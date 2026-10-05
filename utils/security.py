import hashlib
import hmac
import secrets

_ITER = 200_000


def hashPass(password: str, salt: str = None) -> tuple:
    if salt is None:
        salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), _ITER)
    return dk.hex(), salt


def checkPass(password: str, dk_hex: str, salt: str) -> bool:
    try:
        dk, _ = hashPass(password, salt)
        return hmac.compare_digest(dk, dk_hex)
    except ValueError:
        return False


def newToken() -> str:
    return secrets.token_urlsafe(32)


def tokenKey(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
