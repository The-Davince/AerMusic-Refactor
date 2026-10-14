import re

USERNAME_RE = re.compile(r"^[A-Za-z0-9_\u4e00-\u9fa5]{2,20}\Z")
NICKNAME_RE = re.compile(r"^[A-Za-z0-9_\-\u4e00-\u9fa5]{1,20}\Z")
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\Z")
PASSWORD_LETTER_RE = re.compile(r"[A-Za-z]")
PASSWORD_DIGIT_RE = re.compile(r"[0-9]")


def checkUsername(name: str) -> bool:
    return bool(name) and bool(USERNAME_RE.match(name)) and not name.startswith(" ")


def checkPassword(pw: str) -> bool:
    return isinstance(pw, str) and 6 <= len(pw) <= 64


def checkRegPassword(pw: str) -> bool:
    if not isinstance(pw, str) or not 8 <= len(pw) <= 64:
        return False
    return bool(PASSWORD_LETTER_RE.search(pw)) and bool(PASSWORD_DIGIT_RE.search(pw))


def checkNickname(name: str) -> bool:
    return isinstance(name, str) and bool(NICKNAME_RE.match(name))


def checkEmail(email: str) -> bool:
    return isinstance(email, str) and 3 <= len(email) <= 254 and bool(EMAIL_RE.match(email))


def clipStr(val, limit: int) -> str:
    if not isinstance(val, str):
        return ""
    return val.strip()[:limit]
