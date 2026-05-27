import { NextRequest, NextResponse } from 'next/server';
import { runConversion } from '@/lib/converter';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { company_name, fiscal_year, fs_div } = body;

    if (!company_name) {
      return NextResponse.json({ error: '기업명을 입력하세요.' }, { status: 400 });
    }

    const result = await runConversion(company_name, fiscal_year, fs_div || 'OFS');

    // FinancialAccount 배열은 크기가 클 수 있으므로 요약 + 원본 모두 전달
    return NextResponse.json({
      company: result.company,
      fiscal_year: result.fiscal_year,
      accounting_standard: result.accounting_standard,
      accuracy_grade: result.accuracy_grade,
      bs_accounts: result.bs_accounts,
      is_accounts: result.is_accounts,
      conversion_items: result.conversion_items,
      conversion_deltas: result.conversion_deltas,
      kifrs_statements: result.kifrs_statements,
      checklist: result.checklist,
      audit_report: result.audit_report,
      warnings: result.warnings,
      summary: {
        bs_count: result.bs_accounts.length,
        is_count: result.is_accounts.length,
        conversion_count: result.conversion_items.length,
        high_impact_count: result.conversion_items.filter(i => i.impact === 'HIGH').length,
        medium_impact_count: result.conversion_items.filter(i => i.impact === 'MEDIUM').length,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
