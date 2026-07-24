# 관리자 운영자·제휴사 보안 검증 보고서

기준일: 2026-07-22  
검증 단계: STEP 8  
검증 범위: 운영자·제휴사 UI/API, Firebase Auth, Firestore·Storage Rules,
Firestore Indexes, migration·seed script  
종합 결론: **PARTIALLY_COMPLETE**

서버 API의 세분 권한, 역할 계층, 제휴사 격리와 soft termination 경계는
유효하다. STEP 8에서 Rules의 `accountStatus` 검사를 정렬하고 클라이언트의
관리자 프로필 열람 범위를 줄였으며 migration·seed 안전장치를 강화했다.
다만 Rules emulator는 로컬 Java 8 때문에 실행하지 못했고, 운영 migration과
Rules/index 배포는 수행하지 않았다.

## 1. 데이터 접근 구조

### 클라이언트 SDK 직접 읽기

- 공개 CMS 게시본: `cmsPublishedPages`, `cmsPublishedGlobals`
- 로그인 사용자: 자기 `users/{uid}` 문서
- 제휴사 계정:
  - 자기 `partners/{partnerId}`
  - 자기 제휴사의 취소되지 않은 `partnerAssignments`
  - 자기 제휴사의 `partnerAnswerDrafts`
  - 자기에게 배정된 `consultRequests`
- 관리자 운영자·제휴사 UI는 Firestore client SDK로 목록·상세를 읽지 않고
  Firebase Auth에서 ID token만 얻은 뒤 서버 API를 호출한다.

### 클라이언트 SDK 직접 쓰기

- `users`, `partners`, `partnerAssignments`, `partnerAnswerDrafts`,
  `auditLogs`, `partnerUniqueKeys`의 클라이언트 직접 쓰기는 모두 차단한다.
- 운영자 role, permission override, `accountStatus`, partner status와
  `partnerId`를 클라이언트가 직접 변경하는 경로는 없다.
- 기존 회원 상담 생성 등 별도 공개 흐름은 기존 Rules를 유지한다.

### 서버 API를 통한 읽기

- 운영자: `/api/admin/operators`, `/api/admin/operators/{uid}`,
  `/api/admin/overview`
- 제휴사: `/api/admin/partners`, `/api/admin/partners/{partnerId}`,
  `/accounts`
- 제휴사 portal: `/api/partner/session`, `/api/partner/assignments`
- 모든 관리자 API는 Firebase ID token, `admin:true` claim,
  Firestore profile, 활성 상태와 action permission을 검증한다.
- 제휴사 API는 `partner:true`, `users.partnerId`, 활성 계정,
  활성 partner 문서와 assignment 관계를 검증한다.

### 서버 API와 Admin SDK를 통한 쓰기

- 운영자 생성·수정·상태·role·permission·비밀번호·삭제
- 제휴사 생성·수정·상태·종료, 서비스 범위, 계정 생성·이동·연결 해제
- Firebase Auth disabled/custom claims와 Firestore profile 동기화
- unique-key 예약과 audit log

민감한 관리자 mutation은 모두 API + Admin SDK 경계 안에 있다.

## 2. Firestore Rules 변경

### 변경 사항

- `isActiveAccount(user)`를 추가했다.
  - `accountStatus`가 있으면 반드시 `active`여야 한다.
  - migration 전 문서만 `status=active` fallback을 사용한다.
- Firestore와 Storage의 `isAdmin()`이 동일한 활성 상태 함수를 사용한다.
- Firestore `isPartner()`도 동일한 활성 상태 함수와 partner 문서
  `status=active`를 함께 확인한다.
- `users`는 관리자 전체 client read를 제거하고 로그인 사용자의 자기 문서
  read만 허용한다. 관리자 목록은 서버 API에서 읽는다.
- `auditLogs`, `partnerUniqueKeys`를 Admin SDK 전용 collection으로
  명시적으로 차단했다.
- `consultRequests` 전체 write와 `consult-attachments` write도 기존 서버
  API/Admin SDK 경로만 사용하도록 client write를 차단했다.
- 기존 `users`, `partners`, assignment/draft의 client mutation 차단을 유지했다.
- Storage의 `consult-attachments/**`는 partner 직접 read를 계속 차단하고
  active admin만 접근할 수 있다.

### 배포 상태

- Rules 파일만 변경했으며 Firebase production 배포는 수행하지 않았다.
- 정적 계약 테스트는 통과했다.
- emulator 실동작 테스트는 Java 21 이상 환경에서 다시 실행해야 한다.

## 3. Firestore Indexes 변경

`firestore.indexes.json`은 변경하지 않았다. 현재 두 index가 모두 실제 query에
필요하며 추가 index는 필요하지 않다.

