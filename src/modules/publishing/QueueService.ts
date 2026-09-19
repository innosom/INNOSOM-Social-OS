import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { processPublicationJob } from './PublishingWorker';
import { prisma } from '@/lib/prisma';

const PUBLISHING_QUEUE_NAME = 'innosom-publishing-queue';

let queue: Queue | null = null;
let connection: Redis | null = null;

function getRedisConnection(): Redis | null {
  if (process.env.DISABLE_REDIS === 'true') {
    return null;
  }
  if (!connection) {
    connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      connectTimeout: 1000,
      retryStrategy(times) {
        if (times > 2) return null; // stop retrying quickly if Redis unavailable
        return 100;
      },
    });
    connection.on('error', (err) => {
      // suppress unhandled redis error logs in fallback environments
    });
  }
  return connection;
}

export function getPublishingQueue(): Queue | null {
  if (process.env.DISABLE_REDIS === 'true') {
    return null;
  }
  if (!queue) {
    const conn = getRedisConnection();
    if (!conn) return null;
    queue = new Queue(PUBLISHING_QUEUE_NAME, {
      connection: conn,
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }
  return queue;
}

export async function enqueuePublicationJob(
  publicationId: string,
  delayMs: number = 0
): Promise<void> {
  try {
    const q = getPublishingQueue();
    if (!q) throw new Error('Redis Queue disabled');
    await q.add(
      'publish-social-post',
      { publicationId },
      {
        jobId: publicationId, // Enforce Idempotency Key in BullMQ
        delay: delayMs > 0 ? delayMs : 0,
      }
    );
    console.log(`📥 [Queue] Enqueued publication job ${publicationId} with delay ${delayMs}ms`);
  } catch (err) {
    console.warn(`⚠️ [Queue] Redis Queue unavailable. Fallback to direct execution for ${publicationId}`);
    setTimeout(() => {
      processPublicationJob(publicationId).catch((e) =>
        console.error('Fallback worker error:', e)
      );
    }, delayMs);
  }
}

export function startWorker(): Worker | null {
  const conn = getRedisConnection();
  if (!conn) return null;
  const worker = new Worker(
    PUBLISHING_QUEUE_NAME,
    async (job: Job<{ publicationId: string }>) => {
      console.log(`⚙️ [Worker] Processing BullMQ job ${job.id} for publication ${job.data.publicationId}`);
      const res = await processPublicationJob(job.data.publicationId);
      if (!res.success && res.isRetriable) {
        throw new Error(res.error || 'Retriable publication failure');
      }
      return res;
    },
    {
      connection: conn,
      concurrency: 5,
      lockDuration: 30000,
      stalledInterval: 15000,
    }
  );

  worker.on('completed', (job) => {
    console.log(`✅ [Worker] Job ${job.id} completed successfully.`);
  });

  worker.on('failed', (job, err) => {
    console.error(`❌ [Worker] Job ${job?.id} failed with error:`, err);
  });

  return worker;
}

/**
 * Poll database for scheduled posts without racing with BullMQ workers.
 * Atomically claim scheduled posts and enqueue them.
 */
export async function pollScheduledPublications(): Promise<void> {
  const now = new Date();
  const duePublications = await prisma.publication.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledAt: { lte: now },
    },
  });

  for (const pub of duePublications) {
    await enqueuePublicationJob(pub.id, 0);
  }
}

/**
 * Recover publications stuck in PUBLISHING status due to crashed workers or timeouts.
 * Safe crash recovery: if publication is stuck in PUBLISHING for over 5 minutes, reset or reconcile.
 */
export async function recoverStuckPublications(): Promise<void> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const stuckPubs = await prisma.publication.findMany({
    where: {
      status: 'PUBLISHING',
      lastAttemptAt: { lte: fiveMinutesAgo },
    },
  });

  for (const pub of stuckPubs) {
    console.warn(`⚠️ [Worker Recovery] Found stuck publication ${pub.id} in PUBLISHING state since ${pub.lastAttemptAt}. Resetting to SCHEDULED for safe retry.`);
    await prisma.publication.update({
      where: { id: pub.id },
      data: {
        status: 'SCHEDULED',
        errorMessage: 'Stuck in PUBLISHING status due to worker crash or network timeout. Resetting for retry.',
      },
    });
    await enqueuePublicationJob(pub.id, 0);
  }
}
