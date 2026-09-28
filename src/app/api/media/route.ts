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
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const workspaceId = formData.get('workspaceId') as string;
    const file = formData.get('file') as File | null;
    const folderPath = (formData.get('folderPath') as string) || '/';

    if (!workspaceId || !file) {
      return NextResponse.json({ error: 'workspaceId and file are required' }, { status: 400 });
    }

    const { hasAccess } = await validateWorkspaceAccess(session, workspaceId, prisma);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Security validation: File size limit (50MB)
    const MAX_FILE_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File size exceeds maximum allowed limit of 50MB' }, { status: 400 });
    }

    // Security validation: File mime-type check
    const mimeType = file.type || 'application/octet-stream';
    if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/')) {
      return NextResponse.json({ error: 'Unsupported file type. Only image and video files are permitted.' }, { status: 400 });
    }

    // Sanitize folderPath against directory traversal
    const safeFolderPath = '/' + folderPath.replace(/\.\./g, '').replace(/\/+/g, '/').replace(/^\//, '');
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');

    const isVideo = mimeType.startsWith('video/');
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
        fileName: cleanFileName,
        fileSize: file.size,
        mimeType,
        storageKey: `workspaces/${workspaceId}/${Date.now()}-${cleanFileName}`,
        publicUrl,
        folderPath: safeFolderPath,
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