1. `partnerAssignments(partnerId ASC, status ASC)`
   - partner portal의 `partnerId == ...` + `status != revoked`
2. `partnerAssignments(requestId ASC, status ASC)`
   - 관리자 배정 회수의 `requestId == ...` + `status != revoked`

운영자 목록은 `users.role == admin` 이후 서버 메모리 필터·정렬을 사용한다.
제휴사 목록은 `partners.orderBy(updatedAt)`과 단일 equality query만 사용한다.
따라서 요청 예시의 role+status, partnerType+status index는 현재 존재하지 않는
query를 위한 speculative index라 추가하지 않았다.

## 4. API 권한 검증 현황

- 운영자 read/create/update/disable/delete/manageRoles/resetPassword 분리: PASS
- 자기 role·status·permission override 변경 차단: PASS
- 낮은 역할의 같거나 높은 역할 관리 차단: PASS
- 마지막 활성 `super_admin` 제거 사전 차단: PASS, 동시 요청 race는 잔존
- 비활성 운영자 API 403: PASS
- body의 role/permission 조작 방어: PASS
- 제휴사 read/create/update/changeStatus/manageScope/manageMembers 분리: PASS
- cross-partner account 수정·이동 source 검증: PASS
- terminated partner 계정 생성 차단: PASS
- partner portal의 자기 partner/assignment 격리: PASS
- paused/terminated partner의 API 접근 차단: PASS
- partner hard delete 미제공, `terminated` 전환: PASS

## 5. 공격 시나리오별 결과

| 번호 | 시나리오 | 예상 결과 | 실제 결과 | 판정 |
|---:|---|---|---|---|
| 1 | 일반 운영자가 자기 역할을 SUPER_ADMIN으로 변경 | 403/보호 오류 | self sensitive change와 역할 계층에서 차단 | PASS |
| 2 | ADMIN이 SUPER_ADMIN 계정을 수정 | 403 | `canManageOperator`가 상위 역할 target을 차단 | PASS |
| 3 | 마지막 SUPER_ADMIN 비활성화 | 차단 | active super-admin count와 guard로 차단 | PARTIAL |
| 4 | 마지막 SUPER_ADMIN 강등 | 차단 | role 변경 guard로 차단 | PARTIAL |
| 5 | 비활성 운영자의 API 호출 | 403 | `requireActiveAdmin`이 `accountStatus` 기준 차단 | PASS |
| 6 | 권한 없는 메뉴 URL 직접 접근 | 데이터 미노출 | client denied 화면과 API 401/403, shell은 로드됨 | PARTIAL |
| 7 | 권한 없는 운영자 삭제 API 호출 | 403 | `operators:delete`에서 차단 | PASS |
| 8 | Body의 role/permissions 조작 | 400/403 | 역할 타입·rank·manageRoles 검증에서 차단 | PASS |
| 9 | PARTNER_ADMIN이 다른 제휴사 운영자 생성 | 차단 | 해당 역할 미채택, partner token은 admin 계정 API 사용 불가 | PASS |
| 10 | PARTNER_OPERATOR가 다른 제휴사 데이터 조회 | 차단 | 역할 미채택, 기존 `role=partner + partnerId` 격리 | PASS |
| 11 | 제휴사 운영자가 제휴사 상태 변경 | 차단 | admin permission 필요, Rules client write 차단 | PASS |
| 12 | SUSPENDED 제휴사 소속 운영자의 접근 | 403 | `paused` partner 문서로 API와 Rules 모두 차단 | PASS |
| 13 | 연결 데이터가 있는 제휴사 삭제 | hard delete 금지 | `terminated`, `hardDeleted:false`, 관계 보존 | PASS |
| 14 | 운영자 비밀번호 또는 token 로그 노출 | 노출 없음 | Auth에만 전달, audit redaction과 source 계약 통과 | PASS |
| 15 | Firestore client 직접 쓰기로 권한 우회 | deny | 관리자 collection write와 unique/audit 접근 차단 | PASS |

시나리오 3·4의 PARTIAL 이유는 보호 로직이 존재하지만 두 개의 마지막
`super_admin` 변경 요청이 동시에 실행될 때 count와 mutation이 하나의
Firestore transaction/lock으로 묶이지 않기 때문이다.

시나리오 6의 PARTIAL 이유는 `/admin/operations`가 client-auth 구조여서
비인가 사용자도 정적 shell은 내려받을 수 있기 때문이다. 운영 데이터는
서버 API에서 반환되지 않는다.

`PARTNER_ADMIN`, `PARTNER_OPERATOR`는 확정 설계에서 채택하지 않았다.
외부 계정은 모두 `users.role=partner + partnerId`이며 member 관리 API는
내부 관리자 `partners:manageMembers`만 사용할 수 있다.

## 6. migration 검증 결과

