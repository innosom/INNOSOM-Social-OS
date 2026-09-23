import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession, validateWorkspaceAccess } from '@/lib/auth';
import { SocialProviderFactory } from '@/modules/social/SocialProviderFactory';
import { encryptToken } from '@/lib/encryption';

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

        // IMPORTANT SECURITY RULE: Exclude raw/encrypted access/refresh tokens before returning to client
        const { accessTokenEnc, refreshTokenEnc, ...safeConnection } = conn;

        return {
          ...safeConnection,
          status: health.status,
          healthErrorMessage: health.errorMessage || conn.healthErrorMessage,
          capabilities: JSON.parse(conn.capabilities || '{}'),
        };
      })
    );

    return NextResponse.json({ connections: evaluatedConnections });
  } catch (error: any) {
    console.error('Fetch social connections error:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Failed to fetch social connections' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.role !== 'ADMIN' && session.role !== 'MANAGER') {
    return NextResponse.json({ error: 'Forbidden: Insufficient permissions to modify social connections' }, { status: 403 });
  }

  try {
    const { workspaceId, platform, accountName, accountId, avatarUrl, accessToken, refreshToken } = await req.json();

    if (!workspaceId || !platform || !accountName || !accountId) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    const { hasAccess, workspace } = await validateWorkspaceAccess(session, workspaceId, prisma);
    if (!hasAccess || !workspace) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const provider = SocialProviderFactory.getProvider(platform);
    const capabilities = provider.getCapabilities();

    const rawAccessToken = accessToken || `enc_token_mock_${platform.toLowerCase()}_${Date.now()}`;
    const encryptedAccessToken = encryptToken(rawAccessToken)!;
    const encryptedRefreshToken = refreshToken ? encryptToken(refreshToken) : null;

    const connection = await prisma.socialConnection.create({
      data: {
        workspaceId,
        platform,
        accountName,
        accountId,
        avatarUrl: avatarUrl || workspace.logoUrl,
        status: 'CONNECTED',
        scopes: JSON.stringify(['publish_content', 'read_insights']),
        accessTokenEnc: encryptedAccessToken,
        refreshTokenEnc: encryptedRefreshToken,
        capabilities: JSON.stringify(capabilities),
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        workspaceId,
        userId: session.userId,
        action: 'CONNECT_SOCIAL_ACCOUNT',
        entityType: 'SocialConnection',
        entityId: connection.id,
        details: JSON.stringify({ platform, accountName, accountId }),
      },
    });

    const { accessTokenEnc, refreshTokenEnc, ...safeConnection } = connection;
    return NextResponse.json({ connection: safeConnection });
  } catch (error: any) {
    console.error('Connect social account error:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Failed to connect social account' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.role !== 'ADMIN' && session.role !== 'MANAGER') {
    return NextResponse.json({ error: 'Forbidden: Insufficient permissions to modify social connections' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Connection ID is required' }, { status: 400 });
    }

    const connection = await prisma.socialConnection.findUnique({
      where: { id },
      include: { workspace: true },
    });

    if (!connection) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    }

    const { hasAccess } = await validateWorkspaceAccess(
      session,
      connection.workspaceId,
      prisma
    );

    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await prisma.socialConnection.delete({
      where: { id },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        workspaceId: connection.workspaceId,
        userId: session.userId,
        action: 'DISCONNECT_SOCIAL_ACCOUNT',
        entityType: 'SocialConnection',
        entityId: id,
        details: JSON.stringify({ platform: connection.platform, accountName: connection.accountName }),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Disconnect social account error:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Failed to disconnect social account' }, { status: 500 });
  }
}
