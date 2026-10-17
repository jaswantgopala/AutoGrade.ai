import { Storage } from "@google-cloud/storage";
import fs from "fs";
import path from "path";
import os from "os";
import dotenv from "dotenv";

dotenv.config();

const projectId = process.env.GCS_PROJECT_ID?.trim();
const keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
const bucketName = process.env.GCS_BUCKET_NAME?.trim();

const storage = new Storage({
  projectId,
  keyFilename,
});

const signedUrlExpirySeconds = Number(process.env.GCS_SIGNED_URL_EXPIRY_SECONDS || 3600);

function getConfiguredBucketName(): string {
  if (!bucketName) {
    throw new Error("GCS_BUCKET_NAME is not configured.");
  }
  return bucketName;
}

function getBucket() {
  return storage.bucket(getConfiguredBucketName());
}

export async function uploadToGCS(
  filePath: string,
  fileName: string
): Promise<string> {
  const bucket = getBucket();
  const [file] = await bucket.upload(filePath, {
    destination: fileName,
    resumable: false,
  });

  const [signedUrl] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + signedUrlExpirySeconds * 1000,
  });

  return signedUrl;
}

/**
 * Upload a buffer directly to GCS and return signed URL
 * @param buffer File buffer to upload
 * @param fileName Destination filename in GCS
 * @returns Signed URL for the uploaded file
 */
export async function uploadBufferToGCS(
  buffer: Buffer,
  fileName: string
): Promise<string> {
  const tempDir = os.tmpdir();
  const tempFilePath = path.join(tempDir, `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`);

  try {
    // Write buffer to temporary file
    await fs.promises.writeFile(tempFilePath, buffer);
    
    // Upload to GCS
    const signedUrl = await uploadToGCS(tempFilePath, fileName);
    
    return signedUrl;
  } finally {
    // Clean up temporary file
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

export async function downloadFromGCS(filename: string): Promise<Buffer> {
  const bucket = getBucket();
  const file = bucket.file(filename);
  const [buffer] = await file.download();
  return buffer;
}