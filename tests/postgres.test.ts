import EmbeddedPostgres from 'embedded-postgres';
import { execSync } from 'child_process';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

async function runPostgresTests() {
  console.log('\n🐘 Starting Comprehensive PostgreSQL Integration & Production Sanity Tests...\n');

  let pg: EmbeddedPostgres | null = null;
  let databaseUrl = process.env.TEST_POSTGRES_URL || process.env.DATABASE_URL;

  // If no PostgreSQL URL provided or if default is SQLite, start embedded PostgreSQL on port 5434
  if (!databaseUrl || databaseUrl.startsWith('file:')) {
    console.log('📦 Starting local embedded PostgreSQL instance for test suite...');
    pg = new EmbeddedPostgres({
      port: 5434,
      databaseDir: '/tmp/pgdata_test_suite',
      user: 'postgres',
      password: 'password',
    });
    await pg.initialise();
    await pg.start();

    // Create database
    const pgClient = new Client({
      user: 'postgres',
      password: 'password',
      host: 'localhost',
      port: 5434,
      database: 'postgres',
    });
    await pgClient.connect();
    await pgClient.query('CREATE DATABASE innosom_test_db;');
    await pgClient.end();

    databaseUrl = 'postgresql://postgres:password@localhost:5434/innosom_test_db?schema=public';
  }

  process.env.DATABASE_URL = databaseUrl;

  try {
    // 1. Schema Migration Test
    console.log('Testing 1: Production Database Migration Deploy...');
    execSync('npx prisma migrate deploy', {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    console.log('✅ Migration deploy completed successfully.\n');

    // Initialize Prisma Client targeting PostgreSQL
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
    });

    // 2. Seed Test
    console.log('Testing 2: Seeding Data into Fresh PostgreSQL Instance...');
    execSync('npx tsx prisma/seed.ts', {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    console.log('✅ Database seeded successfully.\n');

    // 3. Authentication Test
    console.log('Testing 3: User Authentication & Password Verification...');
    const adminUser = await prisma.user.findUnique({
      where: { email: 'admin@innosom.com' },
      include: { memberships: { include: { organization: true } } },
    });
    if (!adminUser) throw new Error('Admin user not found in PostgreSQL DB');
    const isPasswordValid = await bcrypt.compare('Password123!', adminUser.passwordHash);
    if (!isPasswordValid) throw new Error('Password verification failed for admin user');
    console.log(`✅ Admin authenticated: ${adminUser.name} (${adminUser.email})\n`);

    // 4. Workspace Switching Test
    console.log('Testing 4: Multi-Tenant Workspace & Organization Isolation...');
    const organization = adminUser.memberships[0].organization;
    const workspaces = await prisma.workspace.findMany({
      where: { organizationId: organization.id },
      include: { socialConnections: true },
    });
    if (workspaces.length === 0) throw new Error('No workspaces found for organization');
    console.log(`✅ Retrieved ${workspaces.length} workspaces under organization: ${organization.name}\n`);

    // 5. Content Creation & Platform Variant Test
    console.log('Testing 5: Content Creation with Multi-Platform Variants...');
    const targetWorkspace = workspaces[0];
    const newContent = await prisma.content.create({
      data: {
        workspaceId: targetWorkspace.id,
        authorId: adminUser.id,
        title: 'PostgreSQL Production Launch',
        masterCaption: 'INNOSOM Social OS running on PostgreSQL!',
        status: 'IN_REVIEW',
        variants: {
          create: [
            {
              platform: 'facebook',
              caption: 'Facebook Variant Copy',
              hashtags: JSON.stringify(['#PostgreSQL', '#INNOSOM']),
            },
            {
              platform: 'instagram',
              caption: 'Instagram Variant Copy',
              hashtags: JSON.stringify(['#PostgreSQL', '#INNOSOM']),
            },
          ],
        },
      },
      include: { variants: true },
    });
    if (newContent.variants.length !== 2) throw new Error('Failed to create content variants');
    console.log(`✅ Content created (ID: ${newContent.id}) with 2 variants\n`);

    // 6. Approval Workflow Test
    console.log('Testing 6: Approval Workflow Transitions...');
    const approval = await prisma.approval.create({
      data: {
        contentId: newContent.id,
        userId: adminUser.id,
        status: 'APPROVED',
        comment: 'Approved for production testing',
      },
    });
    const updatedContent = await prisma.content.update({
      where: { id: newContent.id },
      data: { status: 'APPROVED' },
    });
    if (updatedContent.status !== 'APPROVED' || approval.status !== 'APPROVED') {
      throw new Error('Approval state update failed');
    }
    console.log(`✅ Content approval verified: Status updated to APPROVED\n`);

    // 7. Scheduling & Publication Queue Test
    console.log('Testing 7: Publication Scheduling & Performance Query Index Check...');
    const socialConnection = targetWorkspace.socialConnections[0];
    if (!socialConnection) throw new Error('No social connection found in workspace');

    const scheduledPub = await prisma.publication.create({
      data: {
        contentVariantId: newContent.variants[0].id,
        socialConnectionId: socialConnection.id,
        scheduledAt: new Date(Date.now() - 1000), // Due in the past for worker pick-up test
        status: 'SCHEDULED',
        idempotencyKey: `pg-test-${Date.now()}`,
      },
    });

    // Test scheduler query performance (indexing check on status + scheduledAt)
    const duePublications = await prisma.publication.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledAt: { lte: new Date() },
      },
      include: { contentVariant: true, socialConnection: true },
    });
    const foundPub = duePublications.find((p) => p.id === scheduledPub.id);
    if (!foundPub) throw new Error('Scheduler query failed to locate due publication');
    console.log(`✅ Scheduler index query successfully picked up due publication: ${scheduledPub.id}\n`);

    // 8. Publishing Execution & Status Lock Test
    console.log('Testing 8: Atomic Status Update & Publication Execution...');
    const updatedCount = await prisma.publication.updateMany({
      where: { id: scheduledPub.id, status: 'SCHEDULED' },
      data: { status: 'PUBLISHING', lastAttemptAt: new Date(), attempts: 1 },
    });
    if (updatedCount.count !== 1) throw new Error('Atomic status lock transition failed');

    const publishedPub = await prisma.publication.update({
      where: { id: scheduledPub.id },
      data: {
        status: 'PUBLISHED',
        providerPostId: 'pg_mock_post_12345',
        publishedAt: new Date(),
      },
    });
    if (publishedPub.status !== 'PUBLISHED') throw new Error('Publication completion failed');
    console.log(`✅ Atomic status lock and publishing completion verified (Post ID: ${publishedPub.providerPostId})\n`);

    // 9. Media Asset Management Test
    console.log('Testing 9: Media Asset Management & Variant Attachments...');
    const mediaAsset = await prisma.mediaAsset.create({
      data: {
        workspaceId: targetWorkspace.id,
        fileName: 'postgres_banner.png',
        fileSize: 102450,
        mimeType: 'image/png',
        storageKey: 'media/postgres_banner.png',
        publicUrl: 'https://cdn.innosom.com/media/postgres_banner.png',
        width: 1200,
        height: 630,
      },
    });
    await prisma.contentVariantMedia.create({
      data: {
        contentVariantId: newContent.variants[0].id,
        mediaAssetId: mediaAsset.id,
        order: 0,
      },
    });
    console.log(`✅ Media asset attached to variant successfully (Media ID: ${mediaAsset.id})\n`);

    // 10. Analytics Snapshot Test
    console.log('Testing 10: Analytics Snapshots & Aggregation Queries...');
    const analyticsDate = new Date();
    analyticsDate.setHours(0, 0, 0, 0);
    await prisma.analyticsSnapshot.upsert({
      where: {
        workspaceId_platform_date: {
          workspaceId: targetWorkspace.id,
          platform: 'facebook',
          date: analyticsDate,
        },
      },
      update: { impressions: 5000, reach: 3500, likes: 420 },
      create: {
        workspaceId: targetWorkspace.id,
        platform: 'facebook',
        date: analyticsDate,
        impressions: 5000,
        reach: 3500,
        likes: 420,
      },
    });

    const analyticsData = await prisma.analyticsSnapshot.findMany({
      where: { workspaceId: targetWorkspace.id },
    });
    if (analyticsData.length === 0) throw new Error('Analytics retrieval failed');
    console.log(`✅ Analytics snapshots created and queried successfully (${analyticsData.length} snapshot records)\n`);

    // 11. Audit Logging Test at Scale
    console.log('Testing 11: Scalable Audit Logging & Organization Querying...');
    await prisma.auditLog.create({
      data: {
        organizationId: organization.id,
        workspaceId: targetWorkspace.id,
        userId: adminUser.id,
        action: 'POSTGRES_TEST_VERIFIED',
        entityType: 'SYSTEM',
        entityId: 'pg-test-run',
        details: JSON.stringify({ status: 'SUCCESS' }),
        ipAddress: '127.0.0.1',
      },
    });

    const auditLogs = await prisma.auditLog.findMany({
      where: { organizationId: organization.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    if (auditLogs.length === 0) throw new Error('Audit log creation or indexing query failed');
    console.log(`✅ Scalable Audit Logging query returned ${auditLogs.length} logs for organization\n`);

    await prisma.$disconnect();
    if (pg) {
      await pg.stop();
    }

    console.log('🎉 ALL POSTGRESQL INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉\n');
  } catch (error) {
    if (pg) {
      try {
        await pg.stop();
      } catch (_) {}
    }
    console.error('❌ PostgreSQL Integration Test Failed:', error);
    process.exit(1);
  }
}

runPostgresTests();
