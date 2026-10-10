/**
 * 扣子编程对象存储（平台系统变量自动注入，无需写入自定义 .env）：
 * - COZE_BUCKET_ENDPOINT_URL
 * - COZE_BUCKET_NAME
 * 鉴权：workload identity → 请求头 x-storage-token（无需 AK/SK）。
 */

import {
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import {
  getCozeAccessToken,
  isCozeIdentityConfigured,
} from "@/lib/coze-identity";

let client: S3Client | null = null;
let clientEndpoint: string | null = null;

function bucketEndpoint(): string | undefined {
  return process.env.COZE_BUCKET_ENDPOINT_URL?.trim();
}

function bucketName(): string | undefined {
  return process.env.COZE_BUCKET_NAME?.trim();
}

/** 平台是否具备对象存储能力（系统变量占位，运行时由平台注入） */
export function isStorageConfigured(): boolean {
  return Boolean(
    (bucketEndpoint() && bucketName()) || isCozeIdentityConfigured(),
  );
}

function requireEndpoint(): string {
  const endpoint = bucketEndpoint();
  if (!endpoint) {
    throw new Error("未配置存储端点：请确认平台已注入 COZE_BUCKET_ENDPOINT_URL");
  }
  return endpoint.replace(/\/$/, "");
}

function requireBucket(): string {
  const bucket = bucketName();
  if (!bucket) {
    throw new Error("未配置存储桶：请确认平台已注入 COZE_BUCKET_NAME");
  }
  return bucket;
}

function getClient(endpoint: string): S3Client {
  if (client && clientEndpoint === endpoint) return client;

  client = new S3Client({
    endpoint,
    region: "cn-beijing",
    forcePathStyle: true,
    credentials: {
      accessKeyId: "coze",
      secretAccessKey: "coze",
    },
  });
  clientEndpoint = endpoint;

  client.middlewareStack.add(
    (next) => async (args) => {
      const token = await getCozeAccessToken();
      const request = args.request as { headers?: Record<string, string> };
      if (request.headers) {
        request.headers["x-storage-token"] = token;
      }
      return next(args);
    },
    {
      step: "finalizeRequest",
      name: "cozeStorageToken",
      priority: "high",
    },
  );

  return client;
}

/** 永久标识：s3://bucket/key —— 入库存 URI，按需换临时 URL */
export function toObjectUri(bucket: string, key: string): string {
  return `s3://${bucket}/${key}`;
}

export function parseObjectUri(
  uri: string,
): { bucket: string; key: string } | null {
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!m) return null;
  return { bucket: m[1], key: m[2] };
}

export async function uploadImageObject(
  body: Buffer | Uint8Array,
  options?: { contentType?: string; filename?: string },
): Promise<{ uri: string; key: string }> {
  const endpoint = requireEndpoint();
  const bucket = requireBucket();
  const ext = guessExt(options?.filename, options?.contentType);
  const key = `pantograph/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${ext}`;

  const input: PutObjectCommandInput = {
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: options?.contentType || "application/octet-stream",
  };

  await getClient(endpoint).send(new PutObjectCommand(input));
  return { uri: toObjectUri(bucket, key), key };
}

/**
 * 临时可读 URL：走扣子 S3 Proxy `/sign-url`（非 AWS SigV4）。
 * 有效期默认 7 天，平台上限约 30 天。
 */
export async function getPresignedGetUrl(
  uriOrKey: string,
  expiresInSec = 7 * 24 * 3600,
): Promise<string> {
  const endpoint = requireEndpoint();
  const defaultBucket = requireBucket();
  let bucket = defaultBucket;
  let key = uriOrKey;
  const parsed = parseObjectUri(uriOrKey);
  if (parsed) {
    bucket = parsed.bucket;
    key = parsed.key;
  }

  const token = await getCozeAccessToken();
  const res = await fetch(`${endpoint}/sign-url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-storage-token": token,
    },
    body: JSON.stringify({
      bucket_name: bucket,
      path: key,
      expire_time: expiresInSec,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    data?: { url?: string; signed_url?: string; presigned_url?: string };
    url?: string;
    signed_url?: string;
    presigned_url?: string;
    msg?: string;
    message?: string;
  };

  if (!res.ok) {
    throw new Error(
      json.msg || json.message || `生成临时链接失败（HTTP ${res.status}）`,
    );
  }

  const url =
    json.data?.url ||
    json.data?.signed_url ||
    json.data?.presigned_url ||
    json.url ||
    json.signed_url ||
    json.presigned_url;

  if (!url) {
    throw new Error("生成临时链接成功但未返回 URL");
  }
  return url;
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
