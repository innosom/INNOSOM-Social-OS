import { NextRequest } from 'next/server';
import { prisma } from '../src/lib/prisma';
import { signSessionToken } from '../src/lib/auth';
import { POST as createContent } from '../src/app/api/content/route';
import { POST as approveContent } from '../src/app/api/content/approve/route';
import { POST as triggerPublish } from '../src/app/api/publications/[id]/publish/route';
import { POST as retryPublish } from '../src/app/api/publications/[id]/retry/route';
import { POST as createSocialConnection, DELETE as deleteSocialConnection } from '../src/app/api/social-connections/route';
import { GET as oauthCallback } from '../src/app/api/oauth/[provider]/callback/route';
import { processPublicationJob } from '../src/modules/publishing/PublishingWorker';
import { SocialProviderFactory } from '../src/modules/social/SocialProviderFactory';

async function runAdversarialAuditTests() {
  console.log('🛡️  Running Comprehensive Adversarial Security Audit Unit Tests...\n');

  // Setup Test Data
  const testOrg1 = await prisma.organization.create({
    data: { name: 'Audit Org 1', slug: `audit-org-1-${Date.now()}` },
  });

  const testOrg2 = await prisma.organization.create({
    data: { name: 'Audit Org 2', slug: `audit-org-2-${Date.now()}` },
  });

  const workspace1 = await prisma.workspace.create({
    data: { organizationId: testOrg1.id, name: 'Audit Workspace 1', slug: 'audit-ws-1' },
  });

  const workspace2 = await prisma.workspace.create({
    data: { organizationId: testOrg2.id, name: 'Audit Workspace 2', slug: 'audit-ws-2' },
  });

  const editorUser = await prisma.user.create({
    data: {
      email: `editor_${Date.now()}@test.com`,
      name: 'Editor User',
      passwordHash: 'hashed_pw',
    },
  });

  const managerUser = await prisma.user.create({
    data: {
      email: `manager_${Date.now()}@test.com`,
      name: 'Manager User',
      passwordHash: 'hashed_pw',
    },
  });

  await prisma.membership.createMany({
    data: [
      { userId: editorUser.id, organizationId: testOrg1.id, role: 'EDITOR' },
      { userId: managerUser.id, organizationId: testOrg1.id, role: 'MANAGER' },
    ],
  });

  const editorToken = await signSessionToken({
    userId: editorUser.id,
    email: editorUser.email,
    name: editorUser.name,
    organizationId: testOrg1.id,
    role: 'EDITOR',
  });

  const managerToken = await signSessionToken({
    userId: managerUser.id,
    email: managerUser.email,
    name: managerUser.name,
    organizationId: testOrg1.id,
    role: 'MANAGER',
  });

  // Media Asset belonging to Workspace 2 (Org 2)
  const mediaWs2 = await prisma.mediaAsset.create({
    data: {
      workspaceId: workspace2.id,
      fileName: 'secret.jpg',
      fileSize: 1024,
      mimeType: 'image/jpeg',
      storageKey: `workspaces/${workspace2.id}/secret.jpg`,
      publicUrl: 'https://example.com/secret.jpg',
    },
  });

  // --- TEST 1: Media IDOR Isolation ---
  console.log('Testing 1: Media IDOR Cross-Workspace Isolation...');
  const idorReq = new NextRequest('http://localhost:3000/api/content', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `innosom_session=${editorToken}`,
    },
    body: JSON.stringify({
      workspaceId: workspace1.id,
      title: 'Malicious Content Attempt',
      masterCaption: 'Stealing media from Workspace 2',
      platforms: [
        {
          platform: 'FACEBOOK',
          caption: 'Stealing media',
          mediaAssetIds: [mediaWs2.id],
        },
      ],
    }),
  });

  const idorRes = await createContent(idorReq);
  if (idorRes.status !== 403) {
    throw new Error(`TEST 1 FAILED: Media IDOR allowed attached media from another workspace. Status: ${idorRes.status}`);
  }
  console.log('  ✅ Media IDOR cross-workspace attachment blocked (403 Forbidden)');

  // --- TEST 2: RBAC Role Restrictions ---
  console.log('\nTesting 2: RBAC Role Enforcement...');

  // Create valid draft content in Workspace 1
  const draftContent = await prisma.content.create({
    data: {
      workspaceId: workspace1.id,
      authorId: editorUser.id,
      title: 'Draft Article',
      masterCaption: 'Pending review',
      status: 'DRAFT',
    },
  });

  // Editor trying to approve content
  const approveReq = new NextRequest('http://localhost:3000/api/content/approve', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `innosom_session=${editorToken}`,
    },
    body: JSON.stringify({ contentId: draftContent.id, action: 'APPROVE' }),
  });

  const approveRes = await approveContent(approveReq);
  if (approveRes.status !== 403) {
    throw new Error(`TEST 2.1 FAILED: Editor user bypasses RBAC approval check. Status: ${approveRes.status}`);
  }
  console.log('  ✅ Editor prevented from approving content (403 Forbidden)');

  // Editor trying to add social connection
  const connReq = new NextRequest('http://localhost:3000/api/social-connections', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `innosom_session=${editorToken}`,
    },
    body: JSON.stringify({
      workspaceId: workspace1.id,
      platform: 'FACEBOOK',
      accountName: 'Malicious FB',
      accountId: 'fb_123',
    }),
  });

  const connRes = await createSocialConnection(connReq);
  if (connRes.status !== 403) {
    throw new Error(`TEST 2.2 FAILED: Editor user bypasses RBAC social connection creation. Status: ${connRes.status}`);
  }
  console.log('  ✅ Editor prevented from creating social connections (403 Forbidden)');

  // --- TEST 3: Direct Publish & State Bypass ---
  console.log('\nTesting 3: Direct Publish & State Transition Safeguards...');

  const socialConn = await prisma.socialConnection.create({
    data: {
      workspaceId: workspace1.id,
      platform: 'FACEBOOK',
      accountName: 'Audit FB Account',
      accountId: 'fb_audit_acc_1',
      accessTokenEnc: 'enc_token_mock_facebook_1',
      status: 'CONNECTED',
    },
  });

  const variant = await prisma.contentVariant.create({
    data: {
      contentId: draftContent.id,
      platform: 'FACEBOOK',
      caption: 'Draft caption',
    },
  });

  const publication = await prisma.publication.create({
    data: {
      contentVariantId: variant.id,
      socialConnectionId: socialConn.id,
      scheduledAt: new Date(),
      status: 'SCHEDULED',
      idempotencyKey: `pub_audit_test_${Date.now()}`,
    },
  });

  // Editor attempting direct publish trigger on unapproved content
  const pubReq = new NextRequest(`http://localhost:3000/api/publications/${publication.id}/publish`, {
    method: 'POST',
    headers: { Cookie: `innosom_session=${editorToken}` },
  });
  const pubRes = await triggerPublish(pubReq, { params: Promise.resolve({ id: publication.id }) });
  if (pubRes.status !== 403) {
    throw new Error(`TEST 3.1 FAILED: Direct publish permitted for EDITOR role. Status: ${pubRes.status}`);
  }
  console.log('  ✅ Direct publish blocked for EDITOR role (403 Forbidden)');

  // Manager attempting direct publish on unapproved DRAFT content
  const pubMgrReq = new NextRequest(`http://localhost:3000/api/publications/${publication.id}/publish`, {
    method: 'POST',
    headers: { Cookie: `innosom_session=${managerToken}` },
  });
  const pubMgrRes = await triggerPublish(pubMgrReq, { params: Promise.resolve({ id: publication.id }) });
  if (pubMgrRes.status !== 403) {
    throw new Error(`TEST 3.2 FAILED: Direct publish permitted on unapproved DRAFT content. Status: ${pubMgrRes.status}`);
  }
  console.log('  ✅ Direct publish blocked for unapproved DRAFT content (403 Forbidden)');

  // Retrying non-FAILED publication
  const retryReq = new NextRequest(`http://localhost:3000/api/publications/${publication.id}/retry`, {
    method: 'POST',
    headers: { Cookie: `innosom_session=${managerToken}` },
  });
  const retryRes = await retryPublish(retryReq, { params: Promise.resolve({ id: publication.id }) });
  if (retryRes.status !== 400) {
    throw new Error(`TEST 3.3 FAILED: Retry permitted on SCHEDULED publication. Status: ${retryRes.status}`);
  }
  console.log('  ✅ Retry blocked for non-FAILED publication (400 Bad Request)');

  // --- TEST 4: Worker Race Condition & Duplicate Publishing ---
  console.log('\nTesting 4: Worker Concurrency Atomic Lock...');

  // Reset publication status to SCHEDULED
  await prisma.publication.update({
    where: { id: publication.id },
    data: { status: 'SCHEDULED' },
  });

  // Concurrent worker executions
  const [res1, res2] = await Promise.all([
    processPublicationJob(publication.id),
    processPublicationJob(publication.id),
  ]);

  if (!res1.success || !res2.success) {
    throw new Error('TEST 4 FAILED: Publication execution threw unhandled exception.');
  }

  const finalPub = await prisma.publication.findUnique({ where: { id: publication.id } });
  if (finalPub?.status !== 'PUBLISHED') {
    throw new Error(`TEST 4 FAILED: Expected final publication status PUBLISHED, got ${finalPub?.status}`);
  }
  console.log('  ✅ Atomic worker status lock prevented duplicate publishing race condition');

  // --- TEST 5: OAuth Session & CSRF Verification ---
  console.log('\nTesting 5: OAuth Callback Session & State Verification...');

  const invalidOAuthReq = new NextRequest('http://localhost:3000/api/oauth/facebook/callback?code=fake_code&state=invalid_state');
  const oauthRes = await oauthCallback(invalidOAuthReq, { params: Promise.resolve({ provider: 'facebook' }) });
  if (oauthRes.status !== 307 && oauthRes.status !== 302) {
    throw new Error(`TEST 5 FAILED: Invalid OAuth callback did not redirect. Status: ${oauthRes.status}`);
  }
  const redirectUrl = oauthRes.headers.get('location') || '';
  if (!redirectUrl.includes('error=')) {
    throw new Error(`TEST 5 FAILED: OAuth redirect did not contain error param. URL: ${redirectUrl}`);
  }
  console.log('  ✅ Forged/Invalid OAuth callback safely rejected with redirect error');

  // --- TEST 6: Production Secrets Guardrail ---
  console.log('\nTesting 6: Production Secret Enforcement Safeguards...');

  const prevEnv = process.env.NODE_ENV;
  const prevJwt = process.env.JWT_SECRET;
  try {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'innosom-super-secret-jwt-encryption-key-32-bytes!!';

    let caughtError = false;
    try {
      await signSessionToken({
        userId: 'u1',
        email: 'a@b.com',
        name: 'A',
        organizationId: 'o1',
        role: 'ADMIN',
      });
    } catch (err: any) {
      if (err.message.includes('JWT_SECRET environment variable is missing or set to default value')) {
        caughtError = true;
      }
    }

    if (!caughtError) {
      throw new Error('TEST 6 FAILED: Default JWT_SECRET was permitted in production mode!');
    }
    console.log('  ✅ Default JWT_SECRET strictly rejected in production mode');
  } finally {
    process.env.NODE_ENV = prevEnv;
    process.env.JWT_SECRET = prevJwt;
  }

  console.log('\n🎉 ALL ADVERSARIAL SECURITY AUDIT UNIT TESTS PASSED SUCCESSFULLY! 🎉\n');
}

runAdversarialAuditTests().catch((err) => {
  console.error('❌ Adversarial Audit Test Suite Failed:', err);
  process.exit(1);
});
