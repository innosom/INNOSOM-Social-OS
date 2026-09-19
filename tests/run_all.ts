import { runAuthAuthorizationTests } from './auth_authorization.test';
import { runContentApprovalsTests } from './content_approvals.test';
import { runPublishingTests } from './publishing.test';
import { runMediaTests } from './media.test';
import { runSocialProvidersTests } from './social_providers.test';
import { runDataIntegrityTests } from './data_integrity.test';
import { runAnalyticsAuditTests } from './analytics_audit.test';
import { prisma } from '../src/lib/prisma';

async function runMasterTestSuite() {
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('   INNOSOM SOCIAL OS — AUTOMATED SUITE SECURITY & INTEGRITY SUITE   ');
  console.log('════════════════════════════════════════════════════════════════════\n');

  const startTime = Date.now();
  let grandTotalTests = 0;
  let grandPassedTests = 0;

  const results: Record<string, { total: number; passed: number; status: string }> = {};

  async function executeCategory(name: string, fn: () => Promise<{ totalTests: number; passedTests: number }>) {
    try {
      const res = await fn();
      grandTotalTests += res.totalTests;
      grandPassedTests += res.passedTests;
      results[name] = { total: res.totalTests, passed: res.passedTests, status: 'PASSED' };
    } catch (err: any) {
      console.error(`\n❌ Error in category [${name}]:`, err);
      results[name] = { total: 0, passed: 0, status: 'FAILED' };
      throw err;
    }
  }

  try {
    // 1. Auth & Authorization Security
    await executeCategory('Authentication & Authorization', runAuthAuthorizationTests);

    // 2. Content & Approvals Workflow
    await executeCategory('Content & Approvals Workflow', runContentApprovalsTests);

    // 3. Publishing & Background Workers
    await executeCategory('Publishing & Worker Queue', runPublishingTests);

    // 4. Media Asset Management & Security
    await executeCategory('Media Asset Management', runMediaTests);

    // 5. Social Providers & OAuth Security
    await executeCategory('Social Providers & Credentials', runSocialProvidersTests);

    // 6. Data Integrity & Constraints
    await executeCategory('Data Integrity & Constraints', runDataIntegrityTests);

    // 7. Analytics, Audit Logs & Dashboard
    await executeCategory('Analytics, Audit & Dashboard', runAnalyticsAuditTests);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n════════════════════════════════════════════════════════════════════');
    console.log('                 AUTOMATED TEST SUITE SUMMARY REPORT                 ');
    console.log('════════════════════════════════════════════════════════════════════');
    console.table(results);
    console.log(`\n🎉 Total Tests Executed: ${grandTotalTests}`);
    console.log(`✅ Total Tests Passed:   ${grandPassedTests}`);
    console.log(`⏱️  Total Duration:       ${duration}s`);
    console.log('════════════════════════════════════════════════════════════════════\n');
  } finally {
    await prisma.$disconnect();
  }
}

runMasterTestSuite().catch((e) => {
  console.error('\n❌ Master Test Suite execution failed with errors:', e);
  process.exit(1);
});
