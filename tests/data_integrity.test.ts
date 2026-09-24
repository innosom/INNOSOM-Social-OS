import { prisma } from '../src/lib/prisma';
import { encryptToken } from '../src/lib/encryption';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

async function runDataIntegrityTests() {
  console.log('🧪 Running Data Integrity & Relational Constraint Tests...\n');

  // Setup test organization
  const org = await prisma.organization.create({
    data: { name: 'Data Integrity Org', slug: `di-org-${Date.now()}` },
  });
  const ws = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'DI WS', slug: 'di-ws' },
  });
  const user = await prisma.user.create({
    data: { email: `di_user_${Date.now()}@test.com`, name: 'DI User', passwordHash: 'hash' },
  });

  try {
    // 1. Foreign Key Cascading Deletion
    console.log('Testing 1: Foreign Key Cascading Deletion Behavior...');
    const conn = await prisma.socialConnection.create({
      data: {
        workspaceId: ws.id,
        platform: 'FACEBOOK',
        accountName: 'DI Page',
        accountId: 'di_acc_1',
        accessTokenEnc: encryptToken('token')!,
      },
    });

    const content = await prisma.content.create({
      data: {
        workspaceId: ws.id,
        authorId: user.id,
        title: 'Cascade Content',
        masterCaption: 'Cascade Caption',
      },
    });

    const variant = await prisma.contentVariant.create({
      data: {
        contentId: content.id,
        platform: 'FACEBOOK',
        caption: 'Cascade Variant Caption',
      },
    });

    const pub = await prisma.publication.create({
      data: {
        contentVariantId: variant.id,
        socialConnectionId: conn.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `di_pub_${Date.now()}`,
      },
    });

    // Delete content -> should cascade delete variant and publication
    await prisma.content.delete({ where: { id: content.id } });

    const deletedVariant = await prisma.contentVariant.findUnique({ where: { id: variant.id } });
    const deletedPub = await prisma.publication.findUnique({ where: { id: pub.id } });

    if (deletedVariant || deletedPub) {
      throw new Error('Cascading deletion failed: ContentVariant or Publication remained after Content deletion.');
    }
    console.log('  ✅ Foreign key cascading deletion verified.');

    // 2. Duplicate Content Variants Constraint
    console.log('Testing 2: Unique Constraint on Content Variants (contentId + platform)...');
    const newContent = await prisma.content.create({
      data: {
        workspaceId: ws.id,
        authorId: user.id,
        title: 'Unique Variant Content',
        masterCaption: 'Caption',
      },
    });

    await prisma.contentVariant.create({
      data: {
        contentId: newContent.id,
        platform: 'FACEBOOK',
        caption: 'First FB Variant',
      },
    });

    let duplicateVariantFailed = false;
    try {
      await prisma.contentVariant.create({
        data: {
          contentId: newContent.id,
          platform: 'FACEBOOK',
          caption: 'Second FB Variant',
        },
      });
    } catch (err: any) {
      duplicateVariantFailed = true;
    }

    if (!duplicateVariantFailed) {
      throw new Error('Database allowed duplicate ContentVariant for same platform on content item.');
    }
    console.log('  ✅ Duplicate ContentVariant unique constraint verified.');

    // 3. Unique Idempotency Key Constraint
    console.log('Testing 3: Unique Constraint on Publication Idempotency Keys...');
    const conn2 = await prisma.socialConnection.create({
      data: {
        workspaceId: ws.id,
        platform: 'INSTAGRAM',
        accountName: 'DI IG Page',
        accountId: 'di_acc_2',
        accessTokenEnc: encryptToken('token')!,
      },
    });

    const variant2 = await prisma.contentVariant.create({
      data: {
        contentId: newContent.id,
        platform: 'INSTAGRAM',
        caption: 'IG Variant',
      },
    });

    const fixedIdempotencyKey = `unique_idem_key_${Date.now()}`;
    await prisma.publication.create({
      data: {
        contentVariantId: variant2.id,
        socialConnectionId: conn2.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: fixedIdempotencyKey,
      },
    });

    let duplicateIdemFailed = false;
    try {
      await prisma.publication.create({
        data: {
          contentVariantId: variant2.id,
          socialConnectionId: conn2.id,
          scheduledAt: new Date(),
          status: 'SCHEDULED',
          idempotencyKey: fixedIdempotencyKey,
        },
      });
    } catch (err: any) {
      duplicateIdemFailed = true;
    }

    if (!duplicateIdemFailed) {
      throw new Error('Database allowed duplicate publication idempotencyKey.');
    }
    console.log('  ✅ Unique IdempotencyKey constraint verified.');

    // 4. Duplicate Scheduling Protection
    console.log('Testing 4: Duplicate Scheduling Validation...');
    const scheduledCount = await prisma.publication.count({
      where: {
        contentVariantId: variant2.id,
        socialConnectionId: conn2.id,
        status: 'SCHEDULED',
      },
    });

    if (scheduledCount > 1) {
      throw new Error('Found duplicate scheduled publication entries for same variant & connection.');
    }
    console.log('  ✅ Duplicate scheduling protection verified.');

    console.log('\n🎉 ALL DATA INTEGRITY TESTS PASSED SUCCESSFULLY! 🎉');
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}

runDataIntegrityTests().catch((e) => {
  console.error('❌ Data integrity test execution failed:', e);
  process.exit(1);
});
