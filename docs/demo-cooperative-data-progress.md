# 업무 테스트용 농협 데이터 진행상황

## 현재 단계

- 현재 단계: **COMPLETE**
- 상태: STEP 9 최종 검증과 보고서 작성 완료
- 구현 완료: 둥기농협 seed/search/signup, scan/manifest, Firestore/Auth/Storage purge, master 보존, reset, purge job/retry, 관리자 Preview, legacy review/tagging, 고아 검증, 감사 로그
- 부분 완료: 실제 애플리케이션이 만드는 모든 파생 문서에 explicit demo metadata를 직접 복제하는 범위
- 미수행: 운영 Firestore/Auth/Storage inventory 및 삭제, 운영 tagging APPLY, production 배포
- NEXT_GATE: **NEEDS_LEGACY_DATA_REVIEW**

## 확인한 컬렉션

코드와 rules에서 확인한 주요 Firestore 최상위 컬렉션:

- 계정·조직: `users`, `organizations`
- 포인트: `pointLedger`, `point_transactions`
- 문의·답변: `consultRequests`, `answers`, `answerViews`, `answerRatings`
- 파트너 연계: `partnerAssignments`, `partnerAnswerDrafts`
- 견적: `quoteRequests`, `quoteAssignments`, `quotes`, `quoteEmailDeliveries`
- 감사 접수: `auditQuoteRequests`, `auditQuoteIdempotency`, `auditQuoteEmailDedup`, `auditQuoteRateLimits`, `auditQuoteNotifications`
- 감사 평가: `auditEvaluationCases`, `auditEvaluationCaseByQuoteRequest`, `auditEvaluationAccessTokens`, `auditEvaluationSessions`, `auditEvaluationUploadIntents`, `auditEvaluationDocuments`, `auditEvaluationParsingQueue`, `auditEvaluationExtractionRuns`, `auditEvaluationCorrections`, `auditEvaluationConfirmations`, `auditEvaluationStandardQuoteDocuments`, `auditEvaluationNormalizedQuotes`, `auditEvaluationConfigVersions`, `auditEvaluationReportRuns`, `auditEvaluationAuditLogs`, `auditEvaluationRateLimits`
- 활동: `auditLogs`

농협 마스터 Firestore 컬렉션은 확인되지 않았다. `cooperative_master`는 설계 설명에만 있고 실제 원본은 `lib/platform.ts`의 `nonghyupMaster`다.

## 농협 마스터 문서 구조

Firestore 문서가 아니라 코드 객체 배열이다.

- 고유키: `cooperative_id`
- ID 형식: `coop-001` ~ `coop-1109`
- 필드:
  - `cooperative_name`
  - `cooperative_type`
  - `sido`
  - `sigungu`
  - `address`
  - `status`
  - `source`
  - `updated_at`
- 테스트 농협 구분 필드: 없음
- 연락처·자산 규모 필드: 없음

근거: `lib/platform.ts:212-246`, `lib/platform.ts:247-1358`

## 둥기농협 내부 식별값

STEP 3 구현값:

- 표시명: `둥기농협`
- 별도 master collection: `demoCooperativeMaster`
- deterministic 문서 ID: `demo-dunggi-nh`
- `cooperativeId`: `demo-dunggi-nh`
- 내부 코드: `DEMO_DUNGGI_NH`
- `dataClassification`: `DEMO`
- `resettable`: `true`
- source: `INTERNAL_DEMO`

실제 master ID `coop-*`와 충돌하지 않으며 실제 농협 코드나 사업자등록번호를 만들지 않는다. 일반 reset에서는 `demoCooperativeMaster/demo-dunggi-nh`를 보존한다. 실제 `nonghyupMaster` 1,109개 항목에는 둥기농협을 섞지 않는다.

추가 master 필드:

- `schemaVersion: 1`
- `cooperativeName: "둥기농협"`
- `cooperativeType: "지역농협"`
- `address: "업무 테스트용 가상 농협"`
- `status: "active"`
- `signupStatus: "AVAILABLE" | "PENDING" | "REGISTERED"`
- `isDemoInstitution: true`
- `seedVersion: 1`
- `createdAt`, `createdBy`, `updatedAt`, `updatedBy`

## 가입 상태 필드

- 둥기농협 master 상태:
  - seed 최초 생성: `signupStatus: "AVAILABLE"`
  - 가입 신청: `PENDING`
  - 관리자 승인: `REGISTERED`
  - 이미 REGISTERED인 상태에서 추가 신청 시 REGISTERED를 PENDING으로 낮추지 않음
- 선택 가능 판정: master `status == "active"`
- `signupStatus`는 테스트 진행 상태이며 기존 다중 사용자 가입 정책을 바꾸지 않음
- 고객 가입·사용 상태: `users.status`
  - `pending_cooperative_review`
  - `active`
  - `rejected`
- 농협 마스터 `status`: 현재 가입 UI/API에서 사용하지 않음
- 조직 최초 가입: `organizations/{cooperativeId}` 문서 존재 여부로 판정
- 사용자 재승인: `organizations.users[]`에 UID가 존재하는지로 판정

근거: `app/api/signup/route.ts:171-234`, `app/api/admin/users/[uid]/approve/route.ts:62-73`, `lib/firebase/server.ts:235-240`

## 고객 계정 연결 필드

- Firebase Auth email UID ↔ `users/{uid}` ↔ `users.uid`
- 농협 연결:
  - `users.cooperativeId`
  - `users.nh_org_id`
  - `organizations/{cooperativeId}`
  - `organizations.users[]`
- 활동 연결:
  - `uid`, `user_id`, `userId`, `actorUid`
  - `cooperativeId`, `nh_org_id`
  - `requestId`, `quoteRequestId`, `caseId`
- 별도 `tenantId`, `membershipId`, `customerId`: 고객 가입 흐름에서 확인되지 않음

주의: phone Auth 사용자와 email Auth 사용자는 link되지 않는다.

## 테스트 데이터 표식

기존 저장 데이터에는 신뢰 가능한 공통 marker가 없다. STEP 3에서 둥기농협 신규 가입에 다음 기반을 구현했다.

- root 문서:
  - `dataClassification: "DEMO"`
  - `sourceInstitutionId: "demo-dunggi-nh"`
  - `testScenarioId: "dunggi-signup-v1"`
  - `testMetadata`: origin, rootEntityId, createdBy, createdAt
- 현재 전달 root:
  - `users/{uid}`
  - 승인 시 `organizations/demo-dunggi-nh`
- Auth: `testAuthSubjects/{authUid}` registry
- email/password UID와 phone UID가 같으면 한 registry 문서의 providerIds로 병합
- 실제 농협 가입에는 위 필드를 추가하지 않음

질문·견적·평가·Storage 파생 metadata 전파는 STEP 4 graph scan 설계와 함께 확장한다.

판정 우선순위:

1. 명시적 `dataClassification` 또는 호환용 `testData`
2. 승인된 `testScenarioId`
3. finalized manifest의 exact ID
4. 관리자 승인 legacy classification
5. 이름·이메일 pattern은 `CANDIDATE_ONLY`

marker가 없으면 DEMO로 추정하지 않는다.

## Seed 명령

등록 명령:

```text
npm run seed:demo-cooperative -- --expected-project <projectId>
npm run seed:demo-cooperative -- --apply --expected-project <projectId>
```

- 기본 모드: dry-run
- Firestore write: `--apply`가 있을 때만 수행
- 로컬 비접속 preview:

```text
npm run seed:demo-cooperative -- --offline --expected-project demo-dunggi-local
```

- production apply 추가 조건:
  - `DEMO_COOPERATIVE_SEED_PRODUCTION_ENABLED=true`
  - `--confirm-production DEMO_DUNGGI_NH`
  - expected project exact match
- 현재 환경, project ID, 대상 path, create/update/noop, write preview, 보존할 usage field 이름을 출력
- password, private key, token은 출력하지 않음
- deterministic path `demoCooperativeMaster/demo-dunggi-nh`에 transaction upsert
- 기존 문서의 `signupStatus`, registered/claimed/owner/customer/tenant/membership 연결 필드는 update patch에서 제외
- internalCode 중복이나 ID/classification 충돌 시 중단

이번 단계에서는 운영 또는 실제 Firestore에 `--apply`를 실행하지 않았다.

## 검색 노출 방식

- 신규 endpoint: `GET /api/cooperatives/search?q=<query>`
- 실제 농협: 기존 `nonghyupMaster`를 그대로 normalize
- 둥기농협: server가 Firestore demo master의 ID·classification·resettable을 검증한 경우에만 결과에 병합
- `둥기`, `둥기농협` 검색 지원
- UI 공식 선택값: `둥기농협`
- UI 보조 설명: `업무 테스트용`
- 실제 농협에는 demo 표시를 추가하지 않음
- API 장애 시 기존 실제 master의 client-side 검색 결과를 fallback으로 유지
- production은 `DEMO_COOPERATIVE_SIGNUP_ENABLED=true`를 명시해야 demo 검색·가입 허용

