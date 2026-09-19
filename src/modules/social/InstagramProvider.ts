import {
  SocialProvider,
  SocialProviderCapabilities,
  EncryptedCredentials,
  PublishVariantPayload,
  PublishResult,
  ConnectionStatusResult,
} from './SocialProvider';
import { decryptToken } from '@/lib/encryption';

export class InstagramProvider implements SocialProvider {
  getCapabilities(): SocialProviderCapabilities {
    return {
      canPublishImage: true,
      canPublishVideo: true,
      canPublishCarousel: true,
      canSchedule: true,
      supportsStories: true,
      supportsReels: true,
      supportsShorts: false,
      supportsAnalytics: true,
      maxCaptionLength: 2200,
      supportedMediaTypes: ['image', 'video'],
      maxMediaCount: 10,
    };
  }

  async validateConnection(credentials: EncryptedCredentials): Promise<ConnectionStatusResult> {
    const accessToken = decryptToken(credentials.accessTokenEnc);
    if (!accessToken || accessToken.includes('expired')) {
      return {
        status: 'EXPIRED',
        errorMessage: 'Instagram Graph API access token expired. Please re-authenticate.',
      };
    }

    if (accessToken.startsWith('mock_') || accessToken.startsWith('enc_token_mock_')) {
      return { status: 'CONNECTED' };
    }

    try {
      const url = `https://graph.facebook.com/v20.0/me?access_token=${encodeURIComponent(accessToken)}`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.error) {
        if (data.error.code === 190) {
          return {
            status: 'EXPIRED',
            errorMessage: 'Instagram access token has expired or session was revoked.',
          };
        }
        return {
          status: 'REVOKED',
          errorMessage: data.error.message || 'Instagram account access token revoked.',
        };
      }

      return { status: 'CONNECTED' };
    } catch (err: any) {
      return {
        status: 'ERROR',
        errorMessage: err.message || 'Network failure validating Instagram connection.',
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
        error: health.errorMessage || 'Instagram connection is not active.',
        isRetriable: false,
        errorCode: health.status,
      };
    }

    try {
      const accessToken = decryptToken(credentials.accessTokenEnc);
      const igAccountId = variant.metadata?.igAccountId || 'me';
      const fullCaption = `${variant.caption}\n\n${variant.hashtags.join(' ')}`.trim();
      const mediaUrls = variant.mediaUrls || [];

      // Instagram REQUIRES at least 1 media item (image or video)
      if (mediaUrls.length === 0) {
        return {
          success: false,
          error: 'Instagram requires at least one image or video media URL to publish.',
          isRetriable: false,
          errorCode: 'MISSING_REQUIRED_MEDIA',
        };
      }

      if (mediaUrls.length > 10) {
        return {
          success: false,
          error: 'Instagram carousel posts support a maximum of 10 media items.',
          isRetriable: false,
          errorCode: 'INVALID_MEDIA_COUNT',
        };
      }

      let creationId = '';

      if (mediaUrls.length > 1) {
        // Carousel Container Flow
        const childrenContainerIds: string[] = [];
        for (const url of mediaUrls) {
          const isVideo = url.match(/\.(mp4|mov)$/i);
          const childRes = await fetch(`https://graph.facebook.com/v20.0/${igAccountId}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              is_carousel_item: true,
              [isVideo ? 'video_url' : 'image_url']: url,
              access_token: accessToken,
            }),
          });
          const childData = await childRes.json();
          if (childData.error) {
            const isRateLimit = [4, 17, 32].includes(childData.error.code);
            return {
              success: false,
              error: childData.error.message || 'Failed to create Instagram carousel item container.',
              isRetriable: isRateLimit,
              errorCode: `IG_ERR_${childData.error.code}`,
            };
          }
          childrenContainerIds.push(childData.id);
        }

        // Parent Carousel Container
        const carouselRes = await fetch(`https://graph.facebook.com/v20.0/${igAccountId}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            media_type: 'CAROUSEL',
            caption: fullCaption,
            children: childrenContainerIds,
            access_token: accessToken,
          }),
        });
        const carouselData = await carouselRes.json();
        if (carouselData.error) {
          const isRateLimit = [4, 17, 32].includes(carouselData.error.code);
          return {
            success: false,
            error: carouselData.error.message || 'Failed to create Instagram carousel container.',
            isRetriable: isRateLimit,
            errorCode: `IG_ERR_${carouselData.error.code}`,
          };
        }
        creationId = carouselData.id;
      } else {
        // Single Media Container (IMAGE, REELS, or VIDEO)
        const mediaUrl = mediaUrls[0];
        const isVideo = mediaUrl.match(/\.(mp4|mov)$/i) || variant.metadata?.isVideo;
        const isReel = variant.metadata?.isReel || isVideo;

        const body: any = {
          caption: fullCaption,
          access_token: accessToken,
        };

        if (isVideo || isReel) {
          body.media_type = 'REELS';
          body.video_url = mediaUrl;
        } else {
          body.image_url = mediaUrl;
        }

        const containerRes = await fetch(`https://graph.facebook.com/v20.0/${igAccountId}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const containerData = await containerRes.json();
        if (containerData.error) {
          const isRateLimit = [4, 17, 32].includes(containerData.error.code);
          return {
            success: false,
            error: containerData.error.message || 'Failed to create Instagram media container.',
            isRetriable: isRateLimit,
            errorCode: `IG_ERR_${containerData.error.code}`,
          };
        }
        creationId = containerData.id;
      }

      // Step 2: Publish Container
      const publishRes = await fetch(`https://graph.facebook.com/v20.0/${igAccountId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: creationId,
          access_token: accessToken,
        }),
      });

      const publishData = await publishRes.json();
      if (publishData.error) {
        const isRateLimit = [4, 17, 32].includes(publishData.error.code);
        return {
          success: false,
          error: publishData.error.message || 'Failed to publish Instagram media container.',
          isRetriable: isRateLimit,
          errorCode: `IG_ERR_${publishData.error.code}`,
        };
      }

      return {
        success: true,
        providerPostId: publishData.id,
        publishedUrl: `https://instagram.com/p/${publishData.id}`,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Instagram Graph API publishing error.',
        isRetriable: true,
        errorCode: 'NETWORK_TIMEOUT',
      };
    }
  }
}
