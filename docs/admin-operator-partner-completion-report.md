# 관리자 운영자·제휴사 구현 완료 보고서

작성일: 2026-07-22  
검증 단계: STEP 9  
검증 기준: 현재 working tree의 실제 코드와 로컬·격리 테스트  
운영 배포·운영 Firestore/Auth 변경·migration apply: 수행하지 않음

## 1. Executive Verdict

**PARTIALLY_COMPLETE**

운영자·제휴사 관리의 핵심 목록, 등록, 상세, 수정, 역할·세부 권한,
상태, 계정 연결, 서버 API 인가, Rules 경계와 감사 로그는 구현됐다.
최종 검증에서 제휴사 상태/범위 전용 권한의 저장 불일치, 운영자 생성 실패 시
Auth 고아 계정 가능성, 감사 로그 역할 표기를 수정했다.

코드와 격리 회귀 테스트는 통과했다. 다만 운영 데이터 migration 승인,
Java 21 Rules emulator 재검증, 실제 staging 계정 lifecycle과 rollback 검증이
남아 있어 production 완료로 판정하지 않는다.

## 2. 초기 문제

- 운영자 mutation이 coarse `operators:write`에 집중돼 있었다.
- 역할, 세부 권한, 데이터 범위와 계정 상태가 분리되지 않았다.
- 운영자 목록·편집 UI의 역할 선택과 보호 정책이 부족했다.
- 제휴사 전용 목록·상세·계정 lifecycle과 중복 방지가 불완전했다.
- 제휴사 상태가 연결 계정과 partner API 접근에 일관되게 반영되지 않았다.
- 관리자 쓰기 경계와 Firestore/Storage Rules가 새 `accountStatus` 모델과 달랐다.
- 누락 `adminRole`을 최고관리자로 해석하는 legacy 호환 동작이 있었다.

## 3. 분석 결과

실제 원인은 기존 coarse capability·legacy `users.status` 모델과 새 RBAC 모델이
API, UI, Auth, Rules, migration에서 서로 다른 속도로 전환된 것이었다.
STEP 3~8에서 공통 권한 엔진, action permission, 운영자·제휴사 API/UI,
Auth 동기화, Rules와 migration 안전장치를 연결했다.

STEP 9에서는 실제 코드 기준으로 초기 gap 문서의 오래된 판정을 재검토했다.
운영자 전용 목록 API, 제휴사 상세 API, unique-key transaction, 제휴사 계정
생성·수정·이동·연결 해제와 상태 동기화는 이미 구현된 것으로 확인했다.

## 4. 구현 완료 범위

- 공통 역할·permission·scope·status 타입과 역할별 preset
- 역할 preset → 개별 allow → 개별 deny 순서의 권한 판정
- Firebase ID token, claim, Firestore profile, 활성 상태 기반 서버 인가
- 운영자 목록·등록·수정·비활성화·역할·권한·비밀번호·삭제 API/UI
- 제휴사 목록·등록·상세·수정·상태·scope·계정 lifecycle API/UI
- partner name/contact email transaction unique-key 예약
- partner 상태와 연결 계정 Firebase Auth disabled/claims 동기화
- partnerId와 assignment 기반 데이터 격리
- 민감정보 redaction 감사 로그
- Firestore·Storage Rules와 필요한 composite indexes
- dry-run 우선 seed/migration과 대상 project guard

## 5. 운영자 관리 기능

