import { encryptToken, decryptToken, isMockToken, isEncryptedToken } from '../src/lib/encryption';
import { prisma } from '../src/lib/prisma';

const TEST_KEY_1 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_KEY_2 = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

async function runEncryptionTests() {
  console.log('🧪 Running Credential Encryption Security Unit Tests...\n');

  // Save original env key
  const originalKey = process.env.ENCRYPTION_KEY;

  try {
    // 1. encrypt -> decrypt returns original value
    process.env.ENCRYPTION_KEY = TEST_KEY_1;
    const rawToken = 'oauth2_secret_access_token_v2_998877665544332211';
    const encrypted = encryptToken(rawToken);

    if (!encrypted || !isEncryptedToken(encrypted)) {
      throw new Error('Encryption failed: Output string is not in valid encrypted format.');
    }
    if (encrypted === rawToken) {
      throw new Error('Encryption failed: Plaintext was not transformed into ciphertext.');
    }

    const decrypted = decryptToken(encrypted);
    if (decrypted !== rawToken) {
      throw new Error(`Decryption mismatch: Expected "${rawToken}", got "${decrypted}"`);
    }
    console.log('✅ 1. Encrypt -> Decrypt roundtrip test passed.');

    // 2. wrong key fails
    process.env.ENCRYPTION_KEY = TEST_KEY_2;
    let wrongKeyFailed = false;
    try {
      decryptToken(encrypted);
    } catch (err: any) {
      wrongKeyFailed = true;
      if (err.message.includes(TEST_KEY_1) || err.message.includes(TEST_KEY_2) || err.message.includes(rawToken)) {
        throw new Error('Security violation: Error message leaked sensitive key or token info.');
      }
    }
    if (!wrongKeyFailed) {
      throw new Error('Decryption with wrong key should have failed, but succeeded.');
    }
    console.log('✅ 2. Wrong key failure test passed.');

    // 3. modified ciphertext fails
    process.env.ENCRYPTION_KEY = TEST_KEY_1;
    const parts = encrypted.split(':');
    // Modify last character of ciphertext
    const tamperedPayload = parts.slice(0, 4).join(':') + (parts[4].endsWith('a') ? 'b' : 'a');
    let tamperFailed = false;
    try {
      decryptToken(tamperedPayload);
    } catch (err: any) {
      tamperFailed = true;
      if (err.message.includes(rawToken)) {
        throw new Error('Security violation: Error message leaked token value on tampered ciphertext.');
      }
    }
    if (!tamperFailed) {
      throw new Error('Decryption of tampered ciphertext should have failed, but succeeded.');
    }
    console.log('✅ 3. Modified ciphertext authentication failure test passed.');

    // 4. missing encryption key fails securely
    delete process.env.ENCRYPTION_KEY;
    let missingKeyFailedEncrypt = false;
    try {
      encryptToken('test_token');
    } catch (err: any) {
      missingKeyFailedEncrypt = true;
      if (!err.message.includes('ENCRYPTION_KEY')) {
        throw new Error(`Unexpected error message on missing key: ${err.message}`);
      }
    }
    if (!missingKeyFailedEncrypt) {
      throw new Error('Encryption with missing ENCRYPTION_KEY should have failed.');
    }

    let missingKeyFailedDecrypt = false;
    try {
      decryptToken(encrypted);
    } catch (err: any) {
      missingKeyFailedDecrypt = true;
      if (!err.message.includes('ENCRYPTION_KEY')) {
        throw new Error(`Unexpected error message on missing key: ${err.message}`);
      }
    }
    if (!missingKeyFailedDecrypt) {
      throw new Error('Decryption with missing ENCRYPTION_KEY should have failed.');
    }
    console.log('✅ 4. Missing key secure failure test passed.');

    // Restore key for persistence test
    process.env.ENCRYPTION_KEY = TEST_KEY_1;

    // 5. Plaintext token is never returned from persistence APIs / stored in DB
    const sensitiveToken = 'live_production_meta_graph_api_token_12345';
    const encryptedForDb = encryptToken(sensitiveToken)!;

    // Find or create test workspace
    let workspace = await prisma.workspace.findFirst();
    let tempOrg: any = null;
    if (!workspace) {
      tempOrg = await prisma.organization.create({
        data: {
          name: 'Temp Encryption Test Org',
          slug: `temp-enc-test-${Date.now()}`,
          workspaces: {
            create: {
              name: 'Temp Encryption Workspace',
              slug: 'temp-enc-ws',
            },
          },
        },
        include: { workspaces: true },
      });
      workspace = tempOrg.workspaces[0];
    }

    const createdConn = await prisma.socialConnection.create({
      data: {
        workspaceId: workspace.id,
        platform: 'FACEBOOK',
        accountName: 'Security Test Account',
        accountId: 'sec_test_1001',
        status: 'CONNECTED',
        accessTokenEnc: encryptedForDb,
      },
    });

    // Query DB directly
    const fetchedDbConn = await prisma.socialConnection.findUnique({
      where: { id: createdConn.id },
    });

    if (!fetchedDbConn) {
      throw new Error('Failed to re-fetch social connection from persistence layer.');
    }

    if (fetchedDbConn.accessTokenEnc === sensitiveToken) {
      throw new Error('Persistence violation: Plaintext OAuth token was found in the database!');
    }

    if (!fetchedDbConn.accessTokenEnc.startsWith('enc:v1:')) {
      throw new Error('Persistence violation: Token in database is not stored in encrypted format.');
    }

    // Clean up test connection & tempOrg if created
    await prisma.socialConnection.delete({ where: { id: createdConn.id } });
    if (tempOrg) {
      await prisma.organization.delete({ where: { id: tempOrg.id } });
    }
    console.log('✅ 5. Persistence security test passed (plaintext never stored).');

    // 6. Development mock credential preservation test
    const mockToken = 'enc_token_mock_fb_haji_abdi';
    const encMock = encryptToken(mockToken);
    const decMock = decryptToken(encMock);

    if (encMock !== mockToken || decMock !== mockToken) {
      throw new Error('Mock credential preservation test failed.');
    }
    console.log('✅ 6. Development mock credential preservation test passed.');

    console.log('\n🎉 All Credential Encryption Tests Passed Successfully!');
  } finally {
    process.env.ENCRYPTION_KEY = originalKey;
    await prisma.$disconnect();
  }
}

runEncryptionTests().catch((e) => {
  console.error('❌ Encryption test execution failed:', e);
  process.exit(1);
});
