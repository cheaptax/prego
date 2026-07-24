# 포털 로그인 경로 분리 진행상황

최종 업데이트: 2026-07-22  
현재 단계: **STEP 7 — 전체 회귀·보안 검토 완료**  
구현 상태: **코드 회귀 조건부 통과, staging·emulator 운영 gate 남음**  
NEXT_STEP: **STEP 8 — 최종 완료 보고(별도 요청 전 미실행)**

## STEP 7 전체 회귀 결과

### 검증 환경과 범위

- Node.js: 24.13.1
- npm: 11.8.0
- Firebase CLI: 15.24.0
- Java: 8
- `.env.local`의 Firebase client/admin 필수 key 존재 여부만 확인했고 값은
  출력하지 않았다.
- 운영 Firebase 변경, 운영 계정 login/seed, migration과 production 배포는
  수행하지 않았다.
- 요청된 `docs/portal-login-separation-analysis.md`는 저장소에 없어 기존
  문서 결손으로 기록했다.

### 로그인 경로 브라우저 검증

Playwright로 `/login`, `/partner/login`, `/admin/login`을 desktop
1440×900과 mobile 390×844에서 실제 렌더링했다.

- 세 page HTTP 200
- 포털별 제목·설명
- email/password input과 label
- `autocomplete=email`, `autocomplete=current-password`
- password visibility button의 accessible name/pressed state 계약
- 비밀번호 재설정 UI와 Firebase reset 요청 mock 성공
- Firebase invalid credential mock에 generic 오류 표시
- Firebase raw code/message 미노출
- 실패 후 email/password 입력 유지
- 동시에 두 번 submit해도 sign-in 요청 1회
- noindex/nofollow metadata
- mobile 가로 overflow 없음
- browser console/page error 0

실제 active test account나 Auth Emulator가 없어 password 성공과 account type
3×3 matrix는 live Firebase로 실행하지 않았다. 성공 redirect, mismatch와
inactive/profile-missing 결과는 STEP 3 pure resolver와 session contract
테스트로 검증했다.

### 계정·Route Guard 회귀

- portal 집중 회귀: **37/37 통과**
- CUSTOMER
  - customer portal 허용
  - partner/admin mismatch와 `/mypage` 안내
- PARTNER_OPERATOR
  - partner portal 허용
  - customer legacy `/login`에서 `/partner` 안내
  - admin mismatch
- INTERNAL_OPERATOR
  - admin portal 허용
  - customer legacy `/login`에서 `/admin` 안내
  - partner mismatch
- inactive operator, paused/terminated partner 차단
- profile 없음, 복수 profile, claim/profile 충돌 fail-closed
- 비로그인 browser direct access
  - `/mypage` → `/login`
  - `/partner` → `/partner/login`
  - `/admin` → `/admin/login`
- 홈 → admin direct access → admin login → browser back 시 홈 복귀 확인
- login/apply 공개 예외와 redirect loop 없음

실제 authenticated logout 후 BFCache/back, token revoke 후 기존 session은 live
account 부재로 browser에서 실행하지 못했고 logout no-store/cookie 삭제와
server guard 재검증 계약으로 확인했다.

### API 접근 회귀

- 실제 무인증 HTTP:
  - `/api/admin/session` → 401
  - `/api/partner/session` → 401
  - `/api/me/overview` → 401
- route/API boundary test:
  - customer token의 admin/partner API → 403 계약
  - partner token의 admin API → 403 계약
  - internal operator token의 partner API → 403 계약
  - 다른 `partnerId` assignment/resource → 403 계약
  - inactive account → 403 계약
  - 모든 `/api/admin/**` auth/RBAC wrapper 적용
  - 모든 `/api/partner/**` `requirePartner()` 적용
  - customer data API `requireActiveMember()` 적용
- 실제 signed token을 사용한 role matrix는 staging test account 준비 후
  다시 확인해야 한다.

### 기존 기능 회귀 결과

- `test:partner`: **11/11 통과**
- `test:audit-quote`: **33/33 통과**
  - live Firestore rules assertion은 emulator env가 없어 skip
- `test:audit-evaluation`: **164 통과, 1 skip, 0 실패**
- `test:cms`: **104/104 통과**
- `test:integration`: **6/6 통과**
- `test:e2e`:
  - route 27개
  - scenario 81개
  - console error 0
  - failure 0
  - max DOMContentLoaded 1813ms
  - max layout shift 0.0532
- 기존 최고관리자 legacy `/login` redirect 계약 통과
- 관리자 dashboard/RBAC, 운영자 관리, 제휴사 관리, 견적 요청,
  고객 quote/report, logout, password reset 계약 통과
- `seed-admin.mjs`, `check-admin-ready.mjs`와 browser regression script
  `node --check` 통과
- 실제 seed-admin 실행은 운영 계정 변경을 피하기 위해 수행하지 않았다.
- `cms:audit`, `cms:audit:self-test` 통과
- `lint`, `typecheck` 통과
- production build: **통과**
  - 67개 static page 생성
  - `/login`, `/partner/login`, `/admin/login` static route 확인
  - `/mypage`, `/partner`, `/admin`, `/portal-access-denied` dynamic server
    route 확인
  - root Proxy 생성 확인

### Footer 회귀

- 메인 홈페이지 두 링크와 href
- public event/service page 표시
- protected customer/partner portal에서 중복 미표시
- mobile 390px, 44px touch target
- keyboard focus 2px outline
- gray-400/gray-900 contrast **8.26:1**
- partner/admin login noindex/nofollow
- sitemap 부재

