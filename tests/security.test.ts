import { NextRequest } from 'next/server';
import { prisma } from '../src/lib/prisma';
import { signSessionToken } from '../src/lib/auth';
import { GET as getWorkspaces, POST as createWorkspace } from '../src/app/api/workspaces/route';
import { GET as getContent, POST as createContent } from '../src/app/api/content/route';
import { GET as getMedia, POST as uploadMedia } from '../src/app/api/media/route';
import { GET as getSocialConns, POST as createSocialConn, DELETE as deleteSocialConn } from '../src/app/api/social-connections/route';
import { POST as approveContent } from '../src/app/api/content/approve/route';
import { POST as triggerPublish } from '../src/app/api/publications/[id]/publish/route';
import { GET as getAnalytics } from '../src/app/api/analytics/route';
import { GET as getAuditLogs } from '../src/app/api/audit-logs/route';
import { SignJWT } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'innosom-super-secret-jwt-encryption-key-32-bytes!!'
);

function makeReq(url: string, options: { method?: string; body?: any; token?: string; formData?: FormData } = {}) {
  const headers: Record<string, string> = {};
  if (options.token) {
    headers['cookie'] = `innosom_session=${options.token}`;
  }
  let bodyStr: string | undefined = undefined;
  if (options.body) {
    headers['content-type'] = 'application/json';
    bodyStr = JSON.stringify(options.body);
  }

  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: options.method || 'GET',
    headers,
    body: options.formData ? (options.formData as any) : bodyStr,
  });
}

