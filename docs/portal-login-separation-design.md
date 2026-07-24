# 고객·제휴사·내부 운영자 로그인 경로 분리 설계

작성 단계: STEP 2  
작성일: 2026-07-22  
상태: 설계 확정, 구현 전  
운영 배포·Firebase 변경: 수행하지 않음

> `docs/portal-login-separation-analysis.md`는 STEP 2 시작 시 저장소에 없었다.
> 이 설계는 `docs/portal-login-separation-progress.md`,
> `docs/portal-login-separation-completion-report.md`와 실제 인증 코드인
> `components/LoginForm.tsx`, `lib/firebase/client.ts`,
> `lib/firebase/admin.ts`, `lib/firebase/server.ts`,
> `lib/admin/rbac.ts`, `lib/firebase/schema.ts`를 근거로 한다.

## 1. 설계 목표

- 고객, 외부 제휴사, 내부 운영자에게 서로 다른 공개 로그인 URL을 제공한다.
- Firebase 프로젝트와 Firebase Authentication tenant는 현재 하나를 유지한다.
- 세 로그인 화면이 Firebase 로그인 코드를 복제하지 않고 공통
  `LoginForm`과 공통 서버 판정기를 사용한다.
- Firebase 인증 성공 후 서버가 ID token, Firestore profile, 계정 상태,
  account type, partner 상태를 판정한다.
- 로그인 URL과 메뉴 노출은 UX 경계이며, 페이지 guard와 API 인가가 실제
  보안 경계를 담당한다.
- 고객, 제휴사, 내부 운영자의 account type과 내부 역할을 분리한다.
- 비활성 운영자, 비활성 제휴사 계정, 중단·종료된 제휴사를 즉시 차단한다.
- 이메일, 도메인, 특정 UID 문자열을 역할 판정 코드에 하드코딩하지 않는다.
- 기존 `/login`에서 최고관리자가 비밀번호 로그인하는 경로를 유지한다.
- 현재 `users.role`, `adminRole`, permission, `partnerId` 모델을 우선
  재사용하고 불필요한 데이터 migration을 만들지 않는다.

## 2. 최종 URL 구조

확정 URL:

- 고객 로그인: `/login`
- 고객 포털: `/mypage`
- 제휴사 로그인: `/partner/login`
- 제휴사 포털: `/partner`
- 내부 운영자 로그인: `/admin/login`
- 관리자 콘솔: `/admin`

고객 포털은 이미 `/mypage`, `/mypage/quotes`,
`/mypage/requests/[requestId]` 구조가 있으므로 `/my`로 변경하지 않는다.
`/my` alias도 현재 요구가 없으므로 추가하지 않는다.

공개 예외:

- `/partner/login`: 공개 로그인
- `/partner/apply`: 기존 공개 제휴 신청
- `/admin/login`: 공개 로그인
- `/login`, `/signup`, `/pending-approval`: 기존 고객 인증 흐름

보호 경로:

- CUSTOMER: `/mypage`, `/mypage/**`
- PARTNER_OPERATOR: `/partner`, `/partner/**`
  - 단 `/partner/login`, `/partner/apply` 제외
- INTERNAL_OPERATOR: `/admin`, `/admin/**`
  - 단 `/admin/login` 제외

모든 로그인 페이지는 `robots: { index: false, follow: false }`로 고정한다.

## 3. 계정 유형과 역할 구조

### 3.1 파생 account type

새 account type은 별도 Firestore 필드를 즉시 추가하지 않고 기존
`users/{uid}.role`에서 서버가 파생한다.

- `role = "member"` → `CUSTOMER`
- `role = "admin"` → `INTERNAL_OPERATOR`
- `role = "partner"` → `PARTNER_OPERATOR`

공통 코드 타입:

```ts
type PortalAccountType =
  | "CUSTOMER"
  | "INTERNAL_OPERATOR"
  | "PARTNER_OPERATOR";

type PortalKind = "customer" | "partner" | "admin";
```

