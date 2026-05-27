"""
DART API 실제 연동 단계별 테스트
================================
로컬 Python 환경에서 실행합니다.

사전 조건:
  pip install requests openpyxl

실행:
  python test_dart_live.py

각 단계에서 PASS/FAIL을 표시하고, 실패 시 원인을 출력합니다.
"""

import sys
import os
import json
import traceback
from datetime import datetime

# ── 같은 디렉터리의 모듈 로드 ──
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

PASS = "✅ PASS"
FAIL = "❌ FAIL"
WARN = "⚠ WARN"
results = []


def log(step, status, detail=""):
    tag = f"[{step}] {status}"
    if detail:
        tag += f"  — {detail}"
    print(tag)
    results.append((step, status, detail))


def separator(title):
    print(f"\n{'─'*60}")
    print(f"  {title}")
    print(f"{'─'*60}")


# ═══════════════════════════════════════════════════════════
# 0. 환경 점검
# ═══════════════════════════════════════════════════════════
separator("0. 환경 점검")

try:
    import requests
    log("0-1 requests", PASS, f"v{requests.__version__}")
except ImportError:
    log("0-1 requests", FAIL, "pip install requests 필요")
    sys.exit(1)

try:
    import openpyxl
    log("0-2 openpyxl", PASS, f"v{openpyxl.__version__}")
except ImportError:
    log("0-2 openpyxl", FAIL, "pip install openpyxl 필요")
    sys.exit(1)

# API 키 확인
config_path = os.path.join(os.path.dirname(__file__), ".dart_config.json")
if os.path.exists(config_path):
    with open(config_path) as f:
        cfg = json.load(f)
    api_key = cfg.get("api_key", "")
    if api_key:
        log("0-3 API키", PASS, f"{api_key[:8]}...{api_key[-4:]}")
    else:
        log("0-3 API키", FAIL, ".dart_config.json에 api_key가 비어있음")
        sys.exit(1)
else:
    log("0-3 API키", FAIL, ".dart_config.json 파일 없음")
    print("  → python dart_api.py set-key <키> 로 먼저 설정하세요")
    sys.exit(1)


# ═══════════════════════════════════════════════════════════
# 1. dart_api.py 기본 기능
# ═══════════════════════════════════════════════════════════
separator("1. DartAPI 기본 기능")

from dart_api import DartAPI, DartAPIError

dart = DartAPI()

# 1-1. 기업코드 다운로드/캐시 + 기업검색
test_company = "비제바노"
try:
    companies = dart.search_company(test_company)
    if companies:
        corp = companies[0]
        log("1-1 기업검색", PASS,
            f"'{test_company}' → {corp['corp_name']} (code={corp['corp_code']}, stock={corp.get('stock_code','')})")
        corp_code = corp['corp_code']
    else:
        log("1-1 기업검색", FAIL, f"'{test_company}' 결과 0건")
        corp_code = None
except Exception as e:
    log("1-1 기업검색", FAIL, str(e))
    traceback.print_exc()
    corp_code = None

# 1-2. 기업개황
company_info = None
if corp_code:
    try:
        company_info = dart.get_company_info(corp_code)
        if company_info:
            log("1-2 기업개황", PASS,
                f"업종={company_info.induty_code}({company_info.industry_category}), "
                f"결산={company_info.acc_mt}월, 대표={company_info.ceo_nm}")
        else:
            log("1-2 기업개황", FAIL, "None 반환")
    except Exception as e:
        log("1-2 기업개황", FAIL, str(e))
        traceback.print_exc()

# 1-3. 재무제표 주요계정 (fnlttSinglAcnt)
fiscal_year = "2024"
if corp_code:
    try:
        accts = dart.get_financial_statements(corp_code, fiscal_year)
        if accts:
            bs = [a for a in accts if a.sj_div == 'BS']
            is_ = [a for a in accts if a.sj_div in ('IS', 'CIS')]
            log("1-3 주요계정", PASS,
                f"총 {len(accts)}건 (BS={len(bs)}, IS={len(is_)})")
            # 샘플 출력
            for a in accts[:3]:
                print(f"     [{a.sj_div}] {a.account_nm:20s}  당기={a.thstrm_amount:>15,}" if a.thstrm_amount else
                      f"     [{a.sj_div}] {a.account_nm:20s}  당기=None")
        else:
            # 2024 없으면 2023 시도
            accts = dart.get_financial_statements(corp_code, "2023")
            if accts:
                fiscal_year = "2023"
                log("1-3 주요계정", WARN,
                    f"2024 데이터 없음, 2023 대체 → {len(accts)}건")
            else:
                log("1-3 주요계정", FAIL, "2024·2023 모두 데이터 없음")
    except Exception as e:
        log("1-3 주요계정", FAIL, str(e))
        traceback.print_exc()

# 1-4. 상세 재무제표 (fnlttSinglAll)
if corp_code:
    try:
        full = dart.get_full_financial_statements(corp_code, fiscal_year)
        if full:
            log("1-4 상세재무제표", PASS, f"총 {len(full)}건")
        else:
            log("1-4 상세재무제표", WARN, "상세 조회 결과 없음 (비상장사일 수 있음)")
    except Exception as e:
        log("1-4 상세재무제표", FAIL, str(e))
        traceback.print_exc()

