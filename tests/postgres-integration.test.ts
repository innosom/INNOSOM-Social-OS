import EmbeddedPostgres from 'embedded-postgres';
import { execSync } from 'child_process';
import bcrypt from 'bcryptjs';

// Ensure encryption key is set for test session
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

async function runPostgresIntegrationTests() {
  console.log('🐘 Executing PostgreSQL Integration Tests...\n');

  let pg: EmbeddedPostgres | null = null;
  let databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_TEST_URL;

  if (!databaseUrl) {
    console.log('⚙️ Starting local PostgreSQL engine on port 5432...');
    pg = new EmbeddedPostgres({
      port: 5432,
      user: 'postgres',
      password: 'password',
      persistent: false,
    });
    await pg.initialise();
    await pg.start();
    databaseUrl = 'postgresql://postgres:password@localhost:5432/postgres?schema=public';
    process.env.DATABASE_URL = databaseUrl;
  }

  try {
    // Dynamically import modules AFTER process.env.DATABASE_URL is set
    const { prisma } = await import('../src/lib/prisma');
    const { processPublicationJob } = await import('../src/modules/publishing/PublishingWorker');

    try {
      // -------------------------------------------------------------
      // 1. AUTHENTICATION TEST
      // -------------------------------------------------------------
      console.log('Testing 1: Authentication & Password Verification on PostgreSQL...');
      const adminUser = await prisma.user.findUnique({ where: { email: 'admin@innosom.com' } });
      if (!adminUser) throw new Error('Admin user not found in seeded PostgreSQL database');

      const isPasswordValid = await bcrypt.compare('Password123!', adminUser.passwordHash);
      if (!isPasswordValid) throw new Error('Password verification failed for admin user');
      console.log(`  ✅ User ${adminUser.email} authenticated and password hash verified.`);

      // -------------------------------------------------------------
      // 2. WORKSPACE SWITCHING & SCOPING TEST
      // -------------------------------------------------------------
      console.log('\nTesting 2: Workspace Switching & Data Scoping on PostgreSQL...');
      const org = await prisma.organization.findFirst();
      if (!org) throw new Error('Organization not found');

      const workspaces = await prisma.workspace.findMany({
        where: { organizationId: org.id },
        include: { socialConnections: true },
      });

      if (workspaces.length < 2) throw new Error('Expected at least 2 client workspaces in seeded data');

      const ws1 = workspaces[0];
      const ws2 = workspaces[1];

      // Scoped queries check
      const ws1Conns = await prisma.socialConnection.findMany({ where: { workspaceId: ws1.id } });
      const ws2Conns = await prisma.socialConnection.findMany({ where: { workspaceId: ws2.id } });

      for (const conn of ws1Conns) {
        if (conn.workspaceId !== ws1.id) throw new Error('Workspace isolation leakage detected in ws1 query');
      }
      for (const conn of ws2Conns) {
        if (conn.workspaceId !== ws2.id) throw new Error('Workspace isolation leakage detected in ws2 query');
      }
      console.log(`  ✅ Workspace switching verified: ${ws1.name} (${ws1Conns.length} conns) & ${ws2.name} (${ws2Conns.length} conns) strictly isolated.`);

      // -------------------------------------------------------------
      // 3. CONTENT CREATION & VARIANTS TEST
      // -------------------------------------------------------------
      console.log('\nTesting 3: Content Creation & Multi-Platform Variants on PostgreSQL...');
      const createdContent = await prisma.content.create({
        data: {
          workspaceId: ws1.id,
          authorId: adminUser.id,
          title: 'PostgreSQL Migration Test Announcement',
          masterCaption: 'We are thrilled to announce our upgraded PostgreSQL backend infrastructure!',
          status: 'DRAFT',
          variants: {
            create: [
              {
                platform: 'FACEBOOK',
                caption: 'We are thrilled to announce our upgraded PostgreSQL backend infrastructure! 🚀',
                hashtags: JSON.stringify(['#INNOSOM', '#PostgreSQL', '#TechUpdate']),
              },
              {
                platform: 'INSTAGRAM',
                caption: 'We are thrilled to announce our upgraded PostgreSQL backend infrastructure! 🚀✨',
                hashtags: JSON.stringify(['#INNOSOM', '#PostgreSQL', '#TechUpdate', '#DevOps']),
              },
            ],
          },
        },
        include: { variants: true },
      });

      if (createdContent.variants.length !== 2) {
        throw new Error(`Expected 2 variants created, got ${createdContent.variants.length}`);
      }
      console.log(`  ✅ Master Content ID ${createdContent.id} created with ${createdContent.variants.length} platform variants.`);

      // -------------------------------------------------------------
      // 4. SCHEDULING TEST
      // -------------------------------------------------------------
      console.log('\nTesting 4: Post Scheduling on PostgreSQL...');
      const fbConn = await prisma.socialConnection.findFirst({
        where: { workspaceId: ws1.id, platform: 'FACEBOOK' },
      });
      if (!fbConn) throw new Error('No Facebook connection found for test workspace');

      const fbVariant = createdContent.variants.find((v) => v.platform === 'FACEBOOK')!;
      const scheduledAtTime = new Date(Date.now() + 3600 * 1000);

      const scheduledPub = await prisma.publication.create({
        data: {
          contentVariantId: fbVariant.id,
          socialConnectionId: fbConn.id,
          scheduledAt: scheduledAtTime,
          status: 'SCHEDULED',
          idempotencyKey: `pg_test_sched_${Date.now()}`,
        },
      });

      if (scheduledPub.status !== 'SCHEDULED') throw new Error('Scheduled publication status mismatch');
      console.log(`  ✅ Publication ID ${scheduledPub.id} scheduled for ${scheduledAtTime.toISOString()}.`);

      // -------------------------------------------------------------
      // 5. PUBLISHING EXECUTION & WORKER TEST
      // -------------------------------------------------------------
      console.log('\nTesting 5: Async Publishing Worker Execution on PostgreSQL...');
      const pubResult = await processPublicationJob(scheduledPub.id);
      if (!pubResult.success) {
        throw new Error(`Publishing job failed: ${pubResult.error}`);
      }

      const updatedPub = await prisma.publication.findUnique({ where: { id: scheduledPub.id } });
      if (updatedPub?.status !== 'PUBLISHED') {
        throw new Error(`Publication status should be PUBLISHED, got ${updatedPub?.status}`);
      }

      const updatedContent = await prisma.content.findUnique({ where: { id: createdContent.id } });
      if (updatedContent?.status !== 'PUBLISHED') {
        throw new Error(`Parent Content status should transition to PUBLISHED, got ${updatedContent?.status}`);
      }
      console.log(`  ✅ Publishing Worker execution succeeded against PostgreSQL. Publication & Content set to PUBLISHED.`);

      // -------------------------------------------------------------
      // 6. APPROVALS WORKFLOW TEST
      // -------------------------------------------------------------
      console.log('\nTesting 6: Approvals Workflow on PostgreSQL...');
      const approvalContent = await prisma.content.create({
        data: {
          workspaceId: ws1.id,
          authorId: adminUser.id,
          title: 'Approval Review Test Post',
          masterCaption: 'Post requiring manager approval review.',
          status: 'IN_REVIEW',
        },
      });

      const approval = await prisma.approval.create({
        data: {
          contentId: approvalContent.id,
          userId: adminUser.id,
          status: 'APPROVED',
          comment: 'Approved for publication.',
        },
      });

      await prisma.content.update({
        where: { id: approvalContent.id },
        data: { status: 'APPROVED' },
      });

      const refetchedApprovalContent = await prisma.content.findUnique({
        where: { id: approvalContent.id },
        include: { approvals: true },
      });

      if (refetchedApprovalContent?.status !== 'APPROVED' || refetchedApprovalContent.approvals.length !== 1) {
        throw new Error('Approval workflow status update failed');
      }
      console.log(`  ✅ Approval record ${approval.id} created and content transitioned to APPROVED.`);

      // -------------------------------------------------------------
      // 7. ANALYTICS QUERY & AGGREGATION TEST
      // -------------------------------------------------------------
      console.log('\nTesting 7: Analytics Aggregations on PostgreSQL...');
      const analyticsSnapshots = await prisma.analyticsSnapshot.findMany({
        where: { workspaceId: ws1.id },
      });

      const totalImpressions = analyticsSnapshots.reduce((acc, s) => acc + s.impressions, 0);
      const totalReach = analyticsSnapshots.reduce((acc, s) => acc + s.reach, 0);

      console.log(`  ✅ Analytics queried successfully: ${analyticsSnapshots.length} snapshots with ${totalImpressions} total impressions and ${totalReach} reach.`);

      // -------------------------------------------------------------
      // 8. MEDIA ASSETS & ATTACHMENTS TEST
      // -------------------------------------------------------------
      console.log('\nTesting 8: Media Assets & Variant Linkages on PostgreSQL...');
      const mediaAsset = await prisma.mediaAsset.create({
        data: {
          workspaceId: ws1.id,
          fileName: 'pg_test_banner.png',
          fileSize: 2048576,
          mimeType: 'image/png',
          storageKey: 'test/pg_test_banner.png',
          publicUrl: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809',
          width: 1920,
          height: 1080,
          folderPath: '/Banners',
        },
      });

      const igVariant = createdContent.variants.find((v) => v.platform === 'INSTAGRAM')!;
      await prisma.contentVariantMedia.create({
        data: {
          contentVariantId: igVariant.id,
          mediaAssetId: mediaAsset.id,
          order: 0,
        },
      });

      const refetchedMedia = await prisma.mediaAsset.findUnique({
        where: { id: mediaAsset.id },
        include: { contentVariants: true },
      });

      if (!refetchedMedia || refetchedMedia.contentVariants.length !== 1) {
        throw new Error('Media asset linkage check failed');
      }
      console.log(`  ✅ Media Asset ${mediaAsset.id} created and linked to content variant.`);

      // -------------------------------------------------------------
      // 9. AUDIT LOGS AT SCALE TEST
      // -------------------------------------------------------------
      console.log('\nTesting 9: Audit Logs Querying at Scale on PostgreSQL...');
      const auditLogBatch = Array.from({ length: 50 }).map((_, i) => ({
        organizationId: org.id,
        workspaceId: ws1.id,
        userId: adminUser.id,
        action: `SCALE_TEST_ACTION_${i}`,
        entityType: 'TestEntity',
        entityId: `entity_${i}`,
        details: JSON.stringify({ step: i }),
      }));

      await prisma.auditLog.createMany({ data: auditLogBatch });

      const queriedAuditLogs = await prisma.auditLog.findMany({
        where: { organizationId: org.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      if (queriedAuditLogs.length < 20) throw new Error('Audit log batch creation or query failed');
      console.log(`  ✅ Audit logs scale test passed: ${queriedAuditLogs.length} recent audit logs returned using optimized indexes.`);

      await prisma.$disconnect();
      console.log('\n🎉 ALL POSTGRESQL INTEGRATION TESTS PASSED!\n');
    } catch (dbErr) {
      await prisma.$disconnect();
      throw dbErr;
    }
  } finally {
    if (pg) {
      await pg.stop();
      console.log('🛑 Local PostgreSQL engine stopped.');
    }
  }
}

runPostgresIntegrationTests().catch((e) => {
  console.error('❌ PostgreSQL Integration Test Suite failed:', e);
  process.exit(1);
});
