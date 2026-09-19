export interface UploadObjectOptions {
  key: string;
  buffer: Buffer;
  contentType: string;
  isPublic?: boolean;
}

export interface StorageProvider {
  uploadObject(options: UploadObjectOptions): Promise<string>;
  deleteObject(key: string): Promise<void>;
  getPublicUrl(key: string): string;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  exists(key: string): Promise<boolean>;
  getObject(key: string): Promise<{ buffer: Buffer; contentType: string } | null>;
}
