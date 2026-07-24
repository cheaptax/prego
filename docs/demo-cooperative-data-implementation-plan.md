# 둥기농협 및 테스트 데이터 관리 구현 계획

- 단계: STEP 2
- 목적: STEP 3 이후의 구현 범위와 순서를 정의
- 현재 수행 여부: 미수행
- 기준 설계: `docs/demo-cooperative-data-design.md`

## 공통 구현 원칙

- 각 Phase는 별도 검토 가능한 변경 단위로 진행한다.
- 실제 농협 master `nonghyupMaster`는 삭제·초기화하지 않는다.
- 둥기농협 master와 고객 사용 데이터의 저장 위치·권한을 분리한다.
- production에서 seed 또는 APPLY를 자동 실행하지 않는다.
- 이름·이메일 pattern은 SCAN 후보에만 사용한다.
- 실제 데이터와 혼재하면 자동 정리하지 않는다.
- 각 Phase 완료 시 typecheck, lint, 관련 unit/emulator test를 실행한다.
- 현재 작업 트리에 대규모 미커밋 변경이 있으므로 구현 전 기준 branch와 포함 범위를 다시 고정한다.

## Phase 1. 테스트 데이터 공통 타입과 판정 함수

### 수정 파일

- `lib/firebase/schema.ts`
  - `DataClassification`, test metadata 적용 필드 추가
  - purge control-plane record 타입과 기존 record의 선택적 metadata 연결
- `lib/admin/rbac.ts`
  - 관리 화면 표시용 `testData:read`, `testData:purge` permission 등록
  - 두 permission은 `super_admin` preset에만 포함
- `firestore.rules`
  - 신규 control-plane collection의 client write 차단

### 신규 파일

- `lib/test-data/constants.ts`
- `lib/test-data/types.ts`
- `lib/test-data/policy.ts`
- `lib/test-data/classification.ts`
- `lib/test-data/validation.ts`
- `lib/test-data/testing/classification.test.ts`
- `lib/test-data/testing/policy.test.ts`

### 구현 내용

- `PRODUCTION | DEMO` 분류와 root/derived metadata 타입 정의
- `DEMO_CONFIRMED | LEGACY_CONFIRMED | CANDIDATE_ONLY | PRODUCTION | MIXED | BLOCKED` 판정 결과 정의
- 명시적 marker → approved scenario → manifest → legacy approval → pattern 후보 순서 구현
- marker 부재를 DEMO로 추정하지 않는 fail-closed 정책 구현
- master document를 purge target으로 표현하지 못하도록 target union에서 제외
- collection별 허용 root/derived lineage 규칙 정의
- purge limit, manifest TTL, policy version 상수 정의
- API에서 permission 외에 활성 `super_admin` role을 반드시 재검증하는 guard 설계

### 기존 기능 영향

- 기존 문서에는 metadata가 없어도 읽기 가능하도록 선택 필드로 추가한다.
- marker가 없는 기존 운영 데이터는 cleanup 관점에서 `UNKNOWN`이며 삭제되지 않는다.
- 기존 가입·문의·포인트 기능의 payload와 저장 키는 바꾸지 않는다.

### 테스트 방법

- 모든 판정 우선순위 조합 unit test
- `PRODUCTION` 충돌과 marker 위조 차단 test
- pattern-only 후보의 DRY_RUN 제외 test
- non-super-admin permission override가 APPLY 권한을 얻지 못하는 test
- 기존 schema fixture 회귀 test

### 완료 조건

- 공통 타입과 runtime validation이 동일한 허용값을 사용한다.
- 실제 master를 purge target에 넣는 코드가 compile되지 않는다.
- 기존 데이터가 자동으로 DEMO 판정되지 않는다.
- `super_admin` 외 계정은 판정 API조차 실행할 수 없도록 정책이 고정된다.

### 위험

- 기존 record 타입에 필드를 필수로 추가하면 대규모 migration이 필요해질 수 있다.
- 기존 `AdminPermission` exhaustive 목록과 UI test가 깨질 수 있다.
- 여러 collection의 timestamp 형식 차이가 판정 함수로 유입될 수 있다.

### 롤백 방법

