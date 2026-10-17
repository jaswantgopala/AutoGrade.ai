// import fs from "fs";
// import path from "path";
// import os from "os";
// import axios from "axios";
import { Stream } from "stream";
// import { randomUUID } from "crypto";
// import { uploadToS3 } from "../utils/s3";

// type UploadedFile = {
//   path: string;
//   filename: string;
// };

// function buildUniqueFileName(originalName: string): string {
//   const parsed = path.parse(originalName);
//   const safeBaseName = (parsed.name || "file").replace(/[^a-zA-Z0-9-_]/g, "_");
//   const extension = parsed.ext || "";
//   return `${safeBaseName}-${Date.now()}-${randomUUID()}${extension}`;
// }

// const DOWNLOAD_TIMEOUT_MS = Number(process.env.FILE_DOWNLOAD_TIMEOUT_MS || 120000);
// const MAX_DOWNLOAD_ATTEMPTS = Number(process.env.FILE_DOWNLOAD_MAX_ATTEMPTS || 5);

// async function downloadWithFetch(url: string, destinationPath: string): Promise<void> {
//   const controller = new AbortController();
//   const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
//   try {
//     const response = await fetch(url, {
//       signal: controller.signal,
//       headers: {
//         Accept: "*/*",
//         "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
//       },
//     });

//     if (!response.ok) {
//       throw new Error(`Fetch failed with status ${response.status}`);
//     }

//     const buffer = Buffer.from(await response.arrayBuffer());
//     await fs.promises.writeFile(destinationPath, buffer);
//   } finally {
//     clearTimeout(timer);
//   }
// }

// async function downloadToPathWithRetry(url: string, destinationPath: string): Promise<void> {
//   let lastError: unknown = null;

//   for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt += 1) {
//     try {
//       const response = await axios({
//         url,
//         method: "GET",
//         responseType: "stream",
//         timeout: DOWNLOAD_TIMEOUT_MS,
//         headers: {
//           Accept: "*/*",
//           "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
//           Connection: "close",
//         },
//         maxRedirects: 8,
//       } as any);

//       const writer = fs.createWriteStream(destinationPath);
//       await new Promise<void>((resolve, reject) => {
//         (response.data as Stream).pipe(writer);
//         writer.on("finish", () => resolve());
//         writer.on("error", reject);
//       });
//       return;
//     } catch (error) {
//       lastError = error;
//       try {
//         await downloadWithFetch(url, destinationPath);
//         return;
//       } catch (fallbackError) {
//         lastError = fallbackError;
//       }

//       if (attempt < MAX_DOWNLOAD_ATTEMPTS) {
//         await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
//       }
//     }
//   }

//   const message =
//     lastError instanceof Error ? lastError.message : "Unknown download failure";
//   throw new Error(
//     `Failed to download file after ${MAX_DOWNLOAD_ATTEMPTS} attempts (timeout ${DOWNLOAD_TIMEOUT_MS}ms): ${message}`
//   );
// }

// export async function uploadToS3Universal(
//   input: UploadedFile | string
// ): Promise<string> {
//   let filePath: string;
//   let originalFileName: string;
//   if (typeof input === "string") {
//     originalFileName =
//       path.basename(input.split("?")[0]) || `file-${Date.now()}`;
//     filePath = path.join(os.tmpdir(), originalFileName);
//     await downloadToPathWithRetry(input, filePath);
//   }
//   else {
//     filePath = input.path;
//     originalFileName = input.filename;
//   }

//   const uniqueFileName = buildUniqueFileName(originalFileName);

//   try {
//     const url = await uploadToS3(filePath, uniqueFileName);
//     return url;
//   } finally {
//     if (fs.existsSync(filePath)) {
//       fs.unlinkSync(filePath);
//     }
//   }
// }


import fs from "fs";
import path from "path";
import os from "os";
import axios from "axios";
import { uploadToGCS } from "../utils/gcs";
import { extractTextFromFilesOrUrl } from "../utils/extractText";

type UploadInputFile = {
  path: string;
  filename: string;
};

/**
 * Supports:
 * - Multer file
 * - URL
 */
export async function uploadToGCSUniversal(
  input: UploadInputFile | string
): Promise<string> {
  let filePath: string;
  let fileName: string;

  // ✅ URL case
  if (typeof input === "string") {
    fileName =
      path.basename(input.split("?")[0]) || `file-${Date.now()}`;
    filePath = path.join(os.tmpdir(), fileName);

    try {
      const response = await axios({
        url: input,
        method: "GET",
        responseType: "stream",
        timeout: 120000,
        maxRedirects: 8,
        headers: {
          Accept: "application/pdf,*/*",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Connection: "close",
        },
      });

      const writer = fs.createWriteStream(filePath);

      await new Promise((resolve, reject) => {
        (response.data as Stream).pipe(writer);
        writer.on("finish", resolve);
        writer.on("error", reject);
      });
    } catch (error) {
      const status = axios.isAxiosError?.(error) || (error as any).isAxiosError ? (error as any).response?.status : undefined;
      const message = error instanceof Error ? error.message : "Unknown error";

      throw new Error(
        status
          ? `Failed to download file URL (status ${status}). The source may block automated requests. Use a direct-download URL or local file path.`
          : `Failed to download file URL: ${message}`
      );
    }
  } 
  // ✅ Multer case
  else {
    filePath = input.path;
    fileName = input.filename;
  }

  try {
    const url = await uploadToGCS(filePath, fileName);
    return url;
  } finally {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

export async function uploadToGCSAndExtractTextUniversal(
  input: UploadInputFile | string
): Promise<{ url: string; text: string }> {
  const url = await uploadToGCSUniversal(input);
  const text = await extractTextFromFilesOrUrl({
    fileUrl: url,
    cleanupLocalFiles: false,
  });

  return { url, text };
}