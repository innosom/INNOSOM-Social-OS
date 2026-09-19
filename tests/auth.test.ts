import { TestRunner, assertEqual, assertTrue, createMockRequest, getTestEntities } from './test-utils';
import { POST as loginPOST } from '../src/app/api/auth/login/route';
import { GET as contentGET } from '../src/app/api/content/route';
import { signSessionToken, verifySessionToken } from '../src/lib/auth';
import { SignJWT } from 'jose';

export async function runAuthTests(): Promise<TestRunner> {
  const runner = new TestRunner('Authentication');
  const { adminSession } = await getTestEntities();

  await runner.test('Unauthenticated API request returns 401 Unauthorized', async () => {
    const req = await createMockRequest({
      url: '/api/content',
      session: null,
    });
    const res = await contentGET(req);
    assertEqual(res.status, 401);
    const body = await res.json();
    assertEqual(body.error, 'Unauthorized');
  });

  await runner.test('Invalid session token returns null on verification', async () => {
    const invalidToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalidpayload.invalidsignature';
    const verified = await verifySessionToken(invalidToken);
    assertEqual(verified, null);

    const req = await createMockRequest({
      url: '/api/content',
      cookies: { innosom_session: invalidToken },
    });
    const res = await contentGET(req);
    assertEqual(res.status, 401);
  });

  await runner.test('Expired session token returns null on verification and 401 on API request', async () => {
    const JWT_SECRET = new TextEncoder().encode(
      process.env.JWT_SECRET || 'innosom-super-secret-jwt-encryption-key-32-bytes!!'
    );
    const expiredToken = await new SignJWT({ ...adminSession })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 10000)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1000)
      .sign(JWT_SECRET);

    const verified = await verifySessionToken(expiredToken);
    assertEqual(verified, null);

    const req = await createMockRequest({
      url: '/api/content',
      cookies: { innosom_session: expiredToken },
    });
    const res = await contentGET(req);
    assertEqual(res.status, 401);
  });

  await runner.test('Valid JWT session token creation and verification roundtrip', async () => {
    const token = await signSessionToken(adminSession);
    assertTrue(typeof token === 'string' && token.length > 20);

    const verified = await verifySessionToken(token);
    assertTrue(verified !== null);
    assertEqual(verified!.userId, adminSession.userId);
    assertEqual(verified!.email, adminSession.email);
    assertEqual(verified!.role, 'ADMIN');
  });

  await runner.test('Login API handles missing credentials with 400 Bad Request', async () => {
    const req = await createMockRequest({
      url: '/api/auth/login',
      method: 'POST',
      body: { email: 'admin@innosom.com' },
    });
    const res = await loginPOST(req);
    assertEqual(res.status, 400);
  });

  await runner.test('Login API handles invalid email/user with 401 Unauthorized', async () => {
    const req = await createMockRequest({
      url: '/api/auth/login',
      method: 'POST',
      body: { email: 'nonexistent@innosom.com', password: 'Password123!' },
    });
    const res = await loginPOST(req);
    assertEqual(res.status, 401);
  });

  await runner.test('Login API handles incorrect password with 401 Unauthorized', async () => {
    const req = await createMockRequest({
      url: '/api/auth/login',
      method: 'POST',
      body: { email: 'admin@innosom.com', password: 'WrongPassword123!' },
    });
    const res = await loginPOST(req);
    assertEqual(res.status, 401);
  });

  await runner.test('Login API authenticates valid credentials successfully', async () => {
    const req = await createMockRequest({
      url: '/api/auth/login',
      method: 'POST',
      body: { email: 'admin@innosom.com', password: 'Password123!' },
    });
    const res = await loginPOST(req);
    assertEqual(res.status, 200);
    const body = await res.json();
    assertTrue(body.success);
    assertEqual(body.user.email, 'admin@innosom.com');
    assertEqual(body.user.role, 'ADMIN');

    const setCookieHeader = res.headers.get('set-cookie');
    assertTrue(setCookieHeader !== null && setCookieHeader.includes('innosom_session='));
  });

  return runner;
}
