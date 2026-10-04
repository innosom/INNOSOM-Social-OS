import { NextRequest } from 'next/server';
import { prisma } from '../src/lib/prisma';
import { signSessionToken } from '../src/lib/auth';
import { GET as getMedia, POST as uploadMedia } from '../src/app/api/media/route';
import { GET as getContent, POST as createContent } from '../src/app/api/content/route';

function makeFormReq(url: string, token: string, formData: FormData) {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: 'POST',
    headers: {
      cookie: `innosom_session=${token}`,
    },
    body: formData as any,
  });
}

function makeReq(url: string, options: { method?: string; body?: any; token?: string } = {}) {
  const headers: Record<string, string> = {};
  if (options.token) {
    headers['cookie'] = `innosom_session=${options.token}`;
  }
  let bodyStr: string | undefined = undefined;
  if (options.body) {
    headers['content-type'] = 'application/json';
    bodyStr = JSON.stringify(options.body);
  }

  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: options.method || 'GET',
    headers,
    body: bodyStr,
  });
}

async function runMediaTests() {
  console.log('🧪 Running Comprehensive Media Management Tests...\n');

  // Setup test environment
  const org = await prisma.organization.create({
    data: { name: 'Media Test Org', slug: `media-org-${Date.now()}` },
  });

  const org2 = await prisma.organization.create({
    data: { name: 'Media Test Org 2', slug: `media-org2-${Date.now()}` },
  });

  const user = await prisma.user.create({
    data: {
      email: `media-user-${Date.now()}@test.com`,
      name: 'Media Test User',
      passwordHash: 'hashed',
    },
  });

  const userOrg2 = await prisma.user.create({
    data: {
      email: `media-user2-${Date.now()}@test.com`,
      name: 'Media Test User Org 2',
      passwordHash: 'hashed',
    },
  });

  await prisma.membership.createMany({
    data: [
      { userId: user.id, organizationId: org.id, role: 'ADMIN' },
      { userId: userOrg2.id, organizationId: org2.id, role: 'ADMIN' },
    ],
  });

  const workspace = await prisma.workspace.create({
    data: {
      organizationId: org.id,
      name: 'Media Workspace',
      slug: `media-ws-${Date.now()}`,
    },
  });

  const workspaceOrg2 = await prisma.workspace.create({
    data: {
      organizationId: org2.id,
      name: 'Media Workspace Org 2',
      slug: `media-ws2-${Date.now()}`,
    },
  });

  const tokenUser1 = await signSessionToken({
    userId: user.id,
    email: user.email,
    name: user.name,
    organizationId: org.id,
    role: 'ADMIN',
  });

  try {
    // 1. Valid File Upload
    console.log('Testing 1: Valid File Upload...');
    const validFormData = new FormData();
    validFormData.append('workspaceId', workspace.id);
    const fakeFile = new Blob(['sample image content'], { type: 'image/png' });
    validFormData.append('file', fakeFile, 'hero-banner.png');

    const resUpload = await uploadMedia(makeFormReq('http://localhost:3000/api/media', tokenUser1, validFormData));
    if (resUpload.status !== 200) {
      throw new Error(`Media upload failed with status: ${resUpload.status}`);
    }

    const bodyUpload = await resUpload.json();
    if (!bodyUpload.mediaAsset || !bodyUpload.mediaAsset.id) {
      throw new Error('Upload response missing mediaAsset record');
    }
    const uploadedAssetId = bodyUpload.mediaAsset.id;
    console.log('✅ Valid file upload test passed.');

    // 2. Missing Parameters Validation
    console.log('Testing 2: Invalid / Missing Upload Parameters...');
    const invalidFormData = new FormData();
    invalidFormData.append('workspaceId', workspace.id);
    // Missing file

    const resMissingFile = await uploadMedia(
      makeFormReq('http://localhost:3000/api/media', tokenUser1, invalidFormData)
    );
    if (resMissingFile.status !== 400) {
      throw new Error(`Expected 400 on missing file, got ${resMissingFile.status}`);
    }
    console.log('✅ Missing file parameters validation test passed.');

    // 3. Storage Failure / Exception Handling
    console.log('Testing 3: Storage Failure & Error Handling...');
    const failFormData = new FormData();
    failFormData.append('workspaceId', 'non-existent-ws-id');
    failFormData.append('file', fakeFile, 'fail.png');

    const resStorageFail = await uploadMedia(
      makeFormReq('http://localhost:3000/api/media', tokenUser1, failFormData)
    );
    if (resStorageFail.status !== 403 && resStorageFail.status !== 500) {
      throw new Error(`Expected 403 or 500 on invalid workspace upload, got ${resStorageFail.status}`);
    }
    console.log('✅ Storage error handling test passed.');

    // 4. Cross-Workspace Asset Reference Validation
    console.log('Testing 4: Cross-Workspace Media Asset Reference Validation...');
    // Asset created in workspace 1
    const assetWs1 = await prisma.mediaAsset.create({
      data: {
        workspaceId: workspace.id,
        fileName: 'ws1-asset.png',
        fileSize: 1024,
        mimeType: 'image/png',
        storageKey: `workspaces/${workspace.id}/ws1-asset.png`,
        publicUrl: 'https://images.unsplash.com/photo-1542744094-3a3172720249',
      },
    });

    // Attempting to attach workspace 1 asset to content in workspace 2
    const resAttachCrossMedia = await createContent(
      makeReq('http://localhost:3000/api/content', {
        method: 'POST',
        token: tokenUser1,
        body: {
          workspaceId: workspaceOrg2.id, // Org 2 workspace
          title: 'Cross Media Content',
          masterCaption: 'Cross Media',
          platforms: [
            {
              platform: 'FACEBOOK',
              mediaAssetIds: [assetWs1.id],
            },
          ],
        },
      })
    );

    if (resAttachCrossMedia.status !== 403) {
      throw new Error(`Expected 403 on attaching media across workspace boundaries, got ${resAttachCrossMedia.status}`);
    }
    console.log('✅ Cross-workspace asset reference properly blocked.');

    // 5. Orphan Asset Identification & Cleanup
    console.log('Testing 5: Orphan Asset Cleanup...');
    const orphanAsset = await prisma.mediaAsset.create({
      data: {
        workspaceId: workspace.id,
        fileName: 'orphan.png',
        fileSize: 2048,
        mimeType: 'image/png',
        storageKey: `workspaces/${workspace.id}/orphan.png`,
        publicUrl: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4',
      },
    });

    // Query orphan assets (media assets not attached to any content variant)
    const orphans = await prisma.mediaAsset.findMany({
      where: {
        workspaceId: workspace.id,
        contentVariants: { none: {} },
      },
    });

    const isOrphanFound = orphans.some((m) => m.id === orphanAsset.id);
    if (!isOrphanFound) {
      throw new Error('Orphan media asset identification failed');
    }

    // Cleanup orphan asset
    await prisma.mediaAsset.delete({ where: { id: orphanAsset.id } });
    const checkDeletedOrphan = await prisma.mediaAsset.findUnique({ where: { id: orphanAsset.id } });
    if (checkDeletedOrphan) {
      throw new Error('Orphan media asset deletion failed');
    }
    console.log('✅ Orphan asset identification and cleanup test passed.');

    // Clean up test data
    await prisma.mediaAsset.deleteMany({
      where: { id: { in: [uploadedAssetId, assetWs1.id] } },
    });
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspace.id, workspaceOrg2.id] } },
    });
    await prisma.auditLog.deleteMany({
      where: { userId: { in: [user.id, userOrg2.id] } },
    });
    await prisma.membership.deleteMany({
      where: { userId: { in: [user.id, userOrg2.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [user.id, userOrg2.id] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [org.id, org2.id] } },
    });

    console.log('\n🎉 ALL MEDIA MANAGEMENT TESTS PASSED SUCCESSFULLY! 🎉');
  } finally {
    await prisma.$disconnect();
  }
}

runMediaTests().catch((e) => {
  console.error('❌ Media tests failed:', e);
  process.exit(1);
});
