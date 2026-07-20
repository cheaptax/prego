## 변경 요약

- 

## CMS 신규 기능 완료 체크

사용자 화면이나 사용자 노출 기능을 추가·변경한 경우 확인합니다.

- [ ] 중앙 CMS 등록부에 key, 업무용 이름, route와 접근 권한을 등록했습니다.
- [ ] contentSchema, editorSchema, defaultContent와 schemaVersion이 있습니다.
- [ ] 인증·권한·저장 키·API·계산식 등 보호 대상을 정의했습니다.
- [ ] 실제 화면 renderer 기반 미리보기와 `/admin` 메뉴를 연결했습니다.
- [ ] fallback, 초안/게시 분리와 보호 계약 테스트를 추가했습니다.
- [ ] 예외인 경우 `docs/CMS_ROUTE_EXCEPTIONS.json`에 사유·담당자·검토일을 기록했습니다.
- [ ] PC·태블릿·모바일과 관련 guest/member/admin 상태를 확인했습니다.

## 검증

- [ ] `npm run cms:audit`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run test:integration`
- [ ] `npm run test:cms:rules`
- [ ] `npm run test:e2e`
- [ ] `npm run build`

## 보호 대상 또는 예외 설명

- 없음 / 아래에 설명:
