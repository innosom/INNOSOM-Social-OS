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
  const status = searchParams.get('status');

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

    if (status) {
      whereClause.status = status;
    }

    const contents = await prisma.content.findMany({
      where: whereClause,
      include: {
        workspace: {
          select: { id: true, name: true, logoUrl: true },
        },
        author: {
          select: { id: true, name: true, avatarUrl: true },
        },
        variants: {
          include: {
            mediaAttachments: {
              include: { mediaAsset: true },
            },
            publications: {
              include: { socialConnection: true },
            },
          },
        },
        approvals: {
          include: { user: { select: { name: true, avatarUrl: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ contents });
  } catch (error: any) {
    console.error('Fetch content error:', error);
    return NextResponse.json({ error: 'Failed to fetch content' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.role === 'VIEWER') {
    return NextResponse.json({ error: 'Forbidden: Read-only role' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const {
      workspaceId,
      title,
      masterCaption,
      platforms,
      scheduledAt,
      submitForApproval,
    } = body;

    if (!workspaceId || !title || !masterCaption || !platforms || !Array.isArray(platforms)) {
      return NextResponse.json({ error: 'Missing required content parameters' }, { status: 400 });
    }

    if (workspaceId === 'ALL_CLIENTS') {
      return NextResponse.json({ error: 'Cannot create content with ALL_CLIENTS workspace selector' }, { status: 400 });
    }

    const { hasAccess } = await validateWorkspaceAccess(session, workspaceId, prisma);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Validate cross-workspace media asset references
    const allMediaIds: string[] = [];
    for (const p of platforms) {
      if (p.mediaAssetIds && Array.isArray(p.mediaAssetIds)) {
        allMediaIds.push(...p.mediaAssetIds);
      }
    }

    if (allMediaIds.length > 0) {
      const mediaAssets = await prisma.mediaAsset.findMany({
        where: { id: { in: allMediaIds } },
      });

      if (mediaAssets.length !== new Set(allMediaIds).size) {
        return NextResponse.json({ error: 'One or more media assets not found' }, { status: 400 });
      }

      const hasCrossWorkspaceMedia = mediaAssets.some((m) => m.workspaceId !== workspaceId);
      if (hasCrossWorkspaceMedia) {
        return NextResponse.json({ error: 'Forbidden: Cross-workspace media asset reference detected' }, { status: 400 });
      }
    }

    const initialStatus = submitForApproval
      ? 'IN_REVIEW'
      : scheduledAt
      ? 'SCHEDULED'
      : 'DRAFT';

    const content = await prisma.content.create({
      data: {
        workspaceId,
        authorId: session.userId,
        title,
        masterCaption,
        status: initialStatus,
      },
    });

    const socialConnections = await prisma.socialConnection.findMany({
      where: { workspaceId },
    });

    for (const p of platforms) {
      const variant = await prisma.contentVariant.create({
        data: {
          contentId: content.id,
          platform: p.platform,
          caption: p.caption || masterCaption,
          hashtags: JSON.stringify(p.hashtags || []),
        },
      });

      if (p.mediaAssetIds && p.mediaAssetIds.length > 0) {
        await prisma.contentVariantMedia.createMany({
          data: p.mediaAssetIds.map((mId: string, idx: number) => ({
            contentVariantId: variant.id,
            mediaAssetId: mId,
            order: idx,
          })),
        });
      }

      const connection = socialConnections.find((c) => c.platform === p.platform);
      if (connection && scheduledAt) {
        await prisma.publication.create({
          data: {
            contentVariantId: variant.id,
            socialConnectionId: connection.id,
            scheduledAt: new Date(scheduledAt),
            status: initialStatus,
            idempotencyKey: `pub_${workspaceId}_${variant.id}_${new Date(scheduledAt).getTime()}`,
          },
        });
      }
    }

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        workspaceId,
        userId: session.userId,
        action: 'CREATE_CONTENT',
        entityType: 'Content',
        entityId: content.id,
        details: JSON.stringify({ title: content.title, status: content.status }),
      },
    });

    return NextResponse.json({ content });
  } catch (error: any) {
    console.error('Create content error:', error);
    return NextResponse.json({ error: 'Failed to create content' }, { status: 500 });
  }
}
