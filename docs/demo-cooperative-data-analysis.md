# 업무 테스트용 농협 데이터 구조 분석

- 분석일: 2026-07-22
- 단계: STEP 1 — 읽기 전용 구조·관계 분석
- 분석 범위: 현재 `pregosuv` 작업 트리, Firestore/Storage rules, 최근 Git 이력
- 수행하지 않은 작업: 애플리케이션 기능 변경, Firebase/Firestore/Storage 접속·변경·삭제, 운영 데이터 조회

## 1. Executive Summary

현재 시스템은 농협 마스터 데이터(A)와 가입·사용 데이터(B)를 물리적으로 어느 정도 분리한다.

- A의 실제 권위 원본은 Firestore 컬렉션이 아니라 `lib/platform.ts`의 `nonghyupMaster` 정적 배열이다. 런타임에서 확인된 `cooperative_master` 컬렉션은 없다.
- B는 `users`, `organizations`, `pointLedger`, `point_transactions`, `consultRequests` 등 Firestore 최상위 컬렉션과 Firebase Auth, Firebase Storage에 분산되어 있다.
- `organizations/{cooperativeId}`는 농협 마스터 문서가 아니다. `walletBalance`, `users[]`를 가진 조직 지갑·구성원 집계 문서이므로 B에 해당한다.
- 별도 `tenant` 또는 `membership` 컬렉션은 없다. `users.cooperativeId`와 `organizations.users[]`가 사실상 소속 관계를 양방향으로 중복 저장한다.
- 농협이 이미 가입되었는지는 가입 차단 조건이 아니다. 동일 농협에 여러 사용자가 가입할 수 있고, 고객 사용 가능 여부는 `users/{uid}.status == "active"`로 판정한다.
- 농협 마스터의 `status`는 검색 화면이나 가입 API에서 필터링·검증하지 않는다.
- 현재 스키마에는 `isTest`, `isDemo`, `seeded`, `createdBySeed`, 테스트 실행 ID 같은 공통 식별 필드가 없다.
- 따라서 A를 보존한 채 B를 초기화하는 것은 구조적으로 가능하지만, 기존 운영 데이터에서 “테스트 B”를 안전하게 선별하는 것은 현재 정보만으로 불가능하다. 먼저 정확한 UID·문서 ID·Storage 경로로 구성된 삭제 manifest가 필요하다.
- 가장 큰 위험은 이름·이메일 패턴으로 테스트 데이터를 추정하여 실제 고객 B를 함께 삭제하는 것이다. 다음 위험은 Firestore, Auth, Storage 사이에 원자적 트랜잭션이 없어 부분 실패 시 잔존 계정·파일·원장 불일치가 생기는 것이다.

근거:

- 마스터 타입·ID·배열: `lib/platform.ts:212-246`, `lib/platform.ts:247-1358`
- 가입 API의 마스터 조회: `app/api/signup/route.ts:120-133`
- 조직·포인트 스키마: `lib/firebase/schema.ts:148-205`
- 승인 시 조직 생성: `app/api/admin/users/[uid]/approve/route.ts:62-130`
- 활성 회원 판정: `lib/firebase/server.ts:220-240`

### 분석 한계

이번 단계에서는 Firebase 프로젝트에 접속하지 않았다. 그러므로 아래의 “더미데이터 후보”는 코드가 생성할 수 있는 패턴이지, 운영 Firestore/Auth/Storage에 해당 레코드가 실제 존재한다는 확인 결과가 아니다. 이름 또는 이메일만으로 삭제 대상을 확정해서는 안 된다.

## 2. 농협 마스터 데이터 구조

### 권위 원본과 컬렉션명

- 런타임 권위 원본: `lib/platform.ts`의 `nonghyupMaster`
- 런타임 Firestore 농협 마스터 컬렉션: 확인되지 않음
- `cooperative_master`는 `lib/platform.ts:1820-1825`의 설계 설명 문자열에만 존재하며 실제 컬렉션 접근 코드는 없다.
- Firestore `organizations`는 마스터가 아니라 B이다.

### 문서 ID 또는 고유키

- 마스터 고유키: `cooperative_id`
- 생성 방식: `buildCoop(id, ...)`가 `coop-${String(id).padStart(3, "0")}`를 생성한다.
- 현재 범위: `coop-001`부터 `coop-1109`
- 총계 상수: `cooperativeMasterTotal = 1109`
- 근거: `lib/platform.ts:228-245`, `lib/platform.ts:1357`

### 보유 필드

`CooperativeRecord`는 다음 필드를 가진다.

- `cooperative_id`
- `cooperative_name`
- `cooperative_type`: `지역농협 | 축협 | 품목농협`
- `sido`
- `sigungu`
- `address`
- `status`: `active | pending`
- `source`
- `updated_at`

근거: `lib/platform.ts:212-245`

현재 구현에는 연락처, 자산 규모, 실제 도로명 주소, 고객 계정 ID, owner UID가 없다. 모든 항목은 기본적으로 `status: "active"`이고 명시적으로 `pending`을 넘기는 `buildCoop` 호출은 검색되지 않았다. `sido`가 대부분 `"전국"`, `sigungu`가 빈 문자열이므로 지역·주소 정보도 상세 마스터로 보기에는 제한적이다.

### 실제 농협과 테스트 농협 구분

- `isTest`, `isDemo`, `dataPurpose`, `environment` 필드 없음
- `source`는 모든 항목에 `"전국 농협 마스터"`가 들어간다.
- 테스트 농협 전용 타입이나 코드 범위 없음

### 가입 가능 여부와 가입 완료 여부

- 마스터의 `status` 필드는 가입 가능 여부 판정에 사용되지 않는다.
- UI는 `nonghyupMaster` 전체를 이름 또는 지역 문자열로 필터링한다: `components/SignupForm.tsx:356-375`
- API는 `cooperative_id` 존재만 검사한다: `app/api/signup/route.ts:125-133`
- 가입 완료는 마스터가 아니라 `users.status`가 결정한다.

