# 관리자 권한·제휴사 관리 구현 계획

작성 단계: STEP 2  
실행 대상: STEP 3 이후  
상태: 계획 확정, 미실행

이 계획은 `docs/admin-rbac-design.md`와 실제 저장소 코드를 기준으로 한다.
이번 STEP 2에서는 아래 Phase를 실행하지 않는다.

## 공통 구현 원칙

- 기존 Firebase Authentication과 `users`, `partners`, `partnerAssignments`,
  `partnerAnswerDrafts` 컬렉션을 유지한다.
- 역할·권한 정의는 프런트엔드와 서버가 같은 타입과 상수를 사용한다.
- API가 최종 인가를 수행하며 메뉴 숨김만으로 권한을 통제하지 않는다.
- 프로덕션 데이터 migration은 dry-run과 별도 승인 없이는 실행하지 않는다.
- 비밀번호와 token은 Firestore·로그·CLI 인수에 저장하지 않는다.
- 기존 감사평가 미커밋 작업을 reset하거나 덮어쓰지 않는다.

## Phase 1. 공통 타입과 권한 엔진

### 목적

역할, 세부 권한, 계정 상태, 데이터 범위를 분리하고 모든 관리자 API가 사용할
단일 권한 판정 구조를 만든다.

### 수정 대상 파일

- `lib/firebase/schema.ts`
- `lib/admin/rbac.ts`
- `lib/firebase/server.ts`
- `lib/cms/testing/admin-rbac-partner.test.ts`

### 신규 파일

- `lib/admin/authorization-context.ts`
- `lib/admin/authorization-policy.ts`
- `lib/admin/testing/authorization-policy.test.ts`

### 구현 내용

- 기존 관리자 역할 5개를 유지한다.
- 운영자·제휴사 민감 작업에 action capability를 추가한다.
- legacy `operators:write`, `partners:write`, `points:write` alias를
  호환 계층에서 action capability로 확장한다.
- `accountStatus = invited | active | suspended | disabled`를 추가한다.
- `AuthorizationContext`에 uid, account type, role, effective capabilities,
  effective scopes, partnerId, organizationId를 담는다.
- 역할 preset -> allow override -> deny override 순서로 권한을 계산한다.
- deny가 최종 우선이며 `admin:access`도 deny 가능하게 한다.
- `ALL`, `ORGANIZATION`, `PARTNER`, `ASSIGNED`, `OWN`만 지원한다.
- `super_admin`도 같은 엔진을 통과하며 이메일·UID bypass를 만들지 않는다.

### 기존 기능 영향

- 기존 role 이름과 컬렉션은 유지된다.
- `status` fallback으로 기존 관리자가 바로 잠기지 않게 한다.
- legacy capability는 전환 기간 동안 계속 동작한다.

### 테스트 방법

- 역할별 capability snapshot 테스트
- allow/deny 우선순위 테스트
- 비활성 계정 capability 빈 배열 테스트
- legacy alias expansion 테스트
- 역할과 data scope가 독립적으로 계산되는지 테스트

### 완료 조건

- 모든 역할의 effective capability가 결정적이다.
- `read_only`가 쓰기 권한을 기본으로 갖지 않는다.
- `accountStatus != active`이면 모든 관리자·제휴사 API 권한이 없다.
- 타입과 정책 코드에 이메일 하드코딩이 없다.

### 위험 요소

- legacy `adminRole` 누락 계정 처리 방식에 따라 과도한 권한 또는 잠금이 발생할 수 있다.
- capability 이름 변경이 기존 정적 테스트를 깨뜨릴 수 있다.

### 롤백 방법

- API는 기존 coarse capability도 인식하도록 호환 계층을 유지한다.
- 새 `accountStatus`가 없으면 기존 `status`를 읽는 fallback을 유지한다.
- Phase 1 배포 롤백 시 새 필드는 무시되며 기존 컬렉션 구조는 그대로다.

## Phase 2. 운영자 API와 Firebase Auth 연동

### 목적

운영자 생성, 수정, 상태 변경, 역할 변경, 비밀번호 재설정, 삭제를 서로 다른
권한으로 보호하고 Firestore 프로필과 Firebase Auth를 일관되게 동기화한다.

### 수정 대상 파일

- `app/api/admin/operators/route.ts`
- `app/api/admin/operators/[uid]/route.ts`
- `app/api/admin/session/route.ts`
- `lib/firebase/server.ts`
- `lib/firebase/admin.ts`
- `scripts/seed-admin.mjs`
- `scripts/check-admin-ready.mjs`