async function runSecurityTests() {
  console.log('🧪 Running Comprehensive Security & Authorization Tests...\n');

  // Setup test organizations, workspaces, and users
  const org1 = await prisma.organization.create({
    data: { name: 'Org 1 Security Test', slug: `org-1-sec-${Date.now()}` },
  });

  const org2 = await prisma.organization.create({
    data: { name: 'Org 2 Security Test', slug: `org-2-sec-${Date.now()}` },
  });

  const user1 = await prisma.user.create({
    data: {
      email: `user1-sec-${Date.now()}@test.com`,
      name: 'User 1 Admin Org1',
      passwordHash: 'hashed',
    },
  });

  const user2Editor = await prisma.user.create({
    data: {
      email: `user2-editor-${Date.now()}@test.com`,
      name: 'User 2 Editor Org1',
      passwordHash: 'hashed',
    },
  });

  const user3Org2 = await prisma.user.create({
    data: {
      email: `user3-org2-${Date.now()}@test.com`,
      name: 'User 3 Admin Org2',
      passwordHash: 'hashed',
    },
  });

  await prisma.membership.createMany({
    data: [
      { userId: user1.id, organizationId: org1.id, role: 'ADMIN' },
      { userId: user2Editor.id, organizationId: org1.id, role: 'EDITOR' },
      { userId: user3Org2.id, organizationId: org2.id, role: 'ADMIN' },
    ],
  });

  const wsOrg1 = await prisma.workspace.create({
    data: {
      organizationId: org1.id,
      name: 'WS Org 1',
      slug: `ws-org-1-${Date.now()}`,
    },
  });

  const wsOrg2 = await prisma.workspace.create({
    data: {
      organizationId: org2.id,
      name: 'WS Org 2',
      slug: `ws-org-2-${Date.now()}`,
    },
  });

  const tokenUser1 = await signSessionToken({
    userId: user1.id,
    email: user1.email,
    name: user1.name,
    organizationId: org1.id,
    role: 'ADMIN',
  });

  const tokenUser2Editor = await signSessionToken({
    userId: user2Editor.id,
    email: user2Editor.email,
    name: user2Editor.name,
    organizationId: org1.id,
    role: 'EDITOR',
  });

  const tokenUser3Org2 = await signSessionToken({
    userId: user3Org2.id,
    email: user3Org2.email,
    name: user3Org2.name,
    organizationId: org2.id,
    role: 'ADMIN',
  });

  const expiredToken = await new SignJWT({
    userId: user1.id,
    email: user1.email,
    name: user1.name,
    organizationId: org1.id,
    role: 'ADMIN',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 100)
    .sign(JWT_SECRET);

  try {
    // 1. Unauthenticated API requests
    console.log('Testing Unauthenticated Requests...');
    const resUnauthGet = await getWorkspaces(makeReq('http://localhost:3000/api/workspaces'));
    if (resUnauthGet.status !== 401) throw new Error('Unauthenticated GET request did not return 401');

    const resUnauthPost = await createContent(
      makeReq('http://localhost:3000/api/content', { method: 'POST', body: { title: 'Test' } })
    );
    if (resUnauthPost.status !== 401) throw new Error('Unauthenticated POST request did not return 401');

    console.log('✅ Unauthenticated requests rejected with 401.');

    // 2. Invalid session token
    console.log('Testing Invalid Session Token...');
    const resInvalidSession = await getContent(
      makeReq('http://localhost:3000/api/content', { token: 'invalid.jwt.token' })
    );
    if (resInvalidSession.status !== 401) throw new Error('Invalid session token did not return 401');
    console.log('✅ Invalid session token rejected with 401.');

    // 3. Expired session token
    console.log('Testing Expired Session Token...');
    const resExpiredSession = await getMedia(
      makeReq('http://localhost:3000/api/media', { token: expiredToken })
    );
    if (resExpiredSession.status !== 401) throw new Error('Expired session token did not return 401');
    console.log('✅ Expired session token rejected with 401.');

    // 4. Role violations
    console.log('Testing Role Violations (EDITOR attempting workspace creation)...');
    const resRoleViolation = await createWorkspace(
      makeReq('http://localhost:3000/api/workspaces', {
        method: 'POST',
        token: tokenUser2Editor,
        body: { name: 'Forbidden Workspace' },
      })
    );
    if (resRoleViolation.status !== 403) {
      throw new Error(`Role violation allowed or wrong status: expected 403, got ${resRoleViolation.status}`);
    }
    console.log('✅ Role violation correctly rejected with 403.');

    // 5. Unauthorized cross-workspace & cross-organization access
    console.log('Testing Cross-Workspace & Cross-Org Isolation...');

    // User 1 (Org 1) attempting to access Org 2's workspace content
    const resCrossWorkspaceContent = await getContent(
      makeReq(`http://localhost:3000/api/content?workspaceId=${wsOrg2.id}`, { token: tokenUser1 })
    );
    if (resCrossWorkspaceContent.status !== 403) {
      throw new Error(`Cross-workspace content access allowed: got ${resCrossWorkspaceContent.status}`);
    }

    // User 1 attempting to access Org 2's media
    const resCrossWorkspaceMedia = await getMedia(
      makeReq(`http://localhost:3000/api/media?workspaceId=${wsOrg2.id}`, { token: tokenUser1 })
    );
    if (resCrossWorkspaceMedia.status !== 403) {
      throw new Error(`Cross-workspace media access allowed: got ${resCrossWorkspaceMedia.status}`);
    }

    // User 1 attempting to access Org 2's social connections
    const resCrossWorkspaceSocial = await getSocialConns(
      makeReq(`http://localhost:3000/api/social-connections?workspaceId=${wsOrg2.id}`, { token: tokenUser1 })
    );
    if (resCrossWorkspaceSocial.status !== 403) {
      throw new Error(`Cross-workspace social connection access allowed: got ${resCrossWorkspaceSocial.status}`);
    }

    // User 1 attempting to connect social account to Org 2's workspace
    const resCrossConnectSocial = await createSocialConn(
      makeReq('http://localhost:3000/api/social-connections', {
        method: 'POST',
        token: tokenUser1,
        body: { workspaceId: wsOrg2.id, platform: 'FACEBOOK', accountName: 'Hack', accountId: 'hack1' },
      })
    );
    if (resCrossConnectSocial.status !== 403) {
      throw new Error(`Cross-workspace social connection creation allowed: got ${resCrossConnectSocial.status}`);
    }

    // User 1 attempting to create content in Org 2's workspace
    const resCrossCreateContent = await createContent(
      makeReq('http://localhost:3000/api/content', {
        method: 'POST',
        token: tokenUser1,
        body: {
          workspaceId: wsOrg2.id,
          title: 'Unauthorized Content',
          masterCaption: 'Hack',
          platforms: [{ platform: 'FACEBOOK' }],
        },
      })
    );
    if (resCrossCreateContent.status !== 403) {
      throw new Error(`Cross-workspace content creation allowed: got ${resCrossCreateContent.status}`);
    }

    console.log('✅ Cross-workspace / Cross-org access attempts properly blocked with 403.');

    // 6. ALL_CLIENTS multi-tenant isolation (ALL_CLIENTS abuse test)
    console.log('Testing ALL_CLIENTS Multi-Tenant Scope Boundaries...');
    // Create content in Org 2
    const contentOrg2 = await prisma.content.create({
      data: {
        workspaceId: wsOrg2.id,
        authorId: user3Org2.id,
        title: 'Org 2 Secret Post',
        masterCaption: 'Org 2 Caption',
        status: 'DRAFT',
      },
    });

    // Create content in Org 1
    const contentOrg1 = await prisma.content.create({
      data: {
        workspaceId: wsOrg1.id,
        authorId: user1.id,
        title: 'Org 1 Public Post',
        masterCaption: 'Org 1 Caption',
        status: 'DRAFT',
      },
    });

    // Query content with ALL_CLIENTS using User 1 (Org 1)
    const resAllClientsOrg1 = await getContent(
      makeReq('http://localhost:3000/api/content?workspaceId=ALL_CLIENTS', { token: tokenUser1 })
    );
    const bodyAllClientsOrg1 = await resAllClientsOrg1.json();
    const contentsOrg1Fetched = bodyAllClientsOrg1.contents || [];

    const foundOrg2Content = contentsOrg1Fetched.some((c: any) => c.id === contentOrg2.id);
    if (foundOrg2Content) {
      throw new Error('SECURITY VIOLATION: User 1 accessed Org 2 content via ALL_CLIENTS mode!');
    }

    const foundOrg1Content = contentsOrg1Fetched.some((c: any) => c.id === contentOrg1.id);
    if (!foundOrg1Content) {
      throw new Error('User 1 failed to access Org 1 content via ALL_CLIENTS mode.');
    }
    console.log('✅ ALL_CLIENTS query strictly isolated within user organization.');

    // 7. Cross-workspace approval & publication triggers
    console.log('Testing Cross-Workspace Approval & Trigger Executions...');
    // User 1 attempting to approve Org 2's content
    const resApproveCross = await approveContent(
      makeReq('http://localhost:3000/api/content/approve', {
        method: 'POST',
        token: tokenUser1,
        body: { contentId: contentOrg2.id, action: 'APPROVE' },
      })
    );
    if (resApproveCross.status !== 403) {
      throw new Error(`Cross-workspace content approval allowed: got ${resApproveCross.status}`);
    }

    // Create social connection & publication for Org 2
    const connOrg2 = await prisma.socialConnection.create({
      data: {
        workspaceId: wsOrg2.id,
        platform: 'FACEBOOK',
        accountName: 'Org2 FB',
        accountId: 'fb_org_2',
        accessTokenEnc: 'enc_token',
      },
    });

    const variantOrg2 = await prisma.contentVariant.create({
      data: {
        contentId: contentOrg2.id,
        platform: 'FACEBOOK',
        caption: 'Org 2 Caption',
      },
    });

    const pubOrg2 = await prisma.publication.create({
      data: {
        contentVariantId: variantOrg2.id,
        socialConnectionId: connOrg2.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `pub_cross_test_${Date.now()}`,
      },
    });

    // User 1 attempting to trigger publication of Org 2's publication
    const resTriggerCross = await triggerPublish(
      makeReq(`http://localhost:3000/api/publications/${pubOrg2.id}/publish`, {
        method: 'POST',
        token: tokenUser1,
      }),
      { params: Promise.resolve({ id: pubOrg2.id }) }
    );
    if (resTriggerCross.status !== 403) {
      throw new Error(`Cross-workspace publication execution allowed: got ${resTriggerCross.status}`);
    }
    console.log('✅ Cross-workspace approvals & triggers properly blocked with 403.');

    // 8. Analytics & Audit Logs Scoping
    console.log('Testing Analytics & Audit Logs Scoping...');
    const resAnalyticsCross = await getAnalytics(
      makeReq(`http://localhost:3000/api/analytics?workspaceId=${wsOrg2.id}`, { token: tokenUser1 })
    );
    if (resAnalyticsCross.status !== 403) {
      throw new Error(`Cross-workspace analytics access allowed: got ${resAnalyticsCross.status}`);
    }

    const resAuditLogsCross = await getAuditLogs(
      makeReq(`http://localhost:3000/api/audit-logs?workspaceId=${wsOrg2.id}`, { token: tokenUser1 })
    );
    if (resAuditLogsCross.status !== 403) {
      throw new Error(`Cross-workspace audit logs access allowed: got ${resAuditLogsCross.status}`);
    }
    console.log('✅ Analytics and Audit Logs cross-org requests properly blocked.');

    // Clean up test data
    await prisma.publication.deleteMany({ where: { id: pubOrg2.id } });
    await prisma.contentVariant.deleteMany({ where: { id: variantOrg2.id } });
    await prisma.socialConnection.deleteMany({ where: { id: connOrg2.id } });
    await prisma.content.deleteMany({ where: { id: { in: [contentOrg1.id, contentOrg2.id] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [wsOrg1.id, wsOrg2.id] } } });
    await prisma.membership.deleteMany({ where: { userId: { in: [user1.id, user2Editor.id, user3Org2.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [user1.id, user2Editor.id, user3Org2.id] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [org1.id, org2.id] } } });

    console.log('\n🎉 ALL SECURITY & AUTHORIZATION TESTS PASSED SUCCESSFULLY! 🎉');
  } finally {
    await prisma.$disconnect();
  }
}

runSecurityTests().catch((e) => {
  console.error('❌ Security tests failed:', e);
  process.exit(1);
});
