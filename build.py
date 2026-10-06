import argparse
import json
import os
import posixpath
import re
import secrets
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
_MINIFY_JS = os.environ.get("MINIFY_JS", "1") not in ("0", "false", "False")
_REQUIRE_JS_MANGLE = os.environ.get("MINIFY_REQUIRE_MANGLE", "1") not in ("0", "false", "False")
_STATIC_RE = re.compile(r'(src|href)="/static/([^"\'#?]+)"')
_CSS_URL_RE = re.compile(r"url\(\s*(['\"]?)([^'\")\s]+)\1\s*\)")
_JS_STATIC_RE = re.compile(r'["\']/static/([^"\'#?]+)["\']')
_JS_ASSET_RE = re.compile(r'["\']([^"\'\s]+\.(?:png|jpe?g|gif|webp|svg|ico|ttf|woff2?|otf))["\']', re.IGNORECASE)

GREEN, CYAN, YELLOW, RED, BOLD, DIM, RESET = (
    "\033[32m", "\033[36m", "\033[33m", "\033[31m", "\033[1m", "\033[2m", "\033[0m",
)


def _tty():
    return sys.stdout.isatty()


def _bar(cur, total, width=26):
    filled = round(width * cur / total) if total else width
    return "\u2588" * filled + "\u2591" * (width - filled)


def _step(idx, total, title):
    print(f"\n{BOLD}[{idx}/{total}]{RESET} {CYAN}{title}{RESET}")


def _file_progress(cur, total, name, fast):
    if fast or not _tty():
        print(f"  {DIM}.{RESET} {name}")
        return
    pct = round(cur * 100 / total) if total else 100
    sys.stdout.write(f"\r  {_bar(cur, total)} {pct:>3}% {name:<52s}")
    sys.stdout.flush()


def _file_progress_end(fast):
    if fast or not _tty():
        return
    sys.stdout.write("\r" + " " * 88 + "\r")
    sys.stdout.flush()


def _ok(total, unit):
    print(f"  {GREEN}OK{RESET}  {BOLD}{total}{RESET} {unit}")


def _warn(msg):
    print(f"  {YELLOW}WARN{RESET} {msg}")


def _err(msg):
    print(f"  {RED}ERROR{RESET} {msg}", file=sys.stderr)


def rand8():
    return secrets.token_hex(4)


def _sha(p: Path) -> str:
    import hashlib
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _sha_text(text: str) -> str:
    import hashlib
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _hash_name(rel: str, digest: str) -> str:
    parent = posixpath.dirname(rel) or "."
    stem, ext = os.path.splitext(posixpath.basename(rel))
    name = f"{stem}~{digest}{ext}"
    return name if parent == "." else f"{parent}/{name}"


def _ref_map(dist: Path):
    """按输入内容起名, 重写类文件(js/css)的名字在 _settle_names 里迭代修正"""
    m = {}
    for p in dist.rglob("*"):
        if p.is_file() and p.suffix.lower() != ".html":
            rel = p.relative_to(dist).as_posix()
            m[rel] = _hash_name(rel, _sha(p)[:8])
    return m


def _settle_names(dist: Path, ref_map: dict):
    """js/css 写盘前会被重写, 名字必须跟最终内容一致, 迭代到不动点"""
    for _ in range(8):
        next_map = dict(ref_map)
        changed = False
        page_map = _page_module_map(dist, ref_map)
        imp_map = {}
        for key in ("app", "i18n"):
            for rel, new_rel in ref_map.items():
                if rel == f"js/{key}.js":
                    imp_map[key] = new_rel
                    break
        js_rels, js_texts = [], []
        for rel in sorted(ref_map):
            p = dist / rel
            if p.suffix.lower() == ".css":
                text = _rewrite_css(p.read_text(encoding="utf-8"), rel, ref_map)
            elif p.suffix.lower() == ".js":
                text = p.read_text(encoding="utf-8")
                text = _rewrite_js(text, rel, ref_map)
                text = _apply_page_placeholders(text, page_map, ref_map, imp_map)
                js_rels.append(rel)
                js_texts.append(text)
                continue
            else:
                continue
            new_rel = _hash_name(rel, _sha_text(text)[:8])
            if new_rel != next_map[rel]:
                next_map[rel] = new_rel
                changed = True
        if js_rels:
            for rel, text in zip(js_rels, _minify_all(js_texts)):
                new_rel = _hash_name(rel, _sha_text(text)[:8])
                if new_rel != next_map[rel]:
                    next_map[rel] = new_rel
                    changed = True
        ref_map = next_map
        if not changed:
            break
    return ref_map