### 계정 연결 필드

마스터 A 자체에는 계정 연결 필드가 없다. B에서 다음 필드를 사용한다.

- `users/{uid}.cooperativeId`
- `users/{uid}.nh_org_id` — 현재는 `cooperativeId`와 동일 값
- `users/{uid}.cooperativeName` — 이름 snapshot
- `organizations/{cooperativeId}.cooperativeId`
- `organizations/{cooperativeId}.users[]` — Firebase UID 배열

근거: `app/api/signup/route.ts:171-223`, `app/api/admin/users/[uid]/approve/route.ts:62-86`

### 농협 선택·검색 방식

- 별도 검색 API 없음
- 서버 컴포넌트 `app/signup/page.tsx`가 `SignupPageRenderer`를 렌더링하고, 실제 폼은 클라이언트에서 `nonghyupMaster`를 직접 import한다.
- 이름·`sido sigungu` 부분 문자열 검색 후 앞에서 30개만 노출한다.
- 선택 시 `cooperative_id`를 폼 상태에 저장하고 `/api/signup`에 전달한다.

근거: `app/signup/page.tsx:12-20`, `components/SignupForm.tsx:18-34`, `components/SignupForm.tsx:356-375`, `components/SignupForm.tsx:663-681`, `components/SignupForm.tsx:872-895`

동일 농협명이 여러 `cooperative_id`로 존재한다. 따라서 농협명만으로 조직을 식별하면 안 된다. 예를 들어 `중앙농협`, `광주농협`, `온양농협`, `대산농협` 등 중복명이 정적 목록에 존재한다.

## 3. 회원가입 데이터 구조

### 현재 가입 순서

1. 사용자가 휴대폰 인증번호를 요청한다.
2. 제출 시 `PhoneAuthProvider.credential`과 `signInWithCredential`로 휴대폰 Firebase Auth 인증을 완료하고 phone ID token을 얻는다.
3. `createUserWithEmailAndPassword`로 별도의 이메일/비밀번호 Firebase Auth 사용자를 생성한다.
4. 이메일 Auth 프로필의 `displayName`을 설정한다.
5. 명함이 있으면 `business-cards/{emailUserUid}/...`에 업로드한다.
6. 이메일 Auth ID token과 phone ID token을 `/api/signup`에 전송한다.
7. 서버가 두 token, 이메일, 휴대폰, 마스터 `cooperative_id`를 검증한다.
8. Firestore transaction에서 `users/{emailUserUid}`를 `pending_cooperative_review`로 생성한다.
9. 운영자 승인 시 `users.status = active`, `organizations/{cooperativeId}` 생성·갱신, 포인트 원장 생성이 한 Firestore transaction에서 처리된다.

근거:

- 클라이언트 순서: `components/SignupForm.tsx:800-928`
- 서버 검증·사용자 생성: `app/api/signup/route.ts:80-119`, `app/api/signup/route.ts:171-234`
- 승인 transaction: `app/api/admin/users/[uid]/approve/route.ts:35-207`

### 중복 가입 방지

- 이메일: `/api/auth/check-email`이 Firebase Auth `getUserByEmail`과 Firestore `users.email`을 함께 확인한다. 최종적으로 Firebase Auth 자체도 중복 이메일을 차단한다. 근거: `app/api/auth/check-email/route.ts:24-48`
- 휴대폰: Firestore `users`에서 동일 `phone`의 다른 문서를 세어 최대 2개까지만 허용한다. 근거: `app/api/signup/route.ts:198-204`
- 같은 UID·같은 농협으로 `/api/signup`을 재호출하면 기존 상태를 반환하고 새 문서를 만들지 않는다. 근거: `app/api/signup/route.ts:177-196`
- 동일 농협의 다른 UID는 차단하지 않는다. 이것이 정상 다중 사용자 흐름이다.

### 가입 실패 rollback

완전한 rollback은 없다.

- 이메일 Auth 사용자 생성 후 명함 업로드 또는 `/api/signup`이 실패해도 Auth 사용자를 삭제하지 않는다.
- 업로드된 명함도 API 실패 시 삭제하지 않는다.
- catch 블록은 화면 오류와 휴대폰 인증 UI 상태만 갱신한다.
- 서버의 `users` 생성과 audit log는 Firestore transaction 안에 있어 둘 사이에는 원자성이 있지만 Auth/Storage까지 포함하지 못한다.

근거: `components/SignupForm.tsx:842-928`, `app/api/signup/route.ts:174-234`

### 탈퇴·계정 삭제

- 고객 회원 탈퇴 또는 고객 계정 삭제 endpoint는 확인되지 않았다.
- 고객 반려/비활성화는 `users.status = rejected`만 수행한다.
- 반려 시 Auth 사용자 삭제, `organizations.users[]` 제거, 포인트 조정, 관련 문서·Storage 삭제가 없다.
- 재승인은 rejected 사용자를 active로 되돌리지만 UID가 기존 `organizations.users[]`에 있으면 가입 포인트를 다시 주지 않는다.

근거: `app/api/admin/users/[uid]/reject/route.ts:34-79`, `app/api/admin/users/[uid]/approve/route.ts:59-73`, `app/api/admin/users/[uid]/approve/route.ts:132-155`

운영자·파트너 계정에는 Auth 삭제 코드가 있으나 고객 정리용으로 재사용할 수 있는 일반 기능은 아니다: `app/api/admin/operators/[uid]/route.ts:298-358`, `app/api/admin/partners/[partnerId]/accounts/route.ts:172-188`.

## 4. Firebase Auth 관계

### 고객 계정의 주 연결

- 이메일/비밀번호 Auth 사용자의 `uid`가 `users/{uid}` 문서 ID이자 `users.uid`다.
- 이후 문의, 조회, 평가, 포인트 원장의 `uid`, `userId`, `user_id`, `actorUid`가 이 UID를 참조한다.
- 사용자 profile과 Auth token의 UID·이메일 일치를 포털 계정 해석 시 검증한다.

