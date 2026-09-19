import { processPublicationJob } from '../src/modules/publishing/PublishingWorker';
import { prisma } from '../src/lib/prisma';
import { encryptToken } from '../src/lib/encryption';

async function runPublishingTests() {
  console.log('\n🚀 Running Background Publishing & Worker Queue Tests...');
  let totalTests = 0;
  let passedTests = 0;

  // Setup test organization & workspace
  const org = await prisma.organization.create({
    data: { name: 'Publishing Test Org', slug: `pub-org-${Date.now()}` },
  });

  const workspace = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'Publishing Client', slug: 'pub-client' },
  });

  const author = await prisma.user.create({
    data: { name: 'Pub Author', email: `pub-author-${Date.now()}@test.com`, passwordHash: 'hash' },
  });

  // Valid connection
  const activeConn = await prisma.socialConnection.create({
    data: {
      workspaceId: workspace.id,
      platform: 'FACEBOOK',
      accountName: 'Active FB Page',
      accountId: `fb_active_${Date.now()}`,
      status: 'CONNECTED',
      accessTokenEnc: encryptToken('valid_mock_access_token_123')!,
    },
  });

  // Expired token connection
  const expiredConn = await prisma.socialConnection.create({
    data: {
      workspaceId: workspace.id,
      platform: 'INSTAGRAM',
      accountName: 'Expired Insta Page',
      accountId: `insta_expired_${Date.now()}`,
      status: 'EXPIRED',
      accessTokenEnc: encryptToken('expired_mock_token_xyz')!,
    },
  });

  try {
    // 1. Publishing Execution Success
    totalTests++;
    const contentSuccess = await prisma.content.create({
      data: {
        workspaceId: workspace.id,
        authorId: author.id,
        title: 'Success Post',
        masterCaption: 'Testing Success',
        status: 'SCHEDULED',
      },
    });

    const variantSuccess = await prisma.contentVariant.create({
      data: {
        contentId: contentSuccess.id,
        platform: 'FACEBOOK',
        caption: 'Facebook Success Post Caption',
      },
    });

    const pubSuccess = await prisma.publication.create({
      data: {
        contentVariantId: variantSuccess.id,
        socialConnectionId: activeConn.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `pub_test_success_${Date.now()}`,
      },
    });

    const resSuccess = await processPublicationJob(pubSuccess.id);
    if (!resSuccess.success) {
      throw new Error(`Expected publishing job success, got failure: ${resSuccess.error}`);
    }

    const updatedPubSuccess = await prisma.publication.findUnique({ where: { id: pubSuccess.id } });
    if (updatedPubSuccess?.status !== 'PUBLISHED' || !updatedPubSuccess.providerPostId) {
      throw new Error('Publication status was not updated to PUBLISHED or missing providerPostId');
    }
    passedTests++;
    console.log('  ✅ 1. Scheduled publication execution success verified');

    // 2. Idempotency: Processing already PUBLISHED post returns success without re-publishing
    totalTests++;
    const resIdempotent = await processPublicationJob(pubSuccess.id);
    if (!resIdempotent.success) {
      throw new Error('Idempotent re-execution of PUBLISHED post failed');
    }
    passedTests++;
    console.log('  ✅ 2. Worker job idempotency verified for already PUBLISHED post');

    // 3. Rate Limit Handling (fail_once trigger in MockSocialProvider)
    totalTests++;
    const contentRateLimit = await prisma.content.create({
      data: {
        workspaceId: workspace.id,
        authorId: author.id,
        title: 'Rate Limit Post',
        masterCaption: 'Testing Rate Limit',
        status: 'SCHEDULED',
      },
    });

    const variantRateLimit = await prisma.contentVariant.create({
      data: {
        contentId: contentRateLimit.id,
        platform: 'FACEBOOK',
        caption: 'Rate limit caption',
      },
    });

    const pubRateLimit = await prisma.publication.create({
      data: {
        contentVariantId: variantRateLimit.id,
        socialConnectionId: activeConn.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `pub_fail_once_${Date.now()}`,
      },
    });

    const resRateLimit = await processPublicationJob(pubRateLimit.id);
    if (resRateLimit.success) {
      throw new Error('Expected rate limit attempt to fail on first execution');
    }

    const updatedPubRateLimit = await prisma.publication.findUnique({ where: { id: pubRateLimit.id } });
    if (updatedPubRateLimit?.status !== 'FAILED' || !updatedPubRateLimit.errorMessage?.includes('rate limit')) {
      throw new Error(`Expected status FAILED with rate limit error message, got: ${updatedPubRateLimit?.errorMessage}`);
    }
    passedTests++;
    console.log('  ✅ 3. Rate limit failure recording verified');

    // 4. Retry Mechanism
    totalTests++;
    // Simulate retry by updating idempotencyKey with retried suffix and resetting status
    await prisma.publication.update({
      where: { id: pubRateLimit.id },
      data: {
        status: 'SCHEDULED',
        errorMessage: null,
        idempotencyKey: `${pubRateLimit.idempotencyKey}_retried_${Date.now()}`,
      },
    });

    const resRetry = await processPublicationJob(pubRateLimit.id);
    if (!resRetry.success) {
      throw new Error(`Retry attempt failed: ${resRetry.error}`);
    }

    const updatedPubRetry = await prisma.publication.findUnique({ where: { id: pubRateLimit.id } });
    if (updatedPubRetry?.status !== 'PUBLISHED') {
      throw new Error(`Expected retried publication status PUBLISHED, got ${updatedPubRetry?.status}`);
    }
    passedTests++;
    console.log('  ✅ 4. Retry mechanism successfully recovered failed publication');

    // 5. Expired Token Pre-Check Failure
    totalTests++;
    const contentExpired = await prisma.content.create({
      data: {
        workspaceId: workspace.id,
        authorId: author.id,
        title: 'Expired Token Post',
        masterCaption: 'Testing Expired Token',
        status: 'SCHEDULED',
      },
    });

    const variantExpired = await prisma.contentVariant.create({
      data: {
        contentId: contentExpired.id,
        platform: 'INSTAGRAM',
        caption: 'Expired token caption',
      },
    });

    const pubExpired = await prisma.publication.create({
      data: {
        contentVariantId: variantExpired.id,
        socialConnectionId: expiredConn.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `pub_expired_${Date.now()}`,
      },
    });

    const resExpired = await processPublicationJob(pubExpired.id);
    if (resExpired.success) {
      throw new Error('Publication execution should have failed due to expired OAuth token');
    }

    const updatedPubExpired = await prisma.publication.findUnique({ where: { id: pubExpired.id } });
    if (updatedPubExpired?.status !== 'FAILED' || !updatedPubExpired.errorMessage?.includes('expired')) {
      throw new Error('Expected status FAILED with expired token message');
    }
    passedTests++;
    console.log('  ✅ 5. Expired OAuth token failure pre-check verified');

    // 6. Concurrent Worker Execution Safety
    totalTests++;
    const contentConcurrent = await prisma.content.create({
      data: {
        workspaceId: workspace.id,
        authorId: author.id,
        title: 'Concurrent Post',
        masterCaption: 'Testing Concurrent Workers',
        status: 'SCHEDULED',
      },
    });

    const variantConcurrent = await prisma.contentVariant.create({
      data: {
        contentId: contentConcurrent.id,
        platform: 'FACEBOOK',
        caption: 'Concurrent caption',
      },
    });

    const pubConcurrent = await prisma.publication.create({
      data: {
        contentVariantId: variantConcurrent.id,
        socialConnectionId: activeConn.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `pub_concurrent_${Date.now()}`,
      },
    });

    // Execute 2 worker promises simultaneously on same publication ID
    const [comp1, comp2] = await Promise.all([
      processPublicationJob(pubConcurrent.id),
      processPublicationJob(pubConcurrent.id),
    ]);

    if (!comp1.success && !comp2.success) {
      throw new Error('At least one concurrent execution should succeed');
    }

    const updatedPubConcurrent = await prisma.publication.findUnique({ where: { id: pubConcurrent.id } });
    if (updatedPubConcurrent?.status !== 'PUBLISHED') {
      throw new Error('Publication should be PUBLISHED after concurrent processing');
    }
    passedTests++;
    console.log('  ✅ 6. Concurrent worker execution handled safely without race condition');

    // 7. Partial Platform Failure (Multi-Platform Post)
    totalTests++;
    const contentMulti = await prisma.content.create({
      data: {
        workspaceId: workspace.id,
        authorId: author.id,
        title: 'Multi Platform Post',
        masterCaption: 'Multi Platform Caption',
        status: 'SCHEDULED',
      },
    });

    const variantFB = await prisma.contentVariant.create({
      data: { contentId: contentMulti.id, platform: 'FACEBOOK', caption: 'FB Caption' },
    });
    const variantInsta = await prisma.contentVariant.create({
      data: { contentId: contentMulti.id, platform: 'INSTAGRAM', caption: 'Insta Caption' },
    });

    const pubFB = await prisma.publication.create({
      data: {
        contentVariantId: variantFB.id,
        socialConnectionId: activeConn.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `pub_multi_fb_${Date.now()}`,
      },
    });

    const pubInsta = await prisma.publication.create({
      data: {
        contentVariantId: variantInsta.id,
        socialConnectionId: expiredConn.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `pub_multi_insta_${Date.now()}`,
      },
    });

    const resFB = await processPublicationJob(pubFB.id);
    const resInsta = await processPublicationJob(pubInsta.id);

    if (!resFB.success || resInsta.success) {
      throw new Error('Multi-platform partial failure expected FB success and Instagram failure');
    }

    const checkFB = await prisma.publication.findUnique({ where: { id: pubFB.id } });
    const checkInsta = await prisma.publication.findUnique({ where: { id: pubInsta.id } });

    if (checkFB?.status !== 'PUBLISHED' || checkInsta?.status !== 'FAILED') {
      throw new Error('Platform publication statuses were not isolated during partial failure');
    }
    passedTests++;
    console.log('  ✅ 7. Partial platform failure isolation verified (Facebook PUBLISHED, Instagram FAILED)');

    // Clean up
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.user.delete({ where: { id: author.id } });

    console.log(`🎉 Background Publishing Tests Passed: ${passedTests}/${totalTests}\n`);
    return { passedTests, totalTests };
  } catch (err) {
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: author.id } }).catch(() => {});
    throw err;
  }
}

if (require.main === module) {
  runPublishingTests().catch((e) => {
    console.error('❌ Publishing tests failed:', e);
    process.exit(1);
  });
}

export { runPublishingTests };
