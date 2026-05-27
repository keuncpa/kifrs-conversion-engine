/**
 * 내부자료 파싱 엔진
 * 업로드된 엑셀/CSV에서 K-IFRS 전환조정에 필요한 수치를 추출하고 조정액 산출
 */

import ExcelJS from 'exceljs';

// ── 공통 타입 ──

export interface AdjustmentResult {
  category: string;        // 'lease' | 'retirement' | 'ecl' | 'inventory' | 'ppe' | 'financial'
  label: string;           // 표시용 라벨
  items: AdjustmentItem[];
  summary: string;         // 요약 설명
}

export interface AdjustmentItem {
  account_name: string;    // 영향받는 계정과목
  kgaap_amount: number;    // K-GAAP 기존 금액
  kifrs_amount: number;    // K-IFRS 전환 후 금액
  diff: number;            // 차이
  note: string;            // 조정 근거
}

// ── 엑셀 파싱 유틸 ──

function getCellValue(cell: ExcelJS.Cell): string | number | null {
  if (cell.value === null || cell.value === undefined) return null;
  if (typeof cell.value === 'object' && 'result' in cell.value) return cell.value.result as any;
  return cell.value as any;
}

function toNumber(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const cleaned = String(val).replace(/[,\s원₩]/g, '').replace(/\(([^)]+)\)/, '-$1');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function findHeaderRow(sheet: ExcelJS.Worksheet, keywords: string[]): number {
  for (let r = 1; r <= Math.min(20, sheet.rowCount); r++) {
    const row = sheet.getRow(r);
    const vals = row.values as any[];
    if (!vals) continue;
    const rowText = vals.map(v => String(v || '').replace(/\s/g, '')).join(' ');
    const matched = keywords.filter(k => rowText.includes(k.replace(/\s/g, '')));
    if (matched.length >= 2) return r;
  }
  return -1;
}

function findFirst(headerRow: any[], keywords: string[]): number {
  for (const kw of keywords) {
    const idx = findColumn(headerRow, kw);
    if (idx > 0) return idx;
  }
  return -1;
}

function findColumn(headerRow: any[], keyword: string): number {
  const clean = keyword.replace(/\s/g, '');
  for (let i = 1; i < headerRow.length; i++) {
    if (String(headerRow[i] || '').replace(/\s/g, '').includes(clean)) return i;
  }
  return -1;
}

async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS expects ArrayBuffer, not Node Buffer
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  await wb.xlsx.load(ab);
  return wb;
}

// ═══════════════════════════════════════════════
// 1. 리스계약 (IFRS 16)
// ═══════════════════════════════════════════════

