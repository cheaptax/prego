# 관리자 RBAC 및 제휴사 관리 설계

작성 단계: STEP 2  
기준일: 2026-07-22  
상태: 설계 확정, 구현 전

> `docs/admin-operator-partner-gap-analysis.md`와
> `docs/admin-console-rbac-progress.md`는 STEP 2 조사 시작 시 저장소에 존재하지 않았다.
> 따라서 이 문서는 실제 코드인 `lib/admin/rbac.ts`,
> `lib/firebase/schema.ts`, `lib/firebase/server.ts`,
> `app/api/admin/**`, `app/api/partner/**`, Firebase Rules를 기준으로 작성한다.

## 1. 설계 목표

- Firebase Authentication, `users` 컬렉션, 기존 관리자·제휴사 컬렉션을 유지한다.
- 인증 체계를 추가하지 않고 Firebase ID token과 Firestore 프로필을 함께 사용한다.
- 메뉴 숨김은 사용자 경험 개선에만 사용하고 서버 API가 최종 권한을 판정한다.
- 역할, 세부 권한, 데이터 접근 범위, 소속, 계정 상태를 서로 다른 값으로 관리한다.
- 운영자·제휴사에 필요한 범위만 설계하고 지역, CRM, 계약·정산 모델은 도입하지 않는다.
- 최고관리자를 이메일 문자열로 판정하지 않는다.
- 마지막 활성 최고관리자의 강등, 정지, 비활성화, 삭제를 막는다.
- 비밀번호는 Firebase Auth에서만 관리하고 Firestore와 감사 로그에 저장하지 않는다.
- 기존 coarse capability는 호환 기간에만 유지하고 민감 작업부터 action capability로 전환한다.

## 2. 기존 구조와 목표 구조의 차이

### 현재 구조

- `users.role`은 `member | admin | partner`이다.
- 관리자는 `adminRole`과 `adminCapabilityAllow/Deny`를 사용한다.
- 관리자 역할은 `super_admin`, `operations_manager`, `partner_manager`,
  `cms_editor`, `read_only`이다.
- API는 대부분 `requireAdminCapability()`로 보호된다.
- 현재 capability는 대부분 `read/write` 단위이며
  `operators:write`, `partners:write`가 여러 민감 작업을 함께 허용한다.
- 관리자·제휴사 계정 상태가 회원 승인 상태인
  `active | pending_cooperative_review | rejected`를 공유한다.
- 관리자 데이터 범위는 사실상 전역이다.
- 제휴사 사용자는 `partnerId`와 배정 문서로 데이터 범위가 제한된다.
- Custom Claims는 `admin`, `partner`, 일부 `partnerId`를 사용한다.
- `adminRole`이 없는 기존 관리자는 현재 `super_admin`으로 해석된다.

### 목표 구조

- `users.role`은 계정 종류만 나타내며 기존 값을 유지한다.
- `adminRole`은 내부 관리자 역할만 나타낸다.
- `accountStatus`를 관리자·제휴사 로그인 계정 상태로 분리한다.
- 운영자와 제휴사의 민감 작업은 action capability로 세분한다.
- 접근 범위는 별도 권한 판정 단계에서 계산한다.
- 제휴사 소속은 기존 `partnerId`를 유지한다.
- 역할별 기본 권한에 개별 allow/deny override를 적용하되 deny가 우선한다.
- 서버 API는 인증, 계정 상태, 역할, capability, 범위, 리소스 관계를 순서대로 검사한다.
- Firestore Rules는 서버 인가를 대신하지 않으며 직접 클라이언트 접근을 최소화한다.
- `adminRole` 누락 시 무기한 최고관리자로 처리하지 않고 명시적 마이그레이션 후 fail-closed한다.

## 3. 역할 목록

기존 역할명을 우선해 다음 5개 관리자 역할을 확정한다.

| 역할 | 목적 |
|---|---|
| `super_admin` | 모든 관리자 기능, 역할·권한, 마지막 최고관리자 보호 대상 |
| `operations_manager` | 회원, 문의, 포인트, FAQ, 감사견적·감사평가 운영 |
| `partner_manager` | 제휴사 프로필·계정·업무 범위, 문의 배정, 제휴사 답변 검수 |
| `cms_editor` | CMS 콘텐츠, 자산, 게시·복원, FAQ 관리 |
| `read_only` | 허용된 운영 데이터 조회와 감사 로그 조회 |

