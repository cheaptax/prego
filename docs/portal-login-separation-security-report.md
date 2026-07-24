# 포털 로그인 경로 분리 보안 검토 보고서

작성 단계: STEP 7  
작성일: 2026-07-22  
검토 범위: 고객·제휴사·내부 운영자 로그인, page guard, API 인가,
logout/session, 기존 관리자 호환, Footer/SEO  
운영 Firebase·운영 계정 변경: 수행하지 않음  
결론: **코드 경계 조건부 통과, 운영 전 확인사항 남음**

> 요청된 `docs/portal-login-separation-analysis.md`는 검토 시점의 저장소에
> 존재하지 않았다. 설계 문서, 진행상황 문서, 실제 코드와 테스트를 기준으로
> 검토했다.

## 1. 인증 구조

- 세 로그인 URL은 하나의 Firebase Authentication 프로젝트와 공통
  `LoginForm`을 사용한다.
  - 고객: `/login`
  - 제휴사: `/partner/login`
  - 내부 운영자: `/admin/login`
- Client는 Firebase 이메일·비밀번호 인증 후 ID token을
  `/api/auth/portal-session`에 Bearer token으로 전달한다.
- 서버는 token 서명·만료, profile, account type, 계정 상태와 제휴사 상태를
  확인한 뒤 HttpOnly `nh_portal_session` cookie를 발급한다.
- page guard용 session cookie와 mutation/read API용 Bearer token을 분리한다.
  session cookie를 관리자·제휴사 API 인증으로 자동 수용하지 않는다.
- session cookie는 HttpOnly, SameSite=Lax, Path=/이며 production에서는
  Secure를 사용한다. session 발급·logout 응답은 `Cache-Control: no-store`다.
- logout은 server cookie 만료와 Firebase Client `signOut()`을 모두 시도한다.

## 2. 계정 유형 판정

- account type은 이메일·도메인 문자열이 아니라 Firestore `users.role`에서
  서버가 파생한다.
  - `member` → `CUSTOMER`
  - `partner` → `PARTNER_OPERATOR`
  - `admin` → `INTERNAL_OPERATOR`
- token uid/email과 profile uid/email이 일치해야 한다.
- admin/partner claim 동시 보유, profile role과 claim 불일치, 같은 uid의
  복수 profile은 우선순위를 두지 않고 fail-closed 처리한다.
- partner account는 profile의 `partnerId`, token의 optional `partnerId`,
  `partners/{partnerId}` 문서를 대조한다.
- profile 없음은 session을 발급하지 않고 상세 원인을 공개하지 않는
  `account_unavailable`로 처리한다.

검증 근거:

- `lib/auth/account-context.ts`
- `lib/auth/portal-server.ts`
- `lib/admin/testing/portal-authentication.test.ts`
- profile 없음, 중복 profile, claim 충돌, paused/terminated partner 테스트

## 3. 포털별 Route Guard

- `proxy.ts`는 보호 route에서 session cookie 존재만 확인하는 조기 UX
  경계다.
  - `/mypage/**` → customer
  - `/partner/**` → partner
  - `/admin/**` → admin
  - `/partner/login`, `/partner/apply`, `/admin/login`은 공개 예외
- 최종 보안 판정은 각 Server Component의
  `requirePortalPageSession()`이 수행한다.
- 최종 판정은 `verifySessionCookie(cookie, true)`와 Firestore profile/partner
  재조회 후 STEP 3의 `getPortalMismatchResult()`를 사용한다.
- cookie 이름만 위조하거나 proxy와 서버 판정이 달라도 보호 콘텐츠는
  렌더되지 않는다.
- unauthenticated redirect는 query와 `returnTo`를 제거한 고정 내부 경로만
  사용한다.

실제 브라우저 검증:

- `/mypage` → `/login`
- `/partner` → `/partner/login`
- `/admin` → `/admin/login`
- 홈 → `/admin` → `/admin/login` 후 뒤로가기 → 홈
- dev server console error 없음

인증된 뒤로가기·logout 후 BFCache 검증은 실제 test account/session이 없어
실행하지 못했다. 대신 보호 page의 dynamic server guard, logout no-store와
cookie 삭제 계약을 정적·단위 테스트로 확인했다.

## 4. API 권한 분리

### 고객 API

- 실제 customer API namespace는 `/api/me/**`다.
- `requireActiveMember()`가 member role, active status, uid/email,
  admin/partner claim 부재를 확인한다.