export async function parseLeaseData(buffer: Buffer): Promise<AdjustmentResult> {
  const wb = await loadWorkbook(buffer);
  const sheet = wb.worksheets[0];
  const items: AdjustmentItem[] = [];

  // 헤더 찾기: 계약명, 시작일/개시일, 종료일/만료일, 월리스료/월임차료, 할인율/이자율
  const headerRow = findHeaderRow(sheet, ['계약', '리스료', '할인율']) !== -1
    ? findHeaderRow(sheet, ['계약', '리스료', '할인율'])
    : findHeaderRow(sheet, ['계약', '임차료', '이자율']);

  if (headerRow === -1) {
    // 대안: 간단 양식 (총리스료, 리스기간, 할인율만)
    return parseLeaseSimple(sheet);
  }

  const headers = (sheet.getRow(headerRow).values as any[]) || [];
  const colName = findColumn(headers, '계약');
  const colPayment = Math.max(findColumn(headers, '월리스료'), findColumn(headers, '월임차료'), findColumn(headers, '리스료'));
  const colRate = Math.max(findColumn(headers, '할인율'), findColumn(headers, '이자율'));
  const colStart = Math.max(findColumn(headers, '시작'), findColumn(headers, '개시'));
  const colEnd = Math.max(findColumn(headers, '종료'), findColumn(headers, '만료'));
  const colTerm = findColumn(headers, '기간');

  let totalRouAsset = 0;
  let totalLeaseLiab = 0;

  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const name = getCellValue(row.getCell(Math.max(colName, 1)));
    if (!name) continue;

    const monthlyPayment = toNumber(getCellValue(row.getCell(Math.max(colPayment, 2))));
    if (monthlyPayment === 0) continue;

    const annualRate = toNumber(getCellValue(row.getCell(Math.max(colRate, 3))));
    const rate = annualRate > 1 ? annualRate / 100 : annualRate; // 5 → 0.05
    const monthlyRate = rate / 12 || 0.004; // 기본 4.8%

    let months = 0;
    if (colTerm > 0) {
      months = toNumber(getCellValue(row.getCell(colTerm)));
      if (months > 0 && months <= 50) months *= 12; // 년 → 월 변환
    }
    if (months === 0 && colStart > 0 && colEnd > 0) {
      const startVal = getCellValue(row.getCell(colStart));
      const endVal = getCellValue(row.getCell(colEnd));
      if (startVal && endVal) {
        const start = new Date(startVal as any);
        const end = new Date(endVal as any);
        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
          months = Math.max(1, Math.round((end.getTime() - start.getTime()) / (30.44 * 24 * 60 * 60 * 1000)));
        }
      }
    }
    if (months === 0) months = 36; // 기본 3년

    // PV 계산 (월리스료 × 연금현가계수)
    const pvFactor = monthlyRate > 0
      ? (1 - Math.pow(1 + monthlyRate, -months)) / monthlyRate
      : months;
    const pvLease = Math.round(monthlyPayment * pvFactor);

    totalRouAsset += pvLease;
    totalLeaseLiab += pvLease;
  }

  if (totalRouAsset > 0) {
    items.push({
      account_name: '사용권자산',
      kgaap_amount: 0,
      kifrs_amount: totalRouAsset,
      diff: totalRouAsset,
      note: `리스계약 PV 산출 (IFRS 16)`,
    });
    items.push({
      account_name: '리스부채',
      kgaap_amount: 0,
      kifrs_amount: totalLeaseLiab,
      diff: totalLeaseLiab,
      note: `리스부채 인식 (IFRS 16)`,
    });
    // 기존 임차보증금 제거
    items.push({
      account_name: '임차보증금',
      kgaap_amount: 0,
      kifrs_amount: 0,
      diff: 0,
      note: '리스부채로 재분류 (IFRS 16 현재가치 할인 반영)',
    });
  }

  return {
    category: 'lease',
    label: '리스계약 (IFRS 16)',
    items,
    summary: `사용권자산 ${fmt(totalRouAsset)}원, 리스부채 ${fmt(totalLeaseLiab)}원 인식`,
  };
}

function parseLeaseSimple(sheet: ExcelJS.Worksheet): AdjustmentResult {
  // 단순 양식: 셀에서 총리스료, 잔여기간, 할인율 추출
  let totalPayment = 0, months = 36, rate = 0.048;
  for (let r = 1; r <= Math.min(20, sheet.rowCount); r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= 10; c++) {
      const label = String(getCellValue(row.getCell(c)) || '');
      const nextVal = toNumber(getCellValue(row.getCell(c + 1)));
      if (/총.*리스료|총.*임차료|연간.*리스료/.test(label) && nextVal > 0) totalPayment = nextVal;
      if (/기간|개월/.test(label) && nextVal > 0) months = nextVal <= 50 ? nextVal * 12 : nextVal;
      if (/할인율|이자율/.test(label) && nextVal > 0) rate = nextVal > 1 ? nextVal / 100 : nextVal;
    }
  }
  const monthlyPayment = totalPayment / 12 || totalPayment;
  const monthlyRate = rate / 12;
  const pvFactor = monthlyRate > 0 ? (1 - Math.pow(1 + monthlyRate, -months)) / monthlyRate : months;
  const pv = Math.round(monthlyPayment * pvFactor);

  return {
    category: 'lease',
    label: '리스계약 (IFRS 16)',
    items: pv > 0 ? [
      { account_name: '사용권자산', kgaap_amount: 0, kifrs_amount: pv, diff: pv, note: 'IFRS 16 PV 산출' },
      { account_name: '리스부채', kgaap_amount: 0, kifrs_amount: pv, diff: pv, note: 'IFRS 16 리스부채 인식' },
    ] : [],
    summary: pv > 0 ? `사용권자산/리스부채 ${fmt(pv)}원 인식` : '파싱 실패: 양식을 확인해주세요',
  };
}

