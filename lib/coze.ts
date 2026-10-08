/**
 * 扣子 OpenAPI 对话调用层（服务端专用）。
 * PAT 仅通过环境变量注入，禁止写入前端。
 */

const API_BASE = "https://api.coze.cn";
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_SEC = 120;

export class CozeApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: number | string,
  ) {
    super(message);
    this.name = "CozeApiError";
  }
}

function getPat(): string {
  const pat = process.env.COZE_PAT?.trim();
  if (!pat) {
    throw new CozeApiError("未配置 COZE_PAT，请在环境变量中注入个人访问令牌");
  }
  return pat;
}

function getBotId(): string {
  const botId = process.env.COZE_BOT_ID?.trim();
  if (!botId) {
    throw new CozeApiError("未配置 COZE_BOT_ID，请在环境变量中注入智能体 ID");
  }
  return botId;
}

export function getUserId(): string {
  return process.env.COZE_USER_ID?.trim() || "competition_user_01";
}

function authHeaders(json = true): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getPat()}`,
  };
  if (json) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

/** 兼容 `{ data }` 包裹与顶层扁平两种响应形态 */
function unwrapData<T extends Record<string, unknown>>(json: unknown): T {
  if (!json || typeof json !== "object") {
    throw new CozeApiError("接口返回格式异常");
  }
  const obj = json as Record<string, unknown>;
  if (typeof obj.code === "number" && obj.code !== 0) {
    const msg =
      typeof obj.msg === "string" && obj.msg
        ? obj.msg
        : typeof obj.message === "string" && obj.message
          ? obj.message
          : `接口错误 code=${obj.code}`;
    throw new CozeApiError(msg, undefined, obj.code);
  }
  if (obj.data && typeof obj.data === "object") {
    return obj.data as T;
  }
  return obj as T;
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new CozeApiError(
      `接口返回非 JSON（HTTP ${res.status}）`,
      res.status,
    );
  }
}

export interface ChatRoundResult {
  conversationId: string;
  answer: string;
}

export async function sendChat(options: {
  text?: string;
  imageUrl?: string;
  fileId?: string;
  conversationId?: string;
}): Promise<ChatRoundResult> {
  const { text, imageUrl, fileId, conversationId } = options;
  const hasImage = Boolean(imageUrl || fileId);

  if (!text?.trim() && !hasImage) {
    throw new CozeApiError("请提供文本或图片");
  }

  let message: Record<string, string>;

  if (hasImage) {
    const parts: Array<Record<string, string>> = [
      { type: "text", text: text?.trim() || "检测这个部件" },
    ];
    if (fileId) {
      parts.push({ type: "image", file_id: fileId });
    } else if (imageUrl) {
      parts.push({ type: "image", file_url: imageUrl });
    }
    message = {
      role: "user",
      content_type: "object_string",
      content: JSON.stringify(parts),
    };
  } else {
    message = {
      role: "user",
      content: text!.trim(),
      content_type: "text",
    };
  }

  const body = {
    bot_id: getBotId(),
    user_id: getUserId(),
    stream: false,
    auto_save_history: true,
    additional_messages: [message],
  };

  let url = `${API_BASE}/v3/chat`;
  if (conversationId) {
    url += `?conversation_id=${encodeURIComponent(conversationId)}`;
  }

  const createRes = await fetch(url, {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify(body),
  });
  const createJson = await parseJson(createRes);
  if (!createRes.ok) {
    const err = createJson as { msg?: string; message?: string; code?: number };
    throw new CozeApiError(
      err.msg || err.message || `发起对话失败（HTTP ${createRes.status}）`,
      createRes.status,
      err.code,
    );
  }

  const created = unwrapData<{ id?: string; conversation_id?: string }>(
    createJson,
  );
  const chatId = created.id;
  const convId = created.conversation_id;
  if (!chatId || !convId) {
    throw new CozeApiError("发起对话成功但缺少 chat_id / conversation_id");
  }

  let status = "created";
  for (let i = 0; i < POLL_TIMEOUT_SEC; i++) {
    await sleep(POLL_INTERVAL_MS);
    const retrieveRes = await fetch(
      `${API_BASE}/v3/chat/retrieve?conversation_id=${encodeURIComponent(convId)}&chat_id=${encodeURIComponent(chatId)}`,
      { headers: authHeaders(false) },
    );
    const retrieveJson = await parseJson(retrieveRes);
    if (!retrieveRes.ok) {
      throw new CozeApiError(
        `查询对话状态失败（HTTP ${retrieveRes.status}）`,
        retrieveRes.status,
      );
    }
    const detail = unwrapData<{ status?: string }>(retrieveJson);
    status = detail.status || "unknown";
    if (
      status === "completed" ||
      status === "failed" ||
      status === "canceled" ||
      status === "required_action"
    ) {
      break;
    }
  }

  if (status !== "completed") {
    throw new CozeApiError(
      status === "created" || status === "in_progress"
        ? "对话超时，请重试本轮"
        : `对话未正常完成: ${status}`,
    );
  }

  const listRes = await fetch(
    `${API_BASE}/v3/chat/message/list?conversation_id=${encodeURIComponent(convId)}&chat_id=${encodeURIComponent(chatId)}`,
    { headers: authHeaders(false) },
  );
  const listJson = await parseJson(listRes);
  if (!listRes.ok) {
    throw new CozeApiError(
      `获取对话消息失败（HTTP ${listRes.status}）`,
      listRes.status,
    );
  }

  const listPayload = listJson as { data?: unknown; code?: number };
  let messages: Array<{ type?: string; content?: string }> = [];
  if (Array.isArray(listPayload.data)) {
    messages = listPayload.data as Array<{ type?: string; content?: string }>;
  } else if (
    listPayload.data &&
    typeof listPayload.data === "object" &&
    Array.isArray((listPayload.data as { data?: unknown }).data)
  ) {
    messages = (listPayload.data as { data: typeof messages }).data;
  } else if (Array.isArray(listJson)) {
    messages = listJson as typeof messages;
  }

  const answer = messages
    .filter((m) => m?.type === "answer" && typeof m.content === "string")
    .map((m) => m.content as string)
    .join("");

  if (!answer) {
    throw new CozeApiError("对话已完成但未取得回复内容");
  }

  return { conversationId: convId, answer };
}

export async function uploadFile(file: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append("file", file, filename);

  const res = await fetch(`${API_BASE}/v1/files/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getPat()}`,
    },
    body: form,
  });
  const json = await parseJson(res);
  if (!res.ok) {
    const err = json as { msg?: string; message?: string; code?: number };
    throw new CozeApiError(
      err.msg || err.message || `上传文件失败（HTTP ${res.status}）`,
      res.status,
      err.code,
    );
  }
  const data = unwrapData<{ id?: string; file_id?: string }>(json);
  const fileId = data.id || data.file_id;
  if (!fileId) {
    throw new CozeApiError("上传成功但未返回 file_id");
  }
  return fileId;
}

export function isCozeConfigured(): boolean {
  return Boolean(process.env.COZE_PAT?.trim() && process.env.COZE_BOT_ID?.trim());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
