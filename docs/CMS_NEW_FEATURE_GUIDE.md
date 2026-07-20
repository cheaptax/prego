# 신규 기능 CMS 개발 가이드

기준 문서: `NH_PREGO_SOFTCODING_RULES.md`  
강제 검사: `npm run cms:audit`

## 중앙 등록부

모든 사용자 화면은 `lib/cms/feature-registry.ts`의
`CMS_FEATURE_REGISTRY`에 완전한 정의가 있어야 한다.

정의에는 다음 값이 필수다.

- 안정적인 `pageKey`
- 사용자용 화면 이름
- App Router `route`
- 접근 권한
- 런타임 `contentSchema`
- 비개발자용 `editorSchema`
- 장애 시 사용할 `defaultContent`
- 인증·권한·저장 키·API 등 `protectedTargets`
- 실제 화면 미리보기 `previewRenderer`
- `/admin` 메뉴 표시 정보
- fallback 테스트 경로
- `schemaVersion`

기존 구조에서는 `constants.ts`, `defaults.ts`, 화면별 presentation 정의를
등록부가 하나의 정의로 결합한다. 새 key를 일부 파일에만 추가하면 TypeScript의
`Record<CmsPageKey, ...>` 검사 또는 `cms:audit`가 실패한다.

## 생성 스크립트

```bash
npm run cms:create -- \
  --key public.example \
  --name "업무용 화면 이름" \
  --route /example \
  --access guest,member \
  --renderer generic
```

Windows PowerShell에서는 줄바꿈 없이 같은 인자를 전달해도 된다.

스크립트는 다음 뼈대를 함께 만든다.

- 런타임 콘텐츠 schema
- 코드 기본 콘텐츠
- 관리자 editor definition
- 공통 형식의 기능 definition
- fallback 테스트
- 생성된 기능 전용 `REGISTER.md`

생성 결과는 의도적으로 자동 게시하거나 운영 Firebase에 쓰지 않는다.
`REGISTER.md`에 따라 중앙 key/route와 등록부에 연결하기 전에는 완료가 아니다.
route만 만든 상태에서는 `npm run cms:audit`가 실패해야 정상이다.

## 개발 순서

1. 화면에 표시되는 콘텐츠와 보호할 기능 계약을 먼저 구분한다.
2. 생성 스크립트로 schema/default/editor/test 뼈대를 만든다.
3. `CMS_PAGE_KEYS`와 `CMS_PAGE_ROUTES`에 안정 key와 실제 route를 등록한다.
4. 기본 콘텐츠와 업무용 editor presentation을 중앙 등록부에 연결한다.
5. `previewRenderer`가 실제 공개 화면 renderer를 사용하도록 dispatch를 연결한다.
6. `/admin` 목록과 PC·태블릿·모바일 미리보기에서 화면을 확인한다.
7. fallback, 초안/게시 분리, 보호 payload와 권한 회귀 테스트를 완성한다.
8. 아래 명령을 모두 통과시킨다.

```bash
npm run cms:audit
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run test:cms:rules
npm run test:e2e
npm run build
```

## route 검사 방식

`cms:audit`는 컴포넌트 문자열을 검색하지 않는다. Node 파일 시스템 API로
`app/**/page.tsx` 계열 파일을 탐색하고 App Router 규칙에 따라 route group과
parallel segment를 정규화한 뒤 중앙 등록부의 route와 비교한다.
`app/not-found.tsx`는 `/_not-found`로 검사한다. API route는 사용자 화면이
아니므로 비교 대상이 아니다.

CMS 편집 도구처럼 사용자 콘텐츠 화면이 아닌 page는
`docs/CMS_ROUTE_EXCEPTIONS.json`에 다음을 모두 기록해야 한다.

- 정확한 route
- 허용된 예외 종류
- 20자 이상의 구체적인 사유
- 담당자
- 재검토 날짜

존재하지 않는 route의 오래된 예외도 검사 실패로 처리한다.

## 신규 기능 완료 체크리스트

### 등록과 편집

- [ ] `pageKey` 또는 `featureKey`가 표시 문구와 분리되어 있다.
- [ ] 사용자용 이름, route, 접근 권한과 schemaVersion이 등록되어 있다.
- [ ] runtime contentSchema와 editorSchema가 있다.
- [ ] 모든 표시 필드에 업무용 한국어 라벨과 도움말이 있다.
- [ ] CMS 장애 시 사용할 검증된 defaultContent가 있다.
- [ ] 실제 공개 renderer를 사용하는 미리보기가 등록되어 있다.
- [ ] `/admin` 페이지 목록에서 코드·DB 지식 없이 찾을 수 있다.

### 보호 계약

- [ ] 인증, 권한, 내부 field name, 저장 키와 API endpoint를 CMS 입력과 분리했다.
- [ ] 계산식, 개인정보 접근, 파일 제한과 필수 동의 여부를 보호 대상으로 기록했다.
- [ ] 선택지 표시 label과 저장 value를 분리했다.
- [ ] 법적 필수 영역은 숨김·삭제·잠금 해제가 불가능하다.

### 수명주기와 검증

- [ ] 초안은 공개 loader에서 읽지 않는다.
- [ ] 게시, 이력과 rollback이 동작한다.
- [ ] fallback 테스트가 중앙 등록부에 연결되어 있다.
- [ ] guest/member/admin 및 loading/error/empty/denied 상태를 검증했다.
- [ ] PC·태블릿·모바일 미리보기를 검증했다.
- [ ] `cms:audit`, typecheck, lint, unit/integration, Rules emulator, E2E와 production build가 통과한다.

## 의도적인 예외

보안·법률·데이터 무결성 때문에 CMS 등록이 부적절한 사용자 route만 예외로
둘 수 있다. 단순 일정 부족이나 추후 작업 예정은 예외 사유가 아니다.
예외는 `CMS_ROUTE_EXCEPTIONS.json`과 PR 설명에 함께 기록하고 검토일 전에
재승인하거나 제거한다.
