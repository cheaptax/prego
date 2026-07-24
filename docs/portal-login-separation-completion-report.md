# 포털 로그인 경로 분리 최종 완료 보고서

작성일: 2026-07-22  
기준 브랜치/커밋: `main` / `0f19c71`  
검증 기준: 현재 working tree의 실제 코드와 로컬 테스트  
운영 배포·운영 Firebase/Auth 변경: 수행하지 않음

## 1. Executive Verdict

**BLOCKED**

고객 로그인 `/login`, 고객 포털 `/mypage`, 제휴사 포털 `/partner`, 관리자
콘솔 `/admin`은 존재한다. 그러나 목표의 핵심인 `/partner/login`과
`/admin/login`이 없고, 모든 계정이 `components/LoginForm.tsx`가 렌더링되는
`/login`을 함께 사용한다. `middleware.ts` 또는 `proxy.ts`도 없어 URL 단계의
서버 route guard와 기존 URL redirect가 구현되지 않았다.

검토 중 고객 API가 Firebase 로그인만 확인하고 `users.role=member`를 확인하지
않던 문제를 수정했다. 고객 포털은 admin/partner claim을 감지하면 각 포털로
돌려보내며, `/login`은 `noindex`로 고정했다. 관리자·제휴사 API의 서버 인가는
기존 구현대로 유지된다.

요청된 선행 문서
`portal-login-separation-analysis.md`, `portal-login-separation-design.md`,
`portal-login-separation-security-report.md`,
`portal-login-separation-progress.md`는 검토 시작 시 저장소에 없었다.
따라서 이 보고서는 실제 소스와 기존 RBAC/보안 문서를 기준으로 작성했다.

### 목표 대비 구현 상태

1. 고객 로그인 경로 — **COMPLETE**: `app/login/page.tsx`의 `/login`
2. 제휴사 로그인 경로 — **NOT_IMPLEMENTED**: `/partner/login` route 없음
3. 운영자 로그인 경로 — **NOT_IMPLEMENTED**: `/admin/login` route 없음
4. 공통 LoginForm — **PARTIAL**: `components/LoginForm.tsx` 하나만 있으나 포털별 mode/허용 계정 계약과 재사용 페이지가 없음
5. 공통 Firebase 인증 — **COMPLETE**: `getFirebaseAuth()`와 `signInWithEmailAndPassword()` 사용
6. 계정 유형 판정 — **PARTIAL**: 로그인 redirect는 Custom Claims, API는 Firestore profile을 함께 사용
7. 로그인 후 포털 redirect — **PARTIAL**: `/login`에서 admin→`/admin`, partner→`/partner`, member→`/mypage`; 전용 로그인별 허용 계정 검증 없음
8. 포털 불일치 처리 — **PARTIAL**: 고객 포털은 admin/partner를 되돌리지만 admin/partner 화면은 접근 거부 shell을 표시
9. 고객 Route Guard — **PARTIAL**: client auth와 고객 API role guard는 있으나 서버 route guard 없음
10. 제휴사 Route Guard — **PARTIAL**: `PartnerDashboard`와 `/api/partner/session` guard는 있으나 서버 route guard 없음
11. 관리자 Route Guard — **PARTIAL**: 관리자 client/API guard는 있으나 서버 route guard 없음
12. 고객 API 권한 — **PARTIAL**: `/api/me/**`의 member·active 검사를 보강했으나 전체 고객 API 실계정 통합 검증은 미수행
13. 제휴사 API 권한 — **COMPLETE**: `requirePartner()`가 claim, profile, account status, partner status를 확인
14. 관리자 API 권한 — **COMPLETE**: `requirePermission()`/`requireAdminCapability()`가 profile·status·permission을 확인
15. 비활성 계정 차단 — **COMPLETE**: 서버 API가 `accountStatus`/회원 `status`를 재검사
16. 제휴사 상태 확인 — **COMPLETE**: `requirePartner()`가 `partners/{partnerId}.status === "active"` 확인
17. 기존 관리자 로그인 호환 — **COMPLETE**: 기존 `/login`에서 `admin:true` claim이면 `/admin` 이동
18. 기존 URL redirect — **NOT_IMPLEMENTED**: 로그인 URL 호환 redirect 또는 middleware 없음
19. Footer 제휴사 로그인 링크 — **NOT_IMPLEMENTED**
20. Footer 운영자 로그인 링크 — **NOT_IMPLEMENTED**
21. 모바일 Footer — **PARTIAL**: 기존 responsive Footer는 있으나 두 로그인 링크가 없음
22. 로그인 페이지 noindex — **PARTIAL**: 현재 `/login`은 noindex, 미구현된 두 전용 로그인 페이지는 적용 불가
23. 단위 테스트 — **PARTIAL**: portal boundary 4건 통과, 전체 suite는 별도 index 계약 실패
24. API 테스트 — **PARTIAL**: source-contract와 기존 권한 테스트는 있으나 세 계정 실토큰 통합 테스트 없음
25. UI 테스트 — **PARTIAL**: 공통 E2E 72개 시나리오는 통과했으나 미구현 전용 로그인 URL과 계정별 로그인은 테스트 불가
26. production build — **COMPLETE**: `npm run build` 통과

