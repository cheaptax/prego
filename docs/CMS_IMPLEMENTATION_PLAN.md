# CMS implementation plan

기준: `NH_PREGO_SOFTCODING_RULES.md`  
상태: 17개 사용자 화면과 공통 영역의 공개 렌더링·편집·게시·복원 및 전체 재검증 완료

## 1. 목표

비개발자 관리자가 `/admin`에서 공개 화면과 공통 요소의 콘텐츠·허용된 디자인·노출 구성을 안전하게 편집하고, 초안 저장·실제 renderer 미리보기·게시·버전 복원을 수행할 수 있게 한다.

동시에 다음은 코드에서 보호한다.

- Firebase 설정, 인증, session, custom claim과 관리자 판정.
- collection/field/form name, API endpoint와 payload shape.
- 공개범위 ACL, 개인정보 접근, upload 제한.
- 포인트 계산·상태 전이·원장·감사로그.
- event의 idempotency, honeypot, HMAC, rate/dedupe/origin guard.
- 필수 법정 동의의 필수 여부와 임의 HTML/CSS/JavaScript 실행.

## 2. 구현 전 차단 조건

CMS 기능보다 아래 보안 작업을 먼저 완료한다.

1. Firestore `users` self-update를 허용 field만 바꿀 수 있게 제한하고 `role`, `status`, organization ID, server timestamps를 client가 바꾸지 못하게 한다.
2. `organizations`와 `pointLedger`의 일반 signed-in create/update를 제거하고 서버 transaction만 쓰게 한다.
3. admin 판정을 Firebase custom claim 기반으로 통일한다.
4. shared credential admin login endpoint와 credential 안내 문구를 제거하고 기존 Firebase admin 계정 login/custom claim provisioning 절차를 안전한 별도 운영 절차로 바꾼다.
5. `/partner`를 인증된 partner route로 구현하기 전까지 차단하거나 production route에서 제거한다.
6. 공개 FAQ GET의 자동 seed를 제거한다.
7. rules emulator를 CI에서 실제 실행해 보안 규칙 regression 기준을 만든다.

위 작업 없이 CMS write API를 추가하면 현재의 과도한 Firestore 권한과 결합되어 draft·published·audit 데이터도 보호하기 어렵다.

## 3. 안정적 식별자

### pages

- `home`
- `auth.login`
- `auth.signup`
- `auth.pendingApproval`
- `public.consult`
- `public.inquiries`
- `public.faq`
- `public.support`
- `event.auditQuote`
- `member.mypage`
- `member.requestDetail`
- `partner.portal`
- `framework.notFound`

`admin.console`의 기존 운영 label/help도 관리 대상이지만 CMS editor 자체를 같은 CMS로 무제한 편집하면 복구가 어려우므로 별도 `adminPresentation` global 문서와 강제 fallback을 사용한다.

### globals

- `siteIdentity`
- `header`
- `footer`
- `support`
- `defaultSeo`
- `theme`
- `statusMessages`
- `adminPresentation`

### section ID 예

- home: `hero`, `about`, `expertise`, `services`, `process`, `caseStudies`, `faqPreview`
- consult: `steps`, `categorySelector`, `visibilitySelector`, `requestFields`, `success`
- audit event: `hero`, `intakeForm`, `benefits`, `steps`, `faq`, `legalNotice`
- member detail: `summary`, `requestBody`, `attachments`, `answer`, `followupActions`, `rating`

section과 반복 item은 표시 제목이나 array index가 아닌 고유 ID를 유지한다.

## 4. 데이터 모델

기본 collection은 규칙 문서의 이름을 그대로 따른다.

### 공개본

- `cmsPublishedPages/{pageKey}`
- `cmsPublishedGlobals/{documentKey}`

공개본에는 공개 renderer에 필요한 다음 정보만 둔다.

- `schemaVersion`
- `pageKey` 또는 `documentKey`
- `route`
- 검증·정규화된 `content`
- 검증된 `theme`/`styleOverrides`
- `version`, `status: "published"`
- `publishedAt`

공개 문서에는 draft, 내부 메모, actor email/uid, 변경 사유, 감사정보를 넣지 않는다.

### 관리자 전용

