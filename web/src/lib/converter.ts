/**
 * K-GAAP → K-IFRS 전환 엔진 (TypeScript)
 * Python dart_converter.py 포팅
 */

import {
  CompanyInfo,
  FinancialAccount,
  DisclosureInfo,
  searchCompany,
  getCompanyInfo,
  getFinancialStatements,
  getFullFinancialStatements,
  getAccountingStandard,
  getAuditReport,
  getFinancialStatementsFromDocument,
} from './dart-api';

// ── 타입 ──

export interface ConversionItem {
  no: number;
  category: string;
  account_name: string;
  book_value: number | null;
  kifrs_standard: string;
  kifrs_name: string;
  change_description: string;
  impact: string;
  accuracy: string;
  note: string;
}

export interface ConversionDelta {
  account_name: string;
  kgaap_amount: number | null;
  adjustment: number | null;
  kifrs_estimated: number | null;
  changed: boolean;
  kifrs_standard: string;
  change_basis: string;
  assumptions: string;
}

export interface ChecklistCategory {
  category: string;
  items: string[];
  priority: string;
}

export interface KifrsLineItem {
  kifrs_name: string;        // K-IFRS 계정과목명
  kgaap_name: string;        // 원래 K-GAAP 계정과목명
  amount: number | null;     // 전환 전 K-GAAP 금액
  kifrs_amount: number | null; // 전환 후 K-IFRS 추정금액
  diff: number | null;       // 차이 (kifrs - kgaap)
  prev_amount: number | null; // 전기 금액
  adjustment_needed: boolean; // 조정 필요 여부
  adjustment_note: string;   // 조정 내용
  impact: string;            // 영향도
  indent: number;            // 들여쓰기 레벨 (0=대분류, 1=중분류, 2=소분류)
  is_total: boolean;         // 소계/합계 여부
}

export interface KifrsStatements {
  bs: KifrsLineItem[];       // K-IFRS 재무상태표
  is: KifrsLineItem[];       // K-IFRS 포괄손익계산서
}

export interface ConversionResult {
  company: CompanyInfo;
  fiscal_year: string;
  accounting_standard: string;
  accuracy_grade: string;
  bs_accounts: FinancialAccount[];
  is_accounts: FinancialAccount[];
  cf_accounts: FinancialAccount[];
  all_accounts: FinancialAccount[];
  conversion_items: ConversionItem[];
  conversion_deltas: ConversionDelta[];
  kifrs_statements: KifrsStatements;
  checklist: ChecklistCategory[];
  audit_report: DisclosureInfo | null;
  warnings: string[];
}

// ── K-IFRS 매핑 규칙 ──