근거: `app/api/signup/route.ts:121-172`, `lib/auth/account-context.ts:170-199`, `lib/auth/portal-server.ts:20-39`

### 휴대폰 Auth 계정 위험

휴대폰 credential은 이메일 Auth 계정에 link되지 않는다. 먼저 `signInWithCredential(auth, phoneCredential)`을 수행한 뒤 `createUserWithEmailAndPassword`로 별도 이메일 사용자를 만든다. 서버도 phone token의 `phone_number`와 입력값만 비교하고 phone token UID와 email token UID의 동일성을 요구하지 않는다.

따라서 테스트 가입 정리 시 다음 두 Auth 주체를 조사해야 한다.

- Firestore `users/{uid}`에 연결된 이메일 Auth 사용자
- 동일 가입 과정에서 생성 또는 재사용된 phone provider Auth 사용자

근거: `components/SignupForm.tsx:817-848`, `app/api/signup/route.ts:80-118`

이 구조에서는 Firestore `users`만 삭제해도 이메일 Auth가 남아 재가입을 막을 수 있고, 이메일 Auth만 삭제해도 phone Auth가 남을 수 있다.

### 로그인 세션

- 일반 고객 포털은 Firebase token 또는 Firebase session cookie를 사용한다: `lib/auth/portal-server.ts:72-115`
- 별도 고객 Firestore 로그인 세션 컬렉션은 확인되지 않았다.
- 감사 평가 기능은 별도 capability 세션을 `auditEvaluationSessions`에 저장한다.

## 5. tenant·organization·membership 관계

- Firebase Auth tenant 사용: 확인되지 않음
- `tenantId` 필드: 현재 앱·lib 런타임 코드에서 확인되지 않음
- 고객용 별도 `memberships` 컬렉션: 확인되지 않음
- 실제 조직 문서: `organizations/{cooperativeId}`
- 사실상 membership:
  - 사용자 측: `users.cooperativeId`, `users.nh_org_id`
  - 조직 측: `organizations.users[]`

`OrganizationRecord`:

- `cooperativeId`
- `nh_org_id`
- `cooperativeName`
- `walletBalance`
- `users: string[]`
- `createdAt`, `updatedAt`

근거: `lib/firebase/schema.ts:148-156`

`organizations`는 A가 아니라 B다. 마스터 주소·유형·지역을 보유하지 않고, 승인 전에는 문서가 존재하지 않을 수 있으며, 최초 승인 시 생성된다.

## 6. 가입 여부 판정 방식

서로 다른 판정이 존재한다.

- 마스터 유효성: 전달한 ID가 `nonghyupMaster`에 존재하는가
- 가입 신청 존재: `users/{emailAuthUid}` 문서가 존재하는가
- 고객 사용 가능: `users.status == "active"`
- 가입 승인 대기: `users.status == "pending_cooperative_review"`
- 반려·비활성: `users.status == "rejected"`
- 조직 최초 사용자: 승인 시점에 `organizations/{cooperativeId}` 문서가 존재하지 않는가
- 사용자 재가입 여부: `organizations.users[]`에 해당 UID가 이미 포함되는가

근거:

- `app/api/signup/route.ts:125-133`, `app/api/signup/route.ts:177-196`
- `lib/firebase/server.ts:220-240`
- `lib/auth/account-context.ts:69-81`
- `app/api/admin/users/[uid]/approve/route.ts:62-73`

중요한 결론:

- “해당 농협에 다른 사용자가 이미 가입했다”는 가입 차단 조건이 아니다.
- master `status`는 가입 가능 여부에 영향을 주지 않는다.
- 조직 문서 삭제 여부는 가입 가능 자체보다 “최초 조직 보너스” 판정에 영향을 준다.

## 7. 포인트 데이터 관계

### 잔액

- `organizations/{cooperativeId}.walletBalance`
- 연결키: 문서 ID와 `cooperativeId`

### 원장

- `pointLedger/{autoId}`
  - `cooperativeId`, `nh_org_id`
  - `userId`
  - `requestId`, `answerId`, `related_inquiry_id`
  - `event`, `points`, 잔액 전후
- `point_transactions/{autoId}`
  - `cooperativeId`, `nh_org_id`
  - `user_id`
  - `requestId`, `answerId`, `related_inquiry_id`
  - `type`, `amount`, 잔액 전후

근거: `lib/firebase/schema.ts:158-205`

### 생성·차감

- 첫 조직 승인: `first_org_signup` 100,000P
- 사용자 승인: `user_signup` 10,000P
- 답변 열람: `answer_view` / `question_answer_usage` 차감
- 관리자 수동 조정: `manual_adjustment` 또는 admin adjustment

근거:

- 정책: `lib/platform.ts:1448-1452`
- 승인: `app/api/admin/users/[uid]/approve/route.ts:102-185`
- 답변 열람: `app/api/me/answers/[requestId]/view/route.ts:114-188`
- 수동 조정: `app/api/admin/points/adjust/route.ts:41-98`

잔액과 두 원장을 함께 정리하지 않으면 불일치가 발생한다. 특히 `organizations`만 삭제하고 포인트 원장을 남기면 재승인 시 첫 조직 보너스가 다시 지급되면서 과거 원장과 중복된다. 반대로 원장만 삭제하고 조직 잔액을 유지하면 설명 불가능한 잔액이 남는다.

## 8. 질문·답변 데이터 관계

### 질문

- 컬렉션: `consultRequests`
- 문서 ID: Firestore auto ID
- 사용자 연결: `uid`, `user_id`
- 농협 연결: `cooperativeId`, `nh_org_id`, 이름 snapshot
- 후속 질문 연결: `parentRequestId`
- 첨부 연결: `attachments[].path`, `attachments[].url`

근거: `lib/firebase/schema.ts:208-260`, `app/api/consult/route.ts:129-181`

### 답변

- 컬렉션: `answers`
- 문서 ID: 질문 `requestId`와 동일
- 참조: `requestId`
- 파트너 답변이면 `partnerId`, `partnerAssignmentId`, `partnerDraftId`

