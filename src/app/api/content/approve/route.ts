import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession, validateWorkspaceAccess } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { contentId, action, comment } = await req.json();

    if (!contentId || !action) {
      return NextResponse.json({ error: 'contentId and action are required' }, { status: 400 });
    }

    const content = await prisma.content.findUnique({
      where: { id: contentId },
      include: {
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

    for (const variant of content.variants) {
      for (const pub of variant.publications) {
        if (pub.status === 'IN_REVIEW' || pub.status === 'DRAFT') {
          await prisma.publication.update({
            where: { id: pub.id },
            data: { status: action === 'APPROVE' ? 'SCHEDULED' : 'DRAFT' },
          });
        }
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
