import { NextRequest } from 'next/server';
import { prisma } from '../src/lib/prisma';
import { signSessionToken } from '../src/lib/auth';
import { POST as createContent, GET as getContent } from '../src/app/api/content/route';
import { POST as approveContent } from '../src/app/api/content/approve/route';
import { encryptToken } from '../src/lib/encryption';

async function runContentApprovalsTests() {
  console.log('\n📝 Running Content & Approvals Workflow Tests...');
  let totalTests = 0;
  let passedTests = 0;

  function makeReq(url: string, method: string = 'GET', body?: any, token?: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['cookie'] = `innosom_session=${token}`;
    }
    return new NextRequest(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  // Setup test org, workspace, users
  const org = await prisma.organization.create({
    data: { name: 'Content Test Org', slug: `content-org-${Date.now()}` },
  });

  const workspace = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'Content Client', slug: 'content-client' },
  });

  // Create connected social account for scheduling
  const conn = await prisma.socialConnection.create({
    data: {
      workspaceId: workspace.id,
      platform: 'FACEBOOK',
      accountName: 'Test FB Page',
      accountId: `fb_page_${Date.now()}`,
      status: 'CONNECTED',
      accessTokenEnc: encryptToken('mock_token')!,
    },
  });

  const admin = await prisma.user.create({
    data: { name: 'Content Admin', email: `content-admin-${Date.now()}@test.com`, passwordHash: 'hash' },
  });
  const editor = await prisma.user.create({
    data: { name: 'Content Editor', email: `content-editor-${Date.now()}@test.com`, passwordHash: 'hash' },
  });

  await prisma.membership.createMany({
    data: [
      { userId: admin.id, organizationId: org.id, role: 'ADMIN' },
      { userId: editor.id, organizationId: org.id, role: 'EDITOR' },
    ],
  });

  const adminToken = await signSessionToken({
    userId: admin.id,
    email: admin.email,
    name: admin.name,
    organizationId: org.id,
    role: 'ADMIN',
  });

  const editorToken = await signSessionToken({
    userId: editor.id,
    email: editor.email,
    name: editor.name,
    organizationId: org.id,
    role: 'EDITOR',
  });

  try {
    // 1. Content creation with platform variant overrides
    totalTests++;
    const createReq = makeReq('http://localhost:3000/api/content', 'POST', {
      workspaceId: workspace.id,
      title: 'Campaign Announcement',
      masterCaption: 'Default Master Caption',
      platforms: [
        {
          platform: 'FACEBOOK',
          caption: 'Facebook Custom Caption',
          hashtags: ['fb', 'tech'],
        },
        {
          platform: 'INSTAGRAM',
          caption: 'Instagram Custom Caption',
          hashtags: ['insta', 'photo'],
        },
      ],
      submitForApproval: true,
    }, editorToken);

    const createRes = await createContent(createReq);
    if (createRes.status !== 200) {
      throw new Error(`Failed to create content: ${createRes.status}`);
    }
    const createData = await createRes.json();
    const contentId = createData.content.id;

    if (createData.content.status !== 'IN_REVIEW') {
      throw new Error(`Expected content status IN_REVIEW, got ${createData.content.status}`);
    }
    passedTests++;
    console.log('  ✅ 1. Content creation with platform variant overrides and IN_REVIEW status succeeded');

    // 2. Fetch content list filtered by workspace and status
    totalTests++;
    const getReq = makeReq(`http://localhost:3000/api/content?workspaceId=${workspace.id}&status=IN_REVIEW`, 'GET', undefined, adminToken);
    const getRes = await getContent(getReq);
    const getData = await getRes.json();

    if (!getData.contents || getData.contents.length === 0) {
      throw new Error('Failed to fetch pending review content');
    }
    const fetchedContent = getData.contents.find((c: any) => c.id === contentId);
    if (!fetchedContent || fetchedContent.variants.length !== 2) {
      throw new Error('Variants were not properly associated with created content');
    }
    passedTests++;
    console.log('  ✅ 2. Content retrieval and variant inclusion verified');

    // 3. Approval Workflow: Reject / Request Changes
    totalTests++;
    const rejectReq = makeReq('http://localhost:3000/api/content/approve', 'POST', {
      contentId,
      action: 'REJECT',
      comment: 'Please update caption for Instagram',
    }, adminToken);
    const rejectRes = await approveContent(rejectReq);
    if (rejectRes.status !== 200) {
      throw new Error(`Failed to process rejection: ${rejectRes.status}`);
    }

    const updatedRejected = await prisma.content.findUnique({ where: { id: contentId } });
    if (updatedRejected?.status !== 'DRAFT') {
      throw new Error(`Expected status DRAFT after rejection, got ${updatedRejected?.status}`);
    }
    passedTests++;
    console.log('  ✅ 3. Approval workflow rejection (IN_REVIEW -> DRAFT) verified');

    // 4. Approval Workflow: Approve Content
    totalTests++;
    const approveReq = makeReq('http://localhost:3000/api/content/approve', 'POST', {
      contentId,
      action: 'APPROVE',
      comment: 'Approved for publication!',
    }, adminToken);
    const approveRes = await approveContent(approveReq);
    if (approveRes.status !== 200) {
      throw new Error(`Failed to approve content: ${approveRes.status}`);
    }

    const updatedApproved = await prisma.content.findUnique({
      where: { id: contentId },
      include: { approvals: true, variants: { include: { publications: true } } },
    });

    if (updatedApproved?.status !== 'APPROVED' && updatedApproved?.status !== 'PUBLISHED') {
      throw new Error(`Expected status APPROVED or PUBLISHED, got ${updatedApproved?.status}`);
    }
    if (updatedApproved.approvals.length !== 2) {
      throw new Error(`Expected 2 approval records (reject + approve), got ${updatedApproved.approvals.length}`);
    }
    passedTests++;
    console.log('  ✅ 4. Approval workflow approve (DRAFT -> APPROVED/PUBLISHED) and history log verified');

    // 5. Approving content created scheduled publication records
    totalTests++;
    const publications = await prisma.publication.findMany({
      where: { contentVariant: { contentId } },
    });
    if (publications.length === 0) {
      throw new Error('Approval did not generate scheduled publication record for connected platform');
    }
    passedTests++;
    console.log('  ✅ 5. Scheduled publication auto-creation on approval verified');

    // 6. Non-existent content approval attempt returns 404
    totalTests++;
    const invalidApproveReq = makeReq('http://localhost:3000/api/content/approve', 'POST', {
      contentId: '00000000-0000-0000-0000-000000000000',
      action: 'APPROVE',
    }, adminToken);
    const invalidApproveRes = await approveContent(invalidApproveReq);
    if (invalidApproveRes.status !== 404) {
      throw new Error(`Expected status 404 for non-existent content approval, got ${invalidApproveRes.status}`);
    }
    passedTests++;
    console.log('  ✅ 6. Non-existent content approval returned 404 Not Found');

    // Clean up
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, editor.id] } } });

    console.log(`🎉 Content & Approvals Tests Passed: ${passedTests}/${totalTests}\n`);
    return { passedTests, totalTests };
  } catch (err) {
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, editor.id] } } }).catch(() => {});
    throw err;
  }
}

if (require.main === module) {
  runContentApprovalsTests().catch((e) => {
    console.error('❌ Content & Approvals tests failed:', e);
    process.exit(1);
  });
}

export { runContentApprovalsTests };