근거: `lib/firebase/schema.ts:262-276`, `app/api/admin/requests/[requestId]/answer/route.ts:65-108`

### 답변 열람·평가·댓글

- `answerViews/{requestId}_{cooperativeId}`: 농협 단위 최초 차감 표식
- `answerViews/{requestId}_{uid}`: 사용자별 열람 표식
- 두 문서 모두 `requestId`, `answerId`, `cooperativeId`, `uid`를 저장한다.
- `answerRatings/{requestId}_{uid}`: `requestId`, `answerId`, `uid`, 점수, `comment`
- 별도 댓글 collection은 확인되지 않았다. 현재 “댓글”에 가장 가까운 데이터는 `answerRatings.comment`다.

근거: `app/api/me/answers/[requestId]/view/route.ts:41-47`, `app/api/me/answers/[requestId]/view/route.ts:72-179`, `app/api/me/answers/[requestId]/rating/route.ts:43-74`

### 파트너 작업 데이터

- `partnerAssignments`: `requestId`, `partnerId`
- `partnerAnswerDrafts`: `assignmentId`, `requestId`, `partnerId`
- 승인된 draft는 `answers/{requestId}`로 반영된다.

근거: `lib/firebase/schema.ts:335-375`, `app/api/admin/requests/[requestId]/partner-assignment/route.ts:46-119`, `app/api/admin/partner-drafts/[draftId]/route.ts:50-175`

질문을 먼저 삭제하면 답변, 열람, 평가, 포인트, 파트너 작업, 첨부 경로를 역추적하기 어려워진다. 자식·참조 문서와 Storage를 먼저 처리해야 한다.

## 9. 견적·보고서·알림 데이터 관계

### 일반 견적

- `quoteRequests`
  - 상담 출처: deterministic ID `consult_{consultRequestId}`, `sourceId`, `customerUid`, `customerEmail`, `cooperativeId`
  - 감사 이벤트 출처: deterministic ID `audit_quote_{auditQuoteRequestId}`, `sourceId`, `customerEmail`, `customerEmailHash`; 농협 ID는 없음
- `quoteAssignments`: `quoteRequestId`, `partnerId`
- `quotes`: `quoteRequestId`, `quoteAssignmentId`, `partnerId`, `customerEmail`, `pdfPath`
- `quoteEmailDeliveries`: `quoteId`, `quoteRequestId`, `recipientEmail`

근거: `lib/quotes/quote-requests.ts:20-96`, `lib/firebase/schema.ts:377-498`

### 감사 견적 접수

- `auditQuoteRequests`: `requestId`, 원문 `email`, `emailHash`, 동의·캠페인·상태
- `auditQuoteIdempotency`: `requestId`
- `auditQuoteEmailDedup`: `requestId`, `emailHash`, `campaign`
- `auditQuoteRateLimits`: IP hash 또는 email hash 기반
- `auditQuoteNotifications/{requestId}`: `requestId`, `publicReference`, 발송 상태

근거: `lib/audit-quote/collections.ts`, `lib/audit-quote/types.ts:15-37`, `lib/audit-quote/submit.ts:37-59`, `lib/audit-quote/submit.ts:188-322`, `lib/audit-quote/notify.ts:8-24`

감사 견적 접수는 농협 마스터 ID가 아니라 이메일 중심으로 연결된다. 이메일만으로 실제 농협 B와 안전하게 합칠 수 없다.

### 감사 평가·보고서

컬렉션 상수는 `lib/audit-evaluation/collections.ts`에 정의되어 있다.

- `auditEvaluationCases`
- `auditEvaluationCaseByQuoteRequest`
- `auditEvaluationAccessTokens`
- `auditEvaluationSessions`
- `auditEvaluationUploadIntents`
- `auditEvaluationDocuments`
- `auditEvaluationParsingQueue`
- `auditEvaluationExtractionRuns`
- `auditEvaluationCorrections`
- `auditEvaluationConfirmations`
- `auditEvaluationStandardQuoteDocuments`
- `auditEvaluationNormalizedQuotes`
- `auditEvaluationConfigVersions`
- `auditEvaluationReportRuns`
- `auditEvaluationAuditLogs`
- `auditEvaluationRateLimits`

주요 연결:

- case → `quoteRequestId`, `cooperativeId | null`, `customerAccessOwner`
- mapping → `quoteRequestId`, `caseId`
- token → `caseId`, `quoteRequestId`, `emailHash`, `subjectId`
- session → `caseId`, owner
- 업로드·파싱·정정·확정·보고서 → 주로 `caseId`, `documentId`, `quoteId`, `reportVersion`

근거: `lib/audit-evaluation/types.ts:47-77`, `lib/audit-evaluation/types.ts:119-236`, `lib/audit-evaluation/types.ts:656-677`, `lib/audit-evaluation/types.ts:803-847`

현재 이메일 기반 감사 평가 case 생성은 `cooperativeId: null`, 빈 `cooperativeNameSnapshot`으로 시작한다. 그러므로 이 그래프는 농협명이나 `cooperativeId`로 찾지 말고 `auditQuoteRequest.requestId` → case mapping → `caseId`로 추적해야 한다.

근거: `lib/audit-evaluation/customer-access-service.ts:498-515`

### 알림·초대

- 고객 알림 전용 collection은 확인되지 않았다.
- 감사 접수 운영 알림은 `auditQuoteNotifications`.
- 견적 이메일 상태는 `quoteEmailDeliveries`.
- 초대 전용 collection은 없다. 운영자·파트너 계정의 `accountStatus: invited`가 `users`에 저장되며 Firebase Auth 계정과 함께 관리된다. 고객 농협 가입과는 별도 영역이다.

## 10. Storage 파일 관계

확인된 경로:

- 명함: `business-cards/{uid}/{timestamp}-{filename}`
  - Firestore: `users.businessCardPath`, `businessCardUrl`
  - 근거: `components/SignupForm.tsx:850-869`
