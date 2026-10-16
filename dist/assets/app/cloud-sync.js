




(function () {
    const KIND_KEYS = {
        favorites: 'AerMusic_Favorites_Songs',
        playlists: 'AerMusic_Playlists',
        history: 'AerMusic_History'
    };
    const SYNC_TS_KEY = 'AerMusic_Sync_Timestamps';
    const LOCAL_BEHAVIOR_KEY = 'AerMusic_Recommend_Behavior';
    const LOCAL_EVENT_TYPES = new Set(['play_start', 'play_progress', 'play_complete', 'play_skip', 'favorite_add', 'favorite_remove', 'playlist_add', 'dislike', 'dislike_remove']);
    const PUSH_INTERVAL_MS = 60000;
    let lastPushAt = 0;
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
        clearTimeout(edgeState.timer);
        edgeState.timer = null;
        if (edgeState.controller) edgeState.controller.abort();
        edgeState.controller = null;
        edgeState.queue = [];
        edgeState.sending = false;
        edgeState.version++;
        edgeState.last = Object.create(null);
        edgeState.failCount = 0;
        edgeState.local.clear();
        state.restoreVersion++;
        state.restoring = false;
        state.lastPushed = {};
        writeTS({});
        lastPushAt = 0;
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

    function recordLocalEvent(event, base, position, duration, at) {
        if (!LOCAL_EVENT_TYPES.has(event) || !base || !/^\d{1,15}$/.test(base.songId)) return;
        let list = [];
        try {
            const raw = JSON.parse(localStorage.getItem(LOCAL_BEHAVIOR_KEY) || '[]');
            if (Array.isArray(raw)) list = raw;
        } catch (e) {}
        const item = { event, at, songId: base.songId, platform: base.platform };
        if (base.artistId) item.artistId = base.artistId;
        if (base.artistName) item.artistName = base.artistName;
        if (base.albumId) item.albumId = base.albumId;
        if (base.albumName) item.albumName = base.albumName;
        if (position !== undefined) item.position = position;
        if (duration !== undefined) item.duration = duration;
        list.push(item);
        try { localStorage.setItem(LOCAL_BEHAVIOR_KEY, JSON.stringify(list.slice(-120))); } catch (e) {}
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
                    setUser(null);
                    resetSyncState();
                    resetRecommendProfile();
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
        if (!['play_start', 'play_progress', 'play_complete', 'play_skip', 'favorite_add', 'favorite_remove', 'playlist_add', 'dislike', 'dislike_remove', 'search', 'view_song', 'view_artist', 'view_album', 'playlist_create', 'playlist_update', 'playlist_delete', 'playlist_play'].includes(event)) return;
        if (!state.user && !LOCAL_EVENT_TYPES.has(event)) return;
        const base = eventSong(song);
        if (!base) return;
        const now = Date.now();
        const key = event + ':' + base.platform + ':' + base.songId;
        const eventId = now.toString(36) + '-' + Math.random().toString(36).slice(2, 14);
        const data = Object.assign({ event, eventId, at: now }, base);
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
        if (!state.user) {
            recordLocalEvent(event, base, position, duration, now);
            if (Object.keys(eventState.last).length > 512) eventState.last = Object.create(null);
            return;
        }
        eventState.queue.push(data);
        if (eventState.queue.length > 150) eventState.queue.splice(0, eventState.queue.length - 150);
        
        if (eventState.queue.length >= 40) flushEvents();
        else {
            clearTimeout(eventState.timer);
            eventState.timer = setTimeout(() => flushEvents(), event === 'play_progress' ? 8000 : 6000);
        }
    }

    window.AerMusicRecommendEvents = { record: recordEvent, flush: flushEvents };
    
    const authListeners = [];
    function notifyAuthChanged() {
        const user = (state && state.user) ? state.user : null;
        authListeners.forEach((fn) => { try { fn(user); } catch (e) {} });
    }
    function setUser(user) {
        state.user = user || null;
        notifyAuthChanged();
    }

    let mePending = null;
    function fetchMe() {
        if (mePending) return mePending;
        mePending = api('GET', '/api/user/me').then((resp) => {
            setUser(resp.data);
            return state.user;
        }).catch((e) => {
            if (e.status === 401) setUser(null);
            throw e;
        }).finally(() => { mePending = null; });
        return mePending;
    }

    async function afterAuth(data) {
        setUser(data);
        resetSyncState();
        resetRecommendProfile();
        await pullAndRestore();
        return state.user;
    }

    async function login(username, password) {
        const resp = await api('POST', '/api/user/login', { username: username, password: password });
        return afterAuth(resp.data);
    }

    async function register(payload) {
        const resp = await api('POST', '/api/user/register', payload);
        return afterAuth(resp.data);
    }

    async function logout() {
        try { await api('POST', '/api/user/logout'); } catch (e) {}
        setUser(null);
        resetSyncState();
        resetRecommendProfile();
    }

    function updateProfile(profile) { return api('PUT', '/api/user/profile', profile); }
    function sendEmailCode(email) { return api('POST', '/api/user/email/code', { email: email }); }
    function uploadAvatar(dataUrl) { return api('POST', '/api/user/avatar', { dataUrl: dataUrl }); }

    window.AerMusicCloud = {
        getUser: () => (state && state.user) ? state.user : null,
        onAuthChanged: (fn) => { if (typeof fn === 'function' && authListeners.indexOf(fn) < 0) authListeners.push(fn); },
        api: api,
        fetchMe: fetchMe,
        login: login,
        register: register,
        logout: logout,
        updateProfile: updateProfile,
        sendEmailCode: sendEmailCode,
        uploadAvatar: uploadAvatar
    };

    
    window.AerMusicCloud.onAuthChanged(() => { try { window.app && window.app._ensurePlaylistIds && window.app._ensurePlaylistIds(); } catch (e) {} });

    const edgeState = { queue: [], timer: null, sending: false, version: 0, controller: null, failCount: 0, local: new Map(), last: Object.create(null) };

    function edgeSongId(song) {
        if (!song || song.id === undefined || song.id === null || typeof song.id === 'boolean') return '';
        return cleanText(song.id, 128);
    }

    function edgeSongKey(song) {
        const id = edgeSongId(song);
        if (!id) return '';
        return (cleanText(song.platform || song.platformId, 40) || 'cloudmusic') + ':id:' + id;
    }

    function recordEdge(src, dst, seconds) {
        if (!state.user) return;
        const dstId = edgeSongId(dst);
        if (!dstId) return;
        const dstKey = edgeSongKey(dst);
        if (!dstKey) return;
        const srcKey = typeof src === 'string'
            ? (src.startsWith('kw:') && cleanText(src.slice(3), 64) ? 'kw:' + cleanText(src.slice(3), 64) : '')
            : edgeSongKey(src);
        if (!srcKey) return;
        const number = Number(seconds);
        const weight = Number.isFinite(number) && number > 0 ? Math.min(600, Math.round(number * 1000) / 1000) : 0;
        if (weight <= 0) return;
        const now = Date.now();
        const dedupeKey = srcKey + '>' + dstKey;
        if (edgeState.last[dedupeKey] && now - edgeState.last[dedupeKey] < 30000) return;
        edgeState.last[dedupeKey] = now;
        const entry = edgeState.local.get(dstKey);
        if (entry) entry.srcs.set(srcKey, Math.max(entry.srcs.get(srcKey) || 0, weight));
        else {
            edgeState.local.set(dstKey, { srcs: new Map([[srcKey, weight]]) });
            if (edgeState.local.size > 200) edgeState.local.delete(edgeState.local.keys().next().value);
        }
        edgeState.queue.push({ src: srcKey, dst: dstId, platform: (cleanText(dst.platform || dst.platformId, 40) || 'cloudmusic'), seconds: weight });
        if (edgeState.queue.length > 100) edgeState.queue.splice(0, edgeState.queue.length - 100);
        if (edgeState.queue.length >= 20) flushEdges();
        else {
            clearTimeout(edgeState.timer);
            edgeState.timer = setTimeout(() => flushEdges(), 2000);
        }
    }

    async function flushEdges() {
        if (!state.user || edgeState.sending || !edgeState.queue.length) return;
        const userId = state.user.userId;
        const version = edgeState.version;
        const batch = edgeState.queue.splice(0, 50);
        edgeState.sending = true;
        const controller = new AbortController();
        edgeState.controller = controller;
        try {
            await api('POST', '/api/recommend/edges', { edges: batch }, { keepalive: true, signal: controller.signal });
            if (edgeState.version === version && state.user && state.user.userId === userId) edgeState.failCount = 0;
        } catch (e) {
            if (edgeState.version === version && state.user && state.user.userId === userId) {
                edgeState.queue = batch.concat(edgeState.queue).slice(-100);
                edgeState.failCount++;
                if (edgeState.failCount < 5) {
                    clearTimeout(edgeState.timer);
                    edgeState.timer = setTimeout(() => flushEdges(), 5000);
                }
                if (e.status === 401) {
                    setUser(null);
                    resetSyncState();
                    resetRecommendProfile();
                }
            }
        } finally {
            if (edgeState.version === version) {
                edgeState.sending = false;
                edgeState.controller = null;
            }
        }
        if (edgeState.version === version && state.user && state.user.userId === userId && edgeState.queue.length) flushEdges();
    }

    window.AerMusicRecommendEdges = { record: recordEdge, flush: flushEdges, local: edgeState.local };

    
    
    function hotApply(kinds) {
        const app = window.app;
        if (!app) return;
        const read = (key, dft) => { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? dft : v; } catch (e) { return dft; } };
        if (kinds.indexOf('favorites') >= 0) {
            app.favoriteSongs = read(KIND_KEYS.favorites, []);
            try { if (app.refreshAllFavoriteButtons) app.refreshAllFavoriteButtons(); } catch (e) {}
            try { if (app.page === 'favorites' && app.renderFavoritesPage) app.renderFavoritesPage(); } catch (e) {}
        }
        if (kinds.indexOf('playlists') >= 0) {
            app.userPlaylists = read(KIND_KEYS.playlists, []);
            try { if (app._ensurePlaylistIds) app._ensurePlaylistIds(); } catch (e) {}
            try { if (app.page === 'playlists' && app.showPlaylistsList) app.showPlaylistsList(); } catch (e) {}
        }
    }

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
            const changedKinds = [];
            Object.keys(KIND_KEYS).forEach((kind) => {
                const remote = data[kind];
                if (!remote) return;
                if (remote.updatedAt === 0 || remote.data === null || remote.data === undefined) {
                    if (remote.updatedAt !== 0 && (ts[kind] || 0) >= remote.updatedAt) return;
                    
                    localStorage.removeItem(KIND_KEYS[kind]);
                    state.lastPushed[kind] = '';
                } else {
                    if ((ts[kind] || 0) >= (remote.updatedAt || 0)) return;
                    const raw = JSON.stringify(remote.data);
                    if (localStorage.getItem(KIND_KEYS[kind]) === raw) {
                        
                        ts[kind] = remote.updatedAt;
                        state.lastPushed[kind] = raw;
                        return;
                    }
                    localStorage.setItem(KIND_KEYS[kind], raw);
                    state.lastPushed[kind] = raw;
                }
                ts[kind] = remote.updatedAt;
                changed = true;
                changedKinds.push(kind);
            });
            writeTS(ts);
            if (changed) {
                toast('已从云端恢复数据');
                hotApply(changedKinds);
            }
        } catch (e) {
            console.warn('[CloudSync] 拉取失败:', e.message);
        } finally {
            setTimeout(() => {
                if (state.restoreVersion === restoreVersion && state.user && state.user.userId === userId) state.restoring = false;
            }, 1000);
        }
    }

    
    function snapshotKind(kind) {
        const raw = localStorage.getItem(KIND_KEYS[kind]);
        return raw === null ? '' : raw;
    }

    function schedulePush(kind) {
        const wait = Math.max(0, PUSH_INTERVAL_MS - (Date.now() - lastPushAt));
        clearTimeout(state.pushTimer);
        state.pushTimer = setTimeout(() => pushAll(), wait);
    }

    async function pushAll(opts) {
        if (!state.user || state.restoring) return;
        lastPushAt = Date.now();
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
                    
                    anyFail = true;
                    await pullAndRestore();
                    return;
                }
            } catch (e) {
                anyFail = true;
                state.failCount++;
                console.warn('[CloudSync] 推送 ' + kind + ' 失败:', e.message);
                if (e.status === 401) {
                    setUser(null);
                    resetSyncState();
                    resetRecommendProfile();
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
                flushEdges();
            }
        });
    }

    
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

    
    async function boot() {
        try {
            await fetchMe();
            await pullAndRestore();
        } catch (e) {}
        watchLocal();
        
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