### 신규 파일

- `app/api/admin/operators/[uid]/status/route.ts`
- `app/api/admin/operators/[uid]/role/route.ts`
- `app/api/admin/operators/[uid]/password-reset/route.ts`
- `lib/admin/operator-service.ts`
- `lib/admin/testing/operator-service.test.ts`

### 구현 내용

- 운영자 생성은 `operators:create`를 요구한다.
- 일반 정보 수정은 `operators:update`를 요구한다.
- suspend/disable/activate는 `operators:disable`을 요구한다.
- 역할·override 변경은 `operators:manageRoles`를 요구한다.
- 삭제는 `operators:delete`, 비밀번호 재설정은 `operators:resetPassword`를 요구한다.
- 새 운영자는 기본 `operations_manager + invited`로 생성한다.
- 임시 비밀번호를 Firestore에 저장하지 않는다.
- 상태 변경 시 Auth disabled, coarse admin claim, Firestore accountStatus를 동기화한다.
- `setCustomUserClaims` 전에 기존 claims를 읽고 merge한다.
- 자기 정지·삭제·역할 회수와 마지막 활성 최고관리자 제거를 거부한다.
- 역할·상태 변경에 구체적인 오류 코드를 반환한다.
- 부분 실패를 감사 로그에 기록하고 reconciliation 가능한 상태를 남긴다.

### 기존 기능 영향

- 기존 통합 PATCH API 호출은 호환 기간에 새 service로 위임한다.
- 현재 운영자 비밀번호 직접 입력 UI는 password reset flow로 전환할 수 있다.
- 기존 active/rejected 상태 표시는 accountStatus로 대체된다.

### 테스트 방법

- Firebase Auth mock 또는 emulator를 사용한 생성·활성·정지·복구 테스트
- claim merge 보존 테스트
- self-change 차단 테스트
- 마지막 최고관리자 강등·정지·삭제 동시성 테스트
- 권한별 403 matrix
- 비밀번호·reset link가 Firestore·감사 로그에 남지 않는지 검사

### 완료 조건

- 운영자 action마다 별도 capability가 서버에서 검사된다.
- Auth disabled, claim, Firestore accountStatus가 일치한다.
- 마지막 최고관리자를 0명으로 만드는 모든 경로가 차단된다.
- 모든 mutation에 감사 로그가 남는다.

### 위험 요소

- Auth와 Firestore는 단일 transaction으로 묶을 수 없어 부분 실패가 가능하다.
- 비밀번호 reset flow 변경 시 운영자가 로그인을 못 할 수 있다.

### 롤백 방법

- 기존 PATCH payload를 계속 허용하는 adapter를 한 릴리스 유지한다.
- reconciliation 도구로 Auth와 Firestore를 기존 active/rejected 상태로 복원한다.
- 삭제보다 disable을 우선해 UID와 이력을 보존한다.

## Phase 3. 운영자 관리 UI

### 목적

운영자가 역할 preset, action capability override, 상태를 안전하게 관리하고
자신에게 허용되지 않은 메뉴와 작업을 명확히 구분하게 한다.

### 수정 대상 파일

- `components/AdminDashboard.tsx`
- `lib/cms/defaults.ts`
- `lib/cms/admin-operations-content.ts`
- `lib/cms/route-presentation.ts`
- `app/globals.css`
- `lib/cms/testing/admin-operations-integration.test.ts`

### 신규 파일

- `components/admin/OperatorManagementPanel.tsx`
- `components/admin/OperatorRoleEditor.tsx`
- `components/admin/OperatorStatusDialog.tsx`
- `components/admin/useAdminAuthorization.ts`

### 구현 내용

- 거대한 `AdminDashboard`에서 운영자 관리 패널을 분리한다.
- `/api/admin/session`의 effective capability로 탭과 버튼을 표시한다.
- 숨김 여부와 무관하게 API 403을 처리하고 사용자에게 권한 부족을 표시한다.
- 역할 preset 변경 전 실제 추가·회수 권한 diff를 보여준다.
- allow/deny override는 역할 기본값과 구분해 표시한다.
- 마지막 최고관리자와 자기 계정 보호 사유를 구체적으로 표시한다.
- 상태를 invited/active/suspended/disabled로 표시한다.
- 비밀번호 입력 대신 reset action을 사용한다.
- 사용자 노출 문구는 CMS defaults/presentation에 등록한다.

