import { prisma } from '../src/lib/prisma';
import { encryptToken } from '../src/lib/encryption';

async function runDataIntegrityTests() {
  console.log('\n🗄️ Running Data Integrity & Foreign Key Constraint Tests...');
  let totalTests = 0;
  let passedTests = 0;

  try {
    // 1. Cascade Deletion: Deleting Workspace deletes associated SocialConnections, Contents, MediaAssets, AnalyticsSnapshots
    totalTests++;
    const org1 = await prisma.organization.create({
      data: { name: 'Cascade Org', slug: `cascade-org-${Date.now()}` },
    });

    const ws1 = await prisma.workspace.create({
      data: { organizationId: org1.id, name: 'Cascade Workspace', slug: 'cascade-ws' },
    });

    const user1 = await prisma.user.create({
      data: { name: 'Cascade User', email: `cascade-user-${Date.now()}@test.com`, passwordHash: 'hash' },
    });

    const conn = await prisma.socialConnection.create({
      data: {
        workspaceId: ws1.id,
        platform: 'FACEBOOK',
        accountName: 'FB Page',
        accountId: `acc_${Date.now()}`,
        accessTokenEnc: encryptToken('enc_token')!,
      },
    });

    const content = await prisma.content.create({
      data: {
        workspaceId: ws1.id,
        authorId: user1.id,
        title: 'Cascade Content',
        masterCaption: 'Caption',
      },
    });

    const media = await prisma.mediaAsset.create({
      data: {
        workspaceId: ws1.id,
        fileName: 'test.jpg',
        fileSize: 100,
        mimeType: 'image/jpeg',
        storageKey: 'key',
        publicUrl: 'http://url',
      },
    });

    const analytics = await prisma.analyticsSnapshot.create({
      data: {
        workspaceId: ws1.id,
        platform: 'FACEBOOK',
        date: new Date('2025-01-01'),
        impressions: 500,
      },
    });

    // Delete Workspace
    await prisma.workspace.delete({ where: { id: ws1.id } });

    // Verify all related entities were deleted via cascade
    const checkConn = await prisma.socialConnection.findUnique({ where: { id: conn.id } });
    const checkContent = await prisma.content.findUnique({ where: { id: content.id } });
    const checkMedia = await prisma.mediaAsset.findUnique({ where: { id: media.id } });
    const checkAnalytics = await prisma.analyticsSnapshot.findUnique({ where: { id: analytics.id } });

    if (checkConn !== null || checkContent !== null || checkMedia !== null || checkAnalytics !== null) {
      throw new Error('Workspace cascade deletion failed to remove dependent records');
    }
    passedTests++;
    console.log('  ✅ 1. Workspace cascade deletion behavior verified');

    // 2. Cascade Deletion: Deleting Content deletes associated ContentVariants and Approvals
    totalTests++;
    const ws2 = await prisma.workspace.create({
      data: { organizationId: org1.id, name: 'Cascade Workspace 2', slug: 'cascade-ws-2' },
    });

    const content2 = await prisma.content.create({
      data: {
        workspaceId: ws2.id,
        authorId: user1.id,
        title: 'Cascade Content 2',
        masterCaption: 'Caption 2',
      },
    });

    const variant2 = await prisma.contentVariant.create({
      data: {
        contentId: content2.id,
        platform: 'INSTAGRAM',
        caption: 'Insta Caption',
      },
    });

    const approval2 = await prisma.approval.create({
      data: {
        contentId: content2.id,
        userId: user1.id,
        status: 'APPROVED',
      },
    });

    await prisma.content.delete({ where: { id: content2.id } });

    const checkVariant2 = await prisma.contentVariant.findUnique({ where: { id: variant2.id } });
    const checkApproval2 = await prisma.approval.findUnique({ where: { id: approval2.id } });

    if (checkVariant2 !== null || checkApproval2 !== null) {
      throw new Error('Content cascade deletion failed to remove variants or approvals');
    }
    passedTests++;
    console.log('  ✅ 2. Content cascade deletion behavior verified');

    // 3. Unique Constraint: Duplicate ContentVariant on same platform
    totalTests++;
    const content3 = await prisma.content.create({
      data: {
        workspaceId: ws2.id,
        authorId: user1.id,
        title: 'Unique Variant Post',
        masterCaption: 'Master Caption',
      },
    });

    await prisma.contentVariant.create({
      data: { contentId: content3.id, platform: 'FACEBOOK', caption: 'FB 1' },
    });

    let duplicateVariantFailed = false;
    try {
      await prisma.contentVariant.create({
        data: { contentId: content3.id, platform: 'FACEBOOK', caption: 'FB 2' },
      });
    } catch (e: any) {
      duplicateVariantFailed = true;
    }

    if (!duplicateVariantFailed) {
      throw new Error('Duplicate ContentVariant for same platform should have violated unique constraint');
    }
    passedTests++;
    console.log('  ✅ 3. Duplicate ContentVariant unique constraint (@@unique([contentId, platform])) verified');

    // 4. Unique Constraint: Duplicate Idempotency Key in Publication
    totalTests++;
    const content4 = await prisma.content.create({
      data: {
        workspaceId: ws2.id,
        authorId: user1.id,
        title: 'Unique Idempotency Key Post',
        masterCaption: 'Master Caption',
      },
    });

    const conn2 = await prisma.socialConnection.create({
      data: {
        workspaceId: ws2.id,
        platform: 'FACEBOOK',
        accountName: 'FB Page 2',
        accountId: `acc2_${Date.now()}`,
        accessTokenEnc: encryptToken('enc_token')!,
      },
    });

    const variant3 = await prisma.contentVariant.create({
      data: { contentId: content4.id, platform: 'FACEBOOK', caption: 'FB 1' },
    });

    const dupKey = `unique_idempotency_key_${Date.now()}`;
    await prisma.publication.create({
      data: {
        contentVariantId: variant3.id,
        socialConnectionId: conn2.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: dupKey,
      },
    });

    let duplicateKeyFailed = false;
    try {
      await prisma.publication.create({
        data: {
          contentVariantId: variant3.id,
          socialConnectionId: conn2.id,
          scheduledAt: new Date(),
          status: 'SCHEDULED',
          idempotencyKey: dupKey,
        },
      });
    } catch (e: any) {
      duplicateKeyFailed = true;
    }

    if (!duplicateKeyFailed) {
      throw new Error('Duplicate idempotencyKey should have violated unique constraint');
    }
    passedTests++;
    console.log('  ✅ 4. Duplicate idempotencyKey unique constraint (@unique) verified');

    // Clean up
    await prisma.organization.delete({ where: { id: org1.id } });
    await prisma.user.delete({ where: { id: user1.id } });

    console.log(`🎉 Data Integrity & Constraint Tests Passed: ${passedTests}/${totalTests}\n`);
    return { passedTests, totalTests };
  } catch (err) {
    throw err;
  }
}

if (require.main === module) {
  runDataIntegrityTests().catch((e) => {
    console.error('❌ Data Integrity tests failed:', e);
    process.exit(1);
  });
}

export { runDataIntegrityTests };
