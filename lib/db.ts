import { Pool, type QueryResultRow } from "pg";

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function normalizeDatabaseUrl(raw: string): string {
  // node-pg 对 channel_binding=require 支持不稳定，保留 sslmode 即可
  try {
    const u = new URL(raw);
    u.searchParams.delete("channel_binding");
    if (!u.searchParams.has("sslmode")) {
      u.searchParams.set("sslmode", "require");
    }
    // 与 libpq 语义对齐，避免 pg 对 sslmode=require 的弃用告警
    if (!u.searchParams.has("uselibpqcompat")) {
      u.searchParams.set("uselibpqcompat", "true");
    }
    return u.toString();
  } catch {
    return raw.replace(/([?&])channel_binding=[^&]*/g, "").replace(/\?&/, "?");
  }
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getPool(): Pool {
  if (!isDatabaseConfigured()) {
    throw new Error("未配置 DATABASE_URL");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: normalizeDatabaseUrl(process.env.DATABASE_URL!.trim()),
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  await ensureSchema();
  return getPool().query<T>(text, params);
}

export async function ensureSchema(): Promise<void> {
  if (!isDatabaseConfigured()) return;
  if (!schemaReady) {
    schemaReady = (async () => {
      const p = getPool();
      await p.query(`
        CREATE TABLE IF NOT EXISTS conversations (
          id BIGSERIAL PRIMARY KEY,
          conversation_id VARCHAR(128) NOT NULL UNIQUE,
          user_id VARCHAR(100) NOT NULL DEFAULT 'competition_user_01',
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS messages (
          id BIGSERIAL PRIMARY KEY,
          conversation_id VARCHAR(128) NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
          role VARCHAR(20) NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          image_uri TEXT,
          image_url TEXT,
          coze_file_id VARCHAR(128),
          coze_chat_id VARCHAR(128),
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        ALTER TABLE messages ADD COLUMN IF NOT EXISTS coze_chat_id VARCHAR(128);

        CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
          ON messages (conversation_id, created_at);

        CREATE INDEX IF NOT EXISTS idx_conversations_user_updated
          ON conversations (user_id, updated_at DESC);
      `);
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}