### STEP 7에서 수정한 오류

- `lib/admin/testing/portal-login-separation.test.ts`
  - STEP 5 이전 `/api/me/status`·`/api/me/overview`의 inline role 검사 문자열을
    기대하고 있었다.
  - 현재 보안 경계인 `requireMember()`/`requireActiveMember()`와 공통
    server role check를 검증하도록 테스트 expectation만 수정했다.
- `scripts/portal-login-regression.mjs`
  - production 재검증에서 Next.js의 빈 route-announcer도 `role=alert`인 점을
    확인했다.
  - login failure assertion을 `.login-form__error[role=alert]`로 좁혀 실제
    로그인 오류가 표시될 때까지 기다리도록 수정했다.
  - 기능 코드는 변경하지 않았다.

### 기존 unrelated 오류

- `test:admin-rbac`: **91건 중 90 통과, 1 실패**
- 실패:
  `lib/admin/testing/migration-seed-index.test.ts`
  - 테스트는 `partnerAssignments` composite index 2개만 기대한다.
  - 실제 `firestore.indexes.json`에는 live quote query에 필요한
    `quoteAssignments` index 2개가 추가되어 총 4개다.
  - 이전 단계에서도 확인된 기존 index expectation 불일치이며 portal login
    코드 오류가 아니므로 STEP 7에서 수정하지 않았다.
- Node test의 `MODULE_TYPELESS_PACKAGE_JSON` warning은 기존 harness 경고다.

### 남은 차단 요소

- Firestore/Storage rules emulator:
  - `test:audit-evaluation:rules` 실행 실패
  - 원인: Firebase CLI 15.24.0은 Java 21 이상을 요구하지만 현재 Java 8
- staging customer/partner/admin/inactive/profile-missing test account 부재
- live 3×3 password login matrix와 signed-token API matrix 미실행
- revoked/inactive existing session과 logout 후 BFCache browser 검증 미실행
- 운영 admin profile의 명시적 `adminRole` migration/readiness 확인 미완료
- Security Review 결과 medium/high/critical code defect 없음
- 남은 주요 privilege risk는 legacy adminRole 누락 시 super_admin fallback

### 보안 보고서와 검토 결과

- 보고서:
  `docs/portal-login-separation-security-report.md`
- Security Review:
  - medium/high/critical actionable code defect 없음
  - page guard, Bearer API, partnerId scope와 fixed redirect 경계 강화 확인
  - 운영 전 adminRole migration을 우선 gate로 확인
- companion Canvas:
  `portal-login-security-report.canvas.tsx`

### STEP 7 변경 파일

신규:

- `scripts/portal-login-regression.mjs`
- `docs/portal-login-separation-security-report.md`
- Cursor Canvas `portal-login-security-report.canvas.tsx`

수정:

- `lib/admin/testing/portal-login-separation.test.ts`
- `docs/portal-login-separation-progress.md`

### STEP 8에서 작성할 최종 보고 내용

- 목표 대비 구현 완료 상태
- 세 login URL과 canonical portal
- page session guard와 API Bearer 경계
- account type/status/partner scope 판정
- 기존 최고관리자 호환과 adminRole migration gate
- Footer 링크와 SEO
- 전체 회귀 결과와 기존 unrelated 오류
- Java 21 emulator, staging account matrix, revoke/BFCache 확인 목록
- production 반영·rollback 체크리스트

STEP 7에서는 STEP 8 최종 완료 보고서를 작성하지 않았다.

## STEP 6 구현 결과

### 수정한 Footer와 링크 위치

- STEP 1에서 확인한 공통 `components/Footer.tsx`를 그대로 확장했다.
- 기존 운영 주체·정책·문의 열에는 로그인 링크를 섞지 않았다.
- Footer 최하단 `.foot__bar` 오른쪽의 별도
  `.foot__portal-links` 보조 navigation에 배치했다.
- 링크:
  - `제휴사 로그인` → `/partner/login`
  - `운영자 로그인` → `/admin/login`
- `next/link`를 사용하고 새 창, `target`, `rel=nofollow`를 추가하지 않았다.

### CMS 편집과 fallback

- 공통 CMS `footer` 문서에 안정적인 key를 추가했다.
  - `footer.links.partnerLogin`
  - `footer.links.operatorLogin`
  - `footer.text.portalLoginNavigationLabel`
- `/admin/globals/footer`에서 두 링크의 문구·주소와 navigation 접근성 이름을
  업무 용어로 편집할 수 있다.
- 이전에 게시된 footer 문서에 신규 key가 없어도
  `lib/cms/footer-portal-links.ts`의 검증된 기본값으로 즉시 표시된다.
- 초안, 게시, 실제 homepage preview와 rollback은 기존 공통 영역 editor
  lifecycle을 그대로 사용한다.

### 공개 페이지와 포털 내부 표시 정책

- 기본 `showPortalLinks=true`이므로 공통 Footer를 사용하는 다음 공개 영역에
  표시된다.
  - 메인 홈페이지
  - 상담·서비스·정책·고객지원 화면
  - 공개 감사견적 이벤트 화면
  - 고객 로그인·가입 흐름과 제휴 신청 화면
- 보호된 고객·제휴사 포털에서 Footer 자체는 유지하되 보조 로그인 링크는
  `showPortalLinks={false}`로 숨겼다.
  - `/mypage/quotes`
  - `/mypage/quotes/[quoteId]`
  - `/mypage/requests/[requestId]`
  - `/partner`
  - `/portal-access-denied`
