# 둥기농협 및 테스트 데이터 안전 관리 설계

- 단계: STEP 2
- 상태: 정책·구조 설계
- 기준 문서:
  - `docs/demo-cooperative-data-analysis.md`
  - `docs/demo-cooperative-data-progress.md`
- 제약: 이 문서는 기능 구현이나 실제 데이터 변경을 수행하지 않는다.

## 1. 설계 목표

이 설계의 목표는 다음 불변조건을 보장하는 것이다.

1. 표시명이 정확히 `둥기농협`인 가상 농협을 실제 농협과 충돌하지 않는 안정적인 ID로 식별한다.
2. 둥기농협 사용자는 실제 고객과 동일한 가입 승인, 조직 지갑, 포인트, 질문·답변, 견적·평가 흐름을 사용한다.
3. 둥기농협 마스터는 보존하면서 연결된 고객 사용 데이터만 반복 초기화할 수 있다.
4. 실제 농협 마스터 `nonghyupMaster` 항목은 어떤 purge job에도 포함하지 않는다.
5. 실제 농협에 잘못 연결된 과거 테스트 B는 exact UID·문서 ID·Storage 경로로 승인된 경우에만 제거한다.
6. 실제 고객과 테스트 데이터가 혼재하면 자동 APPLY를 차단한다.
7. 이름, 농협명, 이메일, 질문 제목 같은 표시 문자열은 후보 탐색에만 사용한다.
8. SCAN과 DRY_RUN은 대상 Firestore, Auth, Storage를 변경하지 않는다.
9. APPLY는 활성 SUPER_ADMIN의 명시적 승인과 production 안전 플래그가 있을 때만 서버에서 수행한다.
10. Firestore, Auth, Storage의 부분 실패를 같은 `purgeJobId`로 재개할 수 있어야 한다.

현재 구조상 실제 농협 A는 `lib/platform.ts`의 코드 배열이고, `organizations/{cooperativeId}`는 지갑·구성원 사용 데이터 B다. 이 구분을 설계 전반에서 유지한다.

## 2. 둥기농협 마스터 정의

### 저장 위치

실제 1,109개 농협 마스터 배열에 테스트 항목을 섞지 않고, 서버 전용 Firestore 컬렉션을 별도로 둔다.

- 컬렉션: `demoCooperativeMaster`
- 문서 ID: `demo-dunggi-nh`
- 역할: 테스트 전용 농협 A
- client read/write: 금지
- 조회: 서버의 농협 master resolver를 통해 안전한 필드만 반환

분리 이유:

- 실제 마스터 코드와 테스트 마스터의 생명주기를 분리한다.
- 실제 농협 코드 범위 `coop-*`와 충돌하지 않는다.
- production real master를 seed나 reset 과정에서 수정하지 않는다.
- deterministic 문서 ID를 사용해 seed 재실행 시 중복 문서를 만들지 않는다.

### 제안 문서

```ts
type DemoCooperativeMasterRecord = {
  schemaVersion: 1;
  cooperativeId: "demo-dunggi-nh";
  cooperativeName: "둥기농협";
  internalCode: "DEMO_DUNGGI_NH";
  cooperativeType: "지역농협";
  sido: "테스트";
  sigungu: "테스트";
  address: "실재하지 않는 업무 테스트 전용 기관";
  status: "active";
  source: "INTERNAL_DEMO";
  dataClassification: "DEMO";
  resettable: true;
  seedVersion: 1;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};
```

`cooperativeType`은 기존 가입·표시 흐름 호환을 위한 업무 분류일 뿐 실제 지역농협임을 주장하는 코드가 아니다. 사업자등록번호, 실제 농협 코드, 실제 주소, 연락처, 자산 규모는 만들지 않는다.

사용자 화면의 농협명은 정확히 `둥기농협`으로 표시한다. 테스트 구분은 이름에 접두어를 붙이지 않고 별도의 `테스트 전용` 배지로 표시한다.

### 마스터 생명주기

- 일반 reset: `demoCooperativeMaster/demo-dunggi-nh` 보존
- 고객 사용 데이터 reset: 허용
- 마스터 delete: 이번 설계와 Phase 1~9의 범위 밖
- master delete API: 만들지 않음
- 향후 필요 시 별도 설계, 별도 SUPER_ADMIN 이중 승인, 참조 0건 검증을 요구

## 3. 내부 식별값

### 확정 식별값

