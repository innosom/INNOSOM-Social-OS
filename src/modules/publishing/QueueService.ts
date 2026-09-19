import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { processPublicationJob } from './PublishingWorker';
import { prisma } from '@/lib/prisma';

const PUBLISHING_QUEUE_NAME = 'innosom-publishing-queue';

let queue: Queue | null = null;
let connection: Redis | null = null;

function getRedisConnection(): Redis {
  if (!connection) {
    connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy: () => null, // Do not reconnect infinitely if Redis is down
    });
    connection.on('error', () => {
      // Suppress unhandled ioredis error logs in local environments without Redis
    });
  }
  return connection;
}

export function getPublishingQueue(): Queue {
  if (!queue) {
    queue = new Queue(PUBLISHING_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: true,
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
    if (process.env.NODE_ENV === 'test' || !process.env.REDIS_URL_ACTIVE) {
      // Fallback to direct background execution when Redis is not running or in unit testing
      const timer = setTimeout(() => {
        processPublicationJob(publicationId).catch((e) =>
          console.error('Fallback worker error:', e)
        );
      }, Math.min(delayMs, 10));
      if (timer && typeof timer.unref === 'function') {
        timer.unref();
      }
      return;
    }

    const q = getPublishingQueue();
    await q.add(
      'publish-social-post',
      { publicationId },
      {
        jobId: publicationId, // Enforce Idempotency
        delay: delayMs > 0 ? delayMs : 0,
      }
    );
    console.log(`📥 [Queue] Enqueued publication job ${publicationId} with delay ${delayMs}ms`);
  } catch (err) {
    console.warn(`⚠️ [Queue] Redis Queue unavailable. Fallback to direct execution for ${publicationId}`);
    const timer = setTimeout(() => {
      processPublicationJob(publicationId).catch((e) =>
        console.error('Fallback worker error:', e)
      );
    }, Math.min(delayMs, 10));
    if (timer && typeof timer.unref === 'function') {
      timer.unref();
    }
  }
}

export function startWorker(): Worker {
  const worker = new Worker(
    PUBLISHING_QUEUE_NAME,
    async (job: Job<{ publicationId: string }>) => {
      console.log(`⚙️ [Worker] Processing BullMQ job ${job.id} for publication ${job.data.publicationId}`);
      return await processPublicationJob(job.data.publicationId);
    },
    {
      connection: getRedisConnection(),
      concurrency: 5,
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
