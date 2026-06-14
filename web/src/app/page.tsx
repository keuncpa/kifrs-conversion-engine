'use client';

import { useState, useCallback } from 'react';

// ── 타입 ──

interface SearchResult {
  corp_code: string;
  corp_name: string;
  stock_code: string;
  industry: string;
  induty_code: string;
  ceo_nm: string;
  acc_mt: string;
}

interface KifrsLineItem {
  kifrs_name: string;
  kgaap_name: string;
  amount: number | null;
  kifrs_amount: number | null;
  diff: number | null;
  prev_amount: number | null;
  adjustment_needed: boolean;
  adjustment_note: string;
  impact: string;
  indent: number;
  is_total: boolean;
}

interface ConversionData {
  company: any;
  fiscal_year: string;
  accounting_standard: string;
  accuracy_grade: string;
  bs_accounts: any[];
  is_accounts: any[];
  conversion_items: any[];
  conversion_deltas: any[];
  kifrs_statements: { bs: KifrsLineItem[]; is: KifrsLineItem[] };
  checklist: any[];
  audit_report: any;
  warnings: string[];
  summary: {
    bs_count: number;
    is_count: number;
    conversion_count: number;
    high_impact_count: number;
    medium_impact_count: number;
  };
}

type Tab = 'bs' | 'is' | 'conversion' | 'delta' | 'checklist' | 'upload' | 'kifrs_bs' | 'kifrs_is' | 'ai_analysis';

const LOADING_STEPS = [
  '기업 검색 중...',
  '기업개황 조회 중...',
  '회계기준 확인 중...',
  '재무제표 수집 중...',
  '전환근거 매핑 중...',
  '변동내역 산출 중...',
  '체크리스트 생성 중...',
];

// ── 금액 포맷 ──

function fmt(val: number | null | undefined): string {
  if (val == null) return '-';
  return val.toLocaleString('ko-KR');
}

// ── 메인 컴포넌트 ──

