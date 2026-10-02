import { processPublicationJob } from '../src/modules/publishing/PublishingWorker';
import { prisma } from '../src/lib/prisma';
import { encryptToken } from '../src/lib/encryption';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

async function runAdvancedPublishingTests() {
  console.log('🧪 Running Advanced Publishing & Queue Resilience Tests...\n');

  // Setup test org & workspace
  let org = await prisma.organization.findFirst({ where: { slug: 'pub-test-org' } });
  if (!org) {
    org = await prisma.organization.create({
      data: { name: 'Publishing Test Org', slug: 'pub-test-org' },
    });
  }

  let user = await prisma.user.findFirst({ where: { email: 'pubuser@test.com' } });
  if (!user) {
    user = await prisma.user.create({
      data: { name: 'Pub User', email: 'pubuser@test.com', passwordHash: 'hash' },
    });
  }

  let ws = await prisma.workspace.findFirst({ where: { organizationId: org.id, slug: 'pub-ws' } });
  if (!ws) {
    ws = await prisma.workspace.create({
      data: { organizationId: org.id, name: 'Pub Workspace', slug: 'pub-ws' },
    });
  }

  let socialConn = await prisma.socialConnection.findFirst({ where: { workspaceId: ws.id, platform: 'FACEBOOK' } });
  if (!socialConn) {
    socialConn = await prisma.socialConnection.create({
      data: {
        workspaceId: ws.id,
        platform: 'FACEBOOK',
        accountName: 'Test Page FB',
        accountId: 'fb_acc_99',
        accessTokenEnc: encryptToken('test_fb_token')!,
      },
    });
  }

  let socialConnExpired = await prisma.socialConnection.findFirst({ where: { workspaceId: ws.id, platform: 'INSTAGRAM' } });
  if (!socialConnExpired) {
    socialConnExpired = await prisma.socialConnection.create({
      data: {
        workspaceId: ws.id,
        platform: 'INSTAGRAM',
        accountName: 'Expired IG Account',
        accountId: 'ig_acc_expired',
        accessTokenEnc: encryptToken('expired_ig_token')!,
      },
    });
  }

  try {
    // -------------------------------------------------------------
    // 1. Publishing Workflow Scenarios: Success, Failure, Retry & Token Errors
    // -------------------------------------------------------------
    console.log('Testing Publishing Execution Scenarios...');

    // 1a. Successful Publishing Execution
    const contentSuccess = await prisma.content.create({
      data: { workspaceId: ws.id, authorId: user.id, title: 'Success Post', masterCaption: 'Test Caption', status: 'SCHEDULED' },
    });
    const variantSuccess = await prisma.contentVariant.create({
      data: { contentId: contentSuccess.id, platform: 'FACEBOOK', caption: 'Test Caption' },
    });
    const pubSuccess = await prisma.publication.create({
      data: {
        contentVariantId: variantSuccess.id,
        socialConnectionId: socialConn.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `idemp_${Date.now()}_1`,
      },
    });

    const resSuccess = await processPublicationJob(pubSuccess.id);
    if (!resSuccess.success) throw new Error(`Publishing success test failed: ${resSuccess.error}`);

    const dbPubSuccess = await prisma.publication.findUnique({ where: { id: pubSuccess.id } });
    if (dbPubSuccess?.status !== 'PUBLISHED' || !dbPubSuccess.providerPostId) {
      throw new Error('Publication status was not correctly set to PUBLISHED or missing providerPostId');
    }
    console.log('  ✅ Successful publication execution & DB state update verified.');

    // 1b. Idempotency & Re-execution Protection
    const resDuplicateJob = await processPublicationJob(pubSuccess.id);
    if (!resDuplicateJob.success) throw new Error('Duplicate job processing failed to handle idempotency safely.');
    console.log('  ✅ Idempotent execution on already-PUBLISHED publication verified.');

    // 1c. Failure State Transition on Expired Token
    const contentFail = await prisma.content.create({
      data: { workspaceId: ws.id, authorId: user.id, title: 'Expired Token Post', masterCaption: 'Fail Caption', status: 'SCHEDULED' },
    });
    const variantFail = await prisma.contentVariant.create({
      data: { contentId: contentFail.id, platform: 'INSTAGRAM', caption: 'Fail Caption' },
    });
    const pubFail = await prisma.publication.create({
      data: {
        contentVariantId: variantFail.id,
        socialConnectionId: socialConnExpired.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `idemp_${Date.now()}_2`,
      },
    });

    const resFail = await processPublicationJob(pubFail.id);
    if (resFail.success) throw new Error('Expected failure on expired token, but succeeded.');

    const dbPubFail = await prisma.publication.findUnique({ where: { id: pubFail.id } });
    if (dbPubFail?.status !== 'FAILED' || !dbPubFail.errorMessage) {
      throw new Error('Publication status was not set to FAILED on expired token.');
    }
    console.log('  ✅ Failure state transition & error log recording verified.\n');

    // -------------------------------------------------------------
    // 2. Queue & Worker Resilience (Concurrent Execution & Idempotency Keys)
    // -------------------------------------------------------------
    console.log('Testing Worker Race Conditions & Idempotency Guarantees...');

    // 2a. Concurrent Worker Execution (Atomic execution guard)
    const contentConc = await prisma.content.create({
      data: { workspaceId: ws.id, authorId: user.id, title: 'Concurrent Post', masterCaption: 'Conc Caption', status: 'SCHEDULED' },
    });
    const variantConc = await prisma.contentVariant.create({
      data: { contentId: contentConc.id, platform: 'FACEBOOK', caption: 'Conc Caption' },
    });
    const pubConc = await prisma.publication.create({
      data: {
        contentVariantId: variantConc.id,
        socialConnectionId: socialConn.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `idemp_conc_${Date.now()}`,
      },
    });

    // Fire 5 worker execution promises simultaneously
    const results = await Promise.all([
      processPublicationJob(pubConc.id),
      processPublicationJob(pubConc.id),
      processPublicationJob(pubConc.id),
      processPublicationJob(pubConc.id),
      processPublicationJob(pubConc.id),
    ]);

    const allSuccessful = results.every((r) => r.success);
    if (!allSuccessful) throw new Error('Concurrent workers failed execution.');

    const dbPubConc = await prisma.publication.findUnique({ where: { id: pubConc.id } });
    if (dbPubConc?.status !== 'PUBLISHED') {
      throw new Error(`Concurrent execution resulted in invalid status: ${dbPubConc?.status}`);
    }
    console.log('  ✅ Concurrent worker race condition safety verified.');

    // 2b. Partial Platform Failure handling
    const contentMulti = await prisma.content.create({
      data: { workspaceId: ws.id, authorId: user.id, title: 'Multi Platform Post', masterCaption: 'Multi Caption', status: 'IN_REVIEW' },
    });
    const variantValid = await prisma.contentVariant.create({
      data: { contentId: contentMulti.id, platform: 'FACEBOOK', caption: 'Valid Caption' },
    });
    const variantInvalid = await prisma.contentVariant.create({
      data: { contentId: contentMulti.id, platform: 'INSTAGRAM', caption: 'Invalid Caption' },
    });

    const pubValid = await prisma.publication.create({
      data: {
        contentVariantId: variantValid.id,
        socialConnectionId: socialConn.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `idemp_multi_1_${Date.now()}`,
      },
    });

    const pubInvalid = await prisma.publication.create({
      data: {
        contentVariantId: variantInvalid.id,
        socialConnectionId: socialConnExpired.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `idemp_multi_2_${Date.now()}`,
      },
    });

    const resMultiValid = await processPublicationJob(pubValid.id);
    const resMultiInvalid = await processPublicationJob(pubInvalid.id);

    if (!resMultiValid.success || resMultiInvalid.success) {
      throw new Error('Partial platform failure test did not yield expected individual status results.');
    }

    const dbPubMultiValid = await prisma.publication.findUnique({ where: { id: pubValid.id } });
    const dbPubMultiInvalid = await prisma.publication.findUnique({ where: { id: pubInvalid.id } });

    if (dbPubMultiValid?.status !== 'PUBLISHED' || dbPubMultiInvalid?.status !== 'FAILED') {
      throw new Error('Partial platform failure state isolation failed.');
    }
    console.log('  ✅ Partial multi-platform execution state isolation verified.\n');

    console.log('🎉 ALL ADVANCED PUBLISHING & QUEUE TESTS PASSED SUCCESSFULLY! 🎉');
  } finally {
    await prisma.$disconnect();
  }
}

runAdvancedPublishingTests().catch((err) => {
  console.error('❌ Advanced publishing test execution failed:', err);
  process.exit(1);
});
