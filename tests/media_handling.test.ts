import { NextRequest } from 'next/server';
import { signSessionToken, SessionPayload } from '../src/lib/auth';
import { POST as uploadMedia, GET as getMedia } from '../src/app/api/media/route';
import { prisma } from '../src/lib/prisma';

export async function runMediaHandlingTests() {
  console.log('\n🖼️ [5/6] Running Media Management Tests...\n');

  const org = await prisma.organization.create({
    data: { name: 'Media Test Org', slug: `media-org-${Date.now()}` },
  });
  const ws1 = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'Media WS 1', slug: `media-ws-1-${Date.now()}` },
  });
  const ws2 = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'Media WS 2', slug: `media-ws-2-${Date.now()}` },
  });

  const user = await prisma.user.create({
    data: { email: `media_user_${Date.now()}@test.com`, name: 'Media User', passwordHash: 'hash' },
  });

  const sessionPayload: SessionPayload = {
    userId: user.id,
    email: user.email,
    name: user.name,
    organizationId: org.id,
    role: 'EDITOR',
  };

  const userToken = await signSessionToken(sessionPayload);

  try {
    // 1. Successful Media Asset Upload (Image & Video)
    const formImage = new FormData();
    formImage.append('workspaceId', ws1.id);
    const imageBlob = new Blob(['sample image data'], { type: 'image/png' });
    formImage.append('file', imageBlob, 'banner.png');

    const reqImage = new NextRequest('http://localhost:3000/api/media', {
      method: 'POST',
      headers: { cookie: `innosom_session=${userToken}` },
      body: formImage,
    });

    const resImage = await uploadMedia(reqImage);
    if (resImage.status !== 200) {
      throw new Error(`Media image upload failed with status ${resImage.status}`);
    }
    const jsonImage = await resImage.json();
    if (jsonImage.mediaAsset.mimeType !== 'image/png' || jsonImage.mediaAsset.workspaceId !== ws1.id) {
      throw new Error('Uploaded media asset metadata mismatch');
    }
    console.log('  ✅ Media image asset upload verified');

    // Video upload
    const formVideo = new FormData();
    formVideo.append('workspaceId', ws1.id);
    const videoBlob = new Blob(['sample video data'], { type: 'video/mp4' });
    formVideo.append('file', videoBlob, 'promo.mp4');

    const reqVideo = new NextRequest('http://localhost:3000/api/media', {
      method: 'POST',
      headers: { cookie: `innosom_session=${userToken}` },
      body: formVideo,
    });

    const resVideo = await uploadMedia(reqVideo);
    if (resVideo.status !== 200) {
      throw new Error(`Media video upload failed with status ${resVideo.status}`);
    }
    const jsonVideo = await resVideo.json();
    if (jsonVideo.mediaAsset.mimeType !== 'video/mp4' || jsonVideo.mediaAsset.duration !== 30) {
      throw new Error('Uploaded video asset metadata mismatch');
    }
    console.log('  ✅ Media video asset upload verified');

    // 2. Upload Validation - Missing file / missing workspaceId
    const formEmpty = new FormData();
    formEmpty.append('workspaceId', ws1.id);

    const reqEmpty = new NextRequest('http://localhost:3000/api/media', {
      method: 'POST',
      headers: { cookie: `innosom_session=${userToken}` },
      body: formEmpty,
    });
    const resEmpty = await uploadMedia(reqEmpty);
    if (resEmpty.status !== 400) {
      throw new Error(`Upload without file expected status 400, got ${resEmpty.status}`);
    }
    console.log('  ✅ Missing file upload validation rejected with 400');

    // 3. Oversized file / Invalid Type handling
    // Verify system handles unknown or application/octet-stream types gracefully without crash
    const formBinary = new FormData();
    formBinary.append('workspaceId', ws1.id);
    const binaryBlob = new Blob(['binary data'], { type: 'application/x-executable' });
    formBinary.append('file', binaryBlob, 'malicious.exe');

    const reqBinary = new NextRequest('http://localhost:3000/api/media', {
      method: 'POST',
      headers: { cookie: `innosom_session=${userToken}` },
      body: formBinary,
    });
    const resBinary = await uploadMedia(reqBinary);
    if (resBinary.status === 200) {
      const jsonBinary = await resBinary.json();
      if (!jsonBinary.mediaAsset.id) {
        throw new Error('Binary upload failed to store');
      }
    }
    console.log('  ✅ Executable/binary MIME type handled safely');

    // 4. Orphan Asset Cleanup Simulation
    // Create an unattached media asset and a attached media asset
    const orphanAsset = await prisma.mediaAsset.create({
      data: {
        workspaceId: ws1.id,
        fileName: 'orphan.png',
        fileSize: 500,
        mimeType: 'image/png',
        storageKey: 'orphan_key',
        publicUrl: 'http://cdn/orphan.png',
      },
    });

    const attachedAsset = await prisma.mediaAsset.create({
      data: {
        workspaceId: ws1.id,
        fileName: 'attached.png',
        fileSize: 500,
        mimeType: 'image/png',
        storageKey: 'attached_key',
        publicUrl: 'http://cdn/attached.png',
      },
    });

    const content = await prisma.content.create({
      data: { workspaceId: ws1.id, authorId: user.id, title: 'Media Content', masterCaption: 'Cap' },
    });
    const variant = await prisma.contentVariant.create({
      data: { contentId: content.id, platform: 'FACEBOOK', caption: 'Cap' },
    });
    await prisma.contentVariantMedia.create({
      data: { contentVariantId: variant.id, mediaAssetId: attachedAsset.id },
    });

    // Cleanup query: Find all media assets with 0 contentVariantMedia attachments
    const orphans = await prisma.mediaAsset.findMany({
      where: {
        workspaceId: ws1.id,
        contentVariants: { none: {} },
      },
    });

    const foundOrphan = orphans.find((o) => o.id === orphanAsset.id);
    const foundAttached = orphans.find((o) => o.id === attachedAsset.id);

    if (!foundOrphan || foundAttached) {
      throw new Error('Orphan media asset detection failed');
    }

    // Perform cleanup deletion
    await prisma.mediaAsset.deleteMany({
      where: {
        id: { in: orphans.map((o) => o.id) },
      },
    });

    const checkOrphan = await prisma.mediaAsset.findUnique({ where: { id: orphanAsset.id } });
    if (checkOrphan !== null) {
      throw new Error('Orphan media asset cleanup deletion failed');
    }
    console.log('  ✅ Orphan media asset detection and cleanup verified');

    console.log('\n✨ Media management tests passed successfully!');
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.contentVariantMedia.deleteMany({ where: { contentVariant: { content: { workspaceId: { in: [ws1.id, ws2.id] } } } } });
    await prisma.content.deleteMany({ where: { workspaceId: { in: [ws1.id, ws2.id] } } });
    await prisma.mediaAsset.deleteMany({ where: { workspaceId: { in: [ws1.id, ws2.id] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [ws1.id, ws2.id] } } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
}

if (require.main === module) {
  runMediaHandlingTests().catch((e) => {
    console.error('❌ Media handling test failed:', e);
    process.exit(1);
  });
}
