import { prisma } from './prisma';

export const ALLOWED_MEDIA_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
];

export const MAX_MEDIA_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

export function validateMediaFile(file: { name: string; size: number; type: string }): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: 'File is required' };
  }

  const isAllowedType =
    ALLOWED_MEDIA_MIME_TYPES.includes(file.type.toLowerCase()) ||
    file.type.startsWith('image/') ||
    file.type.startsWith('video/');

  if (!isAllowedType) {
    return { valid: false, error: 'Invalid file type. Only standard image and video files are supported.' };
  }

  if (file.size > MAX_MEDIA_FILE_SIZE_BYTES) {
    return { valid: false, error: `File size exceeds maximum allowed limit (${MAX_MEDIA_FILE_SIZE_BYTES / (1024 * 1024)}MB)` };
  }

  return { valid: true };
}

export async function cleanupOrphanMedia(workspaceId?: string): Promise<{ deletedCount: number }> {
  const whereClause: any = {
    contentVariants: { none: {} },
  };

  if (workspaceId && workspaceId !== 'ALL_CLIENTS') {
    whereClause.workspaceId = workspaceId;
  }

  const orphanAssets = await prisma.mediaAsset.findMany({
    where: whereClause,
    select: { id: true },
  });

  const ids = orphanAssets.map((a) => a.id);
  if (ids.length > 0) {
    await prisma.mediaAsset.deleteMany({
      where: { id: { in: ids } },
    });
  }

  return { deletedCount: ids.length };
}