// ═══════════════════════════════════════════════
// 2. 퇴직급여 보험수리적 보고서 (IAS 19)
// ═══════════════════════════════════════════════

export async function parseRetirementData(buffer: Buffer): Promise<AdjustmentResult> {
  const wb = await loadWorkbook(buffer);
  const sheet = wb.worksheets[0];
  const items: AdjustmentItem[] = [];

  let dbo = 0; // 확정급여채무
  let planAsset = 0; // 사외적립자산 공정가치
  let kgaapLiab = 0; // K-GAAP 퇴직급여충당부채
  let kgaapPlanAsset = 0; // K-GAAP 사외적립자산

  // 키-값 쌍 탐색
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= 10; c++) {
      const label = String(getCellValue(row.getCell(c)) || '').replace(/\s/g, '');
      const val = toNumber(getCellValue(row.getCell(c + 1)));
      if (val === 0) continue;

      if (/확정급여채무|확정급여부채|DBO|퇴직급여채무/.test(label)) dbo = val;
      else if (/사외적립자산.*공정|공정가치.*사외|planasset/i.test(label)) planAsset = val;
      else if (/사외적립자산/.test(label) && !planAsset) planAsset = val;
      else if (/퇴직급여충당|K-GAAP.*부채|장부.*부채/.test(label)) kgaapLiab = val;
      else if (/K-GAAP.*사외|장부.*사외/.test(label)) kgaapPlanAsset = val;
    }
  }

  // 테이블 형태도 시도
  if (dbo === 0) {
    const headerRow = findHeaderRow(sheet, ['항목', '금액']);
    if (headerRow > 0) {
      for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
        const row = sheet.getRow(r);
        const label = String(getCellValue(row.getCell(1)) || '').replace(/\s/g, '');
        const val = toNumber(getCellValue(row.getCell(2)));
        if (/확정급여채무|DBO/.test(label)) dbo = val;
        if (/사외적립자산/.test(label)) planAsset = val;
      }
    }
  }

  if (dbo > 0) {
    const netLiab = dbo - planAsset;
    const kgaapNet = kgaapLiab - kgaapPlanAsset;

    items.push({
      account_name: '확정급여부채 (IAS 19)',
      kgaap_amount: kgaapLiab || dbo,
      kifrs_amount: dbo,
      diff: dbo - (kgaapLiab || dbo),
      note: `보험수리적 평가 DBO: ${fmt(dbo)}원`,
    });
    if (planAsset > 0) {
      items.push({
        account_name: '사외적립자산',
        kgaap_amount: kgaapPlanAsset || planAsset,
        kifrs_amount: planAsset,
        diff: planAsset - (kgaapPlanAsset || planAsset),
        note: `사외적립자산 공정가치: ${fmt(planAsset)}원`,
      });
    }
    items.push({
      account_name: '순확정급여부채',
      kgaap_amount: kgaapNet || netLiab,
      kifrs_amount: netLiab,
      diff: netLiab - (kgaapNet || netLiab),
      note: `DBO ${fmt(dbo)} - 사외적립 ${fmt(planAsset)} = ${fmt(netLiab)}`,
    });
  }

  return {
    category: 'retirement',
    label: '퇴직급여 (IAS 19)',
    items,
    summary: dbo > 0 ? `DBO ${fmt(dbo)}원, 순확정급여부채 ${fmt(dbo - planAsset)}원` : '파싱 실패: DBO 금액을 찾을 수 없습니다',
  };
}