- `/admin`, `/admin/operations`는 기존대로 Footer를 렌더하지 않는다.
- 따라서 관리자·제휴사 포털 내부에서 동일 로그인 링크가 중복되지 않는다.

### 데스크톱 표시

- 기존 `.foot__bar`의 copyright·tagline과 나란히 배치한다.
- 12.5px, medium weight, `gray-400` muted 색상을 사용한다.
- 배경·primary button·굵은 CTA 스타일은 사용하지 않는다.
- hover에서만 밝아지고 밑줄이 표시된다.

### 모바일 표시와 접근성

- 720px 이하에서는 `.foot__portal-links`가 별도 100% 폭 행으로 내려간다.
- 링크마다 `min-height: 44px`과 좌우 padding을 적용했다.
- 390×844 Playwright 실제 렌더에서 두 링크 모두 44px 높이와 정상 경로를
  확인했고 가로 넘침이나 숨김이 없었다.
- keyboard Tab으로 `/partner/login` 링크에 실제 도달했고
  `2px solid` focus outline을 확인했다.
- navigation에는 CMS 기반 accessible name을 제공하고 separator는
  `aria-hidden=true`로 제외했다.

### SEO 처리

- `/partner/login`, `/admin/login`의 기존
  `robots: { index: false, follow: false }`를 유지한다.
- 현재 저장소에는 sitemap route/file이 없으므로 로그인 경로가 sitemap에
  포함되지 않는다.
- 내부 링크이며 로그인 페이지 자체가 noindex/nofollow이므로 Footer 링크에
  별도 `nofollow`는 적용하지 않았다.
- robots.txt 전체 차단은 추가하지 않았다.

### STEP 6 테스트 결과

- Footer UI + CMS 집중 테스트: **16/16 통과**
  - 두 문구와 href
  - `next/link`, 새 창·nofollow 미사용
  - 공개 화면 표시와 보호 포털 숨김
  - muted 색상, 12.5px, 44px touch target
  - hover underline, focus-visible
  - 720px mobile 100% row
  - 로그인 page noindex/nofollow와 sitemap 부재
  - CMS 편집 label과 기존 common-area lifecycle
- Playwright desktop 1440×900 Footer 렌더: **통과**
- Playwright mobile 390×844 Footer 렌더: **통과**
- Playwright keyboard Tab/focus: **통과**
- CMS 전체 회귀 테스트: **104/104 통과**
- `npm run cms:audit`: **통과**
  - 사용자 route 29개 = 등록 27개 + 문서화된 예외 2개
- `npm run lint`: **통과**
- `npm run typecheck`: **통과**
- `npm run build`: **통과**
  - 공개 homepage와 전용 로그인 경로 static 생성 확인

### STEP 6 변경 파일

신규:

- `lib/cms/footer-portal-links.ts`
- `lib/cms/testing/footer-portal-links.test.ts`

수정:

- `components/Footer.tsx`
- `components/cms-editor/CmsCommonAreaSettings.tsx`
- `lib/cms/defaults.ts`
- `lib/cms/admin-console-presentation.ts`
- `lib/cms/admin-console-preview.ts`
- `lib/cms/testing/homepage-integration.test.ts`
- `app/globals.css`
- `app/partner/page.tsx`
- `app/mypage/quotes/page.tsx`
- `app/mypage/quotes/[quoteId]/page.tsx`
- `app/mypage/requests/[requestId]/page.tsx`
- `app/portal-access-denied/page.tsx`
- `docs/portal-login-separation-progress.md`

STEP 6에서는 운영 CMS 데이터를 seed/publish하지 않았고 STEP 7을 실행하지
않았다.

## STEP 5 구현 결과

### 보호한 경로

- CUSTOMER: `/mypage`, `/mypage/**`
- PARTNER_OPERATOR: `/partner`, `/partner/**`
  - 공개 예외: `/partner/login`, `/partner/apply`
- INTERNAL_OPERATOR: `/admin`, `/admin/**`
  - 공개 예외: `/admin/login`
- root `proxy.ts` matcher는 위 세 경로만 대상으로 한다.
  - session cookie가 없으면 각각 `/login`, `/partner/login`,
    `/admin/login`으로 query 없이 이동한다.
  - 정적 파일, Next.js 내부 경로와 API는 matcher 대상이 아니다.
  - 공개 로그인·제휴 신청 경로는 route 분류 함수에서 명시적으로 제외한다.

현재 존재하는 모든 보호 page Server Component가
`requirePortalPageSession()`을 호출한다. 따라서 cookie 이름만 위조하거나
proxy 판정과 서버 판정이 달라도 보호 콘텐츠를 렌더하기 전에 최종 차단된다.

### middleware와 서버 검증 구조

- `proxy.ts`
  - `nh_portal_session` 존재 여부만 확인하는 조기 UX 경계다.
  - Firebase token, Firestore profile, role, permission을 최종 판정하지 않는다.
- `resolveSessionAccountContext()`
  - `verifySessionCookie(cookie, true)`로 만료와 revoke를 확인한다.
  - STEP 3 profile resolver를 재사용해 users profile, token/profile email,
    claims, account type, account status를 다시 판정한다.
  - 제휴사 계정은 profile `partnerId`와 partner 문서 상태를 다시 확인한다.
- `requirePortalPageSession()`
  - session 없음·무효 → 요청 포털의 canonical 로그인
  - profile 없음·중복·claim/profile 불일치 → 공통 접근 제한 안내
  - active이지만 다른 포털 → 공통 접근 제한 안내
  - 비활성 운영자와 paused/terminated 제휴사 → 접근 제한
  - 승인 대기 고객 → `/pending-approval`
