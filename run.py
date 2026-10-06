#!/usr/bin/env python3
import os
import sys
import logging

import uvicorn
from dotenv import load_dotenv

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(line_buffering=True)

_PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_PROJECT_DIR, ".env"))
os.chdir(_PROJECT_DIR)
sys.path.insert(0, _PROJECT_DIR)

from utils.log import a as _ulog_a, stop as _ulog_stop


class _ULogHandler(logging.Handler):
    def emit(self, record):
        try:
            _ulog_a(self.format(record), record.levelname)
        except Exception:
            pass


def _route_uvicorn_logs():
    _h = _ULogHandler()
    _h.setFormatter(logging.Formatter("%(message)s"))
    for _name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        _lg = logging.getLogger(_name)
        _lg.handlers = [_h]
        _lg.propagate = False
        _lg.setLevel(logging.INFO)


def _stage(n, total, title):
    print("=" * 46, flush=True)
    print(f"  [阶段 {n}/{total}] {title}", flush=True)
    print("=" * 46, flush=True)


def run_build():
    _stage(1, 4, "构建前端资源 (build.py)")
    build_py = os.path.join(_PROJECT_DIR, "build.py")
    if not os.path.exists(build_py):
        print("  SKIP 未找到 build.py, 跳过前端构建")
        return
    r = subprocess.run([sys.executable, build_py, "--fast"], cwd=_PROJECT_DIR)
    if r.returncode != 0:
        print("ERROR: 前端构建失败, 中止启动", file=sys.stderr)
        sys.exit(1)


def main():
    import config as cfg

    print(f"{cfg.APP_NAME} 服务启动流程", flush=True)
    run_build()

    _stage(2, 4, "检查环境配置")
    if not cfg.NETEASE_URL_KEY:
        print("  WARN NETEASE_URL_KEY 未配置, 歌曲播放地址接口将不可用", file=sys.stderr)
    print(f"  OK  监听 {cfg.HOST}:{cfg.PORT}  数据库 {cfg.DATABASE_PATH}")

    _stage(3, 4, "初始化数据库表结构 (setup.py)")
    from setup import main as setup_main
    setup_main()
    print("  OK  数据库初始化完成")

    _stage(4, 4, "启动 HTTP 服务")
    print(f"  uvicorn app.main:app  host={cfg.HOST}  port={cfg.PORT}")
    _route_uvicorn_logs()
    uvicorn.run(
        "app.main:app",
        host=cfg.HOST,
        port=cfg.PORT,
        log_config=None,
        access_log=False,
        proxy_headers=True,
        forwarded_allow_ips=",".join(cfg.TRUSTED_PROXIES) or "127.0.0.1",
        timeout_graceful_shutdown=5,
    )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    finally:
        try:
            _ulog_stop()
        except Exception:
            pass
