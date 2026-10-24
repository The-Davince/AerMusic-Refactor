




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
    const EVENT_PUSH_DELAY_MS = 10000;
    let lastPushAt = 0;
    let readyResolve = null;
    let pullPromise = null;
    let pullForce = false;
    let forcePullPromise = null;
    const readyPromise = new Promise((resolve) => { readyResolve = resolve; });
    const state = { user: null, pushTimer: null, favoriteTimer: null, favoriteChanges: [], favoriteSending: false, favoriteVersion: 0, favoriteController: null, favoriteFailCount: 0, lastPushed: {}, restoring: false, failCount: 0, restoreVersion: 0 };
    const eventState = { queue: [], timer: null, sending: false, version: 0, controller: null, last: Object.create(null), failCount: 0 };

    function readTS() {
        try { return JSON.parse(localStorage.getItem(SYNC_TS_KEY) || '{}'); } catch (e) { return {}; }
    }
    function writeTS(ts) { try { localStorage.setItem(SYNC_TS_KEY, JSON.stringify(ts)); } catch (e) {} }
    function resetSyncState() {
        clearTimeout(state.pushTimer);
        state.pushTimer = null;
        clearTimeout(state.favoriteTimer);
        state.favoriteTimer = null;
        if (state.favoriteController) state.favoriteController.abort();
        state.favoriteController = null;
        state.favoriteChanges = [];
        state.favoriteSending = false;
        state.favoriteVersion++;
        state.favoriteFailCount = 0;
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
        pullPromise = null;
        pullForce = false;
        forcePullPromise = null;
        writeTS({});
        lastPushAt = 0;
        state.failCount = 0;
    }

    function favoriteChangeSong(song) {
        if (!song || song.id === undefined || song.id === null) return null;
        const result = {
            id: song.id,
            name: cleanText(song.name, 300),
            artist: cleanText(song.artist, 300),
            cover: cleanText(song.cover, 1000),
            platform: cleanText(song.platform || song.platformId, 40) || 'cloudmusic',
            favoriteTime: cleanText(song.favoriteTime, 40),
            playCount: Number.isFinite(Number(song.playCount)) ? Math.max(0, Math.min(1000000, Number(song.playCount))) : 0,
            firstPlayTime: cleanText(song.firstPlayTime, 40),
            duration: normalizeNumber(song.duration, 86400)
        };
        if (song.rawSong && typeof song.rawSong === 'object') {
            result.rawSong = {
                id: song.rawSong.id,
                name: cleanText(song.rawSong.name, 300),
                artist: cleanText(song.rawSong.artist, 300),
                cover: cleanText(song.rawSong.cover, 1000),
                platform: cleanText(song.rawSong.platform || song.rawSong.platformId, 40) || 'cloudmusic',
                duration: normalizeNumber(song.rawSong.duration, 86400),
                album: cleanText(song.rawSong.album, 300),
                albumId: song.rawSong.albumId,
                artists: Array.isArray(song.rawSong.artists) ? song.rawSong.artists.slice(0, 20) : undefined,
                ar: Array.isArray(song.rawSong.ar) ? song.rawSong.ar.slice(0, 20) : undefined,
                al: song.rawSong.al && typeof song.rawSong.al === 'object' ? {
                    id: song.rawSong.al.id,
                    name: cleanText(song.rawSong.al.name, 300),
                    picUrl: cleanText(song.rawSong.al.picUrl, 1000)
                } : undefined,
                dt: normalizeNumber(song.rawSong.dt, 86400000),
                picUrl: cleanText(song.rawSong.picUrl, 1000)
            };
        }
        return result;
    }

    function scheduleFavoritePush() {
        clearTimeout(state.favoriteTimer);
        state.favoriteTimer = setTimeout(() => flushFavoriteChanges(), 300);
    }

    function scheduleEventFlush(delay) {
        clearTimeout(eventState.timer);
        eventState.timer = setTimeout(() => {
            eventState.timer = null;
            flushEvents();
        }, delay);
    }

    function markFavoriteChange(change) {
        if (!state.user || !change || !change.op) return;
        if (change.op === 'upsert') {
            const song = favoriteChangeSong(change.song);
            if (!song) return;
            change = { op: 'upsert', song: song };
        }
        state.favoriteChanges.push(change);
        if (state.favoriteChanges.length > 100) state.favoriteChanges.splice(0, state.favoriteChanges.length - 100);
        scheduleFavoritePush();
    }

    async function flushFavoriteChanges(opts) {
        if (!state.user || state.favoriteSending || !state.favoriteChanges.length) return;
        const userId = state.user.userId;
        const version = state.favoriteVersion;
        const batch = state.favoriteChanges.splice(0, 50);
        state.favoriteSending = true;
        let retryScheduled = false;
        const controller = new AbortController();
        state.favoriteController = controller;
        try {
            const resp = await api('PUT', '/api/library/favorites', { changes: batch, updatedAt: Date.now() }, { keepalive: !!(opts && opts.keepalive), signal: controller.signal });
            const applied = !resp.data || resp.data.applied !== false;
            if (applied && state.favoriteVersion === version && state.user && state.user.userId === userId) {
                const ts = readTS();
                if (resp.data && resp.data.updatedAt) {
                    ts.favorites = resp.data.updatedAt;
                    writeTS(ts);
                }
                state.lastPushed.favorites = snapshotKind('favorites');
                state.favoriteFailCount = 0;
            }
            if (!applied && state.favoriteVersion === version && state.user && state.user.userId === userId) await pullAndRestore();
        } catch (e) {
            if (state.favoriteVersion === version && state.user && state.user.userId === userId) {
                state.favoriteChanges = batch.concat(state.favoriteChanges).slice(-100);
                state.favoriteFailCount++;
                if (state.favoriteFailCount < 5) {
                    retryScheduled = true;
                    clearTimeout(state.favoriteTimer);
                    state.favoriteTimer = setTimeout(() => flushFavoriteChanges(), 5000);
                } else retryScheduled = true;
                if (e.status === 401) {
                    setUser(null);
                    resetSyncState();
                    resetRecommendProfile();
                }
            }
        } finally {
            if (state.favoriteVersion === version) {
                state.favoriteSending = false;
                state.favoriteController = null;
            }
        }
        if (!retryScheduled && state.favoriteVersion === version && state.user && state.user.userId === userId && state.favoriteChanges.length) flushFavoriteChanges();
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

    function eventTags(song) {
        const result = [];
        const add = (value, prefix, depth = 0) => {
            if (depth > 4) return;
            if (Array.isArray(value)) return value.forEach(item => add(item, prefix, depth + 1));
            if (value && typeof value === 'object') return add(value.name || value.value || value.label || value.tag || value.genre || value.category, prefix, depth + 1);
            if (typeof value !== 'string') return;
            value.split(/[,，、|]/).forEach(item => {
                const text = cleanText(item, 64).toLowerCase();
                const key = /^(tag|genre|category):/.test(text) ? text : `${prefix}:${text}`;
                if (text && !result.includes(key)) result.push(key);
            });
        };
        add(song.tags, 'tag');
        add(song.tag, 'tag');
        add(song.genre, 'genre');
        add(song.genres, 'genre');
        add(song.category, 'category');
        add(song.categories, 'category');
        return result.slice(0, 16);
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
            albumName: cleanText(typeof song.album === 'string' ? song.album : album?.name, 120),
            tags: eventTags(song)
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
        if (base.tags.length) item.tags = base.tags;
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
                    scheduleEventFlush(5000);
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
        if (eventState.version === version && state.user && state.user.userId === userId && eventState.queue.length && !eventState.timer) scheduleEventFlush(EVENT_PUSH_DELAY_MS);
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
        } else if (!o.force && last && now - last.at < 1500) return;
        eventState.last[key] = { at: now, position };
        if (!state.user) {
            recordLocalEvent(event, base, position, duration, now);
            if (Object.keys(eventState.last).length > 512) eventState.last = Object.create(null);
            return;
        }
        eventState.queue.push(data);
        if (eventState.queue.length > 150) eventState.queue.splice(0, eventState.queue.length - 150);
        
        scheduleEventFlush(EVENT_PUSH_DELAY_MS);
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
        waitReady: () => readyPromise,
        onAuthChanged: (fn) => { if (typeof fn === 'function' && authListeners.indexOf(fn) < 0) authListeners.push(fn); },
        api: api,
        fetchMe: fetchMe,
        refresh: async () => { if (!state.user) return; await pullAndRestore('playlists'); },
        login: login,
        register: register,
        logout: logout,
        updateProfile: updateProfile,
        sendEmailCode: sendEmailCode,
        uploadAvatar: uploadAvatar,
        markFavoriteChange: markFavoriteChange,
        favoriteChangeSong: favoriteChangeSong
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
        try { if (app._compactStoredSongs) app._compactStoredSongs(); } catch (e) {}
    }

    function pullAndRestore(forceKind) {
        if (!state.user) return Promise.resolve();
        if (pullPromise) {
            if (!forceKind || pullForce === forceKind) return pullPromise;
            if (forcePullPromise) return forcePullPromise;
            forcePullPromise = pullPromise.catch(() => {}).then(() => {
                forcePullPromise = null;
                return pullAndRestore(forceKind);
            });
            return forcePullPromise;
        }
        const task = pullOnce(forceKind);
        pullPromise = task;
        pullForce = forceKind || false;
        const clear = () => { if (pullPromise === task) { pullPromise = null; pullForce = false; } };
        task.then(clear, clear);
        return task;
    }

    function parsePlaylistArray(raw) {
        try {
            const value = JSON.parse(raw || '[]');
            return Array.isArray(value) ? value : [];
        } catch (e) {
            return [];
        }
    }

    function playlistKeys(pl) {
        const keys = [];
        if (pl && pl.uuid) keys.push('u:' + pl.uuid);
        if (pl && pl.id !== undefined && pl.id !== null && pl.id !== '') keys.push('i:' + pl.id);
        return keys;
    }

    function playlistFingerprint(pl) {
        if (!pl || typeof pl !== 'object') return '';
        const songs = Array.isArray(pl.songs) ? pl.songs : [];
        const ids = songs.map(song => song && song.id).filter(id => id !== undefined && id !== null && id !== '').map(String).sort();
        return [pl.name || '', pl.createTime || '', ids.join(',')].join('|');
    }

    function readPlaylistDeletions() {
        let value = {};
        try {
            const parsed = JSON.parse(localStorage.getItem('AerMusic_Playlist_Deletions') || '{}');
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) value = parsed;
        } catch (e) {
            value = {};
        }
        try {
            const runtime = window.app && typeof window.app._allPlaylistDeletions === 'function' ? window.app._allPlaylistDeletions() : null;
            if (runtime && typeof runtime === 'object') Object.keys(runtime).forEach(key => { value[key] = runtime[key]; });
        } catch (e) {}
        const now = Date.now();
        Object.keys(value).forEach(key => {
            if (now - Number(value[key] || 0) > 30 * 24 * 60 * 60 * 1000) delete value[key];
        });
        return value;
    }

    function mergePlaylists(local, remote) {
        if (!Array.isArray(remote)) return remote;
        const result = Array.isArray(local) ? local.slice() : [];
        const deletions = readPlaylistDeletions();
        const seen = new Set();
        const fingerprints = new Set();
        result.forEach(pl => {
            playlistKeys(pl).forEach(key => seen.add(key));
            fingerprints.add(playlistFingerprint(pl));
        });
        remote.forEach(pl => {
            const keys = playlistKeys(pl);
            if (keys.some(key => deletions[key])) return;
            if (keys.some(key => seen.has(key))) return;
            const incomplete = !pl || !pl.uuid || pl.id === undefined || pl.id === null || pl.id === '';
            if (incomplete && fingerprints.has(playlistFingerprint(pl))) return;
            keys.forEach(key => seen.add(key));
            fingerprints.add(playlistFingerprint(pl));
            result.push(pl);
        });
        return result;
    }

    function filterDeletedPlaylists(list) {
        if (!Array.isArray(list)) return list;
        const deletions = readPlaylistDeletions();
        return list.filter(pl => !playlistKeys(pl).some(key => deletions[key]));
    }


    async function pullOnce(forceKind) {
        if (!state.user) return;
        const userId = state.user.userId;
        const restoreVersion = state.restoreVersion;
        state.restoring = true;
        try {
            const resp = await api('GET', '/api/library');
            if (!state.user || state.user.userId !== userId || state.restoreVersion !== restoreVersion) return;
            const data = resp.data || {};
            const ts = readTS();
            let changed = false;
            const changedKinds = [];
            Object.keys(KIND_KEYS).forEach((kind) => {
                if (forceKind && forceKind !== true && kind !== forceKind) return;
                const force = forceKind === true || forceKind === kind;
                const remote = data[kind];
                if (!remote) return;
                if (remote.updatedAt === 0 || remote.data === null || remote.data === undefined) {
                    if (remote.updatedAt === 0) {
                        if (force) return;
                    } else if (!force && (ts[kind] || 0) >= remote.updatedAt) {
                        return;
                    }
                    localStorage.removeItem(KIND_KEYS[kind]);
                    state.lastPushed[kind] = '';
                } else {
                    if (!force && (ts[kind] || 0) >= (remote.updatedAt || 0)) return;
                    const localRaw = localStorage.getItem(KIND_KEYS[kind]);
                    const dirtyForce = force && kind === 'playlists' && localRaw !== null && localRaw !== (state.lastPushed[kind] ?? null);
                    const remoteData = kind === 'playlists' ? filterDeletedPlaylists(remote.data) : remote.data;
                    const deletedFiltered = kind === 'playlists' && Array.isArray(remote.data) && Array.isArray(remoteData) && remoteData.length !== remote.data.length;
                    const needsPush = dirtyForce || deletedFiltered;
                    const nextData = dirtyForce ? mergePlaylists(filterDeletedPlaylists(parsePlaylistArray(localRaw)), remote.data) : remoteData;
                    const raw = JSON.stringify(nextData);
                    if (localRaw === raw) {
                        ts[kind] = remote.updatedAt;
                        state.lastPushed[kind] = needsPush ? '' : raw;
                        return;
                    }
                    localStorage.setItem(KIND_KEYS[kind], raw);
                    state.lastPushed[kind] = needsPush ? '' : raw;
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
        for (const kind of ['playlists', 'history']) {
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
                    if (kind === 'playlists') {
                        try { localStorage.removeItem('AerMusic_Playlist_Deletions'); } catch (e) {}
                        try { if (window.app && typeof window.app._clearSessionPlaylistDeletions === 'function') window.app._clearSessionPlaylistDeletions(); } catch (e) {}
                    }
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
            for (const kind of ['playlists', 'history']) {
                if (snapshotKind(kind) !== state.lastPushed[kind]) { schedulePush(kind); break; }
            }
        }, 3000);
        window.addEventListener('beforeunload', () => {
            if (state.user) {
                pushAll({ keepalive: true });
                flushFavoriteChanges({ keepalive: true });
                flushEvents({ keepalive: true });
                flushEdges();
            }
        });
        window.addEventListener('storage', (e) => {
            if (!e) return;
            if (e.key === 'AerMusic_Playlist_Deletions' || e.key === 'AerMusic_Playlists') {
                try { if (window.app && typeof window.app.applyPlaylistDeletions === 'function') window.app.applyPlaylistDeletions(); } catch (err) {}
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
        try { localStorage.setItem(KIND_KEYS.history, JSON.stringify(list)); } catch (e) {}
    }

    
    async function boot() {
        try {
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
        } finally {
            if (readyResolve) {
                readyResolve();
                readyResolve = null;
            }
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