const ACCOUNT_KIFRS_MAP: [RegExp, string, string, string, string][] = [
  // 자산
  [/현금|현금성자산/, '1007', 'IAS 7 현금흐름표', 'LOW', '명칭 및 표시 변경 가능'],
  [/단기금융상품|정기예금|정기적금/, '1109', 'IFRS 9 금융상품', 'MEDIUM', 'AC/FVPL/FVOCI 재분류 필요'],
  [/매출채권/, '1109', 'IFRS 9 금융상품', 'HIGH', 'ECL(기대신용손실) 모형 적용 필수'],
  [/대손충당금/, '1109', 'IFRS 9 금융상품', 'HIGH', 'ECL 산출로 대체'],
  [/미수금|미수수익/, '1109', 'IFRS 9 금융상품', 'LOW', 'AC 측정, ECL 적용 여부 검토'],
  [/선급금|선급비용/, '1001', 'IAS 1 재무제표 표시', 'LOW', '표시 변경'],
  [/재고자산|상품$|제품$|원재료/, '1002', 'IAS 2 재고자산', 'MEDIUM', 'NRV 평가, 후입선출법 불허'],
  [/장기금융상품/, '1109', 'IFRS 9 금융상품', 'MEDIUM', 'AC/FVPL/FVOCI 재분류'],
  [/매도가능|투자증권|지분증권/, '1109', 'IFRS 9 금융상품', 'HIGH', 'FVOCI/FVPL 재분류, OCI 처리 변경'],
  [/대여금/, '1109', 'IFRS 9 금융상품', 'LOW', 'AC 측정, ECL 적용'],
  [/토지$/, '1016', 'IAS 16 유형자산', 'MEDIUM', '재평가모형 선택 가능, 손상차손 검토'],
  [/건물$/, '1016', 'IAS 16 유형자산', 'MEDIUM', '잔존가치·내용연수 재검토, 구성요소별 감가상각'],
  [/기계장치|차량|비품|공구/, '1016', 'IAS 16 유형자산', 'LOW', '잔존가치·내용연수 재검토'],
  [/건설중인자산/, '1016', 'IAS 16 유형자산', 'LOW', '차입원가 자본화(IAS 23) 검토'],
  [/무형자산|영업권|소프트웨어|개발비|산업재산권/, '1038', 'IAS 38 무형자산', 'MEDIUM', '개발비 자산화 요건 엄격, 영업권 비상각→손상검사'],
  [/보증금|임차보증금/, '1116', 'IFRS 16 리스', 'HIGH', '보증금 현재가치 평가, 리스부채와 함께 처리'],
  [/이연법인세자산/, '1012', 'IAS 12 법인세', 'MEDIUM', '항상 비유동, 실현가능성 재평가'],
  [/투자부동산/, '1040', 'IAS 40 투자부동산', 'MEDIUM', '공정가치모형 또는 원가모형 선택'],
  [/지분법/, '1028', 'IAS 28 관계기업투자', 'MEDIUM', '지분법 적용 범위 재검토'],
  // 부채
  [/매입채무/, '1109', 'IFRS 9 금융상품', 'LOW', 'AC 측정'],
  [/단기차입금|장기차입금/, '1109', 'IFRS 9 금융상품', 'MEDIUM', '유효이자율법 적용, 공정가치 주석공시'],
  [/유동성장기/, '1001', 'IAS 1 재무제표 표시', 'LOW', '유동/비유동 재분류'],
  [/사채$/, '1109', 'IFRS 9 금융상품', 'MEDIUM', '유효이자율법 적용'],
  [/전환사채/, '1132', 'IAS 32 금융상품 표시', 'HIGH', '부채+자본 분리 (복합금융상품)'],
  [/미지급금|미지급비용/, '1109', 'IFRS 9 금융상품', 'LOW', 'AC 측정'],
  [/선수금$|선수수익/, '1115', 'IFRS 15 수익', 'LOW', '계약부채로 재분류 가능'],
  [/예수금/, '1001', 'IAS 1 재무제표 표시', 'LOW', '표시 변경'],
  [/퇴직급여.*부채|퇴직급여충당|확정급여/, '1019', 'IAS 19 종업원급여', 'HIGH', 'DBO(확정급여채무) 보험수리적 평가 필수'],
  [/사외적립|퇴직연금운용/, '1019', 'IAS 19 종업원급여', 'HIGH', '사외적립자산 공정가치 평가'],
  [/이연법인세부채/, '1012', 'IAS 12 법인세', 'MEDIUM', '항상 비유동 분류'],
  [/충당부채/, '1037', 'IAS 37 충당부채', 'MEDIUM', '인식 요건 재검토'],
  // 자본
  [/자본금$/, '1032', 'IAS 32 금융상품 표시', 'LOW', '변경 없음'],
  [/자본잉여금|주식발행초과금/, '1001', 'IAS 1 재무제표 표시', 'LOW', '표시 변경'],
  [/이익잉여금/, '1001', 'IAS 1 재무제표 표시', 'MEDIUM', '전환일 조정사항 반영'],
  [/기타포괄손익/, '1001', 'IAS 1 재무제표 표시', 'MEDIUM', 'FVOCI 평가차이, DBO 재측정 등'],
  [/자기주식/, '1032', 'IAS 32 금융상품 표시', 'LOW', '자본에서 차감 표시'],
  // 수익/비용
  [/매출액|매출$|상품매출|제품매출/, '1115', 'IFRS 15 수익', 'HIGH', '5단계 수익인식 모형, 본인/대리인 판단'],
  [/매출원가/, '1002', 'IAS 2 재고자산', 'LOW', 'NRV 평가 영향 가능'],
  [/급여$|임금$/, '1019', 'IAS 19 종업원급여', 'LOW', '변경 없음'],
  [/임차료|지급임차료/, '1116', 'IFRS 16 리스', 'HIGH', '사용권자산 감가상각비 + 리스부채 이자비용으로 대체'],
  [/감가상각비/, '1016', 'IAS 16 유형자산', 'LOW', '내용연수·잔존가치 재검토 반영'],
  [/대손상각비/, '1109', 'IFRS 9 금융상품', 'HIGH', 'ECL 모형으로 대체'],
  [/이자비용/, '1109', 'IFRS 9 금융상품', 'LOW', '유효이자율법 적용'],
  [/이자수익/, '1109', 'IFRS 9 금융상품', 'LOW', '유효이자율법 적용'],
  [/법인세비용/, '1012', 'IAS 12 법인세', 'MEDIUM', '이연법인세 재계산'],
  [/판매비.*관리비|판관비/, '1001', 'IAS 1 재무제표 표시', 'LOW', '기능별/성격별 분류 선택'],
];

// ── 업종별 가중치 ──

