import { NextRequest, NextResponse } from 'next/server';
import { autoParseInternalData } from '@/lib/internal-data-parser';
import type { AdjustmentResult } from '@/lib/internal-data-parser';

export const maxDuration = 60;

async function fileToBuffer(file: File): Promise<Buffer> {
  const ab = await file.arrayBuffer();
  return Buffer.from(new Uint8Array(ab));
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const results: AdjustmentResult[] = [];

    // formData에서 파일들 추출 (file_0, category_0, file_1, category_1, ...)
    let idx = 0;
    while (true) {
      const file = formData.get(`file_${idx}`) as File | null;
      if (!file) break;

      const category = formData.get(`category_${idx}`) as string | null;
      const buf = await fileToBuffer(file);
      const result = await autoParseInternalData(buf, category || undefined);
      results.push(result);
      idx++;
    }

    // 단일 파일 업로드 (file + category)
    if (idx === 0) {
      const file = formData.get('file') as File | null;
      if (!file) {
        return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 });
      }
      const category = formData.get('category') as string | null;
      const buf = await fileToBuffer(file);
      const result = await autoParseInternalData(buf, category || undefined);
      results.push(result);
    }

    return NextResponse.json({ results });
  } catch (err: any) {
    console.error('Internal data parse error:', err);
    return NextResponse.json({ error: err.message || '파일 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
