# 농협지원센터 · NH Support Center

Next.js (App Router · TypeScript) 기반 농협지원센터 플랫폼.

- 회원가입 / 문의 접수 / 마이페이지
- 관리자 콘솔 (`/admin`)
- Firebase Auth · Firestore · Storage
- Vercel 배포: https://project-eta-one-64.vercel.app

## 다른 PC에서 처음 세팅하기

### 1. 코드 받기

```bash
git clone https://github.com/wowonjin/pregosuv.git
cd pregosuv
```

### 2. 환경 변수 넣기

**방법 A — transfer 파일이 있을 때 (USB 등으로 함께 복사)**

프로젝트 폴더에 `env.local.transfer` 파일을 넣은 뒤:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1
```

**방법 B — 수동**

`.env.example`을 복사해 `.env.local`을 만들고 Firebase 값을 채운 뒤:

```bash
npm install
npm run dev
```

> `.env.local`과 `env.local.transfer`는 GitHub에 올라가지 않습니다. USB·메일 등으로만 옮기세요.

### 3. 실행

```bash
npm run dev
```

- 사이트: http://localhost:3000
- 관리자: http://localhost:3000/admin
- 관리자 로그인은 Firebase 이메일·비밀번호 + `admin: true` claim (절차: [docs/ADMIN_AUTH_MIGRATION.md](docs/ADMIN_AUTH_MIGRATION.md))
- 감사평가 관리자 운영 방법:
  [docs/AUDIT_EVALUATION_ADMIN_OPERATIONS.md](docs/AUDIT_EVALUATION_ADMIN_OPERATIONS.md)
- 감사평가 보안경계·보존 운영:
  [docs/AUDIT_EVALUATION_SECURITY_BOUNDARY.md](docs/AUDIT_EVALUATION_SECURITY_BOUNDARY.md)
- 감사평가 운영 배포·롤백·인수인계:
  [docs/AUDIT_EVALUATION_PRODUCTION_RUNBOOK.md](docs/AUDIT_EVALUATION_PRODUCTION_RUNBOOK.md)

## Vercel 배포

배포 전에 관리자 계정 이관이 끝났는지 확인하세요. `seed:admin`은 CI/Vercel 빌드에 넣지 마세요.

```bash
npm run check:admin-ready -- --expected-project <FIREBASE_PROJECT_ID>
vercel deploy --prod
```

Vercel 대시보드에도 `.env.local`과 동일한 환경 변수를 등록해야 합니다. `ADMIN_PASSWORD`는 Vercel에 넣지 않습니다.

## 스크립트

| 명령 | 설명 |
|------|------|
| `npm run dev` | 로컬 개발 서버 |
| `npm run build` | 프로덕션 빌드 |
| `npm run lint` | ESLint |
| `npm run seed:admin` | 관리자 Auth bootstrap (수동, `--dry-run` / `--confirm-production`) |
| `npm run check:admin-ready` | 배포 전 관리자 claim 읽기 전용 검사 |
| `npm run preflight:audit-evaluation` | 감사평가 운영 환경·데이터 읽기 전용 dry-run |
| `node scripts/smoke-prod.mjs` | 배포 URL 스모크 테스트 |

## 환경 변수

| 변수 | 용도 |
|------|------|
| `NEXT_PUBLIC_FIREBASE_*` | 클라이언트 Firebase 설정 |
| `FIREBASE_PROJECT_ID` | 서버 Firebase Admin |
| `FIREBASE_CLIENT_EMAIL` | 서비스 계정 이메일 |
| `FIREBASE_PRIVATE_KEY` | 서비스 계정 개인키 |
| `ADMIN_EMAIL` | 관리자 로그인 이메일 |
| `ADMIN_PASSWORD` | seed apply 시에만 셸에 설정 (Git/Vercel/문서에 저장 금지) |

템플릿: [.env.example](.env.example)
