/**
 * 扣子 OpenAPI 对话调用层（服务端专用）。
 * PAT 仅通过环境变量注入，禁止写入前端。
 */

import { env } from "@/lib/env";

const API_BASE = "https://api.coze.cn";

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
  const pat = env("BOT_PAT", "COZE_PAT");
  if (!pat) {
    throw new CozeApiError("未配置 BOT_PAT，请在环境变量中注入个人访问令牌");
  }
  return pat;
}

function getBotId(): string {
  const botId = env("BOT_ID", "COZE_BOT_ID");
  if (!botId) {
    throw new CozeApiError("未配置 BOT_ID，请在环境变量中注入智能体 ID");
  }
  return botId;
}

export function getUserId(): string {
  return env("BOT_USER_ID", "COZE_USER_ID") || "competition_user_01";
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

function buildUserMessage(options: {
  text?: string;
  imageUrl?: string;
  imageUrls?: string[];
  fileId?: string;
  fileIds?: string[];
}): Record<string, string> {
  const { text, imageUrl, imageUrls, fileId, fileIds } = options;
  const ids = [
    ...(fileIds || []).filter(Boolean),
    ...(fileId && !(fileIds || []).includes(fileId) ? [fileId] : []),
  ];
  const urls = [
    ...(imageUrls || []).filter(Boolean),
    ...(imageUrl && !(imageUrls || []).includes(imageUrl) ? [imageUrl] : []),
  ];
  const hasImage = ids.length > 0 || urls.length > 0;

  if (hasImage) {
    const parts: Array<Record<string, string>> = [
      { type: "text", text: text?.trim() || "检测这个部件" },
    ];
    if (ids.length > 0) {
      for (const id of ids) {
        parts.push({ type: "image", file_id: id });
      }
    } else {
      for (const url of urls) {
        parts.push({ type: "image", file_url: url });
      }
    }
    return {
      role: "user",
      content_type: "object_string",
      content: JSON.stringify(parts),
    };
  }

  return {
    role: "user",
    content: (text || "").trim(),
    content_type: "text",
  };
}

export interface ChatStartResult {
  conversationId: string;
  chatId: string;
}

export interface ShortcutCommandInfo {
  id: string;
  name: string;
  command?: string;
  description?: string;
  queryTemplate?: string;
  iconUrl?: string;
}

export interface PublishedBotConfig {
  shortcuts: ShortcutCommandInfo[];
  /** 智能体编排页配置的开场白 */
  prologue: string;
}

function parsePrologue(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const info = raw as Record<string, unknown>;
  const prologue =
    typeof info.prologue === "string" ? info.prologue.trim() : "";
  if (!prologue) return "";
  // API 场景需自行替换开场白中的 {{user_name}}
  return prologue.replaceAll("{{user_name}}", getUserId());
}

function parseShortcutCommands(
  list: Array<Record<string, unknown>> | undefined,
): ShortcutCommandInfo[] {
  if (!Array.isArray(list)) return [];
  const parsed: ShortcutCommandInfo[] = [];
  for (const item of list) {
    const rawId = item.id ?? item.command_id;
    const id =
      typeof rawId === "string"
        ? rawId.trim()
        : typeof rawId === "number"
          ? String(rawId)
          : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!id || !name) continue;
    parsed.push({
      id,
      name,
      command:
        typeof item.command === "string" ? item.command.trim() : undefined,
      description:
        typeof item.description === "string"
          ? item.description.trim()
          : undefined,
      queryTemplate:
        typeof item.query_template === "string"
          ? item.query_template.trim()
          : undefined,
      iconUrl:
        typeof item.icon_url === "string" ? item.icon_url.trim() : undefined,
    });
  }
  return parsed;
}

/** 从已发布配置补拉开场白（/v1/bots 未带时的兜底） */
async function fetchOnlinePrologue(): Promise<string> {
  const botId = getBotId();
  const url = `${API_BASE}/v1/bot/get_online_info?bot_id=${encodeURIComponent(botId)}`;
  const res = await fetch(url, { headers: authHeaders(false) });
  const json = await parseJson(res);
  if (!res.ok) return "";
  try {
    const data = unwrapData<{ onboarding_info?: unknown }>(json);
    return parsePrologue(data.onboarding_info);
  } catch {
    return "";
  }
}

