# 감사인 견적 평가보고서 최종 감사

- 일시: 2026-07-21
- 관점: 독립 시니어 리뷰
- 코드 수정: 2026-07-22 긴급 배포 준비에서 Critical/High 최소 수정 완료

## 판정

**제한 공개 준비 완료, 전체 공개는 외부 AV/CDR 승인 전까지 보류**

| 심각도 | 건수 |
|---|---|
| Critical | 1 |
| High | 10 |
| Medium | 7 |

Critical/High 차단점은 코드와 테스트로 해소했습니다. 다만 현재 PDF 검사는
내장 static scan이므로 전체 공개 전 외부 AV/CDR 연동 또는 운영 승인 필요합니다.

## 검증 증거

| 검증 | 결과 | 핵심 관찰 |
|---|---|---|
| TypeScript | 통과 | `tsc --noEmit` |
| ESLint | 통과 | `eslint .` |
| 평가 테스트 | 통과 | 132 pass · 1 skipped (emulator 없는 기본 실행) |
| Rules emulator | 통과 | 6 pass · Firestore/Storage 실제 emulator, skip 0 |
| PDF visual | 통과 | 2개 35p · 5개 46p · 장문 61p, overflow/깨짐 0 |
| Production audit | 통과 | `npm audit --omit=dev --audit-level=high` exit 0 |
| 기존 견적 smoke | 수정 | 고정 sleep 제거, terminal UI state 대기 |

## 우선 수정계획

| 순서 | 조치 | 완료 조건 |
|---|---|---|
| P0-1 | snapshot·config 선택·관리자 인증 계약 수정 | Critical/High 재현 테스트 통과 |
| P0-2 | upload scan 및 matcher fail-closed | UNAVAILABLE/장애/악성 fixture 전부 차단 |
| P0-3 | 내구성 보고서 worker와 attempt별 artifact | PENDING·lease 경합 복구 테스트 통과 |
| P0-4 | retention 정책·orphan·download 경계 수정 | 조기삭제·영구잔존 없음 |
| P0-5 | 운영 dependency 보안 업데이트 | production audit high/critical 해소 |
| P1 | 실제 E2E·Rules CI·PDF 레이아웃·monitoring | skip 없는 필수 CI와 운영 검수 |

## 2026-07-22 해소 요약

- C-01: 보고서 요청 시 config 유효성 기준을 `confirmation.confirmedAt`으로 변경했습니다.
- H-01: `check-admin-ready`와 관리자 UI를 active admin profile 계약에 맞췄습니다.
- H-02: cross-config 기간 중복을 게시 오류로 차단하고 동일 config 이전 게시본은 ARCHIVED 처리합니다.
- H-03/H-06: attempt별 immutable report artifact 경로와 report sweeper cron을 추가했습니다.
- H-04/H-05: static PDF scan과 matcher fail-closed 게이트를 추가했습니다.
- H-07/H-09: 보고서 보존기간·다운로드 기간 검증, case 만료 연장, report snapshot retention 사용을 반영했습니다.
- H-08/M-03: quarantine path retention 포함과 안정적인 스캔 순서를 반영했습니다.
- H-10/M-04/M-07: audit high gate, 평가 Rules/E2E/PDF CI, 견적 smoke 개선을 반영했습니다.

---

## Critical

### C-01. 확정 스냅샷이 설정 만료 후 보고서를 만들지 못함

- **심각도:** Critical
- **정확한 위치:** `lib/audit-evaluation/review-repository.ts:907-910, 1383-1400`
- **재현 조건:** `effectiveTo` 이전에 고객 확인을 완료한 뒤 `effectiveTo` 이후 동일 `confirmationVersion`으로 보고서를 요청한다.
- **고객 또는 운영상 영향:** 고객이 유효한 설정으로 확정한 READY 건이 `config_not_effective`로 영구 중단되어 스냅샷 재현성과 보고서 생성 약속이 깨진다.
- **권장 수정:** 보고서 요청 시 설정 유효성은 `confirmedAt` 기준으로 검증하거나, 이미 저장된 PUBLISHED confirmation snapshot을 신뢰한다.
- **관련 테스트:** confirm → `effectiveTo` 경과 → `requestReport` 성공 및 동일 snapshot/score 유지 통합 테스트