`PortalAccountType`은 로그인·guard 응답과 감사 로그에서 사용하는 정규화된
개념이다. Firestore의 `role` 값을 중복 저장하는 `accountType` 필드는 만들지
않는다.

### 3.2 내부 운영자 역할

`lib/firebase/schema.ts`의 기존 `AdminRole`을 그대로 사용한다.

- `super_admin`
- `operations_manager`
- `partner_manager`
- `cms_editor`
- `read_only`

요청 예시의 `SUPER_ADMIN`, `ADMIN`, `MANAGER`, `OPERATOR`를 별도 타입으로
추가하지 않는다. 기존 역할 preset과 permission 체계가 더 구체적이므로
중복 역할은 권한 불일치와 migration 부담만 만든다.

`adminRole`이 누락된 관리자를 `super_admin`으로 해석하는
`lib/admin/rbac.ts`의 현재 호환 fallback은 신규 portal resolver에서 신뢰하지
않는다. 기능 활성화 전에 승인된 기존 최고관리자 UID에 명시적
`adminRole=super_admin`과 `accountStatus=active`를 준비해야 한다.

### 3.3 제휴사 역할

현재 외부 제휴사 계정은 `users.role="partner"`, `partnerId`, assignment로
동일한 범위의 포털 기능을 사용한다. 제휴사 자체 계정 관리나 제휴사 내부
승인 기능이 없으므로 STEP 3에서 `PARTNER_ADMIN`, `PARTNER_OPERATOR` 역할을
새로 저장하지 않는다.

현재 설계:

- account type: `PARTNER_OPERATOR`
- 역할: 별도 partner role 없음
- 권한 범위: `partnerId + active assignment + resource relationship`

향후 제휴사가 자체 구성원을 관리하는 요구가 확정될 때만
`partnerRole: "partner_admin" | "partner_operator"`를 별도 설계·migration한다.
account type과 role에 같은 `PARTNER_OPERATOR` 이름을 중복 사용하지 않는다.

### 3.4 판정 원본과 claims

- account type 원본: Firestore `users/{uid}.role`
- 관리자 역할 원본: `users/{uid}.adminRole`
- 관리자 permission 원본: 역할 preset + allow/deny
- 제휴사 소속 원본: `users/{uid}.partnerId`
- 관리자·제휴사 상태 원본: `users/{uid}.accountStatus`
- 고객 승인 상태 원본: `users/{uid}.status`
- 제휴사 상태 원본: `partners/{partnerId}.status`
- Custom Claims `admin`, `partner`: 빠른 coarse gate와 profile 정합성 확인

Custom Claims만으로 account type이나 역할을 최종 판정하지 않는다.

## 4. 공통 인증 모듈

### 4.1 재사용할 기존 코드

- `lib/firebase/client.ts`
  - `getFirebaseApp()`
  - `getFirebaseAuth()`
- `lib/firebase/admin.ts`
  - `getFirebaseAdminApp()`
  - `adminAuth()`
  - `adminDb()`
- `components/LoginForm.tsx`
  - persistence 선택
  - `signInWithEmailAndPassword()`
  - Firebase 오류 문구 정규화
  - 비밀번호 재설정
- `lib/firebase/server.ts`
  - `verifyBearerToken()`
  - `getUserRecord()`
  - `requireActiveMember()`
  - `requireActiveAdmin()`/`requirePermission()`
  - `requirePartner()`

### 4.2 추가할 공통 모듈

`lib/auth/portal.ts`:

- `PortalKind`
- `PortalAccountType`
- portal/account type 일치 매트릭스
- canonical login path와 home path
- 안전한 mismatch code와 사용자 문구 key

`lib/auth/portal-server.ts` (`server-only`):

- `resolvePortalIdentity(decodedToken)`
- `assertPortalAccountState(identity)`
- `evaluatePortalAccess(requestedPortal, identity)`
- `requirePortalPageSession(expectedPortal)`
- profile/claim 충돌과 중복 profile 탐지
- partner 문서 상태 확인

