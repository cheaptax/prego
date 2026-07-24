# 관리자 운영자·제휴사 최종 Gap 분석

기준일: 2026-07-22  
최종 재검증: STEP 9  
기준: 현재 저장소 코드, 테스트, Firebase Rules  
판정값: `COMPLETE`, `PARTIAL`, `NOT_IMPLEMENTED`, `NOT_REQUIRED`

이 문서는 STEP 1 문서가 저장소에 남아 있지 않아 실제 코드를 기준으로 복원한
분석 기준선이다. STEP 9에서 STEP 6~8 이전의 오래된 판정을 현재 구현과 다시
대조했다.

## 운영자 관리

| 항목 | 판정 | 현재 구현과 남은 gap |
|---|---|---|
| 목록 | COMPLETE | 전용 API, 검색, 역할·상태·소속 필터, 페이지네이션, 최근 로그인과 목록 상태 UI 구현 |
| 등록 | PARTIAL | Auth·Firestore 생성, action 권한·역할 상승·중복 이메일 차단. reset-email/재초대 없음 |
| 수정 | PARTIAL | 기본정보·역할·override·상태·비밀번호 지원. Auth/Firestore 원자 transaction은 아님 |
| 역할 | PARTIAL | 기존 5개 역할과 계층 검증. migration 전 누락 `adminRole` fail-open 호환 유지 |
| 세부 권한 | COMPLETE | 역할 preset, allow/deny, permission preview와 action API 권한 적용 |
| 접근 범위 | NOT_REQUIRED | 내부 운영자는 설계상 `ALL`; 제한 운영자 scope 저장 모델은 미채택 |
| 계정 상태 | PARTIAL | 읽기·필터는 4개 `AdminStatus`; 운영자 write/UI는 active/disabled 중심 |
| 소속 제휴사 | NOT_REQUIRED | 내부 운영자와 외부 `role=partner + partnerId` 계정을 분리 |
| 비밀번호 재설정 | PARTIAL | Auth 비밀번호 변경과 audit redaction. reset email·재초대 없음 |
| 비활성화 | PARTIAL | Auth disabled·claim·profile 동기화. invited/suspended 전체 UI 전이는 없음 |
| 삭제 정책 | PARTIAL | 자기 삭제·마지막 최고관리자 차단. disable-first 강제 없이 hard delete 존재 |
| 감사 로그 | PARTIAL | 성공 mutation before/after와 민감정보 정제. denied·일부 실패 기록은 제한적 |
| 마지막 SUPER_ADMIN 보호 | PARTIAL | 공통 판정과 API guard 존재. 동시 요청 transaction/lock 없음 |

## 제휴사 관리

| 항목 | 판정 | 현재 구현과 남은 gap |
|---|---|---|
| 목록 | COMPLETE | 전용 API/UI, 검색, 유형·상태 필터, 페이지네이션, 계정 수와 목록 상태 구현 |
| 등록 | COMPLETE | 확정 schema 검증, transaction unique-key 예약, audit와 중복 오류 UI |
| 상세 | COMPLETE | 전용 GET에서 기본·담당자·상태·scope·계정·관련 현황 제공 |
| 수정 | COMPLETE | 기본정보·상태·scope별 permission 독립 검사와 위험 변경 확인 modal |
| 상태 | PARTIAL | 4개 상태와 linked Auth sync 구현. sync 실패 자동 reconciliation 없음 |
| 서비스 범위 | COMPLETE | fields 저장·편집과 배정 시 category 일치 검증 |
| 소속 운영자 | NOT_REQUIRED | 내부 운영자를 제휴사에 소속시키는 모델은 미채택 |
| 소속 제휴사 계정 | COMPLETE | 생성·수정·상태·이동·연결 해제 API/UI 구현 |
| 중복 방지 | PARTIAL | 신규·backfill 문서는 transaction key로 보호. legacy key migration 승인 필요 |
| 삭제 정책 | COMPLETE | hard delete 미제공, `terminated` soft 종료와 관계·audit 보존 |
| 감사 로그 | PARTIAL | 주요 partner/account mutation 기록. denied·일부 실패 canonical snapshot은 제한적 |

## 보안

| 항목 | 판정 | 현재 구현과 남은 gap |
|---|---|---|
| API 인가 | PARTIAL | Bearer token, claim, profile, 상태, action permission 검증. legacy role fallback과 동시성 gap 유지 |
| 페이지 접근 | PARTIAL | client denied 화면과 API 401/403. 서버 middleware가 없어 정적 shell은 로드됨 |
| 메뉴·버튼 노출 | COMPLETE | 운영자·제휴사 UI가 공통 permission helper를 사용하고 API가 최종 인가 |
| Firestore Rules | PARTIAL | active status, partner 격리, server-only collection 차단. Java 21 emulator 재검증 필요 |
| Firebase Auth 상태 | PARTIAL | operator/partner 상태와 claims sync. 자동 reconciliation job 없음 |
| 데이터 범위 | COMPLETE | 내부 `ALL`, 외부 `PARTNER + ASSIGNED`, 자기·조직 범위의 공통 판정 구현 |
| 제휴사 격리 | PARTIAL | partnerId, active partner, assignment/draft guard 적용. attachment staging 검증 필요 |

## 실제 원인

초기 기능은 coarse `operators:write`/`partners:write`, legacy `users.status`와
client UI gate 중심이었다. 공통 RBAC를 도입한 뒤 API, UI, Auth, Rules,
migration을 단계적으로 정렬하면서 두 모델이 한동안 공존했다.

현재 코드 gap은 핵심 CRUD 부재가 아니라 migration 전 legacy fallback,
전체 운영자 상태 lifecycle, 마지막 super-admin 동시성, Auth/Firestore
reconciliation, Rules emulator와 staging 검증에 집중돼 있다.
