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
        return isProduction && process.env.FACEBOOK_APP_ID
          ? new FacebookProvider()
          : new MockSocialProvider('Facebook');
      case 'INSTAGRAM':
        return isProduction && process.env.INSTAGRAM_APP_ID
          ? new InstagramProvider()
          : new MockSocialProvider('Instagram');
      case 'TIKTOK':
        return isProduction && process.env.TIKTOK_APP_ID
          ? new TikTokProvider()
          : new MockSocialProvider('TikTok');
      case 'YOUTUBE':
        return isProduction && process.env.YOUTUBE_CLIENT_ID
          ? new YouTubeProvider()
          : new MockSocialProvider('YouTube');
      default:
        return new MockSocialProvider(platform);
    }
  }
}
