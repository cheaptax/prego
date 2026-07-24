# 관리자 콘솔 RBAC·제휴사 관리 진행 상태

최종 업데이트: 2026-07-22  
현재 단계: **COMPLETE — STEP 9 최종 검증과 완료 판정**  
NEXT_IMPLEMENTATION_STEP: **없음 — staging·production 승인 절차로 전환**  
NEXT_GATE: **NEEDS_DATA_MIGRATION_APPROVAL**

## STEP 9 최종 결과

### 완료 기능

- 운영자 전용 목록, 검색·역할·상태·소속 필터, 페이지네이션과 최근 로그인
- 운영자 등록·수정, 역할·세부 권한, 비활성화, 비밀번호 변경, 삭제 보호
- 제휴사 목록·등록·상세·수정, 상태·scope와 soft termination
- 제휴사 계정 생성·수정·상태·이동·연결 해제
- 역할 preset, allow/deny, 계정 상태와 data scope 공통 권한 엔진
- Firebase ID token·claim·profile·상태·permission 기반 API 인가
- partner unique-key transaction, partnerId·assignment 격리와 linked Auth sync
- Firestore·Storage Rules의 active account/server-only 경계
- 감사 로그 민감정보 redaction과 dry-run 우선 migration·seed guard

### STEP 9 수정

- 제휴사 PATCH가 기본정보, 상태, scope 변경 permission을 독립 검사하도록 수정
- 상태/scope 전용 권한 사용자가 변경 내용을 저장할 수 있도록 UI gate 정렬
- 운영자 profile 저장 실패 시 생성된 Firebase Auth user 보상 삭제
- 운영자 감사 로그 역할 metadata를 공통 `getAdminRole()` 판정으로 정렬
- 미사용 legacy 제휴사 panel/editor 두 컴포넌트 제거
- CMS section copy를 캐시·memoize해 제휴사 목록 무한 재조회와 저장 연결 실패 수정
- 네트워크 저장 실패를 일반 API 오류와 구분하는 사용자 안내 추가
- 위 결함을 재발 방지하는 API·UI·security 계약 테스트 추가

### 미완성 기능·제약

- 운영자 `invited/suspended` 전체 write lifecycle과 reset-email/재초대
- migration 전 누락 `adminRole`의 legacy `super_admin` fallback 제거
- 마지막 활성 super-admin 변경의 분산 동시성 lock
- 운영자 hard delete를 disable-first 정책으로 전환
- Auth/Firestore 부분 실패 자동 reconciliation
- 비인가 직접 URL의 정적 client shell server redirect
- partner assignment attachment 전달의 staging 검증

### 최종 테스트 결과

- `npm run cms:audit`: **PASS, route 23 = registry 21 + exception 2**
- `npm run typecheck`: **PASS**
- `npm run lint`: **PASS**
- `npm run test:admin-rbac`: **PASS, 61/61**
- `npm run test:cms`: **PASS, 92/92**
- `npm test`: **PASS**
- `npm run test:integration`: **PASS, 6/6**
- `npm run test:e2e`: **PASS, route 21·scenario 63·console error 0**
- `npm run verify:audit-report-pdf`: **PASS, fixture 7**
- `npm run build`: **PASS, static page 51**
- `npm run dev` + localhost smoke: **PASS, Ready 1.077s·HTTP 200**
- seed·migration·readiness `--help`: **PASS**
- `npm run test:cms:rules`: **BLOCKED — 로컬 Java 8, Java 21 이상 필요**
- `npm run test:audit-evaluation:rules`: **BLOCKED — 같은 Java prerequisite**

### 배포 전 필요 작업

- Java 21 이상에서 Firestore·Storage Rules emulator suite 통과
- production admin UID-role map과 partner migration dry-run 결과 승인
- `accountStatus`, Auth disabled/claims, partner status inventory 검토
- 최소 2개 활성 `super_admin` 확보
- Firestore managed export 또는 동등 backup 생성
- Rules/index/application staging 배포와 권한별 계정 smoke
- rollback rehearsal, audit log와 401/403/409/Auth sync 모니터링 준비

### NEXT_GATE

**NEEDS_DATA_MIGRATION_APPROVAL**

## STEP 8 구현·검증 결과

### 데이터 접근 경계

- 운영자·제휴사 관리자 UI는 Firebase client SDK에서 Auth token만 얻고,
  목록·상세·mutation은 서버 API와 Admin SDK를 사용한다.
- 운영자 role·permission·상태와 partner profile·계정 연결의 client direct
  write는 허용하지 않는다.
- 외부 제휴사 계정은 `role=partner + partnerId`와 active partner 문서,
  assignment 관계로 자기 범위만 접근한다.

### Rules 변경

- Firestore·Storage에 `isActiveAccount()`를 추가했다.
  - `accountStatus`가 있으면 `active`만 허용
  - migration 전 문서에만 legacy `status=active` fallback
- admin과 partner Rules가 같은 활성 계정 판정을 사용한다.
- 관리자 전체 `users` client read를 제거하고 자기 profile read만 유지했다.
- `auditLogs`, `partnerUniqueKeys`를 Admin SDK 전용으로 명시 차단했다.
- `consultRequests` 전체 mutation과 `consult-attachments` write를 서버
  API/Admin SDK 전용으로 정렬했다.
