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
      const igAccountId = variant.metadata?.igAccountId || 'me';
      const fullCaption = `${variant.caption}\n\n${variant.hashtags.join(' ')}`.trim();
      const imageUrl = variant.mediaUrls[0] || 'https://images.unsplash.com/photo-1542744094-3a3172720249?w=800';

      // Step 1: Create Media Container
      const containerUrl = `https://graph.facebook.com/v20.0/${igAccountId}/media`;
      const containerRes = await fetch(containerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: imageUrl,
          caption: fullCaption,
          access_token: accessToken,
        }),
      });

      const containerData = await containerRes.json();
      if (containerData.error) {
        return {
          success: false,
          error: containerData.error.message || 'Failed to create Instagram media container.',
          isRetriable: containerData.error.code === 4 || containerData.error.code === 17,
        };
      }

      // Step 2: Publish Container
      const publishUrl = `https://graph.facebook.com/v20.0/${igAccountId}/media_publish`;
      const publishRes = await fetch(publishUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: containerData.id,
          access_token: accessToken,
        }),
      });

      const publishData = await publishRes.json();
      if (publishData.error) {
        return {
          success: false,
          error: publishData.error.message || 'Failed to publish Instagram media container.',
          isRetriable: publishData.error.code === 4 || publishData.error.code === 17,
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
      };
    }
  }
}