다음 후보는 채택하지 않는다.

- `ADMIN`, `MANAGER`, `OPERATOR`, `VIEWER`: 기존 역할과 의미가 겹치므로 새 이름을 추가하지 않는다.
- `PARTNER_ADMIN`, `PARTNER_OPERATOR`: 현재 제휴사 포털에는 제휴사 자체 회원 관리나
  역할별 기능 차이가 없다. 제휴사 계정은 `users.role = "partner"`로 유지한다.
  실제 self-service 회원 관리 요구가 생길 때 별도 설계한다.

`member`, `admin`, `partner`는 관리자 RBAC 역할이 아니라 계정 종류다.

## 4. 권한 목록

권한 표기는 기존 코드의 `resource:action` 형식을 유지한다.

### 공통·회원·운영

- `admin:access`
- `members:read`
- `members:write`
- `inquiries:read`
- `inquiries:write`
- `points:read`
- `points:adjust`
- `faqs:read`
- `faqs:write`
- `audit:read`

`members:write`, `inquiries:write`, `faqs:write`는 현재 API가 이미 하나의
업무 흐름으로 묶여 있어 이번 설계에서 더 나누지 않는다.

### 운영자

- `operators:read`
- `operators:create`
- `operators:update`
- `operators:disable`
- `operators:delete`
- `operators:manageRoles`
- `operators:resetPassword`

현재 `operators:write`는 위 6개 쓰기 권한의 legacy alias로만 유지한 뒤 제거한다.

### 제휴사

- `partners:read`
- `partners:create`
- `partners:update`
- `partners:changeStatus`
- `partners:manageMembers`
- `partners:manageScope`

현재 `partners:write`는 위 5개 쓰기 권한의 legacy alias로만 유지한 뒤 제거한다.
제휴사 삭제 API가 없고 감사·배정 이력 보존이 필요하므로 `partners:delete`는 채택하지 않는다.
종료 처리는 `partners:changeStatus`로 수행한다.

### 감사견적

- `auditQuotes:read`
- `auditQuotes:write`

현재 구현은 공개 접수 생성, 관리자 조회·상태 수정·알림 재시도만 존재한다.
별도 `create`, `approve`, `assign`, `delete` 권한은 추가하지 않는다.

### 감사평가·보고서

- `auditEvaluations:read`
- `auditEvaluations:write`

현재 구현의 correction, reprocess, access reissue, report regenerate, retention execute,
config 변경은 모두 `write`로 통일한다. 보고서 전용 역할이 없으므로
`reports.*`를 중복 추가하지 않는다.

### CMS

- `cms:read`
- `cms:write`

현재 CMS 저장, 게시, 복원, 자산 처리는 같은 콘텐츠 운영 책임에 속하므로
이번 단계에서 `publish`, `restore`, `manageAssets`로 더 나누지 않는다.

### 호환 종료 대상

- `admin:read`: 실제 API 판정에 사용되지 않아 제거 대상이다.
- `operators:write`: action capability 전환 후 제거한다.
- `partners:write`: action capability 전환 후 제거한다.
- `points:write`: `points:adjust`로 대체한다.

## 5. 역할별 권한 매트릭스

`R`은 조회, `W`는 변경, `M`은 역할·계정·범위 관리다.

| 기능 | `super_admin` | `operations_manager` | `partner_manager` | `cms_editor` | `read_only` |
|---|---:|---:|---:|---:|---:|
| 관리자 진입 | W | W | W | W | R |
| 회원 | R/W | R/W | - | - | R |
| 운영자 조회 | R | R | - | - | R |
| 운영자 생성·수정·정지·삭제 | M | - | - | - | - |
| 운영자 역할·권한 | M | - | - | - | - |
| 운영자 비밀번호 재설정 | M | - | - | - | - |
| 제휴사 조회 | R | R | R | - | R |
| 제휴사 생성·수정·상태 | M | - | M | - | - |
| 제휴사 계정·업무 범위 | M | - | M | - | - |
| 문의·답변 | R/W | R/W | R/W | - | R |
| 포인트 | R/W | R/W | - | - | R |
| FAQ | R/W | R/W | - | R/W | R |
| 감사 로그 | R | R | R | R | R |
| 감사견적 | R/W | R/W | - | - | R |
| 감사평가·보고서 | R/W | R/W | - | - | R |
| CMS | R/W | - | - | R/W | R |