- partner 문서 상태, assignment partnerId와 client mutation 차단을 유지했다.
- operator API가 생성·상태 변경 시 canonical `accountStatus`와 legacy
  `status`를 함께 기록하도록 정렬했다.

### Indexes 변경

- `firestore.indexes.json` 변경 없음
- 실제 필요한 기존 두 index를 확인했다.
  - `partnerAssignments(partnerId, status)`
  - `partnerAssignments(requestId, status)`
- 운영자/제휴사 목록의 현재 query는 추가 composite index가 필요하지 않아
  role+status, partnerType+status 같은 speculative index를 추가하지 않았다.

### 공격 시나리오 결과

- PASS: 자기 role 상승, 하위 role의 super-admin 수정, 비활성 API,
  삭제 API 직접 호출, body role/permission 조작, cross-partner 접근,
  partner 상태 변경, paused partner 접근, linked partner hard delete,
  password/token log, Firestore client write 우회
- PASS/NOT_APPLICABLE: 설계에 없는 PARTNER_ADMIN/PARTNER_OPERATOR는
  `role=partner + partnerId` 공격 모델로 검증
- PARTIAL:
  - 마지막 `super_admin` 보호는 존재하지만 동시 변경 race lock이 없음
  - 직접 URL은 운영 데이터를 차단하지만 client-auth 구조상 정적 shell은 로드됨

상세 expected/actual 근거는 `docs/admin-security-validation-report.md`에 기록했다.

### Migration 검증

- `migrate-admin-rbac.mjs`, `migrate-partners.mjs`
  - 기본 dry-run
  - `--apply --confirm-production`에서만 write
  - `--expected-project` 또는
    `FIREBASE_MIGRATION_EXPECTED_PROJECT_ID` 필수
  - 대상 project mismatch 즉시 중단
  - 대상·변경·applied/skipped/failure 요약
  - merge/transaction 기반 재실행 가능
  - 비밀번호·token·private key 미출력
- 실제 운영 dry-run/apply는 실행하지 않았다.
- apply 전 managed Firestore export 또는 동등 backup이 필요하다.

### Seed 검증

- `seed-admin.mjs`
  - project ID·production confirmation 검증
  - 신규 user 또는 `--reset-password`에서만 비밀번호 변경
  - 기존 유효 `adminRole`, allow/deny override와 UID 보존
  - `accountStatus=active`, `status=active`, merged `admin:true` claim
  - password/token 미출력과 반복 실행 안전성 강화
- `check-admin-ready.mjs`
  - Auth disabled, claim, Firestore role, super-admin role과 canonical
    account status를 read-only 확인

### STEP 8 테스트 결과

- `npm run test:admin-rbac`: **PASS, 57/57**
- `npm run test:cms`: **PASS, 91/91**
- `npm test`: **PASS**
- `npm run test:integration`: **PASS, 6/6**
- migration·seed·readiness script syntax/help: **PASS**
- `npm run typecheck`: **PASS**
- `npm run lint`: **PASS**
- `npm run build`: **PASS, 51 static pages**
- `npm run test:cms:rules`: **BLOCKED**
  - 로컬 Java 8
  - 현재 Firebase CLI는 Java 21 이상 필요
- 비실패 경고: 기존 Node module-type 및 `punycode` deprecation 경고

### 남은 차단 요소

- Java 21 환경의 Firestore·Storage Rules emulator matrix
- production admin UID-role map과 partner migration dry-run 승인
- 최소 2개 활성 `super_admin`과 동시 변경 보호 강화
- Auth/Firestore partial failure reconciliation
- Rules/index/application staging 배포와 권한별 실제 계정 smoke test

### STEP 9 최종 확인 항목

- STEP 1 gap과 STEP 3~8 구현 범위 COMPLETE/PARTIAL 재분류
- Java 21 Rules test 결과 반영
- migration dry-run과 backup 승인 상태 확인
- 운영자·partner 실제 staging lifecycle과 감사 로그 확인
- completion report·production checklist·NEXT_GATE 최종 확정

## STEP 7 구현 결과

### 완성한 화면

- API 기반 제휴사 목록
  - 제휴사명·유형·내부 식별번호·담당자·이메일·연락처·상태·
    소속 운영자 수·수정일·관리 메뉴
  - 이름 또는 `partnerId` 검색, 유형·상태 필터, 10/20/50건 페이지네이션
  - 로딩·빈 결과·API 오류·재시도·수동 갱신
- 제휴사 등록·수정 modal
  - STEP 6 확정 필드만 제공
  - 유형 Select, 서비스 범위 checkbox, 상태 Select
  - 필수값·이메일·전화번호·포인트 범위 검증
  - 제휴사명·담당자 이메일 중복 API 오류를 필드 맥락의 문구로 표시
  - 저장 중 중복 제출·modal 닫기 방지, Escape·focus trap·작은 화면 scroll
- 제휴사 상세
  - 기본정보, 담당자, 상태, 서비스 범위, 메모
  - 실제 API가 계산한 계정·배정·초안·답변 요약
  - overview에 포함된 해당 제휴사 감사 로그의 최근 이력
  - 문의 배정과 답변 초안 검수의 기존 화면 기능 유지
