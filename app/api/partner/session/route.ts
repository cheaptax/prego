import { NextResponse } from "next/server";
import {
  authErrorCode,
  authErrorStatus,
  requirePartner,
} from "@/lib/firebase/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { decoded, profile, partner } = await requirePartner(req);
    const partnerId = profile?.partnerId ?? partner.id ?? "";
    return NextResponse.json({
      ok: true,
      user: {
        uid: decoded.uid,
        email: decoded.email,
        name: profile?.name,
        partnerId,
      },
      partner: {
        ...partner,
        id: partner.id || partnerId,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }
}
