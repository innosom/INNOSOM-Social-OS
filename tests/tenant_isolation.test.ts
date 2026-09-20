import { NextRequest } from 'next/server';
import { signSessionToken, SessionPayload } from '../src/lib/auth';
import { GET as getContent, POST as createContent } from '../src/app/api/content/route';
import { GET as getMedia, POST as uploadMedia } from '../src/app/api/media/route';
import { GET as getSocialConns, POST as connectSocial } from '../src/app/api/social-connections/route';
import { POST as triggerPublish } from '../src/app/api/publications/[id]/publish/route';
import { prisma } from '../src/lib/prisma';

export async function runTenantIsolationTests() {
  console.log('\n🏢 [2/6] Running Tenant & Cross-Workspace Isolation Security Tests...\n');

  // Setup Org 1 (Workspace 1A & Workspace 1B) and Org 2 (Workspace 2A)
  const org1 = await prisma.organization.create({
    data: { name: 'Tenant Org 1', slug: `tenant-org-1-${Date.now()}` },
  });
  const org2 = await prisma.organization.create({
    data: { name: 'Tenant Org 2', slug: `tenant-org-2-${Date.now()}` },
  });

  const ws1A = await prisma.workspace.create({
    data: { organizationId: org1.id, name: 'Workspace 1A', slug: `ws-1a-${Date.now()}` },
  });
  const ws1B = await prisma.workspace.create({
    data: { organizationId: org1.id, name: 'Workspace 1B', slug: `ws-1b-${Date.now()}` },
  });
  const ws2A = await prisma.workspace.create({
    data: { organizationId: org2.id, name: 'Workspace 2A', slug: `ws-2a-${Date.now()}` },
  });

  const user1 = await prisma.user.create({
    data: { email: `user1_${Date.now()}@org1.com`, name: 'User 1', passwordHash: 'hash' },
  });
  const user2 = await prisma.user.create({
    data: { email: `user2_${Date.now()}@org2.com`, name: 'User 2', passwordHash: 'hash' },
  });

  const sessionUser1: SessionPayload = {
    userId: user1.id,
    email: user1.email,
    name: user1.name,
    organizationId: org1.id,
    role: 'ADMIN',
  };

  const tokenUser1 = await signSessionToken(sessionUser1);

  try {
    // 1. Cross-Workspace Content Isolation
    // User1 attempts to fetch content specifying Workspace 2A (Org 2)
    const getContentReq = new NextRequest(`http://localhost:3000/api/content?workspaceId=${ws2A.id}`, {
      headers: { cookie: `innosom_session=${tokenUser1}` },
    });
    const getContentRes = await getContent(getContentReq);
    if (getContentRes.status !== 403) {
      throw new Error(`Cross-workspace content query expected status 403 Forbidden, got ${getContentRes.status}`);
    }
    console.log('  ✅ Cross-workspace content retrieval blocked with 403 Forbidden');

    // User1 attempts to create content in Workspace 2A (Org 2)
    const createContentReq = new NextRequest('http://localhost:3000/api/content', {
      method: 'POST',
      headers: { cookie: `innosom_session=${tokenUser1}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: ws2A.id,
        title: 'Unauthorized Content',
        masterCaption: 'Should fail',
        platforms: [{ platform: 'FACEBOOK' }],
      }),
    });
    const createContentRes = await createContent(createContentReq);
    if (createContentRes.status !== 403) {
      throw new Error(`Cross-workspace content creation expected status 403 Forbidden, got ${createContentRes.status}`);
    }
    console.log('  ✅ Cross-workspace content creation blocked with 403 Forbidden');

    // 2. Cross-Workspace Media Isolation
    // User1 attempts to fetch media specifying Workspace 2A
    const getMediaReq = new NextRequest(`http://localhost:3000/api/media?workspaceId=${ws2A.id}`, {
      headers: { cookie: `innosom_session=${tokenUser1}` },
    });
    const getMediaRes = await getMedia(getMediaReq);
    if (getMediaRes.status !== 403) {
      throw new Error(`Cross-workspace media query expected status 403 Forbidden, got ${getMediaRes.status}`);
    }
    console.log('  ✅ Cross-workspace media asset retrieval blocked with 403 Forbidden');

    // User1 attempts to reference media from ws2A when creating content in ws1A
    const mediaAssetInWs2A = await prisma.mediaAsset.create({
      data: {
        workspaceId: ws2A.id,
        fileName: 'secret_image.png',
        fileSize: 1024,
        mimeType: 'image/png',
        storageKey: 'key_ws2a',
        publicUrl: 'http://cdn/secret.png',
      },
    });

    const crossMediaContentReq = new NextRequest('http://localhost:3000/api/content', {
      method: 'POST',
      headers: { cookie: `innosom_session=${tokenUser1}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: ws1A.id,
        title: 'Content with Cross-Tenant Media Attachment',
        masterCaption: 'Attempting to attach asset from ws2A',
        platforms: [{ platform: 'FACEBOOK', mediaAssetIds: [mediaAssetInWs2A.id] }],
      }),
    });
    const crossMediaContentRes = await createContent(crossMediaContentReq);
    if (crossMediaContentRes.status === 200) {
      // Check database to ensure cross-workspace media asset wasn't successfully attached to content
      const contentData = await crossMediaContentRes.json();
      const variantMedia = await prisma.contentVariantMedia.findMany({
        where: { mediaAssetId: mediaAssetInWs2A.id },
      });
      if (variantMedia.length > 0) {
        throw new Error('SECURITY VIOLATION: Cross-workspace media asset was attached to content variant!');
      }
    }
    console.log('  ✅ Cross-workspace media asset reference rejected/prevented');

    // 3. Cross-Workspace Social Connection Access
    // User1 attempts to fetch social connections for ws2A
    const getSocialReq = new NextRequest(`http://localhost:3000/api/social-connections?workspaceId=${ws2A.id}`, {
      headers: { cookie: `innosom_session=${tokenUser1}` },
    });
    const getSocialRes = await getSocialConns(getSocialReq);
    if (getSocialRes.status !== 403) {
      throw new Error(`Cross-workspace social connection query expected 403, got ${getSocialRes.status}`);
    }
    console.log('  ✅ Cross-workspace social connection query blocked with 403');

    // User1 attempts to connect a social account to ws2A
    const connectSocialReq = new NextRequest('http://localhost:3000/api/social-connections', {
      method: 'POST',
      headers: { cookie: `innosom_session=${tokenUser1}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: ws2A.id,
        platform: 'INSTAGRAM',
        accountName: 'Hacked Account',
        accountId: 'hacked_123',
      }),
    });
    const connectSocialRes = await connectSocial(connectSocialReq);
    if (connectSocialRes.status !== 403) {
      throw new Error(`Cross-workspace social connection creation expected 403, got ${connectSocialRes.status}`);
    }
    console.log('  ✅ Cross-workspace social connection creation blocked with 403');

    // 4. Cross-Workspace Publication Execution Security
    // Setup social conn & publication in ws2A
    const connWs2A = await prisma.socialConnection.create({
      data: {
        workspaceId: ws2A.id,
        platform: 'FACEBOOK',
        accountName: 'Org2 FB',
        accountId: 'org2_fb_1',
        accessTokenEnc: 'enc_token',
      },
    });
    const contentWs2A = await prisma.content.create({
      data: { workspaceId: ws2A.id, authorId: user2.id, title: 'Org 2 Post', masterCaption: 'Cap' },
    });
    const variantWs2A = await prisma.contentVariant.create({
      data: { contentId: contentWs2A.id, platform: 'FACEBOOK', caption: 'Cap' },
    });
    const pubWs2A = await prisma.publication.create({
      data: {
        contentVariantId: variantWs2A.id,
        socialConnectionId: connWs2A.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `pub_cross_test_${Date.now()}`,
      },
    });

    // User1 attempts to trigger publication execution for Org 2's publication ID
    const triggerReq = new NextRequest(`http://localhost:3000/api/publications/${pubWs2A.id}/publish`, {
      method: 'POST',
      headers: { cookie: `innosom_session=${tokenUser1}` },
    });
    const triggerRes = await triggerPublish(triggerReq, { params: Promise.resolve({ id: pubWs2A.id }) });
    if (triggerRes.status !== 403) {
      throw new Error(`Cross-workspace publication trigger expected status 403 Forbidden, got ${triggerRes.status}`);
    }
    console.log('  ✅ Cross-workspace publication execution trigger blocked with 403 Forbidden');

    console.log('\n✨ Tenant & Cross-Workspace Isolation security tests passed successfully!');
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: [org1.id, org2.id] } } });
    await prisma.mediaAsset.deleteMany({ where: { workspaceId: { in: [ws1A.id, ws1B.id, ws2A.id] } } });
    await prisma.publication.deleteMany({ where: { socialConnection: { workspaceId: { in: [ws1A.id, ws1B.id, ws2A.id] } } } });
    await prisma.content.deleteMany({ where: { workspaceId: { in: [ws1A.id, ws1B.id, ws2A.id] } } });
    await prisma.socialConnection.deleteMany({ where: { workspaceId: { in: [ws1A.id, ws1B.id, ws2A.id] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [ws1A.id, ws1B.id, ws2A.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [user1.id, user2.id] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [org1.id, org2.id] } } });
  }
}

if (require.main === module) {
  runTenantIsolationTests().catch((e) => {
    console.error('❌ Tenant isolation test failed:', e);
    process.exit(1);
  });
}
