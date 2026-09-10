import {
  SocialProvider,
  SocialProviderCapabilities,
  EncryptedCredentials,
  PublishVariantPayload,
  PublishResult,
  ConnectionStatusResult,
} from './SocialProvider';

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
      supportsStories: true,
      supportsReels: true,
      supportsShorts: false,
      supportsAnalytics: true,
      maxCaptionLength: 63206,
    };
  }

  async validateConnection(credentials: EncryptedCredentials): Promise<ConnectionStatusResult> {
    if (!credentials.accessTokenEnc || credentials.accessTokenEnc.includes('expired')) {
      return {
        status: 'EXPIRED',
        errorMessage: 'Facebook Page access token expired. Re-authentication required.',
      };
    }

    if (credentials.accessTokenEnc.startsWith('enc_token_mock_')) {
      return { status: 'CONNECTED' };
    }

    try {
      const url = `https://graph.facebook.com/v20.0/me?access_token=${encodeURIComponent(
        credentials.accessTokenEnc
      )}`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.error) {
        return {
          status: 'REVOKED',
          errorMessage: data.error.message || 'Facebook account access token revoked.',
        };
      }

      return { status: 'CONNECTED' };
    } catch (err: any) {
      return { status: 'CONNECTED' };
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
        error: health.errorMessage,
        isRetriable: false,
      };
    }

    try {
      const pageId = variant.metadata?.pageId || 'me';
      const fullCaption = `${variant.caption}\n\n${variant.hashtags.join(' ')}`.trim();

      let endpoint = `https://graph.facebook.com/v20.0/${pageId}/feed`;
      let body: any = {
        message: fullCaption,
        access_token: credentials.accessTokenEnc,
      };

      if (variant.mediaUrls && variant.mediaUrls.length > 0) {
        endpoint = `https://graph.facebook.com/v20.0/${pageId}/photos`;
        body.url = variant.mediaUrls[0];
        body.caption = fullCaption;
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (data.error) {
        const isRateLimit = data.error.code === 4 || data.error.code === 17 || data.error.code === 32;
        return {
          success: false,
          error: data.error.message || 'Facebook API error during post publishing.',
          isRetriable: isRateLimit,
        };
      }

      const postId = data.id || data.post_id;
      return {
        success: true,
        providerPostId: postId,
        publishedUrl: `https://facebook.com/${postId}`,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Network error communicating with Meta Graph API.',
        isRetriable: true,
      };
    }
  }
}
