import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Firestore } from "firebase-admin/firestore";
import { MemoryFirestore } from "@/lib/audit-quote/testing/memory-firestore";
import {
  PHONE_OTP_PURPOSE_AUDIT_QUOTE,
  issuePhoneOtpProofToken,
  verifyPhoneOtpProofToken,
} from "@/lib/phone-verification/otp";
import { verifyAuditQuotePhoneVerificationToken } from "@/lib/audit-quote/phone-token";
import {
  confirmPhoneOtpChallenge,
  sendPhoneOtpChallenge,
} from "@/lib/phone-verification/service";

const pepper = "test-phone-otp-pepper";

describe("phone otp proof token", () => {
  it("accepts a token issued for the same phone and purpose", () => {
    const token = issuePhoneOtpProofToken({
      purpose: PHONE_OTP_PURPOSE_AUDIT_QUOTE,
      phone: "010-6387-7780",
      pepper,
      nowMs: 1_000,
    });
    assert.match(token, /^pv1\./);
    assert.deepEqual(
      verifyPhoneOtpProofToken({
        token,
        phone: "01063877780",
        purpose: PHONE_OTP_PURPOSE_AUDIT_QUOTE,
        pepper,
        nowMs: 2_000,
      }),
      { ok: true },
    );
  });

  it("rejects a token for a different phone or an expired token", () => {
    const token = issuePhoneOtpProofToken({
      purpose: PHONE_OTP_PURPOSE_AUDIT_QUOTE,
      phone: "010-1111-2222",
      pepper,
      nowMs: 1_000,
      ttlMs: 1_000,
    });
    assert.equal(
      verifyPhoneOtpProofToken({
        token,
        phone: "010-3333-4444",
        purpose: PHONE_OTP_PURPOSE_AUDIT_QUOTE,
        pepper,
        nowMs: 1_000,
      }).ok,
      false,
    );
    assert.deepEqual(
      verifyPhoneOtpProofToken({
        token,
        phone: "010-1111-2222",
        purpose: PHONE_OTP_PURPOSE_AUDIT_QUOTE,
        pepper,
        nowMs: 3_000,
      }),
      { ok: false, error: "phone_verification_expired" },
    );
  });
});

describe("audit quote phone verification tokens", () => {
  it("accepts a solapi proof token or a matching firebase id token", async () => {
    const token = issuePhoneOtpProofToken({
      purpose: PHONE_OTP_PURPOSE_AUDIT_QUOTE,
      phone: "010-6387-7780",
      pepper,
      nowMs: 1_000,
    });
    assert.deepEqual(
      await verifyAuditQuotePhoneVerificationToken({
        token,
        phone: "01063877780",
        pepper,
        nowMs: 2_000,
        verifyFirebaseIdToken: async () => {
          throw new Error("unused");
        },
      }),
      { ok: true },
    );

    assert.deepEqual(
      await verifyAuditQuotePhoneVerificationToken({
        token: "firebase-id-token",
        phone: "010-6387-7780",
        pepper,
        nowMs: 10_000,
        verifyFirebaseIdToken: async () => ({
          phone_number: "+821063877780",
          auth_time: 5,
        }),
      }),
      { ok: true },
    );
  });

  it("rejects a missing, mismatched, or expired firebase id token", async () => {
    assert.deepEqual(
      await verifyAuditQuotePhoneVerificationToken({
        token: "  ",
        phone: "010-6387-7780",
        pepper,
        verifyFirebaseIdToken: async () => {
          throw new Error("unused");
        },
      }),
      { ok: false, error: "missing_phone_verification", status: 400 },
    );
    assert.deepEqual(
      await verifyAuditQuotePhoneVerificationToken({
        token: "firebase-id-token",
        phone: "010-6387-7780",
        pepper,
        nowMs: 10_000,
        verifyFirebaseIdToken: async () => ({
          phone_number: "+821011111111",
          auth_time: 5,
        }),
      }),
      { ok: false, error: "invalid_phone_verification", status: 400 },
    );
    assert.deepEqual(
      await verifyAuditQuotePhoneVerificationToken({
        token: "firebase-id-token",
        phone: "010-6387-7780",
        pepper,
        nowMs: 700_000,
        verifyFirebaseIdToken: async () => ({
          phone_number: "+821063877780",
          auth_time: 1,
        }),
      }),
      { ok: false, error: "phone_verification_expired", status: 400 },
    );
  });
});

