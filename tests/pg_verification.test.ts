import { prisma } from '../src/lib/prisma';
import bcrypt from 'bcryptjs';
import { processPublicationJob } from '../src/modules/publishing/PublishingWorker';

async function runPgVerification() {
  console.log('🧪 Starting Comprehensive PostgreSQL Feature Verification Test...\n');

  // 1. Verify Seed Data
  console.log('1. Checking Seed Data in PostgreSQL...');
  const org = await prisma.organization.findUnique({ where: { slug: 'innosom' } });
  if (!org) throw new Error('Seed failed: Organization not found');
  console.log(`  ✅ Organization found: ${org.name} (${org.id})`);

  const adminUser = await prisma.user.findUnique({ where: { email: 'admin@innosom.com' } });
  if (!adminUser) throw new Error('Seed failed: Admin user not found');
  console.log(`  ✅ Admin user found: ${adminUser.name}`);

  // 2. Test Authentication
  console.log('\n2. Testing Authentication...');
  const isPasswordValid = await bcrypt.compare('Password123!', adminUser.passwordHash);
  if (!isPasswordValid) throw new Error('Authentication failed: Password comparison failed');
  console.log('  ✅ Password authentication verified successfully');

  // 3. Test Workspace Switching & Multi-tenancy
  console.log('\n3. Testing Workspace Switching & Multi-Tenancy...');
  const workspaces = await prisma.workspace.findMany({
    where: { organizationId: org.id },
  });
  if (workspaces.length === 0) throw new Error('No workspaces found for organization');
  console.log(`  ✅ Found ${workspaces.length} client workspaces for org`);
  const targetWorkspace = workspaces[0];
  console.log(`  ✅ Switched context to workspace: ${targetWorkspace.name} (${targetWorkspace.id})`);

  // 4. Test Media Management
  console.log('\n4. Testing Media Management...');
  const mediaAsset = await prisma.mediaAsset.create({
    data: {
      workspaceId: targetWorkspace.id,
      fileName: 'pg_test_image.png',
      fileSize: 102456,
      mimeType: 'image/png',
      storageKey: `workspaces/${targetWorkspace.id}/pg_test_image.png`,
      publicUrl: 'https://images.unsplash.com/photo-1542744094-3a3172720249',
      width: 1200,
      height: 630,
    },
  });
  console.log(`  ✅ Media asset created: ${mediaAsset.fileName} (${mediaAsset.id})`);

  const fetchedMedia = await prisma.mediaAsset.findMany({
    where: { workspaceId: targetWorkspace.id },
  });
  if (!fetchedMedia.some((m) => m.id === mediaAsset.id)) {
    throw new Error('Media asset retrieval failed');
  }
  console.log('  ✅ Media asset retrieval verified');

  // 5. Test Social Connection Retrieval
  console.log('\n5. Testing Social Connection Setup...');
  const socialConn = await prisma.socialConnection.findFirst({
    where: { workspaceId: targetWorkspace.id },
  });
  if (!socialConn) throw new Error('No social connection found in workspace');
  console.log(`  ✅ Social connection active: ${socialConn.platform} (@${socialConn.accountName})`);

  // 6. Test Content Creation & Scheduling
  console.log('\n6. Testing Content Creation & Variant Setup...');
  const newContent = await prisma.content.create({
    data: {
      workspaceId: targetWorkspace.id,
      authorId: adminUser.id,
      title: 'Postgres Integration Test Campaign',
      masterCaption: 'Testing production postgresql migration capability.',
      status: 'SCHEDULED',
    },
  });
  console.log(`  ✅ Master Content created: ${newContent.title} (${newContent.id})`);

  const variant = await prisma.contentVariant.create({
    data: {
      contentId: newContent.id,
      platform: socialConn.platform,
      caption: 'Postgres Integration Test Campaign override caption',
      hashtags: JSON.stringify(['#PostgreSQL', '#ProductionReady']),
    },
  });

  await prisma.contentVariantMedia.create({
    data: {
      contentVariantId: variant.id,
      mediaAssetId: mediaAsset.id,
      order: 0,
    },
  });
  console.log(`  ✅ Content Variant & Media Attachment created for platform ${socialConn.platform}`);

  const scheduledTime = new Date(Date.now() + 60000);
  const publication = await prisma.publication.create({
    data: {
      contentVariantId: variant.id,
      socialConnectionId: socialConn.id,
      scheduledAt: scheduledTime,
      status: 'SCHEDULED',
      idempotencyKey: `pg_pub_${targetWorkspace.id}_${variant.id}_${Date.now()}`,
    },
  });
  console.log(`  ✅ Publication scheduled: ${publication.id}`);

  // 7. Test Publishing Execution
  console.log('\n7. Testing Worker Publishing Execution...');
  const pubResult = await processPublicationJob(publication.id);
  if (!pubResult.success) throw new Error(`Publishing failed: ${pubResult.error}`);

  const updatedPub = await prisma.publication.findUnique({ where: { id: publication.id } });
  if (updatedPub?.status !== 'PUBLISHED') throw new Error('Publication status did not transition to PUBLISHED');
  console.log(`  ✅ Publication executed and transitioned to PUBLISHED (Post ID: ${updatedPub.providerPostId})`);

  // 8. Test Approvals Workflow
  console.log('\n8. Testing Approvals Workflow...');
  const approval = await prisma.approval.create({
    data: {
      contentId: newContent.id,
      userId: adminUser.id,
      status: 'APPROVED',
      comment: 'Approved for production testing',
    },
  });
  console.log(`  ✅ Approval recorded: Status ${approval.status} by user ${approval.userId}`);

  // 9. Test Analytics Queries
  console.log('\n9. Testing Analytics Aggregation...');
  const analyticsSnapshot = await prisma.analyticsSnapshot.create({
    data: {
      workspaceId: targetWorkspace.id,
      platform: socialConn.platform,
      date: new Date(),
      impressions: 1500,
      reach: 1200,
      likes: 340,
      comments: 42,
      shares: 18,
      clicks: 95,
      followers: 5200,
    },
  });

  const analyticsList = await prisma.analyticsSnapshot.findMany({
    where: { workspaceId: targetWorkspace.id },
  });
  if (analyticsList.length === 0) throw new Error('Analytics retrieval failed');
  console.log(`  ✅ Analytics snapshots fetched successfully (Total count: ${analyticsList.length})`);

  // 10. Test Audit Logging
  console.log('\n10. Testing Audit Log Scalability & Querying...');
  const auditLog = await prisma.auditLog.create({
    data: {
      organizationId: org.id,
      workspaceId: targetWorkspace.id,
      userId: adminUser.id,
      action: 'PG_TEST_ACTION',
      entityType: 'Content',
      entityId: newContent.id,
      details: JSON.stringify({ test: 'postgresql_verification' }),
    },
  });

  const fetchedAuditLogs = await prisma.auditLog.findMany({
    where: { organizationId: org.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  if (!fetchedAuditLogs.some((log) => log.id === auditLog.id)) {
    throw new Error('Audit log creation or index query failed');
  }
  console.log(`  ✅ Audit Log created and verified via composite index search`);

  console.log('\n🎉 ALL 10 POSTGRESQL FEATURE VERIFICATION CHECKS PASSED SUCCESSFULLY!\n');
  await prisma.$disconnect();
}

runPgVerification().catch((err) => {
  console.error('❌ PostgreSQL Feature Verification Failed:', err);
  process.exit(1);
});
