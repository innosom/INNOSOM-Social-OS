import { TestRunner, assertEqual, assertTrue, getTestEntities } from './test-utils';
import { prisma } from '../src/lib/prisma';

export async function runDataIntegrityTests(): Promise<TestRunner> {
  const runner = new TestRunner('Data Integrity & Relational Constraints');
  const { orgA } = await getTestEntities();

  await runner.test('Cascade Deletion Behavior: Deleting a Content item cascades to variants and publications', async () => {
    const tempWorkspace = await prisma.workspace.create({
      data: {
        organizationId: orgA.id,
        name: `Temp Workspace ${Date.now()}`,
        slug: `temp-ws-${Date.now()}`,
      },
    });

    const tempConn = await prisma.socialConnection.create({
      data: {
        workspaceId: tempWorkspace.id,
        platform: 'FACEBOOK',
        accountName: 'Temp FB',
        accountId: `temp_fb_${Date.now()}`,
        accessTokenEnc: 'enc_temp_token',
      },
    });

    const tempContent = await prisma.content.create({
      data: {
        workspaceId: tempWorkspace.id,
        authorId: orgA.users[0].userId,
        title: 'Cascade Test Content',
        masterCaption: 'Testing cascading deletions',
        variants: {
          create: {
            platform: 'FACEBOOK',
            caption: 'FB Variant',
          },
        },
      },
      include: { variants: true },
    });

    const tempPub = await prisma.publication.create({
      data: {
        contentVariantId: tempContent.variants[0].id,
        socialConnectionId: tempConn.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        idempotencyKey: `cascade_test_pub_${Date.now()}`,
      },
    });

    await prisma.content.delete({ where: { id: tempContent.id } });

    const fetchedVariant = await prisma.contentVariant.findUnique({
      where: { id: tempContent.variants[0].id },
    });
    assertEqual(fetchedVariant, null, 'ContentVariant should be cascaded and deleted');

    const fetchedPub = await prisma.publication.findUnique({
      where: { id: tempPub.id },
    });
    assertEqual(fetchedPub, null, 'Publication should be cascaded and deleted');

    await prisma.workspace.delete({ where: { id: tempWorkspace.id } });
  });

  await runner.test('Cascade Deletion Behavior: Deleting Workspace cascades connections and contents', async () => {
    const ws = await prisma.workspace.create({
      data: {
        organizationId: orgA.id,
        name: `Ws Cascade Test ${Date.now()}`,
        slug: `ws-cascade-${Date.now()}`,
      },
    });

    const conn = await prisma.socialConnection.create({
      data: {
        workspaceId: ws.id,
        platform: 'TWITTER',
        accountName: 'Temp Twitter',
        accountId: `temp_tw_${Date.now()}`,
        accessTokenEnc: 'enc_token',
      },
    });

    await prisma.workspace.delete({ where: { id: ws.id } });

    const fetchedConn = await prisma.socialConnection.findUnique({ where: { id: conn.id } });
    assertEqual(fetchedConn, null, 'SocialConnection should be cascaded when workspace is deleted');
  });

  await runner.test('Duplicate Content Variants Constraint: @@unique([contentId, platform]) prevents duplicate platform variants', async () => {
    const ws = orgA.workspaces[0];
    const content = await prisma.content.create({
      data: {
        workspaceId: ws.id,
        authorId: orgA.users[0].userId,
        title: 'Variant Unique Constraint Test',
        masterCaption: 'Testing unique variant constraint',
        variants: {
          create: {
            platform: 'YOUTUBE',
            caption: 'YouTube Variant 1',
          },
        },
      },
    });

    let duplicateCaught = false;
    try {
      await prisma.contentVariant.create({
        data: {
          contentId: content.id,
          platform: 'YOUTUBE',
          caption: 'YouTube Variant 2 Duplicate',
        },
      });
    } catch (err: any) {
      duplicateCaught = true;
    }

    assertTrue(duplicateCaught, 'Adding duplicate content variant for same platform should fail unique constraint');

    await prisma.content.delete({ where: { id: content.id } });
  });

  await runner.test('Duplicate Idempotency Keys Constraint: Prisma unique constraint on idempotencyKey rejects duplicates', async () => {
    const ws = orgA.workspaces[0];
    const conn = await prisma.socialConnection.findFirst({ where: { workspaceId: ws.id } });
    const content = await prisma.content.create({
      data: {
        workspaceId: ws.id,
        authorId: orgA.users[0].userId,
        title: 'Idempotency Constraint Test',
        masterCaption: 'Testing idempotency unique key constraint',
        variants: {
          create: {
            platform: 'TIKTOK',
            caption: 'TikTok Variant',
          },
        },
      },
      include: { variants: true },
    });

    if (conn) {
      const key = `test_idempotency_constraint_${Date.now()}`;
      await prisma.publication.create({
        data: {
          contentVariantId: content.variants[0].id,
          socialConnectionId: conn.id,
          scheduledAt: new Date(),
          status: 'SCHEDULED',
          idempotencyKey: key,
        },
      });

      let duplicateCaught = false;
      try {
        await prisma.publication.create({
          data: {
            contentVariantId: content.variants[0].id,
            socialConnectionId: conn.id,
            scheduledAt: new Date(),
            status: 'SCHEDULED',
            idempotencyKey: key,
          },
        });
      } catch (err) {
        duplicateCaught = true;
      }

      assertTrue(duplicateCaught, 'Duplicate publication idempotency key should throw DB constraint error');
    }

    await prisma.content.delete({ where: { id: content.id } });
  });

  return runner;
}
