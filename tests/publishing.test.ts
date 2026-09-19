import { TestRunner, assertEqual, assertTrue, createMockRequest, getTestEntities } from './test-utils';
import { processPublicationJob } from '../src/modules/publishing/PublishingWorker';
import { POST as retryPOST } from '../src/app/api/publications/[id]/retry/route';
import { prisma } from '../src/lib/prisma';
import { encryptToken } from '../src/lib/encryption';

export async function runPublishingTests(): Promise<TestRunner> {
  const runner = new TestRunner('Publishing Engine & Queue');
  const { adminSession, workspaceA } = await getTestEntities();

  // Create test social connection
  const activeConn = await prisma.socialConnection.create({
    data: {
      workspaceId: workspaceA.id,
      platform: 'FACEBOOK',
      accountName: 'Publishing Engine Test FB',
      accountId: `pub_test_fb_${Date.now()}`,
      accessTokenEnc: encryptToken('oauth_valid_token_12345')!,
      status: 'CONNECTED',
    },
  });

  const expiredConn = await prisma.socialConnection.create({
    data: {
      workspaceId: workspaceA.id,
      platform: 'INSTAGRAM',
      accountName: 'Expired Token Test IG',
      accountId: `pub_test_ig_exp_${Date.now()}`,
      accessTokenEnc: encryptToken('enc_token_expired_12345')!,
      status: 'EXPIRED',
    },
  });

  const content = await prisma.content.create({
    data: {
      workspaceId: workspaceA.id,
      authorId: adminSession.userId,
      title: 'Publishing Suite Test Post',
      masterCaption: 'Testing async publishing pipeline',
      status: 'SCHEDULED',
      variants: {
        create: [
          {
            platform: 'FACEBOOK',
            caption: 'Facebook Variant Copy',
            hashtags: JSON.stringify(['#Innosom', '#Tech']),
          },
          {
            platform: 'INSTAGRAM',
            caption: 'Instagram Variant Copy',
            hashtags: JSON.stringify(['#Insta', '#Tech']),
          },
        ],
      },
    },
    include: { variants: true },
  });

  const fbVariant = content.variants.find((v) => v.platform === 'FACEBOOK')!;
  const igVariant = content.variants.find((v) => v.platform === 'INSTAGRAM')!;

  await runner.test('Success: Scheduled publication processing publishes successfully', async () => {
    const pub = await prisma.publication.create({
      data: {
        contentVariantId: fbVariant.id,
        socialConnectionId: activeConn.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `test_pub_success_${Date.now()}`,
      },
    });

    const result = await processPublicationJob(pub.id);
    assertTrue(result.success, `Expected success, got error: ${result.error}`);

    const updatedPub = await prisma.publication.findUnique({ where: { id: pub.id } });
    assertEqual(updatedPub?.status, 'PUBLISHED');
    assertTrue(updatedPub?.publishedAt !== null);
    assertTrue(updatedPub?.providerPostId !== null);

    const updatedContent = await prisma.content.findUnique({ where: { id: content.id } });
    assertEqual(updatedContent?.status, 'PUBLISHED');
  });

  await runner.test('Duplicate Job / Idempotency: Execution of already PUBLISHED job short-circuits safely', async () => {
    const pub = await prisma.publication.create({
      data: {
        contentVariantId: fbVariant.id,
        socialConnectionId: activeConn.id,
        scheduledAt: new Date(),
        status: 'PUBLISHED',
        providerPostId: 'existing_post_100',
        publishedAt: new Date(),
        idempotencyKey: `test_pub_idempotent_${Date.now()}`,
      },
    });

    const result = await processPublicationJob(pub.id);
    assertTrue(result.success);

    const unchangedPub = await prisma.publication.findUnique({ where: { id: pub.id } });
    assertEqual(unchangedPub?.providerPostId, 'existing_post_100');
  });

  await runner.test('Expired Token: Connection with expired token fails prior to publishing execution', async () => {
    const pub = await prisma.publication.create({
      data: {
        contentVariantId: igVariant.id,
        socialConnectionId: expiredConn.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `test_pub_expired_${Date.now()}`,
      },
    });

    const result = await processPublicationJob(pub.id);
    assertTrue(!result.success);
    assertTrue(result.error?.includes('expired') || false);

    const failedPub = await prisma.publication.findUnique({ where: { id: pub.id } });
    assertEqual(failedPub?.status, 'FAILED');
    assertTrue(failedPub?.errorMessage?.includes('expired') || false);
  });

  await runner.test('Rate Limit / Retriable Failure: Handled cleanly by updating status to FAILED', async () => {
    const pub = await prisma.publication.create({
      data: {
        contentVariantId: fbVariant.id,
        socialConnectionId: activeConn.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `pub_fail_once_${Date.now()}`,
      },
    });

    const result = await processPublicationJob(pub.id);
    assertTrue(!result.success);
    assertTrue(result.error?.includes('rate limit') || false);

    const rateLimitedPub = await prisma.publication.findUnique({ where: { id: pub.id } });
    assertEqual(rateLimitedPub?.status, 'FAILED');
  });

  await runner.test('Retry API Endpoint: Resets status to SCHEDULED and updates idempotency key', async () => {
    const failedPub = await prisma.publication.create({
      data: {
        contentVariantId: fbVariant.id,
        socialConnectionId: activeConn.id,
        scheduledAt: new Date(),
        status: 'FAILED',
        errorMessage: 'Mock initial error',
        idempotencyKey: `pub_retry_test_${Date.now()}`,
      },
    });

    const req = await createMockRequest({
      url: `/api/publications/${failedPub.id}/retry`,
      method: 'POST',
      session: adminSession,
    });
    const res = await retryPOST(req, { params: Promise.resolve({ id: failedPub.id }) });
    assertEqual(res.status, 200);

    const retriedPub = await prisma.publication.findUnique({ where: { id: failedPub.id } });
    assertEqual(retriedPub?.status, 'SCHEDULED');
    assertEqual(retriedPub?.errorMessage, null);
    assertTrue(retriedPub?.idempotencyKey.includes('_retried_') || false);
  });

  await runner.test('Duplicate Idempotency Key DB Constraint: Prevents duplicate publication insertion', async () => {
    const key = `unique_idempotency_key_${Date.now()}`;
    await prisma.publication.create({
      data: {
        contentVariantId: fbVariant.id,
        socialConnectionId: activeConn.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: key,
      },
    });

    let caughtDuplicateError = false;
    try {
      await prisma.publication.create({
        data: {
          contentVariantId: fbVariant.id,
          socialConnectionId: activeConn.id,
          scheduledAt: new Date(),
          status: 'SCHEDULED',
          idempotencyKey: key,
        },
      });
    } catch (err: any) {
      caughtDuplicateError = true;
    }
    assertTrue(caughtDuplicateError, 'Inserting duplicate idempotency key should throw DB unique constraint error');
  });

  await runner.test('Partial Platform Failure: Independent statuses recorded across multi-platform variants', async () => {
    const pubSuccess = await prisma.publication.create({
      data: {
        contentVariantId: fbVariant.id,
        socialConnectionId: activeConn.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `partial_success_${Date.now()}`,
      },
    });

    const pubFail = await prisma.publication.create({
      data: {
        contentVariantId: igVariant.id,
        socialConnectionId: expiredConn.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `partial_fail_${Date.now()}`,
      },
    });

    const resSuccess = await processPublicationJob(pubSuccess.id);
    const resFail = await processPublicationJob(pubFail.id);

    assertTrue(resSuccess.success);
    assertTrue(!resFail.success);

    const updatedSuccess = await prisma.publication.findUnique({ where: { id: pubSuccess.id } });
    const updatedFail = await prisma.publication.findUnique({ where: { id: pubFail.id } });

    assertEqual(updatedSuccess?.status, 'PUBLISHED');
    assertEqual(updatedFail?.status, 'FAILED');
  });

  // Clean up
  await prisma.publication.deleteMany({
    where: { socialConnectionId: { in: [activeConn.id, expiredConn.id] } },
  });
  await prisma.content.delete({ where: { id: content.id } });
  await prisma.socialConnection.deleteMany({
    where: { id: { in: [activeConn.id, expiredConn.id] } },
  });

  return runner;
}
