import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma';
import { validateWorkspaceAccess, signSessionToken, verifySessionToken } from '../src/lib/auth';
import { processPublicationJob } from '../src/modules/publishing/PublishingWorker';

async function runE2ETests() {
  console.log('🧪 Starting INNOSOM Social OS Operations E2E Test Suite...');

  // 1. Database Connection & Schema Check
  const orgCount = await prisma.organization.count();
  console.log(`✅ 1. Schema Migration & DB Check Passed (Organizations count: ${orgCount})`);
  if (orgCount === 0) {
    throw new Error('Database appears empty. Please run seeding (npm run db:seed) before running test.');
  }

  // 2. Authentication Test
  const adminUser = await prisma.user.findUnique({
    where: { email: 'admin@innosom.com' },
  });
  if (!adminUser) throw new Error('Admin user not found for authentication test');

  const passwordValid = await bcrypt.compare('Password123!', adminUser.passwordHash);
  if (!passwordValid) throw new Error('Password verification failed for admin user');

  const token = await signSessionToken({
    userId: adminUser.id,
    email: adminUser.email,
    name: adminUser.name,
    organizationId: adminUser.memberships?.[0]?.organizationId || '',
    role: 'ADMIN',
  });
  const verifiedSession = await verifySessionToken(token);
  if (!verifiedSession || verifiedSession.email !== adminUser.email) {
    throw new Error('JWT Session signing/verification failed');
  }
  console.log('✅ 2. Authentication & JWT Session Test Passed');

  // 3. Workspace Switching & Access Control Test
  const connection = await prisma.socialConnection.findFirst({
    include: { workspace: true },
  });
  if (!connection) throw new Error('Social connection not found in seeded database');

  const targetWorkspace = connection.workspace;
  const org = await prisma.organization.findUnique({
    where: { id: targetWorkspace.organizationId },
  });
  if (!org) throw new Error('Organization not found for workspace');

  const accessCheck = await validateWorkspaceAccess(
    {
      userId: adminUser.id,
      email: adminUser.email,
      name: adminUser.name,
      organizationId: org.id,
      role: 'ADMIN',
    },
    targetWorkspace.id,
    prisma
  );

  if (!accessCheck.hasAccess || accessCheck.workspace?.id !== targetWorkspace.id) {
    throw new Error('Workspace access validation failed');
  }

  const allClientsAccess = await validateWorkspaceAccess(
    {
      userId: adminUser.id,
      email: adminUser.email,
      name: adminUser.name,
      organizationId: org.id,
      role: 'ADMIN',
    },
    'ALL_CLIENTS',
    prisma
  );
  if (!allClientsAccess.hasAccess) throw new Error('ALL_CLIENTS workspace mode access failed');
  console.log(`✅ 3. Workspace Switching Test Passed (${targetWorkspace.name})`);

  // 4. Media Asset Operations Test
  const mediaAsset = await prisma.mediaAsset.create({
    data: {
      workspaceId: targetWorkspace.id,
      fileName: 'test-banner.jpg',
      fileSize: 1024500,
      mimeType: 'image/jpeg',
      storageKey: `workspaces/${targetWorkspace.id}/media/test-banner.jpg`,
      publicUrl: `https://storage.innosom.com/workspaces/${targetWorkspace.id}/media/test-banner.jpg`,
      width: 1200,
      height: 630,
      folderPath: '/campaigns',
    },
  });
  const fetchedMedia = await prisma.mediaAsset.findMany({
    where: { workspaceId: targetWorkspace.id },
    orderBy: { createdAt: 'desc' },
  });
  if (!fetchedMedia.some((m) => m.id === mediaAsset.id)) {
    throw new Error('Media asset creation or retrieval failed');
  }
  console.log('✅ 4. Media Asset Creation & Retrieval Test Passed');

  // 5. Content Creation & Platform Variant Test
  const content = await prisma.content.create({
    data: {
      workspaceId: targetWorkspace.id,
      authorId: adminUser.id,
      title: 'Database Operations E2E Test Post',
      masterCaption: 'Testing database production compatibility for INNOSOM Social OS.',
      status: 'DRAFT',
      variants: {
        create: [
          {
            platform: 'FACEBOOK',
            caption: 'Testing database production compatibility for Facebook.',
            hashtags: JSON.stringify(['#INNOSOM', '#Database']),
          },
        ],
      },
    },
    include: { variants: true },
  });

  if (!content || content.variants.length === 0) {
    throw new Error('Content creation with variants failed');
  }

  const variant = content.variants[0];
  await prisma.contentVariantMedia.create({
    data: {
      contentVariantId: variant.id,
      mediaAssetId: mediaAsset.id,
      order: 0,
    },
  });
  console.log('✅ 5. Content Creation & Media Linking Test Passed');

  // 6. Approval Workflow Test
  const approval = await prisma.approval.create({
    data: {
      contentId: content.id,
      userId: adminUser.id,
      status: 'APPROVED',
      comment: 'Approved for database release testing',
    },
  });

  const updatedContent = await prisma.content.update({
    where: { id: content.id },
    data: { status: 'APPROVED' },
  });
  if (updatedContent.status !== 'APPROVED') {
    throw new Error('Approval workflow update failed');
  }
  console.log('✅ 6. Approval Workflow Test Passed');

  // 7. Scheduling Test
  const scheduledAt = new Date(Date.now() - 10000); // 10s in the past so it's due
  const publication = await prisma.publication.create({
    data: {
      contentVariantId: variant.id,
      socialConnectionId: connection.id,
      scheduledAt,
      status: 'SCHEDULED',
      idempotencyKey: `e2e-pub-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    },
  });
  if (!publication || publication.status !== 'SCHEDULED') {
    throw new Error('Publication scheduling failed');
  }
  console.log('✅ 7. Publication Scheduling Test Passed');

  // 8. Publishing Execution Test
  const publishResult = await processPublicationJob(publication.id);
  if (!publishResult.success) {
    throw new Error(`Publishing worker failed: ${publishResult.error}`);
  }

  const publishedPub = await prisma.publication.findUnique({
    where: { id: publication.id },
  });
  if (publishedPub?.status !== 'PUBLISHED') {
    throw new Error('Publication status transition to PUBLISHED failed');
  }
  console.log('✅ 8. Publication Execution Test Passed');

  // 9. Analytics Snapshots Test
  const analyticsDate = new Date();
  analyticsDate.setUTCHours(0, 0, 0, 0);

  const analytics = await prisma.analyticsSnapshot.upsert({
    where: {
      workspaceId_platform_date: {
        workspaceId: targetWorkspace.id,
        platform: 'FACEBOOK',
        date: analyticsDate,
      },
    },
    update: { impressions: 5000, reach: 3500, likes: 450 },
    create: {
      workspaceId: targetWorkspace.id,
      platform: 'FACEBOOK',
      date: analyticsDate,
      impressions: 5000,
      reach: 3500,
      likes: 450,
      comments: 25,
      shares: 10,
      clicks: 120,
    },
  });
  if (!analytics) throw new Error('Analytics snapshot upsert failed');
  console.log('✅ 9. Analytics Operations Test Passed');

  // 10. Audit Log Operations at Scale Test
  const auditLog = await prisma.auditLog.create({
    data: {
      organizationId: org.id,
      workspaceId: targetWorkspace.id,
      userId: adminUser.id,
      action: 'E2E_DATABASE_VERIFICATION',
      entityType: 'Publication',
      entityId: publication.id,
      details: JSON.stringify({ status: 'SUCCESS' }),
      ipAddress: '127.0.0.1',
    },
  });

  const queriedLogs = await prisma.auditLog.findMany({
    where: {
      organizationId: org.id,
      workspaceId: targetWorkspace.id,
      entityType: 'Publication',
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  if (!queriedLogs.some((log) => log.id === auditLog.id)) {
    throw new Error('Audit log query failed');
  }
  console.log('✅ 10. Audit Log Creation & Scalable Query Test Passed');

  // Clean up test entities created
  await prisma.auditLog.delete({ where: { id: auditLog.id } });
  await prisma.publication.delete({ where: { id: publication.id } });
  await prisma.contentVariantMedia.deleteMany({ where: { contentVariantId: variant.id } });
  await prisma.approval.delete({ where: { id: approval.id } });
  await prisma.content.delete({ where: { id: content.id } });
  await prisma.mediaAsset.delete({ where: { id: mediaAsset.id } });

  console.log('🎉 All INNOSOM Social OS Database Operations Tests Passed Successfully!');
  await prisma.$disconnect();
}

runE2ETests().catch((e) => {
  console.error('❌ E2E Test execution failed:', e);
  process.exit(1);
});
