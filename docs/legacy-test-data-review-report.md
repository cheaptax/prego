# Legacy 테스트 데이터 검토 보고서

- 작성일: 2026-07-23
- 단계: STEP 8
- 범위: 저장소·Git seed/fixture 근거, legacy 후보/승인/tagging 도구
- 수행하지 않음: 운영 Firestore/Auth/Storage 조회, legacy 데이터 삭제, 운영 tagging apply

## 1. 조사 방법

`docs/demo-cooperative-data-analysis.md`, `docs/demo-cooperative-data-design.md`,
STEP 4의 graph scan/manifest 구현과 현재 seed·smoke·fixture를 대조했다.

후보 탐색은 다음 순서다.

1. 정확한 Firestore document path, Auth UID, Storage path를 기준으로 graph를 만든다.
2. 고정 seed ID, Git fixture ID, exact seed UID, seed manifest entry,
   개발자가 코드에서 명시한 exact ID를 강한 근거로 기록한다.
3. 이메일·이름 pattern, 개발 기간, 비정상 포인트, fixture 질문 문구,
   localhost/emulator metadata는 보조 근거로만 기록한다.
4. 강한 근거도 legacy 데이터에는 자동 test marker를 추가하지 않는다.
   승인 전 상태는 `REVIEW_REQUIRED`다.
5. 질문·답변 본문, raw email·전화번호, signed URL, 파일 내용은 보고서와
   review manifest에 복제하지 않는다.

실제 Firebase 프로젝트에는 접속하지 않았다. 따라서 이 문서는 운영 데이터가
존재하거나 없다는 증명이 아니다. 실제 농협별 수치는
`POST /api/admin/test-data/legacy`가 해당 `institutionId`를 read-only scan한
결과에서 생성한다.

## 2. 과거 seed 및 fixture 근거

강한 근거로 사용할 수 있는 구조:

- STEP 4가 읽는 승인된 seed manifest의 exact `documentPaths`
- 별도 서버 evidence catalog에 등록한 fixed Firestore path
- exact Auth UID 또는 exact Storage object path
- `legacyTestDataClassifications`의 SUPER_ADMIN 승인 record

저장소 조사 결과:

- `scripts/smoke-mvp.mjs`와 `scripts/smoke-mvp-integrated.mjs`는 timestamp
  이메일을 만들고 실행 당시 미사용 농협을 동적으로 선택한다. Git만으로 exact
  UID, document ID, institutionId를 복원할 수 없으므로 문자열 pattern은
  보조 근거다.
- `scripts/smoke-prod.mjs`의 `test-e2e-*` 역시 exact UID/document ID가
  고정되지 않아 보조 근거다.
- `scripts/audit-evaluation/seed-test-quote-request.mjs`는 auto ID를 사용하며
  농협 ID를 직접 저장하지 않는다. 이름·기본 이메일만으로 실제 농협 cleanup
  대상에 포함하지 않는다.
- `scripts/audit-evaluation/seed-test-published-config.mjs`의 config ID와
  actor는 코드에서 확인되지만 공용 평가 설정이며 특정 고객 농협 graph가
  아니다. 기본 `PRESERVE`다.
- `lib/**/testing`과 `scripts/test-data/*.emulator.test.mjs`의 고정 ID는
  emulator fixture다. emulator project 밖의 운영 대상 근거로 승격하지 않는다.

결론: 현재 Git만으로 특정 실제 농협의 운영 legacy 문서를
`CONFIRMED_TEST`로 자동 확정할 수 있는 exact ID 목록은 없다.

## 3. 실제 농협별 legacy 후보

정적 master에는 `coop-001`부터 `coop-1109`까지 1,109개 실제 농협이 있다.
그러나 smoke가 농협을 동적으로 선택했고 이번 단계에서 운영 inventory를
조회하지 않았으므로 1,109개 항목의 연결 계정·포인트·문의·Auth·Storage count는
모두 `NOT_ASSESSED`다. 0으로 간주하면 안 된다.

