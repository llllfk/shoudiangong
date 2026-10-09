export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** @deprecated 使用 imagePreviewUrls */
  imagePreviewUrl?: string;
  imagePreviewUrls?: string[];
  createdAt: number;
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
