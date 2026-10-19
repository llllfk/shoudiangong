/**
 * 流式对话进度（进程内）。
 * 供前端短轮询，规避网关缓冲 SSE 导致思考过程无法边生成边展示。
 */

export type ChatProgressStatus = "running" | "done" | "error";

export type ChatProgress = {
  conversationId: string;
  chatId: string;
  reasoning: string;
  answer: string;
  status: ChatProgressStatus;
  error?: string;
  updatedAt: number;
};

const store = new Map<string, ChatProgress>();
const TTL_MS = 30 * 60 * 1000;

function keyOf(conversationId: string, chatId: string): string {
  return `${conversationId}:${chatId}`;
}

function gc(now = Date.now()) {
  for (const [key, item] of store) {
    if (now - item.updatedAt > TTL_MS) store.delete(key);
  }
}

export function initChatProgress(
  conversationId: string,
  chatId: string,
): ChatProgress {
  gc();
  const item: ChatProgress = {
    conversationId,
    chatId,
    reasoning: "",
    answer: "",
    status: "running",
    updatedAt: Date.now(),
  };
  store.set(keyOf(conversationId, chatId), item);
  return item;
}

export function patchChatProgress(
  conversationId: string,
  chatId: string,
  patch: Partial<
    Pick<ChatProgress, "reasoning" | "answer" | "status" | "error">
  >,
): ChatProgress | null {
  const key = keyOf(conversationId, chatId);
  const prev = store.get(key);
  if (!prev) return null;
  const next: ChatProgress = {
    ...prev,
    ...patch,
    updatedAt: Date.now(),
  };
  store.set(key, next);
  return next;
}

export function getChatProgress(
  conversationId: string,
  chatId: string,
): ChatProgress | null {
  gc();
  return store.get(keyOf(conversationId, chatId)) || null;
}

export function appendChatReasoning(
  conversationId: string,
  chatId: string,
  delta: string,
): void {
  if (!delta) return;
  const prev = getChatProgress(conversationId, chatId);
  if (!prev || prev.status !== "running") return;
  patchChatProgress(conversationId, chatId, {
    reasoning: prev.reasoning + delta,
  });
}

export function appendChatAnswer(
  conversationId: string,
  chatId: string,
  delta: string,
): void {
  if (!delta) return;
  const prev = getChatProgress(conversationId, chatId);
  if (!prev || prev.status !== "running") return;
  patchChatProgress(conversationId, chatId, {
    answer: prev.answer + delta,
  });
}
