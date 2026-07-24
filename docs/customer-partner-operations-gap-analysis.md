# 고객·제휴사·운영 관점 기능 갭 분석

## 이번 구현에 포함한 P0

- 고객: 제휴사가 확정한 견적서를 이메일 첨부로 수신하고, 로그인 후 `/mypage/quotes`와 `/mypage/quotes/[quoteId]`에서 PDF를 다운로드할 수 있다.
- 제휴사: `/partner/apply`에서 제휴 신청을 접수하고, 승인된 제휴사는 `/partner`에서 배정 견적을 작성·임시저장·최종확정할 수 있다.
- 운영자: 제휴사 관리 탭에서 직역, 업무범위, 제휴 신청 승인/반려, 공통 견적요청 배정, 제출 견적 수와 발송 상태를 확인할 수 있다.
- 시스템: `quoteRequests`, `quoteAssignments`, `quotes`, `quoteEmailDeliveries`로 일반 상담과 감사견적을 같은 견적 도메인에서 추적한다.
- 시스템: Resend 발송 실패 건은 `quoteEmailDeliveries` outbox에 남고 `/api/internal/quote-emails/retry` cron에서 재시도한다.
- 시스템: 회계감사 견적은 게시된 평가기준에서 입력항목을 자동 생성하고, 정량점수·구조화 평가정보·전자서명 문서 식별자를 견적 PDF와 감사평가 업로드 흐름에 연결한다.
- 보안: 신규 Firestore 컬렉션과 `partner-assets/**`, `quotes/**` Storage 경로는 클라이언트 직접 접근을 차단하고 서버 API에서 권한을 확인한다.

## 고객 관점 P1/P2

- P1: 여러 제휴사 견적 비교 화면, 만료 임박 알림, 반려·문의하기 버튼.
- P1: 감사견적 비회원 신청자가 가입 전 받은 메일과 가입 후 견적함이 연결되는 안내 강화.
- P2: 견적서 열람 이력, 다운로드 횟수, 고객 확인/선정 상태 표시.

## 제휴사 관점 P1/P2

- P1: 제휴 신청 진행상태 조회, 보완 요청/자료 재제출, SLA 알림.
- P1: 견적 항목 다중 행 편집 UI, 사업자등록증·직인 이미지, 공급자 상세 프로필 관리.
- P2: 견적 템플릿 저장, 과거 견적 복제, 제출 후 고객 열람/다운로드 상태 확인.

## 운영자 관점 P1/P2

- P1: 제휴 신청 보완 요청, 심사 담당자 배정, 승인 전 중복 업체 병합.
- P1: 견적 재발송 버튼, Resend webhook 서명 검증 고도화, 반송 사유 상세 노출.
- P1: 파트너 계정 claim/Firestore 동기화 정기 점검.
- P2: CSV 내보내기, 직역별 성과 리포트, 고객 선택률/응답시간 분석.

## 배포 체크리스트

- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET`, `NH_SUPPORT_BASE_URL`를 운영 환경에 등록한다.
- Resend 발신 도메인을 검증하고 SPF/DKIM/DMARC 상태를 확인한다.
- Vercel Cron이 `/api/internal/quote-emails/retry`를 호출할 수 있도록 `CRON_SECRET`을 운영 환경에 등록한다.
- `/admin/operations`에서 완성된 감사평가 기준을 게시하고 `AUDIT_EVALUATION_ACTIVE_CONFIG_ID`를 해당 기준 ID로 지정한다.
- 감사평가 연동을 사용할 때 `AUDIT_EVALUATION_ENABLED=true`와 32바이트 이상의 `AUDIT_EVALUATION_DOCUMENT_SIGNING_SECRET`을 운영 환경에 등록한다.
- 제휴사에서 발행한 감사 견적 PDF를 고객 평가 화면에 업로드했을 때 문서가 `VERIFIED`로 식별되고 구조화 평가정보가 자동 반영되는지 확인한다.
- `npm run migrate:partners -- --expected-project <project> --apply --confirm-production`으로 기존 제휴사 `profession` 기본값을 보완한다.
- `npm run cms:audit`, `npm run typecheck`, `npm run lint`, 관련 테스트와 production build를 통과한 뒤 배포한다.