세부 매핑 원칙:

- `super_admin`만 `operators:create/update/disable/delete/manageRoles/resetPassword`를 갖는다.
- `partner_manager`는 제휴사 계정과 scope를 관리하지만 내부 관리자 역할은 관리하지 못한다.
- `read_only`는 모든 쓰기 권한이 없으며 allow override로도 쓰기 권한을 받을 수 없게
  UI에서 경고한다. 서버는 명시적 allow가 있으면 허용할 수 있으므로 감사 로그를 남긴다.
- `super_admin`도 capability 엔진을 통과한다. 별도 이메일·UID bypass를 만들지 않는다.

## 6. 데이터 접근 범위

실제 데이터 구조에 존재하는 범위만 채택한다.

| 범위 | 적용 대상 | 판정 기준 |
|---|---|---|
| `ALL` | 내부 관리자 | capability가 허용한 리소스의 전체 데이터 |
| `ORGANIZATION` | 일반 회원 | `cooperativeId` 또는 `nh_org_id`가 같은 데이터 |
| `PARTNER` | 제휴사 계정 | `users.partnerId`와 리소스 `partnerId` 일치 |
| `ASSIGNED` | 제휴사 계정 | 활성 `partnerAssignments`에 연결된 문의·초안 |
| `OWN` | 일반 회원과 자기 프로필 | `uid`, 작성자, 소유자 일치 |

`REGION`은 지역 기반 데이터 소유권이나 운영자 소속 필드가 없으므로 채택하지 않는다.

내부 관리자 역할은 현재 모두 `ALL`이다. 사용하지 않는 범위를 미리 저장하지 않는다.
권한 엔진은 다음과 같이 범위를 계산한다.

- `role=admin`, `accountStatus=active`: capability별 `ALL`
- `role=partner`: `PARTNER + ASSIGNED`
- `role=member`: `OWN`, 공개 범위, 필요한 경우 `ORGANIZATION`

향후 내부 관리자를 특정 제휴사나 농협으로 제한하는 실제 요구가 생기기 전에는
`adminDataScope`, `regionIds` 같은 필드를 추가하지 않는다.

## 7. 운영자 상태 전이

관리자·제휴사 로그인 계정에 공통 `accountStatus`를 도입한다.
회원 승인 상태인 기존 `status`는 회원 업무를 위해 유지한다.

| 상태 | 로그인 | API | 데이터 조회 | Firebase Auth `disabled` |
|---|---|---|---|---|
| `invited` | 불가 | 불가 | 불가 | `true` |
| `active` | 가능 | 역할·권한·범위에 따라 가능 | 역할·권한·범위에 따라 가능 | `false` |
| `suspended` | 불가 | 불가 | 불가 | `true` |
| `disabled` | 불가 | 불가 | 불가 | `true` |

상태 전이:

```text
invited -> active
active -> suspended -> active
invited -> disabled
active -> disabled
suspended -> disabled
```

- `invited`: Auth 사용자는 만들되 로그인·관리자 claim은 활성화하지 않는다.
- `suspended`: 일시 정지이며 복구 가능하다.
- `disabled`: 퇴사·계약 종료 등 운영상 비활성 상태다. 삭제 대신 우선 사용한다.
- 실제 삭제는 감사·업무 이력 검증 후 최고관리자만 수행한다.
- 상태 변경은 Firestore 프로필, Custom Claims, Auth disabled를 함께 동기화한다.
- stale token이 있어도 서버와 Rules가 Firestore `accountStatus=active`를 재검사한다.

기존 값 매핑:

- 관리자 `status=active` -> `accountStatus=active`
- 관리자 `status=rejected` -> `accountStatus=disabled`
- 관리자 `status=pending_cooperative_review` -> `accountStatus=invited`
- 마이그레이션 기간에는 기존 `status`를 fallback으로 읽고 쓰기는 `accountStatus`를 기준으로 한다.

## 8. 운영자 Firestore 문서 스키마

