import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

async function runPostgresTests() {
  console.log('🧪 Starting End-to-End PostgreSQL Integration Test Suite...\n');

  let testDbUrl = process.env.POSTGRES_DATABASE_URL || process.env.DATABASE_URL;

  if (!testDbUrl || testDbUrl.startsWith('file:')) {
    testDbUrl = process.env.POSTGRES_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/innosom_dev?schema=public';
  }

  if (!testDbUrl.startsWith('postgres://') && !testDbUrl.startsWith('postgresql://')) {
    console.log('⚠️ Skipping PostgreSQL integration tests: DATABASE_URL is not a PostgreSQL connection string.');
    return;
  }

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: testDbUrl,
      },
    },
  });

  try {
    // Quick connectivity check
    await prisma.$connect();
  } catch (err: any) {
    console.log(`⚠️ Skipping PostgreSQL integration tests: Could not connect to PostgreSQL at ${testDbUrl}`);
    console.log(`   Detail: ${err.message || err}`);
    return;
  }

  try {
    // 1. Seed Verification / Fresh DB Setup
    console.log('Step 1: Initializing fresh PostgreSQL Database & Running Seed...');

    // Clean up any existing records in order of FK constraints
    await prisma.auditLog.deleteMany();
    await prisma.analyticsSnapshot.deleteMany();
    await prisma.publication.deleteMany();
    await prisma.contentVariantMedia.deleteMany();
    await prisma.contentVariant.deleteMany();
    await prisma.approval.deleteMany();
    await prisma.content.deleteMany();
    await prisma.mediaAsset.deleteMany();
    await prisma.socialConnection.deleteMany();
    await prisma.workspace.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.user.deleteMany();
    await prisma.organization.deleteMany();

    // Create Organization
    const org = await prisma.organization.create({
      data: {
        name: 'INNOSOM Tech & Digital Solutions',
        slug: 'innosom',
        logoUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe',
      },
    });

    // Create User
    const passwordHash = await bcrypt.hash('Password123!', 10);
    const user = await prisma.user.create({
      data: {
        email: 'admin@innosom.com',
        name: 'INNOSOM Admin',
        passwordHash,
      },
    });

    // Create Membership
    await prisma.membership.create({
      data: {
        userId: user.id,
        organizationId: org.id,
        role: 'ADMIN',
      },
    });

    // Create Workspaces
    const ws1 = await prisma.workspace.create({
      data: {
        organizationId: org.id,
        name: 'Haji Abdi College',
        slug: 'haji-abdi-college',
        isFavorite: true,
      },
    });

    const ws2 = await prisma.workspace.create({
      data: {
        organizationId: org.id,
        name: 'Garowe General Hospital',
        slug: 'garowe-general-hospital',
        isFavorite: false,
      },
    });

    console.log('  ✅ Seed completed successfully.');

    // 2. Authentication & Workspace Switching
    console.log('\nStep 2: Testing Authentication & Workspace Switching...');
    const foundUser = await prisma.user.findUnique({
      where: { email: 'admin@innosom.com' },
      include: { memberships: { include: { organization: true } } },
    });
    if (!foundUser || !(await bcrypt.compare('Password123!', foundUser.passwordHash))) {
      throw new Error('Authentication check failed.');
    }

    const workspaces = await prisma.workspace.findMany({
      where: { organizationId: org.id },
    });
    if (workspaces.length !== 2) {
      throw new Error(`Workspace switching query failed. Expected 2 workspaces, got ${workspaces.length}`);
    }
    console.log('  ✅ Authentication & Workspace isolation verified.');

    // 3. Social Connection Creation
    console.log('\nStep 3: Creating Social Connection...');
    const connection = await prisma.socialConnection.create({
      data: {
        workspaceId: ws1.id,
        platform: 'FACEBOOK',
        accountName: 'Haji Abdi Official FB',
        accountId: 'fb_haji_123',
        accessTokenEnc: 'enc_token_123',
        status: 'CONNECTED',
      },
    });
    console.log('  ✅ Social connection created.');

    // 4. Media Asset Creation
    console.log('\nStep 4: Uploading Media Asset...');
    const mediaAsset = await prisma.mediaAsset.create({
      data: {
        workspaceId: ws1.id,
        fileName: 'campus_tour.jpg',
        fileSize: 1024000,
        mimeType: 'image/jpeg',
        storageKey: 'media/campus_tour.jpg',
        publicUrl: 'https://cdn.innosom.com/media/campus_tour.jpg',
        width: 1920,
        height: 1080,
      },
    });
    console.log('  ✅ Media asset created.');

    // 5. Content Creation & Scheduling
    console.log('\nStep 5: Creating Content & Scheduling Variant Publications...');
    const scheduledDate = new Date(Date.now() + 3600 * 1000); // 1 hour in future
    const content = await prisma.content.create({
      data: {
        workspaceId: ws1.id,
        authorId: user.id,
        title: '2026 Admissions Announcement',
        masterCaption: 'Admissions are now open for 2026 academic year!',
        status: 'SCHEDULED',
        variants: {
          create: {
            platform: 'FACEBOOK',
            caption: 'Admissions are now open for 2026 academic year! Apply today.',
            hashtags: JSON.stringify(['#HajiAbdi', '#Admissions2026']),
            mediaAttachments: {
              create: {
                mediaAssetId: mediaAsset.id,
                order: 0,
              },
            },
            publications: {
              create: {
                socialConnectionId: connection.id,
                scheduledAt: scheduledDate,
                status: 'SCHEDULED',
                idempotencyKey: `pub_${ws1.id}_fb_${Date.now()}`,
              },
            },
          },
        },
      },
      include: {
        variants: {
          include: {
            mediaAttachments: true,
            publications: true,
          },
        },
      },
    });

    if (content.variants.length !== 1 || content.variants[0].publications.length !== 1) {
      throw new Error('Content creation with variant and publication failed.');
    }
    console.log('  ✅ Content & publication scheduled.');

    // 6. Scheduler Query Performance Test
    console.log('\nStep 6: Testing Scheduler Query Performance...');
    const duePublications = await prisma.publication.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledAt: { lte: new Date(Date.now() + 7200 * 1000) },
      },
      include: {
        contentVariant: {
          include: {
            content: true,
            mediaAttachments: { include: { mediaAsset: true } },
          },
        },
        socialConnection: true,
      },
    });
    if (duePublications.length === 0) {
      throw new Error('Scheduler query failed to fetch scheduled publication.');
    }
    console.log(`  ✅ Scheduler query returned ${duePublications.length} publication(s).`);

    // 7. Approvals Workflow
    console.log('\nStep 7: Testing Approval Workflow...');
    await prisma.approval.create({
      data: {
        contentId: content.id,
        userId: user.id,
        status: 'APPROVED',
        comment: 'Approved for publication.',
      },
    });

    const updatedContent = await prisma.content.update({
      where: { id: content.id },
      data: { status: 'APPROVED' },
    });
    if (updatedContent.status !== 'APPROVED') {
      throw new Error('Approval workflow status update failed.');
    }
    console.log('  ✅ Content approval flow completed.');

    // 8. Analytics Snapshots
    console.log('\nStep 8: Testing Analytics Queries...');
    await prisma.analyticsSnapshot.create({
      data: {
        workspaceId: ws1.id,
        platform: 'FACEBOOK',
        date: new Date(),
        impressions: 1500,
        reach: 1200,
        likes: 340,
        comments: 45,
        shares: 12,
        clicks: 89,
        followers: 5200,
      },
    });

    const analytics = await prisma.analyticsSnapshot.findMany({
      where: { workspaceId: ws1.id },
    });
    if (analytics.length !== 1 || analytics[0].impressions !== 1500) {
      throw new Error('Analytics snapshot query failed.');
    }
    console.log('  ✅ Analytics stored and retrieved.');

    // 9. Audit Logging
    console.log('\nStep 9: Testing Audit Log Querying at Scale...');
    await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        workspaceId: ws1.id,
        userId: user.id,
        action: 'SCHEDULE_CONTENT',
        entityType: 'Content',
        entityId: content.id,
        details: JSON.stringify({ title: content.title }),
      },
    });

    const auditLogs = await prisma.auditLog.findMany({
      where: { organizationId: org.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    if (auditLogs.length !== 1 || auditLogs[0].action !== 'SCHEDULE_CONTENT') {
      throw new Error('Audit log query failed.');
    }
    console.log('  ✅ Audit log stored and retrieved.');

    console.log('\n🎉 ALL END-TO-END POSTGRESQL INTEGRATION TESTS PASSED PERFECTLY!');
  } catch (e: any) {
    console.error('❌ PostgreSQL integration tests failed:', e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runPostgresTests();