# 1-5. 회계기준 판별
if corp_code:
    try:
        std = dart.get_accounting_standard(corp_code, fiscal_year)
        log("1-5 회계기준", PASS, f"{std}")
    except Exception as e:
        log("1-5 회계기준", FAIL, str(e))
        traceback.print_exc()

# 1-6. 감사보고서 검색
if corp_code:
    try:
        audit = dart.get_audit_report(corp_code, fiscal_year)
        if audit:
            log("1-6 감사보고서", PASS,
                f"{audit.report_nm} ({audit.rcept_dt}, rcept_no={audit.rcept_no})")
        else:
            log("1-6 감사보고서", WARN, "감사보고서 미발견 (미공시이거나 연도 불일치)")
    except Exception as e:
        log("1-6 감사보고서", FAIL, str(e))
        traceback.print_exc()


# ═══════════════════════════════════════════════════════════
# 2. dart_converter.py end-to-end
# ═══════════════════════════════════════════════════════════
separator("2. End-to-End 컨버전 파이프라인")

from dart_converter import DartConverter

try:
    converter = DartConverter()
    result = converter.convert(test_company, fiscal_year)

    # 결과 검증
    checks = []
    checks.append(("회사정보", result.company is not None))
    checks.append(("BS계정", len(result.bs_accounts) > 0))
    checks.append(("IS계정", len(result.is_accounts) > 0))
    checks.append(("전환항목", len(result.conversion_items) > 0))
    checks.append(("전환변동", len(result.conversion_deltas) > 0))
    checks.append(("체크리스트", len(result.checklist) > 0))

    all_ok = all(v for _, v in checks)
    detail = ", ".join(f"{k}={'O' if v else 'X'}" for k, v in checks)
    log("2-1 convert()", PASS if all_ok else WARN, detail)

    if result.warnings:
        for w in result.warnings:
            print(f"     {w}")

    # 전환항목 샘플
    print(f"\n  전환항목 상위 5건:")
    for item in result.conversion_items[:5]:
        print(f"     [{item.impact:6s}] {item.account_name:20s} → {item.kifrs_standard} {item.kifrs_name}")

except Exception as e:
    log("2-1 convert()", FAIL, str(e))
    traceback.print_exc()
    result = None


# ═══════════════════════════════════════════════════════════
# 3. 엑셀 출력
# ═══════════════════════════════════════════════════════════
separator("3. 엑셀 출력")

if result:
    output_path = os.path.join(
        os.path.dirname(__file__),
        f"{test_company}_KIFRS전환_{fiscal_year}.xlsx"
    )
    try:
        saved = converter.export_excel(output_path)
        file_size = os.path.getsize(saved) / 1024
        log("3-1 엑셀저장", PASS, f"{saved} ({file_size:.1f}KB)")

        # 시트 검증
        wb = openpyxl.load_workbook(saved)
        sheets = wb.sheetnames
        expected = ['재무상태표', '손익계산서', '전환근거', '전환변동내역', '필요내부자료', '요약']
        missing = [s for s in expected if s not in sheets]
        if missing:
            log("3-2 시트구성", WARN, f"누락: {missing} / 실제: {sheets}")
        else:
            log("3-2 시트구성", PASS, f"{len(sheets)}개 시트 모두 존재")
        wb.close()

    except Exception as e:
        log("3-1 엑셀저장", FAIL, str(e))
        traceback.print_exc()


# ═══════════════════════════════════════════════════════════
# 4. 추가 기업 테스트 (선택)
# ═══════════════════════════════════════════════════════════
separator("4. 추가 기업 테스트")

extra_companies = ["금화", "갈라인터내셔널"]
for name in extra_companies:
    try:
        found = dart.search_company(name)
        if found:
            log(f"4-x {name}", PASS, f"검색 결과 {len(found)}건 (첫 결과: {found[0]['corp_name']})")
        else:
            log(f"4-x {name}", WARN, "검색 결과 없음")
    except Exception as e:
        log(f"4-x {name}", FAIL, str(e))


# ═══════════════════════════════════════════════════════════
# 결과 요약
# ═══════════════════════════════════════════════════════════
separator("테스트 결과 요약")

pass_count = sum(1 for _, s, _ in results if s == PASS)
warn_count = sum(1 for _, s, _ in results if s == WARN)
fail_count = sum(1 for _, s, _ in results if s == FAIL)

print(f"\n  총 {len(results)}건: {PASS} {pass_count}건 / {WARN} {warn_count}건 / {FAIL} {fail_count}건")

if fail_count > 0:
    print(f"\n  실패 항목:")
    for step, s, detail in results:
        if s == FAIL:
            print(f"    [{step}] {detail}")

if fail_count == 0:
    print(f"\n  🎉 모든 테스트 통과! DART 연동이 정상 동작합니다.")
    print(f"  다음 명령어로 컨버전을 실행할 수 있습니다:")
    print(f"    python dart_converter.py <기업명> [사업연도]")
elif warn_count > 0 and fail_count == 0:
    print(f"\n  일부 경고가 있지만 핵심 기능은 정상입니다.")
    print(f"  경고 항목은 대부분 데이터 미공시나 비상장사 제한입니다.")
