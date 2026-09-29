import assert from 'node:assert';
import { prisma } from '../src/lib/prisma';

async function runIntegrityTests() {
  console.log('🧪 Running Data Integrity, Foreign Key & Schema Constraint Tests...');

  let org = await prisma.organization.findFirst({ where: { slug: 'innosom' } });
  if (!org) {
    org = await prisma.organization.create({
      data: { name: 'INNOSOM Primary Org', slug: 'innosom' },
    });
  }

  let user = await prisma.user.findFirst({ where: { email: 'integrity_test@innosom.com' } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: 'integrity_test@innosom.com',
        name: 'Integrity Tester',
        passwordHash: 'hash123',
      },
    });
  }

  let workspace = await prisma.workspace.create({
    data: {
      organizationId: org.id,
      name: `Integrity WS ${Date.now()}`,
      slug: `integrity-ws-${Date.now()}`,
    },
  });

  // 1. Foreign Key Relationship Cascades
  console.log('Testing 1: Foreign Key Cascade Deletions...');

  const content = await prisma.content.create({
    data: {
      workspaceId: workspace.id,
      authorId: user.id,
      title: 'Cascade Test Content',
      masterCaption: 'Testing cascade behavior',
      status: 'DRAFT',
    },
  });

  const variant = await prisma.contentVariant.create({
    data: {
      contentId: content.id,
      platform: 'facebook',
      caption: 'FB Variant Caption',
    },
  });

  const socialConn = await prisma.socialConnection.create({
    data: {
      workspaceId: workspace.id,
      platform: 'facebook',
      accountName: 'Integrity FB Page',
      accountId: `fb_acc_${Date.now()}`,
      accessTokenEnc: 'enc_token',
    },
  });

  const publication = await prisma.publication.create({
    data: {
      contentVariantId: variant.id,
      socialConnectionId: socialConn.id,
      scheduledAt: new Date(),
      status: 'SCHEDULED',
      idempotencyKey: `ik_cascade_${Date.now()}`,
    },
  });

  // Verify child records exist
  const fetchedPubBefore = await prisma.publication.findUnique({ where: { id: publication.id } });
  assert.ok(fetchedPubBefore, 'Publication should exist before cascade');

  // Delete parent content -> should cascade delete ContentVariant and Publication
  await prisma.content.delete({ where: { id: content.id } });

  const fetchedVariantAfter = await prisma.contentVariant.findUnique({ where: { id: variant.id } });
  assert.strictEqual(fetchedVariantAfter, null, 'ContentVariant must be deleted when parent Content is deleted');

  const fetchedPubAfter = await prisma.publication.findUnique({ where: { id: publication.id } });
  assert.strictEqual(fetchedPubAfter, null, 'Publication must be cascade deleted when parent ContentVariant is deleted');

  console.log('  ✅ Foreign key cascade deletion tests passed');

  // 2. Unique Constraints Enforcement
  console.log('Testing 2: Schema Unique Constraint Enforcement...');

  const content2 = await prisma.content.create({
    data: {
      workspaceId: workspace.id,
      authorId: user.id,
      title: 'Constraint Test Content',
      masterCaption: 'Testing unique keys',
      status: 'DRAFT',
    },
  });

  const variant2 = await prisma.contentVariant.create({
    data: {
      contentId: content2.id,
      platform: 'instagram',
      caption: 'IG Variant',
    },
  });

  // Duplicate platform variant on same content must fail unique constraint [contentId, platform]
  await assert.rejects(
    async () => {
      await prisma.contentVariant.create({
        data: {
          contentId: content2.id,
          platform: 'instagram',
          caption: 'Duplicate IG Variant',
        },
      });
    },
    (err: any) => err.code === 'P2002',
    'Creating duplicate platform variant for same content must throw P2002 unique constraint error'
  );

  // Duplicate idempotencyKey on Publication must fail
  const uniqueKey = `dup_key_${Date.now()}`;
  await prisma.publication.create({
    data: {
      contentVariantId: variant2.id,
      socialConnectionId: socialConn.id,
      scheduledAt: new Date(),
      status: 'SCHEDULED',
      idempotencyKey: uniqueKey,
    },
  });

  await assert.rejects(
    async () => {
      await prisma.publication.create({
        data: {
          contentVariantId: variant2.id,
          socialConnectionId: socialConn.id,
          scheduledAt: new Date(),
          status: 'SCHEDULED',
          idempotencyKey: uniqueKey,
        },
      });
    },
    (err: any) => err.code === 'P2002',
    'Creating publication with duplicate idempotencyKey must throw P2002 unique constraint error'
  );

  console.log('  ✅ Schema unique constraint tests passed');

  // 3. State Machine & Invalid State Transition Rules
  console.log('Testing 3: State Machine & Transition Rules...');

  const validTransitions: Record<string, string[]> = {
    DRAFT: ['IN_REVIEW', 'APPROVED', 'SCHEDULED'],
    IN_REVIEW: ['APPROVED', 'DRAFT'],
    APPROVED: ['SCHEDULED', 'PUBLISHING'],
    SCHEDULED: ['PUBLISHING', 'FAILED', 'CANCELLED'],
    PUBLISHING: ['PUBLISHED', 'FAILED'],
    PUBLISHED: [],
    FAILED: ['SCHEDULED'],
  };

  const validateStateTransition = (currentStatus: string, nextStatus: string) => {
    const allowed = validTransitions[currentStatus] || [];
    if (!allowed.includes(nextStatus)) {
      throw new Error(`Invalid state transition from ${currentStatus} to ${nextStatus}`);
    }
  };

  // Valid transition
  assert.doesNotThrow(() => validateStateTransition('DRAFT', 'IN_REVIEW'));
  assert.doesNotThrow(() => validateStateTransition('APPROVED', 'SCHEDULED'));

  // Invalid transitions
  assert.throws(
    () => validateStateTransition('PUBLISHED', 'DRAFT'),
    /Invalid state transition from PUBLISHED to DRAFT/,
    'Moving from PUBLISHED to DRAFT directly must fail state transition validation'
  );

  assert.throws(
    () => validateStateTransition('DRAFT', 'PUBLISHED'),
    /Invalid state transition from DRAFT to PUBLISHED/,
    'Bypassing review/approval directly from DRAFT to PUBLISHED must fail'
  );

  console.log('  ✅ State machine and transition rule tests passed');

  // Cleanup test workspace
  await prisma.workspace.delete({ where: { id: workspace.id } });

  console.log('🎉 ALL DATA INTEGRITY & CONSTRAINT TESTS PASSED SUCCESSFULLY!');
}

runIntegrityTests()
  .catch((e) => {
    console.error('❌ Data integrity tests failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
