import { NextRequest } from 'next/server';
import { signSessionToken, verifySessionToken, validateWorkspaceAccess, SessionPayload } from '../src/lib/auth';
import { GET as getWorkspaces, POST as createWorkspace } from '../src/app/api/workspaces/route';
import { GET as getContent } from '../src/app/api/content/route';
import { prisma } from '../src/lib/prisma';
import { SignJWT } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'innosom-super-secret-jwt-encryption-key-32-bytes!!'
);

export async function runSecurityAuthTests() {
  console.log('\n🔒 [1/6] Running Authentication, Authorization & Session Security Tests...\n');

  // Setup test organization & workspaces
  const orgA = await prisma.organization.create({
    data: { name: 'Org Security Test A', slug: `org-sec-a-${Date.now()}` },
  });
  const orgB = await prisma.organization.create({
    data: { name: 'Org Security Test B', slug: `org-sec-b-${Date.now()}` },
  });

  const workspaceA1 = await prisma.workspace.create({
    data: { organizationId: orgA.id, name: 'Workspace A1', slug: `ws-a1-${Date.now()}` },
  });
  const workspaceB1 = await prisma.workspace.create({
    data: { organizationId: orgB.id, name: 'Workspace B1', slug: `ws-b1-${Date.now()}` },
  });

  const userA = await prisma.user.create({
    data: {
      email: `userA_${Date.now()}@test.com`,
      name: 'User A',
      passwordHash: 'hashed_pw',
    },
  });

  const sessionAdminA: SessionPayload = {
    userId: userA.id,
    email: userA.email,
    name: userA.name,
    organizationId: orgA.id,
    role: 'ADMIN',
  };

  const sessionEditorA: SessionPayload = {
    userId: userA.id,
    email: userA.email,
    name: userA.name,
    organizationId: orgA.id,
    role: 'EDITOR',
  };

  try {
    // Test 1: Unauthenticated API request
    const unauthReq = new NextRequest('http://localhost:3000/api/workspaces');
    const unauthRes = await getWorkspaces(unauthReq);
    if (unauthRes.status !== 401) {
      throw new Error(`Unauthenticated API request expected 401, got ${unauthRes.status}`);
    }
    console.log('  ✅ Unauthenticated API request rejected with 401');

    // Test 2: Invalid session token verification
    const invalidToken = 'invalid.jwt.token.string';
    const verifiedInvalid = await verifySessionToken(invalidToken);
    if (verifiedInvalid !== null) {
      throw new Error('Invalid JWT token should return null on verification');
    }
    console.log('  ✅ Invalid session token returned null');

    // Test 3: Expired session token verification
    const expiredToken = await new SignJWT({ ...sessionAdminA })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(JWT_SECRET);

    const verifiedExpired = await verifySessionToken(expiredToken);
    if (verifiedExpired !== null) {
      throw new Error('Expired JWT token should return null on verification');
    }
    console.log('  ✅ Expired session token returned null');

    // Test 4: Workspace validation - authorized workspace
    const validAccess = await validateWorkspaceAccess(sessionAdminA, workspaceA1.id, prisma);
    if (!validAccess.hasAccess || !validAccess.workspace) {
      throw new Error('Valid workspace access failed for org member');
    }
    console.log('  ✅ Authorized workspace access validated');

    // Test 5: Workspace validation - cross-tenant unauthorized workspace
    const invalidAccess = await validateWorkspaceAccess(sessionAdminA, workspaceB1.id, prisma);
    if (invalidAccess.hasAccess) {
      throw new Error('User was able to access workspace belonging to another organization');
    }
    console.log('  ✅ Unauthorized workspace access blocked');

    // Test 6: Role violation - EDITOR creating workspace
    const editorToken = await signSessionToken(sessionEditorA);
    const roleReq = new NextRequest('http://localhost:3000/api/workspaces', {
      method: 'POST',
      headers: {
        cookie: `innosom_session=${editorToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Unauthorized Workspace' }),
    });
    const roleRes = await createWorkspace(roleReq);
    if (roleRes.status !== 403) {
      throw new Error(`EDITOR role creating workspace expected 403, got ${roleRes.status}`);
    }
    console.log('  ✅ Role violation (EDITOR workspace creation) blocked with 403');

    // Test 7: ALL_CLIENTS abuse - User from Org A requesting ALL_CLIENTS content
    const adminToken = await signSessionToken(sessionAdminA);

    // Create content in Org B
    await prisma.content.create({
      data: {
        workspaceId: workspaceB1.id,
        authorId: userA.id,
        title: 'Org B Secret Content',
        masterCaption: 'Org B secret',
        status: 'DRAFT',
      },
    });

    const allClientsReq = new NextRequest('http://localhost:3000/api/content?workspaceId=ALL_CLIENTS', {
      headers: { cookie: `innosom_session=${adminToken}` },
    });
    const allClientsRes = await getContent(allClientsReq);
    const json = await allClientsRes.json();
    const leakedContent = json.contents.find((c: any) => c.workspaceId === workspaceB1.id);

    if (leakedContent) {
      throw new Error('SECURITY VIOLATION: ALL_CLIENTS request leaked cross-tenant content from Org B!');
    }
    console.log('  ✅ ALL_CLIENTS query correctly scoped to user organization only');

    console.log('\n✨ Security & Auth tests passed successfully!');
  } finally {
    // Cleanup
    await prisma.workspace.deleteMany({ where: { id: { in: [workspaceA1.id, workspaceB1.id] } } });
    await prisma.user.delete({ where: { id: userA.id } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  }
}

if (require.main === module) {
  runSecurityAuthTests().catch((e) => {
    console.error('❌ Security & Auth test failed:', e);
    process.exit(1);
  });
}