- 로그인과 신청 page는 server guard를 호출하지 않아 redirect loop를 만들지
  않는다. `returnTo`와 외부 redirect 입력은 사용하지 않는다.

### 포털별 API 권한

- 고객 데이터 API는 실제 저장소 구조인 `/api/me/**`에서
  `requireActiveMember()`를 사용한다.
  - `role=member`, active 상태, uid/email, admin/partner claim 부재를 확인한다.
  - `/api/me/overview`의 profile 없는 Auth 사용자 fallback을 제거했다.
  - `/api/me/status`는 승인 상태 조회 목적상 `requireMember()`를 사용하지만
    member account type과 uid/email 정합성은 동일하게 확인한다.
  - 공통 평가 접근 API도 `requireActiveMember()`로 정렬했다.
- `/api/partner/**`는 모든 route가 `requirePartner()`를 사용한다.
  - partner claim, partner role, active account, uid/email,
    token/profile partnerId 정합성, active partner 문서를 확인한다.
  - resource 조회·수정은 인증 profile의 `partnerId`를 원본으로 사용하고
    assignment의 `partnerId`와 다시 대조한다.
  - 내부 운영자의 partner API 사용은 허용하지 않는 정책으로 명시했다.
- `/api/admin/**`는 모든 route가 `requirePermission()`,
  `requireAdminCapability()`, `getAdminSession()` 또는 감사평가 전용 admin
  wrapper를 사용한다.
  - admin claim과 role, active 상태, uid/email, partner claim 부재를 확인한다.
  - 기존 permission/scope 판정은 유지한다.
- 고객·제휴사 token의 admin API 호출과 내부 운영자 token의 partner API
  호출은 모두 403이다. page session cookie를 mutation API 인증으로
  자동 수용하지 않고 기존 Bearer token 경계를 유지한다.

### 포털 불일치 화면

- `/portal-access-denied` 공통 화면과 CMS key
  `auth.portalAccessDenied`를 추가했다.
- 상세 role, permission, partnerId나 profile 존재 여부를 노출하지 않는다.
- 유효한 active session이면 현재 계정의 canonical 포털 버튼 하나만
  우선 제공하고, 그 외에는 요청 포털의 로그인 버튼을 제공한다.
- 모든 경우 로그아웃 버튼을 제공하며 server cookie와 Firebase Client Auth를
  함께 정리한 뒤 해당 canonical 로그인으로 이동한다.
- CMS 기본값, 관리자 표시 정보, 실제 page preview와 noindex/nofollow를
  등록했다.

### 메뉴와 로그아웃 확인

- 고객 `MyPageDashboard`, 제휴사 `PartnerDashboard`, 내부 운영자
  `CmsAdminConsole`/`AdminDashboard`는 서로 다른 메뉴 컴포넌트를 유지한다.
- 고객 화면에 관리자 메뉴, 제휴사 화면에 내부 운영자 메뉴를 합성하지 않는다.
- logout 목적지는 고객 `/login`, 제휴사 `/partner/login`, 운영자
  `/admin/login`으로 유지된다.

### 보안 테스트 결과

- portal account + route guard/API boundary 집중 테스트: **25/25 통과**
  - 고객의 admin/partner 직접 접근
  - 제휴사 운영자의 admin 직접 접근
  - 내부 운영자의 partner 직접 접근
  - 비로그인 보호 경로 canonical redirect
  - 비활성 운영자의 기존 session 차단
  - 다른 partnerId resource 차단 계약
  - 고객·제휴사 admin API 차단
  - 공개 로그인/apply 예외와 redirect loop 방지
  - proxy cookie 판정 뒤 server final guard 재검증
  - 모든 admin/partner/customer route의 인증 helper 적용
- CMS 전체 회귀 테스트: **98/98 통과**
- `npm run cms:audit`: **통과**
  - 사용자 route 29개 = 등록 27개 + 문서화된 예외 2개
- `npm run lint`: **통과**
- `npm run typecheck`: **통과**
- `npm run build`: **통과**
  - 보호 포털과 `/portal-access-denied` dynamic server route 생성 확인

### STEP 5 변경 파일

신규:

- `proxy.ts`
- `lib/auth/portal-routes.ts`
- `lib/auth/portal-page-guard.ts`
- `app/portal-access-denied/page.tsx`
- `components/PortalAccessDeniedActions.tsx`
- `lib/admin/testing/portal-route-guards.test.ts`

수정:

- `lib/auth/portal-server.ts`
- `lib/firebase/server.ts`
- `app/mypage/page.tsx`
- `app/mypage/quotes/page.tsx`
- `app/mypage/quotes/[quoteId]/page.tsx`
- `app/mypage/requests/[requestId]/page.tsx`
- `app/partner/page.tsx`
- `app/admin/page.tsx`
- `app/admin/operations/page.tsx`
- `app/admin/pages/[pageKey]/page.tsx`
- `app/admin/globals/[documentKey]/page.tsx`
- `app/api/me/overview/route.ts`
- `app/api/me/status/route.ts`
- `app/api/audit-evaluations/access/firebase/route.ts`
- `components/CmsSimplePage.tsx`
- `components/cms-editor/CmsActualPagePreview.tsx`
- `app/globals.css`
- `lib/cms/constants.ts`
- `lib/cms/defaults.ts`
- `lib/cms/admin-console-presentation.ts`
- `lib/cms/feature-registry.ts`
- `lib/cms/editor-validation.ts`
- `lib/cms/route-presentation.ts`
- `lib/cms/testing/route-completion.test.ts`
- `docs/portal-login-separation-progress.md`

