"""Builds Sip.

    python3 tools/build.py          merge the strings into _locales/ and pack dist/sip.xpi
    python3 tools/build.py --check  fail if _locales/ is out of date or the strings disagree

Strings live in locales/<lang>/<part>.json (core, savers, ui). They are merged into
_locales/<lang>/messages.json, the format browsers read, which is committed so the source tree
loads unpacked. The merge fails on a key two parts both define, a key one language lacks, a
plural set that isn't complete (English: one, other; Arabic: zero, one, two, few, many, other),
and a different number of $1…$9 placeholders between the languages.
"""
import glob
import json
import os
import re
import sys
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LANGS = ["en", "ar"]
PARTS = ["core", "savers", "ui"]
PLURALS = {"en": {"one", "other"}, "ar": {"zero", "one", "two", "few", "many", "other"}}
PACK = ["manifest.json", "background.js", "content.js", "autoplay.js", "autoplay-main.js",
        "youtube-quality.js", "youtube-player.js", "youtube/*.js", "popup.html", "popup.js",
        "options.html", "options.js", "style.css", "lib.js", "lib/*.js", "ui/*.js",
        "_locales/*/messages.json", "icons/*.png"]


def merged():
    out, problems = {}, []
    for lang in LANGS:
        messages = {}
        for part in PARTS:
            path = os.path.join(ROOT, "locales", lang, part + ".json")
            if not os.path.exists(path):
                continue
            with open(path, encoding="utf-8") as f:
                for key, entry in json.load(f).items():
                    # Browsers look message names up without regard to case.
                    if key.lower() in (k.lower() for k in messages):
                        problems.append(f"{lang}: {key} is defined twice ({part}.json)")
                    if not re.fullmatch(r"[A-Za-z0-9_]+", key):
                        problems.append(f"{lang}: {key} isn't a valid key name")
                    messages[key] = entry
        out[lang] = dict(sorted(messages.items()))
    return out, problems


def groups(messages):
    """base key -> {category: message} for plural sets; plain keys map to {None: message}."""
    result = {}
    for key, entry in messages.items():
        base, _, category = key.partition("__")
        result.setdefault(base, {})[category or None] = entry["message"]
    return result


def top_placeholder(texts):
    return max([int(n) for t in texts for n in re.findall(r"\$([1-9])", t)] or [0])


def check(out):
    problems = []
    g = {lang: groups(out[lang]) for lang in LANGS}
    for base in sorted(set(g["en"]) | set(g["ar"])):
        forms = {lang: g[lang].get(base) for lang in LANGS}
        for lang in LANGS:
            if forms[lang] is None:
                problems.append(f"{lang}: {base} is missing")
        if any(f is None for f in forms.values()):
            continue
        plural = {lang: set(forms[lang]) - {None} for lang in LANGS}
        if any(plural.values()):
            for lang in LANGS:
                if None in forms[lang]:
                    problems.append(f"{lang}: {base} is both a plural set and a plain string")
                if plural[lang] != PLURALS[lang]:
                    problems.append(f"{lang}: {base} has plural forms {sorted(plural[lang])}, wants {sorted(PLURALS[lang])}")
        counts = {lang: top_placeholder(forms[lang].values()) for lang in LANGS}
        if counts["en"] != counts["ar"]:
            problems.append(f"{base}: English uses ${counts['en']}, Arabic ${counts['ar']}")
    return problems


def rendered(out):
    return {lang: json.dumps(out[lang], ensure_ascii=False, indent=2) + "\n" for lang in LANGS}


def main():
    out, problems = merged()
    problems += check(out)
    if problems:
        sys.exit("Strings don't agree:\n  " + "\n  ".join(problems))
    texts = rendered(out)
    paths = {lang: os.path.join(ROOT, "_locales", lang, "messages.json") for lang in LANGS}
    if "--check" in sys.argv:
        stale = [lang for lang in LANGS if not os.path.exists(paths[lang]) or open(paths[lang], encoding="utf-8").read() != texts[lang]]
        if stale:
            sys.exit(f"_locales is out of date for {', '.join(stale)}: run python3 tools/build.py")
        print("strings ok")
        return
    for lang in LANGS:
        os.makedirs(os.path.dirname(paths[lang]), exist_ok=True)
        with open(paths[lang], "w", encoding="utf-8") as f:
            f.write(texts[lang])
    os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
    xpi = os.path.join(ROOT, "dist", "sip.xpi")
    with zipfile.ZipFile(xpi, "w", zipfile.ZIP_DEFLATED) as z:
        for pattern in PACK:
            matches = sorted(glob.glob(os.path.join(ROOT, pattern)))
            if not matches:
                print(f"warning: nothing matches {pattern}", file=sys.stderr)
            for path in matches:
                z.write(path, os.path.relpath(path, ROOT))
    print(xpi)


if __name__ == "__main__":
    main()
