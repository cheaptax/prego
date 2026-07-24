# Admin Auth Migration (custom-token → Firebase password)

이 문서는 CMS/관리자 콘솔 개발을 유지한 채, 관리자 로그인을 Firebase 이메일·비밀번호 + `admin: true` custom claim 방식으로 전환하기 위한 **수동 bootstrap** 절차다.

비밀번호·토큰·서비스 계정 키는 이 문서에 적지 않는다.

## 권한 모델 (확인된 형식만 사용)

런타임 관리자 판별은 **custom claim `admin: true` + Firestore 활성 관리자 프로필 + RBAC capability**를 함께 사용한다.

| 계층 | 확인 방식 |
|------|-----------|
| 로그인 리다이렉트 (`LoginForm`) | `getIdTokenResult().claims.admin === true` |
| Admin API (`requireAdmin`) | `decoded.admin === true`, `users/{uid}.role == "admin"`, `status == "active"` |
| 세부 Admin API (`requireAdminCapability`) | 위 조건 + `adminRole` 프리셋/allow/deny override로 계산한 capability |
| Firestore / Storage rules | `request.auth.token.admin == true` + 활성 Firestore admin profile |
| Firestore `users/{uid}.adminRole` | `super_admin`, `operations_manager`, `partner_manager`, `cms_editor`, `read_only`; legacy missing 값은 안전한 bootstrap 호환을 위해 `super_admin`으로 취급 |

레거시 `POST /api/auth/admin-login`은 코드상 410으로 비활성화되어 있다. **현재 운영 배포가 아직 구버전이면 custom-token 로그인은 그대로 동작**한다. 이 이관 작업은 Auth 사용자에 비밀번호를 부여하는 것이며, 구 custom-token 경로를 즉시 제거하지 않는다.

## 절대 하지 말 것

- Vercel/CI 빌드에서 `seed:admin` 자동 실행
- 사용자를 삭제 후 재생성
- 관리자 이메일 변경
- 비밀번호를 코드·Git·채팅·문서·로그에 기록
- 운영 데이터 초기화
- 이관 검증 전에 프로덕션 배포

## 사전 조건

- 로컬에 Firebase Admin 자격 증명 (`FIREBASE_*`)이 `.env.local`에 있음
- `ADMIN_EMAIL=admin@gmail.com` (이메일 변경 금지)
- `ADMIN_PASSWORD`는 **셸에서만** 설정 (`.env.local`에서 읽지 않음)
- 대상 production project ID: `nong-1af31` (로컬 `.env.local`의 `FIREBASE_PROJECT_ID`와 일치해야 함)

## 이관 절차

### 1) 대상 Firebase project ID 확인

```powershell
# 값이 nong-1af31 인지 확인 (비밀번호 출력 금지)
node -e "const fs=require('fs');for(const l of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){if(l.startsWith('FIREBASE_PROJECT_ID='))console.log(l)}"
```

### 2) dry-run

```powershell
npm run seed:admin -- --dry-run --expected-project nong-1af31
```

