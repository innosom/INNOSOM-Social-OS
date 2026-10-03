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

    // Role check: Only ADMIN and MANAGER can trigger retries
    if (session.role !== 'ADMIN' && session.role !== 'MANAGER') {
      return NextResponse.json({ error: 'Forbidden: Insufficient permissions to retry publication' }, { status: 403 });
    }

    // Status check: Only FAILED publications can be retried
    if (publication.status !== 'FAILED') {
      return NextResponse.json({ error: `Cannot retry publication with status '${publication.status}'. Only FAILED publications can be retried.` }, { status: 400 });
    }

    // Reset status and idempotency key suffix for retry
    await prisma.publication.update({
      where: { id },
      data: {
        status: 'SCHEDULED',
        errorMessage: null,
        idempotencyKey: `${publication.idempotencyKey}_retried_${Date.now()}`,
      },
    });

    // Enqueue non-blocking job
    await enqueuePublicationJob(publication.id, 0);

    return NextResponse.json({ success: true, message: 'Publication retry queued successfully' });
  } catch (error: any) {
    console.error('Retry publication error:', error);
    return NextResponse.json({ error: 'Failed to retry publication' }, { status: 500 });
  }
}