- 신규 모듈 import를 제거하면 기존 runtime 흐름은 그대로 유지된다.
- schema 신규 필드를 optional로 두어 저장된 기존 문서 rollback이 필요 없게 한다.
- 신규 permission과 rules entry를 제거하고 feature flag를 false로 유지한다.

## Phase 2. 둥기농협 마스터 seed

### 수정 파일

- `lib/platform.ts`
  - 기존 static `CooperativeRecord`를 resolver가 읽을 수 있도록 export 또는 adapter 연결
- `firestore.rules`
  - `demoCooperativeMaster` client direct access deny
- `package.json`
  - 명시적 수동 seed/verify command 등록
- `.env.example`
  - seed용 expected project ID와 enable flag 설명 추가

### 신규 파일

- `lib/cooperatives/types.ts`
- `lib/cooperatives/master-resolver.ts`
- `lib/cooperatives/demo-master.ts`
- `scripts/demo-cooperative/seed-dunggi.mjs`
- `scripts/demo-cooperative/verify-dunggi.mjs`
- `lib/test-data/testing/demo-master.test.ts`

### 구현 내용

- `demoCooperativeMaster/demo-dunggi-nh` deterministic 문서 정의
- 표시명 `둥기농협`, internalCode `DEMO_DUNGGI_NH`, classification `DEMO`, resettable `true` 적용
- 실제 static master와 demo master를 공통 view model로 normalize
- seed transaction에서 ID·internalCode·classification collision 검증
- 재실행 시 한 문서만 유지하는 idempotent set
- unknown field나 production classification이 같은 ID에 있으면 overwrite 금지
- seed와 verify에 project ID, environment, explicit confirmation 적용
- production 자동 seed 경로를 만들지 않음

### 기존 기능 영향

- 이 Phase만으로는 가입 UI에 둥기농협을 노출하지 않는다.
- 실제 `nonghyupMaster` 1,109개 항목의 ID·내용·순서는 변경하지 않는다.
- demo master collection이 없어도 기존 실제 농협 가입은 정상 동작한다.

### 테스트 방법

- Firestore emulator에서 첫 seed, 두 번째 seed, version update
- 같은 ID의 production 문서, 다른 internalCode 충돌 test
- 같은 internalCode 중복 test
- real static master snapshot hash 회귀 test
- production confirmation 누락 실패 test

### 완료 조건

- seed를 반복해도 문서 ID `demo-dunggi-nh` 하나만 존재한다.
- 실제 master 배열 diff가 없다.
- demo master direct client read/write가 거부된다.
- seed 실패 시 기존 문서를 덮어쓰지 않는다.

### 위험

- static real master와 Firestore demo master의 이중 source를 UI가 직접 다룰 수 있다.
- 잘못된 project credential로 다른 Firebase project에 seed할 수 있다.
- display field를 seed가 매번 overwrite하면 관리자 검토 이력이 사라질 수 있다.

### 롤백 방법

- resolver의 demo source를 feature flag로 비활성화한다.
- production에서 생성된 demo master는 이 cleanup 기능으로 삭제하지 않는다.
- 문서 삭제가 필요하면 별도 승인된 master lifecycle 작업으로 처리한다.

## Phase 3. 가입 흐름에서 둥기농협 지원

### 수정 파일

- `components/SignupForm.tsx`
- `app/signup/page.tsx`
- `app/api/signup/route.ts`
- `app/api/auth/check-email/route.ts`
- `app/api/admin/users/[uid]/approve/route.ts`
- `app/api/consult/route.ts`
- `app/api/me/answers/[requestId]/view/route.ts`
- `app/api/me/answers/[requestId]/rating/route.ts`
- `app/api/admin/requests/[requestId]/answer/route.ts`
- `lib/quotes/quote-requests.ts`
- 감사 견적·평가의 root/derived document 생성 service
- `storage.rules`

### 신규 파일

- `app/api/cooperatives/search/route.ts`
- `lib/test-data/context.ts`
- `lib/test-data/propagation.ts`
- `lib/test-data/auth-subject-registry.ts`
- `lib/test-data/testing/signup-propagation.test.ts`

### 구현 내용