컬렉션은 기존 `users/{uid}`를 유지한다.

```ts
type AdminUserDocument = {
  uid: string;
  role: "admin";
  adminRole:
    | "super_admin"
    | "operations_manager"
    | "partner_manager"
    | "cms_editor"
    | "read_only";
  adminCapabilityAllow: AdminCapability[];
  adminCapabilityDeny: AdminCapability[];
  accountStatus: "invited" | "active" | "suspended" | "disabled";

  name: string;
  email: string;
  phone: string;
  position: string;
  duty: string;

  createdAt: string;
  updatedAt: string;
  invitedAt?: string;
  activatedAt?: string;
  suspendedAt?: string;
  suspendedBy?: string;
  disabledAt?: string;
  disabledBy?: string;
};
```

- `email`은 프로필·표시 정보이며 최고관리자 판정에 사용하지 않는다.
- 비밀번호, 임시 비밀번호, reset link, ID token, refresh token은 저장하지 않는다.
- 역할 기본 권한은 코드에 두며 Firestore에 권한 전체를 복제하지 않는다.
- override 배열만 저장한다.
- `position`, `duty`는 표시용이고 인가에 사용하지 않는다.

## 9. 제휴사 Firestore 문서 스키마

컬렉션은 기존 `partners/{partnerId}`를 유지한다.

```ts
type PartnerDocument = {
  id: string;
  name: string;
  displayName: string;
  partnerType: string;
  fields: string[];
  managerName: string;
  contactEmail: string;
  contactPhone: string;
  status: "pending" | "active" | "paused" | "terminated";
  pointMin: number;
  pointMax: number;
  memo?: string;

  createdAt: string;
  createdBy: string;
  createdByEmail?: string;
  updatedAt: string;
  updatedBy: string;
  updatedByEmail?: string;
  statusChangedAt?: string;
  statusChangedBy?: string;
};
```

채택하지 않는 필드:

- `legalName`, `businessNumber`, `representativeName`, `address`:
  현재 가입, 배정, 답변, 포인트 흐름에서 사용하지 않는다.
- `contractStartDate`, `contractEndDate`:
  계약 만료 자동 제어 기능이 없으므로 추가하지 않는다.
- `serviceScope`: 기존 `fields`를 유지한다.
- `notes`: 기존 `memo`를 유지한다.

제휴사 상태:

| 상태 | 새 배정 | 소속 계정 로그인/API | 기존 데이터 |
|---|---|---|---|
| `pending` | 불가 | 불가 | 보존 |
| `active` | 가능 | 활성 계정에 한해 가능 | 배정 범위 조회 |
| `paused` | 불가 | 불가 | 보존, 관리자만 조회 |
| `terminated` | 불가 | 불가 | 삭제하지 않고 감사 목적으로 보존 |

기존 `paused`는 후보의 `SUSPENDED` 의미로 유지해 불필요한 값 마이그레이션을 피한다.

## 10. 운영자와 제휴사 관계

- 내부 운영자: `users.role = "admin"`, `adminRole = "partner_manager"`일 수 있다.
- 제휴사 로그인 계정: `users.role = "partner"`, `partnerId`로 제휴사에 소속된다.
- 한 제휴사에 여러 `users.role = "partner"` 계정을 연결할 수 있다.
- 내부 `partner_manager`와 외부 `partner`는 다른 계정 종류이며 혼합하지 않는다.
- 외부 제휴사 계정에 `adminRole`이나 관리자 capability를 부여하지 않는다.
- 제휴사 계정의 접근 범위는 `partnerId`와 `partnerAssignments`에서 계산한다.
- 제휴사 상태가 `active`가 아니면 연결된 모든 계정은 접근할 수 없다.

## 11. 권한 판정 순서

단일 권한 엔진은 다음 순서를 사용한다.

