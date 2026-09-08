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
}

export interface ConnectionStatusResult {
  status: 'CONNECTED' | 'EXPIRED' | 'REVOKED' | 'ERROR';
  errorMessage?: string;
}

export interface SocialProvider {
  getCapabilities(): SocialProviderCapabilities;
  validateConnection(credentials: EncryptedCredentials): Promise<ConnectionStatusResult>;
  publish(
    variant: PublishVariantPayload,
    credentials: EncryptedCredentials,
    idempotencyKey: string
  ): Promise<PublishResult>;
}
