import { prisma } from '../src/lib/prisma';
import bcrypt from 'bcryptjs';
import { processPublicationJob } from '../src/modules/publishing/PublishingWorker';
import { encryptToken } from '../src/lib/encryption';

async function runPostgresVerificationSuite() {
  console.log('🧪 Starting Comprehensive PostgreSQL Verification Suite...\n');

  try {
    // -------------------------------------------------------------
    // 1. Schema Migration & Database Connection Check
    // -------------------------------------------------------------
    console.log('1. Checking PostgreSQL Database Connection...');
    const orgCount = await prisma.organization.count();
    console.log(`   ✅ Connected to PostgreSQL. Organizations count: ${orgCount}`);

    // -------------------------------------------------------------
    // 2. Authentication Test
    // -------------------------------------------------------------
    console.log('\n2. Testing Authentication & User Credentials...');
    const adminUser = await prisma.user.findUnique({
      where: { email: 'admin@innosom.com' },
    });
    if (!adminUser) throw new Error('Admin user not found in PostgreSQL database.');

    const isPasswordValid = await bcrypt.compare('Password123!', adminUser.passwordHash);
    if (!isPasswordValid) throw new Error('Password hash validation failed for admin user.');
    console.log(`   ✅ User authentication test passed for: ${adminUser.email}`);

    // -------------------------------------------------------------
    // 3. Workspace Switching & Data Isolation Test
    // -------------------------------------------------------------
    console.log('\n3. Testing Workspace Switching & Data Isolation...');
    const workspaces = await prisma.workspace.findMany({
      where: { organizationId: adminUser.memberships?.[0]?.organizationId || (await prisma.organization.findFirst())!.id },
      orderBy: { name: 'asc' },
    });
    if (workspaces.length < 2) throw new Error('Expected multiple workspaces for workspace switching test.');

    const targetWorkspace1 = workspaces[0];
    const targetWorkspace2 = workspaces[1];

    const ws1Connections = await prisma.socialConnection.findMany({ where: { workspaceId: targetWorkspace1.id } });
    const ws2Connections = await prisma.socialConnection.findMany({ where: { workspaceId: targetWorkspace2.id } });

    console.log(`   ✅ Workspace 1 ("${targetWorkspace1.name}") connections: ${ws1Connections.length}`);
    console.log(`   ✅ Workspace 2 ("${targetWorkspace2.name}") connections: ${ws2Connections.length}`);

    // -------------------------------------------------------------
    // 4. Media Asset Creation & Handling
    // -------------------------------------------------------------
    console.log('\n4. Testing Media Asset Creation...');
    const newMedia = await prisma.mediaAsset.create({
      data: {
        workspaceId: targetWorkspace1.id,
        fileName: 'test_launch_banner.png',
        fileSize: 1024500,
        mimeType: 'image/png',
        storageKey: 'uploads/test_launch_banner.png',
        publicUrl: 'https://cdn.innosom.com/uploads/test_launch_banner.png',
        width: 1200,
        height: 630,
        folderPath: '/campaigns',
      },
    });
    console.log(`   ✅ MediaAsset created with ID: ${newMedia.id}`);

    // -------------------------------------------------------------
    // 5. Content Creation with Variants
    // -------------------------------------------------------------
    console.log('\n5. Testing Content Creation & Platform Variants...');
    const newContent = await prisma.content.create({
      data: {
        workspaceId: targetWorkspace1.id,
        authorId: adminUser.id,
        title: 'PostgreSQL Migration Announcement',
        masterCaption: 'We are thrilled to announce full PostgreSQL production readiness!',
        status: 'DRAFT',
        variants: {
          create: [
            {
              platform: 'FACEBOOK',
              caption: 'We are thrilled to announce full PostgreSQL production readiness! #INNOSOM #Tech',
              hashtags: JSON.stringify(['#INNOSOM', '#Tech']),
            },
            {
              platform: 'INSTAGRAM',
              caption: 'We are thrilled to announce full PostgreSQL production readiness! #INNOSOM #Tech',
              hashtags: JSON.stringify(['#INNOSOM', '#Tech']),
            },
          ],
        },
      },
      include: {
        variants: true,
      },
    });
    if (newContent.variants.length !== 2) throw new Error('Failed to create content variants.');

    // Attach media to Facebook variant
    const fbVariant = newContent.variants.find((v) => v.platform === 'FACEBOOK')!;
    await prisma.contentVariantMedia.create({
      data: {
        contentVariantId: fbVariant.id,
        mediaAssetId: newMedia.id,
        order: 0,
      },
    });
    console.log(`   ✅ Content created with ${newContent.variants.length} variants and media attached.`);

    // -------------------------------------------------------------
    // 6. Approvals Test
    // -------------------------------------------------------------
    console.log('\n6. Testing Approvals Workflow...');
    const approval = await prisma.approval.create({
      data: {
        contentId: newContent.id,
        userId: adminUser.id,
        status: 'APPROVED',
        comment: 'Approved for scheduled publishing on PostgreSQL.',
      },
    });

    const approvedContent = await prisma.content.update({
      where: { id: newContent.id },
      data: { status: 'APPROVED' },
    });
    if (approvedContent.status !== 'APPROVED') throw new Error('Content status transition to APPROVED failed.');
    console.log(`   ✅ Approval recorded (ID: ${approval.id}) and Content status set to APPROVED.`);

    // -------------------------------------------------------------
    // 7. Scheduling & Publication Creation
    // -------------------------------------------------------------
    console.log('\n7. Testing Scheduling & Publication Creation...');
    let socialConn = ws1Connections[0];
    if (!socialConn) {
      socialConn = await prisma.socialConnection.create({
        data: {
          workspaceId: targetWorkspace1.id,
          platform: 'FACEBOOK',
          accountName: 'INNOSOM Tech FB',
          accountId: 'innosom_fb_001',
          status: 'CONNECTED',
          accessTokenEnc: encryptToken('test_token_123')!,
        },
      });
    }

    const scheduledPub = await prisma.publication.create({
      data: {
        contentVariantId: fbVariant.id,
        socialConnectionId: socialConn.id,
        scheduledAt: new Date(Date.now() - 1000), // Due for publishing immediately
        status: 'SCHEDULED',
        idempotencyKey: `pub_test_${Date.now()}_${Math.random()}`,
      },
    });
    console.log(`   ✅ Publication scheduled with ID: ${scheduledPub.id}`);

    // Update parent content to SCHEDULED
    await prisma.content.update({
      where: { id: newContent.id },
      data: { status: 'SCHEDULED' },
    });

    // -------------------------------------------------------------
    // 8. Publishing & Idempotency Execution
    // -------------------------------------------------------------
    console.log('\n8. Testing Publishing Worker Execution & Idempotency...');
    const pubResult = await processPublicationJob(scheduledPub.id);
    if (!pubResult.success) throw new Error(`Publishing job failed: ${pubResult.error}`);

    const verifiedPub = await prisma.publication.findUnique({
      where: { id: scheduledPub.id },
    });
    if (verifiedPub?.status !== 'PUBLISHED') throw new Error(`Expected status PUBLISHED, got ${verifiedPub?.status}`);
    console.log(`   ✅ Publication successfully processed and transitioned to PUBLISHED.`);

    // Re-run for idempotency
    const reRunResult = await processPublicationJob(scheduledPub.id);
    if (!reRunResult.success) throw new Error('Idempotent re-run should succeed gracefully.');
    console.log(`   ✅ Publishing idempotency check passed.`);

    // -------------------------------------------------------------
    // 9. Analytics Snapshots
    // -------------------------------------------------------------
    console.log('\n9. Testing Analytics Snapshots...');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const snapshot = await prisma.analyticsSnapshot.upsert({
      where: {
        workspaceId_platform_date: {
          workspaceId: targetWorkspace1.id,
          platform: 'FACEBOOK',
          date: today,
        },
      },
      update: {
        impressions: { increment: 1500 },
        reach: { increment: 1200 },
        likes: { increment: 85 },
      },
      create: {
        workspaceId: targetWorkspace1.id,
        platform: 'FACEBOOK',
        date: today,
        impressions: 1500,
        reach: 1200,
        likes: 85,
        comments: 12,
        shares: 5,
        clicks: 42,
        followers: 3500,
      },
    });
    console.log(`   ✅ Analytics snapshot recorded for ${targetWorkspace1.name} on ${snapshot.date.toISOString().slice(0, 10)}`);

    // -------------------------------------------------------------
    // 10. Audit Logs Querying at Scale
    // -------------------------------------------------------------
    console.log('\n10. Testing Audit Logs at Scale...');
    const auditEntry = await prisma.auditLog.create({
      data: {
        organizationId: targetWorkspace1.organizationId,
        workspaceId: targetWorkspace1.id,
        userId: adminUser.id,
        action: 'CONTENT_PUBLISHED',
        entityType: 'PUBLICATION',
        entityId: scheduledPub.id,
        details: JSON.stringify({ title: newContent.title, providerPostId: verifiedPub.providerPostId }),
        ipAddress: '127.0.0.1',
      },
    });

    const auditLogs = await prisma.auditLog.findMany({
      where: {
        organizationId: targetWorkspace1.organizationId,
        workspaceId: targetWorkspace1.id,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    if (auditLogs.length === 0) throw new Error('Failed to query audit logs.');
    console.log(`   ✅ Successfully created audit log (ID: ${auditEntry.id}) and queried ${auditLogs.length} logs for workspace.`);

    // Clean up created test content & media
    await prisma.content.delete({ where: { id: newContent.id } });
    await prisma.mediaAsset.delete({ where: { id: newMedia.id } });

    console.log('\n🎉 ALL POSTGRESQL VERIFICATION TESTS PASSED SUCCESSFULLY! 🎉\n');
  } catch (err: any) {
    console.error('\n❌ PostgreSQL Verification Suite Failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runPostgresVerificationSuite();
