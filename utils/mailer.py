import asyncio
import hashlib
import hmac
import time
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr

import config as cfg
from utils import db
from utils.log import a

MAX_CODE_ATTEMPTS = 5

_CODE_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#000;font-family:'MiSans','微软雅黑',system-ui,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#000">
<tr><td align="center" style="padding:40px 20px">
<table width="460" cellpadding="0" cellspacing="0" style="background:#121212;border:1px solid rgba(255,255,255,.1);border-radius:16px;overflow:hidden">
<tr><td style="padding:28px 32px 0">
<div style="font-size:20px;font-weight:700;color:#fff;letter-spacing:1px">AerMusic</div>
<div style="font-size:13px;color:#24c8fa;margin-top:4px">邮箱验证码</div>
</td></tr>
<tr><td style="padding:20px 32px">
<div style="height:1px;background:rgba(255,255,255,.1);margin-bottom:20px"></div>
<p style="font-size:14px;color:#b3b3b3;line-height:1.8;margin:0">
你正在进行<strong style="color:#24c8fa">邮箱验证</strong>操作, 这是你的验证码:
</p>
<div style="text-align:center;margin:24px 0">
<span style="display:inline-block;font-size:36px;letter-spacing:10px;font-weight:700;color:#24c8fa;background:rgba(36,200,250,.08);border:1px solid rgba(36,200,250,.3);border-radius:12px;padding:16px 28px">{{CODE}}</span>
</div>
<p style="font-size:12px;color:#808080;line-height:1.7;margin:0">
验证码 {{TTL_MINUTES}} 分钟内有效, 请勿泄露给他人.<br>
如果这不是你本人的操作, 请忽略此邮件.
</p>
</td></tr>
<tr><td style="padding:0 32px 20px">
<div style="height:1px;background:rgba(255,255,255,.1);margin-bottom:16px"></div>
<p style="font-size:11px;color:#666666;margin:0">
AerMusic — 此邮件由系统自动发送, 请勿回复
</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>"""


def _code_hash(code: str) -> str:
    return hashlib.sha256(str(code).encode("utf-8")).hexdigest()


def save_code(email: str, purpose: str, code: str, ttl: int) -> None:
    now = int(time.time())
    digest = _code_hash(code)
    db.run(
        "INSERT INTO verify_codes(email, purpose, code_hash, attempts, expiresat, createdat) VALUES(?,?,?,?,?,?) "
        "ON CONFLICT(email, purpose) DO UPDATE SET code_hash=?, attempts=0, expiresat=?, createdat=?",
        (email, purpose, digest, 0, now + ttl, now, digest, now + ttl, now),
    )


def drop_code(email: str, purpose: str) -> None:
    db.run("DELETE FROM verify_codes WHERE email = ? AND purpose = ?", (email, purpose))


def check_code(email: str, purpose: str, code: str) -> tuple:
    now = int(time.time())
    row = db.get("SELECT code_hash, attempts, expiresat FROM verify_codes WHERE email = ? AND purpose = ?", (email, purpose))
    if not row or row["expiresat"] <= now or row["attempts"] >= MAX_CODE_ATTEMPTS:
        if row:
            drop_code(email, purpose)
        return False, "验证码错误或已过期"
    if hmac.compare_digest(row["code_hash"], _code_hash(code)):
        drop_code(email, purpose)
        return True, ""
    attempts = int(row["attempts"]) + 1
    if attempts >= MAX_CODE_ATTEMPTS:
        drop_code(email, purpose)
        return False, "验证码已作废, 请重新获取"
    db.run("UPDATE verify_codes SET attempts = ? WHERE email = ? AND purpose = ?", (attempts, email, purpose))
    return False, "验证码错误或已过期"


def _render_html(code: str) -> str:
    return (_CODE_TEMPLATE
            .replace("{{CODE}}", str(code))
            .replace("{{TTL_MINUTES}}", str(max(1, cfg.SMTP_CODE_TTL // 60))))


def _send_sync(to_email: str, code: str) -> None:
    sender = cfg.SMTP_FROM or cfg.SMTP_USER
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "AerMusic 邮箱验证码"
    msg["From"] = formataddr((cfg.APP_NAME, sender))
    msg["To"] = to_email
    msg.attach(MIMEText(_render_html(code), "html", "utf-8"))
    if cfg.SMTP_USE_SSL:
        srv = smtplib.SMTP_SSL(cfg.SMTP_HOST, cfg.SMTP_PORT, timeout=15)
    else:
        srv = smtplib.SMTP(cfg.SMTP_HOST, cfg.SMTP_PORT, timeout=15)
        srv.starttls()
    try:
        srv.login(cfg.SMTP_USER, cfg.SMTP_PASS)
        srv.sendmail(sender, [to_email], msg.as_string())
    finally:
        try:
            srv.quit()
        except Exception:
            pass


async def send_code_email(email: str, code: str) -> tuple:
    if not cfg.SMTP_HOST:
        if cfg.SMTP_DEV_LOG_CODE:
            a(f"mail code: {code} to={email} (SMTP 未配置, 仅开发环境)", "WARN")
            return True, ""
        a("mail code send failed: SMTP 未配置", "ERROR")
        return False, "邮件服务未配置, 请联系管理员"
    try:
        await asyncio.to_thread(_send_sync, email, code)
        a(f"mail code sent: to={email}")
        return True, ""
    except Exception as error:
        a(f"mail code send failed: to={email} err={type(error).__name__}: {error}", "ERROR")
        return False, "邮件发送失败, 请稍后重试或联系管理员"
