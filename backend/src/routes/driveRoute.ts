import { Request, Response, Router } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import requireJwt from '../middlewares/requireJwt';
import type { User } from '../database/models/userModel';
import { uploadBufferToGCS } from '../utils/gcs';
import { upload } from '../utils/multer';
import { extractTextFromFilesOrUrl } from '../utils/extractText';
import {
  GoogleAuthError,
  downloadFromGoogleDrive,
  downloadFromGoogleDriveUploadToGCSAndExtractText,
  uploadLocalFileToGoogleDrive,
} from '../services/GoogleClassroomService';

const router = Router();

// Temporary test-only endpoint for verifying Drive file downloads with the logged-in user.
router.get('/download/:fileId', requireJwt, async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    const fileId = typeof req.params.fileId === 'string' ? req.params.fileId.trim() : '';

    if (!fileId) {
      return res.status(400).json({ message: 'fileId is required' });
    }

    const buffer = await downloadFromGoogleDrive(user, fileId);
    const safeName = `${fileId}.bin`;
    const localPath = path.join(os.tmpdir(), safeName);

    await fs.promises.writeFile(localPath, buffer);

    return res.status(200).json({
      message: 'Drive file downloaded to local temp storage successfully.',
      fileId,
      bufferLength: buffer.length,
      localPath,
      previewHex: buffer.subarray(0, Math.min(buffer.length, 32)).toString('hex'),
    });
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      return res.status(error.code).json({ message: error.message });
    }

    return res.status(500).json({
      message: 'Failed to download Google Drive file.',
      error,
    });
  }
});

// Temporary test-only endpoint for end-to-end Drive -> GCS -> OCR flow.
router.get('/process/:fileId', requireJwt, async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    const fileId = typeof req.params.fileId === 'string' ? req.params.fileId.trim() : '';

    if (!fileId) {
      return res.status(400).json({ message: 'fileId is required' });
    }

    const result = await downloadFromGoogleDriveUploadToGCSAndExtractText(user, fileId);
    return res.status(200).json({
      message: 'Drive file downloaded, uploaded to GCS, and OCR text extracted successfully.',
      fileId,
      ...result,
    });
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      return res.status(error.code).json({ message: error.message });
    }

    return res.status(500).json({
      message: 'Failed to process Google Drive file.',
      error,
    });
  }
});

// Temporary test-only endpoint for verifying GCS upload independently.
router.get('/gcs/test', requireJwt, async (_req: Request, res: Response) => {
  try {
    const fileName = `gcs-test-${Date.now()}.txt`;
    const buffer = Buffer.from(
      `GCS test upload\nTimestamp: ${new Date().toISOString()}\nSource: autoGradeAi`
    );

    const signedUrl = await uploadBufferToGCS(buffer, fileName);

    return res.status(200).json({
      message: 'GCS upload test succeeded.',
      fileName,
      bufferLength: buffer.length,
      signedUrl,
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to upload test file to GCS.',
      error,
    });
  }
});

// Temporary test-only endpoint for local file -> OCR text extraction.
router.post('/extract/local', requireJwt, upload, async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'file is required (multipart/form-data field name: file).' });
    }

    const text = await extractTextFromFilesOrUrl({
      files: req.file,
      cleanupLocalFiles: true,
    });

    return res.status(200).json({
      message: 'Text extracted successfully from local uploaded file.',
      fileName: req.file.originalname,
      extractedText: text,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      message: 'Failed to extract text from local uploaded file.',
      error: errorMessage,
    });
  }
});

// Temporary test-only endpoint for local file -> Google Drive upload.
router.post('/upload/local', requireJwt, upload, async (req: Request, res: Response) => {
  try {
    const user = req.user as User;

    if (!req.file) {
      return res.status(400).json({ message: 'file is required (multipart/form-data field name: file).' });
    }

    const folderId = typeof req.body?.folderId === 'string' && req.body.folderId.trim()
      ? req.body.folderId.trim()
      : undefined;
    const customFileName = typeof req.body?.fileName === 'string' && req.body.fileName.trim()
      ? req.body.fileName.trim()
      : req.file.originalname;

    const uploaded = await uploadLocalFileToGoogleDrive(
      user,
      req.file.path,
      customFileName,
      req.file.mimetype,
      folderId
    );

    return res.status(200).json({
      driveId: uploaded.fileId,
    });
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      return res.status(error.code).json({ message: error.message });
    }

    return res.status(500).json({
      message: 'Failed to upload file to Google Drive.',
      error,
    });
  } finally {
    if (req.file?.path) {
      await fs.promises.unlink(req.file.path).catch(() => {
        // Ignore cleanup errors for temp upload files.
      });
    }
  }
});

export default router;