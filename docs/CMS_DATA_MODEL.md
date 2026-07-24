# CMS data model

기준일: 2026-07-20  
스키마 버전: `1`  
최우선 규칙: `NH_PREGO_SOFTCODING_RULES.md`

## 1. 범위

CMS 기반과 함께 비개발자용 `/admin` 콘텐츠 관리자 콘솔을 구현한다.

- 공개 게시본과 관리자 초안의 물리적 분리
- 페이지·공통 영역·수정 이력·감사로그·미디어 모델
- TypeScript 타입, Zod 런타임 스키마, 코드 기본값
- Firestore repository와 공개 resolver
- Firestore/Storage Rules와 권한 행렬 테스트
- dry-run이 기본인 idempotent bootstrap/migration 도구
- Firebase `admin` custom claim만 사용하는 관리자 권한 판단
- 대시보드, 페이지, 공통 영역, 디자인, 이미지·파일, 수정·게시 이력 메뉴
- 기본값을 포함한 페이지 목록, 검색·분류, 미리보기와 안전한 게시 흐름

기존 회원가입, 상담, 이벤트, 포인트, 회원/조직 Firestore collection과 폼 payload는 변경하지 않는다.

## 2. Collection과 공개 범위

### 공개 읽기

- `cmsPublishedPages/{pageKey}`
- `cmsPublishedGlobals/{documentKey}`

공개 게시본에는 renderer가 필요한 정규화된 콘텐츠만 저장한다. 관리자 UID, 내부 메모, 초안 상태, 변경 사유와 감사정보는 저장하지 않는다.
`cmsAssets` 메타데이터에는 업로더와 수명주기 정보가 있으므로 관리자만 읽는다.
공개 화면은 신뢰된 서버 loader가 게시 파일 URL만 해석해 전달한다.

### 관리자 전용 읽기

- `cmsDraftPages/{pageKey}`
- `cmsDraftGlobals/{documentKey}`
- `cmsPageRevisions/{pageKey}/revisions/{revisionId}`
- `cmsGlobalRevisions/{documentKey}/revisions/{revisionId}`
- `cmsAuditLogs/{logId}`
- `cmsAssets/{assetId}`의 draft/archived 메타데이터

Firestore client의 CMS 직접 쓰기는 관리자에게도 허용하지 않는다. 저장·게시·복원은 `FirestoreCmsRepository`를 사용하는 신뢰된 Admin SDK API에서 수행한다.

기존 `users`, `organizations`, `pointLedger`도 현재 애플리케이션이 이미 사용하는 Admin SDK API만 쓰도록 client create/update/delete를 차단했다. collection과 field, 폼 payload, 서버 transaction은 변경하지 않으면서 회원 승인·역할·조직 잔액·포인트 원장의 직접 변조 경로를 제거한다.

### Storage

- `cms/published/{assetId}/{fileName}`: 공개 파일 읽기, client 쓰기 금지
- `cms/drafts/{assetId}/{fileName}`: admin custom claim 읽기와 신규 업로드만 허용

CMS 업로드는 10MB 이하 JPEG, PNG, WebP, GIF, PDF만 허용한다. SVG, HTML과 기존 파일 덮어쓰기는 차단한다. finalize API가 Storage의 실제 MIME과 크기를 다시 확인하며, 페이지 게시 시 참조된 초안 파일을 Admin SDK가 공개 경로로 복사하고 메타데이터 상태를 갱신한다.
회원가입 명함도 같은 MIME allowlist를 사용하고 소유자의 최초 생성만 허용하며
client overwrite와 delete는 차단한다.

## 3. 안정적 식별자

### pageKey

`home`, `auth.login`, `auth.signup`, `auth.pendingApproval`, `legal.terms`, `legal.privacy`, `public.consult`, `public.inquiries`, `public.faq`, `public.support`, `event.auditQuote`, `event.auditQuoteEvaluate`, `event.auditQuoteEvaluation`, `event.auditQuoteEvaluationReview`, `event.auditQuoteEvaluationReport`, `member.mypage`, `member.requestDetail`, `partner.portal`, `admin.console`, `admin.operations`, `framework.notFound`

route는 `lib/cms/constants.ts`의 `CMS_PAGE_ROUTES`에 고정한다. CMS 문서의 route가 고정 route와 다르면 resolver가 사용하지 않는다.

### documentKey

`siteIdentity`, `header`, `footer`, `support`, `defaultSeo`, `theme`, `statusMessages`, `adminPresentation`

section, 반복 item, action, asset도 표시 문구와 무관한 stable ID를 사용한다. 중복 ID는 스키마 검증에서 거부한다.

## 4. 문서 shape

### Published page

필수 필드는 `schemaVersion`, `pageKey`, `route`, `content`, `version`, `status: "published"`, `publishedAt`이다. 선택적으로 허용된 `theme` preset만 포함한다.

### Draft page