const INDUSTRY_WEIGHT: Record<string, [RegExp, string][]> = {
  '도소매업': [[/리스|임차/, 'HIGH'], [/매출|수익/, 'HIGH'], [/재고/, 'HIGH']],
  '제조업': [[/유형자산|토지|건물|기계/, 'HIGH'], [/차입원가|건설중/, 'HIGH']],
  '건설업': [[/수익|매출/, 'HIGH'], [/공사|진행/, 'HIGH']],
  'IT/서비스업': [[/무형자산|개발비|소프트/, 'HIGH'], [/수익|매출/, 'HIGH']],
  '금융업': [[/금융상품|대출|수취/, 'HIGH'], [/ECL|대손/, 'HIGH']],
};

// ── 체크리스트 ──

const CHECKLIST_TEMPLATE = [
  {
    category: '리스 (IFRS 16)',
    items: [
      '전체 임대차 계약서 목록 (건물, 차량, 비품 등)',
      '계약별 월임차료, 계약기간, 보증금 내역',
      '증분차입이자율 산정 근거',
      '변동리스료 해당 여부 (매출연동 등)',
      '원상복구 의무 유무 및 추정 원가',
    ],
    trigger: /보증금|임차|리스|임대/,
  },
  {
    category: '금융상품 (IFRS 9)',
    items: [
      '매출채권 연령분석 (Aging) 자료',
      '과거 3~5년 대손 발생 실적',
      '주요 투자자산의 사업모형 및 현금흐름 특성',
      '금융자산 보유 목적 검토서',
    ],
    trigger: /매출채권|대손|금융상품|투자증권/,
  },
  {
    category: '종업원급여 (IAS 19)',
    items: [
      '임직원 명부 (입사일, 생년월일, 직급, 연봉)',
      '퇴직연금(DB형) 적립 현황',
      '보험수리적 가정 (할인율, 임금상승률, 퇴직률)',
    ],
    trigger: /퇴직|종업원|확정급여|DBO/,
  },
  {
    category: '수익인식 (IFRS 15)',
    items: [
      '주요 수익 계약서 샘플',
      '본인/대리인 판단 근거 (재고위험, 가격결정권)',
      '반품/환불/할인 정책 및 실적',
      '고객충성제도(포인트) 운영 현황',
    ],
    trigger: /매출|수익|수수료/,
  },
  {
    category: '유형자산 (IAS 16)',
    items: [
      '유형자산 대장 (취득원가, 내용연수, 상각방법)',
      '토지/건물 공정가치 평가서 (재평가모형 적용 시)',
      '자산손상 징후 검토',
    ],
    trigger: /토지|건물|유형자산|기계|차량/,
  },
  {
    category: '법인세 (IAS 12)',
    items: [
      '세무조정 내역 (일시적차이 명세)',
      '이월결손금 및 세액공제 현황',
      '적용 법인세율',
    ],
    trigger: /법인세|이연|세무/,
  },
  {
    category: '연결/지분법 (IFRS 10/IAS 28)',
    items: [
      '종속기업·관계기업 목록 및 지분율',
      '종속기업 재무제표',
      '연결범위 판단 근거',
    ],
    trigger: /지분법|종속|관계기업|연결/,
  },
  {
    category: 'IFRS 1 최초적용',
    items: [
      '전환일(개시 재무상태표일) 확정',
      'IFRS 1 면제규정 적용 여부 검토',
      '비교 재무제표 작성 범위',
    ],
    trigger: /.*/,
  },
];

// ── 카테고리 판별 ──

function categorizeAccount(sjDiv: string, accountName: string): string {
  if (sjDiv === 'BS') {
    if (/자산|현금|채권|재고|토지|건물|보증금|투자|이연법인세자산/.test(accountName)) return '자산';
    if (/부채|채무|차입|사채|충당|이연법인세부채|퇴직|선수/.test(accountName)) return '부채';
    if (/자본|잉여|자기주식|포괄손익/.test(accountName)) return '자본';
    return '자산'; // 기본
  }
  if (sjDiv === 'IS' || sjDiv === 'CIS') {
    if (/매출액|매출$|수익/.test(accountName)) return '수익';
    return '비용';
  }
  return '기타';
}

// ── 전환 실행 ──

