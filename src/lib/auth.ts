import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const DEFAULT_SECRET = 'innosom-super-secret-jwt-encryption-key-32-bytes!!';

export function getJwtSecret(): Uint8Array {
  const envJwtSecret = process.env.JWT_SECRET;

  if (process.env.NODE_ENV === 'production' && (!envJwtSecret || envJwtSecret === DEFAULT_SECRET)) {
    throw new Error('Production Configuration Failure: JWT_SECRET environment variable must be explicitly defined in production mode.');
  }

  return new TextEncoder().encode(envJwtSecret || DEFAULT_SECRET);
}

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
    .sign(getJwtSecret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const verified = await jwtVerify(token, getJwtSecret());
    return verified.payload as unknown as SessionPayload;
  } catch (error) {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const token = await signSessionToken(payload);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
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
