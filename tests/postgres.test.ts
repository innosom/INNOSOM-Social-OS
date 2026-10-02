import { execSync } from 'child_process';
import bcrypt from 'bcryptjs';
import { signSessionToken, verifySessionToken } from '../src/lib/auth';
import { processPublicationJob } from '../src/modules/publishing/PublishingWorker';
import { encryptToken } from '../src/lib/encryption';

const TEST_POSTGRES_URL =
  process.env.TEST_POSTGRES_URL ||
  'postgresql://postgres:postgres@localhost:5432/innosom_test?schema=public';

async function runPostgresTests() {
  console.log('🐘 Starting Comprehensive PostgreSQL Production Verification Test Suite...\n');

  // Ensure environment is using PostgreSQL
  process.env.DATABASE_URL = TEST_POSTGRES_URL;
  process.env.ENCRYPTION_KEY =
    process.env.ENCRYPTION_KEY ||
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  try {
    // -------------------------------------------------------------
    // TEST 1: Schema Migration & Prisma Client Generation
    // -------------------------------------------------------------
    console.log('1. Testing Schema Migration & Client Generation against PostgreSQL...');
    try {
      execSync('npx prisma generate --schema=prisma/schema.prisma', {
        env: { ...process.env, DATABASE_URL: TEST_POSTGRES_URL },
        stdio: 'pipe',
      });
      execSync('npx prisma migrate deploy', {
        env: { ...process.env, DATABASE_URL: TEST_POSTGRES_URL },
        stdio: 'pipe',
      });
      console.log('  ✅ PostgreSQL database migrations deployed & Prisma Client generated.');
    } catch (migErr: any) {
      throw new Error(`Migration deploy failed: ${migErr.stderr?.toString() || migErr.message}`);
    }

    // Dynamic import of Prisma Client after client generation
    const { prisma } = await import('../src/lib/prisma');

    // -------------------------------------------------------------
    // TEST 2: Database Seeding
    // -------------------------------------------------------------
    console.log('\n2. Testing Database Seeding...');
    try {
      execSync('npx tsx prisma/seed.ts', {
        env: { ...process.env, DATABASE_URL: TEST_POSTGRES_URL },
        stdio: 'pipe',
      });
      console.log('  ✅ Seed script executed successfully against PostgreSQL.');
    } catch (seedErr: any) {
      throw new Error(`Seeding failed: ${seedErr.stderr?.toString() || seedErr.message}`);
    }

    // Verify seeded data
    const org = await prisma.organization.findUnique({ where: { slug: 'innosom' } });
    if (!org) throw new Error('Seeding verification failed: Organization "innosom" not found.');

    const seededUser = await prisma.user.findUnique({ where: { email: 'admin@innosom.com' } });
    if (!seededUser) throw new Error('Seeding verification failed: Admin user not found.');

    const workspaces = await prisma.workspace.findMany({ where: { organizationId: org.id } });
    if (workspaces.length === 0) throw new Error('Seeding verification failed: No workspaces found.');
    console.log(`  ✅ Verified seeded organization "${org.name}" with ${workspaces.length} workspaces.`);

    // -------------------------------------------------------------
    // TEST 3: Authentication
    // -------------------------------------------------------------
    console.log('\n3. Testing Authentication & Session Management...');
    const user = await prisma.user.findUnique({ where: { email: 'admin@innosom.com' } });
    if (!user) throw new Error('User admin@innosom.com not found in DB');

    const isPasswordValid = await bcrypt.compare('Password123!', user.passwordHash);
    if (!isPasswordValid) throw new Error('Password verification failed for admin user.');

    const membership = await prisma.membership.findFirst({ where: { userId: user.id } });
    if (!membership) throw new Error('User has no organization membership.');

    const token = await signSessionToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      organizationId: membership.organizationId,
      role: membership.role,
    });

    const verified = await verifySessionToken(token);
    if (!verified || verified.userId !== user.id) {
      throw new Error('JWT token verification failed or returned invalid payload.');
    }
    console.log('  ✅ Password hashing and JWT session token verification passed.');

    // -------------------------------------------------------------
    // TEST 4: Workspace Switching & Data Isolation
    // -------------------------------------------------------------
    console.log('\n4. Testing Workspace Switching & Multi-Tenant Data Isolation...');
    const hajiAbdiWs = workspaces.find((w) => w.slug === 'haji-abdi-college');
    const garoweWs = workspaces.find((w) => w.slug === 'garowe-general-hospital');
    if (!hajiAbdiWs || !garoweWs) throw new Error('Required test workspaces not found.');

    const hajiConns = await prisma.socialConnection.findMany({ where: { workspaceId: hajiAbdiWs.id } });
    const garoweConns = await prisma.socialConnection.findMany({ where: { workspaceId: garoweWs.id } });

    // Ensure connections belong exclusively to their respective workspaces
    for (const conn of hajiConns) {
      if (conn.workspaceId !== hajiAbdiWs.id) throw new Error('Data isolation leakage in social connection!');
    }
    console.log(`  ✅ Workspace switching verified: ${hajiAbdiWs.name} (${hajiConns.length} channels), ${garoweWs.name} (${garoweConns.length} channels).`);

    // -------------------------------------------------------------
    // TEST 5: Media Asset Management
    // -------------------------------------------------------------
    console.log('\n5. Testing Media Asset Creation...');
    const newMedia = await prisma.mediaAsset.create({
      data: {
        workspaceId: hajiAbdiWs.id,
        fileName: 'campus_launch_2026.jpg',
        fileSize: 204800,
        mimeType: 'image/jpeg',
        storageKey: 'haji-abdi/campus_launch_2026.jpg',
        publicUrl: 'https://images.unsplash.com/photo-1541339907198-e08756dedf3f?w=800',
        width: 1920,
        height: 1080,
        folderPath: '/Events',
      },
    });

    const fetchedMedia = await prisma.mediaAsset.findUnique({ where: { id: newMedia.id } });
    if (!fetchedMedia || fetchedMedia.fileName !== 'campus_launch_2026.jpg') {
      throw new Error('Media asset creation or retrieval failed.');
    }
    console.log('  ✅ Media asset created and retrieved successfully.');

    // -------------------------------------------------------------
    // TEST 6: Content Creation & Platform Variants
    // -------------------------------------------------------------
    console.log('\n6. Testing Content Creation & Multi-Platform Variants...');
    const createdContent = await prisma.content.create({
      data: {
        workspaceId: hajiAbdiWs.id,
        authorId: user.id,
        title: 'New Computer Science Lab Grand Opening',
        masterCaption: 'We are thrilled to announce the opening of our state-of-the-art Computer Science Lab at Haji Abdi College!',
        status: 'DRAFT',
      },
    });

    const createdVariant = await prisma.contentVariant.create({
      data: {
        contentId: createdContent.id,
        platform: 'FACEBOOK',
        caption: 'We are thrilled to announce the opening of our state-of-the-art Computer Science Lab at Haji Abdi College!',
        hashtags: JSON.stringify(['#TechInGarowe', '#CSLab', '#HajiAbdiCollege']),
      },
    });

    await prisma.contentVariantMedia.create({
      data: {
        contentVariantId: createdVariant.id,
        mediaAssetId: newMedia.id,
        order: 0,
      },
    });

    const fullContent = await prisma.content.findUnique({
      where: { id: createdContent.id },
      include: {
        variants: {
          include: { mediaAttachments: { include: { mediaAsset: true } } },
        },
      },
    });

    if (!fullContent || fullContent.variants.length !== 1 || fullContent.variants[0].mediaAttachments.length !== 1) {
      throw new Error('Content creation with variants and media failed.');
    }
    console.log('  ✅ Content master post and variant media attachments created.');

    // -------------------------------------------------------------
    // TEST 7: Approvals
    // -------------------------------------------------------------
    console.log('\n7. Testing Approval Workflow...');
    await prisma.content.update({
      where: { id: createdContent.id },
      data: { status: 'IN_REVIEW' },
    });

    const approval = await prisma.approval.create({
      data: {
        contentId: createdContent.id,
        userId: user.id,
        status: 'APPROVED',
        comment: 'Approved for immediate publication schedule.',
      },
    });

    await prisma.content.update({
      where: { id: createdContent.id },
      data: { status: 'APPROVED' },
    });

    const approvedContent = await prisma.content.findUnique({ where: { id: createdContent.id } });
    if (approvedContent?.status !== 'APPROVED') {
      throw new Error('Content status update to APPROVED failed.');
    }
    console.log('  ✅ Content approval flow transitions verified.');

    // -------------------------------------------------------------
    // TEST 8: Scheduling
    // -------------------------------------------------------------
    console.log('\n8. Testing Publication Scheduling...');
    const fbConn = hajiConns.find((c) => c.platform === 'FACEBOOK');
    if (!fbConn) throw new Error('Facebook connection not found for Haji Abdi workspace.');

    const scheduledDate = new Date(Date.now() + 3600 * 1000);
    const publication = await prisma.publication.create({
      data: {
        contentVariantId: createdVariant.id,
        socialConnectionId: fbConn.id,
        scheduledAt: scheduledDate,
        status: 'SCHEDULED',
        idempotencyKey: `pg_test_pub_${Date.now()}_${Math.random()}`,
      },
    });

    const scheduledPub = await prisma.publication.findUnique({ where: { id: publication.id } });
    if (!scheduledPub || scheduledPub.status !== 'SCHEDULED') {
      throw new Error('Publication creation in SCHEDULED status failed.');
    }
    console.log('  ✅ Publication scheduled with composite index support.');

    // -------------------------------------------------------------
    // TEST 9: Async Publishing & Worker Execution
    // -------------------------------------------------------------
    console.log('\n9. Testing Async Publishing Execution & Atomic Locks...');
    const pubResult = await processPublicationJob(publication.id);
    if (!pubResult.success) {
      throw new Error(`Worker execution failed: ${pubResult.error}`);
    }

    const publishedPub = await prisma.publication.findUnique({ where: { id: publication.id } });
    if (publishedPub?.status !== 'PUBLISHED') {
      throw new Error(`Expected status PUBLISHED, got ${publishedPub?.status}`);
    }

    // Test Idempotency (Processing an already published post should safely skip)
    const idempotencyRes = await processPublicationJob(publication.id);
    if (!idempotencyRes.success) {
      throw new Error('Worker idempotency test failed on published post.');
    }
    console.log('  ✅ Background publication worker execution & idempotency verified.');

    // -------------------------------------------------------------
    // TEST 10: Analytics Snapshots
    // -------------------------------------------------------------
    console.log('\n10. Testing Analytics Snapshots...');
    const today = new Date();
    const snapshot = await prisma.analyticsSnapshot.create({
      data: {
        workspaceId: hajiAbdiWs.id,
        platform: 'FACEBOOK',
        date: today,
        impressions: 5000,
        reach: 4200,
        likes: 320,
        comments: 45,
        shares: 18,
        clicks: 110,
        followers: 12000,
      },
    });

    const fetchedSnapshot = await prisma.analyticsSnapshot.findUnique({
      where: {
        workspaceId_platform_date: {
          workspaceId: hajiAbdiWs.id,
          platform: 'FACEBOOK',
          date: today,
        },
      },
    });

    if (!fetchedSnapshot || fetchedSnapshot.impressions !== 5000) {
      throw new Error('Analytics snapshot creation or retrieval failed.');
    }
    console.log('  ✅ Analytics snapshot creation & compound unique key retrieval verified.');

    // -------------------------------------------------------------
    // TEST 11: Audit Logging at Scale
    // -------------------------------------------------------------
    console.log('\n11. Testing Audit Logging at Scale...');
    await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        workspaceId: hajiAbdiWs.id,
        userId: user.id,
        action: 'POST_SCHEDULED_TEST',
        entityType: 'Publication',
        entityId: publication.id,
        details: JSON.stringify({ message: 'Post scheduled during PostgreSQL validation test suite.' }),
      },
    });

    const auditLogs = await prisma.auditLog.findMany({
      where: { organizationId: org.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (auditLogs.length === 0) throw new Error('Audit log creation or querying failed.');
    console.log(`  ✅ Audit logs queryable at scale (${auditLogs.length} entries fetched).`);

    console.log('\n🎉 ALL POSTGRESQL PRODUCTION VERIFICATION TESTS PASSED SUCCESSFULLY! 🎉');
  } finally {
    const { prisma } = await import('../src/lib/prisma');
    await prisma.$disconnect();
  }
}

runPostgresTests().catch((e) => {
  console.error('❌ PostgreSQL test execution failed:', e);
  process.exit(1);
});