export async function runConversion(
  companyName: string,
  fiscalYear?: string,
  fsDiv = "OFS"
): Promise<ConversionResult> {
  if (!fiscalYear) {
    fiscalYear = String(new Date().getFullYear() - 1);
  }

  const warnings: string[] = [];

  // Step 1: 기업검색
  const companies = await searchCompany(companyName);
  if (!companies.length) {
    throw new Error(`'${companyName}' 검색 결과가 없습니다.`);
  }
  const corp = companies[0];

  // Step 2: 기업개황
  const companyInfo = await getCompanyInfo(corp.corp_code);
  if (!companyInfo) throw new Error("기업개황 조회 실패");

  // Step 3: 회계기준
  const acctStd = await getAccountingStandard(corp.corp_code, fiscalYear, corp.stock_code);
  if (acctStd === "K-IFRS") {
    throw new Error(
      `${companyInfo.corp_name}은(는) 이미 K-IFRS를 적용 중인 기업입니다. K-GAAP → K-IFRS 전환(컨버전) 대상이 아닙니다.`
    );
  }

  // Step 4: 재무제표 수집
  // 결산월이 12월이 아닌 기업(6월 등)도 고려하여 여러 연도 시도
  const tryYears = [fiscalYear, String(parseInt(fiscalYear) - 1), String(parseInt(fiscalYear) + 1)];
  let allAccounts: FinancialAccount[] = [];

  for (const tryYear of tryYears) {
    allAccounts = await getFullFinancialStatements(corp.corp_code, tryYear, "11011", fsDiv);
    if (!allAccounts.length) {
      allAccounts = await getFinancialStatements(corp.corp_code, tryYear, "11011", fsDiv);
    }
    if (allAccounts.length) {
      if (tryYear !== fiscalYear) {
        warnings.push(`${fiscalYear}년 데이터 없음, ${tryYear}년으로 대체합니다.`);
        fiscalYear = tryYear;
      }
      break;
    }
  }

  // XBRL 데이터 없으면 감사보고서 원문(document.xml)에서 파싱 시도
  if (!allAccounts.length) {
    warnings.push('XBRL 재무데이터가 없어 감사보고서 원문에서 재무제표를 추출합니다.');
    for (const tryYear of tryYears) {
      try {
        const docResult = await getFinancialStatementsFromDocument(corp.corp_code, tryYear);
        if (docResult && docResult.accounts.length > 0) {
          allAccounts = docResult.accounts;
          if (tryYear !== fiscalYear) {
            warnings.push(`${fiscalYear}년 감사보고서 없음, ${tryYear}년으로 대체합니다.`);
            fiscalYear = tryYear;
          }
          break;
        }
      } catch {
        // 다음 연도 시도
      }
    }
  }

  if (!allAccounts.length) {
    throw new Error(
      `${companyInfo.corp_name}의 재무데이터를 찾을 수 없습니다.\n` +
      `DART XBRL 및 감사보고서 원문 모두에서 데이터를 추출하지 못했습니다.`
    );
  }

  const bsAccounts = allAccounts.filter(a => a.sj_div === 'BS');
  const isAccounts = allAccounts.filter(a => ['IS', 'CIS'].includes(a.sj_div));
  const cfAccounts = allAccounts.filter(a => a.sj_div === 'CF');

  // Step 5: 감사보고서
  let auditReport: DisclosureInfo | null = null;
  try {
    auditReport = await getAuditReport(corp.corp_code, fiscalYear);
  } catch { /* ignore */ }

  // Step 6: K-IFRS 매핑
  const conversionItems: ConversionItem[] = [];
  const conversionDeltas: ConversionDelta[] = [];
  let itemNo = 1;

  const industry = companyInfo.industry_category;
  const industryWeights = INDUSTRY_WEIGHT[industry] || [];

  for (const acc of allAccounts) {
    for (const [pattern, code, name, baseImpact, desc] of ACCOUNT_KIFRS_MAP) {
      if (pattern.test(acc.account_nm)) {
        // 업종 가중치 적용
        let impact = baseImpact;
        for (const [iwPattern, iwImpact] of industryWeights) {
          if (iwPattern.test(acc.account_nm)) {
            impact = iwImpact;
            break;
          }
        }

        const category = categorizeAccount(acc.sj_div, acc.account_nm);

        conversionItems.push({
          no: itemNo++,
          category,
          account_name: acc.account_nm,
          book_value: acc.thstrm_amount,
          kifrs_standard: code,
          kifrs_name: name,
          change_description: desc,
          impact,
          accuracy: '★★☆',
          note: '',
        });

        const changed = impact !== 'NONE' && impact !== 'LOW';
        conversionDeltas.push({
          account_name: acc.account_nm,
          kgaap_amount: acc.thstrm_amount,
          adjustment: null,
          kifrs_estimated: null,
          changed,
          kifrs_standard: `${code} ${name}`,
          change_basis: changed
            ? `${name} 적용으로 인한 측정/분류 변동`
            : `K-GAAP과 K-IFRS 간 실질적 차이 없음`,
          assumptions: changed
            ? '내부자료 확보 후 실측 필요'
            : '',
        });

        break; // 첫 매칭만
      }
    }
  }

  // Step 7: 체크리스트
  const accountNames = allAccounts.map(a => a.account_nm).join(' ');
  const checklist: ChecklistCategory[] = [];
  for (const tmpl of CHECKLIST_TEMPLATE) {
    if (tmpl.trigger.test(accountNames)) {
      const priority = tmpl.trigger.source === '.*'
        ? '필수'
        : conversionItems.some(i => i.impact === 'HIGH' && tmpl.trigger.test(i.account_name))
          ? '상'
          : '중';
      checklist.push({
        category: tmpl.category,
        items: tmpl.items,
        priority,
      });
    }
  }

  // Step 8: K-IFRS 전환 후 재무제표 생성
  const kifrs_statements = generateKifrsStatements(bsAccounts, isAccounts, conversionItems);

  return {
    company: companyInfo,
    fiscal_year: fiscalYear,
    accounting_standard: acctStd,
    accuracy_grade: 'D등급',
    bs_accounts: bsAccounts,
    is_accounts: isAccounts,
    cf_accounts: cfAccounts,
    all_accounts: allAccounts,
    conversion_items: conversionItems,
    conversion_deltas: conversionDeltas,
    kifrs_statements,
    checklist,
    audit_report: auditReport,
    warnings,
  };
}

