import { NextResponse } from "next/server";
import { searchSignupCooperatives } from "@/lib/cooperatives/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!query) {
    return NextResponse.json({ ok: true, results: [] });
  }

  const results = await searchSignupCooperatives(query, 10);
  return NextResponse.json(
    { ok: true, results },
    {
      headers: {
        "cache-control": "private, no-store",
      },
    },
  );
}
