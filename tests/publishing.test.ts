import { processPublicationJob } from '../src/modules/publishing/PublishingWorker';
import { prisma } from '../src/lib/prisma';
import { SocialProviderFactory } from '../src/modules/social/SocialProviderFactory';
import { encryptToken } from '../src/lib/encryption';

async function runPublishingTests() {
  console.log('🧪 Running Comprehensive Publishing Lifecycle & Resilience Tests...\n');

  // Setup test environment data
  const org = await prisma.organization.create({
    data: { name: 'Publishing Test Org', slug: `pub-test-org-${Date.now()}` },
  });

  const user = await prisma.user.create({
    data: {
      email: `pub-user-${Date.now()}@test.com`,
      name: 'Publishing Test User',
      passwordHash: 'hashed',
    },
  });

  await prisma.membership.create({
    data: { userId: user.id, organizationId: org.id, role: 'ADMIN' },
  });

  const workspace = await prisma.workspace.create({
    data: {
      organizationId: org.id,
      name: 'Publishing Workspace',
      slug: `pub-ws-${Date.now()}`,
    },
  });

  const validTokenEnc = encryptToken('valid_access_token_12345')!;
  const expiredTokenEnc = encryptToken('expired_access_token_67890')!;

  const socialConnFB = await prisma.socialConnection.create({
    data: {
      workspaceId: workspace.id,
      platform: 'FACEBOOK',
      accountName: 'Publishing FB Account',
      accountId: 'fb_pub_101',
      accessTokenEnc: validTokenEnc,
      status: 'CONNECTED',
    },
  });

  const socialConnExpired = await prisma.socialConnection.create({
    data: {
      workspaceId: workspace.id,
      platform: 'FACEBOOK',
      accountName: 'Expired Token FB Account',
      accountId: 'fb_pub_expired_102',
      accessTokenEnc: expiredTokenEnc,
      status: 'CONNECTED',
    },
  });

  try {
    // 1. Success Path Execution
    console.log('Testing 1: Publishing Success Path...');
    const content1 = await prisma.content.create({
      data: {
        workspaceId: workspace.id,
        authorId: user.id,
        title: 'Success Post',
        masterCaption: 'Post succeeded!',
        status: 'SCHEDULED',
      },
    });

    const variant1 = await prisma.contentVariant.create({
      data: {
        contentId: content1.id,
        platform: 'FACEBOOK',
        caption: 'Post succeeded!',
      },
    });

    const pubSuccess = await prisma.publication.create({
      data: {
        contentVariantId: variant1.id,
        socialConnectionId: socialConnFB.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `pub_succ_${Date.now()}`,
      },
    });

    const resSuccess = await processPublicationJob(pubSuccess.id);
    if (!resSuccess.success) {
      throw new Error(`Success path publication failed: ${resSuccess.error}`);
    }

    const updatedPubSuccess = await prisma.publication.findUnique({ where: { id: pubSuccess.id } });
    if (updatedPubSuccess?.status !== 'PUBLISHED' || !updatedPubSuccess?.providerPostId) {
      throw new Error('Publication record was not updated to PUBLISHED status or missing providerPostId');
    }
    console.log('✅ Success path publication test passed.');

    // 2. Idempotency Check
    console.log('Testing 2: Idempotency (Re-running already PUBLISHED job)...');
    const resIdempotency = await processPublicationJob(pubSuccess.id);
    if (!resIdempotency.success) {
      throw new Error('Idempotency check failed on already published post');
    }
    console.log('✅ Idempotency test passed.');

    // 3. Duplicate Job & Concurrent Execution Safety
    console.log('Testing 3: Duplicate Job / Concurrent Execution Safety...');
    const content2 = await prisma.content.create({
      data: {
        workspaceId: workspace.id,
        authorId: user.id,
        title: 'Concurrent Post',
        masterCaption: 'Concurrent execution',
        status: 'SCHEDULED',
      },
    });

    const variant2 = await prisma.contentVariant.create({
      data: {
        contentId: content2.id,
        platform: 'FACEBOOK',
        caption: 'Concurrent execution',
      },
    });

    const pubConcurrent = await prisma.publication.create({
      data: {
        contentVariantId: variant2.id,
        socialConnectionId: socialConnFB.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `pub_conc_${Date.now()}`,
      },
    });

    // Run parallel execution attempts to simulate worker race conditions
    const [resConc1, resConc2] = await Promise.all([
      processPublicationJob(pubConcurrent.id),
      processPublicationJob(pubConcurrent.id),
    ]);

    if (!resConc1.success || !resConc2.success) {
      throw new Error('Concurrent worker execution failed');
    }

    const finalConcPub = await prisma.publication.findUnique({ where: { id: pubConcurrent.id } });
    if (finalConcPub?.status !== 'PUBLISHED') {
      throw new Error('Concurrent publication failed to reach final PUBLISHED state');
    }
    console.log('✅ Concurrent worker execution & race condition safety test passed.');

    // 4. Expired Token Failure Handling
    console.log('Testing 4: Expired Token Failure Handling...');
    const contentExpired = await prisma.content.create({
      data: {
        workspaceId: workspace.id,
        authorId: user.id,
        title: 'Expired Token Post',
        masterCaption: 'Expired Token',
        status: 'SCHEDULED',
      },
    });

    const variantExpired = await prisma.contentVariant.create({
      data: {
        contentId: contentExpired.id,
        platform: 'FACEBOOK',
        caption: 'Expired Token',
      },
    });

    const pubExpired = await prisma.publication.create({
      data: {
        contentVariantId: variantExpired.id,
        socialConnectionId: socialConnExpired.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `pub_exp_${Date.now()}`,
      },
    });

    const resExpired = await processPublicationJob(pubExpired.id);
    if (resExpired.success) {
      throw new Error('Expired token publication should have failed but succeeded');
    }

    const updatedPubExpired = await prisma.publication.findUnique({ where: { id: pubExpired.id } });
    if (updatedPubExpired?.status !== 'FAILED' || !updatedPubExpired?.errorMessage) {
      throw new Error('Expired token publication record not marked as FAILED with error message');
    }
    console.log('✅ Expired token failure handling test passed.');

    // 5. Provider Rate Limit & Timeout Retry Handling
    console.log('Testing 5: Rate Limit & Timeout Classification...');
    const originalFetch = global.fetch;
    try {
      const fbProvider = new (require('../src/modules/social/FacebookProvider').FacebookProvider)();

      // Mock rate limit response from Graph API
      global.fetch = async (url: any) => {
        if (url.toString().includes('/me?')) {
          return { ok: true, json: async () => ({ id: 'fb_user_123' }) } as any;
        }
        return { ok: false, status: 400, json: async () => ({ error: { code: 17, message: 'User request limit reached' } }) } as any;
      };

      const rateLimitRes = await fbProvider.publish(
        { caption: 'Test rate limit', hashtags: [], mediaUrls: [] },
        { accessTokenEnc: encryptToken('mock_test_token')! },
        'idempotency_rate_limit_1'
      );

      if (rateLimitRes.success) {
        throw new Error('Expected rate limit response to return failure.');
      }
      if (!rateLimitRes.isRetriable) {
        throw new Error('Rate limit error should be classified as retriable.');
      }
      console.log('✅ Rate limit classification test passed.');

      // Mock network timeout response
      global.fetch = async (url: any) => {
        if (url.toString().includes('/me?')) {
          return { ok: true, json: async () => ({ id: 'fb_user_123' }) } as any;
        }
        throw new Error('Network timeout connecting to Meta API');
      };

      const timeoutRes = await fbProvider.publish(
        { caption: 'Test timeout', hashtags: [], mediaUrls: [] },
        { accessTokenEnc: encryptToken('mock_test_token')! },
        'idempotency_timeout_1'
      );

      if (timeoutRes.success) {
        throw new Error('Expected network timeout to return failure.');
      }
      if (!timeoutRes.isRetriable) {
        throw new Error('Network timeout error should be classified as retriable.');
      }
      console.log('✅ Network timeout classification test passed.');
    } finally {
      global.fetch = originalFetch;
    }

    // 6. Partial Platform Failure Handling
    console.log('Testing 6: Partial Multi-Platform Failure Handling...');
    const multiContent = await prisma.content.create({
      data: {
        workspaceId: workspace.id,
        authorId: user.id,
        title: 'Multi-platform post',
        masterCaption: 'Multi-platform caption',
        status: 'SCHEDULED',
      },
    });

    const variantSuccess = await prisma.contentVariant.create({
      data: {
        contentId: multiContent.id,
        platform: 'FACEBOOK',
        caption: 'Success platform',
      },
    });

    const variantFail = await prisma.contentVariant.create({
      data: {
        contentId: multiContent.id,
        platform: 'INSTAGRAM',
        caption: 'Failed platform',
      },
    });

    const pubMultiSuccess = await prisma.publication.create({
      data: {
        contentVariantId: variantSuccess.id,
        socialConnectionId: socialConnFB.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `pub_multi_succ_${Date.now()}`,
      },
    });

    const pubMultiFail = await prisma.publication.create({
      data: {
        contentVariantId: variantFail.id,
        socialConnectionId: socialConnExpired.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `pub_multi_fail_${Date.now()}`,
      },
    });

    const [multiRes1, multiRes2] = await Promise.all([
      processPublicationJob(pubMultiSuccess.id),
      processPublicationJob(pubMultiFail.id),
    ]);

    if (!multiRes1.success || multiRes2.success) {
      throw new Error('Partial platform failure test did not isolate success and failure per variant.');
    }

    const checkSucc = await prisma.publication.findUnique({ where: { id: pubMultiSuccess.id } });
    const checkFail = await prisma.publication.findUnique({ where: { id: pubMultiFail.id } });

    if (checkSucc?.status !== 'PUBLISHED' || checkFail?.status !== 'FAILED') {
      throw new Error('Publication statuses incorrect on partial multi-platform execution.');
    }
    console.log('✅ Partial platform failure isolation test passed.');

    // Clean up test data
    await prisma.publication.deleteMany({
      where: {
        id: {
          in: [
            pubSuccess.id,
            pubConcurrent.id,
            pubExpired.id,
            pubMultiSuccess.id,
            pubMultiFail.id,
          ],
        },
      },
    });
    await prisma.contentVariant.deleteMany({
      where: {
        id: {
          in: [
            variant1.id,
            variant2.id,
            variantExpired.id,
            variantSuccess.id,
            variantFail.id,
          ],
        },
      },
    });
    await prisma.content.deleteMany({
      where: {
        id: {
          in: [
            content1.id,
            content2.id,
            contentExpired.id,
            multiContent.id,
          ],
        },
      },
    });
    await prisma.socialConnection.deleteMany({
      where: { id: { in: [socialConnFB.id, socialConnExpired.id] } },
    });
    await prisma.auditLog.deleteMany({ where: { userId: user.id } });
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.membership.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: org.id } });

    console.log('\n🎉 ALL PUBLISHING LIFECYCLE & RESILIENCE TESTS PASSED SUCCESSFULLY! 🎉');
  } finally {
    await prisma.$disconnect();
  }
}

runPublishingTests().catch((e) => {
  console.error('❌ Publishing tests failed:', e);
  process.exit(1);
});
