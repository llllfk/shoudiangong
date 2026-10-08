import { query } from "@/lib/db";
import { getPresignedGetUrl, isStorageConfigured } from "@/lib/storage";

export interface StoredMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  imageUri?: string | null;
  imageUrl?: string | null;
  cozeFileId?: string | null;
  createdAt: string;
}

export async function ensureConversation(
  conversationId: string,
  userId: string,
): Promise<void> {
  await query(
    `INSERT INTO conversations (conversation_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (conversation_id) DO UPDATE
       SET updated_at = CURRENT_TIMESTAMP`,
    [conversationId, userId],
  );
}

export async function appendMessage(input: {
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  imageUri?: string | null;
  imageUrl?: string | null;
  cozeFileId?: string | null;
  cozeChatId?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO messages
      (conversation_id, role, content, image_uri, image_url, coze_file_id, coze_chat_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.conversationId,
      input.role,
      input.content,
      input.imageUri || null,
      input.imageUrl || null,
      input.cozeFileId || null,
      input.cozeChatId || null,
    ],
  );
  await query(
    `UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE conversation_id = $1`,
    [input.conversationId],
  );
}

export async function hasAssistantForChat(
  conversationId: string,
  chatId: string,
): Promise<boolean> {
  const result = await query<{ id: string }>(
    `SELECT id::text FROM messages
     WHERE conversation_id = $1 AND role = 'assistant' AND coze_chat_id = $2
     LIMIT 1`,
    [conversationId, chatId],
  );
  return result.rows.length > 0;
}

export async function getLatestConversationId(
  userId: string,
): Promise<string | null> {
  const result = await query<{ conversation_id: string }>(
    `SELECT conversation_id FROM conversations
     WHERE user_id = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId],
  );
  return result.rows[0]?.conversation_id || null;
}

export interface ConversationSummary {
  conversationId: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export async function listConversations(
  userId: string,
  limit = 50,
): Promise<ConversationSummary[]> {
  const result = await query<{
    conversation_id: string;
    updated_at: Date;
    title_preview: string | null;
    message_count: string;
  }>(
    `SELECT
       c.conversation_id,
       c.updated_at,
       (
         SELECT m.content FROM messages m
         WHERE m.conversation_id = c.conversation_id AND m.role = 'user'
         ORDER BY m.created_at ASC, m.id ASC
         LIMIT 1
       ) AS title_preview,
       (
         SELECT COUNT(*)::text FROM messages m
         WHERE m.conversation_id = c.conversation_id
       ) AS message_count
     FROM conversations c
     WHERE c.user_id = $1
     ORDER BY c.updated_at DESC
     LIMIT $2`,
    [userId, limit],
  );

  return result.rows.map((row) => ({
    conversationId: row.conversation_id,
    title: formatConversationTitle(row.title_preview),
    updatedAt: new Date(row.updated_at).toISOString(),
    messageCount: Number(row.message_count) || 0,
  }));
}

function formatConversationTitle(preview: string | null): string {
  const text = (preview || "").replace(/\s+/g, " ").trim();
  if (!text) return "未命名检修会话";
  return text.length > 28 ? `${text.slice(0, 28)}…` : text;
}

export async function listMessages(
  conversationId: string,
): Promise<StoredMessage[]> {
  const result = await query<{
    id: string;
    role: string;
    content: string;
    image_uri: string | null;
    image_url: string | null;
    coze_file_id: string | null;
    created_at: Date;
  }>(
    `SELECT id::text, role, content, image_uri, image_url, coze_file_id, created_at
     FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC, id ASC`,
    [conversationId],
  );

  const messages: StoredMessage[] = [];
  for (const row of result.rows) {
    let imageUrl = row.image_url;
    if (row.image_uri && isStorageConfigured()) {
      try {
        imageUrl = await getPresignedGetUrl(row.image_uri);
      } catch {
        // 保留库内旧 URL 兜底
      }
    }
    messages.push({
      id: row.id,
      role: row.role as StoredMessage["role"],
      content: row.content,
      imageUri: row.image_uri,
      imageUrl,
      cozeFileId: row.coze_file_id,
      createdAt: new Date(row.created_at).toISOString(),
    });
  }
  return messages;
}