## 2. 작업 목적

고객, 외부 제휴사, 내부 운영자가 서로 다른 로그인 URL에서 인증하고 계정
유형에 맞는 포털로만 진입하도록 분리하는 것이다. URL 분리는 UX만이 아니라
서버 API의 role, 상태, 소속, permission 검사와 함께 작동해야 한다.

## 3. 기존 문제

- `app/login/page.tsx` 한 곳에서 세 계정 유형이 모두 로그인한다.
- `components/LoginForm.tsx`가 claim만 보고 포털을 선택하며 로그인 화면 자체는
  요청된 포털 유형을 제한하지 않는다.
- `/partner/login`, `/admin/login` route가 없다.
- `middleware.ts`/`proxy.ts`가 없어 보호 페이지의 정적 shell은 인증 전에 전달된다.
- `app/api/me/overview/route.ts` 등 일부 고객 API는 기존에 member role을
  확인하지 않았다. 이번 검토에서 보강했다.
- `lib/admin/rbac.ts`의 `getAdminRole()`은 `adminRole` 누락 profile을
  `super_admin`으로 해석하는 fail-open 호환 동작을 유지한다.
- Footer CMS 스키마와 컴포넌트에는 제휴사·운영자 로그인 링크가 없다.

## 4. 최종 로그인 URL

현재 실제 URL:

- 고객 로그인: `/login`
- 고객 포털: `/mypage`
- 제휴사 로그인: **없음** (`/login`을 공유)
- 제휴사 포털: `/partner`
- 내부 운영자 로그인: **없음** (`/login`을 공유)
- 관리자 콘솔: `/admin`

`npm run build` route manifest에도 `/partner/login`과 `/admin/login`은 없다.

## 5. 계정 유형과 역할

- 고객: `users.role = "member"`, 회원 승인 상태는 `users.status`
- 제휴사 계정: `users.role = "partner"`, `users.partnerId`,
  `accountStatus`, `partners/{partnerId}.status`
- 내부 운영자: `users.role = "admin"`, `accountStatus`, `adminRole`,
  permission allow/deny
- 관리자 역할: `super_admin`, `operations_manager`, `partner_manager`,
  `cms_editor`, `read_only`
- Custom Claims: `admin: true`, `partner: true`; partner 호환 claim으로
  `partnerId`가 사용될 수 있음

근거는 `lib/firebase/schema.ts`, `lib/admin/rbac.ts`,
`lib/firebase/server.ts`이다. 이메일 문자열로 최고관리자를 판정하는 코드는
확인되지 않았다.

## 6. 공통 인증 구조

- Client SDK 초기화: `lib/firebase/client.ts`의 `getFirebaseApp()`,
  `getFirebaseAuth()`
- 비밀번호 로그인: `components/LoginForm.tsx`의
  `signInWithEmailAndPassword()`
- persistence: `browserLocalPersistence` 또는 `browserSessionPersistence`
- 비밀번호 재설정: `sendPasswordResetEmail()`
- 서버 token 검증: `lib/firebase/server.ts`의 `verifyBearerToken()`
- Admin SDK 초기화: `lib/firebase/admin.ts`의 `getFirebaseAdminApp()`
- session cookie는 사용하지 않고 Authorization Bearer ID token을 사용
- `app/api/auth/admin-login/route.ts`의 legacy custom-token endpoint는
  HTTP 410으로 비활성화됨

## 7. 포털별 로그인 화면

고객 로그인 화면만 `app/login/page.tsx`와
`components/LoginPageRenderer.tsx`로 구현되어 있다. 이 화면은
`components/LoginForm.tsx`를 사용한다.

제휴사·운영자 전용 page, 제목/안내, 허용 계정 mode, 포털 불일치 오류 문구는
없다. 이번 단계는 새 기능 추가 금지이므로 두 route를 새로 만들지 않았다.

## 8. 로그인 후 redirect

`components/LoginForm.tsx`의 `submit()` 흐름:

1. Firebase 이메일/비밀번호 로그인
2. 강제 갱신한 ID token claim 확인
3. `admin:true`면 `/admin`
4. `partner:true`면 `/partner`
5. 그 외에는 `/api/me/status` 확인
6. active member면 `/mypage`, 아니면 `/pending-approval`

`components/MyPageDashboard.tsx`는 이번 검토에서 admin/partner claim을
확인해 각각 `/admin`, `/partner`로 되돌리도록 보강했다.

한계: 로그인 단계의 최종 계정 유형 판정이 claim 우선이며, 전용 로그인
화면과 서버 account-resolution endpoint가 없다.

## 9. Route Guard

- 전역 middleware/proxy: 없음
- 고객: `MyPageDashboard`의 `onAuthStateChanged()`와 고객 API 검사
- 제휴사: `PartnerDashboard`의 claim 검사 및 `/api/partner/session`
- 관리자: `AdminDashboard`, `CmsAdminConsole`의 claim 검사 및 관리자 API

세 포털 모두 client-rendered shell을 먼저 받을 수 있다. 데이터는 서버 API가
401/403으로 차단하지만 URL 자체의 server redirect는 구현되지 않았다.
공개 `/login`을 middleware가 오차단하는 문제는 middleware가 없으므로 없다.

## 10. API 권한 분리

관리자:

- `requireAuthenticatedAdmin()` → `requireActiveAdmin()` →
  `requirePermission()` 순서
- admin claim, `users.role=admin`, active 상태, 역할별 permission을 확인

제휴사:

- `requirePartner()`가 partner claim, `users.role=partner`,
  `accountStatus`, profile `partnerId`, partner 문서 active 상태를 확인
- 요청 body의 `partnerId` 대신 인증 profile의 `partnerId`를 원본으로 사용
- assignment API는 리소스와 partnerId 관계를 추가 확인

고객:

- 기존 `requireActiveMember()`는 role, active status, token/profile email을 확인
- 이번 검토에서 consent, 답변 열람·평가, 문의 완료 API에 이를 적용
- status/overview API는 pending 회원 흐름을 유지하면서 non-member profile과
  email mismatch를 403으로 차단
- 공개 문의 API는 admin/partner profile을 회원 context로 사용하지 않도록 수정

## 11. 비활성 계정 처리

- 관리자 API: `isAccountActive()`를 매 요청 확인
- 제휴사 API: 계정 active와 partner 문서 active를 모두 확인
- 고객 mutation API: `requireActiveMember()` 사용
- Firebase Auth disabled/claim 동기화는 운영자·제휴사 관리 API에 구현됨

남은 위험:

- Auth와 Firestore 갱신은 하나의 원자 transaction이 아니며 자동
  reconciliation job이 없다.
- UI shell은 비활성 세션에서도 로드될 수 있으나 서버 데이터는 반환되지 않는다.

## 12. 기존 로그인 경로 호환

기존 `/login`은 삭제·redirect하지 않았으며 관리자와 제휴사도 계속 로그인할
수 있다. 따라서 기존 관리자 로그인 호환은 유지된다.

다만 목표 URL이 추가되지 않아 호환 전략이 아니라 기존 단일 로그인 구조를
그대로 사용하는 상태다. `/api/auth/admin-login`은 410을 반환한다.

## 13. Footer 링크 구현

`components/Footer.tsx`는 `CmsGlobalsProvider`의 `globals.footer`를 사용한다.
기본 링크는 `lib/cms/defaults.ts`의 `CMS_GLOBAL_DEFAULTS.footer.links`에 있는
약관, 개인정보처리방침, 고객문의, 문의게시판, 소개, 회원가입, 마이페이지만
포함한다.

제휴사 로그인과 운영자 로그인 링크는 구현되지 않았다. 추가 시 CMS footer
links schema/default/editor를 함께 확장하고, 문의 열의 보조 링크 또는
정책 열 아래의 명확히 분리된 보조 영역에 배치해야 한다.

모바일에서는 `app/globals.css`가 720px 이하에서 2열, 480px 이하에서 1열로
변환한다. 현재 link font-size는 footer 기본 14px이며 새 링크는 아직 없다.

## 14. SEO와 접근성

- `app/login/page.tsx`는 이번 검토에서 CMS 설정과 관계없이
  `robots: { index: false, follow: false }`로 고정했다.
- `/partner/login`, `/admin/login`은 없으므로 noindex 적용 대상도 없다.
- 기존 login input에는 label, autocomplete, alert/status가 있다.
- 일반 E2E 접근성 검사에서 이름 없는 interactive와 label 없는 input으로 인한
  실패는 없었다.

## 15. 테스트 결과

