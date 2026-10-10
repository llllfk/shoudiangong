/**
 * 扣子 workload identity 令牌（平台系统变量自动注入，无第三方包依赖）。
 * 流程与官方 @coze/workload-identity 对齐：client_credentials → token-exchange。
 */

type CachedToken = { token: string; expireAt: number };

let cache: CachedToken | null = null;
let inflight: Promise<string> | null = null;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`缺少平台系统变量 ${name}`);
  }
  return value;
}

async function requestToken(
  endpoint: string,
  body: URLSearchParams,
): Promise<Record<string, unknown>> {
  const lane = process.env.COZE_SERVER_ENV?.trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (lane && lane !== "NONE") {
    headers["x-tt-env"] = lane;
    headers["x-use-ppe"] = "1";
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.error === "string") {
    const msg =
      (typeof json.error_description === "string" && json.error_description) ||
      (typeof json.error === "string" && json.error) ||
      `令牌请求失败（HTTP ${res.status}）`;
    throw new Error(msg);
  }
  return json;
}

async function fetchAccessToken(): Promise<string> {
  const clientId = requiredEnv("COZE_WORKLOAD_IDENTITY_CLIENT_ID");
  const clientSecret = requiredEnv("COZE_WORKLOAD_IDENTITY_CLIENT_SECRET");
  const tokenEndpoint = requiredEnv("COZE_WORKLOAD_IDENTITY_TOKEN_ENDPOINT");
  const accessTokenEndpoint = requiredEnv(
    "COZE_WORKLOAD_ACCESS_TOKEN_ENDPOINT",
  );

  const idJson = await requestToken(
    tokenEndpoint,
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  );
  const idToken = idJson.access_token;
  if (typeof idToken !== "string" || !idToken) {
    throw new Error("未拿到 identity token");
  }

  const accessJson = await requestToken(
    accessTokenEndpoint,
    new URLSearchParams({
      client_id: clientId,
      subject_token: idToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    }),
  );
  const accessToken = accessJson.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("未拿到 access token");
  }

  const expiresIn =
    typeof accessJson.expires_in === "number" ? accessJson.expires_in : 3600;
  cache = {
    token: accessToken,
    expireAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
  };
  return accessToken;
}

/** 供对象存储请求注入 x-storage-token */
export async function getCozeAccessToken(): Promise<string> {
  const direct = process.env.COZE_WORKLOAD_IDENTITY_TOKEN?.trim();
  if (direct) return direct;

  if (cache && Date.now() < cache.expireAt) {
    return cache.token;
  }
  if (!inflight) {
    inflight = fetchAccessToken().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

export function isCozeIdentityConfigured(): boolean {
  return Boolean(
    process.env.COZE_WORKLOAD_IDENTITY_TOKEN?.trim() ||
      (process.env.COZE_WORKLOAD_IDENTITY_CLIENT_ID?.trim() &&
        process.env.COZE_WORKLOAD_IDENTITY_CLIENT_SECRET?.trim() &&
        process.env.COZE_WORKLOAD_IDENTITY_TOKEN_ENDPOINT?.trim() &&
        process.env.COZE_WORKLOAD_ACCESS_TOKEN_ENDPOINT?.trim()),
  );
}
