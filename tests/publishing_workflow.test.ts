import { processPublicationJob } from '../src/modules/publishing/PublishingWorker';
import { SocialProviderFactory } from '../src/modules/social/SocialProviderFactory';
import { SocialProvider, PublishOptions, PublishResult, ConnectionHealth } from '../src/modules/social/SocialProvider';
import { prisma } from '../src/lib/prisma';

// Custom Mock Social Provider to simulate various error conditions
class CustomMockSocialProvider implements SocialProvider {
  platform = 'FACEBOOK';
  public behavior: 'success' | 'failure' | 'timeout' | 'rate_limit' | 'expired_token' = 'success';

  async publish(options: PublishOptions, credentials: any, idempotencyKey: string): Promise<PublishResult> {
    if (this.behavior === 'failure') {
      return { success: false, error: 'Simulated API failure' };
    }
    if (this.behavior === 'timeout') {
      return { success: false, error: 'Provider network timeout after 30000ms' };
    }
    if (this.behavior === 'rate_limit') {
      return { success: false, error: 'Rate limit exceeded. Try again in 600s' };
    }
    if (this.behavior === 'expired_token') {
      return { success: false, error: 'OAuth access token has expired or been revoked' };
    }

    return {
      success: true,
      providerPostId: `post_mock_${Date.now()}`,
      publishedAt: new Date(),
    };
  }

  async validateConnection(): Promise<ConnectionHealth> {
    return { status: 'CONNECTED' };
  }

  getCapabilities() {
    return { maxCaptionLength: 2200, supportedMediaTypes: ['IMAGE', 'VIDEO'], requiresApproval: false };
  }
}

