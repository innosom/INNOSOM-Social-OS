import { TestRunner, assertEqual, assertTrue, createMockRequest, getTestEntities } from './test-utils';
import { GET as contentGET, POST as contentPOST } from '../src/app/api/content/route';
import { POST as workspacesPOST } from '../src/app/api/workspaces/route';
import { POST as socialPOST, DELETE as socialDELETE } from '../src/app/api/social-connections/route';
import { POST as publishPOST } from '../src/app/api/publications/[id]/publish/route';
import { POST as retryPOST } from '../src/app/api/publications/[id]/retry/route';
import { POST as approvePOST } from '../src/app/api/content/approve/route';
import { prisma } from '../src/lib/prisma';

export async function runSecurityTests(): Promise<TestRunner> {
  const runner = new TestRunner('Security & Tenant Isolation');
  const {
    adminSession,
    editorSession,
    viewerSession,
    orgBSession,
    workspaceA,
    workspaceB,
  } = await getTestEntities();

  // Create test media in Workspace B
  const mediaAssetB = await prisma.mediaAsset.create({
    data: {
      workspaceId: workspaceB.id,
      fileName: 'org_b_secret.jpg',
      fileSize: 1024,
      mimeType: 'image/jpeg',
      storageKey: `workspaces/${workspaceB.id}/secret.jpg`,
      publicUrl: 'https://images.unsplash.com/photo-1542744094-3a3172720249',
    },
  });

  // Create social connection in Workspace B
  const socialConnB = await prisma.socialConnection.create({
    data: {
      workspaceId: workspaceB.id,
      platform: 'FACEBOOK',
      accountName: 'Org B Secret Facebook',
      accountId: 'org_b_fb_123',
      accessTokenEnc: 'enc_token_org_b',
    },
  });

  // Create content and publication in Workspace B
  const contentB = await prisma.content.create({
    data: {
      workspaceId: workspaceB.id,
      authorId: orgBSession.userId,
      title: 'Org B Confidential Content',
      masterCaption: 'Confidential',
      status: 'SCHEDULED',
      variants: {
        create: {
          platform: 'FACEBOOK',
          caption: 'Confidential Variant',
        },
      },
    },
    include: { variants: true },
  });

  const publicationB = await prisma.publication.create({
    data: {
      contentVariantId: contentB.variants[0].id,
      socialConnectionId: socialConnB.id,
      scheduledAt: new Date(),
      status: 'SCHEDULED',
      idempotencyKey: `pub_org_b_${Date.now()}`,
    },
  });

  await runner.test('Unauthorized workspace access: User from Org A accessing Workspace B returns 403', async () => {
    const req = await createMockRequest({
      url: `/api/content?workspaceId=${workspaceB.id}`,
      session: adminSession,
    });
    const res = await contentGET(req);
    assertEqual(res.status, 403);
  });

  await runner.test('Cross-workspace content listing isolation', async () => {
    const req = await createMockRequest({
      url: `/api/content?workspaceId=ALL_CLIENTS`,
      session: adminSession,
    });
    const res = await contentGET(req);
    assertEqual(res.status, 200);
    const body = await res.json();
    const foundB = body.contents.find((c: any) => c.id === contentB.id);
    assertEqual(foundB, undefined, 'Org A should not see Org B content under ALL_CLIENTS');
  });

  await runner.test('Cross-workspace media reference: Referencing Org B media in Org A post is blocked with 400', async () => {
    const req = await createMockRequest({
      url: '/api/content',
      method: 'POST',
      session: editorSession,
      body: {
        workspaceId: workspaceA.id,
        title: 'Cross Workspace Media Attack Attempt',
        masterCaption: 'Attacking media asset',
        platforms: [
          {
            platform: 'FACEBOOK',
            caption: 'Attack',
            mediaAssetIds: [mediaAssetB.id],
          },
        ],
      },
    });
    const res = await contentPOST(req);
    assertEqual(res.status, 400);
    const body = await res.json();
    assertTrue(body.error.includes('media assets from another workspace') || body.error.includes('Forbidden'));
  });

  await runner.test('Cross-workspace social connection disconnect attempt returns 403', async () => {
    const req = await createMockRequest({
      url: `/api/social-connections?id=${socialConnB.id}`,
      method: 'DELETE',
      session: adminSession,
    });
    const res = await socialDELETE(req);
    assertEqual(res.status, 403);
  });

  await runner.test('Cross-workspace publication trigger attempt returns 403', async () => {
    const req = await createMockRequest({
      url: `/api/publications/${publicationB.id}/publish`,
      method: 'POST',
      session: adminSession,
    });
    const res = await publishPOST(req, { params: Promise.resolve({ id: publicationB.id }) });
    assertEqual(res.status, 403);
  });

  await runner.test('Cross-workspace publication retry attempt returns 403', async () => {
    const req = await createMockRequest({
      url: `/api/publications/${publicationB.id}/retry`,
      method: 'POST',
      session: adminSession,
    });
    const res = await retryPOST(req, { params: Promise.resolve({ id: publicationB.id }) });
    assertEqual(res.status, 403);
  });

  await runner.test('Role Violation: VIEWER role blocked from creating content (403)', async () => {
    const req = await createMockRequest({
      url: '/api/content',
      method: 'POST',
      session: viewerSession,
      body: {
        workspaceId: workspaceA.id,
        title: 'Viewer Post Attempt',
        masterCaption: 'Testing viewer restriction',
        platforms: [{ platform: 'FACEBOOK', caption: 'Viewer' }],
      },
    });
    const res = await contentPOST(req);
    assertEqual(res.status, 403);
  });

  await runner.test('Role Violation: VIEWER role blocked from approving content (403)', async () => {
    const req = await createMockRequest({
      url: '/api/content/approve',
      method: 'POST',
      session: viewerSession,
      body: { contentId: contentB.id, action: 'APPROVE' },
    });
    const res = await approvePOST(req);
    assertEqual(res.status, 403);
  });

  await runner.test('Role Violation: EDITOR role blocked from creating new workspace (403)', async () => {
    const req = await createMockRequest({
      url: '/api/workspaces',
      method: 'POST',
      session: editorSession,
      body: { name: 'Unauthorized Workspace by Editor' },
    });
    const res = await workspacesPOST(req);
    assertEqual(res.status, 403);
  });

  await runner.test('Role Compliance: ADMIN role permitted to create new workspace', async () => {
    const req = await createMockRequest({
      url: '/api/workspaces',
      method: 'POST',
      session: adminSession,
      body: { name: `Sec Test Workspace ${Date.now()}` },
    });
    const res = await workspacesPOST(req);
    assertEqual(res.status, 200);
  });

  await runner.test('ALL_CLIENTS abuse: Creating content with workspaceId=ALL_CLIENTS returns 400', async () => {
    const req = await createMockRequest({
      url: '/api/content',
      method: 'POST',
      session: adminSession,
      body: {
        workspaceId: 'ALL_CLIENTS',
        title: 'All Clients Post Abuse',
        masterCaption: 'Abuse attempt',
        platforms: [{ platform: 'FACEBOOK', caption: 'Abuse' }],
      },
    });
    const res = await contentPOST(req);
    assertEqual(res.status, 400);
  });

  await runner.test('ALL_CLIENTS abuse: Creating social connection with workspaceId=ALL_CLIENTS returns 400', async () => {
    const req = await createMockRequest({
      url: '/api/social-connections',
      method: 'POST',
      session: adminSession,
      body: {
        workspaceId: 'ALL_CLIENTS',
        platform: 'FACEBOOK',
        accountName: 'Abuse FB',
        accountId: 'abuse_123',
      },
    });
    const res = await socialPOST(req);
    assertEqual(res.status, 400);
  });

  // Clean up Org B security test entities
  await prisma.publication.delete({ where: { id: publicationB.id } });
  await prisma.content.delete({ where: { id: contentB.id } });
  await prisma.socialConnection.delete({ where: { id: socialConnB.id } });
  await prisma.mediaAsset.delete({ where: { id: mediaAssetB.id } });

  return runner;
}
