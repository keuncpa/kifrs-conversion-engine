/**
 * DART OpenAPI 클라이언트 (Node.js/TypeScript)
 * Python dart_api.py를 Vercel Serverless 환경에 맞게 포팅
 */

const BASE_URL = "https://opendart.fss.or.kr/api";

// ── 타입 정의 ──

export interface CompanyInfo {
  corp_code: string;
  corp_name: string;
  stock_code: string;
  corp_cls: string;
  ceo_nm: string;
  induty_code: string;
  est_dt: string;
  acc_mt: string;
  adres: string;
  bizr_no: string;
  industry_category: string;
}

export interface FinancialAccount {
  account_nm: string;
  sj_div: string;    // BS, IS, CIS, CF
  sj_nm: string;
  thstrm_amount: number | null;
  frmtrm_amount: number | null;
  bfefrmtrm_amount: number | null;
  ord: number;
  fs_div: string;
  currency: string;
}

export interface DisclosureInfo {
  rcept_no: string;
  corp_name: string;
  report_nm: string;
  rcept_dt: string;
  flr_nm: string;
}

export interface CorpCodeEntry {
  corp_code: string;
  corp_name: string;
  stock_code: string;
  modify_date: string;
}

// ── 업종 분류 ──

function getIndustryCategory(indutyCode: string): string {
  if (!indutyCode) return "기타";
  const code2 = indutyCode.slice(0, 2);
  const map: Record<string, string> = {
    '10': '제조업', '11': '제조업', '12': '제조업', '13': '제조업',
    '14': '제조업', '15': '제조업', '16': '제조업', '17': '제조업',
    '18': '제조업', '19': '제조업', '20': '제조업', '21': '제조업',
    '22': '제조업', '23': '제조업', '24': '제조업', '25': '제조업',
    '26': '제조업', '27': '제조업', '28': '제조업', '29': '제조업',
    '30': '제조업', '31': '제조업', '32': '제조업', '33': '제조업',
    '41': '건설업', '42': '건설업',
    '45': '도소매업', '46': '도소매업', '47': '도소매업',
    '58': 'IT/서비스업', '59': 'IT/서비스업', '60': 'IT/서비스업',
    '61': 'IT/서비스업', '62': 'IT/서비스업', '63': 'IT/서비스업',
    '64': '금융업', '65': '금융업', '66': '금융업',
  };
  return map[code2] || "기타";
}

// ── 금액 파싱 ──

function parseAmount(val: string | undefined | null): number | null {
  if (!val || val.trim() === '' || val.trim() === '-') return null;
  const cleaned = val.replace(/,/g, '').replace(/ /g, '').trim();
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
}

// ── 고유번호 캐시 ──
// 빌드 시 미리 생성한 JSON을 우선 사용, 없으면 런타임 다운로드로 폴백
let corpCodesCache: Record<string, CorpCodeEntry> | null = null;

// ── DART API 요청 ──