### 기존 기능 영향

- 회원 관리 탭은 유지한다.
- 현재 `position`, `duty` 표시값은 계속 편집 가능하지만 인가와 분리한다.
- 기존 운영자 목록 데이터는 `/api/admin/overview` 또는 전용 GET API에서 받는다.

### 테스트 방법

- 역할별 탭·버튼 visibility 테스트
- 권한 없는 사용자의 직접 API 호출이 403인지 확인
- role diff와 override UI 테스트
- 키보드·focus trap·dialog 접근성 테스트
- CMS literal 검사와 preview 테스트

### 완료 조건

- `operators:manageRoles` 없는 운영자는 역할 편집 UI를 사용할 수 없다.
- UI와 서버의 capability 이름이 같은 공유 상수에서 나온다.
- self/last-super-admin 오류가 일반 저장 오류로 숨겨지지 않는다.

### 위험 요소

- `AdminDashboard` 분리 중 기존 회원·문의 상태가 깨질 수 있다.
- capability 목록이 많아 UI가 복잡해질 수 있다.

### 롤백 방법

- 새 패널을 feature flag로 전환 가능하게 한다.
- 기존 운영자 목록·편집 컴포넌트를 한 릴리스 유지한다.

## Phase 4. 제휴사 API와 데이터 모델

### 목적

기존 `partners` 모델을 유지하면서 상태, 계정, 업무 범위와 답변 workflow의
서버 불변식을 완성한다.

### 수정 대상 파일

- `lib/firebase/schema.ts`
- `lib/partners.ts`
- `app/api/admin/partners/route.ts`
- `app/api/admin/partners/[partnerId]/route.ts`
- `app/api/admin/partners/[partnerId]/accounts/route.ts`
- `app/api/admin/requests/[requestId]/partner-assignment/route.ts`
- `app/api/admin/partner-drafts/[draftId]/route.ts`
- `app/api/partner/session/route.ts`
- `app/api/partner/assignments/route.ts`
- `app/api/partner/assignments/[assignmentId]/draft/route.ts`

### 신규 파일

- `app/api/admin/partners/[partnerId]/status/route.ts`
- `app/api/admin/partners/[partnerId]/members/route.ts`
- `app/api/admin/partners/[partnerId]/members/[uid]/route.ts`
- `lib/partner/partner-service.ts`
- `lib/partner/assignment-policy.ts`
- `lib/partner/testing/partner-service.test.ts`

### 구현 내용

- 기존 필드 `name`, `displayName`, `partnerType`, `fields`, 연락처,
  point range, memo를 유지한다.
- `terminated` 상태와 상태 변경 감사 필드를 추가한다.
- 제휴사 생성, 일반 수정, 상태 변경, 회원 관리, 업무 범위를 별도 capability로 보호한다.
- 제휴사 상태가 active가 아니면 연결 계정과 partner API를 즉시 차단한다.
- 상태 변경 시 linked user accountStatus, claim, Auth disabled를 동기화한다.
- 제출된 초안은 수정 요청 전까지 partner가 덮어쓰지 못하게 한다.
- revision note를 partner API 응답에 포함한다.
- 문의 상태의 대소문자 혼용을 정규화한다.
- 배정 회수 시 문의 상태와 배정 pointer를 일관되게 복원한다.
- partner `fields`는 배정 가능한 문의 category 검증에 사용한다.

### 기존 기능 영향

- 기존 컬렉션명과 document ID 전략을 유지한다.
- 기존 `paused` 값을 유지하고 `terminated`만 추가한다.
- 기존 `partners:write` 호출은 호환 adapter에서 action capability로 변환한다.

### 테스트 방법

- partner payload와 point range 단위 테스트
- 상태별 로그인·API matrix
- assignment state machine 테스트
- submitted draft immutable 테스트
- category scope mismatch 거부 테스트
- partner status와 linked Auth account 동기화 테스트

### 완료 조건

- pending/paused/terminated 제휴사는 로그인·API·새 배정이 불가하다.
- partner는 자기 partnerId의 활성 배정만 조회한다.
- 초안 승인 전 공개 `answers`에 데이터가 기록되지 않는다.
- mutation이 모두 감사 로그를 남긴다.

### 위험 요소

- 제휴사 정지 시 여러 Auth 계정 업데이트가 일부 실패할 수 있다.
- 기존 배정 데이터의 category가 partner fields와 맞지 않을 수 있다.

### 롤백 방법