- `cmsDraftPages/{pageKey}`
- `cmsDraftGlobals/{documentKey}`
- `cmsPageRevisions/{pageKey}/revisions/{revisionId}`
- `cmsGlobalRevisions/{documentKey}/revisions/{revisionId}`
- `cmsAuditLogs/{logId}`
- `cmsAssets/{assetId}`

draft에는 `createdAt/By`, `updatedAt/By`, base published version과 편집 충돌용 version을 둔다. 모든 시간은 server timestamp를 사용한다.

### revision

- 게시 직전의 published snapshot과 게시한 normalized snapshot을 추적할 수 있어야 한다.
- revision은 immutable이고 삭제 API를 제공하지 않는다.
- rollback도 이전 snapshot을 새 draft로 복사한 뒤 새 publish를 수행한다. 과거 revision 자체를 수정하지 않는다.

### asset

- 원본명, storage path, MIME, byte size, width/height, aspect ratio, alt, focal point, uploader, timestamps, status.
- public asset과 draft-only asset의 path/권한을 분리한다.
- 확장자 문자열만 믿지 않고 MIME·signature·크기·dimension을 검증한다.

## 5. 타입과 runtime schema

1. page별 TypeScript type과 runtime validator를 같은 모듈에서 정의한다.
2. 모든 문서는 `schemaVersion` discriminated union으로 읽는다.
3. validator는 unknown 입력을 받아 허용 field만 반환하고 나머지는 버린다.
4. 잘못된 문서는 renderer에 전달하지 않고 code default를 사용한다.
5. 배열 item ID 중복, 빈 필수문구, invalid link, 허용되지 않은 token, 잘못된 heading hierarchy를 publish 전에 차단한다.
6. rich text가 필요하기 전까지 plain text와 구조화된 paragraph/list/link 모델을 우선한다.
7. rich text 도입 시 tag/attribute allowlist와 `javascript:`/event handler/script 차단을 server와 renderer 양쪽에서 검증한다.
8. 우위·최초 주장과 수치형 KPI에는 근거 URL/문서, 확인일, 만료일, 승인 상태를 별도 metadata로 요구하고 만료되면 게시를 경고 또는 차단한다.

자유형 JSON editor, raw HTML, raw CSS, class name 입력은 제공하지 않는다.

## 6. default와 조회 경로

### code default

- 현재 운영 화면과 동일한 typed default를 page별 파일로 옮긴다.
- 기본값은 deploy artifact에 포함되어 Firebase 장애·문서 누락·schema 실패 때 즉시 사용된다.
- 기존 `lib/platform.ts`의 운영 master/sample/prototype 값을 페이지 콘텐츠 default와 분리한다.

### public read

- 공개 페이지는 Server Component에서 `getPublishedPage(pageKey)`를 호출해 CMS 문서를 한 번 읽는다.
- page 단위 1 read, global은 필요한 문서만 합쳐 읽고 section별 Firestore read를 금지한다.
- 결과를 validator로 정규화한 뒤 default와 명시적으로 merge한다.
- 사용자에게 Firebase 기술 오류를 표시하지 않고 redacted monitoring event만 남긴다.
- client component에는 검증 완료된 직렬화 가능 content만 props로 전달해 초기 깜박임을 없앤다.

### Next.js 16 cache

- public published loader에만 Cache Components의 `use cache`, `cacheTag`, `cacheLife` 도입을 검토한다.
- 도입 시 `next.config.mjs`의 `cacheComponents: true`를 별도 변경으로 검증하고 page tag는 `cms-page:{pageKey}`, global tag는 `cms-global:{documentKey}`로 한다.
- publish 성공 후 해당 tag만 Next.js 16 방식으로 invalidate한다. route handler에서는 `revalidateTag(tag, "max")` 등 지원되는 API를 사용하고 전체 cache를 비우지 않는다.
- draft, preview, admin user별 데이터는 public cache에 넣지 않는다.

## 7. write, publish, rollback

### draft save

1. admin bearer token과 custom claim 검증.
2. pageKey allowlist와 payload schema 검증.
3. client가 보낸 `expectedVersion`과 현재 draft version 비교.
4. Firestore transaction에서 server timestamp, actor UID, 새 version 기록.
5. `cmsAuditLogs`에 target, action, actor, version을 기록하되 콘텐츠 원문과 개인정보는 최소화.
6. 충돌 시 덮어쓰지 않고 현재 server version과 비교 화면을 제공.