`app/api/auth/portal-session/route.ts`:

- Authorization Bearer ID token 검증
- profile과 account type 서버 판정
- 계정 상태와 partner 상태 확인
- requested portal 일치 여부 판정
- Firebase session cookie 발급
- canonical `homePath`와 제한된 결과 반환

`app/api/auth/logout/route.ts`:

- HttpOnly session cookie 삭제
- 응답에 token, profile 전체, permission 전체를 포함하지 않음

### 4.3 공통 LoginForm 계약

`LoginForm`은 세 벌로 복제하지 않고 다음 입력만 받는다.

```ts
type LoginFormProps = {
  portal: "customer" | "partner" | "admin";
  content: CmsPageContent;
  legacyCrossPortal?: boolean;
  previewMode?: boolean;
};
```

공통 submit:

1. Firebase persistence 설정
2. `signInWithEmailAndPassword`
3. ID token 획득
4. `/api/auth/portal-session` 호출
5. 서버가 반환한 access 결과 처리
6. 허용이면 canonical home으로 `replace`
7. 불일치면 안전한 안내와 올바른 포털 링크 표시

Client가 token claim을 직접 읽어 최종 redirect를 결정하는 현재 로직은
서버 resolver 응답으로 교체한다.

### 4.4 session cookie와 API token 경계

페이지 direct access guard를 위해 Firebase session cookie를 추가한다.

- cookie: HttpOnly, Secure(production), SameSite=Lax, Path=/
- 자동 로그인 선택: 최대 14일 persistent cookie
- 자동 로그인 해제: browser session cookie, 서버 session 자체는 짧은 만료
- server verification: `verifySessionCookie(cookie, true)`
- session 확인 후에도 Firestore profile 상태를 다시 조회

기존 API는 Authorization Bearer ID token을 유지한다. session cookie를
관리자·제휴사 mutation API 인증으로 자동 수용하지 않아 CSRF 경계를
불필요하게 넓히지 않는다. 페이지 guard용 cookie와 API Bearer token의 목적을
구분한다.

## 5. 포털별 로그인 화면

### 고객 `/login`

- 기존 `app/login/page.tsx`, `LoginPageRenderer`, CMS `auth.login` 재사용
- 고객용 제목, 회원가입, 이메일 찾기, 비밀번호 재설정 유지
- canonical expected account type: `CUSTOMER`
- 기존 관리자 호환을 위해 `legacyCrossPortal=true`를 유지
- 호환 기간에는 admin/partner 로그인도 서버 판정 후 canonical 포털로 이동

### 제휴사 `/partner/login`

- 공통 page shell과 `LoginForm portal="partner"` 사용
- 회원가입 CTA 대신 `/partner/apply` 안내
- 고객용 이메일 찾기는 제휴사 계정 정책이 확정되기 전 노출하지 않음
- 비밀번호 재설정은 공통 Firebase 기능 재사용
- expected account type: `PARTNER_OPERATOR`

### 내부 운영자 `/admin/login`

- 공통 page shell과 `LoginForm portal="admin"` 사용
- 일반 회원가입, 고객 이메일 찾기, 공개 계정 신청 CTA를 노출하지 않음
- 비밀번호 재설정은 운영 정책에 따라 공통 Firebase reset 또는 관리자 문의
  안내를 사용하되 Firebase 오류 원문은 노출하지 않음
- expected account type: `INTERNAL_OPERATOR`

세 화면은 제목·설명·보조 링크만 다르고 이메일, 비밀번호, persistence,
submit, 오류 처리 코드는 공유한다.

## 6. 로그인 후 계정 판정 흐름

확정 순서:

1. Client Firebase 이메일/비밀번호 인증
2. Client가 ID token을 Authorization Bearer로 서버에 전달
3. 서버가 Firebase Admin SDK로 token 서명·만료 검증
4. 서버가 `users/{uid}` profile을 조회
5. profile `role`에서 account type 파생
6. profile email과 token email 정합성 확인
7. account type별 상태 확인
   - CUSTOMER: `status`
   - INTERNAL_OPERATOR/PARTNER_OPERATOR: `accountStatus`
