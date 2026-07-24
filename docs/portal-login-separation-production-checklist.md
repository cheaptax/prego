# 포털 로그인 경로 분리 배포 전 체크리스트

작성일: 2026-07-22  
현재 판정: **배포 금지 — BLOCKED**  
운영 배포·운영 Firebase/Auth 변경: 수행하지 않음

`/partner/login`, `/admin/login`, Footer 로그인 링크와 URL route guard가
구현되기 전에는 staging 승인 또는 production 배포로 진행하지 않는다.

## 1. 코드와 변경 범위

- [ ] `/partner/login` route와 제휴사 전용 안내가 구현됐다.
- [ ] `/admin/login` route와 운영자 전용 안내가 구현됐다.
- [ ] 공통 `LoginForm`이 요청 포털과 허용 계정 유형을 명시적으로 받는다.
- [ ] 포털 불일치 정책이 세 로그인 화면에 동일하게 적용된다.
- [ ] 고객·제휴사·관리자 보호 경로 목록과 route guard가 확정됐다.
- [ ] 기존 `/login` 호환/redirect 정책이 확정됐다.
- [ ] Footer desktop/mobile에 제휴사·운영자 로그인 링크가 있다.
- [ ] 세 로그인 페이지가 모두 `noindex, nofollow`다.
- [ ] 관련 변경이 현재 대규모 미커밋 작업에서 분리돼 review 가능하다.
- [ ] `git diff --check`가 통과한다.

현재 확인:

- [x] `/login` noindex 적용
- [x] 고객 API의 non-member/비활성 계정 차단 보강
- [x] 관리자·제휴사의 서버 API 권한 경계 존재
- [x] portal boundary 단독 테스트 4/4 통과
- [x] production build 통과

## 2. Firebase 환경변수 확인

- [ ] `NEXT_PUBLIC_FIREBASE_API_KEY`
- [ ] `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- [ ] `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- [ ] `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- [ ] `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- [ ] `NEXT_PUBLIC_FIREBASE_APP_ID`
- [ ] Preview와 Production의 project ID가 의도한 Firebase project와 일치한다.
- [ ] client 환경변수에 Admin private key나 서버 secret이 없다.

근거: `lib/firebase/client.ts`, `.env.example`

## 3. Firebase Admin 환경변수 확인

- [ ] `FIREBASE_PROJECT_ID`
- [ ] `FIREBASE_CLIENT_EMAIL`
- [ ] `FIREBASE_PRIVATE_KEY`
- [ ] 필요 시 `FIREBASE_STORAGE_BUCKET`
- [ ] multiline private key의 `\n` 변환이 정상이다.
- [ ] Preview와 Production service account 권한이 최소 범위다.
- [ ] 환경변수 값이나 private key를 로그·체크리스트에 붙여 넣지 않았다.

근거: `lib/firebase/admin.ts`

## 4. 운영 최고관리자 Auth 계정 확인

- [ ] 승인된 최고관리자 Firebase UID를 확인했다.
- [ ] Firebase Auth user가 존재하고 `disabled=false`다.
- [ ] `admin:true` custom claim이 있다.
- [ ] 최소 2개의 활성 `super_admin`을 확보했다.
- [ ] 기존 관리자 비밀번호 로그인이 실제 staging에서 성공한다.
- [ ] `POST /api/auth/admin-login`이 410을 반환함을 확인했다.
- [ ] 운영 계정 변경 전 별도 승인과 rollback 기록을 확보했다.

권장 read-only 확인: `npm run check:admin-ready -- --expected-project <id>`

## 5. 운영자 Firestore 프로필 확인

- [ ] `users/{uid}.role === "admin"`
- [ ] `accountStatus === "active"`
- [ ] `adminRole`이 명시돼 있고 허용된 5개 역할 중 하나다.
- [ ] allow/deny permission이 허용 목록 안에 있다.
- [ ] Auth email과 profile email이 일치한다.
- [ ] `adminRole` 누락 profile이 없다.
- [ ] migration dry-run의 UID-role map을 2인 이상 검토했다.

## 6. 운영자 역할과 상태 확인

- [ ] `super_admin`
- [ ] `operations_manager`
- [ ] `partner_manager`
- [ ] `cms_editor`
- [ ] `read_only`
- [ ] `invited`, `suspended`, `disabled` 운영자가 API 403을 받는다.
- [ ] 역할별 허용 메뉴와 API permission이 일치한다.
- [ ] 마지막 활성 최고관리자 강등·정지·삭제가 차단된다.

## 7. 제휴사 테스트 계정 확인

