import json
import os
import time

APP_NAME = os.environ.get("APP_NAME", "AerMusic")

APP_VERSION = os.environ.get("APP_VERSION") or str(int(time.time()))
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "5008"))


DATABASE_PATH = os.environ.get("DATABASE_PATH", os.path.join("data", "aermusic.db"))


DB_BACKEND = os.environ.get("DB_BACKEND", "auto").strip().lower() or "auto"

PGSQL_URL = os.environ.get("PGSQL_URL", "").strip()
PGSQL_USERNAME = os.environ.get("PGSQL_USERNAME", "").strip()
PGSQL_PASSWORD = os.environ.get("PGSQL_PASSWORD", "").strip()

PGSQL_DATABASE = os.environ.get("PGSQL_DATABASE", "").strip()
PGSQL_POOL_MIN = max(1, int(os.environ.get("PGSQL_POOL_MIN", "2")))
PGSQL_POOL_MAX = max(PGSQL_POOL_MIN, int(os.environ.get("PGSQL_POOL_MAX", "16")))
PGSQL_CONNECT_TIMEOUT = max(1, int(os.environ.get("PGSQL_CONNECT_TIMEOUT", "5")))


SESSION_TTL_SECONDS = int(os.environ.get("SESSION_TTL_SECONDS", "2592000"))
SESSION_COOKIE_SECURE = os.environ.get("SESSION_COOKIE_SECURE", "True").lower() == "true"


NETEASE_API_BASE = os.environ.get("NETEASE_API_BASE", "http://localhost:3000").rstrip("/")
NETEASE_LYRIC_BASE = os.environ.get("NETEASE_LYRIC_BASE", "http://localhost:5000/tr/lyric").rstrip("/")
NETEASE_URL_API = os.environ.get("NETEASE_URL_API", "http://localhost:5000/geturl").rstrip("/")
NETEASE_URL_KEY = os.environ.get("NETEASE_URL_KEY", "")

UPSTREAM_TIMEOUT = float(os.environ.get("UPSTREAM_TIMEOUT", "10"))
UPSTREAM_RETRIES = int(os.environ.get("UPSTREAM_RETRIES", "2"))
UPSTREAM_MAX_CONNECTIONS = int(os.environ.get("UPSTREAM_MAX_CONNECTIONS", "300"))
UPSTREAM_MAX_KEEPALIVE = int(os.environ.get("UPSTREAM_MAX_KEEPALIVE", "100"))

# 上游与本站同机/内网时前端改走 /api/up 代理, 这个是代理端点进程内缓存的秒数(0=不缓存)
UP_PROXY_TTL = max(0, int(os.environ.get("UP_PROXY_TTL", "120")))

# true 时前端取推荐直接走 /api/recommend/get(后端结合画像实时算), 不再走前端推荐逻辑
INTERNAL_RECOMMEND = os.environ.get("INTERNAL_RECOMMEND", "false").strip().lower() == "true"

TO_THREAD_WORKERS = int(os.environ.get("TO_THREAD_WORKERS", "64"))


REDIS_ADDRESS = os.environ.get("REDIS_ADDRESS", "").strip()
REDIS_USERNAME = os.environ.get("REDIS_USERNAME", "").strip()
REDIS_PASSWORD = os.environ.get("REDIS_PASSWORD", "").strip()
REDIS_DB = int(os.environ.get("REDIS_DB", "0"))
REDIS_TIMEOUT = max(0.05, float(os.environ.get("REDIS_TIMEOUT", "0.3")))
REDIS_RETRY_SECONDS = max(1.0, float(os.environ.get("REDIS_RETRY_SECONDS", "30")))
REDIS_RATE_PREFIX = os.environ.get("REDIS_RATE_PREFIX", "aermusic:recommend:rate:").strip() or "aermusic:recommend:rate:"


CACHE_DEFAULT = int(os.environ.get("CACHE_DEFAULT", "300"))
CACHE_MAX_ENTRIES = int(os.environ.get("CACHE_MAX_ENTRIES", "500"))


MAX_LIMIT = int(os.environ.get("MAX_LIMIT", "100"))


TRUSTED_PROXIES = [o.strip() for o in os.environ.get("TRUSTED_PROXIES", "127.0.0.1,::1").split(",") if o.strip()]


CORS_ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()]


COVER_ALLOW_HOSTS = [o.strip() for o in os.environ.get(
    "COVER_ALLOW_HOSTS",
    "p1.music.126.net,p2.music.126.net,p3.music.126.net,p4.music.126.net,p5.music.126.net,p6.music.126.net,y.music.126.net",
).split(",") if o.strip()]


CCW_OSS_TOKEN = os.environ.get("CCW_OSS_TOKEN", "").strip()
CCW_OSS_USER_ID = os.environ.get("CCW_OSS_USER_ID", "").strip()
CCW_OSS_BUCKET = os.environ.get("CCW_OSS_BUCKET", "zhishi").strip() or "zhishi"
CCW_OSS_ENDPOINT = os.environ.get("CCW_OSS_ENDPOINT", "oss-cn-beijing.aliyuncs.com").strip() or "oss-cn-beijing.aliyuncs.com"
CCW_OSS_CDN = os.environ.get("CCW_OSS_CDN", "m.ccw.site").strip() or "m.ccw.site"
CCW_OSS_PREFIX = os.environ.get("CCW_OSS_PREFIX", "aermusic/avatar").strip().strip("/") or "aermusic/avatar"


SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
SMTP_PORT = int(os.environ.get("SMTP_PORT", "465"))
SMTP_USER = os.environ.get("SMTP_USER", "").strip()
SMTP_PASS = os.environ.get("SMTP_PASS", "")
SMTP_FROM = os.environ.get("SMTP_FROM", "").strip()
SMTP_USE_SSL = os.environ.get("SMTP_USE_SSL", "True").lower() == "true"
SMTP_CODE_TTL = max(60, int(os.environ.get("SMTP_CODE_TTL", "300")))
EMAIL_SEND_COOLDOWN = max(10, int(os.environ.get("EMAIL_SEND_COOLDOWN", "90")))


OIDC_ENABLED = os.environ.get("OIDC_ENABLED", "True").lower() == "true"

OIDC_ISSUER = os.environ.get("OIDC_ISSUER", "").strip().rstrip("/") or (
    CORS_ALLOWED_ORIGINS[0] if CORS_ALLOWED_ORIGINS else f"http://{HOST}:{PORT}")
OIDC_KEY_DIR = os.environ.get("OIDC_KEY_DIR", "").strip() or os.path.join("data", "oidc_keys")
OIDC_KID = os.environ.get("OIDC_KID", "").strip() or "oidc_1"
OIDC_CODE_TTL_SECONDS = max(30, int(os.environ.get("OIDC_CODE_TTL_SECONDS", "120")))
OIDC_ACCESS_TTL_SECONDS = max(60, int(os.environ.get("OIDC_ACCESS_TTL_SECONDS", "1800")))
OIDC_ID_TTL_SECONDS = max(60, int(os.environ.get("OIDC_ID_TTL_SECONDS", "1800")))
OIDC_REFRESH_TTL_SECONDS = max(300, int(os.environ.get("OIDC_REFRESH_TTL_SECONDS", "2592000")))
OIDC_CONSENT_TTL_SECONDS = max(60, int(os.environ.get("OIDC_CONSENT_TTL_SECONDS", "600")))
try:
    _oidc_clients = json.loads(os.environ.get("OIDC_CLIENTS", "") or "{}")
except Exception:
    _oidc_clients = {}
OIDC_CLIENTS = _oidc_clients if isinstance(_oidc_clients, dict) else {}
