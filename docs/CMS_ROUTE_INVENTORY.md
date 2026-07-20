# CMS route inventory

조사 기준일: 2026-07-21  
규칙 기준: `NH_PREGO_SOFTCODING_RULES.md`  
범위: Next.js App Router의 화면·API 전체, 공통 레이아웃, 클라이언트 탭·모달·모바일 메뉴

전체 CMS·관리자 콘솔의 최종 검증 결과, 실행 명령, 사람 확인 항목과 배포 순서는 `docs/CMS_FULL_VERIFICATION.md`를 기준으로 한다.

## 조사 기준과 표기

- 아래 `pageKey`는 `lib/cms/constants.ts`와 CMS 문서에서 사용하는 안정적 식별자다.
- `CMS 전환 대상`은 사용자에게 표시되는 콘텐츠와 허용된 디자인 값만 뜻한다. 인증, 권한, 내부 field name, 저장 키, API 경로, 계산식, 보안 제한은 편집 대상이 아니다.
- 운영 URL의 공개·비로그인 응답과 로컬 소스를 대조했다. 인증 계정이 필요한 운영 화면은 계정정보를 명령·파일·로그에 남기지 않는 조건 때문에 자동화하지 않았고, 동일 화면의 소스와 보호 API를 기준으로 조사했다.
- 전환 전에는 별도 route-level 상태 파일이 없었으며, 현재는 CMS 게시본을 사용하는 `app/not-found.tsx`를 추가했다. 모든 화면은 루트 `app/layout.tsx`의 공통 영역을 공유한다.
- 아래 기존 화면·API 표는 전환 전 기준선과 보호 계약을 보존한 기록이다. 현재 완료 상태는 문서 하단 `전체 사용자 화면 CMS 전환 완료`를 기준으로 판단한다.

## 화면 라우트

