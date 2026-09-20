import {
  SocialProvider,
  SocialProviderCapabilities,
  EncryptedCredentials,
  PublishVariantPayload,
  PublishResult,
  ConnectionStatusResult,
} from './SocialProvider';
import { decryptToken } from '@/lib/encryption';

export class FacebookProvider implements SocialProvider {
  private appId: string;
  private appSecret: string;

  constructor() {
    this.appId = process.env.FACEBOOK_APP_ID || '';
    this.appSecret = process.env.FACEBOOK_APP_SECRET || '';
  }

  getCapabilities(): SocialProviderCapabilities {
    return {
      canPublishImage: true,
      canPublishVideo: true,
      canPublishCarousel: true,
      canSchedule: true,
      supportsStories: false, // Page stories via Graph API require specific partner permissions
      supportsReels: true,
      supportsShorts: false,
      supportsAnalytics: true,
      maxCaptionLength: 63206,
      supportedMediaTypes: ['image', 'video'],
      maxMediaCount: 10,
    };
  }

  async validateConnection(credentials: EncryptedCredentials): Promise<ConnectionStatusResult> {
    const accessToken = decryptToken(credentials.accessTokenEnc);
    if (!accessToken || accessToken.includes('expired')) {
      return {
        status: 'EXPIRED',
        errorMessage: 'Facebook Page access token expired. Re-authentication required.',
      };
    }

    if (accessToken.startsWith('mock_') || accessToken.startsWith('enc_token_mock_')) {
      return { status: 'CONNECTED' };
    }

    try {
      const url = `https://graph.facebook.com/v20.0/me?access_token=${encodeURIComponent(
        accessToken
      )}`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.error) {
        const code = data.error.code;
        if (code === 190) {
          return {
            status: 'EXPIRED',
            errorMessage: 'Facebook session expired or invalidated. Please re-authenticate.',
          };
        }
        return {
          status: 'REVOKED',
          errorMessage: data.error.message || 'Facebook account access token revoked.',
        };
      }

      return { status: 'CONNECTED' };
    } catch (err: any) {
      return {
        status: 'ERROR',
        errorMessage: err.message || 'Network failure validating Facebook connection.',
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
        error: health.errorMessage || 'Facebook connection is not active.',
        isRetriable: false,
        errorCode: health.status,
      };
    }

