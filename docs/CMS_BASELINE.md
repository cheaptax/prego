# CMS baseline

조사 기준일: 2026-07-20  
최우선 기준: `NH_PREGO_SOFTCODING_RULES.md`

## 1. 조사 범위와 방법

- 프로젝트 소스의 `app`, `components`, `lib`, Firebase rules/config, 테스트와 운영 문서를 정적 조사했다.
- Next.js production build가 출력한 전체 route manifest를 소스 inventory와 대조했다.
- 운영 URL의 공개·비로그인 HTML을 확인해 `/`, `/events/audit-quote`, `/admin` 및 나머지 공개 route의 배포 상태를 소스와 대조했다.
- 운영 데이터는 조회·생성·수정·삭제하지 않았다.
- 인증정보가 파일·명령·로그·스크린샷에 남지 않는 대화형 브라우저 도구가 제공되지 않아 인증 후 운영 화면은 자동 로그인하지 않았다. member/admin 화면은 동일 배포 소스, auth 분기, 보호 API와 상태 컴포넌트를 기준으로 조사했다.
- 기능 코드는 수정하지 않았다. 이 단계의 변경은 `docs/CMS_*.md` 문서뿐이다.

## 2. 현재 기술 구조

- Next.js 16.2 App Router, React 19, TypeScript strict.
- 화면 route 13개, API route pattern 27개, 루트 layout 1개.
- 화면 컴포넌트 대부분은 client component이고 Firebase Auth 상태를 브라우저에서 확인한 뒤 API에 ID token을 전달한다.
- 서버 API는 Firebase Admin SDK로 Auth, Firestore, Storage에 접근한다.
- 데이터 요청 라이브러리, schema validation 라이브러리, CSS framework는 없다.
- Tailwind는 사용하지 않는다. 전체 디자인은 약 12,800줄의 단일 `app/globals.css`와 class name에 의존한다.
- middleware/proxy가 없다. URL 진입 보호는 client redirect, 실제 데이터 보호는 API의 bearer 검증에 의존한다.

## 3. 공통 컴포넌트

### 전역

- `app/layout.tsx`: 기본 metadata, viewport/theme color, skip link, 모든 화면에 고정 고객지원 FAB.
- `components/Topbar.tsx`: 로고, 홈 anchor 내비게이션, 상담 CTA, auth별 회원가입/로그인/마이페이지, 모바일 메뉴.
- `components/Footer.tsx`: 운영주체, 정책, 문의 링크, 저작권.
- `components/BrandMark.tsx`, `components/ServiceIcon.tsx`: 공통 시각 자산.

### 홈

- `Hero`, `HeroArt`, `About`, `Expertise`, `Services`, `Process`, `CaseStudies`, `FAQ`.
- `Services`만 `localStorage` 값을 읽을 수 있으나 중앙 CMS가 아니며 사용자 브라우저별로 다르게 보인다.
- `ServiceCatalogAdmin`은 localStorage 편집기지만 어느 route에서도 렌더링하지 않는 미연결 컴포넌트다.
- 홈 FAQ는 Firestore published FAQ를 읽고 실패하면 코드 fallback을 표시한다.

### 폼과 데이터 화면

- `LoginForm`, `SignupForm`, `ConsultForm`, `AuditQuoteEventPage`.
- `InquiryBoard`, `FaqBoard`, `MyPageDashboard`, `RequestDetailPage`.
- `AdminDashboard`, `AdminAuditQuotesPanel`.
- `ConsultRequestLink`: 로그인 상태에 따라 `/login` 또는 `/consult`.

### 공통화 부족

- Card, Form field, state panel, toast, modal은 재사용 컴포넌트보다 CSS class와 각 대형 컴포넌트의 JSX로 반복된다.
- `AdminDashboard.tsx`는 약 4,600줄, `SignupForm.tsx`는 약 1,400줄이다. CMS 렌더러를 직접 추가하면 결합도가 더 커질 위험이 높다.
- 상태 문구와 validation 문구가 화면·API helper에 분산되어 같은 의미의 문구가 서로 다르다.

## 4. 현재 하드코딩 범위

### 사용자 표시 콘텐츠