- 표시명: `둥기농협`
- `cooperativeId`: `demo-dunggi-nh`
- Firestore master 문서 ID: `demo-dunggi-nh`
- 내부 코드: `DEMO_DUNGGI_NH`
- 데이터 분류: `DEMO`
- 초기화 허용: `resettable: true`
- master source: `INTERNAL_DEMO`

### 식별 규칙

- 이름은 식별키로 사용하지 않는다.
- 실제 master ID 형식인 `coop-숫자`를 사용하지 않는다.
- `internalCode`는 내부 테스트 코드이며 실제 농협 코드로 노출하거나 외부 문서에 사용하지 않는다.
- `cooperativeId`와 문서 ID는 seed version 또는 표시명 변경과 무관하게 고정한다.
- reset 허용 조건은 다음을 모두 만족해야 한다.
  - master source가 `demoCooperativeMaster`
  - `cooperativeId == "demo-dunggi-nh"`
  - `dataClassification == "DEMO"`
  - `resettable == true`
- 하나라도 불일치하면 `BLOCKED_MASTER_IDENTITY_MISMATCH`로 중단한다.

### idempotent seed

seed는 이름 검색이나 auto ID를 사용하지 않고 정확한 문서 ID를 transaction으로 읽는다.

- 문서가 없으면 schemaVersion 1로 생성
- 같은 ID·분류·internalCode면 immutable 필드를 검증한 뒤 알려진 seedVersion만 갱신
- 같은 ID에 `PRODUCTION` 또는 다른 internalCode가 있으면 덮어쓰지 않고 실패
- 다른 문서에서 같은 internalCode가 발견되면 실패
- production 자동 seed 금지
- 실행 시 expected Firebase project ID와 명시적 확인 필요

## 4. 테스트 데이터 메타데이터

### 공통 타입

모든 컬렉션에 큰 메타데이터 객체를 복제하지 않는다. 직접적인 테스트 root에는 전체 metadata를, 파생 문서에는 최소 lineage를 둔다.

```ts
type DataClassification = "PRODUCTION" | "DEMO";

type TestDataMetadata = {
  scenarioId: string;
  sourceInstitutionId: string;
  origin: "SIGNUP" | "SEED" | "USER_ACTION" | "DERIVED" | "LEGACY_APPROVAL";
  rootEntityId: string;
  seedVersion?: number;
  seededBy?: string;
  createdBy: string;
  createdAt: string;
};
```

### Tier 1 — root 문서

다음 root에는 전체 필드를 기록한다.

- `users`
- `organizations`
- `consultRequests`
- 독립적으로 생성되는 `auditQuoteRequests`
- `quoteRequests`
- `auditEvaluationCases`
- seed가 직접 생성하는 문서

필드:

- `dataClassification: "DEMO"`
- `testMetadata: TestDataMetadata`

`createdAt`·`createdBy`가 기존 문서에 이미 있으면 기존 필드를 유지하고 metadata에는 stable actor ID만 기록한다. 이메일이나 이름을 provenance로 복제하지 않는다.

### Tier 2 — 파생 문서

포인트 원장, answer view/rating, 답변, assignment, quote, report 같은 파생 문서는 다음 최소 필드를 사용한다.

- `dataClassification: "DEMO"`
- `testScenarioId`
- `sourceInstitutionId`
- 기존 참조 필드: `uid`, `requestId`, `quoteRequestId`, `caseId` 등

전체 `TestDataMetadata`는 root에서 추적하고 파생 문서에는 중복하지 않는다.

### Auth와 Storage

Firebase Auth에는 임의 애플리케이션 필드를 안정적으로 검색할 수 없으므로 별도 registry를 사용한다.

- `testAuthSubjects/{authUid}`
  - `primaryUserUid`
  - `provider`: `password | phone`
  - `dataClassification`
  - `testScenarioId`
  - `sourceInstitutionId`
  - `createdAt`
- Storage object custom metadata:
  - `dataClassification=DEMO`
  - `testScenarioId`
  - `sourceInstitutionId`
  - 가능한 경우 `ownerUid`, `requestId`, `quoteId`, `caseId`

Auth registry와 Storage metadata는 단독 삭제 근거가 아니다. Firestore root lineage와 함께 검증한다.

### 시간과 actor

- 시간: server timestamp 또는 서버 생성 ISO instant
- `createdBy`, `seededBy`: UID 또는 고정 service principal ID
- 저장 금지: 비밀번호, token, raw phone, raw email, 질문 본문

## 5. 테스트 데이터 판정 규칙

### 판정 결과