// ── K-IFRS 전환 후 재무제표 생성 ──

// K-GAAP 계정명 → K-IFRS 계정명 매핑
const BS_KIFRS_REMAP: [RegExp, string][] = [
  [/현금및현금성자산|현금$/, '현금및현금성자산'],
  [/단기금융상품|정기예금|정기적금/, '단기금융자산'],
  [/매출채권/, '매출채권 (ECL 적용)'],
  [/대손충당금/, '손실충당금 (ECL)'],
  [/미수금|미수수익/, '기타수취채권'],
  [/선급금$/, '선급금'],
  [/선급비용/, '선급비용'],
  [/단기대여금/, '단기대여금'],
  [/재고자산|상품$|제품$|원재료|저장품|재공품/, '재고자산 (NRV 평가)'],
  [/장기금융상품/, '장기금융자산'],
  [/매도가능.*증권|투자증권|지분증권/, 'FVOCI 금융자산'],
  [/장기대여금/, '장기대여금'],
  [/토지$/, '토지'],
  [/건물$/, '건물'],
  [/기계장치/, '기계장치'],
  [/차량|운반구/, '차량운반구'],
  [/비품|공구/, '비품'],
  [/지점장치/, '시설장치'],
  [/건설중인자산/, '건설중인자산'],
  [/감가상각누계액/, '감가상각누계액'],
  [/무형자산|소프트웨어|개발비|산업재산권/, '무형자산'],
  [/영업권/, '영업권 (비상각, 매년 손상검사)'],
  [/보증금|임차보증금/, '사용권자산/보증금 (IFRS 16)'],
  [/이연법인세자산/, '이연법인세자산'],
  [/투자부동산/, '투자부동산'],
  [/지분법/, '관계기업투자'],
  [/기타.*비유동자산/, '기타비유동자산'],
  [/매입채무/, '매입채무'],
  [/단기차입금/, '단기차입금'],
  [/장기차입금/, '장기차입금'],
  [/유동성장기/, '유동성장기부채'],
  [/사채$/, '사채 (유효이자율법)'],
  [/전환사채/, '전환사채 (복합금융상품 분리)'],
  [/미지급금/, '기타지급채무'],
  [/미지급비용/, '미지급비용'],
  [/선수금$|선수수익/, '계약부채 (IFRS 15)'],
  [/예수금/, '예수금'],
  [/수입보증금/, '수입보증금'],
  [/퇴직급여.*부채|퇴직급여충당|확정급여/, '확정급여부채 (IAS 19)'],
  [/사외적립|퇴직연금운용/, '사외적립자산'],
  [/국민연금전환금/, '국민연금전환금'],
  [/이연법인세부채/, '이연법인세부채'],
  [/충당부채/, '충당부채 (IAS 37)'],
  [/자본금$|보통주자본금/, '자본금'],
  [/자본잉여금|주식발행초과금/, '자본잉여금'],
  [/이익잉여금|이익준비금|임의적립금|미처분이익/, '이익잉여금'],
  [/기타포괄손익/, '기타포괄손익누계액'],
  [/자기주식/, '자기주식'],
  [/사채할인발행차금/, '사채할인발행차금'],
];

