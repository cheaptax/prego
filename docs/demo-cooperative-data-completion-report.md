# 둥기농협 및 테스트 데이터 정리 최종 완료 보고서

- 검증일: 2026-07-23
- 단계: STEP 9 최종 검증
- 실행 환경: Firebase demo project ID 기반 Firestore/Auth/Storage Emulator
- 운영 작업: 수행하지 않음
- NEXT_GATE: `NEEDS_LEGACY_DATA_REVIEW`

## 1. Executive Verdict

구현과 안전 경계는 최종 검증을 통과했다. 둥기농협 master, exact manifest,
Firestore/Auth/Storage purge, 실제 농협 master 보존, 부분 실패 재개,
SUPER_ADMIN 이중 확인, legacy review/tagging 도구가 연결돼 있다.

운영 정리는 아직 승인할 수 없다. 운영 Firebase inventory를 수행하지 않아 실제
농협별 legacy 후보가 `NOT_ASSESSED`이고, 실제 `REVIEW_REQUIRED`/`UNRESOLVED`
건수를 0으로 확인하지 못했다. 따라서 단계 자체는 완료하되 운영 gate는
`NEEDS_LEGACY_DATA_REVIEW`다.

목표 대비 상태:

1. 둥기농협 마스터 추가 — `COMPLETE`
2. 결정적인 내부 ID — `COMPLETE`
3. Seed 멱등성 — `COMPLETE`
4. 회원가입 목록 조회 — `COMPLETE`
5. 가입 가능 상태 — `COMPLETE`
6. 둥기농협 가입 — `COMPLETE`
7. 테스트 메타데이터 전달 — `PARTIAL`
8. 테스트 데이터 Scan — `COMPLETE`
9. 삭제 Manifest — `COMPLETE`
10. 데이터 혼재 판정 — `COMPLETE`
11. Firestore 정리 — `COMPLETE`
12. Firebase Auth 정리 — `COMPLETE`
13. Storage 정리 — `COMPLETE`
14. 가입상태 복원 — `COMPLETE`
15. 실제 농협 마스터 보존 — `COMPLETE`
16. Purge Job — `COMPLETE`
17. 중복 실행 방지 — `COMPLETE`
18. 부분 실패 재시도 — `COMPLETE`
19. 관리자 Preview UI — `COMPLETE`
20. SUPER_ADMIN 권한 — `COMPLETE`
21. 이중 확인 — `COMPLETE`
22. Legacy 데이터 검토 — `COMPLETE`
23. Legacy tagging migration — `COMPLETE`
24. 고아 데이터 검증 — `COMPLETE`
25. 감사 로그 — `COMPLETE`
26. Emulator 테스트 — `COMPLETE`
27. production build — `COMPLETE`

`PARTIAL` 사유는 신규 둥기농협 가입의 `users`, Auth registry,
`organizations`에는 명시적 metadata가 전달되지만 실제 애플리케이션이 생성하는
모든 포인트·문의·답변·견적·평가 파생 문서에 marker가 직접 복제되지는 않기
때문이다. scanner는 exact UID/request/quote/case graph와 demo institution
lineage로 이 데이터를 찾지만, 운영 적용 전 metadata 전파 범위는 별도 보완
검토가 필요하다.

## 2. 작업 목적

- 실제 농협 master를 변경하지 않고 업무 테스트용 둥기농협을 반복 사용한다.
- 테스트 사용자·포인트·문의·견적·평가·파일만 exact ID로 정리한다.
- 실제·테스트 데이터가 혼재하면 자동 정리를 차단한다.
- 실패 시 이미 완료된 작업을 반복하지 않고 같은 job으로 재개한다.
- 과거 marker 없는 데이터는 관리자 검토 전 자동 삭제하지 않는다.

## 3. 둥기농협 구현