- 가입 화면의 static direct import를 서버 농협 검색 API로 전환
- real static master와 enabled demo master를 같은 response shape로 반환
- 둥기농협 이름은 그대로 표시하고 별도 `테스트 전용` badge 제공
- signup API도 같은 server resolver로 `cooperativeId` 검증
- production에서 demo signup은 별도 `DEMO_COOPERATIVE_SIGNUP_ENABLED`가 true일 때만 허용
- 둥기농협 선택 시 server가 DEMO context를 생성하고 client marker는 신뢰하지 않음
- `users`, 승인 시 `organizations`, 포인트 두 원장에 metadata 전파
- 질문·답변·열람·평가·견적·평가 case의 기존 참조를 따라 classification과 scenario 전파
- email Auth UID와 phone Auth UID를 `testAuthSubjects`에 각각 등록
- 가능하면 phone credential을 primary email Auth user에 link하는 개선을 별도 migration 없이 신규 demo 가입부터 적용
- purge lock이 있는 institution에는 신규 가입·문의·견적 write 차단

### 기존 기능 영향

- 실제 농협 검색 결과와 선택 payload의 `cooperativeId` 의미는 유지한다.
- demo feature flag가 false이거나 demo master가 없으면 현재 실제 농협 흐름만 반환한다.
- 기존 production 문서에는 metadata를 강제로 backfill하지 않는다.
- 기존 phone/email Auth 이중 주체는 legacy로 유지하고 신규 demo부터 정확히 추적한다.

### 테스트 방법

- 실제 농협 검색·가입 회귀 test
- 둥기농협 feature flag on/off test
- forged `dataClassification` payload 무시 test
- demo signup → approval → 110,000P metadata propagation test
- 두 번째 demo user 승인 → 10,000P test
- 질문부터 report까지 lineage propagation test
- purge lock 중 write 409/423 test

### 완료 조건

- 둥기농협이 실제 고객과 같은 가입·승인 흐름을 완료한다.
- demo root와 주요 파생 문서에 query 가능한 lineage가 남는다.
- 두 Auth subject가 UID 기준으로 등록된다.
- 실제 농협 가입 동작과 포인트 정책에 회귀가 없다.

### 위험

- 기존 client-side static search를 API로 바꾸며 검색 UX·성능이 달라질 수 있다.
- metadata 전파 누락 collection이 생길 수 있다.
- phone Auth linking 변경이 기존 가입 세션 순서와 충돌할 수 있다.
- demo signup을 production에서 잘못 노출할 수 있다.

### 롤백 방법

- demo signup feature flag를 false로 전환한다.
- 검색 API는 real static master fallback을 유지한다.
- metadata 필드는 optional이므로 기존 document reader를 되돌릴 수 있다.
- Auth linking 개선은 별도 toggle로 분리한다.

## Phase 4. 테스트 데이터 scan과 manifest

### 수정 파일

- `lib/firebase/schema.ts`
  - manifest·scan result record 타입 연결
- `firestore.indexes.json`
  - metadata, cooperativeId, UID, requestId graph 조회에 필요한 index
- `firestore.rules`
  - scan/control-plane collection direct client access deny

### 신규 파일

- `lib/test-data/scan/graph-scanner.ts`
- `lib/test-data/scan/firestore-scanner.ts`
- `lib/test-data/scan/auth-scanner.ts`
- `lib/test-data/scan/storage-scanner.ts`
- `lib/test-data/scan/mixed-data-detector.ts`
- `lib/test-data/manifest/builder.ts`
- `lib/test-data/manifest/canonicalize.ts`
- `lib/test-data/manifest/limits.ts`
- `app/api/admin/test-data/scan/route.ts`
- `app/api/admin/test-data/dry-run/route.ts`
- `lib/test-data/testing/manifest.test.ts`
- `lib/test-data/testing/mixed-data.test.ts`

### 구현 내용

- collection별 실제 참조 필드를 이용한 directed graph scan
- `uid`, `cooperativeId`, `requestId`, `quoteRequestId`, `caseId` 확장
- Auth UID/provider와 Storage path/generation read inventory
- pattern 후보는 `CANDIDATE_ONLY` 목록으로 분리
- production/unknown root와 공유 child 탐지
- pre/post organization users, wallet, point row count 계산
- Firestore path·updateTime, Auth UID/provider, Storage path·generation manifest 생성
- PII와 본문을 제외한 canonical manifest와 SHA-256 hash 생성
- SCAN/DRY_RUN에서 persistent write 0건 보장
- manifest TTL과 deletion limit 검증