- 상태 변경은 partner 문서와 linked account 변경 내역을 audit metadata에 기록한다.
- reconciliation script로 linked account를 이전 상태로 복원한다.
- 기존 배정은 삭제하지 않고 정책 검증만 비활성화할 수 있게 feature flag를 둔다.

## Phase 5. 제휴사 관리 UI

### 목적

제휴사 프로필, 상태, 업무 범위, 계정, 배정, 답변 초안을 하나의 운영 흐름으로 관리한다.

### 수정 대상 파일

- `components/AdminDashboard.tsx`
- `lib/cms/defaults.ts`
- `lib/cms/route-presentation.ts`
- `app/globals.css`
- `lib/cms/testing/admin-rbac-partner.test.ts`

### 신규 파일

- `components/admin/PartnerManagementPanel.tsx`
- `components/admin/PartnerEditorDialog.tsx`
- `components/admin/PartnerMemberPanel.tsx`
- `components/admin/PartnerAssignmentPanel.tsx`
- `components/admin/PartnerDraftReviewDialog.tsx`

### 구현 내용

- 제휴사 탭을 독립 컴포넌트로 분리한다.
- 프로필 수정과 상태 변경을 별도 action으로 제공한다.
- linked partner account 목록, 초대, 활성·정지, reset action을 제공한다.
- `fields`와 문의 category가 맞는 배정 후보만 기본 표시한다.
- 배정 회수 UI를 추가한다.
- 답변 초안 전체 본문, point cost, revision history를 검수한다.
- `partners:*`, `inquiries:*` capability에 따라 UI를 제어한다.
- 모든 사용자 노출 문구를 CMS에 등록한다.

### 기존 기능 영향

- 현재 제휴사 목록·편집·배정·초안 승인 기능을 유지한다.
- 기존 `AdminDashboard` state를 새 패널로 이동한다.

### 테스트 방법

- 제휴사 역할별 UI action matrix
- 생성·수정·상태 변경·계정 초대 dialog 테스트
- 배정·회수·수정 요청·승인 E2E
- empty/error/denied/loading 상태 테스트
- 접근성 및 모바일 레이아웃 검사

### 완료 조건

- `partner_manager`가 필요한 업무를 수행할 수 있다.
- 권한 없는 관리자는 데이터나 action을 볼 수 없고 직접 API도 403이다.
- API-only로 남아 있던 제휴사 계정 관리가 UI에서 가능하다.

### 위험 요소

- 하나의 탭에 기능이 과밀해질 수 있다.
- 계정 상태와 제휴사 상태를 사용자가 혼동할 수 있다.

### 롤백 방법

- 프로필, 회원, 배정 패널을 독립 feature flag로 분리한다.
- 기존 단순 제휴사 목록 패널을 fallback으로 유지한다.

## Phase 6. 운영자와 제휴사 연결

### 목적

내부 `partner_manager`와 외부 `partner` 계정의 책임을 분리하고
제휴사 상태·소속·배정 관계를 하나의 인가 흐름으로 연결한다.

### 수정 대상 파일

- `lib/firebase/server.ts`
- `lib/admin/authorization-policy.ts`
- `lib/partner/partner-service.ts`
- `app/api/admin/session/route.ts`
- `app/api/partner/session/route.ts`
- `components/LoginForm.tsx`
- `components/PartnerDashboard.tsx`

### 신규 파일

- `lib/partner/partner-authorization.ts`
- `app/api/admin/partners/[partnerId]/reconcile/route.ts`

### 구현 내용

- `partner_manager`는 내부 관리자이며 partner claim을 갖지 않게 한다.
- 외부 partner 계정은 admin claim과 adminRole을 갖지 않게 한다.
- `requirePartner`가 user accountStatus, partnerId, partner status를 확인한다.
- partner가 조회하는 request, draft, attachment는 active assignment를 요구한다.
- 로그인 후 admin/partner/member 목적지를 coarse claim과 서버 session 결과로 결정한다.
- partner 상태 또는 linked account 불일치를 점검하는 reconciliation action을 제공한다.

### 기존 기능 영향

- 현재 admin과 partner 로그인은 같은 Firebase Auth를 계속 사용한다.
- 별도 인증 체계나 별도 비밀번호 저장소를 만들지 않는다.

### 테스트 방법

- admin token으로 partner API 접근 거부
- partner token으로 admin API 접근 거부
- 같은 partnerId와 다른 partnerId 데이터 경계 테스트
- paused/terminated partner 접근 차단 테스트
- stale claim이 있어도 Firestore 상태로 거부되는지 테스트