// ═══════════════════════════════════════════════
// 3. 매출채권 연령분석 (IFRS 9 ECL)
// ═══════════════════════════════════════════════

export async function parseEclData(buffer: Buffer): Promise<AdjustmentResult> {
  const wb = await loadWorkbook(buffer);
  const sheet = wb.worksheets[0];
  const items: AdjustmentItem[] = [];

  // 연령분석 테이블 찾기
  const headerRow = findHeaderRow(sheet, ['연령', '잔액']);
  const headerRow2 = headerRow === -1 ? findHeaderRow(sheet, ['구간', '채권']) : headerRow;
  const headerRow3 = headerRow2 === -1 ? findHeaderRow(sheet, ['경과', '금액']) : headerRow2;
  const hr = Math.max(headerRow, headerRow2, headerRow3);

  let totalBalance = 0;
  let totalEcl = 0;
  let kgaapAllowance = 0;

  if (hr > 0) {
    const headers = (sheet.getRow(hr).values as any[]) || [];
    const colAge = findFirst(headers, ['연령', '구간', '경과']) || 1;
    const colBalance = findFirst(headers, ['채권잔액', '잔액', '채권금액']) || 2;
    const colRate = findFirst(headers, ['손실률', 'ECL률', '충당률']) || -1;
    const colEcl = findFirst(headers, ['충당금액', '충당금', 'ECL금액', '손실금액']) || -1;

    for (let r = hr + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const label = String(getCellValue(row.getCell(colAge)) || '');
      if (!label || /합계|총계|계$/.test(label)) continue;

      const balance = toNumber(getCellValue(row.getCell(colBalance)));
      if (balance === 0) continue;

      let eclAmount = 0;
      if (colEcl > 0) {
        eclAmount = toNumber(getCellValue(row.getCell(colEcl)));
      } else if (colRate > 0) {
        let rate = toNumber(getCellValue(row.getCell(colRate)));
        if (rate > 1) rate /= 100;
        eclAmount = Math.round(balance * rate);
      } else {
        // 연령 기반 기본 손실률 적용
        const defaultRates: [RegExp, number][] = [
          [/미경과|정상|0.*30|1개월/, 0.01],
          [/1.*3개월|31.*60|30.*60|61.*90/, 0.03],
          [/3.*6개월|91.*180|61.*180/, 0.10],
          [/6.*12개월|181.*365|6개월.*1년/, 0.30],
          [/1년.*이상|12개월.*이상|365/, 0.70],
          [/2년|24개월/, 0.90],
        ];
        let rate = 0.05; // 기본
        for (const [pat, r] of defaultRates) {
          if (pat.test(label)) { rate = r; break; }
        }
        eclAmount = Math.round(balance * rate);
      }

      totalBalance += balance;
      totalEcl += eclAmount;
    }
  } else {
    // 키-값 쌍 탐색 (단순 양식)
    for (let r = 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      for (let c = 1; c <= 10; c++) {
        const label = String(getCellValue(row.getCell(c)) || '').replace(/\s/g, '');
        const val = toNumber(getCellValue(row.getCell(c + 1)));
        if (/매출채권.*잔액|총.*채권/.test(label)) totalBalance = val;
        if (/ECL.*충당금|기대신용손실|손실충당금/.test(label)) totalEcl = val;
        if (/K-GAAP.*충당금|대손충당금.*잔액|기존.*충당금/.test(label)) kgaapAllowance = val;
      }
    }
  }

  if (totalEcl > 0) {
    items.push({
      account_name: '매출채권',
      kgaap_amount: totalBalance,
      kifrs_amount: totalBalance,
      diff: 0,
      note: `매출채권 총잔액 ${fmt(totalBalance)}원`,
    });
    items.push({
      account_name: '손실충당금 (ECL)',
      kgaap_amount: kgaapAllowance || 0,
      kifrs_amount: totalEcl,
      diff: totalEcl - kgaapAllowance,
      note: `ECL 산출: ${fmt(totalEcl)}원 (K-GAAP 대손충당금 대비 ${kgaapAllowance ? fmt(totalEcl - kgaapAllowance) + '원 차이' : '비교 필요'})`,
    });
  }

  return {
    category: 'ecl',
    label: '매출채권 ECL (IFRS 9)',
    items,
    summary: totalEcl > 0
      ? `매출채권 ${fmt(totalBalance)}원, ECL 충당금 ${fmt(totalEcl)}원`
      : '파싱 실패: 연령분석 데이터를 찾을 수 없습니다',
  };
}

