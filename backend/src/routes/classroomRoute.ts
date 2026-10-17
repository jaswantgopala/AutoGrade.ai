import { Request, Response, Router } from 'express';
import requireJwt from '../middlewares/requireJwt';
import fs from 'fs';
import { getClassroomClient, GoogleAuthError, downloadFromGoogleDriveUploadToGCSAndExtractText, uploadLocalFileToGoogleDrive } from '../services/GoogleClassroomService';
import { User } from '../database/models/userModel';
import { upload } from '../utils/multer';
import { gradingQueue } from '../queue/gradingQueue';
import { uploadToGCS } from '../utils/gcs';
import resultModel from '../database/models/resultModel';
import courseWorkModel from '../database/models/courseWorkModel';

const router = Router();

type CourseAttachmentRow = {
  studentId: string;
  driveFileId: string;
};

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value as any);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toGoogleClassroomDueDate(value: unknown): { year: number; month: number; day: number } | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return {
    year: parsed.getUTCFullYear(),
    month: parsed.getUTCMonth() + 1,
    day: parsed.getUTCDate(),
  };
}

function toGoogleClassroomDueTime(
  dueDateValue: unknown,
  dueTimeValue?: unknown
): { hours: number; minutes: number; seconds: number; nanos: number } | undefined {
  if (!dueDateValue) {
    return undefined;
  }

  if (typeof dueTimeValue === 'string' && dueTimeValue.trim()) {
    const parsed = dueTimeValue.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (parsed) {
      const hours = Number(parsed[1]);
      const minutes = Number(parsed[2]);
      const seconds = parsed[3] ? Number(parsed[3]) : 0;

      if (
        Number.isInteger(hours) &&
        Number.isInteger(minutes) &&
        Number.isInteger(seconds) &&
        hours >= 0 &&
        hours <= 23 &&
        minutes >= 0 &&
        minutes <= 59 &&
        seconds >= 0 &&
        seconds <= 59
      ) {
        return {
          hours,
          minutes,
          seconds,
          nanos: 0,
        };
      }
    }
  }

  // Classroom API requires dueTime when dueDate is set. Default to end of day.
  return {
    hours: 23,
    minutes: 59,
    seconds: 0,
    nanos: 0,
  };
}

async function countPendingCopiesForCoursework(user: User, courseId: string, courseWorkId: string): Promise<number> {
  const attachmentRows = await fetchCourseworkAttachmentRows(user, courseId, courseWorkId);

  const completedResults = await resultModel.find(
    {
      googleId: user.googleId,
      courseWorkId,
      status: 'completed',
    },
    {
      studentId: 1,
      driveFileId: 1,
    }
  ).lean();

  const completedAttachmentKeys = new Set(
    completedResults
      .filter((item) => item.studentId && item.driveFileId)
      .map((item) => `${String(item.studentId)}::${String(item.driveFileId)}`)
  );
  const legacyCompletedStudents = new Set(
    completedResults
      .filter((item) => item.studentId && !item.driveFileId)
      .map((item) => String(item.studentId))
  );

  const classroom = getClassroomClient(user);
  let pendingCopies = 0;

  for (const row of attachmentRows) {
    const key = `${row.studentId}::${row.driveFileId}`;
    if (completedAttachmentKeys.has(key)) {
      continue;
    }

    if (legacyCompletedStudents.has(row.studentId)) {
      continue;
    }

    pendingCopies += 1;
  }

  return pendingCopies;
}

