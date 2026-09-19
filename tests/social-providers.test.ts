import { TestRunner, assertEqual, assertTrue, getTestEntities } from './test-utils';
import { SocialProviderFactory } from '../src/modules/social/SocialProviderFactory';
import { MockSocialProvider } from '../src/modules/social/MockSocialProvider';
import { encryptToken, decryptToken, isEncryptedToken } from '../src/lib/encryption';
import { prisma } from '../src/lib/prisma';

export async function runSocialProvidersTests(): Promise<TestRunner> {
  const runner = new TestRunner('Social Providers & Security Encryption');
  const { workspaceA } = await getTestEntities();

  await runner.test('SocialProviderFactory: Returns provider instance for all supported platforms', async () => {
    const platforms = ['FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'YOUTUBE'];
    for (const p of platforms) {
      const provider = SocialProviderFactory.getProvider(p);
      assertTrue(provider !== null && provider !== undefined);
      const caps = provider.getCapabilities();
      assertTrue(typeof caps.maxCaptionLength === 'number');
    }
  });

  await runner.test('MockSocialProvider: Capabilities report correct social channel capabilities', async () => {
    const mock = new MockSocialProvider('Instagram');
    const caps = mock.getCapabilities();
    assertTrue(caps.canPublishImage);
    assertTrue(caps.canPublishVideo);
    assertTrue(caps.canPublishCarousel);
    assertEqual(caps.maxCaptionLength, 2200);
  });

  await runner.test('MockSocialProvider: Validate connection correctly detects expired tokens', async () => {
    const mock = new MockSocialProvider('Facebook');
    const encActive = encryptToken('oauth2_active_access_token_123');
    const resActive = await mock.validateConnection({ accessTokenEnc: encActive! });
    assertEqual(resActive.status, 'CONNECTED');

    const encExpired = encryptToken('oauth2_expired_access_token_999');
    const resExpired = await mock.validateConnection({ accessTokenEnc: encExpired! });
    assertEqual(resExpired.status, 'EXPIRED');
  });

  await runner.test('MockSocialProvider: Publish variant payload executes successfully', async () => {
    const mock = new MockSocialProvider('TikTok');
    const encActive = encryptToken('oauth2_tiktok_token_555');
    const result = await mock.publish(
      {
        caption: 'TikTok Trending Video',
        hashtags: ['#Viral', '#Trends'],
        mediaUrls: ['https://assets.mixkit.co/videos/preview/mixkit-tree-branches-in-the-breeze-1188-large.mp4'],
      },
      { accessTokenEnc: encActive! },
      `idempotency_key_tiktok_${Date.now()}`
    );

    assertTrue(result.success);
    assertTrue(result.providerPostId !== undefined && result.providerPostId.includes('tiktok'));
    assertTrue(result.publishedUrl !== undefined);
  });

  await runner.test('Credential Encryption: Encrypt -> Decrypt roundtrip produces exact original plaintext', async () => {
    const originalToken = 'live_production_oauth2_access_token_secret_9988776655';
    const encrypted = encryptToken(originalToken);

    assertTrue(encrypted !== null && isEncryptedToken(encrypted!));
    assertTrue(encrypted !== originalToken, 'Encrypted output must not equal raw plaintext');

    const decrypted = decryptToken(encrypted!);
    assertEqual(decrypted, originalToken);
  });

  await runner.test('Credential Encryption: Wrong key decryption fails securely without leaking secret key/token', async () => {
    const originalKey = process.env.ENCRYPTION_KEY;
    const key1 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const key2 = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

    try {
      process.env.ENCRYPTION_KEY = key1;
      const secretToken = 'super_secret_oauth_token';
      const enc = encryptToken(secretToken);

      process.env.ENCRYPTION_KEY = key2;
      let failedAsExpected = false;
      try {
        decryptToken(enc!);
      } catch (err: any) {
        failedAsExpected = true;
        assertTrue(!err.message.includes(secretToken), 'Error message must not leak token');
      }
      assertTrue(failedAsExpected, 'Decryption with wrong key should throw exception');
    } finally {
      process.env.ENCRYPTION_KEY = originalKey;
    }
  });

  await runner.test('Persistence Security: OAuth tokens in Database are strictly encrypted at rest', async () => {
    const rawSecretToken = 'meta_graph_api_secret_oauth_token_778899';
    const encryptedToken = encryptToken(rawSecretToken)!;

    const connection = await prisma.socialConnection.create({
      data: {
        workspaceId: workspaceA.id,
        platform: 'FACEBOOK',
        accountName: 'Persistence Security Verification',
        accountId: `sec_pers_test_${Date.now()}`,
        status: 'CONNECTED',
        accessTokenEnc: encryptedToken,
      },
    });

    const fetchedDb = await prisma.socialConnection.findUnique({
      where: { id: connection.id },
    });

    assertTrue(fetchedDb !== null);
    assertTrue(fetchedDb!.accessTokenEnc !== rawSecretToken, 'Plaintext token must NEVER be stored in DB');
    assertTrue(fetchedDb!.accessTokenEnc.startsWith('enc:v1:'), 'Stored token must have encrypted prefix format');

    await prisma.socialConnection.delete({ where: { id: connection.id } });
  });

  return runner;
}