// ═══════════════════════════════════════════════
// 4. 재고자산 NRV (IAS 2)
// ═══════════════════════════════════════════════

export async function parseInventoryNrv(buffer: Buffer): Promise<AdjustmentResult> {
  const wb = await loadWorkbook(buffer);
  const sheet = wb.worksheets[0];
  const items: AdjustmentItem[] = [];

  const headerRow = findHeaderRow(sheet, ['품목', '장부']) !== -1
    ? findHeaderRow(sheet, ['품목', '장부'])
    : findHeaderRow(sheet, ['구분', '취득']);

  let totalBook = 0, totalNrv = 0, totalLoss = 0;

  if (headerRow > 0) {
    const headers = (sheet.getRow(headerRow).values as any[]) || [];
    const colName = Math.max(findColumn(headers, '품목'), findColumn(headers, '구분'), findColumn(headers, '품명'), 1);
    const colBook = Math.max(findColumn(headers, '장부'), findColumn(headers, '취득'), findColumn(headers, '원가'), 2);
    const colNrv = Math.max(findColumn(headers, 'NRV'), findColumn(headers, '순실현'), findColumn(headers, '시가'), findColumn(headers, '공정'), -1);
    const colLoss = findColumn(headers, '평가손실');

    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const name = getCellValue(row.getCell(colName));
      if (!name || /합계|총계/.test(String(name))) continue;

      const book = toNumber(getCellValue(row.getCell(colBook)));
      if (book === 0) continue;

      let loss = 0;
      if (colLoss > 0) {
        loss = Math.abs(toNumber(getCellValue(row.getCell(colLoss))));
      } else if (colNrv > 0) {
        const nrv = toNumber(getCellValue(row.getCell(colNrv)));
        loss = Math.max(0, book - nrv);
      }

      totalBook += book;
      totalNrv += (book - loss);
      totalLoss += loss;
    }
  } else {
    // 키-값 쌍
    for (let r = 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      for (let c = 1; c <= 10; c++) {
        const label = String(getCellValue(row.getCell(c)) || '').replace(/\s/g, '');
        const val = toNumber(getCellValue(row.getCell(c + 1)));
        if (/장부금액|재고.*총액|취득원가/.test(label)) totalBook = val;
        if (/NRV|순실현가능가액/.test(label)) totalNrv = val;
        if (/평가손실/.test(label)) totalLoss = val;
      }
    }
    if (totalBook > 0 && totalNrv > 0 && totalLoss === 0) totalLoss = Math.max(0, totalBook - totalNrv);
  }

  if (totalBook > 0) {
    items.push({
      account_name: '재고자산',
      kgaap_amount: totalBook,
      kifrs_amount: totalBook - totalLoss,
      diff: -totalLoss,
      note: `NRV 평가: 장부 ${fmt(totalBook)} → NRV ${fmt(totalBook - totalLoss)} (평가손실 ${fmt(totalLoss)})`,
    });
  }

  return {
    category: 'inventory',
    label: '재고자산 NRV (IAS 2)',
    items,
    summary: totalBook > 0
      ? `재고자산 ${fmt(totalBook)}원, NRV 평가손실 ${fmt(totalLoss)}원`
      : '파싱 실패: 재고자산 데이터를 찾을 수 없습니다',
  };
}

