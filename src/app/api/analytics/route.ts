import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession, validateWorkspaceAccess } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
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
      whereClause.workspace = { organizationId: session.organizationId };
    }

    const snapshots = await prisma.analyticsSnapshot.findMany({
      where: whereClause,
      include: {
        workspace: {
          select: { name: true, logoUrl: true },
        },
      },
      orderBy: { date: 'asc' },
    });

    let totalImpressions = 0;
    let totalReach = 0;
    let totalLikes = 0;
    let totalComments = 0;
    let totalShares = 0;
    let totalFollowers = 0;

    snapshots.forEach((s) => {
      totalImpressions += s.impressions;
      totalReach += s.reach;
      totalLikes += s.likes;
      totalComments += s.comments;
      totalShares += s.shares;
      totalFollowers = Math.max(totalFollowers, s.followers);
    });

    return NextResponse.json({
      summary: {
        totalImpressions,
        totalReach,
        totalLikes,
        totalComments,
        totalShares,
        totalFollowers,
        engagementRate: totalReach > 0 ? (((totalLikes + totalComments + totalShares) / totalReach) * 100).toFixed(2) : '0.00',
      },
      snapshots,
    });
  } catch (error: any) {
    console.error('Fetch analytics error:', error);
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 });
  }
}
