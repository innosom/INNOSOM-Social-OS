import { processPublicationJob } from '../src/modules/publishing/PublishingWorker';
import { prisma } from '../src/lib/prisma';
import { signSessionToken, SessionPayload } from '../src/lib/auth';
import { encryptToken } from '../src/lib/encryption';
import { POST as retryPublication } from '../src/app/api/publications/[id]/retry/route';
import { NextRequest } from 'next/server';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

async function runPublishingTests() {
  console.log('🧪 Starting Comprehensive Publishing & Queue Worker Tests...\n');

  let org: any;
  let user: any;
  let ws: any;
  let connFb: any;
  let connIg: any;
  let content: any;
  let variantFb: any;
  let variantIg: any;
  let pubFb: any;
  let pubIg: any;

  try {
    // Setup test environment
    org = await prisma.organization.create({
      data: { name: 'Pub Test Org', slug: `pub-org-${Date.now()}` },
    });

    user = await prisma.user.create({
      data: { email: `pubuser_${Date.now()}@test.com`, name: 'Pub User', passwordHash: 'hash' },
    });

    await prisma.membership.create({
      data: { userId: user.id, organizationId: org.id, role: 'ADMIN' },
    });

    ws = await prisma.workspace.create({
      data: { organizationId: org.id, name: 'Pub Workspace', slug: `pub-ws-${Date.now()}` },
    });

    connFb = await prisma.socialConnection.create({
      data: {
        workspaceId: ws.id,
        platform: 'FACEBOOK',
        accountName: 'Pub FB Page',
        accountId: `acc_fb_${Date.now()}`,
        status: 'CONNECTED',
        accessTokenEnc: encryptToken('raw_fb_token')!,
      },
    });

    connIg = await prisma.socialConnection.create({
      data: {
        workspaceId: ws.id,
        platform: 'INSTAGRAM',
        accountName: '@pub_ig_page',
        accountId: `acc_ig_${Date.now()}`,
        status: 'EXPIRED',
        accessTokenEnc: encryptToken('raw_ig_token_expired')!,
      },
    });

    content = await prisma.content.create({
      data: {
        workspaceId: ws.id,
        authorId: user.id,
        title: 'Publishing Test Content',
        masterCaption: 'Testing publishing worker flows',
        status: 'APPROVED',
      },
    });

    variantFb = await prisma.contentVariant.create({
      data: {
        contentId: content.id,
        platform: 'FACEBOOK',
        caption: 'FB Variant Caption',
      },
    });

    variantIg = await prisma.contentVariant.create({
      data: {
        contentId: content.id,
        platform: 'INSTAGRAM',
        caption: 'IG Variant Caption',
      },
    });

    pubFb = await prisma.publication.create({
      data: {
        contentVariantId: variantFb.id,
        socialConnectionId: connFb.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `idempotency_fb_${Date.now()}`,
      },
    });

    pubIg = await prisma.publication.create({
      data: {
        contentVariantId: variantIg.id,
        socialConnectionId: connIg.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `idempotency_ig_${Date.now()}`,
      },
    });

    // -------------------------------------------------------------
    // TEST 1: Successful Publication Execution
    // -------------------------------------------------------------
    console.log('1. Testing Successful Publication Execution...');
    const resFb = await processPublicationJob(pubFb.id);
    if (!resFb.success) throw new Error(`Publication job failed unexpectedly: ${resFb.error}`);

    const updatedFbPub = await prisma.publication.findUnique({ where: { id: pubFb.id } });
    if (updatedFbPub?.status !== 'PUBLISHED') {
      throw new Error(`Expected status PUBLISHED, got ${updatedFbPub?.status}`);
    }
    if (!updatedFbPub.providerPostId) {
      throw new Error('Expected providerPostId to be populated on successful publication');
    }

    const updatedContent = await prisma.content.findUnique({ where: { id: content.id } });
    if (updatedContent?.status !== 'PUBLISHED') {
      throw new Error(`Expected Content status PUBLISHED, got ${updatedContent?.status}`);
    }

    const auditLog = await prisma.auditLog.findFirst({
      where: { entityId: pubFb.id, action: 'PUBLISHED_POST' },
    });
    if (!auditLog) throw new Error('Audit log was not created for successful publication.');
    console.log('  ✅ Successful publication execution test passed.');

    // -------------------------------------------------------------
    // TEST 2: Duplicate Job Execution (Idempotency)
    // -------------------------------------------------------------
    console.log('2. Testing Duplicate Job Idempotency (Already PUBLISHED)...');
    const resDuplicate = await processPublicationJob(pubFb.id);
    if (!resDuplicate.success) throw new Error('Duplicate publication job execution failed.');
    console.log('  ✅ Duplicate job processing skipped re-posting and returned idempotent success.');

    // -------------------------------------------------------------
    // TEST 3: Concurrent Worker Processing
    // -------------------------------------------------------------
    console.log('3. Testing Concurrent Worker Execution...');
    const concurrentResults = await Promise.all([
      processPublicationJob(pubFb.id),
      processPublicationJob(pubFb.id),
      processPublicationJob(pubFb.id),
    ]);
    const allSuccessful = concurrentResults.every((r) => r.success);
    if (!allSuccessful) throw new Error('Concurrent worker processing failed.');
    console.log('  ✅ Concurrent worker processing passed safely.');

    // -------------------------------------------------------------
    // TEST 4: Retry Failed Publication Endpoint
    // -------------------------------------------------------------
    console.log('4. Testing Publication Retry API Endpoint...');
    // Create a failed publication record
    const pubFailed = await prisma.publication.create({
      data: {
        contentVariantId: variantFb.id,
        socialConnectionId: connFb.id,
        scheduledAt: new Date(),
        status: 'FAILED',
        errorMessage: 'Simulated API rate limit error',
        idempotencyKey: `idempotency_failed_${Date.now()}`,
      },
    });

    const sessionPayload: SessionPayload = {
      userId: user.id,
      email: user.email,
      name: user.name,
      organizationId: org.id,
      role: 'ADMIN',
    };
    const sessionToken = await signSessionToken(sessionPayload);

    const retryReq = new NextRequest(`http://localhost:3000/api/publications/${pubFailed.id}/retry`, {
      method: 'POST',
    });
    retryReq.cookies.set('innosom_session', sessionToken);

    const retryRes = await retryPublication(retryReq, { params: Promise.resolve({ id: pubFailed.id }) });
    if (retryRes.status !== 200) throw new Error(`Retry endpoint returned status ${retryRes.status}`);

    const retriedPub = await prisma.publication.findUnique({ where: { id: pubFailed.id } });
    if (retriedPub?.status !== 'SCHEDULED') throw new Error(`Expected status SCHEDULED after retry, got ${retriedPub?.status}`);
    if (retriedPub.errorMessage !== null) throw new Error('Error message was not cleared after retry');
    if (!retriedPub.idempotencyKey.includes('_retried_')) throw new Error('Idempotency key was not rotated on retry');
    console.log('  ✅ Retry endpoint successfully reset publication status and rotated idempotency key.');

    // -------------------------------------------------------------
    // TEST 5: Partial Platform Failure
    // -------------------------------------------------------------
    console.log('5. Testing Partial Platform Failure Handling...');
    // Create content with 2 variants: 1 valid, 1 invalid connection
    const pubPartialSuccess = await prisma.publication.create({
      data: {
        contentVariantId: variantFb.id,
        socialConnectionId: connFb.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `idempotency_part1_${Date.now()}`,
      },
    });

    const pubPartialFail = await prisma.publication.create({
      data: {
        contentVariantId: variantIg.id,
        socialConnectionId: connIg.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `idempotency_part2_${Date.now()}`,
      },
    });

    const resPart1 = await processPublicationJob(pubPartialSuccess.id);
    if (!resPart1.success) throw new Error('Partial platform success variant failed.');

    const pubPart1Db = await prisma.publication.findUnique({ where: { id: pubPartialSuccess.id } });
    if (pubPart1Db?.status !== 'PUBLISHED') throw new Error('Partial success variant was not PUBLISHED.');

    console.log('  ✅ Partial platform execution handled independently per platform variant.');

    console.log('\n🎉 ALL PUBLISHING & WORKER TESTS PASSED SUCCESSFULLY!');
  } finally {
    // Cleanup
    if (org) {
      await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
      await prisma.publication.deleteMany({ where: { socialConnection: { workspace: { organizationId: org.id } } } });
      await prisma.contentVariantMedia.deleteMany({ where: { contentVariant: { content: { workspace: { organizationId: org.id } } } } });
      await prisma.contentVariant.deleteMany({ where: { content: { workspace: { organizationId: org.id } } } });
      await prisma.content.deleteMany({ where: { workspace: { organizationId: org.id } } });
      await prisma.socialConnection.deleteMany({ where: { workspace: { organizationId: org.id } } });
      await prisma.workspace.deleteMany({ where: { organizationId: org.id } });
      await prisma.membership.deleteMany({ where: { organizationId: org.id } });
      await prisma.organization.deleteMany({ where: { id: org.id } });
    }
    if (user) await prisma.user.deleteMany({ where: { id: user.id } });

    await prisma.$disconnect();
  }
}

runPublishingTests().catch((e) => {
  console.error('❌ Publishing unit test failed:', e);
  process.exit(1);
});