// ═══════════════════════════════════════════════
// 5. 유형자산 재평가 (IAS 16)
// ═══════════════════════════════════════════════

export async function parsePpeRevaluation(buffer: Buffer): Promise<AdjustmentResult> {
  const wb = await loadWorkbook(buffer);
  const sheet = wb.worksheets[0];
  const items: AdjustmentItem[] = [];

  const headerRow = findHeaderRow(sheet, ['자산', '장부']) !== -1
    ? findHeaderRow(sheet, ['자산', '장부'])
    : findHeaderRow(sheet, ['구분', '취득']);

  if (headerRow > 0) {
    const headers = (sheet.getRow(headerRow).values as any[]) || [];
    const colName = Math.max(findColumn(headers, '자산'), findColumn(headers, '구분'), 1);
    const colBook = Math.max(findColumn(headers, '장부'), findColumn(headers, '취득'), 2);
    const colFair = Math.max(findColumn(headers, '공정'), findColumn(headers, '재평가'), findColumn(headers, '감정'), -1);

    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const name = String(getCellValue(row.getCell(colName)) || '');
      if (!name || /합계|총계/.test(name)) continue;

      const book = toNumber(getCellValue(row.getCell(colBook)));
      const fair = colFair > 0 ? toNumber(getCellValue(row.getCell(colFair))) : 0;
      if (book === 0 && fair === 0) continue;

      if (fair > 0) {
        items.push({
          account_name: name,
          kgaap_amount: book,
          kifrs_amount: fair,
          diff: fair - book,
          note: `재평가: 장부 ${fmt(book)} → 공정가치 ${fmt(fair)}`,
        });
      }
    }
  } else {
    // 키-값
    for (let r = 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      for (let c = 1; c <= 10; c++) {
        const label = String(getCellValue(row.getCell(c)) || '').replace(/\s/g, '');
        const val = toNumber(getCellValue(row.getCell(c + 1)));
        if (/토지.*공정|공정.*토지/.test(label) && val > 0) {
          items.push({ account_name: '토지', kgaap_amount: 0, kifrs_amount: val, diff: val, note: `토지 공정가치: ${fmt(val)}` });
        }
        if (/건물.*공정|공정.*건물/.test(label) && val > 0) {
          items.push({ account_name: '건물', kgaap_amount: 0, kifrs_amount: val, diff: val, note: `건물 공정가치: ${fmt(val)}` });
        }
      }
    }
  }

  const totalDiff = items.reduce((s, i) => s + i.diff, 0);
  return {
    category: 'ppe',
    label: '유형자산 재평가 (IAS 16)',
    items,
    summary: items.length > 0
      ? `${items.length}건 재평가, 순증감 ${fmt(totalDiff)}원`
      : '파싱 실패: 유형자산 재평가 데이터를 찾을 수 없습니다',
  };
}

// ═══════════════════════════════════════════════
// 6. 금융상품 분류 (IFRS 9)
// ═══════════════════════════════════════════════