## STEP 3 테스트 결과

- `npm run test:demo-cooperative`: **통과 — 11 tests**
  - 고정 ID와 실제 master ID 비충돌
  - 실제 master 1,109건 불변
  - create/update/noop seed plan
  - local repository 최초 1건 생성과 재실행 중복 0건
  - 기존 signup/registered usage field 보존
  - `둥기`, `둥기농협` 검색
  - AVAILABLE 선택 가능
  - PENDING/REGISTERED 상태 전이
  - 동일 cooperative UID 재시도 판정
  - demo root metadata와 실제 농협 metadata 미부여
  - email/phone Auth UID registry
- `npm run test:cms`: **통과 — 104 tests**
  - 테스트 농협 보조 문구의 CMS 기본값·관리자 라벨 포함
- `npm run lint`: **통과**
- `npm run typecheck`: **통과**
- `npm run build`: **통과**
- offline seed dry-run: **통과**, Firestore 접속·write 0건
- Firestore Emulator test:
  - 실제 seed CLI의 dry-run → apply → usage 보존 재apply test를 작성함
  - 현재 PC의 Java가 8이라 Firebase CLI가 요구하는 Java 21 조건을 충족하지 못해 실행은 차단됨
  - 오류: `firebase-tools no longer supports Java version before 21`
  - 운영 Firestore로 우회 실행하지 않음

## STEP 4 구현한 scan 방식

서버 전용 `FirestorePurgeScanDataSource`가 선택한 `institutionId` 한 개를 기준으로 다음 순서로 읽기 전용 graph를 확장한다.

1. 실제 master는 `nonghyupMaster`의 exact `cooperative_id`, 둥기농협은 `demoCooperativeMaster/demo-dunggi-nh`의 검증된 identity로 해석한다.
2. `sourceInstitutionId`, `institutionId`, `cooperativeId`, `nh_org_id` direct reference를 조회한다.
3. `users`와 `testAuthSubjects`에서 UID 집합을 만들고 `uid`, `user_id`, `userId`, `customerUid`, `actorUid`, `organizations.users[]`를 추적한다.
4. `consultRequests.id`에서 `requestId`, `parentRequestId`, `answers/{requestId}`, 포인트·열람·평가·partner 작업·견적 graph를 확장한다.
5. `quoteRequestId`, `quoteId`, `caseId`로 견적·감사평가 graph를 확장한다.
6. 발견한 문서 아래 Firestore subcollection을 최대 4단계까지 inventory한다. scan limit 또는 read 실패는 단순 경고가 아니라 manifest blocker가 된다.
7. Firestore path field에서 exact Storage path를 모으고 object generation·size·content type을 read-only 조회한다.
8. exact UID로 Firebase Auth provider·disabled 상태를 read-only 조회한다. 이메일·전화번호는 manifest에 넣지 않는다.

탐색 collection:

- 계정·조직·소속: `users`, `organizations`, `memberships`, `tenants`, `testAuthSubjects`
- 포인트: `pointLedger`, `point_transactions`
- 문의: `consultRequests`, `answers`, `answerViews`, `answerRatings`, `partnerAssignments`, `partnerAnswerDrafts`
- 견적: `quoteRequests`, `quoteAssignments`, `quotes`, `quoteEmailDeliveries`
- 감사 접수: `auditQuoteRequests`, `auditQuoteIdempotency`, `auditQuoteEmailDedup`, `auditQuoteRateLimits`, `auditQuoteNotifications`
- 감사 평가: case, mapping, access token, session, upload, document, parsing, extraction, correction, confirmation, normalized quote, report, audit log, rate limit collection
- 활동: `auditLogs`

농협명이나 이메일은 graph root로 사용하지 않는다. 이메일 pattern은 이미 exact reference로 발견된 문서의 `REVIEW_REQUIRED` 힌트로만 사용한다.

## STEP 4 manifest 구조

`PurgeManifest`에는 다음이 포함된다.

- identity: `manifestId`, institution ID/name/type, demo 여부
- context: mode, environment, project ID, 생성자·생성일·15분 만료시각
- 분류: `targetsByCollection`, `reviewByCollection`, `preservedItems`, `blockedItems`
- 외부 resource: raw 이메일·전화번호 없는 `authUsers`, signed URL 없는 `storageObjects`
- 복원 preview: `resetFields`, `preservedFields`
- 제어: `totalTargetCount`, warning, blocked reason, execution status
- 변경 감지: Firestore update time, Auth provider/status token, Storage generation을 canonicalize한 SHA-256 `checksum`

`manifestId`는 15분 time bucket, institution ID, checksum으로 결정한다. 같은 bucket의 같은 snapshot은 같은 ID를 재사용하고, Firestore update time·Auth 상태·Storage generation 중 하나라도 바뀌면 checksum과 ID가 바뀐다. CLI artifact는 기본적으로 `.artifacts/test-data-manifests/{manifestId}.json`에 저장하며 Git에서 제외한다. 같은 path에 다른 checksum을 덮어쓰지 않는다.

질문·답변 본문, 이름, raw 이메일·전화번호, signed URL, 파일 내용은 manifest에 복제하지 않는다.

## STEP 4 분류 기준

우선순위:

1. cross-institution 또는 broken reference는 `BLOCKED`
2. `dataClassification: PRODUCTION`과 test marker 충돌은 `BLOCKED`; 단독 PRODUCTION marker는 `PRESERVE`
3. `testData: true`, `dataClassification: DEMO|TEST`는 `CONFIRMED_TEST`
4. 만료되지 않은 승인 scenario, finalized seed manifest exact path, 승인 legacy exact path는 `CONFIRMED_TEST`
5. 둥기농협에서 exact graph로 이어진 파생 문서는 `CONFIRMED_TEST`
6. 테스트 이메일 pattern 또는 seed/dev/admin actor 정황만 있으면 `REVIEW_REQUIRED`
7. 그 외 marker 없는 실제 고객 가능 데이터는 `PRESERVE`

`targetsByCollection`에는 `CONFIRMED_TEST`만 들어간다. `REVIEW_REQUIRED`와 `PRESERVE`는 삭제 target count에 포함하지 않는다. 실제·둥기농협 master는 `MASTER_ALWAYS_PRESERVED`로만 표시되고 target collection에 들어가지 않는다.

## STEP 4 혼재 판정

다음이면 manifest 전체 `executionStatus`를 `BLOCKED`로 만든다.

- 한 organization의 `users[]`에 confirmed test와 production/unknown UID가 함께 있음
- 같은 UID 활동에 confirmed test와 preserve/review 데이터가 함께 있음
- test user가 있으나 point row를 test로 확정할 수 없어 wallet 재계산이 모호함
- 같은 Auth UID가 다른 organization에서 발견되거나 다른 institution ID를 참조함
- request·quote·case parent가 없거나 다른 institution graph를 공유함
- confirmed graph에 실제 계약·견적·보고서 가능성이 있는 미확정 문서가 연결됨
- query/subcollection/Auth/Storage inventory가 불완전함
- Firestore 2,000건 또는 Storage 500건 안전 한도를 넘음

BLOCKED manifest도 확인된 항목, review 항목, 보존 항목을 모두 보여주지만 APPLY 가능한 상태로 표시하지 않는다.

## STEP 4 가입상태 reset preview

- 실제 정적 master에는 가입 연결 필드가 없으므로 `resetFields`는 비어 있고 이름·코드·유형·지역·주소·status·source를 `preservedFields`에 기록한다.
- 둥기농협 master에 실제 존재하는 `signupStatus`만 현재값에서 `AVAILABLE`로 바뀌는 preview를 만든다.
- 향후 master에 `isRegistered`, `ownerUid`, `customerId`, `tenantId`, `membershipId`, 등록시각 필드가 실제 존재하는 경우에만 false/null preview를 추가한다.
- `registrationEmail` 현재값은 raw 값 대신 `[REDACTED]`로 표시한다.
- STEP 4는 preview만 생성하며 master 또는 organization을 update하지 않는다.

## STEP 4 실행 인터페이스

- API: `POST /api/admin/test-data/scan`
  - body: `{ "institutionId": "...", "mode": "SCAN" | "DRY_RUN" }`
  - 활성 `super_admin` role 필수
  - response와 manifest는 `private, no-store`
- CLI:
  - `npm run data:scan-test -- --institution-id ... --generated-by ... --expected-project ...`
  - `npm run data:purge-preview -- --institution-id ... --generated-by ... --expected-project ...`
  - environment와 project ID를 출력하고 exact expected project를 요구한다.
  - production은 `TEST_DATA_SCAN_PRODUCTION_ENABLED=true`와 exact `--confirm-production`을 추가 요구한다.
  - `--apply`는 API와 CLI 모두 `apply_not_implemented`로 거부한다.

