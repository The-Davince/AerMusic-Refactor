from html import escape

SCOPE_INFO = {
    "openid": ("账号身份", "获取你的 AerMusic 账号唯一标识"),
    "profile": ("基本资料", "读取昵称、头像和个人简介"),
}
SCOPE_ICONS = {
    "openid": '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c1.3-3 3.7-4.5 7-4.5s5.7 1.5 7 4.5"/>',
    "profile": '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8.5" cy="11" r="2"/><path d="M5.6 16.3c.8-1.4 1.8-2 2.9-2s2.1.6 2.9 2M14 10h4M14 13.5h3"/>',
}
SCOPE_ICON_FALLBACK = SCOPE_ICONS["openid"]

_PAGE_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
 background:#000;color:#fff;font-family:'MiSans','PingFang SC','Microsoft YaHei',system-ui,sans-serif}
.card{width:100%;max-width:420px;background:#121212;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:28px 28px 24px}
.brand{font-size:20px;font-weight:700;letter-spacing:1px}
.brand small{display:block;font-size:13px;font-weight:400;color:#24c8fa;margin-top:4px;letter-spacing:0}
.divider{height:1px;background:rgba(255,255,255,.1);margin:18px 0}
.app{font-size:16px;font-weight:600}
.app-desc{font-size:13px;color:#b3b3b3;line-height:1.7;margin-top:8px}
.scopes{list-style:none;margin:18px 0 4px}
.scopes li{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid rgba(255,255,255,.08);border-radius:12px;margin-bottom:8px;background:rgba(255,255,255,.03)}
.scopes svg{width:20px;height:20px;flex:none;color:#24c8fa}
.scopes b{display:block;font-size:14px;font-weight:600}
.scopes span{display:block;font-size:12px;color:#b3b3b3;margin-top:2px;line-height:1.5}
.account{display:flex;align-items:center;gap:10px;font-size:13px;color:#b3b3b3;margin-top:16px}
.account b{color:#fff;font-weight:600;font-size:14px}
.field{margin-top:14px}
.field label{display:block;font-size:12px;color:#b3b3b3;margin-bottom:6px}
.field input{width:100%;height:42px;padding:0 14px;font-size:14px;color:#fff;background:rgba(255,255,255,.06);
 border:1px solid rgba(255,255,255,.12);border-radius:12px;outline:none}
.field input:focus{border-color:#24c8fa}
.actions{display:flex;gap:10px;margin-top:20px}
.btn{flex:1;height:42px;border:none;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer}
.btn-primary{background:#24c8fa;color:#00222f}
.btn-primary:hover{background:#4dd3fb}
.btn-ghost{background:rgba(255,255,255,.08);color:#fff}
.btn-ghost:hover{background:rgba(255,255,255,.14)}
.error{font-size:13px;color:#ff453a;background:rgba(255,69,58,.1);border:1px solid rgba(255,69,58,.3);
 border-radius:10px;padding:10px 12px;margin-top:16px;line-height:1.6}
.foot{font-size:11px;color:#666;margin-top:18px;line-height:1.6;text-align:center}
"""


def _scope_rows(scopes) -> str:
    rows = []
    for scope in sorted(set(scopes)):
        title, desc = SCOPE_INFO.get(scope, (scope, "读取该应用请求的授权信息"))
        icon = SCOPE_ICONS.get(scope, SCOPE_ICON_FALLBACK)
        rows.append(
            '<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{icon}</svg>'
            f'<div><b>{escape(title)}</b><span>{escape(desc)}</span></div></li>'
        )
    return "".join(rows)


def _error_block(message: str) -> str:
    if not message:
        return ""
    return f'<div class="error">{escape(message)}</div>'


def _shell(title: str, body: str) -> str:
    return (
        '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta name="referrer" content="same-origin">'
        f'<title>{escape(title)} - AerMusic</title><style>{_PAGE_CSS}</style></head>'
        f'<body><div class="card">{body}</div></body></html>'
    )


def render_consent(ticket: str, csrf_token: str, client_name: str, scopes, account_name: str, error: str = "") -> str:
    """consent 页, account_name 为空时内嵌登录表单"""
    if account_name:
        account = (f'<div class="account">当前账号 <b>{escape(account_name)}</b></div>'
                   '<form method="post" action="/api/oidc/consent/decision">'
                   f'<input type="hidden" name="ticket" value="{escape(ticket, quote=True)}">'
                   f'<input type="hidden" name="csrf_token" value="{escape(csrf_token, quote=True)}">'
                   '<div class="actions">'
                   '<button class="btn btn-ghost" type="submit" name="decision" value="deny">拒绝</button>'
                   '<button class="btn btn-primary" type="submit" name="decision" value="approve">允许</button>'
                   '</div></form>')
    else:
        account = (
            f'<form method="post" action="/api/oidc/login">'
            f'<input type="hidden" name="ticket" value="{escape(ticket, quote=True)}">'
            f'<input type="hidden" name="csrf_token" value="{escape(csrf_token, quote=True)}">'
            '<div class="field"><label for="username">用户名</label>'
            '<input id="username" name="username" maxlength="64" autocomplete="username" required></div>'
            '<div class="field"><label for="password">密码</label>'
            '<input id="password" name="password" type="password" maxlength="128" autocomplete="current-password" required></div>'
            '<div class="actions"><button class="btn btn-primary" type="submit">登录并继续</button></div>'
            '</form>')
    body = (
        '<div class="brand">AerMusic<small>账号授权</small></div>'
        '<div class="divider"></div>'
        f'<div class="app">{escape(client_name)}</div>'
        '<div class="app-desc">请求访问你的 AerMusic 账号, 同意后将获得以下权限</div>'
        f'<ul class="scopes">{_scope_rows(scopes)}</ul>'
        f'{_error_block(error)}'
        f'{account}'
        '<div class="foot">授权后该应用只能读取上述信息, 不会获得你的密码</div>'
    )
    return _shell("授权确认", body)


def render_error(message: str) -> str:
    body = ('<div class="brand">AerMusic<small>账号授权</small></div>'
            '<div class="divider"></div>'
            f'<div class="app-desc">{escape(message)}</div>')
    return _shell("授权请求无效", body)
