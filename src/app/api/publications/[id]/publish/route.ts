import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession, validateWorkspaceAccess } from '@/lib/auth';
import { enqueuePublicationJob } from '@/modules/publishing/QueueService';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const publication = await prisma.publication.findUnique({
      where: { id },
      include: {
        socialConnection: true,
        contentVariant: {
          include: { content: true },
        },
      },
    });

    if (!publication) {
      return NextResponse.json({ error: 'Publication not found' }, { status: 404 });
    }

    const { hasAccess } = await validateWorkspaceAccess(
      session,
      publication.socialConnection.workspaceId,
      prisma
    );

    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Guard: Prevent approval bypass. Post must be in APPROVED or SCHEDULED status (and content not DRAFT/IN_REVIEW)
    const contentStatus = publication.contentVariant.content.status;
    if (contentStatus === 'DRAFT' || contentStatus === 'IN_REVIEW') {
      return NextResponse.json(
        { error: 'Forbidden: Cannot publish content that has not been approved' },
        { status: 400 }
      );
    }

    if (publication.status !== 'SCHEDULED' && publication.status !== 'APPROVED' && publication.status !== 'FAILED') {
      return NextResponse.json(
        { error: `Cannot trigger publishing for publication in status '${publication.status}'` },
        { status: 400 }
      );
    }

    // Enqueue non-blocking job
    await enqueuePublicationJob(publication.id, 0);

    return NextResponse.json({ success: true, message: 'Publication execution queued successfully' });
  } catch (error: any) {
    console.error('Publish trigger error:', error);
    return NextResponse.json({ error: 'Failed to execute publication' }, { status: 500 });
  }
}