/** 查看已发布智能体配置（快捷指令 + 开场白） */
export async function getPublishedBotConfig(): Promise<PublishedBotConfig> {
  const botId = getBotId();
  const res = await fetch(`${API_BASE}/v1/bots/${encodeURIComponent(botId)}`, {
    headers: authHeaders(false),
  });
  const json = await parseJson(res);
  if (!res.ok) {
    const err = json as { msg?: string; message?: string; code?: number };
    throw new CozeApiError(
      err.msg || err.message || `获取智能体配置失败（HTTP ${res.status}）`,
      res.status,
      err.code,
    );
  }

  const data = unwrapData<{
    shortcut_commands?: Array<Record<string, unknown>>;
    onboarding_info?: unknown;
  }>(json);

  const shortcuts = parseShortcutCommands(data.shortcut_commands);
  let prologue = parsePrologue(data.onboarding_info);
  if (!prologue) {
    prologue = await fetchOnlinePrologue();
  }

  return { shortcuts, prologue };
}

/** 查看已发布智能体配置中的快捷指令 */
export async function listShortcutCommands(): Promise<ShortcutCommandInfo[]> {
  const { shortcuts } = await getPublishedBotConfig();
  return shortcuts;
}

export type ChatCreateOptions = {
  text?: string;
  imageUrl?: string;
  imageUrls?: string[];
  fileId?: string;
  fileIds?: string[];
  conversationId?: string;
  shortcutCommandId?: string;
};

function buildChatRequest(
  options: ChatCreateOptions,
  stream: boolean,
): { url: string; body: Record<string, unknown> } {
  const {
    text,
    imageUrl,
    imageUrls,
    fileId,
    fileIds,
    conversationId,
    shortcutCommandId,
  } = options;
  const hasImage =
    Boolean(imageUrl || fileId) ||
    Boolean(fileIds?.length) ||
    Boolean(imageUrls?.length);
  const hasShortcut = Boolean(shortcutCommandId?.trim());

  if (!text?.trim() && !hasImage && !hasShortcut) {
    throw new CozeApiError("请提供文本、图片或快捷指令");
  }

  const body: Record<string, unknown> = {
    bot_id: getBotId(),
    user_id: getUserId(),
    stream,
    auto_save_history: true,
  };

  if (hasShortcut) {
    body.shortcut_command = { command_id: shortcutCommandId!.trim() };
    // 快捷指令由平台生成用户输入；若同时有图/文则一并附上
    if (text?.trim() || hasImage) {
      body.additional_messages = [buildUserMessage(options)];
    } else {
      body.additional_messages = [];
    }
  } else {
    body.additional_messages = [buildUserMessage(options)];
  }

  let url = `${API_BASE}/v3/chat`;
  if (conversationId) {
    url += `?conversation_id=${encodeURIComponent(conversationId)}`;
  }
  return { url, body };
}

/** 仅发起对话，立即返回 id，由前端短轮询取结果（避免长连接被网关掐断） */
export async function createChat(
  options: ChatCreateOptions,
): Promise<ChatStartResult> {
  const { url, body } = buildChatRequest(options, false);

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

  return { conversationId: convId, chatId };
}

/** 发起流式对话（用于实时拿到 reasoning_content） */
export async function createChatStreamResponse(
  options: ChatCreateOptions,
  signal?: AbortSignal,
): Promise<Response> {
  const { url, body } = buildChatRequest(options, true);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...authHeaders(true),
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const errJson = await parseJson(res);
    const err = errJson as { msg?: string; message?: string; code?: number };
    throw new CozeApiError(
      err.msg || err.message || `发起流式对话失败（HTTP ${res.status}）`,
      res.status,
      err.code,
    );
  }
  if (!res.body) {
    throw new CozeApiError("流式对话未返回内容");
  }
  return res;
}