async function fetchCourseworkAttachmentRows(user: User, courseId: string, courseWorkId: string): Promise<CourseAttachmentRow[]> {
  const classroom = getClassroomClient(user);
  const queryParams: any = {
    courseId,
    courseWorkId,
    pageSize: 50,
  };

  let pageToken: string | undefined;
  const rows: CourseAttachmentRow[] = [];

  do {
    queryParams.pageToken = pageToken;
    const response = await classroom.courses.courseWork.studentSubmissions.list(queryParams as any);
    const submissions = ((response as any).data.studentSubmissions || []) as any[];

    for (const submission of submissions) {
      const submissionStudentId = submission?.studentId || submission?.userId;
      if (!submissionStudentId) {
        continue;
      }

      const attachments = submission?.assignmentSubmission?.attachments || [];

      for (const attachment of attachments) {
        const driveFileId = attachment?.driveFile?.id;
        if (!driveFileId) {
          continue;
        }

        rows.push({
          studentId: String(submissionStudentId),
          driveFileId: String(driveFileId),
        });
      }
    }

    pageToken = (response as any).data.nextPageToken || undefined;
  } while (pageToken);

  return rows;
}

router.get('/courses', requireJwt, async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    const classroom = getClassroomClient(user);
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 50;
    const courses: any[] = [];
    let pageToken: string | undefined;

    do {
      const response = await classroom.courses.list({
        pageSize,
        pageToken,
        courseStates: ['ACTIVE'],
      });

      courses.push(...(response.data.courses || []));
      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    return res.status(200).json({
      courses,
    });
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      return res.status(error.code).json({
        message: error.message,
      });
    }
    console.error('Failed to fetch courses:', error);
    return res.status(500).json({
      message: 'Failed to fetch Google Classroom courses.',
    });
  }
});
// router.get('/announcements/:googleCourseId', requireJwt, async (req: Request, res: Response) => {
//   try {
//     const user = req.user as User;
//     const googleCourseId = Array.isArray(req.params.googleCourseId)
//       ? req.params.googleCourseId[0]
//       : req.params.googleCourseId;

//     const classroom = getClassroomClient(user);
//     const queryParams: any = {
//       courseId: googleCourseId,
//       pageSize: 50,
//     };
//     if (req.query.pageToken) {
//       queryParams.pageToken = req.query.pageToken;
//     }

//     const response = await classroom.courses.announcements.list(queryParams as any);

//     const announcements = (response as any).data.announcements || [];

//     return res.status(200).json({
//       announcements,
//       nextPageToken: (response as any).data.nextPageToken || null,
//     });
//   } catch (error) {
//     if (error instanceof GoogleAuthError) {
//       return res.status(error.code).json({
//         message: error.message,
//       });
//     }
//     return res.status(500).json({
//       message: 'Failed to fetch Google Classroom announcements.',
//       error,
//     });
//   }
// });
router.get('/coursework/notCreated/:courseId',requireJwt, async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    const courseId = req.params.courseId;
    const classroom = getClassroomClient(user);
    const storedCourseWork = await courseWorkModel.find({
      courseId,
      googleId: user.googleId,
    }).lean();
    const storedCourseWorkIds = new Set(storedCourseWork.map((item) => String(item.courseWorkId)));

    if (storedCourseWorkIds.size === 0) {
      return res.status(200).json({
        courseWork: [],
      });
    }

    const courseWorkStatesQuery = req.query.courseWorkStates;
    const courseWorkStates = Array.isArray(courseWorkStatesQuery)
      ? courseWorkStatesQuery
      : typeof courseWorkStatesQuery === 'string'
      ? courseWorkStatesQuery.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    const queryParams: any = {
      courseId,
    };

    if (req.query.orderBy) {
      queryParams.orderBy = req.query.orderBy;
    }
    if (courseWorkStates && courseWorkStates.length > 0) {
      queryParams.courseWorkStates = courseWorkStates;
    }
    if (req.query.previewVersion) {
      queryParams.previewVersion = req.query.previewVersion;
    }

    const courseWork: any[] = [];
    let pageToken: string | undefined;

    do {
      queryParams.pageToken = pageToken;
      const response = await classroom.courses.courseWork.list(queryParams as any);
      const classroomCourseWork = ((response as any).data.courseWork || []) as any[];
      courseWork.push(...classroomCourseWork.filter((item) => item?.id && !storedCourseWorkIds.has(String(item.id))));
      pageToken = (response as any).data.nextPageToken || undefined;
    } while (pageToken);

    return res.status(200).json({
      courseWork,
    });
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      return res.status(error.code).json({
        message: error.message,
      });
    }
    console.error('Failed to fetch notCreated coursework:', error);
    return res.status(500).json({
      message: 'Failed to fetch Google Classroom course work.',
    });
  }
});