```ts
type TestDataDecision =
  | "DEMO_CONFIRMED"
  | "LEGACY_CONFIRMED"
  | "CANDIDATE_ONLY"
  | "PRODUCTION"
  | "MIXED"
  | "BLOCKED";
```

### 우선순위

1. 명시적 metadata
   - `dataClassification == "DEMO"`
   - 또는 기존 호환용 `testData == true`
   - 서버가 기록한 source institution과 lineage가 일치해야 함
2. 승인된 `testScenarioId`
   - `testDataScenarios/{scenarioId}.status == "APPROVED"`
   - 대상 institution, 허용 collection, 기간, seed version이 일치해야 함
3. finalized manifest의 exact ID
   - canonical manifest hash가 유효하고 만료되지 않아야 함
4. 관리자 검토로 확정된 legacy 데이터
   - `legacyTestDataClassifications`의 APPROVED exact IDs
5. 이름·이메일·제목 pattern
   - `CANDIDATE_ONLY`
   - SCAN 결과에만 표시
   - DRY_RUN 삭제 목록과 APPLY에는 포함 금지

### 충돌 우선 규칙

- 어떤 경로에서도 `PRODUCTION` metadata가 나오면 자동 삭제 금지
- 같은 organization에 미분류 또는 production UID가 있으면 `MIXED`
- parent는 DEMO인데 child가 다른 customer UID를 참조하면 `BLOCKED`
- marker가 없다는 이유로 PRODUCTION 또는 DEMO로 추정하지 않고 `UNKNOWN`으로 취급
- client가 제출한 marker만으로 확정하지 않는다. 서버 resolver가 master와 scenario를 재검증한다.

### 승인된 scenario

`testDataScenarios/{scenarioId}` 제안 필드:

- `schemaVersion`
- `scenarioId`
- `sourceInstitutionId`
- `dataClassification`
- `allowedCollections`
- `seedVersion`
- `status: DRAFT | APPROVED | REVOKED`
- `approvedBy`, `approvedAt`
- `expiresAt`

production에서는 만료되지 않은 APPROVED scenario만 사용한다.

## 6. 보존 대상

### A. 실제 농협 마스터

항상 보존:

- `lib/platform.ts`의 실제 `nonghyupMaster` 항목
- `cooperative_id`
- 이름, 유형, 지역, 주소
- source, updated_at, status
- 향후 추가될 연락처·자산 규모 등 기본정보

실제 마스터는 manifest target 타입으로 직렬화할 수 없게 타입 단계에서 제외한다.

### B. 둥기농협 마스터

기본 보존:

- `demoCooperativeMaster/demo-dunggi-nh`
- 내부 ID, internalCode, 표시명, 분류, resettable

일반 APPLY는 이 문서를 read/verify만 하며 delete 또는 update하지 않는다.

### C. 실제 고객·공용 데이터

기본 보존:

- production 또는 unknown 사용자와 활동
- 실제 UID가 포함된 organization
- 공용 `faqs`, CMS 문서·revision·asset
- `partners`, partner Auth/user, partner logo
- 다른 고객이 공유하는 답변·견적·평가 config·표준 견적 문서
- purge 자체의 control-plane audit log

## 7. 삭제 대상

삭제 가능 조건은 manifest item이 `DEMO_CONFIRMED` 또는 `LEGACY_CONFIRMED`이고 혼재 blocker가 없는 경우다.

### 고객·조직 B

- 테스트 Firebase Auth password user
- 별도로 생성된 phone provider Auth user
- `testAuthSubjects`
- `users/{uid}`
- 테스트 전용 `organizations/{cooperativeId}`
- 테스트 전용 membership 역할의 `organizations.users[]`
- inline consent와 business card reference

### 포인트

- `pointLedger`
- `point_transactions`
- test-only organization의 `walletBalance`
- organization 단위 charged `answerViews`

테스트 전용 organization이면 organization 문서를 마지막에 삭제한다. 실제 농협 B를 테스트 전 상태로 되돌리는 경우에도 실제 고객이 0명이고 모든 B가 legacy test로 확정된 경우에만 문서를 삭제한다.

### 문의·답변

- `consultRequests`
- 후속 질문
- `answers`
- `answerViews`
- `answerRatings.comment`
- 테스트 질문 전용 `partnerAssignments`
- 테스트 질문 전용 `partnerAnswerDrafts`
- 상담 첨부 Storage

### 견적·평가·알림

- `quoteRequests`, `quoteAssignments`, `quotes`, `quoteEmailDeliveries`
- 테스트 접수의 `auditQuoteRequests`
- 해당 request를 가리키는 idempotency, dedup, rate limit, notification
- 해당 case의 평가 sessions, tokens, uploads, parsing, corrections, confirmations, reports, audit logs
- 견적 PDF와 평가 Storage object

