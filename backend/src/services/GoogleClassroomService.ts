import fs from 'fs';
import { google } from 'googleapis';
import type { User } from '../database/models/userModel';
import { extractTextFromFilesOrUrl } from '../utils/extractText';
import { uploadBufferToGCS } from '../utils/gcs';
import { decryptToken } from '../utils/encryption';

export class GoogleAuthError extends Error {
  constructor(
    public code: number,
    public message: string
  ) {
    super(message);
  }
}

/**
 * Initialize Google OAuth2 client with user credentials
 * @param user User object with google tokens
 * @returns Initialized OAuth2 client
 * @throws GoogleAuthError if configuration is incomplete or user lacks tokens
 */
export function getGoogleOAuth2Client(user: User) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const callbackUrl = process.env.GOOGLE_CALLBACK_URL || `${process.env.BE_BASE_URL || 'http://localhost:3000'}/api/auth/google/callback`;

  if (!clientId || !clientSecret) {
    throw new GoogleAuthError(500, 'Google OAuth configuration is incomplete on the server.');
  }

  if (!user.googleRefreshToken && !user.googleAccessToken) {
    throw new GoogleAuthError(400, 'Google Classroom access is not connected yet. Please sign in again with Google consent.');
  }

  const accessToken = decryptToken(user.googleAccessToken);
  const refreshToken = decryptToken(user.googleRefreshToken);

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, callbackUrl);
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  return oauth2Client;
}

/**
 * Get authenticated Google Classroom API client
 * @param user User object with google tokens
 * @returns Classroom API instance
 * @throws GoogleAuthError if authentication fails
 */
export function getClassroomClient(user: User) {
  const oauth2Client = getGoogleOAuth2Client(user);
  return google.classroom({ version: 'v1', auth: oauth2Client });
}

/**
 * Download a file from Google Drive using user's OAuth credentials
 * @param user User object with google tokens
 * @param fileId Google Drive file ID
 * @returns File buffer
 * @throws GoogleAuthError if download fails
 */
export async function downloadFromGoogleDrive(user: User, fileId: string): Promise<Buffer> {
  const oauth2Client = getGoogleOAuth2Client(user);
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  try {
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    return Buffer.from(response.data as ArrayBuffer);
  } catch (error) {
    const typedError = error as {
      code?: number;
      response?: {
        status?: number;
        data?: {
          error?: {
            message?: string;
          };
        };
      };
      message?: string;
    };
    const statusCode = typedError.code || typedError.response?.status || 500;
    const apiMessage = typedError.response?.data?.error?.message || typedError.message || 'Unknown Google Drive error.';

    if (statusCode === 403 && /insufficient authentication scopes/i.test(apiMessage)) {
      throw new GoogleAuthError(
        403,
        'Google authorization is missing required scopes. Please reconnect your Google account and grant Drive permissions again.'
      );
    }

    throw new GoogleAuthError(
      statusCode,
      `Failed to download file from Google Drive: ${apiMessage}`
    );
  }
}

/**
 * Upload a local file to Google Drive using user's OAuth credentials.
 * @param user User object with google tokens
 * @param localFilePath Absolute local file path
 * @param fileName Name to use in Google Drive
 * @param mimeType Optional file mime type
 * @param folderId Optional Google Drive folder ID where file should be uploaded
 * @returns Uploaded file metadata
 * @throws GoogleAuthError if upload fails
 */
export async function uploadLocalFileToGoogleDrive(
  user: User,
  localFilePath: string,
  fileName: string,
  mimeType?: string,
  folderId?: string
): Promise<{
  fileId: string;
  name: string;
  mimeType?: string;
  webViewLink?: string;
  webContentLink?: string;
}> {
  const oauth2Client = getGoogleOAuth2Client(user);
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  try {
    const response = await drive.files.create({
      requestBody: {
        name: fileName,
        mimeType,
        parents: folderId ? [folderId] : undefined,
      },
      media: {
        mimeType: mimeType || 'application/octet-stream',
        body: fs.createReadStream(localFilePath),
      },
      fields: 'id,name,mimeType,webViewLink,webContentLink',
      supportsAllDrives: true,
    });

    const uploaded = response.data;

    if (!uploaded.id || !uploaded.name) {
      throw new Error('Google Drive API did not return uploaded file details.');
    }

    return {
      fileId: uploaded.id,
      name: uploaded.name,
      mimeType: uploaded.mimeType || undefined,
      webViewLink: uploaded.webViewLink || undefined,
      webContentLink: uploaded.webContentLink || undefined,
    };
  } catch (error) {
    const typedError = error as {
      code?: number;
      response?: {
        status?: number;
        data?: {
          error?: {
            message?: string;
          };
        };
      };
      message?: string;
    };
    const statusCode = typedError.code || typedError.response?.status || 500;
    const apiMessage = typedError.response?.data?.error?.message || typedError.message || 'Unknown Google Drive error.';

    if (statusCode === 403 && /insufficient authentication scopes/i.test(apiMessage)) {
      throw new GoogleAuthError(
        403,
        'Google authorization is missing required Drive upload scopes. Please reconnect your Google account and grant Drive permissions again.'
      );
    }

    throw new GoogleAuthError(
      statusCode,
      `Failed to upload file to Google Drive: ${apiMessage}`
    );
  }
}

/**
 * Download file from Google Drive and upload to GCS
 * @param user User object with google tokens
 * @param fileId Google Drive file ID
 * @param fileName Optional custom filename for GCS (defaults to fileId)
 * @returns Signed URL for the uploaded file
 * @throws GoogleAuthError if download fails
 */
export async function downloadFromGoogleDriveAndUploadToGCS(
  user: User,
  fileId: string,
  fileName?: string
): Promise<string> {
  const buffer = await downloadFromGoogleDrive(user, fileId);
  return uploadBufferToGCS(buffer, fileName || `drive_${fileId}`);
}

/**
 * Download a file from Google Drive, upload it to GCS, and extract text via OCR.
 * This is intended for testing and end-to-end file processing.
 * @param user User object with google tokens
 * @param fileId Google Drive file ID
 * @returns Uploaded GCS URL plus extracted text and file metadata
 * @throws GoogleAuthError if download fails
 */
export async function downloadFromGoogleDriveUploadToGCSAndExtractText(
  user: User,
  fileId: string
): Promise<{ uploadedUrl: string; text: string; fileName: string; mimeType?: string }> {
  const oauth2Client = getGoogleOAuth2Client(user);
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  const metadataResponse = await drive.files.get({
    fileId,
    fields: 'name,mimeType',
  });

  const fileName = metadataResponse.data.name || `drive_${fileId}`;
  const mimeType = metadataResponse.data.mimeType || undefined;

  const bufferResponse = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );

  const buffer = Buffer.from(bufferResponse.data as ArrayBuffer);
  const uploadedUrl = await uploadBufferToGCS(buffer, fileName);
  const text = await extractTextFromFilesOrUrl({
    fileUrl: uploadedUrl,
    cleanupLocalFiles: false,
  });

  return {
    uploadedUrl,
    text,
    fileName,
    mimeType,
  };
}
