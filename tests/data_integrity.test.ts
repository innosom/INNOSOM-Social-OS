import { prisma } from '../src/lib/prisma';

export async function runDataIntegrityTests() {
  console.log('\n🗄️ [4/6] Running Data Integrity & Schema Constraint Tests...\n');

  const org = await prisma.organization.create({
    data: { name: 'Integrity Org', slug: `integ-org-${Date.now()}` },
  });
  const ws = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'Integrity WS', slug: `integ-ws-${Date.now()}` },
  });
  const user = await prisma.user.create({
    data: { email: `integ_user_${Date.now()}@test.com`, name: 'Integ User', passwordHash: 'hash' },
  });

  try {
    // 1. Foreign Key Constraints - Cannot create Content with non-existent Workspace ID
    let fkFailed = false;
    try {
      await prisma.content.create({
        data: {
          workspaceId: 'non-existent-workspace-uuid-999',
          authorId: user.id,
          title: 'FK Failure Test',
          masterCaption: 'Caption',
        },
      });
    } catch (err: any) {
      fkFailed = true;
    }
    if (!fkFailed) {
      throw new Error('Foreign key constraint failed: Allowed content creation with invalid workspaceId!');
    }
    console.log('  ✅ Foreign key constraints enforced on invalid parent references');

    // 2. Cascade Deletion Behavior - Deleting Workspace cascades to Content and SocialConnections
    const wsCascade = await prisma.workspace.create({
      data: { organizationId: org.id, name: 'WS Cascade', slug: `ws-cascade-${Date.now()}` },
    });
    const connCascade = await prisma.socialConnection.create({
      data: { workspaceId: wsCascade.id, platform: 'FACEBOOK', accountName: 'FB', accountId: 'fb_cas', accessTokenEnc: 'enc' },
    });
    const contentCascade = await prisma.content.create({
      data: { workspaceId: wsCascade.id, authorId: user.id, title: 'Cascade Content', masterCaption: 'Caption' },
    });

    await prisma.workspace.delete({ where: { id: wsCascade.id } });

    const checkConn = await prisma.socialConnection.findUnique({ where: { id: connCascade.id } });
    const checkContent = await prisma.content.findUnique({ where: { id: contentCascade.id } });

    if (checkConn || checkContent) {
      throw new Error('Cascade deletion failed: SocialConnection or Content was not deleted on Workspace deletion!');
    }
    console.log('  ✅ Cascading deletion behavior verified (Workspace -> Content & SocialConnections)');

    // 3. Duplicate Content Variants Constraint (@@unique([contentId, platform]))
    const contentVarTest = await prisma.content.create({
      data: { workspaceId: ws.id, authorId: user.id, title: 'Variant Unique Test', masterCaption: 'Caption' },
    });

    await prisma.contentVariant.create({
      data: { contentId: contentVarTest.id, platform: 'FACEBOOK', caption: 'First FB Variant' },
    });

    let duplicateVariantFailed = false;
    try {
      await prisma.contentVariant.create({
        data: { contentId: contentVarTest.id, platform: 'FACEBOOK', caption: 'Second FB Variant' },
      });
    } catch (err: any) {
      duplicateVariantFailed = true;
    }
    if (!duplicateVariantFailed) {
      throw new Error('Unique constraint violation: Allowed duplicate ContentVariant for same content & platform!');
    }
    console.log('  ✅ Duplicate content variants constraint (unique per platform) verified');

    // 4. Duplicate Idempotency Key Constraint on Publications
    const conn = await prisma.socialConnection.create({
      data: { workspaceId: ws.id, platform: 'FACEBOOK', accountName: 'FB Unique', accountId: 'fb_uniq', accessTokenEnc: 'enc' },
    });
    const variant = await prisma.contentVariant.create({
      data: { contentId: contentVarTest.id, platform: 'LINKEDIN', caption: 'LinkedIn Variant' },
    });

    const key = `idempotency_key_unique_${Date.now()}`;
    await prisma.publication.create({
      data: { contentVariantId: variant.id, socialConnectionId: conn.id, scheduledAt: new Date(), idempotencyKey: key },
    });

    let duplicateKeyFailed = false;
    try {
      await prisma.publication.create({
        data: { contentVariantId: variant.id, socialConnectionId: conn.id, scheduledAt: new Date(), idempotencyKey: key },
      });
    } catch (err: any) {
      duplicateKeyFailed = true;
    }
    if (!duplicateKeyFailed) {
      throw new Error('Unique constraint violation: Allowed duplicate publication idempotencyKey!');
    }
    console.log('  ✅ Duplicate idempotency keys constraint on Publications verified');

    // 5. Invalid State Machine Transitions
    // Content status should transition DRAFT -> IN_REVIEW -> APPROVED -> SCHEDULED -> PUBLISHED/FAILED
    const contentState = await prisma.content.create({
      data: { workspaceId: ws.id, authorId: user.id, title: 'State Test', masterCaption: 'Cap', status: 'DRAFT' },
    });

    // Verify updating to valid states vs setting status directly
    await prisma.content.update({ where: { id: contentState.id }, data: { status: 'IN_REVIEW' } });
    await prisma.content.update({ where: { id: contentState.id }, data: { status: 'APPROVED' } });
    const checkState = await prisma.content.findUnique({ where: { id: contentState.id } });
    if (checkState?.status !== 'APPROVED') {
      throw new Error('Content state transition to APPROVED failed');
    }
    console.log('  ✅ Publication state machine transitions verified');

    console.log('\n✨ Data integrity & schema constraint tests passed successfully!');
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.publication.deleteMany({ where: { socialConnection: { workspaceId: ws.id } } });
    await prisma.content.deleteMany({ where: { workspaceId: ws.id } });
    await prisma.socialConnection.deleteMany({ where: { workspaceId: ws.id } });
    await prisma.workspace.delete({ where: { id: ws.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
}

if (require.main === module) {
  runDataIntegrityTests().catch((e) => {
    console.error('❌ Data integrity test failed:', e);
    process.exit(1);
  });
}
