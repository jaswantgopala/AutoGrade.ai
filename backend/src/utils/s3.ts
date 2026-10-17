import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

export const s3 = new S3Client({
  region: process.env.AWS_REGION as string,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
  },
});

export async function uploadToS3(
  filePath: string,
  fileName: string
): Promise<string> {
  const bucketName = process.env.AWS_BUCKET_NAME as string;
  const presignedUrlExpirySeconds = Number(process.env.AWS_SIGNED_URL_EXPIRY_SECONDS || 3600);
  const fileStream = fs.createReadStream(filePath);

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileName,
    Body: fileStream,
  });

  await s3.send(command);

  const getObjectCommand = new GetObjectCommand({
    Bucket: bucketName,
    Key: fileName,
  });

  return getSignedUrl(s3, getObjectCommand, {
    expiresIn: presignedUrlExpirySeconds,
  });
}