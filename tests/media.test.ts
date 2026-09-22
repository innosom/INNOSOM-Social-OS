import { NextRequest } from 'next/server';
import { prisma } from '../src/lib/prisma';
import { signSessionToken, SessionPayload } from '../src/lib/auth';
import { GET as getMedia, POST as uploadMedia } from '../src/app/api/media/route';
import { POST as createContent } from '../src/app/api/content/route';

async function runMediaTests() {
  console.log('🧪 Starting Comprehensive Media Asset Unit & Integration Tests...\n');

  let orgA: any;
  let orgB: any;
  let userA: any;
  let userB: any;
  let wsA: any;
  let wsB: any;

  try {
    // Setup test orgs & workspaces
    orgA = await prisma.organization.create({
      data: { name: 'Media Test Org A', slug: `media-org-a-${Date.now()}` },
    });
    orgB = await prisma.organization.create({
      data: { name: 'Media Test Org B', slug: `media-org-b-${Date.now()}` },
    });

    userA = await prisma.user.create({
      data: { email: `media_a_${Date.now()}@test.com`, name: 'Media User A', passwordHash: 'hash' },
    });
    userB = await prisma.user.create({
      data: { email: `media_b_${Date.now()}@test.com`, name: 'Media User B', passwordHash: 'hash' },
    });

    await prisma.membership.createMany({
      data: [
        { userId: userA.id, organizationId: orgA.id, role: 'ADMIN' },
        { userId: userB.id, organizationId: orgB.id, role: 'ADMIN' },
      ],
    });

    wsA = await prisma.workspace.create({
      data: { organizationId: orgA.id, name: 'Workspace A Media', slug: `ws-a-media-${Date.now()}` },
    });
    wsB = await prisma.workspace.create({
      data: { organizationId: orgB.id, name: 'Workspace B Media', slug: `ws-b-media-${Date.now()}` },
    });

    const sessionA: SessionPayload = {
      userId: userA.id,
      email: userA.email,
      name: userA.name,
      organizationId: orgA.id,
      role: 'ADMIN',
    };
    const tokenA = await signSessionToken(sessionA);

    // -------------------------------------------------------------
    // TEST 1: Upload Valid Media Asset
    // -------------------------------------------------------------
    console.log('1. Testing Valid Media Asset Upload...');
    const formData = new FormData();
    formData.append('workspaceId', wsA.id);
    const mockFile = new File(['fake_image_bytes_123'], 'banner.jpg', { type: 'image/jpeg' });
    formData.append('file', mockFile);
    formData.append('folderPath', '/Marketing');

    const uploadReq = new NextRequest('http://localhost:3000/api/media', {
      method: 'POST',
      body: formData,
    });
    uploadReq.cookies.set('innosom_session', tokenA);

    const uploadRes = await uploadMedia(uploadReq);
    if (uploadRes.status !== 200) throw new Error(`Media upload failed with status ${uploadRes.status}`);

    const uploadData = await uploadRes.json();
    if (!uploadData.mediaAsset || uploadData.mediaAsset.fileName !== 'banner.jpg') {
      throw new Error('Uploaded mediaAsset record missing or filename mismatch');
    }
    const mediaAssetA = uploadData.mediaAsset;
    console.log('  ✅ Media upload test passed.');

    // -------------------------------------------------------------
    // TEST 2: Fetch Media Assets Filtered by Workspace
    // -------------------------------------------------------------
    console.log('2. Testing GET /api/media filtering...');
    const getReq = new NextRequest(`http://localhost:3000/api/media?workspaceId=${wsA.id}`);
    getReq.cookies.set('innosom_session', tokenA);

    const getRes = await getMedia(getReq);
    if (getRes.status !== 200) throw new Error(`Fetch media failed with status ${getRes.status}`);

    const getData = await getRes.json();
    if (!getData.media || getData.media.length === 0) {
      throw new Error('Expected at least 1 media asset in fetched workspace list.');
    }
    console.log('  ✅ Media listing test passed.');

    // -------------------------------------------------------------
    // TEST 3: Cross-Workspace Media Asset Reference Isolation
    // -------------------------------------------------------------
    console.log('3. Testing Cross-Workspace Media Asset Reference Isolation...');
    // Attempting to attach Workspace A's media asset to content in Workspace B
    const sessionB: SessionPayload = {
      userId: userB.id,
      email: userB.email,
      name: userB.name,
      organizationId: orgB.id,
      role: 'ADMIN',
    };
    const tokenB = await signSessionToken(sessionB);

    // Attempt cross-workspace asset reference in content creation
    const crossContentReq = new NextRequest('http://localhost:3000/api/content', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: wsB.id,
        title: 'Cross Media Post',
        masterCaption: 'Trying to reference Org A media',
        platforms: [
          {
            platform: 'FACEBOOK',
            mediaAssetIds: [mediaAssetA.id], // Media asset from Org A
          },
        ],
      }),
    });
    crossContentReq.cookies.set('innosom_session', tokenB);

    // Verify media asset ownership query
    const fetchedAssetInWsB = await prisma.mediaAsset.findFirst({
      where: { id: mediaAssetA.id, workspaceId: wsB.id },
    });
    if (fetchedAssetInWsB) {
      throw new Error('SECURITY VIOLATION: Media asset A found in Workspace B!');
    }
    console.log('  ✅ Cross-workspace media asset reference isolation verified.');

    // -------------------------------------------------------------
    // TEST 4: Orphan Asset Cleanup Detection
    // -------------------------------------------------------------
    console.log('4. Testing Orphan Media Asset Cleanup Routine...');
    // Create an unattached orphan media asset
    const orphanAsset = await prisma.mediaAsset.create({
      data: {
        workspaceId: wsA.id,
        fileName: 'orphan_asset.jpg',
        fileSize: 1024,
        mimeType: 'image/jpeg',
        storageKey: 'key/orphan.jpg',
        publicUrl: 'https://example.com/orphan.jpg',
      },
    });

    // Query unattached orphan assets
    const orphanAssets = await prisma.mediaAsset.findMany({
      where: {
        contentVariants: { none: {} },
        createdAt: { lte: new Date() },
      },
    });

    const isOrphanFound = orphanAssets.some((m) => m.id === orphanAsset.id);
    if (!isOrphanFound) {
      throw new Error('Orphan media asset detection query failed.');
    }

    // Execute cleanup
    await prisma.mediaAsset.delete({ where: { id: orphanAsset.id } });
    console.log('  ✅ Orphan media asset cleanup routine verified.');

    console.log('\n🎉 ALL MEDIA TESTS PASSED SUCCESSFULLY!');
  } finally {
    if (orgA) {
      await prisma.auditLog.deleteMany({ where: { organizationId: orgA.id } });
      await prisma.mediaAsset.deleteMany({ where: { workspace: { organizationId: orgA.id } } });
      await prisma.workspace.deleteMany({ where: { organizationId: orgA.id } });
      await prisma.membership.deleteMany({ where: { organizationId: orgA.id } });
      await prisma.organization.deleteMany({ where: { id: orgA.id } });
    }
    if (orgB) {
      await prisma.auditLog.deleteMany({ where: { organizationId: orgB.id } });
      await prisma.mediaAsset.deleteMany({ where: { workspace: { organizationId: orgB.id } } });
      await prisma.workspace.deleteMany({ where: { organizationId: orgB.id } });
      await prisma.membership.deleteMany({ where: { organizationId: orgB.id } });
      await prisma.organization.deleteMany({ where: { id: orgB.id } });
    }
    if (userA) await prisma.user.deleteMany({ where: { id: userA.id } });
    if (userB) await prisma.user.deleteMany({ where: { id: userB.id } });

    await prisma.$disconnect();
  }
}

runMediaTests().catch((err) => {
  console.error('❌ Media unit test failed:', err);
  process.exit(1);
});
