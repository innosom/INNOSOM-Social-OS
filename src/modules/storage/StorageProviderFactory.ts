import { StorageProvider } from './StorageProvider';
import { LocalStorageProvider } from './LocalStorageProvider';
import { S3StorageProvider } from './S3StorageProvider';

let instance: StorageProvider | null = null;

export class StorageProviderFactory {
  static getStorageProvider(): StorageProvider {
    if (instance) {
      return instance;
    }

    const driver = process.env.STORAGE_DRIVER || 'local';

    if (driver === 's3') {
      const bucket = process.env.STORAGE_S3_BUCKET || process.env.S3_BUCKET || '';
      const accessKeyId = process.env.STORAGE_S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '';
      const secretAccessKey = process.env.STORAGE_S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '';
      const endpoint = process.env.STORAGE_S3_ENDPOINT || process.env.S3_ENDPOINT;
      const region = process.env.STORAGE_S3_REGION || process.env.AWS_REGION || 'us-east-1';
      const publicBaseUrl = process.env.STORAGE_S3_PUBLIC_URL || process.env.S3_PUBLIC_URL;

      if (!bucket) {
        throw new Error('S3 storage driver configured but STORAGE_S3_BUCKET is missing.');
      }

      instance = new S3StorageProvider({
        bucket,
        accessKeyId,
        secretAccessKey,
        endpoint,
        region,
        publicBaseUrl,
      });
      return instance;
    }

    const baseDir = process.env.STORAGE_LOCAL_DIR;
    const baseUrl = process.env.STORAGE_LOCAL_URL || '/api/media/file';
    instance = new LocalStorageProvider(baseDir, baseUrl);
    return instance;
  }

  static resetInstance(): void {
    instance = null;
  }
}
