# 관리자 운영자·제휴사 Production 반영 체크리스트

작성일: 2026-07-22  
상태: 실행 전  
주의: 이 문서는 실행 순서다. 이번 검증에서는 배포, migration apply,
운영 Auth/Firestore 변경을 수행하지 않았다.

## 1. 담당자·변경 승인

- [ ] 배포 담당자, Firebase 담당자, rollback 승인자를 지정했다.
- [ ] 코드 변경과 운영 데이터 migration을 별도 승인 단위로 분리했다.
- [ ] staging 검증 결과와 알려진 제한사항을 승인자가 확인했다.
- [ ] production maintenance/monitoring 시간을 확정했다.

## 2. 환경변수

- [ ] `FIREBASE_PROJECT_ID`가 대상 production project와 정확히 일치한다.
- [ ] `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`가 설정돼 있다.
- [ ] `NEXT_PUBLIC_FIREBASE_*`가 같은 project를 가리킨다.
- [ ] smoke용 `SMOKE_ADMIN_EMAIL`, `SMOKE_ADMIN_PASSWORD`는 CI/secret store에만 있다.
- [ ] password, token, service-account JSON이 저장소·로그·명령 이력에 없다.
- [ ] audit quote/evaluation feature flag와 webhook/cron secret을 검토했다.

## 3. Firebase Admin·운영 관리자

- [ ] 배포 runtime service account가 Auth user/claims와 Firestore/Storage에 필요한 최소 권한을 갖는다.
- [ ] 운영 관리자 Auth user와 `users/{uid}` profile이 모두 존재한다.
- [ ] `role=admin`, `adminRole`, `accountStatus/status`, `admin` claim이 일치한다.
- [ ] 최소 2개 이상의 활성 `super_admin` 확보를 권고하고 담당자를 확인했다.
- [ ] 이메일 문자열이 아니라 Firebase UID로 최고관리자 대상을 승인했다.

## 4. migration dry-run

- [ ] `npm run migrate:admin-rbac -- --help`로 최신 옵션을 확인했다.
- [ ] `npm run migrate:admin-rbac -- --expected-project <project-id> --role-map <path>` dry-run 결과를 저장했다.
- [ ] `npm run migrate:partners -- --expected-project <project-id>` dry-run 결과를 저장했다.
- [ ] UID-to-role JSON map을 2인 이상이 검토했다.
- [ ] 누락 role mapping과 예상치 못한 `super_admin` mapping이 0건이다.
- [ ] dry-run 대상 project ID와 결과 건수를 기록했다.
- [ ] `status -> accountStatus` inventory를 별도로 검토했다.
- [ ] Auth disabled/claims와 Firestore profile 불일치 목록을 검토했다.
- [ ] linked partner account와 partner status 불일치 목록을 검토했다.
- [ ] rollback snapshot의 저장 위치와 접근 권한을 확인했다.

## 5. 테스트·빌드