### 기존 기능 영향

- read-only API만 추가한다.
- target business collection, Auth, Storage를 수정하지 않는다.
- query 비용은 발생하므로 scope와 max read를 제한한다.

### 테스트 방법

- emulator fixture로 전체 graph와 orphan graph scan
- 동명 농협의 서로 다른 ID 분리 test
- email pattern만 있는 후보 제외 test
- 공유 answer/partner/config 보존 test
- mixed organization BLOCKED test
- manifest hash 재현성 test
- TTL·limit 초과 test

### 완료 조건

- 같은 snapshot 입력이 같은 canonical manifest hash를 만든다.
- manifest에 없는 resource가 APPLY 대상으로 표현되지 않는다.
- 실제 master와 다른 institution target이 0건이다.
- DRY_RUN 후 Firestore/Auth/Storage state hash가 전과 동일하다.

### 위험

- collection 누락으로 orphan이 남을 수 있다.
- collectionGroup 또는 범위 query가 production 비용을 크게 만들 수 있다.
- audit evaluation처럼 cooperativeId가 없는 graph가 request mapping에서 끊길 수 있다.
- scan 중 새 write가 발생해 manifest가 즉시 stale이 될 수 있다.

### 롤백 방법

- read-only API와 indexes를 제거한다.
- feature flag를 false로 전환한다.
- 생성된 local DRY_RUN artifact는 만료 처리한다.

## Phase 5. 데이터 정리 서버 서비스

### 수정 파일

- `lib/firebase/server.ts`
  - active SUPER_ADMIN 전용 purge guard
- `app/api/signup/route.ts`
- `app/api/consult/route.ts`
- 견적·평가 write API
  - institution purge lock 확인
- `firestore.rules`
- `firestore.indexes.json`
- `.env.example`

### 신규 파일

- `lib/test-data/purge/job-service.ts`
- `lib/test-data/purge/lock-service.ts`
- `lib/test-data/purge/firestore-purger.ts`
- `lib/test-data/purge/dependency-order.ts`
- `lib/test-data/purge/restoration.ts`
- `lib/test-data/purge/audit.ts`
- `lib/test-data/purge/idempotency.ts`
- `app/api/admin/test-data/apply/route.ts`
- `app/api/admin/test-data/jobs/[purgeJobId]/route.ts`
- `lib/test-data/testing/purge-service.test.ts`

### 구현 내용

- APPLY 첫 transaction에서 manifest, job, target lock 저장
- `requestId` 또는 idempotency key를 같은 `purgeJobId`에 매핑
- updateTime precondition 재검증
- leaf-before-parent Firestore 삭제
- child failure 시 parent skip
- test-only organization의 두 point ledger와 wallet finalization
- 실제 master와 demo master mutation을 service API에서 금지
- item별 상태와 retryable error 기록
- Firestore에는 재개용 최소 job summary 저장
- cleanup 권한과 분리된 append-only Cloud Logging sink 또는 동등한 외부 운영 로그에 최종 감사 이벤트 저장
- lock lease와 stale lock recovery
- target institution 이외 path 발견 시 즉시 BLOCKED

### 기존 기능 영향

- purge 중 선택 institution의 신규 write만 일시 차단한다.
- 다른 institution과 일반 운영 기능은 영향을 받지 않는다.
- feature flag가 false이면 APPLY endpoint는 항상 거부한다.

### 테스트 방법

- idempotent 동일 request 재실행
- concurrent APPLY 한 건만 lock 획득
- stale manifest에서 target mutation 0건
- child delete 실패 후 parent 보존
- point 원장 일부 실패 후 organization 보존
- 실제 master path injection 차단
- 다른 cooperativeId 무영향 test

### 완료 조건

- Firestore 단계가 정해진 dependency order로만 실행된다.
- 부분 실패 후 같은 purgeJobId로 안전하게 재개된다.
- 실제·demo master delete 호출이 존재하지 않는다.
- purge audit 실패 시 job을 성공으로 표시하지 않는다.

### 위험

- Firestore batch/transaction 제한 초과
- long-running request timeout
- lock이 남아 정상 write를 차단
- point ledger와 organization 사이의 마지막 transaction 충돌

### 롤백 방법

