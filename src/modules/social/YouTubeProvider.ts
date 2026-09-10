import {
  SocialProvider,
  SocialProviderCapabilities,
  EncryptedCredentials,
  PublishVariantPayload,
  PublishResult,
  ConnectionStatusResult,
} from './SocialProvider';

export class YouTubeProvider implements SocialProvider {
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
    };
  }

  async validateConnection(credentials: EncryptedCredentials): Promise<ConnectionStatusResult> {
    if (!credentials.accessTokenEnc || credentials.accessTokenEnc.includes('expired')) {
      return {
        status: 'EXPIRED',
        errorMessage: 'YouTube Data API OAuth access token expired. Re-authentication required.',
      };
    }
    return { status: 'CONNECTED' };
  }

  async publish(
    variant: PublishVariantPayload,
    credentials: EncryptedCredentials,
    idempotencyKey: string
  ): Promise<PublishResult> {
    const health = await this.validateConnection(credentials);
    if (health.status !== 'CONNECTED') {
      return {
        success: false,
        error: health.errorMessage,
        isRetriable: false,
      };
    }

    try {
      const videoTitle = variant.metadata?.title || variant.caption.substring(0, 100);
      const description = `${variant.caption}\n\n${variant.hashtags.join(' ')}`.trim();

      // YouTube Data API v3 (Videos Insert Endpoint)
      const endpoint = 'https://www.googleapis.com/youtube/v3/videos?part=snippet,status';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${credentials.accessTokenEnc}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          snippet: {
            title: videoTitle,
            description,
            tags: variant.hashtags,
            categoryId: '27', // Education
          },
          status: {
            privacyStatus: 'public',
            selfDeclaredMadeForKids: false,
          },
        }),
      });

      const data = await response.json();

      if (data.error) {
        const isQuotaExceeded = data.error.code === 403 && data.error.message.includes('quota');
        return {
          success: false,
          error: data.error.message || 'YouTube Data API error during video insert.',
          isRetriable: isQuotaExceeded,
        };
      }

      const videoId = data.id || `yt_${Date.now()}`;
      return {
        success: true,
        providerPostId: videoId,
        publishedUrl: `https://youtube.com/watch?v=${videoId}`,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Network error communicating with YouTube Data API v3.',
        isRetriable: true,
      };
    }
  }
}
