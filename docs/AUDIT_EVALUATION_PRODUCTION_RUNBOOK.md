# 감사인 견적 평가보고서 운영 배포·인수인계

이 문서는 운영 명령을 실행하기 위한 절차서다. 이 문서를 작성하는 단계에서는
운영 배포, Rules 배포, 환경변수 변경, 기능 플래그 활성화를 수행하지 않는다.
`deploy`, `promote`, `firebase deploy`, 운영 데이터 쓰기는 별도 승인 후에만 실행한다.

## 1. 현재 준비 상태

- 코드·Rules·보존 작업·관리자 기능·운영 지표 API·운영 사전점검 도구가 준비되어 있다.
- 2026-07-22 긴급 배포 준비에서 최종 감사 Critical/High 차단점에 대한
  최소 수정과 회귀 검증을 완료했다. 제한 공개는 가능하지만 운영 배포와
  feature flag 활성화는 별도 승인 후에만 수행한다.
- 모든 감사평가 기능 플래그는 기본값과 `.env.example`에서 `false`다.
- 운영 Vercel 프로젝트 링크(`.vercel/project.json`)와 Firebase alias
  (`.firebaserc`)는 저장소에 없다. 배포 전 대상 계정·프로젝트를 사람이 확인해야 한다.
- 현재 Vercel MCP에서 확인 가능한 `PREGO HQ` 팀에는 프로젝트가 조회되지 않았다.
  README의 운영 URL과 실제 Vercel 프로젝트 소유 범위를 먼저 일치시켜야 한다.
- 운영 이메일은 인증된 HTTPS webhook 어댑터를 사용한다. 실제 webhook endpoint와
  bearer secret이 없으면 고객 진입을 활성화하면 안 된다.
- 활성 게시 평가기준, 보고서 문구 승인, 운영 보존기간은 코드가 아니라 관리자
  승인 대상이다.
- `npm audit --omit=dev --audit-level=high`는 통과한다. 남은 항목은
  Firebase Admin 전이 의존성의 moderate advisory이며, 이를 제거하려면
  Firebase Admin major upgrade가 필요하므로 별도 호환성 검증 전에는
  `npm audit fix --force`를 실행하지 않는다.

따라서 **제한 공개용 코드 배포 준비는 완료**, **운영 실행은 외부 설정과 승인
전까지 조건부 미완료**다.

## 2. 변경 파일 인벤토리

정확한 작업 트리 목록은 저장소 루트에서 다음 명령으로 확인한다.

```powershell
git status --short
git diff --name-status
```

감사평가 기능의 신규 범위:

- 고객 API: `app/api/audit-evaluations/**`
- 관리자 API: `app/api/admin/audit-evaluations/**`
- 내부 예약 API: `app/api/internal/audit-evaluations/retention/route.ts`
- 고객 페이지:
  - `app/events/audit-quote/evaluate/page.tsx`
  - `app/events/audit-quote/evaluations/[caseId]/page.tsx`
  - `app/events/audit-quote/evaluations/[caseId]/report/page.tsx`
- UI:
  - `components/AuditEvaluationCustomerPage.tsx`
  - `components/AuditQuoteUploader.tsx`
  - `components/AuditQuoteReviewWorkspace.tsx`
  - `components/AuditEvaluationReportWorkspace.tsx`
  - `components/AdminAuditEvaluationPanel.tsx`
- 도메인·저장소·보안·PDF·운영 코드: `lib/audit-evaluation/**`
- 검증: `lib/audit-evaluation/testing/**`
- 운영 도구:
  - `scripts/audit-evaluation/production-preflight.ts`
  - `scripts/verify-audit-report-pdf.ts`
- 문서:
  - `docs/AUDIT_EVALUATION_ADMIN_OPERATIONS.md`
  - `docs/AUDIT_EVALUATION_SECURITY_BOUNDARY.md`
  - `docs/AUDIT_EVALUATION_PRODUCTION_RUNBOOK.md`
- 배포 설정: `vercel.json`

기존 파일의 주요 변경 범위:

- `.env.example`, `README.md`, `package.json`, `package-lock.json`
- `firestore.rules`, `storage.rules`, `next.config.mjs`
- `app/admin/operations/page.tsx`, `components/AdminDashboard.tsx`
- `lib/firebase/server.ts`
- `lib/cms/constants.ts`, `lib/cms/defaults.ts`,
  `lib/cms/feature-registry.ts`, `lib/cms/route-presentation.ts`
- `scripts/cms/rules.test.mjs`

`app/globals.css`와 CMS 관련 대규모 변경도 같은 작업 트리에 있으므로, 배포 PR에서는
`git diff --name-status` 결과 전체를 검토해야 한다. 감사평가 파일만 선택 배포되는
구조가 아니다.

## 3. 환경변수와 secret

### 기능 플래그

모두 서버 전용이며 기본값은 `false`다.

- `AUDIT_EVALUATION_ENABLED`
- `AUDIT_EVALUATION_CUSTOMER_ENTRY_ENABLED`
- `AUDIT_EVALUATION_REPORT_DOWNLOAD_ENABLED`
- `AUDIT_EVALUATION_ADMIN_ENABLED`
- `AUDIT_EVALUATION_AI_NARRATIVE_ENABLED`
- `AUDIT_EVALUATION_ACTIVE_CONFIG_ID`

하위 플래그가 `true`여도 master flag가 `false`면 기능은 열리지 않는다.
AI narrative는 별도 승인이 없으면 계속 `false`로 둔다.

### 필수 secret

