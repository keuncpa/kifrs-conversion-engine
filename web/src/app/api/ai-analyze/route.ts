import { NextRequest, NextResponse } from 'next/server';
import {
  generateConversionAnalysis,
  streamConversionAnalysis,
  isAIAvailable,
  type AIAnalysisRequest,
} from '@/lib/ai-engine';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    if (!isAIAvailable()) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY가 설정되지 않았습니다.' },
        { status: 503 }
      );
    }

    const body = await req.json();
    const { mode, ...request } = body as { mode?: string } & AIAnalysisRequest;

    // 스트리밍 모드
    if (mode === 'stream') {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of streamConversionAnalysis(request)) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          } catch (err: any) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`)
            );
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    // JSON 모드 (기본)
    const result = await generateConversionAnalysis(request);
    return NextResponse.json({ result });
  } catch (err: any) {
    console.error('AI analysis error:', err);
    return NextResponse.json(
      { error: err.message || 'AI 분석 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// AI 사용 가능 여부 확인 엔드포인트
export async function GET() {
  return NextResponse.json({ available: isAIAvailable() });
}
