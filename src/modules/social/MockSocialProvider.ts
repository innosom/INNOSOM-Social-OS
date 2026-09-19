import {
  SocialProvider,
  SocialProviderCapabilities,
  EncryptedCredentials,
  PublishVariantPayload,
  PublishResult,
  ConnectionStatusResult,
} from './SocialProvider';
import { decryptToken } from '@/lib/encryption';

export class MockSocialProvider implements SocialProvider {
  private platformName: string;

  constructor(platformName: string) {
    this.platformName = platformName;
  }

  getCapabilities(): SocialProviderCapabilities {
    return {
      canPublishImage: true,
      canPublishVideo: true,
      canPublishCarousel: true,
      canSchedule: true,
      supportsStories: true,
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
        errorMessage: `${this.platformName} OAuth token has expired. Re-authentication required.`,
      };
    }
    return { status: 'CONNECTED' };
  }

  async publish(
    variant: PublishVariantPayload,
    credentials: EncryptedCredentials,
    idempotencyKey: string
  ): Promise<PublishResult> {
    const accessToken = decryptToken(credentials.accessTokenEnc);
    if (!accessToken || accessToken.includes('expired')) {
      return {
        success: false,
        error: `${this.platformName} connection token expired prior to publishing execution.`,
        isRetriable: false,
      };
    }

    if (process.env.NODE_ENV !== 'test') {
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    if (idempotencyKey.includes('fail_once') && !idempotencyKey.includes('retried')) {
      return {
        success: false,
        error: `${this.platformName} API rate limit exceeded. Retry queued.`,
        isRetriable: true,
      };
    }

    const providerPostId = `${this.platformName.toLowerCase()}_post_${Date.now()}_${Math.floor(
      Math.random() * 10000
    )}`;

    return {
      success: true,
      providerPostId,
      publishedUrl: `https://${this.platformName.toLowerCase()}.com/p/${providerPostId}`,
    };
  }
}