각 실제 농협 scan 결과는 다음 최소 정보만 반환한다.

- institutionId, 농협명, 농협 유형, 계산된 가입 상태
- 연결 계정 수
- `CONFIRMED_TEST`, `REVIEW_REQUIRED`, `PRESERVE`, `UNRESOLVED` count
- 포인트, 질문·답변, 견적·보고서 count
- Auth 사용자와 Storage object count
- 혼재 여부와 `READY | BLOCKED`
- exact resource key, evidence code, change token 또는 generation

실제 농협명은 동명이 존재하므로 이름 검색 결과를 대상 목록으로 사용하지 않는다.
항상 exact `institutionId`를 먼저 지정한다.

## 4. CONFIRMED_TEST 후보

다음 항목만 확정 상태가 된다.

- 이미 명시적 `testData: true` 또는 신뢰 가능한 test classification이 있는 문서
- 기존 승인된 legacy exact path
- SUPER_ADMIN이 review manifest의 개별 candidate를
  `CONFIRMED_TEST`로 승인한 항목

승인 record에는 `reviewedBy`, `reviewedAt`, `decision`, `reason`,
`sourceEvidence`, `reviewVersion`, 검토 시점 change token/generation을 남긴다.
확정 후에도 새 purge scan에서 문서 버전, 농협 참조, Auth/Storage 상태를
다시 검증한다.

## 5. REVIEW_REQUIRED 후보

다음은 자동 확정하지 않는다.

- fixed seed/fixture/exact UID 등 강한 legacy 근거가 있으나 아직 관리자 승인이
  없는 항목
- 테스트 이메일·이름 pattern만 일치하는 항목
- 개발 기간과 생성일이 겹치는 항목
- 비정상적으로 큰 포인트 금액
- fixture 형태의 질문 제목
- localhost/emulator 또는 developer actor metadata

보조 근거만 있는 항목의 suggested decision은 `UNRESOLVED`이며, SUPER_ADMIN이
실제 실행 기록과 exact ID를 대조한 뒤에만 확정할 수 있다.

## 6. PRESERVE 후보

- 명시적 `dataClassification: PRODUCTION`
- 테스트 근거가 없는 고객·활동 문서
- 실제 고객 account와 그 graph
- 공용 평가 config·표준 문서
- partner/CMS 자산
- 관리자가 `PRESERVE`로 결정한 exact resource

`PRESERVE` 결정은 별도 review record에만 저장한다. 원본 고객 문서에는
불필요한 marker를 추가하지 않는다.

## 7. 혼재 데이터

다음이면 `BLOCKED`다.

- 한 organization에 confirmed test UID와 preserve/unknown UID가 함께 있음
- test 후보가 다른 농협 ID를 참조함
- request/quote/case graph에 broken 또는 shared reference가 있음
- 포인트 잔액을 confirmed row만으로 결정적으로 복원할 수 없음
- review 이후 문서 change token 또는 Storage generation이 바뀜

초기 버전은 mixed organization wallet reconcile을 자동 수행하지 않는다.

## 8. Auth 사용자 후보

`users/{uid}`의 exact UID로 Auth metadata를 조회하고 provider, disabled 상태,
change token만 후보에 포함한다. raw email·전화번호는 포함하지 않는다.

- 이메일 pattern으로 Auth 전체를 검색하거나 삭제하지 않는다.
- profile이 confirmed되어도 다른 organization, admin/operator/partner claim이
  있으면 purge manifest가 차단한다.
- Auth가 존재하면 exact UID와 profile review가 함께 확정되어야 한다.

## 9. Storage 파일 후보

Firestore path field에서 얻은 exact object path만 사용한다. bucket, path,
generation, source document path를 검토하며 signed URL은 저장하지 않는다.

- prefix나 파일명 pattern 일괄 적용 금지
- shared reference 또는 institution metadata 불일치 시 차단
- review 이후 generation 변경 시 재검토

