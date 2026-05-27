"""
Markdown → PDF 변환 (한글 폰트 NanumGothic 적용)
weasyprint + python-markdown 사용
"""
import sys
import re
from pathlib import Path
import markdown
from weasyprint import HTML, CSS
from weasyprint.text.fonts import FontConfiguration

FONT_REGULAR = "/sessions/elegant-sleepy-mendel/.fonts/NanumGothic.ttf"
FONT_BOLD = "/sessions/elegant-sleepy-mendel/.fonts/NanumGothicBold.ttf"

CSS_STR = f"""
@font-face {{
    font-family: 'NanumGothic';
    src: url('file://{FONT_REGULAR}') format('truetype');
    font-weight: normal;
    font-style: normal;
}}
@font-face {{
    font-family: 'NanumGothic';
    src: url('file://{FONT_BOLD}') format('truetype');
    font-weight: bold;
    font-style: normal;
}}
@page {{
    size: A4;
    margin: 18mm 15mm 18mm 15mm;
    @bottom-center {{
        content: counter(page) " / " counter(pages);
        font-family: 'NanumGothic';
        font-size: 9pt;
        color: #888;
    }}
}}
* {{ box-sizing: border-box; }}
html, body {{
    font-family: 'NanumGothic', 'Noto Sans CJK KR', sans-serif;
    font-size: 10.5pt;
    line-height: 1.55;
    color: #1f2937;
    word-break: keep-all;
    overflow-wrap: break-word;
}}
h1, h2, h3, h4, h5, h6 {{
    font-family: 'NanumGothic', sans-serif;
    font-weight: bold;
    color: #0f172a;
    margin-top: 1.4em;
    margin-bottom: 0.5em;
    page-break-after: avoid;
}}
h1 {{
    font-size: 20pt;
    border-bottom: 2.5px solid #1f4e79;
    padding-bottom: 6px;
    color: #1f4e79;
}}
h2 {{
    font-size: 15pt;
    border-bottom: 1px solid #cbd5e1;
    padding-bottom: 4px;
    color: #1f4e79;
}}
h3 {{ font-size: 12.5pt; color: #1e3a8a; }}
h4 {{ font-size: 11.5pt; color: #334155; }}
p {{ margin: 0.55em 0; }}
strong {{ font-weight: bold; color: #111827; }}
em {{ color: #4338ca; }}
blockquote {{
    border-left: 3px solid #1f4e79;
    background: #f1f5f9;
    margin: 0.8em 0;
    padding: 0.6em 0.9em;
    color: #334155;
    font-size: 10pt;
}}
code {{
    font-family: 'DejaVu Sans Mono', monospace;
    background: #f1f5f9;
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 9.5pt;
    color: #be123c;
}}
pre {{
    background: #0f172a;
    color: #e2e8f0;
    padding: 10px 12px;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 9pt;
    line-height: 1.45;
    page-break-inside: avoid;
}}
pre code {{ background: transparent; color: inherit; padding: 0; }}
table {{
    border-collapse: collapse;
    width: 100%;
    margin: 0.8em 0;
    font-size: 9.5pt;
    page-break-inside: auto;
}}
table th, table td {{
    border: 1px solid #cbd5e1;
    padding: 5px 7px;
    text-align: left;
    vertical-align: top;
    word-break: keep-all;
}}
table th {{
    background: #1f4e79;
    color: #ffffff;
    font-weight: bold;
}}
table tr:nth-child(even) td {{ background: #f8fafc; }}
ul, ol {{ margin: 0.4em 0 0.6em 1.3em; padding: 0; }}
li {{ margin: 0.18em 0; }}
hr {{
    border: none;
    border-top: 1px dashed #94a3b8;
    margin: 1.2em 0;
}}
a {{ color: #1d4ed8; text-decoration: underline; }}
"""


def md_to_html(md_text: str, title: str) -> str:
    extensions = [
        "extra",        # tables, fenced_code, etc.
        "tables",
        "fenced_code",
        "sane_lists",
        "toc",
        "nl2br",
    ]
    body_html = markdown.markdown(md_text, extensions=extensions, output_format="html5")
    # autolink bare URLs (markdown.extensions.extra handles <url>, but plain URLs not always)
    return f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>{title}</title>
</head>
<body>
{body_html}
</body>
</html>"""


def convert(md_path: str, pdf_path: str):
    md_text = Path(md_path).read_text(encoding="utf-8")
    title = Path(md_path).stem
    html_str = md_to_html(md_text, title)
    font_config = FontConfiguration()
    css = CSS(string=CSS_STR, font_config=font_config)
    HTML(string=html_str, base_url=str(Path(md_path).parent)).write_pdf(
        pdf_path,
        stylesheets=[css],
        font_config=font_config,
    )
    print(f"OK: {pdf_path}")


if __name__ == "__main__":
    pairs = [
        ("/sessions/elegant-sleepy-mendel/mnt/conversion/삼일PwC_Digital전형_적합도분석.md",
         "/sessions/elegant-sleepy-mendel/mnt/outputs/삼일PwC_Digital전형_적합도분석.pdf"),
        ("/sessions/elegant-sleepy-mendel/mnt/conversion/삼일PwC_Digital전형_채용공고_이미지분석.md",
         "/sessions/elegant-sleepy-mendel/mnt/outputs/삼일PwC_Digital전형_채용공고_이미지분석.pdf"),
    ]
    for md, pdf in pairs:
        convert(md, pdf)