const IS_KIFRS_REMAP: [RegExp, string, string][] = [
  // [패턴, K-IFRS명, 분류(revenue/cogs/sga/other_income/other_expense/finance_income/finance_cost/tax)]
  [/매출액|매출$|상품매출|제품매출|수수료매출/, '수익 (IFRS 15)', 'revenue'],
  [/매출원가|상품매출원가/, '매출원가', 'cogs'],
  [/매출총이익/, '매출총이익', 'gross_profit'],
  [/판매비.*관리비|판관비/, '판매비와관리비', 'sga'],
  [/급여$|임금$/, '급여', 'sga_detail'],
  [/퇴직급여/, '퇴직급여 (IAS 19)', 'sga_detail'],
  [/복리후생비/, '복리후생비', 'sga_detail'],
  [/임차료|지급임차료/, '사용권자산상각비 (IFRS 16)', 'sga_detail'],
  [/감가상각비/, '감가상각비', 'sga_detail'],
  [/무형자산상각비/, '무형자산상각비', 'sga_detail'],
  [/대손상각비/, '대손상각비 (ECL)', 'sga_detail'],
  [/지급수수료/, '지급수수료', 'sga_detail'],
  [/광고선전비/, '광고선전비', 'sga_detail'],
  [/경상개발비/, '경상연구개발비', 'sga_detail'],
  [/영업이익|영업손실/, '영업이익(손실)', 'operating'],
  [/이자수익/, '금융수익 - 이자수익', 'finance_income'],
  [/외환차익|외화환산이익/, '금융수익 - 외환이익', 'finance_income'],
  [/이자비용/, '금융비용 - 이자비용', 'finance_cost'],
  [/사채할인발행차금상각/, '금융비용 - 사채상각', 'finance_cost'],
  [/외환차손|외화환산손실/, '금융비용 - 외환손실', 'finance_cost'],
  [/유형자산처분이익|무형자산처분이익/, '기타수익', 'other_income'],
  [/임대료|수입수수료|잡이익/, '기타수익', 'other_income'],
  [/유형자산처분손실|무형자산처분손실/, '기타비용', 'other_expense'],
  [/매도가능증권.*손실|매도가능증권.*손상/, '기타비용', 'other_expense'],
  [/잡손실/, '기타비용', 'other_expense'],
  [/법인세비용차감전/, '법인세비용차감전순이익(손실)', 'pbt'],
  [/법인세비용|법인세수익/, '법인세비용(수익)', 'tax'],
  [/당기순이익|당기순손실/, '당기순이익(손실)', 'net_income'],
];

function getKifrsName(accountName: string, remapRules: [RegExp, string][]): string | null {
  for (const [pattern, kifrsName] of remapRules) {
    if (pattern.test(accountName)) return kifrsName;
  }
  return null;
}

function getConversionInfo(accountName: string, conversionItems: ConversionItem[]): { impact: string; note: string } {
  const item = conversionItems.find(ci => ci.account_name === accountName);
  if (item) return { impact: item.impact, note: item.change_description };
  return { impact: 'LOW', note: '' };
}

