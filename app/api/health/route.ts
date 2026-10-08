import { NextResponse } from "next/server";
import { isCozeConfigured } from "@/lib/coze";

export async function GET() {
  return NextResponse.json({
    data: {
      ok: true,
      configured: isCozeConfigured(),
    },
  });
}