## STEP 4 테스트 결과

- `npm run test:test-data-scan`: **통과 — 13 tests**
  - 둥기농협 graph와 파생 데이터 confirmed 분류
  - pattern-only review, 실제 데이터 preserve, 승인 legacy exact path
  - production/test marker 충돌과 organization 혼재 차단
  - 다른 농협 참조 차단, master target 제외
  - 실제 존재 필드만 reset preview
  - 질문 본문·이메일 manifest 비복제
  - 동일 snapshot manifest 재생성과 Firestore change token 불일치
  - Storage generation 변경 checksum 불일치
  - 빈 농협 scan
  - service read-only 및 API·CLI APPLY 거부
- `npm run typecheck`: **통과**
- `npm run lint`: **통과**
- 실제 Firestore/Auth/Storage에는 접속하지 않음

## 삭제 대상 후보

정확한 테스트 UID·문서 ID가 검증된 경우에만:

- email·phone Firebase Auth 사용자
- `users/{uid}`
- 테스트 UID가 만든 조직 membership과 포인트 영향
- 포인트 잔액·두 원장
- 문의, 답변, 열람, 평가 comment, 후속 질문
- 파트너 배정·draft 중 테스트 문의 전용 레코드
- 견적 요청·배정·견적서·이메일 전달 상태
- 감사 접수·dedup·idempotency·notification·평가 case graph
- 연관 audit/activity 기록
- 명함, 상담 첨부, 견적 PDF, 감사 평가 원본·보고서

코드상 후보 패턴은 `mvp-*`, `integrated-*`, `test-e2e-*`, `jason@nonghyup.com`, `"테스트담당자"`, `"seed-test-admin"`이지만 이 문자열만으로 삭제하면 안 된다.

## 보존 대상

- `lib/platform.ts`의 실제 농협 마스터 항목 전체
- 해당 실제 농협의 `cooperative_id`와 기본정보
- 실제 고객 UID, 문의, 포인트, 견적, 파일
- 다른 고객과 공유되는 조직·파트너 데이터
- 공용 FAQ·CMS·파트너 마스터·평가 config
- 법적 또는 운영 정책상 보존해야 하는 audit/point 원장

`organizations`는 농협 마스터 A가 아니라 B이므로, 테스트 전용임이 검증되면 삭제 가능하지만 실제 고객이 섞였으면 문서 전체를 삭제할 수 없다.

## 삭제·보존 정책

### A. 실제 농협 master

- 항상 보존
- 현재 master에는 가입 연결 필드가 없으므로 초기화 write도 하지 않음
- 코드, 이름, 유형, 지역, 주소, source, updated_at 변경 금지
- purge manifest target 타입에서 master delete를 표현할 수 없게 설계

### B. 둥기농협 master

- `demoCooperativeMaster/demo-dunggi-nh` 기본 보존
- reset 대상은 연결된 B만 해당
- master delete API는 STEP 3~9 범위에 포함하지 않음

### C. 고객 사용 데이터

- `DEMO_CONFIRMED` 또는 `LEGACY_CONFIRMED` exact target만 삭제 가능
- 실제·unknown 데이터가 섞이면 `MIXED/BLOCKED`
- 초기 버전은 mixed organization의 부분 wallet reconcile을 자동 실행하지 않음

### D. 감사 로그

- 테스트 root에 종속된 기존 audit log는 manifest에 포함 가능
- 현재 purge 작업의 최종 감사 원본은 cleanup 권한과 분리된 append-only Cloud Logging sink 또는 동등한 외부 운영 로그에 보존
- `testDataPurgeAuditLogs`에는 job 재개용 최소 상태·요약만 보존
- purge audit에는 UID, job ID, count, 상태, error code만 기록하며 이메일·전화번호·질문 본문·파일 내용을 복제하지 않음

## 가입상태 복원 정책

현재 실제 master에는 `isRegistered`, `signupStatus`, `claimedBy`, `ownerUid`, `customerId`, `tenantId`, `membershipId`, `registeredAt`, `activatedAt`, `registrationEmail`이 없다. 따라서 존재하지 않는 필드를 추가하거나 null로 초기화하지 않는다.

실질적인 가입 가능 상태 복원:

1. test email·phone Auth 제거
2. `users/{uid}`와 UID 참조 B 제거
3. request/quote/case graph와 Storage 제거
4. `pointLedger`와 `point_transactions` 제거
5. 실제 고객이 0명인 test-only `organizations/{cooperativeId}` 제거
6. `/api/auth/check-email`, 신규 가입, 승인, 최초 조직 포인트 검증

DRY_RUN의 예상 상태 `AVAILABLE`은 계산 결과이며 실제 master에 저장하지 않는다. 실제 고객이 남아 있으면 organization을 삭제하거나 최초 조직 상태로 되돌리지 않는다.

## 실행 안전장치

- SCAN: 후보 탐색, write 0건
- DRY_RUN: exact target·before/after·manifest hash 생성, write 0건
- APPLY: 승인된 미만료 manifest만 실행
- 활성 `super_admin` role을 API에서 직접 검증
- production enable flag와 expected Firebase project ID exact match
- recent re-auth와 exact 확인 문구
- 농협명·내부 ID·문서/Auth/Storage count 동시 표시
- 한 job당 institution 1개
- 기본 한도: Auth 20, Firestore 2,000, Storage 500 objects/5 GiB
- deterministic lock, idempotency key, `purgeJobId`
- 실행 전 manifest와 실행 후 item result 저장
- updateTime·Storage generation 변경 시 stale 차단
- child 실패 시 parent·organization 보존
- 선택하지 않은 `cooperativeId` 무영향
- 실제·둥기 master delete 금지
- production cron·deploy hook·startup 자동 실행 금지

## 혼재 데이터 처리

- organization에 production/unknown UID가 있으면 `MIXED`
- test root가 production/unknown child를 공유하면 `BLOCKED`
- 포인트 잔액을 결정적으로 재계산할 수 없으면 `BLOCKED`
- SCAN은 blocker만 보고하고 DRY_RUN/APPLY는 실행하지 않음
- legacy 후보는 exact UID·document path·Storage generation 단위로 관리자 승인
- 이름·이메일·질문 제목만으로 approval 또는 delete 불가
- approval 후에도 새 DRY_RUN에서 graph와 혼재 여부를 다시 검증

## 주요 위험

- 테스트 marker 부재로 실제 고객과 테스트 고객 오분류
- smoke가 실제 농협 마스터 항목을 사용하고 이름으로 “미사용 농협”을 고르는 문제
- 동명 농협을 이름으로 잘못 연결할 위험
- phone Auth와 email Auth 중 하나만 남는 orphan
- 가입 실패 후 Auth 사용자·명함 rollback 부재
- Firestore 문서 삭제 후 Storage object 잔존
- Firestore 부모 삭제 시 서브컬렉션 비자동삭제
- organization 잔액과 `pointLedger`, `point_transactions` 불일치
- 질문 삭제 후 답변·열람·평가·견적·파일 orphan
- 조직 문서 오삭제로 최초 가입 포인트 중복 지급
- Firestore/Auth/Storage 부분 실패
- 감사 견적·평가 데이터가 `cooperativeId` 없이 이메일/request ID로만 연결되는 구간

## 현재 Git 상태

### 바깥 작업공간

- 경로: `C:\Users\cheap\NH support`
- 브랜치: `master`
- 커밋: 없음
- `pregosuv/` 전체가 untracked로 표시됨

### 실제 앱 저장소

- 경로: `C:\Users\cheap\NH support\pregosuv`
- 브랜치: `main`
- upstream: `origin/main`
- 분석 시작 시 미커밋 상태: modified 88개, untracked 79개, 총 167개
- 최근 커밋: 총 5개만 존재
  - `0f19c71` Complete CMS integration and verification
  - `328e911` Add FY27 audit quote intake and operations.
  - `e11ab62` Update admin console and signup flows.
  - `2dd4def` Add env template, setup script, and clone guide for other machines.
  - `cc4e54f` Initial commit: NH support center with admin console fixes.
- STEP 1에서 추가한 파일:
  - `docs/demo-cooperative-data-analysis.md`
  - `docs/demo-cooperative-data-progress.md`
- STEP 2에서 추가·수정한 파일:
  - 신규 `docs/demo-cooperative-data-design.md`
  - 신규 `docs/demo-cooperative-data-implementation-plan.md`
  - 수정 `docs/demo-cooperative-data-progress.md`
- STEP 3 변경 파일은 아래 목록과 같음
- 기존 미커밋 변경을 reset하거나 덮어쓰지 않고 대상 위치에 국소적으로 추가함

## STEP 3 변경 파일

### 신규