- [ ] Node/Java 버전이 CI와 일치한다.
- [ ] Java 21 이상을 사용한다.
- [ ] `npm ci`
- [ ] `npm run cms:audit`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run test:admin-rbac`
- [ ] `npm run test:partner`
- [ ] `npm test`
- [ ] `npm run test:integration`
- [ ] `npm run test:cms:rules`
- [ ] `npm run test:audit-evaluation:rules`
- [ ] audit-evaluation Firestore emulator E2E flow가 skip 없이 실행됐다.
- [ ] `npm run verify:audit-report-pdf`
- [ ] `npm run test:e2e`
- [ ] `npm run build`
- [ ] `npm run dev`가 정상 기동되고 localhost HTTP smoke가 200을 반환한다.

## 6. Firebase 배포 순서

- [ ] Firestore Rules diff와 rollback 파일을 검토했다.
- [ ] Storage Rules가 partner의 전체 상담 첨부파일 직접 read를 허용하지 않는다.
- [ ] `firestore.indexes.json`의 partner assignment indexes를 검토했다.
- [ ] Firestore Indexes를 먼저 배포하고 build 완료 상태를 확인했다.
- [ ] Firestore Rules를 배포했다.
- [ ] Storage Rules를 배포했다.
- [ ] Rules 배포 직후 guest/member/admin/partner 접근 matrix를 확인했다.
- [ ] 애플리케이션을 staging에 배포했다.
- [ ] staging 검증 후에만 production 애플리케이션을 배포했다.

## 7. 애플리케이션 smoke

- [ ] 기존 최고관리자 로그인이 성공한다.
- [ ] 관리자 dashboard와 모든 허용 메뉴가 열린다.
- [ ] VIEWER/read_only에 쓰기 버튼이 노출되지 않거나 API가 403을 반환한다.
- [ ] 운영자 목록 조회가 성공한다.
- [ ] 운영자 생성 후 Auth/profile/claim/status가 일치한다.
- [ ] 상위 역할 생성·변경이 차단된다.
- [ ] 마지막 활성 최고관리자 강등·정지·삭제가 차단된다.
- [ ] 운영자 비활성화 후 기존 token을 포함한 API가 거부된다.
- [ ] 제휴사 목록·생성이 성공한다.
- [ ] 제휴사 상태 변경이 API 정책에 반영된다.
- [ ] paused/terminated partner가 로그인/API를 사용할 수 없다.
- [ ] partner scope와 다른 category 배정이 거부된다.
- [ ] partner가 다른 partner의 assignment/draft/attachment에 접근하지 못한다.
- [ ] 제출된 partner draft가 revision request 전 수정되지 않는다.

## 8. 기존 기능 회귀

- [ ] 기존 견적 관리 조회·상태 변경·알림 재시도
- [ ] 고객/회원 승인·거부·문의·답변
- [ ] 포인트 조정과 ledger
- [ ] 감사평가 보고서 조회·재생성 권한
- [ ] CMS 편집·게시·복원
- [ ] 관리자 메뉴 이동과 로그인 redirect
- [ ] 기존 Firebase 회원 가입·로그인·승인대기 흐름
- [ ] `seed-admin` dry-run과 `check-admin-ready`
- [ ] STEP 9 완료 보고서의 COMPLETE/PARTIAL 판정과 실제 staging 결과가 일치한다.

## 9. 감사 로그

- [ ] 운영자 생성·역할·override·상태·비밀번호·삭제 기록을 확인했다.
- [ ] 제휴사 생성·수정·상태·계정·배정·초안 기록을 확인했다.
- [ ] actor UID/email/role, required permission, target, timestamp가 맞다.
- [ ] password, token, reset link, credential이 before/after/metadata에 없다.
- [ ] denied/failed mutation 관측과 correlation 방법을 확인했다.

## 10. migration apply

- [ ] 별도 승인 티켓이 있다.
- [ ] rehearsal project에서 동일 role map과 rollback을 검증했다.
- [ ] apply 직전 최소 2개 활성 최고관리자를 재확인했다.
- [ ] 승인된 `--role-map`, `--apply`, 확인 옵션만 사용한다.
- [ ] apply 결과 건수와 UID를 dry-run 결과와 대조했다.
- [ ] `check-admin-ready`와 수동 로그인을 다시 실행했다.
- [ ] Auth/profile reconciliation 결과가 0건이다.

## 11. 롤백 준비

- [ ] 직전 application artifact와 배포 ID를 기록했다.
- [ ] 직전 Firestore/Storage Rules를 보관했다.
- [ ] migration 전 role/status/claim snapshot을 보관했다.
- [ ] 코드 rollback과 Auth/profile reconciliation 순서를 문서화했다.
- [ ] 담당자와 rollback 판단 기준을 합의했다.
- [ ] rollback 중 계정을 hard delete하지 않는다.

## 12. 모니터링

- [ ] 관리자 401/403/5xx 비율
- [ ] `inactive_account`, `operator_management_denied`, `last_super_admin` 발생
- [ ] Firebase Auth update/claim 실패
- [ ] Firestore permission/index 오류
- [ ] partner scope/assignment 접근 거부
- [ ] audit log write 실패
- [ ] 운영자·제휴사 생성 latency와 부분 실패
- [ ] login redirect loop와 관리자 menu 오류
- [ ] 배포 후 최소 24시간 모니터링 담당자 지정

## 승인 Gate

- [ ] 데이터 migration 승인 완료
- [ ] Java 21 Rules emulator 통과
- [ ] staging smoke 통과
- [ ] rollback rehearsal 완료
- [ ] production configuration 검토 완료

현재 Gate: **NEEDS_DATA_MIGRATION_APPROVAL**