- 표시명: `둥기농협`
- cooperative ID 및 master 문서 ID: `demo-dunggi-nh`
- internal code: `DEMO_DUNGGI_NH`
- 실제 `coop-*` ID 범위와 분리
- master collection: `demoCooperativeMaster`
- `dataClassification: DEMO`, `isDemoInstitution: true`,
  `resettable: true`
- UI에는 `테스트 전용` 배지를 표시한다.
- 실제 static master 1,109건에는 둥기농협을 추가하지 않았다.

## 4. 둥기농협 Seed

seed는 exact document ID를 사용하며 create/update/noop plan을 계산한다.
동일 identity는 재실행해도 한 문서만 유지하고 signup 사용 필드는 덮어쓰지
않는다. collision, project mismatch, production flag/confirmation 누락은
실패한다.

Firestore Emulator에서 dry-run, 최초 apply, 재apply, 사용 필드 보존을
실행했고 1/1 test가 통과했다.

## 5. 회원가입 테스트 흐름

검색 API와 가입 API가 같은 server resolver를 사용한다. 둥기농협은 feature
flag와 검증된 demo master가 있을 때 선택 가능하며 `AVAILABLE → PENDING →
REGISTERED` 상태 전이를 사용한다. signup은 customer profile과 email/phone
Auth subject registry를 생성하고, 승인 시 organization과 가입 포인트를 만든다.

검색·가입 정책은 단위/route 검증을 통과했다. 이번 최종 검증은 실제 브라우저
휴대폰 인증 UI를 자동 조작하지 않았으므로, 하나의 browser session으로
검색부터 승인까지 실행한 증거는 없다. purge 이후 Auth UID 재생성과
`signupStatus: AVAILABLE`은 Emulator에서 확인했다.

## 6. 테스트 데이터 식별 구조

삭제 확정 우선순위:

1. 신뢰 가능한 explicit test marker
2. 승인된 test scenario
3. finalized seed manifest의 exact path
4. SUPER_ADMIN이 승인한 legacy exact resource
5. 둥기농협의 exact graph lineage

이름·농협명·이메일·질문 제목 pattern은 `REVIEW_REQUIRED` 힌트일 뿐
`CONFIRMED_TEST`나 삭제 근거가 아니다. `PRODUCTION` marker 충돌,
cross-institution, shared reference, broken graph는 `BLOCKED`다.

## 7. Scan과 Manifest

scanner는 단일 `institutionId`에서 UID, request ID, quote request ID, case ID,
Firestore path, Auth UID, Storage exact path를 확장한다. 최대 4단계
subcollection inventory와 query limit 경고를 포함한다.

manifest에는 exact Firestore path/update time, Auth UID/provider/change token,
Storage bucket/path/generation/size, preserved master, reset preview, count,
15분 만료, SHA-256 checksum이 포함된다. raw email·전화번호, 질문 본문,
signed URL, 파일 내용은 포함하지 않는다.

## 8. Firestore 정리

`CONFIRMED_TEST` exact document만 update-time precondition으로 한 건씩 삭제한다.
`recursiveDelete`, collection 전체 삭제, query 결과 bulk delete는 사용하지
않는다. 평가 leaf → 견적 → 문의·답변 → audit intake → point → membership/
tenant → user → organization 순으로 처리한다.

subcollection은 scan manifest에 개별 path로 포함돼 부모보다 먼저 처리된다.
`NOT_FOUND`는 멱등 성공이고 stale update time은 job을 차단한다.

## 9. Firebase Auth 정리

manifest의 exact UID만 처리한다. profile/registry/institution/provider/custom
claim/다른 조직 참조를 재검증한 뒤 disable → refresh token revoke →
Firestore/Storage 성공 → delete 순서를 사용한다.

admin/operator/partner role 또는 claim, 다른 조직과 연결된 UID, manifest 밖
business reference는 차단한다. email pattern lookup/delete는 없다.

## 10. Storage 정리

Firestore source에서 얻은 exact bucket/path와 object generation만 삭제한다.
generation mismatch, institution/owner metadata mismatch, shared reference는
차단한다. prefix는 삭제에 사용하지 않고 사후 고아 object 조회에만 사용한다.

