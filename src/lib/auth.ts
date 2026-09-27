import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET environment variable is required in production mode.');
    }
    return new TextEncoder().encode('innosom-super-secret-jwt-encryption-key-32-bytes!!');
  }
  return new TextEncoder().encode(secret);
}

const JWT_SECRET = getJwtSecret();

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

export async function getSession(req?: any): Promise<SessionPayload | null> {
  let token: string | undefined;

  if (req && typeof req.cookies?.get === 'function') {
    token = req.cookies.get(COOKIE_NAME)?.value;
  }

  if (!token) {
    try {
      const cookieStore = await cookies();
      token = cookieStore.get(COOKIE_NAME)?.value;
    } catch {
      // Out of Next.js server component / server context request scope
    }
  }

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