### 기존 테스트 감사 로그

- 테스트 root를 exact target으로 참조하는 기존 `auditLogs`
- 테스트 case에 종속된 `auditEvaluationAuditLogs`

이번 purge job의 새 감사 로그는 삭제 대상에 포함하지 않는다. 최종 감사 이벤트는 업무 데이터와 분리된 append-only Cloud Logging sink 또는 동등한 외부 운영 로그에 남기고, Firestore job 문서는 재개를 위한 최소 상태만 가진다.

## 8. 가입상태 초기화 대상 필드

### 현재 실제 마스터

STEP 1에서 확인한 실제 master에는 다음 필드가 없다.

- `isRegistered`
- `signupStatus`
- `claimedBy`
- `ownerUid`
- `customerId`
- `tenantId`
- `membershipId`
- `registeredAt`
- `activatedAt`
- `registrationEmail`

따라서 존재하지 않는 가입 연결 필드를 실제 master에 새로 추가하거나 null로 초기화하지 않는다.

### 현재 구조의 실질적 복원

가입 가능 상태 복원은 B를 통해 수행한다.

- 테스트 email Auth 삭제 → 이메일 중복 차단 제거
- 테스트 phone Auth 삭제 → phone orphan 제거
- `users/{uid}` 삭제 → 가입 profile 제거
- 테스트 문의·견적·평가·파일 삭제
- 두 포인트 원장 삭제
- 테스트 전용 `organizations/{cooperativeId}` 삭제

현재 가입 API는 organization 존재로 신규 가입을 차단하지 않는다. organization 삭제는 “다음 승인 시 최초 조직” 판정과 100,000P 최초 보너스를 정상화하기 위해 필요하다.

### 실제 농협 복원 조건

- 실제 master A: 변경 없음
- 실제 고객 UID 수: 0
- 남은 production/unknown 사용 데이터: 0
- 남은 point row: 0
- 남은 Auth test subject: 0
- 남은 Storage target: 0
- 조건 충족 시 예상 상태: `AVAILABLE` — 계산된 DRY_RUN 결과이며 master에 저장하지 않음

실제 고객이 하나라도 있으면 first-organization 상태로 복원하지 않고 `MIXED/BLOCKED`로 처리한다.

## 9. SCAN·DRY_RUN·APPLY 흐름

### SCAN

목적: 후보와 graph를 읽기 전용 탐색

- 입력: project ID, target `cooperativeId`, 선택적 scenario ID
- exact ID, metadata, 참조 필드로 graph 확장
- pattern은 후보 힌트로 별도 표시
- production/unknown/mixed 데이터와 blocker 표시
- 어떠한 Firestore/Auth/Storage/control-plane write도 하지 않음
- 결과는 ephemeral response 또는 관리자 다운로드 artifact

상태:

- `CLEAN`
- `CANDIDATES_FOUND`
- `MIXED`
- `BLOCKED`

### DRY_RUN

목적: 실제 APPLY 대상과 변경 전후를 확정

- SCAN 후보 중 판정 규칙을 통과한 item만 선택
- Firestore path, Auth UID/provider, Storage bucket/path/generation 목록 생성
- 문서 수, Auth 수, Storage 수·bytes 계산
- organization users·wallet 전후 예상값 계산
- 가입상태 예상값 `AVAILABLE | UNCHANGED | BLOCKED` 표시
- 최대 삭제 제한 검증
- canonical JSON manifest와 SHA-256 hash 생성
- 어떠한 Firestore/Auth/Storage/control-plane write도 하지 않음
- manifest에 PII·질문 본문·파일 내용 포함 금지

DRY_RUN은 짧은 만료시간을 가진다. 기본 15분 후에는 stale로 처리하고 다시 실행한다.

### APPLY

목적: 승인된 immutable manifest만 실행

1. SUPER_ADMIN, recent re-auth, production flag를 검증한다.
2. DRY_RUN manifest hash와 확인 문구를 검증한다.
3. 첫 transaction에서 immutable manifest, purge job, institution lock을 control-plane에 저장한다.
4. read version/updateTime과 Storage generation을 재검증한다.
5. 하나라도 변했으면 target mutation 전에 `BLOCKED_STALE_MANIFEST`로 중단한다.
6. 단계별 삭제를 수행한다.
7. item별 성공·실패·not-found를 기록한다.
8. 최종 가입상태 검증과 최소 감사 로그를 저장한다.

