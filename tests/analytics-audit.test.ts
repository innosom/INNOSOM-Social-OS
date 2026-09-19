import { TestRunner, assertEqual, assertTrue, createMockRequest, getTestEntities } from './test-utils';
import { GET as analyticsGET } from '../src/app/api/analytics/route';
import { GET as auditLogsGET } from '../src/app/api/audit-logs/route';
import { prisma } from '../src/lib/prisma';

export async function runAnalyticsAuditTests(): Promise<TestRunner> {
  const runner = new TestRunner('Analytics & Immutable Audit Logs');
  const { adminSession, workspaceA, workspaceB } = await getTestEntities();

  const snapshotA = await prisma.analyticsSnapshot.create({
    data: {
      workspaceId: workspaceA.id,
      platform: 'FACEBOOK',
      date: new Date('2025-01-01'),
      impressions: 10000,
      reach: 5000,
      likes: 500,
      comments: 50,
      shares: 25,
      followers: 1200,
    },
  });

  await runner.test('Analytics Summary Aggregation (ALL_CLIENTS): Calculates totals and engagement rate', async () => {
    const req = await createMockRequest({
      url: '/api/analytics?workspaceId=ALL_CLIENTS',
      session: adminSession,
    });

    const res = await analyticsGET(req);
    assertEqual(res.status, 200);

    const body = await res.json();
    assertTrue(body.summary !== undefined);
    assertTrue(body.summary.totalImpressions >= 10000);
    assertTrue(body.summary.totalReach >= 5000);
    assertTrue(parseFloat(body.summary.engagementRate) >= 0);
  });

  await runner.test('Analytics Workspace Scoping: Scopes metrics to specific workspaceId', async () => {
    const req = await createMockRequest({
      url: `/api/analytics?workspaceId=${workspaceA.id}`,
      session: adminSession,
    });

    const res = await analyticsGET(req);
    assertEqual(res.status, 200);

    const body = await res.json();
    assertTrue(body.snapshots.length >= 1);
    body.snapshots.forEach((s: any) => {
      assertEqual(s.workspaceId, workspaceA.id);
    });
  });

  await runner.test('Analytics Tenant Isolation: Accessing Org B analytics returns 403', async () => {
    const req = await createMockRequest({
      url: `/api/analytics?workspaceId=${workspaceB.id}`,
      session: adminSession,
    });

    const res = await analyticsGET(req);
    assertEqual(res.status, 403);
  });

  await runner.test('Audit Logs Fetching: Retrieves audit logs for organization', async () => {
    const req = await createMockRequest({
      url: '/api/audit-logs?workspaceId=ALL_CLIENTS',
      session: adminSession,
    });

    const res = await auditLogsGET(req);
    assertEqual(res.status, 200);

    const body = await res.json();
    assertTrue(Array.isArray(body.logs));
    assertTrue(body.logs.length > 0);
  });

  await runner.test('Audit Logs Tenant Isolation: Accessing Org B audit logs returns 403', async () => {
    const req = await createMockRequest({
      url: `/api/audit-logs?workspaceId=${workspaceB.id}`,
      session: adminSession,
    });

    const res = await auditLogsGET(req);
    assertEqual(res.status, 403);
  });

  await prisma.analyticsSnapshot.delete({ where: { id: snapshotA.id } });

  return runner;
}