- 종료 UX
  - hard delete 버튼을 제공하지 않고 `terminated` soft 종료만 제공
  - 중지·종료가 소속 계정 Auth/API 접근을 차단한다는 확인 문구 표시

### 운영자 연결 UI

- `users.role=partner + partnerId` 계정을 소속 운영자로 표시한다.
- 계정 이름·이메일·역할·상태·전화번호·수정일과 빈 상태를 표시한다.
- `partners:manageMembers` 권한이 있으면 다음을 제공한다.
  - 임시 비밀번호를 사용하는 신규 계정 생성
  - 기본정보·계정 상태 수정
  - 전체 제휴사 옵션을 조회한 뒤 `targetPartnerId`로 소속 이동
  - 연결 해제 확인 modal
- 내부 관리자 역할과 외부 제휴사 계정 역할을 혼합하지 않는다.

### 권한별 노출 차이

- `partners:read`: 메뉴·목록·상세·운영 현황 조회
- `partners:create`: 제휴사 추가
- `partners:update`: 기본정보·담당자·포인트·메모 수정
- `partners:changeStatus`: 상태 변경·종료
- `partners:manageScope`: 서비스 범위 수정
- `partners:manageMembers`: 소속 계정 생성·수정·이동·연결 해제
- 권한 없는 직접 화면 접근에는 접근 거부 상태를 표시하며 API가 최종 인가한다.
- 확정 설계에 없는 `PARTNER_ADMIN/PARTNER_OPERATOR` 관리자 역할은 추가하지
  않았다. 외부 제휴사 계정은 기존 partner portal에서 자기 `partnerId`와
  배정 범위만 접근한다.

### STEP 7 테스트 결과

- `npm run test:admin-rbac`: **PASS, 41/41**
  - 신규 제휴사 폼·상태·오류·계정 검증 5건
  - 신규 목록·상세·필터·오류·확인·권한 UI 계약 6건
- `npm run test:cms`: **PASS, 90/90**
- `npm run test:e2e`: **PASS, 63 scenarios, console error 0**
- `npm run typecheck`: **PASS**
- `npm run lint`: **PASS**
- `npm run build`: **PASS, 51 static pages**
- 비실패 경고: 기존 Node module-type 및 `punycode` deprecation 경고

### 의도적으로 제외하거나 남은 제한

- 사업자등록번호·계약기간은 STEP 6 확정 스키마에서 제외되어 입력·상세
  섹션을 만들지 않았다. 목록 식별번호는 `partnerId`다.
- `terminated` 제휴사는 복구·수정 UI를 제공하지 않는다.
- 별도 제휴사 감사 로그 endpoint가 없어 최근 이력은 overview가 반환한
  audit log 범위 안에서 표시한다.
- 이메일 초대·재초대 발송 수단이 없어 계정 추가는 임시 비밀번호 방식이다.
- Auth·Firestore 부분 실패 자동 reconciliation은 STEP 8 준비 제한사항이다.

### STEP 8 보안 검증 준비사항

- `partners.*` 버튼 노출과 각 API permission의 대조 검증
- 다른 제휴사 계정 이동·수정·연결 해제 격리 테스트
- paused·terminated 전환 후 Auth disabled/claim/API 차단 staging 검증
- Java 21 환경의 Firestore·Storage Rules emulator 전체 실행
- partner migration dry-run 결과와 unique-key 충돌 검토
- 실제 staging 계정으로 긴 이름·이메일, 작은 화면, keyboard focus 수동 검증

## STEP 6 구현 결과

### 제휴사 컬렉션 구조

- 기존 `partners/{partnerId}`를 유지한다.
- 저장 필드:
  - `id`, `name`, `displayName`, `partnerType`
  - `fields`(서비스 범위)
  - `managerName`, `contactEmail`, `contactPhone`
  - `status`: `pending | active | paused | terminated`
  - `pointMin`, `pointMax`, `memo`
  - `createdAt`, `createdBy`, `createdByEmail`
  - `updatedAt`, `updatedBy`, `updatedByEmail`
  - `statusChangedAt`, `statusChangedBy`, `statusChangedByEmail`
- 설계에서 제외된 `legalName`, `businessNumber`, `representativeName`,
  `address`, 계약 시작·종료일은 추가하지 않았다. 목록의 내부 식별번호는
  Firestore 문서 ID인 `partnerId`다.
- 이름과 담당자 이메일 중복의 경쟁 조건을 막기 위해 서버 전용
  `partnerUniqueKeys/{kind_sha256}` 예약 문서를 사용한다. 원문 이메일은
  unique-key 문서에 복제하지 않는다.

### 구현한 API

- `GET /api/admin/partners`
  - `partners:read`
  - 이름·ID·담당자·연락처 검색, 유형·상태 필터, 페이지네이션
  - 연결된 `users.role=partner` 계정 수와 유형 필터 후보 반환
- `POST /api/admin/partners`
  - `partners:create`
  - 필수값·이메일·길이·서비스 범위·포인트 범위·상태 검증
  - 제휴사명과 담당자 이메일 정규화 중복 차단
  - partner 문서, unique-key 문서, 감사 로그를 한 transaction에서 생성
- `GET /api/admin/partners/{partnerId}`
  - `partners:read`
  - 상세, 연결 계정, 전체·활성 배정, 초안, partner 답변 수 요약
