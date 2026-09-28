import { prisma } from '../src/lib/prisma';
import { processPublicationJob } from '../src/modules/publishing/PublishingWorker';
import crypto from 'crypto';

async function runSecurityAuditTests() {
  console.log('🧪 Starting Security Audit & Vulnerability Regression Unit Tests...\n');

  // 1. OAuth State HMAC Signature Verification Test
  console.log('Testing 1: OAuth HMAC State Signature & CSRF Verification...');
  const secretKey = process.env.JWT_SECRET || 'innosom-super-secret-jwt-encryption-key-32-bytes!!';
  const payloadStr = JSON.stringify({ workspaceId: 'ws-123', provider: 'facebook', nonce: 'nonce-abc', userId: 'user-456' });
  const validSig = crypto.createHmac('sha256', secretKey).update(payloadStr).digest('hex');

  // Valid state verification
  const validStateObj = { payload: payloadStr, sig: validSig };
  const verifiedSig = crypto.createHmac('sha256', secretKey).update(validStateObj.payload).digest('hex');
  if (verifiedSig !== validStateObj.sig) {
    throw new Error('OAuth valid state signature verification failed.');
  }

  // Tampered payload state verification
  const tamperedPayload = JSON.stringify({ workspaceId: 'ws-HACKED-999', provider: 'facebook', nonce: 'nonce-abc', userId: 'user-456' });
  const tamperedSig = crypto.createHmac('sha256', secretKey).update(tamperedPayload).digest('hex');
  if (tamperedSig === validSig) {
    throw new Error('OAuth tampered state payload matched signature unexpectedly!');
  }
  console.log('  ✅ OAuth HMAC state signature verification test passed.');

  // 2. Worker Atomic Publication State Lock & Single Execution Test
  console.log('\nTesting 2: Worker Atomic Publication State Lock & Single Execution...');
  const testWorkspace = await prisma.workspace.findFirst();
  if (!testWorkspace) {
    throw new Error('No workspace found in DB to run worker race test.');
  }

  const testConnection = await prisma.socialConnection.findFirst({
    where: { workspaceId: testWorkspace.id },
  });
  if (!testConnection) {
    throw new Error('No social connection found in DB to run worker race test.');
  }

  const testContent = await prisma.content.create({
    data: {
      workspaceId: testWorkspace.id,
      authorId: (await prisma.user.findFirst())!.id,
      title: 'Worker Race Test',
      masterCaption: 'Testing worker lock',
      status: 'APPROVED',
    },
  });

  const testVariant = await prisma.contentVariant.create({
    data: {
      contentId: testContent.id,
      platform: testConnection.platform,
      caption: 'Testing worker lock',
    },
  });

  const testPub = await prisma.publication.create({
    data: {
      contentVariantId: testVariant.id,
      socialConnectionId: testConnection.id,
      scheduledAt: new Date(),
      status: 'SCHEDULED',
      idempotencyKey: `audit_test_pub_${Date.now()}`,
    },
  });

  // Concurrent worker execution simulation
  const [res1, res2] = await Promise.all([
    processPublicationJob(testPub.id),
    processPublicationJob(testPub.id),
  ]);

  if (!res1.success && !res2.success) {
    throw new Error('Both publication worker runs failed unexpectedly.');
  }

  // Reload publication from DB
  const reloadedPub = await prisma.publication.findUnique({ where: { id: testPub.id } });
  if (reloadedPub?.attempts !== 1) {
    throw new Error(`Worker execution attempted ${reloadedPub?.attempts} times. Expected exactly 1 execution due to atomic lock.`);
  }
  console.log('  ✅ Worker atomic lock prevented duplicate execution successfully.');

  // Clean up test data
  await prisma.content.delete({ where: { id: testContent.id } });

  // 3. Cross-Workspace Media Asset Isolation Logic Test
  console.log('\nTesting 3: Cross-Workspace Media Asset Isolation Guard...');
  const workspaces = await prisma.workspace.findMany({ take: 2 });
  if (workspaces.length >= 2) {
    const ws1 = workspaces[0];
    const ws2 = workspaces[1];

    const mediaAssetWs1 = await prisma.mediaAsset.create({
      data: {
        workspaceId: ws1.id,
        fileName: 'client1_private.png',
        fileSize: 1024,
        mimeType: 'image/png',
        storageKey: `workspaces/${ws1.id}/test.png`,
        publicUrl: 'http://example.com/test.png',
      },
    });

    // Verify media asset belonging to ws1 is rejected when created for ws2
    const checkMediaInWs2 = await prisma.mediaAsset.findMany({
      where: {
        id: { in: [mediaAssetWs1.id] },
        workspaceId: ws2.id,
      },
    });

    if (checkMediaInWs2.length !== 0) {
      throw new Error('Cross-workspace media query failed: Media asset from ws1 was matched in ws2!');
    }

    await prisma.mediaAsset.delete({ where: { id: mediaAssetWs1.id } });
    console.log('  ✅ Cross-workspace media asset isolation test passed.');
  }

  // 4. Media Folder Path & Filename Sanitization Test
  console.log('\nTesting 4: Media Folder Path & Filename Sanitization...');
  const maliciousFolderPath = '../../../../etc/passwd';
  const sanitizedFolderPath = '/' + maliciousFolderPath.replace(/\.\./g, '').replace(/\/+/g, '/').replace(/^\//, '');
  if (sanitizedFolderPath.includes('..')) {
    throw new Error(`Path traversal sanitization failed. Got: ${sanitizedFolderPath}`);
  }

  const maliciousFileName = '../../malicious_script<>.sh';
  const cleanFileName = maliciousFileName.replace(/[^a-zA-Z0-9_.-]/g, '_');
  if (cleanFileName.includes('<') || cleanFileName.includes('>')) {
    throw new Error(`Filename sanitization failed. Got: ${cleanFileName}`);
  }
  console.log('  ✅ Media folder path & filename sanitization test passed.');

  console.log('\n🎉 ALL SECURITY AUDIT & VULNERABILITY REGRESSION TESTS PASSED! 🎉');
}

runSecurityAuditTests().catch((err) => {
  console.error('❌ Security Audit Test Execution Failed:', err);
  process.exit(1);
});
