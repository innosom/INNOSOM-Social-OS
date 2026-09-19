import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { getSession, validateWorkspaceAccess } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { StorageProviderFactory } from '@/modules/storage/StorageProviderFactory';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ path: string[] }> }
) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = await props.params;
  const rawSegments = params.path;

  if (!rawSegments || rawSegments.length === 0) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  // 1. Join and normalize key to eliminate any '.' or '..' path traversal segments
  const joinedKey = rawSegments.join('/');
  const normalizedKey = path.normalize(joinedKey).replace(/^(\.\.[\/\\])+/, '').replace(/\\/g, '/');

  // Check for any remaining path traversal attempts
  if (normalizedKey.includes('..')) {
    return NextResponse.json({ error: 'Invalid path traversal attempt' }, { status: 400 });
  }

  const cleanSegments = normalizedKey.split('/').filter(Boolean);

  // 2. Validate workspace access on normalized path segments
  // Expected structure: workspaces/[workspaceId]/...
  if (cleanSegments[0] === 'workspaces') {
    const workspaceId = cleanSegments[1];
    if (!workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace media path' }, { status: 400 });
    }

    const { hasAccess } = await validateWorkspaceAccess(session, workspaceId, prisma);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  } else {
    // Media files must be under workspaces directory
    return NextResponse.json({ error: 'Invalid media path' }, { status: 400 });
  }

  try {
    const storage = StorageProviderFactory.getStorageProvider();
    const result = await storage.getObject(normalizedKey);

    if (!result) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(result.buffer), {
      headers: {
        'Content-Type': result.contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error: any) {
    console.error('Error serving media file:', error);
    return NextResponse.json({ error: 'Failed to serve file' }, { status: 500 });
  }
}
