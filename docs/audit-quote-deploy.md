# FY27 Audit Quote Intake — Deploy Notes

## Environment variables

Add to Vercel / `.env.local` (values never committed):

| Name | Required | Description |
|---|---|---|
| `AUDIT_QUOTE_EVENT_ENABLED` | yes in each env (default `false`) | Feature flag to enable/disable intake API |
| `AUDIT_QUOTE_HASH_PEPPER` | **yes** | HMAC secret (≥16 chars) for `emailHash` / idempotency hashes |
| `AUDIT_QUOTE_PRIVACY_POLICY_VERSION` | no | Must match client `privacyPolicyVersion` (default `2026-07-20`) |
| `AUDIT_QUOTE_ALLOWED_ORIGINS` | no | Comma-separated browser origins |
| `AUDIT_QUOTE_ALLOWED_CAMPAIGNS` | no | Comma-separated campaign allowlist |
| `AUDIT_QUOTE_ALLOWED_CHANNELS` | no | Comma-separated channel allowlist |
| `AUDIT_QUOTE_MAX_BODY_BYTES` | no | Default `8192` |
| `AUDIT_QUOTE_CAPTCHA_ENABLED` | no | Boundary flag only (default `false`) |
| `AUDIT_QUOTE_APP_CHECK_ENABLED` | no | Boundary flag only (default `false`) |
| `AUDIT_QUOTE_ENDS_AT` | no | ISO timestamp; past value disables the event page/API intake |
| `AUDIT_QUOTE_SHOW_POINTS_BENEFIT` | no | Show Q&A points section (default `false`) |
| `AUDIT_QUOTE_POINTS_BASE_LABEL` | no | Required with points flag (e.g. `계약 감사보수`) |
| `AUDIT_QUOTE_GUARANTEE_MIN_QUOTES` | no | If `false`, UI avoids “최소 2건 보장” wording |
| `AUDIT_QUOTE_RETENTION_COPY` | no | Retention disclosure text; empty → “개인정보처리방침에 따름” |
| `AUDIT_QUOTE_PRIVACY_POLICY_HREF` | no | Default `/signup` (existing site policy entry) |

Existing Firebase Admin vars remain required for the API route:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

## Firestore rules

Deploy `firestore.rules` so client SDKs cannot read/write:

- `auditQuoteRequests`
- `auditQuoteIdempotency`
- `auditQuoteEmailDedup`
- `auditQuoteRateLimits`

Admin SDK used by Next.js Route Handlers bypasses rules.

## Service account IAM (least privilege)

Use a dedicated Firebase/GCP service account for the Next.js server when possible.

Minimum practical roles for this feature:

1. **Cloud Datastore User** (or Firestore equivalent write access) — create/update documents in the audit-quote collections above
2. Do **not** grant broad Owner / Editor on the whole project for production if a narrower custom role is available
3. This intake path does **not** need Storage or Auth admin permissions

Rotate keys via Vercel env; never commit `*-firebase-adminsdk-*.json`.

## Rate limiting

No shared Redis/Upstash infrastructure exists in this repo. Intake uses **Firestore-backed** counters in `auditQuoteRateLimits` so limits work across multiple Vercel instances. An in-memory `Map` is intentionally not used as the sole limiter.

## Staff notification

Storage success is independent from staff notification.

| Name | Required | Description |
|---|---|---|
| `AUDIT_QUOTE_NOTIFY_WEBHOOK_URL` | no | Generic webhook (Slack incoming webhook compatible) |
| `AUDIT_QUOTE_NOTIFY_INCLUDE_EMAIL` | no | Include raw email in body only (default `false`) |
| `AUDIT_QUOTE_ADMIN_BASE_URL` | no | Link target shown in notification body |

Failures are stored in `auditQuoteNotifications` and can be retried from `/admin` → Audit quotes.

## Rollback

Set `AUDIT_QUOTE_EVENT_ENABLED=false` to stop new intake without redeploying code.
