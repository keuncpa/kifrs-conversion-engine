import { NextRequest, NextResponse } from 'next/server';
import { runConversion } from '@/lib/converter';
import { generateExcel } from '@/lib/excel-export';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { company_name, fiscal_year, fs_div } = body;

    if (!company_name) {
      return NextResponse.json({ error: '기업명을 입력하세요.' }, { status: 400 });
    }

    const result = await runConversion(company_name, fiscal_year, fs_div || 'OFS');
    const buffer = await generateExcel(result);

    const filename = encodeURIComponent(`${result.company.corp_name}_KIFRS전환_${result.fiscal_year}.xlsx`);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
