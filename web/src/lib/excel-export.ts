/**
 * 엑셀 출력 모듈 (ExcelJS)
 * Vercel Serverless에서 동작하는 서버 사이드 엑셀 생성
 */

import ExcelJS from 'exceljs';
import { ConversionResult } from './converter';

export async function generateExcel(result: ConversionResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'K-IFRS 컨버전 시스템';
  wb.created = new Date();

  const r = result;

  // 공통 스타일
  const headerFont: Partial<ExcelJS.Font> = { name: '맑은 고딕', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
  const headerFill: ExcelJS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C3E50' } };
  const normalFont: Partial<ExcelJS.Font> = { name: '맑은 고딕', size: 10 };
  const titleFont: Partial<ExcelJS.Font> = { name: '맑은 고딕', bold: true, size: 14 };
  const subtitleFont: Partial<ExcelJS.Font> = { name: '맑은 고딕', size: 10, color: { argb: 'FF666666' } };
  const numFmt = '#,##0';
  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
    bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
    left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
    right: { style: 'thin', color: { argb: 'FFD9D9D9' } },
  };

  const impactFills: Record<string, ExcelJS.FillPattern> = {
    HIGH: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE0E0' } },
    MEDIUM: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFDE7' } },
    LOW: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } },
    NONE: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } },
    REVIEW: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE0B2' } },
  };

  function writeHeader(ws: ExcelJS.Worksheet, rowNum: number, headers: string[]) {
    const row = ws.getRow(rowNum);
    headers.forEach((h, i) => {
      const cell = row.getCell(i + 1);
      cell.value = h;
      cell.font = headerFont;
      cell.fill = headerFill;
      cell.alignment = { horizontal: 'center', wrapText: true };
    });
  }

  function styleDataRows(ws: ExcelJS.Worksheet, startRow: number, endRow: number, numCols: number, numColIndices?: Set<number>) {
    for (let r = startRow; r <= endRow; r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= numCols; c++) {
        const cell = row.getCell(c);
        cell.font = normalFont;
        cell.border = thinBorder;
        if (numColIndices?.has(c)) {
          cell.numFmt = numFmt;
        }
      }
    }
  }

  // ── Sheet 1: 재무상태표 ──
  const wsBs = wb.addWorksheet('재무상태표');
  wsBs.getCell('A1').value = `${r.company.corp_name} 재무상태표 (K-GAAP)`;
  wsBs.getCell('A1').font = titleFont;
  wsBs.getCell('A2').value = `제${r.fiscal_year}기 | 정확도: ${r.accuracy_grade} | 출처: DART 공시`;
  wsBs.getCell('A2').font = subtitleFont;

  writeHeader(wsBs, 4, ['계정과목', `당기금액\n(${r.fiscal_year})`, '전기금액', '전전기금액']);
  let row = 5;
  for (const acc of r.bs_accounts) {
    wsBs.getCell(row, 1).value = acc.account_nm;
    wsBs.getCell(row, 2).value = acc.thstrm_amount;
    wsBs.getCell(row, 3).value = acc.frmtrm_amount;
    wsBs.getCell(row, 4).value = acc.bfefrmtrm_amount;
    row++;
  }
  styleDataRows(wsBs, 5, row - 1, 4, new Set([2, 3, 4]));
  wsBs.getColumn('A').width = 30;
  ['B', 'C', 'D'].forEach(c => { wsBs.getColumn(c).width = 18; });

  // ── Sheet 2: 손익계산서 ──
  const wsIs = wb.addWorksheet('손익계산서');
  wsIs.getCell('A1').value = `${r.company.corp_name} 손익계산서 (K-GAAP)`;
  wsIs.getCell('A1').font = titleFont;
  wsIs.getCell('A2').value = `제${r.fiscal_year}기 | 출처: DART 공시`;
  wsIs.getCell('A2').font = subtitleFont;

  writeHeader(wsIs, 4, ['계정과목', `당기금액\n(${r.fiscal_year})`, '전기금액']);
  row = 5;
  for (const acc of r.is_accounts) {
    wsIs.getCell(row, 1).value = acc.account_nm;
    wsIs.getCell(row, 2).value = acc.thstrm_amount;
    wsIs.getCell(row, 3).value = acc.frmtrm_amount;
    row++;
  }
  styleDataRows(wsIs, 5, row - 1, 3, new Set([2, 3]));
  wsIs.getColumn('A').width = 30;
  ['B', 'C'].forEach(c => { wsIs.getColumn(c).width = 18; });

  // ── Sheet 3: 전환근거 ──
  const wsConv = wb.addWorksheet('전환근거');
  wsConv.getCell('A1').value = `${r.company.corp_name} K-IFRS 전환근거`;
  wsConv.getCell('A1').font = titleFont;
  wsConv.getCell('A2').value = `정확도: ${r.accuracy_grade} | DART 공시 기반 예비분석 | 정밀 분석에는 내부자료 필요`;
  wsConv.getCell('A2').font = subtitleFont;

  writeHeader(wsConv, 4, ['No.', '구분', 'K-GAAP 계정과목', '장부금액', '적용 K-IFRS', '전환 시 변동사항', '영향도', '정확도']);
  row = 5;
  for (const item of r.conversion_items) {
    wsConv.getCell(row, 1).value = item.no;
    wsConv.getCell(row, 2).value = item.category;
    wsConv.getCell(row, 3).value = item.account_name;
    wsConv.getCell(row, 4).value = item.book_value;
    wsConv.getCell(row, 5).value = `${item.kifrs_standard} ${item.kifrs_name}`;
    wsConv.getCell(row, 6).value = item.change_description;
    wsConv.getCell(row, 7).value = item.impact;
    wsConv.getCell(row, 8).value = item.accuracy;

    if (impactFills[item.impact]) {
      for (let c = 1; c <= 8; c++) {
        wsConv.getCell(row, c).fill = impactFills[item.impact];
      }
    }
    row++;
  }
  styleDataRows(wsConv, 5, row - 1, 8, new Set([4]));
  const convWidths = [5, 8, 22, 16, 28, 35, 8, 8];
  'ABCDEFGH'.split('').forEach((c, i) => { wsConv.getColumn(c).width = convWidths[i]; });

  // ── Sheet 4: 전환 변동내역 ──
  const wsDelta = wb.addWorksheet('전환변동내역');
  wsDelta.getCell('A1').value = `${r.company.corp_name} 전환 변동내역`;
  wsDelta.getCell('A1').font = titleFont;

  writeHeader(wsDelta, 3, ['계정과목', 'K-GAAP 금액', '전환조정', 'K-IFRS 추정', '변동여부', '적용 K-IFRS', '변동/무변동 근거', '추정 가정']);
  row = 4;
  for (const d of r.conversion_deltas) {
    wsDelta.getCell(row, 1).value = d.account_name;
    wsDelta.getCell(row, 2).value = d.kgaap_amount;
    wsDelta.getCell(row, 3).value = d.adjustment ?? '산출 필요';
    wsDelta.getCell(row, 4).value = d.kifrs_estimated ?? '실측 필요';
    wsDelta.getCell(row, 5).value = d.changed ? '변동' : '무변동';
    wsDelta.getCell(row, 6).value = d.kifrs_standard;
    wsDelta.getCell(row, 7).value = d.change_basis;
    wsDelta.getCell(row, 8).value = d.assumptions;
    row++;
  }
  styleDataRows(wsDelta, 4, row - 1, 8, new Set([2, 3, 4]));
  const deltaWidths = [22, 16, 12, 16, 8, 16, 35, 30];
  'ABCDEFGH'.split('').forEach((c, i) => { wsDelta.getColumn(c).width = deltaWidths[i]; });

  // ── Sheet 5: 필요 내부자료 ──
  const wsCk = wb.addWorksheet('필요내부자료');
  wsCk.getCell('A1').value = `${r.company.corp_name} K-IFRS 전환 필요 내부자료`;
  wsCk.getCell('A1').font = titleFont;

  writeHeader(wsCk, 3, ['카테고리', '필요 자료', '우선순위']);
  row = 4;
  for (const cat of r.checklist) {
    for (let i = 0; i < cat.items.length; i++) {
      wsCk.getCell(row, 1).value = i === 0 ? cat.category : '';
      wsCk.getCell(row, 2).value = cat.items[i];
      wsCk.getCell(row, 3).value = i === 0 ? cat.priority : '';
      row++;
    }
  }
  styleDataRows(wsCk, 4, row - 1, 3);
  wsCk.getColumn('A').width = 25;
  wsCk.getColumn('B').width = 55;
  wsCk.getColumn('C').width = 12;

  // ── Sheet 6: 요약 ──
  const wsSum = wb.addWorksheet('요약');
  wsSum.getCell('A1').value = 'K-GAAP → K-IFRS 전환 요약';
  wsSum.getCell('A1').font = titleFont;

  const infoRows = [
    ['회사명', r.company.corp_name],
    ['사업자등록번호', r.company.bizr_no],
    ['대표이사', r.company.ceo_nm],
    ['업종', `${r.company.industry_category} (${r.company.induty_code})`],
    ['결산월', `${r.company.acc_mt}월`],
    ['사업연도', r.fiscal_year],
    ['적용 회계기준', r.accounting_standard],
    ['분석 정확도', r.accuracy_grade],
    ['데이터 출처', 'DART 전자공시시스템'],
    ['분석 일시', new Date().toLocaleString('ko-KR')],
  ];
  row = 3;
  for (const [label, val] of infoRows) {
    wsSum.getCell(row, 1).value = label;
    wsSum.getCell(row, 1).font = { ...normalFont, bold: true };
    wsSum.getCell(row, 2).value = val;
    wsSum.getCell(row, 2).font = normalFont;
    row++;
  }

  if (r.warnings.length) {
    row++;
    wsSum.getCell(row, 1).value = '⚠ 주의사항';
    wsSum.getCell(row, 1).font = { name: '맑은 고딕', bold: true, size: 11, color: { argb: 'FFFF0000' } };
    row++;
    for (const w of r.warnings) {
      wsSum.getCell(row, 1).value = w;
      wsSum.getCell(row, 1).font = normalFont;
      row++;
    }
  }

  row++;
  wsSum.getCell(row, 1).value = 'ℹ 정확도 등급 안내';
  wsSum.getCell(row, 1).font = { name: '맑은 고딕', bold: true, size: 11 };
  row++;
  const grades = [
    'D등급: DART 공시 기반 예비분석. 주요 계정의 전환 방향성 파악 수준.',
    'C등급: 시산표(TB) + 계정과목체계(COA) 입력 시. 계정별 매핑 가능.',
    'B등급: 필수 입력 + 리스/금융상품/임직원 등 추가 입력 시. 주요 항목 실측.',
    'A등급: 전체 입력양식 작성 시. 감사 수준 근접.',
  ];
  for (const g of grades) {
    wsSum.getCell(row, 1).value = g;
    wsSum.getCell(row, 1).font = normalFont;
    row++;
  }

  wsSum.getColumn('A').width = 20;
  wsSum.getColumn('B').width = 50;

  // Buffer 생성
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