- `lib/cooperatives/demo-cooperative.ts`
- `lib/cooperatives/server.ts`
- `lib/cooperatives/testing/demo-cooperative.test.ts`
- `lib/test-data/root-metadata.ts`
- `app/api/cooperatives/search/route.ts`
- `scripts/demo-cooperative/seed-dunggi.mjs`
- `scripts/demo-cooperative/seed-dunggi.emulator.test.mjs`

### 수정

- `.env.example`
- `package.json`
- `lib/firebase/schema.ts`
- `lib/cms/defaults.ts`
- `lib/cms/route-presentation.ts`
- `components/SignupForm.tsx`
- `app/api/signup/route.ts`
- `app/api/admin/users/[uid]/approve/route.ts`
- `firestore.rules`
- `docs/demo-cooperative-data-progress.md`

`lib/platform.ts`의 실제 `nonghyupMaster`는 수정하지 않았다.

## STEP 4에서 사용한 데이터 관계

STEP 4 scan·manifest는 다음 root와 실제 참조를 사용한다.

### master root

- `demoCooperativeMaster/demo-dunggi-nh`
- identity:
  - `cooperativeId`
  - `internalCode`
  - `dataClassification`
  - `isDemoInstitution`
  - `resettable`
- 상태:
  - `status`
  - `signupStatus`

### 고객 root

- `users/{uid}`
- `dataClassification: DEMO`
- `sourceInstitutionId: demo-dunggi-nh`
- `testScenarioId: dunggi-signup-v1`
- `testMetadata.rootEntityId == uid`
- 기존 연결:
  - `cooperativeId`
  - `nh_org_id`

### Auth root

- `testAuthSubjects/{authUid}`
- `primaryUserUid`
- `providerIds`
- `sourceInstitutionId`
- `testScenarioId`

### organization/membership root

- `organizations/demo-dunggi-nh`
- `users[]`
- `walletBalance`
- user에서 상속한 test root metadata

### 다음 graph 확장 키

- UID: `uid`, `user_id`, `userId`, `actorUid`
- institution: `cooperativeId`, `nh_org_id`, `sourceInstitutionId`
- 문의: `requestId`, `parentRequestId`
- 견적: `quoteRequestId`, `sourceId`
- 평가: `caseId`, `documentId`, `reportVersion`
- Storage: Firestore의 exact path와 object generation

STEP 4 scanner는 이 root에서 질문·답변·포인트·견적·평가·Auth·Storage 관계를 read-only inventory하고 manifest를 생성한다.

## STEP 4 변경 파일

### 신규

- `lib/test-data/purge-types.ts`
- `lib/test-data/purge-manifest.ts`
- `lib/test-data/purge-firestore-source.ts`
- `lib/test-data/purge-scan-service.ts`
- `lib/test-data/purge-api.ts`
- `lib/test-data/testing/purge-scan.test.ts`
- `app/api/admin/test-data/scan/route.ts`
- `scripts/test-data/scan-manifest.mjs`

### 수정

- `.env.example`
- `.gitignore`
- `package.json`
- `firestore.rules`
- `docs/demo-cooperative-data-progress.md`

실제 `nonghyupMaster`, 고객 문서, Firebase Auth 사용자, Storage object는 수정하지 않았다.

## STEP 5 purge job 구조

control-plane collection:

- `testDataPurgeManifests/{manifestId}`와 `chunks/*`
  - 승인 manifest를 gzip/base64 chunk로 immutable 저장
  - 같은 ID·checksum은 재사용하고 다른 checksum 충돌은 거부
- `testDataPurgeJobs/{purgeJobId}`
  - deterministic job ID로 같은 manifest의 새 job 중복 생성 방지
- `testDataPurgeLocks/{institutionId}`
  - `ACTIVE` lock으로 가입·승인·문의 및 주요 고객 mutation 차단
- `testDataPurgeAuditLogs/{auditId}`
  - job 재개와 결과 확인용 최소 감사 summary

job 상태:

- `CREATED`, `VALIDATING`, `RUNNING`
- `PARTIALLY_FAILED`
- `COMPLETED`, `BLOCKED`, `CANCELLED`

주요 필드:

- `purgeJobId`, `manifestId`, `manifestChecksum`
- institution ID/name
- `requestedBy`, `requestedByEmail`, `requestId`
- 시작·완료·갱신 시각, attempt count
- `currentPhase`, 전체/처리/deferred progress
- collection별 `deletedCounts`
- exact path별 `DELETED | NOT_FOUND | FAILED_RETRYABLE | BLOCKED_STALE | DEFERRED_STEP_6`
- 최소 `failedItems`, `resetResult`
- STEP 6 대기 Auth UID와 Storage path

한 요청은 기본 최대 250개 Firestore item을 처리한다. 남은 항목이 있으면 같은 deterministic job을 `PARTIALLY_FAILED` 상태에서 재호출하여 이어서 처리한다.

## STEP 5 실행 조건

APPLY 전에 다음을 검증한다.

- API에서 활성 `super_admin` role과 최근 10분 이내 인증
- `TEST_DATA_PURGE_ENABLED=true`
- `TEST_DATA_PURGE_ALLOWED_PROJECT_ID` exact match
- production은 추가로 `TEST_DATA_PURGE_PRODUCTION_ENABLED=true`; 이번 검증에서는 활성화하지 않음
- 등록된 `manifestId`, `DRY_RUN`, `DRY_RUN_READY`
- manifest 미만료, blocker 0, review item 0
- institution ID/name, environment, project ID exact match
- 현재 scanner 결과와 checksum 및 보안 관련 manifest shape 일치
- actual master 존재와 identity 일치
- master·control-plane path가 target에 없음
- 모든 target이 `CONFIRMED_TEST` Firestore document
- Firestore 2,000, Auth 20, Storage 500/5 GiB 한도
- server가 생성한 exact confirmation
  - 둥기농협: `DELETE TEST DATA: 둥기농협`
  - 실제 농협: `DELETE TEST DATA: {농협명} [{cooperativeId}]`
- 같은 manifest가 `RUNNING/VALIDATING`이면 중복 실행 차단

manifest 등록 시에도 current scanner가 생성한 checksum과 target/reset/Auth/Storage shape를 재검증하므로 client가 target path를 임의 추가할 수 없다.

## STEP 5 Firestore 삭제 순서

실제 구현 순서:

1. manifest 등록 확인, deterministic job·institution lock
2. current graph 전체 재-scan 및 checksum 검증
3. 평가 access/session/upload intent/rate limit
4. 평가 correction·confirmation·extraction·parsing·normalized quote·document·report·audit, case mapping과 case
5. quote email delivery·quote·assignment·request
6. answer rating·view·partner draft/assignment·answer·후속 질문·부모 질문
7. audit quote notification·idempotency·dedup·rate limit·request
8. 기존 테스트 activity/audit
9. `pointLedger`, `point_transactions`
10. `memberships`, `tenants`
11. `users`
12. organization 삭제 직전 재-scan하여 새 target·재생성 문서·혼재 여부 차단
13. test-only `organizations`
14. 최종 Firestore 재-scan
15. 실제 존재하는 가입 연결 필드 reset
16. 감사 summary 기록

부모/자식 path가 함께 있으면 collection phase보다 우선해 깊은 subcollection 문서를 먼저 삭제한다. Firestore `recursiveDelete`와 field-based bulk delete는 사용하지 않는다. STEP 4가 manifest에 고정한 exact document path를 개별 update-time precondition으로 삭제하여 item별 재개 상태를 유지한다.

`NOT_FOUND`는 멱등 성공이다. update time이 바뀌면 `BLOCKED_STALE`, retryable Firestore 오류는 `FAILED_RETRYABLE`로 기록한다.

## STEP 5 가입상태 복원

- 실제 정적 `nonghyupMaster`:
  - Firestore 문서가 아니므로 write 0건
  - 이름·코드·유형·지역·주소·status·source를 그대로 보존
  - 현재 가입 연결 필드가 없어 reset patch 없음
- 둥기농협:
  - `demoCooperativeMaster/demo-dunggi-nh`를 삭제하지 않음
  - identity, internalCode, 이름, 유형, 주소, 분류, resettable을 transaction에서 재검증
  - manifest preview에 있고 실제 문서에도 존재하는 allowlist 필드만 update
  - 현재 구현에서는 `signupStatus → AVAILABLE`
  - master 기본정보와 다른 필드는 변경하지 않음

모든 필수 Firestore/Auth/Storage item 삭제와 최종 고아 검증이 성공한 뒤에만
reset한다.

Firebase Auth 또는 Storage target이 남아 있거나 `testAuthSubjects`가
deferred이면 master reset을 진행하지 않는다.
`PARTIALLY_FAILED/AWAITING_AUTH_STORAGE`로 유지하고 institution lock도
해제하지 않는다.

## STEP 5 멱등성·부분 실패 처리

