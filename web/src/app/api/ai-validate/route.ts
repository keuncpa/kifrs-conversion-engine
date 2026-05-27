import { NextRequest, NextResponse } from 'next/server';
import { validateInternalData, isAIAvailable } from '@/lib/ai-engine';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    if (!isAIAvailable()) {
      return NextResponse.json({ error: 'OPENAI_API_KEY 미설정' }, { status: 503 });
    }

    const { category, data, companyContext } = await req.json();
    const result = await validateInternalData(category, data, companyContext);
    return NextResponse.json({ result });
  } catch (err: any) {
    console.error('AI validation error:', err);
    return NextResponse.json(
      { error: err.message || 'AI 검증 중 오류' },
      { status: 500 }
    );
  }
}