async function dartRequest(
  endpoint: string,
  params: Record<string, string> = {},
  binary = false
): Promise<any> {
  const apiKey = process.env.DART_API_KEY;
  if (!apiKey) {
    throw new Error("DART_API_KEY 환경변수가 설정되지 않았습니다.");
  }

  const url = new URL(`${BASE_URL}/${endpoint}`);
  url.searchParams.set('crtfc_key', apiKey);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(30000),
  });

  if (binary) {
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${endpoint}`);
    return Buffer.from(await res.arrayBuffer());
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    // ZIP 등 바이너리
    return Buffer.from(await res.arrayBuffer());
  }

  const data = await res.json();
  const status = data.status || '000';
  if (status !== '000') {
    if (status === '013') return null; // 조회 결과 없음
    throw new Error(`DART API [${status}]: ${data.message || '알 수 없는 오류'}`);
  }
  return data;
}

// ── 고유번호 로드 ──
// 1순위: 빌드 시 생성한 src/data/corp-codes.json (즉시 로드, 타임아웃 없음)
// 2순위: 런타임 DART API 다운로드 (폴백)

async function loadCorpCodes(): Promise<Record<string, CorpCodeEntry>> {
  if (corpCodesCache) return corpCodesCache;

  // 1순위: 번들된 JSON 파일
  try {
    const bundled = await import('@/data/corp-codes.json');
    const raw = bundled.default || bundled;
    // 번들 JSON은 축약 형태 {name: {c, n, s}} → CorpCodeEntry로 변환
    const entries = Object.entries(raw as Record<string, any>);
    if (entries.length > 0) {
      const dict: Record<string, CorpCodeEntry> = {};
      for (const [key, val] of entries) {
        dict[key] = {
          corp_code: val.c,
          corp_name: val.n,
          stock_code: val.s || '',
          modify_date: '',
        };
      }
      corpCodesCache = dict;
      return dict;
    }
    // 번들 파일이 비어있으면 런타임 다운로드로 폴백
  } catch {
    // 번들 파일이 없으면 런타임 다운로드로 폴백
  }

  // 2순위: 런타임 다운로드
  const content = await dartRequest("corpCode.xml", {}, true) as Buffer;
  if (!content) throw new Error("고유번호 목록 다운로드 실패");

  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip(content);
  const entries = zip.getEntries();
  const xmlString = entries[0].getData().toString('utf-8');

  const corpDict: Record<string, CorpCodeEntry> = {};
  const listRegex = /<list>([\s\S]*?)<\/list>/g;
  let match;
  while ((match = listRegex.exec(xmlString)) !== null) {
    const block = match[1];
    const corpCode = block.match(/<corp_code>(.*?)<\/corp_code>/)?.[1]?.trim() || '';
    const corpName = block.match(/<corp_name>(.*?)<\/corp_name>/)?.[1]?.trim() || '';
    const stockCode = block.match(/<stock_code>(.*?)<\/stock_code>/)?.[1]?.trim() || '';
    const modifyDate = block.match(/<modify_date>(.*?)<\/modify_date>/)?.[1]?.trim() || '';

    if (corpName && corpCode) {
      const entry: CorpCodeEntry = { corp_code: corpCode, corp_name: corpName, stock_code: stockCode, modify_date: modifyDate };
      corpDict[corpName] = entry;
      const clean = corpName.replace(/주식회사/g, '').replace(/\(주\)/g, '').replace(/㈜/g, '').trim();
      if (clean !== corpName) corpDict[clean] = entry;
    }
  }

  corpCodesCache = corpDict;
  return corpDict;
}

// ── 공개 API 함수들 ──

export async function searchCompany(name: string, limit = 10): Promise<CorpCodeEntry[]> {
  const codes = await loadCorpCodes();
  const nameClean = name.replace(/ /g, '').toLowerCase();
  const results: CorpCodeEntry[] = [];
  const seenCodes = new Set<string>();

  // 1순위: 정확 매칭
  for (const [key, val] of Object.entries(codes)) {
    if (key.replace(/ /g, '').toLowerCase() === nameClean) {
      if (!seenCodes.has(val.corp_code)) {
        results.push(val);
        seenCodes.add(val.corp_code);
      }
    }
  }

  // 2순위: 포함 매칭
  if (results.length < limit) {
    for (const [key, val] of Object.entries(codes)) {
      if (key.replace(/ /g, '').toLowerCase().includes(nameClean)) {
        if (!seenCodes.has(val.corp_code)) {
          results.push(val);
          seenCodes.add(val.corp_code);
          if (results.length >= limit) break;
        }
      }
    }
  }

  return results;
}

export async function getCompanyInfo(corpCode: string): Promise<CompanyInfo | null> {
  const data = await dartRequest("company.json", { corp_code: corpCode });
  if (!data) return null;

  return {
    corp_code: corpCode,
    corp_name: data.corp_name || '',
    stock_code: data.stock_code || '',
    corp_cls: data.corp_cls || '',
    ceo_nm: data.ceo_nm || '',
    induty_code: data.induty_code || '',
    est_dt: data.est_dt || '',
    acc_mt: data.acc_mt || '',
    adres: data.adres || '',
    bizr_no: data.bizr_no || '',
    industry_category: getIndustryCategory(data.induty_code || ''),
  };
}

export async function getFinancialStatements(
  corpCode: string,
  bsnsYear: string,
  reprtCode = "11011",
  fsDiv = "OFS"
): Promise<FinancialAccount[]> {
  const data = await dartRequest("fnlttSinglAcnt.json", {
    corp_code: corpCode,
    bsns_year: bsnsYear,
    reprt_code: reprtCode,
  });

  if (!data || !data.list) return [];

  return data.list
    .filter((item: any) => item.fs_div === fsDiv)
    .map((item: any) => ({
      account_nm: item.account_nm || '',
      sj_div: item.sj_div || '',
      sj_nm: item.sj_nm || '',
      thstrm_amount: parseAmount(item.thstrm_amount),
      frmtrm_amount: parseAmount(item.frmtrm_amount),
      bfefrmtrm_amount: parseAmount(item.bfefrmtrm_amount),
      ord: parseInt(item.ord || '0', 10) || 0,
      fs_div: item.fs_div || '',
      currency: item.currency || 'KRW',
    }))
    .sort((a: FinancialAccount, b: FinancialAccount) =>
      a.sj_div.localeCompare(b.sj_div) || a.ord - b.ord
    );
}

export async function getFullFinancialStatements(
  corpCode: string,
  bsnsYear: string,
  reprtCode = "11011",
  fsDiv = "OFS"
): Promise<FinancialAccount[]> {
  const data = await dartRequest("fnlttSinglAcntAll.json", {
    corp_code: corpCode,
    bsns_year: bsnsYear,
    reprt_code: reprtCode,
    fs_div: fsDiv,
  });

  if (!data || !data.list) return [];

  return data.list
    .map((item: any) => ({
      account_nm: item.account_nm || '',
      sj_div: item.sj_div || '',
      sj_nm: item.sj_nm || '',
      thstrm_amount: parseAmount(item.thstrm_amount),
      frmtrm_amount: parseAmount(item.frmtrm_amount),
      bfefrmtrm_amount: parseAmount(item.bfefrmtrm_amount),
      ord: parseInt(item.ord || '0', 10) || 0,
      fs_div: fsDiv,
      currency: item.currency || 'KRW',
    }))
    .sort((a: FinancialAccount, b: FinancialAccount) =>
      a.sj_div.localeCompare(b.sj_div) || a.ord - b.ord
    );
}

export async function getAccountingStandard(corpCode: string, bsnsYear: string, stockCode?: string): Promise<string> {
  try {
    const cfs = await getFinancialStatements(corpCode, bsnsYear, "11011", "CFS");
    if (cfs.length > 0) return "K-IFRS";
    const ofs = await getFinancialStatements(corpCode, bsnsYear, "11011", "OFS");
    if (ofs.length > 0) return "K-GAAP";
  } catch {
    // ignore
  }
  // XBRL 데이터 없는 경우: 상장사(stock_code 있음)는 K-IFRS, 비상장은 K-GAAP 추정
  if (stockCode && stockCode.trim()) return "K-IFRS";
  return "K-GAAP";
}

export async function searchDisclosures(
  corpCode: string,
  pblntfDetailTy = "",
  bgnDe = "",
  endDe = "",
): Promise<DisclosureInfo[]> {
  const params: Record<string, string> = {
    corp_code: corpCode,
    last_reprt_at: 'Y',
    page_count: '10',
  };
  if (pblntfDetailTy) params.pblntf_detail_ty = pblntfDetailTy;
  if (bgnDe) params.bgn_de = bgnDe;
  if (endDe) params.end_de = endDe;

  const data = await dartRequest("list.json", params);
  if (!data || !data.list) return [];

  return data.list.map((item: any) => ({
    rcept_no: item.rcept_no || '',
    corp_name: item.corp_name || '',
    report_nm: item.report_nm || '',
    rcept_dt: item.rcept_dt || '',
    flr_nm: item.flr_nm || '',
  }));
}

export async function getAuditReport(corpCode: string, bsnsYear: string): Promise<DisclosureInfo | null> {
  const results = await searchDisclosures(
    corpCode, "F001",
    `${bsnsYear}0101`,
    `${parseInt(bsnsYear) + 1}1231`
  );
  return results[0] || null;
}

// ── 감사보고서 원문 파싱 (비상장 외감법인용) ──

interface ParsedDocAccount {
  acode: string;
  name: string;
  thstrm_amount: number | null;  // 당기
  frmtrm_amount: number | null;  // 전기
}

interface ParsedDocSection {
  title: string;
  accounts: ParsedDocAccount[];
}

function parseAmountFromDoc(val: string): number | null {
  if (!val || val.trim() === '' || val.trim() === '-') return null;
  const cleaned = val.replace(/,/g, '').replace(/ /g, '').replace(/\(/g, '-').replace(/\)/g, '').trim();
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
}

/**
 * 감사보고서 XML 내 섹션(재무상태표/손익계산서/현금흐름표) 경계를 위치 기반으로 탐지
 */
function detectSections(xmlContent: string): { bs: [number, number]; is: [number, number]; cf: [number, number] } {
  // <TITLE> 태그 안에서 재무제표 섹션 키워드를 찾아 본문 위치를 결정
  // 주석(footnotes) 영역에서 키워드가 재등장하므로 마지막 등장이 아닌 TITLE 태그 기준 사용
  const sectionPositions: Record<string, number[]> = { bs: [], is: [], cf: [], sce: [] };

  const sectionKeywords: [string, RegExp][] = [
    ['bs', /재\s*무\s*상\s*태\s*표/],
    ['is', /손\s*익\s*계\s*산\s*서|포\s*괄\s*손\s*익\s*계\s*산\s*서/],
    ['cf', /현\s*금\s*흐\s*름\s*표/],
    ['sce', /자\s*본\s*변\s*동\s*표/],
  ];

  // 1차: <TITLE> 태그 안에서 검색 (가장 신뢰도 높음)
  const titlePattern = /<TITLE[^>]*>([^<]*)<\/TITLE>/g;
  let titleMatch;
  while ((titleMatch = titlePattern.exec(xmlContent)) !== null) {
    const titleContent = titleMatch[1];
    for (const [key, pattern] of sectionKeywords) {
      if (pattern.test(titleContent)) {
        sectionPositions[key].push(titleMatch.index);
      }
    }
  }

  // 2차 폴백: TITLE 태그에서 못 찾으면 전체 텍스트에서 검색 (첫 등장 사용)
  for (const [key, pattern] of sectionKeywords) {
    if (sectionPositions[key].length === 0) {
      const globalPattern = new RegExp(pattern.source, 'g');
      let m;
      while ((m = globalPattern.exec(xmlContent)) !== null) {
        sectionPositions[key].push(m.index);
      }
    }
  }

  // TITLE 태그 매칭이 있으면 첫 번째(보통 유일한) TITLE 위치 사용
  // 폴백의 경우 첫 번째 등장 위치 사용 (목차일 수 있으나 마지막보다 안전)
  const bsStart = sectionPositions.bs[0] || 0;
  const isStart = sectionPositions.is[0] || 0;
  const cfStart = sectionPositions.cf[0] || 0;
  const sceStart = sectionPositions.sce[0] || 0;

  // 순서: BS → IS → (SCE) → CF (일반적)
  const end = xmlContent.length;
  return {
    bs: [bsStart, isStart > bsStart ? isStart : end],
    is: [isStart, sceStart > isStart ? sceStart : (cfStart > isStart ? cfStart : end)],
    cf: [cfStart, end],
  };
}

/**
 * 감사보고서 XML에서 TE 태그를 파싱하여 재무데이터 추출
 * 섹션 위치 기반으로 BS/IS/CF를 정확히 분류
 */
function parseDocumentXml(xmlContent: string): (ParsedDocAccount & { sj_div: string })[] {
  const sections = detectSections(xmlContent);

  const tePattern = /<TE([^>]*)>([^<]*)<\/TE>/g;
  const rows: { pos: number; acode: string; name: string; amounts: Record<string, string> }[] = [];
  let current: { pos: number; acode: string; name: string; amounts: Record<string, string> } | null = null;

  let match;
  while ((match = tePattern.exec(xmlContent)) !== null) {
    const pos = match.index;
    const attrsStr = match[1];
    const text = match[2].trim();
    const attrs: Record<string, string> = {};
    const attrPattern = /(\w+)="([^"]*)"/g;
    let am;
    while ((am = attrPattern.exec(attrsStr)) !== null) {
      attrs[am[1]] = am[2];
    }

    const acode = attrs.ACODE || '';
    const adelim = attrs.ADELIM || '';

    if (adelim === '0') {
      if (current && current.name) {
        rows.push(current);
      }
      current = { pos, acode, name: text, amounts: {} };
    } else if (current && ['1', '2', '3', '4'].includes(adelim)) {
      if (text) {
        current.amounts[adelim] = text;
      }
    }
  }
  if (current && current.name) {
    rows.push(current);
  }

  return rows.map(r => {
    const thstrm = r.amounts['2'] || r.amounts['1'] || null;
    const frmtrm = r.amounts['4'] || r.amounts['3'] || null;

    // 위치 기반 섹션 분류
    let sjDiv = 'BS';
    if (r.pos >= sections.cf[0] && sections.cf[0] > 0) sjDiv = 'CF';
    else if (r.pos >= sections.is[0] && sections.is[0] > 0) sjDiv = 'IS';
    else if (r.pos >= sections.bs[0]) sjDiv = 'BS';

    return {
      acode: r.acode,
      name: r.name.replace(/\(주석[^)]*\)/g, '').replace(/^\d+\./,'').trim(),
      thstrm_amount: thstrm ? parseAmountFromDoc(thstrm) : null,
      frmtrm_amount: frmtrm ? parseAmountFromDoc(frmtrm) : null,
      sj_div: sjDiv,
    };
  }).filter(a => a.name && (a.thstrm_amount !== null || a.frmtrm_amount !== null));
}

/**
 * DART document.xml API로 감사보고서 원문을 다운로드하고 재무데이터 파싱
 */
export async function getFinancialStatementsFromDocument(
  corpCode: string,
  bsnsYear: string,
): Promise<{ accounts: FinancialAccount[]; rceptNo: string } | null> {
  // 1) 감사보고서 검색 (개별 감사보고서 우선, 연결은 제외)
  const auditReports = await searchDisclosures(
    corpCode, "F001",
    `${bsnsYear}0101`,
    `${parseInt(bsnsYear) + 1}1231`
  );

  // "감사보고서"만 필터 (연결감사보고서 제외)
  const indivReport = auditReports.find(r => r.report_nm.includes('감사보고서') && !r.report_nm.includes('연결'))
    || auditReports[0];

  if (!indivReport) return null;

  // 2) document.xml 다운로드
  const zipBuffer = await dartRequest("document.xml", { rcept_no: indivReport.rcept_no }, true) as Buffer;
  if (!zipBuffer || zipBuffer.length < 100) return null;

  // 3) ZIP 해제
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  // 가장 큰 XML 파일이 본문 (보통 하나만 있음)
  let mainXml = '';
  let maxSize = 0;
  for (const entry of entries) {
    const data = entry.getData();
    if (entry.entryName.endsWith('.xml') && data.length > maxSize) {
      maxSize = data.length;
      mainXml = data.toString('utf-8');
    }
  }

  if (!mainXml) return null;

  // 4) TE 태그 파싱
  const parsed = parseDocumentXml(mainXml);
  if (parsed.length === 0) return null;

  // 5) FinancialAccount 형태로 변환 (파서가 위치 기반으로 sj_div를 이미 결정)
  const sjNmMap: Record<string, string> = { BS: '재무상태표', IS: '손익계산서', CF: '현금흐름표' };
  const accounts: FinancialAccount[] = parsed.map((p, idx) => ({
    account_nm: p.name,
    sj_div: p.sj_div,
    sj_nm: sjNmMap[p.sj_div] || '기타',
    thstrm_amount: p.thstrm_amount,
    frmtrm_amount: p.frmtrm_amount,
    bfefrmtrm_amount: null,
    ord: idx + 1,
    fs_div: 'OFS',
    currency: 'KRW',
  }));

  return { accounts, rceptNo: indivReport.rcept_no };
}
