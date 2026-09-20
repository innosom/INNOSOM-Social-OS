import { FacebookProvider } from '../src/modules/social/FacebookProvider';
import { InstagramProvider } from '../src/modules/social/InstagramProvider';
import { TikTokProvider } from '../src/modules/social/TikTokProvider';
import { YouTubeProvider } from '../src/modules/social/YouTubeProvider';
import { MockSocialProvider } from '../src/modules/social/MockSocialProvider';
import { SocialProviderFactory } from '../src/modules/social/SocialProviderFactory';
import { encryptToken } from '../src/lib/encryption';

// Set up encryption key for tests
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// Helper to create valid encrypted credentials
function mockCredentials(token = 'valid_test_access_token', refreshToken = 'valid_test_refresh_token') {
  return {
    accessTokenEnc: encryptToken(token)!,
    refreshTokenEnc: encryptToken(refreshToken),
    expiresAt: new Date(Date.now() + 3600 * 1000),
  };
}

// Global fetch mock helper
const originalFetch = global.fetch;

function mockFetchResponse(status: number, jsonResponse: any) {
  global.fetch = async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => jsonResponse,
    } as any);
}

function restoreFetch() {
  global.fetch = originalFetch;
}

async function runProviderTests() {
  console.log('🧪 Starting Comprehensive Social Provider Unit Tests...\n');

  try {
    // -------------------------------------------------------------
    // TEST 1: SocialProviderFactory Hardening & Strict Mode
    // -------------------------------------------------------------
    console.log('Testing 1: SocialProviderFactory Strict Production Mode...');
    process.env.ENABLE_LIVE_SOCIAL_APIS = 'true';
    delete process.env.FACEBOOK_APP_ID;

    let threwExpectedError = false;
    try {
      SocialProviderFactory.getProvider('FACEBOOK');
    } catch (err: any) {
      if (err.message.includes('Production Configuration Error')) {
        threwExpectedError = true;
      }
    }
    if (!threwExpectedError) throw new Error('Factory failed to throw error when missing App ID in production!');
    console.log('  ✅ Factory strict production check passed.');

    process.env.ENABLE_LIVE_SOCIAL_APIS = 'false';
    const mockProvider = SocialProviderFactory.getProvider('FACEBOOK');
    if (!(mockProvider instanceof MockSocialProvider)) {
      throw new Error('Factory failed to return MockSocialProvider in development mode.');
    }
    console.log('  ✅ Factory development mock fallback check passed.\n');

    // -------------------------------------------------------------
    // TEST 2: FacebookProvider
    // -------------------------------------------------------------
    console.log('Testing 2: FacebookProvider...');
    const fbProvider = new FacebookProvider();

    // 2a: Connection Validation - Connected
    mockFetchResponse(200, { id: 'fb_user_123', name: 'Test Page' });
    let fbHealth = await fbProvider.validateConnection(mockCredentials());
    if (fbHealth.status !== 'CONNECTED') throw new Error(`FB Connected test failed: ${fbHealth.status}`);
    console.log('  ✅ FB Valid connection test passed.');

    // 2b: Connection Validation - Expired
    let fbExpiredCreds = mockCredentials('expired_fb_token');
    fbHealth = await fbProvider.validateConnection(fbExpiredCreds);
    if (fbHealth.status !== 'EXPIRED') throw new Error(`FB Expired token test failed: ${fbHealth.status}`);
    console.log('  ✅ FB Expired token test passed.');

    // 2c: Connection Validation - Revoked
    mockFetchResponse(400, { error: { code: 190, message: 'OAuth token has been revoked' } });
    fbHealth = await fbProvider.validateConnection(mockCredentials('revoked_token'));
    if (fbHealth.status !== 'EXPIRED' && fbHealth.status !== 'REVOKED') {
      throw new Error(`FB Revoked token test failed: ${fbHealth.status}`);
    }
    console.log('  ✅ FB Revoked token test passed.');

    // 2d: Publish Successful Image Post
    mockFetchResponse(200, { id: 'fb_post_999' });
    let fbPubRes = await fbProvider.publish(
      { caption: 'Hello FB', hashtags: ['#test'], mediaUrls: ['https://example.com/photo.jpg'] },
      mockCredentials(),
      'key_1'
    );
    if (!fbPubRes.success || fbPubRes.providerPostId !== 'fb_post_999') {
      throw new Error(`FB Publish image failed: ${fbPubRes.error}`);
    }
    console.log('  ✅ FB Image publish test passed.');

    // 2e: Rate Limit Classification
    global.fetch = async (url: any) => {
      if (url.toString().includes('/me?')) {
        return { ok: true, json: async () => ({ id: 'fb_user_123' }) } as any;
      }
      return { ok: false, status: 400, json: async () => ({ error: { code: 17, message: 'User request limit reached' } }) } as any;
    };
    fbPubRes = await fbProvider.publish(
      { caption: 'Rate Limit Test', hashtags: [], mediaUrls: [] },
      mockCredentials(),
      'key_2'
    );
    if (fbPubRes.success || !fbPubRes.isRetriable) {
      throw new Error('FB Rate limit classification failed to classify as retriable.');
    }
    console.log('  ✅ FB Rate limit retriable error classification test passed.');

    // 2f: Network Timeout / Error
    global.fetch = async (url: any) => {
      if (url.toString().includes('/me?')) {
        return { ok: true, json: async () => ({ id: 'fb_user_123' }) } as any;
      }
      throw new Error('Network timeout');
    };
    fbPubRes = await fbProvider.publish(
      { caption: 'Timeout Test', hashtags: [], mediaUrls: [] },
      mockCredentials(),
      'key_3'
    );
    if (fbPubRes.success || !fbPubRes.isRetriable) {
      throw new Error('FB Network error failed to classify as retriable.');
    }
    console.log('  ✅ FB Network timeout test passed.\n');

    // -------------------------------------------------------------
    // TEST 3: InstagramProvider
    // -------------------------------------------------------------
    console.log('Testing 3: InstagramProvider...');
    const igProvider = new InstagramProvider();

    // 3a: Invalid Media Payload (0 media)
    let igPubRes = await igProvider.publish(
      { caption: 'No Media Test', hashtags: [], mediaUrls: [] },
      mockCredentials(),
      'key_4'
    );
    if (igPubRes.success || igPubRes.errorCode !== 'MISSING_REQUIRED_MEDIA') {
      throw new Error('IG 0-media check failed to reject.');
    }
    console.log('  ✅ IG Missing required media test passed.');

    // 3b: Successful Publish (Container Creation -> Publication)
    let fetchCount = 0;
    global.fetch = async (url: any) => {
      fetchCount++;
      if (url.toString().includes('/me?')) {
        return { ok: true, json: async () => ({ id: '123' }) } as any;
      }
      if (url.toString().includes('/media_publish')) {
        return { ok: true, json: async () => ({ id: 'ig_post_777' }) } as any;
      }
      return { ok: true, json: async () => ({ id: 'ig_container_111' }) } as any;
    };

    igPubRes = await igProvider.publish(
      { caption: 'IG Test Photo', hashtags: ['#insta'], mediaUrls: ['https://example.com/ig.jpg'] },
      mockCredentials(),
      'key_5'
    );
    if (!igPubRes.success || igPubRes.providerPostId !== 'ig_post_777') {
      throw new Error(`IG Publish failed: ${igPubRes.error}`);
    }
    console.log('  ✅ IG Container creation & publish flow test passed.\n');

    // -------------------------------------------------------------
    // TEST 4: TikTokProvider
    // -------------------------------------------------------------
    console.log('Testing 4: TikTokProvider...');
    const ttProvider = new TikTokProvider();

    // 4a: Unsupported Media Type (Image on TikTok)
    global.fetch = async (url: any) => {
      if (url.toString().includes('/user/info/')) {
        return { ok: true, json: async () => ({ error: { code: 'ok' } }) } as any;
      }
      return { ok: true, json: async () => ({}) } as any;
    };
    let ttPubRes = await ttProvider.publish(
      { caption: 'TikTok Image Test', hashtags: [], mediaUrls: ['https://example.com/image.jpg'], metadata: { isVideo: false } },
      mockCredentials(),
      'key_6'
    );
    if (ttPubRes.success || ttPubRes.errorCode !== 'UNSUPPORTED_MEDIA_TYPE') {
      throw new Error('TikTok image rejection check failed.');
    }
    console.log('  ✅ TikTok unsupported media type rejection test passed.');

    // 4b: Successful Publish (Video Init Request)
    global.fetch = async (url: any) => {
      if (url.toString().includes('/user/info/')) {
        return { ok: true, json: async () => ({ error: { code: 'ok' } }) } as any;
      }
      return { ok: true, json: async () => ({ error: { code: 'ok' }, data: { publish_id: 'tt_pub_555' } }) } as any;
    };

    ttPubRes = await ttProvider.publish(
      { caption: 'TikTok Dance', hashtags: ['#dance'], mediaUrls: ['https://example.com/video.mp4'] },
      mockCredentials(),
      'key_7'
    );
    if (!ttPubRes.success || ttPubRes.providerPostId !== 'tt_pub_555') {
      throw new Error(`TikTok Video Publish failed: ${ttPubRes.error}`);
    }
    console.log('  ✅ TikTok video init publish test passed.\n');

    // -------------------------------------------------------------
    // TEST 5: YouTubeProvider
    // -------------------------------------------------------------
    console.log('Testing 5: YouTubeProvider...');
    const ytProvider = new YouTubeProvider();

    // 5a: Successful Video Publish
    global.fetch = async (url: any) => {
      if (url.toString().includes('/channels?')) {
        return { ok: true, json: async () => ({ items: [{ id: 'yt_chan_1' }] }) } as any;
      }
      return { ok: true, json: async () => ({ id: 'yt_vid_888' }) } as any;
    };

    let ytPubRes = await ytProvider.publish(
      { caption: 'YouTube Video #shorts', hashtags: ['#shorts'], mediaUrls: ['https://example.com/shorts.mp4'] },
      mockCredentials(),
      'key_8'
    );
    if (!ytPubRes.success || ytPubRes.providerPostId !== 'yt_vid_888' || !ytPubRes.publishedUrl?.includes('/shorts/')) {
      throw new Error(`YouTube Shorts Publish failed: ${ytPubRes.error}`);
    }
    console.log('  ✅ YouTube video upload & Shorts URL detection test passed.');

    // 5b: Quota Exceeded Rate Limit
    global.fetch = async (url: any) => {
      if (url.toString().includes('/channels?')) {
        return { ok: true, json: async () => ({ items: [{ id: 'yt_chan_1' }] }) } as any;
      }
      return { ok: false, status: 403, json: async () => ({ error: { code: 403, message: 'The request cannot be completed because you have exceeded your quota.' } }) } as any;
    };
    ytPubRes = await ytProvider.publish(
      { caption: 'Quota Test', hashtags: [], mediaUrls: ['https://example.com/vid.mp4'] },
      mockCredentials(),
      'key_9'
    );
    if (ytPubRes.success || !ytPubRes.isRetriable) {
      throw new Error('YouTube quota error was not classified as retriable.');
    }
    console.log('  ✅ YouTube quota limit retriable error test passed.\n');

    // -------------------------------------------------------------
    // TEST 6: MockSocialProvider Sanity Check
    // -------------------------------------------------------------
    console.log('Testing 6: MockSocialProvider...');
    const localMock = new MockSocialProvider('Twitter');
    const mockHealth = await localMock.validateConnection(mockCredentials());
    if (mockHealth.status !== 'CONNECTED') throw new Error('MockSocialProvider connection failed.');

    const mockPub = await localMock.publish(
      { caption: 'Mock Post', hashtags: [], mediaUrls: [] },
      mockCredentials(),
      'key_10'
    );
    if (!mockPub.success) throw new Error('MockSocialProvider publish failed.');
    console.log('  ✅ MockSocialProvider sanity test passed.\n');

    restoreFetch();
    console.log('🎉 ALL SOCIAL PROVIDER UNIT TESTS PASSED SUCCESSFULLY! 🎉');
  } catch (error: any) {
    restoreFetch();
    console.error('❌ Provider unit tests failed:', error.message || error);
    process.exit(1);
  }
}

runProviderTests();
