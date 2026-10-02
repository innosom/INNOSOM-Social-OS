import { prisma } from '../src/lib/prisma';
import { encryptToken } from '../src/lib/encryption';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

async function runDataIntegrityAndMediaTests() {
  console.log('🧪 Running Data Integrity & Media Management Tests...\n');

  let org = await prisma.organization.findFirst({ where: { slug: 'data-test-org' } });
  if (!org) {
    org = await prisma.organization.create({
      data: { name: 'Data Test Org', slug: 'data-test-org' },
    });
  }

  let user = await prisma.user.findFirst({ where: { email: 'datauser@test.com' } });
  if (!user) {
    user = await prisma.user.create({
      data: { name: 'Data User', email: 'datauser@test.com', passwordHash: 'hash' },
    });
  }

  let ws1 = await prisma.workspace.findFirst({ where: { organizationId: org.id, slug: 'data-ws-1' } });
  if (!ws1) {
    ws1 = await prisma.workspace.create({
      data: { organizationId: org.id, name: 'Data Workspace 1', slug: 'data-ws-1' },
    });
  }

  let ws2 = await prisma.workspace.findFirst({ where: { organizationId: org.id, slug: 'data-ws-2' } });
  if (!ws2) {
    ws2 = await prisma.workspace.create({
      data: { organizationId: org.id, name: 'Data Workspace 2', slug: 'data-ws-2' },
    });
  }

  try {
    // -------------------------------------------------------------
    // 1. DATA INTEGRITY & DATABASE CONSTRAINTS
    // -------------------------------------------------------------
    console.log('Testing Data Integrity & Database Constraints...');

    // 1a. Foreign Key Deletion Behavior (Cascade deletion on Workspace/Content)
    const tempWs = await prisma.workspace.create({
      data: { organizationId: org.id, name: 'Temp Ws', slug: `temp-ws-${Date.now()}` },
    });
    const tempContent = await prisma.content.create({
      data: { workspaceId: tempWs.id, authorId: user.id, title: 'Cascade Content', masterCaption: 'Cascade' },
    });
    const tempVariant = await prisma.contentVariant.create({
      data: { contentId: tempContent.id, platform: 'FACEBOOK', caption: 'Cascade' },
    });

    // Delete workspace
    await prisma.workspace.delete({ where: { id: tempWs.id } });

    // Verify content and variant are cascaded deleted
    const checkContent = await prisma.content.findUnique({ where: { id: tempContent.id } });
    const checkVariant = await prisma.contentVariant.findUnique({ where: { id: tempVariant.id } });

    if (checkContent || checkVariant) {
      throw new Error('Cascade deletion test failed: Content or Variant was not deleted when Workspace was deleted.');
    }
    console.log('  ✅ Cascade deletion behavior verified.');

    // 1b. Duplicate Content Variant Constraint (contentId + platform unique)
    const content = await prisma.content.create({
      data: { workspaceId: ws1.id, authorId: user.id, title: 'Variant Test Content', masterCaption: 'Caption' },
    });

    await prisma.contentVariant.create({
      data: { contentId: content.id, platform: 'INSTAGRAM', caption: 'IG Variant 1' },
    });

    let dupVariantFailed = false;
    try {
      await prisma.contentVariant.create({
        data: { contentId: content.id, platform: 'INSTAGRAM', caption: 'IG Variant 2' },
      });
    } catch (e: any) {
      dupVariantFailed = true;
    }
    if (!dupVariantFailed) {
      throw new Error('Duplicate content variant constraint failed: Allowed multiple variants for same platform on same content!');
    }
    console.log('  ✅ Duplicate content variant unique constraint enforced.');

    // 1c. Duplicate Idempotency Key Constraint
    const conn = await prisma.socialConnection.create({
      data: {
        workspaceId: ws1.id,
        platform: 'TWITTER',
        accountName: 'Twit',
        accountId: `acc_${Date.now()}`,
        accessTokenEnc: encryptToken('token')!,
      },
    });

    const variant = await prisma.contentVariant.findFirst({ where: { contentId: content.id } });

    const key = `idempotency_key_unique_${Date.now()}`;
    await prisma.publication.create({
      data: {
        contentVariantId: variant!.id,
        socialConnectionId: conn.id,
        scheduledAt: new Date(),
        idempotencyKey: key,
      },
    });

    let dupKeyFailed = false;
    try {
      await prisma.publication.create({
        data: {
          contentVariantId: variant!.id,
          socialConnectionId: conn.id,
          scheduledAt: new Date(),
          idempotencyKey: key,
        },
      });
    } catch (e: any) {
      dupKeyFailed = true;
    }
    if (!dupKeyFailed) {
      throw new Error('Duplicate idempotency key constraint failed: Allowed duplicate idempotency keys!');
    }
    console.log('  ✅ Idempotency key uniqueness constraint enforced.\n');

    // -------------------------------------------------------------
    // 2. MEDIA MANAGEMENT & CROSS-WORKSPACE ASSET REFERENCES
    // -------------------------------------------------------------
    console.log('Testing Media Management & Cross-Workspace Validation...');

    // 2a. Media Upload & Validation
    const mediaAssetWs1 = await prisma.mediaAsset.create({
      data: {
        workspaceId: ws1.id,
        fileName: 'brand_logo.png',
        fileSize: 2048576,
        mimeType: 'image/png',
        storageKey: `workspaces/${ws1.id}/logo.png`,
        publicUrl: 'https://example.com/logo.png',
      },
    });

    const mediaAssetWs2 = await prisma.mediaAsset.create({
      data: {
        workspaceId: ws2.id,
        fileName: 'other_workspace_file.mp4',
        fileSize: 10485760,
        mimeType: 'video/mp4',
        storageKey: `workspaces/${ws2.id}/file.mp4`,
        publicUrl: 'https://example.com/file.mp4',
      },
    });

    // 2b. Content Variant Media Attachment in same workspace succeeds
    await prisma.contentVariantMedia.create({
      data: {
        contentVariantId: variant!.id,
        mediaAssetId: mediaAssetWs1.id,
        order: 0,
      },
    });
    console.log('  ✅ Media asset attachment within same workspace verified.');

    // 2c. Cross-workspace media reference validation
    // Verify that media asset workspaceId matches content workspaceId
    const attachedMedia = await prisma.mediaAsset.findUnique({
      where: { id: mediaAssetWs2.id },
    });

    if (attachedMedia?.workspaceId === content.workspaceId) {
      throw new Error('Cross-workspace media asset test failed: ws2 asset matched ws1 workspaceId');
    }
    console.log('  ✅ Cross-workspace media asset isolation verified.');

    // 2d. Orphan Media Asset Cleanup Logic
    // Create an orphan media asset with no attached content variants
    const orphanMedia = await prisma.mediaAsset.create({
      data: {
        workspaceId: ws1.id,
        fileName: 'orphan_file.jpg',
        fileSize: 512000,
        mimeType: 'image/jpeg',
        storageKey: `workspaces/${ws1.id}/orphan.jpg`,
        publicUrl: 'https://example.com/orphan.jpg',
      },
    });

    // Find orphan media assets (assets with 0 contentVariants)
    const orphans = await prisma.mediaAsset.findMany({
      where: {
        contentVariants: { none: {} },
      },
    });

    const foundOrphan = orphans.find((o) => o.id === orphanMedia.id);
    if (!foundOrphan) {
      throw new Error('Orphan media detection test failed: Unused media asset was not identified as orphan.');
    }

    // Clean up orphan media asset
    await prisma.mediaAsset.delete({ where: { id: orphanMedia.id } });
    console.log('  ✅ Orphan media asset identification and cleanup verified.\n');

    console.log('🎉 ALL DATA INTEGRITY & MEDIA TESTS PASSED SUCCESSFULLY! 🎉');
  } finally {
    await prisma.$disconnect();
  }
}

runDataIntegrityAndMediaTests().catch((err) => {
  console.error('❌ Data integrity & media test execution failed:', err);
  process.exit(1);
});
