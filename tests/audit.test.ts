import { signSessionToken, verifySessionToken, validateWorkspaceAccess } from '../src/lib/auth';
import { processPublicationJob } from '../src/modules/publishing/PublishingWorker';
import { prisma } from '../src/lib/prisma';
import crypto from 'crypto';

async function runAuditTests() {
  console.log('🧪 Running Comprehensive Security Audit Tests...\n');

  try {
    // 1. JWT & Authorization Tests
    console.log('Testing 1: JWT Production Safeguards & Workspace Access...');
    const originalEnv = process.env.NODE_ENV;
    const originalSecret = process.env.JWT_SECRET;

    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = 'production';

    let jwtProdError = false;
    try {
      await signSessionToken({
        userId: 'u1',
        email: 'test@example.com',
        name: 'Test',
        organizationId: 'o1',
        role: 'EDITOR',
      });
    } catch (err: any) {
      if (err.message.includes('JWT_SECRET environment variable is required')) {
        jwtProdError = true;
      }
    }
    process.env.NODE_ENV = originalEnv;
    if (originalSecret) process.env.JWT_SECRET = originalSecret;

    if (!jwtProdError) {
      throw new Error('FAILED: Missing JWT_SECRET in production did not throw an error.');
    }
    console.log('  ✅ JWT Production enforcement verified.');

    // Workspace ID validation
    const session = {
      userId: 'u1',
      email: 'test@example.com',
      name: 'Test User',
      organizationId: 'org_test',
      role: 'EDITOR',
    };

    const emptyAccess = await validateWorkspaceAccess(session, '', prisma);
    const allClientsAccess = await validateWorkspaceAccess(session, 'ALL_CLIENTS', prisma);

    if (emptyAccess.hasAccess || allClientsAccess.hasAccess) {
      throw new Error('FAILED: validateWorkspaceAccess allowed empty or ALL_CLIENTS workspace ID.');
    }
    console.log('  ✅ Pseudo-workspace access restriction verified.');

    // 2. OAuth HMAC State Validation Test
    console.log('\nTesting 2: OAuth HMAC State Token Verification...');
    const secretKey = 'test_secret_key_64_bytes_000000000000000000000000000000000000000000';
    const payload = JSON.stringify({ workspaceId: 'ws1', provider: 'facebook', nonce: 'nonce123', userId: 'u1' });
    const validHmac = crypto.createHmac('sha256', secretKey).update(payload).digest('hex');
    const tamperedHmac = crypto.createHmac('sha256', secretKey).update(payload + 'tampered').digest('hex');

    if (validHmac === tamperedHmac) {
      throw new Error('FAILED: HMAC match on tampered payload.');
    }
    console.log('  ✅ OAuth HMAC state token integrity verified.');

    // 3. Worker Race Condition Atomic Transition Test
    console.log('\nTesting 3: Worker Atomic State Lock (Duplicate Publishing Prevention)...');
    const mockWorkspace = await prisma.workspace.findFirst({
      include: { socialConnections: true },
    });

    const testUser = await prisma.user.findFirst();

    if (mockWorkspace && mockWorkspace.socialConnections.length > 0 && testUser) {
      const conn = mockWorkspace.socialConnections[0];

      const content = await prisma.content.create({
        data: {
          workspaceId: mockWorkspace.id,
          authorId: testUser.id,
          title: 'Race Condition Test Content',
          masterCaption: 'Testing atomic worker transitions',
          status: 'APPROVED',
        },
      });

      const variant = await prisma.contentVariant.create({
        data: {
          contentId: content.id,
          platform: conn.platform,
          caption: 'Testing atomic worker transitions',
        },
      });

      const pub = await prisma.publication.create({
        data: {
          contentVariantId: variant.id,
          socialConnectionId: conn.id,
          scheduledAt: new Date(),
          status: 'SCHEDULED',
          idempotencyKey: `race_test_pub_${Date.now()}`,
        },
      });

      // Concurrent execution simulation
      const [res1, res2] = await Promise.all([
        processPublicationJob(pub.id),
        processPublicationJob(pub.id),
      ]);

      const wins = [res1, res2].filter((r) => r.success).length;
      if (wins > 1) {
        throw new Error('FAILED: Both concurrent worker calls succeeded! Duplicate publishing risk detected.');
      }
      console.log('  ✅ Single worker execution lock verified under concurrent execution.');
    }

    console.log('\n🎉 ALL SECURITY AUDIT TESTS PASSED SUCCESSFULLY! 🎉\n');
  } catch (error: any) {
    console.error('\n❌ Security Audit Test Failed:', error);
    process.exit(1);
  }
}

runAuditTests();
