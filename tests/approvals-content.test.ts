import { TestRunner, assertEqual, assertTrue, createMockRequest, getTestEntities } from './test-utils';
import { POST as contentPOST } from '../src/app/api/content/route';
import { POST as approvePOST } from '../src/app/api/content/approve/route';
import { prisma } from '../src/lib/prisma';

export async function runApprovalsContentTests(): Promise<TestRunner> {
  const runner = new TestRunner('Approvals & Content Lifecycle');
  const { managerSession, editorSession, workspaceA } = await getTestEntities();

  let testContentId: string = '';

  await runner.test('Submit Content for Approval: Creates content with IN_REVIEW status', async () => {
    const req = await createMockRequest({
      url: '/api/content',
      method: 'POST',
      session: editorSession,
      body: {
        workspaceId: workspaceA.id,
        title: 'Q4 Brand Expansion Campaign',
        masterCaption: 'Announcing our new regional headquarters!',
        submitForApproval: true,
        platforms: [
          {
            platform: 'FACEBOOK',
            caption: 'Facebook Brand Expansion Copy',
            hashtags: ['#Growth', '#Expansion'],
          },
          {
            platform: 'INSTAGRAM',
            caption: 'Instagram Brand Expansion Copy',
            hashtags: ['#Design', '#Growth'],
          },
        ],
      },
    });

    const res = await contentPOST(req);
    assertEqual(res.status, 200);

    const body = await res.json();
    assertTrue(body.content !== undefined);
    assertEqual(body.content.status, 'IN_REVIEW');
    testContentId = body.content.id;
  });

  await runner.test('Approve Content Workflow: Manager approves content, updates status to APPROVED and logs audit', async () => {
    assertTrue(testContentId !== '', 'Content ID should be set from previous test');

    const req = await createMockRequest({
      url: '/api/content/approve',
      method: 'POST',
      session: managerSession,
      body: {
        contentId: testContentId,
        action: 'APPROVE',
        comment: 'Great copy and media alignment. Approved for launch!',
      },
    });

    const res = await approvePOST(req);
    assertEqual(res.status, 200);

    const body = await res.json();
    assertEqual(body.content.status, 'APPROVED');

    const approvals = await prisma.approval.findMany({
      where: { contentId: testContentId },
    });
    assertTrue(approvals.length > 0);
    assertEqual(approvals[0].status, 'APPROVED');
    assertEqual(approvals[0].comment, 'Great copy and media alignment. Approved for launch!');

    const auditLogs = await prisma.auditLog.findMany({
      where: { entityId: testContentId, action: 'APPROVE_CONTENT' },
    });
    assertTrue(auditLogs.length > 0);
  });

  await runner.test('Request Changes Workflow: Rejecting content sets status back to DRAFT', async () => {
    const reqCreate = await createMockRequest({
      url: '/api/content',
      method: 'POST',
      session: editorSession,
      body: {
        workspaceId: workspaceA.id,
        title: 'Draft Rejection Test Post',
        masterCaption: 'Needs revision caption',
        submitForApproval: true,
        platforms: [{ platform: 'FACEBOOK', caption: 'Needs revision' }],
      },
    });
    const resCreate = await contentPOST(reqCreate);
    const bodyCreate = await resCreate.json();
    const contentToRejectId = bodyCreate.content.id;

    const reqReject = await createMockRequest({
      url: '/api/content/approve',
      method: 'POST',
      session: managerSession,
      body: {
        contentId: contentToRejectId,
        action: 'REJECT',
        comment: 'Please refine hashtags and update image asset.',
      },
    });

    const resReject = await approvePOST(reqReject);
    assertEqual(resReject.status, 200);

    const bodyReject = await resReject.json();
    assertEqual(bodyReject.content.status, 'DRAFT');

    const auditLogs = await prisma.auditLog.findMany({
      where: { entityId: contentToRejectId, action: 'REQUEST_CONTENT_CHANGES' },
    });
    assertTrue(auditLogs.length > 0);

    await prisma.content.delete({ where: { id: contentToRejectId } });
  });

  if (testContentId) {
    await prisma.content.delete({ where: { id: testContentId } });
  }

  return runner;
}
