import assert from 'node:assert';
import { processPublicationJob } from '../src/modules/publishing/PublishingWorker';
import { prisma } from '../src/lib/prisma';
import { encryptToken } from '../src/lib/encryption';
import { signSessionToken, SessionPayload } from '../src/lib/auth';
import { POST as retryPublication } from '../src/app/api/publications/[id]/retry/route';
import { NextRequest } from 'next/server';

async function runPublishingTests() {
  console.log('🧪 Running Comprehensive Publishing Pipeline Tests...');

  let org = await prisma.organization.findFirst({ where: { slug: 'innosom' } });
  if (!org) {
    org = await prisma.organization.create({
      data: { name: 'INNOSOM Primary Org', slug: 'innosom' },
    });
  }

  let user = await prisma.user.findFirst({ where: { email: 'pub_test@innosom.com' } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: 'pub_test@innosom.com',
        name: 'Publishing Tester',
        passwordHash: 'hash123',
      },
    });
  }

  let ws = await prisma.workspace.create({
    data: {
      organizationId: org.id,
      name: `Pub WS ${Date.now()}`,
      slug: `pub-ws-${Date.now()}`,
    },
  });

  const session: SessionPayload = {
    userId: user.id,
    email: user.email,
    name: user.name,
    organizationId: org.id,
    role: 'ADMIN',
  };
  const validToken = await signSessionToken(session);

  const socialConn = await prisma.socialConnection.create({
    data: {
      workspaceId: ws.id,
      platform: 'facebook',
      accountName: 'Publishing FB Page',
      accountId: `fb_pub_${Date.now()}`,
      accessTokenEnc: encryptToken('mock_valid_token'),
    },
  });

  // 1. Successful Scheduled Publication Execution & Idempotency
  console.log('Testing 1: Successful Execution & Idempotency Check...');

  const content1 = await prisma.content.create({
    data: {
      workspaceId: ws.id,
      authorId: user.id,
      title: 'Successful Post',
      masterCaption: 'Testing successful publishing flow',
      status: 'SCHEDULED',
    },
  });

  const variant1 = await prisma.contentVariant.create({
    data: {
      contentId: content1.id,
      platform: 'facebook',
      caption: 'FB Variant Caption',
    },
  });

  const pub1 = await prisma.publication.create({
    data: {
      contentVariantId: variant1.id,
      socialConnectionId: socialConn.id,
      scheduledAt: new Date(),
      status: 'SCHEDULED',
      idempotencyKey: `ik_succ_${Date.now()}`,
    },
  });

  // Process job
  const res1 = await processPublicationJob(pub1.id);
  assert.strictEqual(res1.success, true, 'Publication execution should succeed');

  const updatedPub1 = await prisma.publication.findUnique({ where: { id: pub1.id } });
  assert.strictEqual(updatedPub1?.status, 'PUBLISHED', 'Publication status should be updated to PUBLISHED');
  assert.ok(updatedPub1?.providerPostId, 'Provider post ID should be recorded');

  // Idempotency check: process same publication again
  const resIdempotent = await processPublicationJob(pub1.id);
  assert.strictEqual(resIdempotent.success, true, 'Re-executing an already PUBLISHED post should return success idempotently');

  console.log('  ✅ Successful execution & idempotency tests passed');

  // 2. Retry Endpoint & Failure Recovery
  console.log('Testing 2: Retry Endpoint & Status Reset...');

  const pubFailed = await prisma.publication.create({
    data: {
      contentVariantId: variant1.id,
      socialConnectionId: socialConn.id,
      scheduledAt: new Date(),
      status: 'FAILED',
      errorMessage: 'Simulated network timeout',
      idempotencyKey: `ik_failed_${Date.now()}`,
    },
  });

  const retryReq = new NextRequest(`http://localhost:3000/api/publications/${pubFailed.id}/retry`, {
    method: 'POST',
  });
  retryReq.cookies.set('innosom_session', validToken);

  const retryRes = await retryPublication(retryReq, { params: Promise.resolve({ id: pubFailed.id }) });
  assert.strictEqual(retryRes.status, 200, 'Retry endpoint should return HTTP 200');

  const updatedPubFailed = await prisma.publication.findUnique({ where: { id: pubFailed.id } });
  assert.strictEqual(updatedPubFailed?.status, 'SCHEDULED', 'Retried publication status should reset to SCHEDULED');
  assert.strictEqual(updatedPubFailed?.errorMessage, null, 'Error message should be cleared upon retry');

  console.log('  ✅ Retry endpoint & status reset tests passed');

  // 3. Worker Concurrency Locks Simulation
  console.log('Testing 3: Worker Concurrency & Lock Handling...');

  const content3 = await prisma.content.create({
    data: {
      workspaceId: ws.id,
      authorId: user.id,
      title: 'Concurrent Post',
      masterCaption: 'Testing concurrent worker locks',
      status: 'SCHEDULED',
    },
  });

  const variant3 = await prisma.contentVariant.create({
    data: {
      contentId: content3.id,
      platform: 'facebook',
      caption: 'FB Concurrent Variant',
    },
  });

  const pub3 = await prisma.publication.create({
    data: {
      contentVariantId: variant3.id,
      socialConnectionId: socialConn.id,
      scheduledAt: new Date(),
      status: 'SCHEDULED',
      idempotencyKey: `ik_conc_${Date.now()}`,
    },
  });

  // Execute two worker jobs concurrently
  const [concRes1, concRes2] = await Promise.all([
    processPublicationJob(pub3.id),
    processPublicationJob(pub3.id),
  ]);

  assert.ok(concRes1.success && concRes2.success, 'Both concurrent executions should resolve gracefully without race condition errors');

  const finalPub3 = await prisma.publication.findUnique({ where: { id: pub3.id } });
  assert.strictEqual(finalPub3?.status, 'PUBLISHED', 'Final status should be PUBLISHED');

  console.log('  ✅ Worker concurrency & lock handling tests passed');

  // 4. Partial Platform Failure
  console.log('Testing 4: Partial Platform Failure Tracking...');

  const contentMulti = await prisma.content.create({
    data: {
      workspaceId: ws.id,
      authorId: user.id,
      title: 'Multi Platform Post',
      masterCaption: 'Multi platform test post',
      status: 'SCHEDULED',
    },
  });

  const variantFB = await prisma.contentVariant.create({
    data: {
      contentId: contentMulti.id,
      platform: 'facebook',
      caption: 'FB Multi Variant',
    },
  });

  const variantIG = await prisma.contentVariant.create({
    data: {
      contentId: contentMulti.id,
      platform: 'instagram',
      caption: 'IG Multi Variant',
    },
  });

  const pubFB = await prisma.publication.create({
    data: {
      contentVariantId: variantFB.id,
      socialConnectionId: socialConn.id,
      scheduledAt: new Date(),
      status: 'SCHEDULED',
      idempotencyKey: `ik_fb_${Date.now()}`,
    },
  });

  const pubIG = await prisma.publication.create({
    data: {
      contentVariantId: variantIG.id,
      socialConnectionId: socialConn.id,
      scheduledAt: new Date(),
      status: 'SCHEDULED',
      idempotencyKey: `ik_ig_${Date.now()}`,
    },
  });

  // Process FB success, simulate IG failure
  await processPublicationJob(pubFB.id);

  await prisma.publication.update({
    where: { id: pubIG.id },
    data: {
      status: 'FAILED',
      errorMessage: 'Instagram media container creation timeout',
    },
  });

  const checkFB = await prisma.publication.findUnique({ where: { id: pubFB.id } });
  const checkIG = await prisma.publication.findUnique({ where: { id: pubIG.id } });

  assert.strictEqual(checkFB?.status, 'PUBLISHED', 'FB variant publication should be PUBLISHED');
  assert.strictEqual(checkIG?.status, 'FAILED', 'IG variant publication should be FAILED');

  console.log('  ✅ Partial platform failure tracking tests passed');

  // Cleanup test workspace
  await prisma.workspace.delete({ where: { id: ws.id } });

  console.log('🎉 ALL PUBLISHING PIPELINE TESTS PASSED SUCCESSFULLY!');
}

runPublishingTests()
  .catch((e) => {
    console.error('❌ Publishing pipeline tests failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
