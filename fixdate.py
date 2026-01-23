python3 <<'EOF'
import os
import re
from datetime import datetime

folder = "content"  # Hugo 內容目錄，通常是 content/

# 匹配常見的非標準日期格式（你的例子 + 一些常見變體）
date_pattern = re.compile(
    r'^date:\s*'
    r'(\d{4})[-/](\d{1,2})[-/](\d{1,2})'          # 年-月-日 或 年/月/日
    r'(?:\s+[Tt])?'                               # 可選的 T 或空格
    r'(\d{1,2}):(\d{1,2}):?(\d{1,2})?'            # 時:分(:秒 可選)
    r'(?:\s*([+-]\d{4}|\s*Z|\s*UTC))?\s*$',       # 時區部分（可選）
    re.IGNORECASE | re.MULTILINE
)

def normalize_date(match):
    year, month, day = match.group(1), match.group(2), match.group(3)
    hour   = match.group(4) or "00"
    minute = match.group(5) or "00"
    second = match.group(6) or "00"
    tz     = match.group(7)

    # 補零
    year   = int(year)
    month  = int(month)
    day    = int(day)
    hour   = int(hour)
    minute = int(minute)
    second = int(second)

    # 處理時區
    if not tz or tz.strip().upper() in ('', 'Z', 'UTC'):
        tz_offset = "Z"              # UTC
    else:
        # +0800 → +08:00
        tz = tz.replace(" ", "").strip()
        if len(tz) == 5 and tz[0] in "+-":   # +0800, -0500
            sign = tz[0]
            hh = tz[1:3]
            mm = tz[3:5]
            tz_offset = f"{sign}{hh}:{mm}"
        else:
            tz_offset = tz  # 已經是 +08:00 或其他格式，保留

    # 組成標準 RFC3339 / ISO8601 格式
    iso_date = f"{year:04d}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}:{second:02d}{tz_offset}"

    return f"date: {iso_date}"

modified_count = 0

for root, dirs, files in os.walk(folder):
    for file in files:
        if not file.endswith((".md", ".markdown", ".mdown")):
            continue

        path = os.path.join(root, file)
        try:
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
        except Exception as e:
            print(f"無法讀取 {path} : {e}")
            continue

        # 替換（使用 re.sub 配合 function）
        new_content, count = re.subn(
            date_pattern,
            normalize_date,
            content,
            flags=re.MULTILINE | re.IGNORECASE
        )

        if count > 0:
            try:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(new_content)
                print(f"已修正 {count} 處日期 → {path}")
                modified_count += count
            except Exception as e:
                print(f"無法寫入 {path} : {e}")

if modified_count == 0:
    print("沒有發現需要修正的 date 格式。")
else:
    print(f"\n總共修正了 {modified_count} 個 date 欄位。")
EOF