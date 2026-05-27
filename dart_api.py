"""
DART OpenAPI 연동 모듈
======================
금융감독원 전자공시시스템(DART)에서 기업 재무정보를 자동 수집한다.

주요 기능:
  1. 기업명 → 고유번호(corp_code) 검색
  2. 기업개황 조회 (업종, 결산월, 대표자 등)
  3. 재무제표 주요계정 조회 (BS/IS 수치)
  4. 단일회사 전체 재무제표 조회 (상세)
  5. 공시서류 검색 및 원문 다운로드 (감사보고서 PDF)

사용법:
  dart = DartAPI(api_key="YOUR_KEY")
  corp = dart.search_company("비제바노")
  financials = dart.get_financial_statements(corp['corp_code'], '2024')
"""

import os
import json
import time
import zipfile
import io
import re
import xml.etree.ElementTree as ET
from typing import Optional, List, Dict, Any, Tuple
from dataclasses import dataclass, field
from pathlib import Path

try:
    import requests
except ImportError:
    requests = None


# ═══════════════════════════════════════════════════════════
# 설정
# ═══════════════════════════════════════════════════════════

BASE_URL = "https://opendart.fss.or.kr/api"

# API 키 저장 위치 (프로젝트 루트의 .dart_config.json)
CONFIG_PATH = Path(__file__).parent / ".dart_config.json"

# 고유번호 캐시 (ZIP 다운로드 결과를 로컬에 저장)
CORP_CODE_CACHE = Path(__file__).parent / ".dart_corp_codes.json"


# ═══════════════════════════════════════════════════════════
# 데이터 구조
# ═══════════════════════════════════════════════════════════

@dataclass
class CompanyInfo:
    """기업 기본정보"""
    corp_code: str          # DART 고유번호 (8자리)
    corp_name: str          # 정식 회사명
    stock_code: str = ""    # 종목코드 (상장사만)
    corp_cls: str = ""      # Y=유가, K=코스닥, N=코넥스, E=기타
    ceo_nm: str = ""        # 대표자명
    induty_code: str = ""   # 업종코드
    est_dt: str = ""        # 설립일
    acc_mt: str = ""        # 결산월
    adres: str = ""         # 주소
    bizr_no: str = ""       # 사업자등록번호

    @property
    def industry_category(self) -> str:
        """업종 대분류 추정"""
        code = self.induty_code
        if not code:
            return "기타"
        code2 = code[:2] if len(code) >= 2 else code
        industry_map = {
            '10': '제조업', '11': '제조업', '12': '제조업', '13': '제조업',
            '14': '제조업', '15': '제조업', '16': '제조업', '17': '제조업',
            '18': '제조업', '19': '제조업', '20': '제조업', '21': '제조업',
            '22': '제조업', '23': '제조업', '24': '제조업', '25': '제조업',
            '26': '제조업', '27': '제조업', '28': '제조업', '29': '제조업',
            '30': '제조업', '31': '제조업', '32': '제조업', '33': '제조업',
            '41': '건설업', '42': '건설업',
            '45': '도소매업', '46': '도소매업', '47': '도소매업',
            '58': 'IT/서비스업', '59': 'IT/서비스업', '60': 'IT/서비스업',
            '61': 'IT/서비스업', '62': 'IT/서비스업', '63': 'IT/서비스업',
            '64': '금융업', '65': '금융업', '66': '금융업',
        }
        return industry_map.get(code2, '기타')


@dataclass
class FinancialAccount:
    """재무제표 계정 항목"""
    account_nm: str         # 계정명
    sj_div: str             # BS/IS/CIS/CF/SCE
    sj_nm: str              # 재무제표명
    thstrm_amount: Optional[int] = None    # 당기금액
    frmtrm_amount: Optional[int] = None    # 전기금액
    bfefrmtrm_amount: Optional[int] = None # 전전기금액
    ord: int = 0            # 정렬순서
    fs_div: str = ""        # OFS/CFS
    currency: str = "KRW"


