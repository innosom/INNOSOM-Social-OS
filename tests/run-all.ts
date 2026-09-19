import { runAuthTests } from './auth.test';
import { runSecurityTests } from './security.test';
import { runPublishingTests } from './publishing.test';
import { runMediaTests } from './media.test';
import { runDataIntegrityTests } from './data-integrity.test';
import { runApprovalsContentTests } from './approvals-content.test';
import { runAnalyticsAuditTests } from './analytics-audit.test';
import { runSocialProvidersTests } from './social-providers.test';
import { prisma } from '../src/lib/prisma';

async function runAllTests() {
  console.log('===============================================================');
  console.log('🧪 INNOSOM Social OS — Comprehensive Automated Test Suite');
  console.log('===============================================================\n');

  const startTime = Date.now();
  const suites = [];

  try {
    suites.push(await runAuthTests());
    suites.push(await runSecurityTests());
    suites.push(await runPublishingTests());
    suites.push(await runMediaTests());
    suites.push(await runDataIntegrityTests());
    suites.push(await runApprovalsContentTests());
    suites.push(await runAnalyticsAuditTests());
    suites.push(await runSocialProvidersTests());
  } catch (err) {
    console.error('Fatal error during test suite execution:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }

  let totalTests = 0;
  let totalPassed = 0;
  let totalFailed = 0;

  console.log('\n===============================================================');
  console.log('📊 TEST SUITE SUMMARY REPORT');
  console.log('===============================================================');

  for (const suite of suites) {
    const summary = suite.printSummary();
    totalTests += summary.total;
    totalPassed += summary.passed;
    totalFailed += summary.failed;
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n---------------------------------------------------------------');
  console.log(`⏱ Total Execution Time: ${duration}s`);
  console.log(`🔢 Total Test Cases Executed: ${totalTests}`);
  console.log(`✅ Passed: ${totalPassed}`);
  console.log(`❌ Failed: ${totalFailed}`);
  console.log('---------------------------------------------------------------\n');

  if (totalFailed > 0) {
    console.error(`💥 TEST SUITE FAILED with ${totalFailed} failing test(s).`);
    process.exit(1);
  } else {
    console.log(`🎉 ALL ${totalTests} AUTOMATED TESTS PASSED SUCCESSFULLY!`);
    process.exit(0);
  }
}

runAllTests().catch((e) => {
  console.error('Unhandled test runner error:', e);
  process.exit(1);
});
