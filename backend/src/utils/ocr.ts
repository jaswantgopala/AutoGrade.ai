import { randomUUID } from "crypto";
import { Storage } from "@google-cloud/storage";
import vision from "@google-cloud/vision";
import path from "path";
import fs from "fs";
import os from "os";

const projectId = process.env.OCR_PROJECT_ID?.trim() || process.env.GCS_PROJECT_ID?.trim();
const keyFilename =
  process.env.OCR_GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
const gcsProjectId = process.env.GCS_PROJECT_ID?.trim();
const gcsKeyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
const bucketName = process.env.GCS_BUCKET_NAME?.trim();

const client = new vision.ImageAnnotatorClient({
  projectId,
  keyFilename,
});

const storage = new Storage({
  projectId: gcsProjectId,
  keyFilename: gcsKeyFilename,
});

function getConfiguredBucketName(): string {
  if (!bucketName) {
    throw new Error("GCS_BUCKET_NAME is not configured.");
  }
  return bucketName;
}

function getBucket() {
  return storage.bucket(getConfiguredBucketName());
}

function toGcsUri(objectName: string): string {
  return `gs://${getConfiguredBucketName()}/${objectName}`;
}

function parseGcsUri(gcsUri: string): { bucket: string; objectName: string } {
  const match = gcsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error(`Invalid GCS URI: ${gcsUri}`);
  }

  return {
    bucket: match[1],
    objectName: match[2],
  };
}

async function deleteGcsObject(gcsUri: string): Promise<void> {
  const { bucket: uriBucket, objectName } = parseGcsUri(gcsUri);
  await storage.bucket(uriBucket).file(objectName).delete({ ignoreNotFound: true } as any);
}

async function uploadPdfBufferToGcs(buffer: Buffer, fileName: string): Promise<string> {
  const bucket = getBucket();
  const tempFilePath = path.join(os.tmpdir(), `ocr-upload-${Date.now()}-${randomUUID()}-${path.basename(fileName || "document.pdf")}`);
  await fs.promises.writeFile(tempFilePath, buffer);

  const safeName = path.basename(fileName || "document.pdf");
  const objectName = `ocr-temp/${Date.now()}-${randomUUID()}-${safeName}`;
  const file = bucket.file(objectName);

  try {
    await bucket.upload(tempFilePath, {
      destination: objectName,
      resumable: false,
      contentType: "application/pdf",
    });
  } finally {
    if (fs.existsSync(tempFilePath)) {
      await fs.promises.unlink(tempFilePath).catch(() => undefined);
    }
  }

  return toGcsUri(objectName);
}

async function readVisionOutputFromGcsPrefix(prefix: string): Promise<string> {
  const bucket = getBucket();
  const [files] = await bucket.getFiles({ prefix });
  const textParts: string[] = [];

  for (const file of files) {
    const [contents] = await file.download();
    const payload = JSON.parse(contents.toString("utf8"));
    const responses = Array.isArray(payload.responses) ? payload.responses : [];

    for (const response of responses) {
      const text =
        response.fullTextAnnotation?.text ||
        response.textAnnotations?.[0]?.description ||
        "";

      if (text.trim()) {
        textParts.push(text.trim());
      }
    }

    await file.delete({ ignoreNotFound: true } as any).catch(() => undefined);
  }

  return textParts.join("\n\n").trim();
}

export async function extractPdfTextFromBuffer(
  buffer: Buffer,
  fileName = "document.pdf"
): Promise<string> {
  const inputGcsUri = await uploadPdfBufferToGcs(buffer, fileName);
  const outputPrefix = `vision-output/${Date.now()}-${randomUUID()}`;
  const outputGcsUri = toGcsUri(`${outputPrefix}/`);

  try {
    const [operation] = await (client as any).asyncBatchAnnotateFiles({
      requests: [
        {
          inputConfig: {
            mimeType: "application/pdf",
            gcsSource: {
              uri: inputGcsUri,
            },
          },
          features: [
            {
              type: "DOCUMENT_TEXT_DETECTION",
            },
          ],
          outputConfig: {
            gcsDestination: {
              uri: outputGcsUri,
            },
            batchSize: 1,
          },
        },
      ],
    });

    await operation.promise();
    return await readVisionOutputFromGcsPrefix(`${outputPrefix}/`);
  } finally {
    await deleteGcsObject(inputGcsUri).catch(() => undefined);
  }
}

export async function extractText(buffer: Buffer): Promise<string> {
  const [result] = await client.documentTextDetection({
    image: { content: buffer },
  });

  return result.fullTextAnnotation?.text || "";
}