import path from 'node:path';

export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

export const MIME_TO_EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/jpg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'image/svg+xml': ['.svg'],
  'video/mp4': ['.mp4'],
  'video/webm': ['.webm'],
  'video/quicktime': ['.mov'],
};

export const DEFAULT_MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateMediaFile(
  file: { name: string; size: number; type: string },
  maxSizeBytes: number = DEFAULT_MAX_FILE_SIZE
): ValidationResult {
  if (!file) {
    return { valid: false, error: 'File is required' };
  }

  // 1. Filename sanity check & Path traversal check
  if (!file.name || typeof file.name !== 'string' || file.name.trim() === '') {
    return { valid: false, error: 'Invalid filename' };
  }

  if (file.name.includes('\0') || file.name.includes('..') || file.name.includes('/') || file.name.includes('\\')) {
    return { valid: false, error: 'Filename contains invalid characters or path traversal elements' };
  }

  // Check extension existence
  const ext = path.extname(file.name).toLowerCase();
  if (!ext || ext === '.') {
    return { valid: false, error: 'File extension is required' };
  }

  // 2. MIME type validation
  const mimeType = (file.type || '').toLowerCase();
  if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
    return { valid: false, error: `Unsupported or invalid MIME type: ${file.type || 'none'}` };
  }

  // 3. File extension matching MIME type
  const allowedExtensions = MIME_TO_EXTENSIONS[mimeType];
  if (allowedExtensions && !allowedExtensions.includes(ext)) {
    return { valid: false, error: `File extension '${ext}' does not match MIME type '${file.type}'` };
  }

  // 4. File size validation
  if (file.size <= 0) {
    return { valid: false, error: 'File cannot be empty' };
  }

  if (file.size > maxSizeBytes) {
    return { valid: false, error: `File size exceeds the maximum limit of ${maxSizeBytes / (1024 * 1024)}MB` };
  }

  return { valid: true };
}

export function sanitizeFileName(fileName: string): string {
  // Remove any directory components and strip characters other than alphanumeric, dots, hyphens, and underscores
  const basename = path.basename(fileName);
  return basename
    .replace(/[^\w\.-]/g, '_')
    .replace(/_+/g, '_');
}

export function sanitizeFolderPath(folderPath: string): string {
  if (!folderPath) return '/';
  const normalized = path.normalize(folderPath).replace(/^(\.\.[\/\\])+/, '');
  if (normalized === '.' || normalized === '') return '/';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

export function generateStorageKey(workspaceId: string, fileName: string): string {
  const safeWorkspaceId = sanitizeFileName(workspaceId);
  const safeFileName = sanitizeFileName(fileName);
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  return `workspaces/${safeWorkspaceId}/${timestamp}-${randomSuffix}-${safeFileName}`;
}
