import { NextResponse } from "next/server";
import {
  authErrorCode,
  authErrorStatus,
  getAdminSession,
} from "@/lib/firebase/server";
import { getAdminRole } from "@/lib/admin/rbac";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { decoded, profile, capabilities } = await getAdminSession(req);
    return NextResponse.json({
      ok: true,
      admin: {
        uid: decoded.uid,
        email: decoded.email,
        role: profile ? getAdminRole(profile) : "super_admin",
        capabilities,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }
}
