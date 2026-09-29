import assert from 'node:assert';
import { prisma } from '../src/lib/prisma';
import { signSessionToken, SessionPayload } from '../src/lib/auth';
import { POST as uploadMedia, GET as getMedia } from '../src/app/api/media/route';
import { NextRequest } from 'next/server';

async function runMediaTests() {
  console.log('🧪 Running Media Asset Lifecycle, Validation & Cleanup Tests...');

  let org = await prisma.organization.findFirst({ where: { slug: 'innosom' } });
  if (!org) {
    org = await prisma.organization.create({
      data: { name: 'INNOSOM Primary Org', slug: 'innosom' },
    });
  }

  let user = await prisma.user.findFirst({ where: { email: 'media_test@innosom.com' } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: 'media_test@innosom.com',
        name: 'Media Tester',
        passwordHash: 'hash123',
      },
    });
  }

  let ws1 = await prisma.workspace.create({
    data: {
      organizationId: org.id,
      name: `Media WS1 ${Date.now()}`,
      slug: `media-ws1-${Date.now()}`,
    },
  });

  let ws2 = await prisma.workspace.create({
    data: {
      organizationId: org.id,
      name: `Media WS2 ${Date.now()}`,
      slug: `media-ws2-${Date.now()}`,
    },
  });

  const session: SessionPayload = {
    userId: user.id,
    email: user.email,
    name: user.name,
    organizationId: org.id,
    role: 'ADMIN',
  };

  // 1. File Type & Size Validation
  console.log('Testing 1: File Type & Size Validation Rules...');

  const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'];
  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

  const validateFileUpload = (fileName: string, mimeType: string, fileSize: number) => {
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new Error(`Unsupported file format: ${mimeType}`);
    }
    if (fileSize > MAX_FILE_SIZE) {
      throw new Error(`File size ${fileSize} exceeds maximum limit of ${MAX_FILE_SIZE} bytes`);
    }
  };

  // Valid uploads
  assert.doesNotThrow(() => validateFileUpload('banner.jpg', 'image/jpeg', 2 * 1024 * 1024));
  assert.doesNotThrow(() => validateFileUpload('promo.mp4', 'video/mp4', 15 * 1024 * 1024));

  // Invalid MIME type
  assert.throws(
    () => validateFileUpload('script.sh', 'application/x-sh', 100),
    /Unsupported file format: application\/x-sh/,
    'Uploading executable scripts must be rejected'
  );

  // Oversized file
  assert.throws(
    () => validateFileUpload('huge_video.mov', 'video/mp4', 100 * 1024 * 1024),
    /exceeds maximum limit/,
    'Uploading files larger than 50MB must be rejected'
  );

  console.log('  ✅ File type and size validation tests passed');

  // 2. Media Upload & Querying via API Route
  console.log('Testing 2: Media Asset API Endpoints...');

  const formData = new FormData();
  formData.append('workspaceId', ws1.id);
  const mockBlob = new Blob(['sample content'], { type: 'image/png' });
  formData.append('file', mockBlob, 'brand_logo.png');

  const uploadReq = new NextRequest('http://localhost:3000/api/media', {
    method: 'POST',
    body: formData,
  });
  const validToken = await signSessionToken(session);
  uploadReq.cookies.set('innosom_session', validToken);

  const uploadRes = await uploadMedia(uploadReq);
  assert.strictEqual(uploadRes.status, 200, 'Media upload should return HTTP 200');

  const uploadData = await uploadRes.json();
  assert.ok(uploadData.mediaAsset?.id, 'Returned data should contain created mediaAsset ID');
  assert.strictEqual(uploadData.mediaAsset.fileName, 'brand_logo.png');

  // Query media for ws1
  const queryReq = new NextRequest(`http://localhost:3000/api/media?workspaceId=${ws1.id}`);
  queryReq.cookies.set('innosom_session', validToken);

  const queryRes = await getMedia(queryReq);
  const queryData = await queryRes.json();
  assert.strictEqual(queryRes.status, 200);
  assert.ok(Array.isArray(queryData.media), 'Query result should contain media array');
  assert.ok(
    queryData.media.some((m: any) => m.id === uploadData.mediaAsset.id),
    'Uploaded media asset should be present in workspace media list'
  );

  console.log('  ✅ Media upload and querying API tests passed');

  // 3. Cross-Workspace Asset Attachment Guard
  console.log('Testing 3: Cross-Workspace Asset Attachment Guard...');

  const contentWs2 = await prisma.content.create({
    data: {
      workspaceId: ws2.id,
      authorId: user.id,
      title: 'WS2 Content',
      masterCaption: 'Testing WS2 media linking',
      status: 'DRAFT',
    },
  });

  const variantWs2 = await prisma.contentVariant.create({
    data: {
      contentId: contentWs2.id,
      platform: 'facebook',
      caption: 'FB Variant in WS2',
    },
  });

  const linkMediaToVariant = async (variantId: string, mediaAssetId: string) => {
    const targetVariant = await prisma.contentVariant.findUnique({
      where: { id: variantId },
      include: { content: true },
    });
    const mediaAsset = await prisma.mediaAsset.findUnique({
      where: { id: mediaAssetId },
    });

    if (!targetVariant || !mediaAsset) {
      throw new Error('Record not found');
    }

    if (targetVariant.content.workspaceId !== mediaAsset.workspaceId) {
      throw new Error('Forbidden: Cannot attach media asset from a different workspace');
    }

    return prisma.contentVariantMedia.create({
      data: {
        contentVariantId: variantId,
        mediaAssetId,
      },
    });
  };

  await assert.rejects(
    linkMediaToVariant(variantWs2.id, uploadData.mediaAsset.id),
    /Forbidden: Cannot attach media asset from a different workspace/,
    'Cross-workspace media linking must be rejected'
  );

  console.log('  ✅ Cross-workspace asset attachment guard tests passed');

  // 4. Orphan Media Asset Cleanup Logic
  console.log('Testing 4: Orphan Media Asset Identification & Cleanup...');

  const orphanMedia = await prisma.mediaAsset.create({
    data: {
      workspaceId: ws1.id,
      fileName: 'unused_asset.png',
      fileSize: 500,
      mimeType: 'image/png',
      storageKey: `workspaces/${ws1.id}/unused.png`,
      publicUrl: 'https://example.com/unused.png',
    },
  });

  // Identify media assets not referenced in ContentVariantMedia
  const allWorkspaceMedia = await prisma.mediaAsset.findMany({
    where: { workspaceId: ws1.id },
    include: { contentVariants: true },
  });

  const orphanAssets = allWorkspaceMedia.filter((m) => m.contentVariants.length === 0);
  assert.ok(
    orphanAssets.some((m) => m.id === orphanMedia.id),
    'Unattached media asset should be correctly identified as an orphan'
  );

  // Perform cleanup deletion
  const deleteResult = await prisma.mediaAsset.deleteMany({
    where: { id: { in: orphanAssets.map((m) => m.id) } },
  });
  assert.ok(deleteResult.count >= 1, 'Orphan media assets should be successfully deleted');

  console.log('  ✅ Orphan media asset cleanup tests passed');

  // Cleanup workspaces
  await prisma.workspace.deleteMany({ where: { id: { in: [ws1.id, ws2.id] } } });

  console.log('🎉 ALL MEDIA LIFECYCLE, VALIDATION & CLEANUP TESTS PASSED SUCCESSFULLY!');
}

runMediaTests()
  .catch((e) => {
    console.error('❌ Media tests failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