Published page의 편집 콘텐츠에 `basePublishedVersion`, `status: "draft"`, `createdAt/By`, `updatedAt/By`, 선택적 `internalNote`를 추가한다. `version`은 optimistic concurrency 확인에 사용한다.

Global 문서는 `pageKey/route` 대신 `documentKey`를 사용하고 `CmsGlobalContent`를 저장한다.

### Revision

Revision은 당시 정규화된 published snapshot, version, revision action, 생성 시각과 actor UID를 저장한다. client update/delete를 허용하지 않는다. 복원은 revision 자체를 바꾸거나 즉시 게시하지 않고 새 draft를 만든다.

### Audit log

감사로그는 target type/key, action, from/to version, actor UID, server timestamp와 최소 metadata만 저장한다. 콘텐츠 원문, 비밀번호, token, 이메일과 개인정보는 metadata에 기록하지 않는다.

### Asset

Asset metadata는 asset ID, 상태, Storage path, 원본 파일명, MIME, byte size, 이미지 dimension, alt, focal point와 관리자 전용 actor/timestamp를 가진다. 게시 상태와 Storage path prefix가 다르면 검증에 실패한다.

## 5. 콘텐츠와 디자인 스키마

`lib/cms/schemas.ts`의 모든 object schema는 strict mode다. 알 수 없는 field는 저장·렌더링 전에 거부한다.

- 본문은 plain text와 구조화된 section/item/action만 사용한다.
- `script`, `style`, `iframe`, event handler, `javascript:`와 HTML data URL 패턴을 거부한다.
- 링크는 내부 `/` 경로, page anchor, HTTPS, `mailto`, `tel`만 허용한다.
- raw HTML, raw CSS, JavaScript, class name 필드는 없다.
- 디자인은 palette, text scale, spacing, radius, alignment allowlist만 사용한다.
- SEO title/description 길이, asset type/size/dimension, 배열 개수와 stable ID를 검증한다.
- 필수 기능·법정 section은 `locked` 기본 section으로 지정하고 누락을 거부한다.

## 6. Repository와 resolver

`lib/cms/repository.ts`:

- 공개 page/global 단일 조회
- page와 필요한 global을 `Firestore.getAll` 한 번으로 batch 조회
- root layout에서 `siteIdentity`, `header`, `footer`, `support` 게시본을 한 번에 batch 조회
- version 충돌을 확인하는 draft 저장
- transaction 기반 게시, revision, audit 기록
- revision을 새 draft로 복원
- asset metadata 검증과 감사기록

`lib/cms/resolver.ts`:

- missing, invalid schema, route 불일치, Firestore 오류를 사용자에게 노출하지 않는다.
- 실패한 대상은 `lib/cms/defaults.ts`의 검증된 code default로 반환한다.
- 반환값의 `source`는 `published` 또는 `default`, default version은 `0`이다.
- default는 매번 clone하여 호출자가 전역 기본값을 변경할 수 없다.
- page section별 Firestore 조회 API는 제공하지 않는다.

공개 화면 컴포넌트는 기존 동작을 유지한다. `/admin`은 보호된 요약 API로 CMS 게시본·초안·감사기록을 한 번에 조회하고, 데이터가 없으면 동일 기본값으로 17개 화면과 8개 공통 영역을 표시한다. 메인 페이지 편집기는 일반화한 대체 화면이 아니라 공개 화면과 같은 실제 컴포넌트를 공유해 초안을 즉시 표시한다. 기능 폼의 저장 키와 인증·계산 로직은 renderer 입력에 포함하지 않는다.

메인 페이지의 `CmsSection`은 다음 구조를 사용한다.

- `text`: 강조 문구, 둘째 설명, 접근성 설명처럼 섹션별로 이름이 있는 안전한 일반 텍스트
- `items`: 전문성 카드, 지원 분야, 상담 단계, 게시판 안내, FAQ 같은 반복 항목
- `groups`: 서비스 요약 수치, 센터 소개 요약, 지원 방식, 농협이 체감하는 가치처럼 한 섹션 안에서 의미가 다른 반복 묶음
- `actions`: 내부 화면과 외부 주소가 구분된 CTA
- `style`: 승인된 토큰과 PC·태블릿·모바일 범위값
- `commonOverrides`: 공통 문서를 복사하지 않고 특정 페이지에서만 적용하는 명시적 상단·하단 덮어쓰기

공통 `siteIdentity`, `header`, `footer`, `support`는 `cmsPublishedGlobals`/`cmsDraftGlobals`에 한 번만 저장한다. 메인 페이지 문서에는 이 값을 중복 저장하지 않는다.

관리자 API:

- `GET /api/admin/cms/overview`: 페이지·공통 영역·디자인·파일·최근 작업 요약
- `GET /api/admin/cms/pages/{화면 식별값}`: 초안, 게시 비교본, 이력과 참조 파일
- `PATCH /api/admin/cms/pages/{화면 식별값}`: 초안 자동·직접 저장과 버전 충돌 검사
- `POST /api/admin/cms/pages/{화면 식별값}/publish`: 초안 번호 충돌을 확인한 뒤 게시
- `GET, PATCH /api/admin/cms/globals/{공통 영역 식별값}`: 공통 초안, 게시 비교본, 이력 조회와 초안 저장
- `POST /api/admin/cms/globals/{공통 영역 식별값}/publish`: 공통 초안 게시와 전체 layout 재검증
- `POST /api/admin/cms/globals/{공통 영역 식별값}/revisions/{이력 식별값}/restore`: 이전 공통 게시본을 새 초안으로 복원
- `POST /api/admin/cms/pages/{화면 식별값}/revisions/{버전 식별값}/restore`: 이전 게시본을 새 초안으로 복원
- `POST /api/admin/cms/assets/finalize`: 관리자 업로드의 실제 MIME·크기와 메타데이터 검증

일반 관리자 화면에는 내부 식별값, 저장 경로와 스키마 명칭을 표시하지 않는다. 자세한 사용법과 현재 편집 범위는 `docs/CMS_ADMIN_CONSOLE.md`를 따른다.

페이지 영역 디자인은 자유형 CSS가 아니라 승인된 token과 범위로 저장한다.

- 글꼴 3종, 글자 크기 프리셋과 PC·태블릿·모바일별 12–80px 상세값
- 굵기, 1.0–2.0 줄 간격, 정렬과 승인 색상
- 배경, 간격 프리셋과 기기별 0–160px 위아래 여백
- 테두리, 모서리와 그림자 프리셋
- 목록 항목의 `deleted` 상태는 초안에서 복원할 수 있고 게시본 정규화 시 제거

게시 전에는 필수 문구, 링크 형식, 이미지 대체 설명, 제목 순서, 색상 대비와 상세 디자인 범위를 검사한다. 오류는 게시를 막고 경고는 확인 후 게시할 수 있다.

## 7. schemaVersion과 migration

현재 버전은 `1`이다. 모든 read는 runtime schema 검증 전에 `lib/cms/migrations.ts`의 순차 migration registry를 통과한다.

- `schemaVersion`이 없는 문서는 legacy version `0`으로 취급한다.
- `0 -> 1` migration은 원본을 mutate하지 않고 version field를 추가한다.
- 현재 코드보다 높은 version은 자동 변환하지 않고 code default로 fallback한다.
- migration 후에도 전체 current schema와 page/document identity를 다시 검증한다.

새 버전 추가 시 `n -> n+1` 함수, old-version test와 idempotency test를 함께 추가해야 한다.

## 8. Bootstrap/migration 운영

명령:

```text
npm run cms:bootstrap
npm run cms:bootstrap -- --help
```

기본 실행은 Firebase 초기화도 하지 않는 offline dry-run이며 대상 key만 출력한다. 실제 검사나 쓰기에는 project와 environment를 명시해야 한다.

- `--inspect`: read-only 검사
- `--apply`: 누락 문서만 create
- `--include-published`: 명시한 경우에만 게시본 기본값도 대상에 포함
- `--migrate-existing`: 알려진 old schema만 migration
- apply 필수값: `--project`, `--environment`, `--actor`, 정확한 `--confirm`
- production apply는 추가 `--allow-production` 없이는 거부

기존 문서가 있으면 콘텐츠를 덮어쓰지 않는다. schema migration은 transaction에서 현재 version을 다시 확인한다. 로그에는 collection/key/version/count만 출력하고 콘텐츠 원문을 출력하지 않는다.

이번 구현·검증 중에는 `--inspect`, `--apply`, seed 또는 migration을 어떤 Firebase project에도 실행하지 않았다.

## 9. 권한

서버 `requireAdmin`, 관리자 화면 진입과 Rules의 관리자 판정은 모두 Firebase ID token의 `admin == true` custom claim만 사용한다. 이메일 문자열 fallback과 shared-credential custom-token endpoint는 사용하지 않는다.

관리자 계정은 별도 운영 절차에서 Firebase Auth 사용자에게 custom claim을 부여한다. claim 변경 후에는 ID token refresh가 필요하다.

## 10. 테스트

- `npm run test:cms`: schema, XSS/link 차단, default fallback, migration, 관리자 목록 fallback·업무 라벨·권한, Rules 정적 계약
- `npm run test:cms:rules`: 로컬 Firestore/Storage emulator의 guest/member/admin read/write 행렬
- `npm run test:integration`: 초안, 게시, 충돌, 이력, 복원과 fallback 전체 흐름
- `npm run test:e2e`: 17개 route의 PC·태블릿·모바일, 접근 가능한 이름, 가로 넘침, hydration·console 오류와 CLS
- `npm run typecheck`
- `npm run lint`
- `npm run test:audit-quote`
- `npm run build`

Emulator 실행은 `demo-cms-local` project ID만 사용하며 운영 Firebase를 사용하지 않는다. Firebase CLI 최신 버전은 JDK 21 이상이 필요하며 CI는 Temurin 21로 실제 Firestore·Storage Rules 검사를 실행한다.