function generateKifrsStatements(
  bsAccounts: FinancialAccount[],
  isAccounts: FinancialAccount[],
  conversionItems: ConversionItem[],
): KifrsStatements {

  // === 전환조정 추정 로직 ===
  // 내부자료 없이 계정과목 특성에 따른 일반적 조정 방향/비율 적용
  function estimateAdjustment(accountName: string, amount: number | null, impact: string): { kifrsAmount: number | null; diff: number | null; note: string } {
    if (!amount || impact === 'LOW' || impact === 'NONE') {
      return { kifrsAmount: amount, diff: 0, note: '' };
    }

    // 대손충당금 → ECL(기대신용손실) 모형: 일반적으로 충당금 증가 (10~30%)
    if (/대손충당금/.test(accountName)) {
      const adj = Math.round(amount * 0.15);
      return { kifrsAmount: amount + adj, diff: adj, note: 'ECL 모형 적용 시 충당금 증가 추정 (+15%)' };
    }
    // 매출채권 → ECL 적용으로 순액 감소
    if (/매출채권/.test(accountName)) {
      const adj = -Math.round(Math.abs(amount) * 0.02);
      return { kifrsAmount: amount + adj, diff: adj, note: 'ECL 대손 추가 인식 추정 (-2%)' };
    }
    // 재고자산 → NRV 평가, 후입선출법 불허: 소폭 감소 가능
    if (/재고자산|상품$|제품$|원재료/.test(accountName)) {
      const adj = -Math.round(Math.abs(amount) * 0.01);
      return { kifrsAmount: amount + adj, diff: adj, note: 'NRV 평가차이 추정 (-1%)' };
    }
    // 퇴직급여충당부채 → DBO 보험수리적 평가: 일반적으로 부채 증가
    if (/퇴직급여.*부채|퇴직급여충당|확정급여/.test(accountName)) {
      const adj = Math.round(amount * 0.08);
      return { kifrsAmount: amount + adj, diff: adj, note: 'DBO 보험수리적 평가 시 부채 증가 추정 (+8%)' };
    }
    // 사외적립자산 → 공정가치 평가
    if (/사외적립|퇴직연금운용/.test(accountName)) {
      const adj = -Math.round(Math.abs(amount) * 0.03);
      return { kifrsAmount: amount + adj, diff: adj, note: '사외적립자산 공정가치 평가차이 추정 (-3%)' };
    }
    // 임차보증금 → IFRS 16 리스부채/사용권자산 전환
    if (/보증금|임차보증금/.test(accountName)) {
      const adj = -Math.round(Math.abs(amount) * 0.05);
      return { kifrsAmount: amount + adj, diff: adj, note: 'IFRS 16 현재가치 할인 추정 (-5%)' };
    }
    // 임차료 → 사용권자산상각비로 전환: 금액 자체는 유사하나 성격 변동
    if (/임차료|지급임차료/.test(accountName)) {
      return { kifrsAmount: amount, diff: 0, note: 'IFRS 16 사용권자산상각비+이자비용으로 재분류' };
    }
    // 매도가능증권 → FVOCI/FVPL 재분류
    if (/매도가능|투자증권|지분증권/.test(accountName)) {
      const adj = Math.round(amount * 0.03);
      return { kifrsAmount: amount + adj, diff: adj, note: 'FVOCI/FVPL 공정가치 평가차이 추정 (+3%)' };
    }
    // 전환사채 → 부채+자본 분리
    if (/전환사채/.test(accountName)) {
      const adj = -Math.round(Math.abs(amount) * 0.1);
      return { kifrsAmount: amount + adj, diff: adj, note: '복합금융상품 자본요소 분리 추정 (-10%)' };
    }
    // 무형자산/개발비 → 자산화 요건 엄격
    if (/무형자산|개발비|영업권/.test(accountName)) {
      const adj = -Math.round(Math.abs(amount) * 0.05);
      return { kifrsAmount: amount + adj, diff: adj, note: '자산화 요건 강화에 따른 감소 추정 (-5%)' };
    }
    // 매출액 → IFRS 15 5단계 수익인식
    if (/매출액|매출$|상품매출|제품매출/.test(accountName)) {
      const adj = -Math.round(Math.abs(amount) * 0.02);
      return { kifrsAmount: amount + adj, diff: adj, note: 'IFRS 15 수익인식 시점차이 추정 (-2%)' };
    }
    // 토지/건물 → 재평가 가능
    if (/토지$/.test(accountName)) {
      const adj = Math.round(amount * 0.1);
      return { kifrsAmount: amount + adj, diff: adj, note: '재평가모형 적용 시 증가 추정 (+10%)' };
    }
    if (/건물$/.test(accountName)) {
      const adj = -Math.round(Math.abs(amount) * 0.03);
      return { kifrsAmount: amount + adj, diff: adj, note: '구성요소별 감가상각 적용 시 감소 추정 (-3%)' };
    }
    // 이익잉여금 → 전환 조정 반영
    if (/이익잉여금/.test(accountName)) {
      return { kifrsAmount: amount, diff: null, note: '상기 조정사항 순액이 이익잉여금에 반영' };
    }
    // 기타 MEDIUM/HIGH → 방향 미정
    return { kifrsAmount: amount, diff: null, note: '내부자료 확보 후 산출 필요' };
  }

  // === K-IFRS 재무상태표 ===
  const kifrs_bs: KifrsLineItem[] = [];

  for (const acc of bsAccounts) {
    const kifrsName = getKifrsName(acc.account_nm, BS_KIFRS_REMAP);
    const info = getConversionInfo(acc.account_nm, conversionItems);
    const needsAdj = info.impact === 'HIGH' || info.impact === 'MEDIUM';
    const est = estimateAdjustment(acc.account_nm, acc.thstrm_amount, info.impact);

    kifrs_bs.push({
      kifrs_name: kifrsName || acc.account_nm,
      kgaap_name: acc.account_nm,
      amount: acc.thstrm_amount,
      kifrs_amount: est.kifrsAmount,
      diff: est.diff,
      prev_amount: acc.frmtrm_amount,
      adjustment_needed: needsAdj,
      adjustment_note: needsAdj ? (est.note || info.note) : '',
      impact: info.impact,
      indent: 0,
      is_total: /총\s*계|합\s*계/.test(acc.account_nm),
    });
  }

  // === K-IFRS 포괄손익계산서 ===
  const kifrs_is: KifrsLineItem[] = [];

  // 먼저 기존 IS 계정을 K-IFRS 분류별로 그룹핑
  const classified: { acc: FinancialAccount; kifrsName: string; category: string }[] = [];

  for (const acc of isAccounts) {
    let matched = false;
    for (const [pattern, kifrsName, category] of IS_KIFRS_REMAP) {
      if (pattern.test(acc.account_nm)) {
        classified.push({ acc, kifrsName, category });
        matched = true;
        break;
      }
    }
    if (!matched) {
      // 영업외수익 → 기타수익, 영업외비용 → 기타비용
      if (/영업외수익/.test(acc.account_nm)) {
        classified.push({ acc, kifrsName: '기타수익 합계', category: 'other_income' });
      } else if (/영업외비용/.test(acc.account_nm)) {
        classified.push({ acc, kifrsName: '기타비용 합계', category: 'other_expense' });
      } else {
        classified.push({ acc, kifrsName: acc.account_nm, category: 'sga_detail' });
      }
    }
  }

  // K-IFRS 형식 순서대로 출력
  const categoryOrder = ['revenue', 'cogs', 'gross_profit', 'sga', 'sga_detail', 'operating',
    'other_income', 'other_expense', 'finance_income', 'finance_cost', 'pbt', 'tax', 'net_income'];

  // 금융수익/금융비용/기타수익/기타비용 소계 계산
  const financeIncome = classified.filter(c => c.category === 'finance_income');
  const financeCost = classified.filter(c => c.category === 'finance_cost');
  const otherIncome = classified.filter(c => c.category === 'other_income');
  const otherExpense = classified.filter(c => c.category === 'other_expense');

  for (const cat of categoryOrder) {
    const items = classified.filter(c => c.category === cat);

    // 금융수익/비용, 기타수익/비용은 소계 헤더를 먼저 추가
    if (cat === 'finance_income' && financeIncome.length > 0) {
      const sum = financeIncome.reduce((s, c) => s + (c.acc.thstrm_amount || 0), 0);
      const prevSum = financeIncome.reduce((s, c) => s + (c.acc.frmtrm_amount || 0), 0);
      kifrs_is.push({ kifrs_name: '금융수익', kgaap_name: '', amount: sum || null, kifrs_amount: sum || null, diff: 0, prev_amount: prevSum || null,
        adjustment_needed: false, adjustment_note: '', impact: 'LOW', indent: 0, is_total: true });
    }
    if (cat === 'finance_cost' && financeCost.length > 0) {
      const sum = financeCost.reduce((s, c) => s + (c.acc.thstrm_amount || 0), 0);
      const prevSum = financeCost.reduce((s, c) => s + (c.acc.frmtrm_amount || 0), 0);
      kifrs_is.push({ kifrs_name: '금융비용', kgaap_name: '', amount: sum || null, kifrs_amount: sum || null, diff: 0, prev_amount: prevSum || null,
        adjustment_needed: false, adjustment_note: '', impact: 'LOW', indent: 0, is_total: true });
    }
    if (cat === 'other_income' && otherIncome.length > 0) {
      const sum = otherIncome.reduce((s, c) => s + (c.acc.thstrm_amount || 0), 0);
      const prevSum = otherIncome.reduce((s, c) => s + (c.acc.frmtrm_amount || 0), 0);
      kifrs_is.push({ kifrs_name: '기타수익', kgaap_name: '', amount: sum || null, kifrs_amount: sum || null, diff: 0, prev_amount: prevSum || null,
        adjustment_needed: false, adjustment_note: '', impact: 'LOW', indent: 0, is_total: true });
    }
    if (cat === 'other_expense' && otherExpense.length > 0) {
      const sum = otherExpense.reduce((s, c) => s + (c.acc.thstrm_amount || 0), 0);
      const prevSum = otherExpense.reduce((s, c) => s + (c.acc.frmtrm_amount || 0), 0);
      kifrs_is.push({ kifrs_name: '기타비용', kgaap_name: '', amount: sum || null, kifrs_amount: sum || null, diff: 0, prev_amount: prevSum || null,
        adjustment_needed: false, adjustment_note: '', impact: 'LOW', indent: 0, is_total: true });
    }

    for (const { acc, kifrsName, category } of items) {
      const info = getConversionInfo(acc.account_nm, conversionItems);
      const needsAdj = info.impact === 'HIGH' || info.impact === 'MEDIUM';
      const isSubItem = ['sga_detail', 'finance_income', 'finance_cost', 'other_income', 'other_expense'].includes(category);
      const isTotal = /총이익|영업이익|순이익|순손실|차감전/.test(acc.account_nm);
      const est = estimateAdjustment(acc.account_nm, acc.thstrm_amount, info.impact);

      kifrs_is.push({
        kifrs_name: kifrsName,
        kgaap_name: acc.account_nm !== kifrsName ? acc.account_nm : '',
        amount: acc.thstrm_amount,
        kifrs_amount: est.kifrsAmount,
        diff: est.diff,
        prev_amount: acc.frmtrm_amount,
        adjustment_needed: needsAdj,
        adjustment_note: needsAdj ? (est.note || info.note) : '',
        impact: info.impact,
        indent: isSubItem ? 1 : 0,
        is_total: isTotal,
      });
    }
  }

  return { bs: kifrs_bs, is: kifrs_is };
}
