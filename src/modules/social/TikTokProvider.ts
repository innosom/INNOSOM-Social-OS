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
      supportedMediaTypes: ['video'],
      maxMediaCount: 1,
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

    if (accessToken.startsWith('mock_') || accessToken.startsWith('enc_token_mock_')) {
      return { status: 'CONNECTED' };
    }

    try {
      const res = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();

      if (data.error && data.error.code !== 'ok' && data.error.code !== 0) {
        if (data.error.code === 40101 || data.error.code === 40102) {
          return {
            status: 'EXPIRED',
            errorMessage: 'TikTok access token has expired or is invalid.',
          };
        }
        return {
          status: 'REVOKED',
          errorMessage: data.error.message || 'TikTok account access token revoked.',
        };
      }

      return { status: 'CONNECTED' };
    } catch (err: any) {
      return {
        status: 'ERROR',
        errorMessage: err.message || 'Network failure validating TikTok connection.',
      };
    }
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
        error: health.errorMessage || 'TikTok connection is not active.',
        isRetriable: false,
        errorCode: health.status,
      };
    }

    try {
      const accessToken = decryptToken(credentials.accessTokenEnc);
      const fullCaption = `${variant.caption}\n\n${variant.hashtags.join(' ')}`.trim();
      const mediaUrls = variant.mediaUrls || [];

      if (mediaUrls.length === 0) {
        return {
          success: false,
          error: 'TikTok publishing requires a valid video media URL.',
          isRetriable: false,
          errorCode: 'MISSING_REQUIRED_MEDIA',
        };
      }

      const videoUrl = mediaUrls[0];
      const isVideo = videoUrl.match(/\.(mp4|mov|webm)$/i) || variant.metadata?.isVideo !== false;

      if (!isVideo) {
        return {
          success: false,
          error: 'TikTok only supports video content publishing.',
          isRetriable: false,
          errorCode: 'UNSUPPORTED_MEDIA_TYPE',
        };
      }

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
            privacy_level: variant.metadata?.privacyLevel || 'PUBLIC_TO_EVERYONE',
            disable_duet: variant.metadata?.disableDuet || false,
            disable_comment: variant.metadata?.disableComment || false,
            disable_stitch: variant.metadata?.disableStitch || false,
          },
          source_info: {
            source: 'PULL_FROM_URL',
            video_url: videoUrl,
          },
        }),
      });

      const data = await response.json();

      if (data.error && data.error.code !== 'ok' && data.error.code !== 0) {
        const errorCode = data.error.code;
        const isRateLimit = errorCode === 40007 || errorCode === 40008;
        return {
          success: false,
          error: data.error.message || 'TikTok API error during video publishing initialization.',
          isRetriable: isRateLimit,
          errorCode: `TT_ERR_${errorCode}`,
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
        errorCode: 'NETWORK_TIMEOUT',
      };
    }
  }
}
