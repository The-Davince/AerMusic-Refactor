/**
 * AerMusic 云同步
 * 登录后把收藏/歌单/播放历史存到服务端, 换设备或清浏览器数据不再丢
 * 未登录时一切照旧走 localStorage
 */
(function () {
    const KIND_KEYS = {
        favorites: 'AerMusic_Favorites_Songs',
        playlists: 'AerMusic_Playlists',
        history: 'AerMusic_History'
    };
    const SYNC_TS_KEY = 'AerMusic_Sync_Timestamps';
    const state = { user: null, pushTimer: null, lastPushed: {}, restoring: false };

    function readTS() {
        try { return JSON.parse(localStorage.getItem(SYNC_TS_KEY) || '{}'); } catch (e) { return {}; }
    }
    function writeTS(ts) { localStorage.setItem(SYNC_TS_KEY, JSON.stringify(ts)); }

    function api(method, url, body) {
        const opts = { method, headers: {} };
        if (body !== undefined) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        return fetch(url, opts).then(async (r) => {
            let data = null;
            try { data = await r.json(); } catch (e) {}
            if (!r.ok || !data || data.code !== 0) {
                const msg = (data && data.msg) || ('请求失败 ' + r.status);
                throw new Error(msg);
            }
            return data;
        });
    }

    function toast(msg) {
        if (window.app && window.app.showToast) window.app.showToast(msg);
        else console.log('[CloudSync]', msg);
    }

    /* ---------- 拉取 ---------- */
    async function pullAndRestore() {
        if (!state.user) return;
        state.restoring = true;
        try {
            const resp = await api('GET', '/api/library');
            const data = resp.data || {};
            const ts = readTS();
            let changed = false;
            Object.keys(KIND_KEYS).forEach((kind) => {
                const remote = data[kind];
                if (!remote || remote.data === null || remote.data === undefined) return;
                if ((ts[kind] || 0) >= (remote.updatedAt || 0)) return;
                localStorage.setItem(KIND_KEYS[kind], JSON.stringify(remote.data));
                ts[kind] = remote.updatedAt;
                state.lastPushed[kind] = JSON.stringify(remote.data);
                changed = true;
            });
            writeTS(ts);
            if (changed) {
                toast('已从云端恢复数据, 即将刷新');
                setTimeout(() => location.reload(), 800);
            }
        } catch (e) {
            console.warn('[CloudSync] 拉取失败:', e.message);
        } finally {
            setTimeout(() => { state.restoring = false; }, 1000);
        }
    }

    /* ---------- 推送 ---------- */
    function snapshotKind(kind) {
        const raw = localStorage.getItem(KIND_KEYS[kind]);
        return raw === null ? '' : raw;
    }

    function schedulePush(kind) {
        clearTimeout(state.pushTimer);
        state.pushTimer = setTimeout(() => pushAll(), 2000);
    }

    async function pushAll() {
        if (!state.user || state.restoring) return;
        const ts = readTS();
        const now = Date.now();
        for (const kind of Object.keys(KIND_KEYS)) {
            const snap = snapshotKind(kind);
            if (snap === state.lastPushed[kind]) continue;
            try {
                await api('PUT', '/api/library/' + kind, { data: snap === '' ? null : JSON.parse(snap), updatedAt: now });
                state.lastPushed[kind] = snap;
                ts[kind] = now;
            } catch (e) {
                console.warn('[CloudSync] 推送 ' + kind + ' 失败:', e.message);
            }
        }
        writeTS(ts);
    }

    function watchLocal() {
        setInterval(() => {
            if (!state.user) return;
            for (const kind of Object.keys(KIND_KEYS)) {
                if (snapshotKind(kind) !== state.lastPushed[kind]) { schedulePush(kind); break; }
            }
        }, 3000);
        window.addEventListener('beforeunload', () => { if (state.user) pushAll(); });
    }

    /* ---------- 播放历史 ---------- */
    function recordHistory(song) {
        if (!song || song.id === undefined) return;
        let list = [];
        try { list = JSON.parse(localStorage.getItem(KIND_KEYS.history) || '[]'); } catch (e) {}
        if (!Array.isArray(list)) list = [];
        const entry = { id: song.id, name: song.name, artist: song.artist, cover: song.cover, platform: song.platform, playedAt: Date.now() };
        if (list.length && String(list[0].id) === String(song.id)) { list[0].playedAt = entry.playedAt; }
        else {
            const rest = list.filter(x => String(x.id) !== String(song.id));
            list = [entry].concat(rest).slice(0, 200);
        }
        localStorage.setItem(KIND_KEYS.history, JSON.stringify(list));
    }

    /* ---------- UI ---------- */
    function ensureSection() {
        const overlay = document.getElementById('theme-overlay');
        if (!overlay || document.getElementById('account-section')) return;

        const section = document.createElement('div');
        section.className = 'settings-section';
        section.id = 'account-section';

        const dataSection = Array.from(overlay.querySelectorAll('.settings-section'))
            .find(s => s.querySelector('.settings-label') && s.querySelector('.settings-label').textContent.indexOf('数据管理') > -1);
        const label = document.createElement('h3');
        label.className = 'settings-label';
        label.textContent = '账号与云同步';
        section.appendChild(label);
        const box = document.createElement('div');
        box.id = 'account-box';
        box.style.cssText = 'margin-top:1.5vh;';
        section.appendChild(box);

        if (dataSection) dataSection.parentNode.insertBefore(section, dataSection);
        else overlay.appendChild(section);
        renderBox();
    }

    function renderBox() {
        const box = document.getElementById('account-box');
        if (!box) return;
        if (!state.user) {
            box.innerHTML = `
                <div style="display:flex; flex-direction:column; gap:1vh; max-width:300px;">
                    <div style="font-size:1.25vh; color:rgba(255,255,255,0.55);">登录后收藏/歌单/历史自动云端保存</div>
                    <input id="acc-user" class="meta-input" placeholder="用户名" autocomplete="username" style="width:100%;">
                    <input id="acc-pass" class="meta-input" type="password" placeholder="密码" autocomplete="current-password" style="width:100%;">
                    <div style="display:flex; gap:1vh;">
                        <div id="acc-login" class="add-style-btn" style="cursor:pointer;text-align:center;flex:1;">登录</div>
                        <div id="acc-register" class="add-style-btn" style="cursor:pointer;text-align:center;flex:1;background:rgba(255,255,255,0.08);color:#fff;">注册</div>
                    </div>
                </div>`;
            box.querySelector('#acc-login').onclick = () => doAuth('/api/user/login');
            box.querySelector('#acc-register').onclick = () => doAuth('/api/user/register');
        } else {
            box.innerHTML = `
                <div style="display:flex; align-items:center; gap:1.5vh; flex-wrap:wrap;">
                    <span style="font-size:1.35vh; color:#fff;">已登录: ${state.user.username.replace(/[^A-Za-z0-9_\u4e00-\u9fa5]/g, '')}</span>
                    <div id="acc-sync" class="add-style-btn" style="cursor:pointer;">立即同步</div>
                    <div id="acc-logout" class="add-style-btn" style="cursor:pointer;background:rgba(255,59,48,0.2);color:#ff3b30;">退出登录</div>
                </div>
                <div style="font-size:1.15vh; color:rgba(255,255,255,0.4); margin-top:1vh;">收藏 / 歌单 / 播放历史会自动同步到云端</div>`;
            box.querySelector('#acc-sync').onclick = async () => { await pushAll(); await pullAndRestore(); toast('同步完成'); };
            box.querySelector('#acc-logout').onclick = doLogout;
        }
    }

    async function doAuth(url) {
        const box = document.getElementById('account-box');
        const name = box.querySelector('#acc-user').value.trim();
        const pass = box.querySelector('#acc-pass').value;
        if (!name || !pass) { toast('请输入用户名和密码'); return; }
        try {
            const resp = await api('POST', url, { username: name, password: pass });
            state.user = resp.data;
            toast(url.indexOf('register') > -1 ? '注册成功, 已登录' : '登录成功');
            renderBox();
            await pullAndRestore();
        } catch (e) {
            toast(e.message);
        }
    }

    async function doLogout() {
        try { await api('POST', '/api/user/logout'); } catch (e) {}
        state.user = null;
        toast('已退出登录');
        renderBox();
    }

    /* ---------- 启动 ---------- */
    async function boot() {
        ensureSection();
        const settingsBtn = document.getElementById('theme-btn');
        if (settingsBtn) settingsBtn.addEventListener('click', () => setTimeout(ensureSection, 50));
        try {
            const resp = await api('GET', '/api/user/me');
            state.user = resp.data;
            renderBox();
            await pullAndRestore();
        } catch (e) { renderBox(); }
        watchLocal();
        // 等待 app 就绪后挂播放历史记录
        const hookApp = () => {
            if (window.app && !window.app.__cloudSyncHooked) {
                window.app.__cloudSyncHooked = true;
                const originalPlay = window.app.play.bind(window.app);
                window.app.play = (index) => {
                    const song = window.app.playlist && window.app.playlist[index];
                    recordHistory(song);
                    return originalPlay(index);
                };
            }
        };
        hookApp();
        setInterval(hookApp, 1000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
