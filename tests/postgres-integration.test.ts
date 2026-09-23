import { prisma } from '../src/lib/prisma';
import bcrypt from 'bcryptjs';
import { validateWorkspaceAccess, signSessionToken, verifySessionToken } from '../src/lib/auth';
import { processPublicationJob } from '../src/modules/publishing/PublishingWorker';

async function runPostgresIntegrationTests() {
  console.log('🚀 Running Comprehensive PostgreSQL Integration Verification Suite...');

  // 1. Schema & Connection Check
  console.log('1️⃣  Testing Database Schema & Connection...');
  const orgCount = await prisma.organization.count();
  console.log(`   Found ${orgCount} organization(s).`);

  // 2. Seed Data Check
  console.log('2️⃣  Testing Seed Data Integrity...');
  const userAdmin = await prisma.user.findUnique({ where: { email: 'admin@innosom.com' } });
  if (!userAdmin) throw new Error('Seed test failed: Admin user missing');

  const workspace = await prisma.workspace.findFirst();
  if (!workspace) throw new Error('Seed test failed: Workspace missing');
  console.log(`   Seed verified. Workspace: ${workspace.name} (${workspace.id})`);

  // 3. Authentication
  console.log('3️⃣  Testing Authentication & Passwords...');
  const isMatch = await bcrypt.compare('Password123!', userAdmin.passwordHash);
  if (!isMatch) throw new Error('Authentication test failed: Password hash mismatch');

  const sessionPayload = {
    userId: userAdmin.id,
    email: userAdmin.email,
    name: userAdmin.name,
    organizationId: workspace.organizationId,
    role: 'ADMIN',
  };
  const token = await signSessionToken(sessionPayload);
  const verifiedSession = await verifySessionToken(token);
  if (!verifiedSession || verifiedSession.userId !== userAdmin.id) {
    throw new Error('Authentication test failed: JWT token verification failed');
  }
  console.log('   Authentication passed successfully.');

  // 4. Workspace Switching & Access Validation
  console.log('4️⃣  Testing Workspace Switching & Access Control...');
  const accessCheck = await validateWorkspaceAccess(verifiedSession, workspace.id, prisma);
  if (!accessCheck.hasAccess || !accessCheck.workspace) {
    throw new Error('Workspace switching test failed: Access denied for valid workspace');
  }
  const invalidAccessCheck = await validateWorkspaceAccess(verifiedSession, 'invalid-ws-id', prisma);
  if (invalidAccessCheck.hasAccess) {
    throw new Error('Workspace switching test failed: Invalid workspace allowed access');
  }
  console.log('   Workspace switching passed successfully.');

  // 5. Content Creation
  console.log('5️⃣  Testing Content Creation...');
  const newContent = await prisma.content.create({
    data: {
      workspaceId: workspace.id,
      authorId: userAdmin.id,
      title: 'PostgreSQL Verification Post',
      masterCaption: 'Testing PostgreSQL multi-tenant publishing pipeline.',
      status: 'DRAFT',
    },
  });

  const variant = await prisma.contentVariant.create({
    data: {
      contentId: newContent.id,
      platform: 'FACEBOOK',
      caption: 'Testing PostgreSQL multi-tenant publishing pipeline on Facebook.',
      hashtags: JSON.stringify(['#PostgreSQL', '#INNOSOM']),
    },
  });
  console.log(`   Content created successfully. Content ID: ${newContent.id}`);

  // 6. Media Management
  console.log('6️⃣  Testing Media Management...');
  const mediaAsset = await prisma.mediaAsset.create({
    data: {
      workspaceId: workspace.id,
      fileName: 'test-postgres-asset.png',
      fileSize: 2048576,
      mimeType: 'image/png',
      storageKey: `media/${workspace.id}/test-postgres-asset.png`,
      publicUrl: 'https://example.com/test-asset.png',
      width: 1080,
      height: 1080,
      folderPath: '/PostgreSQL Tests',
    },
  });

  await prisma.contentVariantMedia.create({
    data: {
      contentVariantId: variant.id,
      mediaAssetId: mediaAsset.id,
      order: 0,
    },
  });

  const fetchedMedia = await prisma.mediaAsset.findMany({
    where: { workspaceId: workspace.id },
  });
  if (!fetchedMedia.some((m) => m.id === mediaAsset.id)) {
    throw new Error('Media management test failed: Created asset not found');
  }
  console.log('   Media management passed successfully.');

  // 7. Approvals Flow
  console.log('7️⃣  Testing Approvals Flow...');
  const approval = await prisma.approval.create({
    data: {
      contentId: newContent.id,
      userId: userAdmin.id,
      status: 'APPROVED',
      comment: 'Approved for scheduled publication.',
    },
  });

  await prisma.content.update({
    where: { id: newContent.id },
    data: { status: 'APPROVED' },
  });
  console.log('   Approvals flow passed successfully.');

  // 8. Scheduling
  console.log('8️⃣  Testing Scheduling...');
  const connection = await prisma.socialConnection.findFirst({
    where: { workspaceId: workspace.id, platform: 'FACEBOOK' },
  });
  if (!connection) throw new Error('Scheduling test failed: Social connection missing');

  const publication = await prisma.publication.create({
    data: {
      contentVariantId: variant.id,
      socialConnectionId: connection.id,
      scheduledAt: new Date(Date.now() + 60000),
      status: 'SCHEDULED',
      idempotencyKey: `pg_test_pub_${Date.now()}`,
    },
  });
  console.log(`   Publication scheduled successfully. ID: ${publication.id}`);

  // 9. Async Publishing & Idempotency Execution
  console.log('9️⃣  Testing Async Publishing & Idempotency...');
  const pubResult = await processPublicationJob(publication.id);
  if (!pubResult.success) throw new Error(`Publishing failed: ${pubResult.error}`);

  const updatedPub = await prisma.publication.findUnique({
    where: { id: publication.id },
  });
  if (updatedPub?.status !== 'PUBLISHED') {
    throw new Error(`Publishing test failed: Expected status PUBLISHED, got ${updatedPub?.status}`);
  }

  // Test Idempotency (re-running processPublicationJob on already PUBLISHED post)
  const rerunResult = await processPublicationJob(publication.id);
  if (!rerunResult.success) {
    throw new Error('Idempotency test failed: Re-executing published job failed');
  }
  console.log('   Async publishing & idempotency passed successfully.');

  // 10. Analytics
  console.log('🔟 Testing Analytics...');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await prisma.analyticsSnapshot.upsert({
    where: {
      workspaceId_platform_date: {
        workspaceId: workspace.id,
        platform: 'FACEBOOK',
        date: today,
      },
    },
    update: { impressions: 1500, reach: 1100, likes: 220 },
    create: {
      workspaceId: workspace.id,
      platform: 'FACEBOOK',
      date: today,
      impressions: 1500,
      reach: 1100,
      likes: 220,
    },
  });

  const analytics = await prisma.analyticsSnapshot.findMany({
    where: { workspaceId: workspace.id },
  });
  if (analytics.length === 0) throw new Error('Analytics test failed: No snapshot records found');
  console.log('   Analytics snapshot queries passed successfully.');

  // 11. Audit Logging
  console.log('1️⃣1️⃣ Testing Audit Logging & Scalability Queries...');
  const auditLog = await prisma.auditLog.create({
    data: {
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      userId: userAdmin.id,
      action: 'PG_INTEGRATION_TEST_EXECUTED',
      entityType: 'Publication',
      entityId: publication.id,
      details: JSON.stringify({ status: 'PUBLISHED', testRunner: 'Jules' }),
    },
  });

  const auditLogs = await prisma.auditLog.findMany({
    where: { organizationId: workspace.organizationId },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  if (!auditLogs.some((l) => l.id === auditLog.id)) {
    throw new Error('Audit log test failed: Created audit record not found');
  }
  console.log('   Audit logging passed successfully.');

  console.log('\n✨ ALL POSTGRESQL INTEGRATION TESTS PASSED SUCCESSFULLY! ✨');
}

runPostgresIntegrationTests()
  .catch((e) => {
    console.error('❌ PostgreSQL Integration Test Suite Failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