### 완료 조건

- 계정 종류가 혼합되지 않는다.
- partner 상태와 assignment 관계가 모든 partner API에서 일관되게 적용된다.
- 로그인 라우팅이 claim만이 아니라 서버 session 결과를 확인한다.

### 위험 요소

- 기존 로그인 redirect가 바뀌어 무한 redirect가 발생할 수 있다.
- claim 갱신 전 UI와 서버 상태가 잠시 다를 수 있다.

### 롤백 방법

- 기존 `/admin`, `/partner` client gate를 fallback으로 유지한다.
- session API 오류 시 권한을 허용하지 않고 로그인 화면으로 돌린다.

## Phase 7. Firestore Rules와 Indexes

### 목적

클라이언트 직접 접근을 최소화하고 실제 partner query에 필요한 인덱스를 명시한다.

### 수정 대상 파일

- `firestore.rules`
- `storage.rules`
- `firebase.json`
- `scripts/cms/rules.test.mjs`

### 신규 파일

- `firestore.indexes.json`
- `scripts/admin-rbac-rules.test.mjs`
- `scripts/partner-rules.test.mjs`

### 구현 내용

- 관리자·제휴사 privileged mutation은 모두 server-only로 유지한다.
- direct admin read가 필요하지 않은 컬렉션은 Rules에서 deny한다.
- Rules에 역할 preset 계산을 복제하지 않는다.
- user profile의 role/accountStatus와 partner status를 최소 gate로 확인한다.
- 모든 partner의 `consult-attachments/**` 직접 읽기를 제거한다.
- assignment-scoped signed URL API를 통해 첨부파일을 제공한다.
- 아래 composite index를 추가한다.
  - `partnerAssignments(partnerId, status)`
  - `partnerAssignments(requestId, status)`
- 실제 query가 요구하면 order field를 포함한 index를 emulator 오류 메시지 기준으로 보완한다.

### 기존 기능 영향

- 클라이언트 SDK로 직접 읽던 경로가 있으면 서버 API로 이동해야 한다.
- Storage attachment URL 소비 방식이 signed URL로 바뀔 수 있다.

### 테스트 방법

- Firestore/Storage emulator에서 guest/member/admin/partner matrix 실행
- 다른 partner attachment 접근 거부
- paused partner 접근 거부
- 필요한 query가 index 오류 없이 실행되는지 확인

### 완료 조건

- Rules와 서버 API가 서로 모순되지 않는다.
- partner가 다른 partner의 문의·초안·첨부파일을 읽지 못한다.
- production query에 필요한 index manifest가 저장소에 있다.

### 위험 요소

- Rules 강화로 기존 CMS 또는 첨부파일 읽기가 차단될 수 있다.
- index 배포 전 API가 실패할 수 있다.

### 롤백 방법

- index는 추가만 하며 기존 index를 삭제하지 않는다.
- Rules 변경은 emulator matrix 통과 후 별도 배포한다.
- signed URL 전환 전 기존 읽기 경로를 feature flag로 유지한다.

## Phase 8. 테스트와 마이그레이션

### 목적

기존 운영자·제휴사 데이터를 안전하게 새 상태·권한 모델로 전환하고
권한 상승·잠금 회귀를 방지한다.

### 수정 대상 파일

- `scripts/migrate-admin-rbac.mjs`
- `scripts/check-admin-ready.mjs`
- `package.json`
- `docs/ADMIN_AUTH_MIGRATION.md`
- 기존 CMS·감사평가 auth 정적 테스트

### 신규 파일

- `scripts/migrate-admin-account-status.mjs`
- `scripts/check-admin-rbac-ready.mjs`
- `scripts/reconcile-auth-profiles.mjs`
- `lib/admin/testing/api-authorization-matrix.test.ts`
- `lib/partner/testing/partner-workflow.test.ts`
- `docs/ADMIN_RBAC_MIGRATION_RUNBOOK.md`

### 구현 내용

- 모든 migration은 dry-run 기본으로 만든다.
- 대상 Firebase project ID와 명시적 확인 문구를 요구한다.
- 승인된 UID만 `super_admin`으로 지정한다.
- 나머지 관리자 역할은 inventory 결과를 검토해 지정한다.
- status -> accountStatus를 매핑한다.
- coarse override를 action capability로 변환한다.
- linked partner account와 partner status를 검증한다.
- migration 전후 건수·UID·상태만 출력하고 비밀번호·token·PII 원문은 출력하지 않는다.
- rollback snapshot은 권한 관련 필드만 안전한 파일 또는 별도 관리자 컬렉션에 저장한다.