- `PATCH /api/admin/partners/{partnerId}`
  - 기본정보 `partners:update`
  - 상태 `partners:changeStatus`
  - 서비스 범위 `partners:manageScope`
  - 상태 전이, 중복 unique-key 이동, before/after 감사 로그
  - 상태 변경 후 linked Auth disabled/claims 동기화
- `DELETE /api/admin/partners/{partnerId}`
  - `partners:changeStatus`
  - 문서를 삭제하지 않고 `terminated`로 전환
- `GET|POST /api/admin/partners/{partnerId}/accounts`
  - 연결 계정 조회와 신규 제휴사 계정 생성
- `PATCH|DELETE /api/admin/partners/{partnerId}/accounts/{uid}`
  - `partners:manageMembers`
  - 계정 정보·상태·소속 변경과 연결 해제
  - Auth disabled, `partner` claim, `partnerId` claim 동기화

### 운영자 연결 방식

- 내부 운영자(`users.role=admin`)는 제휴사에 소속시키지 않는다.
- 제휴사 로그인 계정은 기존 `users.role=partner`, `users.partnerId`를
  단일 관계 원본으로 사용한다.
- `partners` 문서에 계정 UID 배열을 중복 저장하지 않는다.
- 상세·목록의 소속 계정은 `users.partnerId == partnerId` 쿼리로 계산한다.
- 소속 변경은 한 user 문서의 `partnerId`를 transaction에서 변경해
  양쪽 상세 조회에 즉시 반영되며 연결·해제 감사 로그를 각각 남긴다.
- 확정 설계에 없는 `PARTNER_ADMIN/PARTNER_OPERATOR`는 추가하지 않았다.
  외부 제휴사 계정은 기존 `/api/partner/session`과 배정 API로 자기
  `partnerId` 범위만 접근한다.

### 상태와 삭제 정책

- 요청의 `SUSPENDED` 의미는 기존 값 `paused`로 유지한다.
- `pending -> active|terminated`
- `active -> paused|terminated`
- `paused -> active|terminated`
- `terminated`는 복원·수정하지 않는 종결 상태다.
- `pending`, `paused`, `terminated`에서는 `requirePartner()`가 API 접근을
  차단하고 linked Firebase Auth 계정도 disabled/claim false로 동기화한다.
- hard delete API는 제공하지 않는다. 계정·배정·초안·답변 연결 여부와
  관계없이 종료 상태와 감사 이력을 보존하므로 고객·견적·보고서 등
  미래 연결 데이터도 실수로 연쇄 삭제되지 않는다.

### Migration 필요 여부

- **필요함**: 기존 문서의 정규화 필드, 상태 변경 메타데이터와
  `partnerUniqueKeys` 예약 문서를 backfill해야 한다.
- `scripts/migrate-partners.mjs`
  - 기본 dry-run
  - `--apply --confirm-production`에서만 쓰기
  - 대상·변경 필드·invalid 문서·중복 충돌·실패 건수 출력
  - transaction과 merge를 사용해 재실행 가능
- 실제 apply는 실행하지 않았다.

### STEP 6 테스트 결과

- `npm run test:partner`: **PASS, 5/5**
- `npm run test:admin-rbac`: **PASS, 30/30**
  - 신규 제휴사 API 권한·목록·중복·격리·상태·연결·종료·migration 계약 6건
- `npm test`: **PASS**
- `npm run test:integration`: **PASS, 6/6**
- `node scripts/migrate-partners.mjs --help`: **PASS**
- `npm run typecheck`: **PASS**
- `npm run lint`: **PASS**

### STEP 7에서 사용할 API 계약

- 목록: `GET /api/admin/partners?search=&type=&status=&page=&pageSize=`
- 상세: `GET /api/admin/partners/{partnerId}`
- 생성: `POST /api/admin/partners`
- 수정·상태·서비스 범위: `PATCH /api/admin/partners/{partnerId}`
- 종료: `DELETE /api/admin/partners/{partnerId}` (soft terminate)
- 계정 목록·생성: `GET|POST /api/admin/partners/{partnerId}/accounts`
- 계정 수정·소속 변경·해제:
  `PATCH|DELETE /api/admin/partners/{partnerId}/accounts/{uid}`
- STEP 7에서는 이 계약을 사용해 목록 필터, 상세, 계정 lifecycle,
  상태·종료 확인 UI를 구현하며 API 보안 판정을 대체하지 않는다.

## STEP 5 구현 결과

### 완성한 화면

- 운영자 목록: 이름·이메일, 직책·담당, 역할, 내부 소속, `ALL` 접근 범위,
  계정 상태, Firebase Auth 최근 로그인, 수정일, 관리 메뉴 표시
- 이름·이메일 검색, 역할·상태·소속 필터, 10/20/50건 페이지네이션
- 목록 로딩·빈 결과·오류·재시도·수동 갱신 상태
- 운영자 추가: 역할 Select, 역할 설명과 주요 권한 미리보기, 계정 상태,
  고정 소속·범위 안내, 임시 비밀번호 정책, 필드별 검증