### 남은 접근 통제 위험

- proxy는 의도적으로 cookie 존재만 확인한다. 신규 보호 page가 추가되면
  Server Component guard를 반드시 함께 적용해야 하며 proxy만 신뢰하면 안 된다.
- session 최종 판정은 매 요청 Firestore profile/partner 재조회 비용이 있다.
  캐시를 추가할 경우 계정 정지 반영 지연을 별도로 설계해야 한다.
- 기존 관리자 `adminRole` 누락 시 최고관리자 호환 fallback은 아직 유지된다.
  운영 전 `check:admin-ready`와 명시적 role migration 확인이 필요하다.
- invalid/revoked session cookie는 보호 page에서 로그인으로 이동하지만
  Server Component가 cookie를 직접 삭제하지는 않는다. 로그인 성공 또는
  logout 시 덮어쓰거나 만료하며, 무한 redirect는 발생하지 않는다.
- 실제 Firebase revoke, paused partner, 세 account type 브라우저 조합은
  staging 계정과 emulator에서 추가 확인해야 한다.

### STEP 6 Footer 작업 대상

- `components/Footer.tsx`
- `lib/cms/defaults.ts`의 footer links
- CMS 공통 영역 editor presentation/test
- `app/globals.css`의 desktop/mobile/focus/touch target

STEP 5에서는 Footer 링크를 추가하지 않았다.

## STEP 4 구현 결과

### 생성한 로그인 경로

- 고객: `/login`
  - CMS page key: `auth.login`
  - `expectedPortal="customer"`
  - 기존 최고관리자·제휴사 `/login` 호환을 위해
    `legacyCrossPortal=true`
- 제휴사: `/partner/login`
  - CMS page key: `auth.partnerLogin`
  - `expectedPortal="partner"`
  - 포털 불일치는 자동 인증 실패로 숨기지 않고 canonical 포털 안내
- 내부 운영자: `/admin/login`
  - CMS page key: `auth.adminLogin`
  - `expectedPortal="admin"`
  - 포털 불일치는 canonical 포털 안내

세 페이지 모두 `robots: noindex, nofollow`, `Topbar`, 기존 login shell,
`Footer`를 공유한다.

### 공통 LoginForm 구조

- `LoginPageRenderer`가 CMS page key를 받아 동일 레이아웃을 렌더링한다.
- `lib/auth/login-page.ts`가 page key별 고정 설정을 제공한다.
  - expected portal
  - legacy cross-portal 허용 여부
  - 고객 아이디 찾기 노출 여부
- 단일 `LoginForm`이 STEP 3의 다음 코드를 그대로 재사용한다.
  - `loginWithEmailAndPassword()`
  - `/api/auth/portal-session`
  - Firebase 안전 오류 변환
  - portal mismatch 처리
  - 중복 제출 ref
  - 비밀번호 재설정
- 이메일·비밀번호 label, Enter form submit, `autocomplete=email`,
  `autocomplete=current-password`, 비밀번호 표시 버튼을 유지한다.
- 로그인 실패 시 email/password state를 초기화하지 않는다.
- 고객만 회원가입과 아이디 찾기를 노출한다.
- 제휴사는 회원가입 대신 `/partner/apply`의 제휴사 등록 문의를 노출한다.
- 운영자는 회원가입·고객 아이디 찾기를 노출하지 않고 비밀번호 재설정만
  제공한다.

### 포털별 CMS 기본 문구

- 고객
  - `농협지원센터 로그인`
  - `견적 요청 내역과 평가보고서를 확인하세요.`
- 제휴사
  - `제휴사 로그인`
  - `등록된 제휴사 운영자 계정으로 로그인하세요.`
- 운영자
  - `운영자 로그인`
  - `농협지원센터 내부 운영자 전용입니다.`

세 page key를 CMS 중앙 등록부, 관리자 표시 정보, 편집 필드 설명,
실제 page preview에 등록했다. 운영 데이터에 seed/publish는 수행하지 않았고
CMS 문서가 없으면 검증된 코드 기본값을 사용한다.

### 로그인 성공·오류 처리

- CUSTOMER → `/mypage`
- PARTNER_OPERATOR → `/partner`
- INTERNAL_OPERATOR → `/admin`
- 승인 대기 고객 → `/pending-approval`
- active 계정이 다른 포털에서 로그인하면 403 `portal_mismatch` 후 검증된
  canonical 내부 경로를 안내한다.
- suspended/disabled 운영자와 paused/terminated 제휴사는
  `account_unavailable`로 차단한다.
- profile 없음과 account configuration 오류도 상세 원인을 노출하지 않는
  일반 접근 불가 문구를 사용한다.
- Firebase raw error code/message는 사용자에게 렌더링하지 않는다.

### 기존 경로 호환과 redirect

- 기존 고객 표준 `/login`을 변경하지 않았다.
- 기존 관리자·제휴사의 `/login` 비밀번호 로그인도 server resolver 판정 후
  각각 `/admin`, `/partner`로 이동한다.
- 기존 browser login page redirect가 따로 없었으므로 새 alias/redirect를
  만들지 않았다.
- 세 로그인 page 자체에서 `redirect()`를 호출하지 않고 서로 다른 canonical
  route를 직접 렌더링하므로 redirect loop가 없다.