- 같은 manifest는 같은 `purgeJobId` 사용
- `DELETED`, `NOT_FOUND`, `DEFERRED_STEP_6` item은 재실행 시 건너뜀
- retryable 실패 item만 같은 job/다음 attempt에서 재시도
- 이미 수동 삭제된 exact path는 `NOT_FOUND` 성공
- 삭제한 path가 재생성되거나 새로운 confirmed target이 생기면 reset 전에 차단
- update-time 불일치 시 같은 manifest로 재탐색하거나 target을 추가하지 않고 `BLOCKED`
- child 실패 시 이후 parent·organization·master reset을 진행하지 않음
- Auth·Storage 대기 job은 STEP 5 재호출 시 삭제를 반복하지 않고 같은 상태를 반환

감사 summary:

- actor ID, manifest/job/institution ID와 이름
- collection별 삭제 건수, reset 필드명
- 실패 건수, 시작·결과 시각, 상태, request ID
- 질문·답변 본문, token, 비밀번호, 삭제 snapshot은 기록하지 않음
- 같은 최소 event를 structured server log로도 출력하여 외부 logging sink 수집 기반 제공

## STEP 5 실행 API

1. 승인 manifest 등록:
   - `POST /api/admin/test-data/manifests`
   - body: `{ "manifest": <STEP 4 DRY_RUN manifest> }`
2. challenge·count preview:
   - `GET /api/admin/test-data/purge?manifestId=...`
3. APPLY:
   - `POST /api/admin/test-data/purge`
   - body:
     - `apply: true`
     - `manifestId`
     - exact `confirmation`

`apply: true`가 없으면 요청 schema에서 거부한다. 모든 response는 `private, no-store`다.

## STEP 5 테스트 결과

- `npm run test:test-data-scan`: **통과 — 23 tests**
  - 기존 STEP 4 scan 13개
  - STEP 5 service/API 10개
  - exact 순서 삭제, 실제·demo master 보존
  - demo signup reset, 다른 농협 불변
  - review/blocked/expired/checksum/권한/challenge/limit 차단
  - 중복 실행, 중간 실패 재개, not-found 멱등 처리
  - Auth·Storage pending과 감사 로그
- `npm run typecheck`: **통과**
- `npm run lint`: **통과**
- Firestore Emulator 통합 테스트:
  - `scripts/test-data/purge-firestore.emulator.test.mjs` 작성
  - 명령: `npm run test:test-data-purge:emulator`
  - 현재 PC Java 8로 Firebase CLI의 Java 21+ 요구조건을 충족하지 못해 emulator 시작 전에 차단
  - 오류: `firebase-tools no longer supports Java version before 21`
  - 운영 또는 실제 Firebase 프로젝트로 우회 실행하지 않음

## STEP 5 변경 파일

### 신규

- `lib/test-data/purge-job-types.ts`
- `lib/test-data/purge-apply-policy.ts`
- `lib/test-data/purge-firestore-executor.ts`
- `lib/test-data/purge-apply-service.ts`
- `lib/test-data/purge-apply-api.ts`
- `lib/test-data/purge-runtime.ts`
- `lib/test-data/purge-lock.ts`
- `lib/test-data/testing/purge-apply.test.ts`
- `app/api/admin/test-data/manifests/route.ts`
- `app/api/admin/test-data/purge/route.ts`
- `scripts/test-data/purge-firestore.emulator.test.mjs`

### 수정

- `.env.example`
- `package.json`
- `firestore.rules`
- `lib/firebase/server.ts`
- `app/api/signup/route.ts`
- `app/api/admin/users/[uid]/approve/route.ts`
- `app/api/consult/route.ts`
- `app/api/me/answers/[requestId]/view/route.ts`
- `app/api/me/answers/[requestId]/rating/route.ts`
- `app/api/me/requests/[requestId]/complete/route.ts`
- `app/api/me/consents/route.ts`
- `app/api/audit-evaluations/access/firebase/route.ts`
- `docs/demo-cooperative-data-progress.md`

## STEP 6 Auth·Storage 대상

STEP 5 job의 다음 필드를 그대로 사용한다.

- `pendingAuthUids`
  - email/password와 phone Auth UID
  - provider·disabled/change token은 승인 manifest에 보존
- `pendingStoragePaths`
  - business card, 상담 첨부, quote PDF, 평가 원본·격리·report/temp
  - bucket·generation·size는 승인 manifest에 보존
- `DEFERRED_STEP_6`인 `testAuthSubjects/{authUid}`

STEP 6 예정 순서:

1. pending Auth identity와 provider/change token 재검증
2. Auth disable·refresh token revoke
3. Storage exact path/generation 삭제
4. Firebase Auth user 삭제
5. `testAuthSubjects` 삭제
6. 잔여 Auth/Storage/registry 0건 확인
7. job `COMPLETED`, audit 기록, institution lock 해제

STEP 5에서는 Firebase Auth disable/delete, token revoke, Storage delete를 실행하지 않았다.

## STEP 6 Auth 삭제 조건

Auth UID는 승인 manifest의 `authUsers` exact UID만 처리한다. manifest candidate에는 다음 근거를 함께 고정한다.

- `profileDocumentPath`, `registryDocumentPath`, `primaryUserUid`
- customer profile의 `CONFIRMED_TEST` 분류
- `sourceInstitutionId`
- 실제로 연결된 organization ID 목록
- profile role과 Auth custom claim key
- provider ID, disabled 상태, Auth change token
- `reviewStatus: APPROVED`

APPLY 전 서버가 Auth와 Firestore를 다시 읽어 다음을 모두 확인한다.

- manifest의 `CONFIRMED_TEST` UID이고 승인된 customer profile lineage가 있음
- source institution이 target과 exact match
- target 이외 organization의 `users[]`에 UID 또는 primary UID가 없음
- `admin`, `operator`, `partner`, `super_admin`, 내부 운영 role/profile/custom claim이 없음
- UID가 참조하는 문의, 포인트, 견적, 평가 case가 모두 manifest Firestore target에 포함됨
- provider 집합이 manifest 이후 변경되지 않음

이메일·전화번호 pattern은 Auth lookup 또는 삭제 근거로 사용하지 않는다. profile/registry가 이미 삭제된 재시도에서는 등록된 immutable manifest와 이전 phase 결과를 사용하되, 신규 provider·다른 조직 참조는 계속 차단한다.

## STEP 6 Storage 삭제 조건

- manifest의 `storageObjects` exact bucket/path만 처리
- generation이 존재하고 현재 object generation과 exact match
- source Firestore path가 `CONFIRMED_TEST`
- source institution 및 object custom metadata의 institution이 target과 일치
- owner UID metadata가 존재하면 manifest owner와 일치
- 두 개 이상 Firestore 문서가 같은 object를 참조하면 `SHARED_STORAGE_OBJECT`로 APPLY 차단
- `partner-assets`, CMS asset 또는 다른 농협 path는 manifest에 없으므로 비대상

삭제는 `file.delete({ ifGenerationMatch })` 단건 호출만 사용한다. prefix는 삭제에 사용하지 않고, 사후 신규·고아 object를 읽기 전용으로 찾을 때만 사용한다. object가 이미 없으면 `NOT_FOUND` 멱등 성공이다.

## STEP 6 purge phase

STEP 6 high-level phase:

1. `DISABLE_AUTH_USERS`
2. `REVOKE_SESSIONS`
3. `DELETE_FIRESTORE_DATA`
4. `DELETE_STORAGE_OBJECTS`
5. `DELETE_AUTH_USERS`
6. `RESET_INSTITUTION`
7. `VERIFY_ORPHANS`
8. `COMPLETE`

각 phase는 `phaseResults`에 `startedAt`, `completedAt`, `successCount`, `failureCount`, `retryable`을 기록한다. Auth는 UID별 `validated`, `disabled`, `sessionsRevoked`, `deleted` 상태를, Storage는 exact path별 `VALIDATED`, `DELETED`, `NOT_FOUND`, `FAILED_RETRYABLE`, `BLOCKED` 상태를 기록한다.

실행 순서는 대상 전체 재검증 후 Auth disable과 refresh token revoke를 먼저 수행한다. 그 뒤 STEP 5 exact Firestore deletion, generation-precondition Storage deletion, Auth 최종 삭제, `testAuthSubjects` 삭제를 실행한다. 모든 외부 대상이 끝난 뒤에만 demo `signupStatus`를 `AVAILABLE`로 reset한다. STEP 5 호환 모드에서 `AWAITING_AUTH_STORAGE`인 같은 job도 STEP 6 external gate가 활성화되면 동일 `purgeJobId`로 재개한다.

외부 삭제에는 별도 서버 flag `TEST_DATA_PURGE_EXTERNAL_ENABLED=true`가 필요하다. 기존 `TEST_DATA_PURGE_ENABLED`, allowed project ID, production 추가 gate, SUPER_ADMIN/recent-auth/confirmation 조건도 그대로 필요하다.

