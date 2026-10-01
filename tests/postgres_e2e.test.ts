import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { processPublicationJob } from '../src/modules/publishing/PublishingWorker';
import { execSync } from 'child_process';

const postgresUrl =
  process.env.POSTGRES_DATABASE_URL ||
  (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres')
    ? process.env.DATABASE_URL
    : 'postgresql://postgres:postgres@localhost:5432/innosom_test');

process.env.DATABASE_URL = postgresUrl;

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: postgresUrl,
    },
  },
});

async function runPostgresE2ETests() {
  console.log('🧪 Running Full PostgreSQL E2E Integration Test Suite...\n');

  try {
    // -------------------------------------------------------------
    // TEST 1: Schema Migration & Database Seeding
    // -------------------------------------------------------------
    console.log('1. Testing PostgreSQL Migration & Seeding...');
    execSync('npm run db:migrate:deploy', {
      env: { ...process.env, DATABASE_URL: postgresUrl },
      stdio: 'inherit',
    });

    execSync('npx tsx prisma/seed.ts', {
      env: { ...process.env, DATABASE_URL: postgresUrl },
      stdio: 'inherit',
    });
    console.log('  ✅ Schema migration and seed execution succeeded on PostgreSQL.\n');

    // -------------------------------------------------------------
    // TEST 2: Authentication Workflow
    // -------------------------------------------------------------
    console.log('2. Testing Authentication Workflow...');
    const user = await prisma.user.findUnique({
      where: { email: 'admin@innosom.com' },
      include: {
        memberships: {
          include: { organization: true },
        },
      },
    });

    if (!user) throw new Error('Admin user not found after seeding.');
    const isPasswordValid = await bcrypt.compare('Password123!', user.passwordHash);
    if (!isPasswordValid) throw new Error('Password hash verification failed.');

    if (user.memberships.length === 0 || user.memberships[0].role !== 'ADMIN') {
      throw new Error('User membership role mismatch.');
    }
    console.log('  ✅ Authentication & Password Hash verification passed.\n');

    // -------------------------------------------------------------
    // TEST 3: Workspace Switching & Context Scoping
    // -------------------------------------------------------------
    console.log('3. Testing Workspace Switching & Isolation...');
    const org = user.memberships[0].organization;
    const workspaces = await prisma.workspace.findMany({
      where: { organizationId: org.id },
      orderBy: { name: 'asc' },
    });

    if (workspaces.length < 5) {
      throw new Error(`Expected at least 5 client workspaces, found ${workspaces.length}`);
    }

    // Switch context to Haji Abdi College
    const hajiAbdi = workspaces.find((w) => w.slug === 'haji-abdi-college');
    const hospital = workspaces.find((w) => w.slug === 'garowe-general-hospital');

    if (!hajiAbdi || !hospital) throw new Error('Target workspaces not found.');

    const hajiConns = await prisma.socialConnection.findMany({
      where: { workspaceId: hajiAbdi.id },
    });
    const hospitalConns = await prisma.socialConnection.findMany({
      where: { workspaceId: hospital.id },
    });

    if (hajiConns.length === 0) throw new Error('Haji Abdi social connections missing.');
    // Check that connections belong strictly to their workspace
    for (const conn of hajiConns) {
      if (conn.workspaceId !== hajiAbdi.id) {
        throw new Error('Workspace data leakage detected in social connections!');
      }
    }
    console.log('  ✅ Workspace switching and data isolation verified.\n');

    // -------------------------------------------------------------
    // TEST 4: Content Creation & Variants
    // -------------------------------------------------------------
    console.log('4. Testing Content & Variant Creation...');
    const newContent = await prisma.content.create({
      data: {
        workspaceId: hajiAbdi.id,
        authorId: user.id,
        title: 'Postgres Test Announcement',
        masterCaption: 'This is a test post for PostgreSQL validation.',
        status: 'DRAFT',
      },
    });

    const variantFb = await prisma.contentVariant.create({
      data: {
        contentId: newContent.id,
        platform: 'FACEBOOK',
        caption: 'This is a test post for PostgreSQL validation on Facebook.',
        hashtags: JSON.stringify(['#PostgresTest', '#INNOSOM']),
      },
    });

    const fetchedContent = await prisma.content.findUnique({
      where: { id: newContent.id },
      include: { variants: true },
    });

    if (!fetchedContent || fetchedContent.variants.length !== 1) {
      throw new Error('Content variant creation or fetching failed.');
    }
    console.log('  ✅ Content creation with platform variants verified.\n');

    // -------------------------------------------------------------
    // TEST 5: Media Assets
    // -------------------------------------------------------------
    console.log('5. Testing Media Assets Management...');
    const mediaAsset = await prisma.mediaAsset.create({
      data: {
        workspaceId: hajiAbdi.id,
        fileName: 'postgres_banner.png',
        fileSize: 204800,
        mimeType: 'image/png',
        storageKey: 'haji-abdi/postgres_banner.png',
        publicUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800',
        folderPath: '/PostgreSQL Test Assets',
      },
    });

    await prisma.contentVariantMedia.create({
      data: {
        contentVariantId: variantFb.id,
        mediaAssetId: mediaAsset.id,
        order: 0,
      },
    });

    const queriedMedia = await prisma.mediaAsset.findMany({
      where: {
        workspaceId: hajiAbdi.id,
        folderPath: '/PostgreSQL Test Assets',
      },
    });

    if (queriedMedia.length !== 1 || queriedMedia[0].id !== mediaAsset.id) {
      throw new Error('Media asset folder path query index test failed.');
    }
    console.log('  ✅ Media asset creation and indexed folder path query verified.\n');

    // -------------------------------------------------------------
    // TEST 6: Scheduling & Publications
    // -------------------------------------------------------------
    console.log('6. Testing Scheduling Workflow...');
    const scheduledTime = new Date(Date.now() + 3600 * 1000);
    const pub = await prisma.publication.create({
      data: {
        contentVariantId: variantFb.id,
        socialConnectionId: hajiConns[0].id,
        scheduledAt: scheduledTime,
        status: 'SCHEDULED',
        idempotencyKey: `pg_pub_${Date.now()}_test`,
      },
    });

    await prisma.content.update({
      where: { id: newContent.id },
      data: { status: 'SCHEDULED' },
    });

    const duePubs = await prisma.publication.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledAt: { lte: new Date(Date.now() + 7200 * 1000) },
      },
    });

    if (!duePubs.some((p) => p.id === pub.id)) {
      throw new Error('Scheduler query failed to find due publication.');
    }
    console.log('  ✅ Publication scheduling & compound index query verified.\n');

    // -------------------------------------------------------------
    // TEST 7: Background Publishing Execution
    // -------------------------------------------------------------
    console.log('7. Testing Publishing Execution Worker...');
    const pubResult = await processPublicationJob(pub.id);
    if (!pubResult.success) {
      throw new Error(`Worker processPublicationJob failed: ${pubResult.error}`);
    }

    const publishedPub = await prisma.publication.findUnique({
      where: { id: pub.id },
    });
    const updatedParentContent = await prisma.content.findUnique({
      where: { id: newContent.id },
    });

    if (publishedPub?.status !== 'PUBLISHED' || updatedParentContent?.status !== 'PUBLISHED') {
      throw new Error('Publication execution failed to transition status to PUBLISHED.');
    }
    console.log('  ✅ Worker execution and status transition to PUBLISHED verified.\n');

    // -------------------------------------------------------------
    // TEST 8: Approvals Workflow
    // -------------------------------------------------------------
    console.log('8. Testing Approval Workflow...');
    const reviewContent = await prisma.content.create({
      data: {
        workspaceId: hajiAbdi.id,
        authorId: user.id,
        title: 'Content Pending Review',
        masterCaption: 'Please approve this post.',
        status: 'IN_REVIEW',
      },
    });

    const approvalRecord = await prisma.approval.create({
      data: {
        contentId: reviewContent.id,
        userId: user.id,
        status: 'APPROVED',
        comment: 'Looks great! Approved for scheduling.',
      },
    });

    await prisma.content.update({
      where: { id: reviewContent.id },
      data: { status: 'APPROVED' },
    });

    const checkedApproval = await prisma.approval.findFirst({
      where: { contentId: reviewContent.id },
      include: { user: true, content: true },
    });

    if (!checkedApproval || checkedApproval.content.status !== 'APPROVED') {
      throw new Error('Approval workflow record or content status check failed.');
    }
    console.log('  ✅ Approval creation and content state transition verified.\n');

    // -------------------------------------------------------------
    // TEST 9: Analytics Snapshots
    // -------------------------------------------------------------
    console.log('9. Testing Analytics Snapshots...');
    const today = new Date();
    await prisma.analyticsSnapshot.upsert({
      where: {
        workspaceId_platform_date: {
          workspaceId: hajiAbdi.id,
          platform: 'FACEBOOK',
          date: today,
        },
      },
      update: { impressions: 5000, reach: 4000, likes: 600 },
      create: {
        workspaceId: hajiAbdi.id,
        platform: 'FACEBOOK',
        date: today,
        impressions: 5000,
        reach: 4000,
        likes: 600,
      },
    });

    const analyticsList = await prisma.analyticsSnapshot.findMany({
      where: { workspaceId: hajiAbdi.id },
      orderBy: { date: 'desc' },
    });

    if (analyticsList.length === 0) {
      throw new Error('Analytics snapshots query returned empty list.');
    }
    console.log('  ✅ Analytics snapshot creation and upsert verified.\n');

    // -------------------------------------------------------------
    // TEST 10: Audit Logs Querying at Scale
    // -------------------------------------------------------------
    console.log('10. Testing Audit Logs at Scale...');
    const auditEntries = [];
    for (let i = 0; i < 25; i++) {
      auditEntries.push({
        organizationId: org.id,
        workspaceId: hajiAbdi.id,
        userId: user.id,
        action: `SCALE_TEST_ACTION_${i}`,
        entityType: 'TestEntity',
        entityId: `entity_${i}`,
        details: JSON.stringify({ index: i }),
      });
    }

    await prisma.auditLog.createMany({
      data: auditEntries,
    });

    const logs = await prisma.auditLog.findMany({
      where: { organizationId: org.id },
      include: { user: true, workspace: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    if (logs.length < 20) {
      throw new Error(`Audit log query returned ${logs.length} logs, expected 20.`);
    }
    console.log('  ✅ Audit log creation and indexed pagination query verified at scale.\n');

    console.log('🎉 ALL POSTGRESQL E2E INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉');
  } finally {
    await prisma.$disconnect();
  }
}

runPostgresE2ETests().catch((err) => {
  console.error('❌ PostgreSQL E2E test execution failed:', err);
  process.exit(1);
});
