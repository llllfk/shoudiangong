import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { env } from "@/lib/env";

let client: S3Client | null = null;

function storageUrl(): string | undefined {
  return env("STORAGE_URL", "COZE_STORAGE_URL");
}
function storageBucket(): string | undefined {
  return env("STORAGE_BUCKET", "COZE_STORAGE_BUCKET");
}
function storageAk(): string | undefined {
  return env("STORAGE_AK", "COZE_STORAGE_AK");
}
function storageSk(): string | undefined {
  return env("STORAGE_SK", "COZE_STORAGE_SK");
}

export function isStorageConfigured(): boolean {
  return Boolean(
    storageUrl() && storageBucket() && storageAk() && storageSk(),
  );
}

function getClient(): S3Client {
  if (!isStorageConfigured()) {
    throw new Error("未配置对象存储环境变量（STORAGE_URL/BUCKET/AK/SK）");
  }
  if (!client) {
    client = new S3Client({
      endpoint: storageUrl(),
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: storageAk() || "",
        secretAccessKey: storageSk() || "",
      },
    });
  }
  return client;
}

export function getBucket(): string {
  return storageBucket() || "";
}

/** 永久标识：s3://bucket/key —— 入库存 URI，按需换临时 URL */
export function toObjectUri(key: string): string {
  return `s3://${getBucket()}/${key}`;
}

export function parseObjectUri(uri: string): { bucket: string; key: string } | null {
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!m) return null;
  return { bucket: m[1], key: m[2] };
}

export async function uploadImageObject(
  body: Buffer | Uint8Array,
  options?: { contentType?: string; filename?: string },
): Promise<{ uri: string; key: string }> {
  const ext = guessExt(options?.filename, options?.contentType);
  const key = `pantograph/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${ext}`;
  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: body,
      ContentType: options?.contentType || "application/octet-stream",
    }),
  );
  return { uri: toObjectUri(key), key };
}

/** 临时可读 URL（默认 7 天，上限按平台约束） */
export async function getPresignedGetUrl(
  uriOrKey: string,
  expiresInSec = 7 * 24 * 3600,
): Promise<string> {
  let bucket = getBucket();
  let key = uriOrKey;
  const parsed = parseObjectUri(uriOrKey);
  if (parsed) {
    bucket = parsed.bucket;
    key = parsed.key;
  }
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: expiresInSec },
  );
}

function guessExt(filename?: string, contentType?: string): string {
  if (filename) {
    const i = filename.lastIndexOf(".");
    if (i >= 0) return filename.slice(i).toLowerCase();
  }
  if (contentType === "image/png") return ".png";
  if (contentType === "image/webp") return ".webp";
  if (contentType === "image/gif") return ".gif";
  return ".jpg";
}
