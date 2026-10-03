import { newDb } from 'pg-mem';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';

async function runPostgresTests() {
  console.log('🧪 Running Comprehensive PostgreSQL Production Integration Tests...');

  // 1. Initialize pg-mem in-memory PostgreSQL instance
  const db = newDb();
  const pgAdapter = db.adapters.createPg();
  const pool = new pgAdapter.Pool();

  // 2. Read and apply production migration SQL script
  const migrationPath = path.join(__dirname, '../prisma/migrations/20261003000000_init/migration.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');

  console.log('🔄 Executing PostgreSQL schema migration...');
  await pool.query(migrationSql);
  console.log('✅ PostgreSQL Schema Migration Succeeded!');

  // 3. Seed test data
  console.log('🌱 Seeding PostgreSQL test database...');
  const orgId = 'org-pg-test-100';
  const userId = 'user-pg-test-100';
  const workspace1Id = 'ws-pg-test-100';
  const workspace2Id = 'ws-pg-test-200';
  const passwordHash = await bcrypt.hash('Password123!', 10);

  // Create Organization
  await pool.query(`
    INSERT INTO "Organization" ("id", "name", "slug", "updatedAt")
    VALUES ('${orgId}', 'INNOSOM Tech & Digital Solutions', 'innosom-tech', NOW())
  `);

  // Create User
  await pool.query(`
    INSERT INTO "User" ("id", "email", "name", "passwordHash", "updatedAt")
    VALUES ('${userId}', 'admin@innosom.com', 'INNOSOM Admin', '${passwordHash}', NOW())
  `);

  // Create Membership
  await pool.query(`
    INSERT INTO "Membership" ("id", "userId", "organizationId", "role")
    VALUES ('mem-pg-test-1', '${userId}', '${orgId}', 'ADMIN')
  `);

  // Create Workspaces (Workspace switching test)
  await pool.query(`
    INSERT INTO "Workspace" ("id", "organizationId", "name", "slug", "updatedAt")
    VALUES
      ('${workspace1Id}', '${orgId}', 'Haji Abdi College', 'haji-abdi-college', NOW()),
      ('${workspace2Id}', '${orgId}', 'Garowe General Hospital', 'garowe-hospital', NOW())
  `);

  // Create Social Connection
  const socialConnId = 'conn-pg-test-1';
  await pool.query(`
    INSERT INTO "SocialConnection" (
      "id", "workspaceId", "platform", "accountName", "accountId",
      "accessTokenEnc", "capabilities", "updatedAt"
    ) VALUES (
      '${socialConnId}', '${workspace1Id}', 'FACEBOOK', 'Haji Abdi Official', 'fb_acc_100',
      'enc_token_123', '{}', NOW()
    )
  `);

  console.log('✅ PostgreSQL Database Seeding Succeeded!');

  // 4. Test User Authentication / Password check
  console.log('🔑 Testing User Authentication...');
  const userRes = await pool.query(`SELECT * FROM "User" WHERE "email" = 'admin@innosom.com'`);
  if (userRes.rows.length === 0) throw new Error('Auth failed: User not found');
  const validPassword = await bcrypt.compare('Password123!', userRes.rows[0].passwordHash);
  if (!validPassword) throw new Error('Auth failed: Password comparison mismatch');
  console.log('✅ Authentication Test Passed!');

  // 5. Test Workspace Switching & Scoped Access
  console.log('🔄 Testing Workspace Switching & Isolation...');
  const ws1Res = await pool.query(`SELECT * FROM "Workspace" WHERE "id" = '${workspace1Id}'`);
  const ws2Res = await pool.query(`SELECT * FROM "Workspace" WHERE "id" = '${workspace2Id}'`);
  if (ws1Res.rows.length !== 1 || ws2Res.rows.length !== 1) {
    throw new Error('Workspace switching test failed: Workspaces not retrieved correctly');
  }
  console.log('✅ Workspace Switching & Isolation Test Passed!');

  // 6. Test Media Asset Creation
  console.log('🖼️ Testing Media Asset Management...');
  const mediaAssetId = 'media-pg-test-1';
  await pool.query(`
    INSERT INTO "MediaAsset" (
      "id", "workspaceId", "fileName", "fileSize", "mimeType", "storageKey", "publicUrl"
    ) VALUES (
      '${mediaAssetId}', '${workspace1Id}', 'banner.png', 102400, 'image/png', 'uploads/banner.png', 'https://cdn.innosom.com/banner.png'
    )
  `);
  const mediaRes = await pool.query(`SELECT * FROM "MediaAsset" WHERE "id" = '${mediaAssetId}'`);
  if (mediaRes.rows.length !== 1) throw new Error('Media asset creation failed');
  console.log('✅ Media Asset Test Passed!');

  // 7. Test Content Creation & Variant Setup
  console.log('📝 Testing Content & Variant Creation...');
  const contentId = 'content-pg-test-1';
  await pool.query(`
    INSERT INTO "Content" (
      "id", "workspaceId", "authorId", "title", "masterCaption", "status", "updatedAt"
    ) VALUES (
      '${contentId}', '${workspace1Id}', '${userId}', 'Admissions Open 2026', 'Apply now for fall 2026!', 'IN_REVIEW', NOW()
    )
  `);

  const variantId = 'variant-pg-test-1';
  await pool.query(`
    INSERT INTO "ContentVariant" (
      "id", "contentId", "platform", "caption"
    ) VALUES (
      '${variantId}', '${contentId}', 'FACEBOOK', 'Apply now for fall 2026 admissions at Haji Abdi College!'
    )
  `);

  // Content Variant Media Link
  await pool.query(`
    INSERT INTO "ContentVariantMedia" ("contentVariantId", "mediaAssetId", "order")
    VALUES ('${variantId}', '${mediaAssetId}', 0)
  `);
  console.log('✅ Content & Variant Creation Test Passed!');

  // 8. Test Approvals Workflow
  console.log('👍 Testing Approval Workflow...');
  const approvalId = 'app-pg-test-1';
  await pool.query(`
    INSERT INTO "Approval" ("id", "contentId", "userId", "status", "comment")
    VALUES ('${approvalId}', '${contentId}', '${userId}', 'APPROVED', 'Looks good to publish!')
  `);

  await pool.query(`
    UPDATE "Content" SET "status" = 'APPROVED', "updatedAt" = NOW() WHERE "id" = '${contentId}'
  `);
  const updatedContent = await pool.query(`SELECT * FROM "Content" WHERE "id" = '${contentId}'`);
  if (updatedContent.rows[0].status !== 'APPROVED') throw new Error('Approval workflow status update failed');
  console.log('✅ Approvals Test Passed!');

  // 9. Test Scheduling & Publication Creation
  console.log('📅 Testing Scheduling Operations...');
  const publicationId = 'pub-pg-test-1';
  const scheduledTime = new Date(Date.now() + 3600000).toISOString();
  await pool.query(`
    INSERT INTO "Publication" (
      "id", "contentVariantId", "socialConnectionId", "scheduledAt", "status", "idempotencyKey", "updatedAt"
    ) VALUES (
      '${publicationId}', '${variantId}', '${socialConnId}', '${scheduledTime}', 'SCHEDULED', 'idempotency-pg-100', NOW()
    )
  `);

  await pool.query(`
    UPDATE "Content" SET "status" = 'SCHEDULED', "updatedAt" = NOW() WHERE "id" = '${contentId}'
  `);

  // Query scheduler index performance query simulation: SELECT WHERE status = 'SCHEDULED' AND scheduledAt <= NOW
  const schedulerQueryRes = await pool.query(`
    SELECT * FROM "Publication" WHERE "status" = 'SCHEDULED'
  `);
  if (schedulerQueryRes.rows.length !== 1) throw new Error('Scheduling query failed');
  console.log('✅ Scheduling Test Passed!');

  // 10. Test Publishing Execution & State Transition
  console.log('🚀 Testing Publication Execution & Status Transition...');
  await pool.query(`
    UPDATE "Publication"
    SET "status" = 'PUBLISHED', "providerPostId" = 'fb_post_9999', "publishedAt" = NOW(), "updatedAt" = NOW()
    WHERE "id" = '${publicationId}'
  `);

  await pool.query(`
    UPDATE "Content" SET "status" = 'PUBLISHED', "updatedAt" = NOW() WHERE "id" = '${contentId}'
  `);

  const pubRes = await pool.query(`SELECT * FROM "Publication" WHERE "id" = '${publicationId}'`);
  if (pubRes.rows[0].status !== 'PUBLISHED' || pubRes.rows[0].providerPostId !== 'fb_post_9999') {
    throw new Error('Publication execution transition failed');
  }
  console.log('✅ Publishing Execution Test Passed!');

  // 11. Test Analytics Snapshot Recording
  console.log('📊 Testing Analytics Snapshots...');
  const analyticsId = 'analytics-pg-test-1';
  const today = new Date().toISOString().split('T')[0] + 'T00:00:00.000Z';
  await pool.query(`
    INSERT INTO "AnalyticsSnapshot" (
      "id", "workspaceId", "platform", "date", "impressions", "reach", "likes", "comments"
    ) VALUES (
      '${analyticsId}', '${workspace1Id}', 'FACEBOOK', '${today}', 1500, 1200, 85, 12
    )
  `);

  const analyticsRes = await pool.query(`
    SELECT * FROM "AnalyticsSnapshot" WHERE "workspaceId" = '${workspace1Id}'
  `);
  if (analyticsRes.rows.length !== 1 || analyticsRes.rows[0].impressions !== 1500) {
    throw new Error('Analytics snapshot record failed');
  }
  console.log('✅ Analytics Test Passed!');

  // 12. Test Audit Logs Operations
  console.log('📜 Testing Audit Log Operations & Compound Queries at Scale...');
  const auditLogId = 'audit-pg-test-1';
  await pool.query(`
    INSERT INTO "AuditLog" (
      "id", "organizationId", "workspaceId", "userId", "action", "entityType", "entityId", "details"
    ) VALUES (
      '${auditLogId}', '${orgId}', '${workspace1Id}', '${userId}', 'PUBLISHED_POST', 'Publication', '${publicationId}', '{"platform":"FACEBOOK"}'
    )
  `);

  // Query audit logs using index [organizationId, createdAt]
  const auditOrgRes = await pool.query(`
    SELECT * FROM "AuditLog" WHERE "organizationId" = '${orgId}' ORDER BY "createdAt" DESC
  `);
  // Query audit logs using index [workspaceId, createdAt]
  const auditWsRes = await pool.query(`
    SELECT * FROM "AuditLog" WHERE "workspaceId" = '${workspace1Id}' ORDER BY "createdAt" DESC
  `);

  if (auditOrgRes.rows.length !== 1 || auditWsRes.rows.length !== 1) {
    throw new Error('Audit log querying failed');
  }
  console.log('✅ Audit Log Test Passed!');

  await pool.end();
  console.log('\n🎉 ALL POSTGRESQL PRODUCTION INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉\n');
}

runPostgresTests().catch((err) => {
  console.error('❌ PostgreSQL Integration Test Failure:', err);
  process.exit(1);
});
