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
    if (!workspaceId || workspaceId === 'ALL_CLIENTS') {
      const activeClientsCount = await prisma.workspace.count({
        where: { organizationId: session.organizationId },
      });

      const socialConnectionsCount = await prisma.socialConnection.count({
        where: { workspace: { organizationId: session.organizationId } },
      });

      const scheduledPublicationsCount = await prisma.publication.count({
        where: {
          socialConnection: { workspace: { organizationId: session.organizationId } },
          status: 'SCHEDULED',
        },
      });

      const pendingApprovalsCount = await prisma.content.count({
        where: {
          workspace: { organizationId: session.organizationId },
          status: 'IN_REVIEW',
        },
      });

      const failedPublications = await prisma.publication.findMany({
        where: {
          socialConnection: { workspace: { organizationId: session.organizationId } },
          status: 'FAILED',
        },
        include: {
          contentVariant: { include: { content: true } },
          socialConnection: { include: { workspace: true } },
        },
        take: 5,
        orderBy: { updatedAt: 'desc' },
      });

      const upcomingPublications = await prisma.publication.findMany({
        where: {
          socialConnection: { workspace: { organizationId: session.organizationId } },
          status: { in: ['SCHEDULED', 'APPROVED'] },
        },
        include: {
          contentVariant: { include: { content: true } },
          socialConnection: { include: { workspace: true } },
        },
        take: 5,
        orderBy: { scheduledAt: 'asc' },
      });

      const expiredConnections = await prisma.socialConnection.findMany({
        where: {
          workspace: { organizationId: session.organizationId },
          status: { in: ['EXPIRED', 'REVOKED', 'ERROR'] },
        },
        include: { workspace: true },
      });

      return NextResponse.json({
        type: 'AGENCY',
        metrics: {
          activeClientsCount,
          socialConnectionsCount,
          scheduledPublicationsCount,
          pendingApprovalsCount,
          failedCount: failedPublications.length,
          expiredConnectionsCount: expiredConnections.length,
        },
        failedPublications,
        upcomingPublications,
        expiredConnections,
      });
    } else {
      const { hasAccess, workspace } = await validateWorkspaceAccess(session, workspaceId, prisma);
      if (!hasAccess || !workspace) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const socialConnections = await prisma.socialConnection.findMany({
        where: { workspaceId },
      });

      const scheduledCount = await prisma.publication.count({
        where: {
          socialConnection: { workspaceId },
          status: 'SCHEDULED',
        },
      });

      const draftsCount = await prisma.content.count({
        where: { workspaceId, status: 'DRAFT' },
      });

      const pendingApprovalsCount = await prisma.content.count({
        where: { workspaceId, status: 'IN_REVIEW' },
      });

      const recentFailures = await prisma.publication.findMany({
        where: {
          socialConnection: { workspaceId },
          status: 'FAILED',
        },
        include: {
          contentVariant: { include: { content: true } },
          socialConnection: true,
        },
        take: 5,
        orderBy: { updatedAt: 'desc' },
      });

      const upcomingPublications = await prisma.publication.findMany({
        where: {
          socialConnection: { workspaceId },
          status: { in: ['SCHEDULED', 'APPROVED'] },
        },
        include: {
          contentVariant: { include: { content: true } },
          socialConnection: true,
        },
        take: 5,
        orderBy: { scheduledAt: 'asc' },
      });

      return NextResponse.json({
        type: 'WORKSPACE',
        workspace,
        metrics: {
          connectionsCount: socialConnections.length,
          scheduledCount,
          draftsCount,
          pendingApprovalsCount,
          failuresCount: recentFailures.length,
        },
        socialConnections,
        recentFailures,
        upcomingPublications,
      });
    }
  } catch (error: any) {
    console.error('Fetch dashboard error:', error);
    return NextResponse.json({ error: 'Failed to fetch dashboard data' }, { status: 500 });
  }
}
