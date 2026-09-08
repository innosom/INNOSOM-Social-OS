import { processPublicationJob } from '../src/modules/publishing/PublishingWorker';
import { prisma } from '../src/lib/prisma';

async function runTests() {
  console.log('🧪 Running INNOSOM Social OS Tests...');

  const pubPublished = await prisma.publication.findFirst({
    where: { status: 'PUBLISHED' },
  });

  if (pubPublished) {
    const res = await processPublicationJob(pubPublished.id);
    if (!res.success) throw new Error('Idempotency test failed');
    console.log('✅ Idempotency Test Passed');
  }

  const pubScheduled = await prisma.publication.findFirst({
    where: { status: 'SCHEDULED' },
  });

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