@dataclass
class DisclosureInfo:
    """공시 정보"""
    rcept_no: str           # 접수번호
    corp_name: str
    report_nm: str          # 보고서명
    rcept_dt: str           # 접수일자
    flr_nm: str = ""        # 제출인


# ═══════════════════════════════════════════════════════════
# DART API 클라이언트
# ═══════════════════════════════════════════════════════════

class DartAPIError(Exception):
    """DART API 오류"""
    pass


class DartAPI:
    """DART OpenAPI 클라이언트"""

    def __init__(self, api_key: Optional[str] = None):
        if requests is None:
            raise ImportError("requests 라이브러리가 필요합니다: pip install requests")

        self.api_key = api_key or self._load_api_key()
        self._corp_codes: Dict[str, Dict] = {}  # name → {corp_code, stock_code, ...}
        self._request_count = 0
        self._last_request_time = 0

    # ── API 키 관리 ──

    @staticmethod
    def save_api_key(key: str):
        """API 키를 로컬 설정 파일에 저장"""
        config = {}
        if CONFIG_PATH.exists():
            with open(CONFIG_PATH, 'r') as f:
                config = json.load(f)
        config['api_key'] = key
        with open(CONFIG_PATH, 'w') as f:
            json.dump(config, f, indent=2)
        print(f"✅ API 키가 {CONFIG_PATH}에 저장되었습니다.")

    def _load_api_key(self) -> str:
        """설정 파일에서 API 키 로드"""
        if CONFIG_PATH.exists():
            with open(CONFIG_PATH, 'r') as f:
                config = json.load(f)
                return config.get('api_key', '')
        # 환경변수에서도 확인
        return os.environ.get('DART_API_KEY', '')

    # ── 공통 요청 ──

    def _request(self, endpoint: str, params: dict = None, binary: bool = False) -> Any:
        """DART API 요청 (속도제한 준수)"""
        if not self.api_key:
            raise DartAPIError(
                "DART API 키가 설정되지 않았습니다.\n"
                "1. https://opendart.fss.or.kr 에서 회원가입\n"
                "2. 인증키 신청 후 발급\n"
                "3. DartAPI.save_api_key('발급받은키') 실행"
            )

        # 속도 제한: 분당 약 900건 → 초당 15건 → 최소 70ms 간격
        elapsed = time.time() - self._last_request_time
        if elapsed < 0.1:
            time.sleep(0.1 - elapsed)

        url = f"{BASE_URL}/{endpoint}"
        params = params or {}
        params['crtfc_key'] = self.api_key

        response = requests.get(url, params=params, timeout=30)
        self._last_request_time = time.time()
        self._request_count += 1

        if binary:
            if response.status_code != 200:
                raise DartAPIError(f"HTTP {response.status_code}: {endpoint}")
            return response.content

        # JSON 응답 처리
        if response.headers.get('Content-Type', '').startswith('application/json'):
            data = response.json()
        else:
            # ZIP 파일 등 바이너리 응답
            return response.content

        # 에러 체크
        status = data.get('status', '000')
        if status != '000':
            msg = data.get('message', '알 수 없는 오류')
            if status == '013':
                return None  # 조회 결과 없음
            raise DartAPIError(f"DART API 오류 [{status}]: {msg}")

        return data

    # ── 1. 고유번호 검색 (기업명 → corp_code) ──

    def _load_corp_codes(self):
        """고유번호 목록을 캐시에서 로드하거나 API에서 다운로드"""
        # 캐시가 있으면 로드
        if CORP_CODE_CACHE.exists():
            cache_age = time.time() - CORP_CODE_CACHE.stat().st_mtime
            if cache_age < 86400 * 30:  # 30일 이내면 캐시 사용
                with open(CORP_CODE_CACHE, 'r', encoding='utf-8') as f:
                    self._corp_codes = json.load(f)
                return

        # API에서 다운로드 (ZIP → XML 파싱)
        print("📥 DART 기업 고유번호 목록을 다운로드합니다 (최초 1회)...")
        content = self._request("corpCode.xml", binary=True)

        if not content:
            raise DartAPIError("고유번호 목록 다운로드 실패")

        # ZIP 해제 → XML 파싱
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            xml_name = zf.namelist()[0]
            with zf.open(xml_name) as xml_file:
                tree = ET.parse(xml_file)
                root = tree.getroot()

        corp_dict = {}
        for item in root.findall('.//list'):
            corp_code = item.findtext('corp_code', '').strip()
            corp_name = item.findtext('corp_name', '').strip()
            stock_code = item.findtext('stock_code', '').strip()
            modify_date = item.findtext('modify_date', '').strip()

            if corp_name and corp_code:
                # 이름 기반 검색용: 정식명, (주) 제거명, 공백 제거명 모두 등록
                names = [corp_name]
                clean = corp_name.replace('주식회사', '').replace('(주)', '').replace('㈜', '').strip()
                if clean != corp_name:
                    names.append(clean)

                entry = {
                    'corp_code': corp_code,
                    'corp_name': corp_name,
                    'stock_code': stock_code or '',
                    'modify_date': modify_date,
                }
                for n in names:
                    corp_dict[n] = entry

        self._corp_codes = corp_dict

        # 캐시 저장
        with open(CORP_CODE_CACHE, 'w', encoding='utf-8') as f:
            json.dump(corp_dict, f, ensure_ascii=False)
        print(f"✅ {len(corp_dict)}개 기업 정보가 캐시되었습니다.")

    def search_company(self, name: str, limit: int = 10) -> List[Dict[str, str]]:
        """기업명으로 고유번호 검색

        Args:
            name: 검색할 기업명 (부분 매칭)
            limit: 최대 결과 수

        Returns:
            [{'corp_code': '00126380', 'corp_name': '삼성전자', 'stock_code': '005930'}, ...]
        """
        if not self._corp_codes:
            self._load_corp_codes()

        name_clean = name.replace(' ', '').lower()
        results = []
        seen_codes = set()

        # 1순위: 정확 매칭
        for key, val in self._corp_codes.items():
            if key.replace(' ', '').lower() == name_clean:
                if val['corp_code'] not in seen_codes:
                    results.append(val)
                    seen_codes.add(val['corp_code'])

        # 2순위: 포함 매칭
        if len(results) < limit:
            for key, val in self._corp_codes.items():
                if name_clean in key.replace(' ', '').lower():
                    if val['corp_code'] not in seen_codes:
                        results.append(val)
                        seen_codes.add(val['corp_code'])
                        if len(results) >= limit:
                            break

        return results

    # ── 2. 기업개황 조회 ──

    def get_company_info(self, corp_code: str) -> Optional[CompanyInfo]:
        """기업개황 조회"""
        data = self._request("company.json", {'corp_code': corp_code})
        if not data:
            return None

        return CompanyInfo(
            corp_code=corp_code,
            corp_name=data.get('corp_name', ''),
            stock_code=data.get('stock_code', ''),
            corp_cls=data.get('corp_cls', ''),
            ceo_nm=data.get('ceo_nm', ''),
            induty_code=data.get('induty_code', ''),
            est_dt=data.get('est_dt', ''),
            acc_mt=data.get('acc_mt', ''),
            adres=data.get('adres', ''),
            bizr_no=data.get('bizr_no', ''),
        )

    # ── 3. 재무제표 주요계정 조회 ──

    def get_financial_statements(
        self,
        corp_code: str,
        bsns_year: str,
        reprt_code: str = "11011",  # 사업보고서
        fs_div: str = "OFS",        # OFS=개별, CFS=연결
    ) -> List[FinancialAccount]:
        """단일회사 주요계정 조회

        Args:
            corp_code: 고유번호
            bsns_year: 사업연도 (예: '2024')
            reprt_code: 11011=사업보고서, 11012=반기, 11013=1Q, 11014=3Q
            fs_div: OFS=개별재무제표, CFS=연결재무제표

        Returns:
            계정 목록 (FinancialAccount)
        """
        data = self._request("fnlttSinglAcnt.json", {
            'corp_code': corp_code,
            'bsns_year': bsns_year,
            'reprt_code': reprt_code,
        })

        if not data or 'list' not in data:
            return []

        accounts = []
        for item in data['list']:
            # 개별/연결 필터링
            if item.get('fs_div') != fs_div:
                continue

            acc = FinancialAccount(
                account_nm=item.get('account_nm', ''),
                sj_div=item.get('sj_div', ''),
                sj_nm=item.get('sj_nm', ''),
                thstrm_amount=self._parse_amount(item.get('thstrm_amount', '')),
                frmtrm_amount=self._parse_amount(item.get('frmtrm_amount', '')),
                bfefrmtrm_amount=self._parse_amount(item.get('bfefrmtrm_amount', '')),
                ord=int(item.get('ord', 0) or 0),
                fs_div=item.get('fs_div', ''),
                currency=item.get('currency', 'KRW'),
            )
            accounts.append(acc)

        accounts.sort(key=lambda a: (a.sj_div, a.ord))
        return accounts

    # ── 4. 단일회사 전체 재무제표 조회 (상세) ──

    def get_full_financial_statements(
        self,
        corp_code: str,
        bsns_year: str,
        reprt_code: str = "11011",
        fs_div: str = "OFS",
    ) -> List[FinancialAccount]:
        """단일회사 전체 재무제표 조회 (상세 계정과목 포함)

        fnlttSinglAll.json 엔드포인트 사용
        """
        data = self._request("fnlttSinglAll.json", {
            'corp_code': corp_code,
            'bsns_year': bsns_year,
            'reprt_code': reprt_code,
            'fs_div': fs_div,
        })

        if not data or 'list' not in data:
            return []

        accounts = []
        for item in data['list']:
            acc = FinancialAccount(
                account_nm=item.get('account_nm', ''),
                sj_div=item.get('sj_div', ''),
                sj_nm=item.get('sj_nm', ''),
                thstrm_amount=self._parse_amount(item.get('thstrm_amount', '')),
                frmtrm_amount=self._parse_amount(item.get('frmtrm_amount', '')),
                bfefrmtrm_amount=self._parse_amount(item.get('bfefrmtrm_amount', '')),
                ord=int(item.get('ord', 0) or 0),
                fs_div=fs_div,
                currency=item.get('currency', 'KRW'),
            )
            accounts.append(acc)

        accounts.sort(key=lambda a: (a.sj_div, a.ord))
        return accounts

    # ── 5. 공시서류 검색 ──

    def search_disclosures(
        self,
        corp_code: str,
        pblntf_detail_ty: str = "",   # F001=감사보고서, A001=사업보고서
        bgn_de: str = "",
        end_de: str = "",
        last_reprt_at: str = "Y",
        page_count: int = 10,
    ) -> List[DisclosureInfo]:
        """공시서류 검색"""
        params = {
            'corp_code': corp_code,
            'last_reprt_at': last_reprt_at,
            'page_count': str(page_count),
        }
        if pblntf_detail_ty:
            params['pblntf_detail_ty'] = pblntf_detail_ty
        if bgn_de:
            params['bgn_de'] = bgn_de
        if end_de:
            params['end_de'] = end_de

        data = self._request("list.json", params)
        if not data or 'list' not in data:
            return []

        return [
            DisclosureInfo(
                rcept_no=item.get('rcept_no', ''),
                corp_name=item.get('corp_name', ''),
                report_nm=item.get('report_nm', ''),
                rcept_dt=item.get('rcept_dt', ''),
                flr_nm=item.get('flr_nm', ''),
            )
            for item in data['list']
        ]

    def get_audit_report(self, corp_code: str, bsns_year: str) -> Optional[DisclosureInfo]:
        """최신 감사보고서 검색"""
        results = self.search_disclosures(
            corp_code=corp_code,
            pblntf_detail_ty="F001",  # 감사보고서
            bgn_de=f"{bsns_year}0101",
            end_de=f"{int(bsns_year)+1}1231",
            last_reprt_at="Y",
        )
        return results[0] if results else None

    def get_business_report(self, corp_code: str, bsns_year: str) -> Optional[DisclosureInfo]:
        """최신 사업보고서 검색"""
        results = self.search_disclosures(
            corp_code=corp_code,
            pblntf_detail_ty="A001",  # 사업보고서
            bgn_de=f"{bsns_year}0101",
            end_de=f"{int(bsns_year)+1}1231",
            last_reprt_at="Y",
        )
        return results[0] if results else None

    # ── 6. 공시서류 원문 다운로드 ──

    def download_document(self, rcept_no: str, save_dir: str = ".") -> Optional[str]:
        """공시서류 원문 ZIP 다운로드

        Returns:
            저장된 파일 경로 또는 None
        """
        content = self._request("document.xml", {'rcept_no': rcept_no}, binary=True)
        if not content:
            return None

        save_path = os.path.join(save_dir, f"dart_{rcept_no}.zip")
        with open(save_path, 'wb') as f:
            f.write(content)

        return save_path

    # ── 유틸리티 ──

    @staticmethod
    def _parse_amount(val: str) -> Optional[int]:
        """금액 문자열을 정수로 변환 ('-', '9,999,999' 등 처리)"""
        if not val or val.strip() in ('', '-'):
            return None
        cleaned = val.replace(',', '').replace(' ', '').strip()
        try:
            return int(cleaned)
        except (ValueError, TypeError):
            return None

    def get_accounting_standard(self, corp_code: str, bsns_year: str) -> str:
        """적용 회계기준 판별 (K-GAAP vs K-IFRS)

        개별재무제표와 연결재무제표 유무로 판단
        """
        # CFS(연결)가 있으면 K-IFRS 가능성 높음
        cfs = self.get_financial_statements(corp_code, bsns_year, fs_div="CFS")
        ofs = self.get_financial_statements(corp_code, bsns_year, fs_div="OFS")

        if cfs and len(cfs) > 0:
            # 연결재무제표가 존재 → K-IFRS (또는 K-IFRS 이미 적용 중)
            return "K-IFRS"
        elif ofs and len(ofs) > 0:
            return "K-GAAP"
        return "판별불가"


