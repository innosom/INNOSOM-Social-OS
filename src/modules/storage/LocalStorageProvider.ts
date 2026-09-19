import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { StorageProvider, UploadObjectOptions } from './StorageProvider';

export class LocalStorageProvider implements StorageProvider {
  private baseDir: string;
  private baseUrl: string;

  constructor(baseDir?: string, baseUrl?: string) {
    this.baseDir = baseDir || path.join(process.cwd(), 'uploads');
    this.baseUrl = baseUrl || '/api/media/file';
    if (!fsSync.existsSync(this.baseDir)) {
      fsSync.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private getFilePath(key: string): string {
    // Prevent directory traversal by normalizing path and checking containment
    const safeKey = path.normalize(key).replace(/^(\.\.[\/\\])+/, '');
    const targetPath = path.join(this.baseDir, safeKey);
    const resolvedBase = path.resolve(this.baseDir);
    const resolvedTarget = path.resolve(targetPath);

    if (!resolvedTarget.startsWith(resolvedBase)) {
      throw new Error('Path traversal attempt detected');
    }
    return resolvedTarget;
  }

  async uploadObject(options: UploadObjectOptions): Promise<string> {
    const filePath = this.getFilePath(options.key);
    const parentDir = path.dirname(filePath);
    await fs.mkdir(parentDir, { recursive: true });
    await fs.writeFile(filePath, options.buffer);
    return this.getPublicUrl(options.key);
  }

  async deleteObject(key: string): Promise<void> {
    try {
      const filePath = this.getFilePath(key);
      await fs.unlink(filePath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
  }

  getPublicUrl(key: string): string {
    const safeKey = path.normalize(key).replace(/^(\.\.[\/\\])+/, '');
    const cleanKey = safeKey.split(path.sep).join('/');
    return `${this.baseUrl}/${cleanKey}`;
  }

  async getSignedUrl(key: string, expiresInSeconds: number = 3600): Promise<string> {
    // For local storage, standard URL with temporary signature/expires param
    const publicUrl = this.getPublicUrl(key);
    const expiresAt = Date.now() + expiresInSeconds * 1000;
    return `${publicUrl}?expires=${expiresAt}`;
  }

  async exists(key: string): Promise<boolean> {
    try {
      const filePath = this.getFilePath(key);
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async getObject(key: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    try {
      const filePath = this.getFilePath(key);
      const buffer = await fs.readFile(filePath);
      // Basic MIME type fallback from key
      let contentType = 'application/octet-stream';
      if (key.endsWith('.jpg') || key.endsWith('.jpeg')) contentType = 'image/jpeg';
      else if (key.endsWith('.png')) contentType = 'image/png';
      else if (key.endsWith('.webp')) contentType = 'image/webp';
      else if (key.endsWith('.gif')) contentType = 'image/gif';
      else if (key.endsWith('.mp4')) contentType = 'video/mp4';
      else if (key.endsWith('.webm')) contentType = 'video/webm';

      return { buffer, contentType };
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }
}