- 비활성화된 `/api/auth/admin-login`은 browser login 경로가 아니며 410을
  유지한다.
- 관리자 logout은 `/admin/login`, 제휴사 logout은 `/partner/login`,
  고객 logout은 `/login`으로 정렬했다.

### STEP 4 테스트 결과

- portal UI + 공통 auth 집중 테스트: **20/20 통과**
- CMS 전체 테스트: **98/98 통과**
- `npm run cms:audit`: **통과**
  - 사용자 route 28개 = 등록 26개 + 문서화된 예외 2개
- `npm run lint`: **통과**
- `npm run typecheck`: **통과**
- `npm run build`: **통과**
  - `/login`, `/partner/login`, `/admin/login` 모두 static route 생성 확인

### STEP 4 변경 파일

신규:

- `app/partner/login/page.tsx`
- `app/admin/login/page.tsx`
- `lib/auth/login-page.ts`
- `lib/cms/testing/portal-login-pages.test.ts`

수정:

- `app/login/page.tsx`
- `components/LoginForm.tsx`
- `components/LoginPageRenderer.tsx`
- `components/cms-editor/CmsActualPagePreview.tsx`
- `components/AdminDashboard.tsx`
- `components/CmsAdminConsole.tsx`
- `components/PartnerDashboard.tsx`
- `lib/cms/constants.ts`
- `lib/cms/defaults.ts`
- `lib/cms/admin-console-presentation.ts`
- `lib/cms/feature-registry.ts`
- `lib/cms/editor-validation.ts`
- `lib/cms/route-presentation.ts`
- `lib/cms/testing/route-completion.test.ts`
- `docs/portal-login-separation-progress.md`

### STEP 5에서 보호할 경로

- CUSTOMER: `/mypage`, `/mypage/**`
- PARTNER_OPERATOR: `/partner`, `/partner/**`
  - 공개 제외: `/partner/login`, `/partner/apply`
- INTERNAL_OPERATOR: `/admin`, `/admin/**`
  - 공개 제외: `/admin/login`
- STEP 5는 `PORTAL_SESSION_COOKIE`, session cookie 검증,
  `canAccessPortal()`, `getLoginPathForPortal()`을 재사용한다.
- API Bearer token 인가는 기존 API에서 계속 별도로 수행한다.

STEP 4에서는 root `proxy.ts`와 Footer portal link를 구현하지 않았다.

## STEP 3 구현 결과

### 구현한 공통 인증 모듈

- `lib/auth/portal.ts`
  - `PortalType`, `AccountType`, `AccountStatus`
  - `AuthenticatedAccountContext`
  - `canAccessPortal()`, `getDefaultPortal()`
  - `getPortalHomePath()`, `getLoginPathForPortal()`
  - `getPortalMismatchResult()`, `getPostLoginPath()`
- `lib/auth/account-context.ts`
  - Firebase identity, profile, claim, 계정·제휴사 상태를 정규화하는 순수 판정기
  - profile 없음, 중복 profile, claim/profile 충돌을 typed error로 fail-closed
- `lib/auth/portal-server.ts`
  - `resolveAccountContext(req)`
  - 기존 `verifyBearerToken()`, `adminDb()` 재사용
  - direct `users/{uid}`와 동일 uid query 결과를 합쳐 중복 profile 탐지
- `lib/auth/login-client.ts`
  - Firebase 비밀번호 로그인, persistence, ID token 교환, redirect 결과 처리
  - 공통 logout에서 HttpOnly session 삭제와 Firebase `signOut()` 모두 시도
- `lib/auth/login-errors.ts`
  - Firebase 오류 code를 CMS의 안전한 오류 문구 key로 변환
- `lib/auth/session.ts`
  - 공통 session cookie 이름과 만료시간
- `app/api/auth/portal-session/route.ts`
  - 서버 account context 판정 후 Firebase session cookie 생성
  - persistent 14일, browser session 12시간
  - HttpOnly, SameSite=Lax, production Secure, no-store
- `app/api/auth/logout/route.ts`
  - 공통 session cookie 만료

### 계정 유형 판정 방식

- 이메일 주소나 도메인으로 판정하지 않는다.
- `users.role`을 서버에서 다음과 같이 파생한다.
  - `member` → `CUSTOMER`
  - `partner` → `PARTNER_OPERATOR`
  - `admin` → `INTERNAL_OPERATOR`
- token email과 profile email, profile uid와 token uid를 확인한다.
- admin은 `admin:true`, partner는 `partner:true` claim과 profile role의
  정합성을 확인한다. admin/partner claim 동시 보유도 차단한다.
- admin role과 permission은 기존 `AdminRole`, `getAdminRole()`,
  `getEffectivePermissions()`를 재사용한다.
- customer 상태는 `users.status`, 운영자 상태는 기존
  `getAccountStatus()`를 정규화한다.
- partner는 profile `partnerId`와 `partners/{partnerId}`를 확인한다.
  `pending`은 `INVITED`, `paused`는 `SUSPENDED`, `terminated`는
  `DISABLED`로 처리한다.
- profile 없음, 같은 uid의 복수 profile, uid/email/claim 불일치,
  partner 문서 없음은 session을 발급하지 않는다.

### 포털 접근 판정 방식

- active `CUSTOMER` → customer, `/mypage`
- active `PARTNER_OPERATOR` → partner, `/partner`
- active `INTERNAL_OPERATOR` → admin, `/admin`
- customer 승인 대기 → `/pending-approval`
- `INVITED` 운영자, `SUSPENDED`, `DISABLED`, paused/terminated partner는
  모든 보호 포털을 차단한다.
