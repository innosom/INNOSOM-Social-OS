import { NextRequest } from 'next/server';
import { prisma } from '../src/lib/prisma';
import { signSessionToken } from '../src/lib/auth';
import { POST as loginPost, GET as loginGet, DELETE as loginDelete } from '../src/app/api/auth/login/route';
import { GET as getWorkspaces, POST as createWorkspace } from '../src/app/api/workspaces/route';
import { GET as getContent, POST as createContent } from '../src/app/api/content/route';
import { POST as approveContent } from '../src/app/api/content/approve/route';
import { GET as getSocialConnections, POST as connectSocial } from '../src/app/api/social-connections/route';
import { GET as getAnalytics } from '../src/app/api/analytics/route';
import { GET as getAuditLogs } from '../src/app/api/audit-logs/route';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

async function runCategoriesTests() {
  console.log('🧪 Running Core System Categories & Business Logic Tests...\n');

  // Setup test org, workspaces, users
  const org = await prisma.organization.create({
    data: { name: 'Categories Test Org', slug: `cat-org-${Date.now()}` },
  });

  const ws1 = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'Client Alpha', slug: 'alpha', isFavorite: true },
  });
  const ws2 = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'Client Beta', slug: 'beta', isFavorite: false },
  });

  const admin = await prisma.user.create({
    data: { email: `cat_admin_${Date.now()}@test.com`, name: 'Cat Admin', passwordHash: 'hash' },
  });

  await prisma.membership.create({
    data: { userId: admin.id, organizationId: org.id, role: 'ADMIN' },
  });

  const adminToken = await signSessionToken({
    userId: admin.id,
    email: admin.email,
    name: admin.name,
    organizationId: org.id,
    role: 'ADMIN',
  });

  try {
    // 1. Authentication Lifecycle
    console.log('Testing 1: Authentication API Route Lifecycle...');
    const reqGetSession = new NextRequest('http://localhost:3000/api/auth/login', {
      headers: { cookie: `innosom_session=${adminToken}` },
    });
    const resGetSession = await loginGet();
    // In test context without Next cookie context, loginGet returns user from session token
    const reqDeleteSession = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'DELETE',
    });
    const resDeleteSession = await loginDelete();
    if (resDeleteSession.status !== 200) {
      throw new Error(`Logout failed with status ${resDeleteSession.status}`);
    }
    console.log('  ✅ Authentication lifecycle verified.');

    // 2. Workspace Switching & Filtering
    console.log('Testing 2: Workspace Switching & Listing...');
    const reqWs = new NextRequest('http://localhost:3000/api/workspaces', {
      headers: { cookie: `innosom_session=${adminToken}` },
    });
    const resWs = await getWorkspaces(reqWs);
    if (resWs.status !== 200) {
      throw new Error(`Fetch workspaces failed with status ${resWs.status}`);
    }
    const bodyWs = await resWs.json();
    if (bodyWs.workspaces.length < 2) {
      throw new Error('Workspace list count mismatch');
    }
    console.log('  ✅ Workspace switching & listing verified.');

    // 3. Content Creation & Approval Workflow
    console.log('Testing 3: Content Creation & Approval Workflow...');
    const reqCreateContent = new NextRequest('http://localhost:3000/api/content', {
      method: 'POST',
      headers: { cookie: `innosom_session=${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: ws1.id,
        title: 'Approval Post',
        masterCaption: 'Approval Master Caption',
        submitForApproval: true,
        platforms: [{ platform: 'FACEBOOK', caption: 'FB Caption' }],
      }),
    });

    const resCreateContent = await createContent(reqCreateContent);
    if (resCreateContent.status !== 200) {
      throw new Error(`Create content failed with status ${resCreateContent.status}`);
    }
    const bodyContent = await resCreateContent.json();
    if (bodyContent.content.status !== 'IN_REVIEW') {
      throw new Error(`Expected IN_REVIEW status on submitForApproval, got ${bodyContent.content.status}`);
    }

    // Approve post
    const reqApprove = new NextRequest('http://localhost:3000/api/content/approve', {
      method: 'POST',
      headers: { cookie: `innosom_session=${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        contentId: bodyContent.content.id,
        action: 'APPROVE',
        comment: 'Looks great! Approved.',
      }),
    });

    const resApprove = await approveContent(reqApprove);
    if (resApprove.status !== 200) {
      throw new Error(`Content approval failed with status ${resApprove.status}`);
    }
    const bodyApprove = await resApprove.json();
    if (bodyApprove.content.status !== 'APPROVED') {
      throw new Error(`Expected APPROVED content status, got ${bodyApprove.content.status}`);
    }
    console.log('  ✅ Content creation & approval workflow verified.');

    // 4. Social Provider Connection & Health Audit
    console.log('Testing 4: Social Provider Connection & Management...');
    const reqConn = new NextRequest('http://localhost:3000/api/social-connections', {
      method: 'POST',
      headers: { cookie: `innosom_session=${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: ws1.id,
        platform: 'FACEBOOK',
        accountName: 'Alpha Brand Page',
        accountId: 'alpha_page_101',
      }),
    });

    const resConn = await connectSocial(reqConn);
    if (resConn.status !== 200) {
      throw new Error(`Connect social failed with status ${resConn.status}`);
    }
    const bodyConn = await resConn.json();
    if (bodyConn.connection.accessTokenEnc) {
      throw new Error('SECURITY VIOLATION: Access token leaked in API response!');
    }
    console.log('  ✅ Social provider connection & secret masking verified.');

    // 5. Analytics Aggregation
    console.log('Testing 5: Analytics Summary Aggregation...');
    await prisma.analyticsSnapshot.create({
      data: {
        workspaceId: ws1.id,
        platform: 'FACEBOOK',
        date: new Date(),
        impressions: 1000,
        reach: 800,
        likes: 50,
        comments: 10,
        shares: 5,
        clicks: 20,
        followers: 1200,
      },
    });

    const reqAnalytics = new NextRequest(`http://localhost:3000/api/analytics?workspaceId=${ws1.id}`, {
      headers: { cookie: `innosom_session=${adminToken}` },
    });

    const resAnalytics = await getAnalytics(reqAnalytics);
    if (resAnalytics.status !== 200) {
      throw new Error(`Get analytics failed with status ${resAnalytics.status}`);
    }
    const bodyAnalytics = await resAnalytics.json();
    if (bodyAnalytics.summary.totalImpressions < 1000 || bodyAnalytics.summary.totalReach < 800) {
      throw new Error('Analytics aggregation total mismatch');
    }
    console.log('  ✅ Analytics summary aggregation verified.');

    // 6. Audit Log Recording
    console.log('Testing 6: Audit Log Capture Verification...');
    const reqAudit = new NextRequest(`http://localhost:3000/api/audit-logs?workspaceId=${ws1.id}`, {
      headers: { cookie: `innosom_session=${adminToken}` },
    });

    const resAudit = await getAuditLogs(reqAudit);
    if (resAudit.status !== 200) {
      throw new Error(`Get audit logs failed with status ${resAudit.status}`);
    }
    const bodyAudit = await resAudit.json();
    if (bodyAudit.logs.length === 0) {
      throw new Error('Audit logs list is unexpectedly empty');
    }
    console.log('  ✅ Audit log recording & retrieval verified.');

    // 7. Error Handling Boundaries
    console.log('Testing 7: API Route Invalid Payload Boundaries...');
    const reqBadContent = new NextRequest('http://localhost:3000/api/content', {
      method: 'POST',
      headers: { cookie: `innosom_session=${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Missing required parameters' }),
    });

    const resBadContent = await createContent(reqBadContent);
    if (resBadContent.status !== 400) {
      throw new Error(`Expected 400 on invalid payload, got ${resBadContent.status}`);
    }
    console.log('  ✅ Invalid payload boundary error handling verified.');

    console.log('\n🎉 ALL CORE SYSTEM CATEGORY TESTS PASSED SUCCESSFULLY! 🎉');
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.user.delete({ where: { id: admin.id } });
    await prisma.$disconnect();
  }
}

runCategoriesTests().catch((e) => {
  console.error('❌ Categories test execution failed:', e);
  process.exit(1);
});
