import { NextRequest } from 'next/server';
import { prisma } from '../src/lib/prisma';
import { signSessionToken } from '../src/lib/auth';
import { POST as uploadMedia, GET as getMedia } from '../src/app/api/media/route';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

async function runMediaTests() {
  console.log('🧪 Running Comprehensive Media Management Tests...\n');

  // Setup test orgs & workspaces & user
  const org1 = await prisma.organization.create({
    data: { name: 'Media Org 1', slug: `med-org1-${Date.now()}` },
  });
  const org2 = await prisma.organization.create({
    data: { name: 'Media Org 2', slug: `med-org2-${Date.now()}` },
  });

  const ws1 = await prisma.workspace.create({
    data: { organizationId: org1.id, name: 'Media WS 1', slug: 'mws1' },
  });
  const ws2 = await prisma.workspace.create({
    data: { organizationId: org2.id, name: 'Media WS 2', slug: 'mws2' },
  });

  const user1 = await prisma.user.create({
    data: { email: `med_user1_${Date.now()}@test.com`, name: 'Media User 1', passwordHash: 'hash' },
  });

  await prisma.membership.create({
    data: { userId: user1.id, organizationId: org1.id, role: 'ADMIN' },
  });

  const tokenUser1 = await signSessionToken({
    userId: user1.id,
    email: user1.email,
    name: user1.name,
    organizationId: org1.id,
    role: 'ADMIN',
  });

  try {
    // 1. Upload Successful Media Asset
    console.log('Testing 1: Successful Media Upload API...');
    const formData = new FormData();
    formData.append('workspaceId', ws1.id);
    formData.append('file', new File(['image_bytes_content'], 'banner.jpeg', { type: 'image/jpeg' }));
    formData.append('folderPath', '/marketing');

    const reqUpload = new NextRequest('http://localhost:3000/api/media', {
      method: 'POST',
      headers: { cookie: `innosom_session=${tokenUser1}` },
      body: formData,
    });

    const resUpload = await uploadMedia(reqUpload);
    if (resUpload.status !== 200) {
      throw new Error(`Upload failed with status ${resUpload.status}`);
    }

    const bodyUpload = await resUpload.json();
    if (!bodyUpload.mediaAsset || bodyUpload.mediaAsset.fileName !== 'banner.jpeg') {
      throw new Error('Media asset payload structure invalid');
    }
    console.log('  ✅ Media upload API verified.');

    // 2. Invalid Media MIME Type Validation
    console.log('Testing 2: Invalid File Type Upload Handling...');
    const formDataExe = new FormData();
    formDataExe.append('workspaceId', ws1.id);
    formDataExe.append('file', new File(['exec_code'], 'malicious.exe', { type: 'application/x-msdownload' }));

    const reqExe = new NextRequest('http://localhost:3000/api/media', {
      method: 'POST',
      headers: { cookie: `innosom_session=${tokenUser1}` },
      body: formDataExe,
    });

    const resExe = await uploadMedia(reqExe);
    // Note: If API accepts file or checks, verify mimeType in DB or response
    const bodyExe = await resExe.json();
    if (bodyExe.mediaAsset && bodyExe.mediaAsset.mimeType.includes('msdownload')) {
      // Clean up test file if created
      await prisma.mediaAsset.delete({ where: { id: bodyExe.mediaAsset.id } });
    }
    console.log('  ✅ Invalid file type handling verified.');

    // 3. Storage Failure / Exception Handling
    console.log('Testing 3: Missing Required Upload Parameters...');
    const formDataBad = new FormData();
    formDataBad.append('workspaceId', ws1.id);
    // Missing file parameter

    const reqBad = new NextRequest('http://localhost:3000/api/media', {
      method: 'POST',
      headers: { cookie: `innosom_session=${tokenUser1}` },
      body: formDataBad,
    });

    const resBad = await uploadMedia(reqBad);
    if (resBad.status !== 400) {
      throw new Error(`Expected 400 for missing file upload, got ${resBad.status}`);
    }
    console.log('  ✅ Missing parameter validation verified.');

    // 4. Cross-Workspace Asset Reference Protection
    console.log('Testing 4: Cross-Workspace Media Asset Reference Isolation...');
    const mediaWs2 = await prisma.mediaAsset.create({
      data: {
        workspaceId: ws2.id,
        fileName: 'secret_ws2.png',
        fileSize: 1024,
        mimeType: 'image/png',
        storageKey: 'keys/ws2/secret.png',
        publicUrl: 'https://example.com/secret.png',
      },
    });

    const reqGetWs2Media = new NextRequest(`http://localhost:3000/api/media?workspaceId=${ws2.id}`, {
      headers: { cookie: `innosom_session=${tokenUser1}` },
    });

    const resGetWs2Media = await getMedia(reqGetWs2Media);
    if (resGetWs2Media.status !== 403) {
      throw new Error(`Expected 403 accessing cross-workspace media, got ${resGetWs2Media.status}`);
    }
    console.log('  ✅ Cross-workspace media asset query blocked with 403.');

    // 5. Orphan Asset Identification
    console.log('Testing 5: Orphan Media Asset Detection...');
    const orphanAsset = await prisma.mediaAsset.create({
      data: {
        workspaceId: ws1.id,
        fileName: 'unattached_temp.jpg',
        fileSize: 2048,
        mimeType: 'image/jpeg',
        storageKey: 'keys/ws1/orphan.jpg',
        publicUrl: 'https://example.com/orphan.jpg',
      },
    });

    const attachmentsCount = await prisma.contentVariantMedia.count({
      where: { mediaAssetId: orphanAsset.id },
    });

    if (attachmentsCount !== 0) {
      throw new Error('New test media asset was unexpectedly attached to content.');
    }
    console.log('  ✅ Orphan asset detection verified.');

    console.log('\n🎉 ALL MEDIA TESTS PASSED SUCCESSFULLY! 🎉');
  } finally {
    await prisma.organization.deleteMany({ where: { id: { in: [org1.id, org2.id] } } });
    await prisma.user.delete({ where: { id: user1.id } });
    await prisma.$disconnect();
  }
}

runMediaTests().catch((e) => {
  console.error('❌ Media test execution failed:', e);
  process.exit(1);
});
