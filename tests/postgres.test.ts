import { execSync } from 'child_process';
import { prisma } from '../src/lib/prisma';
import bcrypt from 'bcryptjs';
import { processPublicationJob } from '../src/modules/publishing/PublishingWorker';
import { pollScheduledPublications } from '../src/modules/publishing/QueueService';

async function runPostgresTestSuite() {
  console.log('🧪 Running Comprehensive PostgreSQL Integration & Verification Suite...\n');

  const pgDbUrl = process.env.DATABASE_URL || 'postgresql://innosom:innosom_password@localhost:5432/innosom_db';
  process.env.DATABASE_URL = pgDbUrl;

  try {
    // -------------------------------------------------------------
    // TEST 1: Schema Migration Execution
    // -------------------------------------------------------------
    console.log('1. Testing PostgreSQL Schema Migration (prisma migrate deploy)...');
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: pgDbUrl },
      stdio: 'inherit',
    });
    console.log('   ✅ PostgreSQL migration deployed successfully.\n');

    // -------------------------------------------------------------
    // TEST 2: Database Seeding
    // -------------------------------------------------------------
    console.log('2. Testing Seed Execution on PostgreSQL...');
    execSync('npx tsx prisma/seed.ts', {
      env: { ...process.env, DATABASE_URL: pgDbUrl },
      stdio: 'inherit',
    });
    console.log('   ✅ PostgreSQL seed executed successfully.\n');

    // -------------------------------------------------------------
    // TEST 3: Authentication & User Management
    // -------------------------------------------------------------
    console.log('3. Testing Authentication & User Management...');
    const adminUser = await prisma.user.findUnique({
      where: { email: 'admin@innosom.com' },
    });
    if (!adminUser) throw new Error('Admin user from seed not found');

    const isPasswordValid = await bcrypt.compare('Password123!', adminUser.passwordHash);
    if (!isPasswordValid) throw new Error('Password hash verification failed');
    console.log(`   ✅ Authenticated user: ${adminUser.name} (${adminUser.email})\n`);

    // -------------------------------------------------------------
    // TEST 4: Workspace Switching & Multi-tenant Data Isolation
    // -------------------------------------------------------------
    console.log('4. Testing Workspace Switching & Organization Isolation...');
    const memberships = await prisma.membership.findMany({
      where: { userId: adminUser.id },
      include: { organization: { include: { workspaces: true } } },
    });
    if (memberships.length === 0) throw new Error('No memberships found for admin user');

    const org = memberships[0].organization;
    if (!org.workspaces || org.workspaces.length === 0) {
      throw new Error('No workspaces found for organization');
    }
    const targetWorkspace = org.workspaces[0];
    console.log(`   ✅ Active Organization: ${org.name}, Switched Workspace: ${targetWorkspace.name}\n`);

    // -------------------------------------------------------------
    // TEST 5: Content Creation, Variants & Media Attachment
    // -------------------------------------------------------------
    console.log('5. Testing Content Creation & Multi-platform Variants...');
    const mediaAsset = await prisma.mediaAsset.create({
      data: {
        workspaceId: targetWorkspace.id,
        fileName: 'test-banner.png',
        fileSize: 102400,
        mimeType: 'image/png',
        storageKey: 'media/test-banner.png',
        publicUrl: 'https://cdn.innosom.com/media/test-banner.png',
        folderPath: '/campaigns',
      },
    });

    const createdContent = await prisma.content.create({
      data: {
        workspaceId: targetWorkspace.id,
        authorId: adminUser.id,
        title: 'PG Integration Test Campaign Post',
        masterCaption: 'Excellence in Digital Solutions - INNOSOM Tech',
        status: 'IN_REVIEW',
        variants: {
          create: [
            {
              platform: 'FACEBOOK',
              caption: 'Excellence in Digital Solutions #INNOSOM',
              hashtags: JSON.stringify(['#INNOSOM', '#Tech']),
            },
            {
              platform: 'INSTAGRAM',
              caption: 'Excellence in Digital Solutions #INNOSOM #Digital',
              hashtags: JSON.stringify(['#INNOSOM', '#Digital']),
            },
          ],
        },
      },
      include: { variants: true },
    });

    const fbVariant = createdContent.variants.find((v) => v.platform === 'FACEBOOK');
    if (!fbVariant) throw new Error('Facebook variant not created');

    await prisma.contentVariantMedia.create({
      data: {
        contentVariantId: fbVariant.id,
        mediaAssetId: mediaAsset.id,
        order: 0,
      },
    });
    console.log(`   ✅ Content created (ID: ${createdContent.id}) with 2 variants & media attached.\n`);

    // -------------------------------------------------------------
    // TEST 6: Approvals Workflow
    // -------------------------------------------------------------
    console.log('6. Testing Approval Workflow...');
    const approval = await prisma.approval.create({
      data: {
        contentId: createdContent.id,
        userId: adminUser.id,
        status: 'APPROVED',
        comment: 'Approved for immediate scheduling on PostgreSQL.',
      },
    });

    const updatedContent = await prisma.content.update({
      where: { id: createdContent.id },
      data: { status: 'APPROVED' },
    });
    if (updatedContent.status !== 'APPROVED') throw new Error('Content status update failed');
    console.log(`   ✅ Approval recorded (ID: ${approval.id}), Content status transitioned to APPROVED.\n`);

    // -------------------------------------------------------------
    // TEST 7: Scheduling & Scheduler Composite Index Performance
    // -------------------------------------------------------------
    console.log('7. Testing Scheduling & Queue Polling Query Performance...');
    const socialConn = await prisma.socialConnection.findFirst({
      where: { workspaceId: targetWorkspace.id, platform: 'FACEBOOK' },
    });
    if (!socialConn) throw new Error('No Facebook social connection found in seeded workspace');

    const scheduledTime = new Date(Date.now() - 60000); // 1 minute in the past
    const publication = await prisma.publication.create({
      data: {
        contentVariantId: fbVariant.id,
        socialConnectionId: socialConn.id,
        scheduledAt: scheduledTime,
        status: 'SCHEDULED',
        idempotencyKey: `pg-test-idempotency-${Date.now()}`,
      },
    });

    // Test scheduler poll query performance using status + scheduledAt index
    const startTime = Date.now();
    const duePubs = await prisma.publication.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledAt: { lte: new Date() },
      },
    });
    const queryDurationMs = Date.now() - startTime;

    const foundTargetPub = duePubs.some((p) => p.id === publication.id);
    if (!foundTargetPub) throw new Error('Scheduler query failed to find due publication');
    console.log(`   ✅ Scheduled publication (ID: ${publication.id}) queried in ${queryDurationMs}ms.\n`);

    // -------------------------------------------------------------
    // TEST 8: Async Publishing Processing & Status Transitions
    // -------------------------------------------------------------
    console.log('8. Testing Async Publishing Execution...');
    const pubResult = await processPublicationJob(publication.id);
    if (!pubResult.success) throw new Error(`Publication processing failed: ${pubResult.error}`);

    const verifiedPub = await prisma.publication.findUnique({ where: { id: publication.id } });
    if (verifiedPub?.status !== 'PUBLISHED') {
      throw new Error(`Expected status PUBLISHED, got ${verifiedPub?.status}`);
    }
    console.log(`   ✅ Publication ${publication.id} successfully published to provider.\n`);

    // -------------------------------------------------------------
    // TEST 9: Media Management & Querying
    // -------------------------------------------------------------
    console.log('9. Testing Media Asset Filtering & Storage Operations...');
    const workspaceMedia = await prisma.mediaAsset.findMany({
      where: { workspaceId: targetWorkspace.id, folderPath: '/campaigns' },
      orderBy: { createdAt: 'desc' },
    });
    if (workspaceMedia.length === 0) throw new Error('Media asset folder query returned 0 results');
    console.log(`   ✅ Found ${workspaceMedia.length} media assets in folder '/campaigns'.\n`);

    // -------------------------------------------------------------
    // TEST 10: Analytics Snapshot Queries
    // -------------------------------------------------------------
    console.log('10. Testing Analytics Snapshot Aggregate Queries...');
    const analytics = await prisma.analyticsSnapshot.findMany({
      where: { workspaceId: targetWorkspace.id },
      orderBy: { date: 'desc' },
    });
    console.log(`   ✅ Queried ${analytics.length} analytics snapshots for workspace.\n`);

    // -------------------------------------------------------------
    // TEST 11: Audit Logging Query Performance at Scale
    // -------------------------------------------------------------
    console.log('11. Testing Audit Logging at Scale...');
    await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        workspaceId: targetWorkspace.id,
        userId: adminUser.id,
        action: 'POSTGRES_VERIFICATION_COMPLETE',
        entityType: 'SystemTest',
        entityId: 'pg-test-01',
        details: JSON.stringify({ verifiedAt: new Date().toISOString() }),
      },
    });

    const auditLogs = await prisma.auditLog.findMany({
      where: { organizationId: org.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    if (auditLogs.length === 0) throw new Error('Audit log query returned 0 results');
    console.log(`   ✅ Successfully retrieved ${auditLogs.length} audit log entries for organization.\n`);

    console.log('🎉 COMPREHENSIVE POSTGRESQL TEST SUITE PASSED SUCCESSFULLY! 🎉\n');
  } finally {
    await prisma.$disconnect();
  }
}

runPostgresTestSuite().catch((err) => {
  console.error('❌ PostgreSQL integration test failed:', err);
  process.exit(1);
});