# ═══════════════════════════════════════════════════════════
# CLI 인터페이스
# ═══════════════════════════════════════════════════════════

if __name__ == '__main__':
    import sys

    if len(sys.argv) < 2:
        print("사용법:")
        print("  python dart_api.py set-key <API키>        # API 키 저장")
        print("  python dart_api.py search <기업명>        # 기업 검색")
        print("  python dart_api.py info <고유번호>        # 기업개황 조회")
        print("  python dart_api.py fs <고유번호> <연도>   # 재무제표 조회")
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == 'set-key':
        DartAPI.save_api_key(sys.argv[2])
    elif cmd == 'search':
        dart = DartAPI()
        results = dart.search_company(sys.argv[2])
        for r in results:
            print(f"  {r['corp_code']}  {r['corp_name']:20s}  [{r.get('stock_code','')}]")
    elif cmd == 'info':
        dart = DartAPI()
        info = dart.get_company_info(sys.argv[2])
        if info:
            print(json.dumps(info.__dict__, ensure_ascii=False, indent=2))
    elif cmd == 'fs':
        dart = DartAPI()
        accounts = dart.get_financial_statements(sys.argv[2], sys.argv[3])
        for a in accounts:
            print(f"  [{a.sj_div}] {a.account_nm:20s}  당기={a.thstrm_amount}  전기={a.frmtrm_amount}")