export default function Home() {
  const [companyName, setCompanyName] = useState('');
  const [fiscalYear, setFiscalYear] = useState(String(new Date().getFullYear() - 1));
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [converting, setConverting] = useState(false);
  const [conversionData, setConversionData] = useState<ConversionData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('conversion');
  const [error, setError] = useState('');
  const [loadingStep, setLoadingStep] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [internalResults, setInternalResults] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string>('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [aiJsonResult, setAiJsonResult] = useState<any>(null);

  // ── 기업 검색 ──
  const handleSearch = useCallback(async () => {
    if (!companyName.trim()) return;
    setSearching(true);
    setError('');
    setSearchResults(null);
    setConversionData(null);

    try {
      const res = await fetch(`/api/search?name=${encodeURIComponent(companyName.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSearchResults(data.results);
      if (data.results.length === 0) {
        setError(`'${companyName}' 검색 결과가 없습니다.`);
      }
    } catch (err: any) {
      setError(err.message || '검색 중 오류가 발생했습니다.');
    } finally {
      setSearching(false);
    }
  }, [companyName]);

  // ── 컨버전 실행 ──
  const handleConvert = useCallback(async (selectedName?: string) => {
    const name = selectedName || companyName.trim();
    if (!name) return;

    setConverting(true);
    setError('');
    setSearchResults(null);
    setConversionData(null);
    setActiveTab('conversion');

    // 로딩 스텝 시뮬레이션
    let step = 0;
    const stepInterval = setInterval(() => {
      step = Math.min(step + 1, LOADING_STEPS.length - 1);
      setLoadingStep(step);
    }, 2500);

    try {
      const res = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: name,
          fiscal_year: fiscalYear,
          fs_div: 'OFS',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setConversionData(data);
    } catch (err: any) {
      setError(err.message || '컨버전 중 오류가 발생했습니다.');
    } finally {
      clearInterval(stepInterval);
      setConverting(false);
      setLoadingStep(0);
    }
  }, [companyName, fiscalYear]);

  // ── 엑셀 다운로드 ──
  const handleDownload = useCallback(async () => {
    if (!conversionData) return;
    setDownloading(true);

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: conversionData.company.corp_name,
          fiscal_year: conversionData.fiscal_year,
          fs_div: 'OFS',
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${conversionData.company.corp_name}_KIFRS전환_${conversionData.fiscal_year}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || '다운로드 중 오류가 발생했습니다.');
    } finally {
      setDownloading(false);
    }
  }, [conversionData]);

  // ── AI 전환근거 분석 ──
  const handleAiAnalysis = useCallback(async (mode: 'stream' | 'json' = 'stream') => {
    if (!conversionData) return;
    setAiLoading(true);
    setAiAnalysis('');
    setAiJsonResult(null);
    setActiveTab('ai_analysis');

    const requestBody = {
      mode,
      companyName: conversionData.company.corp_name,
      fiscalYear: conversionData.fiscal_year,
      industry: conversionData.company.industry_category || '기타',
      accounts: conversionData.conversion_items.map((item: any) => ({
        name: item.account_name,
        amount: item.book_value,
        category: item.category,
        kifrsStandard: `${item.kifrs_standard} ${item.kifrs_name}`,
        impact: item.impact,
      })),
    };

    try {
      if (mode === 'stream') {
        const res = await fetch('/api/ai-analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error);
        }

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            const lines = text.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') break;
                try {
                  const parsed = JSON.parse(data);
                  if (parsed.text) {
                    accumulated += parsed.text;
                    setAiAnalysis(accumulated);
                  }
                  if (parsed.error) throw new Error(parsed.error);
                } catch { /* skip parse errors */ }
              }
            }
          }
        }
      } else {
        const res = await fetch('/api/ai-analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setAiJsonResult(data.result);
      }
    } catch (err: any) {
      setError(err.message || 'AI 분석 중 오류가 발생했습니다.');
    } finally {
      setAiLoading(false);
    }
  }, [conversionData]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  return (
    <>
      {/* Header */}
      <header className="header">
        <div className="container header-inner">
          <div className="brand">
            <div className="brand-mark">KI</div>
            <div className="brand-text">
              <h1>K-<span>IFRS</span> 컨버전</h1>
              <p className="brand-sub">K-GAAP → K-IFRS 전환 자동화 엔진</p>
            </div>
          </div>
          <div className="header-badges">
            <span className="header-badge">DART 연동</span>
            <span className="header-badge accent">AI 전환근거</span>
          </div>
        </div>
      </header>

      <main className="container">
        {/* Hero */}
        <section className="search-section">
          <div className="hero">
            <span className="hero-eyebrow">DART 연동 · 자동 전환 분석</span>
            <h2 className="hero-title">감사보고서를 <span>K-IFRS</span>로<br />자동 전환합니다</h2>
            <p className="hero-desc">기업명만 입력하면 DART에서 재무데이터를 수집하고, 전환근거 매핑부터 변동내역·필요자료 체크리스트까지 한 번에 분석합니다.</p>
          </div>

          {/* Search */}
          <div className="search-card">
            <p className="search-title">분석할 기업명과 사업연도를 입력하세요.</p>
            <div className="search-form">
              <div className="form-group company-input">
                <label>기업명</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="예: 비제바노, 삼성전자"
                  disabled={converting}
                />
              </div>
              <div className="form-group">
                <label>사업연도</label>
                <select value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)} disabled={converting}>
                  {Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - 1 - i)).map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <button className="btn-primary" onClick={handleSearch} disabled={searching || converting || !companyName.trim()}>
                {searching ? '검색 중...' : '검색'}
              </button>
              <button className="btn-secondary" onClick={() => handleConvert()} disabled={converting || !companyName.trim()}>
                바로 전환
              </button>
            </div>

            {/* Search Results */}
            {searchResults && searchResults.length > 0 && (
              <div className="search-results">
                {searchResults.map((r) => (
                  <div key={r.corp_code} className="search-result-item" onClick={() => { setCompanyName(r.corp_name); handleConvert(r.corp_name); }}>
                    <div className="result-info">
                      <span className="result-name">{r.corp_name}</span>
                      <span className="result-meta">
                        {r.industry && `${r.industry}`}
                        {r.ceo_nm && ` · ${r.ceo_nm}`}
                        {r.stock_code && ` · ${r.stock_code}`}
                      </span>
                    </div>
                    <button className="result-select-btn" onClick={(e) => { e.stopPropagation(); setCompanyName(r.corp_name); handleConvert(r.corp_name); }}>
                      전환 분석
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Architecture (landing only) */}
        {!conversionData && !converting && <ArchitectureSection />}

        {/* Error */}
        {error && (
          <div className="error-box">
            <p>{error}</p>
          </div>
        )}

        {/* Loading */}
        {converting && (
          <div className="loading-overlay">
            <div className="spinner" />
            <p className="loading-text">K-IFRS 전환 분석을 수행하고 있습니다...</p>
            <div className="loading-steps">
              {LOADING_STEPS.map((step, i) => (
                <div key={i} className={`loading-step ${i < loadingStep ? 'done' : i === loadingStep ? 'active' : ''}`}>
                  {i < loadingStep ? '✓' : i === loadingStep ? '→' : '○'} {step}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        {conversionData && (
          <>
            {/* Warnings */}
            {conversionData.warnings.length > 0 && (
              <div className="warnings">
                {conversionData.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </div>
            )}

            {/* Summary Cards */}
            <section className="summary-section">
              <div className="summary-grid">
                <div className="summary-card">
                  <p className="summary-card-label">회사명</p>
                  <p className="summary-card-value" style={{ fontSize: 18 }}>{conversionData.company.corp_name}</p>
                  <p className="summary-card-sub">{conversionData.company.industry_category} · {conversionData.fiscal_year}기</p>
                </div>
                <div className="summary-card">
                  <p className="summary-card-label">적용 회계기준</p>
                  <p className="summary-card-value" style={{ fontSize: 18 }}>{conversionData.accounting_standard}</p>
                  <p className="summary-card-sub">정확도: {conversionData.accuracy_grade}</p>
                </div>
                <div className="summary-card">
                  <p className="summary-card-label">전환 대상 계정</p>
                  <p className="summary-card-value">{conversionData.summary.conversion_count}</p>
                  <p className="summary-card-sub">BS {conversionData.summary.bs_count} · IS {conversionData.summary.is_count}</p>
                </div>
                <div className="summary-card">
                  <p className="summary-card-label">HIGH 영향도</p>
                  <p className="summary-card-value" style={{ color: 'var(--high-text)' }}>{conversionData.summary.high_impact_count}</p>
                  <p className="summary-card-sub">MEDIUM {conversionData.summary.medium_impact_count}건</p>
                </div>
              </div>

              {/* Download Bar */}
              <div className="download-bar">
                <div className="download-info">
                  전환 분석 완료 <span>{conversionData.company.corp_name} · {conversionData.fiscal_year}기 · 6개 시트</span>
                </div>
                <button className="btn-primary" onClick={handleDownload} disabled={downloading}>
                  {downloading ? '생성 중...' : '엑셀 다운로드'}
                </button>
              </div>
            </section>

            {/* Tabs */}
            <section className="tabs-section">
              <div className="tabs-header">
                <button className={`tab-btn ${activeTab === 'conversion' ? 'active' : ''}`} onClick={() => setActiveTab('conversion')}>전환근거</button>
                <button className={`tab-btn ${activeTab === 'bs' ? 'active' : ''}`} onClick={() => setActiveTab('bs')}>재무상태표</button>
                <button className={`tab-btn ${activeTab === 'is' ? 'active' : ''}`} onClick={() => setActiveTab('is')}>손익계산서</button>
                <button className={`tab-btn ${activeTab === 'kifrs_bs' ? 'active' : ''}`} onClick={() => setActiveTab('kifrs_bs')}>전환후 재무상태표</button>
                <button className={`tab-btn ${activeTab === 'kifrs_is' ? 'active' : ''}`} onClick={() => setActiveTab('kifrs_is')}>전환후 포괄손익계산서</button>
                <button className={`tab-btn ${activeTab === 'delta' ? 'active' : ''}`} onClick={() => setActiveTab('delta')}>전환변동내역</button>
                <button className={`tab-btn ${activeTab === 'checklist' ? 'active' : ''}`} onClick={() => setActiveTab('checklist')}>필요내부자료</button>
                <button className={`tab-btn ${activeTab === 'upload' ? 'active' : ''}`} onClick={() => setActiveTab('upload')} style={activeTab === 'upload' ? {} : { background: 'var(--high-bg)', color: 'var(--high-text)' }}>내부자료 업로드</button>
                <button className={`tab-btn ${activeTab === 'ai_analysis' ? 'active' : ''}`} onClick={() => setActiveTab('ai_analysis')} style={activeTab === 'ai_analysis' ? {} : { background: '#f0f9ff', color: '#0369a1', fontWeight: 600, border: '1px solid #bae6fd' }}>AI 전환근거</button>
              </div>

              <div className="tab-content">
                {activeTab === 'conversion' && <ConversionTable items={conversionData.conversion_items} />}
                {activeTab === 'bs' && <FinancialTable accounts={conversionData.bs_accounts} year={conversionData.fiscal_year} showPrev3 />}
                {activeTab === 'is' && <FinancialTable accounts={conversionData.is_accounts} year={conversionData.fiscal_year} />}
                {activeTab === 'kifrs_bs' && <KifrsTable items={conversionData.kifrs_statements?.bs || []} year={conversionData.fiscal_year} title="K-IFRS 재무상태표" />}
                {activeTab === 'kifrs_is' && <KifrsTable items={conversionData.kifrs_statements?.is || []} year={conversionData.fiscal_year} title="K-IFRS 포괄손익계산서" />}
                {activeTab === 'delta' && <DeltaTable deltas={conversionData.conversion_deltas} />}
                {activeTab === 'checklist' && <ChecklistView checklist={conversionData.checklist} />}
                {activeTab === 'ai_analysis' && <AIAnalysisView
                  conversionData={conversionData}
                  aiAnalysis={aiAnalysis}
                  aiLoading={aiLoading}
                  aiJsonResult={aiJsonResult}
                  onRunStream={() => handleAiAnalysis('stream')}
                  onRunJson={() => handleAiAnalysis('json')}
                />}
                {activeTab === 'upload' && <UploadView
                  uploading={uploading}
                  internalResults={internalResults}
                  conversionData={conversionData}
                  onUpload={async (file, category) => {
                    setUploading(true);
                    try {
                      const fd = new FormData();
                      fd.append('file', file);
                      fd.append('category', category);
                      const res = await fetch('/api/apply-internal', { method: 'POST', body: fd });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error);
                      setInternalResults(prev => [...prev, ...data.results]);
                      // 전환후 재무제표에 반영
                      if (conversionData && data.results.length > 0) {
                        const updated = applyInternalAdjustments(conversionData, data.results);
                        setConversionData(updated);
                      }
                    } catch (err: any) {
                      setError(err.message || '업로드 중 오류가 발생했습니다.');
                    } finally {
                      setUploading(false);
                    }
                  }}
                  onClear={() => setInternalResults([])}
                />}
              </div>
            </section>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="site-footer">
        <div className="container footer-inner">
          <div>
            <div className="footer-brand">K-<span>IFRS</span> 컨버전 엔진</div>
            <div className="footer-meta">K-GAAP → K-IFRS End-to-End 자동 전환 파이프라인 · DART OpenAPI 연동</div>
          </div>
          <div className="footer-stack">
            <span className="footer-chip">Next.js 14</span>
            <span className="footer-chip">TypeScript</span>
            <span className="footer-chip">Python Engine</span>
            <span className="footer-chip">DART OpenAPI</span>
            <span className="footer-chip">Vercel</span>
          </div>
        </div>
      </footer>
    </>
  );
}

// ── 아키텍처 설명 섹션 ──

function ArchitectureSection() {
  const pipeline = [
    { label: '기업 검색', sub: 'DART corp_code 확보' },
    { label: '데이터 수집', sub: 'BS·IS·CF + 감사보고서' },
    { label: '비정형 파싱', sub: '202개 정규식 인식' },
    { label: 'K-IFRS 매핑', sub: '40+ 계정 × 17 기준서' },
    { label: '변동내역 산출', sub: '조정액·체크리스트' },
    { label: '결과 · 엑셀', sub: '대시보드 / 다운로드' },
  ];

  const layers = [
    {
      icon: '🌐', navy: true, name: 'Web Application', tag: 'Next.js 14 · React 18 · TS',
      items: ['기업검색 · 전환실행 · 결과 대시보드', '6개 서버리스 API 라우트', 'ExcelJS 기반 전환조서 출력'],
    },
    {
      icon: '⚙️', navy: false, name: 'Core Engine', tag: 'Python 3.9+ · TypeScript 5.4',
      items: ['DART API Client — 재무제표·공시 수집', 'K-IFRS Mapping Engine — 업종별 가중치', '비정형 Excel Parser — 18종 시트 판별'],
    },
    {
      icon: '🔗', navy: false, name: 'External Services', tag: 'opendart.fss.or.kr',
      items: ['DART OpenAPI — 금융감독원 전자공시', 'OpenAI API — 전환근거 생성 (optional)', 'Vercel — 서버리스 배포'],
    },
  ];

  const metrics = [
    { num: '6,645', label: '총 소스코드 (lines)' },
    { num: '202', label: '정규식 인식 패턴' },
    { num: '18종', label: '시트 유형 자동인식' },
    { num: '40+', label: 'K-IFRS 매핑 규칙' },
    { num: '17', label: '적용 K-IFRS 기준서' },
    { num: '8', label: '내부자료 체크 영역' },
  ];

  return (
    <section className="arch-section">
      <div className="arch-head">
        <span className="arch-eyebrow">System Architecture</span>
        <h2 className="arch-title">기업명 하나로, 전환의 전 과정을 자동화</h2>
        <p className="arch-desc">
          비정형 감사보고서 파싱부터 DART 연동, K-IFRS 전환근거 매핑, 변동내역 산출까지 —
          수십 단계의 회계 판단을 하나의 파이프라인으로 연결한 End-to-End 컨버전 엔진입니다.
        </p>
      </div>

      {/* Pipeline */}
      <div className="arch-pipeline">
        {pipeline.map((p, i) => (
          <div key={i} className="pipe-step">
            <div className="pipe-num">{i + 1}</div>
            <div className="pipe-label">{p.label}</div>
            <div className="pipe-sub">{p.sub}</div>
          </div>
        ))}
      </div>

      {/* Layers */}
      <div className="arch-layers">
        {layers.map((l, i) => (
          <div key={i} className="layer-card">
            <div className="layer-top">
              <div className={`layer-icon ${l.navy ? 'navy' : ''}`}>{l.icon}</div>
              <div>
                <div className="layer-name">{l.name}</div>
                <div className="layer-tag">{l.tag}</div>
              </div>
            </div>
            <ul className="layer-list">
              {l.items.map((it, j) => <li key={j}>{it}</li>)}
            </ul>
          </div>
        ))}
      </div>

      {/* Metrics */}
      <div className="metrics-strip">
        {metrics.map((m, i) => (
          <div key={i} className="metric">
            <div className="metric-num">{m.num}</div>
            <div className="metric-label">{m.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── 하위 컴포넌트 ──

function ConversionTable({ items }: { items: any[] }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th className="text-center">No.</th>
          <th>구분</th>
          <th>K-GAAP 계정과목</th>
          <th className="text-right">장부금액</th>
          <th>적용 K-IFRS</th>
          <th>전환 시 변동사항</th>
          <th className="text-center">영향도</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, i) => (
          <tr key={i}>
            <td className="text-center">{item.no}</td>
            <td className="text-nowrap">{item.category}</td>
            <td>{item.account_name}</td>
            <td className="text-right text-nowrap">{fmt(item.book_value)}</td>
            <td className="text-small">{item.kifrs_standard} {item.kifrs_name}</td>
            <td className="text-small">{item.change_description}</td>
            <td className="text-center">
              <span className={`impact-badge impact-${item.impact}`}>{item.impact}</span>
            </td>
          </tr>
        ))}
        {items.length === 0 && (
          <tr><td colSpan={7} className="text-center" style={{ padding: 40, color: 'var(--text-sub)' }}>전환 대상 항목이 없습니다.</td></tr>
        )}
      </tbody>
    </table>
  );
}

function FinancialTable({ accounts, year, showPrev3 }: { accounts: any[]; year: string; showPrev3?: boolean }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>계정과목</th>
          <th className="text-right">당기금액 ({year})</th>
          <th className="text-right">전기금액</th>
          {showPrev3 && <th className="text-right">전전기금액</th>}
        </tr>
      </thead>
      <tbody>
        {accounts.map((acc, i) => (
          <tr key={i}>
            <td>{acc.account_nm}</td>
            <td className="text-right text-nowrap">{fmt(acc.thstrm_amount)}</td>
            <td className="text-right text-nowrap">{fmt(acc.frmtrm_amount)}</td>
            {showPrev3 && <td className="text-right text-nowrap">{fmt(acc.bfefrmtrm_amount)}</td>}
          </tr>
        ))}
        {accounts.length === 0 && (
          <tr><td colSpan={showPrev3 ? 4 : 3} className="text-center" style={{ padding: 40, color: 'var(--text-sub)' }}>재무제표 데이터가 없습니다.</td></tr>
        )}
      </tbody>
    </table>
  );
}

function DeltaTable({ deltas }: { deltas: any[] }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>계정과목</th>
          <th className="text-right">K-GAAP 금액</th>
          <th className="text-right">전환조정</th>
          <th className="text-right">K-IFRS 추정</th>
          <th className="text-center">변동</th>
          <th>적용 K-IFRS</th>
          <th>근거</th>
        </tr>
      </thead>
      <tbody>
        {deltas.map((d, i) => (
          <tr key={i}>
            <td>{d.account_name}</td>
            <td className="text-right text-nowrap">{fmt(d.kgaap_amount)}</td>
            <td className="text-right text-nowrap">{d.adjustment != null ? fmt(d.adjustment) : '산출 필요'}</td>
            <td className="text-right text-nowrap">{d.kifrs_estimated != null ? fmt(d.kifrs_estimated) : '실측 필요'}</td>
            <td className="text-center">
              <span className={`impact-badge ${d.changed ? 'impact-HIGH' : 'impact-LOW'}`}>
                {d.changed ? '변동' : '무변동'}
              </span>
            </td>
            <td className="text-small">{d.kifrs_standard}</td>
            <td className="text-small">{d.change_basis}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function KifrsTable({ items, year, title }: { items: KifrsLineItem[]; year: string; title: string }) {
  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 14, color: 'var(--text-sub)' }}>
          전환 후 추정 재무제표 · 실측치는 내부자료 반영 후 확정
        </span>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, background: 'var(--high-bg)', color: 'var(--high-text)' }}>
          조정필요 {items.filter(i => i.adjustment_needed).length}건
        </span>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>K-IFRS 계정과목</th>
            <th style={{ color: 'var(--text-sub)', fontSize: 12 }}>K-GAAP 원계정</th>
            <th className="text-right">전환 전 (K-GAAP)</th>
            <th className="text-right">전환 후 (K-IFRS 추정)</th>
            <th className="text-right">차이</th>
            <th>조정 내용</th>
            <th className="text-center">영향도</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i} style={{
              fontWeight: item.is_total ? 700 : 400,
              background: item.is_total ? 'var(--bg-highlight, rgba(0,0,0,0.02))' : undefined,
              borderTop: item.is_total ? '2px solid var(--border)' : undefined,
            }}>
              <td style={{ paddingLeft: 16 + item.indent * 20 }}>
                {item.kifrs_name}
              </td>
              <td style={{ color: 'var(--text-sub)', fontSize: 12 }}>
                {item.kgaap_name !== item.kifrs_name ? item.kgaap_name : ''}
              </td>
              <td className="text-right text-nowrap">{fmt(item.amount)}</td>
              <td className="text-right text-nowrap" style={item.adjustment_needed ? { color: 'var(--high-text)' } : undefined}>
                {fmt(item.kifrs_amount)}
              </td>
              <td className="text-right text-nowrap" style={{
                color: item.diff == null ? 'var(--text-sub)' : item.diff > 0 ? '#2563eb' : item.diff < 0 ? '#dc2626' : 'var(--text-sub)',
                fontSize: 13,
              }}>
                {item.diff == null ? '산출필요' : item.diff === 0 ? '-' : (item.diff > 0 ? '+' : '') + fmt(item.diff)}
              </td>
              <td className="text-center">
                {item.adjustment_needed ? (
                  <span style={{ color: 'var(--high-text)', fontWeight: 600 }}>●</span>
                ) : (
                  <span style={{ color: 'var(--text-sub)' }}>-</span>
                )}
              </td>
              <td className="text-small">{item.adjustment_note || '-'}</td>
              <td className="text-center">
                {item.impact && !item.is_total && (
                  <span className={`impact-badge impact-${item.impact}`}>{item.impact}</span>
                )}
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr><td colSpan={8} className="text-center" style={{ padding: 40, color: 'var(--text-sub)' }}>전환 후 재무제표 데이터가 없습니다.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ChecklistView({ checklist }: { checklist: any[] }) {
  return (
    <div>
      {checklist.map((cat, i) => (
        <div key={i} className="checklist-group">
          <div className="checklist-title">
            {cat.category}
            <span className={`checklist-priority ${cat.priority === '상' ? 'priority-high' : cat.priority === '필수' ? 'priority-required' : 'priority-mid'}`}>
              {cat.priority}
            </span>
          </div>
          <ul className="checklist-items">
            {cat.items.map((item: string, j: number) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ── 내부자료 카테고리 정의 ──

// ── 전환 효과 총합계 ──

const ASSET_KEYWORDS = /자산|채권|재고|토지|건물|기계|비품|보증금|사용권|투자|현금|예금|선급|미수|대여금|개발비|소프트웨어|영업권/;
const LIABILITY_KEYWORDS = /부채|차입금|사채|미지급|선수|예수|충당|퇴직|리스부채|매입채무/;
const EQUITY_KEYWORDS = /자본금|잉여금|자기주식|포괄손익|이익잉여/;
const IS_KEYWORDS = /매출|수익|원가|판매비|급여|감가상각|이자|법인세|순이익|영업이익|비용/;

function classifyAccount(name: string): 'asset' | 'liability' | 'equity' | 'income' | 'unknown' {
  if (ASSET_KEYWORDS.test(name)) return 'asset';
  if (LIABILITY_KEYWORDS.test(name)) return 'liability';
  if (EQUITY_KEYWORDS.test(name)) return 'equity';
  if (IS_KEYWORDS.test(name)) return 'income';
  return 'unknown';
}

function ImpactSummary({ results }: { results: any[] }) {
  const allItems = results.flatMap((r: any) => r.items || []);
  if (allItems.length === 0) return null;

  let assetDiff = 0, liabDiff = 0, equityDiff = 0, isDiff = 0;
  const assetItems: string[] = [], liabItems: string[] = [], equityItems: string[] = [], isItems: string[] = [];

  for (const item of allItems) {
    if (item.diff === 0) continue;
    const cls = classifyAccount(item.account_name);
    if (cls === 'asset') { assetDiff += item.diff; assetItems.push(item.account_name); }
    else if (cls === 'liability') { liabDiff += item.diff; liabItems.push(item.account_name); }
    else if (cls === 'equity') { equityDiff += item.diff; equityItems.push(item.account_name); }
    else if (cls === 'income') { isDiff += item.diff; isItems.push(item.account_name); }
    else { assetDiff += item.diff; assetItems.push(item.account_name); } // 기본 자산
  }

  const retainedEarningsImpact = assetDiff - liabDiff; // 자산↑ - 부채↑ = 이익잉여금 영향

  const fmtDiff = (v: number) => v === 0 ? '-' : (v > 0 ? '+' : '') + fmt(v);
  const diffColor = (v: number) => v > 0 ? '#2563eb' : v < 0 ? '#dc2626' : 'var(--text-sub)';

  return (
    <div style={{ marginTop: 20, padding: 20, border: '2px solid var(--accent, #2563eb)', borderRadius: 10, background: 'rgba(37,99,235,0.03)' }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 16px', color: 'var(--accent, #2563eb)' }}>전환 효과 총합계</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div style={{ padding: 14, background: 'var(--bg-card, #fff)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 4 }}>자산 변동</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: diffColor(assetDiff) }}>{fmtDiff(assetDiff)}</div>
          {assetItems.length > 0 && <div style={{ fontSize: 11, color: 'var(--text-sub)', marginTop: 4 }}>{assetItems.join(', ')}</div>}
        </div>
        <div style={{ padding: 14, background: 'var(--bg-card, #fff)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 4 }}>부채 변동</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: diffColor(liabDiff) }}>{fmtDiff(liabDiff)}</div>
          {liabItems.length > 0 && <div style={{ fontSize: 11, color: 'var(--text-sub)', marginTop: 4 }}>{liabItems.join(', ')}</div>}
        </div>
        <div style={{ padding: 14, background: 'var(--bg-card, #fff)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 4 }}>순자산(자본) 영향</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: diffColor(retainedEarningsImpact) }}>{fmtDiff(retainedEarningsImpact)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-sub)', marginTop: 4 }}>자산변동 - 부채변동 → 이익잉여금</div>
        </div>
        {isDiff !== 0 && (
          <div style={{ padding: 14, background: 'var(--bg-card, #fff)', borderRadius: 8, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 4 }}>손익 변동</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: diffColor(isDiff) }}>{fmtDiff(isDiff)}</div>
            {isItems.length > 0 && <div style={{ fontSize: 11, color: 'var(--text-sub)', marginTop: 4 }}>{isItems.join(', ')}</div>}
          </div>
        )}
      </div>
      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-sub)', lineHeight: 1.5 }}>
        ※ 자산 증가 {fmt(Math.abs(assetDiff))}원, 부채 증가 {fmt(Math.abs(liabDiff))}원 → 이익잉여금(전환일 조정) {fmtDiff(retainedEarningsImpact)}원 반영 예상
      </div>
    </div>
  );
}

const UPLOAD_CATEGORIES = [
  { key: 'lease', label: '리스계약 (IFRS 16)', icon: '🏢', desc: '임차계약서 / 리스 스케줄', columns: '계약명, 시작일, 종료일, 월리스료, 할인율' },
  { key: 'retirement', label: '퇴직급여 (IAS 19)', icon: '👤', desc: '보험수리적 평가보고서', columns: '확정급여채무(DBO), 사외적립자산 공정가치' },
  { key: 'ecl', label: '매출채권 ECL (IFRS 9)', icon: '📊', desc: '매출채권 연령분석표', columns: '연령구간, 잔액, 손실률(또는 충당금액)' },
  { key: 'inventory', label: '재고자산 NRV (IAS 2)', icon: '📦', desc: '재고자산 실사/NRV 평가', columns: '품목, 장부금액, 순실현가능가액' },
  { key: 'ppe', label: '유형자산 재평가 (IAS 16)', icon: '🏗️', desc: '감정평가서 / 재평가 내역', columns: '자산명, 장부금액, 공정가치(감정가)' },
  { key: 'financial', label: '금융상품 분류 (IFRS 9)', icon: '💰', desc: '금융상품 분류 및 공정가치', columns: '상품명, K-GAAP 장부금액, IFRS 분류, 공정가치' },
];

function UploadView({ uploading, internalResults, conversionData, onUpload, onClear }: {
  uploading: boolean;
  internalResults: any[];
  conversionData: ConversionData;
  onUpload: (file: File, category: string) => void;
  onClear: () => void;
}) {
  return (
    <div>
      <div style={{ marginBottom: 16, padding: '12px 16px', background: 'var(--bg-card, #f8f9fa)', borderRadius: 8, fontSize: 14, color: 'var(--text-sub)' }}>
        내부자료를 업로드하면 추정치 대신 <strong>실제 데이터 기반</strong>으로 전환후 재무제표가 갱신됩니다.
        엑셀(.xlsx) 또는 CSV 파일을 지원합니다.
      </div>

      {/* 카테고리별 업로드 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12, marginBottom: 24 }}>
        {UPLOAD_CATEGORIES.map(cat => {
          const uploaded = internalResults.find((r: any) => r.category === cat.key);
          return (
            <div key={cat.key} style={{
              border: `1px solid ${uploaded ? 'var(--accent, #2563eb)' : 'var(--border, #e5e7eb)'}`,
              borderRadius: 8, padding: 16,
              background: uploaded ? 'rgba(37,99,235,0.04)' : 'var(--bg-card, #fff)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 20 }}>{cat.icon}</span>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{cat.label}</span>
                {uploaded && <span style={{ fontSize: 11, padding: '2px 6px', background: 'var(--accent, #2563eb)', color: '#fff', borderRadius: 4 }}>반영됨</span>}
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-sub)', margin: '4px 0' }}>{cat.desc}</p>
              <p style={{ fontSize: 11, color: 'var(--text-sub)', margin: '4px 0 12px' }}>필요 컬럼: {cat.columns}</p>

              {uploaded ? (
                <div style={{ fontSize: 13, color: 'var(--accent, #2563eb)' }}>
                  {uploaded.summary}
                </div>
              ) : (
                <label style={{
                  display: 'inline-block', padding: '6px 14px', fontSize: 13,
                  background: 'var(--accent, #2563eb)', color: '#fff', borderRadius: 6,
                  cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.5 : 1,
                }}>
                  {uploading ? '처리 중...' : '파일 선택'}
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    style={{ display: 'none' }}
                    disabled={uploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) onUpload(file, cat.key);
                      e.target.value = '';
                    }}
                  />
                </label>
              )}
            </div>
          );
        })}
      </div>

      {/* 업로드 결과 요약 */}
      {internalResults.length > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>업로드 반영 결과</h3>
            <button onClick={onClear} style={{
              fontSize: 12, padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 4,
              background: 'transparent', cursor: 'pointer', color: 'var(--text-sub)',
            }}>초기화</button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>구분</th>
                <th>계정과목</th>
                <th className="text-right">K-GAAP 금액</th>
                <th className="text-right">K-IFRS 금액</th>
                <th className="text-right">차이</th>
                <th>근거</th>
              </tr>
            </thead>
            <tbody>
              {internalResults.flatMap((result: any, ri: number) =>
                result.items.map((item: any, ii: number) => (
                  <tr key={`${ri}-${ii}`}>
                    {ii === 0 && <td rowSpan={result.items.length} style={{ fontWeight: 600, fontSize: 13, verticalAlign: 'top' }}>{result.label}</td>}
                    <td>{item.account_name}</td>
                    <td className="text-right text-nowrap">{fmt(item.kgaap_amount)}</td>
                    <td className="text-right text-nowrap">{fmt(item.kifrs_amount)}</td>
                    <td className="text-right text-nowrap" style={{
                      color: item.diff > 0 ? '#2563eb' : item.diff < 0 ? '#dc2626' : 'var(--text-sub)',
                    }}>
                      {item.diff === 0 ? '-' : (item.diff > 0 ? '+' : '') + fmt(item.diff)}
                    </td>
                    <td className="text-small">{item.note}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* 전환 효과 총합계 */}
          <ImpactSummary results={internalResults} />
        </div>
      )}
    </div>
  );
}

// ── 내부자료 조정 반영 ──

function applyInternalAdjustments(data: ConversionData, results: any[]): ConversionData {
  const updated = { ...data, kifrs_statements: { ...data.kifrs_statements, bs: [...data.kifrs_statements.bs], is: [...data.kifrs_statements.is] } };

  for (const result of results) {
    for (const adj of result.items) {
      // BS에서 매칭되는 계정 찾아 업데이트
      for (let i = 0; i < updated.kifrs_statements.bs.length; i++) {
        const item = updated.kifrs_statements.bs[i];
        if (matchAccount(item.kifrs_name, adj.account_name) || matchAccount(item.kgaap_name, adj.account_name)) {
          updated.kifrs_statements.bs[i] = {
            ...item,
            kifrs_amount: adj.kifrs_amount,
            diff: adj.kifrs_amount - (item.amount || 0),
            adjustment_note: `[실측] ${adj.note}`,
            adjustment_needed: false, // 실측 반영 완료
          };
          break;
        }
      }
      // IS에서도 매칭
      for (let i = 0; i < updated.kifrs_statements.is.length; i++) {
        const item = updated.kifrs_statements.is[i];
        if (matchAccount(item.kifrs_name, adj.account_name) || matchAccount(item.kgaap_name, adj.account_name)) {
          updated.kifrs_statements.is[i] = {
            ...item,
            kifrs_amount: adj.kifrs_amount,
            diff: adj.kifrs_amount - (item.amount || 0),
            adjustment_note: `[실측] ${adj.note}`,
            adjustment_needed: false,
          };
          break;
        }
      }
    }
  }

  return updated;
}

function matchAccount(name: string, target: string): boolean {
  if (!name || !target) return false;
  const a = name.replace(/\s|\(.*?\)/g, '');
  const b = target.replace(/\s|\(.*?\)/g, '');
  return a.includes(b) || b.includes(a);
}

// ── AI 전환근거 분석 컴포넌트 ──

function AIAnalysisView({ conversionData, aiAnalysis, aiLoading, aiJsonResult, onRunStream, onRunJson }: {
  conversionData: ConversionData;
  aiAnalysis: string;
  aiLoading: boolean;
  aiJsonResult: any;
  onRunStream: () => void;
  onRunJson: () => void;
}) {
  const highImpactCount = conversionData.conversion_items.filter((i: any) => i.impact === 'HIGH').length;
  const mediumImpactCount = conversionData.conversion_items.filter((i: any) => i.impact === 'MEDIUM').length;

  return (
    <div>
      {/* AI 분석 헤더 */}
      <div style={{
        padding: '20px 24px', marginBottom: 20,
        background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)',
        borderRadius: 12, color: '#fff',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 24 }}>&#x1F916;</span>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>AI 전환근거 생성 엔진</h3>
          <span style={{ fontSize: 11, padding: '2px 8px', background: 'rgba(255,255,255,0.15)', borderRadius: 10 }}>GPT-4o Powered</span>
        </div>
        <p style={{ margin: '4px 0 16px', fontSize: 13, opacity: 0.8, lineHeight: 1.5 }}>
          OpenAI GPT-4o API와 K-IFRS 기준서 컨텍스트(Pseudo-RAG)를 활용하여,
          {conversionData.company.corp_name}의 {highImpactCount + mediumImpactCount}개 조정 대상 계정에 대한
          전환근거를 자동 생성합니다. 각 계정별로 IFRS 기준서 문단을 인용하고, 조정 방향·추정 영향·필요 조치를 제시합니다.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onRunStream}
            disabled={aiLoading}
            style={{
              padding: '10px 20px', fontSize: 14, fontWeight: 600,
              background: aiLoading ? '#475569' : '#3b82f6', color: '#fff',
              border: 'none', borderRadius: 8, cursor: aiLoading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {aiLoading ? (
              <><span className="ai-spinner" />분석 중...</>
            ) : (
              <>&#9889; AI 전환근거 생성 (스트리밍)</>
            )}
          </button>
          <button
            onClick={onRunJson}
            disabled={aiLoading}
            style={{
              padding: '10px 20px', fontSize: 14, fontWeight: 600,
              background: 'transparent', color: '#93c5fd',
              border: '1px solid #3b82f6', borderRadius: 8,
              cursor: aiLoading ? 'not-allowed' : 'pointer',
            }}
          >
            &#128202; 구조화 분석 (JSON)
          </button>
        </div>
      </div>

      {/* 기술 스택 설명 */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 10, marginBottom: 20,
      }}>
        {[
          { label: 'LLM API', value: 'OpenAI GPT-4o', desc: 'Gen AI API 활용' },
          { label: '기준서 컨텍스트', value: 'Pseudo-RAG', desc: 'IFRS 9/15/16/IAS 19 등 10개 기준서 내장' },
          { label: '분석 대상', value: `${highImpactCount + mediumImpactCount}개 계정`, desc: `HIGH ${highImpactCount} + MEDIUM ${mediumImpactCount}` },
          { label: '출력 형식', value: '스트리밍/JSON', desc: 'SSE 실시간 + 구조화 데이터' },
        ].map((tech, i) => (
          <div key={i} style={{
            padding: 12, border: '1px solid var(--border)', borderRadius: 8,
            background: 'var(--bg-card, #fff)',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 2 }}>{tech.label}</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{tech.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text-sub)', marginTop: 2 }}>{tech.desc}</div>
          </div>
        ))}
      </div>

      {/* 스트리밍 분석 결과 */}
      {aiAnalysis && (
        <div style={{
          padding: '20px 24px', background: 'var(--bg-card, #fff)',
          border: '1px solid var(--border)', borderRadius: 10,
          marginBottom: 20,
        }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600 }}>
            &#x1F4DD; AI 생성 전환근거
            {aiLoading && <span style={{ fontSize: 12, color: 'var(--text-sub)', fontWeight: 400, marginLeft: 8 }}>생성 중...</span>}
          </h4>
          <div
            style={{
              fontSize: 14, lineHeight: 1.8, color: 'var(--text-main)',
              whiteSpace: 'pre-wrap', fontFamily: 'inherit',
            }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(aiAnalysis) }}
          />
        </div>
      )}

      {/* JSON 구조화 분석 결과 */}
      {aiJsonResult && (
        <div>
          {/* 전체 요약 */}
          <div style={{
            padding: '16px 20px', background: '#f0f9ff', border: '1px solid #bae6fd',
            borderRadius: 10, marginBottom: 16,
          }}>
            <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: '#0369a1' }}>전체 전환 영향 요약</h4>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{aiJsonResult.companyOverview}</p>
          </div>

          {/* 계정별 전환근거 */}
          {aiJsonResult.rationales?.map((r: any, i: number) => (
            <div key={i} style={{
              padding: '16px 20px', border: '1px solid var(--border)',
              borderRadius: 10, marginBottom: 10,
              borderLeft: `4px solid ${r.riskLevel === '상' ? '#ef4444' : r.riskLevel === '중' ? '#f59e0b' : '#22c55e'}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h5 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
                  {r.accountName}
                  <span style={{ fontSize: 12, color: 'var(--text-sub)', fontWeight: 400, marginLeft: 8 }}>{r.kifrsStandard}</span>
                </h5>
                <div style={{ display: 'flex', gap: 6 }}>
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 4,
                    background: r.adjustmentDirection === '증가' ? '#dbeafe' : r.adjustmentDirection === '감소' ? '#fee2e2' : '#f3f4f6',
                    color: r.adjustmentDirection === '증가' ? '#1d4ed8' : r.adjustmentDirection === '감소' ? '#dc2626' : '#6b7280',
                  }}>
                    {r.adjustmentDirection}
                  </span>
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 4,
                    background: r.riskLevel === '상' ? '#fee2e2' : r.riskLevel === '중' ? '#fef3c7' : '#dcfce7',
                    color: r.riskLevel === '상' ? '#dc2626' : r.riskLevel === '중' ? '#d97706' : '#16a34a',
                  }}>
                    위험도: {r.riskLevel}
                  </span>
                </div>
              </div>

              <div style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 8 }}>
                <div><strong>전환근거:</strong> {r.rationale}</div>
                <div style={{ color: '#0369a1', marginTop: 4 }}><strong>기준서 인용:</strong> {r.standardReference}</div>
                <div style={{ marginTop: 4 }}><strong>추정 영향:</strong> {r.estimatedImpact}</div>
              </div>

              {r.requiredActions?.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-sub)', marginTop: 6 }}>
                  <strong>필요 조치:</strong> {r.requiredActions.join(' / ')}
                </div>
              )}
            </div>
          ))}

          {/* 주요 리스크 & 권고사항 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
            {aiJsonResult.keyRisks?.length > 0 && (
              <div style={{ padding: 16, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10 }}>
                <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: '#dc2626' }}>주요 리스크</h4>
                {aiJsonResult.keyRisks.map((r: string, i: number) => (
                  <p key={i} style={{ margin: '4px 0', fontSize: 13, lineHeight: 1.5 }}>&#x26A0;&#xFE0F; {r}</p>
                ))}
              </div>
            )}
            {aiJsonResult.recommendations?.length > 0 && (
              <div style={{ padding: 16, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10 }}>
                <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: '#16a34a' }}>권고사항</h4>
                {aiJsonResult.recommendations.map((r: string, i: number) => (
                  <p key={i} style={{ margin: '4px 0', fontSize: 13, lineHeight: 1.5 }}>&#x2705; {r}</p>
                ))}
              </div>
            )}
          </div>

          {/* 총 영향 요약 */}
          {aiJsonResult.totalImpactSummary && (
            <div style={{
              marginTop: 16, padding: '14px 20px',
              background: 'linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%)',
              borderRadius: 10, color: '#fff', fontSize: 14, lineHeight: 1.6,
            }}>
              <strong>&#x1F4CA; 전체 영향 요약:</strong> {aiJsonResult.totalImpactSummary}
            </div>
          )}
        </div>
      )}

      {/* 초기 상태 (분석 실행 전) */}
      {!aiAnalysis && !aiJsonResult && !aiLoading && (
        <div style={{
          padding: 40, textAlign: 'center', color: 'var(--text-sub)',
          border: '2px dashed var(--border)', borderRadius: 12,
        }}>
          <p style={{ fontSize: 40, margin: '0 0 12px' }}>&#x1F916;</p>
          <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>AI 전환근거를 생성하려면 위 버튼을 클릭하세요</p>
          <p style={{ fontSize: 13, margin: 0 }}>
            GPT-4o가 K-IFRS 기준서를 참고하여 {conversionData.company.corp_name}의
            {highImpactCount + mediumImpactCount}개 조정 대상 계정에 대한 전환근거를 자동 작성합니다.
          </p>
          <p style={{ fontSize: 12, marginTop: 12, color: '#9ca3af' }}>
            ※ OpenAI API 키가 필요합니다 (.env.local에 OPENAI_API_KEY 설정)
          </p>
        </div>
      )}
    </div>
  );
}

// ── 간이 마크다운 렌더러 ──
function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^## (.+)$/gm, '<h3 style="margin:20px 0 8px;font-size:16px;font-weight:700;color:#0f172a;border-bottom:1px solid #e2e8f0;padding-bottom:6px">$1</h3>')
    .replace(/^### (.+)$/gm, '<h4 style="margin:14px 0 6px;font-size:14px;font-weight:600;color:#1e40af">$1</h4>')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#0f172a">$1</strong>')
    .replace(/^- (.+)$/gm, '<div style="padding-left:16px;margin:3px 0">&#x2022; $1</div>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
}
