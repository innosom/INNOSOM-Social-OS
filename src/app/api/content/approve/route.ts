import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession, validateWorkspaceAccess } from '@/lib/auth';
import { enqueuePublicationJob } from '@/modules/publishing/QueueService';

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.role !== 'ADMIN' && session.role !== 'MANAGER') {
    return NextResponse.json({ error: 'Forbidden: Insufficient permissions to approve content' }, { status: 403 });
  }

  try {
    const { contentId, action, comment } = await req.json();

    if (!contentId || !action) {
      return NextResponse.json({ error: 'contentId and action are required' }, { status: 400 });
    }

    const content = await prisma.content.findUnique({
      where: { id: contentId },
      include: {
        workspace: true,
        variants: {
          include: { publications: true },
        },
      },
    });

    if (!content) {
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    }

    const { hasAccess } = await validateWorkspaceAccess(session, content.workspaceId, prisma);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (content.status === 'PUBLISHED') {
      return NextResponse.json({ error: 'Conflict: Cannot alter approval status of already published content' }, { status: 409 });
    }

    const newStatus = action === 'APPROVE' ? 'APPROVED' : 'DRAFT';

    const updatedContent = await prisma.content.update({
      where: { id: contentId },
      data: { status: newStatus },
    });

    await prisma.approval.create({
      data: {
        contentId,
        userId: session.userId,
        status: newStatus,
        comment: comment || null,
      },
    });

    // Handle variants and associated publications
    const socialConnections = await prisma.socialConnection.findMany({
      where: { workspaceId: content.workspaceId },
    });

    for (const variant of content.variants) {
      const connection = socialConnections.find((c) => c.platform === variant.platform);

      if (variant.publications.length > 0) {
        for (const pub of variant.publications) {
          if (pub.status === 'IN_REVIEW' || pub.status === 'DRAFT' || pub.status === 'APPROVED') {
            const nextPubStatus = action === 'APPROVE' ? 'SCHEDULED' : 'DRAFT';
            const updatedPub = await prisma.publication.update({
              where: { id: pub.id },
              data: { status: nextPubStatus },
            });

            if (action === 'APPROVE') {
              const delay = Math.max(0, new Date(updatedPub.scheduledAt).getTime() - Date.now());
              await enqueuePublicationJob(updatedPub.id, delay);
            }
          }
        }
      } else if (connection && action === 'APPROVE') {
        // Create and enqueue publication if none existed previously
        const scheduledTime = new Date();
        const newPub = await prisma.publication.create({
          data: {
            contentVariantId: variant.id,
            socialConnectionId: connection.id,
            scheduledAt: scheduledTime,
            status: 'SCHEDULED',
            idempotencyKey: `pub_${content.workspaceId}_${variant.id}_${scheduledTime.getTime()}`,
          },
        });
        await enqueuePublicationJob(newPub.id, 0);
      }
    }

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        workspaceId: content.workspaceId,
        userId: session.userId,
        action: action === 'APPROVE' ? 'APPROVE_CONTENT' : 'REQUEST_CONTENT_CHANGES',
        entityType: 'Content',
        entityId: content.id,
        details: JSON.stringify({ comment: comment || '' }),
      },
    });

    return NextResponse.json({ content: updatedContent });
  } catch (error: any) {
    console.error('Approve content error:', error);
    return NextResponse.json({ error: 'Failed to process content approval' }, { status: 500 });
  }
}