router.get('/coursework/created/:courseId',requireJwt, async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    const courseId = req.params.courseId;
    const classroom = getClassroomClient(user);
    const storedCourseWork = await courseWorkModel.find({
      courseId,
      googleId: user.googleId,
    }).lean();
    const storedCourseWorkIds = new Set(storedCourseWork.map((item) => String(item.courseWorkId)));

    if (storedCourseWorkIds.size === 0) {
      return res.status(200).json({
        courseWork: [],
      });
    }

    const courseWorkStatesQuery = req.query.courseWorkStates;
    const courseWorkStates = Array.isArray(courseWorkStatesQuery)
      ? courseWorkStatesQuery
      : typeof courseWorkStatesQuery === 'string'
      ? courseWorkStatesQuery.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    const queryParams: any = {
      courseId,
    };

    if (req.query.orderBy) {
      queryParams.orderBy = req.query.orderBy;
    }
    if (courseWorkStates && courseWorkStates.length > 0) {
      queryParams.courseWorkStates = courseWorkStates;
    }
    if (req.query.previewVersion) {
      queryParams.previewVersion = req.query.previewVersion;
    }

    const courseWork: any[] = [];
    let pageToken: string | undefined;

    do {
      queryParams.pageToken = pageToken;
      const response = await classroom.courses.courseWork.list(queryParams as any);
      const classroomCourseWork = ((response as any).data.courseWork || []) as any[];
      courseWork.push(...classroomCourseWork.filter((item) => item?.id && storedCourseWorkIds.has(String(item.id))));
      pageToken = (response as any).data.nextPageToken || undefined;
    } while (pageToken);

    return res.status(200).json({
      courseWork,
    });
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      return res.status(error.code).json({
        message: error.message,
      });
    }
    console.error('Failed to fetch created coursework:', error);
    return res.status(500).json({
      message: 'Failed to fetch Google Classroom course work.',
    });
  }
});

