import base64
import json
import os
import time
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

import config as cfg
from utils.log import a

_private_key: Ed25519PrivateKey = None
_public_keys: dict = {}


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _b64url_decode(text: str) -> bytes:
    text = text.replace("-", "+").replace("_", "/")
    pad = 4 - len(text) % 4
    if pad != 4:
        text += "=" * pad
    return base64.b64decode(text)


def _key_path(kid: str) -> Path:
    return Path(cfg.OIDC_KEY_DIR) / f"{kid}.pem"


def init_jwt_keys(kid: str = None) -> None:
    """启动时初始化 Ed25519 密钥, PEM 存 OIDC_KEY_DIR, 存在则复用"""
    global _private_key
    kid = kid or cfg.OIDC_KID
    path = _key_path(kid)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        key = serialization.load_pem_private_key(path.read_bytes(), password=None)
    else:
        key = Ed25519PrivateKey.generate()
        path.write_bytes(key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ))
        try:
            os.chmod(str(path), 0o600)
        except Exception:
            pass
    _private_key = key
    _public_keys[kid] = key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    a(f"oidc keys init: kid={kid} path={path}")


def get_jwks() -> dict:
    return {"keys": [{
        "kty": "OKP",
        "kid": kid,
        "crv": "Ed25519",
        "x": _b64url_encode(x),
        "use": "sig",
        "alg": "EdDSA",
    } for kid, x in _public_keys.items()]}


def sign_jwt(payload: dict) -> str:
    if _private_key is None:
        init_jwt_keys()
    header = {"alg": "EdDSA", "kid": cfg.OIDC_KID, "typ": "JWT"}
    h = _b64url_encode(json.dumps(header, separators=(",", ":"), ensure_ascii=False).encode())
    p = _b64url_encode(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode())
    sig = _private_key.sign(f"{h}.{p}".encode())
    return f"{h}.{p}.{_b64url_encode(sig)}"


def verify_jwt(token: str, expected_aud: list = None) -> dict:
    """验签 + iss/exp 校验, expected_aud 传 None 时跳过 aud 检查(由调用方再查 client_id)"""
    try:
        parts = str(token).split(".")
        if len(parts) != 3:
            return None
        h_b64, p_b64, s_b64 = parts
        header = json.loads(_b64url_decode(h_b64))
        payload = json.loads(_b64url_decode(p_b64))
        if not isinstance(header, dict) or not isinstance(payload, dict):
            return None
        if header.get("alg") != "EdDSA":
            return None
        x = _public_keys.get(header.get("kid"))
        if not x:
            return None
        try:
            Ed25519PublicKey.from_public_bytes(x).verify(_b64url_decode(s_b64), f"{h_b64}.{p_b64}".encode())
        except Exception:
            return None
        if payload.get("iss") != cfg.OIDC_ISSUER:
            return None
        if int(payload.get("exp") or 0) < int(time.time()):
            return None
        if expected_aud is not None:
            aud = payload.get("aud", [])
            if isinstance(aud, str):
                aud = [aud]
            if not any(item in expected_aud for item in aud):
                return None
        return payload
    except Exception as error:
        a(f"jwt verify err: {type(error).__name__}: {error}", "WARN")
        return None
