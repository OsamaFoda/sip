"""Writes store/i18n-review.html: every string in English and Arabic side by side, with what it's
for and which part of Sip owns it, plural sets together, and the Arabic digits choice. For the
developer to review the Arabic before release; a changed string is a one-line edit in
locales/ar/<part>.json, then python3 tools/build.py."""
import html
import json
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PARTS = ["core", "savers", "ui"]


def load(lang, part):
    with open(os.path.join(ROOT, "locales", lang, part + ".json"), encoding="utf-8") as f:
        return json.load(f)


def main():
    digits = re.search(r"ARABIC_DIGITS = '(\w+)'", open(os.path.join(ROOT, "lib", "format.js"), encoding="utf-8").read()).group(1)
    rows = []
    for part in PARTS:
        en, ar = load("en", part), load("ar", part)
        bases = sorted({k.split("__")[0] for k in list(en) + list(ar)}, key=lambda b: list(en).index(next(k for k in en if k.split("__")[0] == b)) if any(k.split("__")[0] == b for k in en) else 0)
        for base in bases:
            en_forms = {k.split("__")[1] if "__" in k else "": v for k, v in en.items() if k.split("__")[0] == base}
            ar_forms = {k.split("__")[1] if "__" in k else "": v for k, v in ar.items() if k.split("__")[0] == base}
            desc = next(iter(en_forms.values()))["description"]
            if list(ar_forms) == [""]:
                rows.append((part, base, desc, html.escape(en_forms[""]["message"]), html.escape(ar_forms[""]["message"])))
            else:
                fmt = lambda forms: "<br>".join(f"<small>{c}</small> {html.escape(forms[c]['message'])}" for c in ("zero", "one", "two", "few", "many", "other") if c in forms)
                rows.append((part, base + " (plural)", desc, fmt(en_forms), fmt(ar_forms)))
    body = "\n".join(f"<tr><td>{p}</td><td><code>{html.escape(k)}</code></td><td>{html.escape(d)}</td><td>{e}</td><td lang=ar dir=rtl>{a}</td></tr>" for p, k, d, e, a in rows)
    page = f"""<!doctype html><html lang=en><head><meta charset=utf-8><title>Sip: Arabic review</title>
<style>body{{font:14px/1.45 system-ui,"Noto Sans Arabic",sans-serif;margin:24px;color:#13242b}} table{{border-collapse:collapse;width:100%}}
td,th{{border:1px solid #d5dde0;padding:6px 8px;vertical-align:top;text-align:start}} th{{background:#eaf0f6;position:sticky;top:0}}
td:nth-child(5){{font-size:16px}} small{{color:#5b6b71;font-family:monospace}} code{{font-size:12px}} .note{{background:#fff6dd;padding:10px 14px;border-radius:8px}}</style></head><body>
<h1>Sip 1.0: strings to review</h1>
<p class=note>Arabic digits: <b>{digits}</b> ({'Western digits, 1.42 جيجا' if digits == 'latn' else 'Arabic-Indic digits, ١٫٤٢ جيجا'}).
Change <code>ARABIC_DIGITS</code> in <code>lib/format.js</code> to switch. Plural sets show each form Arabic needs:
zero, one, two, few (3–10), many (11–99), other (100 and up). To change a string, edit <code>locales/ar/&lt;part&gt;.json</code> and run <code>python3 tools/build.py</code>.</p>
<p>{len(rows)} strings.</p>
<table><thead><tr><th>Part</th><th>Key</th><th>What it's for</th><th>English</th><th>العربية</th></tr></thead><tbody>
{body}
</tbody></table></body></html>
"""
    out = os.path.join(ROOT, "store", "i18n-review.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(page)
    print(out, len(rows), "strings")


if __name__ == "__main__":
    main()
