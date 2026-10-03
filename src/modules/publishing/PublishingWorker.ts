import { prisma } from '@/lib/prisma';
import { SocialProviderFactory } from '@/modules/social/SocialProviderFactory';

export async function processPublicationJob(publicationId: string): Promise<{ success: boolean; error?: string }> {
  console.log(`🚀 [Worker] Starting publication execution for ID: ${publicationId}`);

  const publication = await prisma.publication.findUnique({
    where: { id: publicationId },
    include: {
      contentVariant: {
        include: {
          content: {
            include: {
              workspace: true,
            },
          },
          mediaAttachments: {
            include: { mediaAsset: true },
          },
        },
      },
      socialConnection: {
        include: {
          workspace: true,
        },
      },
    },
  });

  if (!publication) {
    console.error(`❌ [Worker] Publication ${publicationId} not found.`);
    return { success: false, error: 'Publication record not found' };
  }

  if (publication.status === 'PUBLISHED') {
    console.log(`ℹ️ [Worker] Publication ${publicationId} is already PUBLISHED. Skipping.`);
    return { success: true };
  }

  // Atomic state transition: Ensure single worker execution and prevent duplicate posting race conditions
  const updateResult = await prisma.publication.updateMany({
    where: {
      id: publicationId,
      status: { in: ['SCHEDULED', 'APPROVED', 'FAILED'] },
    },
    data: {
      status: 'PUBLISHING',
      lastAttemptAt: new Date(),
      attempts: { increment: 1 },
    },
  });

  if (updateResult.count === 0) {
    console.log(`⚠️ [Worker] Publication ${publicationId} lock acquisition failed (already in PUBLISHING or PUBLISHED state). Skipping execution.`);
    return { success: true };
  }

  try {
    const provider = SocialProviderFactory.getProvider(publication.socialConnection.platform);

    const mediaUrls = publication.contentVariant.mediaAttachments.map((m) => m.mediaAsset.publicUrl);
    const parsedHashtags = JSON.parse(publication.contentVariant.hashtags || '[]');

    const publishResult = await provider.publish(
      {
        caption: publication.contentVariant.caption,
        hashtags: parsedHashtags,
        mediaUrls,
      },
      {
        accessTokenEnc: publication.socialConnection.accessTokenEnc,
        refreshTokenEnc: publication.socialConnection.refreshTokenEnc,
        expiresAt: publication.socialConnection.expiresAt,
      },
      publication.idempotencyKey
    );

    if (publishResult.success) {
      await prisma.publication.update({
        where: { id: publicationId },
        data: {
          status: 'PUBLISHED',
          providerPostId: publishResult.providerPostId,
          publishedAt: new Date(),
          errorMessage: null,
        },
      });

      await prisma.content.update({
        where: { id: publication.contentVariant.contentId },
        data: { status: 'PUBLISHED' },
      });

      await prisma.auditLog.create({
        data: {
          organizationId: publication.socialConnection.workspace.organizationId,
          workspaceId: publication.socialConnection.workspaceId,
          userId: publication.contentVariant.content.authorId,
          action: 'PUBLISHED_POST',
          entityType: 'Publication',
          entityId: publication.id,
          details: JSON.stringify({
            platform: publication.socialConnection.platform,
            providerPostId: publishResult.providerPostId,
          }),
        },
      });

      console.log(`✅ [Worker] Publication ${publicationId} published successfully!`);
      return { success: true };
    } else {
      await prisma.publication.update({
        where: { id: publicationId },
        data: {
          status: 'FAILED',
          errorMessage: publishResult.error || 'Unknown publishing error',
        },
      });

      console.error(`❌ [Worker] Publication ${publicationId} failed: ${publishResult.error}`);
      return { success: false, error: publishResult.error };
    }
  } catch (error: any) {
    console.error(`❌ [Worker] Fatal error executing publication ${publicationId}:`, error);

    await prisma.publication.update({
      where: { id: publicationId },
      data: {
        status: 'FAILED',
        errorMessage: error.message || 'Worker unexpected execution error',
      },
    });

    return { success: false, error: error.message };
  }
}