## 10. 자동 정리 가능한 농협

저장소 조사만으로 `READY`를 인증한 실제 농협은 0개다. 이는 정리 가능한
농협이 없다는 뜻이 아니라 운영 inventory를 수행하지 않았다는 뜻이다.

도구는 연결 데이터가 없거나 모든 exact resource 검토가 끝나고 Auth/Storage,
master 보존, reset plan, cross-reference 조건이 모두 충족된 농협만 `READY`로
계산한다.

## 11. 수동 검토가 필요한 농협

현재 Git의 smoke script는 실행 시 농협을 동적으로 선택했으므로 특정
institutionId 목록을 복원할 수 없다. 다음 순서로 수동 범위를 확정해야 한다.

1. SUPER_ADMIN이 exact institutionId별 legacy scan을 실행한다.
2. `REVIEW_REQUIRED` candidate의 실행 로그, seed manifest, UID/document ID를
   대조한다.
3. 각 candidate를 `CONFIRMED_TEST`, `PRESERVE`, `UNRESOLVED` 중 하나로
   결정한다.

운영 read-only inventory 전에는 모든 실제 농협의 현재 평가 상태를
`NOT_ASSESSED`로 유지한다.

## 12. 정리 불가능한 농협과 이유

특정 실제 농협을 정리 불가능하다고 확정하지 않았다. 다음 reason이 하나라도
있으면 해당 review manifest는 `BLOCKED`다.

- `REVIEW_REQUIRED_REMAINS`, `UNRESOLVED_REMAINS`
- `PRESERVED_CUSTOMER_ACCOUNT`
- `MIXED_REAL_AND_TEST_DATA`
- `AUTH_TARGET_UNCONFIRMED`, `STORAGE_TARGET_UNCONFIRMED`
- `CROSS_INSTITUTION_REFERENCE`, `BROKEN_REFERENCE`
- `MASTER_PRESERVATION_UNCONFIRMED`, `RESET_PLAN_UNCONFIRMED`
- candidate 최대 건수 초과

## 13. migration 실행 방법

기본 명령은 dry-run이다.

```powershell
npm run migrate:legacy-test-tags -- `
  --review-manifest <READY_MANIFEST_ID> `
  --institution-id <EXACT_INSTITUTION_ID> `
  --document-path users/<EXACT_UID> `
  --expected-project <EXACT_PROJECT_ID> `
  --target-environment <development|staging|production|emulator>
```

한 명령에 `--document-path`를 반복할 수 있으나 최대 100개다. 도구는 승인된
review record에 있는 exact path만 허용하고 다음 전후 필드만 표시·적용한다.

- `dataClassification: LEGACY_TEST`
- `testData: true`
- `legacyReviewId`
- `reviewedAt`
- `reviewedBy`

`PRESERVE`, `UNRESOLVED`, 명시적 production, 다른 농협 참조, stale change
token, master path는 차단한다. 동일 값 재실행은 `NOOP`다.

이번 단계에서는
`scripts/test-data/fixtures/legacy-tag-review.sample.json`으로 offline
dry-run만 검증했다. 실제 Firebase apply는 실행하지 않았다.

## 14. 프로덕션 실행 전 승인사항

- `READY` review manifest와 모든 candidate 결정
- SUPER_ADMIN 최종 `CONFIRMED_TEST` 승인
- exact project ID, institutionId, document path
- 실제 고객·mixed graph 없음
- Auth UID와 Storage path/generation 확정
- master 보존 필드와 B reset plan 확인
- 승인된 backup/change ticket과 운영 시간대
- `--apply` 명시
- `LEGACY_TEST_DATA_TAGGING_PRODUCTION_ENABLED=true`
- `--confirm-production <EXACT_INSTITUTION_ID>`

프로덕션 flag 기본값은 false다. 이번 STEP 8에서는 production apply와 legacy
데이터 삭제를 수행하지 않았다.