- `app/layout.tsx`: 사이트명, 기본 SEO, skip link, 고객지원 접근성 label.
- `app/**/page.tsx`: 각 페이지 SEO, hero, 소개 문구.
- 홈 section 컴포넌트: 제목, 본문, KPI, 카드, CTA, badge, FAQ heading.
- `lib/platform.ts`: navigation, 9개 지원분야, 공개범위 설명, 가입/포인트/partner/admin 정책과 대규모 sample/prototype 데이터.
- `lib/default-faqs.ts`: FAQ fallback 4개.
- 로그인/가입/문의/이벤트/마이페이지/관리자 컴포넌트: label, placeholder, 도움말, validation, loading/success/error/empty/permission 문구 전체.
- `lib/request-status.ts`, `lib/member-status.ts`, `lib/inquiry-categories.ts`, `lib/audit-quote/status.ts`: 사용자 표시 status/category label.

### 디자인 값

- `app/globals.css`: 색상, 글꼴, 간격, 반경, 그림자, breakpoint와 모든 component style.
- `app/layout.tsx`: metadata icon의 inline SVG 색과 viewport theme color.
- 여러 JSX의 inline style: margin, text alignment 등.
- SVG path, 아이콘 크기와 색이 컴포넌트에 직접 포함된다.
- 이벤트 화면은 별도 `aq-*`, admin/member는 `admin-*`, 가입은 `auth-*` class 군으로 사실상 독립 디자인 시스템처럼 동작한다.

### 코드에 남겨야 하는 값

- route, API endpoint, Firestore collection/field, form `name`, status 저장값.
- auth/session/admin claim, visibility ACL, point 계산·범위·원장, 상태 전이.
- upload 형식·크기·개수, honeypot, idempotency, HMAC/dedupe/rate limit.
- 필수 개인정보 동의 여부와 policy version 검증.
- 농협의 안정 ID와 운영 master data. 농협 표시명 관리는 일반 페이지 CMS가 아니라 별도 권한·검증·이력을 가진 master-data 기능이어야 한다.

## 5. 기존 CMS 유사 기능 평가

### FAQ: 부분 구현

- Firestore `faqs`에 question, answer, category, `isPublic`, `displayStatus`, order, actor, timestamps를 저장한다.
- `/admin`에서 검색, 필터, 생성, 수정, 삭제가 가능하다.
- 공개 API는 public+published만 반환하고 코드 fallback이 있다.
- 부족한 점:
  - runtime schema와 `schemaVersion` 없음.
  - draft/published 문서가 collection 수준에서 분리되지 않음.
  - preview, revision, rollback, conflict detection 없음.
  - 삭제가 복구 가능한 soft delete가 아님.
  - timestamp가 server timestamp가 아닌 ISO client/server 시간 문자열.
  - 공개 GET이 collection이 비어 있으면 기본 FAQ를 자동으로 production에 쓰는 side effect가 있음.
  - rich text sanitize 정책 없음(현재 plain text라 직접 XSS 표면은 작음).

### 지원분야: 브라우저 localStorage prototype

- `Services`는 `nh-support-service-catalog` localStorage를 읽는다.
- `ServiceCatalogAdmin`은 동일 브라우저에 즉시 저장하지만 `/admin`에 연결되지 않았고 권한, 중앙 저장, draft/publish, audit, revision이 없다.
- 데이터가 빈 배열이면 홈 지원분야가 모두 사라질 수 있고 icon 값은 TypeScript union을 runtime에서 완전 검증하지 않는다.
- CMS로 간주할 수 없으며, 도입 시 legacy localStorage 값은 신뢰하지 않아야 한다.

### 회계감사 이벤트: 환경변수 기반 운영 설정

- enabled, 종료시각, 정책 version, 종료문구, 일부 benefit 표시를 env로 조정한다.
- 배포가 필요하고 `/admin` 편집, draft/preview/revision이 없어 소프트코딩 규칙을 충족하지 못한다.
- 보안 관련 config와 표시 콘텐츠 config가 같은 계층에 섞여 있어 CMS 전환 시 분리해야 한다.

### 그 외 화면

- 페이지 CMS collection, schema, loader, cache/revalidation, preview route가 없다.
- `cmsPublishedPages`, `cmsDraftPages`, globals, revisions, CMS audit/assets collection이 없다.
- 따라서 FAQ 외 주요 화면은 코드 배포 없이 편집할 수 없다.

## 6. 권한과 인증 기준선

### guest

