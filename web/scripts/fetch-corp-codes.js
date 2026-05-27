#!/usr/bin/env node
/**
 * DART 고유번호 목록을 미리 다운로드하여 JSON으로 저장
 *
 * 사용법:
 *   node scripts/fetch-corp-codes.js
 *
 * 결과:
 *   src/data/corp-codes.json (약 5~8MB)
 *
 * 빌드 전 또는 월 1회 실행하면 충분합니다.
 * package.json의 prebuild 스크립트로도 등록 가능.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.DART_API_KEY
  || (() => {
    // .env.local에서 읽기
    const envPath = path.join(__dirname, '..', '.env.local');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      const match = content.match(/DART_API_KEY=(.+)/);
      if (match) return match[1].trim();
    }
    return '';
  })();

if (!API_KEY) {
  console.error('❌ DART_API_KEY가 설정되지 않았습니다.');
  console.error('   .env.local 파일에 DART_API_KEY=키값 을 추가하세요.');
  process.exit(1);
}

const OUTPUT_DIR = path.join(__dirname, '..', 'src', 'data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'corp-codes.json');

// Vercel 빌드 환경에서는 DART API 접근이 불가하므로 스킵
if (process.env.VERCEL) {
  console.log('⏭️  Vercel 빌드 환경 — prebuild 스킵 (런타임 API 사용)');
  process.exit(0);
}

// 이미 파일이 존재하면 스킵 (빌드 속도 개선)
if (fs.existsSync(OUTPUT_FILE)) {
  const stat = fs.statSync(OUTPUT_FILE);
  if (stat.size > 1000) {
    console.log(`✅ corp-codes.json 이미 존재 (${(stat.size / 1024 / 1024).toFixed(1)}MB) — 스킵`);
    process.exit(0);
  }
}

async function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  console.log('📥 DART 고유번호 목록 다운로드 중...');

  const url = `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${API_KEY}`;
  const zipBuffer = await fetchBuffer(url);
  console.log(`   ZIP 크기: ${(zipBuffer.length / 1024 / 1024).toFixed(1)}MB`);

  // ZIP 해제 (adm-zip 없이 순수 Node.js로)
  // ZIP 파일 구조를 직접 파싱하거나, unzip 사용
  // 간단하게 adm-zip 사용
  let AdmZip;
  try {
    AdmZip = require('adm-zip');
  } catch {
    console.log('   adm-zip 설치 중...');
    require('child_process').execSync('npm install adm-zip --no-save', { stdio: 'inherit' });
    AdmZip = require('adm-zip');
  }

  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  const xmlString = entries[0].getData().toString('utf-8');
  console.log(`   XML 크기: ${(xmlString.length / 1024 / 1024).toFixed(1)}MB`);

  // XML 파싱
  const corpDict = {};
  const listRegex = /<list>([\s\S]*?)<\/list>/g;
  let match;
  let count = 0;

  while ((match = listRegex.exec(xmlString)) !== null) {
    const block = match[1];
    const corpCode = block.match(/<corp_code>(.*?)<\/corp_code>/)?.[1]?.trim() || '';
    const corpName = block.match(/<corp_name>(.*?)<\/corp_name>/)?.[1]?.trim() || '';
    const stockCode = block.match(/<stock_code>(.*?)<\/stock_code>/)?.[1]?.trim() || '';

    if (corpName && corpCode) {
      const entry = { c: corpCode, n: corpName, s: stockCode };
      // 이름 기반 키
      corpDict[corpName] = entry;
      // (주), 주식회사 제거 버전
      const clean = corpName.replace(/주식회사/g, '').replace(/\(주\)/g, '').replace(/㈜/g, '').trim();
      if (clean !== corpName && clean) {
        corpDict[clean] = entry;
      }
      count++;
    }
  }

  // 저장
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(corpDict));
  const fileSize = fs.statSync(OUTPUT_FILE).size;
  console.log(`\n✅ 완료: ${count.toLocaleString()}개 기업`);
  console.log(`   저장: ${OUTPUT_FILE}`);
  console.log(`   크기: ${(fileSize / 1024 / 1024).toFixed(1)}MB`);
  console.log(`\n   이 파일은 프로젝트에 포함되어 Vercel에 번들됩니다.`);
  console.log(`   월 1회 재실행하면 최신 데이터를 반영할 수 있습니다.`);
}

main().catch((err) => {
  console.error('❌ 실패:', err.message);
  process.exit(1);
});