1. Authorization Bearer token 존재 여부를 확인한다.
2. Firebase Admin SDK로 ID token 서명과 만료를 검증한다.
3. 목적에 따라 coarse claim `admin=true` 또는 `partner=true`를 확인한다.
4. `users/{uid}` 프로필 존재 여부와 `role`을 확인한다.
5. `accountStatus=active`를 확인한다.
6. 제휴사 계정이면 `partners/{partnerId}.status=active`를 확인한다.
7. 관리자면 `adminRole`의 기본 capability를 계산한다.
8. allow override를 더하고 deny override를 마지막에 적용한다.
9. 요청 API에 필요한 capability가 있는지 확인한다.
10. 데이터 접근 범위 `ALL/PARTNER/ASSIGNED/ORGANIZATION/OWN`을 계산한다.
11. 대상 리소스의 소유, 소속, 배정 관계를 확인한다.
12. 쓰기 요청이면 상태 전이, optimistic lock, 마지막 최고관리자 같은 불변식을 확인한다.
13. 허용된 mutation과 거부된 민감 작업을 감사 로그에 남긴다.

deny override가 allow보다 우선한다. `admin:access`도 명시적 deny가 가능해야 하며,
현재처럼 항상 다시 추가하지 않는다.

## 12. API 인증·인가 방식

- 모든 관리자·제휴사 API는 Firebase ID token Bearer 인증을 사용한다.
- 관리자 API는 `requireAdminCapability(request, capability)`를 사용한다.
- 제휴사 API는 `requirePartner(request)` 후 리소스 배정 관계를 검사한다.
- 목록 API도 capability와 scope에 맞는 쿼리만 실행한다.
- UI가 숨긴 메뉴·버튼과 무관하게 API가 동일 검사를 수행한다.
- 읽기와 쓰기 capability를 구분한다.
- 감사평가 correction/reprocess/regenerate/reissue/retention mutation은
  `auditEvaluations:write`를 요구한다.
- CMS page GET은 `cms:read`, mutation은 `cms:write`로 통일한다.
- 운영자 mutation API는 action capability를 각각 요구한다.
- 제휴사 프로필 수정, 상태 변경, 계정 관리는 서로 다른 capability를 요구한다.

프런트엔드와 서버는 `lib/admin/rbac.ts`의 역할·capability 상수를 공유한다.
서버 전용 리소스 판정은 별도 server-only 모듈에서 같은 타입을 사용한다.

## 13. Firebase Custom Claims 사용 여부와 이유

Custom Claims를 유지한다.

사용 값:

- `admin: true`
- `partner: true`

원칙:

- claim은 관리자·제휴사 계정의 빠른 coarse gate와 Firebase Rules에만 사용한다.
- `adminRole`, capability, override, accountStatus는 claim에 넣지 않는다.
- `partnerId` claim은 현재 호환을 위해 유지할 수 있으나 서버 인가의 원본으로 사용하지 않는다.
- 최종 권한 원본은 Firestore 프로필, 제휴사 문서, 배정 문서다.
- claim 변경 시 기존 custom claims를 읽고 merge하여 다른 claim을 지우지 않는다.
- 계정 정지·비활성화 시 claim을 false로 바꾸고 Auth disabled를 true로 설정한다.

이유:

- ID token만으로 coarse route를 빠르게 거부할 수 있다.
- 역할·세부 권한을 claim에 넣으면 토큰 갱신 전까지 변경이 지연되므로 적합하지 않다.
- Firestore 프로필을 매 API에서 재검사하면 stale claim이 있어도 즉시 차단할 수 있다.

## 14. Firestore Rules 적용 방식

- Admin SDK를 통한 서버 API 쓰기는 Rules를 우회하므로 API 인가가 필수다.
- 일반 클라이언트의 관리자·제휴사 직접 쓰기는 계속 거부한다.
- 관리자 민감 데이터 직접 읽기도 가능한 한 서버 API로 통일한다.
- Rules에 역할 프리셋 계산을 복제하지 않는다.
- `users` 자기 프로필, 공개 CMS 게시본처럼 직접 읽기가 필요한 최소 경로만 허용한다.
- 제휴사 문의·첨부파일은 서버 API가 `partnerId + active assignment`를 확인한 뒤
  제한된 데이터 또는 단기 signed URL을 반환한다.
- 현재 모든 제휴사가 모든 `consult-attachments/**`를 읽을 수 있는 Storage Rule은 제거 대상이다.
- Rules가 관리자·제휴사 상태를 확인할 때 `accountStatus=active`와
  제휴사 문서 `status=active`를 함께 확인한다.

## 15. 감사 로그 구조

기존 `auditLogs` 컬렉션을 유지하고 선택 필드를 확장한다.

