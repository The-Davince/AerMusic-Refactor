




(function () {
    const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
    const FILE_LIMIT = 1024 * 1024;
    
    const CROP_VIEW = 260;
    const CROP_HOLE = 260;
    const OUT_SIZE = 512;
    const CODE_LEN = 6;
    const CODE_COOLDOWN = 60;
    const BIO_LIMIT = 1000;
    const NAME_LIMIT = 20;

    const state = {
        booted: false,
        userKey: null,
        codeTimer: 0,
        codeLeft: 0,
        crop: null
    };

    const app = () => window.app;
    const cloud = () => window.AerMusicCloud;
    const toast = (msg) => {
        const a = app();
        if (a && a.showToast) a.showToast(msg);
    };
    const esc = (v) => {
        const a = app();
        if (a && a.escapeHtml) return a.escapeHtml(v);
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    };

    const ICON_USER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    const ICON_CAMERA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';
    const ICON_EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    const ICON_EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
    const ICON_ZOOM_OUT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>';
    const ICON_ZOOM_IN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="11" y1="8" x2="11" y2="14"/></svg>';

    const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
    const passStrong = (v) => v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v);

    const safeAvatar = (v) => {
        const s = String(v == null ? '' : v).trim();
        if (/^\/[^/\\]/.test(s) || /^https?:\/\//i.test(s)) return s;
        return '';
    };

    function renderAvatar(el, avatar) {
        if (!el) return;
        const url = safeAvatar(avatar);
        el.innerHTML = url ? '<img class="user-avatar-img" alt="头像">' : ICON_USER;
        const img = el.querySelector('img');
        if (img) {
            img.addEventListener('error', () => { el.innerHTML = ICON_USER; });
            img.src = url;
        }
    }

    function setBusy(btn, busy, text) {
        if (!btn) return;
        if (busy) {
            btn.dataset.originText = btn.textContent;
            btn.disabled = true;
            btn.textContent = text || '处理中...';
        } else {
            btn.disabled = false;
            if (btn.dataset.originText != null) {
                btn.textContent = btn.dataset.originText;
                delete btn.dataset.originText;
            }
        }
    }

    function syncNameMarquee() {
        const boxEl = document.getElementById('user-name-box');
        const nameEl = document.getElementById('user-name');
        if (!boxEl || !nameEl) return;
        nameEl.classList.remove('user-name-marquee');
        nameEl.style.removeProperty('--user-name-shift');
        boxEl.classList.remove('need-marquee');
        const wide = nameEl.scrollWidth > boxEl.clientWidth + 1;
        if (!wide) return;
        boxEl.classList.add('need-marquee');
        nameEl.style.setProperty('--user-name-shift', (nameEl.scrollWidth - boxEl.clientWidth + 2) + 'px');
        nameEl.classList.add('user-name-marquee');
    }

    function refreshUserArea() {
        const chip = document.getElementById('user-chip');
        const nameEl = document.getElementById('user-name');
        const avatarEl = document.getElementById('user-avatar');
        if (!chip || !nameEl || !avatarEl) return;
        const c = cloud();
        const user = c && c.getUser ? c.getUser() : null;
        const key = user ? String(user.userId || user.uuid || user.username || '') : '';
        const changed = key !== state.userKey;
        state.userKey = key;
        const name = user ? String(user.nickname || user.username || '用户') : '未登录';
        nameEl.textContent = name;
        chip.title = user ? name : '未登录';
        chip.classList.toggle('is-guest', !user);
        renderAvatar(avatarEl, user ? user.avatar : '');
        syncNameMarquee();
        syncTopbarReserve();
        if (changed) closeUserPopup();
    }

    
    function syncTopbarMetrics() {
        const root = document.documentElement;
        const search = document.querySelector('.search-container');
        const h = search ? Math.round(search.getBoundingClientRect().height) : 0;
        if (h > 0) root.style.setProperty('--aer-topbar-h', h + 'px');
    }

    
    function syncTopbarReserve() {
        syncTopbarMetrics();
        const wrap = document.getElementById('user-wrap');
        const root = document.documentElement;
        if (!wrap || window.innerWidth <= 768) {
            root.style.setProperty('--aer-topbar-reserve', '0px');
            return;
        }
        root.style.setProperty('--aer-topbar-reserve', Math.round(wrap.offsetWidth + 14) + 'px');
    }

    
    function buildTopBar() {
        const topBar = document.getElementById('top-bar');
        const search = topBar ? topBar.querySelector('.search-container') : null;
        if (!topBar || !search || document.getElementById('user-wrap')) return false;
        const wrap = document.createElement('div');
        wrap.id = 'user-wrap';
        wrap.innerHTML = `
            <div id="user-chip" class="user-chip is-guest" role="button" tabindex="0" aria-label="个人信息">
                <span id="user-avatar" class="user-avatar">${ICON_USER}</span>
                <span id="user-name-box" class="user-name-box"><span id="user-name" class="user-name">未登录</span></span>
            </div>`;
        topBar.insertBefore(wrap, search.nextSibling);
        const chip = wrap.querySelector('#user-chip');
        chip.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleUserPopup();
        });
        chip.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleUserPopup();
            }
        });
        document.addEventListener('click', onDocClick, true);
        window.addEventListener('resize', () => {
            closeUserPopup();
            syncNameMarquee();
            syncTopbarReserve();
            syncTopbarMetrics();
        });
        return true;
    }

    function onDocClick(e) {
        const popup = document.getElementById('user-popup');
        if (!popup) return;
        if (e.target.closest && (e.target.closest('#user-popup') || e.target.closest('#user-chip') || e.target.closest('#apple-music-modal'))) return;
        
        if (e.target.tagName === 'INPUT' && e.target.type === 'file') return;
        closeUserPopup();
    }

    
    function toggleUserPopup() {
        if (document.getElementById('user-popup')) {
            closeUserPopup();
            return;
        }
        openUserPopup();
    }

    function guestHtml() {
        return `
            <div class="up-guest">
                <span class="user-avatar">${ICON_USER}</span>
                <div class="up-guest-title">未登录</div>
                <div class="up-guest-desc">登录后收藏 / 歌单 / 播放历史自动云端保存</div>
                <button type="button" class="up-btn primary" data-up="login">登录 / 注册</button>
            </div>`;
    }

    function profileHtml(user) {
        const nick = esc(user.nickname || '');
        const uuid = esc(user.uuid || user.userId || '');
        const bio = esc(user.bio || '');
        const avatar = safeAvatar(user.avatar);
        return `
            <div class="up-head">
                <button type="button" class="up-avatar-btn" data-up="avatar" title="更换头像" aria-label="更换头像">
                    <span class="user-avatar">${avatar ? `<img class="user-avatar-img" alt="头像" src="${esc(avatar)}">` : ICON_USER}</span>
                    <span class="up-avatar-badge">${ICON_CAMERA}</span>
                </button>
                <div class="up-head-info">
                    <input id="up-nickname" class="up-input" maxlength="${NAME_LIMIT}" placeholder="昵称" value="${nick}">
                    <div class="up-uuid" title="UUID">UUID: ${uuid || '未知'}</div>
                </div>
            </div>
            <label class="up-label" for="up-bio">个人简介</label>
            <textarea id="up-bio" class="up-input up-bio" maxlength="${BIO_LIMIT}" placeholder="写点什么介绍一下自己吧">${bio}</textarea>
            <div class="up-count"><span id="up-bio-count">0</span>/${BIO_LIMIT}</div>
            <div class="up-actions">
                <button type="button" class="up-btn primary" data-up="save">保存</button>
                <button type="button" class="up-btn danger" data-up="logout">退出登录</button>
            </div>`;
    }

    function openUserPopup() {
        const chip = document.getElementById('user-chip');
        if (!chip) return;
        const old = document.getElementById('user-popup');
        if (old) old.remove();
        const c = cloud();
        const user = c && c.getUser ? c.getUser() : null;
        const popup = document.createElement('div');
        popup.id = 'user-popup';
        popup.className = 'user-popup';
        popup.innerHTML = user ? profileHtml(user) : guestHtml();
        document.body.appendChild(popup);
        bindPopup(popup, user);
        const rect = chip.getBoundingClientRect();
        const width = popup.offsetWidth || 292;
        let left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
        let top = rect.bottom + 8;
        if (top + popup.offsetHeight > window.innerHeight - 8) top = Math.max(8, rect.top - popup.offsetHeight - 8);
        popup.style.left = Math.round(left) + 'px';
        popup.style.top = Math.round(top) + 'px';
        requestAnimationFrame(() => popup.classList.add('is-open'));
    }

    function closeUserPopup() {
        const popup = document.getElementById('user-popup');
        if (!popup || popup.dataset.closing === '1') return;
        popup.dataset.closing = '1';
        popup.classList.remove('is-open');
        popup.classList.add('is-closing');
        setTimeout(() => {
            if (popup.isConnected) popup.remove();
        }, 180);
    }

    function bindPopup(popup, user) {
        if (!user) {
            const loginBtn = popup.querySelector('[data-up="login"]');
            if (loginBtn) loginBtn.onclick = () => {
                closeUserPopup();
                openAuthModal('login');
            };
            return;
        }
        const avatarBtn = popup.querySelector('[data-up="avatar"]');
        const saveBtn = popup.querySelector('[data-up="save"]');
        const logoutBtn = popup.querySelector('[data-up="logout"]');
        const bio = popup.querySelector('#up-bio');
        const count = popup.querySelector('#up-bio-count');
        if (avatarBtn) avatarBtn.onclick = () => pickAvatarFile();
        if (saveBtn) saveBtn.onclick = () => saveProfile(saveBtn);
        if (logoutBtn) logoutBtn.onclick = () => doLogout(logoutBtn);
        if (bio && count) {
            const syncCount = () => { count.textContent = String(bio.value.length); };
            bio.addEventListener('input', syncCount);
            syncCount();
        }
    }

    async function saveProfile(btn) {
        const popup = document.getElementById('user-popup');
        const nickEl = popup ? popup.querySelector('#up-nickname') : null;
        const bioEl = popup ? popup.querySelector('#up-bio') : null;
        if (!nickEl || !bioEl) return;
        const nickname = nickEl.value.trim();
        const bio = bioEl.value.trim();
        if (!nickname) { toast('昵称不能为空'); return; }
        if (nickname.length > NAME_LIMIT) { toast('昵称最多 ' + NAME_LIMIT + ' 个字'); return; }
        if (bio.length > BIO_LIMIT) { toast('个人简介最多 ' + BIO_LIMIT + ' 字'); return; }
        const c = cloud();
        if (!c || !c.updateProfile) return;
        setBusy(btn, true, '保存中...');
        try {
            await c.updateProfile({ nickname: nickname, bio: bio });
            toast('已保存');
            if (c.fetchMe) await c.fetchMe().catch(() => {});
            refreshUserArea();
        } catch (e) {
            toast(e.message || '保存失败');
        } finally {
            setBusy(btn, false);
        }
    }

    async function doLogout(btn) {
        const c = cloud();
        if (!c || !c.logout) return;
        setBusy(btn, true, '退出中...');
        try {
            await c.logout();
            toast('已退出登录');
        } catch (e) {
            toast(e.message || '退出失败');
        } finally {
            setBusy(btn, false);
        }
        closeUserPopup();
        refreshUserArea();
    }

    
    function codeBoxesHtml() {
        let html = '';
        for (let i = 0; i < CODE_LEN; i++) {
            html += '<input class="auth-code-input" type="text" inputmode="numeric" maxlength="1" autocomplete="one-time-code" aria-label="验证码第 ' + (i + 1) + ' 位">';
        }
        return html;
    }

    function authHtml(mode) {
        const isLogin = mode !== 'register';
        return `
            <div class="auth-tabs">
                <button type="button" class="auth-tab${isLogin ? ' active' : ''}" data-auth-tab="login">登录</button>
                <button type="button" class="auth-tab${isLogin ? '' : ' active'}" data-auth-tab="register">注册</button>
            </div>
            <div class="auth-pane" data-auth-pane="login"${isLogin ? '' : ' style="display:none;"'}>
                <input id="auth-login-user" class="up-input" placeholder="用户名或邮箱" autocomplete="username" maxlength="64" spellcheck="false">
                <div class="auth-pass-row">
                    <input id="auth-login-pass" class="up-input" type="password" placeholder="密码" autocomplete="current-password" maxlength="64">
                    <button type="button" class="auth-eye" data-auth-eye="auth-login-pass" title="显示密码" aria-label="显示密码">${ICON_EYE}</button>
                </div>
                <button type="button" class="up-btn primary auth-submit" data-auth-submit="login">登录</button>
            </div>
            <div class="auth-pane" data-auth-pane="register"${isLogin ? ' style="display:none;"' : ''}>
                <input id="auth-reg-user" class="up-input" placeholder="用户名" autocomplete="username" maxlength="20" spellcheck="false">
                <div class="auth-pass-row">
                    <input id="auth-reg-pass" class="up-input" type="password" placeholder="密码(至少 8 位, 含字母和数字)" autocomplete="new-password" maxlength="64">
                    <button type="button" class="auth-eye" data-auth-eye="auth-reg-pass" title="显示密码" aria-label="显示密码">${ICON_EYE}</button>
                </div>
                <input id="auth-reg-nick" class="up-input" placeholder="昵称" maxlength="${NAME_LIMIT}">
                <div class="auth-email-row">
                    <input id="auth-reg-email" class="up-input" placeholder="邮箱" autocomplete="email" maxlength="64" spellcheck="false">
                    <button type="button" class="up-btn code-btn" data-auth-code>获取验证码</button>
                </div>
                <div class="auth-code-boxes" id="auth-code-boxes">${codeBoxesHtml()}</div>
                <button type="button" class="up-btn primary auth-submit" data-auth-submit="register">注册</button>
            </div>`;
    }

    function openAuthModal(mode) {
        const a = app();
        if (!a || !a.showAppleModal) { toast('弹窗组件还没准备好, 稍后再试'); return; }
        clearCodeTimer();
        const wantRegister = mode === 'register';
        const handle = a.showAppleModal('登录 / 注册', authHtml(wantRegister ? 'register' : 'login'), null, null, { hideFooter: true, maxWidth: '420px' });
        if (!handle || !handle.modal) return;
        bindAuthModal(handle.modal, wantRegister ? 'register' : 'login');
    }

    function switchAuthPane(modal, mode) {
        modal.querySelectorAll('[data-auth-tab]').forEach((tab) => {
            tab.classList.toggle('active', tab.dataset.authTab === mode);
        });
        modal.querySelectorAll('[data-auth-pane]').forEach((pane) => {
            pane.style.display = pane.dataset.authPane === mode ? '' : 'none';
        });
    }

    function bindAuthModal(modal, mode) {
        bindEyes(modal);
        const boxes = modal.querySelector('#auth-code-boxes');
        if (boxes) bindCodeInputs(boxes);
        const codeBtn = modal.querySelector('[data-auth-code]');
        if (codeBtn) codeBtn.onclick = () => sendCode(modal, codeBtn);
        modal.querySelectorAll('[data-auth-tab]').forEach((tab) => {
            tab.onclick = () => switchAuthPane(modal, tab.dataset.authTab);
        });
        modal.querySelectorAll('[data-auth-submit]').forEach((btn) => {
            btn.onclick = () => {
                if (btn.dataset.authSubmit === 'register') doRegister(modal, btn);
                else doLogin(modal, btn);
            };
        });
        modal.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA') return;
            const pane = e.target.closest('[data-auth-pane]');
            if (!pane || pane.style.display === 'none') return;
            const submit = pane.querySelector('[data-auth-submit]');
            if (submit && !submit.disabled) {
                e.preventDefault();
                submit.click();
            }
        });
        switchAuthPane(modal, mode);
    }

    function bindEyes(modal) {
        modal.querySelectorAll('[data-auth-eye]').forEach((btn) => {
            btn.onclick = () => {
                const input = modal.querySelector('#' + btn.dataset.authEye);
                if (!input) return;
                const show = input.type === 'password';
                input.type = show ? 'text' : 'password';
                btn.innerHTML = show ? ICON_EYE_OFF : ICON_EYE;
                btn.title = show ? '隐藏密码' : '显示密码';
            };
        });
    }

    function bindCodeInputs(boxes) {
        const list = Array.prototype.slice.call(boxes.querySelectorAll('.auth-code-input'));
        list.forEach((el, i) => {
            el.addEventListener('input', () => {
                const digits = el.value.replace(/\D/g, '');
                if (!digits) {
                    el.value = '';
                    return;
                }
                el.value = digits.slice(-1);
                if (i < list.length - 1) list[i + 1].focus();
            });
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace') {
                    e.preventDefault();
                    if (el.value) el.value = '';
                    else if (i > 0) {
                        list[i - 1].value = '';
                        list[i - 1].focus();
                    }
                } else if (e.key === 'ArrowLeft' && i > 0) {
                    e.preventDefault();
                    list[i - 1].focus();
                } else if (e.key === 'ArrowRight' && i < list.length - 1) {
                    e.preventDefault();
                    list[i + 1].focus();
                }
            });
            el.addEventListener('paste', (e) => {
                e.preventDefault();
                const cd = e.clipboardData || window.clipboardData;
                if (!cd) return;
                const text = cd.getData('text') || '';
                const digits = text.replace(/\D/g, '').slice(0, list.length);
                if (!digits) return;
                list.forEach((box, k) => { box.value = digits[k] || ''; });
                list[Math.min(digits.length, list.length - 1)].focus();
            });
            el.addEventListener('focus', () => el.select());
        });
    }

    function readCode(modal) {
        let code = '';
        modal.querySelectorAll('.auth-code-input').forEach((box) => { code += box.value.replace(/\D/g, ''); });
        return code;
    }

    function startCodeCooldown(btn) {
        clearCodeTimer();
        state.codeLeft = CODE_COOLDOWN;
        const tick = () => {
            if (!btn.isConnected) {
                clearCodeTimer();
                return;
            }
            if (state.codeLeft <= 0) {
                clearCodeTimer();
                btn.disabled = false;
                btn.textContent = '获取验证码';
                return;
            }
            btn.disabled = true;
            btn.textContent = state.codeLeft + 's 后重试';
            state.codeLeft--;
        };
        tick();
        state.codeTimer = setInterval(tick, 1000);
    }

    function clearCodeTimer() {
        if (state.codeTimer) {
            clearInterval(state.codeTimer);
            state.codeTimer = 0;
        }
        state.codeLeft = 0;
    }

    async function sendCode(modal, btn) {
        if (btn.disabled) return;
        const emailEl = modal.querySelector('#auth-reg-email');
        const email = emailEl ? emailEl.value.trim() : '';
        if (!isEmail(email)) { toast('请先填写正确的邮箱'); return; }
        const c = cloud();
        if (!c || !c.sendEmailCode) { toast('服务还没准备好, 稍后再试'); return; }
        btn.disabled = true;
        btn.textContent = '发送中...';
        try {
            await c.sendEmailCode(email);
            toast('验证码已发送, 请查收邮箱');
            startCodeCooldown(btn);
        } catch (e) {
            toast(e.message || '验证码发送失败');
            btn.disabled = false;
            btn.textContent = '获取验证码';
        }
    }

    async function doLogin(modal, btn) {
        const userEl = modal.querySelector('#auth-login-user');
        const passEl = modal.querySelector('#auth-login-pass');
        const username = userEl ? userEl.value.trim() : '';
        const password = passEl ? passEl.value : '';
        if (!username) { toast('请输入用户名或邮箱'); return; }
        if (!password) { toast('请输入密码'); return; }
        const c = cloud();
        if (!c || !c.login) return;
        setBusy(btn, true);
        try {
            await c.login(username, password);
            toast('登录成功');
            closeAuthModal();
        } catch (e) {
            toast(e.message || '登录失败');
        } finally {
            setBusy(btn, false);
        }
    }

    async function doRegister(modal, btn) {
        const userEl = modal.querySelector('#auth-reg-user');
        const passEl = modal.querySelector('#auth-reg-pass');
        const nickEl = modal.querySelector('#auth-reg-nick');
        const emailEl = modal.querySelector('#auth-reg-email');
        const username = userEl ? userEl.value.trim() : '';
        const password = passEl ? passEl.value : '';
        const nickname = nickEl ? nickEl.value.trim() : '';
        const email = emailEl ? emailEl.value.trim() : '';
        const code = readCode(modal);
        if (!username) { toast('请输入用户名'); return; }
        if (!password) { toast('请输入密码'); return; }
        if (!passStrong(password)) { toast('密码至少 8 位, 且必须包含字母和数字'); return; }
        if (!nickname) { toast('请输入昵称'); return; }
        if (!isEmail(email)) { toast('邮箱格式不正确'); return; }
        if (!/^\d{6}$/.test(code)) { toast('请输入 ' + CODE_LEN + ' 位数字验证码'); return; }
        const c = cloud();
        if (!c || !c.register) return;
        setBusy(btn, true);
        try {
            await c.register({ username: username, password: password, nickname: nickname, email: email, code: code });
            toast('注册成功, 已自动登录');
            closeAuthModal();
        } catch (e) {
            toast(e.message || '注册失败');
        } finally {
            setBusy(btn, false);
        }
    }

    function closeAuthModal() {
        clearCodeTimer();
        const modal = document.getElementById('apple-music-modal');
        if (modal && typeof modal.close === 'function') modal.close();
    }

    
    function pickAvatarFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/jpeg,image/png,image/webp';
        input.style.display = 'none';
        document.body.appendChild(input);
        input.onchange = () => {
            const file = input.files && input.files[0];
            input.remove();
            if (file) startCrop(file);
        };
        input.addEventListener('cancel', () => input.remove());
        input.click();
    }

    function readAsImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error('image load failed'));
                img.src = reader.result;
            };
            reader.onerror = () => reject(new Error('file read failed'));
            reader.readAsDataURL(file);
        });
    }

    async function loadImage(file) {
        if (window.createImageBitmap) {
            try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) {}
        }
        return readAsImage(file);
    }

    async function startCrop(file) {
        const type = file.type || '';
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const okType = FILE_TYPES.indexOf(type) > -1 || (!type && ['jpg', 'jpeg', 'png', 'webp'].indexOf(ext) > -1);
        if (!okType) { toast('只支持 jpg / png / webp 格式的图片'); return; }
        if (file.size > FILE_LIMIT) { toast('图片不能超过 1MB'); return; }
        let source = null;
        try { source = await loadImage(file); } catch (e) { source = null; }
        if (!source || !source.width || !source.height) { toast('图片读取失败, 换一张试试'); return; }
        openCropModal(source, type === 'image/png' ? 'image/png' : 'image/jpeg');
    }

    function cropHtml() {
        return `
            <div class="crop-stage">
                <canvas id="crop-canvas" width="${CROP_VIEW}" height="${CROP_VIEW}"></canvas>
                <div class="crop-mask"><div class="crop-hole"></div></div>
            </div>
            <div class="crop-zoom-row">
                <span class="crop-zoom-icon">${ICON_ZOOM_OUT}</span>
                <input id="crop-zoom" type="range" min="1" max="3" step="0.01" value="1" aria-label="缩放">
                <span class="crop-zoom-icon">${ICON_ZOOM_IN}</span>
            </div>
            <div class="crop-tip">拖动图片调整位置, 滑块缩放</div>
            <div class="up-actions">
                <button type="button" class="up-btn" data-crop-cancel>取消</button>
                <button type="button" class="up-btn primary" data-crop-ok>确认</button>
            </div>`;
    }

    function openCropModal(source, outType) {
        const a = app();
        if (!a || !a.showAppleModal) { toast('弹窗组件还没准备好, 稍后再试'); return; }
        const handle = a.showAppleModal('裁剪头像', cropHtml(), null, null, { hideFooter: true, maxWidth: '360px' });
        if (!handle || !handle.modal) return;
        setupCrop(handle.modal, source, outType);
    }

    function setupCrop(modal, source, outType) {
        const canvas = modal.querySelector('#crop-canvas');
        const zoom = modal.querySelector('#crop-zoom');
        if (!canvas || !zoom) return;
        const crop = {
            source: source,
            outType: outType,
            base: Math.max(CROP_VIEW / source.width, CROP_VIEW / source.height),
            zoom: 1,
            dx: 0,
            dy: 0,
            dragging: false,
            lastX: 0,
            lastY: 0,
            canvas: canvas,
            ctx: canvas.getContext('2d')
        };
        state.crop = crop;
        clampCrop(crop);
        drawCrop(crop);
        canvas.addEventListener('pointerdown', (e) => {
            crop.dragging = true;
            crop.lastX = e.clientX;
            crop.lastY = e.clientY;
            if (canvas.setPointerCapture) {
                try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
            }
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!crop.dragging) return;
            const ratio = CROP_VIEW / (canvas.getBoundingClientRect().width || CROP_VIEW);
            crop.dx += (e.clientX - crop.lastX) * ratio;
            crop.dy += (e.clientY - crop.lastY) * ratio;
            crop.lastX = e.clientX;
            crop.lastY = e.clientY;
            clampCrop(crop);
            drawCrop(crop);
        });
        const stopDrag = () => { crop.dragging = false; };
        canvas.addEventListener('pointerup', stopDrag);
        canvas.addEventListener('pointercancel', stopDrag);
        zoom.addEventListener('input', () => {
            crop.zoom = Math.min(3, Math.max(1, Number(zoom.value) || 1));
            clampCrop(crop);
            drawCrop(crop);
        });
        const cancelBtn = modal.querySelector('[data-crop-cancel]');
        const okBtn = modal.querySelector('[data-crop-ok]');
        if (cancelBtn) cancelBtn.onclick = () => closeCropModal();
        if (okBtn) okBtn.onclick = () => confirmCrop(okBtn);
        
        modal.addEventListener('click', (e) => { if (e.target === modal) state.crop = null; });
    }

    function clampCrop(crop) {
        const drawW = crop.base * crop.zoom * crop.source.width;
        const drawH = crop.base * crop.zoom * crop.source.height;
        const maxX = Math.max(0, (drawW - CROP_VIEW) / 2);
        const maxY = Math.max(0, (drawH - CROP_VIEW) / 2);
        crop.dx = Math.max(-maxX, Math.min(maxX, crop.dx));
        crop.dy = Math.max(-maxY, Math.min(maxY, crop.dy));
    }

    function drawCrop(crop) {
        const drawW = crop.base * crop.zoom * crop.source.width;
        const drawH = crop.base * crop.zoom * crop.source.height;
        const left = CROP_VIEW / 2 + crop.dx - drawW / 2;
        const top = CROP_VIEW / 2 + crop.dy - drawH / 2;
        crop.ctx.clearRect(0, 0, CROP_VIEW, CROP_VIEW);
        crop.ctx.drawImage(crop.source, left, top, drawW, drawH);
    }

    function exportCrop(crop) {
        const out = document.createElement('canvas');
        out.width = OUT_SIZE;
        out.height = OUT_SIZE;
        const ctx = out.getContext('2d');
        const drawW = crop.base * crop.zoom * crop.source.width;
        const drawH = crop.base * crop.zoom * crop.source.height;
        const k = drawW / crop.source.width;
        const left = CROP_VIEW / 2 + crop.dx - drawW / 2;
        const top = CROP_VIEW / 2 + crop.dy - drawH / 2;
        const at = (CROP_VIEW - CROP_HOLE) / 2;
        ctx.drawImage(crop.source, (at - left) / k, (at - top) / k, CROP_HOLE / k, CROP_HOLE / k, 0, 0, OUT_SIZE, OUT_SIZE);
        let url = out.toDataURL(crop.outType, 0.92);
        if (dataUrlBytes(url) > FILE_LIMIT && crop.outType !== 'image/jpeg') url = out.toDataURL('image/jpeg', 0.92);
        let quality = 0.9;
        while (dataUrlBytes(url) > FILE_LIMIT && quality >= 0.5) {
            url = out.toDataURL('image/jpeg', quality);
            quality -= 0.1;
        }
        return url;
    }

    function dataUrlBytes(url) {
        const text = String(url);
        const at = text.indexOf(',');
        if (at < 0) return 0;
        const pad = /==$/.test(text) ? 2 : (/=$/.test(text) ? 1 : 0);
        return Math.max(0, Math.floor((text.length - at - 1) * 3 / 4) - pad);
    }

    async function confirmCrop(btn) {
        const crop = state.crop;
        if (!crop) return;
        const c = cloud();
        if (!c || !c.uploadAvatar) { toast('服务还没准备好, 稍后再试'); return; }
        let dataUrl = '';
        try {
            dataUrl = exportCrop(crop);
        } catch (e) {
            toast('图片处理失败, 换一张试试');
            return;
        }
        setBusy(btn, true, '上传中...');
        try {
            await c.uploadAvatar(dataUrl);
            toast('头像已更新');
            closeCropModal();
            if (c.fetchMe) await c.fetchMe().catch(() => {});
            refreshUserArea();
            const user = c.getUser ? c.getUser() : null;
            updatePopupAvatar(user ? user.avatar : '');
        } catch (e) {
            toast(e.message || '头像上传失败');
            setBusy(btn, false);
        }
    }

    function updatePopupAvatar(avatar) {
        const popup = document.getElementById('user-popup');
        const el = popup ? popup.querySelector('.user-avatar') : null;
        if (el) renderAvatar(el, avatar);
    }

    function closeCropModal() {
        state.crop = null;
        const modal = document.getElementById('apple-music-modal');
        if (modal && typeof modal.close === 'function') modal.close();
    }

    function apply() {
        if (state.booted) return true;
        const a = app();
        const c = cloud();
        if (!a || !a.escapeHtml || !a.showToast) return false;
        if (!c || !c.fetchMe || !c.onAuthChanged) return false;
        if (!buildTopBar()) return false;
        state.booted = true;
        c.onAuthChanged(() => refreshUserArea());
        refreshUserArea();
        c.fetchMe().catch(() => {});
        return true;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function tick() {
            if (apply()) return;
            setTimeout(tick, 50);
        });
    } else {
        (function tick() {
            if (apply()) return;
            setTimeout(tick, 50);
        })();
    }

    window.AerMusicUser = {
        refresh: refreshUserArea,
        openAuth: openAuthModal,
        openProfile: openUserPopup
    };
})();
