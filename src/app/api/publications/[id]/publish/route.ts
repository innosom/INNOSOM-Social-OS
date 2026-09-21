import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession, validateWorkspaceAccess } from '@/lib/auth';
import { enqueuePublicationJob } from '@/modules/publishing/QueueService';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.role !== 'ADMIN' && session.role !== 'MANAGER') {
    return NextResponse.json({ error: 'Forbidden: Insufficient permissions to trigger immediate publishing' }, { status: 403 });
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

    const parentStatus = publication.contentVariant.content.status;
    if (parentStatus !== 'APPROVED' && parentStatus !== 'SCHEDULED' && parentStatus !== 'PUBLISHED') {
      return NextResponse.json({ error: 'Forbidden: Cannot trigger publish on unapproved or draft content' }, { status: 403 });
    }

    // Enqueue non-blocking job
    await enqueuePublicationJob(publication.id, 0);

    return NextResponse.json({ success: true, message: 'Publication execution queued successfully' });
  } catch (error: any) {
    console.error('Publish trigger error:', error);
    return NextResponse.json({ error: 'Failed to execute publication' }, { status: 500 });
  }
}