describe("phone otp send and confirm", () => {
  it("sends a code without recaptcha and issues a proof token on confirm", async () => {
    const db = new MemoryFirestore();
    let capturedText = "";
    const sent = await sendPhoneOtpChallenge({
      db: db as unknown as Firestore,
      phone: "010-6387-7780",
      purpose: PHONE_OTP_PURPOSE_AUDIT_QUOTE,
      ipHash: "ip-1",
      pepper,
      nowMs: 10_000,
      sendSms: async (input) => {
        capturedText = input.text;
        return { ok: true, provider: "solapi", id: "g1" };
      },
    });
    assert.equal(sent.ok, true);
    const code = capturedText.match(/(\d{6})$/u)?.[1];
    assert.equal(typeof code, "string");
    assert.match(capturedText, /^\[농협지원센터\] 인증번호 /);
    const confirmed = await confirmPhoneOtpChallenge({
      db: db as unknown as Firestore,
      phone: "01063877780",
      purpose: PHONE_OTP_PURPOSE_AUDIT_QUOTE,
      code: code!,
      pepper,
      nowMs: 11_000,
    });
    assert.equal(confirmed.ok, true);
    if (confirmed.ok) {
      assert.deepEqual(
        verifyPhoneOtpProofToken({
          token: confirmed.token,
          phone: "010-6387-7780",
          purpose: PHONE_OTP_PURPOSE_AUDIT_QUOTE,
          pepper,
          nowMs: 12_000,
        }),
        { ok: true },
      );
    }
  });

  it("rejects a wrong code and does not issue a token", async () => {
    const db = new MemoryFirestore();
    await sendPhoneOtpChallenge({
      db: db as unknown as Firestore,
      phone: "010-1234-5678",
      purpose: PHONE_OTP_PURPOSE_AUDIT_QUOTE,
      ipHash: "ip-2",
      pepper,
      nowMs: 10_000,
      sendSms: async () => ({ ok: true, provider: "solapi", id: "g2" }),
    });
    const confirmed = await confirmPhoneOtpChallenge({
      db: db as unknown as Firestore,
      phone: "010-1234-5678",
      purpose: PHONE_OTP_PURPOSE_AUDIT_QUOTE,
      code: "000000",
      pepper,
      nowMs: 11_000,
    });
    assert.deepEqual(confirmed, {
      ok: false,
      error: "invalid_phone_verification",
      status: 400,
    });
  });

  it("issues a local code when SMS is not configured outside production", async () => {
    const db = new MemoryFirestore();
    const sent = await sendPhoneOtpChallenge({
      db: db as unknown as Firestore,
      phone: "010-6387-7780",
      purpose: PHONE_OTP_PURPOSE_AUDIT_QUOTE,
      ipHash: "ip-3",
      pepper,
      nowMs: 10_000,
      allowLocalDelivery: true,
      sendSms: async () => ({
        ok: false,
        skipped: true,
        error: "sms_not_configured",
      }),
    });
    assert.equal(sent.ok, true);
    if (!sent.ok || !sent.localCode) {
      throw new Error("expected localCode");
    }
    const confirmed = await confirmPhoneOtpChallenge({
      db: db as unknown as Firestore,
      phone: "010-6387-7780",
      purpose: PHONE_OTP_PURPOSE_AUDIT_QUOTE,
      code: sent.localCode,
      pepper,
      nowMs: 11_000,
    });
    assert.equal(confirmed.ok, true);
  });

  it("does not issue a local code when SMS is missing in production", async () => {
    const db = new MemoryFirestore();
    const sent = await sendPhoneOtpChallenge({
      db: db as unknown as Firestore,
      phone: "010-6387-7780",
      purpose: PHONE_OTP_PURPOSE_AUDIT_QUOTE,
      ipHash: "ip-4",
      pepper,
      nowMs: 10_000,
      allowLocalDelivery: false,
      sendSms: async () => ({
        ok: false,
        skipped: true,
        error: "sms_not_configured",
      }),
    });
    assert.deepEqual(sent, {
      ok: false,
      error: "sms_not_configured",
      status: 503,
    });
  });
});

describe("audit quote phone verification client", () => {
  it("tries Solapi first and falls back to Firebase phone auth", () => {
    const source = readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../../components/AuditQuoteEventPage.tsx",
      ),
      "utf8",
    );
    assert.match(source, /\/api\/phone-verification\/send/);
    assert.match(source, /sms_not_configured/);
    assert.match(source, /PhoneAuthProvider/);
    assert.match(source, /localCode/);
    assert.match(source, /findExactCooperativeMatch/);
    assert.match(source, /resolveSelectedCooperative/);
  });
});
