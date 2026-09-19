import { startWorker, pollScheduledPublications, recoverStuckPublications } from './modules/publishing/QueueService';

console.log('🚀 [INNOSOM OS] Starting Publishing Queue Worker Process...');

let worker: any = null;

try {
  worker = startWorker();
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

// Periodically run crash/stuck publication recovery every 60 seconds
setInterval(async () => {
  try {
    await recoverStuckPublications();
  } catch (err) {
    console.error('Stuck publication recovery error:', err);
  }
}, 60000);

// Handle graceful shutdown
const shutdown = async (signal: string) => {
  console.log(`\n🛑 [INNOSOM OS] Received ${signal}. Shutting down worker process gracefully...`);
  if (worker) {
    try {
      await worker.close();
      console.log('✅ BullMQ Worker closed cleanly.');
    } catch (err) {
      console.error('Error closing BullMQ Worker:', err);
    }
  }
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
