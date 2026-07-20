# 메인 화면 CMS 연결 검증

검증일: 2026-07-21  
비교 기준: 현재 운영 `/`와 로컬 CMS 코드 기본값 `/`

## 화면 비교

같은 Chromium과 글꼴 환경에서 운영 화면과 변경 후 로컬 화면을 각각 전체 페이지로 캡처했다.

- PC: 1440×1200 viewport, 결과 이미지 1440×6820
- 모바일: 390×844 viewport, 결과 이미지 404×10272
- PC의 7개 섹션 높이: `928, 1069, 786, 1315, 772, 695, 951px`로 전후 동일
- 모바일의 7개 섹션 높이: `1084, 1833, 1623, 2342, 994, 951, 845px`로 전후 동일
- 전체 높이: PC `6820px`, 모바일 `10272px`로 전후 동일
- 픽셀 차이: PC `0.045%`, 모바일 `0.106%`
- 브라우저 console/page error: PC·모바일 모두 없음
- 링크 목적지 배열: 상단 메뉴, 인증 버튼, 푸터 모두 전후 동일

작은 픽셀 차이는 서로 다른 요청 시점의 SVG 애니메이션/안티앨리어싱 프레임에 해당하며, DOM 크기와 전체 레이아웃은 동일하다.

## 레이아웃 이동

PerformanceObserver의 `layout-shift` 누적값:

- PC: 운영 `0.0280`, 변경 후 `0.0269`
- 모바일: 운영 `0.0171`, 변경 후 `0.0171`

CMS 페이지와 FAQ는 서버 HTML에 게시 snapshot 또는 코드 기본값으로 포함된다. hydration 후 localStorage나 FAQ client fetch로 본문을 교체하지 않으므로 CMS 연결로 추가된 콘텐츠 깜박임은 없다. 인증 상태 확인 뒤 상단 인증 버튼이 나타나는 기존 동작은 유지한다.

## 데이터와 권한

- 공개 loader는 `resolvePublishedPage`와 `resolvePublishedGlobals`만 호출한다.
- 공개 loader에는 `getDraftPage`/`getDraftGlobal` 호출이 없다.
- 페이지와 공통 영역의 초안 저장, 게시, 이력 복원 API는 모두 `requireAdmin(request)`를 통과해야 한다.
- 공통 영역 복원은 공개본을 즉시 바꾸지 않고 새 초안을 만든다.
- 게시 성공 뒤 페이지 route 또는 전체 layout을 재검증한다.
- CMS 문서 또는 Firebase 연결이 없으면 코드 기본값을 서버에서 즉시 렌더링한다.

## 실행 검증

- `npm run typecheck`
- `npm run lint`
- `npm run test:cms`
- `npm run test:audit-quote`
- `npm run build`

Firebase Rules emulator 실검증은 JDK 21 환경에서 `npm run test:cms:rules`로
실행하며 Firestore·Storage guest/member/admin 행렬이 통과했다. CI도
Temurin 21에서 같은 명령을 실행한다.

## 전체 CMS 재검증 보완

2026-07-21 전체 재검증에서 다음을 추가로 확인·수정했다.

- 홈 모바일 `센터 소개` 카드가 ID 선택자의 우선순위 때문에 2열로 남아
  14px 가로 넘침을 만들던 문제를 1열 규칙으로 수정했다.
- Pretendard Variable을 외부 CSS import 대신 로컬 WOFF2 preload로 바꾸고
  첫 글꼴 교체로 인한 문의 게시판 CLS를 `0.1766`에서 최대 `0.0532`로 낮췄다.
- 중앙 등록부의 17개 route를 PC·태블릿·모바일 51개 조합으로 검사했고
  가로 넘침, 접근 가능한 이름, hydration 오류와 브라우저 console 오류가
  없음을 확인했다.
- 홈 제목, 모바일 제목 크기, 카드 순서, FAQ, 이미지 참조를 초안으로
  변경하고 게시·이력·복원·롤백하는 통합 흐름과 stale version 충돌을
  메모리 Firestore에서 검증했다.
