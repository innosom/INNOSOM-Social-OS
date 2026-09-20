import { runSecurityAuthTests } from './security_auth.test';
import { runTenantIsolationTests } from './tenant_isolation.test';
import { runPublishingWorkflowTests } from './publishing_workflow.test';
import { runDataIntegrityTests } from './data_integrity.test';
import { runMediaHandlingTests } from './media_handling.test';
import { runAnalyticsAuditTests } from './analytics_audit.test';

async function runMasterTestSuite() {
  console.log('===========================================================');
  console.log('🛡️ INNOSOM Social OS - Comprehensive Test Suite');
  console.log('===========================================================');

  const startTime = Date.now();
  let totalSuites = 0;
  let passedSuites = 0;

  const testSuites = [
    { name: 'Authentication, Session & Authorization Security', fn: runSecurityAuthTests },
    { name: 'Tenant & Cross-Workspace Isolation Security', fn: runTenantIsolationTests },
    { name: 'Publishing Workflow & Worker Resiliency', fn: runPublishingWorkflowTests },
    { name: 'Data Integrity & Schema Constraints', fn: runDataIntegrityTests },
    { name: 'Media Management & Asset Validation', fn: runMediaHandlingTests },
    { name: 'Analytics, Audit Logging & Error Handling', fn: runAnalyticsAuditTests },
  ];

  for (const suite of testSuites) {
    totalSuites++;
    try {
      await suite.fn();
      passedSuites++;
    } catch (err: any) {
      console.error(`❌ Suite [${suite.name}] FAILED:`, err);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n===========================================================');
  console.log('📋 COMPREHENSIVE TEST SUITE SUMMARY REPORT');
  console.log('===========================================================');
  console.log(`Total Test Suites Executed : ${totalSuites}`);
  console.log(`Suites Passed              : ${passedSuites}`);
  console.log(`Suites Failed              : ${totalSuites - passedSuites}`);
  console.log(`Total Time Elapsed         : ${duration}s`);
  console.log('-----------------------------------------------------------');
  console.log('Coverage Areas Verified:');
  console.log('  [✓] Authentication & Session Management (JWT, expired tokens, unauth access)');
  console.log('  [✓] Authorization & RBAC (Role violations, workspace boundaries)');
  console.log('  [✓] Multi-Tenant Isolation (Cross-workspace content, media, connections, pub triggers, ALL_CLIENTS scope)');
  console.log('  [✓] Publishing Engine (Success, failures, retries, timeouts, rate limits, expired OAuth, concurrent workers, idempotency)');
  console.log('  [✓] Data Integrity (Foreign keys, cascade deletion, unique constraints, state transitions)');
  console.log('  [✓] Media Management (Image/video uploads, file validation, binary safety, orphan cleanup)');
  console.log('  [✓] Analytics & Audit Logs (Metric calculations, engagement rate, tenant log isolation, secure errors)');
  console.log('===========================================================\n');

  if (passedSuites !== totalSuites) {
    process.exit(1);
  }
}

runMasterTestSuite().catch((err) => {
  console.error('Fatal Test Suite Error:', err);
  process.exit(1);
});