- active 계정의 포털 불일치는 403 `portal_mismatch`와 검증된 canonical
  내부 경로만 반환한다.
- 기존 `/login`은 `legacyCrossPortal=true` 기본값으로 관리자와 제휴사를
  각각 기존 포털로 보내 기존 최고관리자 로그인을 유지한다.

### 기존 관리자 인증 호환과 전환 계획

- 기존 Firebase `signInWithEmailAndPassword()`를 공통 서비스에서 유지한다.
- `seed-admin.mjs`의 Auth password, `admin:true`, 기존 UID·role 보존 구조를
  변경하지 않았다.
- 기존 profile의 `adminRole` 누락 fallback은 현재 최고관리자 호환을 위해
  기존 `getAdminRole()` 경로를 재사용한다. STEP 4 staging 전
  `check:admin-ready`와 migration으로 명시적 role을 확인한 뒤 별도 보안
  변경에서 fallback 제거 여부를 결정한다.
- `app/api/auth/admin-login/route.ts`는 410 상태를 유지한다.
- 신규 로그인과 session API는 custom token을 생성하지 않는다.
- 410 legacy route는 STEP 4와 staging에서 기존 최고관리자 비밀번호 로그인
  회귀를 확인할 때까지 명시적 tombstone으로 유지한 뒤 제거 여부를 결정한다.
- 비밀번호는 코드·Firestore에 저장하지 않으며 기존 seed도 shell 환경변수만
  사용한다.

### 테스트 결과

- portal 관련 단위/계약 테스트: **18/18 통과**
  - 고객·내부 운영자·제휴사 운영자 판정
  - profile 없음, customer/operator 중복 profile
  - 비활성 admin, paused/terminated partner
  - default portal, portal mismatch
  - Firebase 오류 문구 변환
  - 공통 로그인/session/logout 및 410 legacy API 계약
- `npm run typecheck`: **통과**
- `npm run lint`: **통과**
- `npm run test:cms`: **92/92 통과**
- `npm run test:admin-rbac`: 신규 portal 테스트는 전부 통과했으나 전체 명령은
  기존 `migration-seed-index.test.ts`가 Firestore의 새
  `quoteAssignments` index 2개를 예상하지 않아 **76/77**에서 실패한다.
  이번 STEP 3 인증 변경과 무관한 기존 blocker다.

### STEP 3 변경 파일

신규:

- `lib/auth/portal.ts`
- `lib/auth/account-context.ts`
- `lib/auth/portal-server.ts`
- `lib/auth/login-client.ts`
- `lib/auth/login-errors.ts`
- `lib/auth/session.ts`
- `app/api/auth/portal-session/route.ts`
- `app/api/auth/logout/route.ts`
- `lib/admin/testing/portal-authentication.test.ts`

수정:

- `components/LoginForm.tsx`
- `components/MyPageDashboard.tsx`
- `components/PartnerDashboard.tsx`
- `components/AdminDashboard.tsx`
- `components/CmsAdminConsole.tsx`
- `lib/cms/defaults.ts`
- `lib/cms/route-presentation.ts`
- `lib/cms/testing/route-completion.test.ts`
- `docs/portal-login-separation-progress.md`

### STEP 4 재사용 대상

- 전용 로그인 화면:
  - `LoginForm expectedPortal="partner" legacyCrossPortal={false}`
  - `LoginForm expectedPortal="admin" legacyCrossPortal={false}`
- page guard/proxy:
  - `PORTAL_SESSION_COOKIE`
  - `resolveAccountContext()`와 account-context 순수 판정 규칙
  - `canAccessPortal()`, `getPortalMismatchResult()`
  - `getLoginPathForPortal()`, `getPortalHomePath()`
- 포털 logout:
  - `logoutPortalSession()`

STEP 3에서는 전용 로그인 page, root `proxy.ts`, Footer를 구현하지 않았다.

## STEP 2 확정 사항

### 확정된 경로

- 고객 로그인: `/login`
- 고객 포털: `/mypage`
- 제휴사 로그인: `/partner/login`
- 제휴사 포털: `/partner`
- 내부 운영자 로그인: `/admin/login`
- 관리자 콘솔: `/admin`

기존 고객 포털이 `/mypage`와 하위 route를 이미 사용하므로 `/my`로 변경하거나
alias를 추가하지 않는다.

공개 예외:

- `/login`
- `/partner/login`
- `/partner/apply`
- `/admin/login`
- `/signup`
- `/pending-approval`

### 확정된 계정 유형

- `CUSTOMER`
  - 원본: `users.role = "member"`
  - 상태: `users.status`
- `INTERNAL_OPERATOR`
  - 원본: `users.role = "admin"`
  - 상태: `users.accountStatus`
  - 역할: 기존 `AdminRole` 재사용
    - `super_admin`
    - `operations_manager`
    - `partner_manager`
    - `cms_editor`
    - `read_only`
- `PARTNER_OPERATOR`
  - 원본: `users.role = "partner"`
  - 상태: `users.accountStatus`
  - 소속: `users.partnerId`
  - 제휴사 상태: `partners/{partnerId}.status`

`CUSTOMER`, `INTERNAL_OPERATOR`, `PARTNER_OPERATOR`는 서버가 기존 role에서
파생하며 별도 Firestore `accountType` 필드를 중복 저장하지 않는다.

현재 제휴사 포털에 자체 회원 관리·역할별 기능이 없으므로
`PARTNER_ADMIN`, `PARTNER_OPERATOR` 세부 역할은 새로 만들지 않는다.
향후 요구가 생기면 account type과 별도로 `partnerRole`을 설계한다.

