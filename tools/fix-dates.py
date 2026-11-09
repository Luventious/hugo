#!/usr/bin/env python3
"""规范化 content/ 下 md frontmatter 的 date 为 RFC3339。

与 .github/workflows/deploy_COS.yml 的 "Fix Hugo Date Formats to RFC3339"
步骤使用同一正则，保证本地预览和 CI 构建看到的 date 完全一致。

用法：python tools/fix-dates.py   （不带参数，原地修改）
"""
import os
import re

FOLDER = "content"
# 匹配 `date: 2022-12-1 8:0:00 +0800` 这类缺前导零 / 空格分隔的写法
PATTERN = re.compile(
    r"(date:\s*)(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2}):(\d{1,2})\s*([+-]?\d{1,2}:?\d{2})"
)


def fix(match: re.Match) -> str:
    prefix = match.group(1)
    y, m, d = int(match.group(2)), int(match.group(3)), int(match.group(4))
    H, M, S = int(match.group(5)), int(match.group(6)), int(match.group(7))
    tz_raw = match.group(8).strip()
    if tz_raw.startswith(("+", "-")):
        tz_sign, tz_body = tz_raw[0], tz_raw[1:]
    else:
        tz_sign, tz_body = "+", tz_raw
    tz_digits = tz_body.replace(":", "").zfill(4)
    tz_h, tz_m = int(tz_digits[:2]), int(tz_digits[2:])
    return f"{prefix}{y:04d}-{m:02d}-{d:02d}T{H:02d}:{M:02d}:{S:02d}{tz_sign}{tz_h:02d}:{tz_m:02d}"


def main() -> int:
    root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    changed = 0
    for base, _dirs, files in os.walk(os.path.join(root, FOLDER)):
        for name in files:
            if not name.endswith(".md"):
                continue
            path = os.path.join(base, name)
            with open(path, encoding="utf-8") as f:
                content = f.read()
            new = PATTERN.sub(fix, content)
            if new != content:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(new)
                changed += 1
                print(f"fixed: {os.path.relpath(path, root)}")
    if changed:
        print(f"[fix-dates] normalized {changed} file(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
