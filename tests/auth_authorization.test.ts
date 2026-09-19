import { NextRequest } from 'next/server';
import { prisma } from '../src/lib/prisma';
import { signSessionToken, SessionPayload } from '../src/lib/auth';
import { GET as getContent, POST as createContent } from '../src/app/api/content/route';
import { POST as approveContent } from '../src/app/api/content/approve/route';
import { POST as createWorkspace } from '../src/app/api/workspaces/route';
import { POST as uploadMedia } from '../src/app/api/media/route';
import { POST as connectSocial, DELETE as disconnectSocial } from '../src/app/api/social-connections/route';

async function runAuthAuthorizationTests() {
  console.log('\n🔒 Running Authentication & Authorization Security Tests...');
  let totalTests = 0;
  let passedTests = 0;

  // Helper to construct request with optional session cookie
  function makeReq(url: string, method: string = 'GET', body?: any, token?: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['cookie'] = `innosom_session=${token}`;
    }
    return new NextRequest(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  // Setup test organizations, workspaces, and users
  const orgA = await prisma.organization.create({
    data: { name: 'Auth Test Org A', slug: `auth-org-a-${Date.now()}` },
  });
  const orgB = await prisma.organization.create({
    data: { name: 'Auth Test Org B', slug: `auth-org-b-${Date.now()}` },
  });

  const wsA1 = await prisma.workspace.create({
    data: { organizationId: orgA.id, name: 'Client A1', slug: 'client-a1' },
  });
  const wsB1 = await prisma.workspace.create({
    data: { organizationId: orgB.id, name: 'Client B1', slug: 'client-b1' },
  });

  const userAdminA = await prisma.user.create({
    data: { name: 'Admin A', email: `admin-a-${Date.now()}@test.com`, passwordHash: 'hash' },
  });
  const userEditorA = await prisma.user.create({
    data: { name: 'Editor A', email: `editor-a-${Date.now()}@test.com`, passwordHash: 'hash' },
  });
  const userViewerA = await prisma.user.create({
    data: { name: 'Viewer A', email: `viewer-a-${Date.now()}@test.com`, passwordHash: 'hash' },
  });

  await prisma.membership.createMany({
    data: [
      { userId: userAdminA.id, organizationId: orgA.id, role: 'ADMIN' },
      { userId: userEditorA.id, organizationId: orgA.id, role: 'EDITOR' },
      { userId: userViewerA.id, organizationId: orgA.id, role: 'VIEWER' },
    ],
  });

  const tokenAdminA = await signSessionToken({
    userId: userAdminA.id,
    email: userAdminA.email,
    name: userAdminA.name,
    organizationId: orgA.id,
    role: 'ADMIN',
  });

  const tokenEditorA = await signSessionToken({
    userId: userEditorA.id,
    email: userEditorA.email,
    name: userEditorA.name,
    organizationId: orgA.id,
    role: 'EDITOR',
  });

  const tokenViewerA = await signSessionToken({
    userId: userViewerA.id,
    email: userViewerA.email,
    name: userViewerA.name,
    organizationId: orgA.id,
    role: 'VIEWER',
  });

  try {
    // 1. Unauthenticated API request
    totalTests++;
    const unauthReq = makeReq('http://localhost:3000/api/content');
    const unauthRes = await getContent(unauthReq);
    if (unauthRes.status !== 401) {
      throw new Error(`Expected status 401 for unauthenticated request, got ${unauthRes.status}`);
    }
    passedTests++;
    console.log('  ✅ 1. Unauthenticated API request returned 401 Unauthorized');

    // 2. Invalid session token
    totalTests++;
    const invalidTokenReq = makeReq('http://localhost:3000/api/content', 'GET', undefined, 'invalid_malformed_token_123');
    const invalidTokenRes = await getContent(invalidTokenReq);
    if (invalidTokenRes.status !== 401) {
      throw new Error(`Expected status 401 for invalid session token, got ${invalidTokenRes.status}`);
    }
    passedTests++;
    console.log('  ✅ 2. Invalid session token returned 401 Unauthorized');

    // 3. Tenant Isolation: User in Org A attempting to access Workspace in Org B
    totalTests++;
    const crossOrgReq = makeReq(`http://localhost:3000/api/content?workspaceId=${wsB1.id}`, 'GET', undefined, tokenAdminA);
    const crossOrgRes = await getContent(crossOrgReq);
    if (crossOrgRes.status !== 403) {
      throw new Error(`Expected status 403 for cross-organization access, got ${crossOrgRes.status}`);
    }
    passedTests++;
    console.log('  ✅ 3. Tenant isolation enforced: Cross-organization access returned 403 Forbidden');

    // 4. Role Violation: VIEWER attempting to create content
    totalTests++;
    const viewerCreateReq = makeReq('http://localhost:3000/api/content', 'POST', {
      workspaceId: wsA1.id,
      title: 'Viewer Post',
      masterCaption: 'Viewer Caption',
      platforms: [{ platform: 'FACEBOOK' }],
    }, tokenViewerA);
    const viewerCreateRes = await createContent(viewerCreateReq);
    if (viewerCreateRes.status !== 403) {
      throw new Error(`Expected status 403 for VIEWER role content creation, got ${viewerCreateRes.status}`);
    }
    passedTests++;
    console.log('  ✅ 4. Role violation prevented: VIEWER content creation returned 403 Forbidden');

    // 5. Role Violation: EDITOR attempting to approve content
    totalTests++;
    // First create a content as Editor
    const editorCreateReq = makeReq('http://localhost:3000/api/content', 'POST', {
      workspaceId: wsA1.id,
      title: 'Review Post',
      masterCaption: 'Review Caption',
      platforms: [{ platform: 'FACEBOOK' }],
      submitForApproval: true,
    }, tokenEditorA);
    const editorCreateRes = await createContent(editorCreateReq);
    const contentData = await editorCreateRes.json();
    const createdContentId = contentData.content.id;

    // Editor tries to approve
    const editorApproveReq = makeReq('http://localhost:3000/api/content/approve', 'POST', {
      contentId: createdContentId,
      action: 'APPROVE',
    }, tokenEditorA);
    const editorApproveRes = await approveContent(editorApproveReq);
    if (editorApproveRes.status !== 403) {
      throw new Error(`Expected status 403 for EDITOR role content approval, got ${editorApproveRes.status}`);
    }
    passedTests++;
    console.log('  ✅ 5. Role violation prevented: EDITOR approval action returned 403 Forbidden');

    // 6. Role Violation: EDITOR attempting to create workspace
    totalTests++;
    const editorWsReq = makeReq('http://localhost:3000/api/workspaces', 'POST', {
      name: 'Forbidden Workspace',
    }, tokenEditorA);
    const editorWsRes = await createWorkspace(editorWsReq);
    if (editorWsRes.status !== 403) {
      throw new Error(`Expected status 403 for EDITOR workspace creation, got ${editorWsRes.status}`);
    }
    passedTests++;
    console.log('  ✅ 6. Role violation prevented: EDITOR workspace creation returned 403 Forbidden');

    // 7. ALL_CLIENTS Abuse Prevention: Attempting to create content with workspaceId: ALL_CLIENTS
    totalTests++;
    const allClientsReq = makeReq('http://localhost:3000/api/content', 'POST', {
      workspaceId: 'ALL_CLIENTS',
      title: 'Abuse Post',
      masterCaption: 'Abuse Caption',
      platforms: [{ platform: 'FACEBOOK' }],
    }, tokenAdminA);
    const allClientsRes = await createContent(allClientsReq);
    if (allClientsRes.status !== 400) {
      throw new Error(`Expected status 400 for ALL_CLIENTS creation abuse, got ${allClientsRes.status}`);
    }
    passedTests++;
    console.log('  ✅ 7. ALL_CLIENTS abuse prevented: Write operation with ALL_CLIENTS returned 400 Bad Request');

    // Clean up
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAdminA.id, userEditorA.id, userViewerA.id] } } });

    console.log(`🎉 Auth & Authorization Tests Passed: ${passedTests}/${totalTests}\n`);
    return { passedTests, totalTests };
  } catch (err) {
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [userAdminA.id, userEditorA.id, userViewerA.id] } } }).catch(() => {});
    throw err;
  }
}

if (require.main === module) {
  runAuthAuthorizationTests().catch((e) => {
    console.error('❌ Auth & Authorization tests failed:', e);
    process.exit(1);
  });
}

export { runAuthAuthorizationTests };