### publish

1. draft schema, 링크, alt, 필수문구, 대비, heading, 법정문구 잠금 검사.
2. 영향을 받는 route와 global override를 게시 확인 화면에 표시.
3. transaction에서 기존 published snapshot을 revision에 보존.
4. 내부정보를 제거한 normalized 공개본만 published collection에 기록.
5. draft의 base version을 새 published version으로 갱신.
6. audit log 작성 후 관련 cache tag만 invalidate.

### rollback

1. revision 목록은 관리자만 읽는다.
2. 선택한 revision을 현재 draft로 복원하며 즉시 공개하지 않는다.
3. preview와 diff 확인 후 별도 publish한다.
4. rollback 자체도 새 revision/audit event가 된다.

## 8. Firebase rules와 API

### Firestore

- public: `cmsPublishedPages`, `cmsPublishedGlobals`만 read 가능, client write 금지.
- admin claim: draft/revision/CMS audit/asset metadata read 가능.
- CMS write는 원칙적으로 Admin SDK API만 허용한다. client direct write를 열지 않는다.
- revisions와 audit logs는 client delete/update를 항상 deny한다.
- 기존 collection rules도 field-level validation과 immutable field 검사를 추가한다.

### Storage

- published asset read와 draft asset read를 path 수준에서 분리한다.
- upload는 admin claim과 signed upload 정책을 검증한다.
- overwrite 대신 새 asset ID/path를 만들고 reference 상태로 lifecycle을 관리한다.

### API route 제안

- `GET /api/admin/cms/pages`
- `GET, PATCH /api/admin/cms/pages/[pageKey]/draft`
- `POST /api/admin/cms/pages/[pageKey]/publish`
- `GET /api/admin/cms/pages/[pageKey]/revisions`
- `POST /api/admin/cms/pages/[pageKey]/restore`
- global 문서도 동일 pattern.
- asset upload/finalize/delete는 별도 endpoint.

endpoint와 payload는 관리자 UI에 노출하거나 CMS 데이터로 저장하지 않는다.

## 9. 관리자 편집 UX

기존 `/admin`에 `콘텐츠 관리` entry를 추가하되, 4,600줄의 `AdminDashboard`에 editor 전체를 넣지 않는다. `/admin/cms`와 `/admin/cms/[pageKey]`의 중첩 route로 분리하고 기존 운영 콘솔은 유지한다.

### 목록

- 페이지명, URL, 공개 version, draft 유무, 마지막 게시일, 편집자, 상태, 미리보기 thumbnail.
- guest/member/admin/partner 대상과 영향 route를 표시.

### 편집기

- 좌측: page/section tree, 표시·숨김, 순서.
- 중앙: 실제 공개 renderer를 재사용한 preview.
- 우측: 선택 section의 업무 용어 기반 field.
- 상단: PC/tablet/mobile 전환, 저장 상태, draft/published 차이, undo/redo.
- 하단 또는 별도 drawer: validation warning, broken link, alt/heading/contrast 문제.

### 입력 원칙

- 색상 token picker와 허용 palette.
- typography/spacing은 `작게/기본/크게` preset+허용 범위.
- 링크는 내부 route selector와 `https` 외부 URL을 분리.
- 반복 item은 stable ID 유지, drag reorder, duplicate, soft delete/restore.
- 법적 필수 section과 보안 경고는 숨김/영구삭제 불가.
- 위험 action은 변경 영향과 이전/이후 diff를 표시.

### preview 보안

- draft API는 admin token을 요구한다.
- preview renderer에는 draft data를 props로 전달하고 draft URL/response를 public cache에 저장하지 않는다.
- 실제 renderer component를 공유하되 form submit, 포인트 차감, 회원/관리자 mutation은 preview mode에서 완전히 비활성화한다.

## 10. 화면별 전환 순서

### 0단계: 보안·계약 고정

- P0 rules/admin auth/partner 공개 문제 수정.
- 기존 payload와 collection shape를 snapshot/contract test로 고정.
- 현재 3개 validation command와 rules emulator를 CI 기준선으로 등록.

### 1단계: CMS foundation

- types/runtime schemas/default resolver.
- published/draft/revision/audit/asset repository.
- rules와 admin API.
- 누락/invalid fallback, draft/public 분리, conflict, audit tests.
- production 자동 seed/migration은 실행하지 않는다.

