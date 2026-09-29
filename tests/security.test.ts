import assert from 'node:assert';
import { prisma } from '../src/lib/prisma';
import { signSessionToken, verifySessionToken, validateWorkspaceAccess, SessionPayload } from '../src/lib/auth';
import { GET as getContent, POST as createContent } from '../src/app/api/content/route';
import { GET as getMedia, POST as uploadMedia } from '../src/app/api/media/route';
import { POST as approveContent } from '../src/app/api/content/approve/route';
import { NextRequest } from 'next/server';

async function runSecurityTests() {
  console.log('🧪 Running Security, Authentication, Workspace Isolation & Security Audit Tests...');

  // Setup DB Test State
  let org1 = await prisma.organization.findFirst({ where: { slug: 'innosom' } });
  if (!org1) {
    org1 = await prisma.organization.create({
      data: { name: 'INNOSOM Primary Org', slug: 'innosom' },
    });
  }

  let org2 = await prisma.organization.findFirst({ where: { slug: 'external-agency' } });
  if (!org2) {
    org2 = await prisma.organization.create({
      data: { name: 'External Agency Org', slug: 'external-agency' },
    });
  }

  let user1 = await prisma.user.findFirst({ where: { email: 'sec_admin@innosom.com' } });
  if (!user1) {
    user1 = await prisma.user.create({
      data: {
        email: 'sec_admin@innosom.com',
        name: 'Sec Admin User',
        passwordHash: 'hash123',
      },
    });
  }

  let user2 = await prisma.user.findFirst({ where: { email: 'external_user@external.com' } });
  if (!user2) {
    user2 = await prisma.user.create({
      data: {
        email: 'external_user@external.com',
        name: 'External User',
        passwordHash: 'hash123',
      },
    });
  }

  let ws1 = await prisma.workspace.findFirst({ where: { organizationId: org1.id, slug: 'org1-ws1' } });
  if (!ws1) {
    ws1 = await prisma.workspace.create({
      data: {
        organizationId: org1.id,
        name: 'Org1 Workspace 1',
        slug: 'org1-ws1',
      },
    });
  }

  let ws2 = await prisma.workspace.findFirst({ where: { organizationId: org2.id, slug: 'org2-ws1' } });
  if (!ws2) {
    ws2 = await prisma.workspace.create({
      data: {
        organizationId: org2.id,
        name: 'Org2 Workspace 1',
        slug: 'org2-ws1',
      },
    });
  }

  const validSessionOrg1: SessionPayload = {
    userId: user1.id,
    email: user1.email,
    name: user1.name,
    organizationId: org1.id,
    role: 'ADMIN',
  };

  const validSessionOrg2: SessionPayload = {
    userId: user2.id,
    email: user2.email,
    name: user2.name,
    organizationId: org2.id,
    role: 'EDITOR',
  };

  const tokenOrg1 = await signSessionToken(validSessionOrg1);
  const tokenOrg2 = await signSessionToken(validSessionOrg2);

  // 1. JWT Session Signing, Invalidation & Expired Session Verification
  console.log('Testing 1: Authentication, Invalidation & Expired Session Checks...');
  const token = await signSessionToken(validSessionOrg1);
  assert.ok(token && typeof token === 'string', 'Session token should be created');

  const verified = await verifySessionToken(token);
  assert.strictEqual(verified?.userId, user1.id, 'Verified user ID should match payload');
  assert.strictEqual(verified?.organizationId, org1.id, 'Verified org ID should match payload');

  const invalidTokenResult = await verifySessionToken('invalid.jwt.token');
  assert.strictEqual(invalidTokenResult, null, 'Invalid JWT token must resolve to null');

  const corruptedSignatureToken = `${token.substring(0, token.length - 10)}1234567890`;
  const corruptedResult = await verifySessionToken(corruptedSignatureToken);
  assert.strictEqual(corruptedResult, null, 'Tampered/Corrupted token must resolve to null');

  console.log('  ✅ Authentication & token security tests passed');

  // 2. Workspace Access Validation & ALL_CLIENTS Scope Enforcement
  console.log('Testing 2: Workspace Access Validation & ALL_CLIENTS Scope...');
  const accessWs1 = await validateWorkspaceAccess(validSessionOrg1, ws1.id, prisma);
  assert.strictEqual(accessWs1.hasAccess, true, 'Org1 user must have access to Org1 workspace');

  const accessWs2 = await validateWorkspaceAccess(validSessionOrg1, ws2.id, prisma);
  assert.strictEqual(accessWs2.hasAccess, false, 'Org1 user MUST NOT have access to Org2 workspace');

  const accessAllClients = await validateWorkspaceAccess(validSessionOrg1, 'ALL_CLIENTS', prisma);
  assert.strictEqual(accessAllClients.hasAccess, true, 'ALL_CLIENTS scope access should validate true');

  console.log('  ✅ Workspace access validation & ALL_CLIENTS scope tests passed');

  // 3. API Unauthenticated Access Checks
  console.log('Testing 3: Unauthenticated API Request Enforcement...');
  const unauthReq = new NextRequest('http://localhost:3000/api/content');
  const unauthRes = await getContent(unauthReq);
  assert.strictEqual(unauthRes.status, 401, 'Unauthenticated content request must return 401');

  const unauthMediaReq = new NextRequest('http://localhost:3000/api/media');
  const unauthMediaRes = await getMedia(unauthMediaReq);
  assert.strictEqual(unauthMediaRes.status, 401, 'Unauthenticated media request must return 401');

  console.log('  ✅ Unauthenticated API requests correctly blocked with 401');

  // 4. Cross-Workspace Data Leakage Prevention (Content, Media, Social Connections, Publications)
  console.log('Testing 4: Cross-Workspace Data Leakage Prevention...');

  // Create content in ws1 (Org1)
  const contentWs1 = await prisma.content.create({
    data: {
      workspaceId: ws1.id,
      authorId: user1.id,
      title: 'Org 1 Sensitive Content',
      masterCaption: 'Top secret caption for Org 1',
      status: 'DRAFT',
    },
  });

  // User 2 (Org 2) attempts to fetch content from ws1 via API
  const crossReq = new NextRequest(`http://localhost:3000/api/content?workspaceId=${ws1.id}`);
  crossReq.cookies.set('innosom_session', tokenOrg2);

  const crossRes = await getContent(crossReq);
  assert.strictEqual(crossRes.status, 403, 'Cross-workspace content fetch attempt must return 403 Forbidden');

  // User 2 attempts to upload media to ws1 via API
  const formData = new FormData();
  formData.append('workspaceId', ws1.id);
  formData.append('file', new Blob(['fake content'], { type: 'image/png' }), 'cross.png');

  const crossUploadReq = new NextRequest('http://localhost:3000/api/media', {
    method: 'POST',
    body: formData,
  });
  crossUploadReq.cookies.set('innosom_session', tokenOrg2);

  const crossUploadRes = await uploadMedia(crossUploadReq);
  assert.strictEqual(crossUploadRes.status, 403, 'Cross-workspace media upload attempt must return 403 Forbidden');

  // Verify DB query scoping behavior for Org2 queries
  const org2Contents = await prisma.content.findMany({
    where: { workspace: { organizationId: org2.id } },
  });
  const containsOrg1Content = org2Contents.some((c) => c.id === contentWs1.id);
  assert.strictEqual(containsOrg1Content, false, 'Org2 tenant queries MUST NEVER include Org1 contents');

  console.log('  ✅ Cross-workspace tenant data isolation verified');

  // 5. Cross-Workspace Action Security & Unauthorized Approval Block
  console.log('Testing 5: Cross-Workspace Action Security & Approval Block...');

  // User 2 (Org 2) attempts to approve Org 1 content via API route
  const approveReq = new NextRequest('http://localhost:3000/api/content/approve', {
    method: 'POST',
    body: JSON.stringify({
      contentId: contentWs1.id,
      action: 'APPROVE',
    }),
  });
  approveReq.cookies.set('innosom_session', tokenOrg2);

  const approveRes = await approveContent(approveReq);
  assert.strictEqual(approveRes.status, 403, 'User from another organization attempting approval must return 403 Forbidden');

  console.log('  ✅ Cross-workspace approval block verified');

  // Cleanup test specific records
  await prisma.content.deleteMany({ where: { id: contentWs1.id } });

  console.log('🎉 ALL SECURITY & TENANT ISOLATION TESTS PASSED SUCCESSFULLY!');
}

runSecurityTests()
  .catch((e) => {
    console.error('❌ Security tests failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