- 홈/공개 route와 이벤트 intake 접근 가능.
- 헤더에서 회원가입/로그인 표시, 상담 CTA는 로그인으로 이동.
- 문의 게시판은 `public` 항목의 본문/답변만 읽는다.
- `/consult` form 자체는 보이지만 제출 시 token이 없으면 실패한다.

### member

- Firebase email/password 로그인 후 `/api/me/status`의 Firestore user status가 `active`여야 마이페이지로 이동한다.
- active member는 본인 문의, public 문의, 동일 농협의 org-only 문의를 server projection으로 받는다.
- 조직 wallet을 공유하며 답변 최초 열람 시 transaction으로 포인트가 차감된다.
- 필수 동의는 화면에서 잠기고 선택 수신 동의만 변경한다.

### admin

- Firestore/Storage rules의 admin은 `request.auth.token.admin == true`.
- 그러나 client `/admin`과 server `requireAdmin`은 custom claim 외에 특정 이메일 문자열 비교도 허용한다.
- 별도의 `POST /api/auth/admin-login`은 shared credential를 검증한 뒤 user 생성/갱신, custom claim 부여, custom token 발급까지 수행한다.
- 이 구조는 “이메일 문자열만으로 관리자 권한을 판단하지 않는다”는 프로젝트 규칙과 맞지 않으며 shared credential endpoint 자체도 제거 대상이다.

### partner

- role type과 prototype 데이터는 있으나 실제 Auth role, partner collection, route/API ACL이 없다.
- `/partner`는 누구나 접근 가능한 정적 prototype이다.

## 7. Firebase와 보안 규칙

### 사용 collection

- 회원/조직: `users`, `organizations`.
- 문의: `consultRequests`, `answers`, `answerViews`, `answerRatings`.
- 포인트/감사: `pointLedger`, `point_transactions`, `auditLogs`.
- 콘텐츠: `faqs`.
- 이벤트: `auditQuoteRequests`, `auditQuoteIdempotency`, `auditQuoteEmailDedup`, `auditQuoteRateLimits`, `auditQuoteNotifications`.

### Firestore rules 현황

- `users/{uid}`: admin 또는 본인은 read/create/update, delete는 admin.
- `organizations/{id}`: 모든 signed-in 사용자가 read/create/update, delete는 admin.
- `pointLedger/{id}`: admin read, 모든 signed-in 사용자가 create, update/delete는 admin.
- `consultRequests/{id}`: admin 또는 본인 read, 본인 create, update/delete admin.
- audit-quote 5개 collection: client read/write 모두 deny.
- 명시되지 않은 collection은 client default deny이고 서버 Admin SDK만 접근한다.

### Storage rules 현황

- `business-cards/{userId}/{fileName}`: admin 또는 소유자 read, 소유자 write, 10MB 미만, `image/*` 또는 PDF.
- 그 외 모든 path는 admin claim만 read/write.

### 보안 우선순위 발견사항

#### P0

1. 본인은 `users/{uid}` 전체를 update할 수 있다. field allowlist가 없어 직접 Firestore SDK로 자신의 `status`, `role`, `cooperativeId` 등을 변경할 수 있다. API가 user status를 신뢰하므로 가입 승인 우회로 이어질 수 있다.
2. 모든 signed-in 사용자가 모든 `organizations` 문서를 create/update할 수 있다. wallet balance와 users 목록 등 조직 데이터 무결성이 보호되지 않는다.
3. 모든 signed-in 사용자가 `pointLedger`를 create할 수 있다. 원장 불변성과 포인트 데이터 신뢰성이 깨진다.
4. admin 판정이 custom claim 단독이 아니라 이메일 문자열 fallback을 사용한다.
5. admin login endpoint가 배포 기본값을 가진 shared credential 방식이고, 로그인 오류 UI에도 해당 credential 안내가 포함되어 있다. credential rotation, brute-force 방어, 비밀 노출 관점에서 즉시 제거 대상이다.

#### P1

1. `/partner`가 인증 없이 내부 운영정책, 샘플 조직/문의/포인트를 표시한다. 현재 값이 sample이어도 실제 데이터처럼 보이고 제품 내부 정책을 공개한다.
2. 공개 FAQ GET이 빈 DB에 자동 seed한다. 운영 데이터 자동 덮어쓰기/seed 금지 원칙과 GET 무부작용 원칙을 위반한다.
3. route middleware가 없어 보호 페이지의 HTML loading shell은 누구나 받는다. 데이터 API는 보호되지만 server-side redirect와 일관된 권한 없음 처리가 없다.
4. admin overview가 여러 collection 전체를 한 번에 읽는다. 최소 권한 projection, pagination, 비용/성능 상한이 없다.
5. account lookup/check endpoints의 rate limit·abuse 방어가 코드에서 확인되지 않았다.

