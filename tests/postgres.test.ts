import { execSync } from 'child_process';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma';
import { processPublicationJob } from '../src/modules/publishing/PublishingWorker';
import { validateWorkspaceAccess, SessionPayload } from '../src/lib/auth';

// Ensure PostgreSQL DATABASE_URL default
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith('file:')) {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/innosom_dev?schema=public';
}

async function runPostgresTests() {
  console.log('🐘 Running Comprehensive PostgreSQL Operations & Integration Test Suite...\n');

  try {
    // 1. Schema Migration Test
    console.log('🔄 1. Testing PostgreSQL Schema Migration (prisma migrate deploy)...');
    execSync('npx prisma migrate deploy', {
      env: { ...process.env },
      stdio: 'pipe',
    });
    console.log('✅ 1. Schema Migration Test Passed.');

    // 2. Seed Test
    console.log('🌱 2. Testing Database Seeding on PostgreSQL...');
    execSync('npx tsx prisma/seed.ts', {
      env: { ...process.env },
      stdio: 'pipe',
    });
    console.log('✅ 2. Database Seed Test Passed.');

    // 3. Authentication Test
    console.log('🔐 3. Testing Authentication on PostgreSQL...');
    const adminUser = await prisma.user.findUnique({
      where: { email: 'admin@innosom.com' },
    });
    if (!adminUser) throw new Error('Admin user missing after seeding.');

    const isPasswordValid = await bcrypt.compare('Password123!', adminUser.passwordHash);
    if (!isPasswordValid) throw new Error('Password hash validation failed.');
    console.log('✅ 3. Authentication Test Passed.');

    // 4. Workspace Switching Test
    console.log('🏢 4. Testing Workspace Scoping & Switching on PostgreSQL...');
    const org = await prisma.organization.findFirst({
      include: { workspaces: true },
    });
    if (!org || org.workspaces.length === 0) throw new Error('Organization or Workspaces missing.');

    const targetWorkspace = org.workspaces[0];
    const sessionPayload: SessionPayload = {
      userId: adminUser.id,
      email: adminUser.email,
      name: adminUser.name,
      organizationId: org.id,
      role: 'ADMIN',
    };

    const accessCheck = await validateWorkspaceAccess(sessionPayload, targetWorkspace.id, prisma);
    if (!accessCheck.hasAccess || accessCheck.workspace?.id !== targetWorkspace.id) {
      throw new Error('Workspace switching validation failed.');
    }

    // Verify cross-tenant isolation
    const invalidAccess = await validateWorkspaceAccess(
      { ...sessionPayload, organizationId: 'non-existent-org-uuid' },
      targetWorkspace.id,
      prisma
    );
    if (invalidAccess.hasAccess) throw new Error('Cross-tenant data isolation failure.');
    console.log('✅ 4. Workspace Switching Test Passed.');

    // 5. Media Asset Creation Test
    console.log('🖼️ 5. Testing Media Asset Creation & Folder Querying on PostgreSQL...');
    const mediaAsset = await prisma.mediaAsset.create({
      data: {
        workspaceId: targetWorkspace.id,
        fileName: 'test_banner.jpg',
        fileSize: 204800,
        mimeType: 'image/jpeg',
        storageKey: 'media/test_banner.jpg',
        publicUrl: 'https://cdn.innosom.com/media/test_banner.jpg',
        folderPath: '/campaigns/2025',
      },
    });

    const queriedMedia = await prisma.mediaAsset.findMany({
      where: {
        workspaceId: targetWorkspace.id,
        folderPath: '/campaigns/2025',
      },
    });
    if (!queriedMedia.some((m) => m.id === mediaAsset.id)) {
      throw new Error('Media asset folder query failed.');
    }
    console.log('✅ 5. Media Asset Test Passed.');

    // 6. Content Creation & Platform Variant Test
    console.log('📝 6. Testing Content Creation & Multi-Platform Variants on PostgreSQL...');
    const content = await prisma.content.create({
      data: {
        workspaceId: targetWorkspace.id,
        authorId: adminUser.id,
        title: 'Postgres Operations Update',
        masterCaption: 'INNOSOM Social OS is now powered by PostgreSQL!',
        status: 'IN_REVIEW',
        variants: {
          create: [
            {
              platform: 'FACEBOOK',
              caption: 'FB: INNOSOM Social OS is now powered by PostgreSQL!',
              hashtags: JSON.stringify(['#Tech', '#Innosom']),
              mediaAttachments: {
                create: [
                  {
                    mediaAssetId: mediaAsset.id,
                    order: 0,
                  },
                ],
              },
            },
          ],
        },
      },
      include: {
        variants: {
          include: { mediaAttachments: true },
        },
      },
    });

    if (content.variants.length !== 1 || content.variants[0].mediaAttachments.length !== 1) {
      throw new Error('Content variant with media creation failed.');
    }
    console.log('✅ 6. Content Creation Test Passed.');

    // 7. Approvals Test
    console.log('👍 7. Testing Approvals Workflow on PostgreSQL...');
    const approval = await prisma.approval.create({
      data: {
        contentId: content.id,
        userId: adminUser.id,
        status: 'APPROVED',
        comment: 'Approved for PostgreSQL launch.',
      },
    });

    await prisma.content.update({
      where: { id: content.id },
      data: { status: 'APPROVED' },
    });

    const approvedContent = await prisma.content.findUnique({
      where: { id: content.id },
      include: { approvals: true },
    });

    if (approvedContent?.status !== 'APPROVED' || approvedContent.approvals.length === 0) {
      throw new Error('Approval workflow execution failed.');
    }
    console.log('✅ 7. Approvals Workflow Test Passed.');

    // 8. Scheduling Test
    console.log('📅 8. Testing Post Scheduling on PostgreSQL...');
    const conn = await prisma.socialConnection.findFirst({
      where: { workspaceId: targetWorkspace.id },
    });
    if (!conn) throw new Error('No social connection found for workspace.');

    const variant = content.variants[0];
    const publication = await prisma.publication.create({
      data: {
        contentVariantId: variant.id,
        socialConnectionId: conn.id,
        scheduledAt: new Date(Date.now() - 10000), // scheduled in past for immediate worker pickup
        status: 'SCHEDULED',
        idempotencyKey: `pg-test-idempotency-${Date.now()}`,
      },
    });

    if (publication.status !== 'SCHEDULED') throw new Error('Publication scheduling failed.');
    console.log('✅ 8. Post Scheduling Test Passed.');

    // 9. Publishing Execution Test
    console.log('🚀 9. Testing Async Publishing Execution on PostgreSQL...');
    const publishResult = await processPublicationJob(publication.id);
    if (!publishResult.success) {
      throw new Error(`Publishing execution failed: ${publishResult.error}`);
    }

    const updatedPublication = await prisma.publication.findUnique({
      where: { id: publication.id },
    });
    if (updatedPublication?.status !== 'PUBLISHED') {
      throw new Error('Publication status did not update to PUBLISHED.');
    }

    const updatedParentContent = await prisma.content.findUnique({
      where: { id: content.id },
    });
    if (updatedParentContent?.status !== 'PUBLISHED') {
      throw new Error('Parent Content status did not update to PUBLISHED.');
    }
    console.log('✅ 9. Publishing Execution Test Passed.');

    // 10. Analytics Snapshots Test
    console.log('📊 10. Testing Analytics Snapshot Storage & Retrieval on PostgreSQL...');
    await prisma.analyticsSnapshot.create({
      data: {
        workspaceId: targetWorkspace.id,
        platform: 'FACEBOOK',
        date: new Date('2025-01-01'),
        impressions: 15000,
        reach: 12000,
        likes: 850,
        comments: 120,
        shares: 45,
        clicks: 310,
        followers: 5200,
      },
    });

    const analytics = await prisma.analyticsSnapshot.findMany({
      where: { workspaceId: targetWorkspace.id },
    });
    if (analytics.length === 0) throw new Error('Analytics snapshot retrieval failed.');
    console.log('✅ 10. Analytics Test Passed.');

    // 11. Audit Logs Scalability Test
    console.log('📜 11. Testing Audit Log Storage & Querying at Scale on PostgreSQL...');
    const auditLogsData = Array.from({ length: 50 }, (_, i) => ({
      organizationId: org.id,
      workspaceId: targetWorkspace.id,
      userId: adminUser.id,
      action: `BULK_SCALE_ACTION_${i}`,
      entityType: 'Publication',
      entityId: publication.id,
      details: JSON.stringify({ index: i, timestamp: new Date().toISOString() }),
    }));

    await prisma.auditLog.createMany({
      data: auditLogsData,
    });

    const queriedLogs = await prisma.auditLog.findMany({
      where: {
        organizationId: org.id,
        workspaceId: targetWorkspace.id,
        entityType: 'Publication',
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    if (queriedLogs.length < 20) throw new Error('Scaled Audit Log query failed.');
    console.log('✅ 11. Scaled Audit Log Test Passed.');

    console.log('\n🎉 ALL POSTGRESQL OPERATIONAL TESTS PASSED SUCCESSFULLY! 🎉');
  } finally {
    await prisma.$disconnect();
  }
}

runPostgresTests().catch((err) => {
  console.error('❌ PostgreSQL Test Suite Failed:', err);
  process.exit(1);
});
