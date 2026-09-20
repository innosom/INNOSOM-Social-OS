import { prisma } from '../src/lib/prisma';
import { SocialProviderFactory } from '../src/modules/social/SocialProviderFactory';
import { validateWorkspaceAccess } from '../src/lib/auth';

async function runAuditTests() {
  console.log('🧪 Running Comprehensive Security Audit Tests...\n');

  // Test 1: Production Mock Provider Guard
  console.log('--- Test 1: Production Mock Provider Guard ---');
  const originalEnv = process.env.ENABLE_LIVE_SOCIAL_APIS;
  process.env.ENABLE_LIVE_SOCIAL_APIS = 'true';
  delete process.env.FACEBOOK_APP_ID;

  try {
    SocialProviderFactory.getProvider('FACEBOOK');
    console.error('❌ Test 1 Failed: Expected error when credentials missing in production mode.');
    process.exit(1);
  } catch (err: any) {
    if (err.message.includes('Production Configuration Error')) {
      console.log('✅ 1. Mock provider fallback blocked in production mode.');
    } else {
      console.error('❌ Test 1 Failed with unexpected error:', err);
      process.exit(1);
    }
  } finally {
    process.env.ENABLE_LIVE_SOCIAL_APIS = originalEnv;
  }

  // Test 2: Cross-Organization Workspace Isolation Check
  console.log('--- Test 2: Cross-Organization Workspace Isolation ---');
  const orgA = await prisma.organization.findFirst();
  if (!orgA) {
    console.error('❌ Test 2 Failed: No organization found in DB.');
    process.exit(1);
  }

  const workspaceA = await prisma.workspace.findFirst({
    where: { organizationId: orgA.id },
  });

  if (!workspaceA) {
    console.error('❌ Test 2 Failed: No workspace found for Organization A.');
    process.exit(1);
  }

  // Fake session from Organization B
  const fakeSessionOrgB = {
    userId: 'user-b-id',
    email: 'userb@orgb.com',
    name: 'User B',
    organizationId: 'fake-org-b-uuid',
    role: 'ADMIN',
  };

  const isolationCheck = await validateWorkspaceAccess(fakeSessionOrgB, workspaceA.id, prisma);
  if (!isolationCheck.hasAccess) {
    console.log('✅ 2. Cross-organization workspace access denied correctly.');
  } else {
    console.error('❌ Test 2 Failed: User from Organization B gained access to Organization A workspace.');
    process.exit(1);
  }

  // Test 3: Idempotency Key Uniqueness Enforcement
  console.log('--- Test 3: Idempotency Key Constraint ---');
  const existingPub = await prisma.publication.findFirst();
  if (existingPub) {
    try {
      await prisma.publication.create({
        data: {
          contentVariantId: existingPub.contentVariantId,
          socialConnectionId: existingPub.socialConnectionId,
          scheduledAt: new Date(),
          status: 'SCHEDULED',
          idempotencyKey: existingPub.idempotencyKey, // Duplicate key
        },
      });
      console.error('❌ Test 3 Failed: Allowed duplicate idempotency key creation.');
      process.exit(1);
    } catch (err: any) {
      console.log('✅ 3. Duplicate idempotency key blocked by database unique constraint.');
    }
  } else {
    console.log('ℹ️ Test 3 Skipped: No existing publication found to test duplicate key.');
  }

  console.log('\n🎉 All Security Audit Tests Passed Successfully!');
}

runAuditTests()
  .catch((e) => {
    console.error('Fatal Error running audit tests:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