---

## High

### H-01. 관리자 인증 계약 변경과 배포 전 점검이 불일치

- **심각도:** High
- **정확한 위치:** `lib/firebase/server.ts:29-43`; `firestore.rules:8-19`; `scripts/check-admin-ready.mjs:113-136`; `components/AdminDashboard.tsx:827-851`
- **재현 조건:** `admin:true` claim은 있으나 `users/{uid}` 문서가 없거나 `role/status`가 정확히 `admin/active`가 아닌 기존 계정으로 로그인한다.
- **고객 또는 운영상 영향:** 점검 스크립트는 READY를 반환할 수 있지만 기존 `/admin` API와 CMS Rules는 403이 되어 관리자 전체 업무가 중단될 수 있다.
- **권장 수정:** 운영 계정을 읽기 전용으로 먼저 검증하고 readiness 조건에 `role/status`를 포함한다. 전역 강화가 의도되지 않았다면 감사평가 전용 guard로 격리한다.
- **관련 테스트:** 기존 claim-only, missing-profile, rejected-profile 계정에 대한 로그인·메뉴·기존 API 회귀 테스트

### H-02. 복수 게시 설정이 남고 활성 설정 선택이 config ID를 무시

- **심각도:** High
- **정확한 위치:** `lib/audit-evaluation/admin-config-repository.ts:271-332`; `admin-config-validation.ts:254-268`; `customer-access-repository.ts:124-143`
- **재현 조건:** `config-a` v10과 `config-b` v3을 같은 기간에 게시하거나, 동일 config의 겹치는 버전을 경고 확인 후 게시한다.
- **고객 또는 운영상 영향:** 모두 PUBLISHED로 남으며 전역 version 숫자가 큰 설정이 선택되어 새 고객 건이 의도하지 않은 평가기준에 고정될 수 있다.
- **권장 수정:** 활성 config ID를 명시하고 동일 ID 내 겹침을 차단하거나 이전 버전을 같은 트랜잭션에서 ARCHIVED 처리한다.
- **관련 테스트:** 복수 ID·복수 버전·동시 게시 후 정확히 하나의 활성 설정만 선택되는 Firestore 통합 테스트

### H-03. after() 유실 시 PENDING 보고서가 복구되지 않음

- **심각도:** High
- **정확한 위치:** `app/api/audit-evaluations/[caseId]/reports/route.ts:91-105`; `components/AuditEvaluationReportWorkspace.tsx:59-84, 168-187`; `lib/audit-evaluation/admin-repository.ts:1137-1142`
- **재현 조건:** `REPORT_GENERATION_REQUESTED` 저장 직후 서버리스 인스턴스가 종료되어 `after()`가 실행되지 않게 한다.
- **고객 또는 운영상 영향:** `generationAttempt=0`인 PENDING이 무기한 폴링되고 고객 재시도 버튼과 관리자 재생성 모두 제공되지 않는다.
- **권장 수정:** PENDING/만료 lease를 회수하는 내구성 queue·sweeper를 추가하고 일정 시간 이후 고객·관리자 재시도를 허용한다.
- **관련 테스트:** `after()` 미실행, 오래된 PENDING 회수, 중복 worker 단일 claim 통합 테스트

### H-04. 보안 스캔 UNAVAILABLE 상태로 파싱·확정·다운로드 가능

- **심각도:** High
- **정확한 위치:** `lib/audit-evaluation/upload-service.ts:325-337, 392-411`; `parsing-service.ts:59-90`; `review-readiness.ts:100-115`; `app/api/audit-evaluations/[caseId]/upload-intents/[intentId]/finalize/route.ts:37-44`
- **재현 조건:** 구조적으로 유효하지만 악성 payload를 포함한 PDF를 올린다. 현재 문서는 `scanStatus=UNAVAILABLE`로 저장되고 즉시 파싱된다.
- **고객 또는 운영상 영향:** 악성 PDF가 private Storage에 보존되고 signed URL로 고객·관리자에게 전달될 수 있다.
- **권장 수정:** AV/CDR 결과가 CLEAN일 때만 promote·parse·download·confirmation을 허용하고 UNAVAILABLE은 명시적 차단 상태로 둔다.
- **관련 테스트:** EICAR/polyglot fixture와 scanner 장애 시 promote·parse·download·readiness 전부 차단 테스트