- 운영자 수정: 기본 정보, 역할, 개별 allow/deny 예외, 상태 변경
- 운영자 상세: 계정 정보, 최근 로그인, 최근 관련 감사 로그, 권한별 작업 버튼
- 위험 변경 확인: 최고관리자 역할 변경, 역할 강등, 비활성화, 삭제

### 변경한 컴포넌트와 공통 모듈

- `components/AdminDashboard.tsx`
  - 운영자 목록·필터·페이지네이션·상세·추가·수정·확인 흐름
  - 모달 초기 포커스, Tab 포커스 순환, Escape 닫기, 저장 중 닫기 방지
  - canonical `canShowAdminMenu()` / `canShowAdminAction()` 기반 노출 제어
- `lib/admin/operator-ui.ts`
  - 폼 검증, 역할 선택 범위, 권한 미리보기, 보호·위험 변경 판정,
    안전한 서버 오류 문구 매핑
- `app/globals.css`
  - 운영자 전용 표·필터·모달·권한 미리보기와 작은 화면 스크롤 대응
- `lib/cms/defaults.ts`
  - 신규 운영자 UI 문구를 `admin.operations` CMS 기본값으로 등록

### API 연결 상태

- `GET /api/admin/operators`
  - `operators:read` 필수
  - 검색·역할·상태·소속 필터와 서버 페이지네이션
  - Firebase Auth `lastSignInTime`을 ISO 시간으로 정규화
  - 전체 활성 최고관리자 수 반환
- `POST /api/admin/operators`
  - 생성 성공 후 모달 닫기와 목록 갱신
  - Firebase 중복 이메일을 `409 email_already_exists`로 정규화
- `PATCH /api/admin/operators/[uid]`
  - 수정된 민감 필드만 전송해 자기 기본정보 수정이 역할·상태 변경으로
    오인되지 않도록 처리
- `DELETE /api/admin/operators/[uid]`
  - 삭제 확인 후 목록 갱신
- `GET /api/admin/overview`
  - UI가 공통 권한 헬퍼를 사용할 수 있도록 `adminContext` 반환

### 권한별 노출 제어

- `operators:read`: 운영자 하위 메뉴와 목록
- `operators:create`: 운영자 추가 버튼
- `operators:update`: 기본정보 수정
- `operators:manageRoles`: 역할과 개별 권한 예외
- `operators:disable`: 활성·비활성 전환
- `operators:resetPassword`: 비밀번호 재설정
- `operators:delete`: 삭제
- 본인 민감 설정, 마지막 활성 `super_admin`, 현재 역할 이상 대상은
  UI에서 사전 차단하며 서버 API가 최종 판정한다.

### STEP 5 테스트 결과

- `npm run test:admin-rbac`: **PASS, 24/24**
  - 신규 운영자 폼·역할·권한 미리보기·보호 정책 단위 테스트 4건
  - 신규 운영자 목록·오류·중복 제출·버튼 노출·위험 변경 UI 계약 테스트 5건
- `npm run test:cms`: **PASS, 90/90**
- `npm run test:e2e`: **PASS, 63 scenarios, console error 0**
- `npm run typecheck`: **PASS**
- `npm run lint`: **PASS**
- `npm run build`: **PASS, 51 static pages**
- 비실패 경고: 기존 Node module-type 및 `punycode` deprecation 경고

### 남은 운영자 관리 제한사항

- 이메일 초대·재초대 발송 수단이 없어 임시 비밀번호 방식만 제공한다.
- UI 쓰기 상태는 현재 API가 지원하는 `active/disabled`에 한정된다.
  기존 `invited/suspended` 문서는 목록 필터·표시는 가능하지만 별도 상태 전이 API가 필요하다.
- 내부 운영자는 설계상 제휴사 소속 없이 `ALL` 범위로 고정된다.
  외부 제휴사 계정은 운영자 화면에 혼합하지 않는다.
- Auth·Firestore 부분 실패 reconciliation과 마지막 최고관리자 동시성 강화는
  기존 프로덕션 준비 제한사항으로 남아 있다.
- 실제 Firebase 테스트 계정으로 키보드 포커스, 긴 이메일, 640px 이하 화면,
  중복 이메일과 상태 변경을 수동 확인해야 한다.

### STEP 6 준비사항

- `partners/{partnerId}` 프로필과 `users.role=partner` 계정 lifecycle을 분리 유지
- 제휴사 계정 역할을 내부 `adminRole`에 추가하지 않음
- partner 상태 변경 시 linked Auth disabled/claim 동기화와 reconciliation 설계
- 제휴사 중복 방지, 계정 초대·재초대 전달 방식, 서비스 범위 UI/API 계약 확정
- STEP 6은 이번 단계에서 실행하지 않음

## 전체 프로그램 상태(기존 STEP 9 기준)

### 완료 기능

