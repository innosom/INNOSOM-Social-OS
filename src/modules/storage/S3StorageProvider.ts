import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as s3GetSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageProvider, UploadObjectOptions } from './StorageProvider';

export interface S3StorageConfig {
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
  forcePathStyle?: boolean;
}

export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;
  private publicBaseUrl?: string;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.publicBaseUrl = config.publicBaseUrl;

    this.client = new S3Client({
      region: config.region || 'us-east-1',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle ?? true,
    });
  }

  async uploadObject(options: UploadObjectOptions): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: options.key,
      Body: options.buffer,
      ContentType: options.contentType,
    });

    await this.client.send(command);
    return this.getPublicUrl(options.key);
  }

  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.client.send(command);
  }

  getPublicUrl(key: string): string {
    if (this.publicBaseUrl) {
      const baseUrl = this.publicBaseUrl.endsWith('/')
        ? this.publicBaseUrl.slice(0, -1)
        : this.publicBaseUrl;
      const cleanKey = key.startsWith('/') ? key.slice(1) : key;
      return `${baseUrl}/${cleanKey}`;
    }

    const endpoint = this.client.config.endpoint
      ? this.client.config.endpoint.toString()
      : `https://s3.${this.client.config.region}.amazonaws.com`;

    const cleanEndpoint = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
    const cleanKey = key.startsWith('/') ? key.slice(1) : key;
    return `${cleanEndpoint}/${this.bucket}/${cleanKey}`;
  }

  async getSignedUrl(key: string, expiresInSeconds: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return await s3GetSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async exists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.client.send(command);
      return true;
    } catch {
      return false;
    }
  }

  async getObject(key: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const response = await this.client.send(command);
      if (!response.Body) return null;

      const byteArray = await response.Body.transformToByteArray();
      const buffer = Buffer.from(byteArray);
      const contentType = response.ContentType || 'application/octet-stream';
      return { buffer, contentType };
    } catch {
      return null;
    }
  }
}
