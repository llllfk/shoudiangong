export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  imagePreviewUrl?: string;
  createdAt: number;
}

export interface ChatRequestBody {
  text?: string;
  imageUrl?: string;
  fileId?: string;
  imageUri?: string;
  conversationId?: string;
}

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
