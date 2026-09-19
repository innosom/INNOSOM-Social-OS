import { TestRunner, assertEqual, assertTrue, createMockRequest, getTestEntities } from './test-utils';
import { POST as mediaPOST } from '../src/app/api/media/route';
import { POST as contentPOST } from '../src/app/api/content/route';
import { cleanupOrphanMedia } from '../src/lib/media';
import { prisma } from '../src/lib/prisma';

export async function runMediaTests(): Promise<TestRunner> {
  const runner = new TestRunner('Media Asset Operations');
  const { adminSession, workspaceA, workspaceB } = await getTestEntities();

  await runner.test('Upload: Valid image file upload creates MediaAsset record', async () => {
    const formData = new FormData();
    formData.append('workspaceId', workspaceA.id);
    const mockFile = new File(['mock_image_bytes'], 'test_campaign_banner.png', { type: 'image/png' });
    formData.append('file', mockFile);

    const req = await createMockRequest({
      url: '/api/media',
      method: 'POST',
      session: adminSession,
      formData,
    });

    const res = await mediaPOST(req);
    assertEqual(res.status, 200);

    const body = await res.json();
    assertTrue(body.mediaAsset !== undefined);
    assertEqual(body.mediaAsset.fileName, 'test_campaign_banner.png');
    assertEqual(body.mediaAsset.workspaceId, workspaceA.id);

    await prisma.mediaAsset.delete({ where: { id: body.mediaAsset.id } });
  });

  await runner.test('Upload: Valid video file upload creates MediaAsset with video dimensions', async () => {
    const formData = new FormData();
    formData.append('workspaceId', workspaceA.id);
    const mockFile = new File(['mock_video_bytes'], 'promo_video.mp4', { type: 'video/mp4' });
    formData.append('file', mockFile);

    const req = await createMockRequest({
      url: '/api/media',
      method: 'POST',
      session: adminSession,
      formData,
    });

    const res = await mediaPOST(req);
    assertEqual(res.status, 200);

    const body = await res.json();
    assertEqual(body.mediaAsset.mimeType, 'video/mp4');
    assertEqual(body.mediaAsset.width, 1080);
    assertEqual(body.mediaAsset.height, 1920);

    await prisma.mediaAsset.delete({ where: { id: body.mediaAsset.id } });
  });

  await runner.test('Invalid Type: Uploading unsupported file type (e.g. text/plain or executable) returns 400', async () => {
    const formData = new FormData();
    formData.append('workspaceId', workspaceA.id);
    const mockFile = new File(['malicious code'], 'script.sh', { type: 'text/x-shellscript' });
    formData.append('file', mockFile);

    const req = await createMockRequest({
      url: '/api/media',
      method: 'POST',
      session: adminSession,
      formData,
    });

    const res = await mediaPOST(req);
    assertEqual(res.status, 400);
    const body = await res.json();
    assertTrue(body.error.includes('Invalid file type') || body.error.includes('supported'));
  });

  await runner.test('Oversized File: Uploading file exceeding maximum allowed limit (100MB) returns 400', async () => {
    const formData = new FormData();
    formData.append('workspaceId', workspaceA.id);
    const largeFile = new File(['test'], 'giant_file.mp4', { type: 'video/mp4' });
    formData.append('file', largeFile);
    formData.append('fileSize', (105 * 1024 * 1024).toString());

    const req = await createMockRequest({
      url: '/api/media',
      method: 'POST',
      session: adminSession,
      formData,
    });

    const res = await mediaPOST(req);
    assertEqual(res.status, 400);
    const body = await res.json();
    assertTrue(body.error.includes('maximum allowed limit') || body.error.includes('100MB'));
  });

  await runner.test('Storage Failure: Handles stream/storage provider error gracefully (500)', async () => {
    const formData = new FormData();
    formData.append('workspaceId', workspaceA.id);
    const mockFile = new File(['bytes'], 'test.png', { type: 'image/png' });
    formData.append('file', mockFile);
    formData.append('simulateStorageFailure', 'true');

    const req = await createMockRequest({
      url: '/api/media',
      method: 'POST',
      session: adminSession,
      formData,
    });

    const res = await mediaPOST(req);
    assertEqual(res.status, 500);
    const body = await res.json();
    assertTrue(body.error.includes('failed') || body.error.includes('timeout'));
  });

  await runner.test('Orphan Cleanup: Unreferenced media assets are removed successfully', async () => {
    const orphanAsset = await prisma.mediaAsset.create({
      data: {
        workspaceId: workspaceA.id,
        fileName: 'orphan_test_image.jpg',
        fileSize: 500,
        mimeType: 'image/jpeg',
        storageKey: `workspaces/${workspaceA.id}/orphan.jpg`,
        publicUrl: 'https://images.unsplash.com/photo-1542744094-3a3172720249',
      },
    });

    const result = await cleanupOrphanMedia(workspaceA.id);
    assertTrue(result.deletedCount >= 1, 'Orphan media should be identified and deleted');

    const fetched = await prisma.mediaAsset.findUnique({ where: { id: orphanAsset.id } });
    assertEqual(fetched, null, 'Orphan media should no longer exist in DB');
  });

  await runner.test('Cross-workspace media reference: Blocked when posting content across workspaces', async () => {
    const assetB = await prisma.mediaAsset.create({
      data: {
        workspaceId: workspaceB.id,
        fileName: 'org_b_photo.jpg',
        fileSize: 800,
        mimeType: 'image/jpeg',
        storageKey: `workspaces/${workspaceB.id}/photo.jpg`,
        publicUrl: 'https://images.unsplash.com/photo-1542744094-3a3172720249',
      },
    });

    const req = await createMockRequest({
      url: '/api/content',
      method: 'POST',
      session: adminSession,
      body: {
        workspaceId: workspaceA.id,
        title: 'Cross Workspace Media Attachment Attempt',
        masterCaption: 'Attachment test',
        platforms: [
          {
            platform: 'FACEBOOK',
            caption: 'Cross workspace attachment',
            mediaAssetIds: [assetB.id],
          },
        ],
      },
    });

    const res = await contentPOST(req);
    assertEqual(res.status, 400);

    await prisma.mediaAsset.delete({ where: { id: assetB.id } });
  });

  return runner;
}