    try {
      const accessToken = decryptToken(credentials.accessTokenEnc);
      const pageId = variant.metadata?.pageId || 'me';
      const fullCaption = `${variant.caption}\n\n${variant.hashtags.join(' ')}`.trim();
      const mediaUrls = variant.mediaUrls || [];
      const isReel = variant.metadata?.isReel || false;

      // Validate media capabilities
      if (mediaUrls.length > 10) {
        return {
          success: false,
          error: 'Facebook supports a maximum of 10 media attachments per post.',
          isRetriable: false,
          errorCode: 'INVALID_MEDIA_COUNT',
        };
      }

      // 1. Reel publishing endpoint
      if (isReel && mediaUrls.length > 0) {
        const videoUrl = mediaUrls[0];
        const reelInitUrl = `https://graph.facebook.com/v20.0/${pageId}/video_reels`;
        const res = await fetch(reelInitUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            upload_phase: 'start',
            access_token: accessToken,
          }),
        });
        const data = await res.json();
        if (data.error) {
          const isRateLimit = [4, 17, 32].includes(data.error.code);
          return {
            success: false,
            error: data.error.message || 'Facebook Reels initialization failed.',
            isRetriable: isRateLimit,
            errorCode: `FB_ERR_${data.error.code}`,
          };
        }

        const videoId = data.video_id;
        // Upload & Finish Reel
        const finishUrl = `https://graph.facebook.com/v20.0/${pageId}/video_reels`;
        const finishRes = await fetch(finishUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            upload_phase: 'finish',
            video_id: videoId,
            video_state: 'PUBLISHED',
            description: fullCaption,
            video_url: videoUrl,
            access_token: accessToken,
          }),
        });
        const finishData = await finishRes.json();
        if (finishData.error) {
          const isRateLimit = [4, 17, 32].includes(finishData.error.code);
          return {
            success: false,
            error: finishData.error.message || 'Facebook Reels publication finish failed.',
            isRetriable: isRateLimit,
            errorCode: `FB_ERR_${finishData.error.code}`,
          };
        }

        return {
          success: true,
          providerPostId: videoId,
          publishedUrl: `https://facebook.com/${videoId}`,
        };
      }

      // 2. Carousel / Multi-Photo Post
      if (mediaUrls.length > 1) {
        // Step 2a: Upload each image as unpublished photo attachment
        const attachedMediaIds: string[] = [];
        for (const url of mediaUrls) {
          const photoRes = await fetch(`https://graph.facebook.com/v20.0/${pageId}/photos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url,
              published: false,
              access_token: accessToken,
            }),
          });
          const photoData = await photoRes.json();
          if (photoData.error) {
            const isRateLimit = [4, 17, 32].includes(photoData.error.code);
            return {
              success: false,
              error: photoData.error.message || 'Failed to upload photo attachment for carousel.',
              isRetriable: isRateLimit,
              errorCode: `FB_ERR_${photoData.error.code}`,
            };
          }
          attachedMediaIds.push(photoData.id);
        }

        // Step 2b: Create feed post linking all attached media
        const feedBody: any = {
          message: fullCaption,
          access_token: accessToken,
        };
        attachedMediaIds.forEach((id, index) => {
          feedBody[`attached_media[${index}]`] = JSON.stringify({ media_fbid: id });
        });

        const feedRes = await fetch(`https://graph.facebook.com/v20.0/${pageId}/feed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(feedBody),
        });
        const feedData = await feedRes.json();
        if (feedData.error) {
          const isRateLimit = [4, 17, 32].includes(feedData.error.code);
          return {
            success: false,
            error: feedData.error.message || 'Failed to create multi-photo Facebook post.',
            isRetriable: isRateLimit,
            errorCode: `FB_ERR_${feedData.error.code}`,
          };
        }

        return {
          success: true,
          providerPostId: feedData.id,
          publishedUrl: `https://facebook.com/${feedData.id}`,
        };
      }

      // 3. Single Media Post (Video or Single Photo)
      if (mediaUrls.length === 1) {
        const mediaUrl = mediaUrls[0];
        const isVideo = mediaUrl.match(/\.(mp4|mov|avi|wmv)$/i) || variant.metadata?.isVideo;

        let endpoint = `https://graph.facebook.com/v20.0/${pageId}/photos`;
        let body: any = {
          url: mediaUrl,
          caption: fullCaption,
          access_token: accessToken,
        };

        if (isVideo) {
          endpoint = `https://graph.facebook.com/v20.0/${pageId}/videos`;
          body = {
            file_url: mediaUrl,
            description: fullCaption,
            access_token: accessToken,
          };
        }

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const data = await response.json();
        if (data.error) {
          const isRateLimit = [4, 17, 32].includes(data.error.code);
          return {
            success: false,
            error: data.error.message || 'Facebook single media publishing failed.',
            isRetriable: isRateLimit,
            errorCode: `FB_ERR_${data.error.code}`,
          };
        }

        const postId = data.id || data.post_id;
        return {
          success: true,
          providerPostId: postId,
          publishedUrl: `https://facebook.com/${postId}`,
        };
      }

      // 4. Text-only Post
      const response = await fetch(`https://graph.facebook.com/v20.0/${pageId}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: fullCaption,
          access_token: accessToken,
        }),
      });

      const data = await response.json();
      if (data.error) {
        const isRateLimit = [4, 17, 32].includes(data.error.code);
        return {
          success: false,
          error: data.error.message || 'Facebook text post publishing failed.',
          isRetriable: isRateLimit,
          errorCode: `FB_ERR_${data.error.code}`,
        };
      }

      return {
        success: true,
        providerPostId: data.id,
        publishedUrl: `https://facebook.com/${data.id}`,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Network error communicating with Meta Graph API.',
        isRetriable: true,
        errorCode: 'NETWORK_TIMEOUT',
      };
    }
  }
}