- [ ] Firebase Auth user가 staging 전용 계정이다.
- [ ] `partner:true` claim이 있다.
- [ ] `users.role === "partner"`다.
- [ ] `users.partnerId`가 실제 partner 문서를 가리킨다.
- [ ] `users.accountStatus === "active"`다.
- [ ] `partners/{partnerId}.status === "active"`다.
- [ ] paused/terminated 계정을 별도로 준비했다.
- [ ] 다른 partnerId의 배정·견적·첨부에 접근할 수 없다.

## 8. 고객 테스트 계정 확인

- [ ] Firebase Auth user가 staging 전용 계정이다.
- [ ] `users.role === "member"`다.
- [ ] active 고객 계정이 있다.
- [ ] pending/rejected 고객 계정이 있다.
- [ ] Auth email과 profile email이 일치한다.
- [ ] 고객이 `/api/admin/**`, `/api/partner/**`에서 403을 받는다.
- [ ] 고객 own/org/public 데이터 경계가 예상대로다.

## 9. 기존 관리자 로그인 경로 확인

- [ ] `/login`을 기존 관리자 호환 경로로 유지할지 결정했다.
- [ ] 유지 시 admin 계정이 `/admin`으로 이동한다.
- [ ] redirect로 전환 시 loop 없이 `/admin/login`으로 이동한다.
- [ ] 기존 bookmark, 문서, 운영 runbook을 갱신했다.
- [ ] `/api/auth/admin-login` 410 동작과 구버전 배포 여부를 확인했다.

## 10. 새 로그인 경로 확인

- [ ] `/login` — 고객
- [ ] `/partner/login` — 제휴사
- [ ] `/admin/login` — 내부 운영자
- [ ] `/mypage` — 고객 포털
- [ ] `/partner` — 제휴사 포털
- [ ] `/admin` — 관리자 콘솔
- [ ] 세 로그인 페이지 모두 직접 새로고침과 deep link가 동작한다.
- [ ] 공개 로그인 page가 route guard에 의해 차단되지 않는다.

현재 `/partner/login`, `/admin/login`은 존재하지 않는다.

## 11. Vercel Preview 배포

- [ ] 별도 review branch/PR을 만들었다.
- [ ] Preview 환경변수를 staging Firebase로 연결했다.
- [ ] production Firebase를 Preview에서 사용하지 않는다.
- [ ] Vercel Preview build가 통과한다.
- [ ] Preview URL 접근 권한과 테스트 담당자를 확인했다.
- [ ] Preview runtime log에서 secret/token/password 노출이 없다.

이번 단계에서는 Preview 배포를 수행하지 않았다.

## 12. 고객 로그인 테스트

- [ ] active 고객: `/login` → `/mypage`
- [ ] pending 고객: `/login` → `/pending-approval`
- [ ] 잘못된 비밀번호: 안전한 일반 오류
- [ ] 비밀번호 재설정: 존재 여부를 과도하게 노출하지 않음
- [ ] local/session persistence 선택이 예상대로다.
- [ ] logout 후 고객 API가 401을 반환한다.
- [ ] admin/partner 계정은 고객 포털 데이터를 받지 못한다.

## 13. 제휴사 로그인 테스트

- [ ] active 계정: `/partner/login` → `/partner`
- [ ] missing partner claim: 403 또는 명확한 불일치 처리
- [ ] missing partner profile/partnerId: 403
- [ ] paused/terminated partner: 403
- [ ] 다른 partner assignment/quote 접근: 403 또는 404
- [ ] logout 후 partner API: 401

## 14. 운영자 로그인 테스트

- [ ] active admin: `/admin/login` → `/admin`
- [ ] admin claim 없음: 403 또는 명확한 불일치 처리
- [ ] member/partner profile: 관리자 API 403
- [ ] invited/suspended/disabled: 관리자 API 403
- [ ] 역할별 permission matrix가 적용된다.
- [ ] logout 후 관리자 API: 401

## 15. 잘못된 포털 로그인 테스트

- [ ] 고객 계정으로 `/partner/login`
- [ ] 고객 계정으로 `/admin/login`
- [ ] 제휴사 계정으로 `/login`
- [ ] 제휴사 계정으로 `/admin/login`
- [ ] 운영자 계정으로 `/login`
- [ ] 운영자 계정으로 `/partner/login`
- [ ] 직접 `/mypage`, `/partner`, `/admin` 접근
- [ ] 자동 이동, 오류, logout 정책이 설계와 일치한다.
- [ ] redirect loop가 없다.

## 16. 비활성 계정 테스트

- [ ] 비활성 고객의 기존 ID token으로 고객 API 403
- [ ] 비활성 운영자의 기존 ID token으로 관리자 API 403
- [ ] 비활성 제휴사 계정의 기존 ID token으로 partner API 403
- [ ] active 계정이 연결된 paused/terminated partner에서 partner API 403
- [ ] 상태 변경 직후 token refresh 전에도 Firestore profile 재검사로 차단
- [ ] Auth disabled/claim/profile 부분 실패를 탐지하고 복구할 절차가 있다.

