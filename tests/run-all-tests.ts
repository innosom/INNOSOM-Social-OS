import EmbeddedPostgres from 'embedded-postgres';
import { execSync } from 'child_process';

async function runAllTests() {
  console.log('🚀 Initializing Test Environment with PostgreSQL...\n');

  let pg: EmbeddedPostgres | null = null;
  let databaseUrl = process.env.POSTGRES_TEST_URL;

  if (!databaseUrl) {
    console.log('⚙️ Starting local PostgreSQL engine on port 5432...');
    pg = new EmbeddedPostgres({
      port: 5432,
      user: 'postgres',
      password: 'password',
      persistent: false,
    });
    await pg.initialise();
    await pg.start();
    databaseUrl = 'postgresql://postgres:password@localhost:5432/postgres?schema=public';
  }

  process.env.DATABASE_URL = databaseUrl;
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  try {
    // 1. Run Migrations
    console.log('1️⃣ Running PostgreSQL Schema Migrations (prisma migrate deploy)...');
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    });

    // 2. Run Seed
    console.log('\n2️⃣ Running Database Seed (prisma/seed.ts)...');
    execSync('npx tsx prisma/seed.ts', {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    });

    // 3. Run Test Suites
    console.log('\n3️⃣ Running PostgreSQL Integration Test Suite...');
    execSync('npx tsx tests/postgres-integration.test.ts', {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    });

    console.log('\n4️⃣ Running Encryption & Security Unit Tests...');
    execSync('npx tsx tests/encryption.test.ts', {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    });

    console.log('\n5️⃣ Running Publishing & Workflow Unit Tests...');
    execSync('npx tsx tests/publishing.test.ts', {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    });

    console.log('\n6️⃣ Running Social Provider Unit Tests...');
    execSync('npx tsx tests/providers.test.ts', {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    });

    console.log('\n🎉 ALL TEST SUITES PASSED SUCCESSFULLY AGAINST POSTGRESQL!\n');
  } finally {
    if (pg) {
      await pg.stop();
      console.log('🛑 PostgreSQL engine stopped.');
    }
  }
}

runAllTests().catch((e) => {
  console.error('❌ Test execution failed:', e);
  process.exit(1);
});