APPLY는 cron, 배포 hook, production seed, 앱 시작 시 자동 실행하지 않는다.

## 10. 삭제 manifest 구조

```ts
type PurgeManifest = {
  schemaVersion: 1;
  manifestId: string;
  manifestHash: string;
  mode: "DRY_RUN";
  projectId: string;
  environment: "development" | "staging" | "production";
  generatedAt: string;
  expiresAt: string;
  generatedByUid: string;
  target: {
    cooperativeId: string;
    cooperativeName: string;
    masterSource: "REAL_STATIC_MASTER" | "DEMO_MASTER";
    dataClassification: "PRODUCTION" | "DEMO";
    resettable: boolean;
  };
  policyVersion: string;
  scenarioIds: string[];
  decision: "READY" | "MIXED" | "BLOCKED";
  blockers: Array<{ code: string; resourceIdHash?: string }>;
  limits: {
    firestoreDocuments: number;
    authSubjects: number;
    storageObjects: number;
    storageBytes: number;
  };
  counts: {
    firestoreDocuments: number;
    authSubjects: number;
    storageObjects: number;
    storageBytes: number;
  };
  firestoreTargets: FirestoreTarget[];
  authTargets: AuthTarget[];
  storageTargets: StorageTarget[];
  restorationPlan: RestorationPlan;
};
```

### Firestore target

- document path
- collection
- document ID
- updateTime 또는 version precondition
- 판정 근거 코드
- root entity ID
- dependency stage
- delete 또는 final organization reconcile action

문서 payload는 넣지 않는다.

### Auth target

- UID
- provider ID
- registry document path
- primary user UID
- disabled 여부
- 판정 근거

raw email, phone, token은 넣지 않는다.

### Storage target

- bucket
- full path
- generation
- size
- content type
- source Firestore path
- 판정 근거

signed URL과 파일 내용은 넣지 않는다.

### restoration plan

- organization action: `DELETE_TEST_ONLY | RECONCILE | NONE | BLOCKED`
- 사용자 수 before/after
- wallet before/after
- point row before/after
- 예상 가입 상태
- master mutation: 항상 `NONE`

### control-plane 컬렉션

- `testDataPurgeManifests/{manifestId}`
- `testDataPurgeJobs/{purgeJobId}`
- `testDataPurgeLocks/{targetHash}`
- `testDataPurgeAuditLogs/{logId}` — job 재개용 최소 상태·요약
- `testDataScenarios/{scenarioId}`
- `legacyTestDataClassifications/{classificationId}`

모두 client read/write를 deny하고 Admin SDK API만 사용한다.

삭제 작업 자체의 최종 감사 원본은 위 Firestore collection이 아니라 별도 append-only 운영 로그에 기록한다. 두 곳 모두 질문 본문, 이메일, 전화번호, signed URL을 저장하지 않는다.

## 11. 삭제 순서

현재 참조 구조에 맞춘 APPLY 순서다.

1. **manifest 저장·잠금**
   - canonical manifest 저장
   - `projectId + cooperativeId` deterministic lock 획득
   - `purgeJobId` 생성 또는 idempotency key로 기존 job 재사용
2. **쓰기 차단**
   - target Auth user disable
   - refresh token revoke
   - purge lock을 가입·문의·견적 write API가 확인
3. **세션·접근권한**
   - `auditEvaluationSessions`
   - `auditEvaluationAccessTokens`
   - 평가 rate limit과 upload intent
4. **감사 평가 leaf와 Storage**
   - manifest에 기록한 quarantine/original/report/temp object를 generation precondition으로 삭제
   - object 성공 후 corrections, confirmations, extraction, parsing, normalized quote, document, report run 삭제
   - case mapping과 case는 마지막
5. **견적 leaf와 Storage**
   - `quoteEmailDeliveries`
   - quote PDF object
   - `quotes`
   - `quoteAssignments`
   - `quoteRequests`
6. **질문·답변 leaf와 Storage**
   - `answerRatings`
   - 사용자·organization `answerViews`
   - 상담 첨부 object
   - 테스트 전용 partner draft/assignment
   - `answers`
   - 후속 `consultRequests`
   - 부모 `consultRequests`
7. **감사 접수 보조 문서**
   - notification
   - idempotency
   - email dedup
   - request에 귀속됨이 증명된 rate limit
   - `auditQuoteRequests`
8. **기존 테스트 audit/activity**
   - 테스트 target을 exact ID로 참조하는 기존 audit log
   - purge job의 새 audit log는 제외
