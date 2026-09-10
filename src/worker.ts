import { startWorker, pollScheduledPublications } from './modules/publishing/QueueService';

console.log('🚀 [INNOSOM OS] Starting Publishing Queue Worker Process...');

try {
  startWorker();
  console.log('✅ BullMQ Worker listening for publishing jobs.');
} catch (e) {
  console.warn('⚠️ Redis connection error for BullMQ Worker. Running polling loop...');
}

// Poll database for scheduled posts every 10 seconds
setInterval(async () => {
  try {
    await pollScheduledPublications();
  } catch (err) {
    console.error('Polling error:', err);
  }
}, 10000);
