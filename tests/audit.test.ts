import { NextRequest } from 'next/server';
import { prisma } from '../src/lib/prisma';
import { signSessionToken, verifySessionToken, getSession } from '../src/lib/auth';
import { processPublicationJob } from '../src/modules/publishing/PublishingWorker';
import { POST as approveRoute } from '../src/app/api/content/approve/route';
import { POST as createContentRoute } from '../src/app/api/content/route';
import { GET as oauthCallbackRoute } from '../src/app/api/oauth/[provider]/callback/route';
import { POST as publishRoute } from '../src/app/api/publications/[id]/publish/route';
import { POST as retryRoute } from '../src/app/api/publications/[id]/retry/route';
import { POST as connectSocialRoute, DELETE as disconnectSocialRoute } from '../src/app/api/social-connections/route';

async function runAuditTests() {
  console.log('🧪 Starting Adversarial Security & Infrastructure Audit Test Suite...\n');

  // Setup test org and users
  const testOrg1 = await prisma.organization.create({
    data: { name: 'Audit Org 1', slug: `audit-org-1-${Date.now()}` },
  });

  const testOrg2 = await prisma.organization.create({
    data: { name: 'Audit Org 2', slug: `audit-org-2-${Date.now()}` },
  });

  const editorUser = await prisma.user.create({
    data: {
      email: `editor_${Date.now()}@org1.com`,
      name: 'Editor User',
      passwordHash: 'hash',
    },
  });

  const adminUser = await prisma.user.create({
    data: {
      email: `admin_${Date.now()}@org1.com`,
      name: 'Admin User',
      passwordHash: 'hash',
    },
  });

  const wsOrg1 = await prisma.workspace.create({
    data: { organizationId: testOrg1.id, name: 'Org 1 WS', slug: `org-1-ws-${Date.now()}` },
  });

  const wsOrg2 = await prisma.workspace.create({
    data: { organizationId: testOrg2.id, name: 'Org 2 WS', slug: `org-2-ws-${Date.now()}` },
  });

  const editorPayload = {
    userId: editorUser.id,
    email: editorUser.email,
    name: 'Editor User',
    organizationId: testOrg1.id,
    role: 'EDITOR',
  };

  const adminPayload = {
    userId: adminUser.id,
    email: adminUser.email,
    name: 'Admin User',
    organizationId: testOrg1.id,
    role: 'ADMIN',
  };

  const editorToken = await signSessionToken(editorPayload);
  const adminToken = await signSessionToken(adminPayload);

  try {
    // 1. RBAC Test: Editor cannot self-approve content
    console.log('Testing 1: RBAC Enforcement for Content Approvals...');
    const testContent = await prisma.content.create({
      data: {
        workspaceId: wsOrg1.id,
        authorId: editorPayload.userId,
        title: 'Unauthorized Approval Test Post',
        masterCaption: 'Test caption',
        status: 'IN_REVIEW',
      },
    });

    const approveReq = new NextRequest('http://localhost:3000/api/content/approve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `innosom_session=${editorToken}`,
      },
      body: JSON.stringify({ contentId: testContent.id, action: 'APPROVE' }),
    });

    const approveRes = await approveRoute(approveReq);
    if (approveRes.status !== 403) {
      throw new Error(`RBAC Failure: EDITOR user was able to trigger approval endpoint (status: ${approveRes.status})`);
    }
    console.log('✅ 1. RBAC Enforcement for Content Approvals Passed.');

    // 2. Editor scheduling restriction test: Editor attempting to bypass approval via scheduledAt
    console.log('Testing 2: Editor Scheduling Approval Bypass Prevention...');
    const createReq = new NextRequest('http://localhost:3000/api/content', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `innosom_session=${editorToken}`,
      },
      body: JSON.stringify({
        workspaceId: wsOrg1.id,
        title: 'Bypass Approval Test',
        masterCaption: 'Bypass caption',
        scheduledAt: new Date(Date.now() + 3600000).toISOString(),
        platforms: [{ platform: 'FACEBOOK', caption: 'Bypass caption' }],
      }),
    });

    const createRes = await createContentRoute(createReq);
    const createData = await createRes.json();
    if (createData.content.status === 'SCHEDULED') {
      throw new Error('Approval Bypass Failure: EDITOR created content directly with SCHEDULED status!');
    }
    if (createData.content.status !== 'IN_REVIEW') {
      throw new Error(`Expected status IN_REVIEW for EDITOR scheduled content, got ${createData.content.status}`);
    }
    console.log('✅ 2. Editor Scheduling Approval Bypass Prevention Passed.');

    // 3. Multi-Tenant Organization Isolation: Org 1 user accessing Org 2 Workspace
    console.log('Testing 3: Multi-Tenant Workspace Isolation...');
    const connSocialReq = new NextRequest('http://localhost:3000/api/social-connections', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `innosom_session=${adminToken}`,
      },
      body: JSON.stringify({
        workspaceId: wsOrg2.id, // Org 2 workspace
        platform: 'FACEBOOK',
        accountName: 'Cross Tenant Account',
        accountId: 'cross_tenant_1',
      }),
    });

    const connSocialRes = await connectSocialRoute(connSocialReq);
    if (connSocialRes.status !== 403) {
      throw new Error(`Tenant Isolation Failure: User in Org 1 accessed Org 2 workspace (status: ${connSocialRes.status})`);
    }
    console.log('✅ 3. Multi-Tenant Workspace Isolation Passed.');

    // 4. OAuth Callback Session & Workspace Validation
    console.log('Testing 4: OAuth Callback Session Validation...');
    const nonce = 'test_nonce_12345';
    const stateData = JSON.stringify({
      workspaceId: wsOrg2.id, // Target Org 2 workspace
      provider: 'facebook',
      nonce,
      userId: editorPayload.userId,
    });
    const stateParam = Buffer.from(stateData).toString('base64url');

    const oauthCallbackReq = new NextRequest(
      `http://localhost:3000/api/oauth/facebook/callback?code=mock_code&state=${stateParam}`,
      {
        headers: {
          cookie: `oauth_state_facebook=${nonce}; innosom_session=${editorToken}`, // Org 1 user
        },
      }
    );

    const oauthCallbackRes = await oauthCallbackRoute(oauthCallbackReq, {
      params: Promise.resolve({ provider: 'facebook' }),
    });

    const redirectUrl = oauthCallbackRes.headers.get('location') || '';
    if (!redirectUrl.includes('Forbidden') && !redirectUrl.includes('error')) {
      throw new Error(`OAuth State Exploit Failure: OAuth callback permitted cross-workspace connection! Redirect URL: ${redirectUrl}`);
    }
    console.log('✅ 4. OAuth Callback Session Validation Passed.');

    // 5. Unapproved Publication Execution Prevention
    console.log('Testing 5: Unapproved Publication Execution Restriction...');
    const draftContent = await prisma.content.create({
      data: {
        workspaceId: wsOrg1.id,
        authorId: editorPayload.userId,
        title: 'Draft Post',
        masterCaption: 'Draft',
        status: 'DRAFT',
      },
    });

    const variant = await prisma.contentVariant.create({
      data: { contentId: draftContent.id, platform: 'FACEBOOK', caption: 'Draft' },
    });

    const conn = await prisma.socialConnection.create({
      data: {
        workspaceId: wsOrg1.id,
        platform: 'FACEBOOK',
        accountName: 'Audit Test Page',
        accountId: 'audit_page_1',
        accessTokenEnc: 'enc_token_mock_audit',
      },
    });

    const draftPub = await prisma.publication.create({
      data: {
        contentVariantId: variant.id,
        socialConnectionId: conn.id,
        scheduledAt: new Date(),
        status: 'DRAFT',
        idempotencyKey: `audit_draft_pub_${Date.now()}`,
      },
    });

    const triggerPubReq = new NextRequest(`http://localhost:3000/api/publications/${draftPub.id}/publish`, {
      method: 'POST',
      headers: { cookie: `innosom_session=${adminToken}` },
    });

    const triggerPubRes = await publishRoute(triggerPubReq, {
      params: Promise.resolve({ id: draftPub.id }),
    });

    if (triggerPubRes.status !== 400) {
      throw new Error(`Publishing Safety Failure: Direct publish triggered for unapproved content (status: ${triggerPubRes.status})`);
    }
    console.log('✅ 5. Unapproved Publication Execution Restriction Passed.');

    // 6. Publication Retry Restrictions
    console.log('Testing 6: Publication Retry Restrictions...');
    const scheduledPub = await prisma.publication.create({
      data: {
        contentVariantId: variant.id,
        socialConnectionId: conn.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `audit_sched_pub_${Date.now()}`,
      },
    });

    const retryReq = new NextRequest(`http://localhost:3000/api/publications/${scheduledPub.id}/retry`, {
      method: 'POST',
      headers: { cookie: `innosom_session=${adminToken}` },
    });

    const retryRes = await retryRoute(retryReq, {
      params: Promise.resolve({ id: scheduledPub.id }),
    });

    if (retryRes.status !== 400) {
      throw new Error(`Publication Retry Failure: Non-failed publication was allowed to be retried (status: ${retryRes.status})`);
    }
    console.log('✅ 6. Publication Retry Restrictions Passed.');

    // Clean up test data
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: [testOrg1.id, testOrg2.id] } } });
    await prisma.publication.deleteMany({ where: { socialConnectionId: conn.id } });
    await prisma.contentVariant.deleteMany({ where: { contentId: draftContent.id } });
    await prisma.content.deleteMany({ where: { workspaceId: { in: [wsOrg1.id, wsOrg2.id] } } });
    await prisma.socialConnection.deleteMany({ where: { id: conn.id } });
    await prisma.workspace.deleteMany({ where: { id: { in: [wsOrg1.id, wsOrg2.id] } } });
    await prisma.membership.deleteMany({ where: { organizationId: { in: [testOrg1.id, testOrg2.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [editorUser.id, adminUser.id] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [testOrg1.id, testOrg2.id] } } });

    console.log('\n🎉 ALL ADVERSARIAL SECURITY AUDIT TESTS PASSED SUCCESSFULLY! 🎉');
  } finally {
    await prisma.$disconnect();
  }
}

runAuditTests().catch((err) => {
  console.error('❌ Adversarial Security Audit Test Failed:', err);
  process.exit(1);
});