| pageKey | URL 또는 route pattern | 접근 권한 | 관련 코드 | 화면 구성 | 하드코딩 콘텐츠 | CMS 전환 대상 | 보호해야 할 기능 | 로딩·성공·오류·빈 상태 | 관리자 편집 화면 필요 여부 |
|---|---|---|---|---|---|---|---|---|---|
| `home` | `/` 및 `/#about`, `#expertise`, `#services`, `#process`, `#faq` | guest/member/admin 모두 | `app/page.tsx`; `components/{Topbar,Hero,About,Expertise,Services,Process,CaseStudies,FAQ,Footer}.tsx`; `lib/platform.ts` | 공통 헤더, hero/KPI, 소개, 전문성, 9개 지원분야, 4단계 상담흐름, 공개범위 사례, FAQ, 푸터 | 거의 모든 제목·본문·KPI·카드·CTA·내비·푸터. 지원분야 기본값과 1,109개 농협 마스터도 코드 상수 | SEO, hero, KPI, 섹션 순서/노출, 카드/서비스/사례/FAQ 표시, CTA, 이미지·alt, 페이지 theme override | auth별 CTA 목적지, 문의 공개범위, 서비스 안정 ID, FAQ 공개 필터, 농협 마스터·포인트 정책 | FAQ 로딩, Firestore 실패 시 기본 FAQ 안내. FAQ 자체 빈 상태는 기본값으로 대체 | 필요. `home` 페이지 편집기와 `global.header`, `global.footer` |
| `auth.login` | `/login` | guest 중심; 로그인 상태도 접근 가능 | `app/login/page.tsx`; `components/LoginForm.tsx` | 로그인, 자동 로그인, 비밀번호 표시, 아이디 찾기/비밀번호 재설정 접이 패널 | SEO, hero, label/placeholder/help/error/success/loading 문구 전체 | 안내·label·placeholder·안전한 오류/성공 문구, SEO, 레이아웃 token | 이메일/비밀번호 field, Firebase persistence/sign-in/reset, 관리자 인증 분기·endpoint, rate limit | 제출 중, Firebase 오류, 계정 찾기 성공/실패, 재설정 성공/실패. 로그인 성공은 role/status에 따라 redirect | 필요. 단 인증 로직·관리자 식별값은 편집 금지 |
| `auth.signup` | `/signup` | guest; 가입 도중 Firebase phone/email 사용자 | `app/signup/page.tsx`; `components/SignupForm.tsx`; `lib/platform.ts` | 기본정보, 휴대폰 인증, 이메일 중복확인, 농협 자동완성, 담당자, 명함 업로드, 필수/선택 동의, 혜택 | 단계명, 모든 label/placeholder/help/validation, 담당업무 표시값, 혜택 문구, 파일 안내 | 표시 문구, 선택지의 label, 안전 범위, 도움말, 동의문 본문/버전 연결, 디자인 | 내부 form key/payload, 필수 동의 여부, 인증 TTL, 비밀번호 정책, 농협 ID, upload 형식·10MB 제한, 지급 계산 | 인증번호 발송/확인/만료, 이메일 checking/available/duplicate/error, 농협 검색 empty, 파일 오류, submit loading/error. 별도 완료 화면 없이 `/login` 이동 | 필요. 법정 필수항목 숨김/삭제 금지 |
| `auth.pendingApproval` | `/pending-approval` | pending member 의도이나 URL 자체는 공개 | `app/pending-approval/page.tsx`; 공통 헤더/푸터 | 승인 대기 설명과 로그인 CTA | SEO와 화면 문구 전체 | 제목·안내·CTA·SEO·디자인 | 실제 승인 상태와 redirect 정책 | 정적 안내만 존재 | 필요 |
| `public.consult` | `/consult`; 후속문의 query `?parentRequestId=...&subject=...` | 화면은 공개, 제출은 active member token 필요 | `app/consult/page.tsx`; `components/{ConsultSteps,ConsultForm}.tsx`; `app/api/consult/route.ts` | 4단계 안내, 분야/공개범위 선택, 제목/내용, 사진 최대 6장, 제출 성공 카드 | SEO, 단계·label·선택지 표시값·placeholder·제한/오류/성공 문구 | 표시 콘텐츠, 단계, 선택지 label/설명, 업로드 도움말, 성공/오류 문구, SEO/theme | `category`/`visibility` 저장값, max 2,000자, image/10MB/6개, token·소속 검증, `parentRequestId`, 저장 collection | 등록 중, 인증/검증/파일/네트워크 오류, 접수 성공·접수번호, 후속문의 notice. 초기 empty form | 필요 |
| `public.inquiries` | `/inquiries` | guest는 public, member는 public+동일 농협+본인 | `app/inquiries/page.tsx`; `components/InquiryBoard.tsx`; `app/api/inquiries/route.ts` | hero, 검색, guest/member별 필터, `<details>` 목록·답변/잠금 | SEO/hero, 필터·검색·상태·잠금·empty/error 문구 | hero/SEO, 표시 label·설명·상태 문구·빈/오류 문구, 스타일 | 서버의 공개범위 ACL, 본문/답변 마스킹, org/uid 비교 | 목록 loading/error/empty, 답변 없음, 권한 잠금, guest 로그인 CTA | 필요 |
| `public.faq` | `/faq` | 공개 | `app/faq/page.tsx`; `components/FaqBoard.tsx`; `app/api/faqs/route.ts`; `lib/default-faqs.ts` | hero, 카테고리/검색, FAQ accordion | SEO/hero/검색·상태 문구. FAQ는 Firestore 또는 코드 fallback | hero/SEO, FAQ 콘텐츠·순서·공개상태, 상태 문구·디자인 | published/public 필터, fallback 검증, 안정 ID, sanitize 정책 | loading, API 실패 시 fallback+경고, 검색 empty | 기존 FAQ 편집기 확장 필요 |
| `event.auditQuote` | `/events/audit-quote` | 공개 이벤트 | `app/events/audit-quote/page.tsx`; `components/AuditQuoteEventPage.tsx`; `lib/audit-quote/*` | hero, 3필드 intake, 필수/선택 동의, 혜택, 3단계, FAQ, 면책 | SEO, hero, benefits/steps/FAQ/면책/폼 문구. 일부 운영값만 env | 페이지 전 콘텐츠·SEO·섹션 순서/노출·안전한 이벤트 on/off·종료문구·theme | 이메일 도메인 검증, payload key, idempotency, honeypot, origin/body/rate/dedupe/HMAC, 법적 필수 동의 | event closed, field error, submit, API/network error, success+public reference | 필요. 이벤트 전용 편집기 및 법적 문구 잠금 |
| `member.mypage` | `/mypage`; 탭 query `?tab=overview|inquiries|points|profile` | active member; 미로그인→login, pending→pending | `app/mypage/page.tsx`; `components/MyPageDashboard.tsx`; `/api/me/overview`, `/api/me/consents` | 사이드바 4탭, KPI, 문의/포인트 표, 프로필, 선택 수신 토글, toast | 탭명·설명, KPI/표/empty/help/status/consent 문구와 디자인 | 화면 문구·label·empty/error, 탭 표시명/순서(필수 기능 유지), theme | token/status, org wallet 계산, 개인정보, ledger, 필수동의 lock, consent payload | 전체 loading/error/retry, refresh/saving toast, profile incomplete, 문의/ledger empty | 필요. member 전용 preview 데이터 fixture 필요 |
| `member.requestDetail` | `/mypage/requests/[requestId]` | 요청을 볼 수 있는 active member; 현재 UI는 자신의 overview 목록 안에서만 찾음 | `app/mypage/requests/[requestId]/page.tsx`; `components/RequestDetailPage.tsx`; member answer/rating/complete API | 문의·첨부, 답변 paywall, 후속 액션, 평가, 완료, 열람/완료 확인 모달 | 모든 label/help/status/error/modal 문구 | 표시 문구, 포인트 안내·성공/오류, 섹션 제목, theme | request ID/ACL, point 차감 transaction, 중복 차감 방지, 평가/완료 순서, payload | loading/error/not-found·권한없음, 답변 준비/본문 없음, 부족 포인트, view/rating/complete loading·success/error, 2개 확인 모달 | 필요. 기능별 문구와 잠금 가능한 법정/결제성 안내 |
| `public.support` | `/support` | 공개 | `app/support/page.tsx`; 공통 헤더/푸터 | 고객지원 안내, consult/mypage CTA | SEO와 화면 문구 전체 | 전부(연락처·운영시간·채널을 공통 CMS로 분리) | CTA 목적지 allowlist | 정적 안내만 존재 | 필요; `global.support` 권장 |
| `partner.portalPrototype` | `/partner` | 현재 공개. 의도상 partner 전용이어야 함 | `app/partner/page.tsx`; `lib/platform.ts` | KPI, 배정 queue, 조직 지갑, 답변 form, 성과/리스크 카드 | 샘플 농협·문의·포인트·성과·내부 운영정책 전체 | 공개 CMS로 전환하기 전 라우트 격리/폐기 여부 결정. 실제 partner 화면의 도움말만 CMS | partner 인증/배정 ACL, 실제 문의/지갑/PII, 답변 field/payload, 계산식 | 실데이터 loading/error/empty/permission 상태 없음. form submit도 없음 | 공개 CMS 편집보다 먼저 접근통제·제품범위 결정 필요 |
| `admin.console` | `/admin` | admin 의도. 클라이언트는 특정 이메일 또는 custom claim, API도 동일 조건 | `app/admin/page.tsx`; `components/{AdminDashboard,AdminAuditQuotesPanel}.tsx`; admin API | 6개 주탭: Overview, Members, Inquiries, Audit quotes, Points, Audit log. 회원/운영자 및 문의/FAQ subtabs. 다수 상세·확인·편집 modal | 탭/지표/표/필터/도움말/상태/모달/토스트 문구와 일부 내부 개발용 용어 | CMS 편집기 shell의 공통 help/label/theme. 기존 운영 기능의 표시 문구는 CMS schema와 분리 관리 | custom claim 기반 권한, PII, 회원/운영자/답변/포인트/견적 상태 전이, 감사로그, 내부 field/API | auth loading, denied, data error/retry, refresh; 각 표 empty; 상세 loading/error; mutation success/error/conflict; modal confirm; FAQ draft/published | CMS 편집 화면의 호스트. 기존 운영 탭은 보호 |
| `framework.notFound` | `/_not-found` 및 미등록 URL | 공개 | Next.js 자동 생성; 커스텀 파일 없음 | 기본 404 | 프레임워크 기본 문구/스타일 | 커스텀 404 콘텐츠·SEO | status code 404 | not-found 단일 상태 | 필요 |