8. claim/profile 정합성 확인
   - admin profile은 `admin:true`
   - partner profile은 `partner:true`
   - 상충 claims는 configuration error
9. PARTNER_OPERATOR면 `partnerId`와 partner 문서 active 확인
10. requested portal과 account type 일치 확인
11. INTERNAL_OPERATOR면 명시적 `adminRole`, permission 확인
12. session cookie 발급
13. canonical home path 반환
14. Client가 `router.replace(homePath)` 실행

고객 상태별 결과:

- `active`: `/mypage`
- `pending_cooperative_review`: `/pending-approval`
- `rejected`: generic account unavailable 안내

admin/partner의 `invited`, `suspended`, `disabled`는 session을 발급하지 않고
403 `account_unavailable`로 처리한다.

## 7. 포털 불일치 처리

인증 성공과 포털 권한 실패를 구분한다. 잘못된 포털에서 올바른 비밀번호로
로그인한 경우 "비밀번호가 틀렸다"는 메시지를 표시하지 않는다.

공통 응답 원칙:

- HTTP 403 + `code: "portal_mismatch"`
- 이미 인증된 본인에게만 `homePath` 또는 canonical login link 제공
- 응답에 role, permission, partnerId, profile 존재 여부 상세를 포함하지 않음
- 오류 문구: "이 로그인 화면에서 사용할 수 없는 계정입니다. 계정에 맞는
  서비스로 이동해 주세요."

시나리오별 정책:

- 고객이 `/admin/login`에서 로그인
  - session은 CUSTOMER로 발급
  - 403 mismatch 안내
  - "고객 서비스로 이동" → `/mypage`
- 고객이 `/partner/login`에서 로그인
  - session은 CUSTOMER로 발급
  - 403 mismatch, `/mypage` 링크
- 제휴사 운영자가 `/admin/login`에서 로그인
  - session은 PARTNER_OPERATOR로 발급
  - 403 mismatch, `/partner` 링크
- 내부 운영자가 `/partner/login`에서 로그인
  - session은 INTERNAL_OPERATOR로 발급
  - 403 mismatch, `/admin` 링크
- 운영자가 `/login`에서 로그인
  - 기존 최고관리자 호환 정책으로 자동 `/admin` 이동
  - 제휴사 계정도 호환 기간에는 자동 `/partner` 이동
  - 새 공개 링크와 운영 문서는 각각 전용 로그인 URL을 사용
- 고객·운영자 profile이 동시에 존재하는 비정상 계정
  - 현재 `users/{uid}` 단일 문서에서는 정상적으로 발생할 수 없음
  - 별도 legacy customer collection까지 조회해 두 account type이 검출되거나
    admin/partner claims가 동시에 true이면 precedence를 두지 않고 fail-closed
  - session 미발급, 403 `account_configuration_error`, 보안 audit 기록
  - 올바른 포털 링크 대신 고객지원 안내
- profile이 없는 Firebase Auth 계정
  - session 미발급
  - 403 generic `account_unavailable`
  - profile 존재 여부나 계정 종류를 공개하지 않음
  - client Firebase session을 sign-out하고 고객지원 안내

직접 URL 포털 불일치에서는 resolver가 확인한 canonical home으로 한 번만
redirect한다. query에 원래 URL 전체를 넣지 않고 허용된 내부 path allowlist만
사용해 open redirect와 redirect loop를 방지한다.

## 8. Route Guard 구조

STEP 3에서는 Next.js 16의 root `proxy.ts`를 사용한다. matcher는 보호 포털만
대상으로 하고 로그인·신청 화면을 명시적으로 제외한다.

guard 동작:

1. session cookie 없음
   - `/mypage/**` → `/login`
   - `/partner/**` → `/partner/login`
   - `/admin/**` → `/admin/login`
2. session cookie 검증 실패 또는 만료
   - cookie 삭제 응답과 함께 해당 로그인으로 redirect
3. 유효 session
   - Firestore profile과 상태 재검사
   - expected portal 불일치면 canonical home으로 redirect
4. inactive/suspended/terminated
   - generic access denied 또는 해당 로그인으로 이동
   - 보호 데이터는 렌더하지 않음

matcher 제외:

- `/login`
- `/partner/login`
- `/partner/apply`
- `/admin/login`
- static assets, Next internals, 공개 API

`proxy.ts`는 페이지 UX와 정적 shell 노출을 줄이기 위한 경계다. API는
반드시 기존 서버 인가를 별도로 수행한다. proxy에서 메뉴 권한이나 개별
resource permission까지 판정하지 않는다.

## 9. API 권한 검증 구조

### 고객 API

- `requireActiveMember(req)`
- `users.role === "member"`
- `users.status === "active"`
- token/profile email 일치
- own UID, organization, visibility 관계 확인

### 제휴사 API

- `requirePartner(req)`
- `partner:true` claim
- `users.role === "partner"`
- account active
- profile의 `partnerId`를 원본으로 사용
- `partners/{partnerId}.status === "active"`
- assignment와 resource partnerId 관계 확인
- 요청 body/query의 partnerId를 권한 원본으로 신뢰하지 않음

### 관리자 API

- `requireActiveAdmin(req)`
- `admin:true` claim
- `users.role === "admin"`
- account active
- 명시적 `adminRole`
- `requirePermission()`/`requireAnyPermission()`
- 대상 resource scope와 역할 계층 확인

페이지에서 버튼이나 메뉴를 숨기는 것은 UX일 뿐이며 API 401/403을 대체하지
않는다. 모든 mutation은 server-side permission과 상태를 다시 확인한다.

## 10. 로그아웃과 세션 만료

공통 logout 순서:

1. `POST /api/auth/logout`으로 HttpOnly session cookie 삭제
2. Firebase Client SDK `signOut(getFirebaseAuth())`
3. 현재 portal의 canonical login으로 `replace`
4. 두 단계 중 하나가 실패해도 다른 단계는 `finally`에서 시도

logout redirect:

- CUSTOMER → `/login`
- PARTNER_OPERATOR → `/partner/login`
- INTERNAL_OPERATOR → `/admin/login`

session 만료:

- page guard는 로그인 페이지로 이동하고 `reason=session_expired` 같은
  제한된 UI code만 전달
- API는 token 없음/만료에 401
- permission·상태 거부는 403
- refresh token이나 ID token을 URL, local log, audit metadata에 기록하지 않음

비밀번호 변경, 계정 정지, 역할 회수 시 Auth refresh token revoke와
Firestore 상태 변경을 함께 수행한다. page guard는
`verifySessionCookie(cookie, true)`와 profile 상태 재검사로 기존 session을
차단한다.

## 11. 비활성 계정 처리

INTERNAL_OPERATOR와 PARTNER_OPERATOR:

- `accountStatus=active`만 로그인·페이지·API 허용
- `invited`, `suspended`, `disabled`는 403
- Auth `disabled=true`, 관련 claim false, refresh token revoke를 동기화
- 동기화가 부분 실패해도 Firestore profile active 재검사로 fail-closed

CUSTOMER:

- `status=active`만 고객 포털과 mutation API 허용
- `pending_cooperative_review`는 `/pending-approval`
- `rejected`는 generic account unavailable

상태를 session cookie claim만으로 판단하지 않으며 매 보호 요청에서 canonical
profile을 확인한다.

## 12. 제휴사 상태 처리

제휴사 계정이 active여도 연결된 `partners/{partnerId}` 문서가 active가 아니면
접근을 차단한다.

- `pending`: 로그인/포털/API 불가
- `active`: 계정 active와 assignment 조건에 따라 허용
- `paused`: 로그인/포털/API 불가, 데이터 보존
- `terminated`: 로그인/포털/API 불가, 관계·감사 이력 보존

