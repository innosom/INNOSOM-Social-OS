import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'innosom-super-secret-jwt-encryption-key-32-bytes!!'
);

export interface SessionPayload {
  userId: string;
  email: string;
  name: string;
  organizationId: string;
  role: string;
}

const COOKIE_NAME = 'innosom_session';

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET);
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const verified = await jwtVerify(token, JWT_SECRET);
    return verified.payload as unknown as SessionPayload;
  } catch (error) {
    return null;
  }
}

export async function getSession(req?: NextRequest): Promise<SessionPayload | null> {
  let token: string | undefined;

  if (req) {
    token = req.cookies.get(COOKIE_NAME)?.value;
  }

  if (!token) {
    try {
      const cookieStore = await cookies();
      token = cookieStore.get(COOKIE_NAME)?.value;
    } catch (e) {
      // Outside of Next.js server request context (e.g. unit testing environment)
      token = undefined;
    }
  }

  if (!token) return null;
  return verifySessionToken(token);
}

export async function setSessionCookie(payload: SessionPayload): Promise<string> {
  const token = await signSessionToken(payload);
  try {
    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    });
  } catch (e) {
    // Outside request scope context
  }
  return token;
}

export async function clearSessionCookie(): Promise<void> {
  try {
    const cookieStore = await cookies();
    cookieStore.delete(COOKIE_NAME);
  } catch (e) {
    // Outside request scope context
  }
}

export async function validateWorkspaceAccess(
  session: SessionPayload,
  workspaceId: string,
  prismaClient: any
): Promise<{ hasAccess: boolean; workspace: any | null }> {
  if (!workspaceId || workspaceId === 'ALL_CLIENTS') {
    return { hasAccess: true, workspace: null };
  }

  const workspace = await prismaClient.workspace.findFirst({
    where: {
      id: workspaceId,
      organizationId: session.organizationId,
    },
  });

  return {
    hasAccess: !!workspace,
    workspace,
  };
}

export function hasRole(session: SessionPayload, allowedRoles: string[]): boolean {
  if (!session || !session.role) return false;
  return allowedRoles.includes(session.role.toUpperCase());
}

export async function validateWorkspaceMutationAccess(
  session: SessionPayload,
  workspaceId: string,
  prismaClient: any
): Promise<{ hasAccess: boolean; error?: string; workspace?: any | null }> {
  if (!workspaceId) {
    return { hasAccess: false, error: 'Workspace ID is required' };
  }
  if (workspaceId === 'ALL_CLIENTS') {
    return { hasAccess: false, error: 'ALL_CLIENTS cannot be target of mutation operations' };
  }

  const workspace = await prismaClient.workspace.findFirst({
    where: {
      id: workspaceId,
      organizationId: session.organizationId,
    },
  });

  if (!workspace) {
    return { hasAccess: false, error: 'Workspace not found or unauthorized' };
  }

  return { hasAccess: true, workspace };
}