- `npm run typecheck`: **PASS**
- `npm run lint`: **PASS**
- portal boundary 단독 테스트: **PASS, 4/4**
- `npm run test:partner`: **PASS, 11/11**
- `npm run test:cms`: **PASS, 92/92**, emulator 2개는 환경변수 미설정으로 skip
- `npm run test:e2e`: **PASS**, 24 routes, 72 scenarios, console error 0
- `npm run build`: **PASS**, Next.js 16.2.11 production build
- `git diff --check`: **PASS**
- `npm test`: **FAIL**
  - `test:admin-rbac` 65/66
  - `lib/admin/testing/migration-seed-index.test.ts`가 index 2개만 기대하지만
    현재 `firestore.indexes.json`에는 `quoteAssignments` index 2개가 추가돼 있음
  - portal boundary 4건은 이 suite 안에서도 모두 통과

실제 Firebase 고객·제휴사·관리자 계정을 사용한 로그인과 401/403 smoke는
제약에 따라 수행하지 않았다.

## 16. 변경 파일

이번 최종 검토에서 직접 수정:

- `app/login/page.tsx`
- `app/api/inquiries/route.ts`
- `app/api/me/status/route.ts`
- `app/api/me/overview/route.ts`
- `app/api/me/consents/route.ts`
- `app/api/me/requests/[requestId]/complete/route.ts`
- `app/api/me/answers/[requestId]/rating/route.ts`
- `app/api/me/answers/[requestId]/view/route.ts`
- `components/MyPageDashboard.tsx`

검토 전부터 working tree에 있던 관련 변경:

- `components/LoginForm.tsx`: partner claim redirect
- `lib/firebase/server.ts`: 관리자·제휴사·고객 서버 인가
- 관리자·제휴사 API 및 RBAC 관련 다수 파일

## 17. 신규 파일

- `lib/admin/testing/portal-login-separation.test.ts`
- `docs/portal-login-separation-completion-report.md`
- `docs/portal-login-separation-production-checklist.md`
- `docs/portal-login-separation-progress.md`

## 18. 운영 환경 반영 전 작업

1. `/partner/login`, `/admin/login`과 포털별 허용 계정 계약을 구현한다.
2. URL route guard 또는 server session 전략을 확정한다.
3. Footer CMS schema/default/editor와 모바일 UI에 두 링크를 추가한다.
4. 기존 `/login`의 호환 정책을 확정한다.
5. stale `adminRole`/claim/accountStatus를 migration dry-run으로 확인한다.
6. 전체 `npm test`의 index 계약 실패를 현재 quote index 요구와 정렬한다.
7. Java 21 환경에서 Rules emulator suite를 실행한다.
8. staging Firebase 테스트 계정으로 세 포털과 401/403을 확인한다.
9. 147개 porcelain entry가 있는 현재 dirty working tree를 기능별로 분리하고
   review 가능한 commit/PR 상태로 만든다.

## 19. 알려진 제한사항

- 전용 제휴사·운영자 로그인 URL 미구현
- middleware/server route guard 미구현
- 로그인 account-type 판정이 client claim 우선
- `adminRole` 누락 시 `super_admin` fallback
- 마지막 super-admin 동시 변경 race
- Auth/Firestore 부분 실패 reconciliation 부재
- 포털 로그인 전용 Footer 링크 부재
- 실제 계정 기반 통합 테스트 미수행
- 요청된 선행 분석·설계·보안 문서 3개 부재

## 20. 롤백 방법

이번 검토의 코드 변경만 되돌릴 때:

1. 위 16절의 직접 수정 파일에서 member role/API hardening과 noindex 변경을
   이전 상태로 되돌린다.
2. `lib/admin/testing/portal-login-separation.test.ts`를 제거한다.
3. 이 단계에서 작성한 문서 3개를 제거한다.
4. 사용자와 다른 작업의 기존 미커밋 변경은 건드리지 않는다.

배포 롤백은 직전 검증 release로 애플리케이션을 되돌린 뒤 Rules와 Auth/profile
정합성을 확인한다. 이번 단계에서는 배포나 운영 데이터 변경을 하지 않았다.

## 21. 다음 권장 작업

다음 구현 단계에서 먼저 포털별 로그인 계약을 확정해야 한다.

- `/login`에서 admin/partner를 계속 허용할지 또는 전용 URL로 안내할지
- 잘못된 포털 로그인 시 자동 이동, 오류 표시, 강제 logout 중 어떤 정책을 쓸지
- middleware + session cookie를 도입할지, client shell + API guard를 유지할지
- Footer 링크를 CMS 편집 가능하게 할지 코드 고정으로 둘지
- legacy `adminRole` fallback 제거 시점과 production UID-role migration 승인

## NEXT_GATE

**BLOCKED**
