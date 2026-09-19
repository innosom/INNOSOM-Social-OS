import { NextRequest } from 'next/server';
import { prisma } from '../src/lib/prisma';
import { signSessionToken } from '../src/lib/auth';
import { GET as getAnalytics } from '../src/app/api/analytics/route';
import { GET as getAuditLogs } from '../src/app/api/audit-logs/route';
import { GET as getDashboard } from '../src/app/api/dashboard/route';

async function runAnalyticsAuditTests() {
  console.log('\n📊 Running Analytics, Audit Logging & Dashboard Tests...');
  let totalTests = 0;
  let passedTests = 0;

  // Setup test organization & workspaces
  const org = await prisma.organization.create({
    data: { name: 'Analytics Audit Org', slug: `aa-org-${Date.now()}` },
  });

  const ws1 = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'Client 1', slug: 'client-1' },
  });

  const ws2 = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'Client 2', slug: 'client-2' },
  });

  const admin = await prisma.user.create({
    data: { name: 'AA Admin', email: `aa-admin-${Date.now()}@test.com`, passwordHash: 'hash' },
  });

  await prisma.membership.create({
    data: { userId: admin.id, organizationId: org.id, role: 'ADMIN' },
  });

  const token = await signSessionToken({
    userId: admin.id,
    email: admin.email,
    name: admin.name,
    organizationId: org.id,
    role: 'ADMIN',
  });

  try {
    // Populate analytics snapshots
    await prisma.analyticsSnapshot.createMany({
      data: [
        {
          workspaceId: ws1.id,
          platform: 'FACEBOOK',
          date: new Date('2025-01-01'),
          impressions: 1000,
          reach: 800,
          likes: 50,
          comments: 10,
          shares: 5,
          followers: 500,
        },
        {
          workspaceId: ws2.id,
          platform: 'INSTAGRAM',
          date: new Date('2025-01-01'),
          impressions: 2000,
          reach: 1500,
          likes: 120,
          comments: 20,
          shares: 15,
          followers: 1200,
        },
      ],
    });

    // Populate audit logs
    await prisma.auditLog.createMany({
      data: [
        {
          organizationId: org.id,
          workspaceId: ws1.id,
          userId: admin.id,
          action: 'CREATE_CONTENT',
          entityType: 'Content',
          details: JSON.stringify({ title: 'Test Post 1' }),
        },
        {
          organizationId: org.id,
          workspaceId: ws2.id,
          userId: admin.id,
          action: 'UPLOAD_MEDIA',
          entityType: 'MediaAsset',
          details: JSON.stringify({ fileName: 'banner.png' }),
        },
      ],
    });

    // 1. Workspace-scoped Analytics Calculation
    totalTests++;
    const ws1AnalyticsReq = new NextRequest(`http://localhost:3000/api/analytics?workspaceId=${ws1.id}`, {
      headers: { cookie: `innosom_session=${token}` },
    });
    const ws1AnalyticsRes = await getAnalytics(ws1AnalyticsReq);
    const ws1AnalyticsData = await ws1AnalyticsRes.json();

    if (ws1AnalyticsData.summary.totalImpressions !== 1000 || ws1AnalyticsData.summary.totalReach !== 800) {
      throw new Error(`Workspace 1 analytics calculation mismatch: got ${JSON.stringify(ws1AnalyticsData.summary)}`);
    }
    passedTests++;
    console.log('  ✅ 1. Workspace-scoped analytics calculation verified');

    // 2. Agency-wide (ALL_CLIENTS) Analytics Aggregation
    totalTests++;
    const agencyAnalyticsReq = new NextRequest('http://localhost:3000/api/analytics?workspaceId=ALL_CLIENTS', {
      headers: { cookie: `innosom_session=${token}` },
    });
    const agencyAnalyticsRes = await getAnalytics(agencyAnalyticsReq);
    const agencyAnalyticsData = await agencyAnalyticsRes.json();

    if (agencyAnalyticsData.summary.totalImpressions !== 3000 || agencyAnalyticsData.summary.totalReach !== 2300) {
      throw new Error(`Agency-wide analytics aggregation mismatch: got ${JSON.stringify(agencyAnalyticsData.summary)}`);
    }
    passedTests++;
    console.log('  ✅ 2. Agency-wide (ALL_CLIENTS) analytics aggregation verified');

    // 3. Audit Log Retrieval & Filtering
    totalTests++;
    const auditLogsReq = new NextRequest(`http://localhost:3000/api/audit-logs?workspaceId=${ws1.id}`, {
      headers: { cookie: `innosom_session=${token}` },
    });
    const auditLogsRes = await getAuditLogs(auditLogsReq);
    const auditLogsData = await auditLogsRes.json();

    if (auditLogsData.logs.length !== 1 || auditLogsData.logs[0].action !== 'CREATE_CONTENT') {
      throw new Error('Audit log workspace filtering mismatch');
    }
    passedTests++;
    console.log('  ✅ 3. Immutable audit log retrieval and workspace filtering verified');

    // 4. Dashboard Metrics Mode Switching (Agency Mode vs Workspace Mode)
    totalTests++;
    // Agency mode
    const agencyDashReq = new NextRequest('http://localhost:3000/api/dashboard?workspaceId=ALL_CLIENTS', {
      headers: { cookie: `innosom_session=${token}` },
    });
    const agencyDashRes = await getDashboard(agencyDashReq);
    const agencyDashData = await agencyDashRes.json();

    if (agencyDashData.type !== 'AGENCY' || agencyDashData.metrics.activeClientsCount !== 2) {
      throw new Error(`Agency dashboard metrics mismatch: got ${JSON.stringify(agencyDashData.metrics)}`);
    }

    // Workspace mode
    const wsDashReq = new NextRequest(`http://localhost:3000/api/dashboard?workspaceId=${ws1.id}`, {
      headers: { cookie: `innosom_session=${token}` },
    });
    const wsDashRes = await getDashboard(wsDashReq);
    const wsDashData = await wsDashRes.json();

    if (wsDashData.type !== 'WORKSPACE' || wsDashData.workspace.id !== ws1.id) {
      throw new Error(`Workspace dashboard metrics mismatch: got ${JSON.stringify(wsDashData.workspace)}`);
    }
    passedTests++;
    console.log('  ✅ 4. Dashboard metrics mode switching (Agency vs Workspace) verified');

    // Clean up
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.user.delete({ where: { id: admin.id } });

    console.log(`🎉 Analytics, Audit & Dashboard Tests Passed: ${passedTests}/${totalTests}\n`);
    return { passedTests, totalTests };
  } catch (err) {
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: admin.id } }).catch(() => {});
    throw err;
  }
}

if (require.main === module) {
  runAnalyticsAuditTests().catch((e) => {
    console.error('❌ Analytics & Audit tests failed:', e);
    process.exit(1);
  });
}

export { runAnalyticsAuditTests };