### 기존 기능 영향

- migration 적용 전에는 호환 fallback이 기존 데이터를 읽는다.
- 프로덕션 데이터 쓰기는 별도 승인된 운영 단계에서만 수행한다.

### 테스트 방법

- fixture 데이터로 dry-run/apply/idempotency 테스트
- 관리자 0명, 최고관리자 1명·2명, legacy role 누락 사례 테스트
- auth/profile mismatch 탐지 테스트
- 전체 API 401/403/200 matrix
- 기존 CMS·감사견적·감사평가 regression 실행

### 완료 조건

- dry-run이 변경 예정 건수를 정확히 보고한다.
- 같은 migration을 반복해도 결과가 바뀌지 않는다.
- 마지막 최고관리자 보호가 migration에도 적용된다.
- rollback 절차가 rehearsal 환경에서 검증된다.

### 위험 요소

- 현재 `adminRole` 누락 계정을 모두 최고관리자로 보는 fallback이 권한을 과다 부여할 수 있다.
- 잘못된 UID 매핑으로 관리자 접근이 잠길 수 있다.

### 롤백 방법

- 적용 전 권한 필드 snapshot을 저장한다.
- Auth disabled/claims와 Firestore 프로필을 함께 복원하는 reconciliation을 실행한다.
- 문제가 있으면 application compatibility fallback을 한 릴리스 유지한다.

## Phase 9. 최종 검증

### 목적

브라우저, API, Firestore, Storage, Auth, 감사 로그까지 전체 업무 흐름을 검증한다.

### 수정 대상 파일

- `README.md`
- `docs/CMS_ROUTE_INVENTORY.md`
- `docs/CMS_DATA_MODEL.md`
- `docs/admin-console-rbac-progress.md`
- CI workflow 파일

### 신규 파일

- `docs/ADMIN_OPERATOR_PARTNER_RUNBOOK.md`
- `scripts/smoke-admin-rbac.mjs`
- `scripts/smoke-partner-workflow.mjs`

### 구현 내용

- 운영자 역할별 smoke scenario를 실행한다.
- 제휴사 생성 -> 계정 초대 -> 활성화 -> 문의 배정 -> 초안 제출 ->
  수정 요청/승인 -> 회원 답변 흐름을 검증한다.
- 계정·제휴사 정지 후 즉시 API와 데이터가 차단되는지 검증한다.
- 감사 로그의 actor, capability, target, result를 확인한다.
- 문서의 legacy prototype 설명을 현재 구현으로 갱신한다.

### 기존 기능 영향

- 기능 변경 없이 검증과 문서 정합성만 완료한다.
- production 배포는 이 Phase 완료 후 별도 승인 사항이다.

### 테스트 방법

```text
npm run typecheck
npm run lint
npm test
npm run cms:audit
npm run test:cms:rules
npm run test:audit-evaluation:rules
npm run build
```

추가로 Firebase Emulator에서 auth/rules/workflow smoke를 실행한다.

### 완료 조건

- 모든 정적·단위·통합·Rules·build 검증이 통과한다.
- 권한 없는 직접 API 호출이 모두 거부된다.
- 마지막 최고관리자, partner status, assignment ACL 시나리오가 통과한다.
- 운영·마이그레이션·롤백 문서가 준비된다.

### 위험 요소

- emulator와 production Firebase 동작 차이가 있을 수 있다.
- 환경변수·feature flag 차이로 감사평가 테스트가 달라질 수 있다.

### 롤백 방법

- 배포는 기능 flag와 단계적 rollout으로 진행한다.
- 실패한 Phase의 변경만 되돌리고 컬렉션명과 기존 문서는 유지한다.
- production rollback은 코드 rollback과 Auth/profile reconciliation을 함께 수행한다.

## STEP 3 시작 전 승인 항목

- 역할·capability matrix 승인
- `accountStatus` 도입 승인
- action capability 이름 승인
- 기존 `adminRole` 누락 계정의 UID별 역할 매핑 승인
- partner account 상태 동기화 정책 승인
- Firestore Rules direct read 축소 승인
- migration rehearsal 프로젝트와 rollback 담당자 지정

이 승인 전에는 STEP 3 구현이나 프로덕션 데이터 변경을 시작하지 않는다.