### 2단계: canonical design tokens

- 중복 `:root`를 실제 computed 값 기준으로 정리.
- color/typography/spacing/radius/shadow/layout responsive token type 정의.
- 기존 화면 결과를 바꾸지 않는 visual regression 기준 확보.

### 3단계: globals

- `siteIdentity`, `header`, `footer`, `support`, `defaultSeo`, `theme`.
- `Topbar`, `Footer`, root metadata, support FAB를 typed global content로 전환.
- guest/member/admin CTA 목적지는 allowlist로 보호.

### 4단계: 공개 정적 페이지

- `[완료] home`: 기존 운영 문구·링크·DOM·반응형 디자인을 코드 기본값으로 이전.
- `[완료] home`: section 순서/노출, 히어로·서비스 요약·센터 소개·가치·전문성·지원 분야·상담 흐름·게시판 안내·FAQ·SEO·상태 문구를 CMS에 연결.
- `[완료] home`: 미연결 localStorage 서비스 편집기를 제거하고 server-side published/default resolver로 통일.
- `[완료] common`: `siteIdentity`, `header`, `footer`, `support`를 페이지와 분리해 공통 초안·게시본·이력으로 관리.
- `[완료] common`: 서비스 로고, 내비게이션, 로그인·회원가입·상담 버튼, 푸터 링크와 고객지원 플로팅 버튼의 전용 편집·게시·복원 화면 연결.
- `[완료] preview`: 공개 메인 화면과 관리자 미리보기가 같은 실제 컴포넌트를 사용.
- `[완료] public.support`, `auth.pendingApproval`, 이용약관·개인정보처리방침과 custom 404의 페이지 본문 연결.

### 5단계: FAQ 통합

- 현재 FAQ를 page/global CMS architecture에 연결.
- 공개 GET side-effect 제거.
- 기존 FAQ 문서는 읽기 호환을 유지하며 명시적 dry-run migration으로만 새 구조에 복사.
- draft/published 분리, revision/rollback, soft delete 추가.

### 6단계: auth와 일반 문의

- `auth.login`, `auth.signup`, `public.consult`, `public.inquiries`.
- label/placeholder/help/error/success와 선택지 표시 label만 전환.
- 내부 field/value/payload/필수 동의/upload/auth는 그대로 유지.
- account enumeration을 유발하지 않도록 CMS 오류 문구의 정보량을 검증한다.

### 7단계: 이벤트

- `event.auditQuote` 콘텐츠와 안전한 on/off, 일정, 정책 링크를 CMS로 이동.
- HMAC/rate/dedupe/idempotency/origin/consent version은 보호 config로 유지.
- 법적 면책과 개인정보 동의 section에 필수 lock과 version history 적용.

### 8단계: member 화면

- `member.mypage`, `member.requestDetail`.
- empty/error/help/status 표현을 전환하되 point 계산·ledger·paywall·평가/완료 순서는 보호.
- preview에는 fixture만 사용하고 실제 member 데이터와 mutation을 연결하지 않는다.

### 9단계: admin presentation

- 기존 운영 기능의 label/help/empty/error를 `adminPresentation`으로 점진 전환.
- 회원, 포인트, 운영자, 답변, 감사로그 기능과 field key는 그대로 보호.
- admin editor 자체가 잘못된 CMS 값 때문에 사용할 수 없지 않도록 강제 code fallback과 “기본 UI로 열기” recovery path 제공.

### 10단계: partner

- partner Auth role, assigned-request ACL, API/data model이 먼저 구현된 경우에만 `partner.portal` 콘텐츠를 CMS에 연결.
- 현재 공개 prototype sample은 production에서 제거하고 실제 데이터가 CMS 콘텐츠로 섞이지 않게 한다.

## 11. migration 전략

1. 현재 화면 literal을 typed default로 옮기는 작업과 CMS read 연결을 분리해 review한다.
2. 첫 배포는 CMS collection이 비어 있어도 모든 화면이 default로 동일하게 보여야 한다.
3. bootstrap 도구는 기본 `--dry-run`, 명시적 project/environment와 확인 phrase가 있어야만 write한다.
4. production에서 app startup, GET, build가 seed/migration을 실행하지 않는다.
5. migration은 idempotent하고 이미 편집된 draft/published를 덮어쓰지 않는다.
6. FAQ legacy migration은 source/target count와 hash만 보고하고 콘텐츠 원문·PII를 로그에 출력하지 않는다.
7. rollback은 코드 deploy rollback과 content revision rollback을 별도로 문서화한다.

