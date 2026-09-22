import { prisma } from '../src/lib/prisma';

async function runIntegrityTests() {
  console.log('🧪 Starting Data Integrity & Relational Constraint Tests...\n');

  let org: any;
  let user: any;
  let ws: any;

  try {
    org = await prisma.organization.create({
      data: { name: 'Integrity Test Org', slug: `integrity-org-${Date.now()}` },
    });

    user = await prisma.user.create({
      data: { email: `integrity_${Date.now()}@test.com`, name: 'Integrity User', passwordHash: 'hash' },
    });

    ws = await prisma.workspace.create({
      data: { organizationId: org.id, name: 'Integrity Workspace', slug: `integrity-ws-${Date.now()}` },
    });

    // -------------------------------------------------------------
    // TEST 1: Unique Constraint - Duplicate Content Variants
    // -------------------------------------------------------------
    console.log('1. Testing Unique Constraint on [contentId, platform]...');
    const content = await prisma.content.create({
      data: {
        workspaceId: ws.id,
        authorId: user.id,
        title: 'Integrity Test Content',
        masterCaption: 'Testing constraints',
      },
    });

    await prisma.contentVariant.create({
      data: { contentId: content.id, platform: 'FACEBOOK', caption: 'FB Caption' },
    });

    let duplicateVariantFailed = false;
    try {
      await prisma.contentVariant.create({
        data: { contentId: content.id, platform: 'FACEBOOK', caption: 'Duplicate FB Caption' },
      });
    } catch (err: any) {
      duplicateVariantFailed = true;
    }
    if (!duplicateVariantFailed) {
      throw new Error('Database allowed creating duplicate ContentVariant for same contentId + platform!');
    }
    console.log('  ✅ Duplicate ContentVariant unique constraint [contentId, platform] enforced.');

    // -------------------------------------------------------------
    // TEST 2: Unique Constraint - Duplicate Idempotency Key
    // -------------------------------------------------------------
    console.log('2. Testing Unique Constraint on Publication.idempotencyKey...');
    const socialConn = await prisma.socialConnection.create({
      data: {
        workspaceId: ws.id,
        platform: 'FACEBOOK',
        accountName: 'Integrity FB Page',
        accountId: `acc_int_${Date.now()}`,
        status: 'CONNECTED',
        accessTokenEnc: 'enc_token',
      },
    });

    const variant = await prisma.contentVariant.findFirst({ where: { contentId: content.id } });
    const sharedIdempotencyKey = `idempotency_unique_key_${Date.now()}`;

    await prisma.publication.create({
      data: {
        contentVariantId: variant!.id,
        socialConnectionId: socialConn.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: sharedIdempotencyKey,
      },
    });

    let duplicateIdempotencyFailed = false;
    try {
      await prisma.publication.create({
        data: {
          contentVariantId: variant!.id,
          socialConnectionId: socialConn.id,
          scheduledAt: new Date(),
          status: 'SCHEDULED',
          idempotencyKey: sharedIdempotencyKey,
        },
      });
    } catch (err: any) {
      duplicateIdempotencyFailed = true;
    }
    if (!duplicateIdempotencyFailed) {
      throw new Error('Database allowed creating duplicate Publication idempotencyKey!');
    }
    console.log('  ✅ Duplicate Publication.idempotencyKey unique constraint enforced.');

    // -------------------------------------------------------------
    // TEST 3: Deletion Cascades & AuditLog Set Null
    // -------------------------------------------------------------
    console.log('3. Testing Cascade Deletion Behaviors...');

    const mediaAsset = await prisma.mediaAsset.create({
      data: {
        workspaceId: ws.id,
        fileName: 'test.png',
        fileSize: 500,
        mimeType: 'image/png',
        storageKey: 'key/test.png',
        publicUrl: 'https://example.com/test.png',
      },
    });

    const auditLog = await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        workspaceId: ws.id,
        userId: user.id,
        action: 'TEST_ACTION',
        entityType: 'Workspace',
      },
    });

    // Delete workspace and verify cascading behavior
    await prisma.workspace.delete({ where: { id: ws.id } });

    // Verify socialConnection, content, mediaAsset deleted
    const deletedConn = await prisma.socialConnection.findUnique({ where: { id: socialConn.id } });
    const deletedContent = await prisma.content.findUnique({ where: { id: content.id } });
    const deletedMedia = await prisma.mediaAsset.findUnique({ where: { id: mediaAsset.id } });

    if (deletedConn || deletedContent || deletedMedia) {
      throw new Error('Workspace cascade deletion failed to remove child records.');
    }

    // Verify AuditLog workspaceId was set to null rather than deleting audit history
    const updatedAuditLog = await prisma.auditLog.findUnique({ where: { id: auditLog.id } });
    if (!updatedAuditLog || updatedAuditLog.workspaceId !== null) {
      throw new Error('AuditLog workspaceId was not set to null on workspace deletion.');
    }
    console.log('  ✅ Cascade deletion and AuditLog nullification verified successfully.');

    console.log('\n🎉 ALL DATA INTEGRITY TESTS PASSED SUCCESSFULLY!');
  } finally {
    if (org) {
      await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
      await prisma.organization.deleteMany({ where: { id: org.id } });
    }
    if (user) await prisma.user.deleteMany({ where: { id: user.id } });

    await prisma.$disconnect();
  }
}

runIntegrityTests().catch((err) => {
  console.error('❌ Data integrity unit test failed:', err);
  process.exit(1);
});
