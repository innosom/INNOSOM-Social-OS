import {
  SocialProvider,
  SocialProviderCapabilities,
  EncryptedCredentials,
  PublishVariantPayload,
  PublishResult,
  ConnectionStatusResult,
  ReconciliationResult,
} from './SocialProvider';
import { decryptToken } from '@/lib/encryption';

export class MockSocialProvider implements SocialProvider {
  private platformName: string;
  private static createdPostsMap = new Map<string, string>();

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

  async checkPostStatus(
    idempotencyKey: string,
    credentials: EncryptedCredentials
  ): Promise<ReconciliationResult> {
    if (MockSocialProvider.createdPostsMap.has(idempotencyKey)) {
      return {
        published: true,
        providerPostId: MockSocialProvider.createdPostsMap.get(idempotencyKey),
      };
    }
    return { published: false };
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

    // Check reconciliation status
    if (MockSocialProvider.createdPostsMap.has(idempotencyKey)) {
      const providerPostId = MockSocialProvider.createdPostsMap.get(idempotencyKey)!;
      return {
        success: true,
        providerPostId,
        publishedUrl: `https://${this.platformName.toLowerCase()}.com/p/${providerPostId}`,
      };
    }

    if (idempotencyKey.includes('rate_limit') || (idempotencyKey.includes('fail_once') && !idempotencyKey.includes('retried'))) {
      return {
        success: false,
        error: `${this.platformName} API rate limit exceeded (HTTP 429). Retry queued.`,
        isRetriable: true,
      };
    }

    if (idempotencyKey.includes('timeout_after_creation')) {
      // Simulate post created externally before network timeout
      const providerPostId = `${this.platformName.toLowerCase()}_post_timeout_${Date.now()}`;
      MockSocialProvider.createdPostsMap.set(idempotencyKey, providerPostId);
      return {
        success: false,
        error: `${this.platformName} provider HTTP connection timed out after request submission.`,
        isRetriable: true,
      };
    }

    if (idempotencyKey.includes('fatal_error')) {
      return {
        success: false,
        error: `${this.platformName} API fatal validation error: Invalid payload parameters.`,
        isRetriable: false,
      };
    }

    const providerPostId = `${this.platformName.toLowerCase()}_post_${Date.now()}_${Math.floor(
      Math.random() * 10000
    )}`;

    MockSocialProvider.createdPostsMap.set(idempotencyKey, providerPostId);

    return {
      success: true,
      providerPostId,
      publishedUrl: `https://${this.platformName.toLowerCase()}.com/p/${providerPostId}`,
    };
  }
}