- APPLY flag를 즉시 false로 전환한다.
- lock recovery admin procedure로 남은 lock을 해제한다.
- 이미 삭제된 item은 되돌리지 않고 manifest 기반으로 재개 또는 승인된 backup에서 수동 복구한다.
- write API의 lock guard는 lock collection이 없으면 기존 동작을 유지하게 한다.

## Phase 6. Firebase Auth·Storage 정리

### 수정 파일

- `components/SignupForm.tsx`
  - demo business card object metadata 또는 서버 업로드 경로 적용
- `app/api/consult/route.ts`
- `lib/quotes/quote-storage.ts`
- `lib/audit-evaluation/upload-storage.ts`
- `lib/audit-evaluation/report-storage.ts`
- `lib/audit-evaluation/upload-identity.ts`
- `storage.rules`
- `lib/test-data/purge/job-service.ts`

### 신규 파일

- `lib/test-data/purge/auth-purger.ts`
- `lib/test-data/purge/storage-purger.ts`
- `lib/test-data/storage-metadata.ts`
- `lib/test-data/testing/auth-purger.test.ts`
- `lib/test-data/testing/storage-purger.test.ts`

### 구현 내용

- Auth registry와 provider 교차검증
- email/password와 phone subject disable·token revoke
- Firestore·Storage 선행 단계 성공 후 Auth delete
- Auth not-found idempotent 처리
- Storage custom metadata 기록
- manifest generation precondition delete
- object 성공 후 path-bearing Firestore parent 삭제 허용
- CMS·partner asset denylist와 허용 prefix 고정
- Auth/Storage item별 retry 상태를 purge job에 통합

### 기존 기능 영향

- demo upload에만 추가 metadata를 기록한다.
- 실제 고객 upload path·권한은 유지한다.
- Auth cleanup은 명시적 APPLY job 안에서만 호출된다.

### 테스트 방법

- Auth emulator의 password/phone 두 UID cleanup
- provider mismatch와 추가 provider stale 차단
- Storage emulator generation mismatch
- object delete 실패 시 parent 보존
- CMS·partner path injection 차단
- signed URL object 삭제 후 접근 실패 확인

### 완료 조건

- demo reset 후 registry·Auth UID·Storage object가 0건이다.
- 한쪽 Auth UID 실패 시 job이 PARTIAL이며 organization finalization을 하지 않는다.
- broad prefix delete API가 없다.

### 위험

- Firebase Auth delete 후 password를 복구할 수 없다.
- client upload metadata는 위조 가능하므로 단독 근거로 쓸 수 없다.
- Storage generation precondition 지원 방식이 SDK별로 다를 수 있다.
- phone Auth UID가 과거 데이터에 기록되지 않았을 수 있다.

### 롤백 방법

- Auth/Storage stage feature flag를 끄고 Firestore finalization을 중단한다.
- 삭제 전에는 disable된 Auth를 re-enable할 수 있다.
- 삭제 후에는 approved backup 또는 테스트 계정 재생성만 가능하다.
- Storage versioning이 있는 환경만 generation rollback을 수동 검토한다.

## Phase 7. 관리자 정리 UI

### 수정 파일

- `components/AdminDashboard.tsx`
- `app/admin/operations/page.tsx`
- `lib/cms/admin-operations-content.ts`
- `lib/cms/admin-operations-preview.ts`
- `lib/cms/defaults.ts`
- `lib/cms/schemas.ts`
- `lib/cms/feature-registry.ts`
- 관리자 operations 관련 style 파일

### 신규 파일

- `components/admin/TestDataCleanupPanel.tsx`
- `components/admin/TestDataManifestReview.tsx`
- `components/admin/TestDataPurgeJobStatus.tsx`
- `lib/test-data/admin-ui.ts`
- `lib/test-data/feature-flags.ts`
- `lib/test-data/testing/admin-ui.test.ts`

### 구현 내용

- SUPER_ADMIN에게만 SCAN/DRY_RUN/APPLY UI 노출
- 농협명과 내부 ID를 항상 함께 표시
- classification, master source, resettable 표시
- collection별 document count, Auth provider count, Storage object/bytes 표시
- before/after organization·wallet·가입상태 표시
- mixed/blocker와 pattern-only candidate를 명확히 분리
- exact confirmation phrase 입력
- manifest hash·만료시간·승인자 표시
- 실행 상태와 retry 가능한 failure item 표시
- 기술적인 collection/path는 고급 접힘 영역에 두고 기본 화면에는 업무 용어 사용
- 설명·경고·버튼 문구는 CMS에서 편집하되 권한·확인 형식·field/API key는 보호

