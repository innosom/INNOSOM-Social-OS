import { NextRequest } from 'next/server';
import { prisma } from '../src/lib/prisma';
import { signSessionToken } from '../src/lib/auth';
import { POST as uploadMedia, GET as getMedia } from '../src/app/api/media/route';
import { POST as createContent } from '../src/app/api/content/route';
import { cleanupOrphanMediaAssets } from '../src/lib/media';

async function runMediaTests() {
  console.log('\n🖼️ Running Media Asset Management & Security Tests...');
  let totalTests = 0;
  let passedTests = 0;

  // Setup test organizations, workspaces, user
  const org = await prisma.organization.create({
    data: { name: 'Media Test Org', slug: `media-org-${Date.now()}` },
  });

  const ws1 = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'Media Client 1', slug: 'media-client-1' },
  });

  const ws2 = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'Media Client 2', slug: 'media-client-2' },
  });

  const userAdmin = await prisma.user.create({
    data: { name: 'Media Admin', email: `media-admin-${Date.now()}@test.com`, passwordHash: 'hash' },
  });

  await prisma.membership.create({
    data: { userId: userAdmin.id, organizationId: org.id, role: 'ADMIN' },
  });

  const adminToken = await signSessionToken({
    userId: userAdmin.id,
    email: userAdmin.email,
    name: userAdmin.name,
    organizationId: org.id,
    role: 'ADMIN',
  });

  try {
    // 1. Valid Media Upload
    totalTests++;
    const file = new File(['fake image data'], 'hero-banner.jpg', { type: 'image/jpeg' });
    const formData = new FormData();
    formData.append('workspaceId', ws1.id);
    formData.append('file', file);

    const uploadReq = new NextRequest('http://localhost:3000/api/media', {
      method: 'POST',
      headers: { cookie: `innosom_session=${adminToken}` },
      body: formData,
    });

    const uploadRes = await uploadMedia(uploadReq);
    if (uploadRes.status !== 200) {
      throw new Error(`Media upload failed with status ${uploadRes.status}`);
    }

    const uploadData = await uploadRes.json();
    const media1Id = uploadData.mediaAsset.id;
    if (uploadData.mediaAsset.mimeType !== 'image/jpeg' || uploadData.mediaAsset.workspaceId !== ws1.id) {
      throw new Error('Uploaded media properties mismatch');
    }
    passedTests++;
    console.log('  ✅ 1. Valid image upload verified');

    // 2. Invalid MIME Type Rejection
    totalTests++;
    const badFile = new File(['malicious script'], 'hack.sh', { type: 'application/x-sh' });
    const badFormData = new FormData();
    badFormData.append('workspaceId', ws1.id);
    badFormData.append('file', badFile);

    const badUploadReq = new NextRequest('http://localhost:3000/api/media', {
      method: 'POST',
      headers: { cookie: `innosom_session=${adminToken}` },
      body: badFormData,
    });

    const badUploadRes = await uploadMedia(badUploadReq);
    if (badUploadRes.status !== 400) {
      throw new Error(`Expected status 400 for invalid MIME type, got ${badUploadRes.status}`);
    }
    passedTests++;
    console.log('  ✅ 2. Invalid file MIME type rejection (application/x-sh -> 400) verified');

    // 3. Oversized File Rejection (> 50MB)
    totalTests++;
    const oversizedFile = new File([new Uint8Array(50 * 1024 * 1024 + 1024)], 'huge_video.mp4', { type: 'video/mp4' });

    const oversizedFormData = new FormData();
    oversizedFormData.append('workspaceId', ws1.id);
    oversizedFormData.append('file', oversizedFile);

    const oversizedReq = new NextRequest('http://localhost:3000/api/media', {
      method: 'POST',
      headers: { cookie: `innosom_session=${adminToken}` },
      body: oversizedFormData,
    });

    const oversizedRes = await uploadMedia(oversizedReq);
    if (oversizedRes.status !== 400) {
      throw new Error(`Expected status 400 for oversized file, got ${oversizedRes.status}`);
    }
    passedTests++;
    console.log('  ✅ 3. Oversized file rejection (> 50MB -> 400) verified');

    // 4. Cross-Workspace Asset Reference Protection
    totalTests++;
    // Upload media to Workspace 2
    const fileWs2 = new File(['ws2 image'], 'ws2.jpg', { type: 'image/jpeg' });
    const formDataWs2 = new FormData();
    formDataWs2.append('workspaceId', ws2.id);
    formDataWs2.append('file', fileWs2);

    const uploadWs2Req = new NextRequest('http://localhost:3000/api/media', {
      method: 'POST',
      headers: { cookie: `innosom_session=${adminToken}` },
      body: formDataWs2,
    });

    const uploadWs2Res = await uploadMedia(uploadWs2Req);
    const mediaWs2Data = await uploadWs2Res.json();
    const media2Id = mediaWs2Data.mediaAsset.id;

    // Attempt to create content in Workspace 1 referencing media2Id from Workspace 2
    const crossRefReq = new NextRequest('http://localhost:3000/api/content', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `innosom_session=${adminToken}`,
      },
      body: JSON.stringify({
        workspaceId: ws1.id,
        title: 'Cross Workspace Media Post',
        masterCaption: 'Testing Cross Ref',
        platforms: [
          {
            platform: 'FACEBOOK',
            mediaAssetIds: [media2Id],
          },
        ],
      }),
    });

    const crossRefRes = await createContent(crossRefReq);
    if (crossRefRes.status !== 400) {
      throw new Error(`Expected status 400 for cross-workspace media asset reference, got ${crossRefRes.status}`);
    }
    passedTests++;
    console.log('  ✅ 4. Cross-workspace media asset reference protection verified');

    // 5. Orphan Asset Cleanup
    totalTests++;
    // Currently media1Id and media2Id are not attached to any content variant (orphaned)
    const cleanupResult = await cleanupOrphanMediaAssets(ws1.id);
    if (cleanupResult.deletedCount !== 1 || !cleanupResult.deletedIds.includes(media1Id)) {
      throw new Error('Orphan cleanup failed to identify or remove orphaned asset');
    }

    const checkMedia1 = await prisma.mediaAsset.findUnique({ where: { id: media1Id } });
    if (checkMedia1 !== null) {
      throw new Error('Orphaned media asset was not deleted from database');
    }
    passedTests++;
    console.log('  ✅ 5. Orphan media asset cleanup routine verified');

    // Clean up
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.user.delete({ where: { id: userAdmin.id } });

    console.log(`🎉 Media Asset Management Tests Passed: ${passedTests}/${totalTests}\n`);
    return { passedTests, totalTests };
  } catch (err) {
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: userAdmin.id } }).catch(() => {});
    throw err;
  }
}

if (require.main === module) {
  runMediaTests().catch((e) => {
    console.error('❌ Media tests failed:', e);
    process.exit(1);
  });
}

export { runMediaTests };