## STEP 6 부분 실패·재시도

- Auth disable 후 Firestore 실패: Auth는 disabled/revoked 상태를 유지하고 같은 job에서 Firestore phase부터 재개
- Firestore 후 Storage 실패: Auth 최종 삭제와 institution reset을 진행하지 않고 `PARTIALLY_FAILED`
- Storage 후 Auth 실패: 삭제된 Storage는 반복하지 않고 실패 UID만 재시도
- 일부 UID 실패: UID별 결과를 보존하고 retryable UID만 다음 attempt에서 재호출
- Auth 또는 Storage가 이미 없음: `NOT_FOUND` 성공
- Storage generation 변경, 신규 provider, 다른 organization 참조: 자동 재분류하지 않고 `BLOCKED`
- manifest 이후 신규 Firestore/Storage 데이터: 자동 추가·삭제하지 않고 최종 완료 차단
- orphan blocker가 남으면 lock을 해제하지 않고 `PARTIALLY_FAILED` 또는 `BLOCKED`

삭제 전 checksum 재검증은 purge가 직접 만든 Auth disabled/token revoke와 Storage delete 상태만 허용한다. 외부 변경은 stale로 처리한다.

## STEP 6 고아 데이터 검증

`FirebasePurgeOrphanVerifier`가 삭제 후 읽기 전용 보고서를 생성한다.

- Auth 없는 customer profile
- customer profile 없는 manifest Auth UID
- organization 없는 membership/tenant
- request 없는 answer
- wallet 없는 point row 또는 point row 없는 비정상 wallet
- 삭제 후 남은 manifest Storage object
- 대상 UID를 계속 참조하는 문의·열람·평가·견적·포인트·audit/evaluation 문서
- reset institution을 참조하는 active tenant
- manifest 이후 target UID/prefix에 새로 생긴 미확인 Firestore/Storage 데이터

보고서는 resource path와 detail code만 저장하고 문서 payload, 이메일, 전화번호, 질문 본문, token, signed URL은 저장하지 않는다. verifier는 고아 데이터를 자동 삭제하지 않는다.

## STEP 6 테스트 결과

- `npm run test:test-data-scan`: **통과 — 30 tests**
  - Auth disable → revoke → Firestore → Storage → Auth delete 순서
  - 운영자 role/custom identity와 다중 organization UID 차단
  - 공유 Storage object 차단 및 다른 농협 file 보존
  - Storage/Auth 중간 실패 후 같은 phase 재개
  - 이미 없는 Auth/Storage 멱등 성공
  - orphan/new object 최종 완료 차단
  - 둥기농협 `AVAILABLE`, 실제 master 무변경, lock 해제
- `npm run typecheck`: **통과**
- `npm run lint`: **통과**
- `npm run build`: **통과**
- purge 관련 portal/admin guard tests: **통과 — 15 tests**
- `npm test` 전체 실행:
  - 이번 purge route/helper를 인식하지 못하던 guard 정규식은 수정 후 통과
  - 기존 `firestore.indexes.json`에 `quoteAssignments` index 2개가 있으나 `migration-seed-index.test.ts`가 `partnerAssignments` 2개만 기대하여 해당 비관련 1개 test에서 중단
  - STEP 6 구현이 만든 실패는 남지 않음
- Auth·Firestore·Storage Emulator 통합 테스트:
  - `scripts/test-data/purge-auth-storage.emulator.test.mjs` 작성
  - 명령: `npm run test:test-data-purge-external:emulator`
  - 현재 PC Java 8로 Firebase CLI의 Java 21+ 요구조건을 충족하지 못해 emulator 시작 전에 차단
  - 오류: `firebase-tools no longer supports Java version before 21`
  - 운영 또는 실제 Firebase 프로젝트로 우회 실행하지 않음

## STEP 6 변경 파일

### 신규

- `lib/test-data/purge-external-executor.ts`
- `lib/test-data/purge-orphan-verifier.ts`
- `scripts/test-data/purge-auth-storage.emulator.test.mjs`

### 수정

- `lib/test-data/purge-types.ts`
- `lib/test-data/purge-manifest.ts`
- `lib/test-data/purge-firestore-source.ts`
- `lib/test-data/purge-job-types.ts`
- `lib/test-data/purge-apply-service.ts`
- `lib/test-data/purge-runtime.ts`
- `lib/firebase/admin.ts`
- `lib/test-data/testing/purge-apply.test.ts`
- `lib/admin/testing/portal-login-separation.test.ts`
- `lib/admin/testing/portal-route-guards.test.ts`
- `.env.example`
- `firebase.json`
- `package.json`
- `docs/demo-cooperative-data-progress.md`

## STEP 9 최종 마감

### 구현 완료 항목

- 둥기농협 deterministic master와 idempotent seed
- server cooperative search와 정상 signup/approval 흐름
- exact graph SCAN, DRY_RUN manifest, mixed data 차단
- update-time precondition Firestore 정리
- exact UID Firebase Auth disable/revoke/delete
- exact path/generation Storage 정리
- 실제 농협 master 무변경 및 둥기농협 `signupStatus: AVAILABLE` 복원
- deterministic Purge Job, institution lock, 중복 실행 방지, 부분 실패 재개
- SUPER_ADMIN Preview UI, master/test checkbox, exact 확인 문구
- legacy candidate review, SUPER_ADMIN 승인, dry-run-first tagging migration
- Firestore/Auth/Storage 고아 검증과 최소 감사 summary

### 미완성·부분 완료 항목

- 신규 둥기농협 가입의 `users`, Auth registry, `organizations`에는 explicit
  metadata가 전달되지만 모든 포인트·문의·답변·견적·평가 파생 write에 marker가
  직접 복제되지는 않는다.
- 실제 browser phone Auth부터 관리자 승인까지 하나의 E2E session으로 자동화한
  테스트는 없다. 각 route/policy와 purge data flow는 unit/API/Emulator로
  검증했다.

### 수동 검토 필요 항목

- 운영 Firebase inventory를 수행하지 않아 실제 농협 1,109개는
  `NOT_ASSESSED`
- 과거 smoke가 선택한 exact institution ID, UID, Firestore path, Storage
  generation 복원
- 모든 `REVIEW_REQUIRED`/`UNRESOLVED` 결정
- 실제 고객 혼재, Auth multi-organization, shared Storage 재검토

### 전체 테스트 결과

- `npm test`: 466 tests, 465 pass, 1 skip, 0 fail
- `npm run test:admin-rbac`: 91/91 pass
- `npm run test:test-data-scan`: 51/51 pass
- `npm run test:demo-cooperative`: 11/11 pass
- Firestore demo seed Emulator: 1/1 pass
- Firestore-only purge Emulator: 1/1 pass
- Firestore/Auth/Storage 시나리오 A-D Emulator: 4/4 pass
  - A: full graph, Auth 2, Storage 3, master 보존, AVAILABLE, Auth 재생성
  - B: 실제 `coop-001` 사용 데이터 정리와 static master 불변
  - C: mixed data manifest/UI blocker와 등록 거부
  - D: Storage 실패, PARTIALLY_FAILED, 동일 job 재개·멱등 replay
- legacy tagging offline dry-run: update 1, blocked 0
- lint, typecheck, CMS audit, production build: pass

### 최종 검증에서 수정한 오류

- Firebase Storage Emulator의 not-found message 차이를 허용하도록 assertion 수정
- stale `quoteAssignments`/`partnerAssignments` composite index와 회귀 테스트를
  현재 live query에 맞게 정리
- production flag, project binding, manifest ID, institution payload 변조
  negative test 추가
- purge/scan/legacy review 감사 event에서 actor email을 새로 저장하지 않도록
  수정
- external cleanup 대기 중 master reset을 차단하고, stale lock lease 만료 후
  정상 write를 허용하도록 수정
- 감사 로그 저장 성공 전에 job 완료·lock 해제를 하지 않도록 수정
- Emulator A-D에 point, question/answer/rating, quote/report,
  membership/tenant, Auth/Storage, real master, retry 검증 추가

### 운영 반영 전 필요 작업

1. 운영 read-only legacy inventory
2. `REVIEW_REQUIRED`와 `UNRESOLVED` 0건 달성
3. Firestore/Storage backup과 exact Auth/Storage target 승인
4. staging browser phone-auth signup E2E
5. production checklist 및 SUPER_ADMIN/조직 승인
6. 한시적 production flag 활성화와 실행 후 즉시 비활성화

### NEXT_GATE

**NEEDS_LEGACY_DATA_REVIEW**

이유: 구현·Emulator·regression·build는 통과했으나 운영 legacy 데이터는 조회하지
않았고, 실제 농협별 review 완료 여부를 증명하지 못했다. 운영 삭제나 production
배포는 수행하지 않았다.