def _apply_page_manifest(text: str, page_map: dict) -> str:
    """把页面模块映射写进 index.html 的 window.__PAGES__ 占位"""
    if not page_map:
        return text
    payload = "{ " + ", ".join(f"{k}: '{v}'" for k, v in sorted(page_map.items())) + " }"
    return PAGE_PLACEHOLDER_RE.sub(payload, text, count=1)


def _apply_assets_manifest(text: str, ref_map: dict) -> str:
    """把全部资源的原始路径->带hash文件名映射写进 window.__AER_STATIC__ 占位, 供运行时动态加载"""
    if not ref_map:
        return text
    payload = "{ " + ", ".join(f"'{k}': '{v}'" for k, v in sorted(ref_map.items())) + " }"
    return ASSETS_PLACEHOLDER_RE.sub(payload, text, count=1)


def _rewrite_html(text: str, ref_map: dict) -> str:
    def sub(mm):
        ref = mm.group(2)
        if ref in ref_map:
            return f'{mm.group(1)}="/static/{ref_map[ref]}"'
        return mm.group(0)
    return _STATIC_RE.sub(sub, text)


def _minify_all(texts):
    """批量 JS 压缩, 生产默认要求 esbuild 完成变量重命名."""
    if not _MINIFY_JS:
        return list(texts)
    from utils.jsmin import minify_backend, minify_many
    output = minify_many(texts)
    if _REQUIRE_JS_MANGLE and minify_backend() != "esbuild":
        raise RuntimeError("JS minify requires esbuild; install Node/esbuild or set MINIFY_REQUIRE_MANGLE=0")
    return output


def _rewrite_js(text: str, js_rel: str, ref_map: dict) -> str:
    js_dir = posixpath.dirname(js_rel) or "."
    def sub_abs(mm):
        ref = mm.group(1)
        if ref in ref_map:
            return f'"/static/{ref_map[ref]}"'
        return mm.group(0)
    text = _JS_STATIC_RE.sub(sub_abs, text)
    def sub_rel(mm):
        u = mm.group(1)
        if u.startswith(("/", "http://", "https://", "data:", "#", "//")):
            return mm.group(0)
        target = posixpath.normpath(posixpath.join(js_dir, u))
        if target.startswith("../") or target not in ref_map:
            return mm.group(0)
        return f'"/static/{ref_map[target]}"'
    return _JS_ASSET_RE.sub(sub_rel, text)


def _rewrite_css(text: str, css_rel: str, ref_map: dict) -> str:
    css_dir = posixpath.dirname(css_rel)
    def sub(mm):
        u = mm.group(2)
        if u.startswith(("http://", "https://", "data:", "#")):
            return mm.group(0)
        target = posixpath.normpath(posixpath.join(css_dir, u))
        if target.startswith("../") or target not in ref_map:
            return mm.group(0)
        new_rel = ref_map[target]
        rel = posixpath.relpath(new_rel, css_dir)
        return f"url('{rel}')"
    return _CSS_URL_RE.sub(sub, text)


PAGE_PLACEHOLDER_RE = re.compile(r"/\*\s*@build:pages\s*\*/\s*\{[^}]*\}")
ASSETS_PLACEHOLDER_RE = re.compile(r"/\*\s*@build:assets\s*\*/\s*\{[^}]*\}")
_PLACEHOLDER_IMPORT_RE = re.compile(r"/static/js/@(app|i18n)")
_PAGE_IMPORT_RE = re.compile(r"'/static/js/pages/([A-Za-z0-9_\-]+)'")
PAGES_IMPORT_PREFIX = "/static/js/pages/"


def _page_module_map(dist: Path, ref_map: dict):
    """从已生成的 ref_map 取 dist/js/pages/*.js 的最终文件名"""
    mods = {}
    for rel, new_rel in ref_map.items():
        if rel.startswith("js/pages/") and rel.endswith(".js"):
            mods[posixpath.splitext(posixpath.basename(rel))[0]] = posixpath.basename(new_rel)
    return mods


def _apply_page_placeholders(text: str, page_map: dict, ref_map: dict, imp_map: dict) -> str:
    """回填 PAGE_MODULES 映射与 /static/js/@app|@i18n 占位 import"""
    def sub_imp(mm):
        key = mm.group(1)
        target = imp_map.get(key)
        # imp_map 存的是 dist 相对路径 (如 js/app~xxx.js), 去掉 js/ 前缀避免重复
        return f"/static/js/{target[3:]}" if target and target.startswith("js/") else (f"/static/js/{target}" if target else mm.group(0))
    text = _PLACEHOLDER_IMPORT_RE.sub(sub_imp, text)
    # 页面模块之间互相 import 的 /static/js/pages/xxx 也要换成带哈希的文件名
    if page_map:
        def sub_page(mm):
            name = mm.group(1)
            return f"'{PAGES_IMPORT_PREFIX}{page_map[name]}'" if name in page_map else mm.group(0)
        text = _PAGE_IMPORT_RE.sub(sub_page, text)
    return text


