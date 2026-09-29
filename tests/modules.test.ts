import assert from 'node:assert';
import { prisma } from '../src/lib/prisma';
import { signSessionToken, SessionPayload } from '../src/lib/auth';
import { encryptToken } from '../src/lib/encryption';
import { POST as approveContent } from '../src/app/api/content/approve/route';
import { GET as getAnalytics } from '../src/app/api/analytics/route';
import { GET as getAuditLogs } from '../src/app/api/audit-logs/route';
import { NextRequest } from 'next/server';

async function runModulesTests() {
  console.log('🧪 Running Business Workflow Modules Tests (Approvals, Analytics, Audit Logs)...');

  let org = await prisma.organization.findFirst({ where: { slug: 'innosom' } });
  if (!org) {
    org = await prisma.organization.create({
      data: { name: 'INNOSOM Primary Org', slug: 'innosom' },
    });
  }

  let managerUser = await prisma.user.findFirst({ where: { email: 'mod_manager@innosom.com' } });
  if (!managerUser) {
    managerUser = await prisma.user.create({
      data: {
        email: 'mod_manager@innosom.com',
        name: 'Workflow Manager',
        passwordHash: 'hash123',
      },
    });
  }

  let ws = await prisma.workspace.create({
    data: {
      organizationId: org.id,
      name: `Modules WS ${Date.now()}`,
      slug: `modules-ws-${Date.now()}`,
    },
  });

  const session: SessionPayload = {
    userId: managerUser.id,
    email: managerUser.email,
    name: managerUser.name,
    organizationId: org.id,
    role: 'MANAGER',
  };

  const validToken = await signSessionToken(session);

  // 1. Content Review & Approval Pipeline
  console.log('Testing 1: Content Review & Approval Pipeline...');

  const content = await prisma.content.create({
    data: {
      workspaceId: ws.id,
      authorId: managerUser.id,
      title: 'Approval Review Post',
      masterCaption: 'Pending manager approval caption',
      status: 'IN_REVIEW',
    },
  });

  const socialConn = await prisma.socialConnection.create({
    data: {
      workspaceId: ws.id,
      platform: 'facebook',
      accountName: 'Modules FB Page',
      accountId: `fb_mod_${Date.now()}`,
      accessTokenEnc: encryptToken('mock_access_token_123'),
    },
  });

  const variant = await prisma.contentVariant.create({
    data: {
      contentId: content.id,
      platform: 'facebook',
      caption: 'FB Approval Caption',
    },
  });

  // Call approve endpoint
  const approveReq = new NextRequest('http://localhost:3000/api/content/approve', {
    method: 'POST',
    body: JSON.stringify({
      contentId: content.id,
      action: 'APPROVE',
      comment: 'Approved for publishing by manager',
    }),
  });
  approveReq.cookies.set('innosom_session', validToken);

  const approveRes = await approveContent(approveReq);
  assert.strictEqual(approveRes.status, 200, 'Content approval should return HTTP 200');

  const approveData = await approveRes.json();
  assert.strictEqual(approveData.content?.status, 'APPROVED', 'Content status should transition to APPROVED');

  // Verify approval record created in DB
  const approvalRecord = await prisma.approval.findFirst({
    where: { contentId: content.id },
  });
  assert.ok(approvalRecord, 'Approval record must be created');
  assert.strictEqual(approvalRecord?.status, 'APPROVED');
  assert.strictEqual(approvalRecord?.comment, 'Approved for publishing by manager');

  console.log('  ✅ Content review & approval pipeline tests passed');

  // 2. Analytics Aggregations
  console.log('Testing 2: Analytics Query Aggregations...');

  const today = new Date();
  await prisma.analyticsSnapshot.create({
    data: {
      workspaceId: ws.id,
      platform: 'facebook',
      date: today,
      impressions: 5000,
      reach: 3500,
      likes: 450,
      comments: 60,
      shares: 25,
      clicks: 120,
    },
  });

  const analyticsReq = new NextRequest(`http://localhost:3000/api/analytics?workspaceId=${ws.id}`);
  analyticsReq.cookies.set('innosom_session', validToken);

  const analyticsRes = await getAnalytics(analyticsReq);
  assert.strictEqual(analyticsRes.status, 200, 'Analytics endpoint should return HTTP 200');

  const analyticsData = await analyticsRes.json();
  assert.ok(analyticsData.snapshots || analyticsData.analytics, 'Response should contain analytics data');

  console.log('  ✅ Analytics aggregation tests passed');

  // 3. Automated Audit Log Logging & Query Filtering
  console.log('Testing 3: Automated Audit Log Logging & Filtering...');

  const auditReq = new NextRequest(`http://localhost:3000/api/audit-logs?workspaceId=${ws.id}`);
  auditReq.cookies.set('innosom_session', validToken);

  const auditRes = await getAuditLogs(auditReq);
  assert.strictEqual(auditRes.status, 200, 'Audit log query should return HTTP 200');

  const auditData = await auditRes.json();
  assert.ok(Array.isArray(auditData.logs || auditData.auditLogs), 'Audit log response should contain logs array');

  // Verify that approval action emitted an audit log entry
  const logsList = auditData.logs || auditData.auditLogs || [];
  const hasApprovalAuditLog = logsList.some(
    (log: any) => log.action === 'APPROVE_CONTENT' && log.entityId === content.id
  );
  assert.ok(hasApprovalAuditLog, 'APPROVE_CONTENT action must be present in audit logs');

  console.log('  ✅ Automated audit log logging & filtering tests passed');

  // Wait brief moment for background job execution to complete before cleanup
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Cleanup workspace
  await prisma.workspace.delete({ where: { id: ws.id } });

  console.log('🎉 ALL BUSINESS WORKFLOW MODULES TESTS PASSED SUCCESSFULLY!');
}

runModulesTests()
  .catch((e) => {
    console.error('❌ Modules tests failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