## 12. 테스트 계획

### unit

- page/global schema valid/invalid/old-version migration.
- missing/invalid CMS → exact default fallback.
- design token allowlist와 min/max.
- link/sanitize/alt/heading/required-section validation.
- merge 시 stable item ID와 순서 보존.

### rules emulator

- guest는 published만 read.
- member는 draft/revision/audit/assets 접근 불가.
- admin claim은 허용 범위만 접근.
- direct client write는 published/draft 모두 차단.
- 기존 users/org/ledger privilege escalation regression.
- audit-quote deny-all 유지.

### API integration

- admin token 없는 save/publish/restore 차단.
- stale version conflict.
- public 문서에 actor/draft/internal metadata가 포함되지 않음.
- revision immutable, rollback은 새 draft 생성.
- publish 후 target cache만 invalidation.

### 기존 기능 regression

- signup, consult, event, answer view/rating/complete, FAQ, admin answer/points/member/operator의 endpoint와 payload snapshot.
- visibility guest/org/owner/admin matrix.
- 포인트 최초 1회 차감과 잔액/두 원장 일치.
- required consent와 upload 제한.

### UI/E2E

- guest/member/admin/partner route 접근.
- PC/tablet/mobile preview.
- loading/success/error/empty/denied.
- draft save, auto-save, preview, publish, conflict, diff, rollback.
- keyboard/focus trap/escape, accessible name, contrast, heading.
- CMS 장애 중 public fallback과 admin recovery UI.

### 매 단계 필수 명령

- `npm run typecheck`
- `npm run lint`
- `npm run test:audit-quote`
- 새 CMS/rules/E2E test
- `npm run build`

기존 lint warning과 test warning은 별도 baseline으로 유지해 새 오류와 구분한다.

## 13. 구현 단위 권장

큰 일괄 변경 대신 다음 review 단위로 나눈다.

1. 보안 rules/admin auth/partner route.
2. CMS type/default/validator와 tests.
3. Firebase repository/rules/API와 tests.
4. admin CMS 목록·editor shell·preview.
5. global header/footer/theme.
6. home/support/pending/404.
7. FAQ migration.
8. login/signup/consult/inquiries.
9. audit-quote event.
10. member 화면.
11. admin presentation.
12. partner portal은 인증 기능과 함께 별도 범위.

각 단위는 CMS 편집과 public fallback이 함께 완성되어야 하며, 화면 literal만 먼저 옮기고 editor를 미래 작업으로 남기지 않는다.

## 14. 주의사항

- 기존 `components/SignupForm.tsx`에는 조사 시작 전 사용자 변경이 있으므로 구현 시 덮어쓰지 않는다.
- CMS document에 collection name, internal field, endpoint를 넣지 않는다.
- 공개본에 actor, draft note, revision metadata를 넣지 않는다.
- page content와 운영 master data(농협 목록, user, wallet, request)를 같은 CMS에 저장하지 않는다.
- 운영 sample/prototype 데이터를 default content로 재사용하지 않는다.
- CMS 장애를 사용자 오류 화면으로 바꾸지 않는다.
- admin 화면도 CMS 값 오류 때문에 잠기지 않도록 hard fallback과 recovery mode를 유지한다.
- 자동 게시, 자동 production migration, build-time production write를 금지한다.

## 15. 완료 판단

각 pageKey는 다음을 모두 통과해야 완료다.

- `/admin`에서 찾고 업무 용어로 편집 가능.
- draft 저장과 실제 renderer의 PC/tablet/mobile preview 가능.
- publish diff, 영향 route, revision, rollback 제공.
- CMS 누락/invalid/장애 시 현재와 같은 code default 표시.
- public은 published만 읽고 draft/actor/audit에 접근 불가.
- form payload·저장 키·인증·포인트·ACL이 기존 contract와 동일.
- loading/success/error/empty/denied와 접근성 test 통과.
- typecheck, lint, test, production build 통과.
