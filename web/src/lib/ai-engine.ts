/**
 * AI 전환근거 생성 엔진
 * OpenAI GPT API를 활용한 K-GAAP → K-IFRS 전환근거 자동 생성
 *
 * 삼일PwC AI Accountant와 유사한 접근:
 * - K-IFRS 기준서 컨텍스트 기반 RAG-like 분석
 * - 계정과목별 전환 영향 분석 및 근거 생성
 * - 업로드 내부자료 이상치 검증
 */

import OpenAI from 'openai';

// ── 타입 정의 ──

export interface AIAnalysisRequest {
  companyName: string;
  fiscalYear: string;
  industry: string;
  accounts: {
    name: string;
    amount: number | null;
    category: string; // 자산/부채/자본/수익/비용
    kifrsStandard: string;
    impact: string;
  }[];
}

export interface AIConversionRationale {
  accountName: string;
  kifrsStandard: string;
  rationale: string;          // AI 생성 전환근거
  standardReference: string;  // IFRS 기준서 조항 인용
  adjustmentDirection: string; // 증가/감소/변동없음
  estimatedImpact: string;    // 추정 영향 설명
  riskLevel: string;          // 위험도 평가
  requiredActions: string[];  // 필요 조치사항
}

export interface AIAnalysisResult {
  companyOverview: string;      // 전체 전환 영향 요약
  rationales: AIConversionRationale[];
  keyRisks: string[];           // 주요 리스크
  recommendations: string[];    // 권고사항
  totalImpactSummary: string;   // 총 영향 요약
}

export interface AIValidationResult {
  isReasonable: boolean;
  findings: string[];
  anomalies: { field: string; value: string; issue: string }[];
  suggestions: string[];
}

// ── K-IFRS 기준서 핵심 컨텍스트 (Pseudo-RAG) ──
// 실제 RAG 시스템에서는 벡터DB에서 검색하지만,
// 여기서는 핵심 기준서 내용을 시스템 프롬프트로 제공

const KIFRS_STANDARDS_CONTEXT = `
## K-IFRS 주요 기준서 핵심 내용 (전환 시 적용)

### IFRS 9 금융상품
- 문단 5.5.1: 기대신용손실(ECL) 모형 — 발생손실이 아닌 기대손실 인식
- 문단 5.5.15: 매출채권은 간편법 적용 가능 (전체기간 기대신용손실)
- 문단 4.1.2: 금융자산 분류 — 사업모형과 현금흐름 특성에 따라 AC/FVOCI/FVPL
- 문단 5.2.1: 최초 인식 시 공정가치로 측정
- K-GAAP 대손충당금(발생손실 모형) → K-IFRS ECL 모형으로 전환 시 일반적으로 충당금 증가

### IFRS 15 고객과의 계약에서 생기는 수익
- 문단 9: 5단계 수익인식 모형
  1단계: 계약 식별, 2단계: 수행의무 식별, 3단계: 거래가격 산정
  4단계: 거래가격 배분, 5단계: 수행의무 이행 시 수익인식
- 문단 B34-B38: 본인/대리인 판단 — 재고위험, 가격결정권, 신용위험
- 문단 51-58: 변동대가(반품, 할인, 인센티브) 추정 및 제약
- K-GAAP 인도기준 → K-IFRS 수행의무 이행기준으로 전환 시 수익인식 시점 변동 가능

### IFRS 16 리스
- 문단 22: 리스이용자는 사용권자산과 리스부채를 인식
- 문단 26: 리스부채 = 미래 리스료의 현재가치 (증분차입이자율 적용)
- 문단 24: 사용권자산 = 리스부채 + 선급리스료 + 초기직접원가 + 복구원가 추정치
- 문단 5: 단기리스(12개월 이하), 소액자산 리스 면제 가능
- K-GAAP 운용리스 임차료 → K-IFRS 사용권자산 감가상각비 + 리스부채 이자비용

### IAS 19 종업원급여
- 문단 67: 확정급여채무(DBO)는 예측단위적립방식(PUC)으로 측정
- 문단 83: 보험수리적 가정 — 할인율, 임금상승률, 퇴직률, 사망률
- 문단 120: 재측정요소(보험수리적 손익)는 기타포괄손익(OCI)으로 인식
- 문단 113: 사외적립자산은 공정가치로 측정
- K-GAAP 퇴직급여충당부채(간편법) → K-IFRS DBO(보험수리적 평가) 전환 시 일반적으로 부채 증가

### IAS 16 유형자산
- 문단 29-31: 원가모형 또는 재평가모형 선택 (회계정책)
- 문단 43-47: 구성요소별 감가상각 (component depreciation)
- 문단 51: 잔존가치와 내용연수를 매 회계연도 말 재검토
- 문단 63: 손상차손 인식 (IAS 36 적용)
- K-GAAP → K-IFRS 전환 시 IFRS 1 면제규정으로 간주원가 적용 가능

### IAS 2 재고자산
- 문단 9: 원가와 순실현가능가치(NRV) 중 낮은 금액으로 측정
- 문단 25: 후입선출법(LIFO) 사용 불가
- 문단 34: 저가법 평가손실은 매출원가에 포함

### IAS 12 법인세
- 문단 15, 24: 모든 가산·차감 일시적차이에 대해 이연법인세 인식
- 문단 56: 이연법인세는 항상 비유동으로 분류
- 문단 47: 이연법인세자산 인식 시 실현가능성 평가

### IAS 37 충당부채
- 문단 14: 인식요건 — 현재의무, 자원유출 가능성, 신뢰성 있는 추정
- 문단 36: 최선의 추정치로 측정, 화폐의 시간가치 고려

### IAS 32 금융상품 표시
- 문단 28-32: 복합금융상품(전환사채 등)의 부채요소와 자본요소 분리
- 문단 11: 금융부채와 지분상품의 구분 기준

### IFRS 1 한국채택국제회계기준의 최초채택
- 문단 D5-D8: 유형자산·투자부동산·무형자산에 간주원가 면제규정 적용 가능
- 문단 E1: 사업결합 소급적용 면제
- 문단 D9B: 리스 전환 실무간편법 허용
- 문단 7: 전환일 개시 재무상태표 작성 필수
`;

