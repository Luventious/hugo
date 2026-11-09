# -*- coding: utf-8 -*-
"""修复 CJK 标点紧贴 ** 导致的加粗失效（goldmark/CommonMark flanking）。

失效条件（精确）：
1. 闭合侧：`。**客户` —— 闭合 ** 前是标点、后紧跟文字（非标点非空白）。
2. 打开侧：`为**“移动…` —— 打开 ** 后紧跟标点、且该加粗段的闭合符是
   正常闭合（其后是标点/空白，即不是同类失效的开头）。
   用成对扫描定位 **inner**；打开侧仅当 inner 以标点开头时才动，
   把该标点移到 ** 之前。

修后文字内容、标点位置均不变（只与 ** 对调），且"标点不进粗"符合
中文排版惯例。幂等：第二次跑不产生变化。

用法：python tools/fix-bold.py
"""
import os
import re
import unicodedata

PAIR = re.compile(r"\*\*(.+?)\*\*", re.S)


def is_punct(ch: str) -> bool:
    return bool(ch) and unicodedata.category(ch)[0] in ("P", "S")


def is_word(ch: str) -> bool:
    return bool(ch) and not ch.isspace() and not is_punct(ch)


def fix_text(text: str) -> str:
    # 迭代到不动点：修复一对后可能让相邻对变成可识别形态
    prev = None
    cur = text
    rounds = 0
    while cur != prev and rounds < 10:
        prev, cur, rounds = cur, _fix_pass(cur), rounds + 1
    return cur


def _fix_pass(text: str) -> str:
    out, pos = [], 0
    for m in PAIR.finditer(text):
        inner = m.group(1)
        before = text[m.start() - 1] if m.start() else ""
        after = text[m.end()] if m.end() < len(text) else ""
        open_punct = ""
        close_punct = ""
        if inner and is_punct(inner[-1]) and is_word(after):
            inner, close_punct = inner[:-1], inner[-1]
        if inner and is_punct(inner[0]) and is_word(before):
            open_punct, inner = inner[0], inner[1:]
        if not open_punct and not close_punct:
            continue
        out.append(text[pos:m.start()])
        out.append(open_punct + "**" + inner + "**" + close_punct)
        pos = m.end()
    out.append(text[pos:])
    return "".join(out)


def main() -> int:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    changed = 0
    for base, _dirs, files in os.walk(os.path.join(root, "content")):
        for name in files:
            if not name.endswith(".md"):
                continue
            path = os.path.join(base, name)
            with open(path, encoding="utf-8") as f:
                content = f.read()
            new = fix_text(content)
            if new != content:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(new)
                changed += 1
                print(f"fixed: {os.path.relpath(path, root)}")
    print(f"[fix-bold] normalized {changed} file(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