- 상담 첨부: `consult-attachments/{uid}/{requestId}/{filename}`
  - Firestore: `consultRequests.attachments[].path/url`
  - object metadata: `ownerUid`, `requestId`
  - 근거: `app/api/consult/route.ts:199-228`
- 견적 PDF: `quotes/{quoteId}/v{version}/quote.pdf`
  - Firestore: `quotes.pdfPath`
  - object metadata: `quoteId`, `version`
  - 근거: `lib/quotes/quote-storage.ts:3-18`
- 감사 평가 원본: `audit-evaluation/originals/{caseId}/{documentId}/source.pdf`
- 감사 평가 격리: `audit-evaluation/quarantine/{caseId}/{intentId}/source.pdf`
- 감사 평가 보고서: `audit-evaluation/reports/{caseId}/v{reportVersion}/attempt-{attempt}/report.pdf`
- 보고서 view model: 같은 report 경로의 `view-model.json`
- 임시 렌더: `audit-evaluation/temp/{caseId}/{jobId}/{fileName}`
  - 근거: `lib/audit-evaluation/upload-identity.ts:4-91`
- 파트너 로고: `partner-assets/{partnerId}/logo.{png|jpg}`
  - 고객 농협 B가 아니므로 테스트 고객 정리에 포함하면 안 된다.
  - 근거: `app/api/partner/profile/logo/route.ts:42-63`

Firestore 문서 삭제는 Storage object를 삭제하지 않는다. Storage 경로를 담은 문서를 먼저 삭제하면 object를 찾을 근거도 사라진다. 상담 첨부 URL은 2036년까지의 signed URL로 생성되므로 문서만 삭제해서는 충분하지 않다.

## 11. 기존 seed 및 더미데이터 생성 방식

### Git 이력

저장소에는 요청한 30~50개보다 적은 총 5개 커밋만 존재한다.

- `cc4e54f` — 초기 시스템. 농협 마스터, 가입, 조직, 포인트, 문의·답변, Firebase Auth, `seed-admin`, MVP/production smoke 스크립트 추가
- `2dd4def` — 로컬 설정·clone 안내
- `e11ab62` — 관리자 콘솔·가입 흐름 업데이트, 이메일 중복확인 등
- `328e911` — FY27 감사 견적 접수·운영 컬렉션 추가
- `0f19c71` — CMS 통합·검증

seed/더미 고객 정리 기능을 추가한 커밋은 없다. 감사 평가·파트너·견적의 많은 현재 파일은 미커밋 작업 트리에 있으므로 커밋 이력만으로는 현재 데이터 모델 전체를 설명할 수 없다.

### `scripts/seed-admin.mjs`

- Firebase Auth admin과 `users/{uid}` admin profile을 생성·갱신한다.
- 기존 UID·비밀번호·role을 가능한 보존한다.
- `--dry-run`, 프로젝트 ID 일치, write 시 `--confirm-production` 보호 장치가 있다.
- 고객 농협 더미데이터 seed가 아니다.
- Auth 사용자를 생성할 수 있고 Storage는 만들지 않는다.

근거: `scripts/seed-admin.mjs:10-16`, `scripts/seed-admin.mjs:115-151`, `scripts/seed-admin.mjs:157-291`

### 감사 평가 테스트 seed

`scripts/audit-evaluation/seed-test-quote-request.mjs`:

- 기본 이메일 `jason@nonghyup.com`
- `auditQuoteRequests`와 `auditQuoteEmailDedup` 생성
- `contactName: "테스트담당자"`, 상태 `delivered`
- 같은 `emailHash`가 있으면 재사용하므로 이메일 기준으로는 중복 방지
- 저장 문서에 공통 `isTest`는 없음
- Firebase Auth·Storage 생성 없음

`scripts/audit-evaluation/seed-test-published-config.mjs`:

- `auditEvaluationConfigVersions`에 `"내부 테스트용 평가기준"` 게시
- `actorUid = "seed-test-admin"`
- deterministic config ID/version이 이미 PUBLISHED이면 재사용
- Firebase Auth·Storage 생성 없음

두 스크립트 모두 `.env.local`의 Firebase Admin credential로 임의 프로젝트를 가리킬 수 있고, `seed-admin`과 같은 명시적 production confirmation guard가 없다. 운영 환경에서 실행되었는지는 코드만으로 확인할 수 없다.

### smoke 스크립트

`scripts/smoke-mvp.mjs`, `scripts/smoke-mvp-integrated.mjs`:

- 기본 URL이 `https://project-eta-one-64.vercel.app`
- timestamp 이메일 생성:
  - `mvp-a1-*`, `mvp-a2-*`, `mvp-b-*`
  - `integrated-a1-*`, `integrated-a2-*`, `integrated-b-*`
- 실제 마스터 농협 이름 후보 중 당시 `organizations`에 없는 이름을 골라 가입·문의·답변·평가·포인트 사용을 시도한다.
- 테스트 식별 필드를 저장하지 않는다.
- cleanup 단계가 없다.
- 정상 완료된다면 Firebase Auth, `users`, `organizations`, 포인트, 문의, 답변, 열람, 평가, audit log가 생성된다.
- business card와 상담 첨부 파일은 이 smoke 시나리오에서 업로드하지 않는다.

`scripts/smoke-prod.mjs`:

- 같은 public 기본 URL 사용
- `test-e2e-{timestamp}@example.com`, `"테스트사용자"`, `"테스트 문의 제목"`을 사용
- 현재 UI의 휴대폰 인증 단계를 완료하지 않으므로 현재 코드 기준으로 가입 성공 여부는 보장되지 않는다.

현재 폼은 휴대폰 인증이 필수이므로 이 smoke 코드가 현 상태에서 완주할 가능성은 낮다. 그러나 과거 실행 결과나 수동 테스트 데이터의 존재 여부는 실제 Firebase read-only inventory 없이는 판단할 수 없다.

### fixture·mock

