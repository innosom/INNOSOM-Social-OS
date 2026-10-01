import { processPublicationJob } from '../src/modules/publishing/PublishingWorker';
import { prisma } from '../src/lib/prisma';
import { encryptToken } from '../src/lib/encryption';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

async function runTests() {
  console.log('🧪 Running INNOSOM Social OS Tests...');

  let pubPublished = await prisma.publication.findFirst({
    where: { status: 'PUBLISHED' },
  });

  let pubScheduled = await prisma.publication.findFirst({
    where: { status: 'SCHEDULED' },
  });

  // If DB is not seeded yet, create test records
  if (!pubPublished || !pubScheduled) {
    let org = await prisma.organization.findFirst();
    if (!org) {
      org = await prisma.organization.create({
        data: { name: 'Publishing Test Org', slug: `pub_org_${Date.now()}` },
      });
    }

    let user = await prisma.user.findFirst();
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: `pub_test_${Date.now()}@test.com`,
          name: 'Publishing Tester',
          passwordHash: 'hash',
        },
      });
    }

    let ws = await prisma.workspace.findFirst();
    if (!ws) {
      ws = await prisma.workspace.create({
        data: {
          organizationId: org.id,
          name: 'Publishing Test WS',
          slug: `pub_ws_${Date.now()}`,
        },
      });
    }

    let conn = await prisma.socialConnection.findFirst();
    if (!conn) {
      conn = await prisma.socialConnection.create({
        data: {
          workspaceId: ws.id,
          platform: 'FACEBOOK',
          accountName: 'Test Page',
          accountId: `conn_${Date.now()}`,
          accessTokenEnc: encryptToken('mock_access_token_12345')!,
        },
      });
    }

    let content = await prisma.content.create({
      data: {
        workspaceId: ws.id,
        authorId: user.id,
        title: 'Publishing Test Content',
        masterCaption: 'Test caption',
        status: 'SCHEDULED',
      },
    });

    let variant = await prisma.contentVariant.create({
      data: {
        contentId: content.id,
        platform: 'FACEBOOK',
        caption: 'Test caption',
      },
    });

    if (!pubPublished) {
      pubPublished = await prisma.publication.create({
        data: {
          contentVariantId: variant.id,
          socialConnectionId: conn.id,
          scheduledAt: new Date(),
          status: 'PUBLISHED',
          idempotencyKey: `idempotent_pub_${Date.now()}`,
        },
      });
    }

    if (!pubScheduled) {
      pubScheduled = await prisma.publication.create({
        data: {
          contentVariantId: variant.id,
          socialConnectionId: conn.id,
          scheduledAt: new Date(),
          status: 'SCHEDULED',
          idempotencyKey: `scheduled_pub_${Date.now()}`,
        },
      });
    }
  }

  if (pubPublished) {
    const res = await processPublicationJob(pubPublished.id);
    if (!res.success) throw new Error('Idempotency test failed');
    console.log('✅ Idempotency Test Passed');
  }

  if (pubScheduled) {
    const res = await processPublicationJob(pubScheduled.id);
    if (!res.success) throw new Error('Publishing test failed');

    const updated = await prisma.publication.findUnique({ where: { id: pubScheduled.id } });
    if (updated?.status !== 'PUBLISHED') throw new Error('Status transition to PUBLISHED failed');
    console.log('✅ Scheduled Publication Execution Test Passed');
  }

  console.log('🎉 All Automated Tests Passed Successfully!');
  await prisma.$disconnect();
}

runTests().catch((e) => {
  console.error('❌ Test execution failed:', e);
  process.exit(1);
});
