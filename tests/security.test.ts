import { NextRequest } from 'next/server';
import { prisma } from '../src/lib/prisma';
import { signSessionToken, SessionPayload } from '../src/lib/auth';
import { GET as getContent, POST as createContent } from '../src/app/api/content/route';
import { GET as getMedia, POST as uploadMedia } from '../src/app/api/media/route';
import { GET as getSocialConns, POST as createSocialConn, DELETE as deleteSocialConn } from '../src/app/api/social-connections/route';
import { GET as getWorkspaces, POST as createWorkspace } from '../src/app/api/workspaces/route';
import { GET as getDashboard } from '../src/app/api/dashboard/route';
import { GET as getAnalytics } from '../src/app/api/analytics/route';
import { GET as getAuditLogs } from '../src/app/api/audit-logs/route';
import { POST as publishPublication } from '../src/app/api/publications/[id]/publish/route';
import { POST as retryPublication } from '../src/app/api/publications/[id]/retry/route';

async function runSecurityTests() {
  console.log('🧪 Starting Security & Authorization Unit Tests...\n');

  let orgA: any;
  let orgB: any;
  let userA: any;
  let userB: any;
  let editorA: any;
  let wsA: any;
  let wsB: any;
  let socialConnB: any;
  let contentB: any;
  let publicationB: any;

  try {
    // -------------------------------------------------------------
    // Setup Test Data (Org A vs Org B)
    // -------------------------------------------------------------
    orgA = await prisma.organization.create({
      data: { name: 'Security Test Org A', slug: `org-a-${Date.now()}` },
    });

    orgB = await prisma.organization.create({
      data: { name: 'Security Test Org B', slug: `org-b-${Date.now()}` },
    });

    userA = await prisma.user.create({
      data: {
        email: `usera_${Date.now()}@test.com`,
        name: 'User Org A',
        passwordHash: 'hashedpass',
      },
    });

    userB = await prisma.user.create({
      data: {
        email: `userb_${Date.now()}@test.com`,
        name: 'User Org B',
        passwordHash: 'hashedpass',
      },
    });

    editorA = await prisma.user.create({
      data: {
        email: `editora_${Date.now()}@test.com`,
        name: 'Editor Org A',
        passwordHash: 'hashedpass',
      },
    });

    await prisma.membership.createMany({
      data: [
        { userId: userA.id, organizationId: orgA.id, role: 'ADMIN' },
        { userId: editorA.id, organizationId: orgA.id, role: 'EDITOR' },
        { userId: userB.id, organizationId: orgB.id, role: 'ADMIN' },
      ],
    });

    wsA = await prisma.workspace.create({
      data: {
        organizationId: orgA.id,
        name: 'Workspace A',
        slug: `ws-a-${Date.now()}`,
      },
    });

    wsB = await prisma.workspace.create({
      data: {
        organizationId: orgB.id,
        name: 'Workspace B',
        slug: `ws-b-${Date.now()}`,
      },
    });

    socialConnB = await prisma.socialConnection.create({
      data: {
        workspaceId: wsB.id,
        platform: 'FACEBOOK',
        accountName: 'Org B Page',
        accountId: `acc_b_${Date.now()}`,
        status: 'CONNECTED',
        accessTokenEnc: 'enc_token_b',
      },
    });

    contentB = await prisma.content.create({
      data: {
        workspaceId: wsB.id,
        authorId: userB.id,
        title: 'Org B Secret Content',
        masterCaption: 'Top Secret B',
        status: 'DRAFT',
      },
    });

    const variantB = await prisma.contentVariant.create({
      data: {
        contentId: contentB.id,
        platform: 'FACEBOOK',
        caption: 'Top Secret B FB',
      },
    });

    publicationB = await prisma.publication.create({
      data: {
        contentVariantId: variantB.id,
        socialConnectionId: socialConnB.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `pub_key_b_${Date.now()}`,
      },
    });

    const sessionPayloadA: SessionPayload = {
      userId: userA.id,
      email: userA.email,
      name: userA.name,
      organizationId: orgA.id,
      role: 'ADMIN',
    };

    const sessionPayloadEditorA: SessionPayload = {
      userId: editorA.id,
      email: editorA.email,
      name: editorA.name,
      organizationId: orgA.id,
      role: 'EDITOR',
    };

    const tokenA = await signSessionToken(sessionPayloadA);
    const tokenEditorA = await signSessionToken(sessionPayloadEditorA);

    function makeReq(url: string, method: string = 'GET', body?: any, cookiesDict?: Record<string, string>) {
      const init: any = {
        method,
        headers: { 'content-type': 'application/json' },
      };
      if (body) {
        init.body = typeof body === 'string' ? body : JSON.stringify(body);
      }
      const req = new NextRequest(url, init);
      if (cookiesDict) {
        Object.entries(cookiesDict).forEach(([k, v]) => {
          req.cookies.set(k, v);
        });
      }
      return req;
    }

    // -------------------------------------------------------------
    // TEST 1: Unauthenticated API Requests (401 Unauthorized)
    // -------------------------------------------------------------
    console.log('1. Testing Unauthenticated Requests (401)...');
    const reqUnauth = makeReq('http://localhost:3000/api/content?workspaceId=' + wsA.id);
    const resUnauth = await getContent(reqUnauth);
    if (resUnauth.status !== 401) throw new Error(`Expected 401 on unauthenticated GET content, got ${resUnauth.status}`);
    console.log('  ✅ Unauthenticated request correctly rejected with 401.');

    // -------------------------------------------------------------
    // TEST 2: Invalid Session Token (401 Unauthorized)
    // -------------------------------------------------------------
    console.log('2. Testing Invalid Session Token (401)...');
    const reqInvalid = makeReq('http://localhost:3000/api/content?workspaceId=' + wsA.id, 'GET', null, {
      innosom_session: 'invalid.corrupted.token_string',
    });
    const resInvalid = await getContent(reqInvalid);
    if (resInvalid.status !== 401) throw new Error(`Expected 401 on invalid token, got ${resInvalid.status}`);
    console.log('  ✅ Invalid session token correctly rejected with 401.');

    // -------------------------------------------------------------
    // TEST 3: Expired Session Token (401 Unauthorized)
    // -------------------------------------------------------------
    console.log('3. Testing Expired Session Token (401)...');
    const expiredToken = await signSessionToken(sessionPayloadA, '-1s');
    const reqExpired = makeReq('http://localhost:3000/api/content?workspaceId=' + wsA.id, 'GET', null, {
      innosom_session: expiredToken,
    });
    const resExpired = await getContent(reqExpired);
    if (resExpired.status !== 401) throw new Error(`Expected 401 on expired token, got ${resExpired.status}`);
    console.log('  ✅ Expired session token correctly rejected with 401.');

    // -------------------------------------------------------------
    // TEST 4: Unauthorized Workspace Access (403 Forbidden)
    // -------------------------------------------------------------
    console.log('4. Testing Unauthorized Workspace Access (403)...');
    const reqCrossWs = makeReq('http://localhost:3000/api/content?workspaceId=' + wsB.id, 'GET', null, {
      innosom_session: tokenA,
    });
    const resCrossWs = await getContent(reqCrossWs);
    if (resCrossWs.status !== 403) throw new Error(`Expected 403 on cross-org workspace access, got ${resCrossWs.status}`);
    console.log('  ✅ Cross-org workspace access rejected with 403.');

    // -------------------------------------------------------------
    // TEST 5: Cross-Workspace Content Operations
    // -------------------------------------------------------------
    console.log('5. Testing Cross-Workspace Content Creation (403)...');
    const reqCreateCrossContent = makeReq('http://localhost:3000/api/content', 'POST', {
      workspaceId: wsB.id,
      title: 'Hacked Content',
      masterCaption: 'Attempting cross-workspace content injection',
      platforms: [{ platform: 'FACEBOOK' }],
    }, { innosom_session: tokenA });
    const resCreateCrossContent = await createContent(reqCreateCrossContent);
    if (resCreateCrossContent.status !== 403) throw new Error(`Expected 403 on cross-org content creation, got ${resCreateCrossContent.status}`);
    console.log('  ✅ Cross-workspace content creation blocked with 403.');

    // -------------------------------------------------------------
    // TEST 6: Cross-Workspace Media Operations
    // -------------------------------------------------------------
    console.log('6. Testing Cross-Workspace Media Fetch (403)...');
    const reqGetCrossMedia = makeReq('http://localhost:3000/api/media?workspaceId=' + wsB.id, 'GET', null, {
      innosom_session: tokenA,
    });
    const resGetCrossMedia = await getMedia(reqGetCrossMedia);
    if (resGetCrossMedia.status !== 403) throw new Error(`Expected 403 on cross-org media fetch, got ${resGetCrossMedia.status}`);
    console.log('  ✅ Cross-workspace media fetch blocked with 403.');

    // -------------------------------------------------------------
    // TEST 7: Cross-Workspace Social Connections
    // -------------------------------------------------------------
    console.log('7. Testing Cross-Workspace Social Connections Delete (403)...');
    const reqDelCrossConn = makeReq(`http://localhost:3000/api/social-connections?id=${socialConnB.id}`, 'DELETE', null, {
      innosom_session: tokenA,
    });
    const resDelCrossConn = await deleteSocialConn(reqDelCrossConn);
    if (resDelCrossConn.status !== 403) throw new Error(`Expected 403 on cross-org social connection deletion, got ${resDelCrossConn.status}`);
    console.log('  ✅ Cross-workspace social connection deletion blocked with 403.');

    // -------------------------------------------------------------
    // TEST 8: Cross-Workspace Publication Execution & Retry
    // -------------------------------------------------------------
    console.log('8. Testing Cross-Workspace Publication Publish & Retry (403)...');
    const reqCrossPub = makeReq(`http://localhost:3000/api/publications/${publicationB.id}/publish`, 'POST', null, {
      innosom_session: tokenA,
    });
    const resCrossPub = await publishPublication(reqCrossPub, { params: Promise.resolve({ id: publicationB.id }) });
    if (resCrossPub.status !== 403) throw new Error(`Expected 403 on cross-org publication publish, got ${resCrossPub.status}`);

    const reqCrossRetry = makeReq(`http://localhost:3000/api/publications/${publicationB.id}/retry`, 'POST', null, {
      innosom_session: tokenA,
    });
    const resCrossRetry = await retryPublication(reqCrossRetry, { params: Promise.resolve({ id: publicationB.id }) });
    if (resCrossRetry.status !== 403) throw new Error(`Expected 403 on cross-org publication retry, got ${resCrossRetry.status}`);
    console.log('  ✅ Cross-workspace publication trigger blocked with 403.');

    // -------------------------------------------------------------
    // TEST 9: Role Violation Enforcement (EDITOR vs ADMIN)
    // -------------------------------------------------------------
    console.log('9. Testing Role Violations (EDITOR workspace creation block)...');
    const reqCreateWsEditor = makeReq('http://localhost:3000/api/workspaces', 'POST', {
      name: 'Forbidden Workspace by Editor',
    }, { innosom_session: tokenEditorA });
    const resCreateWsEditor = await createWorkspace(reqCreateWsEditor);
    if (resCreateWsEditor.status !== 403) throw new Error(`Expected 403 for EDITOR role workspace creation, got ${resCreateWsEditor.status}`);
    console.log('  ✅ EDITOR role workspace creation blocked with 403.');

    const reqCreateWsAdmin = makeReq('http://localhost:3000/api/workspaces', 'POST', {
      name: 'Valid Workspace by Admin',
    }, { innosom_session: tokenA });
    const resCreateWsAdmin = await createWorkspace(reqCreateWsAdmin);
    if (resCreateWsAdmin.status !== 200) throw new Error(`Expected 200 for ADMIN role workspace creation, got ${resCreateWsAdmin.status}`);
    console.log('  ✅ ADMIN role workspace creation allowed with 200.');

    // -------------------------------------------------------------
    // TEST 10: ALL_CLIENTS Scope Isolation
    // -------------------------------------------------------------
    console.log('10. Testing ALL_CLIENTS Tenant Isolation...');
    const reqAllClientsContent = makeReq('http://localhost:3000/api/content?workspaceId=ALL_CLIENTS', 'GET', null, {
      innosom_session: tokenA,
    });
    const resAllClientsContent = await getContent(reqAllClientsContent);
    const bodyAllClients = await resAllClientsContent.json();

    const leakedContent = bodyAllClients.contents?.find((c: any) => c.id === contentB.id);
    if (leakedContent) {
      throw new Error('SECURITY VIOLATION: ALL_CLIENTS query leaked content belonging to another organization!');
    }
    console.log('  ✅ ALL_CLIENTS multi-tenant isolation verified (no Org B data leaked).');

    console.log('\n🎉 ALL SECURITY & AUTHORIZATION TESTS PASSED SUCCESSFULLY!');
  } finally {
    // Cleanup security test artifacts in dependency order
    const orgIds = [orgA?.id, orgB?.id].filter(Boolean);
    const userIds = [userA?.id, userB?.id, editorA?.id].filter(Boolean);

    if (orgIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
      await prisma.publication.deleteMany({ where: { socialConnection: { workspace: { organizationId: { in: orgIds } } } } });
      await prisma.contentVariantMedia.deleteMany({ where: { contentVariant: { content: { workspace: { organizationId: { in: orgIds } } } } } });
      await prisma.contentVariant.deleteMany({ where: { content: { workspace: { organizationId: { in: orgIds } } } } });
      await prisma.content.deleteMany({ where: { workspace: { organizationId: { in: orgIds } } } });
      await prisma.socialConnection.deleteMany({ where: { workspace: { organizationId: { in: orgIds } } } });
      await prisma.workspace.deleteMany({ where: { organizationId: { in: orgIds } } });
      await prisma.membership.deleteMany({ where: { organizationId: { in: orgIds } } });
      await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    }

    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }

    await prisma.$disconnect();
  }
}

runSecurityTests().catch((err) => {
  console.error('❌ Security unit test failed:', err);
  process.exit(1);
});
