import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession, validateWorkspaceAccess } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get('workspaceId');

  try {
    const whereClause: any = {};
    if (workspaceId && workspaceId !== 'ALL_CLIENTS') {
      const { hasAccess } = await validateWorkspaceAccess(session, workspaceId, prisma);
      if (!hasAccess) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      whereClause.workspaceId = workspaceId;
    } else {
      whereClause.organizationId = session.organizationId;
    }

    const logs = await prisma.auditLog.findMany({
      where: whereClause,
      include: {
        user: { select: { id: true, name: true, avatarUrl: true, email: true } },
        workspace: { select: { id: true, name: true, logoUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return NextResponse.json({ logs });
  } catch (error: any) {
    console.error('Fetch audit logs error:', error);
    return NextResponse.json({ error: 'Failed to fetch audit logs' }, { status: 500 });
  }
}