### 공통 안전장치

- 기본 모드 dry-run
- `--apply`에서만 write
- apply는 `--confirm-production` 필수
- `--expected-project <id>` 또는
  `FIREBASE_MIGRATION_EXPECTED_PROJECT_ID` 필수
- 실제 `FIREBASE_PROJECT_ID` 불일치 시 즉시 중단
- 비밀번호·token·private key 미출력
- production 자동 실행 없음

### `migrate-admin-rbac.mjs`

- admin profile 수와 누락 role 수 출력
- UID별 명시적 role map 없이는 apply 차단
- before `(missing)` / after role 요약
- applied/skipped/failures 출력과 문서별 실패 기록
- merge write와 누락 role 대상만 처리하므로 재실행 가능

### `migrate-partners.mjs`

- 대상·변경·invalid·unique-key·conflict·failure 수 출력
- name/email conflict가 있으면 apply 차단
- partner normalization과 unique-key 예약을 transaction으로 처리
- merge와 owner 검증으로 재실행 가능

### 백업과 롤백

스크립트 자체가 backup을 만들지는 않는다. apply 전 운영자가 Firebase/
Google Cloud managed export 또는 동등한 Firestore backup을 생성해야 한다.
RBAC rollback은 승인한 UID-role map과 export를 기준으로 profile 필드를
복원한다. Partner rollback은 partner 문서와 `partnerUniqueKeys`를 같은
backup 시점으로 함께 복원해야 한다.

실제 dry-run 또는 apply는 운영 DB에 실행하지 않았다.

## 7. seed 검증 결과

`seed-admin.mjs`:

- `--expected-project`와 `--confirm-production` 필수
- 기존 Auth user는 UID를 유지하고 admin claim을 merge
- 신규 user 또는 명시적 `--reset-password`에서만 비밀번호를 요구·변경
- 최소 8자, 12자 이상 권고
- 기존 유효 `adminRole`과 permission override를 보존
- role이 없는 bootstrap profile만 `super_admin`으로 설정
- `accountStatus=active`, legacy `status=active`를 함께 기록
- 비밀번호·token을 출력하지 않음
- 반복 실행 시 기존 role과 비밀번호를 의도치 않게 덮어쓰지 않음

`check-admin-ready.mjs`:

- Auth 존재·disabled·admin claim·Firestore role·super-admin role과
  canonical account status를 read-only로 확인
- 비밀번호를 읽거나 출력하지 않음

## 8. 남은 보안 위험

1. 마지막 `super_admin` count와 변경이 단일 transaction이 아니어서
   동시 강등/삭제 race 가능성이 남는다.
2. migration 승인 전에는 `adminRole` 누락 profile을 legacy
   `super_admin`으로 해석하는 fallback이 유지된다.
3. Auth와 Firestore는 하나의 원자 transaction으로 묶을 수 없어 상태 변경
   중 부분 실패가 가능하다. partner API/Rules는 partner status로 차단하지만
   Auth disabled/claim reconciliation job은 필요하다.
4. 관리자 route는 server session cookie가 아니라 client ID token을 사용하므로
   직접 URL에서 정적 shell까지 차단하지는 않는다.
5. Rules emulator matrix는 Java 21 환경에서 아직 실행되지 않았다.
6. broad Rules/index 변경은 production 배포 전 기존 console-managed index와
   diff 검토가 필요하다.

## 9. 프로덕션 반영 전 필수 작업

- Java 21 이상 환경에서 `npm run test:cms:rules` 통과
- production admin/partner inventory와 migration dry-run 실행
- UID-role map 및 partner unique-key conflict 결과 승인
- 최소 2개 활성 `super_admin` 확보
- Firestore managed export 또는 동등 backup 생성
- `firestore.rules`, `storage.rules`, indexes diff 검토
- Rules → indexes → application 순서의 staging 배포와 smoke test
- paused/terminated partner의 Auth disabled/claims reconciliation 확인
- 권한별 실제 계정으로 15개 시나리오 재검증
- audit log와 401/403/409 증가 모니터링 준비

## 10. 롤백 전략

1. 애플리케이션: 이전 검증 release로 rollback
2. Rules: 직전 배포 ruleset으로 즉시 복원
3. Indexes: 기존 index를 삭제하지 말고 필요한 경우 신규 manifest만 되돌림
4. RBAC migration: pre-apply export와 승인 role map으로 profile 복원
5. Partner migration: partner 문서와 `partnerUniqueKeys`를 동일 backup에서 복원
6. Auth 상태/claims: backup inventory와 Firestore profile 기준으로 재동기화
7. rollback 후 관리자·partner 로그인, 권한, audit log를 재확인

운영 배포, 운영 Firestore write, Auth user 변경과 migration apply는 수행하지 않았다.