- `AUDIT_QUOTE_HASH_PEPPER`: 기존 견적요청 이메일 HMAC과 같아야 한다.
- `AUDIT_EVALUATION_DOCUMENT_SIGNING_SECRET`: 최소 32 bytes, 문서 서명 전용.
- `AUDIT_EVALUATION_ACCESS_SECRET`: 최소 32 bytes, 접근·세션 토큰 전용.
- `AUDIT_EVALUATION_EMAIL_WEBHOOK_TOKEN`: 최소 16 bytes, 이메일 webhook bearer.
- `CRON_SECRET`: 최소 32 bytes, Vercel Cron 호출 검증용.
- 기존 Firebase Admin:
  `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.

문서 서명 secret과 접근 secret은 서로 달라야 한다. 운영 중 교체하면 기존 문서
서명 또는 기존 접근 토큰이 무효화될 수 있으므로 즉시 회전하지 않는다.

### 일반 서버 설정

- `AUDIT_EVALUATION_BASE_URL`: 운영 HTTPS origin.
- `AUDIT_EVALUATION_EMAIL_PROVIDER=webhook`
- `AUDIT_EVALUATION_EMAIL_WEBHOOK_URL`: 인증된 HTTPS endpoint.
- `AUDIT_EVALUATION_ACCESS_EMAIL_HASH_ALLOWLIST`: 제한 공개 시 사용할
  쉼표 구분 이메일 HMAC-SHA256. 비어 있으면 추가 제한이 없다.
- `AUDIT_EVALUATION_AV_SCAN_MODE`: `static`, `external`, `required`.
  현재 기본 `static`은 EICAR, PDF JavaScript/Launch/OpenAction/EmbeddedFile,
  polyglot signature를 차단하는 최소 방어다. 전체 공개 전에는 외부 AV/CDR
  연동 후 `required` 전환을 승인받는다.
- `AUDIT_EVALUATION_AV_SCAN_URL`, `AUDIT_EVALUATION_AV_SCAN_TOKEN`: 외부
  AV/CDR 연동 시 사용한다.

이메일 webhook 요청은 다음 필드만 전송한다.

- `schemaVersion`
- `event=AUDIT_EVALUATION_ACCESS_LINK`
- `recipientEmail`
- `magicLink`
- `expiresAt`

Webhook은 2xx를 반환해야 하며 로그에 recipient, magic link 원문을 남기지 않는다.

## 4. 데이터·Rules·예약 작업

### Firestore collections

- `auditEvaluationCases`
- `auditEvaluationCaseByQuoteRequest`
- `auditEvaluationAccessTokens`
- `auditEvaluationSessions`
- `auditEvaluationUploadIntents`
- `auditEvaluationDocuments`
- `auditEvaluationParsingQueue`
- `auditEvaluationExtractionRuns`
- `auditEvaluationCorrections`
- `auditEvaluationConfirmations`
- `auditEvaluationStandardQuoteDocuments`
- `auditEvaluationNormalizedQuotes`
- `auditEvaluationConfigVersions`
- `auditEvaluationReportRuns`
- `auditEvaluationAuditLogs`
- `auditEvaluationRateLimits`

클라이언트는 위 collection을 직접 읽거나 쓰지 못한다. Admin SDK가 API에서만
접근한다.

### Firestore indexes

현재 저장소에는 `firestore.indexes.json`이 없다. 감사평가 쿼리는 단일 필드
인덱스 또는 equality index merge 범위이며, 새 composite index를 전제로 하지 않는다.
빈 indexes 파일을 배포하면 콘솔에서 관리 중인 기존 index 삭제를 유발할 수 있으므로
새 파일을 임의로 만들지 않는다.

승인 전 읽기 확인:

```powershell
npx firebase firestore:indexes --project <firebase-project-id>
```

Preview/테스트 평가 건 실행에서 `FAILED_PRECONDITION: The query requires an
index`가 발생하면 Firebase가 제시한 index만 별도 검토·추가한다.

### Firestore Rules

- 평가 collection은 모두 client deny.
- CMS 관리자 접근은 `admin: true` custom claim뿐 아니라 `users/{uid}`의
  `role=admin`, `status=active`도 요구한다.
- 기존 관리자 계정이나 custom claim을 변경하지 않는다.

### Storage Rules

다음 경로는 client direct access를 모두 거부한다.

- `audit-evaluation/originals/**`
- `audit-evaluation/quarantine/**`
- `audit-evaluation/reports/**`
- `audit-evaluation/temp/**`

업로드·다운로드는 서버가 생성한 짧은 signed URL로만 수행한다.

### 예약 작업

`vercel.json`은 매일 `18:00 UTC`(한국시간 다음 날 `03:00`)에
`/api/internal/audit-evaluations/retention`을 호출하고, 10분마다
`/api/internal/audit-evaluations/reports/sweep`을 호출한다. Vercel Cron은
Production deployment에서만 실행된다. `CRON_SECRET` 검증과 master feature flag가
모두 통과해야 실제 작업이 실행된다. feature flag가 꺼진 경우 두 cron은 성공적인
skip 응답을 반환한다. retention 삭제는 관리자 dry-run과 plan hash 확인이
선행되어야 한다.

## 5. PDF 패키지

운영 runtime 의존성:

- `@react-pdf/renderer`
- `pretendard`

배포 함수에 포함할 폰트:

- `Pretendard-Regular.ttf`
- `Pretendard-SemiBold.ttf`
- `Pretendard-Bold.ttf`

`next.config.mjs`는 고객 보고서 생성 route와 관리자 재생성 route에 폰트를
명시적으로 trace한다. `@napi-rs/canvas`는 시각검사 devDependency이며 운영 PDF
생성 runtime 의존성이 아니다.

검증 명령:

```powershell
npm ci
npm audit --omit=dev --audit-level=high
npm run verify:audit-report-pdf
npm run test:audit-evaluation:rules
npx vercel build --prod
```

## 6. migration 판단

현재 평가 기능은 기존 `auditQuoteRequests` 문서를 삭제하거나 수정하지 않는다.
평가 case는 별도 collection에 생성되고, 연결은 `requestId`, `publicReference`,
`emailHash`, `quoteCount`, `status`를 읽는 방식이다. 신규 평가 필드는 기존 문서에
강제로 추가되지 않으므로 원칙적으로 데이터 migration은 필요 없다.

운영 데이터가 이 가정을 만족하는지 읽기 전용으로 확인한다.

```powershell
node --env-file=.env.production.local --import tsx scripts/audit-evaluation/production-preflight.ts
```

출력 특성:

- `mode=READ_ONLY_DRY_RUN`
- 대상 건수와 실패 유형의 집계만 출력
- 이메일, 문서 ID, 원문 미출력
- 쓰기 건수 `0`
- 10,000건 초과 시 `request_scan_truncated`로 실패

`missingEmailHashCount` 또는 `missingPublicReferenceCount`가 1 이상이면
`migration.required=true`가 된다. 이때 운영 활성화를 중단한다. 기존 문서를
삭제하거나 현장에서 임의 보정하지 말고, 별도 승인된 migration을 다음 조건으로
작성한다.

1. optional field만 추가한다.
2. dry-run 대상 hash와 대상 건수를 승인받는다.
3. 성공·실패 문서를 분리하고 원문·이메일을 로그에 남기지 않는다.
4. 각 문서에 migration version과 완료시각을 기록한다.
5. 동일 version 재실행은 no-op으로 만든다.
6. rollback은 이번 migration이 추가한 필드만 제거하며 기존 필드는 복원하지 않는다.

운영 preflight 결과가 `migration.required=false`면 migration·rollback·완료 표시가
필요하지 않다.

## 7. 운영 지표

활성 관리자 전용 endpoint:

```text
GET /api/admin/audit-evaluations/monitoring?from=<ISO>&to=<ISO>
```

최대 조회 구간은 31일, source별 최대 10,000건이다. 초과 시 `truncated=true`이며
해당 결과를 완전한 운영 통계로 해석하지 않는다.

지표 정의:

- 평가 시작 건수: window 내 생성된 case 수.
- 업로드 성공률: `COMPLETED upload intent / 전체 upload intent`.
- 파싱 성공률: `COMPLETED extraction / terminal extraction`.
- 고객 확인 필요 비율:
  `NEEDS_REVIEW / (COMPLETED + NEEDS_REVIEW extraction)`.
- 보고서 생성 성공률: `COMPLETED / (COMPLETED + FAILED report)`.
- 평균 생성시간: 완료 보고서의 `generatedAt - generationStartedAt`.
- PDF 실패율:
  `PDF_RENDER_FAILED / REPORT_GENERATION_STARTED·RETRIED`.
- 권한 거부 건수: `ACCESS_DENIED` audit event 수.
- 만료 건수: `RETENTION_EXPIRED` audit event 수.

응답에는 집계값과 시간창만 포함하고 case ID, 이메일, token, 파일명, 문서 원문,
정규화 견적 원문은 포함하지 않는다.

## 8. 승인 후 배포 순서

아래 명령은 저장소 루트에서 실행한다. `<...>`는 승인된 실제 값으로 바꾼다.

### A. 대상과 복구 가능 상태 확인

```powershell
npx vercel whoami
npx vercel link --scope <vercel-team-or-owner> --project <vercel-project>
npx firebase projects:list
npx firebase firestore:indexes --project <firebase-project-id>
git rev-parse HEAD
git status --short
```

확인:

- README URL, Vercel project, Firebase project ID가 같은 운영 대상인지 확인.
- 현재 production deployment URL/ID를 rollback 기록에 보관.
- Firestore managed export 또는 조직 백업 정책의 최근 성공 상태 확인.
- Storage object versioning/backup 상태 확인.
- 기존 Rules와 index 정의를 별도 안전 위치에 보관.

### B. 운영 환경을 로컬 파일로 읽기

```powershell
npx vercel env pull .env.production.local --environment=production --yes
node --env-file=.env.production.local --import tsx scripts/audit-evaluation/production-preflight.ts
```

preflight는 모든 감사평가 플래그가 `false`일 때만 통과한다. `.env.production.local`은
커밋하지 않는다.

### C. 배포 전 검증

```powershell
npm ci
npm run typecheck
npm run lint
npm run test
npm run test:integration
$env:JAVA_HOME="<JDK-21-path>"
$env:PATH="$env:JAVA_HOME\bin;$env:PATH"
npm run test:audit-evaluation:rules
npm run test:cms:rules
npm run verify:audit-report-pdf
npx vercel build --prod
```

### D. Rules 호환성 확인과 배포

먼저 dry-run 및 emulator 결과를 검토한다.

```powershell
npx firebase deploy --only firestore:rules,storage --project <firebase-project-id> --dry-run
```

별도 Rules 배포 승인을 받은 뒤에만 실행한다.

```powershell
npx firebase deploy --only firestore:rules,storage --project <firebase-project-id>
```

배포 직후 기존 관리자 로그인, CMS 읽기·쓰기, 기존 Firestore 기능을 재검증한다.

### E. 서버 코드 preview

```powershell
npx vercel pull --yes --environment=preview
npx vercel build
npx vercel deploy --prebuilt
```

Preview에는 production Firebase credential을 넣지 않는다. 격리된 preview
Firebase를 사용한다.

### F. Production 코드 배포

명시적인 운영 배포 승인 후에만:

```powershell
npx vercel pull --yes --environment=production
npx vercel build --prod
npx vercel deploy --prebuilt --prod
```

배포 직후 모든 감사평가 플래그가 `false`인지 deployment environment와 실제
404/비노출 동작으로 다시 확인한다.

### G. 내부 검수

1. Preview에서 master/admin만 활성화하고 customer entry는 false로 유지한다.
2. 평가기준·보고서 문구·보존기간을 승인 후 게시한다.
3. 가상 농협과 가상 회계법인으로 테스트 견적요청 1건을 만든다.
4. 제한 공개 대상의 기존 `emailHash`만 allowlist에 넣는다.
5. Preview에서 customer entry와 report download를 제한적으로 활성화한다.
6. 견적 2건, 추출, 확인, 점수, 보수 분석, 웹 보고서, PDF를 검수한다.
7. monitoring API, audit log, Vercel runtime error를 확인한다.

### H. 제한 공개와 전체 공개

운영에서 제한 공개를 승인한 경우에만 master/customer/report 플래그를 활성화하고
`AUDIT_EVALUATION_ACCESS_EMAIL_HASH_ALLOWLIST`를 유지한 새 deployment를 만든다.
관찰 기간 후 전체 공개 승인을 받으면 allowlist를 비운 새 deployment를 만든다.

환경변수 변경은 기존 deployment에 소급되지 않으므로 매 단계 재배포가 필요하다.

## 9. 롤백

모든 상황에서 첫 조치는 새 고객 진입 차단이다.

1. `AUDIT_EVALUATION_CUSTOMER_ENTRY_ENABLED=false`
2. 필요 시 `AUDIT_EVALUATION_REPORT_DOWNLOAD_ENABLED=false`
3. false 환경으로 검증된 이전 deployment를 promote하거나 새 deployment 생성
4. 기존 보고서와 원본 문서는 삭제하지 않음

상황별 후속 조치:

- 고객 페이지 오류: customer entry false, 직전 정상 deployment promote.
- 업로드 장애: customer entry false, Storage signed URL·bucket·CORS·quota 확인.
- 파싱 오류 급증: customer entry false, OCR/AI 설정 비활성, 실패 queue만 재처리.
- 잘못된 점수 계산: customer/report download false, 잘못된 기준 게시 중단,
  수정 기준은 새 version으로 게시. 기존 보고서는 보존하고 노출만 중단.
- PDF 한글 깨짐: report download false, 폰트 trace와 배포 bundle 확인 후
  관리자 재생성. 기존 PDF 삭제 금지.
- 권한 문제: customer entry false, ACCESS_DENIED 지표 확인, token·PII 로그 금지.
- 관리자 로그인 회귀: admin flag false, 기존 관리자 계정·claim 변경 금지,
  직전 코드 deployment promote.
- Firestore Rules 문제: customer entry false 후 직전 Rules 파일을 emulator로
  검증하고 별도 승인 후 재배포. Rules만 임의 완화하지 않는다.

Vercel artifact rollback:

```powershell
npx vercel ls
npx vercel inspect <known-good-deployment-url>
npx vercel promote <known-good-deployment-url>
```

## 10. 운영 체크리스트

- [ ] 평가기준 총점·threshold·적용기간 및 게시 승인
- [ ] 보고서 제목·문구·면책·연락처 승인
- [ ] 개인정보 안내와 접근링크 안내 확인
- [ ] 업로드 허용 형식 PDF 및 최대 크기 확인
- [ ] 원본·중간데이터·보고서·token·audit log 보존기간 확인
- [ ] 관리자 claim, `role=admin`, `status=active` 확인
- [ ] 가상 fixture 고객 테스트 완료
- [ ] 2개·5개·장문·동점·누락 fixture PDF 시각 검수
- [ ] Firestore·Storage 공격 Rules 테스트
- [ ] Firestore export·Storage 복구·Vercel rollback 절차 확인
- [ ] 이메일 webhook 전달·재시도·비밀값 마스킹 확인
- [ ] monitoring `truncated=false`와 지표 수집 확인
- [ ] production dependency audit의 high·critical 조치 및 회귀검증
- [ ] 모든 플래그 false 배포를 먼저 확인
- [ ] 제한 공개와 전체 공개 각각 별도 승인

## 11. 인수인계

### 고객 사용법

견적요청에 사용한 농협 이메일과 접수번호로 평가 접근링크를 요청한다. 일회용
링크로 접속해 PDF 견적을 올리고, 추출값과 근거를 비교·정정한 뒤 최종 확인한다.
확인된 값으로만 점수·보수 분석·보고서가 생성된다. 보고서 완료 후 웹 조회와
제한된 기간의 PDF 다운로드가 가능하다.

### 관리자 사용법

`/admin/operations`의 감사평가 메뉴에서 건 목록, 상세, 문서 무결성, 추출 근거,
고객·관리자 정정, 점수, 보수, 보고서 version, 오류, audit log, 보존 대상을
관리한다. 활성 admin profile과 claim을 모두 요구한다.

### 평가기준 변경법

게시본을 직접 수정하지 않는다. 기존 version을 복제해 draft를 수정하고 미리보기·
계산기·총점·threshold·기간 충돌 검증 후 새 version으로 게시한다. 기존 보고서는
기존 snapshot을 유지한다.

### 오류 처리법

오류 목록에서 고객 영향, 오류 코드, 재시도 횟수, 해결방법을 확인한다. 문서 ID를
바꿔 다른 case를 처리하지 않는다. stack trace·원문·token을 고객 또는 일반 로그에
노출하지 않는다.

### 보고서 재생성법

실패 보고서는 관리자 재시도로 새 generation attempt를 사용한다. 데이터 또는
기준 snapshot이 달라졌다면 새 confirmation/report version을 만든다. 완료된 동일
snapshot은 중복 생성하지 않는다.

### 기능 비활성화법

가장 먼저 customer entry flag를 false로 한 deployment로 전환한다. 필요하면 report
download와 admin flag도 false로 한다. master flag false는 전체 감사평가 기능을
닫는다. 환경변수 변경 후에는 새 deployment 또는 검증된 artifact promote가 필요하다.

### 데이터 구조

견적요청은 기존 `auditQuoteRequests`에 유지한다. 평가 case, access token/session,
upload intent/document, extraction run/normalized quote, correction/confirmation,
config version, report run, audit log는 서로 분리된다. 보고서는 생성 시 config와
quote snapshot을 보존한다. 원본 PDF와 보고서 파일은 private Storage에 둔다.

### 알려진 제한사항

- 운영 이메일 전달은 외부 HTTPS webhook 운영이 필요하다.
- 환경변수 기능 플래그 변경은 이미 생성된 Vercel deployment에 소급되지 않는다.
- OCR·AI 추출과 AI narrative는 기본 비활성이다.
- 이미지 전용 레거시 PDF는 OCR provider가 없으면 수동 확인이 필요하다.
- 운영 지표는 source별 10,000건 또는 31일을 초과하면 분할 조회가 필요하다.
- 기존 견적요청에 농협명 snapshot이 없으면 보고서 표지가 빈 조직명 fallback을
  사용할 수 있다.
- 현재 저장소에는 Vercel/Firebase 프로젝트 alias가 없어 사람의 대상 확인이
  필수다.

### 향후 개선과제

- webhook provider의 delivery receipt·재시도 queue 연동
- 동적 kill switch 또는 Vercel Flags를 통한 재배포 없는 긴급 차단
- 장기 지표를 위한 외부 observability sink와 alert threshold
- 운영 OCR provider 도입 여부 검토
- 대용량 collection을 위한 집계 rollup과 필요한 composite index 재평가