- 공통 RBAC 타입, 역할 preset, allow/deny override, scope·계정 상태 판정
- Firebase ID token·claim·Firestore profile 기반 관리자/제휴사 API 인가
- 운영자·제휴사 기본 목록, 생성, 수정, 상태·권한·계정 mutation
- 운영자 action permission과 역할 계층·자기 변경·마지막 최고관리자 guard
- 운영자 목록 복합 필터·페이지네이션·최근 로그인과 권한 기반 CRUD UI
- 제휴사 목록·상세·생성·수정·상태·종료·계정 연결 서버 API
- 제휴사 목록 필터·페이지네이션·상세·요약·감사 이력과 권한 기반 UI
- 제휴사 계정 생성·수정·소속 이동·연결 해제 UI와 위험 작업 확인 modal
- 제휴사명·담당자 이메일 transaction unique-key 예약과 dry-run migration
- 제휴사 상태 변경 시 linked Auth disabled/claims 동기화
- partner active 상태, partnerId, assignment, category scope 격리
- 제출된 partner draft lock과 Storage partner direct attachment read 차단
- 감사 로그 민감정보 redaction
- partner assignment composite index manifest
- 명시적 UID-role map을 요구하는 dry-run 우선 RBAC migration
- 하드코딩된 smoke 관리자 credential 제거

### 미완성 기능

- `accountStatus` 전체 write lifecycle과 reset-email/re-invitation
- Auth·Firestore 부분 실패 reconciliation과 last-super-admin 동시성 강화
- partner Auth sync 실패 자동 reconciliation
- 관리자 메뉴·버튼 전체를 canonical permission helper로 통일
- assignment-authorized attachment 전달 흐름의 staging 검증
- legacy 누락 `adminRole -> super_admin` fallback 제거

### 최종 테스트 결과

