import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession, validateWorkspaceAccess, validateWorkspaceMutationAccess } from '@/lib/auth';
import { validateMediaFile, cleanupOrphanMedia } from '@/lib/media';

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

    const media = await prisma.mediaAsset.findMany({
      where: whereClause,
      include: {
        workspace: {
          select: { id: true, name: true, logoUrl: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ media });
  } catch (error: any) {
    console.error('Fetch media error:', error);
    return NextResponse.json({ error: 'Failed to fetch media assets' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.role === 'VIEWER') {
    return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
  }

  try {
    const formData = await req.formData();
    const workspaceId = formData.get('workspaceId') as string;
    const file = formData.get('file') as File | null;
    const folderPath = (formData.get('folderPath') as string) || '/';
    const simulateFailure = formData.get('simulateStorageFailure') === 'true';

    const mutationCheck = await validateWorkspaceMutationAccess(session, workspaceId, prisma);
    if (!mutationCheck.hasAccess) {
      return NextResponse.json(
        { error: mutationCheck.error || 'Forbidden' },
        { status: mutationCheck.error?.includes('ALL_CLIENTS') ? 400 : 403 }
      );
    }

    if (!file) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }

    const fileSize = formData.get('fileSize') ? Number(formData.get('fileSize')) : file.size;

    const validation = validateMediaFile({
      name: file.name,
      size: fileSize,
      type: file.type || 'application/octet-stream',
    });

    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    if (simulateFailure) {
      return NextResponse.json({ error: 'Storage upload failed: S3 connection timeout' }, { status: 500 });
    }

    const isVideo = file.type.startsWith('video/');
    const sampleUrls = isVideo
      ? [
          'https://assets.mixkit.co/videos/preview/mixkit-tree-branches-in-the-breeze-1188-large.mp4',
        ]
      : [
          'https://images.unsplash.com/photo-1542744094-3a3172720249?w=800&auto=format&fit=crop&q=80',
          'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800&auto=format&fit=crop&q=80',
          'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&auto=format&fit=crop&q=80',
        ];

    const publicUrl = sampleUrls[Math.floor(Math.random() * sampleUrls.length)];

    const mediaAsset = await prisma.mediaAsset.create({
      data: {
        workspaceId,
        fileName: file.name,
        fileSize,
        mimeType: file.type || 'application/octet-stream',
        storageKey: `workspaces/${workspaceId}/${Date.now()}-${file.name}`,
        publicUrl,
        folderPath,
        width: isVideo ? 1080 : 1200,
        height: isVideo ? 1920 : 630,
        duration: isVideo ? 30 : null,
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        workspaceId,
        userId: session.userId,
        action: 'UPLOAD_MEDIA',
        entityType: 'MediaAsset',
        entityId: mediaAsset.id,
        details: JSON.stringify({ fileName: mediaAsset.fileName, size: mediaAsset.fileSize }),
      },
    });

    return NextResponse.json({ mediaAsset });
  } catch (error: any) {
    console.error('Upload media error:', error);
    return NextResponse.json({ error: 'Failed to upload media asset' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const orphanCleanup = searchParams.get('orphanCleanup') === 'true';
  const workspaceId = searchParams.get('workspaceId');
  const mediaAssetId = searchParams.get('id');

  try {
    if (orphanCleanup) {
      if (workspaceId && workspaceId !== 'ALL_CLIENTS') {
        const { hasAccess } = await validateWorkspaceAccess(session, workspaceId, prisma);
        if (!hasAccess) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
      }
      const result = await cleanupOrphanMedia(workspaceId || undefined);
      return NextResponse.json({ success: true, deletedCount: result.deletedCount });
    }

    if (!mediaAssetId) {
      return NextResponse.json({ error: 'Media Asset ID is required' }, { status: 400 });
    }

    const asset = await prisma.mediaAsset.findUnique({
      where: { id: mediaAssetId },
    });

    if (!asset) {
      return NextResponse.json({ error: 'Media asset not found' }, { status: 404 });
    }

    const { hasAccess } = await validateWorkspaceAccess(session, asset.workspaceId, prisma);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await prisma.mediaAsset.delete({
      where: { id: mediaAssetId },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete media error:', error);
    return NextResponse.json({ error: 'Failed to delete media asset' }, { status: 500 });
  }
}