- `lib/audit-evaluation/testing/*`, `lib/cms/testing/*`, rules 테스트는 memory repository 또는 Firebase emulator를 사용한다.
- `package.json:19`, `package.json:27`은 `demo-*` emulator project를 명시한다.
- 이 테스트 fixture는 코드상 운영 Firestore에 직접 쓰지 않는다.

## 12. 실제 농협에 연결된 더미데이터 후보

확정된 운영 데이터가 아니라 조사 우선순위 후보만 기록한다.

### 고객 가입 smoke 후보

- Auth/users 이메일 패턴:
  - `mvp-a1-{timestamp}@example.com`
  - `mvp-a2-{timestamp}@example.com`
  - `mvp-b-{timestamp}@example.com`
  - `integrated-a1-{timestamp}@example.com`
  - `integrated-a2-{timestamp}@example.com`
  - `integrated-b-{timestamp}@example.com`
  - `test-e2e-{timestamp}@example.com`
  - `invalid-org-{timestamp}@example.com` — Auth만 생성되고 Firestore 가입은 거절될 가능성이 있는 후보
- 이름:
  - `A농협 사용자 1/2`, `B농협 사용자 1`
  - `통합 A농협 사용자 1/2`, `통합 B농협 사용자 1`
  - `테스트사용자`
- 문의 제목 prefix:
  - `MVP 미공개`, `MVP 우리농협`, `MVP 전체공개`, `MVP B농협 전체공개`
  - `통합 A농협 미공개`, `통합 A농협 우리농협`
  - `테스트 문의 제목`

근거: `scripts/smoke-mvp.mjs:315-418`, `scripts/smoke-mvp.mjs:458-488`, `scripts/smoke-mvp-integrated.mjs:240-299`, `scripts/smoke-prod.mjs:63-119`

연결된 농협은 고정되지 않고 실행 시점의 기존 `organizations.cooperativeName`을 보고 “미사용” 이름을 동적으로 고른다. 이 판정은 이름 기반이며 마스터에 동명이 있는 경우 ID를 구분하지 못한다. 실제 농협 마스터 항목에 테스트 B가 연결될 가능성이 있으나, 어느 `cooperativeId`인지는 운영 데이터 조회 전에는 확정할 수 없다.

### 코드 전용 샘플

`lib/platform.ts`의 `sampleInquiries`, `pointWallet`, `pointLedger`, `partnerQueue`는 `서울중앙농협` 이름의 화면·기획 샘플이다. 이 상수 자체는 Firestore write에 사용되는 코드가 확인되지 않았으므로 운영 더미데이터로 단정할 수 없다.

근거: `lib/platform.ts:1491-1568`, `lib/platform.ts:1671-1695`

### 감사 평가 seed 후보

- `auditQuoteRequests`에서 seed 기본 이메일과 일치하는 레코드
- `contactName == "테스트담당자"` 후보
- 연관 `auditQuoteEmailDedup`, `quoteRequests`, 평가 case graph
- `"내부 테스트용 평가기준"`, `publishedBy == "seed-test-admin"` config

이 역시 문자열만으로 삭제하지 말고 request ID, config ID/version, 생성 이력으로 검증해야 한다.

## 13. 더미데이터 식별 가능성

### 현재 결론

공통·신뢰 가능한 더미데이터 식별 필드는 없다.

- 없음: `isDemo`, `isTest`, `seeded`, `createdBySeed`, `testData`, `seedRunId`
- smoke 생성 레코드는 일반 고객과 동일한 스키마·흐름을 사용한다.
- audit log에는 actor·action·target은 남지만 test 여부는 없다.
- 일부 테스트 문자열과 이메일 패턴은 후보 탐색에만 쓸 수 있다.

### 안전하게 식별 가능한 범위

이미 신뢰할 수 있는 root ID를 확보한 뒤에는 실제 참조 필드로 그래프를 추적할 수 있다.

- email Auth UID → `users/{uid}`
- `uid` → 문의, 열람, 평가, audit actor, 명함 경로
- `cooperativeId` → organization, 포인트 원장, 농협 단위 answer view
- `requestId` → answer, view, rating, point ledger, assignment, draft, quote request, audit log, 첨부
- `quoteRequestId` → assignment, quote, email delivery, 평가 case mapping
- `caseId` → 감사 평가 전 컬렉션과 Storage

하지만 같은 실제 농협 조직에 실제 사용자와 테스트 사용자가 혼재하면 `cooperativeId`만으로 일괄 삭제해서는 안 된다. UID·request ID 단위의 포함/제외 검증이 필요하다.

## 14. 삭제 대상과 보존 대상

### 반드시 보존할 A

- `lib/platform.ts`의 해당 실제 농협 `nonghyupMaster` 항목
- `cooperative_id`, 이름, 유형, 지역, 주소, status, source, updated_at
- 다른 실제 농협 마스터 항목 전체

현재 A는 코드이므로 Firestore 정리 과정에서 직접 삭제될 대상이 아니다.

### 조건부 삭제·초기화할 B 후보

정확한 테스트 root ID가 검증된 경우에만:

- Firebase Auth 이메일 사용자와 별도 phone provider 사용자
- `users/{uid}`
- `organizations/{cooperativeId}` 또는 그 문서의 테스트 UID·테스트로 인한 잔액 부분
- `pointLedger`, `point_transactions`
- `consultRequests`, `answers`, `answerViews`, `answerRatings`
- 해당 문의의 `partnerAssignments`, `partnerAnswerDrafts`
- `quoteRequests`, `quoteAssignments`, `quotes`, `quoteEmailDeliveries`
- 연관 감사 접수·dedup·idempotency·notification·evaluation graph
- 연관 `auditLogs`, `auditEvaluationAuditLogs` — 보존 법적·운영 정책을 STEP 2에서 먼저 결정
- 사용자의 inline `consents`
- 명함, 상담 첨부, 견적 PDF, 감사 평가 원본·격리본·보고서·임시 파일

### 기본 보존할 비고객·공용 데이터