9. **포인트**
   - `pointLedger`
   - `point_transactions`
   - 잔여 answer view와 organization 잔액의 일치 확인
10. **사용자 파일**
    - business card object를 generation precondition으로 삭제
11. **Firebase Auth**
    - 모든 앞 단계가 성공한 UID만 email/password·phone Auth 삭제
    - not-found는 idempotent 성공
12. **고객 profile·membership**
    - `users/{uid}` 삭제
    - `testAuthSubjects` 삭제
13. **organization B와 가입상태 복원**
    - test-only면 `organizations/{cooperativeId}` 삭제
    - 혼재면 자동 reconcile하지 않고 BLOCKED
    - 실제·둥기 master는 변경하지 않음
14. **검증·감사**
    - target count 0
    - 예상 가입상태 확인
    - 최소 purge audit log 저장
    - lock 해제

Storage는 path-bearing 문서보다 먼저 삭제한다. immutable manifest가 path를 이미 보존하므로 object 삭제 실패 시 parent 문서를 남겨 재시도할 수 있다.

## 12. Firebase Auth 정리 방식

### 미래 테스트 가입

- 이메일 Auth UID와 phone Auth UID를 서버가 모두 확인한다.
- 두 UID를 `testAuthSubjects`에 각각 등록한다.
- registry는 같은 `primaryUserUid`, scenario, institution을 가리킨다.
- 이름, 이메일, 전화번호로 Auth 사용자를 역추정하지 않는다.
- 가능하면 Phase 3에서 phone credential을 email account에 link하는 흐름을 검토한다. link 전환 전까지는 두 UID cleanup을 기본으로 한다.

### SCAN

- registry UID로 `getUser(uid)` 조회
- provider와 disabled 상태 확인
- Firestore user·scenario·institution과 교차검증
- registry가 없는 legacy Auth는 자동 삭제 대상이 아님

### APPLY

- disable
- refresh token revoke
- 다른 데이터 정리 완료 후 delete
- `auth/user-not-found`는 성공으로 기록
- UID provider가 manifest와 다르거나 새 provider가 추가되면 stale/block
- 삭제 실패 시 user profile과 organization finalization을 진행하지 않고 PARTIAL 상태로 유지

### 이메일 재가입 복원

Firestore `users`와 이메일 Auth가 모두 없어야 `/api/auth/check-email`이 available을 반환한다. 두 곳 중 하나라도 남으면 purge job을 성공 처리하지 않는다.

## 13. Storage 정리 방식

### 식별

다음 순서로 path를 확보한다.

1. Firestore path field
2. approved manifest exact path
3. object custom metadata와 root ID 교차검증

prefix list 또는 파일명 pattern만으로 delete하지 않는다.

### 안전한 삭제

- manifest에 bucket, path, generation, size 기록
- APPLY에서 generation 일치 조건 사용
- generation이 달라지면 새 파일로 간주하고 BLOCKED
- object not-found는 idempotent 성공
- object 삭제 성공 후 path-bearing Firestore 문서 삭제
- Storage delete 실패 시 해당 parent graph 삭제 중단

### 대상 경로

- `business-cards/{uid}/...`
- `consult-attachments/{uid}/{requestId}/...`
- `quotes/{quoteId}/...`
- `audit-evaluation/originals/{caseId}/...`
- `audit-evaluation/quarantine/{caseId}/...`
- `audit-evaluation/reports/{caseId}/...`
- `audit-evaluation/temp/{caseId}/...`

CMS asset와 partner asset는 고객 테스트 cleanup 대상이 아니다.

## 14. 부분 실패 처리

### job 상태

- `PREPARING`
- `LOCKED`
- `DISABLING_ACCESS`
- `DELETING_ACTIVITY`
- `DELETING_STORAGE`
- `DELETING_AUTH`
- `FINALIZING`
- `SUCCEEDED`
- `PARTIAL`
- `FAILED`
- `BLOCKED`

### item 상태

- `PENDING`
- `DELETED`
- `NOT_FOUND`
- `FAILED_RETRYABLE`
- `BLOCKED_STALE`
- `SKIPPED_DEPENDENCY`

### 처리 원칙

- 같은 idempotency key는 같은 `purgeJobId`를 반환한다.
- item별 완료 상태를 저장하고 재실행 시 `DELETED/NOT_FOUND`를 건너뛴다.
- child 실패 시 parent와 organization을 삭제하지 않는다.
- Firestore updateTime 또는 Storage generation 불일치는 재탐색하지 않고 job을 BLOCKED로 전환한다.
- APPLY 도중 새 대상을 자동으로 추가하지 않는다. 새 DRY_RUN이 필요하다.
- lock은 lease와 owner job ID를 가지며 만료 후 SUPER_ADMIN이 상태를 확인하고 재개할 수 있다.
- 최대 retry 수를 넘기면 PARTIAL로 종료하고 수동 조치 목록을 제공한다.

