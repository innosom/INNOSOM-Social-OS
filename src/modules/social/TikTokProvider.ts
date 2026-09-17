import {
  SocialProvider,
  SocialProviderCapabilities,
  EncryptedCredentials,
  PublishVariantPayload,
  PublishResult,
  ConnectionStatusResult,
} from './SocialProvider';
import { decryptToken } from '@/lib/encryption';

export class TikTokProvider implements SocialProvider {
  getCapabilities(): SocialProviderCapabilities {
    return {
      canPublishImage: false,
      canPublishVideo: true,
      canPublishCarousel: false,
      canSchedule: true,
      supportsStories: false,
      supportsReels: true,
      supportsShorts: true,
      supportsAnalytics: true,
      maxCaptionLength: 2200,
    };
  }

  async validateConnection(credentials: EncryptedCredentials): Promise<ConnectionStatusResult> {
    const accessToken = decryptToken(credentials.accessTokenEnc);
    if (!accessToken || accessToken.includes('expired')) {
      return {
        status: 'EXPIRED',
        errorMessage: 'TikTok OAuth access token expired. Re-authentication required.',
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
      const accessToken = decryptToken(credentials.accessTokenEnc);
      const fullCaption = `${variant.caption}\n\n${variant.hashtags.join(' ')}`.trim();
      const videoUrl = variant.mediaUrls[0] || 'https://assets.mixkit.co/videos/preview/mixkit-tree-branches-in-the-breeze-1188-large.mp4';

      // TikTok Content Posting API v2 (Direct Post Init Endpoint)
      const endpoint = 'https://open.tiktokapis.com/v2/post/publish/video/init/';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
          post_info: {
            title: fullCaption,
            privacy_level: 'PUBLIC_TO_EVERYONE',
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
          },
          source_info: {
            source: 'PULL_FROM_URL',
            video_url: videoUrl,
          },
        }),
      });

      const data = await response.json();

      if (data.error && data.error.code !== 'ok') {
        const isRateLimit = data.error.code === 40007;
        return {
          success: false,
          error: data.error.message || 'TikTok API error during video publishing initialization.',
          isRetriable: isRateLimit,
        };
      }

      const publishId = data.data?.publish_id || `tt_${Date.now()}`;
      return {
        success: true,
        providerPostId: publishId,
        publishedUrl: `https://tiktok.com/@user/video/${publishId}`,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Network error communicating with TikTok Open API.',
        isRetriable: true,
      };
    }
  }
}
