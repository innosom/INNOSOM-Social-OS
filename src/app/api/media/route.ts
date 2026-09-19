import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession, validateWorkspaceAccess } from '@/lib/auth';
import { StorageProviderFactory } from '@/modules/storage/StorageProviderFactory';
import { validateMediaFile, generateStorageKey, sanitizeFolderPath } from '@/modules/storage/validation';
import { extractMediaMetadata } from '@/modules/storage/metadata';

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

  try {
    const formData = await req.formData();
    const workspaceId = formData.get('workspaceId') as string;
    const file = formData.get('file') as File | null;
    const rawFolderPath = (formData.get('folderPath') as string) || '/';

    if (!workspaceId || !file) {
      return NextResponse.json({ error: 'workspaceId and file are required' }, { status: 400 });
    }

    // Authorization check
    const { hasAccess } = await validateWorkspaceAccess(session, workspaceId, prisma);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Validation check (MIME type, extension, size, filename)
    const validation = validateMediaFile(file);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const folderPath = sanitizeFolderPath(rawFolderPath);

    // Extract actual metadata (width, height, duration, mimeType, fileSize)
    const metadata = extractMediaMetadata(buffer, file.type);

    // Generate safe storage key
    const storageKey = generateStorageKey(workspaceId, file.name);

    const storage = StorageProviderFactory.getStorageProvider();

    // Store asset in object storage
    let publicUrl: string;
    try {
      publicUrl = await storage.uploadObject({
        key: storageKey,
        buffer,
        contentType: metadata.mimeType,
        isPublic: true,
      });
    } catch (storageError: any) {
      console.error('Storage upload failed:', storageError);
      return NextResponse.json({ error: 'Failed to upload media file to storage' }, { status: 500 });
    }

    // Database record creation with cleanup if DB operation fails
    try {
      const mediaAsset = await prisma.$transaction(async (tx) => {
        const createdAsset = await tx.mediaAsset.create({
          data: {
            workspaceId,
            fileName: file.name,
            fileSize: metadata.fileSize,
            mimeType: metadata.mimeType,
            storageKey,
            publicUrl,
            folderPath,
            width: metadata.width,
            height: metadata.height,
            duration: metadata.duration,
          },
        });

        await tx.auditLog.create({
          data: {
            organizationId: session.organizationId,
            workspaceId,
            userId: session.userId,
            action: 'UPLOAD_MEDIA',
            entityType: 'MediaAsset',
            entityId: createdAsset.id,
            details: JSON.stringify({ fileName: createdAsset.fileName, size: createdAsset.fileSize }),
          },
        });

        return createdAsset;
      });

      return NextResponse.json({ mediaAsset });
    } catch (dbError: any) {
      console.error('Database record creation failed after storage upload, rolling back storage file:', dbError);
      try {
        await storage.deleteObject(storageKey);
      } catch (cleanupError) {
        console.error('Failed to cleanup storage file after database error:', cleanupError);
      }
      return NextResponse.json({ error: 'Failed to save media asset record' }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Upload media error:', error);
    return NextResponse.json({ error: 'Failed to upload media asset' }, { status: 500 });
  }
}
