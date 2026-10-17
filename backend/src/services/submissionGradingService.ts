import { User } from '../database/models/userModel';
import { getClassroomClient, downloadFromGoogleDriveUploadToGCSAndExtractText } from './GoogleClassroomService';
import { extractTextFromFilesOrUrl } from '../utils/extractText';
import courseWorkModel from '../database/models/courseWorkModel';
import resultModel from '../database/models/resultModel';
import { gradeResult } from '../gradingWorker/grading';
import { GradingJobPayload } from '../queue/gradingQueue';
import { calculateSpendWithProfit } from './billingService';

export type GradingJobResult = {
  courseId: string;
  courseWorkId: string;
  teacherAnswerSource: string | null;
  vectorWarning: string | null;
  gradedSubmissions: number;
  gradedAttachments: number;
  newlyGradedAttachments: number;
  failedAttachments: number;
  spendEstimate: {
    geminiInputTokens: number;
    geminiOutputTokens: number;
    ocrPages: number;
    gcsStorageGb: number;
    gcsEgressGb: number;
    billing: ReturnType<typeof calculateSpendWithProfit>;
  };
};

export async function processSubmissionGrading(
  payload: GradingJobPayload,
  onProgress?: (progress: { total: number; processed: number; failed: number }) => Promise<void> | void,
  onDebug?: (message: string, meta?: Record<string, unknown>) => Promise<void> | void
): Promise<GradingJobResult> {
  const user = payload.user as unknown as User;
  const { courseId, courseWorkId, driveId, maxScore, rubricContext, strictness, referenceFileUrl } = payload;

  if (onDebug) {
    await onDebug('Starting grading payload processing.', {
      courseId,
      courseWorkId,
      hasDriveId: Boolean(driveId),
      hasReferenceFileUrl: Boolean(referenceFileUrl),
    });
  }

  const classroom = getClassroomClient(user);
  const vectorWarning = 'Vector usage is disabled. Grading uses direct reference text + rubric context.';
  let teacherAnswer = '';

  if (referenceFileUrl) {
    if (onDebug) {
      await onDebug('Extracting reference material text.', { referenceFileUrl });
    }
    const referenceMaterialText = await extractTextFromFilesOrUrl({
      fileUrl: referenceFileUrl,
      cleanupLocalFiles: false,
    });

    if (referenceMaterialText.trim()) {
      teacherAnswer = referenceMaterialText;
      if (onDebug) {
        await onDebug('Reference material extracted for direct grading context.', {
          length: referenceMaterialText.length,
        });
      }
    }
  }

  let course = await courseWorkModel.findOne({ courseId, courseWorkId });
  if (!course) {
    if (!maxScore || !strictness || !rubricContext) {
      throw new Error('First-time setup requires maxScore, strictness, and rubricContext.');
    }

    course = await courseWorkModel.create({
      courseId,
      courseWorkId,
      googleId: user.googleId,
      maxScore,
      strictness,
      rubricContext,
    });

    if (onDebug) {
      await onDebug('Created coursework config in database for first-time setup.', {
        courseId,
        courseWorkId,
      });
    }
  }

  const questionPaperText = driveId
    ? (await downloadFromGoogleDriveUploadToGCSAndExtractText(user, driveId)).text
    : '';

  const queryParams: any = {
    courseId,
    courseWorkId,
    pageSize: 50,
  };

  const studentSubmissions: any[] = [];
  let pageToken: string | undefined;

  do {
    queryParams.pageToken = pageToken;
    const response = await classroom.courses.courseWork.studentSubmissions.list(queryParams as any);
    studentSubmissions.push(...((response as any).data.studentSubmissions || []));
    pageToken = (response as any).data.nextPageToken || undefined;
  } while (pageToken);

  if (onDebug) {
    await onDebug('Fetched student submissions.', {
      submissionsCount: studentSubmissions.length,
    });
  }

  let total = 0;
  for (const submission of studentSubmissions) {
    const attachments = submission?.assignmentSubmission?.attachments || [];
    total += attachments.filter((a: any) => !!a?.driveFile?.id).length;
  }

  let processed = 0;
  let failed = 0;
  let newlyGradedAttachments = 0;
  let totalGeminiInputTokens = 0;
  let totalGeminiOutputTokens = 0;
  let estimatedOcrPages = 0;
  let estimatedGcsStorageGb = 0;
  let estimatedGcsEgressGb = 0;
  if (onProgress) {
    await onProgress({ total, processed, failed });
  }
  if (onDebug) {
    await onDebug('Computed total attachments to process.', { totalAttachments: total });
  }

  for (const submission of studentSubmissions) {
    const attachments = submission?.assignmentSubmission?.attachments || [];

    for (const attachment of attachments) {
      const driveFileId = attachment?.driveFile?.id;
      if (!driveFileId) {
        continue;
      }

      const submissionStudentId = submission.studentId || submission.userId;
      if (!submissionStudentId) {
        failed += 1;
        if (onDebug) {
          await onDebug('Attachment skipped: missing student identifier.', {
            submissionId: submission?.id || null,
            driveFileId,
          });
        }
        processed += 1;
        if (onProgress) {
          await onProgress({ total, processed, failed });
        }
        continue;
      }

      const existing = await resultModel.findOne({
        googleId: user.googleId,
        courseWorkId,
        studentId: submissionStudentId,
        $or: [
          { driveFileId },
          { driveFileId: { $exists: false } },
          { driveFileId: null },
        ],
      }).lean();

      if (existing?.status === 'completed') {
        if (onDebug) {
          await onDebug('Skipping already graded attachment.', {
            submissionId: submission?.id || null,
            studentId: submissionStudentId,
            driveFileId,
          });
        }
        processed += 1;
        if (onProgress) {
          await onProgress({ total, processed, failed });
        }
        continue;
      }

      try {
        if (onDebug) {
          await onDebug('Processing attachment.', {
            submissionId: submission?.id || null,
            driveFileId,
          });
        }
        const studentAnswerFile = await downloadFromGoogleDriveUploadToGCSAndExtractText(user, driveFileId);
        estimatedOcrPages += 1;
        const estimatedBytes = Buffer.byteLength(studentAnswerFile.text || '', 'utf8');
        const estimatedGb = estimatedBytes / (1024 * 1024 * 1024);
        estimatedGcsStorageGb += estimatedGb;
        estimatedGcsEgressGb += estimatedGb;

        const grade = await gradeResult({
          maxScore: Number(course.maxScore),
          strictness: course.strictness,
          rubricContext: course.rubricContext,
          questionPaper: questionPaperText,
          teacherAnswer: teacherAnswer || '',
          studentAnswer: studentAnswerFile.text,
          feedback: '',
        });

        if (grade.usage) {
          totalGeminiInputTokens += grade.usage.inputTokens;
          totalGeminiOutputTokens += grade.usage.outputTokens;
        }

        // Fetch student profile from Google Classroom
        let studentName = 'Unknown';
        let studentEmail = 'Unknown';
        try {
          const studentProfile = await classroom.userProfiles.get({
            userId: submissionStudentId,
          });
          studentName = studentProfile.data.name?.fullName || 'Unknown';
          studentEmail = studentProfile.data.emailAddress || 'Unknown';
        } catch (profileError) {
          console.warn(`Failed to fetch profile for student ${submissionStudentId}:`, profileError);
        }

        if (existing) {
          await resultModel.updateOne(
            { _id: existing._id },
            {
              $set: {
                googleId: user.googleId,
                driveFileId,
                grade: grade.grade,
                remark: grade.remark,
                score: grade.score,
                feedback: grade.feedback,
                studentName,
                studentEmail,
                status: 'completed',
              },
            }
          );
        } else {
          await resultModel.create({
            googleId: user.googleId,
            driveFileId,
            studentId: submissionStudentId,
            courseWorkId,
            grade: grade.grade,
            remark: grade.remark,
            score: grade.score,
            feedback: grade.feedback,
            studentName,
            studentEmail,
            status: 'completed',
          });
        }

        newlyGradedAttachments += 1;
      } catch (error) {
        failed += 1;
        if (onDebug) {
          await onDebug('Attachment grading failed.', {
            submissionId: submission?.id || null,
            driveFileId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      } finally {
        processed += 1;
        if (onProgress) {
          await onProgress({ total, processed, failed });
        }
      }
    }
  }

  if (onDebug) {
    await onDebug('Grading payload processing completed.', {
      gradedSubmissions: studentSubmissions.length,
      gradedAttachments: processed,
      failedAttachments: failed,
      totalGeminiInputTokens,
      totalGeminiOutputTokens,
    });
  }

  const spendBilling = calculateSpendWithProfit({
    geminiInputTokens: totalGeminiInputTokens,
    geminiOutputTokens: totalGeminiOutputTokens,
    ocrPages: estimatedOcrPages,
    gcsStorageGb: estimatedGcsStorageGb,
    gcsEgressGb: estimatedGcsEgressGb,
  });

  return {
    courseId,
    courseWorkId,
    teacherAnswerSource: teacherAnswer ? 'reference_file' : null,
    vectorWarning,
    gradedSubmissions: studentSubmissions.length,
    gradedAttachments: processed,
    newlyGradedAttachments,
    failedAttachments: failed,
    spendEstimate: {
      geminiInputTokens: totalGeminiInputTokens,
      geminiOutputTokens: totalGeminiOutputTokens,
      ocrPages: estimatedOcrPages,
      gcsStorageGb: estimatedGcsStorageGb,
      gcsEgressGb: estimatedGcsEgressGb,
      billing: spendBilling,
    },
  };
}