## API 라우트

API에는 사용자 화면이 없으므로 `화면 구성` 열에는 endpoint 역할을 기록한다. API 오류 code와 내부 저장 키는 코드에서 보호하고, 그에 대응하는 사용자 표시 문구만 페이지 CMS에 둔다.

| pageKey | URL 또는 route pattern | 접근 권한 | 관련 코드 | 화면 구성 | 하드코딩 콘텐츠 | CMS 전환 대상 | 보호해야 할 기능 | 로딩·성공·오류·빈 상태 | 관리자 편집 화면 필요 여부 |
|---|---|---|---|---|---|---|---|---|---|
| `api.auth.adminLogin` | `POST /api/auth/admin-login` | 현재 shared credential를 아는 guest | `app/api/auth/admin-login/route.ts`; `lib/firebase/admin.ts` | 관리자 Firebase user 생성/claim 설정/custom token 발급 | error code, 관리자 기본 identity 및 credential fallback | 없음 | credential/claim 발급, rate limit, 감사·경보. 즉시 보안 재설계 대상 | 200 token; 400 invalid JSON; 401 invalid credentials | 아니오 |
| `api.auth.checkEmail` | `POST /api/auth/check-email` | 공개 | `app/api/auth/check-email/route.ts` | Auth와 `users` 중복조회 | error code | 없음 | 이메일 정규화, enumeration/rate limit | available true/false, validation/server error | 아니오 |
| `api.auth.findEmail` | `POST /api/auth/find-email` | 공개 | `app/api/auth/find-email/route.ts` | 이름+전화로 마스킹 이메일 조회 | error code | 없음 | account enumeration, phone normalization, rate limit, 마스킹 | match/no-match/invalid phone | 아니오 |
| `api.signup` | `POST /api/signup` | 유효 email token + phone token | `app/api/signup/route.ts`; `lib/firebase/schema.ts`; `lib/platform.ts` | `users`, 승인 전 프로필 저장 및 가입 정책 처리 | error code, 포인트 정책 참조 | 화면 문구만 `/signup` CMS | payload key, token 일치, phone 계정 제한, cooperative ID, transaction, 지급 정책 | validation/auth/conflict/transaction success/error | 아니오 |
| `api.consult.create` | `POST /api/consult` | 로그인 active member | `app/api/consult/route.ts` | multipart 문의·첨부 저장, 후속문의 연결 | error code | 화면 문구만 `/consult` CMS | `subject`, `message`, `visibility`, `category`, `consent`, `parentRequestId`, attachments key와 제한, ACL | 201 접수번호; auth/profile/validation/upload/server error | 아니오 |
| `api.inquiries.list` | `GET /api/inquiries` | guest optional bearer; 반환 범위 차등 | `app/api/inquiries/route.ts` | public/member 게시판 projection | 표시용 상태/권한 notice 일부를 API가 생성 | notice/label을 typed presentation map으로 이동 가능 | visibility ACL, PII/본문/답변 projection | 목록 또는 error; 빈 배열 정상 | 아니오 |
| `api.faqs.public` | `GET /api/faqs` | 공개 | `app/api/faqs/route.ts`; `lib/default-faqs.ts` | published+public FAQ 반환 | error code; 현재 GET이 DB가 비면 default를 쓰기 저장 | 없음; fallback은 코드 기본값 | 공개 필터. GET의 운영 데이터 자동 seed 제거 필요 | 목록/500; 클라이언트 fallback | 아니오 |
| `api.me.status` | `GET /api/me/status` | bearer member | `app/api/me/status/route.ts` | 현재 회원 status 반환 | error code | 없음 | token/uid와 server status | active/pending/rejected, auth/not-found | 아니오 |
| `api.me.overview` | `GET /api/me/overview` | active bearer member | `app/api/me/overview/route.ts` | user/org/허용 문의·답변/view/rating/ledger 집계 | error code | 없음 | canReadRequest ACL, PII, organization/ledger projection | profileIncomplete, approval_pending, auth/server error | 아니오 |
| `api.me.consents` | `PATCH /api/me/consents` | bearer member | `app/api/me/consents/route.ts` | 선택 수신 동의 갱신 | error code | 없음 | 허용 key만 변경, 필수동의 불변, actor/시간 | success/validation/auth/not-found | 아니오 |
| `api.me.answerView` | `POST /api/me/answers/[requestId]/view` | 요청 열람 가능한 active member | `app/api/me/answers/[requestId]/view/route.ts` | answer 공개와 조직 지갑 차감 transaction | error code | 화면 문구만 request detail CMS | ACL, point 범위/잔액, org 1회 차감과 user view, ledger/transaction/audit | success, insufficient points, already viewed, missing answer/request, auth | 아니오 |
| `api.me.answerRating` | `POST /api/me/answers/[requestId]/rating` | 답변을 열람한 member | `app/api/me/answers/[requestId]/rating/route.ts` | score/helpful/comment upsert | error code | 화면 문구만 request detail CMS | score 범위, view 선행, uid, audit | create/update success, validation/auth/not-viewed | 아니오 |
| `api.me.requestComplete` | `POST /api/me/requests/[requestId]/complete` | 요청 소유 member | `app/api/me/requests/[requestId]/complete/route.ts` | 문의 완료 상태 전이 | error code | 화면 문구만 request detail CMS | 소유권, answer view+rating 선행, 허용 상태전이, audit | success/already complete/prerequisite/auth/not-found | 아니오 |
| `api.auditQuote.create` | `POST /api/audit-quote/requests` | 공개, event flag·origin guard | `app/api/audit-quote/requests/route.ts`; `lib/audit-quote/{submit,security,config}.ts` | 이벤트 intake | public error code | 화면 오류 문구만 event CMS | payload, required consent/version, Idempotency-Key, honeypot, HMAC, dedupe/rate/origin/body size | 동일 shape 성공/중복, validation/rate/disabled/server error | 아니오 |
| `api.admin.overview` | `GET /api/admin/overview` | admin | `app/api/admin/overview/route.ts`; `lib/firebase/server.ts` | 9개 운영 collection 전체 조회 | error code | 없음 | admin claim, PII, query 규모/최소 projection | data success/auth/server error | 아니오 |
| `api.admin.faqs` | `GET, POST /api/admin/faqs` | admin | `app/api/admin/faqs/route.ts` | FAQ 목록/생성 | validation/error code | FAQ editor가 사용 | question/answer/category/public/status/order key, actor/audit | list/create success, auth/validation/error | 기존 화면 유지·CMS에 통합 |
| `api.admin.faq` | `PATCH, DELETE /api/admin/faqs/[faqId]` | admin | `app/api/admin/faqs/[faqId]/route.ts` | FAQ 수정/삭제 | validation/error code | FAQ editor가 사용 | field allowlist, stable ID, delete 정책, audit | success/not-found/auth/validation/error | 기존 화면 유지; 삭제는 복구형으로 개선 |
| `api.admin.answer` | `POST /api/admin/requests/[requestId]/answer` | admin | `app/api/admin/requests/[requestId]/answer/route.ts` | 문의 분류/담당/포인트/답변 저장 | error code | 화면 문구만 admin presentation config | `internalCategory`, `adminTags`, `pointCost`, `answerBody`, 범위, 상태, audit | success/auth/validation/not-found/error | 아니오 |
| `api.admin.userApprove` | `POST /api/admin/users/[uid]/approve` | admin | `app/api/admin/users/[uid]/approve/route.ts` | 승인/재활성, org wallet/가입 포인트 transaction | error code | 없음 | 상태전이, cooperative ID, 중복지급 방지, ledger/transaction/audit | approve/reactivate/noop, missing org/user, auth/error | 아니오 |
| `api.admin.userReject` | `POST /api/admin/users/[uid]/reject` | admin | `app/api/admin/users/[uid]/reject/route.ts` | 거절/비활성화와 사유 기록 | error code | 없음 | 상태전이, reason, self/protected user 정책, audit | reject/deactivate/noop, auth/not-found/error | 아니오 |
| `api.admin.businessCard` | `GET /api/admin/users/[uid]/business-card` | admin | `app/api/admin/users/[uid]/business-card/route.ts` | 보호된 명함 URL 해석 | error code | 없음 | PII, storage path/bucket, signed URL/권한 | url/no attachment/not-found/auth/error | 아니오 |
| `api.admin.operators` | `POST /api/admin/operators` | admin | `app/api/admin/operators/route.ts` | 운영자 Auth user+Firestore profile 생성 | error code | 없음 | password, custom claim, role/status, 중복, audit | success/auth/validation/conflict/error | 아니오 |
| `api.admin.operator` | `PATCH, DELETE /api/admin/operators/[uid]` | admin | `app/api/admin/operators/[uid]/route.ts` | 운영자 정보/비밀번호/권한 변경·삭제 | error code | 없음 | self/기본 관리자 보호, claim 동기화, irreversible delete, audit | success/protected/not-found/auth/validation/error | 아니오 |
| `api.admin.pointsAdjust` | `POST /api/admin/points/adjust` | admin | `app/api/admin/points/adjust/route.ts` | org wallet 수동 증감, 2개 원장 기록 | error code | 없음 | signed integer/reason, 음수잔액 금지, atomic transaction, audit | success/auth/validation/not-found/conflict/error | 아니오 |
| `api.admin.auditQuotes` | `GET /api/admin/audit-quotes` | admin | `app/api/admin/audit-quotes/route.ts`; `lib/audit-quote/admin.ts` | 상태 필터 목록·received count | error code | 필터 표시 label만 admin UI | admin claim, 목록 이메일 마스킹, query limit/index | list/empty/auth/error | 아니오 |
| `api.admin.auditQuote` | `GET, PATCH /api/admin/audit-quotes/[requestId]` | admin | `app/api/admin/audit-quotes/[requestId]/route.ts` | 원문 상세, status/assignee/quoteCount 갱신 | error code | 상태 표시 label만 admin UI | PII, 허용 상태전이, count 범위, optimistic conflict, audit | detail/save success, conflict, invalid transition, not-found/auth | 아니오 |
| `api.admin.auditQuoteNotifyRetry` | `POST /api/admin/audit-quotes/[requestId]/notify-retry` | admin | `app/api/admin/audit-quotes/[requestId]/notify-retry/route.ts`; `lib/audit-quote/notify.ts` | 알림 재시도 | error code | 없음 | admin claim, retry/dedupe, PII 비로그, audit | success/status+attempts, not-found/auth/send error | 아니오 |