export type CozeStreamPiece =
  | { kind: "meta"; conversationId: string; chatId: string }
  | { kind: "reasoning_delta"; text: string }
  | { kind: "answer_delta"; text: string }
  | { kind: "done"; conversationId: string; chatId: string }
  | { kind: "error"; message: string };

/** 解析扣子 SSE，抽出思维链与回复增量 */
export async function* iterateCozeChatStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<CozeStreamPiece> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let conversationId = "";
  let chatId = "";
  let metaSent = false;

  const emitMeta = function* (): Generator<CozeStreamPiece> {
    if (!metaSent && conversationId && chatId) {
      metaSent = true;
      yield { kind: "meta", conversationId, chatId };
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        let eventName = "";
        const dataLines: string[] = [];
        for (const line of rawEvent.split("\n")) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }
        const dataStr = dataLines.join("\n");
        if (!dataStr || dataStr === "[DONE]") {
          if (conversationId && chatId) {
            yield* emitMeta();
            yield { kind: "done", conversationId, chatId };
          }
          continue;
        }

        let data: Record<string, unknown>;
        try {
          data = JSON.parse(dataStr) as Record<string, unknown>;
        } catch {
          continue;
        }

        const conv =
          typeof data.conversation_id === "string" ? data.conversation_id : "";
        const id = typeof data.id === "string" ? data.id : "";
        const msgChatId =
          typeof data.chat_id === "string" ? data.chat_id : "";

        if (
          eventName === "conversation.chat.created" ||
          eventName === "conversation.chat.in_progress"
        ) {
          if (conv) conversationId = conv;
          if (id) chatId = id;
          yield* emitMeta();
          continue;
        }

        if (
          eventName === "conversation.chat.failed" ||
          eventName === "error"
        ) {
          const lastError = data.last_error as
            | { msg?: string; message?: string }
            | undefined;
          yield {
            kind: "error",
            message:
              lastError?.msg ||
              lastError?.message ||
              (typeof data.msg === "string" ? data.msg : "") ||
              "流式对话失败",
          };
          continue;
        }

        if (
          eventName === "conversation.message.delta" ||
          eventName === "conversation.message.completed"
        ) {
          if (conv) conversationId = conv;
          if (msgChatId) chatId = msgChatId;
          yield* emitMeta();

          const msgType = typeof data.type === "string" ? data.type : "";
          const reasoning =
            typeof data.reasoning_content === "string"
              ? data.reasoning_content
              : typeof data.reasoningContent === "string"
                ? data.reasoningContent
                : "";
          const content =
            typeof data.content === "string" ? data.content : "";

          // delta 事件给增量；completed 可能是全文，避免重复追加
          if (eventName === "conversation.message.delta") {
            if (reasoning) {
              yield { kind: "reasoning_delta", text: reasoning };
            }
            if (msgType === "answer" && content) {
              yield { kind: "answer_delta", text: content };
            }
          }
          continue;
        }

        if (eventName === "conversation.chat.completed") {
          if (conv) conversationId = conv;
          if (id) chatId = id;
          yield* emitMeta();
          yield { kind: "done", conversationId, chatId };
        }
      }
    }

    if (conversationId && chatId) {
      yield* emitMeta();
      yield { kind: "done", conversationId, chatId };
    }
  } finally {
    reader.releaseLock();
  }
}