### 기존 기능 영향

- 기존 operations 탭에 SUPER_ADMIN 전용 영역을 추가한다.
- 일반 admin에게는 navigation과 API 모두 보이지 않거나 거부된다.
- 기존 CMS draft/publish/revision 구조에 copy를 포함한다.

### 테스트 방법

- role별 UI visibility와 direct URL/API denial
- SCAN → DRY_RUN 상태 전이
- stale manifest에서 APPLY 버튼 비활성화
- blocker·limit 초과 표시
- exact confirmation mismatch
- mobile, keyboard, screen reader 기본 접근성
- CMS fallback·draft/published 분리 test

### 완료 조건

- 비개발자 SUPER_ADMIN이 JSON 입력 없이 안전 절차를 완료한다.
- 대상명·ID·건수·before/after를 확인하지 않고 APPLY할 수 없다.
- UI 우회로 API 권한을 우회할 수 없다.
- CMS audit와 운영 화면 회귀 test가 통과한다.

### 위험

- `AdminDashboard.tsx`가 큰 단일 component라 회귀 범위가 넓다.
- CMS copy와 보호 로직의 경계가 잘못되면 확인 문구가 편집 가능해질 수 있다.
- job polling이 과도한 read를 만들 수 있다.

### 롤백 방법

- admin feature flag를 false로 전환한다.
- 신규 panel import와 tab registration을 제거한다.
- server APPLY flag는 계속 false로 유지한다.
- CMS 신규 section이 남아도 기존 화면은 fallback으로 정상 동작하게 한다.

## Phase 8. Legacy 더미데이터 분류

### 수정 파일

- `components/admin/TestDataCleanupPanel.tsx`
- `lib/test-data/classification.ts`
- `lib/test-data/scan/graph-scanner.ts`
- `firestore.rules`
- `.env.example`

### 신규 파일

- `lib/test-data/legacy/classification-service.ts`
- `lib/test-data/legacy/evidence.ts`
- `app/api/admin/test-data/legacy/route.ts`
- `app/api/admin/test-data/legacy/[classificationId]/approve/route.ts`
- `app/api/admin/test-data/legacy/[classificationId]/reject/route.ts`
- `scripts/demo-cooperative/inventory-legacy.mjs`
- `lib/test-data/testing/legacy-classification.test.ts`

### 구현 내용

- 기존 smoke·seed pattern으로 후보만 찾는 read-only inventory
- exact UID, document path, Storage path/generation으로 classification record 작성
- pattern은 evidence hint이고 approval 근거의 전부가 될 수 없도록 validation
- APPROVED/REJECTED workflow와 reviewer UID 기록
- production에서는 서로 다른 SUPER_ADMIN 두 명 승인 옵션 적용
- 승인된 exact ID만 새 DRY_RUN에 포함
- 실제 고객과 공유하는 graph는 승인 후에도 MIXED/BLOCKED
- 과거 데이터에 marker를 무조건 backfill하지 않고 control-plane classification으로 보존

### 기존 기능 영향

- production business document를 수정하지 않는다.
- 이름·이메일 검색 결과가 자동 삭제 대상으로 승격되지 않는다.
- 기존 smoke script는 public production URL 기본값을 제거하거나 emulator/staging 전용으로 제한한다.

### 테스트 방법

- `mvp-*`, `integrated-*`, `test-e2e-*` 후보 탐색
- pattern-only approval 거부
- exact graph evidence approval
- 같은 이름 다른 cooperativeId 분리
- 실제 UID가 섞인 legacy graph BLOCKED
- 승인 revoke 후 새 DRY_RUN 제외

### 완료 조건

- legacy 후보마다 exact resource list와 reviewer decision이 있다.
- pattern만으로 APPROVED 상태를 만들 수 없다.
- mixed real data는 APPLY manifest를 만들 수 없다.
- inventory script가 write mode를 갖지 않는다.

### 위험

