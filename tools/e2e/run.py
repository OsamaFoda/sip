"""Runs Sip's end-to-end cases (tools/e2e/case_*.py), each in a real browser of its own with a
throwaway profile, at most 3 at a time. Everything is local: the cases serve their own pages.

    python3 tools/e2e/run.py                 every case
    python3 tools/e2e/run.py meter youtube   the cases whose names contain one of these words

A case defines run(ctx) -> {"ok": bool, ...}, and may set PREFS (extra browser prefs) and
TIMEOUT (seconds). A case fails, too, if the browser tried to reach anything over HTTPS (the
proxy refuses it, so nothing leaves the machine, but the case wasn't in control of its traffic).
"""
import concurrent.futures
import glob
import importlib.util
import json
import os
import subprocess
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def one(path):
    from common import Context
    spec = importlib.util.spec_from_file_location("case", path)
    case = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(case)
    ctx = Context(prefs=getattr(case, "PREFS", None), install=getattr(case, "INSTALL", True))
    try:
        result = case.run(ctx)
    except Exception:
        result = {"ok": False, "error": traceback.format_exc()[-2000:]}
    finally:
        leaks = list(ctx.server.leaks)
        ctx.stop()
    connects = [l for l in leaks if l[0] == "CONNECT"]
    if connects:
        result = {**result, "ok": False, "https_attempts": connects[:10]}
    elif leaks:
        result = {**result, "unrouted": leaks[:10]}
    print(json.dumps(result))


def spawn(path):
    case = importlib.util.spec_from_file_location("c", path)
    timeout = 120
    with open(path) as f:
        for line in f:
            if line.startswith("TIMEOUT"):
                timeout = int(line.split("=")[1])
    started = time.time()
    try:
        done = subprocess.run([sys.executable, __file__, "--one", path], capture_output=True, text=True, timeout=timeout + 60)
        last = (done.stdout.strip().splitlines() or [""])[-1]
        result = json.loads(last) if last.startswith("{") else {"ok": False, "output": (done.stdout + done.stderr)[-1500:]}
    except subprocess.TimeoutExpired:
        result = {"ok": False, "error": "timed out"}
    return path, result, time.time() - started


def main():
    if sys.argv[1:2] == ["--one"]:
        return one(sys.argv[2])
    words = sys.argv[1:]
    paths = sorted(glob.glob(os.path.join(HERE, "case_*.py")))
    if words:
        paths = [p for p in paths if any(w in os.path.basename(p) for w in words)]
    if not paths:
        sys.exit("No cases found")
    failed = 0
    with concurrent.futures.ThreadPoolExecutor(3) as pool:
        for path, result, seconds in pool.map(spawn, paths):
            ok = result.get("ok") is True
            failed += not ok
            name = os.path.basename(path)[5:-3]
            print(f"{'pass' if ok else 'FAIL'}  {name}  ({seconds:.0f}s)")
            if not ok or os.environ.get("SIP_E2E_VERBOSE"):
                print("      " + json.dumps(result)[:3000])
    print(f"\n{len(paths) - failed} of {len(paths)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