/** 取消进行中的对话（需 PAT 具备 cancelChat 权限） */
export async function cancelChat(
  conversationId: string,
  chatId: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/v3/chat/cancel`, {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify({
      conversation_id: conversationId,
      chat_id: chatId,
    }),
  });
  const json = await parseJson(res);
  if (!res.ok) {
    const err = json as { msg?: string; message?: string; code?: number };
    // 4104：当前状态不可取消（已完成等），对前端可视为已结束
    if (err.code === 4104) return;
    throw new CozeApiError(
      err.msg || err.message || `取消对话失败（HTTP ${res.status}）`,
      res.status,
      err.code,
    );
  }
}

export type ChatStatusValue =
  | "created"
  | "in_progress"
  | "completed"
  | "failed"
  | "canceled"
  | "required_action"
  | "unknown";

export async function retrieveChatStatus(
  conversationId: string,
  chatId: string,
): Promise<ChatStatusValue> {
  const retrieveRes = await fetch(
    `${API_BASE}/v3/chat/retrieve?conversation_id=${encodeURIComponent(conversationId)}&chat_id=${encodeURIComponent(chatId)}`,
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
  return (detail.status as ChatStatusValue) || "unknown";
}

export interface ChatAnswerResult {
  answer: string;
  /** 深度思考思维链；模型未开启或未返回时为空 */
  reasoning: string;
}

export async function listChatAnswer(
  conversationId: string,
  chatId: string,
): Promise<ChatAnswerResult> {
  const listRes = await fetch(
    `${API_BASE}/v3/chat/message/list?conversation_id=${encodeURIComponent(conversationId)}&chat_id=${encodeURIComponent(chatId)}`,
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
  let messages: Array<{
    type?: string;
    content?: string;
    reasoning_content?: string;
    reasoningContent?: string;
  }> = [];
  if (Array.isArray(listPayload.data)) {
    messages = listPayload.data as typeof messages;
  } else if (
    listPayload.data &&
    typeof listPayload.data === "object" &&
    Array.isArray((listPayload.data as { data?: unknown }).data)
  ) {
    messages = (listPayload.data as { data: typeof messages }).data;
  } else if (Array.isArray(listJson)) {
    messages = listJson as typeof messages;
  }

  const answerParts: string[] = [];
  const reasoningParts: string[] = [];
  for (const m of messages) {
    const reasoningRaw =
      (typeof m.reasoning_content === "string" && m.reasoning_content) ||
      (typeof m.reasoningContent === "string" && m.reasoningContent) ||
      "";
    if (reasoningRaw.trim()) {
      reasoningParts.push(reasoningRaw.trim());
    }
    if (m?.type !== "answer") continue;
    if (typeof m.content === "string" && m.content) {
      answerParts.push(m.content);
    }
  }

  const answer = answerParts.join("");
  if (!answer) {
    throw new CozeApiError("对话已完成但未取得回复内容");
  }
  return {
    answer,
    reasoning: reasoningParts.join("\n\n"),
  };
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

/** 默认豆包「知性女声」，可用 BOT_VOICE_ID 覆盖 */
export function getVoiceId(): string {
  return (
    env("BOT_VOICE_ID", "TTS_VOICE_ID") || "7468512265134899251"
  );
}

/**
 * 调用扣子语音合成（豆包音色）。
 * input 单次 UTF-8 最长 1024 字节，调用方需自行分片。
 */
export async function synthesizeSpeech(text: string): Promise<{
  audio: ArrayBuffer;
  contentType: string;
}> {
  const input = text.trim();
  if (!input) {
    throw new CozeApiError("朗读文本为空");
  }

  const res = await fetch(`${API_BASE}/v1/audio/speech`, {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify({
      input,
      voice_id: getVoiceId(),
      response_format: "mp3",
      speed: 1,
      sample_rate: 24000,
    }),
  });

  const contentType = res.headers.get("content-type") || "";
  if (!res.ok) {
    let message = `语音合成失败（HTTP ${res.status}）`;
    try {
      const json = (await res.json()) as {
        msg?: string;
        message?: string;
        code?: number;
      };
      message = json.msg || json.message || message;
      throw new CozeApiError(message, res.status, json.code);
    } catch (err) {
      if (err instanceof CozeApiError) throw err;
      throw new CozeApiError(message, res.status);
    }
  }

  // 成功时直接返回音频二进制；若误返回 JSON 则按错误处理
  if (contentType.includes("application/json")) {
    const json = (await res.json()) as {
      msg?: string;
      message?: string;
      code?: number;
    };
    throw new CozeApiError(
      json.msg || json.message || "语音合成返回异常",
      res.status,
      json.code,
    );
  }

  return {
    audio: await res.arrayBuffer(),
    contentType: contentType.includes("audio")
      ? contentType
      : "audio/mpeg",
  };
}

export function isCozeConfigured(): boolean {
  return Boolean(env("BOT_PAT", "COZE_PAT") && env("BOT_ID", "COZE_BOT_ID"));
}