상태 변경 시 linked Auth 계정 disabled/claims 동기화를 시도한다. 최종
보안 원본은 매 요청의 partner 문서 상태 검사다.

## 13. Footer 링크 배치

현재 `components/Footer.tsx`의 가장 하단 `.foot__bar`에 별도 보조 nav를
추가한다. 고객 CTA나 상단 문의 열에는 넣지 않는다.

구조:

```tsx
<nav className="foot__portal-links" aria-label="제휴사 및 운영자 로그인">
  <Link href="/partner/login">제휴사 로그인</Link>
  <span aria-hidden="true">|</span>
  <Link href="/admin/login">운영자 로그인</Link>
</nav>
```

CMS 기본 링크:

- `footer.links.partnerLogin`
- `footer.links.operatorLogin`

수정 대상은 `lib/cms/defaults.ts`의 footer defaults,
`components/Footer.tsx`, 공통 영역 editor presentation/test다.
`cmsGlobalContentSchema`는 links record이므로 schema shape 추가는 필요하지
않지만 protected link key와 editor label을 등록해야 한다.

스타일:

- `.foot__bar`와 같은 muted color
- 12~12.5px, 12px 미만 금지
- 강조 배경·primary color·굵은 CTA 금지
- 링크별 최소 44px touch 영역을 padding/min-height로 확보
- keyboard focus-visible 표시
- 내부 링크이므로 `rel`은 불필요; 새 창을 열지 않음
- 모바일에서 wrap 또는 한 줄 유지, `display:none` 금지
- separator는 `aria-hidden`

## 14. 기존 경로 호환 및 redirect

- `/mypage`: 유지, `/my`로 변경하지 않음
- `/login`: 고객 canonical login으로 유지
- 기존 관리자·제휴사도 `/login`에서 계속 인증 가능
- `/login`의 cross-portal 호환은 server resolver가 담당하며 이메일
  하드코딩이나 client claim redirect를 사용하지 않음
- 신규 운영 문서와 Footer는 `/admin/login`, `/partner/login`을 사용
- `/admin` unauthenticated → `/admin/login`
- `/partner` unauthenticated → `/partner/login`
- `/mypage` unauthenticated → `/login`
- `returnTo`는 각 portal 내부 allowlist만 허용
- `app/api/auth/admin-login/route.ts`는 410 상태를 유지하고 재활성화하지 않음
- legacy custom-token code를 새 경로 구현에 복사하지 않음

기존 최고관리자 보호:

- 기능 활성화 전 `check-admin-ready`로 Auth user, admin claim, 명시적
  `adminRole`, active status를 확인
- 기존 `/login` 호환 유지
- 성공 확인 전 legacy 관련 환경변수나 운영 계정을 삭제·변경하지 않음

## 15. 단계별 구현 계획

### Phase 1 — 공통 타입과 서버 resolver

- `lib/auth/portal.ts`
- `lib/auth/portal-server.ts`
- account type/portal matrix 단위 테스트
- profile/claim/status anomaly fail-closed 테스트

### Phase 2 — 공통 session API와 LoginForm

- `app/api/auth/portal-session/route.ts`
- `app/api/auth/logout/route.ts`
- `components/LoginForm.tsx`에 `portal` 계약 추가
- 현재 client claim 기반 redirect를 서버 응답 기반으로 교체
- `/login` legacy cross-portal 호환 유지

### Phase 3 — 전용 로그인 화면

- `app/partner/login/page.tsx`
- `app/admin/login/page.tsx`
- 공통 login page renderer 또는 shell 추출
- 세 화면 noindex와 접근성 확인

### Phase 4 — page guard

- root `proxy.ts`
- 보호 matcher와 공개 예외
- session 만료, wrong portal, open redirect 방지 테스트

### Phase 5 — portal logout 정렬

- `MyPageDashboard`
- `PartnerDashboard`
- `AdminDashboard`
- `CmsAdminConsole`
- cookie와 Client Auth 동시 logout

### Phase 6 — Footer

