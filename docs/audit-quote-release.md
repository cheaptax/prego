# FY27 Audit Quote — Release, Monitoring, Rollback

Do **not** treat this document as approval to deploy. Human GO is required.

## Environment separation

| Env | Firebase project | App host | Intake flag default |
|---|---|---|---|
| dev | dedicated dev project | localhost / preview | `AUDIT_QUOTE_EVENT_ENABLED=true` only locally |
| staging | dedicated staging project | Vercel preview/staging | explicit `true` after smoke |
| prod | production project | production Vercel | explicit `true` only after approvals |

Never point staging app at production Firestore.

## Environment variable ownership

| Variable | Owner | Notes |
|---|---|---|
| `FIREBASE_*` Admin | Platform / security | Server only |
| `NEXT_PUBLIC_FIREBASE_*` | Platform | Public client config |
| `AUDIT_QUOTE_HASH_PEPPER` | Security | ≥32 random bytes, server only |
| `AUDIT_QUOTE_EVENT_ENABLED` | Product ops | Kill switch |
| `AUDIT_QUOTE_ENDS_AT` | Product ops | Optional hard stop |
| `AUDIT_QUOTE_ALLOWED_ORIGINS` | Platform | Exact origins |
| `AUDIT_QUOTE_NOTIFY_WEBHOOK_URL` | Ops | Generic webhook |
| `AUDIT_QUOTE_PRIVACY_POLICY_*` | Legal / privacy | Copy + version |

## HMAC pepper lifecycle

1. Generate: `openssl rand -base64 48`
2. Store only in Vercel/secret manager (never git)
3. Rotate: dual-read not supported in MVP — schedule maintenance window, set new pepper, accept that old emailHash values will not match new hashes (dedupe continuity breaks). Prefer rotate only between events.
4. On suspected leak: disable intake flag immediately, rotate pepper, invalidate webhook if needed.

## IAM minimum for Admin SDK (intake path)

Needed:
- Firestore create/update/get on `auditQuoteRequests`, `auditQuoteIdempotency`, `auditQuoteEmailDedup`, `auditQuoteRateLimits`, `auditQuoteNotifications`, `auditLogs`

Not needed for intake:
- Storage admin
- Auth user deletion
- Project Owner/Editor

Use a dedicated runtime service account when possible.

## Deploy order

1. Deploy Firestore Rules (deny-all for `auditQuote*`)
2. Confirm no client indexes required for admin list (current admin list uses full collection get + sort)
3. Deploy application (intake remains OFF unless flag true)
4. Configure webhook + origins + pepper
5. Staging smoke
6. Enable flag on staging → verify → disable or leave per plan
7. Production deploy with flag **false**
8. Production smoke of page closed state
9. Enable flag for launch window

## Staging / production smoke (no real customer PII)

Staging:
- Open `/events/audit-quote`
- Submit synthetic email `staging+aq@example.com` with consent
- Confirm 1 Firestore doc `status=received`
- Confirm webhook (or skipped) recorded in `auditQuoteNotifications`
- Confirm `/admin` Audit quotes list shows masked email; detail shows raw
- Replay same Idempotency-Key → still 1 doc

Production smoke (before public link):
- Flag false → closed message visible, API `event_disabled`
- Flag true briefly with synthetic address only
- Disable flag after smoke if launch is later

## Monitoring checklist

| Signal | Where |
|---|---|
| API success rate | Vercel logs / status codes for `/api/audit-quote/requests` |
| 4xx / 5xx ratio | same |
| rate_limited ratio | count `429` |
| Firestore write failures | `submit_failed` logs (code only) |
| submit_attempt vs success | analytics events (no PII) |
| open `received` count | Admin Audit quotes KPI |
| age of oldest received | Admin + manual review |
| notify failures | `auditQuoteNotifications.status=failed` + retry |
| >24h untreated | daily ops check |

## Rollback

1. Set `AUDIT_QUOTE_EVENT_ENABLED=false` (or past `ENDS_AT`) — target <10 minutes
2. If needed, rollback app deployment to previous Vercel version
3. **Do not delete** `auditQuoteRequests` data
4. Staff continue processing existing `received` via `/admin`
5. Rules rollback must keep `auditQuote*` deny-all; never roll back to a ruleset that opens these collections
6. Data deletion/migration requires separate written approval

## Retention deletion procedure (manual, approved)

1. Confirm retention policy + legal approval
2. Export audit trail ids if required
3. Delete or hard-anonymize due docs in `auditQuoteRequests` and related index/idempotency/notification docs
4. Record operator, time, count in ops log
5. No unattended production deletes in this release

## Human approvals before GO

- [ ] Legal entity processing personal data
- [ ] Purpose + retention period copy
- [ ] Privacy policy URL
- [ ] Third-party accounting firm disclosure/consent approach
- [ ] Non-official NH naming review
- [ ] “2 quotes” wording (guarantee vs request)
- [ ] First-reply / quote target SLA
- [ ] Q&A points terms (or keep hidden)
- [ ] On-call staff + access list
- [ ] Event start/end
- [ ] Firebase project confirmation (prod vs staging)
