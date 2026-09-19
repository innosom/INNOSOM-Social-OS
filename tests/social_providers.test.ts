import { NextRequest } from 'next/server';
import { prisma } from '../src/lib/prisma';
import { signSessionToken } from '../src/lib/auth';
import { SocialProviderFactory } from '../src/modules/social/SocialProviderFactory';
import { GET as getSocialConnections, POST as connectSocial } from '../src/app/api/social-connections/route';
import { encryptToken, isEncryptedToken } from '../src/lib/encryption';

async function runSocialProvidersTests() {
  console.log('\n🌐 Running Social Providers & OAuth Security Tests...');
  let totalTests = 0;
  let passedTests = 0;

  // Setup test organization & workspace
  const org = await prisma.organization.create({
    data: { name: 'Social Test Org', slug: `social-org-${Date.now()}` },
  });

  const workspace = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'Social Client', slug: 'social-client' },
  });

  const user = await prisma.user.create({
    data: { name: 'Social Admin', email: `social-admin-${Date.now()}@test.com`, passwordHash: 'hash' },
  });

  await prisma.membership.create({
    data: { userId: user.id, organizationId: org.id, role: 'ADMIN' },
  });

  const token = await signSessionToken({
    userId: user.id,
    email: user.email,
    name: user.name,
    organizationId: org.id,
    role: 'ADMIN',
  });

  try {
    // 1. SocialProviderFactory Provider Instantiation & Capabilities
    totalTests++;
    const fbProvider = SocialProviderFactory.getProvider('FACEBOOK');
    const instaProvider = SocialProviderFactory.getProvider('INSTAGRAM');
    const tiktokProvider = SocialProviderFactory.getProvider('TIKTOK');
    const ytProvider = SocialProviderFactory.getProvider('YOUTUBE');

    const fbCaps = fbProvider.getCapabilities();
    const instaCaps = instaProvider.getCapabilities();

    if (!fbCaps.canPublishImage || !fbCaps.canPublishVideo || !instaCaps.canPublishCarousel) {
      throw new Error('Social provider capabilities mismatch');
    }
    passedTests++;
    console.log('  ✅ 1. SocialProviderFactory and capabilities retrieval verified');

    // 2. OAuth Credential Encryption on Social Connection Creation
    totalTests++;
    const rawOAuthToken = 'secret_live_oauth2_access_token_val_990011';
    const createReq = new NextRequest('http://localhost:3000/api/social-connections', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `innosom_session=${token}`,
      },
      body: JSON.stringify({
        workspaceId: workspace.id,
        platform: 'FACEBOOK',
        accountName: 'INNOSOM Main Page',
        accountId: 'fb_page_1001',
        accessToken: rawOAuthToken,
      }),
    });

    const createRes = await connectSocial(createReq);
    if (createRes.status !== 200) {
      throw new Error(`Failed to create social connection: ${createRes.status}`);
    }

    const createData = await createRes.json();
    const createdConnId = createData.connection.id;

    // Verify DB record directly
    const dbConn = await prisma.socialConnection.findUnique({ where: { id: createdConnId } });
    if (!dbConn) throw new Error('Social connection not found in DB');

    if (dbConn.accessTokenEnc === rawOAuthToken) {
      throw new Error('SECURITY VIOLATION: Plaintext OAuth token was stored in database!');
    }

    if (!isEncryptedToken(dbConn.accessTokenEnc)) {
      throw new Error('OAuth token in database is not properly encrypted (missing enc:v1: prefix)');
    }
    passedTests++;
    console.log('  ✅ 2. OAuth token encryption at rest verified (plaintext never stored)');

    // 3. Token Sanitization in API Response (omitted from GET /api/social-connections)
    totalTests++;
    const getReq = new NextRequest(`http://localhost:3000/api/social-connections?workspaceId=${workspace.id}`, {
      method: 'GET',
      headers: { cookie: `innosom_session=${token}` },
    });

    const getRes = await getSocialConnections(getReq);
    const getData = await getRes.json();

    const connInPayload = getData.connections.find((c: any) => c.id === createdConnId);
    if (!connInPayload) {
      throw new Error('Created social connection missing from GET response');
    }

    if ('accessTokenEnc' in connInPayload || 'refreshTokenEnc' in connInPayload) {
      throw new Error('SECURITY VIOLATION: Encrypted tokens leaked in client API response!');
    }
    passedTests++;
    console.log('  ✅ 3. OAuth credential sanitization in API response verified');

    // 4. Connection Health Validation & Automatic Status Updates
    totalTests++;
    // Create connection with expired token string
    const expiredConn = await prisma.socialConnection.create({
      data: {
        workspaceId: workspace.id,
        platform: 'INSTAGRAM',
        accountName: 'Expired Insta Account',
        accountId: 'insta_exp_999',
        status: 'CONNECTED',
        accessTokenEnc: encryptToken('expired_access_token_sample')!,
      },
    });

    // Calling GET /api/social-connections evaluates health and updates status in DB
    await getSocialConnections(getReq);

    const updatedExpiredConn = await prisma.socialConnection.findUnique({ where: { id: expiredConn.id } });
    if (updatedExpiredConn?.status !== 'EXPIRED') {
      throw new Error(`Expected connection status to auto-update to EXPIRED, got ${updatedExpiredConn?.status}`);
    }
    passedTests++;
    console.log('  ✅ 4. Real-time OAuth connection health validation and auto-status update verified');

    // Clean up
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.user.delete({ where: { id: user.id } });

    console.log(`🎉 Social Providers & OAuth Security Tests Passed: ${passedTests}/${totalTests}\n`);
    return { passedTests, totalTests };
  } catch (err) {
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    throw err;
  }
}

if (require.main === module) {
  runSocialProvidersTests().catch((e) => {
    console.error('❌ Social Providers tests failed:', e);
    process.exit(1);
  });
}

export { runSocialProvidersTests };
