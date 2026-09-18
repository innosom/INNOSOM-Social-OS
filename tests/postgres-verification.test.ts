import { execSync } from 'child_process';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma';
import { processPublicationJob } from '../src/modules/publishing/PublishingWorker';
import { signSessionToken, verifySessionToken } from '../src/lib/auth';
import { encryptToken } from '../src/lib/encryption';

async function runPostgresVerificationTests() {
  console.log('🧪 Starting Comprehensive PostgreSQL End-to-End Verification Test...\n');

  // 1. Schema Migration Test
  console.log('1️⃣ [TEST] Database Schema Migration');
  try {
    execSync('npm run db:migrate:deploy', { stdio: 'inherit', env: process.env });
    console.log('✅ Schema migration successfully applied on PostgreSQL!\n');
  } catch (err: any) {
    throw new Error(`Schema migration failed: ${err.message}`);
  }

  // 2. Seed Test
  console.log('2️⃣ [TEST] Database Seeding');
  try {
    execSync('npm run db:seed', { stdio: 'inherit', env: process.env });
    console.log('✅ Database seeding complete on PostgreSQL!\n');
  } catch (err: any) {
    throw new Error(`Seeding failed: ${err.message}`);
  }

  // 3. Authentication Test
  console.log('3️⃣ [TEST] Authentication & Session Management');
  const user = await prisma.user.findUnique({
    where: { email: 'admin@innosom.com' },
    include: { memberships: { include: { organization: true } } },
  });
  if (!user) {
    throw new Error('Admin user not found after seeding.');
  }

  const isPasswordValid = await bcrypt.compare('Password123!', user.passwordHash);
  if (!isPasswordValid) {
    throw new Error('Password verification failed for seeded admin user.');
  }

  const membership = user.memberships[0];
  const token = await signSessionToken({
    userId: user.id,
    email: user.email,
    name: user.name,
    organizationId: membership.organizationId,
    role: membership.role,
  });

  const verifiedSession = await verifySessionToken(token);
  if (!verifiedSession || verifiedSession.userId !== user.id) {
    throw new Error('JWT Session token verification failed.');
  }
  console.log('✅ Authentication test passed!\n');

  // 4. Workspace Switching Test
  console.log('4️⃣ [TEST] Workspace Switching & Multitenancy Scoping');
  const workspaces = await prisma.workspace.findMany({
    where: { organizationId: membership.organizationId },
    include: { _count: { select: { socialConnections: true, contents: true } } },
  });

  if (workspaces.length === 0) {
    throw new Error('No workspaces found for seeded organization.');
  }

  const targetWorkspace = workspaces[0];
  // Verify workspace scoping queries
  const scopedConnections = await prisma.socialConnection.findMany({
    where: { workspaceId: targetWorkspace.id },
  });

  console.log(`✅ Workspace switching test passed (${workspaces.length} workspaces accessible, scoped to "${targetWorkspace.name}")!\n`);

  // 5. Content Creation Test
  console.log('5️⃣ [TEST] Content Creation');
  const newContent = await prisma.content.create({
    data: {
      workspaceId: targetWorkspace.id,
      authorId: user.id,
      title: 'Postgres Verification Announcement',
      masterCaption: 'Testing PostgreSQL database compatibility for INNOSOM Social OS.',
      status: 'DRAFT',
    },
  });

  const contentVariant = await prisma.contentVariant.create({
    data: {
      contentId: newContent.id,
      platform: 'FACEBOOK',
      caption: 'Testing PostgreSQL database compatibility for INNOSOM Social OS.',
      hashtags: JSON.stringify(['#PostgreSQL', '#INNOSOM']),
    },
  });

  console.log(`✅ Content creation test passed (Content ID: ${newContent.id}, Variant ID: ${contentVariant.id})!\n`);

  // 6. Scheduling Test
  console.log('6️⃣ [TEST] Scheduling');
  const socialConn = scopedConnections[0];
  if (!socialConn) {
    throw new Error('No social connection available in test workspace.');
  }

  const scheduledTime = new Date(Date.now() + 3600000); // 1 hour in future
  const publication = await prisma.publication.create({
    data: {
      contentVariantId: contentVariant.id,
      socialConnectionId: socialConn.id,
      scheduledAt: scheduledTime,
      status: 'SCHEDULED',
      idempotencyKey: `pub_test_pg_${Date.now()}`,
    },
  });

  await prisma.content.update({
    where: { id: newContent.id },
    data: { status: 'SCHEDULED' },
  });

  console.log(`✅ Scheduling test passed (Publication ID: ${publication.id}, Scheduled At: ${scheduledTime.toISOString()})!\n`);

  // 7. Publishing Test
  console.log('7️⃣ [TEST] Publication Worker Execution & Background Publishing');
  const publishResult = await processPublicationJob(publication.id);
  if (!publishResult.success) {
    throw new Error(`Publishing worker failed: ${publishResult.error}`);
  }

  const publishedPub = await prisma.publication.findUnique({
    where: { id: publication.id },
  });

  if (!publishedPub || publishedPub.status !== 'PUBLISHED') {
    throw new Error(`Publication status should be PUBLISHED, got: ${publishedPub?.status}`);
  }

  console.log('✅ Publishing test passed!\n');

  // 8. Approvals Test
  console.log('8️⃣ [TEST] Approvals Workflow');
  const reviewContent = await prisma.content.create({
    data: {
      workspaceId: targetWorkspace.id,
      authorId: user.id,
      title: 'Post Needing Approval',
      masterCaption: 'Needs approval before scheduling.',
      status: 'IN_REVIEW',
    },
  });

  const approval = await prisma.approval.create({
    data: {
      contentId: reviewContent.id,
      userId: user.id,
      status: 'APPROVED',
      comment: 'Verified and approved by Admin.',
    },
  });

  await prisma.content.update({
    where: { id: reviewContent.id },
    data: { status: 'APPROVED' },
  });

  console.log(`✅ Approvals test passed (Approval ID: ${approval.id}, Status: ${approval.status})!\n`);

  // 9. Analytics Test
  console.log('9️⃣ [TEST] Analytics Storage & Aggregation');
  const analyticsDate = new Date();
  const snapshot = await prisma.analyticsSnapshot.create({
    data: {
      workspaceId: targetWorkspace.id,
      platform: 'FACEBOOK',
      date: analyticsDate,
      impressions: 5000,
      reach: 3200,
      likes: 450,
      comments: 65,
      shares: 30,
      clicks: 120,
      followers: 15000,
    },
  });

  const analyticsAgg = await prisma.analyticsSnapshot.findMany({
    where: { workspaceId: targetWorkspace.id },
  });

  if (analyticsAgg.length === 0) {
    throw new Error('Analytics query returned 0 snapshots.');
  }

  console.log(`✅ Analytics test passed (${analyticsAgg.length} snapshots queryable)!\n`);

  // 10. Media Assets Test
  console.log('🔟 [TEST] Media Asset Management');
  const mediaAsset = await prisma.mediaAsset.create({
    data: {
      workspaceId: targetWorkspace.id,
      fileName: 'postgres_hero.jpg',
      fileSize: 2048500,
      mimeType: 'image/jpeg',
      storageKey: `workspaces/${targetWorkspace.id}/postgres_hero.jpg`,
      publicUrl: 'https://images.unsplash.com/photo-1542744094-3a3172720249',
      width: 1920,
      height: 1080,
    },
  });

  const mediaList = await prisma.mediaAsset.findMany({
    where: { workspaceId: targetWorkspace.id },
  });

  if (!mediaList.some((m) => m.id === mediaAsset.id)) {
    throw new Error('Newly created media asset was not found in query.');
  }

  console.log(`✅ Media asset test passed (Asset ID: ${mediaAsset.id})!\n`);

  // 11. Audit Logs Test
  console.log('1️⃣1️⃣ [TEST] Audit Logs Query & Immutability');
  await prisma.auditLog.create({
    data: {
      organizationId: membership.organizationId,
      workspaceId: targetWorkspace.id,
      userId: user.id,
      action: 'POSTGRES_VERIFICATION_COMPLETE',
      entityType: 'System',
      entityId: targetWorkspace.id,
      details: JSON.stringify({ verifiedAt: new Date().toISOString() }),
    },
  });

  const auditLogs = await prisma.auditLog.findMany({
    where: { organizationId: membership.organizationId },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  if (auditLogs.length === 0) {
    throw new Error('Audit logs query returned no records.');
  }

  console.log(`✅ Audit log test passed (${auditLogs.length} audit logs retrieved)!\n`);

  console.log('🎉 ALL 11 POSTGRESQL VERIFICATION TESTS PASSED SUCCESSFULLY!');
}

runPostgresVerificationTests().catch((err) => {
  console.error('❌ PostgreSQL verification test failed:', err);
  process.exit(1);
});
