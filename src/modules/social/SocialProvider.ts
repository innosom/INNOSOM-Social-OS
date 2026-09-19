export interface SocialProviderCapabilities {
  canPublishImage: boolean;
  canPublishVideo: boolean;
  canPublishCarousel: boolean;
  canSchedule: boolean;
  supportsStories: boolean;
  supportsReels: boolean;
  supportsShorts: boolean;
  supportsAnalytics: boolean;
  maxCaptionLength: number;
  supportedMediaTypes: ('image' | 'video')[];
  maxMediaCount: number;
}

export interface EncryptedCredentials {
  accessTokenEnc: string;
  refreshTokenEnc?: string | null;
  expiresAt?: Date | null;
}

export interface PublishVariantPayload {
  caption: string;
  hashtags: string[];
  mediaUrls: string[];
  metadata?: Record<string, any>;
}

export interface PublishResult {
  success: boolean;
  providerPostId?: string;
  publishedUrl?: string;
  error?: string;
  isRetriable?: boolean;
  errorCode?: string;
}

export interface ConnectionStatusResult {
  status: 'CONNECTED' | 'EXPIRED' | 'REVOKED' | 'ERROR';
  errorMessage?: string;
}

export interface RefreshTokenResult {
  success: boolean;
  accessTokenEnc?: string;
  refreshTokenEnc?: string | null;
  expiresAt?: Date | null;
  error?: string;
}

export interface SocialProvider {
  getCapabilities(): SocialProviderCapabilities;
  validateConnection(credentials: EncryptedCredentials): Promise<ConnectionStatusResult>;
  refreshCredentials?(credentials: EncryptedCredentials): Promise<RefreshTokenResult>;
  revokeCredentials?(credentials: EncryptedCredentials): Promise<boolean>;
  publish(
    variant: PublishVariantPayload,
    credentials: EncryptedCredentials,
    idempotencyKey: string
  ): Promise<PublishResult>;
}