## 17. Footer 링크 테스트

- [ ] desktop Footer에 제휴사 로그인 링크
- [ ] desktop Footer에 운영자 로그인 링크
- [ ] label과 href 오탈자 없음
- [ ] 약관·개인정보처리방침·사업자/운영 주체 정보와 시각적으로 구분
- [ ] 키보드 focus와 accessible name 확인
- [ ] CMS draft/publish/rollback에서 링크가 보존됨

현재 두 로그인 링크는 구현되지 않았다.

## 18. 모바일 테스트

- [ ] 390px viewport
- [ ] 480px breakpoint
- [ ] 720px breakpoint
- [ ] Footer link touch target이 충분하다.
- [ ] 로그인 input/button이 가로 넘침 없이 보인다.
- [ ] 키보드 표시 시 submit/recovery 조작이 가능하다.
- [ ] screen reader label과 focus 순서를 확인했다.
- [ ] mobile E2E에서 console error와 horizontal overflow가 없다.

현재 공통 E2E의 mobile 포함 72개 시나리오는 통과했으나 전용 로그인 URL은
존재하지 않아 검증하지 못했다.

## 19. API 401·403 확인

- [ ] token 없음 → 401
- [ ] invalid/expired token → 401
- [ ] 유효 token, 잘못된 role/claim → 403
- [ ] inactive profile → 403
- [ ] permission 부족 → 403
- [ ] partner status inactive → 403
- [ ] cross-partner resource → 403 또는 정보 비노출 404
- [ ] body의 partnerId가 인증 profile 범위를 바꾸지 못함

## 20. 자동 테스트와 production build

- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] portal boundary test 4/4
- [x] `npm run test:partner` 11/11
- [x] `npm run test:cms` 92/92
- [x] `npm run test:e2e` 24 routes, 72 scenarios
- [x] `npm run build`
- [ ] `npm test`
- [ ] Java 21에서 Firestore/Storage Rules emulator suite
- [ ] 실제 staging 계정 기반 API/UI smoke

현재 `npm test` 실패 원인은
`lib/admin/testing/migration-seed-index.test.ts`의 기대 index 2개와
`firestore.indexes.json`의 실제 index 4개 불일치다.

## 21. 로그와 모니터링 확인

- [ ] 401/403/409 비율 dashboard 또는 query 준비
- [ ] login 실패 급증 알림
- [ ] Auth disabled/claim sync 실패 알림
- [ ] admin/partner 상태 변경 audit log
- [ ] password, ID token, Authorization header, private key 미기록
- [ ] 운영자 역할·상태 변경 actor/target/result 기록
- [ ] rollback 직후 확인할 log query 준비

## 22. 프로덕션 배포

- [ ] 위 BLOCKED 항목이 모두 해결됐다.
- [ ] 변경 PR이 승인됐다.
- [ ] Firestore backup/export를 완료했다.
- [ ] migration dry-run 결과를 승인했다.
- [ ] Rules/index/application 배포 순서를 승인했다.
- [ ] 배포 시간과 담당자, rollback 담당자를 지정했다.
- [ ] 프로덕션 배포 승인 후에만 실행한다.

이번 단계에서는 프로덕션 배포를 수행하지 않았다.

## 23. 배포 후 즉시 점검

- [ ] `/login`, `/partner/login`, `/admin/login` HTTP 200
- [ ] `/mypage`, `/partner`, `/admin` 계정별 접근
- [ ] 기존 관리자 `/login` 호환 또는 redirect
- [ ] Footer desktop/mobile 링크
- [ ] 고객·제휴사·운영자 API 200/401/403
- [ ] password reset
- [ ] logout과 기존 token 차단
- [ ] Vercel runtime error와 Firebase Auth error 급증 없음

## 24. 롤백 준비

- [ ] 직전 production deployment 식별
- [ ] 직전 Firestore/Storage Rules ruleset 식별
- [ ] index는 즉시 삭제하지 않는 원칙 확인
- [ ] migration 전 Firestore export
- [ ] admin UID-role/accountStatus/claim inventory
- [ ] partner profile/status/linked account inventory
- [ ] 앱 rollback 후 Auth/profile 재동기화 절차
- [ ] rollback smoke 담당자와 판정 기준

## 배포 게이트

**BLOCKED**

해제 조건은 전용 로그인 URL, 포털별 불일치 정책, route guard/legacy redirect,
Footer 링크 구현과 전체 테스트 green이다.