- `lib/cms/defaults.ts`
- `components/Footer.tsx`
- CMS common-area presentation/test
- `app/globals.css` desktop/mobile/focus/touch target

### Phase 7 — 회귀·staging 검증

- unit/API/UI tests
- production build
- Java 21 Rules emulator
- staging Firebase 3계정 유형과 inactive/paused 계정
- 기존 최고관리자 `/login` 회귀

STEP 3에서는 Phase 1부터 구현하되 production 배포와 운영 데이터 변경은 별도
승인 전 수행하지 않는다.

## 16. 테스트 시나리오

### 정상 로그인

- active CUSTOMER: `/login` → `/mypage`
- pending CUSTOMER: `/login` → `/pending-approval`
- active PARTNER_OPERATOR: `/partner/login` → `/partner`
- active INTERNAL_OPERATOR: `/admin/login` → `/admin`
- 기존 super admin: `/login` → `/admin`

### 포털 불일치

- CUSTOMER at `/admin/login` → 403 + `/mypage` 안내
- CUSTOMER at `/partner/login` → 403 + `/mypage` 안내
- PARTNER_OPERATOR at `/admin/login` → 403 + `/partner` 안내
- INTERNAL_OPERATOR at `/partner/login` → 403 + `/admin` 안내
- INTERNAL_OPERATOR at `/login` → compatibility redirect `/admin`
- PARTNER_OPERATOR at `/login` → compatibility redirect `/partner`

### 계정·상태 이상

- profile 없음 → generic 403, session 미발급
- admin/partner claims 동시 true → configuration error
- profile role과 claim 불일치 → configuration error
- adminRole 누락 → fail-closed
- suspended/disabled admin → 403
- disabled partner account → 403
- active account + paused/terminated partner → 403
- 기존 session으로 비활성 전환 후 재접근 → 차단

### 직접 URL과 API

- unauthenticated `/mypage` → `/login`
- unauthenticated `/partner` → `/partner/login`
- unauthenticated `/admin` → `/admin/login`
- CUSTOMER token on admin/partner API → 403
- PARTNER token on admin API → 403
- ADMIN token on partner/customer mutation API → 403
- body의 다른 `partnerId` → 범위 변경 불가
- 권한 없는 관리자 role → 403
- 잘못된 `returnTo` 외부 URL → canonical home

### session/logout

- local persistence와 session persistence
- session cookie 만료
- revoked refresh token/session
- 각 포털 logout 후 API 401
- logout API 실패 시 client signOut
- client signOut 실패 시 cookie 삭제

### UI·SEO·Footer

- 세 로그인 page noindex
- Firebase 오류 원문 미노출
- desktop/mobile Footer 링크 href와 label
- 390px에서 touch target과 가로 넘침
- keyboard focus-visible과 accessible nav label
- CMS publish/rollback 후 두 Footer 링크 유지
- redirect loop와 console error 없음

## 17. 롤백 방법

데이터 schema를 추가하지 않는 설계이므로 애플리케이션 rollback을 우선한다.

1. 직전 검증 deployment로 되돌린다.
2. root `proxy.ts`의 portal matcher를 비활성화하거나 이전 release로 복원한다.
3. `/login`의 기존 client 로그인 흐름을 복원한다.
4. 신규 `/partner/login`, `/admin/login`과 session API를 제거하거나
   feature flag를 끈다.
5. Footer 신규 링크를 이전 CMS published global 또는 코드 default로 rollback한다.
6. 신규 session cookie를 만료시키는 logout response를 한동안 유지한다.
7. 기존 `/api/auth/admin-login` 410과 기존 최고관리자 Auth/profile은 변경하지 않는다.
8. rollback 후 `/login` 최고관리자, 고객 `/mypage`, 제휴사 `/partner`,
   관리자 API 401/403을 재확인한다.

운영 `adminRole`/accountStatus 정비가 별도 승인으로 수행된 경우에는 사전
inventory와 Firestore backup을 기준으로 롤백하며, 비밀번호·token·private key를
문서나 로그에 저장하지 않는다.
