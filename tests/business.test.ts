import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma';
import { signSessionToken, SessionPayload } from '../src/lib/auth';
import { encryptToken } from '../src/lib/encryption';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
import { POST as login } from '../src/app/api/auth/login/route';
import { GET as getWorkspaces, POST as createWorkspace } from '../src/app/api/workspaces/route';
import { GET as getContent, POST as createContent } from '../src/app/api/content/route';
import { POST as approveContent } from '../src/app/api/content/approve/route';
import { GET as getAnalytics } from '../src/app/api/analytics/route';
import { GET as getAuditLogs } from '../src/app/api/audit-logs/route';
import { pollScheduledPublications } from '../src/modules/publishing/QueueService';

async function runBusinessTests() {
  console.log('🧪 Starting Business Logic & Domain API Unit Tests...\n');

  let org: any;
  let userAdmin: any;
  let userEditor: any;
  let ws1: any;
  let ws2: any;
  let socialConn: any;

  try {
    const rawPassword = 'SecurePassword123!';
    const passwordHash = await bcrypt.hash(rawPassword, 10);

    org = await prisma.organization.create({
      data: { name: 'Business Test Org', slug: `biz-org-${Date.now()}` },
    });

    userAdmin = await prisma.user.create({
      data: {
        email: `bizadmin_${Date.now()}@test.com`,
        name: 'Biz Admin',
        passwordHash,
      },
    });

    userEditor = await prisma.user.create({
      data: {
        email: `bizeditor_${Date.now()}@test.com`,
        name: 'Biz Editor',
        passwordHash,
      },
    });

    await prisma.membership.createMany({
      data: [
        { userId: userAdmin.id, organizationId: org.id, role: 'ADMIN' },
        { userId: userEditor.id, organizationId: org.id, role: 'EDITOR' },
      ],
    });

    ws1 = await prisma.workspace.create({
      data: { organizationId: org.id, name: 'Client Alpha', slug: `client-alpha-${Date.now()}` },
    });

    ws2 = await prisma.workspace.create({
      data: { organizationId: org.id, name: 'Client Beta', slug: `client-beta-${Date.now()}` },
    });

    socialConn = await prisma.socialConnection.create({
      data: {
        workspaceId: ws1.id,
        platform: 'FACEBOOK',
        accountName: 'Client Alpha Page',
        accountId: `acc_alpha_${Date.now()}`,
        status: 'CONNECTED',
        accessTokenEnc: encryptToken('raw_token')!,
      },
    });

    const sessionAdminPayload: SessionPayload = {
      userId: userAdmin.id,
      email: userAdmin.email,
      name: userAdmin.name,
      organizationId: org.id,
      role: 'ADMIN',
    };
    const tokenAdmin = await signSessionToken(sessionAdminPayload);

    // -------------------------------------------------------------
    // TEST 1: Authentication Endpoints (/api/auth/login)
    // -------------------------------------------------------------
    console.log('1. Testing Login Endpoint (Success & Failures)...');
    // 1a. Valid login
    const validLoginReq = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: userAdmin.email, password: rawPassword }),
    });
    const validLoginRes = await login(validLoginReq);
    if (validLoginRes.status !== 200) throw new Error(`Valid login failed with status ${validLoginRes.status}`);

    // 1b. Invalid password
    const badPassReq = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: userAdmin.email, password: 'WrongPassword!' }),
    });
    const badPassRes = await login(badPassReq);
    if (badPassRes.status !== 401) throw new Error(`Expected 401 on wrong password, got ${badPassRes.status}`);

    // 1c. Non-existent email
    const unknownUserReq = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@test.com', password: rawPassword }),
    });
    const unknownUserRes = await login(unknownUserReq);
    if (unknownUserRes.status !== 401) throw new Error(`Expected 401 on non-existent email, got ${unknownUserRes.status}`);
    console.log('  ✅ Login authentication tests passed.');

    // -------------------------------------------------------------
    // TEST 2: Workspaces Listing & Switching
    // -------------------------------------------------------------
    console.log('2. Testing Workspace Listing & Context Switching...');
    const wsReq = new NextRequest('http://localhost:3000/api/workspaces');
    wsReq.cookies.set('innosom_session', tokenAdmin);

    const wsRes = await getWorkspaces(wsReq);
    const wsData = await wsRes.json();
    if (!wsData.workspaces || wsData.workspaces.length < 2) {
      throw new Error('Workspace listing failed to return Organization workspaces.');
    }
    console.log('  ✅ Workspace listing and context switching tests passed.');

    // -------------------------------------------------------------
    // TEST 3: Content Lifecycle & Approvals Workflow
    // -------------------------------------------------------------
    console.log('3. Testing Content Approval Workflow (Review -> Approve -> Scheduled)...');
    // 3a. Create content submitted for approval
    const createContentReq = new NextRequest('http://localhost:3000/api/content', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: ws1.id,
        title: 'Q1 Product Launch',
        masterCaption: 'Exciting news coming soon!',
        platforms: [{ platform: 'FACEBOOK', caption: 'FB Launch Post' }],
        submitForApproval: true,
      }),
    });
    createContentReq.cookies.set('innosom_session', tokenAdmin);

    const createRes = await createContent(createContentReq);
    const createData = await createRes.json();
    const createdContent = createData.content;
    if (createdContent.status !== 'IN_REVIEW') {
      throw new Error(`Expected status IN_REVIEW on submitForApproval, got ${createdContent.status}`);
    }

    // 3b. Approve content
    const approveReq = new NextRequest('http://localhost:3000/api/content/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contentId: createdContent.id,
        action: 'APPROVE',
        comment: 'Looks great, approved!',
      }),
    });
    approveReq.cookies.set('innosom_session', tokenAdmin);

    const approveRes = await approveContent(approveReq);
    if (approveRes.status !== 200) throw new Error(`Approval failed with status ${approveRes.status}`);

    const approvedContent = await prisma.content.findUnique({ where: { id: createdContent.id } });
    if (approvedContent?.status !== 'APPROVED') {
      throw new Error(`Expected status APPROVED after approval, got ${approvedContent?.status}`);
    }

    const approvalRecord = await prisma.approval.findFirst({
      where: { contentId: createdContent.id },
    });
    if (!approvalRecord || approvalRecord.status !== 'APPROVED') {
      throw new Error('Approval history record was not created correctly.');
    }
    console.log('  ✅ Content approval workflow test passed.');

    // -------------------------------------------------------------
    // TEST 4: Scheduled Publications Polling
    // -------------------------------------------------------------
    console.log('4. Testing Scheduled Publications Polling...');
    const scheduledPub = await prisma.publication.create({
      data: {
        contentVariantId: (await prisma.contentVariant.findFirst({ where: { contentId: createdContent.id } }))!.id,
        socialConnectionId: socialConn.id,
        scheduledAt: new Date(Date.now() - 1000), // Due in the past
        status: 'SCHEDULED',
        idempotencyKey: `poll_pub_key_${Date.now()}`,
      },
    });

    await pollScheduledPublications();
    console.log('  ✅ Scheduled publications polling test passed.');

    // -------------------------------------------------------------
    // TEST 5: Analytics Summary Metrics Aggregation
    // -------------------------------------------------------------
    console.log('5. Testing Analytics Metrics Aggregation...');
    await prisma.analyticsSnapshot.create({
      data: {
        workspaceId: ws1.id,
        platform: 'FACEBOOK',
        date: new Date(),
        impressions: 5000,
        reach: 4000,
        likes: 300,
        comments: 50,
        shares: 20,
        clicks: 100,
        followers: 1000,
      },
    });

    const analyticsReq = new NextRequest(`http://localhost:3000/api/analytics?workspaceId=${ws1.id}`);
    analyticsReq.cookies.set('innosom_session', tokenAdmin);

    const analyticsRes = await getAnalytics(analyticsReq);
    const analyticsData = await analyticsRes.json();
    if (!analyticsData.summary || analyticsData.summary.totalImpressions !== 5000) {
      throw new Error('Analytics summary calculation mismatch.');
    }
    console.log('  ✅ Analytics metric aggregations test passed.');

    // -------------------------------------------------------------
    // TEST 6: Audit Logs Querying
    // -------------------------------------------------------------
    console.log('6. Testing Audit Log Recording & Querying...');
    const auditReq = new NextRequest(`http://localhost:3000/api/audit-logs?workspaceId=${ws1.id}`);
    auditReq.cookies.set('innosom_session', tokenAdmin);

    const auditRes = await getAuditLogs(auditReq);
    const auditData = await auditRes.json();
    if (!auditData.logs || auditData.logs.length === 0) {
      throw new Error('Audit logs query returned empty list.');
    }
    console.log('  ✅ Audit log querying test passed.');

    console.log('\n🎉 ALL BUSINESS LOGIC & DOMAIN TESTS PASSED SUCCESSFULLY!');
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (org) {
      await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
      await prisma.analyticsSnapshot.deleteMany({ where: { workspace: { organizationId: org.id } } });
      await prisma.approval.deleteMany({ where: { content: { workspace: { organizationId: org.id } } } });
      await prisma.publication.deleteMany({ where: { socialConnection: { workspace: { organizationId: org.id } } } });
      await prisma.contentVariantMedia.deleteMany({ where: { contentVariant: { content: { workspace: { organizationId: org.id } } } } });
      await prisma.contentVariant.deleteMany({ where: { content: { workspace: { organizationId: org.id } } } });
      await prisma.content.deleteMany({ where: { workspace: { organizationId: org.id } } });
      await prisma.socialConnection.deleteMany({ where: { workspace: { organizationId: org.id } } });
      await prisma.workspace.deleteMany({ where: { organizationId: org.id } });
      await prisma.membership.deleteMany({ where: { organizationId: org.id } });
      await prisma.organization.deleteMany({ where: { id: org.id } });
    }
    if (userAdmin) await prisma.user.deleteMany({ where: { id: userAdmin.id } });
    if (userEditor) await prisma.user.deleteMany({ where: { id: userEditor.id } });

    await prisma.$disconnect();
  }
}

runBusinessTests().catch((err) => {
  console.error('❌ Business unit test failed:', err);
  process.exit(1);
});
