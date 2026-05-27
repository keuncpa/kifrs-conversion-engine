# K-IFRS 컨버전 시스템 배포 가이드

## 사전 준비

1. **Node.js 18+** 설치
2. **Vercel 계정** — https://vercel.com 에서 가입
3. **DART API 키** — 이미 발급 완료 (`.env.local`에 저장됨)

## 로컬 실행 (테스트)

```bash
cd web
npm install

# 고유번호 데이터 미리 다운로드 (최초 1회, 이후 월 1회 갱신)
npm run fetch-corps

npm run dev
```

브라우저에서 http://localhost:3000 접속

## Vercel 배포

### 방법 1: Vercel CLI (추천)

```bash
# Vercel CLI 설치
npm i -g vercel

# 고유번호 다운로드 (빌드 시 자동 실행되지만 미리 해두면 확실)
npm run fetch-corps

# 배포
cd web
vercel

# 프로덕션 배포
vercel --prod
```

첫 배포 시 프로젝트 설정:
- Framework: **Next.js** (자동 감지됨)
- Build Command: `next build` (prebuild에서 고유번호 자동 다운로드)
- Output Directory: `.next`

### 방법 2: GitHub 연동

1. GitHub에 리포지토리 생성 후 push
2. Vercel 대시보드 → New Project → GitHub repo 선택
3. 자동 빌드 및 배포

> **참고**: `npm run build` 실행 시 `prebuild` 스크립트가 자동으로 고유번호를 다운로드합니다.
> Vercel 빌드 환경에서도 DART_API_KEY 환경변수가 설정되어 있으면 자동으로 동작합니다.

## 환경변수 설정 (필수)

Vercel 대시보드 → 프로젝트 → Settings → Environment Variables:

| 변수명 | 값 |
|---|---|
| `DART_API_KEY` | `82fa7a2187fab011862722c6160e8e4342559f4c` |

또는 CLI로:
```bash
vercel env add DART_API_KEY
```

## 고유번호 데이터 관리

- `npm run fetch-corps` — DART에서 전체 기업 고유번호(~10만건)를 다운로드하여 `src/data/corp-codes.json`에 저장
- 이 파일은 프로젝트에 번들되어 Vercel에 배포됨 → 런타임 ZIP 다운로드 불필요, 즉시 검색
- `npm run build` 시 `prebuild`로 자동 실행됨
- 월 1회 정도 `npm run fetch-corps`를 재실행하면 신규 등록 기업이 반영됨

## 주의사항

- Vercel Free 플랜에서도 정상 동작 (고유번호가 빌드 시 번들되므로 타임아웃 문제 없음)
- `.env.local`은 git에 올리지 않음 (`.gitignore`에 포함)
- `src/data/corp-codes.json`은 약 5~8MB — git에 포함하거나 빌드 시마다 생성 중 선택