둥기농협 Emulator 시나리오에서 business card, quote PDF, evaluation report
3개가 삭제됐고 다른 농협 object는 보존됐다.

## 11. 실제 농협 마스터 보존

실제 master는 `lib/platform.ts`의 static `nonghyupMaster`이며 Firestore purge
target이 아니다. manifest에는 `MASTER_ALWAYS_PRESERVED` item으로만 들어간다.
service와 UI가 master/control-plane path를 이중 차단한다.

`coop-001` Emulator 시나리오에서 test customer, organization, point,
consultation, Auth, Storage를 삭제한 뒤 static master의 이름·코드·유형·지역·
주소·status·source 전체가 동일함을 확인했다.

## 12. 가입상태 복원

실제 농협 master에는 가입 연결 필드가 없으므로 write하지 않는다. 테스트 전용
organization과 user/Auth를 제거해 재가입 가능한 상태를 만든다.

둥기농협은 모든 Firestore/Auth/Storage 단계와 고아 검증이 성공한 뒤에만
master identity를 transaction에서 다시 확인하고 allowlist field인
`signupStatus`를 `AVAILABLE`로 변경한다. Storage 실패 시 master는
`REGISTERED`를 유지했다.

## 13. Legacy 데이터 검토

fixed seed path, Git fixture ID, exact seed UID, seed manifest/log ID,
developer-declared exact ID는 강한 근거다. 이메일·이름 pattern, 개발 시각,
비정상 포인트, fixture 문구, localhost/emulator metadata는 보조 근거다.

보조 근거 또는 미승인 강한 근거는 `REVIEW_REQUIRED`다. SUPER_ADMIN만
`CONFIRMED_TEST`를 승인할 수 있고 evidence, reason, reviewedBy,
reviewedAt, reviewVersion을 기록한다. 검토 후 resource change token이 바뀌면
stale로 차단한다. 신규 review/audit event에는 actor email을 저장하지 않도록
최종 수정했다.

## 14. 관리자 정리 UI

`/admin/test-data`는 SUPER_ADMIN 전용이다. 기관명과 ID, master 보존,
삭제·검토·보존 항목, Auth/Storage count, blocker, checksum, 만료, reset
preview, job progress를 표시한다.

기본 동작은 Preview이며, master 보존과 테스트 데이터 범위 확인 checkbox 및
server-generated exact phrase를 모두 만족해야 APPLY가 가능하다. mixed
manifest는 UI와 API 모두 실행을 막는다.

## 15. 권한과 안전장치

- server `requireRole(request, "super_admin")`
- APPLY recent authentication 10분
- strict API schema; client `institutionId` 추가 주입 거부
- registered manifest ID와 checksum 재검증
- environment/project exact binding
- production 3개 기능 flag 기본 false
- Firestore 2,000, Auth 20, Storage 500/5 GiB 한도
- master/control-plane target 금지
- 운영자 Auth와 multi-organization UID 금지
- confirmation exact match
- lease expiry를 적용한 institution lock과 deterministic job ID

일반 ADMIN과 PARTNER_ADMIN은 별도 허용 정책이 없고 SUPER_ADMIN 검사에서
차단된다.

## 16. 부분 실패와 재실행

각 item과 phase의 결과를 저장한다. retryable 실패 시 `PARTIALLY_FAILED`로
멈추며 child 실패 후 parent, organization, master reset을 진행하지 않는다.
재실행은 동일 manifest의 deterministic `purgeJobId`를 사용하고
`DELETED`/`NOT_FOUND` item을 건너뛴다.

Storage 강제 실패 Emulator test에서 1차는 `DELETE_STORAGE_OBJECTS`와
`PARTIALLY_FAILED`, master `REGISTERED`, Auth disabled/revoked 상태였다.
2차는 같은 job attempt 2로 `COMPLETED`, 3차는 idempotent replay였다.