## 클라이언트 내부 화면 상태와 오버레이

- 공통 모바일 메뉴: `Topbar`의 hamburger와 `.nav-mobile`; auth 준비 전 CTA 비활성.
- accordion/details: 홈 FAQ, FAQ 게시판, 문의 게시판, 이벤트 FAQ.
- 로그인 접이 패널: 아이디 찾기, 비밀번호 찾기.
- 회원가입 동적 패널: 휴대폰 인증번호, 농협 검색 결과/empty, 파일 미리보기, 동의 그룹.
- 마이페이지 탭: `overview`, `inquiries`, `points`, `profile`.
- 관리자 탭: `overview`, `members`, `inquiries`, `auditQuotes`, `points`, `audit`.
- 관리자 subtabs: 회원/운영자, 문의/FAQ.
- 문의 상세 modal: 답변 포인트 차감 확인, 문의 완료 확인.
- 관리자 modal: 회원 승인·거절·비활성·재활성, 운영자 생성/편집, 포인트 조정 확인, 전체 거래, 문의/답변 상세, 고객평가, FAQ 생성/편집.
- 브라우저 native confirm/prompt: 운영자 권한 변경, 임시 비밀번호, 운영자 삭제. CMS 구현 시 접근 가능한 앱 modal로 교체할 대상이다.

