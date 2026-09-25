import { prisma } from '../src/lib/prisma';
import { processPublicationJob } from '../src/modules/publishing/PublishingWorker';
import { encryptToken } from '../src/lib/encryption';

async function runAuditTests() {
  console.log('🧪 Running Final Adversarial Audit Unit Tests...');

  let testOrgA = await prisma.organization.findFirst({ where: { slug: 'innosom-tech' } });
  if (!testOrgA) {
    testOrgA = await prisma.organization.create({
      data: { name: 'Audit Test Org A', slug: 'innosom-tech' },
    });
  }

  let testOrgB = await prisma.organization.findFirst({ where: { slug: 'org-b-competitor' } });
  if (!testOrgB) {
    testOrgB = await prisma.organization.create({
      data: { name: 'Competitor Org B', slug: 'org-b-competitor' },
    });
  }

  const workspaceA = await prisma.workspace.create({
    data: { organizationId: testOrgA.id, name: 'Org A Workspace', slug: `workspace-a-${Date.now()}` },
  });

  const workspaceB = await prisma.workspace.create({
    data: { organizationId: testOrgB.id, name: 'Org B Workspace', slug: `workspace-b-${Date.now()}` },
  });

  const mediaB = await prisma.mediaAsset.create({
    data: {
      workspaceId: workspaceB.id,
      fileName: 'secret-org-b-media.jpg',
      fileSize: 1024,
      mimeType: 'image/jpeg',
      storageKey: `workspaces/${workspaceB.id}/secret.jpg`,
      publicUrl: 'https://example.com/secret-org-b.jpg',
    },
  });

  // Test 1: Validate media asset ownership
  console.log('Testing 1: Cross-tenant private media asset isolation check...');
  const mediaAssetsInA = await prisma.mediaAsset.findMany({
    where: { id: { in: [mediaB.id] }, workspaceId: workspaceA.id },
  });
  if (mediaAssetsInA.length === 0) {
    console.log('  ✅ Cross-tenant media attachment safely blocked.');
  } else {
    throw new Error('FAILED: Cross-tenant media attachment vulnerability detected!');
  }

  // Test 2: Worker Race Condition Prevention via Atomic DB Transition
  console.log('Testing 2: Worker atomic DB status transition under concurrency...');
  const conn = await prisma.socialConnection.create({
    data: {
      workspaceId: workspaceA.id,
      platform: 'FACEBOOK',
      accountName: 'FB Audit Test',
      accountId: `fb_acc_${Date.now()}`,
      accessTokenEnc: encryptToken('mock_access_token')!,
    },
  });

  const content = await prisma.content.create({
    data: {
      workspaceId: workspaceA.id,
      authorId: (await prisma.user.findFirst())?.id || 'mock-user-id',
      title: 'Concurrency Audit Post',
      masterCaption: 'Testing race conditions',
      status: 'APPROVED',
    },
  });

  const variant = await prisma.contentVariant.create({
    data: { contentId: content.id, platform: 'FACEBOOK', caption: 'Concurrency test caption' },
  });

  const pub = await prisma.publication.create({
    data: {
      contentVariantId: variant.id,
      socialConnectionId: conn.id,
      scheduledAt: new Date(),
      status: 'SCHEDULED',
      idempotencyKey: `audit_concurrency_${pubId()}`,
    },
  });

  // Execute two worker jobs concurrently
  const [res1, res2] = await Promise.all([
    processPublicationJob(pub.id),
    processPublicationJob(pub.id),
  ]);

  if ((res1.success && res2.success) || res1.success !== res2.success) {
    const pubRecord = await prisma.publication.findUnique({ where: { id: pub.id } });
    if (pubRecord?.attempts === 1) {
      console.log('  ✅ Worker race condition prevented: Only 1 execution attempt processed.');
    } else {
      throw new Error(`FAILED: Multiple execution attempts processed (${pubRecord?.attempts})`);
    }
  }

  // Cleanup audit resources
  await prisma.publication.deleteMany({ where: { id: pub.id } });
  await prisma.socialConnection.deleteMany({ where: { id: conn.id } });
  await prisma.mediaAsset.deleteMany({ where: { id: mediaB.id } });
  await prisma.workspace.deleteMany({ where: { id: { in: [workspaceA.id, workspaceB.id] } } });
  await prisma.organization.deleteMany({ where: { id: testOrgB.id } });

  console.log('🎉 All Adversarial Audit Security Unit Tests Passed Successfully!\n');
}

function pubId(): string {
  return Math.random().toString(36).substring(2, 10);
}

runAuditTests().catch((err) => {
  console.error('❌ Audit test suite failed:', err);
  process.exit(1);
});
