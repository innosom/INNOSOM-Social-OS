import { SocialProvider } from './SocialProvider';
import { MockSocialProvider } from './MockSocialProvider';

export class SocialProviderFactory {
  static getProvider(platform: string): SocialProvider {
    switch (platform.toUpperCase()) {
      case 'FACEBOOK':
      case 'INSTAGRAM':
      case 'TIKTOK':
      case 'YOUTUBE':
        return new MockSocialProvider(platform);
      default:
        throw new Error(`Unsupported social platform: ${platform}`);
    }
  }
}