### 공통 인증 방식

- Firebase 프로젝트와 Authentication은 하나를 유지
- Client 로그인: 기존 `getFirebaseAuth()`와
  `signInWithEmailAndPassword()` 재사용
- 공통 `LoginForm`에 `portal: customer | partner | admin` 입력 추가 예정
- Client가 ID token을 서버 `/api/auth/portal-session`으로 전달
- 서버가 token, profile, 상태, account type, partner 상태를 판정
- page direct access guard용 HttpOnly Firebase session cookie 발급
- API 인증은 기존 Authorization Bearer ID token 유지
- 관리자·제휴사 API는 기존 `requirePermission()`/`requirePartner()` 재사용
- 이메일·도메인·UID 문자열로 역할을 판정하지 않음

추가 예정 공통 모듈:

- `lib/auth/portal.ts`
- `lib/auth/portal-server.ts`
- `app/api/auth/portal-session/route.ts`
- `app/api/auth/logout/route.ts`

### 포털 불일치 정책

- 인증 성공과 포털 권한 실패를 구분
- 잘못된 포털의 올바른 계정은 403 `portal_mismatch`
- 이미 인증된 본인에게만 canonical portal 이동 링크 제공
- profile/role/partnerId/permission 상세는 오류 응답에 노출하지 않음

확정 시나리오:

- CUSTOMER at `/admin/login` → 403 + `/mypage`
- CUSTOMER at `/partner/login` → 403 + `/mypage`
- PARTNER_OPERATOR at `/admin/login` → 403 + `/partner`
- INTERNAL_OPERATOR at `/partner/login` → 403 + `/admin`
- INTERNAL_OPERATOR at `/login` → 기존 호환으로 `/admin`
- PARTNER_OPERATOR at `/login` → 기존 호환으로 `/partner`
- profile 없음 → generic 403, session 미발급
- account type 중복 또는 claim/profile 충돌 → fail-closed, audit, 지원 안내

### Footer 링크 위치

`components/Footer.tsx`의 최하단 `.foot__bar`에 muted 보조 nav를 추가한다.

- 제휴사 로그인 → `/partner/login`
- 운영자 로그인 → `/admin/login`
- `aria-label="제휴사 및 운영자 로그인"`
- separator는 `aria-hidden`
- 12~12.5px, 12px 미만 금지
- 링크별 최소 44px touch 영역
- focus-visible 유지
- 모바일에서 숨기지 않고 wrap 허용

CMS key:

- `footer.links.partnerLogin`
- `footer.links.operatorLogin`

### redirect가 필요한 기존 경로

- unauthenticated `/mypage/**` → `/login`
- unauthenticated `/partner/**` → `/partner/login`
  - `/partner/login`, `/partner/apply` 제외
- unauthenticated `/admin/**` → `/admin/login`
  - `/admin/login` 제외
- wrong portal direct access → 서버가 판정한 canonical home
- session 만료 → 해당 portal login

호환 정책:

- `/login`은 고객 canonical login으로 유지
- 기존 최고관리자와 제휴사도 `/login`에서 계속 인증 가능
- 신규 문서와 Footer는 전용 로그인 URL 사용
- `/api/auth/admin-login`은 410 유지, custom-token 경로 재활성화 금지
- `/my`는 추가하지 않음

## STEP 3에서 수정할 파일

### 신규 예정

- `lib/auth/portal.ts`
- `lib/auth/portal-server.ts`
- `app/api/auth/portal-session/route.ts`
- `app/api/auth/logout/route.ts`
- `app/partner/login/page.tsx`
- `app/admin/login/page.tsx`
- `proxy.ts`
- portal identity/session/redirect 테스트 파일

### 수정 예정

- `components/LoginForm.tsx`
- `components/LoginPageRenderer.tsx` 또는 신규 공통 login shell
- `app/login/page.tsx`
- `components/MyPageDashboard.tsx`
- `components/PartnerDashboard.tsx`
- `components/AdminDashboard.tsx`
- `components/CmsAdminConsole.tsx`
- `components/Footer.tsx`
- `lib/firebase/server.ts`
- `lib/firebase/schema.ts`는 공통 타입 export가 필요할 때만 수정
- `lib/cms/defaults.ts`
- `lib/cms/route-presentation.ts`
- `lib/cms/feature-registry.ts`
- `app/globals.css`
- 관련 `lib/admin/testing/*`, `lib/cms/testing/*`

## 구현 전 확인 조건

- 기존 최고관리자 profile에 명시적 `adminRole`과 active status가 있는지
  read-only 확인
- `/login` 호환 회귀 테스트 유지
- public `/partner/apply`가 proxy에 차단되지 않는 matcher 테스트
- session cookie와 API Bearer token의 역할 분리
- 외부 `returnTo` 차단과 redirect loop 테스트
- production 배포·운영 Firebase/Auth 변경은 별도 승인 전 금지

## 작성 문서

- `docs/portal-login-separation-design.md`
- `docs/portal-login-separation-progress.md`

선행 분석 문서는 STEP 2 시작 시 저장소에 없었다.

- `docs/portal-login-separation-analysis.md`

대체 근거:

- `docs/portal-login-separation-completion-report.md`
- 실제 인증·RBAC·Footer 코드

## NEXT_GATE

**READY_FOR_STEP_5_IMPLEMENTATION**

STEP 5는 사용자 요청 전 실행하지 않는다.