- `npm run cms:audit`: PASS
- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm test`: PASS
- `npm run test:integration`: PASS, 6/6
- `npm run test:e2e`: PASS, 63 scenarios, console error 0
- `npm run verify:audit-report-pdf`: PASS, 7 fixtures
- `npm run build`: PASS, 51 static pages
- `git diff --check`: PASS
- `npm run test:cms:rules`: BLOCKED — local Java 8, Java 21+ 필요
- `npm run test:audit-evaluation:rules`: BLOCKED — 동일 prerequisite

### 배포 전 필요 작업

- Java 21 환경에서 Firestore/Storage Rules emulator 전체 통과
- production admin UID별 역할 map 및 `accountStatus` migration 승인
- 최소 2개 활성 `super_admin` 확보
- linked partner Auth reconciliation staging rehearsal
- Firestore indexes·Rules·application 순서 배포와 rollback 준비
- 실제 staging 계정으로 관리자·partner lifecycle 수동 검증

상세 보고:

- `docs/admin-operator-partner-gap-analysis.md`
- `docs/admin-rbac-design.md`
- `docs/admin-security-validation-report.md`
- `docs/admin-operator-partner-completion-report.md`
- `docs/admin-operator-partner-production-checklist.md`

## STEP 3 기록(역사)

- `docs/admin-operator-partner-gap-analysis.md`: STEP 2 시작 시 저장소에 없음
- 본 문서: STEP 2 시작 시 저장소에 없어 새로 작성
- 설계 기준: 실제 인증·관리자·제휴사 코드와 Firebase Rules

## STEP 3 구현 결과

### 구현한 타입

- `AdminRole`
- `AdminPermission`
- `AdminCapability` (기존 API 호환 alias)
- `AdminScope`
- `AdminStatus`
- `PartnerStatus`
- `PartnerType`
- `OperatorProfile`
- `PartnerRecord`
- `AuthorizationContext`
- `AdminResourceDescriptor`
- `AuditLogRecord`
- `AdminAuditLogInput`
- `AuditLogSnapshot`, `AuditLogValue`, `AuditLogTargetType`

관리자·제휴사 로그인 계정에는 optional `accountStatus`를 추가했다.
기존 문서는 `users.status` fallback으로 계속 동작한다.

### 구현한 권한 함수

- `getEffectivePermissions()`
- `hasPermission()`
- `hasAnyPermission()`
- `hasAllPermissions()`
- `getAccountStatus()`
- `isAccountActive()`
- `createAuthorizationContext()`
- `canAccessResource()`
- `canManageOperator()`
- `canManagePartner()`
- `isSuperAdmin()`
- `wouldRemoveLastSuperAdmin()`
- `canShowAdminMenu()` (UX 전용)
- `canShowAdminAction()` (UX 전용)

`resolveAdminCapabilities()`, `hasAdminCapability()`,
`normalizeAdminCapabilities()`, `ADMIN_CAPABILITIES`는 기존 API·UI 호환을 위해 유지한다.

### 구현한 서버 인가 함수

- `requireAuthenticatedAdmin()`
- `requireActiveAdmin()`
- `requirePermission()`
- `requireAnyPermission()`
- `requireRole()`
- `assertAdminScope()`
- `AdminAuthorizationError`
- `authErrorResponse()`
- `getRequestId()`
- `writeAdminAuditLog()`
- `addAdminAuditLog()`

기존 `requireAdmin()`과 `requireAdminCapability()`는 새 함수에 위임한다.
Bearer Firebase ID token, admin claim, Firestore profile, accountStatus를 순서대로 확인한다.
인증 누락·유효하지 않은 token은 401, 비활성·권한·scope 거부는 403이다.

### 감사 로그 기반

- 기존 `auditLogs` 컬렉션과 기존 writer를 유지한다.
- 신규 canonical input은 `actorId`, `actorEmail`, `action`, `targetType`,
  `targetId`, `before`, `after`, `createdAt`, `requestId`를 지원한다.
- password, token, secret, authorization, cookie, private key,
  reset link, credential 계열 필드는 재귀적으로 `[REDACTED]` 처리한다.
- 기존 `actorUid` 저장 형식은 표시·조회 호환을 위해 유지한다.

### 테스트 결과

- `npm run test:admin-rbac`: **15/15 통과**
- 기존 `admin-rbac-partner.test.ts`: **3/3 통과**
- `npm run typecheck`: **통과**
- `npm run lint`: **통과**

Node의 기존 module-type/punycode 경고가 출력되었으나 테스트 실패는 아니다.

### STEP 3 변경 파일

- `lib/firebase/schema.ts`
- `lib/admin/rbac.ts`
- `lib/admin/menu-permissions.ts` (신규)
- `lib/admin/audit.ts` (신규)
- `lib/firebase/server.ts`
- `lib/partners.ts`
- `lib/admin/testing/authorization-policy.test.ts` (신규)
- `lib/admin/testing/server-authorization.test.ts` (신규)
- `package.json`
- `docs/admin-console-rbac-progress.md`

### 아직 구현하지 않은 항목

- 운영자 CRUD API 분리·action permission 적용
- 운영자 상태와 Firebase Auth disabled/claims 동기화
- 운영자 관리 UI
- 제휴사 CRUD·계정 관리 API와 UI
- 제휴사 문서 상태를 확인하는 partner API 차단
- Firestore/Storage Rules와 composite indexes
- 프로덕션 migration과 배포

### STEP 4에서 사용할 함수와 경로

- 역할·권한: `lib/admin/rbac.ts`
  - `getEffectivePermissions`
  - `hasPermission`
  - `canManageOperator`
  - `isSuperAdmin`
  - `wouldRemoveLastSuperAdmin`
- 서버 인가: `lib/firebase/server.ts`
  - `requirePermission`
  - `requireAnyPermission`
  - `requireRole`
  - `assertAdminScope`
  - `authErrorResponse`
  - `getRequestId`
- 감사 로그: `lib/admin/audit.ts`, `lib/firebase/server.ts`
  - `prepareAdminAuditLog`
  - `writeAdminAuditLog`
  - `addAdminAuditLog`
- 타입: `lib/firebase/schema.ts`
  - `AdminPermission`
  - `AdminStatus`
  - `OperatorProfile`
  - `AuthorizationContext`
- 기존 운영자 API:
  - `app/api/admin/operators/route.ts`
  - `app/api/admin/operators/[uid]/route.ts`

## STEP 2 완료 항목

- [x] 기존 Firebase 인증·Custom Claims 구조 확인
- [x] 관리자 역할·capability·override 구조 확인
- [x] 운영자 API와 마지막 최고관리자 보호 확인
- [x] 제휴사 프로필·계정·배정·초안 workflow 확인
- [x] Firestore/Storage Rules와 index gap 확인
- [x] 목표 역할·권한·상태·접근 범위 확정
- [x] RBAC 설계 문서 작성
- [x] 9개 Phase 구현 계획 작성
- [ ] 애플리케이션 기능 구현
- [ ] 프로덕션 데이터 migration
- [ ] 프로덕션 배포

애플리케이션 기능 구현, 프로덕션 데이터 수정, 배포는 STEP 2에서 수행하지 않는다.

## 확정된 역할

내부 관리자 역할은 기존 이름을 유지한다.

- `super_admin`
- `operations_manager`
- `partner_manager`
- `cms_editor`
- `read_only`

계정 종류는 기존 `users.role`을 유지한다.

- `member`
- `admin`
- `partner`

`PARTNER_ADMIN`, `PARTNER_OPERATOR`는 현재 제휴사 self-service 회원 관리 기능이 없어
채택하지 않는다.

## 확정된 권한

### 유지

- `admin:access`
- `members:read`, `members:write`
- `inquiries:read`, `inquiries:write`
- `faqs:read`, `faqs:write`
- `audit:read`
- `auditQuotes:read`, `auditQuotes:write`
- `auditEvaluations:read`, `auditEvaluations:write`
- `cms:read`, `cms:write`
- `operators:read`
- `partners:read`
- `points:read`

### 세분화

운영자:

- `operators:create`
- `operators:update`
- `operators:disable`
- `operators:delete`
- `operators:manageRoles`
- `operators:resetPassword`

제휴사:

- `partners:create`
- `partners:update`
- `partners:changeStatus`
- `partners:manageMembers`
- `partners:manageScope`

포인트:

- `points:adjust`

### 호환 후 제거

- `admin:read`
- `operators:write`
- `partners:write`
- `points:write`

`operators:write`와 `partners:write`는 migration 기간에 action capability alias로만 사용한다.

## 확정된 접근 범위

- `ALL`: capability가 허용한 내부 관리자 데이터
- `ORGANIZATION`: 같은 `cooperativeId` 또는 `nh_org_id`의 회원 데이터
- `PARTNER`: 같은 `partnerId`의 제휴사 데이터
- `ASSIGNED`: 활성 제휴사 배정에 연결된 문의·초안
- `OWN`: 자기 프로필·자기 작성 데이터

`REGION`은 현재 지역 소유권 모델이 없어 채택하지 않는다.
내부 관리자는 현재 `ALL`만 사용하며 사용하지 않는 scope 필드를 미리 추가하지 않는다.

## 확정된 운영자 상태

신규 `accountStatus`:

- `invited`
- `active`
- `suspended`
- `disabled`

| 상태 | 로그인 | API·데이터 | Firebase Auth disabled |
|---|---|---|---|
| `invited` | 불가 | 불가 | `true` |
| `active` | 가능 | 권한·범위에 따라 가능 | `false` |
| `suspended` | 불가 | 불가 | `true` |
| `disabled` | 불가 | 불가 | `true` |

기존 `users.status`는 회원 승인 workflow를 위해 유지하고 관리자·제휴사 계정 상태는
`accountStatus`로 분리한다.

## 확정된 제휴사 상태

- `pending`
- `active`
- `paused`
- `terminated`

기존 `paused`를 `SUSPENDED` 의미로 유지한다.
`active`가 아닌 제휴사는 새 배정, 소속 계정 로그인, API·데이터 접근을 허용하지 않는다.
기존 데이터와 감사 이력은 삭제하지 않는다.

## Custom Claims 사용 여부

사용한다.

- `admin: true`: 내부 관리자 coarse gate
- `partner: true`: 외부 제휴사 coarse gate

역할, capability, override, accountStatus는 claim에 저장하지 않는다.
최종 권한 원본은 Firestore user profile, partner document, assignment document다.
현재 `partnerId` claim은 호환할 수 있으나 서버 인가의 원본으로 사용하지 않는다.

## 마이그레이션 필요 항목

- 관리자 `status` -> `accountStatus`
- 제휴사 로그인 계정 `accountStatus` 추가
- `adminRole` 누락 관리자에 명시적 역할 지정
- 승인된 Firebase UID만 `super_admin`으로 지정
- `operators:write` -> 운영자 action capability 변환
- `partners:write` -> 제휴사 action capability 변환
- `points:write` -> `points:adjust` 변환
- partner status와 linked Auth user disabled/claims 정합성 보정
- Custom Claims merge 갱신 방식으로 전환
- 마지막 최고관리자 보호 transaction·동시성 보강
- `partnerAssignments` composite indexes 추가
- Storage attachment 접근을 assignment 단위로 축소

모든 migration은 dry-run 기본이며 STEP 2에서는 실행하지 않는다.

## 다음 구현 단계의 주요 파일

### 공통 RBAC

- `lib/firebase/schema.ts`
- `lib/admin/rbac.ts`
- `lib/firebase/server.ts`
- `lib/admin/authorization-context.ts` (신규)
- `lib/admin/authorization-policy.ts` (신규)

### 운영자 API·UI

- `app/api/admin/operators/route.ts`
- `app/api/admin/operators/[uid]/route.ts`
- `app/api/admin/operators/[uid]/status/route.ts` (신규)
- `app/api/admin/operators/[uid]/role/route.ts` (신규)
- `app/api/admin/operators/[uid]/password-reset/route.ts` (신규)
- `components/AdminDashboard.tsx`
- `components/admin/OperatorManagementPanel.tsx` (신규)

### 제휴사 API·UI

- `lib/partners.ts`
- `app/api/admin/partners/route.ts`
- `app/api/admin/partners/[partnerId]/route.ts`
- `app/api/admin/partners/[partnerId]/accounts/route.ts`
- `app/api/admin/requests/[requestId]/partner-assignment/route.ts`
- `app/api/admin/partner-drafts/[draftId]/route.ts`
- `app/api/partner/session/route.ts`
- `app/api/partner/assignments/route.ts`
- `app/api/partner/assignments/[assignmentId]/draft/route.ts`
- `components/admin/PartnerManagementPanel.tsx` (신규)
- `components/PartnerDashboard.tsx`

### Rules·indexes·migration·test

- `firestore.rules`
- `storage.rules`
- `firebase.json`
- `firestore.indexes.json` (신규)
- `scripts/migrate-admin-rbac.mjs`
- `scripts/migrate-admin-account-status.mjs` (신규)
- `scripts/reconcile-auth-profiles.mjs` (신규)
- `lib/admin/testing/authorization-policy.test.ts` (신규)
- `lib/partner/testing/partner-workflow.test.ts` (신규)

## 확인된 주요 구현 gap

- 현재 운영자·제휴사 쓰기 권한이 coarse `write`로 묶여 있다.
- 관리자·제휴사 계정 상태가 회원 승인 상태와 혼재한다.
- `adminRole` 누락 계정이 현재 최고관리자로 해석된다.
- 일부 감사평가 mutation이 `auditEvaluations:read`만 요구한다.
- 제휴사 문서 상태가 partner API 로그인에 반영되지 않는다.
- 제휴사 계정 생성 API는 있으나 관리 UI가 없다.
- 제출된 제휴사 초안을 partner가 다시 덮어쓸 수 있다.
- Storage Rules가 모든 partner에게 모든 상담 첨부파일 읽기를 허용한다.
- partner assignment query용 composite index manifest가 없다.

## 작성 문서

- `docs/admin-rbac-design.md`
- `docs/admin-operator-partner-implementation-plan.md`
- `docs/admin-console-rbac-progress.md`

위 내용은 STEP 3 당시의 역사 기록이며 현재 상태와 NEXT_GATE는 문서 상단을 따른다.
