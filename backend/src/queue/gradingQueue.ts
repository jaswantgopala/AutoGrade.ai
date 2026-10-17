import { Queue } from 'bullmq';
import { createRedisConnection } from './redis';

export const GRADING_QUEUE_NAME = 'grading-submissions';

export type GradingJobPayload = {
  user: {
    id: string;
    googleId: string;
    email: string;
    fullName: string;
    googleRefreshToken?: string;
    googleAccessToken?: string;
    jwtSecureCode: string;
    createdAt: string;
    updatedAt: string;
  };
  courseId: string;
  courseWorkId: string;
  driveId?: string;
  rubricContext?: string;
  strictness?: 'Easy' | 'Medium' | 'Hard';
  maxScore?: number;
  referenceFileUrl?: string;
  billing?: {
    freeCopiesAtStart: number;
    costPerCopyInr: number;
  };
  debug?: {
    requestId: string;
    enqueuedAt: string;
    initiatedBy: string;
  };
};

const queueConnection = createRedisConnection();

export const gradingQueue = new Queue<GradingJobPayload>(GRADING_QUEUE_NAME, {
  connection: queueConnection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 200,
    attempts: 4,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  },
});