### H-05. 표준 견적 매처 장애가 검증 실패가 아니라 레거시 경로로 열림

- **심각도:** High
- **정확한 위치:** `lib/audit-evaluation/upload-service.ts:460-473, 560-569`
- **재현 조건:** 서명 secret 누락으로 기본 matcher 생성이 실패하거나 repository matcher가 예외를 던지게 한 뒤 식별 마커가 있는 문서를 업로드한다.
- **고객 또는 운영상 영향:** 신뢰 문서 검증 경계가 조용히 제거되고 변조 문서가 일반 파서·고객 확인 경로로 진행될 수 있다.
- **권장 수정:** 식별 마커가 있거나 matcher 구성이 필요한 경우 `MATCHING_FAILED`로 fail-closed하고 운영 health/preflight에서 secret을 강제한다.
- **관련 테스트:** matcher throw, secret 누락, repository timeout 시 문서 저장·파싱·확정 차단 테스트

### H-06. 보고서 lease 재시도 경합이 동일 Storage 경로를 덮어씀

- **심각도:** High
- **정확한 위치:** `lib/audit-evaluation/report-repository.ts:173-199`; `report-generation-service.ts:130-174`; `report-storage.ts:31-47`
- **재현 조건:** 첫 생성이 5분 lease를 넘긴 상태에서 두 번째 attempt를 claim하고 두 worker의 view-model/PDF 저장 순서를 교차시킨다.
- **고객 또는 운영상 영향:** Firestore는 최신 attempt만 완료 처리해도 오래된 worker가 같은 경로를 덮어 웹 JSON과 PDF가 서로 다른 attempt가 될 수 있다.
- **권장 수정:** attempt별 immutable 경로에 저장한 뒤 활성 attempt 검증과 함께 최종 pointer를 게시하고 stale artifact를 정리한다.
- **관련 테스트:** 두 생성 promise를 제어해 payload/PDF 저장 순서를 교차하는 concurrency 테스트

### H-07. 보존·다운로드·case 만료 정책 간 일관성 검증이 없음

- **심각도:** High
- **정확한 위치:** `lib/audit-evaluation/schemas.ts:331-339, 366-380`; `retention-service.ts:231-250`; `report-service.ts:207-229`; `customer-access-service.ts:310-325`
- **재현 조건:** `reportDays < customerDownloadDays`로 게시하거나 case 생성 29일 후 30일 다운로드 보고서를 생성한다.
- **고객 또는 운영상 영향:** 약속된 다운로드 기간 전에 보고서가 삭제되거나 case 만료로 인증이 차단된다.
- **권장 수정:** 게시 시 `reportDays ≥ customerDownloadDays`를 강제하고 case 접근 만료를 생성 보고서의 다운로드 종료일까지 연장하거나 완료 보고서 전용 read access를 둔다.
- **관련 테스트:** 보고서 생성 시점이 case 만료에 가까운 시나리오와 retention/download 경계 테스트

### H-08. 중단된 업로드의 quarantine 원문이 보존정책 밖에 남음

- **심각도:** High
- **정확한 위치:** `lib/audit-evaluation/upload-service.ts:205-218`; `retention-service.ts:210-228, 340-376`
- **재현 조건:** signed URL로 PDF를 quarantine에 업로드한 뒤 finalize를 호출하지 않고 retention 기간을 경과시킨다.
- **고객 또는 운영상 영향:** uploadIntent 문서는 삭제될 수 있어도 `quarantineStoragePath` 객체는 `storagePaths`에 포함되지 않아 민감한 견적서가 무기한 남는다.
- **권장 수정:** upload intent 보존 항목에 `quarantineStoragePath`를 포함하고 만료 intent 및 orphan prefix를 별도 sweep한다.
- **관련 테스트:** 미완료·만료 intent 실행 후 Firestore와 Storage 객체가 함께 삭제되는 retention 테스트

### H-09. 보존 작업이 최신 게시 설정 하나를 전체 과거 데이터에 적용

