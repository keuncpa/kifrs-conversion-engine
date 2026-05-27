#!/bin/bash
# K-IFRS 컨버전 시스템 — 로컬 설정 및 실행
set -e

echo "=== K-IFRS 컨버전 시스템 설정 ==="

# Node.js 확인
if ! command -v node &> /dev/null; then
    echo "❌ Node.js가 설치되어 있지 않습니다."
    echo "   https://nodejs.org 에서 18+ 버전을 설치하세요."
    exit 1
fi
echo "✅ Node.js $(node -v)"

# npm install
echo ""
echo "📦 패키지 설치 중..."
npm install

# .env.local 확인
if [ ! -f .env.local ]; then
    echo ""
    echo "⚠ .env.local 파일이 없습니다."
    echo "  .env.local.example을 복사하고 DART API 키를 입력하세요:"
    echo "  cp .env.local.example .env.local"
    exit 1
fi
echo "✅ .env.local 확인"

# 빌드 테스트
echo ""
echo "🔨 빌드 테스트 중..."
npm run build

echo ""
echo "=== 설정 완료! ==="
echo ""
echo "로컬 실행:  npm run dev  → http://localhost:3000"
echo "Vercel 배포: npx vercel --prod"
echo ""
echo "Vercel 환경변수 설정 잊지 마세요:"
echo "  DART_API_KEY = $(grep DART_API_KEY .env.local | cut -d= -f2)"
