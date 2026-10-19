export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** 模型深度思考内容（reasoning_content） */
  reasoning?: string;
  /** 本轮刚返回时先展开思考区，随后自动折叠 */
  reasoningAutoCollapse?: boolean;
  /** @deprecated 使用 imagePreviewUrls */
  imagePreviewUrl?: string;
  imagePreviewUrls?: string[];
  createdAt: number;
}

export interface ShortcutCommand {
  id: string;
  name: string;
  command?: string;
  description?: string;
  queryTemplate?: string;
  iconUrl?: string;
}

export interface ShortcutsResult {
  shortcuts: ShortcutCommand[];
  /** 智能体编排页配置的开场白 */
  prologue?: string;
}

export interface ChatRequestBody {
  text?: string;
  /** 单图（兼容） */
  imageUrl?: string;
  fileId?: string;
  imageUri?: string;
  /** 多图 */
  imageUrls?: string[];
  fileIds?: string[];
  imageUris?: string[];
  conversationId?: string;
  /** 点击智能体快捷指令时传入 */
  shortcutCommandId?: string;
}

export interface ChatStartResult {
  conversationId: string;
  chatId: string;
}

export interface ChatStatusResult {
  status: string;
  conversationId: string;
  chatId: string;
  answer?: string;
  reasoning?: string;
  error?: string;
}

/** 流式对话进度（短轮询） */
export interface ChatProgressResult {
  conversationId: string;
  chatId: string;
  status: "running" | "done" | "error";
  reasoning: string;
  answer: string;
  error?: string;
}

/** @deprecated 兼容旧命名；现由 start + status 替代 */
export interface ChatResult {
  conversationId: string;
  answer: string;
}

export interface UploadResult {
  fileId: string;
  imageUri?: string;
  imageUrl?: string;
}

export interface HistoryResult {
  conversationId: string | null;
  messages: Array<{
    id: string;
    role: ChatRole;
    content: string;
    reasoning?: string | null;
    imageUrl?: string | null;
    imageUrls?: string[];
    createdAt: string;
  }>;
}

export interface ConversationItem {
  conversationId: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export interface ConversationsResult {
  conversations: ConversationItem[];
}

export interface ApiSuccess<T> {
  data: T;
}

export interface ApiError {
  error: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