```ts
type AuditLogDocument = {
  id: string;
  actorUid: string;
  actorEmail?: string;
  actorRole?: string;
  requiredCapability?: string;
  action: string;
  targetType: string;
  targetId: string;
  scope?: "ALL" | "ORGANIZATION" | "PARTNER" | "ASSIGNED" | "OWN";
  metadata?: Record<string, string | number | boolean | null>;
  correlationId?: string;
  result?: "success" | "denied" | "failed";
  createdAt: string;
};
```

필수 기록:

- 운영자 생성, 역할·override 변경, 상태 변경, 비밀번호 재설정, 삭제
- 제휴사 생성·수정·상태 변경, 계정 생성·상태 변경, scope 변경
- 문의 배정·회수, 제휴사 답변 제출·수정 요청·승인
- 마지막 최고관리자 변경 거부
- 권한 부족으로 거부된 민감 mutation

비밀번호, reset link, 토큰, 첨부파일 원문, 민감 PII 전체는 기록하지 않는다.

## 16. 권한 상승 방지

- `operators:manageRoles`가 없는 사용자는 `adminRole`과 override를 수정할 수 없다.
- 자기 역할, 자기 override, 자기 상태는 직접 변경할 수 없다.
- `super_admin` 부여는 활성 `super_admin`만 수행할 수 있다.
- 요청 payload의 capability는 allowlist로 정규화한다.
- UI에서 보낸 resolved capability 전체를 신뢰하지 않고 서버가 다시 계산한다.
- `users.role` 변경은 일반 운영자 수정 API와 분리한다.
- `partner` 계정에 관리자 claim이나 adminRole을 함께 부여하지 않는다.
- Custom Claims 갱신은 기존 claim merge 방식으로 수행한다.
- 상태·역할 변경은 Firestore와 Auth 중 하나만 성공한 불일치 상태를 탐지할 수 있게
  감사 로그와 reconciliation 도구를 제공한다.

## 17. 마지막 `super_admin` 보호

- 이메일 하드코딩을 사용하지 않는다.
- `users`에서 `role=admin`, `adminRole=super_admin`,
  `accountStatus=active`인 계정 수를 계산한다.
- 아래 작업으로 활성 최고관리자가 0명이 되면 서버가 거부한다.
  - 강등
  - `suspended` 또는 `disabled` 전환
  - 관리자 role 제거
  - 계정 삭제
- 자기 권한 회수·정지·삭제도 거부한다.
- 체크와 변경을 가능한 한 Firestore transaction으로 수행한다.
- Firebase Auth 변경이 필요한 경우 Firestore invariant 예약 후 Auth 변경,
  최종 commit 또는 보상 처리 순서와 reconciliation을 사용한다.
- 긴급 복구는 수동 seed 도구와 명시적 프로젝트·UID·확인 문구로만 수행한다.

## 18. 기존 데이터 마이그레이션 방안

1. 읽기 전용 inventory를 실행해 관리자·제휴사 계정과 claim 상태를 보고한다.
2. 운영자별 목표 `adminRole`을 검토한다.
3. 최고관리자는 이메일 코드 비교가 아니라 명시적으로 승인한 Firebase UID로 지정한다.
4. 관리자 `status`를 `accountStatus`로 매핑한다.
5. 기존 coarse capability override를 action capability로 변환한다.
   - `operators:write` -> 운영자 action capability 6개
   - `partners:write` -> 제휴사 action capability 5개
   - `points:write` -> `points:adjust`
6. `adminRole` 누락 계정을 자동으로 전부 최고관리자로 만들지 않는다.
   승인된 UID만 `super_admin`, 나머지는 검토 결과에 따라
   `operations_manager` 또는 `read_only`로 설정한다.
7. 제휴사 로그인 계정에 `accountStatus`를 추가한다.
8. `partners.status=paused`는 유지하고 종료된 제휴사만 `terminated`로 명시한다.
9. linked partner account와 Custom Claims/Auth disabled 상태를 검증한다.
10. dry-run 결과와 변경 건수를 승인한 뒤 별도 STEP 3에서만 적용한다.

이번 STEP 2에서는 스크립트를 실행하거나 프로덕션 데이터를 수정하지 않는다.