- 승인 상태 확인 전용 `/api/me/status`만 `requireMember()`를 사용하며
  account type과 uid/email 정합성은 동일하게 확인한다.
- profile 없는 synthetic member fallback은 제거됐다.
- quote/request/report resource는 authenticated uid와 조직/소유 관계를
  다시 확인한다.

### 제휴사 API

- 모든 `/api/partner/**` route는 `requirePartner()`를 사용한다.
- active partner account와 active partner 문서만 허용한다.
- 요청 body/query의 `partnerId`를 권한 원본으로 사용하지 않고 profile의
  `partnerId`로 query와 resource 관계를 제한한다.
- assignment의 `partnerId`가 다르면 403이다.
- 내부 운영자의 partner API 사용은 허용하지 않는 정책이다.

### 관리자 API

- 모든 `/api/admin/**` route는 active admin과 기존 RBAC helper를 사용한다.
- route별 `requirePermission()`, `requireAdminCapability()`,
  `getAdminSession()` 또는 감사평가 전용 admin wrapper가 적용된다.
- 고객·제휴사 claim은 관리자 helper에서 403 처리한다.
- 개별 resource는 기존 scope/role hierarchy를 추가 적용한다.

실제 HTTP 무인증 검증:

- `/api/admin/session` → 401
- `/api/partner/session` → 401
- `/api/me/overview` → 401

고객 token의 admin/partner API, partner token의 admin API와 cross-partner
resource는 pure resolver·source contract 테스트로 검증했다. Auth Emulator나
비운영 test account가 없어 live signed-token matrix는 실행하지 않았다.

## 5. 잘못된 포털 로그인 처리

- 인증 실패와 portal mismatch를 구분한다.
- active 계정이 다른 로그인 화면을 사용하면 403 `portal_mismatch`와
  서버가 결정한 canonical 내부 경로만 반환한다.
- 응답에 account role, permission, partnerId와 profile 상세를 포함하지 않는다.
- `/portal-access-denied`는 generic 안내, canonical 포털 버튼과 logout만
  제공한다.
- `portal` query는 enum으로 제한하며 임의 redirect URL을 받지 않는다.
- 기존 `/login`은 `legacyCrossPortal=true`로 관리자·제휴사를 canonical
  포털에 보내 기존 관리자 로그인 호환을 유지한다.

검증 결과:

- customer → partner/admin mismatch
- partner → admin mismatch
- internal operator → partner mismatch
- canonical redirect path
- login page 자체 redirect loop 없음
- open redirect 입력 경로 없음

## 6. 비활성 계정 처리

- customer는 `status=active`만 customer 포털/API를 사용한다.
- 승인 대기 customer는 `/pending-approval`로 이동한다.
- internal operator와 partner operator는 `accountStatus=active`만 허용한다.
- partner account가 active여도 partner 문서가 pending/paused/terminated면
  차단한다.
- 기존 session도 매 보호 요청에서 `checkRevoked=true`와 profile/partner
  상태 재조회로 다시 판정한다.
- 비활성·중단 계정에는 상세 상태나 내부 역할을 노출하지 않는다.

검증 결과:

- suspended/disabled operator 차단
- paused/terminated partner 차단
- inactive account API 403 계약
- profile 없는 Auth account generic 차단

## 7. 공격 시나리오 테스트

- account type 교차 portal 접근
- customer/partner의 admin API 접근
- internal operator의 partner API 접근
- 다른 `partnerId` assignment 접근
- 무인증 보호 page/API 접근
- profile 없음과 claim/profile 충돌
- revoked/inactive session 재접근 계약
- portal query를 이용한 open redirect
- 로그인 중복 submit
- Firebase raw 오류 노출
- password reset endpoint와 generic UI 처리
- logout cookie 삭제와 no-store
- Footer 링크를 이용한 관리자 권한 우회 여부

STEP 7 집중 테스트는 37/37 통과했다. Playwright 브라우저 회귀에서는 세
로그인 page의 desktop/mobile 렌더링, 제목·설명, 입력 label,
autocomplete, noindex/nofollow, password reset, 실패 메시지, 입력 유지,
중복 submit 1회, unauthenticated redirect, back navigation과 Footer keyboard
focus를 확인했다.

## 8. 기존 관리자 로그인 호환

- `/login`에서 internal operator와 partner account를 판정하는
  `legacyCrossPortal` 호환이 유지된다.
- legacy `/api/auth/admin-login`은 410 tombstone으로 유지되며 custom token
  로그인을 재활성화하지 않는다.
