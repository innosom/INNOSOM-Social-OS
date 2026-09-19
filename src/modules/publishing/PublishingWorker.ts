import { prisma } from '@/lib/prisma';
import { SocialProviderFactory } from '@/modules/social/SocialProviderFactory';
import { calculateParentContentStatus } from './StateMachine';

export async function processPublicationJob(
  publicationId: string
): Promise<{ success: boolean; error?: string; isRetriable?: boolean }> {
  console.log(`🚀 [Worker] Starting publication execution for ID: ${publicationId}`);

  // Fetch publication record to check status
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
    return { success: false, error: 'Publication record not found', isRetriable: false };
  }

  // Idempotency check: if already PUBLISHED, return immediately
  if (publication.status === 'PUBLISHED') {
    console.log(`ℹ️ [Worker] Publication ${publicationId} is already PUBLISHED. Skipping execution.`);
    return { success: true };
  }

  // Atomic state claim: attempt to transition from SCHEDULED or FAILED to PUBLISHING
  const claimResult = await prisma.publication.updateMany({
    where: {
      id: publicationId,
      status: { in: ['SCHEDULED', 'FAILED'] },
    },
    data: {
      status: 'PUBLISHING',
      lastAttemptAt: new Date(),
      attempts: { increment: 1 },
    },
  });

  if (claimResult.count === 0) {
    // If another worker already claimed it and updated status (or published it)
    const currentPub = await prisma.publication.findUnique({ where: { id: publicationId } });
    if (currentPub?.status === 'PUBLISHED') {
      return { success: true };
    }
    console.log(`⚠️ [Worker] Publication ${publicationId} is already being processed or in non-claimable state (${currentPub?.status}).`);
    return { success: true };
  }

  try {
    const provider = SocialProviderFactory.getProvider(publication.socialConnection.platform);

    // Validate social connection credentials first
    const health = await provider.validateConnection({
      accessTokenEnc: publication.socialConnection.accessTokenEnc,
      refreshTokenEnc: publication.socialConnection.refreshTokenEnc,
      expiresAt: publication.socialConnection.expiresAt,
    });

    if (health.status === 'EXPIRED' || health.status === 'REVOKED') {
      // Mark connection as EXPIRED
      await prisma.socialConnection.update({
        where: { id: publication.socialConnectionId },
        data: {
          status: health.status,
          healthErrorMessage: health.errorMessage || 'Social connection token expired or revoked.',
        },
      });

      const failureMessage = health.errorMessage || `${publication.socialConnection.platform} token expired or revoked. Re-authentication required.`;

      await prisma.publication.update({
        where: { id: publicationId },
        data: {
          status: 'FAILED',
          errorMessage: failureMessage,
        },
      });

      await syncParentContentStatus(publication.contentVariant.contentId);

      return {
        success: false,
        error: failureMessage,
        isRetriable: false,
      };
    }

    // Check if provider has reconciliation capability for timeout safety
    if (provider.checkPostStatus) {
      const existingStatus = await provider.checkPostStatus(publication.idempotencyKey, {
        accessTokenEnc: publication.socialConnection.accessTokenEnc,
        refreshTokenEnc: publication.socialConnection.refreshTokenEnc,
        expiresAt: publication.socialConnection.expiresAt,
      });

      if (existingStatus.published && existingStatus.providerPostId) {
        console.log(`ℹ️ [Worker] Provider reconciliation found post already created for key ${publication.idempotencyKey}`);
        await prisma.publication.update({
          where: { id: publicationId },
          data: {
            status: 'PUBLISHED',
            providerPostId: existingStatus.providerPostId,
            publishedAt: new Date(),
            errorMessage: null,
          },
        });

        await syncParentContentStatus(publication.contentVariant.contentId);
        return { success: true };
      }
    }

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

      await syncParentContentStatus(publication.contentVariant.contentId);

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

      await syncParentContentStatus(publication.contentVariant.contentId);

      console.error(`❌ [Worker] Publication ${publicationId} failed: ${publishResult.error}`);
      return {
        success: false,
        error: publishResult.error,
        isRetriable: publishResult.isRetriable ?? false,
      };
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

    await syncParentContentStatus(publication.contentVariant.contentId);

    return { success: false, error: error.message, isRetriable: true };
  }
}

/**
 * Synchronize the parent Content status based on all child publications.
 */
export async function syncParentContentStatus(contentId: string): Promise<void> {
  const content = await prisma.content.findUnique({
    where: { id: contentId },
    include: {
      variants: {
        include: {
          publications: true,
        },
      },
    },
  });

  if (!content) return;

  const allPubStatuses = content.variants.flatMap((v) => v.publications.map((p) => p.status));
  const newContentStatus = calculateParentContentStatus(allPubStatuses);

  if (content.status !== newContentStatus) {
    await prisma.content.update({
      where: { id: contentId },
      data: { status: newContentStatus },
    });
  }
}