| 항목 | 판정 | 실제 상태 |
|---|---|---|
| 목록 | COMPLETE | 전용 GET, 검색, 역할·상태·소속 필터, 페이지네이션, 최근 로그인, 로딩·오류·갱신 |
| 등록 | PARTIAL | Auth·Firestore 생성, 역할 계층·중복 이메일·audit 적용. reset-email/재초대는 없음 |
| 수정 | PARTIAL | 기본정보·역할·override·상태·비밀번호 통합 PATCH. Auth/Firestore는 원자 transaction이 아님 |
| 역할 | PARTIAL | 기존 5개 역할과 계층 검증. migration 전 누락 `adminRole` fail-open fallback 유지 |
| 세부 권한 | COMPLETE | 역할 preset, allow/deny, 구조화된 UI preview, action permission API 적용 |
| 접근 범위 | NOT_REQUIRED | 내부 운영자는 설계상 `ALL`이며 제한 scope 모델은 채택하지 않음 |
| 계정 상태 | PARTIAL | 읽기·필터는 4개 `AdminStatus`; 운영자 쓰기 UI는 `active/disabled` 중심 |
| 소속 제휴사 | NOT_REQUIRED | 내부 `role=admin`과 외부 `role=partner + partnerId`를 분리 |
| 비밀번호 재설정 | PARTIAL | Firebase Auth 비밀번호 변경과 audit redaction 적용. reset-email/재초대 없음 |
| 비활성화 | PARTIAL | Auth disabled·admin claim·profile 동기화. invited/suspended 전체 UI 전이는 없음 |
| 삭제 정책 | PARTIAL | 자기 삭제·마지막 최고관리자 삭제 차단. disable-first 강제 없이 hard delete 존재 |
| 감사 로그 | PARTIAL | 성공 mutation before/after와 비밀번호 정제. denied·일부 부분 실패 로그는 제한적 |
| 마지막 SUPER_ADMIN 보호 | PARTIAL | 강등·비활성·삭제 guard 존재. 동시 요청 race lock은 없음 |

## 6. 제휴사 관리 기능

| 항목 | 판정 | 실제 상태 |
|---|---|---|
| 목록 | COMPLETE | 검색, 유형·상태 필터, 페이지네이션, 계정 수, 로딩·빈 결과·오류·갱신 |
| 등록 | COMPLETE | 확정 schema 검증, transaction unique-key, audit, 중복 오류 UI |
| 상세 | COMPLETE | 전용 GET, 기본·담당자·상태·scope·계정·배정/초안/답변 요약 |
| 수정 | COMPLETE | 기본정보·상태·scope별 permission을 독립 검사하고 위험 상태 확인 modal 사용 |
| 상태 | PARTIAL | pending/active/paused/terminated와 연결 Auth sync. 실패 자동 reconciliation 없음 |
| 서비스 범위 | COMPLETE | 저장·수정 UI, category 검증, 배정 시 scope 일치 검증 |
| 소속 운영자 | NOT_REQUIRED | 내부 운영자를 제휴사에 소속시키는 모델은 채택하지 않음 |
| 소속 제휴사 계정 | COMPLETE | 생성·수정·상태·이동·연결 해제와 권한별 UI 제공 |
| 중복 방지 | PARTIAL | 신규·migration 완료 문서는 transaction key로 보호. legacy key backfill 승인 필요 |
| 삭제 정책 | COMPLETE | hard delete 미제공, `terminated` soft 종료와 관계·audit 보존 |
| 감사 로그 | PARTIAL | 주요 제휴사·계정 mutation 기록. denied·일부 실패 canonical snapshot은 제한적 |

## 7. 역할 및 권한 매트릭스

실제 관리자 역할은 `super_admin`, `operations_manager`, `partner_manager`,
`cms_editor`, `read_only`다. 아래 `ADMIN`, `MANAGER`, `OPERATOR`,
`PARTNER_ADMIN`, `PARTNER_OPERATOR`는 요청 개념을 실제 모델에 대응시킨 것이다.

| 요청 유형 | 실제 매핑 | 운영자 목록 | 운영자 생성 | 역할 변경 | 비활성화 | 제휴사 목록 | 제휴사 생성 | 제휴사 상태 | 타 제휴사 | 견적·고객·보고서 | 감사 로그 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SUPER_ADMIN | `super_admin` | 가능 | 가능 | 가능 | 가능 | 가능 | 가능 | 가능 | 가능 | 읽기·쓰기 | 가능 |
| ADMIN | `operations_manager`에 가장 근접 | 가능 | 불가 | 불가 | 불가 | 가능 | 불가 | 불가 | 읽기 가능 | 운영 읽기·쓰기 | 가능 |
| MANAGER | `partner_manager`에 가장 근접 | 불가 | 불가 | 불가 | 불가 | 가능 | 가능 | 가능 | 관리 가능 | 문의·배정만 | 가능 |
| OPERATOR | 별도 role 미채택 | 해당 없음 | 해당 없음 | 해당 없음 | 해당 없음 | 해당 없음 | 해당 없음 | 해당 없음 | 해당 없음 | 해당 없음 | 해당 없음 |
| VIEWER | `read_only` | 가능 | 불가 | 불가 | 불가 | 가능 | 불가 | 불가 | 읽기 가능 | 읽기만 | 가능 |
| PARTNER_ADMIN | 별도 role 미채택, `role=partner` | 불가 | 불가 | 불가 | 불가 | 자기 portal만 | 불가 | 불가 | 차단 | 배정 문의만 | 불가 |
| PARTNER_OPERATOR | 별도 role 미채택, `role=partner` | 불가 | 불가 | 불가 | 불가 | 자기 portal만 | 불가 | 불가 | 차단 | 배정 문의만 | 불가 |
| 비활성 운영자 | inactive admin/partner | 차단 | 차단 | 차단 | 차단 | 차단 | 차단 | 차단 | 차단 | 차단 | 차단 |