export async function parseFinancialInstruments(buffer: Buffer): Promise<AdjustmentResult> {
  const wb = await loadWorkbook(buffer);
  const sheet = wb.worksheets[0];
  const items: AdjustmentItem[] = [];

  const headerRow = findHeaderRow(sheet, ['금융', '분류']) !== -1
    ? findHeaderRow(sheet, ['금융', '분류'])
    : findHeaderRow(sheet, ['상품', '장부']);

  if (headerRow > 0) {
    const headers = (sheet.getRow(headerRow).values as any[]) || [];
    const colName = Math.max(findColumn(headers, '상품'), findColumn(headers, '금융'), findColumn(headers, '구분'), 1);
    const colKgaap = Math.max(findColumn(headers, 'K-GAAP'), findColumn(headers, '장부'), findColumn(headers, '취득'), 2);
    const colClassification = Math.max(findColumn(headers, 'IFRS'), findColumn(headers, '분류'), findColumn(headers, 'K-IFRS'), -1);
    const colFair = Math.max(findColumn(headers, '공정'), findColumn(headers, '시가'), -1);

    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const name = String(getCellValue(row.getCell(colName)) || '');
      if (!name || /합계|총계/.test(name)) continue;

      const kgaap = toNumber(getCellValue(row.getCell(colKgaap)));
      const fair = colFair > 0 ? toNumber(getCellValue(row.getCell(colFair))) : kgaap;
      const classification = colClassification > 0 ? String(getCellValue(row.getCell(colClassification)) || '') : '';
      if (kgaap === 0 && fair === 0) continue;

      items.push({
        account_name: name,
        kgaap_amount: kgaap,
        kifrs_amount: fair || kgaap,
        diff: (fair || kgaap) - kgaap,
        note: classification
          ? `${classification} 분류, 공정가치 ${fmt(fair || kgaap)}원`
          : `공정가치 ${fmt(fair || kgaap)}원`,
      });
    }
  }

  const totalDiff = items.reduce((s, i) => s + i.diff, 0);
  return {
    category: 'financial',
    label: '금융상품 분류 (IFRS 9)',
    items,
    summary: items.length > 0
      ? `${items.length}건 재분류, 공정가치 평가차이 ${fmt(totalDiff)}원`
      : '파싱 실패: 금융상품 데이터를 찾을 수 없습니다',
  };
}

// ── 자동 분류 파서 ──

export async function autoParseInternalData(buffer: Buffer, category?: string): Promise<AdjustmentResult> {
  if (category) {
    switch (category) {
      case 'lease': return parseLeaseData(buffer);
      case 'retirement': return parseRetirementData(buffer);
      case 'ecl': return parseEclData(buffer);
      case 'inventory': return parseInventoryNrv(buffer);
      case 'ppe': return parsePpeRevaluation(buffer);
      case 'financial': return parseFinancialInstruments(buffer);
    }
  }

  // 자동 분류: 시트명이나 키워드로 판단
  const wb = await loadWorkbook(buffer);
  const sheetName = wb.worksheets[0]?.name || '';
  const firstRows: string[] = [];
  const sheet = wb.worksheets[0];
  for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
    const row = sheet.getRow(r);
    const vals = row.values as any[];
    if (vals) firstRows.push(vals.map(v => String(v || '')).join(' '));
  }
  const allText = (sheetName + ' ' + firstRows.join(' ')).replace(/\s/g, '');

  if (/리스|임차|사용권|lease/i.test(allText)) return parseLeaseData(buffer);
  if (/퇴직|DBO|보험수리|확정급여/i.test(allText)) return parseRetirementData(buffer);
  if (/연령|aging|ECL|기대신용|대손/i.test(allText)) return parseEclData(buffer);
  if (/재고|NRV|순실현|inventory/i.test(allText)) return parseInventoryNrv(buffer);
  if (/재평가|감정|공정가치.*토지|공정가치.*건물/i.test(allText)) return parsePpeRevaluation(buffer);
  if (/금융상품|FVPL|FVOCI|AC측정|매도가능/i.test(allText)) return parseFinancialInstruments(buffer);

  return {
    category: 'unknown',
    label: '자동분류 실패',
    items: [],
    summary: '파일 내용을 자동 분류할 수 없습니다. 카테고리를 지정해서 다시 업로드해주세요.',
  };
}

// ── fmt helper ──
function fmt(val: number): string {
  return val.toLocaleString('ko-KR');
}