## 권한별 화면 차이

- guest: 홈 헤더에 회원가입/로그인, 상담 CTA는 `/login`; 문의 게시판은 public만 상세 열람; `/consult` UI는 볼 수 있으나 제출 시 차단.
- pending/rejected member: 로그인 후 상태 API 결과에 따라 `/pending-approval`; 서버의 active 확인이 필요한 API는 거부.
- active member: 헤더에 마이페이지; 문의 작성, 본인/동일 농협 공개범위, 마이페이지·포인트·답변 열람/평가/완료.
- admin: `/admin` 운영 콘솔과 admin API. 현재 custom claim 외에 이메일 문자열도 우회 조건으로 사용한다.
- partner: 실제 인증/ACL 구현이 없다. `/partner`는 공개 정적 prototype이다.

## 라우팅상 주요 결론

1. URL 수준 보호는 middleware가 아니라 각 클라이언트 컴포넌트 redirect와 각 API의 bearer 검증에 의존한다.
2. 관리자 판정은 이후 구현에서 Firebase `admin` custom claim으로 통일했고 이메일 문자열 fallback과 공유 관리자 로그인 endpoint를 비활성화했다.
3. `/partner`는 내부 정책과 샘플 운영정보를 공개하므로 CMS 전환 전에 접근 차단 또는 제거가 선행되어야 한다.
4. 별도 route-level loading/error/not-found 파일이 없어 초기 HTML은 client loading shell이며, 인증 후 오류는 컴포넌트 내부 상태로만 처리한다.
5. 현재 CMS pageKey는 17개이며 `/terms`, `/privacy`, 관리자 운영 분리와 커스텀 404를 포함한다. CMS 자체 편집 도구 route는 pageKey 수에 중복 포함하지 않는다.

