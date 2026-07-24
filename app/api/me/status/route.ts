import { NextResponse } from "next/server";
import {
  authErrorCode,
  authErrorStatus,
  requireMember,
} from "@/lib/firebase/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  let user;
  try {
    ({ profile: user } = await requireMember(req));
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(error) },
      { status: authErrorStatus(error) },
    );
  }

  return NextResponse.json({
    ok: true,
    status: user.status,
    cooperativeName: user.cooperativeName ?? user.manualCooperativeName ?? null,
  });
}