- **심각도:** High
- **정확한 위치:** `lib/audit-evaluation/retention-service.ts:168-177, 315-334`
- **재현 조건:** 미래 `effectiveFrom`과 짧은 보존기간을 가진 설정을 가장 최근에 게시한 뒤 cron을 실행한다.
- **고객 또는 운영상 영향:** 유효기간이 시작되지 않은 정책도 모든 과거 case/report에 적용되어 조기 삭제가 발생할 수 있다.
- **권장 수정:** case/report에 고정된 config snapshot 기준으로 정책을 계산하거나 별도의 단일 전역 보존정책에 명시적 승인 버전을 둔다.
- **관련 테스트:** 과거·현재·미래 설정이 섞인 데이터에서 각 record가 올바른 정책으로만 삭제되는 테스트

### H-10. 운영 의존성에 해결되지 않은 high/critical advisory 존재

- **심각도:** High
- **정확한 위치:** `package.json:30-41`; `package-lock.json`; `npm audit --omit=dev`
- **재현 조건:** 저장소 루트에서 `npm audit --omit=dev`를 실행한다.
- **고객 또는 운영상 영향:** 14건(critical 1, high 4 포함): Next.js DoS/우회/XSS 계열과 websocket-driver, grpc, protobuf 관련 알려진 취약점이 운영 트리에 남아 있다.
- **권장 수정:** force 업데이트가 아닌 호환 버전별 업그레이드 계획을 세우고 전체 회귀·Rules·PDF 검증 후 재감사한다.
- **관련 테스트:** CI production audit gate와 업그레이드 후 인증·업로드·PDF·기존 페이지 회귀 테스트

---

## Medium

### M-01. AI narrative가 근거 없는 정성 추천 문장을 통과시킬 수 있음

- **심각도:** Medium
- **정확한 위치:** `lib/audit-evaluation/report-narrative.ts:120-148`; `report-view-model.ts:547-565`; `components/AuditEvaluationReportWorkspace.tsx:269-280`
- **재현 조건:** 아무 fact를 인용하면서 숫자 없이 “A 회계법인을 우선 선임하는 것이 유리합니다”를 adapter가 반환한다.
- **고객 또는 운영상 영향:** fact ID와 숫자 검사는 통과하지만 LLM이 사실상 선임 방향에 영향을 주는 문장이 웹/PDF에 노출될 수 있다.
- **권장 수정:** AI 문장은 extractive template/허용 문장 schema로 제한하고 해결 전 AI 플래그를 계속 false로 유지한다.
- **관련 테스트:** 비숫자 추천·우열·확신 표현과 한국어 수사 주입 시 rule-based fallback 테스트

### M-02. 실제 만료 지표가 아닌 retention 삭제 건수를 만료로 집계

- **심각도:** Medium
- **정확한 위치:** `lib/audit-evaluation/monitoring-service.ts:203-208`; `customer-access-service.ts:209-232, 310-325`
- **재현 조건:** 만료 magic link를 사용한 뒤 지표를 조회하거나 source/report retention 삭제를 실행한다.
- **고객 또는 운영상 영향:** 전자는 `expiredCount`가 증가하지 않고 후자는 접근 만료가 아닌데도 증가해 운영 판단이 왜곡된다.
- **권장 수정:** `ACCESS_TOKEN_EXPIRED`, `SESSION_EXPIRED`, `CASE_ACCESS_EXPIRED`를 PII 없이 기록하고 종류별로 집계한다.
- **관련 테스트:** 각 만료 유형과 일반 retention 삭제를 분리해 집계하는 monitoring 테스트

### M-03. 보존 스캔이 collection당 첫 1,000건에 고정

- **심각도:** Medium
- **정확한 위치:** `lib/audit-evaluation/retention-service.ts:334-365`
- **재현 조건:** 첫 1,000건이 아직 보존 대상이 아니고 그 뒤에 오래된 대상이 있도록 1,001건 이상을 만든다.
- **고객 또는 운영상 영향:** 동일한 첫 페이지가 반복되어 뒤의 오래된 원문·토큰·로그가 영구히 정리되지 않을 수 있다.
- **권장 수정:** 시간 필드 `orderBy` + cursor pagination과 안정적인 batch checkpoint를 사용한다.
- **관련 테스트:** 1,001건 이상에서 페이지 경계를 넘는 eligible record 삭제 테스트