## 관리자 콘솔 구현 반영

2026-07-20 CMS 관리자 콘솔 구현으로 다음 route가 추가·분리되었다.

- `/admin`: 콘텐츠 대시보드, 페이지 관리, 공통 영역, 디자인 설정, 이미지·파일, 수정·게시 이력
- `/admin/operations`: 기존 회원·상담·포인트 운영 기능
- `/admin/pages/[pageKey]`: 관리자 전용 3영역 페이지 편집기와 초안 미리보기
- `GET /api/admin/cms/overview`: 관리자 전용 CMS 운영 요약과 페이지 목록
- `GET, PATCH /api/admin/cms/pages/[pageKey]`: 관리자 전용 편집 데이터 조회와 초안 저장
- `POST /api/admin/cms/pages/[pageKey]/publish`: 관리자 전용 페이지 게시
- `POST /api/admin/cms/pages/[pageKey]/revisions/[revisionId]/restore`: 이전 게시본의 새 초안 복원
- `/admin/globals/[documentKey]`: 서비스 이름·로고, 상단 메뉴, 하단 정보, 고객지원 공통 영역 편집기
- `GET, PATCH /api/admin/cms/globals/[documentKey]`: 관리자 전용 공통 영역 조회와 초안 저장
- `POST /api/admin/cms/globals/[documentKey]/publish`: 관리자 전용 공통 영역 게시
- `POST /api/admin/cms/globals/[documentKey]/revisions/[revisionId]/restore`: 이전 공통 게시본의 새 초안 복원
- `POST /api/admin/cms/assets/finalize`: 관리자 업로드 파일의 서버 검증과 메타데이터 확정

`/admin`과 모든 CMS API는 Firebase `admin` custom claim을 각각 확인한다. CMS collection이 비어 있어도 페이지 목록과 편집기는 코드 기본값으로 표시하며 운영 Firebase에 자동 seed하지 않는다.

## 메인 화면과 공통 영역 연결 반영

2026-07-21 기준 `/`는 Server Component에서 검증된 `cmsPublishedPages/home` 게시본만 읽고, 문서가 없거나 사용할 수 없으면 운영 화면과 동일한 코드 기본값을 사용한다. 초안 collection은 공개 loader에서 참조하지 않는다.

- root layout은 `siteIdentity`, `header`, `footer`, `support` 게시본을 batch 조회해 모든 공통 컴포넌트에 공급한다.
- 메인 화면은 공개 화면과 관리자 미리보기에서 같은 `HomePageRenderer`와 기존 `Topbar`, `Hero`, `About`, `Expertise`, `Services`, `Process`, `CaseStudies`, `FAQ`, `Footer`를 사용한다.
- `Services`의 브라우저 localStorage 덮어쓰기를 제거해 서버 HTML과 hydration 이후 콘텐츠가 달라지는 경로를 없앴다.
- FAQ 미리보기는 메인 페이지 게시 snapshot에 포함되어 초기 client fetch에 따른 콘텐츠 이동 없이 렌더링한다.
- 로그인 상태에 따른 상담 목적지와 로그인·회원가입·마이페이지 분기는 기존 Firebase 인증 흐름을 유지한다.
- 공통 영역은 페이지 문서에 중복 저장하지 않으며, 메인 페이지의 명시적 `commonOverrides`가 있을 때만 상단·하단 표시를 페이지별로 다르게 처리한다.

## FY27 회계감사 견적 화면 연결 반영

2026-07-21 기준 `/events/audit-quote`는 Server Component에서 검증된 `cmsPublishedPages/event.auditQuote` 게시본만 읽는다. 게시본이 없거나 이전 구조이면 현재 운영 문구를 가진 코드 기본값으로 보완한다.

- 공개 화면과 관리자 미리보기는 같은 `AuditQuoteEventPage`를 사용한다.
- 페이지 배지·제목·설명, 폼 표시 문구, 모든 상태 안내, 혜택·단계·FAQ, 운영 주체·면책, SEO와 승인된 디자인을 페이지 초안에서 관리한다.
- `intakeForm`과 `legalNotice`는 필수 영역으로 저장·게시 검증에서도 숨김, 잠금 해제와 삭제를 거부한다.
- 법적 문구 변경은 게시 전 경고와 게시 버전 이력 표시에 반영한다.
- payload는 CMS를 입력으로 받지 않는 별도 builder로 고정했다. `email`, `name`, `phone`, 필수 동의, 정책 버전, source와 honeypot 구조는 기존 API 계약을 유지한다.
- 게시 시 `/events/audit-quote`만 revalidate하며, 이전 게시본 복원은 관리자 초안에만 반영된 뒤 명시적으로 재게시한다.