### 포인트 finalization

포인트 두 원장과 organization final state는 마지막 bounded Firestore transaction에서 검증한다. transaction 전에 잔여 production/unknown row가 발견되면 중단한다.

## 15. 혼재 데이터 처리

### 혼재 판정

다음 중 하나면 `MIXED`다.

- 같은 `organizations/{cooperativeId}.users[]`에 production/unknown UID가 존재
- test request가 production/unknown answer, partner draft, quote를 공유
- point row의 UID 또는 request가 manifest root 밖
- case 또는 Storage object가 다른 institution/scenario를 참조
- organization 잔액을 test row만 제거하여 결정적으로 재계산할 수 없음

### 정책

- SCAN: 혼재 경로와 blocker만 보고
- DRY_RUN: deletion target을 확정하지 않고 `BLOCKED`
- APPLY: 실행 금지
- 이름·이메일 pattern으로 혼재 여부를 해소하지 않음

### legacy 수동 검토

`legacyTestDataClassifications`에 다음을 기록한다.

- exact Firebase UID
- exact Firestore document path
- exact Storage path/generation
- evidence code와 reviewer note
- `APPROVED | REJECTED`
- reviewer UID와 시각
- production에서는 서로 다른 두 SUPER_ADMIN 승인 권고

승인 후에도 새 DRY_RUN에서 graph 일관성을 다시 확인한다. legacy approval은 실제 master 삭제 권한을 주지 않는다.

초기 버전에서는 mixed organization의 부분 wallet reconcile을 자동화하지 않는다. 전체 graph가 test-only로 확정되거나 별도 수동 정합성 계획이 승인될 때까지 BLOCKED로 유지한다.

## 16. 권한 및 확인 절차

### 권한

- API: 활성 `super_admin`만 허용
- 일반 `operations_manager`, capability allow override, 이메일 allowlist만으로 허용하지 않음
- server에서 `isSuperAdmin(context)` 재검증
- UI 숨김은 보조 수단이며 API 권한 검사가 최종 경계
- SCAN, DRY_RUN, APPLY 모두 SUPER_ADMIN 필요

### recent authentication

- APPLY 시 최근 인증 시각 10분 이내 요구
- session·token·profile role 일치 검증
- production에서는 initiator와 approver를 분리하는 2인 승인 권고

### 확인 화면

반드시 표시:

- 농협명과 내부 `cooperativeId`
- master source와 data classification
- Firestore 문서 수
- Auth identity 수와 provider별 수
- Storage object 수와 bytes
- organization users·wallet before/after
- 예상 가입 상태
- blocker와 skipped item
- manifest hash 앞·뒤 일부

확인 문구:

- 둥기농협: `둥기농협 demo-dunggi-nh 테스트 데이터 초기화`
- 실제 농협 legacy: `{정확한 농협명} {cooperativeId} 승인된 테스트 데이터 삭제`

문구는 server가 생성하고 exact match한다. 보안 문구 형식은 CMS에서 변경할 수 없다. 설명·도움말만 CMS 편집 대상으로 둔다.

## 17. 프로덕션 안전장치

### 필수 gate

- `TEST_DATA_PURGE_ENABLED=true`
- `TEST_DATA_PURGE_ALLOWED_PROJECT_ID`가 Firebase Admin project ID와 exact match
- production 추가 승인 flag 또는 승인 ticket ID
- target institution 한 개만 허용
- manifest 미만료
- READY decision
- blocker 0
- exact 확인 문구
- recent re-auth
- SUPER_ADMIN
- production 2인 승인 적용 권고

### 최대 삭제 제한 기본값

- 한 job당 institution: 1
- Auth identity: 20
- Firestore document: 2,000
- Storage object: 500
- Storage bytes: 5 GiB

한도를 넘으면 split APPLY로 우회하지 않고 BLOCKED 후 정책 검토한다. production에서 환경변수만으로 한도를 임의 상향하지 않고 코드·검토를 거친다.

### 영향 범위

- manifest에 없는 문서·UID·path는 절대 삭제하지 않음
- collection 전체 delete 금지
- prefix-only Storage delete 금지
- `nonghyupMaster`와 `demoCooperativeMaster` delete 금지
- 다른 `cooperativeId` 참조 발견 시 중단
- production 자동 실행, cron, deploy hook, startup migration 금지
- 기능 flag 기본값 false