- `scripts/seed-admin.mjs`는 project ID 일치, dry-run 우선,
  `--confirm-production`, password shell-only 입력과 기존 UID/password/role
  보존을 구현한다.
- STEP 7에서는 seed script를 실행해 운영 Auth/Firestore를 변경하지 않았다.
  `node --check`와 기존 seed safety 테스트만 수행했다.
- 보안 검토에서 medium/high/critical exploit은 발견되지 않았다.

남은 중요 운영 위험:

- `adminRole`이 없는 legacy admin profile은 호환을 위해
  `super_admin`으로 해석된다.
- 이 fallback은 공격자가 생성하는 경로가 아니지만 migration이 끝나지 않은
  운영 데이터에서는 과도 권한이 될 수 있다.

## 9. Footer 링크와 SEO

- 공개 Footer 최하단에 다음 내부 링크를 제공한다.
  - 제휴사 로그인 → `/partner/login`
  - 운영자 로그인 → `/admin/login`
- protected customer/partner portal에서는 중복 링크를 표시하지 않는다.
- link는 `next/link`, 같은 창 이동, CMS 기본값/fallback을 사용한다.
- `/partner/login`, `/admin/login`은 noindex/nofollow다.
- sitemap 파일이 없으므로 로그인 page가 sitemap에 포함되지 않는다.
- robots.txt 전체 차단과 Footer `rel=nofollow`는 추가하지 않았다.
- Footer 링크 색상 대비는 `#B0B8C1` 대 `#191F28` 기준 8.26:1이다.
- mobile 390px에서 44px touch target과 keyboard 2px focus outline을
  확인했다.

## 10. 남은 위험

### 프로덕션 반영 차단 요소

- 운영 admin profile의 명시적 `adminRole` migration/readiness 확인 미완료
- Java 21 부재로 Firestore/Storage rules emulator 실행 실패
- 비운영 customer/partner/admin test account와 Auth Emulator 부재
- 실제 signed token을 사용한 3×3 portal login matrix 미실행
- inactive/revoked session의 live browser BFCache/logout 재검증 미실행

### 기존 unrelated 오류

- `test:admin-rbac`의
  `lib/admin/testing/migration-seed-index.test.ts`가 live query에 필요한
  `quoteAssignments` index 2개를 반영하지 못해 91건 중 1건 실패한다.
- portal 인증 구현 오류가 아니라 기존 index expectation의 불일치이며
  이번 단계에서는 unrelated 기능 테스트를 수정하지 않았다.
- Node ESM typeless warning과 rules test skip 메시지는 기존 test harness
  경고다.

### 이번 단계에서 수정한 오류

- `lib/admin/testing/portal-login-separation.test.ts`가 STEP 5 이전의 inline
  `role` 검사 문자열을 기대하고 있었다.
- 현재 공통 `requireMember()`/`requireActiveMember()` 계약을 검증하도록
  테스트만 수정했다.
- production browser 재검증에서 Next.js route-announcer의 빈
  `role=alert`를 login error로 오인하던 test selector를 발견했다.
- browser regression selector를 실제
  `.login-form__error[role=alert]`로 좁히고 재실행해 통과했다.
- 기능 코드는 변경하지 않았다.

## 11. 프로덕션 반영 전 확인사항

1. Java 21을 설치하고 `test:audit-evaluation:rules`,
   `test:cms:rules`를 emulator에서 통과시킨다.
2. staging Firebase에 active customer, active partner operator,
   active internal operator, inactive operator, paused partner와
   profile 없는 Auth account를 준비한다.
3. 3개 로그인 URL × 3개 active account matrix를 실제 password login으로
   확인한다.
4. inactive 전환과 token revoke 후 기존 session이 즉시 차단되는지 확인한다.
5. logout 후 browser back/BFCache에서 보호 데이터가 보이지 않는지 확인한다.
6. partner account로 다른 `partnerId` resource/API를 실제 호출해 403을
   확인한다.
7. `npm run check:admin-ready -- --expected-project <staging-project>`로
   기존 최고관리자 claim, 명시적 adminRole과 active status를 확인한다.
8. 모든 운영 admin profile의 `adminRole` migration을 완료한 뒤 legacy
   fallback 제거 시점을 결정한다.
9. stale composite-index 테스트 expectation을 현재 live query index와
   별도 작업에서 정렬한다.
10. staging에서 lint, typecheck, 전체 unit/integration/UI, rules emulator와
    production build를 다시 실행한다.

운영 배포, 운영 Firebase 변경, 운영 계정 변경과 migration은 이 단계에서
수행하지 않았다.