- 다른 UID가 포함된 실제 고객 데이터
- 공용 `faqs`
- CMS published/draft/revision/assets/audit log
- 공용 평가 config, 표준 견적 문서 — 특정 seed config임이 별도 검증된 경우 제외
- `partners`, partner Auth/users, partner logo
- 다른 고객과 공유되는 partner 배정·답변

포인트 원장은 `lib/platform.ts:1937`에서 삭제하지 않고 조정 이벤트로 처리한다는 QA 원칙도 선언되어 있다. 테스트 초기화에서 물리 삭제할지 보정 이벤트로 남길지는 감사·회계 정책 결정이 필요하다.

## 15. 삭제 순서

STEP 2에서 구현한다면 다음 순서를 권고한다. 이번 단계에서는 실행하지 않았다.

1. 대상 Firebase project ID와 환경을 고정하고 production 여부를 이중 확인한다.
2. exact root 목록을 만든다: email Auth UID, phone Auth UID, `cooperativeId`, request IDs, quote request IDs, case IDs, Storage 경로.
3. 이름·이메일 패턴으로 찾은 후보를 실제 참조 필드로 교차검증하고, 실제 고객 UID가 하나라도 섞이면 조직 전체 삭제를 금지한다.
4. dry-run 결과와 문서 수·Storage object 수·예상 잔액을 snapshot/manifest로 남긴다.
5. 테스트 Auth 사용자를 우선 disable하고 refresh/session 접근을 차단하되 아직 삭제하지 않는다.
6. Storage 경로를 먼저 manifest에 고정한다. object 삭제가 실패하면 해당 경로를 가진 Firestore 문서를 삭제하지 않는다.
7. leaf 데이터부터 삭제한다.
   - 평가: sessions/tokens/rate limits/audit logs → corrections/confirmations/extraction/parsing/normalized data/upload intents/documents/report runs → mapping → case
   - 견적: email deliveries → quotes → quote assignments → quote request
   - 문의: ratings → user/org answer views → point rows → partner drafts/assignments → answer → 후속 질문 → 부모 질문
   - 감사 접수: notifications/idempotency/dedup/rate-limit 연관 → request
8. 테스트 `users/{uid}`와 그 UID를 참조하는 audit/activity 데이터를 처리한다.
9. `organizations/{cooperativeId}`를 마지막 Firestore transaction에서 처리한다.
   - 테스트 전용 조직: 잔액·원장·참조가 모두 0건임을 확인한 후 organization 문서 삭제
   - 혼재 조직: 실제 UID를 보존하고 테스트 UID만 `users[]`에서 제거하며, 보존 원장 기준으로 잔액을 재계산
10. Firestore·Storage 사후 inventory가 0건인지 확인한 뒤 Firebase Auth 이메일·phone 사용자를 마지막으로 삭제한다.
11. `/api/auth/check-email`, 신규 가입, 승인, 조직 최초 보너스 동작을 검증한다.

Firestore batch는 최대 범위와 transaction read/write 제한이 있고 Auth/Storage를 포함할 수 없다. 따라서 재실행 가능한 단계별 상태, idempotency, 실패 재개 지점이 필요하다.

## 16. 데이터 정리 후 가입상태 복원 방법

### 현재 코드에서 “가입 가능”의 의미

농협 자체는 마스터 ID가 존재하기만 하면 항상 선택·신청 가능하다. `organizations` 존재 여부로 농협 가입을 막지 않는다. 따라서 복원 대상은 농협 마스터 flag가 아니라 계정·조직 B다.

### 완전한 테스트 전 상태 복원

테스트 전용으로 사용된 실제 농협에 실제 고객 B가 전혀 없었다는 것이 검증된 경우:

- A의 `nonghyupMaster` 항목은 그대로 둔다.
- 테스트 email·phone Auth 사용자를 삭제한다.
- `users/{uid}`와 모든 UID 참조 B를 삭제한다.
- 모든 request/quote/case graph와 Storage를 삭제한다.
- 포인트 두 원장과 `organizations/{cooperativeId}`를 함께 제거한다.

이렇게 해야 다음 실제 첫 사용자 승인 시 `organizations`가 존재하지 않아 최초 조직 100,000P와 사용자 10,000P가 정상 생성된다.

### 실제 고객과 혼재한 경우

- `organizations`를 삭제하지 않는다.
- 실제 사용자 UID와 실제 사용으로 생긴 원장·잔액·문의는 보존한다.
- 테스트 UID만 `organizations.users[]`에서 제거한다.
- 테스트 원장의 효과를 제거한 뒤 보존 원장에 맞춰 `walletBalance`를 재계산한다.
- 실제 사용자 수가 0이 아닌 한 “최초 조직” 상태로 되돌리면 안 된다.

### 자동 복원 기능 존재 여부

자동 복원 기능은 없다.

- 고객 반려는 organization membership을 제거하지 않는다.
- 고객 Auth 삭제와 organization 정리를 연결한 코드가 없다.
- organization 문서가 빈 `users[]`로 남아도 다음 승인에서는 `isFirstUser == false`다.
- 기존 Auth 사용자나 `users.email` 문서가 남으면 이메일 중복 확인이 재가입을 차단한다.

## 17. 주요 위험