### 감사 로그

별도 append-only 운영 로그와 `testDataPurgeAuditLogs` job summary에는 최소 정보만 보존한다. 운영 로그는 purge service account가 write-only로 전송하고 cleanup job이 삭제할 권한을 갖지 않는다.

- purgeJobId, manifestHash
- target cooperativeId
- actor/approver UID
- mode, 시각, 상태
- collection별 count
- error code와 retry count
- restoration result

저장 금지:

- 이름·이메일·전화번호
- 질문·답변 본문
- 동의 내용
- 파일 내용·signed URL

## 18. 롤백 또는 복구 전략

물리 삭제는 완전한 transaction rollback이 불가능하다. 이 설계의 기본 복구 방식은 “되돌리기”보다 “중단·재개·재생성”이다.

### 삭제 전

- immutable manifest와 precondition 확보
- 실제 농협 legacy cleanup은 승인된 Firestore backup과 Storage versioning/backup 존재 여부 확인
- backup 위치를 purge audit에 직접 기록하지 않고 backup job ID만 기록
- Auth password는 복구할 수 없으므로 Auth delete는 모든 활동·Storage 정리 후 수행

### 실행 중

- child 실패 시 parent 보존
- Auth는 먼저 disable만 하고 마지막 단계에 delete
- generation/updateTime mismatch 시 즉시 중단
- 같은 purgeJobId로 retry

### 삭제 후

- 둥기농협: master와 approved scenario에서 테스트 데이터를 다시 seed/가입하여 복구
- 실제 농협: master는 변경되지 않으므로 새 고객이 정상 가입
- Auth delete 후 계정 자체를 복구해야 하는 경우 기존 password 복원은 불가능하며 새 가입 절차가 필요
- broad production backup restore는 다른 고객 데이터를 덮을 수 있으므로 자동화하지 않음

### 보상 처리

- organization finalization 전 실패: organization과 user profile을 남기고 재시도
- Auth delete 후 user profile 삭제 실패: account는 disabled/deleted 상태이므로 안전하며 profile 삭제를 재시도
- organization 삭제 실패: 신규 최초 보너스 검증을 성공 처리하지 않고 PARTIAL 유지
- purge audit write 실패: job을 성공 처리하지 않고 audit write 재시도

## 19. 테스트 전략

### 단위 테스트

- ID·internalCode 불변성
- seed idempotency와 collision 거부
- 판정 우선순위 1~5
- production marker 충돌
- pattern-only 후보가 APPLY에 들어가지 않는지
- mixed graph BLOCKED
- manifest canonical hash
- max limit
- confirmation phrase exact match

### Firestore emulator

- real master를 target으로 만들 수 없는지
- demo master가 reset 후 남는지
- leaf-before-parent delete
- updateTime stale 차단
- point 두 원장과 organization final transaction
- purge lock과 중복 요청
- 부분 실패 재개
- Firestore 서브컬렉션 inventory

### Auth emulator

- password UID와 phone UID registry
- disable → revoke → delete 순서
- 한쪽 실패 시 PARTIAL
- not-found idempotency
- cleanup 후 이메일 재가입 가능

### Storage emulator

- exact path와 generation match
- generation mismatch 차단
- object 실패 시 parent 문서 보존
- signed URL 대상 object 삭제
- CMS/partner asset 비대상 검증

### 통합 테스트

- 둥기농협 seed 재실행 시 master 1개
- 실제 UI에서 둥기농협 선택·가입·승인
- 최초 110,000P와 추가 사용자 10,000P
- 질문·답변·열람·평가·견적·보고서·첨부 생성
- SCAN → DRY_RUN → APPLY
- master 보존, B 0건, Auth/Storage 0건
- reset 후 동일 흐름 재가입

### 실제 농협 legacy 시나리오

- exact legacy approval이 없는 후보는 CANDIDATE_ONLY
- test-only graph는 master 보존 후 B 정리·AVAILABLE
- 실제 UID 한 명이 섞이면 MIXED/BLOCKED
- 같은 이름의 다른 `cooperativeId` 무영향

### production 검증

- production에서는 자동 APPLY 테스트 금지
- SCAN/DRY_RUN과 gate 실패 테스트만 수행
- 허용된 별도 테스트 프로젝트에서 APPLY end-to-end 수행
- `npm run typecheck`, lint, 관련 unit/emulator test, production build 통과