- 과거 phone Auth UID와 Storage generation을 복원하지 못할 수 있다.
- 오래된 audit log가 부족해 legacy를 확정할 수 없을 수 있다.
- reviewer가 실제 사용 데이터를 test로 오분류할 수 있다.

### 롤백 방법

- classification status를 REVOKED로 전환하고 이후 manifest에서 제외한다.
- 아직 APPLY하지 않은 business data에는 영향이 없다.
- 불확실한 후보는 영구적으로 CANDIDATE_ONLY/BLOCKED에 둔다.

## Phase 9. 테스트 및 최종 검증

### 수정 파일

- `package.json`
- `firebase.json`
- 관련 test script와 CI workflow
- `docs/demo-cooperative-data-progress.md`
- 운영 runbook 또는 관리자 사용 문서

### 신규 파일

- `lib/test-data/testing/end-to-end.test.ts`
- `lib/test-data/testing/partial-failure.test.ts`
- `lib/test-data/testing/concurrency.test.ts`
- `lib/test-data/testing/master-preservation.test.ts`
- `scripts/demo-cooperative/verify-reset.mjs`
- `docs/demo-cooperative-data-runbook.md`
- `docs/demo-cooperative-data-verification.md`

### 구현 내용

- emulator 기반 전체 seed → 가입 → 승인 → 사용 → reset → 재가입 검증
- Firestore/Auth/Storage fault injection
- concurrent APPLY와 idempotent retry
- 실제 master snapshot과 비선택 institution 무영향 검증
- mixed organization blocking
- production gate negative test
- 운영 runbook, incident recovery, lock recovery, partial job 재개 절차 문서화
- 최종 collection inventory와 security rules 검증

### 기존 기능 영향

- runtime 기능 변경 없이 검증·문서·CI gate를 추가한다.
- production APPLY 자동 test는 추가하지 않는다.
- 실제 Firebase project 대신 emulator 또는 승인된 별도 테스트 project를 사용한다.

### 테스트 방법

1. 둥기농협 seed를 두 번 실행
2. email/phone 가입과 승인
3. 최초 조직·사용자 포인트 확인
4. 문의·답변·열람·평가·견적·보고서·파일 생성
5. SCAN과 DRY_RUN state hash 불변 확인
6. APPLY 중 의도적 Storage/Auth 실패
7. 같은 purgeJobId로 재개
8. master 보존과 B 0건 확인
9. 동일 둥기농협 재가입
10. 실제 농협 test-only fixture 복원
11. 실제 UID 혼재 fixture BLOCKED
12. typecheck, lint, rules test, production build

### 완료 조건

- 전체 정상·실패·재개 시나리오 통과
- 둥기농협 master 문서가 reset 전후 동일
- 실제 master snapshot이 동일
- 선택하지 않은 cooperativeId의 state hash가 동일
- Auth·Storage orphan 0건
- reset 후 최초 가입 포인트 정책이 정확함
- production APPLY gate 기본 차단
- runbook과 verification evidence 검토 완료

### 위험

- emulator와 production Admin SDK 동작 차이
- 전체 graph fixture가 실제 collection을 누락할 수 있음
- production build는 통과하지만 장기 job timeout은 재현하지 못할 수 있음
- 미커밋 기존 변경과 test failure 원인이 섞일 수 있음

### 롤백 방법

- production enable flag를 false로 유지한다.
- demo signup과 admin cleanup UI flag를 각각 비활성화한다.
- APPLY endpoint 배포를 되돌려도 control-plane job record는 감사 목적으로 보존한다.
- 데이터가 이미 삭제된 경우 자동 broad restore를 하지 않고 승인된 backup과 runbook을 사용한다.

## Phase 간 승인 기준

- Phase 1~4: 구현·emulator 검증 후에도 APPLY 기능은 없어야 한다.
- Phase 5~6: APPLY service가 생겨도 production flag 기본값은 false다.
- Phase 7: UI 노출과 API 권한을 함께 검토한다.
- Phase 8: legacy 분류 완료 전 실제 농협 대상 APPLY를 허용하지 않는다.
- Phase 9: 최종 검증과 별도 운영 승인 전 production APPLY를 활성화하지 않는다.

STEP 3에서는 Phase 1부터 시작하며, 한 번에 Phase 1~9 전체를 구현하지 않는다.
