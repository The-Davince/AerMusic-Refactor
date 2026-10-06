import os
import shutil
import subprocess
import tempfile
from pathlib import Path

_ESBUILD_BIN = os.environ.get("ESBUILD_BIN", "esbuild")

def _esbuild_cmd():
    root = Path(__file__).resolve().parent.parent
    node = shutil.which("node")
    for entry in (root / "node_modules" / "esbuild" / "bin" / "esbuild",
                  root / "node_modules" / "esbuild" / "bin.js"):
        if entry.exists() and node:
            return [node, str(entry)]
    exe = shutil.which(_ESBUILD_BIN)
    if exe:
        return [exe]
    npx = shutil.which("npx")
    return [npx, "--offline", "--yes", _ESBUILD_BIN] if npx else None

def _esbuild_run(texts):
    cmd = _esbuild_cmd()
    if not cmd or not texts:
        return [""] * len(texts)
    try:
        with tempfile.TemporaryDirectory(prefix="aermusic-jsmin-") as tmp:
            source_dir = Path(tmp) / "source"
            output_dir = Path(tmp) / "output"
            source_dir.mkdir()
            source_files = []
            for i, text in enumerate(texts):
                source = source_dir / f"{i}.js"
                source.write_text(text, encoding="utf-8")
                source_files.append(str(source))
            proc = subprocess.run(
                cmd + ["--minify", "--target=es2020", "--legal-comments=none",
                       f"--outdir={output_dir}", *source_files],
                capture_output=True, timeout=180,
            )
            if proc.returncode != 0:
                return [""] * len(texts)
            outputs = []
            for i in range(len(texts)):
                output = output_dir / f"{i}.js"
                if not output.exists():
                    return [""] * len(texts)
                outputs.append(output.read_text(encoding="utf-8"))
            return outputs
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