#### P2

- CMS runtime schema/sanitizer가 없다.
- Firebase 오류 원문이 일부 member/admin UI에 표시될 수 있다.
- native prompt로 운영자 임시 비밀번호를 받는다.
- business-card client upload 실패를 console error로 남긴다. 비밀번호/token은 아니지만 운영 로그 정책을 정리할 필요가 있다.
- 홈의 우위·최초 주장과 수치형 KPI는 근거 출처, 유효기간, 승인자 정보 없이 코드에 표시된다. CMS 전환 시 일반 문구보다 강한 게시 승인과 만료 경고가 필요하다.

## 8. 폼 저장 위치와 보호할 payload

### 로그인·계정 복구

- member 로그인: Firebase Auth `signInWithEmailAndPassword`; 서버 저장 없음.
- admin 로그인: `POST /api/auth/admin-login`에 `email`, `password`; custom token 반환.
- 아이디 찾기: `POST /api/auth/find-email`에 `name`, `phone`; 마스킹 이메일만 반환.
- 비밀번호 찾기: Firebase Auth `sendPasswordResetEmail`.

### 회원가입

- 명함: Firebase Storage `business-cards/{uid}/{timestamp}-{safeFileName}`.
- `POST /api/signup` JSON:
  - token: `idToken`, `phoneVerificationIdToken`
  - identity: `name`, `phone`, `email`
  - organization: `cooperativeId`, `manualCooperativeName`
  - work: `position`, `duty`
  - file: `businessCardUrl`, `businessCardPath`
  - consent object: `terms`, `privacy`, `marketing`, `email`, `sms`, `kakao`
- 주요 저장 위치: `users`; 승인 시 `organizations`, `pointLedger`, `point_transactions`, `auditLogs`.

### 일반 상담 문의

- `POST /api/consult` multipart:
  - `subject`, `message`, `visibility`, `category`
  - `consent`, `marketingConsent`
  - optional `parentRequestId`
  - repeated `attachments`
- 저장: `consultRequests`; 첨부는 Firebase Storage의 문의별 path; 후속문의면 parent 문서 연결정보 갱신.

### 회계감사 이벤트

- `POST /api/audit-quote/requests` JSON:
  - `email`, `name`, `phone`
  - `privacyConsent`, `privacyPolicyVersion`, `marketingConsent`
  - `source.campaign`, `source.channel`
  - honeypot `companyWebsite`
- header: `Idempotency-Key`.
- 저장: audit-quote intake/dedupe/rate/notification collection. raw email과 HMAC email hash의 취급은 보호 대상이다.

### member 액션

- 선택동의: `PATCH /api/me/consents`, `{ consents: { [allowedKey]: boolean } }`.
- 답변 열람: `POST /api/me/answers/[requestId]/view`, body 없음.
- 평가: `POST /api/me/answers/[requestId]/rating`, `score`, `helpful`, `comment`.
- 문의 완료: `POST /api/me/requests/[requestId]/complete`, body 없음.

### admin 액션

- 답변: `internalCategory`, `adminTags`, `pointCost`, `answerBody`.
- 포인트 조정: `cooperativeId`, signed `points`, `reason`.
- FAQ: `question`, `answer`, `category`, `isPublic`, `displayStatus`, `order`.
- 회원 거절/비활성: `reason`; 승인/재활성은 body 없음.
- 운영자: `name`, `email`, optional `password`, `position`, `duty`, `status`.
- 견적 접수 수정: `status`, `assignedTo`, `quoteCount`, `expectedUpdatedAt`.

위 key, endpoint, collection, 계산·검증은 CMS에서 편집할 수 없게 해야 한다. CMS는 대응하는 label, placeholder, 도움말, 안전한 상태 문구와 개발자가 허용한 선택지 label만 관리한다.

## 9. 디자인 시스템 기준선

### token