// ── OpenAI 클라이언트 ──

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

// ── AI 전환근거 생성 ──

export async function generateConversionAnalysis(
  request: AIAnalysisRequest
): Promise<AIAnalysisResult> {
  const client = getOpenAIClient();
  if (!client) {
    throw new Error('OPENAI_API_KEY가 설정되지 않았습니다. .env.local에 추가해주세요.');
  }

  const accountsSummary = request.accounts
    .filter(a => a.impact === 'HIGH' || a.impact === 'MEDIUM')
    .map(a => `- ${a.name}: ${a.amount ? (a.amount / 1e6).toFixed(0) + '백만원' : '금액 미상'} (${a.category}, 영향도: ${a.impact}, 관련 기준서: ${a.kifrsStandard})`)
    .join('\n');

  const systemPrompt = `당신은 K-GAAP에서 K-IFRS로의 회계기준 전환(컨버전)을 수행하는 전문 회계사입니다.
아래 K-IFRS 기준서 핵심 내용을 참고하여, 각 계정과목별로 구체적이고 정확한 전환근거를 작성해주세요.

${KIFRS_STANDARDS_CONTEXT}

중요 지침:
1. 각 계정과목에 대해 관련 IFRS 기준서의 구체적 문단 번호를 인용하세요.
2. K-GAAP과 K-IFRS의 차이점을 명확히 설명하세요.
3. 조정 방향(증가/감소)과 그 근거를 논리적으로 제시하세요.
4. 실무에서 필요한 추가 검토사항을 구체적으로 명시하세요.
5. 업종 특성(${request.industry})을 고려한 분석을 포함하세요.

반드시 아래 JSON 형식으로 응답하세요(마크다운 코드블록 없이 순수 JSON만):`;

  const userPrompt = `다음 기업의 K-GAAP → K-IFRS 전환 분석을 수행해주세요.

기업명: ${request.companyName}
사업연도: ${request.fiscalYear}
업종: ${request.industry}

주요 조정 대상 계정과목:
${accountsSummary}

아래 JSON 형식으로 응답해주세요:
{
  "companyOverview": "전체 전환 영향 요약 (3~5문장)",
  "rationales": [
    {
      "accountName": "계정과목명",
      "kifrsStandard": "관련 기준서",
      "rationale": "전환근거 상세 설명 (K-GAAP vs K-IFRS 차이점, 조정 내용)",
      "standardReference": "IFRS 기준서 구체적 문단 인용 (예: IFRS 9 문단 5.5.1, 5.5.15)",
      "adjustmentDirection": "증가/감소/변동없음/재분류",
      "estimatedImpact": "추정 영향 설명",
      "riskLevel": "상/중/하",
      "requiredActions": ["필요 조치사항 1", "필요 조치사항 2"]
    }
  ],
  "keyRisks": ["주요 리스크 1", "주요 리스크 2"],
  "recommendations": ["권고사항 1", "권고사항 2"],
  "totalImpactSummary": "총 영향 요약"
}`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('AI 응답이 비어있습니다.');

  try {
    const parsed = JSON.parse(content) as AIAnalysisResult;
    return parsed;
  } catch {
    throw new Error('AI 응답 파싱 실패: ' + content.substring(0, 200));
  }
}

