import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession, validateWorkspaceAccess } from '@/lib/auth';
import { SocialProviderFactory } from '@/modules/social/SocialProviderFactory';

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
      whereClause.workspace = { organizationId: session.organizationId };
    }

    const connections = await prisma.socialConnection.findMany({
      where: whereClause,
      include: {
        workspace: {
          select: { id: true, name: true, logoUrl: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const evaluatedConnections = await Promise.all(
      connections.map(async (conn) => {
        const provider = SocialProviderFactory.getProvider(conn.platform);
        const health = await provider.validateConnection({
          accessTokenEnc: conn.accessTokenEnc,
          refreshTokenEnc: conn.refreshTokenEnc,
          expiresAt: conn.expiresAt,
        });

        if (health.status !== conn.status) {
          await prisma.socialConnection.update({
            where: { id: conn.id },
            data: {
              status: health.status,
              healthErrorMessage: health.errorMessage || null,
              lastCheckedAt: new Date(),
            },
          });
        }

        return {
          ...conn,
          status: health.status,
          healthErrorMessage: health.errorMessage || conn.healthErrorMessage,
          capabilities: JSON.parse(conn.capabilities || '{}'),
        };
      })
    );

    return NextResponse.json({ connections: evaluatedConnections });
  } catch (error: any) {
    console.error('Fetch social connections error:', error);
    return NextResponse.json({ error: 'Failed to fetch social connections' }, { status: 500 });
  }
}
