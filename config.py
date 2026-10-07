import os
import time

APP_NAME = os.environ.get("APP_NAME", "AerMusic")
# 部署版本号, 仅用于 about 页/健康检查展示, 默认取启动时间戳(防缓存由构建产物 hash 负责)
APP_VERSION = os.environ.get("APP_VERSION") or str(int(time.time()))
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "5008"))

# sqlite 库文件位置, 相对项目根目录
DATABASE_PATH = os.environ.get("DATABASE_PATH", os.path.join("data", "aermusic.db"))

# 登录会话
SESSION_TTL_SECONDS = int(os.environ.get("SESSION_TTL_SECONDS", "2592000"))
SESSION_COOKIE_SECURE = os.environ.get("SESSION_COOKIE_SECURE", "True").lower() == "true"

# 网易云上游, key 从 .env 读, 不再写死在代码里
NETEASE_API_BASE = os.environ.get("NETEASE_API_BASE", "http://localhost:3000").rstrip("/")
NETEASE_LYRIC_BASE = os.environ.get("NETEASE_LYRIC_BASE", "http://localhost:5000/tr/lyric").rstrip("/")
NETEASE_URL_API = os.environ.get("NETEASE_URL_API", "http://localhost:5000/geturl").rstrip("/")
NETEASE_URL_KEY = os.environ.get("NETEASE_URL_KEY", "")

UPSTREAM_TIMEOUT = float(os.environ.get("UPSTREAM_TIMEOUT", "10"))
UPSTREAM_RETRIES = int(os.environ.get("UPSTREAM_RETRIES", "2"))

# 可选 Redis/Garnet, 用于多进程共享推荐事件限流, 不配置时使用进程内限流
REDIS_ADDRESS = os.environ.get("REDIS_ADDRESS", "").strip()
REDIS_USERNAME = os.environ.get("REDIS_USERNAME", "").strip()
REDIS_PASSWORD = os.environ.get("REDIS_PASSWORD", "").strip()
REDIS_DB = int(os.environ.get("REDIS_DB", "0"))
REDIS_TIMEOUT = max(0.05, float(os.environ.get("REDIS_TIMEOUT", "0.3")))
REDIS_RETRY_SECONDS = max(1.0, float(os.environ.get("REDIS_RETRY_SECONDS", "30")))
REDIS_RATE_PREFIX = os.environ.get("REDIS_RATE_PREFIX", "aermusic:recommend:rate:").strip() or "aermusic:recommend:rate:"

# 缓存秒数, 按接口名覆盖, 如 CACHE_URL=600
CACHE_DEFAULT = int(os.environ.get("CACHE_DEFAULT", "300"))
CACHE_MAX_ENTRIES = int(os.environ.get("CACHE_MAX_ENTRIES", "800"))

# 上游单页最大条数, 防止 limit=999999 这类参数打到上游
MAX_LIMIT = int(os.environ.get("MAX_LIMIT", "100"))

# 可信反代(用于真实IP), 直连部署别开 XFF
TRUSTED_PROXIES = [o.strip() for o in os.environ.get("TRUSTED_PROXIES", "127.0.0.1,::1").split(",") if o.strip()]

# 允许的跨域来源, 逗号分隔, 留空则同源
CORS_ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()]

# 封面代理白名单域名(取色用, 图片跨域无CORS头时前端取不到像素)
COVER_ALLOW_HOSTS = [o.strip() for o in os.environ.get(
    "COVER_ALLOW_HOSTS",
    "p1.music.126.net,p2.music.126.net,p3.music.126.net,p4.music.126.net,p5.music.126.net,p6.music.126.net,y.music.126.net",
).split(",") if o.strip()]
