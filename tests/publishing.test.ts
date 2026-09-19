import { processPublicationJob, syncParentContentStatus } from '../src/modules/publishing/PublishingWorker';
import { recoverStuckPublications } from '../src/modules/publishing/QueueService';
import { assertValidPublicationTransition } from '../src/modules/publishing/StateMachine';
import { encryptToken } from '../src/lib/encryption';
import { prisma } from '../src/lib/prisma';

async function runPublishingTests() {
  console.log('🧪 Running Comprehensive Publishing Architecture Resilience Tests...\n');

  // Setup test Workspace, User, Organization, Social Connections, Content & Variants
  const org = await prisma.organization.upsert({
    where: { slug: 'test-resilience-org' },
    update: {},
    create: { name: 'Test Resilience Org', slug: 'test-resilience-org' },
  });

  const workspace = await prisma.workspace.upsert({
    where: { organizationId_slug: { organizationId: org.id, slug: 'test-resilience-workspace' } },
    update: {},
    create: { name: 'Test Workspace', slug: 'test-resilience-workspace', organizationId: org.id },
  });

  const user = await prisma.user.upsert({
    where: { email: 'resilience-tester@innosom.com' },
    update: {},
    create: { email: 'resilience-tester@innosom.com', name: 'Resilience Tester', passwordHash: 'hash' },
  });

  // Valid connection
  const connFB = await prisma.socialConnection.upsert({
    where: { workspaceId_platform_accountId: { workspaceId: workspace.id, platform: 'Facebook', accountId: 'fb-test-acc' } },
    update: { status: 'CONNECTED', accessTokenEnc: encryptToken('valid_fb_access_token_123') },
    create: {
      workspaceId: workspace.id,
      platform: 'Facebook',
      accountName: 'FB Test Page',
      accountId: 'fb-test-acc',
      status: 'CONNECTED',
      accessTokenEnc: encryptToken('valid_fb_access_token_123'),
    },
  });

  // Expired connection
  const connExpired = await prisma.socialConnection.upsert({
    where: { workspaceId_platform_accountId: { workspaceId: workspace.id, platform: 'Instagram', accountId: 'ig-test-expired' } },
    update: { status: 'CONNECTED', accessTokenEnc: encryptToken('expired_access_token_456') },
    create: {
      workspaceId: workspace.id,
      platform: 'Instagram',
      accountName: 'IG Expired Account',
      accountId: 'ig-test-expired',
      status: 'CONNECTED',
      accessTokenEnc: encryptToken('expired_access_token_456'),
    },
  });

  // Content with variants
  const content = await prisma.content.create({
    data: {
      workspaceId: workspace.id,
      authorId: user.id,
      title: 'Resilience Test Content',
      masterCaption: 'Testing production resilience',
      status: 'SCHEDULED',
    },
  });

  const variantFB = await prisma.contentVariant.create({
    data: {
      contentId: content.id,
      platform: 'Facebook',
      caption: 'FB Variant Caption',
    },
  });

  const variantIG = await prisma.contentVariant.create({
    data: {
      contentId: content.id,
      platform: 'Instagram',
      caption: 'IG Variant Caption',
    },
  });

  // 1. Provider Success Test
  console.log('1️⃣ Testing Provider Success...');
  const pubSuccess = await prisma.publication.create({
    data: {
      contentVariantId: variantFB.id,
      socialConnectionId: connFB.id,
      scheduledAt: new Date(),
      status: 'SCHEDULED',
      idempotencyKey: `test_success_${Date.now()}`,
    },
  });

  const resSuccess = await processPublicationJob(pubSuccess.id);
  if (!resSuccess.success) throw new Error(`Provider success test failed: ${resSuccess.error}`);
  const updatedPubSuccess = await prisma.publication.findUnique({ where: { id: pubSuccess.id } });
  if (updatedPubSuccess?.status !== 'PUBLISHED' || !updatedPubSuccess.providerPostId) {
    throw new Error('Publication was not correctly updated to PUBLISHED with providerPostId');
  }
  console.log('   ✅ Provider Success Test Passed');

  // 2. Duplicate Worker & Idempotency Safety Test
  console.log('2️⃣ Testing Concurrent Duplicate Workers & Idempotency Safety...');
  const pubConcurrent = await prisma.publication.create({
    data: {
      contentVariantId: variantFB.id,
      socialConnectionId: connFB.id,
      scheduledAt: new Date(),
      status: 'SCHEDULED',
      idempotencyKey: `test_concurrent_${Date.now()}`,
    },
  });

  const [res1, res2, res3] = await Promise.all([
    processPublicationJob(pubConcurrent.id),
    processPublicationJob(pubConcurrent.id),
    processPublicationJob(pubConcurrent.id),
  ]);

  if (!res1.success || !res2.success || !res3.success) {
    throw new Error('Concurrent workers failed or raised unhandled exception');
  }
  const updatedConcurrent = await prisma.publication.findUnique({ where: { id: pubConcurrent.id } });
  if (updatedConcurrent?.status !== 'PUBLISHED' || updatedConcurrent.attempts > 1) {
    throw new Error(`Duplicate workers caused duplicate attempts! Attempts count: ${updatedConcurrent?.attempts}`);
  }
  console.log('   ✅ Duplicate Workers & Idempotency Test Passed');

  // 3. Provider Timeout & Reconciliation Test
  console.log('3️⃣ Testing Provider Timeout & Reconciliation Behavior...');
  const timeoutKey = `test_timeout_after_creation_${Date.now()}`;
  const pubTimeout = await prisma.publication.create({
    data: {
      contentVariantId: variantFB.id,
      socialConnectionId: connFB.id,
      scheduledAt: new Date(),
      status: 'SCHEDULED',
      idempotencyKey: timeoutKey,
    },
  });

  // First run simulates network timeout after post creation on social platform
  const resTimeout1 = await processPublicationJob(pubTimeout.id);
  if (resTimeout1.success || !resTimeout1.isRetriable) {
    throw new Error('Expected timeout run to be marked retriable failure');
  }

  // Second run uses provider reconciliation check before attempting duplicate publish
  const resTimeout2 = await processPublicationJob(pubTimeout.id);
  if (!resTimeout2.success) {
    throw new Error(`Reconciliation retry failed: ${resTimeout2.error}`);
  }

  const updatedPubTimeout = await prisma.publication.findUnique({ where: { id: pubTimeout.id } });
  if (updatedPubTimeout?.status !== 'PUBLISHED' || !updatedPubTimeout.providerPostId) {
    throw new Error('Publication reconciliation did not resolve status to PUBLISHED');
  }
  console.log('   ✅ Provider Timeout & Reconciliation Test Passed');

  // 4. Rate Limit Retry Classification Test
  console.log('4️⃣ Testing Rate Limit Retry Classification...');
  const pubRateLimit = await prisma.publication.create({
    data: {
      contentVariantId: variantFB.id,
      socialConnectionId: connFB.id,
      scheduledAt: new Date(),
      status: 'SCHEDULED',
      idempotencyKey: `test_rate_limit_${Date.now()}`,
    },
  });

  const resRateLimit = await processPublicationJob(pubRateLimit.id);
  if (resRateLimit.success || !resRateLimit.isRetriable) {
    throw new Error('Rate limit error was not correctly classified as retriable');
  }
  console.log('   ✅ Rate Limit Retry Classification Test Passed');

  // 5. Expired Token & Non-Retriable Classification Test
  console.log('5️⃣ Testing Expired Token Handling & Connection Invalidation...');
  const pubExpired = await prisma.publication.create({
    data: {
      contentVariantId: variantIG.id,
      socialConnectionId: connExpired.id,
      scheduledAt: new Date(),
      status: 'SCHEDULED',
      idempotencyKey: `test_expired_${Date.now()}`,
    },
  });

  const resExpired = await processPublicationJob(pubExpired.id);
  if (resExpired.success || resExpired.isRetriable) {
    throw new Error('Expired token error was wrongly marked retriable');
  }

  const updatedConnExpired = await prisma.socialConnection.findUnique({ where: { id: connExpired.id } });
  if (updatedConnExpired?.status !== 'EXPIRED') {
    throw new Error('Social connection was not marked EXPIRED upon token expiration');
  }
  console.log('   ✅ Expired Token & Connection Invalidation Test Passed');

  // 6. Worker Crash & Stuck Publication Recovery Test
  console.log('6️⃣ Testing Worker Crash & Stuck Publication Recovery...');
  const pubStuck = await prisma.publication.create({
    data: {
      contentVariantId: variantFB.id,
      socialConnectionId: connFB.id,
      scheduledAt: new Date(),
      status: 'PUBLISHING',
      lastAttemptAt: new Date(Date.now() - 10 * 60 * 1000), // 10 mins ago
      idempotencyKey: `test_stuck_${Date.now()}`,
    },
  });

  await recoverStuckPublications();
  const updatedPubStuck = await prisma.publication.findUnique({ where: { id: pubStuck.id } });
  if (updatedPubStuck?.status !== 'SCHEDULED') {
    throw new Error('Stuck publication in PUBLISHING state was not recovered to SCHEDULED');
  }
  console.log('   ✅ Worker Crash & Stuck Recovery Test Passed');

  // 7. Multi-Platform Independent Tracking & Partial Success Test
  console.log('7️⃣ Testing Multi-Platform Independent Tracking & Partial Content Status...');
  const multiContent = await prisma.content.create({
    data: {
      workspaceId: workspace.id,
      authorId: user.id,
      title: 'Multi-Platform Post',
      masterCaption: 'Multi platform caption',
      status: 'SCHEDULED',
    },
  });

  const varFB = await prisma.contentVariant.create({
    data: { contentId: multiContent.id, platform: 'Facebook', caption: 'FB' },
  });
  const varIG = await prisma.contentVariant.create({
    data: { contentId: multiContent.id, platform: 'Instagram', caption: 'IG' },
  });

  const pubFB = await prisma.publication.create({
    data: {
      contentVariantId: varFB.id,
      socialConnectionId: connFB.id,
      scheduledAt: new Date(),
      status: 'SCHEDULED',
      idempotencyKey: `test_multi_fb_${Date.now()}`,
    },
  });

  const pubIG = await prisma.publication.create({
    data: {
      contentVariantId: varIG.id,
      socialConnectionId: connExpired.id, // Will fail
      scheduledAt: new Date(),
      status: 'SCHEDULED',
      idempotencyKey: `test_multi_ig_${Date.now()}`,
    },
  });

  await processPublicationJob(pubFB.id);
  await processPublicationJob(pubIG.id);

  const updatedMultiContent = await prisma.content.findUnique({ where: { id: multiContent.id } });
  if (updatedMultiContent?.status !== 'PARTIALLY_PUBLISHED') {
    throw new Error(`Expected Content status PARTIALLY_PUBLISHED but got ${updatedMultiContent?.status}`);
  }
  console.log('   ✅ Multi-Platform Independent Tracking Test Passed');

  // 8. State Machine Transition Constraints Test
  console.log('8️⃣ Testing State Machine Transition Constraints...');
  let transitionThrew = false;
  try {
    assertValidPublicationTransition('PUBLISHED', 'SCHEDULED');
  } catch (err) {
    transitionThrew = true;
  }
  if (!transitionThrew) {
    throw new Error('State machine failed to block invalid transition from PUBLISHED to SCHEDULED');
  }
  console.log('   ✅ State Machine Transition Constraints Test Passed');

  console.log('\n🎉 ALL PUBLISHING ARCHITECTURE TESTS PASSED SUCCESSFULLY!');
  await prisma.$disconnect();
}

runPublishingTests().catch((err) => {
  console.error('\n❌ Publishing Architecture Test Suite Failed:', err);
  process.exit(1);
});