## 전체 사용자 화면 CMS 전환 완료

2026-07-21 기준 App Router의 사용자 노출 화면은 아래 17개 안정 `pageKey`로 관리한다. 모두 `/admin` 페이지 목록에 업무용 한국어 이름, 실제 URL, 대상 사용자와 게시 상태가 표시되며 `/admin/pages/[pageKey]`에서 같은 실제 렌더러로 PC·태블릿·모바일 초안을 확인한다.

- 공개·공통: `home`, `public.consult`, `public.inquiries`, `public.faq`, `public.support`, `event.auditQuote`
- 로그인·가입·법적 안내: `auth.login`, `auth.signup`, `auth.pendingApproval`, `legal.terms`, `legal.privacy`
- 회원: `member.mypage`, `member.requestDetail`
- 관리자: `admin.console`, `admin.operations`
- 제한·시스템: `partner.portal`, `framework.notFound`

`/terms`, `/privacy`와 커스텀 `app/not-found.tsx`를 추가했다. 기존 푸터의 약관·개인정보 링크 기본값은 각각 `/terms`, `/privacy`를 가리킨다. 아이디 찾기와 비밀번호 재설정은 `auth.login`의 계정 찾기 영역으로, 모바일 메뉴는 `global.header`로, 문의 상세의 포인트 열람·평가·완료 확인 창과 관리자 운영 모달은 각각 해당 회원·관리자 pageKey로 관리한다.

### 라우트별 완료 상태와 보호 항목

- `/login`: 첫 안내, 로그인 필드, 비밀번호 보기, 자동 로그인, 회원가입 링크, 아이디 찾기·비밀번호 재설정의 입력·처리·성공·오류 문구와 SEO를 전환했다. Firebase persistence/sign-in/reset, 회원 상태 분기와 `/api/me/status`, `/api/auth/find-email`은 보호한다.
- `/signup`: 가입 단계, 모든 표시 라벨·placeholder·도움말·검증 문구, 농협 검색 상태, 명함 안내, 필수·선택 동의, 혜택과 SEO를 전환했다. email/phone 인증, 비밀번호 정책, 농협 master ID, form key, `/api/signup`, 파일 종류·10MB 제한과 필수 동의 여부는 보호한다.
- `/pending-approval`: 승인 대기 안내, CTA, 디자인과 SEO를 전환했다. 실제 회원 승인 상태와 로그인 redirect는 보호한다.
- `/terms`, `/privacy`: 전체 법적 문구, 시행일, 문의 링크, 디자인과 SEO를 전환했다. 모든 법적 영역은 표시·잠금을 강제하고 삭제·숨김을 게시 검증에서 차단한다. 기본 문구 변경은 경고와 게시 버전 이력에 기록한다.
- `/consult`: 단계, 분야·공개범위 표시 이름과 설명, 입력·첨부·후속문의·완료·오류 문구와 SEO를 전환했다. `category`, `visibility`, `subject`, `message`, `consent`, `parentRequestId`, `attachments` 값, 인증·소속 ACL, 개수·용량 제한과 `/api/consult`는 보호한다.
- `/inquiries`: guest/member 필터, 검색, 건수, 공개범위·상태 배지, 열람 제한, 답변·빈 화면·오류와 SEO를 전환했다. 공개범위 projection, 본문·답변 masking, uid/농협 비교와 `/api/inquiries`는 보호한다.
- `/faq`: 첫 안내, 유형·검색·빈 상태, 질문·답변·순서·노출과 SEO를 페이지 게시본으로 전환했다. 안정 ID와 공개 게시본 검증은 보호하며 공개 화면은 초기 HTML의 게시 snapshot을 사용해 로딩 이동을 만들지 않는다.
- `/support`: 첫 안내, 채널 CTA, 디자인과 SEO를 전환했다. CTA 주소는 안전한 내부·외부 링크 검증을 거친다.
- `/mypage`: 탭 표시 이름·순서, KPI·표·포인트·프로필·동의·toast·loading/error/empty 문구와 SEO를 전환했다. `overview|inquiries|points|profile` query 값, bearer/status/개인정보 projection, 포인트 집계와 동의 PATCH key는 보호한다.
- `/mypage/requests/[requestId]`: 문의·첨부·답변 paywall·후속 지원·평가·완료 및 두 확인 모달의 전체 표시 문구와 SEO를 전환했다. request ID/ACL, 조직 1회 차감 transaction, rating/complete 순서, API 주소와 payload는 보호한다.
- `/admin`: 콘텐츠 관리 메뉴·필터·지표·도움말·빈 상태·오류·게시 확인 창과 SEO를 `admin.console`로 전환했다. admin custom claim, CMS API, 초안/게시/이력 분리, optimistic conflict와 publish payload는 보호한다.
- `/admin/operations`: 회원·운영자·문의·FAQ·회계감사 견적·포인트·감사로그 탭, 표·필터·상세·toast·모달과 SEO를 `admin.operations`로 전환했다. 관리자 권한, PII, 상태 전이, 점수·포인트 계산, Firestore key와 모든 admin API payload는 보호한다. 기존 native `confirm`/`prompt`는 접근 가능한 앱 확인 창으로 교체했다.
- `/partner`: partner 인증과 배정 ACL이 아직 제품 범위에 없으므로 공개 샘플 운영정보를 제거했다. CMS에서는 잠긴 접근 안내와 안전한 CTA만 게시하며 실제 포털 데이터·폼은 노출하지 않는다.
- 미등록 URL: `framework.notFound` 게시본으로 404 제목·설명·CTA·디자인을 표시하며 HTTP 404 처리는 Next.js가 보호한다.

