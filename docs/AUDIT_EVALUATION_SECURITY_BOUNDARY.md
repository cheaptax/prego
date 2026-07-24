# 감사인 견적 평가 보안경계와 보존 운영

## 접근경계

- 평가 관련 Firestore 컬렉션과 Storage 경로는 Firebase 클라이언트에서 모두 거부한다.
- 고객 접근은 HttpOnly·Secure·SameSite=Strict 세션 쿠키를 검증하는 서버 API만 사용한다.
- 세션은 `caseId`에 결합되며 다른 평가 건 ID로 재사용할 수 없다.
- 관리자 API는 Firebase `admin: true` custom claim과 `users/{uid}`의 `role=admin`, `status=active`를 모두 확인한다.
- 점수 계산, 설정 게시, 보고서 생성, 최종 Storage 경로 확정과 감사로그 쓰기는 Admin SDK 서버 코드만 수행한다.

관리자 화면이나 기능 플래그는 권한 수단이 아니다. 화면이 숨겨져 있어도 API와 Rules 검증은 동일하게 적용된다.

## API 방어

- 고객 변경 API는 정확한 Origin과 `application/json`을 확인한다.
- JSON 본문은 엔드포인트별 바이트 상한을 적용한다.
- 공개 이메일 요청은 존재 여부와 관계없이 같은 응답과 최소 응답시간을 사용한다.
- 접근링크 교환은 HMAC 기반 IP 키로 Firestore rate limit을 적용한다. IP 원문은 저장하지 않는다.
- 접근토큰은 원문을 저장하지 않고 HMAC 해시만 저장하며, 일회 사용·만료·교체 시 재사용을 거부한다.
- 업로드 intent와 보고서 생성은 idempotency 및 버전 충돌 검사를 사용한다.
- 파일 ID, case ID와 Storage 경로는 허용 문자만 조합하며 사용자 입력 경로를 직접 사용하지 않는다.
- 다운로드 파일명은 고정 규칙으로 생성하여 CR/LF와 경로 문자를 포함할 수 없다.
- 사용자 텍스트는 React/PDF 텍스트 노드로만 렌더링하며 자유 HTML·JavaScript를 실행하지 않는다.

## Storage 경계

- `originals`, `quarantine`, `reports`, `temp`는 모두 직접 읽기·쓰기를 거부한다.
- 업로드는 15분 만료 signed URL로 격리 경로에만 받고, PDF MIME·크기·magic bytes·구조를 서버에서 재검증한다.
- 검증 완료 후에만 `{caseId}/{documentId}` 최종 원본 경로로 이동한다.
- 보고서는 공개 URL을 사용하지 않고 case 권한 재검증 후 짧은 signed URL을 발급한다.

## 보존정책

게시된 평가설정에서 다음 기간을 일 단위로 관리한다.

- 원본 견적서
- 평가 중간데이터
- 보고서
- 만료 접근토큰·세션
- 감사로그

`자동 만료 처리`는 기본값이 꺼져 있다. 켜서 게시할 때 경고 확인이 필요하다.

관리자는 보고서 설정 화면에서 삭제 대상 dry-run을 확인할 수 있다. 실행 요청에는 15분 이내의 `asOf`와 대상 `planHash`가 필요하며, 대상이 바뀌면 실행을 거부한다. 한 번에 최대 200건을 처리해 서버리스 실행시간과 Firestore batch 한도를 지킨다.

- 원본 삭제: 원본 파일과 문서 레코드만 삭제하며 보고서는 별도 기간까지 유지한다.
- 중간데이터 삭제: 추출·정정·확정·처리 데이터를 삭제한다.
- 보고서 삭제: PDF, view model과 보고서 실행 레코드를 삭제하여 다운로드가 불가능해진다.
- 삭제 감사로그: 분류, 식별자와 처리결과만 기록하며 문서 내용은 남기지 않는다.

Vercel Cron은 매일 한국시간 오전 3시에 서버 전용 경로를 호출한다. `CRON_SECRET`, 전체 기능 플래그와 게시된 `deleteAfterExpiry=true`가 모두 있어야 실제 삭제한다.

## 감사 이벤트

평가 건 생성, 링크 발급·교체·철회, 업로드·삭제, 추출 결과, 고객·관리자 정정, 고객 확정, 평가 실행, 설정 게시, 보고서 생성·재생성·다운로드, 접근 거부와 보존 만료 처리를 기록한다.

로그에는 비밀번호, 토큰 원문, 이메일 원문, 문서 원문이나 평가 입력 전체를 기록하지 않는다.

## 배포 전 확인

```powershell
npm run test:audit-evaluation:rules
npm run test:audit-evaluation
npm run typecheck
npm run lint
npm run build
```

Firebase Emulator 실행에는 JDK 21 이상이 필요하다. Emulator 공격 테스트, 전체 테스트와 빌드가 모두 통과하기 전에는 다음 플래그를 활성화하지 않는다.

- `AUDIT_EVALUATION_ENABLED`
- `AUDIT_EVALUATION_CUSTOMER_ENTRY_ENABLED`
- `AUDIT_EVALUATION_REPORT_DOWNLOAD_ENABLED`
- `AUDIT_EVALUATION_ADMIN_ENABLED`