// ── AI 내부자료 검증 ──

export async function validateInternalData(
  category: string,
  data: Record<string, unknown>[],
  companyContext: { name: string; industry: string; fiscalYear: string }
): Promise<AIValidationResult> {
  const client = getOpenAIClient();
  if (!client) {
    return {
      isReasonable: true,
      findings: ['AI 검증 미실시 (API 키 미설정)'],
      anomalies: [],
      suggestions: [],
    };
  }

  const dataPreview = JSON.stringify(data.slice(0, 10), null, 2);

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `당신은 K-IFRS 전환을 위한 내부자료를 검증하는 회계감사 전문가입니다.
업로드된 자료의 합리성, 이상치, 누락 항목을 점검해주세요.
업종: ${companyContext.industry}, 사업연도: ${companyContext.fiscalYear}

반드시 아래 JSON 형식으로 응답하세요:
{
  "isReasonable": true/false,
  "findings": ["발견사항 1", "발견사항 2"],
  "anomalies": [{"field": "필드명", "value": "값", "issue": "문제점"}],
  "suggestions": ["제안사항 1"]
}`
      },
      {
        role: 'user',
        content: `${companyContext.name}의 ${category} 자료를 검증해주세요.\n\n데이터 프리뷰:\n${dataPreview}`
      },
    ],
    temperature: 0.2,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return { isReasonable: true, findings: ['AI 검증 실패'], anomalies: [], suggestions: [] };
  }

  try {
    return JSON.parse(content) as AIValidationResult;
  } catch {
    return { isReasonable: true, findings: ['AI 응답 파싱 실패'], anomalies: [], suggestions: [] };
  }
}

// ── AI 스트리밍 전환근거 생성 (SSE) ──

export async function* streamConversionAnalysis(
  request: AIAnalysisRequest
): AsyncGenerator<string> {
  const client = getOpenAIClient();
  if (!client) {
    throw new Error('OPENAI_API_KEY가 설정되지 않았습니다.');
  }

  const accountsSummary = request.accounts
    .filter(a => a.impact === 'HIGH' || a.impact === 'MEDIUM')
    .map(a => `- ${a.name}: ${a.amount ? (a.amount / 1e6).toFixed(0) + '백만원' : '금액미상'} (${a.category}, 영향도: ${a.impact}, 기준서: ${a.kifrsStandard})`)
    .join('\n');

  const systemPrompt = `당신은 K-GAAP → K-IFRS 전환 전문 회계사입니다.
${KIFRS_STANDARDS_CONTEXT}

각 계정과목에 대해 전환근거를 마크다운 형식으로 작성하세요.
반드시 IFRS 기준서의 구체적 문단 번호를 인용하고, 조정 방향과 실무 필요사항을 명시하세요.`;

  const userPrompt = `기업명: ${request.companyName} | 업종: ${request.industry} | 사업연도: ${request.fiscalYear}

아래 계정과목들의 K-IFRS 전환근거를 작성해주세요:
${accountsSummary}

각 계정과목별로 다음 형식으로 작성:
## [계정과목명] — [관련 IFRS 기준서]
**전환근거**: K-GAAP과 K-IFRS의 차이점 및 조정 내용 (기준서 문단 인용)
**조정방향**: 증가/감소/재분류
**추정영향**: 구체적 영향 설명
**필요조치**: 실무에서 확보해야 할 자료 및 수행할 절차

마지막에 전체 요약 작성.`;

  const stream = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 4000,
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}

// ── AI 사용 가능 여부 확인 ──

export function isAIAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}
