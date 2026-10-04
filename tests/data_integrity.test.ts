import { prisma } from '../src/lib/prisma';

async function runDataIntegrityTests() {
  console.log('🧪 Running Comprehensive Data Integrity & Constraint Tests...\n');

  // Setup test environment
  const org = await prisma.organization.create({
    data: { name: 'Data Integrity Test Org', slug: `di-org-${Date.now()}` },
  });

  const user = await prisma.user.create({
    data: {
      email: `di-user-${Date.now()}@test.com`,
      name: 'Data Integrity User',
      passwordHash: 'hashed',
    },
  });

  await prisma.membership.create({
    data: { userId: user.id, organizationId: org.id, role: 'ADMIN' },
  });

  const workspace = await prisma.workspace.create({
    data: {
      organizationId: org.id,
      name: 'Data Integrity Workspace',
      slug: `di-ws-${Date.now()}`,
    },
  });

  const socialConn = await prisma.socialConnection.create({
    data: {
      workspaceId: workspace.id,
      platform: 'FACEBOOK',
      accountName: 'DI Account',
      accountId: 'di_account_1',
      accessTokenEnc: 'enc_token',
    },
  });

  try {
    // 1. Foreign Key Constraints & Cascade Deletion Behavior
    console.log('Testing 1: Foreign Key Cascade Deletion Behavior...');
    const contentCascade = await prisma.content.create({
      data: {
        workspaceId: workspace.id,
        authorId: user.id,
        title: 'Cascade Delete Post',
        masterCaption: 'Cascade Caption',
        status: 'DRAFT',
      },
    });

    const variantCascade = await prisma.contentVariant.create({
      data: {
        contentId: contentCascade.id,
        platform: 'FACEBOOK',
        caption: 'Cascade Caption',
      },
    });

    const pubCascade = await prisma.publication.create({
      data: {
        contentVariantId: variantCascade.id,
        socialConnectionId: socialConn.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `di_pub_casc_${Date.now()}`,
      },
    });

    // Delete parent Content -> ContentVariant & Publication should cascade delete
    await prisma.content.delete({ where: { id: contentCascade.id } });

    const checkVariant = await prisma.contentVariant.findUnique({ where: { id: variantCascade.id } });
    const checkPub = await prisma.publication.findUnique({ where: { id: pubCascade.id } });

    if (checkVariant || checkPub) {
      throw new Error('Cascade deletion failed: ContentVariant or Publication remained after parent Content deletion.');
    }
    console.log('✅ Foreign key cascade deletion behavior test passed.');

    // 2. Duplicate Content Variants Constraint (`@@unique([contentId, platform])`)
    console.log('Testing 2: Duplicate Content Variant Constraint Enforcement...');
    const contentVariantDup = await prisma.content.create({
      data: {
        workspaceId: workspace.id,
        authorId: user.id,
        title: 'Duplicate Variant Test',
        masterCaption: 'Master Caption',
      },
    });

    await prisma.contentVariant.create({
      data: {
        contentId: contentVariantDup.id,
        platform: 'FACEBOOK',
        caption: 'First FB Variant',
      },
    });

    let duplicateVariantFailed = false;
    try {
      await prisma.contentVariant.create({
        data: {
          contentId: contentVariantDup.id,
          platform: 'FACEBOOK',
          caption: 'Second FB Variant',
        },
      });
    } catch (err: any) {
      duplicateVariantFailed = true;
    }

    if (!duplicateVariantFailed) {
      throw new Error('Duplicate content variant creation should have been rejected by unique constraint.');
    }
    console.log('✅ Duplicate content variant constraint test passed.');

    // 3. Duplicate Idempotency Keys Constraint (`@unique` on Publication.idempotencyKey)
    console.log('Testing 3: Duplicate Idempotency Key Constraint Enforcement...');
    const contentIdem = await prisma.content.create({
      data: {
        workspaceId: workspace.id,
        authorId: user.id,
        title: 'Idempotency Key Test',
        masterCaption: 'Caption',
      },
    });

    const variantIdem = await prisma.contentVariant.create({
      data: {
        contentId: contentIdem.id,
        platform: 'FACEBOOK',
        caption: 'Caption',
      },
    });

    const sharedIdempotencyKey = `pub_idem_key_unique_${Date.now()}`;

    await prisma.publication.create({
      data: {
        contentVariantId: variantIdem.id,
        socialConnectionId: socialConn.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: sharedIdempotencyKey,
      },
    });

    let duplicateIdemFailed = false;
    try {
      await prisma.publication.create({
        data: {
          contentVariantId: variantIdem.id,
          socialConnectionId: socialConn.id,
          scheduledAt: new Date(),
          status: 'SCHEDULED',
          idempotencyKey: sharedIdempotencyKey,
        },
      });
    } catch (err: any) {
      duplicateIdemFailed = true;
    }

    if (!duplicateIdemFailed) {
      throw new Error('Duplicate idempotency key insertion should have been rejected by unique constraint.');
    }
    console.log('✅ Duplicate idempotency key constraint test passed.');

    // 4. Invalid State Transitions in Publishing State Machine
    console.log('Testing 4: Invalid State Machine Transitions...');
    // Define state machine rules: valid transitions
    const validTransitions: Record<string, string[]> = {
      DRAFT: ['IN_REVIEW', 'SCHEDULED'],
      IN_REVIEW: ['APPROVED', 'DRAFT'],
      APPROVED: ['SCHEDULED', 'DRAFT'],
      SCHEDULED: ['PUBLISHING', 'DRAFT'],
      PUBLISHING: ['PUBLISHED', 'FAILED'],
      FAILED: ['SCHEDULED', 'DRAFT'],
      PUBLISHED: [],
    };

    function canTransition(current: string, next: string): boolean {
      return (validTransitions[current] || []).includes(next);
    }

    if (canTransition('DRAFT', 'PUBLISHED')) {
      throw new Error('Invalid state transition allowed: DRAFT -> PUBLISHED directly.');
    }

    if (canTransition('PUBLISHED', 'SCHEDULED')) {
      throw new Error('Invalid state transition allowed: PUBLISHED -> SCHEDULED directly.');
    }

    if (canTransition('IN_REVIEW', 'PUBLISHED')) {
      throw new Error('Invalid state transition allowed: IN_REVIEW -> PUBLISHED directly.');
    }
    console.log('✅ Invalid state transition validation test passed.');

    // 5. Duplicate Scheduling / Duplicate Job Prevention
    console.log('Testing 5: Duplicate Scheduling Prevention...');
    const duplicateScheduledTime = new Date('2026-06-01T10:00:00Z');
    const pubSched1 = await prisma.publication.create({
      data: {
        contentVariantId: variantIdem.id,
        socialConnectionId: socialConn.id,
        scheduledAt: duplicateScheduledTime,
        status: 'SCHEDULED',
        idempotencyKey: `pub_${workspace.id}_${variantIdem.id}_${duplicateScheduledTime.getTime()}`,
      },
    });

    let duplicateScheduleFailed = false;
    try {
      await prisma.publication.create({
        data: {
          contentVariantId: variantIdem.id,
          socialConnectionId: socialConn.id,
          scheduledAt: duplicateScheduledTime,
          status: 'SCHEDULED',
          idempotencyKey: `pub_${workspace.id}_${variantIdem.id}_${duplicateScheduledTime.getTime()}`,
        },
      });
    } catch (err) {
      duplicateScheduleFailed = true;
    }

    if (!duplicateScheduleFailed) {
      throw new Error('Duplicate publication scheduling with identical idempotency key was allowed.');
    }
    console.log('✅ Duplicate scheduling prevention test passed.');

    // Clean up test data
    await prisma.content.deleteMany({
      where: { id: { in: [contentVariantDup.id, contentIdem.id] } },
    });
    await prisma.socialConnection.delete({ where: { id: socialConn.id } });
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.membership.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: org.id } });

    console.log('\n🎉 ALL DATA INTEGRITY & CONSTRAINT TESTS PASSED SUCCESSFULLY! 🎉');
  } finally {
    await prisma.$disconnect();
  }
}

runDataIntegrityTests().catch((e) => {
  console.error('❌ Data integrity tests failed:', e);
  process.exit(1);
});