### 상태별·미리보기·저장 계약

- guest 미리보기는 로그인·가입·공개 게시판·FAQ·지원 화면의 공개 상태를 사용한다.
- member 미리보기는 개인식별정보가 아닌 고정 fixture로 마이페이지·문의 상세의 문의, 답변, 포인트, 평가와 모달 상태를 보여 준다.
- admin 미리보기는 고정 운영 fixture를 사용하며 인증, 네트워크 요청, 저장, 게시와 상태 변경을 실행하지 않는다.
- 공개 loader는 `cmsPublishedPages`만 읽고 페이지별 코드 기본값과 병합한다. 관리자 편집 loader만 `cmsDraftPages`와 revision을 읽는다.
- CMS 문구는 form/API payload builder의 입력으로 전달하지 않는다. 회귀 테스트가 로그인·가입·상담·회원·관리자 endpoint, 내부 field name, payload key와 권한 분기를 고정한다.

### 남은 미전환 화면

사용자에게 라우팅되는 화면 기준 미전환 항목은 없다. `/admin/pages/[pageKey]`와 `/admin/globals/[documentKey]`는 CMS 콘텐츠 자체가 아니라 보호된 편집 도구이므로 사용자 페이지 목록의 별도 편집 대상으로 중복 등록하지 않는다. `/partner`는 미전환이 아니라 인증·ACL 구현 전 의도적으로 기능을 차단한 상태다.

## 전체 CMS 재검증 반영

2026-07-21 재검증에서 중앙 등록부의 17개 사용자 화면과 2개 편집 도구
예외를 다시 대조했다.

- PC·태블릿·모바일 51개 browser 조합에서 HTTP 상태, 제목, 가로 넘침,
  입력 label, 버튼·링크 이름, hydration과 console 오류를 검사했다.
- guest는 공개 화면만 보고 member/admin route는 로그인 화면으로 이동했다.
  member/admin 실제 데이터 상태는 개인정보를 사용하지 않는 preview fixture와
  API·Rules contract test로 검증했다.
- 메인 제목, 모바일 글자 크기, 카드 순서, FAQ 추가, 이미지 참조, 초안,
  게시, 이력, 복원과 rollback을 하나의 통합 수명주기 test로 수행했다.
- 공통 영역 자동저장 중 이어서 입력한 변경이 누락될 수 있던 경쟁 상태를
  후속 저장 queue로 수정하고 복원 충돌을 별도 안내한다.
- 이미지와 상단 메뉴 삭제를 soft delete로 바꿔 새로고침·게시 이력 뒤에도
  복원할 수 있게 했다.
- 공개 `cmsAssets` metadata 읽기를 차단해 업로더 UID와 수명주기 정보는
  관리자에게만 보인다. 공개 화면은 서버가 해석한 게시 파일 URL만 받는다.
- 회원가입 명함은 정확한 JPEG·PNG·WebP·GIF·PDF 최초 생성만 허용하고
  client overwrite/delete를 차단한다.

## 신규 하드코딩 방지 강제 장치

`lib/cms/feature-registry.ts`의 `CMS_FEATURE_REGISTRY`가 사용자 화면별
key, 업무용 이름, route, 접근 권한, runtime/editor schema, 기본 콘텐츠,
보호 대상, 미리보기 renderer, 관리자 메뉴, fallback 테스트와 schemaVersion을
하나의 정의로 제공한다. `/admin` 페이지 목록과 편집기 미리보기도 이 등록부의
메타데이터를 사용한다.

`npm run cms:audit`는 `app/**/page.*`를 App Router 규칙으로 탐색해 등록부
route와 직접 비교한다. 문자열 검색에 의존하지 않으며 미등록 화면, 기본 콘텐츠,
runtime/editor schema, 보호 대상, 관리자 메뉴, 미리보기, fallback 테스트와
schemaVersion 누락을 실패로 처리한다. CMS 편집 도구 route 두 개의 예외는
`docs/CMS_ROUTE_EXCEPTIONS.json`에 담당자와 재검토일을 포함해 기록한다.

신규 기능 뼈대는 `npm run cms:create -- --key ... --name ... --route ... --access ...`
로 생성하며 상세 절차와 완료 체크리스트는 `docs/CMS_NEW_FEATURE_GUIDE.md`를
따른다. 같은 검사는 `.github/workflows/cms-guardrails.yml`에서 PR과 기본
브랜치 push마다 실행한다.