감사 로그 저장 실패도 job을 `COMPLETED`로 저장하거나 lock을 해제하지 않고
`PARTIALLY_FAILED/FINALIZING`으로 남긴다. 같은 job 재시도에서 감사 로그 저장이
성공한 뒤에만 완료·lock 해제를 수행한다.

## 17. 고아 데이터 검증

완료 전 다음을 read-only로 확인한다.

- profile/Auth 불일치
- membership/tenant와 organization 불일치
- answer/request 불일치
- point row/wallet 불일치
- 삭제 UID reference
- manifest Storage object 잔존
- 승인 prefix 아래 manifest 밖 신규 object

blocker가 하나라도 있으면 완료와 lock 해제를 막는다. 자동 고아 삭제는 없다.

## 18. 전체 테스트 결과

최종 결과:

- `npm test`: 466 tests, 465 pass, 1 skip, 0 fail
- admin RBAC/route regression: 91/91 pass
- test-data unit/API/UI/security: 51/51 pass
- 둥기농협 unit: 11/11 pass
- 둥기농협 seed Firestore Emulator: 1/1 pass
- Firestore purge Emulator: 1/1 pass
- 통합 Firestore/Auth/Storage Emulator A-D: 4/4 pass
- legacy tagging offline dry-run: update 1, blocked 0
- `npm run lint`: pass
- `npm run typecheck`: pass
- `npm run cms:audit`: route 30 = registered 27 + documented exception 3
- `npm run build`: pass

시나리오 판정:

- A 둥기농협 정상 테스트 — `PARTIAL`
  - seed/search/policy와 전체 purge graph는 통과
  - profile, membership, tenant, point, question/answer/rating, quote/report,
    3개 Storage object, Auth 2개, master 보존, AVAILABLE, Auth 재생성 확인
  - 실제 browser phone-auth/signup/approval 단일 여정은 자동 실행하지 않음
  - app의 모든 파생 write에 명시적 metadata가 복제되지는 않음
- B 실제 농협 테스트 데이터 — `COMPLETE`
  - `coop-001` exact graph 정리, static master 불변, Auth 재생성 확인
- C 실제 데이터 혼재 — `COMPLETE`
  - manifest `BLOCKED`, 관리자 실행 blocker, 등록 거부 확인
- D 실패와 재실행 — `COMPLETE`
  - Storage 강제 실패, PARTIALLY_FAILED, 같은 job 재개·완료·멱등 replay 확인

보안 점검 15개 항목은 test 또는 code boundary로 통과했다. request에는
`institutionId` 필드가 없어 변조 입력은 strict schema에서 거부되며, 실제
대상 ID는 등록 manifest와 재-scan 결과에서만 읽는다.

## 19. 변경 파일

최종 검증에서 수정:

- `firestore.indexes.json`
- `lib/admin/testing/migration-seed-index.test.ts`
- `lib/test-data/purge-apply-service.ts`
- `lib/test-data/purge-lock.ts`
- `lib/test-data/purge-firestore-executor.ts`
- `lib/test-data/purge-job-types.ts`
- `lib/test-data/purge-api.ts`
- `lib/test-data/purge-admin-read.ts`
- `lib/test-data/legacy-review-types.ts`
- `lib/test-data/legacy-review-service.ts`
- `lib/test-data/legacy-review-api.ts`
- `lib/test-data/testing/purge-apply.test.ts`
- `lib/test-data/testing/purge-admin-ui.test.ts`
- `scripts/test-data/purge-auth-storage.emulator.test.mjs`
- `scripts/test-data/purge-firestore.emulator.test.mjs`
- `docs/demo-cooperative-data-progress.md`

주요 수정은 stale Firestore index regression 제거, A-D Emulator 검증 확장,
production/project/manifest 변조 negative test, Storage emulator not-found
assertion 호환, external 완료 전 master reset 차단, lock lease expiry,
감사 저장 전 완료·lock 해제 차단, audit actor email 비저장이다.