def build():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fast", action="store_true", help="不显示文件级进度条(CI/日志友好)")
    a = ap.parse_args()

    name = ROOT.name
    dist = ROOT / "dist"
    page_out = ROOT / "page"
    public_out = ROOT / "public"

    print("=" * 56)
    print(f"  {BOLD}RUNNING{RESET}  ·  {CYAN}{name}{RESET}  ({datetime.now().strftime('%Y-%m-%d %H:%M:%S')})")
    print("=" * 56)
    t0 = time.time()

    if not dist.exists():
        _err(f"No {dist}")
        sys.exit(1)
    if (dist / "api").exists():
        _err("Detected dist/api/")
        sys.exit(1)

    _step(1, 4, "Scanning dist .")
    files = sorted([p for p in dist.rglob("*") if p.is_file()])
    html_files = [p for p in files if p.suffix.lower() == ".html"]
    asset_files = [p for p in files if p.suffix.lower() != ".html"]
    _ok(len(files), " files")
    if not html_files:
        _warn("No HTML files found, pages will be empty")

    ref_map = _settle_names(dist, _ref_map(dist))
    page_map = _page_module_map(dist, ref_map)
    imp_map = {}
    for key in ("app", "i18n"):
        for rel, new_rel in ref_map.items():
            if rel == f"js/{key}.js":
                imp_map[key] = new_rel
                break
    for stem, new_name in page_map.items():
        ref_map[f"js/pages/{stem}.js"] = f"js/pages/{new_name}"
    _step(2, 4, "Building pages .")
    if page_out.exists():
        shutil.rmtree(page_out)
    page_out.mkdir(parents=True)
    for i, p in enumerate(html_files, 1):
        rel = p.relative_to(dist).as_posix()
        out = page_out / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        text = p.read_text(encoding="utf-8")
        text = _rewrite_html(text, ref_map)
        text = _apply_page_manifest(text, page_map)
        text = _apply_assets_manifest(text, ref_map)
        out.write_text(text, encoding="utf-8")
        _file_progress(i, len(html_files), f"page/{rel}", a.fast)
    _file_progress_end(a.fast)
    _ok(len(html_files), " pages")

    _step(3, 4, "Building resources .")
    if public_out.exists():
        shutil.rmtree(public_out)
    public_out.mkdir(parents=True)
    prepared = []
    for p in asset_files:
        rel = p.relative_to(dist).as_posix()
        if p.suffix.lower() != ".js":
            continue
        text = p.read_text(encoding="utf-8")
        text = _rewrite_js(text, rel, ref_map)
        text = _apply_page_placeholders(text, page_map, ref_map, imp_map)
        prepared.append((p, rel, text))
    minified = iter(_minify_all([t for _, _, t in prepared]))
    for i, p in enumerate(asset_files, 1):
        rel = p.relative_to(dist).as_posix()
        new_rel = ref_map[rel]
        out = public_out / new_rel
        out.parent.mkdir(parents=True, exist_ok=True)
        if p.suffix.lower() == ".js":
            out.write_text(next(minified), encoding="utf-8")
        elif p.suffix.lower() == ".css":
            text = p.read_text(encoding="utf-8")
            text = _rewrite_css(text, rel, ref_map)
            out.write_text(text, encoding="utf-8")
        else:
            shutil.copy2(p, out)
        _file_progress(i, len(asset_files), f"public/{new_rel}", a.fast)
    _file_progress_end(a.fast)
    _ok(len(asset_files), " resources")

    _step(4, 4, "Building manifest .")
    manifest = {
        "project": name,
        "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "files": {},
    }
    for p in html_files:
        rel = p.relative_to(dist).as_posix()
        manifest["files"][f"page/{rel}"] = _sha(page_out / rel)
    for p in asset_files:
        rel = p.relative_to(dist).as_posix()
        manifest["files"][f"public/{ref_map[rel]}"] = _sha(public_out / ref_map[rel])
    (ROOT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    _ok(1, " manifest")

    dt = time.time() - t0
    print()
    print(f"  {GREEN}BUILD SUCCESS{RESET}  {{{len(html_files)} pages  {len(asset_files)} resources | {dt:.2f}s}}{RESET}")
    return 0


if __name__ == "__main__":
    sys.exit(build())
