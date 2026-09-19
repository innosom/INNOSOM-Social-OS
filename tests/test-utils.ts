import { NextRequest } from 'next/server';
import { signSessionToken, SessionPayload } from '../src/lib/auth';
import { prisma } from '../src/lib/prisma';

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export class TestRunner {
  private categoryName: string;
  private results: TestResult[] = [];

  constructor(categoryName: string) {
    this.categoryName = categoryName;
  }

  async test(name: string, fn: () => Promise<void> | void): Promise<void> {
    try {
      await fn();
      this.results.push({ name, passed: true });
      console.log(`  ✅ ${name}`);
    } catch (err: any) {
      this.results.push({ name, passed: false, error: err.message || String(err) });
      console.error(`  ❌ ${name}:`, err.message || err);
    }
  }

  printSummary(): { total: number; passed: number; failed: number } {
    const passed = this.results.filter((r) => r.passed).length;
    const failed = this.results.filter((r) => !r.passed).length;
    console.log(`\n📋 [${this.categoryName}] Passed: ${passed}/${this.results.length}`);
    if (failed > 0) {
      console.error(`❌ Failed tests in ${this.categoryName}:`);
      this.results.filter((r) => !r.passed).forEach((r) => console.error(`   - ${r.name}: ${r.error}`));
    }
    return { total: this.results.length, passed, failed };
  }

  getResults() {
    return this.results;
  }
}

export function assertEqual(actual: any, expected: any, message?: string) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function assertTrue(condition: boolean, message?: string) {
  if (!condition) {
    throw new Error(message || 'Expected condition to be true');
  }
}

export function assertFalse(condition: boolean, message?: string) {
  if (condition) {
    throw new Error(message || 'Expected condition to be false');
  }
}

export async function createMockRequest(options: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  session?: SessionPayload | null;
  cookies?: Record<string, string>;
  formData?: FormData;
}): Promise<NextRequest> {
  const { url, method = 'GET', headers = {}, body, session, cookies = {}, formData } = options;
  const reqHeaders = new Headers(headers);

  if (session !== undefined && session !== null) {
    const token = await signSessionToken(session);
    reqHeaders.set('cookie', `innosom_session=${token}`);
  } else {
    for (const [k, v] of Object.entries(cookies)) {
      reqHeaders.set('cookie', `${k}=${v}`);
    }
  }

  const reqInit: any = {
    method,
    headers: reqHeaders,
  };

  if (formData) {
    reqInit.body = formData;
  } else if (body !== undefined) {
    reqHeaders.set('content-type', 'application/json');
    reqInit.body = JSON.stringify(body);
  }

  return new NextRequest(new URL(url, 'http://localhost:3000'), reqInit);
}

export async function getTestEntities() {
  const orgA = await prisma.organization.findFirst({
    where: { slug: 'innosom' },
    include: { workspaces: true, users: { include: { user: true } } },
  });

  if (!orgA) {
    throw new Error('Database not seeded properly. Please run npm run db:seed first.');
  }

  let orgB = await prisma.organization.findFirst({
    where: { slug: 'external-agency' },
    include: { workspaces: true },
  });

  if (!orgB) {
    orgB = await prisma.organization.create({
      data: {
        name: 'External Security Agency Org B',
        slug: 'external-agency',
        workspaces: {
          create: {
            name: 'Org B Isolated Workspace',
            slug: 'org-b-workspace',
          },
        },
      },
      include: { workspaces: true },
    });
  }

  const workspaceA = orgA.workspaces[0];
  const workspaceA2 = orgA.workspaces[1] || workspaceA;
  const workspaceB = orgB.workspaces[0];

  const adminMember = orgA.users.find((u) => u.role === 'ADMIN');
  const managerMember = orgA.users.find((u) => u.role === 'MANAGER');
  const editorMember = orgA.users.find((u) => u.role === 'EDITOR');

  const adminUser = adminMember ? adminMember.user : { id: 'admin-id', email: 'admin@innosom.com', name: 'Admin User' };
  const managerUser = managerMember ? managerMember.user : { id: 'manager-id', email: 'manager@innosom.com', name: 'Manager User' };
  const editorUser = editorMember ? editorMember.user : { id: 'editor-id', email: 'editor@innosom.com', name: 'Editor User' };

  let viewerUser = await prisma.user.findUnique({ where: { email: 'viewer@innosom.com' } });
  if (!viewerUser) {
    viewerUser = await prisma.user.create({
      data: {
        email: 'viewer@innosom.com',
        name: 'Viewer User',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz0123456789',
        memberships: {
          create: {
            organizationId: orgA.id,
            role: 'VIEWER',
          },
        },
      },
    });
  }

  let orgBUser = await prisma.user.findUnique({ where: { email: 'user@external.com' } });
  if (!orgBUser) {
    orgBUser = await prisma.user.create({
      data: {
        email: 'user@external.com',
        name: 'Org B User',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz0123456789',
        memberships: {
          create: {
            organizationId: orgB.id,
            role: 'ADMIN',
          },
        },
      },
    });
  }

  const adminSession: SessionPayload = {
    userId: adminUser.id,
    email: adminUser.email,
    name: adminUser.name,
    organizationId: orgA.id,
    role: 'ADMIN',
  };

  const managerSession: SessionPayload = {
    userId: managerUser.id,
    email: managerUser.email,
    name: managerUser.name,
    organizationId: orgA.id,
    role: 'MANAGER',
  };

  const editorSession: SessionPayload = {
    userId: editorUser.id,
    email: editorUser.email,
    name: editorUser.name,
    organizationId: orgA.id,
    role: 'EDITOR',
  };

  const viewerSession: SessionPayload = {
    userId: viewerUser.id,
    email: viewerUser.email,
    name: viewerUser.name,
    organizationId: orgA.id,
    role: 'VIEWER',
  };

  const orgBSession: SessionPayload = {
    userId: orgBUser.id,
    email: orgBUser.email,
    name: orgBUser.name,
    organizationId: orgB.id,
    role: 'ADMIN',
  };

  return {
    orgA,
    orgB,
    workspaceA,
    workspaceA2,
    workspaceB,
    adminSession,
    managerSession,
    editorSession,
    viewerSession,
    orgBSession,
  };
}