또는:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/seed-admin-secure.ps1 -ExpectedProject nong-1af31 -DryRun
```

### 3–4) 이메일·UID·기존 custom claims 확인

dry-run 출력에서 다음을 기록한다(비밀번호 제외).

- `email=admin@gmail.com`
- `uid=...` (이후 단계에서 동일해야 함)
- `customClaims=...`
- `adminClaim=true|false`
- `firestoreAdminRole=super_admin` 또는 legacy missing

### 5) 새 비밀번호 준비 (사용자 직접)

- 최소 **8자** (권장 **12자** 이상)
- Cursor 채팅·소스·Git 추적 파일·명령줄 인수에 넣지 말 것
- 비밀번호 관리 프로그램에 보관
- 아래 6단계에서 숨김 입력으로만 전달

### 6) 운영 확인 후 적용

```powershell
powershell -ExecutionPolicy Bypass -File scripts/seed-admin-secure.ps1 -ExpectedProject nong-1af31 -ConfirmProduction
```

스크립트가 숨김으로 비밀번호를 받은 뒤 `npm run seed:admin -- --expected-project nong-1af31 --confirm-production`을 실행하고, 종료 시 셸의 `ADMIN_PASSWORD`를 제거한다.

동등한 수동 방법(비밀번호를 화면에 표시하지 않도록 주의):

```powershell
$env:ADMIN_PASSWORD = Read-Host -AsSecureString | ForEach-Object {
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($_);
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
npm run seed:admin -- --expected-project nong-1af31 --confirm-production
Remove-Item Env:ADMIN_PASSWORD
```

### 7–8) UID·claim 재확인

```powershell
npm run check:admin-ready -- --expected-project nong-1af31
```

- `uid`가 3단계에서 본 값과 동일한지 확인
- `adminClaim=true` 인지 확인
- exit code `0` 이어야 함

### 9) 토큰 갱신

이미 브라우저에 로그인된 세션이 있으면 로그아웃 후 다시 로그인하거나 `getIdToken(true)`로 강제 갱신한다. 새 배포 코드는 로그인 직후 `getIdTokenResult(true)`를 사용한다.

### 10) 새 로그인 방식 검증 (운영 URL UI는 변경하지 않음)

운영 `https://project-eta-one-64.vercel.app` 은 구 custom-token 빌드가 떠 있을 수 있으므로, **배포 전**에는 로컬에서 production Firebase를 가리키는 빌드로 검증한다.

```powershell
npm run build
npm run start
# http://localhost:3000/login 에서 admin@gmail.com + 새 비밀번호로 로그인
```

검증 체크리스트:

- [ ] Firebase 비밀번호 로그인 성공
- [ ] UID가 기존 UID와 동일
- [ ] ID token에 `admin: true`
- [ ] `users/{uid}`가 `role=admin`, `status=active`, `adminRole=super_admin` 상태
- [ ] `/admin` 접근 성공
- [ ] `/api/admin/overview` → 200
- [ ] 관리자 Firestore 읽기 성공
- [ ] 관리자 쓰기/Storage는 **테스트 전용 문서/경로만** 사용 후 즉시 정리 (업무 데이터 금지)
- [ ] 새로고침 후 세션 유지
- [ ] 무한 redirect 없음
- [ ] 로그아웃 후 `/admin` 차단
- [ ] 일반 사용자 `/admin` 차단

### 11) 배포 가능 상태

다음이 모두 참일 때만 새 코드 배포를 진행한다(이 문서 범위 밖·별도 승인).

```powershell
npm run check:admin-ready -- --expected-project nong-1af31
npm run typecheck
npm run lint
npm run test:cms
npm run build
```

배포 전 체크리스트 경고:

> `check:admin-ready`가 실패하면 배포하지 말 것. 관리자 비밀번호 로그인·`admin` claim이 준비되지 않은 상태에서 새 `LoginForm`을 올리면 관리자 로그인이 실패한다.

## CI / Vercel

- `seed:admin`을 빌드·Preview·Production 배포 훅에 넣지 않는다.
- 이유: 비밀번호 재설정, 시크릿 로그 노출, 잘못된 프로젝트 변경, Preview→Production 오염.
- 관리자 추가·claim 변경은 콘솔의 Operators API 또는 이 수동 seed를 사용한다.
- 비밀번호 변경과 claim 변경은 가능하면 분리한다(seed는 전환용 bootstrap).

## 운영 보호·롤백 여유

- 이관(비밀번호 부여) 자체는 구 custom-token 로그인을 깨지 않아야 한다(동일 UID·claim 유지).
- 새 배포 이후에도 레거시 시크릿/`admin-login` 관련 값은 **즉시 삭제하지 말고**, 전환 확인 후 별도 작업으로 정리한다.

## 관련 명령

| 명령 | 역할 |
|------|------|
| `npm run seed:admin -- --dry-run --expected-project <id>` | 읽기 전용 점검 |
| `npm run seed:admin -- --expected-project <id> --confirm-production` | 비밀번호·claim 적용 |
| `npm run check:admin-ready -- --expected-project <id>` | 배포 전 읽기 전용 준비 검사 |
| `scripts/seed-admin-secure.ps1` | 숨김 비밀번호 입력 도우미 |
