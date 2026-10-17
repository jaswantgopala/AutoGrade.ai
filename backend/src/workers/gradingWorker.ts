import { Worker } from 'bullmq';
import { GRADING_QUEUE_NAME, GradingJobPayload } from '../queue/gradingQueue';
import { createRedisConnection } from '../queue/redis';
import { processSubmissionGrading } from '../services/submissionGradingService';
import { debitWallet } from '../services/walletService';

let workerInstance: Worker<GradingJobPayload> | null = null;

export function startGradingWorker() {
  if (workerInstance) {
    return workerInstance;
  }

  const connection = createRedisConnection();
  const concurrency = Number(process.env.GRADING_WORKER_CONCURRENCY || 1);

  workerInstance = new Worker<GradingJobPayload>(
    GRADING_QUEUE_NAME,
    async (job) => {
      const requestId = job.data?.debug?.requestId || 'unknown-request';
      console.log('[BullMQ] grading job started', {
        jobId: job.id,
        requestId,
        courseId: job.data.courseId,
        courseWorkId: job.data.courseWorkId,
      });

      return processSubmissionGrading(job.data, async (progress) => {
        await job.updateProgress(progress);
      }, async (message, meta) => {
        const logLine = `[${requestId}] ${message}${meta ? ` ${JSON.stringify(meta)}` : ''}`;
        await job.log(logLine);
        console.log('[BullMQ][debug]', {
          jobId: job.id,
          requestId,
          message,
          meta: meta || null,
        });
      });
    },
    {
      connection,
      concurrency,
    }
  );

  workerInstance.on('active', (job) => {
    console.log('[BullMQ] grading job active', {
      jobId: job?.id,
      requestId: job?.data?.debug?.requestId || null,
      attemptsMade: job?.attemptsMade,
    });
  });

  workerInstance.on('progress', (job, progress) => {
    console.log('[BullMQ] grading job progress', {
      jobId: job?.id,
      requestId: job?.data?.debug?.requestId || null,
      progress,
    });
  });

  workerInstance.on('completed', (job) => {
    const completedResult = (job.returnvalue || {}) as {
      newlyGradedAttachments?: number;
    };
    const freeCopiesAtStart = Number(job.data?.billing?.freeCopiesAtStart || 0);
    const costPerCopyInr = Number(job.data?.billing?.costPerCopyInr || 0);
    const newlyGradedAttachments = Number(completedResult.newlyGradedAttachments || 0);
    const paidCopies = Math.max(0, newlyGradedAttachments - freeCopiesAtStart);
    const amountToDebitInr = Math.round(paidCopies * costPerCopyInr * 100) / 100;

    if (amountToDebitInr > 0) {
      debitWallet({
        userId: job.data.user.id,
        amountInr: amountToDebitInr,
        reason: 'grading_usage',
        referenceId: String(job.id),
        metadata: {
          courseId: job.data.courseId,
          courseWorkId: job.data.courseWorkId,
          paidCopies,
          newlyGradedAttachments,
          freeCopiesAtStart,
          costPerCopyInr,
        },
      }).catch((error) => {
        console.error('[BullMQ] wallet debit failed after grading completion', {
          jobId: job.id,
          userId: job.data.user.id,
          amountToDebitInr,
          error: error instanceof Error ? error.message : error,
        });
      });
    }

    console.log('[BullMQ] grading job completed', {
      jobId: job.id,
      requestId: job.data?.debug?.requestId || null,
      newlyGradedAttachments,
      paidCopies,
      amountToDebitInr,
      returnValue: job.returnvalue || null,
    });
  });

  workerInstance.on('failed', (job, err) => {
    console.error('[BullMQ] grading job failed', {
      jobId: job?.id,
      requestId: job?.data?.debug?.requestId || null,
      attemptsMade: job?.attemptsMade,
      error: err?.message || err,
    });
  });

  workerInstance.on('error', (err) => {
    console.error('[BullMQ] worker error:', err?.message || err);
  });

  return workerInstance;
}

if (require.main === module) {
  startGradingWorker();
  console.log('[BullMQ] grading worker started.');
}
