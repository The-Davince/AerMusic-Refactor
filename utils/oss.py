"""头像 OSS 上传: 用 CCW 账号换阿里云 OSS 的 STS 临时凭证后直传 (照抄 D:/github/team.mcyyt.cn/utils/upload.py)

凭证链路: CCW token -> POST community-web.ccw.site/ccw-main/status 取密文 -> AES-CBC 解密出 AK/SK/STS
签名: OSS 签名 V1 (HMAC-SHA1), 只有 x-oss-* 与 Content-MD5/Content-Type/Date 参与规范化
"""
import base64
import hashlib
import hmac
import json
import time
import uuid
from email.utils import formatdate
from urllib.parse import quote, unquote, urlparse

import httpx
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

import config as cfg
from utils.log import a

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
_CREDS_URL = "https://community-web.ccw.site/ccw-main/status"
_CREDS_TTL_SECONDS = 3600
_MAX_BYTES = 2 * 1024 * 1024

_creds = None
_creds_expiry = 0.0


def enabled():
    return bool(cfg.CCW_OSS_TOKEN and cfg.CCW_OSS_USER_ID)


def _headers():
    return {"User-Agent": _UA}


def _decrypt(enc_data):
    user_id = cfg.CCW_OSS_USER_ID
    key = user_id[-16:].encode("utf-8")
    iv = user_id[:16].encode("utf-8")
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv))
    decryptor = cipher.decryptor()
    raw = decryptor.update(base64.b64decode(enc_data)) + decryptor.finalize()
    if not raw:
        raise ValueError("凭证解密结果为空")
    raw = raw[:-raw[-1]]
    creds = json.loads(raw.decode("utf-8"))
    for field in ("accessKeyId", "accessKeySecret", "securityToken"):
        if field not in creds:
            raise ValueError(f"解密后缺少字段: {field}")
    return creds


async def _get_credentials(force=False):
    global _creds, _creds_expiry
    if not force and _creds and time.monotonic() < _creds_expiry:
        return _creds
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(_CREDS_URL, headers=dict(_headers(), Cookie=f"token={cfg.CCW_OSS_TOKEN}"))
    resp.raise_for_status()
    body = resp.json() or {}
    enc = (body.get("body") or {}).get("data")
    if not enc:
        raise ValueError("获取 OSS Token 失败")
    _creds = _decrypt(enc)
    _creds_expiry = time.monotonic() + _CREDS_TTL_SECONDS
    return _creds


def _sign(method, resource, creds, headers):
    oss_headers = sorted((k.lower(), v) for k, v in headers.items() if k.lower().startswith("x-oss-"))
    canonical = "".join(f"{k}:{v}\n" for k, v in oss_headers)
    to_sign = (f"{method}\n{headers.get('Content-MD5', '')}\n{headers.get('Content-Type', '')}\n"
               f"{headers.get('Date', '')}\n{canonical}{resource}")
    digest = hmac.new(creds["accessKeySecret"].encode(), to_sign.encode(), hashlib.sha1).digest()
    return f"OSS {creds['accessKeyId']}:{base64.b64encode(digest).decode()}"


def _genKey(ext):
    return f"{cfg.CCW_OSS_PREFIX}/{uuid.uuid4().hex}{ext}"


async def _put(key, body, content_type, creds):
    resource = f"/{cfg.CCW_OSS_BUCKET}/{key}"
    headers = {
        "Content-Type": content_type,
        "Content-MD5": base64.b64encode(hashlib.md5(body).digest()).decode(),
        "Content-Length": str(len(body)),
        "x-oss-security-token": creds["securityToken"],
        "Date": formatdate(timeval=None, localtime=False, usegmt=True),
    }
    headers["Authorization"] = _sign("PUT", resource, creds, headers)
    url = f"https://{cfg.CCW_OSS_BUCKET}.{cfg.CCW_OSS_ENDPOINT}/{quote(key)}"
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.put(url, content=body, headers=headers)
    if resp.status_code != 200:
        raise RuntimeError(f"上传失败: {resp.status_code} {resp.text[:200]}")


async def uploadBytes(body, ext, content_type):
    """上传一段字节, 返回可直链的 CDN URL; 未配置凭证时返回 None 由调用方回退本地存储"""
    if not enabled():
        return None
    if not body or len(body) > _MAX_BYTES:
        raise ValueError("文件大小不合法")
    key = _genKey(ext)
    creds = await _get_credentials()
    try:
        await _put(key, body, content_type, creds)
    except Exception:
        creds = await _get_credentials(force=True)
        await _put(key, body, content_type, creds)
    return f"https://{cfg.CCW_OSS_CDN}/{key}"


def _extractKey(url_or_key):
    text = str(url_or_key or "").strip()
    if not text.startswith("http"):
        return text.strip("/")
    return unquote(urlparse(text).path.lstrip("/"))


async def deleteByUrl(url_or_key):
    """删除历史头像, 尽力而为: 失败只记日志不影响业务流程"""
    if not enabled():
        return False
    try:
        key = _extractKey(url_or_key)
        if not key or not key.startswith(cfg.CCW_OSS_PREFIX + "/"):
            return False
        creds = await _get_credentials()
        resource = f"/{cfg.CCW_OSS_BUCKET}/{key}"
        headers = {"x-oss-security-token": creds["securityToken"],
                   "Date": formatdate(timeval=None, localtime=False, usegmt=True)}
        headers["Authorization"] = _sign("DELETE", resource, creds, headers)
        url = f"https://{cfg.CCW_OSS_BUCKET}.{cfg.CCW_OSS_ENDPOINT}/{quote(key)}"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.delete(url, headers=headers)
        return resp.status_code == 204
    except Exception as error:
        a(f"oss delete failed: {type(error).__name__}: {error}", "WARN")
        return False
