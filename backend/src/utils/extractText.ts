import fs from "fs";
import axios from "axios";
import path from "path";
import { extractPdfTextFromBuffer, extractText } from "./ocr";

type MulterFile = {
  path: string;
  originalname: string;
  filename?: string;
};

type MulterFilesInput =
  | MulterFile
  | MulterFile[]
  | Record<string, MulterFile[]>
  | undefined;

export type ExtractTextInput = {
  files?: MulterFilesInput;
  fileUrl?: string;
  cleanupLocalFiles?: boolean;
};

function isMulterFile(value: MulterFilesInput): value is MulterFile {
  return (
    !!value &&
    !Array.isArray(value) &&
    typeof value === "object" &&
    typeof (value as MulterFile).path === "string" &&
    typeof (value as MulterFile).originalname === "string"
  );
}

function normalizeMulterFiles(files: MulterFilesInput): MulterFile[] {
  if (!files) {
    return [];
  }

  if (Array.isArray(files)) {
    return files;
  }

  if (isMulterFile(files)) {
    return [files];
  }

  return Object.values(files).flat();
}

async function extractTextFromOneMulterFile(
  file: MulterFile,
  cleanupLocalFiles: boolean
): Promise<string> {
  try {
    const buffer = await fs.promises.readFile(file.path);
    if (path.extname(file.originalname).toLowerCase() === ".pdf") {
      return await extractPdfTextFromBuffer(buffer, file.originalname);
    }

    return await extractText(buffer);
  } finally {
    if (cleanupLocalFiles && file.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  }
}

/**
 * Accepts either a direct file URL or req.file/req.files shaped input and
 * returns extracted text.
 */
export async function extractTextFromFilesOrUrl(
  input: ExtractTextInput
): Promise<string> {
  const cleanupLocalFiles = input.cleanupLocalFiles ?? true;

  if (input.fileUrl) {
    const response = await axios.get<ArrayBuffer>(input.fileUrl, {
      responseType: "arraybuffer",
    });
    const buffer = Buffer.from(response.data);
    const contentType = (response.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    const urlPath = new URL(input.fileUrl).pathname;
    const looksLikePdf = contentType === "application/pdf" || path.extname(urlPath).toLowerCase() === ".pdf";

    if (looksLikePdf) {
      return await extractPdfTextFromBuffer(buffer, path.basename(urlPath) || "document.pdf");
    }

    return await extractText(buffer);
  }

  const files = normalizeMulterFiles(input.files);
  if (files.length === 0) {
    throw new Error("No files or fileUrl provided for text extraction.");
  }

  const extractedTextParts = await Promise.all(
    files.map((file) => extractTextFromOneMulterFile(file, cleanupLocalFiles))
  );

  return extractedTextParts.filter(Boolean).join("\n\n");
}
