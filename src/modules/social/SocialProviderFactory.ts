import { SocialProvider } from './SocialProvider';
import { FacebookProvider } from './FacebookProvider';
import { InstagramProvider } from './InstagramProvider';
import { TikTokProvider } from './TikTokProvider';
import { YouTubeProvider } from './YouTubeProvider';
import { MockSocialProvider } from './MockSocialProvider';

export class SocialProviderFactory {
  static getProvider(platform: string): SocialProvider {
    const isProductionMode = process.env.ENABLE_LIVE_SOCIAL_APIS === 'true' || process.env.NODE_ENV === 'production';

    const normalizedPlatform = platform.toUpperCase();

    if (isProductionMode) {
      switch (normalizedPlatform) {
        case 'FACEBOOK':
          if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) {
            throw new Error('Production Configuration Error: Missing FACEBOOK_APP_ID or FACEBOOK_APP_SECRET environment variables.');
          }
          return new FacebookProvider();

        case 'INSTAGRAM':
          if (!process.env.INSTAGRAM_APP_ID || !process.env.INSTAGRAM_APP_SECRET) {
            throw new Error('Production Configuration Error: Missing INSTAGRAM_APP_ID or INSTAGRAM_APP_SECRET environment variables.');
          }
          return new InstagramProvider();

        case 'TIKTOK':
          if (!process.env.TIKTOK_APP_ID || !process.env.TIKTOK_APP_SECRET) {
            throw new Error('Production Configuration Error: Missing TIKTOK_APP_ID or TIKTOK_APP_SECRET environment variables.');
          }
          return new TikTokProvider();

        case 'YOUTUBE':
          if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET) {
            throw new Error('Production Configuration Error: Missing YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET environment variables.');
          }
          return new YouTubeProvider();

        default:
          throw new Error(`Production Configuration Error: Unsupported platform '${platform}'.`);
      }
    }

    // Development & Test Mock Provider Fallback
    switch (normalizedPlatform) {
      case 'FACEBOOK':
      case 'INSTAGRAM':
      case 'TIKTOK':
      case 'YOUTUBE':
        return new MockSocialProvider(platform);
      default:
        return new MockSocialProvider(platform);
    }
  }
}
