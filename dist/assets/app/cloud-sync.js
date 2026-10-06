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
    const state = { user: null, pushTimer: null, lastPushed: {}, restoring: false, failCount: 0, restoreVersion: 0 };
    const eventState = { queue: [], timer: null, sending: false, version: 0, controller: null, last: Object.create(null), failCount: 0 };

    function readTS() {
        try { return JSON.parse(localStorage.getItem(SYNC_TS_KEY) || '{}'); } catch (e) { return {}; }
    }
    function writeTS(ts) { localStorage.setItem(SYNC_TS_KEY, JSON.stringify(ts)); }
    function resetSyncState() {
        clearTimeout(state.pushTimer);
        state.pushTimer = null;
        clearTimeout(eventState.timer);
        eventState.timer = null;
        if (eventState.controller) eventState.controller.abort();
        eventState.controller = null;
        eventState.queue = [];
        eventState.sending = false;
        eventState.version++;
        eventState.last = Object.create(null);
        eventState.failCount = 0;
        state.restoreVersion++;
        state.restoring = false;
        state.lastPushed = {};
        writeTS({});
        state.failCount = 0;
    }

    function api(method, url, body, opts) {
        const o = opts || {};
        const init = { method, headers: {}, keepalive: !!o.keepalive, signal: o.signal };
        if (body !== undefined) {
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(body);
        }
        return fetch(url, init).then(async (r) => {
            let data = null;
            try { data = await r.json(); } catch (e) {}
            if (!r.ok || !data || data.code !== 0) {
                const msg = (data && data.msg) || ('请求失败 ' + r.status);
                const err = new Error(msg);
                err.status = r.status;
                throw err;
            }
            return data;
        });
    }

    function toast(msg) {
        if (window.app && window.app.showToast) window.app.showToast(msg);
        else console.log('[CloudSync]', msg);
    }

    function resetRecommendProfile() {
        if (window.CloudMusicPlatform && window.CloudMusicPlatform.resetRecommendProfile) {
            window.CloudMusicPlatform.resetRecommendProfile();
        }
    }

    function cleanText(value, limit) {
        if (typeof value !== 'string' && typeof value !== 'number') return '';
        const text = String(value).trim();
        return text && text.length <= limit && !/[\u0000-\u001f\u007f]/.test(text) ? text : '';
    }

    function eventSong(song) {
        if (!song || song.id === undefined || song.id === null || typeof song.id === 'boolean') return null;
        const songId = cleanText(song.id, 128);
        if (!songId) return null;
        const artist = Array.isArray(song.artists) ? song.artists[0] : (Array.isArray(song.ar) ? song.ar[0] : null);
        const album = song.album && typeof song.album === 'object' ? song.album : (song.al || null);
        const payload = {
            songId,
            platform: cleanText(song.platform || song.platformId, 40) || 'cloudmusic',
            artistId: cleanText(song.artistId || artist?.id, 128),
            artistName: cleanText(song.artist || artist?.name, 120),
            albumId: cleanText(song.albumId || album?.id, 128),
            albumName: cleanText(typeof song.album === 'string' ? song.album : album?.name, 120)
        };
        return payload;
    }

    function normalizeNumber(value, max) {
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 && number <= max ? Math.round(number * 1000) / 1000 : undefined;
    }

    async function flushEvents(opts) {
        if (!state.user || eventState.sending || !eventState.queue.length) return;
        const userId = state.user.userId;
        const version = eventState.version;
        const batch = eventState.queue.splice(0, 50);
        eventState.sending = true;
        const controller = new AbortController();
        eventState.controller = controller;
        try {
            await api('POST', '/api/recommend/events', { events: batch }, { keepalive: true, signal: controller.signal });
            if (eventState.version === version && state.user && state.user.userId === userId) eventState.failCount = 0;
        } catch (e) {
            if (eventState.version === version && state.user && state.user.userId === userId) {
                eventState.queue = batch.concat(eventState.queue).slice(-100);
                eventState.failCount++;
                if (eventState.failCount < 5) {
                    clearTimeout(eventState.timer);
                    eventState.timer = setTimeout(() => flushEvents(), 5000);
                }
                if (e.status === 401) {
                    state.user = null;
                    resetSyncState();
                    resetRecommendProfile();
                    renderBox();
                }
            }
        } finally {
            if (eventState.version === version) {
                eventState.sending = false;
                eventState.controller = null;
            }
        }
        if (eventState.version === version && state.user && state.user.userId === userId && eventState.queue.length) flushEvents();
    }

    function recordEvent(event, song, extra) {
        if (!state.user || !['play_start', 'play_progress', 'play_complete', 'play_skip', 'favorite_add', 'favorite_remove', 'playlist_add'].includes(event)) return;
        const base = eventSong(song);
        if (!base) return;
        const now = Date.now();
        const key = event + ':' + base.platform + ':' + base.songId;
        const data = Object.assign({ event, at: now }, base);
        const o = extra || {};
        const position = normalizeNumber(o.position, 86400);
        const duration = normalizeNumber(o.duration || song.duration, 86400);
        if (position !== undefined) data.position = position;
        if (duration !== undefined) data.duration = duration;
        const last = eventState.last[key];
        if (event === 'play_progress') {
            if (last && position !== undefined && last.position !== undefined && position >= last.position && position - last.position < 10) return;
        } else if (last && now - last.at < 1500) return;
        eventState.last[key] = { at: now, position };
        eventState.queue.push(data);
        if (eventState.queue.length > 100) eventState.queue.splice(0, eventState.queue.length - 100);
        if (eventState.queue.length >= 20) flushEvents();
        else {
            clearTimeout(eventState.timer);
            eventState.timer = setTimeout(() => flushEvents(), event === 'play_progress' ? 3000 : 1000);
        }
    }

    window.AerMusicRecommendEvents = { record: recordEvent, flush: flushEvents };

    /* ---------- 拉取 ---------- */
    async function pullAndRestore() {
        if (!state.user) return;
        const userId = state.user.userId;
        const restoreVersion = state.restoreVersion;
        state.restoring = true;
        try {
            const resp = await api('GET', '/api/library');
            if (!state.user || state.user.userId !== userId) return;
            const data = resp.data || {};
            const ts = readTS();
            let changed = false;
            Object.keys(KIND_KEYS).forEach((kind) => {
                const remote = data[kind];
                if (!remote) return;
                if (remote.updatedAt === 0 || remote.data === null || remote.data === undefined) {
                    if (remote.updatedAt !== 0 && (ts[kind] || 0) >= remote.updatedAt) return;
                    // 云端已清空: 移除本地键并记录时间戳, 保持多端一致
                    localStorage.removeItem(KIND_KEYS[kind]);
                    state.lastPushed[kind] = '';
                } else {
                    if ((ts[kind] || 0) >= (remote.updatedAt || 0)) return;
                    const raw = JSON.stringify(remote.data);
                    if (localStorage.getItem(KIND_KEYS[kind]) === raw) {
                        // 内容一致只推进时间戳, 避免多开设备互相触发刷新
                        ts[kind] = remote.updatedAt;
                        state.lastPushed[kind] = raw;
                        return;
                    }
                    localStorage.setItem(KIND_KEYS[kind], raw);
                    state.lastPushed[kind] = raw;
                }
                ts[kind] = remote.updatedAt;
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
            setTimeout(() => {
                if (state.restoreVersion === restoreVersion && state.user && state.user.userId === userId) state.restoring = false;
            }, 1000);
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

    async function pushAll(opts) {
        if (!state.user || state.restoring) return;
        const userId = state.user.userId;
        const o = opts || {};
        const ts = readTS();
        const now = Date.now();
        let anyFail = false;
        for (const kind of Object.keys(KIND_KEYS)) {
            if (!state.user || state.user.userId !== userId) return;
            const snap = snapshotKind(kind);
            if (snap === state.lastPushed[kind]) continue;
            try {
                const resp = await api('PUT', '/api/library/' + kind,
                    { data: snap === '' ? null : JSON.parse(snap), updatedAt: now },
                    { keepalive: !!o.keepalive });
                const applied = resp.data && resp.data.applied !== false;
                if (applied) {
                    state.lastPushed[kind] = snap;
                    ts[kind] = resp.data.updatedAt;
                    state.failCount = 0;
                } else {
                    // 服务端有更新的版本, 本地被拒: 拉取覆盖, 不标记已同步
                    anyFail = true;
                    await pullAndRestore();
                    return;
                }
            } catch (e) {
                anyFail = true;
                state.failCount++;
                console.warn('[CloudSync] 推送 ' + kind + ' 失败:', e.message);
                if (e.status === 401) {
                    state.user = null;
                    resetSyncState();
                    resetRecommendProfile();
                    renderBox();
                    return;
                }
                if (state.failCount >= 5) { toast('云同步失败次数过多, 已暂停自动同步'); return; }
            }
        }
        writeTS(ts);
        if (!anyFail) state.failCount = 0;
    }

    function watchLocal() {
        setInterval(() => {
            if (!state.user) return;
            for (const kind of Object.keys(KIND_KEYS)) {
                if (snapshotKind(kind) !== state.lastPushed[kind]) { schedulePush(kind); break; }
            }
        }, 3000);
        window.addEventListener('beforeunload', () => {
            if (state.user) {
                pushAll({ keepalive: true });
                flushEvents({ keepalive: true });
            }
        });
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
            const safeName = String(state.user.username).replace(/[^A-Za-z0-9_\u4e00-\u9fa5]/g, '');
            box.innerHTML = `
                <div style="display:flex; align-items:center; gap:1.5vh; flex-wrap:wrap;">
                    <span style="font-size:1.35vh; color:#fff;">已登录: ${safeName}</span>
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
            resetSyncState();
            resetRecommendProfile();
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
        resetSyncState();
        resetRecommendProfile();
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
                    recordEvent('play_start', song, { position: 0, duration: song && song.duration });
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
