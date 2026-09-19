import path from 'node:path';
import fs from 'node:fs/promises';
import { prisma } from '../src/lib/prisma';
import { POST } from '../src/app/api/media/route';
import { StorageProviderFactory } from '../src/modules/storage/StorageProviderFactory';
import { signSessionToken } from '../src/lib/auth';

// Ensure JWT secret and DB URL exist
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key-32-chars-minimum-length!!';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:./dev.db';

async function runMediaTests() {
  console.log('🧪 Running Real Media Storage Unit & Integration Tests...\n');

  // Setup test organization and workspaces in DB
  const org = await prisma.organization.upsert({
    where: { slug: 'test-org-media' },
    update: {},
    create: {
      name: 'Test Media Org',
      slug: 'test-org-media',
    },
  });

  const user = await prisma.user.upsert({
    where: { email: 'media-test@example.com' },
    update: {},
    create: {
      name: 'Media Tester',
      email: 'media-test@example.com',
      passwordHash: 'hash',
    },
  });

  await prisma.membership.upsert({
    where: {
      userId_organizationId: {
        userId: user.id,
        organizationId: org.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      organizationId: org.id,
      role: 'ADMIN',
    },
  });

  const workspace1 = await prisma.workspace.upsert({
    where: {
      organizationId_slug: {
        organizationId: org.id,
        slug: 'test-ws-1',
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      name: 'Test Workspace 1',
      slug: 'test-ws-1',
    },
  });

  // Create another workspace in a DIFFERENT org to test cross-workspace access rejection
  const otherOrg = await prisma.organization.upsert({
    where: { slug: 'test-other-org' },
    update: {},
    create: { name: 'Other Org', slug: 'test-other-org' },
  });

  const workspace2OtherOrg = await prisma.workspace.upsert({
    where: {
      organizationId_slug: {
        organizationId: otherOrg.id,
        slug: 'test-ws-other',
      },
    },
    update: {},
    create: {
      organizationId: otherOrg.id,
      name: 'Other Workspace',
      slug: 'test-ws-other',
    },
  });

  // Generate Session Token
  const validToken = await signSessionToken({
    userId: user.id,
    email: user.email,
    name: user.name,
    organizationId: org.id,
    role: 'ADMIN',
  });

  // Helper function to build Request object
  function createUploadRequest(
    formData: FormData,
    options: { token?: string } = {}
  ): any {
    const token = options.token !== undefined ? options.token : validToken;
    const headers = new Headers();
    if (token) {
      headers.set('cookie', `innosom_session=${token}`);
    }

    return {
      url: 'http://localhost:3000/api/media',
      headers,
      formData: async () => formData,
    };
  }

  // Sample PNG 1x1 buffer
  const samplePngBuffer = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082',
    'hex'
  );

  // 1. Successful Upload Test
  {
    console.log('Test 1: Successful image upload');
    const formData = new FormData();
    const file = new File([samplePngBuffer], 'test-image.png', { type: 'image/png' });
    formData.append('file', file);
    formData.append('workspaceId', workspace1.id);

    const req = createUploadRequest(formData);
    const res = await POST(req);
    const json = await res.json();

    if (res.status !== 200 || !json.mediaAsset) {
      throw new Error(`Upload failed: ${res.status} ${JSON.stringify(json)}`);
    }

    if (json.mediaAsset.width !== 1 || json.mediaAsset.height !== 1) {
      throw new Error(`Incorrect dimensions extracted: ${json.mediaAsset.width}x${json.mediaAsset.height}`);
    }

    // Verify file actually stored in storage
    const storage = StorageProviderFactory.getStorageProvider();
    const exists = await storage.exists(json.mediaAsset.storageKey);
    if (!exists) {
      throw new Error('File was not stored in storage provider!');
    }

    console.log('  ✅ Successful upload test passed.');
  }

  // 2. Unauthorized Upload Test (No Token)
  {
    console.log('Test 2: Unauthorized upload attempt (no session)');
    const formData = new FormData();
    const file = new File([samplePngBuffer], 'unauth.png', { type: 'image/png' });
    formData.append('file', file);
    formData.append('workspaceId', workspace1.id);

    const req = createUploadRequest(formData, { token: '' });
    const res = await POST(req);

    if (res.status !== 401) {
      throw new Error(`Expected 401 Unauthorized, got ${res.status}`);
    }
    console.log('  ✅ Unauthorized upload test passed.');
  }

  // 3. Cross-Workspace Access Test
  {
    console.log('Test 3: Cross-workspace upload attempt');
    const formData = new FormData();
    const file = new File([samplePngBuffer], 'cross-ws.png', { type: 'image/png' });
    formData.append('file', file);
    formData.append('workspaceId', workspace2OtherOrg.id); // Belongs to different org

    const req = createUploadRequest(formData);
    const res = await POST(req);

    if (res.status !== 403) {
      throw new Error(`Expected 403 Forbidden, got ${res.status}`);
    }
    console.log('  ✅ Cross-workspace access test passed.');
  }

  // 4. Oversized File Test
  {
    console.log('Test 4: Oversized file upload attempt');
    const hugeBuffer = Buffer.alloc(51 * 1024 * 1024); // 51MB
    const formData = new FormData();
    const file = new File([hugeBuffer], 'huge.png', { type: 'image/png' });
    formData.append('file', file);
    formData.append('workspaceId', workspace1.id);

    const req = createUploadRequest(formData);
    const res = await POST(req);
    const json = await res.json();

    if (res.status !== 400 || !json.error?.includes('exceeds the maximum limit')) {
      throw new Error(`Expected size validation error, got ${res.status} ${JSON.stringify(json)}`);
    }
    console.log('  ✅ Oversized file test passed.');
  }

  // 5. Invalid MIME Type Test
  {
    console.log('Test 5: Invalid MIME type attempt');
    const formData = new FormData();
    const file = new File([Buffer.from('echo bad')], 'script.sh', { type: 'text/x-shellscript' });
    formData.append('file', file);
    formData.append('workspaceId', workspace1.id);

    const req = createUploadRequest(formData);
    const res = await POST(req);
    const json = await res.json();

    if (res.status !== 400 || !json.error?.includes('Unsupported or invalid MIME type')) {
      throw new Error(`Expected MIME validation error, got ${res.status} ${JSON.stringify(json)}`);
    }
    console.log('  ✅ Invalid MIME type test passed.');
  }

  // 6. Path Traversal Filename Test
  {
    console.log('Test 6: Path traversal in filename attempt');
    const formData = new FormData();
    const file = new File([samplePngBuffer], '../../etc/passwd.png', { type: 'image/png' });
    formData.append('file', file);
    formData.append('workspaceId', workspace1.id);

    const req = createUploadRequest(formData);
    const res = await POST(req);
    const json = await res.json();

    if (res.status !== 400 || !json.error?.includes('path traversal')) {
      throw new Error(`Expected path traversal error, got ${res.status} ${JSON.stringify(json)}`);
    }
    console.log('  ✅ Path traversal filename test passed.');
  }

  // 7. Cleanup after DB failure test
  {
    console.log('Test 7: Cleanup storage object on database transaction failure');

    const storage = StorageProviderFactory.getStorageProvider();
    let capturedKey: string | null = null;

    // We intercept storage.uploadObject to know what key was written
    const originalUpload = storage.uploadObject.bind(storage);
    storage.uploadObject = async (opts) => {
      capturedKey = opts.key;
      return originalUpload(opts);
    };

    // We mock $transaction to throw error after storage upload
    const originalTransaction = prisma.$transaction.bind(prisma);
    prisma.$transaction = (async () => {
      throw new Error('Simulated Database Failure');
    }) as any;

    try {
      const formData = new FormData();
      const file = new File([samplePngBuffer], 'fail-db.png', { type: 'image/png' });
      formData.append('file', file);
      formData.append('workspaceId', workspace1.id);

      const req = createUploadRequest(formData);
      const res = await POST(req);

      if (res.status !== 500) {
        throw new Error(`Expected 500 status on DB failure, got ${res.status}`);
      }

      if (!capturedKey) {
        throw new Error('Storage key was not captured during test');
      }

      // Verify that the file was deleted from storage during rollback cleanup
      const exists = await storage.exists(capturedKey);
      if (exists) {
        throw new Error(`Storage object ${capturedKey} was NOT cleaned up after DB failure!`);
      }

      console.log('  ✅ Cleanup on DB failure test passed.');
    } finally {
      // Restore mocks
      prisma.$transaction = originalTransaction;
      storage.uploadObject = originalUpload;
    }
  }

  console.log('\n🎉 ALL MEDIA STORAGE TESTS PASSED SUCCESSFULLY!');
}

runMediaTests().catch((err) => {
  console.error('❌ Media tests failed:', err);
  process.exit(1);
});
