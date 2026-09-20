import { NextRequest } from 'next/server';
import { signSessionToken, SessionPayload } from '../src/lib/auth';
import { GET as getAnalytics } from '../src/app/api/analytics/route';
import { GET as getAuditLogs } from '../src/app/api/audit-logs/route';
import { prisma } from '../src/lib/prisma';

export async function runAnalyticsAuditTests() {
  console.log('\n📊 [6/6] Running Analytics, Audit Logs & Error Handling Tests...\n');

  const org1 = await prisma.organization.create({
    data: { name: 'Analytics Org 1', slug: `ana-org-1-${Date.now()}` },
  });
  const org2 = await prisma.organization.create({
    data: { name: 'Analytics Org 2', slug: `ana-org-2-${Date.now()}` },
  });

  const ws1 = await prisma.workspace.create({
    data: { organizationId: org1.id, name: 'Analytics WS 1', slug: `ana-ws-1-${Date.now()}` },
  });
  const ws2 = await prisma.workspace.create({
    data: { organizationId: org2.id, name: 'Analytics WS 2', slug: `ana-ws-2-${Date.now()}` },
  });

  const user1 = await prisma.user.create({
    data: { email: `ana_user1_${Date.now()}@test.com`, name: 'User 1', passwordHash: 'hash' },
  });

  const sessionUser1: SessionPayload = {
    userId: user1.id,
    email: user1.email,
    name: user1.name,
    organizationId: org1.id,
    role: 'ADMIN',
  };

  const tokenUser1 = await signSessionToken(sessionUser1);

  try {
    // 1. Analytics calculation and tenant isolation
    await prisma.analyticsSnapshot.create({
      data: {
        workspaceId: ws1.id,
        platform: 'FACEBOOK',
        date: new Date(),
        impressions: 1000,
        reach: 800,
        likes: 100,
        comments: 20,
        shares: 10,
        followers: 500,
      },
    });

    await prisma.analyticsSnapshot.create({
      data: {
        workspaceId: ws2.id,
        platform: 'FACEBOOK',
        date: new Date(),
        impressions: 99999,
        reach: 88888,
        likes: 7777,
        comments: 666,
        shares: 55,
        followers: 4444,
      },
    });

    // Query analytics for User 1 (Org 1)
    const reqAna1 = new NextRequest(`http://localhost:3000/api/analytics?workspaceId=${ws1.id}`, {
      headers: { cookie: `innosom_session=${tokenUser1}` },
    });
    const resAna1 = await getAnalytics(reqAna1);
    if (resAna1.status !== 200) {
      throw new Error(`Analytics query failed with status ${resAna1.status}`);
    }
    const jsonAna1 = await resAna1.json();
    if (jsonAna1.summary.totalImpressions !== 1000 || jsonAna1.summary.totalLikes !== 100) {
      throw new Error(`Analytics calculation mismatch: Expected 1000 impressions, got ${jsonAna1.summary.totalImpressions}`);
    }
    // Engagement rate = (100 + 20 + 10) / 800 * 100 = 130 / 800 * 100 = 16.25%
    if (jsonAna1.summary.engagementRate !== '16.25') {
      throw new Error(`Engagement rate calculation mismatch: Expected 16.25, got ${jsonAna1.summary.engagementRate}`);
    }
    console.log('  ✅ Analytics metric calculation and engagement rate accuracy verified');

    // Cross-tenant analytics query attempt
    const reqAnaCross = new NextRequest(`http://localhost:3000/api/analytics?workspaceId=${ws2.id}`, {
      headers: { cookie: `innosom_session=${tokenUser1}` },
    });
    const resAnaCross = await getAnalytics(reqAnaCross);
    if (resAnaCross.status !== 403) {
      throw new Error(`Cross-tenant analytics query expected 403, got ${resAnaCross.status}`);
    }
    console.log('  ✅ Cross-workspace analytics access blocked with 403');

    // 2. Audit Logs generation and tenant isolation
    await prisma.auditLog.create({
      data: {
        organizationId: org1.id,
        workspaceId: ws1.id,
        userId: user1.id,
        action: 'CREATE_CONTENT',
        entityType: 'Content',
        details: JSON.stringify({ test: 'Org 1 Action' }),
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: org2.id,
        workspaceId: ws2.id,
        userId: user1.id,
        action: 'DELETE_CONTENT',
        entityType: 'Content',
        details: JSON.stringify({ test: 'Org 2 Action' }),
      },
    });

    // Query audit logs for User 1
    const reqAudit1 = new NextRequest('http://localhost:3000/api/audit-logs', {
      headers: { cookie: `innosom_session=${tokenUser1}` },
    });
    const resAudit1 = await getAuditLogs(reqAudit1);
    if (resAudit1.status !== 200) {
      throw new Error(`Audit logs query failed with status ${resAudit1.status}`);
    }
    const jsonAudit1 = await resAudit1.json();
    const org2Log = jsonAudit1.logs.find((l: any) => l.organizationId === org2.id);
    if (org2Log) {
      throw new Error('SECURITY VIOLATION: Audit logs query returned logs from another organization!');
    }
    console.log('  ✅ Audit log generation and organizational isolation verified');

    // 3. Secure Error Handling (no sensitive leaks in API errors)
    const reqAuditCross = new NextRequest(`http://localhost:3000/api/audit-logs?workspaceId=${ws2.id}`, {
      headers: { cookie: `innosom_session=${tokenUser1}` },
    });
    const resAuditCross = await getAuditLogs(reqAuditCross);
    if (resAuditCross.status !== 403) {
      throw new Error(`Cross-tenant audit log query expected status 403, got ${resAuditCross.status}`);
    }
    const jsonAuditCross = await resAuditCross.json();
    if (jsonAuditCross.error !== 'Forbidden' || JSON.stringify(jsonAuditCross).includes(process.env.ENCRYPTION_KEY || 'key')) {
      throw new Error('API error response leaked internal details or encryption key');
    }
    console.log('  ✅ Secure API error handling verified (no information leakage)');

    console.log('\n✨ Analytics, audit logs & error handling tests passed successfully!');
  } finally {
    await prisma.analyticsSnapshot.deleteMany({ where: { workspaceId: { in: [ws1.id, ws2.id] } } });
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: [org1.id, org2.id] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [ws1.id, ws2.id] } } });
    await prisma.user.delete({ where: { id: user1.id } });
    await prisma.organization.deleteMany({ where: { id: { in: [org1.id, org2.id] } } });
  }
}

if (require.main === module) {
  runAnalyticsAuditTests().catch((e) => {
    console.error('❌ Analytics & Audit test failed:', e);
    process.exit(1);
  });
}