`cms_editor`는 CMS·FAQ write와 audit read를 갖고 운영자·제휴사 관리 권한은 없다.
메뉴·버튼은 UX gate이며 API가 최종 권한 경계다.

## 8. 데이터 접근 범위

- `ALL`: 활성 내부 관리자에게 permission이 허용한 리소스 전체
- `ORGANIZATION`: 같은 농협/조직 회원 데이터
- `PARTNER`: 같은 `partnerId`
- `ASSIGNED`: 활성 `partnerAssignments`
- `OWN`: 자기 프로필·자기 리소스

현재 내부 관리자는 모두 `ALL`이다. 외부 partner는 `PARTNER + ASSIGNED`만 사용한다.

## 9. Firebase Auth 연동 방식

- Firebase ID token Bearer 인증을 재사용한다.
- Custom Claims의 `admin`, `partner`, `partnerId`는 coarse gate로 사용한다.
- 역할, permission, override와 account status 원본은 Firestore profile이다.
- 운영자·제휴사 계정 상태 변경 시 Auth disabled와 claims를 동기화한다.
- 제휴사 `paused/terminated`는 연결 계정 API 접근을 차단한다.
- 비밀번호는 Auth에만 전달하며 Firestore·응답·감사 snapshot에 저장하지 않는다.
- 운영자 생성의 profile 저장 실패 시 생성된 Auth user를 삭제하도록 보상 처리한다.

## 10. Firestore 데이터 구조

- 계정: `users/{uid}`
- 제휴사: `partners/{partnerId}`
- 제휴사 unique key: `partnerUniqueKeys/{kind_hash}`
- 배정: `partnerAssignments/{assignmentId}`
- 제휴사 초안: `partnerAnswerDrafts/{assignmentId}`
- 감사 로그: `auditLogs/{logId}`

제휴사-계정 관계의 원본은 `users.partnerId`이며 양방향 UID 배열을 두지 않는다.
시간 필드는 현재 subsystem 관례에 맞춘 ISO UTC string을 사용한다.

## 11. Firestore Rules와 Indexes

- 관리자·제휴사 민감 mutation은 Admin SDK server route로 제한한다.
- Rules는 `accountStatus`를 우선 확인하고 migration 전 `status`만 fallback한다.
- 관리자 client의 전체 `users` read를 제거하고 자기 profile read만 허용한다.
- `auditLogs`, `partnerUniqueKeys`는 client read/write를 명시 차단한다.
- partner direct read는 partnerId, active partner와 assignment를 확인한다.
- 실제 필요한 index는 `partnerAssignments(partnerId,status)`와
  `partnerAssignments(requestId,status)` 두 개다.
- Rules/index는 production에 배포하지 않았다.
- 정적 Rules 계약은 통과했으나 emulator는 로컬 Java 8 때문에 차단됐다.

## 12. 감사 로그

- 운영자 생성·수정·역할·override·상태·비밀번호·삭제
- 제휴사 생성·수정·상태·scope·계정 연결·이동·해제
- partner 배정·회수·초안·승인·수정요청
- actor, required permission, target, before/after, result, request context 기록
- password, token, secret, authorization, cookie, private key, reset link,
  credential key의 재귀적 redaction

STEP 9에서 운영자 역할 metadata가 raw fallback 대신 공통 `getAdminRole()`을
사용하도록 정렬했다.

## 13. migration 방법

1. apply 전 Firestore managed export 또는 동등 backup을 생성한다.
2. `npm run migrate:admin-rbac -- --expected-project <id> --role-map <path>`를
   기본 dry-run으로 실행한다.