export async function runPublishingWorkflowTests() {
  console.log('\n🚀 [3/6] Running Publishing Workflow & Worker Resiliency Tests...\n');

  const mockProvider = new CustomMockSocialProvider();

  // Override SocialProviderFactory.getProvider to return our customizable mock
  const originalGetProvider = SocialProviderFactory.getProvider;
  SocialProviderFactory.getProvider = (platform: string) => {
    return mockProvider;
  };

  const org = await prisma.organization.create({
    data: { name: 'Publishing Test Org', slug: `pub-org-${Date.now()}` },
  });
  const ws = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'Publishing WS', slug: `pub-ws-${Date.now()}` },
  });
  const user = await prisma.user.create({
    data: { email: `pub_user_${Date.now()}@test.com`, name: 'Pub User', passwordHash: 'hash' },
  });
  const conn = await prisma.socialConnection.create({
    data: { workspaceId: ws.id, platform: 'FACEBOOK', accountName: 'FB Test', accountId: 'fb_1', accessTokenEnc: 'enc_token' },
  });

  try {
    // Helper to create content and publication
    async function createTestPublication(idempotencyKeySuffix: string) {
      const content = await prisma.content.create({
        data: { workspaceId: ws.id, authorId: user.id, title: 'Publish Test', masterCaption: 'Caption' },
      });
      const variant = await prisma.contentVariant.create({
        data: { contentId: content.id, platform: 'FACEBOOK', caption: 'Variant Caption' },
      });
      const publication = await prisma.publication.create({
        data: {
          contentVariantId: variant.id,
          socialConnectionId: conn.id,
          scheduledAt: new Date(),
          status: 'SCHEDULED',
          idempotencyKey: `pub_test_${idempotencyKeySuffix}_${Date.now()}`,
        },
      });
      return publication;
    }

    // 1. Success workflow
    mockProvider.behavior = 'success';
    const pubSuccess = await createTestPublication('success');
    const resSuccess = await processPublicationJob(pubSuccess.id);
    if (!resSuccess.success) {
      throw new Error(`Expected publishing success, got error: ${resSuccess.error}`);
    }
    const updatedSuccess = await prisma.publication.findUnique({ where: { id: pubSuccess.id } });
    if (updatedSuccess?.status !== 'PUBLISHED' || !updatedSuccess.providerPostId) {
      throw new Error('Publication status was not updated to PUBLISHED or missing providerPostId');
    }
    console.log('  ✅ Publishing success workflow and status transition verified');

    // 2. Failure handling
    mockProvider.behavior = 'failure';
    const pubFail = await createTestPublication('fail');
    const resFail = await processPublicationJob(pubFail.id);
    if (resFail.success) {
      throw new Error('Expected publishing failure, but returned success');
    }
    const updatedFail = await prisma.publication.findUnique({ where: { id: pubFail.id } });
    if (updatedFail?.status !== 'FAILED' || !updatedFail.errorMessage?.includes('Simulated API failure')) {
      throw new Error('Publication status was not updated to FAILED or error message missing');
    }
    console.log('  ✅ Publishing failure & error recording verified');

    // 3. Retry workflow
    mockProvider.behavior = 'success'; // Fixed issue on retry
    const resRetry = await processPublicationJob(pubFail.id);
    if (!resRetry.success) {
      throw new Error(`Expected retry to succeed, got error: ${resRetry.error}`);
    }
    const updatedRetry = await prisma.publication.findUnique({ where: { id: pubFail.id } });
    if (updatedRetry?.status !== 'PUBLISHED' || updatedRetry.attempts !== 2) {
      throw new Error(`Publication retry failed or attempts not incremented (attempts: ${updatedRetry?.attempts})`);
    }
    console.log('  ✅ Publication retry mechanism and attempt counter verified');

    // 4. Timeout handling
    mockProvider.behavior = 'timeout';
    const pubTimeout = await createTestPublication('timeout');
    const resTimeout = await processPublicationJob(pubTimeout.id);
    if (resTimeout.success || !resTimeout.error?.includes('timeout')) {
      throw new Error('Timeout error handling failed');
    }
    console.log('  ✅ Provider timeout handling verified');

    // 5. Rate limit handling
    mockProvider.behavior = 'rate_limit';
    const pubRate = await createTestPublication('rate');
    const resRate = await processPublicationJob(pubRate.id);
    if (resRate.success || !resRate.error?.includes('Rate limit')) {
      throw new Error('Rate limit error handling failed');
    }
    console.log('  ✅ Provider rate limiting handling verified');

    // 6. Expired token handling
    mockProvider.behavior = 'expired_token';
    const pubExpired = await createTestPublication('expired');
    const resExpired = await processPublicationJob(pubExpired.id);
    if (resExpired.success || !resExpired.error?.includes('expired')) {
      throw new Error('Expired OAuth token handling failed');
    }
    console.log('  ✅ Expired token error handling verified');

    // 7. Duplicate job & idempotency key execution
    mockProvider.behavior = 'success';
    const pubDup = await createTestPublication('dup');
    await processPublicationJob(pubDup.id); // First execution -> PUBLISHED
    const resDup = await processPublicationJob(pubDup.id); // Second execution
    if (!resDup.success) {
      throw new Error('Re-processing a PUBLISHED job should return success (idempotent)');
    }
    const dupCheck = await prisma.publication.findUnique({ where: { id: pubDup.id } });
    if (dupCheck?.attempts !== 1) {
      throw new Error('Idempotent re-run should not re-execute or increment attempts');
    }
    console.log('  ✅ Duplicate job execution & idempotency check verified');

    // 8. Concurrent worker execution (race condition handling)
    const pubConcurrent = await createTestPublication('concurrent');
    const [res1, res2] = await Promise.all([
      processPublicationJob(pubConcurrent.id),
      processPublicationJob(pubConcurrent.id),
    ]);
    if (!res1.success || !res2.success) {
      throw new Error('Concurrent worker processing failed');
    }
    console.log('  ✅ Concurrent worker race condition handling verified');

    // 9. Partial platform failure handling
    mockProvider.behavior = 'success';
    const contentMulti = await prisma.content.create({
      data: { workspaceId: ws.id, authorId: user.id, title: 'Multi Platform Post', masterCaption: 'Multi' },
    });
    const variantFB = await prisma.contentVariant.create({
      data: { contentId: contentMulti.id, platform: 'FACEBOOK', caption: 'FB' },
    });
    const variantIG = await prisma.contentVariant.create({
      data: { contentId: contentMulti.id, platform: 'INSTAGRAM', caption: 'IG' },
    });

    const connIG = await prisma.socialConnection.create({
      data: { workspaceId: ws.id, platform: 'INSTAGRAM', accountName: 'IG Test', accountId: 'ig_1', accessTokenEnc: 'enc_token' },
    });

    const pubFB = await prisma.publication.create({
      data: { contentVariantId: variantFB.id, socialConnectionId: conn.id, scheduledAt: new Date(), status: 'SCHEDULED', idempotencyKey: `pub_multi_fb_${Date.now()}` },
    });
    const pubIG = await prisma.publication.create({
      data: { contentVariantId: variantIG.id, socialConnectionId: connIG.id, scheduledAt: new Date(), status: 'SCHEDULED', idempotencyKey: `pub_multi_ig_${Date.now()}` },
    });

    // Execute FB success
    mockProvider.behavior = 'success';
    await processPublicationJob(pubFB.id);

    // Execute IG failure
    mockProvider.behavior = 'failure';
    await processPublicationJob(pubIG.id);

    const checkFB = await prisma.publication.findUnique({ where: { id: pubFB.id } });
    const checkIG = await prisma.publication.findUnique({ where: { id: pubIG.id } });

    if (checkFB?.status !== 'PUBLISHED' || checkIG?.status !== 'FAILED') {
      throw new Error('Partial platform failure state assertion failed');
    }
    console.log('  ✅ Partial platform failure (one success, one fail) verified');

    console.log('\n✨ Publishing workflow & worker resiliency tests passed successfully!');
  } finally {
    // Restore original factory provider method
    SocialProviderFactory.getProvider = originalGetProvider;

    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.publication.deleteMany({ where: { socialConnection: { workspaceId: ws.id } } });
    await prisma.content.deleteMany({ where: { workspaceId: ws.id } });
    await prisma.socialConnection.deleteMany({ where: { workspaceId: ws.id } });
    await prisma.workspace.delete({ where: { id: ws.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
}

if (require.main === module) {
  runPublishingWorkflowTests().catch((e) => {
    console.error('❌ Publishing workflow test failed:', e);
    process.exit(1);
  });
}
