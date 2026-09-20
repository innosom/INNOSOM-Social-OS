import { SocialProvider } from './SocialProvider';
import { FacebookProvider } from './FacebookProvider';
import { InstagramProvider } from './InstagramProvider';
import { TikTokProvider } from './TikTokProvider';
import { YouTubeProvider } from './YouTubeProvider';
import { MockSocialProvider } from './MockSocialProvider';

export class SocialProviderFactory {
  static getProvider(platform: string): SocialProvider {
    const isProduction = process.env.NODE_ENV === 'production' || process.env.ENABLE_LIVE_SOCIAL_APIS === 'true';

    switch (platform.toUpperCase()) {
      case 'FACEBOOK':
        if (isProduction) {
          if (!process.env.FACEBOOK_APP_ID) {
            throw new Error('Production Configuration Error: Missing FACEBOOK_APP_ID environment variable.');
          }
          return new FacebookProvider();
        }
        return new MockSocialProvider('Facebook');
      case 'INSTAGRAM':
        if (isProduction) {
          if (!process.env.INSTAGRAM_APP_ID) {
            throw new Error('Production Configuration Error: Missing INSTAGRAM_APP_ID environment variable.');
          }
          return new InstagramProvider();
        }
        return new MockSocialProvider('Instagram');
      case 'TIKTOK':
        if (isProduction) {
          if (!process.env.TIKTOK_APP_ID) {
            throw new Error('Production Configuration Error: Missing TIKTOK_APP_ID environment variable.');
          }
          return new TikTokProvider();
        }
        return new MockSocialProvider('TikTok');
      case 'YOUTUBE':
        if (isProduction) {
          if (!process.env.YOUTUBE_CLIENT_ID) {
            throw new Error('Production Configuration Error: Missing YOUTUBE_CLIENT_ID environment variable.');
          }
          return new YouTubeProvider();
        }
        return new MockSocialProvider('YouTube');
      default:
        if (isProduction) {
          throw new Error(`Production Configuration Error: Platform ${platform} is not supported in live mode.`);
        }
        return new MockSocialProvider(platform);
    }
  }
}
