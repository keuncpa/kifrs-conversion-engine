import { NextRequest, NextResponse } from 'next/server';
import { searchCompany, getCompanyInfo } from '@/lib/dart-api';

export const maxDuration = 60; // Vercel Pro: 최대 60초

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name');
  if (!name) {
    return NextResponse.json({ error: '기업명을 입력하세요.' }, { status: 400 });
  }

  try {
    const results = await searchCompany(name, 10);

    // 상위 5개에 대해 기업개황도 함께 조회
    const enriched = await Promise.all(
      results.slice(0, 5).map(async (c) => {
        try {
          const info = await getCompanyInfo(c.corp_code);
          return {
            corp_code: c.corp_code,
            corp_name: c.corp_name,
            stock_code: c.stock_code,
            industry: info?.industry_category || '',
            induty_code: info?.induty_code || '',
            ceo_nm: info?.ceo_nm || '',
            acc_mt: info?.acc_mt || '',
          };
        } catch {
          return {
            corp_code: c.corp_code,
            corp_name: c.corp_name,
            stock_code: c.stock_code,
            industry: '',
            induty_code: '',
            ceo_nm: '',
            acc_mt: '',
          };
        }
      })
    );

    return NextResponse.json({ results: enriched });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