router.post('/coursework/:courseId/:courseWorkId/submissions', requireJwt, upload, async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    const requestId = `grade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const freeCopiesLimit = Number(process.env.FREE_COPIES_PER_ACCOUNT || 5);
    const paidCopyCostInr = Number(process.env.PAID_COPY_COST_INR || 7);
    const { driveId, rubricContext, strictness, maxScore } = req.body as {
      driveId?: string;
      rubricContext?: string;
      strictness?: 'Easy' | 'Medium' | 'Hard';
      maxScore?: number;
    };
    const courseId = req.params.courseId;
    const courseWorkId = req.params.courseWorkId;
    const safeCourseId = String(courseId);
    const safeCourseWorkId = String(courseWorkId);

    const usedFreeCopies = await resultModel.countDocuments({
      googleId: user.googleId,
      status: 'completed',
    });
    const remainingFreeCopies = Math.max(0, freeCopiesLimit - usedFreeCopies);

    const requestedCopies = await countPendingCopiesForCoursework(user, safeCourseId, safeCourseWorkId);
    if (requestedCopies === 0) {
      return res.status(400).json({
        message: 'No student submission attachments found to grade.',
        freeCopiesLimit,
        usedFreeCopies,
        remainingFreeCopies,
      });
    }

    const freeCopiesToConsume = Math.min(remainingFreeCopies, requestedCopies);
    const paidCopiesToConsume = Math.max(0, requestedCopies - freeCopiesToConsume);
    const requiredWalletInr = Math.round(paidCopiesToConsume * paidCopyCostInr * 100) / 100;
    const walletBalanceInr = Number((user as any).walletBalanceInr || 0);

    if (requiredWalletInr > walletBalanceInr) {
      return res.status(402).json({
        message: 'Insufficient wallet balance. Please recharge to continue grading remaining copies.',
        freeCopiesLimit,
        usedFreeCopies,
        remainingFreeCopies,
        requestedCopies,
        paidCopiesToConsume,
        paidCopyCostInr,
        requiredWalletInr,
        walletBalanceInr,
      });
    }

    const createdAtIso = toIsoOrNull(user.createdAt) || new Date().toISOString();
    const updatedAtIso = toIsoOrNull(user.updatedAt) || createdAtIso;

    let referenceFileUrl: string | undefined;
    if (req.file) {
      try {
        referenceFileUrl = await uploadToGCS(
          req.file.path,
          `reference-${Date.now()}-${req.file.originalname}`
        );
      } catch (uploadError) {
        console.error('Failed to upload reference file to GCS:', uploadError);
        // Don't fail the entire request, just proceed without reference file
      }
    }

    const job = await gradingQueue.add('grade-coursework-submissions', {
      user: {
        id: String(user.id),
        googleId: user.googleId,
        email: user.email,
        fullName: user.fullName,
        googleAccessToken: user.googleAccessToken,
        googleRefreshToken: user.googleRefreshToken,
        jwtSecureCode: user.jwtSecureCode,
        createdAt: createdAtIso,
        updatedAt: updatedAtIso,
      },
      courseId: safeCourseId,
      courseWorkId: safeCourseWorkId,
      driveId,
      rubricContext,
      strictness,
      maxScore,
      referenceFileUrl,
      billing: {
        freeCopiesAtStart: freeCopiesToConsume,
        costPerCopyInr: paidCopyCostInr,
      },
      debug: {
        requestId,
        enqueuedAt: new Date().toISOString(),
        initiatedBy: user.email,
      },
    });

    console.log('[GradingJob] queued', {
      requestId,
      jobId: job.id,
      courseId: safeCourseId,
      courseWorkId: safeCourseWorkId,
      hasDriveId: Boolean(driveId),
      hasReferenceFile: Boolean(referenceFileUrl),
    });

    return res.status(202).json({
      message: 'Grading started in background.',
      requestId,
      jobId: job.id,
      status: 'queued',
      freeCopiesLimit,
      usedFreeCopies,
      remainingFreeCopies: Math.max(0, remainingFreeCopies - freeCopiesToConsume),
      consumedFreeCopies: freeCopiesToConsume,
      paidCopiesToConsume,
      paidCopyCostInr,
      requiredWalletInr,
      walletBalanceInr,
      statusEndpoint: `/api/classroom/coursework/${safeCourseId}/${safeCourseWorkId}/submissions/jobs/${job.id}`,
    });
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      return res.status(error.code).json({
        message: error.message,
      });
    }

    console.error('Submissions grading route failed:', error);

    return res.status(500).json({
      message: 'Failed to fetch and grade Google Classroom student submissions.',
    });
  }
});

router.get('/coursework/:courseId/:courseWorkId/submissions/jobs/:jobId', requireJwt, async (req: Request, res: Response) => {
  try {
    const courseId = String(req.params.courseId);
    const courseWorkId = String(req.params.courseWorkId);
    const jobId = String(req.params.jobId);

    const job = await gradingQueue.getJob(jobId);
    if (!job) {
      return res.status(404).json({
        message: 'Job not found.',
      });
    }

    const data = job.data as any;
    if (data.courseId !== courseId || data.courseWorkId !== courseWorkId) {
      return res.status(404).json({
        message: 'Job not found for this coursework.',
      });
    }

    const state = await job.getState();
    const progress = job.progress || { total: 0, processed: 0, failed: 0 };
    const attemptsMade = typeof job.attemptsMade === 'number' ? job.attemptsMade : 0;

    const createdAtIso = toIsoOrNull(job.timestamp);
    const processedAtIso = toIsoOrNull(job.processedOn);
    const finishedAtIso = toIsoOrNull(job.finishedOn);

    return res.status(200).json({
      jobId,
      state,
      progress,
      attemptsMade,
      result: job.returnvalue || null,
      error: job.failedReason || null,
      requestId: (job.data as any)?.debug?.requestId || null,
      createdAt: createdAtIso,
      processedAt: processedAtIso,
      finishedAt: finishedAtIso,
    });
  } catch (error) {
    console.error('Failed to fetch job status:', error);
    return res.status(500).json({
      message: 'Failed to fetch job status.',
    });
  }
});

router.get('/dashboard/:courseId/:courseWorkId',requireJwt, async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    const courseId = String(req.params.courseId);
    const courseWorkId = String(req.params.courseWorkId);

    // Fetch all grading results for this coursework (student info already stored in DB)
    const results = await resultModel.find({
      courseWorkId,
      googleId: user.googleId,
    });

    const attachmentRows = await fetchCourseworkAttachmentRows(user, courseId, courseWorkId);
    const totalCopies = attachmentRows.length;
    const totalStudents = new Set(attachmentRows.map((row) => row.studentId)).size;

    const completedResults = results.filter((item) => item.status === 'completed');
    const failedResults = results.filter((item) => item.status === 'failed');

    const completedAttachmentKeys = new Set(
      completedResults
        .filter((item) => item.studentId && (item as any).driveFileId)
        .map((item) => `${String(item.studentId)}::${String((item as any).driveFileId)}`)
    );

    const legacyCompletedStudents = new Set(
      completedResults
        .filter((item) => item.studentId && !(item as any).driveFileId)
        .map((item) => String(item.studentId))
    );

    let completedCopies = 0;
    let remainingCopies = 0;
    const completedStudentIds = new Set<string>();

    for (const row of attachmentRows) {
      const key = `${row.studentId}::${row.driveFileId}`;
      if (completedAttachmentKeys.has(key) || legacyCompletedStudents.has(row.studentId)) {
        completedCopies += 1;
        completedStudentIds.add(row.studentId);
      } else {
        remainingCopies += 1;
      }
    }

    return res.status(200).json({
      courseId,
      courseWorkId,
      summary: {
        totalStudents,
        completedStudents: completedStudentIds.size,
        remainingStudents: Math.max(0, totalStudents - completedStudentIds.size),
        totalCopies,
        completedCopies,
        failedCopies: failedResults.length,
        remainingCopies,
      },
      results,
    });
  } catch (error) {
    console.error('Dashboard fetch failed:', error);

    return res.status(500).json({
      message: 'Failed to fetch dashboard data.',
    });
  }
})

router.post('/createCoursework/:courseId', requireJwt,upload, async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    const classroom = getClassroomClient(user);
    const courseId = String(req.params.courseId);
    const { title, description, maxPoints, dueDate, dueTime } = req.body as {
      title?: string;
      description?: string;
      maxPoints?: string | number;
      dueDate?: string;
      dueTime?: string;
    };
    const parsedDueDate = toGoogleClassroomDueDate(dueDate);
    const parsedDueTime = toGoogleClassroomDueTime(parsedDueDate, dueTime);
    const normalizedMaxPoints =
      maxPoints === undefined || maxPoints === null || String(maxPoints).trim() === ''
        ? undefined
        : Number(maxPoints);

    if (!req.file) {
      return res.status(400).json({
        message: 'file is required (multipart/form-data field name: file).',
      });
    }

    const uploaded = await uploadLocalFileToGoogleDrive(
      user,
      req.file.path,
      req.file.originalname,
      req.file.mimetype
    );

    const createCourseWorkResponse = await classroom.courses.courseWork.create({
      courseId,
      requestBody: {
        title,
        description,
        maxPoints: Number.isFinite(normalizedMaxPoints) ? normalizedMaxPoints : undefined,
        dueDate: parsedDueDate,
        dueTime: parsedDueTime,
        workType: 'ASSIGNMENT',
        materials: [
          {
            driveFile: {
              driveFile: {
                id: uploaded.fileId,
              },
              shareMode: 'VIEW',
            },
          },
        ],
        state: 'PUBLISHED',
      },
    } as any);

    const courseworkId = createCourseWorkResponse.data.id;
    if (!courseworkId) {
      return res.status(502).json({
        message: 'Google Classroom did not return a coursework ID.',
      });
    }

    await courseWorkModel.create({
      googleId: user.googleId,
      courseWorkId: courseworkId,
      courseId: courseId,
      maxScore: Number.isFinite(normalizedMaxPoints) ? Number(normalizedMaxPoints) : 0,
      strictness: 'Medium',
      rubricContext: description || '',
    });
    
    return res.status(201).json({
      courseworkId,
      driveId: uploaded.fileId,
    });
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      return res.status(error.code).json({
        message: error.message,
      });
    }

    console.error('Create coursework failed:', error);

    return res.status(500).json({
      message: 'Failed to create coursework.',
    });
  } finally {
    if (req.file?.path) {
      await fs.promises.unlink(req.file.path).catch(() => {
        // Ignore cleanup errors for temp upload files.
      });
    }
  }
});


router.patch('/coursework/:courseId/:courseWorkId/submissions/marks', requireJwt, async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    const classroom = getClassroomClient(user);
    const courseId = String(req.params.courseId);
    const courseWorkId = String(req.params.courseWorkId);
    const previewVersion = typeof req.query.previewVersion === 'string' ? req.query.previewVersion : undefined;

    const results = await resultModel.find({ courseWorkId }).lean();
    if (!results.length) {
      return res.status(404).json({
        message: 'No graded results found in DB for this coursework.',
        courseId,
        courseWorkId,
      });
    }

    const submissionsByStudentId = new Map<string, string>();
    let pageToken: string | undefined;
    do {
      const listResponse = await classroom.courses.courseWork.studentSubmissions.list({
        courseId,
        courseWorkId,
        pageSize: 100,
        pageToken,
      } as any);

      const submissions = ((listResponse as any).data.studentSubmissions || []) as any[];
      for (const submission of submissions) {
        const submissionStudentId = submission.studentId || submission.userId;
        const submissionId = submission.id;
        if (submissionStudentId && submissionId) {
          submissionsByStudentId.set(String(submissionStudentId), String(submissionId));
        }
      }

      pageToken = (listResponse as any).data.nextPageToken || undefined;
    } while (pageToken);

    let patchedCount = 0;
    let missingSubmissionCount = 0;
    const failures: Array<{ studentId: string; reason: string }> = [];

    for (const result of results) {
      const studentId = String(result.studentId || '');
      if (!studentId) {
        failures.push({ studentId: '', reason: 'Missing studentId in DB result.' });
        continue;
      }

      const submissionId = submissionsByStudentId.get(studentId);
      if (!submissionId) {
        missingSubmissionCount += 1;
        failures.push({ studentId, reason: 'No matching Classroom student submission found.' });
        continue;
      }

      const numericScore = Number(result.score);
      if (!Number.isFinite(numericScore)) {
        failures.push({ studentId, reason: `Invalid score in DB: ${String(result.score)}` });
        continue;
      }

      try {
        await classroom.courses.courseWork.studentSubmissions.patch({
          courseId,
          courseWorkId,
          id: submissionId,
          updateMask: 'draftGrade,assignedGrade',
          previewVersion,
          requestBody: {
            draftGrade: numericScore,
            assignedGrade: numericScore,
          },
        } as any);
        patchedCount += 1;
      } catch (error) {
        failures.push({
          studentId,
          reason: error instanceof Error ? error.message : 'Unknown patch error',
        });
      }
    }

    return res.status(200).json({
      message: 'Student submission marks sync completed.',
      courseId,
      courseWorkId,
      totalResults: results.length,
      patchedCount,
      missingSubmissionCount,
      failedCount: failures.length,
      failures,
    });
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      return res.status(error.code).json({
        message: error.message,
      });
    }

    console.error('Failed to update student submission marks:', error);
    return res.status(500).json({
      message: 'Failed to update student submission marks from DB.',
    });
  }
});

export default router;