### M-04. 최상위 E2E와 Rules가 기본 검증에서 건너뛰어짐

- **심각도:** Medium
- **정확한 위치:** `package.json:16-21`; `.github/workflows/cms-guardrails.yml:39-49`; `lib/audit-evaluation/testing/e2e-flow.test.ts:160-164, 399-406`
- **재현 조건:** `npm run test:audit-evaluation` 또는 현재 CI를 실행한다.
- **고객 또는 운영상 영향:** 현재 실행은 127 pass, 1 skipped이며 E2E는 emulator 없으면 skip되고 실제 PDF renderer·HTTP·cookie·signed upload·브라우저를 사용하지 않는다. Rules 전용 명령도 CI에 없다.
- **권장 수정:** CI에서 audit-evaluation emulator rules를 필수 실행하고 Playwright HTTP/UI lifecycle을 별도 구축하며 E2E에서 실제 PDF renderer를 사용한다.
- **관련 테스트:** quote→access→2 upload→review→report→download→admin 전 흐름과 A/B IDOR browser/API 테스트

### M-05. PDF가 정상 fixture에서도 과도하게 분절됨

- **심각도:** Medium
- **정확한 위치:** `lib/audit-evaluation/report-pdf.tsx:530-625, 659-689`; `scripts/verify-audit-report-pdf.ts`
- **재현 조건:** `npm run verify:audit-report-pdf`를 실행한다.
- **고객 또는 운영상 영향:** 2개 견적 43페이지, 5개 55페이지, 장문 70페이지가 생성되고 대부분의 페이지가 희박해 비교·인쇄 업무 효율이 낮다.
- **권장 수정:** 여러 block을 한 페이지에 pack하고 넓은 표는 landscape/업무별 축약표를 사용해 사람이 검수 가능한 분량으로 재설계한다.
- **관련 테스트:** 페이지 수 예산, 표 묶음 연속성, Playwright 웹/PDF 시각 비교 및 인쇄 검수

### M-06. 품질평가 규칙이 이름·식별자 같은 비업무 필드도 점수화 가능

- **심각도:** Medium
- **정확한 위치:** `lib/audit-evaluation/schemas.ts:244-251`; `scoring-engine.ts:706-714`
- **재현 조건:** `accountingFirmName`에 TEXT LT/GTE threshold를 둔 100점 설정을 게시한다.
- **고객 또는 운영상 영향:** 보수/VAT만 금지되어 회계법인명 사전순 등 비합리적 기준이 유효한 품질점수와 순위를 만들 수 있다.
- **권장 수정:** 게시 가능한 scored field와 rule kind의 업무 승인 allowlist matrix를 둔다.
- **관련 테스트:** identity/name/text 필드 점수화 거부 및 승인된 count/revenue/checklist 조합 허용 테스트

### M-07. 기존 견적요청 smoke가 현재 폼 상태를 처리하지 못함

- **심각도:** Medium
- **정확한 위치:** `scripts/smoke-audit-quote-page.mjs:32-49`
- **재현 조건:** 실행 중인 로컬 서버에 `SMOKE_BASE_URL`을 지정해 `npm run smoke:audit-quote-page`를 실행한다.
- **고객 또는 운영상 영향:** 폼은 표시됐지만 제출 후 허용된 성공/오류 문구를 찾지 못해 Unexpected form state로 실패했다. 실제 회귀와 오래된 smoke assertion을 구분할 수 없다.
- **권장 수정:** 네트워크 응답과 필드 오류를 명시적으로 기다리고 API 상태별 assertion을 분리하되 실패를 삭제하거나 무조건 통과시키지 않는다.
- **관련 테스트:** 격리된 audit-quote API mock으로 성공·검증오류·서버오류·접수종료 browser smoke

---

## 확인된 강점

- 직접적인 고객 간 IDOR·Firestore/Storage client 우회는 발견되지 않았고, emulator Rules 6건이 통과했습니다.
- threshold 경계, 100점 합계, 품질점수와 보수 분리, 동점 경쟁순위, snapshot 기본 불변성도 단위 테스트로 확인됐습니다.
