import { NextResponse } from "next/server";
import { isCozeConfigured } from "@/lib/coze";
import { isDatabaseConfigured } from "@/lib/db";
import { isStorageConfigured } from "@/lib/storage";

/** 前端仅探测能力开关，不回传任何密钥 */
export async function GET() {
  return NextResponse.json({
    data: {
      configured: isCozeConfigured(),
      database: isDatabaseConfigured(),
      storage: isStorageConfigured(),
    },
  });
}
