import os
import shutil
import subprocess
from pathlib import Path

_ESBUILD_BIN = os.environ.get("ESBUILD_BIN", "esbuild")

def _esbuild_cmd():
    root = Path(__file__).resolve().parent.parent.parent
    node = shutil.which("node")
    for entry in (root / "node_modules" / "esbuild" / "bin" / "esbuild",
                  root / "node_modules" / "esbuild" / "bin.js"):
        if entry.exists() and node:
            return [node, str(entry)]
    exe = shutil.which(_ESBUILD_BIN)
    if exe and os.name != "nt":
        return [exe]
    npx = shutil.which("npx")
    return [npx, "--yes", _ESBUILD_BIN] if npx else None

def _esbuild_run(texts):
    cmd = _esbuild_cmd()
    if not cmd or not texts:
        return [""] * len(texts)
    payload = "\n;\n".join(texts)
    try:
        proc = subprocess.run(
            cmd + ["--minify", "--target=es2020", "--legal-comments=none"],
            input=payload.encode("utf-8"), capture_output=True, timeout=180,
        )
        if proc.returncode != 0 or not proc.stdout:
            return [""] * len(texts)
        return proc.stdout.decode("utf-8", "replace").split("\n;\n")
    except Exception:
        return [""] * len(texts)

def _rjsmin_run(text):
    try:
        import rjsmin
        return rjsmin.jsmin(text)
    except Exception:
        return ""

def minify_many(texts):
    texts = list(texts or [])
    if not texts:
        return texts
    outs = _esbuild_run(texts)
    if len(outs) != len(texts) or not all(outs):
        fallback = [""] * len(texts)
        for i, text in enumerate(texts):
            alt = _rjsmin_run(text)
            fallback[i] = alt if alt else text
        return fallback
    return outs

def minify_js(text: str) -> str:
    return minify_many([text])[0] if text else text

def minify_available() -> str:
    if _esbuild_cmd() and _esbuild_run(["var a=1;"])[0]:
        return "esbuild"
    return "rjsmin" if _rjsmin_run("var a = 1;") else "none"
