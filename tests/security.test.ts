import { NextRequest } from 'next/server';
import { prisma } from '../src/lib/prisma';
import { signSessionToken } from '../src/lib/auth';
import { GET as getContent, POST as createContent } from '../src/app/api/content/route';
import { GET as getMedia, POST as uploadMedia } from '../src/app/api/media/route';
import { GET as getSocialConnections, POST as connectSocial, DELETE as deleteSocial } from '../src/app/api/social-connections/route';
import { GET as getWorkspaces, POST as createWorkspace } from '../src/app/api/workspaces/route';
import { GET as getAnalytics } from '../src/app/api/analytics/route';
import { GET as getAuditLogs } from '../src/app/api/audit-logs/route';
import { POST as triggerPublish } from '../src/app/api/publications/[id]/publish/route';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

async function runSecurityTests() {
  console.log('🧪 Running Comprehensive Security & Authorization Tests...\n');

  // Setup test organizations & workspaces & users
  const orgA = await prisma.organization.create({
    data: { name: 'Security Org A', slug: `sec-org-a-${Date.now()}` },
  });
  const orgB = await prisma.organization.create({
    data: { name: 'Security Org B', slug: `sec-org-b-${Date.now()}` },
  });

  const wsA1 = await prisma.workspace.create({
    data: { organizationId: orgA.id, name: 'Org A WS 1', slug: 'a1' },
  });
  const wsA2 = await prisma.workspace.create({
    data: { organizationId: orgA.id, name: 'Org A WS 2', slug: 'a2' },
  });
  const wsB1 = await prisma.workspace.create({
    data: { organizationId: orgB.id, name: 'Org B WS 1', slug: 'b1' },
  });

  const userAdminA = await prisma.user.create({
    data: { email: `admin_a_${Date.now()}@test.com`, name: 'Admin A', passwordHash: 'hash' },
  });
  const userEditorA = await prisma.user.create({
    data: { email: `editor_a_${Date.now()}@test.com`, name: 'Editor A', passwordHash: 'hash' },
  });
  const userAdminB = await prisma.user.create({
    data: { email: `admin_b_${Date.now()}@test.com`, name: 'Admin B', passwordHash: 'hash' },
  });

  await prisma.membership.create({
    data: { userId: userAdminA.id, organizationId: orgA.id, role: 'ADMIN' },
  });
  await prisma.membership.create({
    data: { userId: userEditorA.id, organizationId: orgA.id, role: 'EDITOR' },
  });
  await prisma.membership.create({
    data: { userId: userAdminB.id, organizationId: orgB.id, role: 'ADMIN' },
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

  const tokenAdminB = await signSessionToken({
    userId: userAdminB.id,
    email: userAdminB.email,
    name: userAdminB.name,
    organizationId: orgB.id,
    role: 'ADMIN',
  });

  try {
    // 1. Unauthenticated API Requests
    console.log('Testing 1: Unauthenticated API Requests rejection (401)...');
    const reqUnauth = new NextRequest('http://localhost:3000/api/content');
    const resUnauth = await getContent(reqUnauth);
    if (resUnauth.status !== 401) {
      throw new Error(`Expected 401 for unauthenticated GET /api/content, got ${resUnauth.status}`);
    }
    console.log('  ✅ Unauthenticated request correctly rejected with 401.');

    // 2. Invalid & Expired Sessions
    console.log('Testing 2: Invalid Session Token rejection (401)...');
    const reqInvalid = new NextRequest('http://localhost:3000/api/content', {
      headers: { cookie: 'innosom_session=invalid_jwt_token_string' },
    });
    const resInvalid = await getContent(reqInvalid);
    if (resInvalid.status !== 401) {
      throw new Error(`Expected 401 for invalid session, got ${resInvalid.status}`);
    }
    console.log('  ✅ Invalid session token correctly rejected with 401.');

    // 3. Unauthorized Workspace Access
    console.log('Testing 3: Unauthorized Cross-Organization Workspace Access (403)...');
    const reqCrossWs = new NextRequest(`http://localhost:3000/api/content?workspaceId=${wsB1.id}`, {
      headers: { cookie: `innosom_session=${tokenAdminA}` },
    });
    const resCrossWs = await getContent(reqCrossWs);
    if (resCrossWs.status !== 403) {
      throw new Error(`Expected 403 accessing cross-org workspace wsB1 from Admin A, got ${resCrossWs.status}`);
    }
    console.log('  ✅ Cross-organization workspace access correctly denied with 403.');

    // 4. Cross-Workspace Content Isolation
    console.log('Testing 4: Cross-Workspace Content Isolation...');
    const contentB = await prisma.content.create({
      data: {
        workspaceId: wsB1.id,
        authorId: userAdminB.id,
        title: 'Org B Secret Post',
        masterCaption: 'Caption Org B',
        status: 'DRAFT',
      },
    });

    const reqCreateCrossContent = new NextRequest('http://localhost:3000/api/content', {
      method: 'POST',
      headers: { cookie: `innosom_session=${tokenAdminA}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: wsB1.id,
        title: 'Hacked Title',
        masterCaption: 'Hacked',
        platforms: [{ platform: 'FACEBOOK' }],
      }),
    });
    const resCreateCrossContent = await createContent(reqCreateCrossContent);
    if (resCreateCrossContent.status !== 403) {
      throw new Error(`Expected 403 creating content in Org B workspace from Org A user, got ${resCreateCrossContent.status}`);
    }
    console.log('  ✅ Cross-workspace content creation blocked with 403.');

    // 5. Cross-Workspace Media Isolation
    console.log('Testing 5: Cross-Workspace Media Isolation...');
    const formData = new FormData();
    formData.append('workspaceId', wsB1.id);
    formData.append('file', new File(['dummy_content'], 'test.png', { type: 'image/png' }));

    const reqCrossMedia = new NextRequest('http://localhost:3000/api/media', {
      method: 'POST',
      headers: { cookie: `innosom_session=${tokenAdminA}` },
      body: formData,
    });
    const resCrossMedia = await uploadMedia(reqCrossMedia);
    if (resCrossMedia.status !== 403) {
      throw new Error(`Expected 403 uploading media to Org B workspace from Org A user, got ${resCrossMedia.status}`);
    }
    console.log('  ✅ Cross-workspace media upload blocked with 403.');

    // 6. Cross-Workspace Social Connection & Deletion Isolation
    console.log('Testing 6: Cross-Workspace Social Connection Isolation...');
    const connB = await prisma.socialConnection.create({
      data: {
        workspaceId: wsB1.id,
        platform: 'FACEBOOK',
        accountName: 'Org B Page',
        accountId: 'org_b_acc_1',
        accessTokenEnc: 'enc:v1:test',
      },
    });

    const reqDeleteCrossConn = new NextRequest(`http://localhost:3000/api/social-connections?id=${connB.id}`, {
      method: 'DELETE',
      headers: { cookie: `innosom_session=${tokenAdminA}` },
    });
    const resDeleteCrossConn = await deleteSocial(reqDeleteCrossConn);
    if (resDeleteCrossConn.status !== 403) {
      throw new Error(`Expected 403 deleting Org B social connection from Org A user, got ${resDeleteCrossConn.status}`);
    }
    console.log('  ✅ Cross-workspace social connection deletion blocked with 403.');

    // 7. Cross-Workspace Publication Execution Protection
    console.log('Testing 7: Cross-Workspace Publication Trigger Isolation...');
    const variantB = await prisma.contentVariant.create({
      data: {
        contentId: contentB.id,
        platform: 'FACEBOOK',
        caption: 'Variant Org B',
      },
    });
    const pubB = await prisma.publication.create({
      data: {
        contentVariantId: variantB.id,
        socialConnectionId: connB.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `pub_test_sec_${Date.now()}`,
      },
    });

    const reqTriggerCrossPub = new NextRequest(`http://localhost:3000/api/publications/${pubB.id}/publish`, {
      method: 'POST',
      headers: { cookie: `innosom_session=${tokenAdminA}` },
    });
    const resTriggerCrossPub = await triggerPublish(reqTriggerCrossPub, { params: Promise.resolve({ id: pubB.id }) });
    if (resTriggerCrossPub.status !== 403) {
      throw new Error(`Expected 403 triggering Org B publication from Org A user, got ${resTriggerCrossPub.status}`);
    }
    console.log('  ✅ Cross-workspace publication trigger blocked with 403.');

    // 8. Role Violations (EDITOR vs ADMIN)
    console.log('Testing 8: Role Violations Enforcement (EDITOR creating workspace)...');
    const reqEditorCreateWs = new NextRequest('http://localhost:3000/api/workspaces', {
      method: 'POST',
      headers: { cookie: `innosom_session=${tokenEditorA}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Unauthorized Workspace' }),
    });
    const resEditorCreateWs = await createWorkspace(reqEditorCreateWs);
    if (resEditorCreateWs.status !== 403) {
      throw new Error(`Expected 403 when EDITOR tries to create a workspace, got ${resEditorCreateWs.status}`);
    }
    console.log('  ✅ Role violation correctly rejected with 403.');

    // 9. ALL_CLIENTS Parameter Scoping and Boundary Enforcement
    console.log('Testing 9: ALL_CLIENTS parameter parameter scoping...');
    const reqAllClients = new NextRequest('http://localhost:3000/api/content?workspaceId=ALL_CLIENTS', {
      headers: { cookie: `innosom_session=${tokenAdminA}` },
    });
    const resAllClients = await getContent(reqAllClients);
    if (resAllClients.status !== 200) {
      throw new Error(`Expected 200 for ALL_CLIENTS query, got ${resAllClients.status}`);
    }
    const dataAllClients = await resAllClients.json();
    const hasOrgBContent = dataAllClients.contents.some((c: any) => c.workspace.organizationId === orgB.id);
    if (hasOrgBContent) {
      throw new Error('SECURITY VIOLATION: ALL_CLIENTS query returned content from another organization!');
    }
    console.log('  ✅ ALL_CLIENTS parameter query correctly isolated to user organization.');

    console.log('\n🎉 ALL SECURITY AND AUTHORIZATION TESTS PASSED SUCCESSFULLY! 🎉');
  } finally {
    // Cleanup created test records
    await prisma.organization.deleteMany({
      where: { id: { in: [orgA.id, orgB.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [userAdminA.id, userEditorA.id, userAdminB.id] } },
    });
    await prisma.$disconnect();
  }
}

runSecurityTests().catch((e) => {
  console.error('❌ Security test execution failed:', e);
  process.exit(1);
});