1. **식별 실패**: 공통 test marker가 없어 실제 고객과 테스트 고객을 이름·이메일만으로 구분할 수 없다.
2. **실제 농협에 혼재**: smoke가 실제 마스터 농협을 선택하며 “미사용” 여부도 농협명으로 판단한다. 동명 농협·동시 가입·기존 미승인 사용자 때문에 오판할 수 있다.
3. **Auth 이중 주체**: phone Auth와 email Auth가 link되지 않아 한쪽만 삭제할 수 있다.
4. **부분 rollback 부재**: 가입 실패 후 Auth 사용자 또는 명함이 orphan으로 남을 수 있다.
5. **비원자적 삭제**: Firestore, Auth, Storage를 하나의 transaction으로 정리할 수 없다.
6. **잔액·원장 불일치**: organization 잔액, `pointLedger`, `point_transactions`, answer view를 함께 처리해야 한다.
7. **최초 가입 보너스 재지급**: organization 존재 여부만으로 최초 조직을 판정하므로 잘못 삭제하면 포인트가 중복 지급된다.
8. **부모 삭제 비연쇄성**: Firestore는 부모 문서 삭제 시 서브컬렉션을 자동 삭제하지 않는다. 현재 고객 B는 주로 최상위 컬렉션이고 확인된 명시적 서브컬렉션은 CMS revision이지만, 운영에 코드 밖 서브컬렉션이 없는지 inventory가 필요하다.
9. **질문 그래프 orphan**: 질문 삭제 후 답변·열람·평가·후속 질문·파트너 draft·견적·포인트·파일이 남을 수 있다.
10. **Storage 잔존**: signed URL과 object는 Firestore 문서 삭제로 사라지지 않는다.
11. **감사 견적의 이메일 연결**: `auditQuoteRequests`와 최초 평가 case는 `cooperativeId`가 없어 이메일·request graph로만 추적 가능하다.
12. **삭제 기능 오용**: `AuditEvaluationRetentionService`는 평가 보존기간 데이터만 대상으로 하며 고객 계정 전체 graph cleanup이 아니다. 최대 plan 200건, collection별 1,000건 제한도 있어 일반 초기화 도구로 사용할 수 없다. 근거: `lib/audit-evaluation/retention-service.ts:17-18`, `lib/audit-evaluation/retention-service.ts:120-160`, `lib/audit-evaluation/retention-service.ts:347-389`
13. **오래된 smoke 코드**: public 기본 URL을 쓰지만 현재 휴대폰 인증 흐름과 맞지 않는다. “실행 성공” 또는 “데이터 없음” 어느 쪽도 코드만으로 단정할 수 없다.
14. **대규모 미커밋 변경**: 분석 시작 시 앱 저장소에 modified 88개, untracked 79개가 있었다. cleanup 설계를 현재 작업 트리 기준으로 할지 `origin/main` 기준으로 할지 STEP 2에서 고정해야 한다.

## 18. 관련 파일·함수·컬렉션 경로

### 핵심 파일·함수

- 농협 마스터: `lib/platform.ts`
  - `CooperativeRecord`, `buildCoop`, `nonghyupMaster`
- 가입 UI: `components/SignupForm.tsx`
  - `filteredCooperatives`, `selectCooperative`, `submit`
- 가입 API: `app/api/signup/route.ts`
  - `POST`
- 이메일 중복 확인: `app/api/auth/check-email/route.ts`
- 승인·조직 생성: `app/api/admin/users/[uid]/approve/route.ts`
- 반려·비활성: `app/api/admin/users/[uid]/reject/route.ts`
- 활성 회원 판정: `lib/firebase/server.ts`
  - `requireMember`, `requireActiveMember`, `canReadRequest`
- 공통 스키마: `lib/firebase/schema.ts`
- 문의·첨부 생성: `app/api/consult/route.ts`
- 답변 생성: `app/api/admin/requests/[requestId]/answer/route.ts`
- 답변 열람·포인트 차감: `app/api/me/answers/[requestId]/view/route.ts`
- 평가: `app/api/me/answers/[requestId]/rating/route.ts`
- 견적 request 변환: `lib/quotes/quote-requests.ts`
- 견적 Storage: `lib/quotes/quote-storage.ts`
- 감사 접수 컬렉션: `lib/audit-quote/collections.ts`
- 감사 접수 알림: `lib/audit-quote/notify.ts`
- 감사 평가 컬렉션: `lib/audit-evaluation/collections.ts`
- 감사 평가 타입·참조: `lib/audit-evaluation/types.ts`
- 감사 평가 Storage 경로: `lib/audit-evaluation/upload-identity.ts`
- 기존 평가 retention: `lib/audit-evaluation/retention-service.ts`
- Firestore rules: `firestore.rules`
- Storage rules: `storage.rules`

### B의 주요 Firestore 최상위 컬렉션

- 계정·조직: `users`, `organizations`
- 포인트: `pointLedger`, `point_transactions`
- 문의·답변: `consultRequests`, `answers`, `answerViews`, `answerRatings`
- 파트너 연계: `partnerAssignments`, `partnerAnswerDrafts`
- 일반 견적: `quoteRequests`, `quoteAssignments`, `quotes`, `quoteEmailDeliveries`
- 감사 접수: `auditQuoteRequests`, `auditQuoteIdempotency`, `auditQuoteEmailDedup`, `auditQuoteRateLimits`, `auditQuoteNotifications`
- 감사 평가: `auditEvaluationCases`, `auditEvaluationCaseByQuoteRequest`, `auditEvaluationAccessTokens`, `auditEvaluationSessions`, `auditEvaluationUploadIntents`, `auditEvaluationDocuments`, `auditEvaluationParsingQueue`, `auditEvaluationExtractionRuns`, `auditEvaluationCorrections`, `auditEvaluationConfirmations`, `auditEvaluationStandardQuoteDocuments`, `auditEvaluationNormalizedQuotes`, `auditEvaluationConfigVersions`, `auditEvaluationReportRuns`, `auditEvaluationAuditLogs`, `auditEvaluationRateLimits`
- 활동·감사: `auditLogs`
- 고객 문의와 직접 무관한 공용/별도 영역: `faqs`, `partners`, `partnerApplications`, CMS collections, `publicRateLimits`

### Git 상태

- 바깥 작업공간 `C:\Users\cheap\NH support`: 커밋 없는 `master`, `pregosuv/` 전체가 untracked로 보임
- 실제 앱 저장소 `C:\Users\cheap\NH support\pregosuv`: `main...origin/main`
- 분석 시작 시 앱 저장소: modified 88개, untracked 79개, 총 167개 미커밋 항목
- 본 분석 문서는 기존 변경을 수정하지 않고 새 파일로만 추가했다.