- blue 50~700, gray 50~900.
- semantic: primary/strong/soft/tint, background, border, text 1~4, leaf, danger, warning.
- shadow 4종, radius 6단계, content max width, responsive page padding, Pretendard font stack.
- 문제: 파일 중간에 두 번째 `:root`가 같은 token 일부를 다시 정의한다. 실제 최종값은 CSS cascade상 뒤의 선언이며, 앞부분만 보고 디자인 값을 판단하면 틀릴 수 있다.

### typography와 font

- Pretendard Variable을 jsDelivr 외부 `@import`로 로드한다.
- body 16px/1.6에서 시작하고 각 화면 class에 다수의 직접 font-size/weight/letter-spacing이 있다.
- typed typography scale은 없다.

### responsive

- 주요 breakpoint: 1180/1120/1100/1080/880/820/720/560/480px.
- 동일 의미의 breakpoint가 화면군별로 반복되어 PC/tablet/mobile token 체계가 아니다.
- `prefers-reduced-motion` 대응이 일부 존재한다.

### CMS 전환 원칙

- 자유 CSS를 저장하지 않고 승인된 token ID와 범위형 값만 허용한다.
- global theme와 page/section override를 분리한다.
- 현재 CSS의 실제 computed 기준을 먼저 canonical token으로 정리한 뒤 CMS theme schema를 연결한다.
- event/admin/member/auth의 시각 변형은 preset으로 유지하고 관리자가 임의 class name을 입력하게 하지 않는다.

## 10. 운영 화면 대조

- `/`: 배포된 hero, 소개, 전문성, 지원분야, 상담흐름, 상담사례, FAQ loading shell이 현재 소스와 일치했다.
- `/events/audit-quote`: 공개 intake가 enabled 상태이고 form, 혜택, 단계, FAQ, 면책이 소스와 일치했다.
- `/admin`: 비로그인 HTML은 “관리자 콘솔 준비” loading shell만 노출한다.
- `/mypage`: 비로그인 HTML은 “마이페이지 준비” loading shell만 노출한다.
- `/faq`, `/inquiries`: 초기 HTML은 0건/loading이며 client hydration 후 API 결과로 바뀌는 구조다.
- `/partner`: 인증 없이 sample queue, 조직 wallet, 성과와 내부 리스크 문구가 전부 공개되는 것이 운영에서도 확인됐다.
- `/login`, `/signup`, `/consult`, `/support`, `/pending-approval`의 공개 HTML은 현재 소스의 form/안내와 일치했다.
- 공개 운영 화면 확인만 수행했으며 데이터 제출 버튼은 누르지 않았다.

## 11. 검증 기준선

문서 작성 전 기존 working tree에는 사용자 변경으로 보이는 `components/SignupForm.tsx` 수정과 규칙 파일의 untracked 상태가 있었다. 이 조사에서는 해당 파일을 수정하지 않았다.

### typecheck

- 명령: `npm run typecheck`
- 결과: 성공, 오류 0.

### lint

- 명령: `npm run lint`
- 결과: 성공, 오류 0, 기존 warning 1.
- warning: `app/api/consult/route.ts`의 `getInquiryCategoryLabel` 미사용 import.

### test

- 명령: `npm run test:audit-quote`
- 결과: 29 tests passed, fail 0, skipped 1.
- skip: Firebase Emulator host가 없어 live rules assertion 미실행. static rules contract는 통과.
- 기존 warning: TypeScript test의 module type 미지정, Node `punycode` deprecation.
- 전체 member/admin/CMS E2E test script는 package에 없다.

### production build

- 명령: `npm run build`
- 결과: 성공.
- compile, TypeScript, static generation 모두 성공.
- Next.js route manifest에서 화면 13개와 API 27개가 확인됐다.

## 12. 기준선 결론

현재 시스템은 FAQ에 한정된 운영 편집과 일부 코드 fallback을 갖고 있지만 프로젝트 규칙이 요구하는 페이지 CMS는 없다. CMS 구현 전에 다음을 선행 조건으로 본다.

1. Firestore self-write와 organization/ledger rules를 잠가 승인·포인트 무결성을 회복한다.
2. admin 판정을 custom claim 기반으로 통일하고 shared credential 경로와 노출 문구를 제거한다.
3. 공개 `/partner` prototype을 격리한다.
4. FAQ GET 자동 seed를 제거하고 명시적·안전한 migration 절차로 바꾼다.
5. 기존 payload, collection, point transaction과 visibility ACL의 회귀 test를 추가한 뒤 CMS loader를 도입한다.
