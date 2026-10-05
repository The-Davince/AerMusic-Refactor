import re

USERNAME_RE = re.compile(r"^[A-Za-z0-9_\u4e00-\u9fa5]{2,20}\Z")


def checkUsername(name: str) -> bool:
    return bool(name) and bool(USERNAME_RE.match(name)) and not name.startswith(" ")


def checkPassword(pw: str) -> bool:
    return isinstance(pw, str) and 6 <= len(pw) <= 64


def clipStr(val, limit: int) -> str:
    if not isinstance(val, str):
        return ""
    return val.strip()[:limit]