3. UID-role map, 누락 role, 예상 super-admin 수를 2인 이상 검토한다.
4. `npm run migrate:partners -- --expected-project <id>` dry-run에서
   변경·invalid·unique-key conflict·failure 수를 검토한다.
5. rehearsal project에서 같은 입력으로 idempotency와 rollback을 검증한다.
6. 별도 승인 후에만 `--apply --confirm-production`을 사용한다.

이번 검증에서는 운영 project dry-run과 apply를 실행하지 않았다.

## 14. seed 방법

1. Firebase Admin 환경변수와 `--expected-project`를 확인한다.
2. `npm run seed:admin -- --dry-run --expected-project <id>`를 먼저 실행한다.
3. 기존 Auth user/profile/claims와 최소 2개 활성 super-admin 계획을 검토한다.
4. 기존 user의 role·override·비밀번호는 보존한다.
5. 승인된 재설정에서만 `--reset-password`와 `ADMIN_PASSWORD`를 사용한다.
6. `npm run check:admin-ready -- --expected-project <id>`로 read-only 확인한다.

실제 계정 생성·변경은 수행하지 않았다.

## 15. 테스트 결과

| 명령 | 결과 |
|---|---|
| `npm run cms:audit` | PASS, route 23 = registry 21 + exception 2 |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run test:admin-rbac` | PASS, 61/61 |
| `npm run test:cms` | PASS, 92/92 |
| `npm test` | PASS, 전체 unit suite |
| `npm run test:integration` | PASS, 6/6 |
| `npm run test:e2e` | PASS, route 21·scenario 63·console error 0 |
| `npm run verify:audit-report-pdf` | PASS, fixture 7 |
| `npm run build` | PASS, static page 51 |
| `npm run dev` + local HTTP smoke | PASS, Ready 1.077s·HTTP 200 |
| seed·migration·readiness `--help` | PASS, write 없이 CLI guard 확인 |
| `npm run test:cms:rules` | BLOCKED, Java 8; Firebase CLI requires Java 21+ |
| `npm run test:audit-evaluation:rules` | BLOCKED, 같은 Java prerequisite |

자동화 회귀 범위에는 관리자 dashboard/menu 계약, 운영자·제휴사 UI/API,
견적, 회원·문의, 보고서/PDF, Firebase 인증·인가와 seed/migration 안전성 검사가
포함된다. 실제 최고관리자 로그인과 실제 Firebase lifecycle은 운영 계정을 사용하지
않기 위해 staging 수동 확인 항목으로 남겼다.

비실패 경고는 Node module-type과 `punycode` deprecation이다.
실제 운영 계정 로그인과 운영 Firebase smoke는 실행하지 않았다.

## 16. 변경 파일 목록

STEP 3~9의 주요 수정 파일:

- `lib/firebase/schema.ts`
- `lib/firebase/server.ts`
- `lib/admin/rbac.ts`
- `lib/admin/audit.ts`
- `lib/admin/menu-permissions.ts`
- `components/AdminDashboard.tsx`
- `components/admin/PartnerManagementPanel.tsx`
- `app/api/admin/operators/route.ts`
- `app/api/admin/operators/[uid]/route.ts`
- `app/api/admin/partners/route.ts`
- `app/api/admin/partners/[partnerId]/route.ts`
- `app/api/admin/partners/[partnerId]/accounts/route.ts`
- `app/api/admin/partners/[partnerId]/accounts/[uid]/route.ts`
- `app/api/partner/**`
- `firestore.rules`
- `storage.rules`
- `firestore.indexes.json`
- `scripts/seed-admin.mjs`
- `scripts/check-admin-ready.mjs`
- `scripts/migrate-admin-rbac.mjs`
- `scripts/migrate-partners.mjs`
- `lib/cms/defaults.ts`
- `app/globals.css`

STEP 9 직접 코드 수정:

- 제휴사 기본정보·상태·scope 변경 권한 독립 판정
- 상태/scope 전용 편집자의 저장 버튼 gate 수정
- 운영자 생성 실패 시 Auth user 보상 삭제
- 운영자 감사 역할 metadata의 공통 resolver 사용
- 미사용 legacy 제휴사 UI 두 컴포넌트 제거
- CMS section copy의 참조 안정성을 보장해 제휴사 목록 무한 재조회와 저장 요청 실패 수정
- 네트워크 단계에서 저장 요청이 실패하면 일반 서버 오류와 구분해 안내
- 관련 API/UI/security 계약 테스트 보강

## 17. 신규 파일 목록

- `components/admin/PartnerManagementPanel.tsx`
- `lib/admin/operator-ui.ts`
- `lib/admin/partner-ui.ts`
- `lib/admin/audit.ts`
- `lib/admin/menu-permissions.ts`
- `lib/partner-management.ts`
- `lib/partner-management-server.ts`
- `scripts/migrate-admin-rbac.mjs`
- `scripts/migrate-partners.mjs`
- `scripts/check-admin-ready.mjs`
- `firestore.indexes.json`
- `docs/admin-rbac-design.md`
- `docs/admin-operator-partner-implementation-plan.md`
- `docs/admin-security-validation-report.md`
- `docs/admin-operator-partner-completion-report.md`
- `docs/admin-operator-partner-production-checklist.md`
- 관련 `lib/admin/testing/*`, `lib/partner/testing/*`

## 18. 프로덕션 반영 전 필수 작업

- Java 21 이상에서 Rules emulator 두 suite 통과
- production admin UID-role map과 partner migration dry-run 승인
- `accountStatus`, Auth disabled/claims와 partner status inventory 검토
- 최소 2개 활성 `super_admin` 확보
- Firestore managed export 또는 동등 backup 생성
- Rules/index/application staging 배포
- 권한별 실제 staging 계정 lifecycle과 rollback rehearsal
- audit log, 401/403/409, Auth sync failure 모니터링 준비

## 19. 수동 확인 항목

- 기존 최고관리자 로그인과 dashboard/menu 이동
- 운영자 생성·역할 변경·비활성화·비밀번호 변경
- 마지막 최고관리자 보호 메시지와 동시 요청
- 제휴사 생성·상태·scope·계정 생성·이동·연결 해제
- paused/terminated partner 로그인·API 차단
- 타 partner assignment/draft/attachment 접근 거부
- 견적·회원/문의·보고서·CMS 회귀
- 긴 이름/이메일, 640px 이하 modal, keyboard focus/Escape
- 감사 로그 actor, permission, target, result와 민감정보

## 20. 알려진 제한사항

- conceptual `ADMIN/MANAGER/OPERATOR/PARTNER_ADMIN/PARTNER_OPERATOR`는
  별도 role이 아니며 기존 역할/계정 종류에 대응한다.
- 운영자 `invited/suspended` 전체 write lifecycle과 reset-email flow가 없다.
- 운영자 delete는 disable-first가 아닌 hard delete다.
- migration 전 누락 `adminRole`의 legacy `super_admin` fallback이 남아 있다.
- 마지막 super-admin count와 mutation이 단일 transaction/lock이 아니다.
- Auth와 Firestore는 원자 transaction이 아니며 자동 reconciliation job이 없다.
- 비인가 직접 URL은 데이터는 차단하지만 정적 client shell은 로드한다.
- partner assignment attachment 전달 흐름은 staging 검증이 필요하다.

## 21. 롤백 방법

1. 애플리케이션을 직전 검증 release로 rollback한다.
2. Firestore/Storage Rules를 직전 승인 ruleset으로 복원한다.
3. 기존 index는 삭제하지 않는다.
4. RBAC migration은 pre-apply export와 승인 UID-role map으로 profile을 복원한다.
5. Partner migration은 partner 문서와 `partnerUniqueKeys`를 같은 시점으로 복원한다.
6. Auth disabled/claims를 backup inventory와 profile 기준으로 재동기화한다.
7. rollback 후 관리자·partner 로그인, 권한과 audit log를 다시 확인한다.

## 22. 다음 권장 작업

1. Java 21 CI/staging에서 Rules emulator suite를 통과시킨다.
2. production UID-role map과 partner migration dry-run을 승인한다.
3. 최소 2개 활성 super-admin을 확보한다.
4. staging에서 운영자·제휴사 lifecycle과 rollback을 rehearsal한다.
5. 별도 승인으로 last-super-admin concurrency와 Auth reconciliation을 강화한다.

## NEXT_GATE

**NEEDS_DATA_MIGRATION_APPROVAL**