상세:

- `docs/demo-cooperative-data-completion-report.md`
- `docs/demo-data-purge-production-checklist.md`

## STEP 7 관리자 메뉴 위치

- route: `/admin/test-data`
- 메뉴명: `시스템 관리 > 테스트 데이터 관리`
- `/admin` 콘텐츠 관리와 `/admin/operations` 회원·상담 운영 화면에서 최고관리자에게만 메뉴 링크 표시
- 서버 page guard:
  - `requirePortalPageSession("admin")`
  - resolved account role이 `super_admin`이 아니면 접근 거부 route로 이동
- API guard:
  - 모든 기관·job·history·scan·manifest·purge API가 `authorizePurgeAdmin` 또는 `requireRole("super_admin")`을 다시 실행
- 일반 ADMIN, OPERATOR, PARTNER는 메뉴 표시와 direct route/API 접근 모두 차단

화면 표시는 기존 `admin.operations` CMS 게시 콘텐츠의 잠긴 `testDataManagement` 섹션을 재사용한다. 권한, endpoint, confirmation 형식, manifest 검증은 CMS 편집 대상이 아니다. `/admin/test-data`는 별도 공개 화면으로 중복 등록하지 않는 보호된 시스템 도구로 `docs/CMS_ROUTE_EXCEPTIONS.json`에 문서화했다.

## STEP 7 Preview 화면

기관 검색과 선택 시 표시:

- 농협명, 내부 ID, 내부 코드, 실제/테스트 구분
- 가입상태
- 연결 `users` 수
- 연결 `organizations`·`tenants` 수
- 명시적 test marker 여부
- linked graph의 최종 활동일
- `CONFIRMED_TEST | REVIEW_REQUIRED | PRESERVE | BLOCKED` 분류 상태
- 둥기농협: `업무 테스트용`, `초기화 가능`
- 실제 농협: `실제 농협`, `마스터 보존`

`데이터 점검`은 먼저 STEP 4 `SCAN`을 실행한다. 실행 가능 후보에 한해 별도 `실행 미리보기 생성`에서 `DRY_RUN`을 다시 실행하고 서버에서 manifest를 등록·재검증한 뒤 challenge preview를 읽는다.

Preview 제공 정보:

- `CONFIRMED_TEST`, `REVIEW_REQUIRED`, `PRESERVE`, `BLOCKED` count
- 컬렉션별 exact 삭제 예정 count
- Auth·Storage 예정 count
- 실제 존재하는 가입상태 reset field의 현재값과 예상값
- 보존되는 master field
- warning·blocked reason
- manifest 만료 시간

질문·답변 본문, raw email·전화번호, signed URL, 문서 snapshot은 표시하지 않는다. 실패 화면도 resource path 대신 phase, 안전한 error code와 retry 가능 여부만 표시한다.

## STEP 7 실행 차단 조건

화면의 실행 버튼은 다음 조건에서 제공하지 않는다.

- `REVIEW_REQUIRED` item 존재
- manifest `BLOCKED` 또는 blocked item 존재
- 혼재·cross-institution·Auth identity·shared Storage blocker
- manifest 만료
- 현재 institution active purge lock
- 안전 한도·master target·master preserved item 누락
- 다른 실행 중 job

서버의 기존 STEP 5~6 검사는 UI 상태와 무관하게 다시 실행한다.

- 현재 snapshot checksum·Auth change token·Storage generation
- project/environment/feature flag
- manifest expiry/status/review/blocker
- master identity와 master target 금지
- 최대 건수
- exact confirmation
- SUPER_ADMIN·recent authentication
- 중복 job·institution lock

따라서 UI 상태가 조작되거나 오래된 브라우저가 요청해도 APPLY가 허용되지 않는다.

## STEP 7 이중 확인

1차 확인:

- Firestore/Auth/Storage count
- 예상 가입상태 reset field
- 보존되는 master field
- `실제 농협 마스터 정보는 삭제되지 않음` 확인 checkbox
- `대상이 테스트 데이터임을 검토함` 확인 checkbox

2차 확인:

- 서버가 반환한 exact challenge를 화면에 표시
- 사용자가 동일한 문자열을 직접 입력
- 입력값이 exact match일 때만 실행 버튼 활성화
- 실행 중 버튼 잠금으로 중복 클릭 방지

보안 confirmation 형식은 CMS에서 변경할 수 없고 기존 서버 policy를 사용한다.

## STEP 7 purge 진행·완료 UI

진행 화면:

- 현재 high-level phase
- 완료 percentage
- collection별 Firestore 삭제 수
- Auth·Storage 성공 수
- 가입상태 reset 결과
- 실패 phase·error code
- retry 가능 여부

`purgeJobId`를 browser local storage에 보존하고 `GET /api/admin/test-data/jobs/{purgeJobId}`를 주기적으로 조회한다. 브라우저를 닫았다 열어도 등록 manifest의 비민감 preview와 job 상태를 복원한다. `PARTIALLY_FAILED`이고 manifest가 유효하며 retry 대상이 남은 경우 같은 job을 이중 확인 후 재개한다.

완료 화면:

- final status
- Firestore/Auth/Storage 처리 수
- reset result
- orphan verification 통과 여부와 blocker count
- 실패 항목
- `purgeJobId`, 완료 시각
- 다시 가입 가능 여부
- 둥기농협은 `/signup` 테스트 가입 이동
- 다시 데이터 점검

## STEP 7 감사 이력

추가 read API:

- `GET /api/admin/test-data/institutions?q=...`
- `GET /api/admin/test-data/institutions?institutionId=...`
- `GET /api/admin/test-data/jobs/{purgeJobId}`
- `GET /api/admin/test-data/history?institutionId=...`

`testDataPurgeAdminEvents`에는 UI/API SCAN의 actor, institution, manifest ID, 결과와 시각만 기록한다. 고객 payload를 복제하지 않는다. 이력 API는 다음을 합쳐 시각순으로 반환한다.

- SCAN actor: `testDataPurgeAdminEvents`
- manifest approver: `testDataPurgeManifests`
- purge actor·result: `testDataPurgeAuditLogs`

Firestore client rules는 위 새 collection read/write를 모두 deny하고 서버 Admin SDK만 사용한다.

## STEP 7 테스트 결과

- `npm run test:test-data-scan`: **통과 — 38 tests**
  - UI count와 `REVIEW_REQUIRED`·`BLOCKED`·만료·master target 차단
  - SUPER_ADMIN page/API guard
  - 실제/둥기농협 CMS badge copy
  - 이중 확인·중복 실행·local job 복원 contract
  - 진행·부분 실패·완료·orphan 표시 contract
  - 모바일 modal `100dvh` scroll·stacking
  - 기관 read API 403/200/404
  - 최소 SCAN audit event
- `npm run test:cms`: **통과 — 104 tests**
- portal/admin route guard tests: STEP 7 신규 page/API 포함 부분 **통과**
- `npm run lint`: **통과**
- `npm run typecheck`: **통과**
- `npm run cms:audit`: **통과 — route 30 = 등록 27 + 문서 예외 3**
- `npm run build`: **통과**
- `npm run test:admin-rbac` 전체:
  - STEP 7 page/API route guard는 통과
  - 기존 `migration-seed-index.test.ts`의 `quoteAssignments` index 기대값 불일치 1건은 계속 남아 있으며 STEP 7 변경과 무관
- 개발 중 운영 또는 production purge APPLY는 실행하지 않았다.

## STEP 7 변경 파일

신규:

- `app/admin/test-data/page.tsx`
- `components/TestDataManagement.tsx`
- `lib/test-data/purge-admin-read.ts`
- `lib/test-data/purge-admin-api.ts`
- `lib/test-data/purge-admin-ui-policy.ts`
- `app/api/admin/test-data/institutions/route.ts`
- `app/api/admin/test-data/jobs/[purgeJobId]/route.ts`
- `app/api/admin/test-data/history/route.ts`
- `lib/test-data/testing/purge-admin-ui.test.ts`

수정:

- `app/admin/page.tsx`
- `app/admin/operations/page.tsx`
- `components/CmsAdminConsole.tsx`
- `components/AdminDashboard.tsx`
- `app/api/admin/test-data/scan/route.ts`
- `lib/test-data/purge-api.ts`
- `lib/cms/defaults.ts`
- `lib/cms/route-presentation.ts`
- `lib/cms/testing/admin-console.test.ts`
- `lib/admin/testing/portal-route-guards.test.ts`
- `app/globals.css`
- `firestore.rules`
- `docs/CMS_ROUTE_EXCEPTIONS.json`
- `docs/demo-cooperative-data-progress.md`

## STEP 8 legacy 데이터 분류 대상

STEP 8에서는 자동 삭제를 추가하지 않고 exact evidence 기반 legacy classification을 준비한다.

