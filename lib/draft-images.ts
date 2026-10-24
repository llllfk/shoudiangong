import { query } from "@/lib/db";

export type DraftImageRecord = {
  id: string;
  fileId: string;
  imageUri?: string;
  imageUrl?: string;
  filename?: string;
  createdAt: string;
};

type DraftRow = {
  id: string;
  file_id: string;
  image_uri: string | null;
  image_url: string | null;
  filename: string | null;
  created_at: Date | string;
};

function mapRow(row: DraftRow): DraftImageRecord {
  return {
    id: String(row.id),
    fileId: row.file_id,
    imageUri: row.image_uri || undefined,
    imageUrl: row.image_url || undefined,
    filename: row.filename || undefined,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

export async function listDraftImages(
  userId: string,
): Promise<DraftImageRecord[]> {
  const { rows } = await query<DraftRow>(
    `SELECT id::text AS id, file_id, image_uri, image_url, filename, created_at
     FROM draft_images
     WHERE user_id = $1
     ORDER BY created_at ASC, id ASC`,
    [userId],
  );
  return rows.map(mapRow);
}

export async function addDraftImage(params: {
  userId: string;
  fileId: string;
  imageUri?: string;
  imageUrl?: string;
  filename?: string;
}): Promise<DraftImageRecord> {
  const { rows } = await query<DraftRow>(
    `INSERT INTO draft_images (user_id, file_id, image_uri, image_url, filename)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id::text AS id, file_id, image_uri, image_url, filename, created_at`,
    [
      params.userId,
      params.fileId,
      params.imageUri || null,
      params.imageUrl || null,
      params.filename || null,
    ],
  );
  return mapRow(rows[0]);
}

export async function countDraftImages(userId: string): Promise<number> {
  const { rows } = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM draft_images WHERE user_id = $1`,
    [userId],
  );
  return Number(rows[0]?.n || 0);
}

export async function deleteDraftImage(
  userId: string,
  id: string,
): Promise<boolean> {
  const { rowCount } = await query(
    `DELETE FROM draft_images WHERE user_id = $1 AND id = $2`,
    [userId, id],
  );
  return (rowCount ?? 0) > 0;
}

export async function clearDraftImages(userId: string): Promise<number> {
  const { rowCount } = await query(
    `DELETE FROM draft_images WHERE user_id = $1`,
    [userId],
  );
  return rowCount ?? 0;
}

/** 后台补写对象存储地址（S3 延后上传完成后调用） */
export async function updateDraftImageStorage(params: {
  userId: string;
  id: string;
  imageUri: string;
  imageUrl?: string;
}): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE draft_images
     SET image_uri = $3, image_url = $4
     WHERE user_id = $1 AND id = $2`,
    [
      params.userId,
      params.id,
      params.imageUri,
      params.imageUrl || null,
    ],
  );
  return (rowCount ?? 0) > 0;
}