## 20. 신규 파일

STEP 9 신규:

- `docs/demo-cooperative-data-completion-report.md`
- `docs/demo-data-purge-production-checklist.md`

STEP 3~8의 주요 신규 영역:

- `lib/cooperatives/*`
- `lib/test-data/*`
- `app/api/cooperatives/*`
- `app/api/admin/test-data/*`
- `app/admin/test-data/*`
- `scripts/demo-cooperative/*`
- `scripts/test-data/*`
- `components/TestDataManagement.tsx`
- `docs/legacy-test-data-review-report.md`

## 21. 알려진 제한사항

- 운영 Firebase inventory를 수행하지 않았다.
- 실제 농협 1,109개의 legacy 상태는 `NOT_ASSESSED`다.
- Git pattern만으로 실제 cleanup 가능 농협을 확정할 수 없다.
- 신규 demo 가입의 모든 파생 document에 explicit metadata가 직접 저장되지는
  않는다.
- browser 기반 phone Auth 전체 signup E2E는 실행하지 않았다.
- Firestore/Auth/Storage 간 단일 원자 transaction은 불가능하다.
- Auth delete 후 기존 password 복구는 불가능하다.
- mixed organization wallet 부분 reconcile은 자동화하지 않았다.
- Emulator와 production Admin SDK의 장기 실행·quota 차이는 남는다.
- Node module type 및 Firebase dependency deprecation warning은 비차단 경고다.
- production read-only SCAN API는 SUPER_ADMIN/project binding을 사용하지만
  CLI와 같은 별도 scan feature flag·확인 문구를 요구하지 않는다.
- manifest 등록과 legacy `CONFIRMED_TEST` 승인은 SUPER_ADMIN 전용이지만,
  recent-auth 10분 검증은 최종 APPLY에만 적용된다.

## 22. 운영 실행 전 필수 승인

- 운영 project ID와 최신 backup
- exact institution ID
- 운영 legacy inventory 및 모든 review decision
- `REVIEW_REQUIRED`/`UNRESOLVED` 0건
- mixed/cross-reference 0건
- Auth UID 및 Storage generation 목록
- master 보존·reset plan
- manifest checksum과 삭제 count
- SUPER_ADMIN 및 조직의 2인 승인
- 실행 시간대와 부분 실패 담당자
- production purge/external flags의 한시적 활성화

상세 항목은 `docs/demo-data-purge-production-checklist.md`를 사용한다.

## 23. 롤백 및 복구 방법

물리 삭제는 자동 rollback하지 않는다.

- 실행 전: immutable manifest, Firestore backup, Storage backup/versioning 확인
- 실행 중: 즉시 기능 flag 비활성화, child 실패에서 중단, 동일 job 재개
- stale/혼재/신규 target: 기존 manifest 재사용 금지, 새 SCAN과 승인
- Auth delete 전: disabled account는 필요 시 재활성화 가능
- Auth delete 후: 새 가입 절차로 재생성
- 둥기농협: 보존된 master에서 scenario를 다시 가입/seed
- 실제 농협: static master는 그대로이므로 신규 고객 가입으로 복구
- broad production backup restore는 다른 고객을 덮을 수 있어 자동 실행 금지

## 24. 다음 권장 작업

1. 운영 read-only legacy inventory를 exact institution ID별로 수행한다.
2. 모든 `REVIEW_REQUIRED`/`UNRESOLVED`를 관리자 검토로 해소한다.
3. 신규 demo 파생 write의 metadata 전달 범위를 별도 변경으로 보완한다.
4. staging에서 실제 browser phone-auth/signup/approval E2E를 수행한다.
5. production SCAN과 legacy 승인에도 별도 recent-auth/confirmation gate를
   적용할지 보안 정책으로 결정한다.
6. production checklist와 변경 승인을 완료한 뒤에만 purge gate를 재평가한다.