- 실제 농협에 연결됐으나 marker가 없는 과거 `users`, `organizations`, point 두 원장
- 과거 seed·smoke가 만든 것으로 보이는 문의·답변·열람·평가 데이터
- exact request/quote/case graph와 partner assignment·draft
- `testAuthSubjects`가 없는 legacy Auth UID
- Firestore source metadata가 부족한 Storage exact object
- 같은 UID·organization·wallet에 실제·테스트 가능성이 혼재한 BLOCKED 후보
- 기존 문자열·이메일 pattern 후보는 검색 힌트로만 유지

승인 결과는 exact UID, Firestore document path, Storage path/generation 단위로 `legacyTestDataClassifications`에 기록하고, 승인 후에도 새 SCAN·DRY_RUN에서 cross-institution, shared reference, production marker와 checksum을 다시 검증해야 한다.

## STEP 8 legacy 후보 탐색 기준

구현 위치:

- `lib/test-data/legacy-candidate-report.ts`
- `lib/test-data/legacy-review-types.ts`
- `lib/test-data/legacy-review-service.ts`

강한 근거:

- fixed seed Firestore document path
- Git fixture의 exact path
- exact seed Auth UID
- 승인된 seed manifest entry
- 개발자가 코드에서 명시한 exact ID
- 기존 승인된 legacy review

강한 근거가 있어도 marker 없는 legacy resource는 승인 전
`REVIEW_REQUIRED`다. 기존 명시적 test marker 또는 이미 승인된 exact legacy
record만 `CONFIRMED_TEST`로 읽는다.

보조 근거:

- test/demo/dummy/mvp/integrated/e2e 이메일 pattern
- test/demo/dummy 이름 pattern
- 서버 evidence catalog의 개발 기간
- 비정상적으로 큰 포인트
- fixture 형태의 질문 제목
- localhost/emulator metadata
- seed/test/demo/dev actor pattern

보조 근거만 있는 후보는 `REVIEW_REQUIRED`이며 suggested decision은
`UNRESOLVED`다. 후보 보고서에는 질문 본문, raw email·전화번호, signed URL을
포함하지 않는다.

## STEP 8 관리자 검토 구조

API:

- `POST /api/admin/test-data/legacy`
  - exact `institutionId`를 scan하고 review manifest와 비식별 후보 보고서를 저장
  - SUPER_ADMIN 전용
- `GET /api/admin/test-data/legacy?reviewManifestId=...`
  - manifest, candidate, 현재 decision 조회
  - SUPER_ADMIN 전용
- `POST /api/admin/test-data/legacy/reviews`
  - exact candidate 하나를 `CONFIRMED_TEST | PRESERVE | UNRESOLVED`로 결정
  - optimistic `reviewVersion` 검증

승인 record:

- collection: `legacyTestDataClassifications`
- append-only history: `legacyTestDataReviewEvents/{reviewId}_v{reviewVersion}`
- exact `resourceKey`, `documentPath | authUid | storagePath`
- `reviewedBy`, `reviewedAt`, `decision`, `reason`, `sourceEvidence`
- `reviewVersion`, 검토 시점 change token/generation
- `CONFIRMED_TEST`의 server-side SUPER_ADMIN 재검증

`PRESERVE`와 `UNRESOLVED`는 활성 관리자만 기록할 수 있고,
`CONFIRMED_TEST`는 SUPER_ADMIN만 기록할 수 있다. 클라이언트가 제출한 evidence
code는 저장된 candidate evidence의 부분집합이어야 한다. client Firestore
rules는 review manifest와 classification collection을 모두 deny한다.

STEP 4 scan source는 승인 record를 다시 읽는다.

- `CONFIRMED_TEST` → `LEGACY_APPROVAL`
- `PRESERVE` → `LEGACY_REVIEW_PRESERVE`
- `UNRESOLVED` → `LEGACY_REVIEW_UNRESOLVED`
- 검토 후 document change token 변경 → `BLOCKED`
- `REVIEW_REQUIRED` 1건 이상 → purge manifest
  `LEGACY_REVIEW_INCOMPLETE`, `BLOCKED`

## STEP 8 migration 방식

구현:

- `lib/test-data/legacy-tag-migration.ts`
- `scripts/test-data/migrate-legacy-tags.mjs`
- npm script: `migrate:legacy-test-tags`

기본 mode는 `DRY_RUN`이다. apply에는 다음을 모두 요구한다.

- `--apply`
- status가 `READY`인 review manifest
- exact `--institution-id`
- 반복 가능한 exact `--document-path`
- review manifest project ID와 `--expected-project` 일치
- review manifest environment와 explicit `--target-environment` 일치
- 문서별 `CONFIRMED_TEST`/`APPROVED` review record
- 검토 시점 change token 일치
- 한 번에 최대 100개
- master path, explicit production, cross-institution 문서 제외
- production에서
  `LEGACY_TEST_DATA_TAGGING_PRODUCTION_ENABLED=true`
- production exact `--confirm-production <institutionId>`

변경 preview는 기존 전체 payload를 출력하지 않고 다음 필드의 before/after만
표시한다.

- `dataClassification: LEGACY_TEST`
- `testData: true`
- `legacyReviewId`
- `reviewedAt`
- `reviewedBy`

동일 marker가 있으면 `NOOP`로 처리한다. `PRESERVE` 원본 문서는 수정하지 않고
review control-plane에만 결정을 유지한다. 이번 단계에서는 offline fixture
dry-run만 실행했고 Firebase apply는 실행하지 않았다.

## STEP 8 정리 가능 판정

다음을 모두 충족해야 `READY`다.

- 모든 resource가 `CONFIRMED_TEST` 또는 `PRESERVE`
- `REVIEW_REQUIRED`와 `UNRESOLVED` 0건
- preserve 고객 account 0건
- 실제/test 혼재 없음
- confirmed 사용자에 대한 Auth target 확정
- source가 confirmed인 Storage exact object 확정
- 실제 master 보존 필드 확인
- demo master인 경우 reset field 확인
- cross-institution/broken reference 없음
- candidate 최대 건수 이하

하나라도 충족하지 않으면 reason code와 함께 `BLOCKED`다. 실제 master는
tagging 또는 purge target이 아니다.

## STEP 8 남은 수동 검토

- 운영 Firebase inventory를 수행하지 않았으므로 실제 농협 1,109개의 현재
  계정·포인트·문의·Auth·Storage count는 `NOT_ASSESSED`
- 과거 smoke는 실행 시 농협을 동적으로 선택해 Git만으로 exact
  institutionId를 복원할 수 없음
- Git에서 확인한 문자열 pattern만으로 후보를 확정하지 않음
- 운영 적용 전 exact seed log/manifest/UID/document ID와 별도 change ticket
  검토 필요

상세 근거와 실행 전 승인사항은
`docs/legacy-test-data-review-report.md`에 기록했다.

## STEP 8 테스트 결과

- `npm run test:test-data-scan`: **통과 — 48 tests**
  - STEP 8 신규 10 tests
  - seed exact ID 강한 근거와 승인 전 `REVIEW_REQUIRED`
  - 이메일 pattern-only `REVIEW_REQUIRED`
  - 실제 데이터 `PRESERVE`
  - SUPER_ADMIN 승인과 권한 없는 승인 차단
  - migration dry-run, 미승인/cross-institution 차단
  - review item 존재 시 purge `BLOCKED`
  - 모든 검토 완료 후 `READY`
- offline migration dry-run: **통과 — update 1, blocked 0**
- `npm run typecheck`: **통과**
- `npm run lint`: **통과**
- `npm run build`: **통과**
- `npm run test:admin-rbac`: **90/91 통과**
  - 신규 legacy API를 포함한 admin page/API route guard 통과
  - 기존 `migration-seed-index.test.ts`의 `quoteAssignments` index 기대값
    불일치 1건은 STEP 8 legacy 변경과 무관하게 계속 남음

운영 Firestore migration apply와 legacy purge는 실행하지 않았다.

## STEP 8 변경 파일

신규:

- `lib/test-data/legacy-review-types.ts`
- `lib/test-data/legacy-candidate-report.ts`
- `lib/test-data/legacy-review-service.ts`
- `lib/test-data/legacy-review-api.ts`
- `lib/test-data/legacy-tag-migration.ts`
- `lib/test-data/testing/legacy-review.test.ts`
- `app/api/admin/test-data/legacy/route.ts`
- `app/api/admin/test-data/legacy/reviews/route.ts`
- `scripts/test-data/migrate-legacy-tags.mjs`
- `scripts/test-data/fixtures/legacy-tag-review.sample.json`
- `docs/legacy-test-data-review-report.md`

수정:

- `lib/test-data/purge-types.ts`
- `lib/test-data/purge-manifest.ts`
- `lib/test-data/purge-firestore-source.ts`
- `firestore.rules`
- `package.json`
- `docs/demo-cooperative-data-progress.md`
