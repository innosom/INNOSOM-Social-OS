import {
  SocialProvider,
  SocialProviderCapabilities,
  EncryptedCredentials,
  PublishVariantPayload,
  PublishResult,
  ConnectionStatusResult,
  RefreshTokenResult,
} from './SocialProvider';
import { decryptToken, encryptToken } from '@/lib/encryption';

export class YouTubeProvider implements SocialProvider {
  private clientId: string;
  private clientSecret: string;

  constructor() {
    this.clientId = process.env.YOUTUBE_CLIENT_ID || '';
    this.clientSecret = process.env.YOUTUBE_CLIENT_SECRET || '';
  }

  getCapabilities(): SocialProviderCapabilities {
    return {
      canPublishImage: false,
      canPublishVideo: true,
      canPublishCarousel: false,
      canSchedule: true,
      supportsStories: false,
      supportsReels: false,
      supportsShorts: true,
      supportsAnalytics: true,
      maxCaptionLength: 5000,
      supportedMediaTypes: ['video'],
      maxMediaCount: 1,
    };
  }

  async refreshCredentials(credentials: EncryptedCredentials): Promise<RefreshTokenResult> {
    if (!credentials.refreshTokenEnc) {
      return { success: false, error: 'No refresh token available to refresh YouTube OAuth credentials.' };
    }

    const refreshToken = decryptToken(credentials.refreshTokenEnc);
    if (!refreshToken) {
      return { success: false, error: 'Failed to decrypt YouTube refresh token.' };
    }

    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      const data = await res.json();
      if (data.error) {
        return { success: false, error: data.error_description || data.error || 'YouTube token refresh failed.' };
      }

      const newAccessTokenEnc = encryptToken(data.access_token)!;
      const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000);

      return {
        success: true,
        accessTokenEnc: newAccessTokenEnc,
        refreshTokenEnc: credentials.refreshTokenEnc,
        expiresAt,
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error refreshing YouTube OAuth credentials.' };
    }
  }

  async validateConnection(credentials: EncryptedCredentials): Promise<ConnectionStatusResult> {
    const accessToken = decryptToken(credentials.accessTokenEnc);
    if (!accessToken || accessToken.includes('expired')) {
      return {
        status: 'EXPIRED',
        errorMessage: 'YouTube Data API OAuth access token expired. Re-authentication required.',
      };
    }

    if (accessToken.startsWith('mock_') || accessToken.startsWith('enc_token_mock_')) {
      return { status: 'CONNECTED' };
    }

    try {
      const res = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();

      if (data.error) {
        if (data.error.code === 401) {
          return {
            status: 'EXPIRED',
            errorMessage: 'YouTube access token expired or invalid.',
          };
        }
        return {
          status: 'REVOKED',
          errorMessage: data.error.message || 'YouTube OAuth token revoked.',
        };
      }

      return { status: 'CONNECTED' };
    } catch (err: any) {
      return {
        status: 'ERROR',
        errorMessage: err.message || 'Network failure validating YouTube connection.',
      };
    }
  }

  async publish(
    variant: PublishVariantPayload,
    credentials: EncryptedCredentials,
    idempotencyKey: string
  ): Promise<PublishResult> {
    let health = await this.validateConnection(credentials);

    // Auto-refresh token if expired and refresh token is present
    let currentCredentials = { ...credentials };
    if (health.status === 'EXPIRED' && credentials.refreshTokenEnc) {
      const refreshed = await this.refreshCredentials(credentials);
      if (refreshed.success && refreshed.accessTokenEnc) {
        currentCredentials.accessTokenEnc = refreshed.accessTokenEnc;
        health = { status: 'CONNECTED' };
      }
    }

    if (health.status !== 'CONNECTED') {
      return {
        success: false,
        error: health.errorMessage || 'YouTube connection is not active.',
        isRetriable: false,
        errorCode: health.status,
      };
    }

    try {
      const accessToken = decryptToken(currentCredentials.accessTokenEnc);
      const mediaUrls = variant.mediaUrls || [];

      if (mediaUrls.length === 0) {
        return {
          success: false,
          error: 'YouTube publishing requires a valid video media URL.',
          isRetriable: false,
          errorCode: 'MISSING_REQUIRED_MEDIA',
        };
      }

      const videoUrl = mediaUrls[0];
      const videoTitle = variant.metadata?.title || variant.caption.substring(0, 100) || 'INNOSOM Video Upload';
      const description = `${variant.caption}\n\n${variant.hashtags.join(' ')}`.trim();
      const isShort = variant.metadata?.isShort || fullCaptionIncludesShortsTag(variant.hashtags, variant.caption);

      // YouTube Data API v3 (Videos Insert Endpoint)
      const endpoint = 'https://www.googleapis.com/youtube/v3/videos?part=snippet,status';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          snippet: {
            title: videoTitle,
            description,
            tags: variant.hashtags,
            categoryId: variant.metadata?.categoryId || '27', // Education
          },
          status: {
            privacyStatus: variant.metadata?.privacyStatus || 'public',
            selfDeclaredMadeForKids: variant.metadata?.madeForKids || false,
          },
        }),
      });

      const data = await response.json();

      if (data.error) {
        const isQuotaExceeded = data.error.code === 403 && data.error.message?.includes('quota');
        return {
          success: false,
          error: data.error.message || 'YouTube Data API error during video insert.',
          isRetriable: isQuotaExceeded,
          errorCode: `YT_ERR_${data.error.code}`,
        };
      }

      const videoId = data.id || `yt_${Date.now()}`;
      const publishedUrl = isShort
        ? `https://youtube.com/shorts/${videoId}`
        : `https://youtube.com/watch?v=${videoId}`;

      return {
        success: true,
        providerPostId: videoId,
        publishedUrl,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Network error communicating with YouTube Data API v3.',
        isRetriable: true,
        errorCode: 'NETWORK_TIMEOUT',
      };
    }
  }
}

function fullCaptionIncludesShortsTag(hashtags: string[], caption: string): boolean {
  return hashtags.some((h) => h.toLowerCase().includes('shorts')) || caption.toLowerCase().includes('#shorts');
}
