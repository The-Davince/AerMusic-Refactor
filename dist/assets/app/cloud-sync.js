




(function () {
    const KIND_KEYS = {
        favorites: 'AerMusic_Favorites_Songs',
        playlists: 'AerMusic_Playlists',
        history: 'AerMusic_History'
    };
    const SYNC_TS_KEY = 'AerMusic_Sync_Timestamps';
    const LOCAL_BEHAVIOR_KEY = 'AerMusic_Recommend_Behavior';
    const SNAPSHOT_KEYS = {
        favorites: 'AerMusic_Favorites_Songs',
        favoritePlaylists: 'AerMusic_Favorites_Playlists',
        playlists: 'AerMusic_Playlists',
        history: 'AerMusic_History',
        playlistDeletions: 'AerMusic_Playlist_Deletions',
        syncTimestamps: SYNC_TS_KEY,
        recommendBehavior: LOCAL_BEHAVIOR_KEY,
        reduceRecommend: 'AerMusic_ReduceRecommend_Songs',
        recommendSession: 'AerMusic_Recommend_Session',
        searchHistory: 'AerMusic_SearchHistory',
        lastSong: 'AerMusic_LastSong'
    };
    const SNAPSHOT_PREFIX = 'AerMusic_Data_v1:';
    const ACTIVE_PRINCIPAL_KEY = 'AerMusic_ActivePrincipal';
    const GUEST_TOKEN_KEY = 'AerMusic_Guest_Token';
    const GUEST_ID_KEY = 'AerMusic_Guest_Id';
    const LOCAL_EVENT_TYPES = new Set(['play_start', 'play_progress', 'play_complete', 'play_skip', 'favorite_add', 'favorite_remove', 'playlist_add', 'dislike', 'dislike_remove']);
    const PUSH_INTERVAL_MS = 60000;
    const EVENT_PUSH_DELAY_MS = 10000;
    let lastPushAt = 0;
    let readyResolve = null;
    let pullPromise = null;
    let pullForce = false;
    let forcePullPromise = null;
    const readyPromise = new Promise((resolve) => { readyResolve = resolve; });
    const state = { user: null, principal: null, principalId: '', guestPromise: null, guestFailAt: 0, guestServerData: false, pushTimer: null, favoriteTimer: null, favoriteChanges: [], favoriteSending: false, favoriteVersion: 0, favoriteController: null, favoriteFailCount: 0, lastPushed: {}, restoring: false, failCount: 0, restoreVersion: 0 };
    const eventState = { queue: [], timer: null, sending: false, version: 0, controller: null, last: Object.create(null), failCount: 0 };

    function readTS() {
        try { return JSON.parse(localStorage.getItem(SYNC_TS_KEY) || '{}'); } catch (e) { return {}; }
    }
    function writeTS(ts) { try { localStorage.setItem(SYNC_TS_KEY, JSON.stringify(ts)); } catch (e) {} }

    function principalFromKey(key) {
        if (!key) return null;
        if (key === 'guest:pending') return { id: 0, isGuest: true, key };
        if (key.indexOf('user:') === 0) {
            const id = Number(key.slice(5));
            return id > 0 ? { id: id, isGuest: false, key: key } : null;
        }
        if (key.indexOf('guest:') === 0) {
            const id = Number(key.slice(6));
            return id > 0 ? { id: id, isGuest: true, key: key } : null;
        }
        return null;
    }

    function principalId() {
        return state.principal ? state.principal.id : 0;
    }

    function hasPrincipal() {
        return principalId() > 0;
    }

    function snapshotKey(principal, name) {
        return SNAPSHOT_PREFIX + principal + ':' + name;
    }

    function saveActiveSnapshot(principal) {
        if (!principal) return;
        Object.keys(SNAPSHOT_KEYS).forEach(name => {
            try {
                const key = snapshotKey(principal, name);
                const raw = localStorage.getItem(SNAPSHOT_KEYS[name]);
                if (raw === null) localStorage.removeItem(key);
                else localStorage.setItem(key, raw);
            } catch (e) {}
        });
    }

    function loadSnapshotIntoFixed(principal) {
        Object.keys(SNAPSHOT_KEYS).forEach(name => {
            try {
                const raw = localStorage.getItem(snapshotKey(principal, name));
                if (raw === null) localStorage.removeItem(SNAPSHOT_KEYS[name]);
                else localStorage.setItem(SNAPSHOT_KEYS[name], raw);
            } catch (e) {}
        });
        try { sessionStorage.removeItem('AerMusic_Playlist_Deletions'); } catch (e) {}
    }

    function activatePrincipal(key) {
        const next = principalFromKey(key);
        if (!next) return;
        if (state.principalId === key) {
            state.principal = next;
            return;
        }
        if (state.principalId) saveActiveSnapshot(state.principalId);
        state.principalId = key;
        state.principal = next;
        try { localStorage.setItem(ACTIVE_PRINCIPAL_KEY, key); } catch (e) {}
        loadSnapshotIntoFixed(key);
        state.lastPushed = {};
        state.restoring = false;
        resetRecommendProfile();
        hotApply(['favorites', 'favoritePlaylists', 'playlists', 'history']);
    }

    function migratePendingToGuest(guestId) {
        const target = 'guest:' + guestId;
        if (state.principalId === 'guest:pending') {
            saveActiveSnapshot('guest:pending');
            Object.keys(SNAPSHOT_KEYS).forEach(name => {
                try {
                    const raw = localStorage.getItem(snapshotKey('guest:pending', name));
                    if (raw === null) localStorage.removeItem(snapshotKey(target, name));
                    else localStorage.setItem(snapshotKey(target, name), raw);
                } catch (e) {}
            });
            state.principalId = target;
            state.principal = { id: guestId, isGuest: true, key: target };
            try { localStorage.setItem(ACTIVE_PRINCIPAL_KEY, target); } catch (e) {}
            try { localStorage.setItem(GUEST_ID_KEY, String(guestId)); } catch (e) {}
            return;
        }
        activatePrincipal(target);
        try { localStorage.setItem(GUEST_ID_KEY, String(guestId)); } catch (e) {}
    }

    function readGuestToken() {
        try { return localStorage.getItem(GUEST_TOKEN_KEY) || ''; } catch (e) { return ''; }
    }

    function setGuestToken(token) {
        try { if (token) localStorage.setItem(GUEST_TOKEN_KEY, token); } catch (e) {}
    }

    function clearGuestToken() {
        try { localStorage.removeItem(GUEST_TOKEN_KEY); localStorage.removeItem(GUEST_ID_KEY); } catch (e) {}
    }

    function initPrincipal() {
        let key = '';
        try { key = localStorage.getItem(ACTIVE_PRINCIPAL_KEY) || ''; } catch (e) {}
        if (!key) {
            key = 'guest:pending';
            state.principalId = key;
            state.principal = { id: 0, isGuest: true, key: key };
            try { localStorage.setItem(ACTIVE_PRINCIPAL_KEY, key); } catch (e) {}
            return;
        }
        if (key === 'guest:pending') {
            let cached = 0;
            try { cached = Number(localStorage.getItem(GUEST_ID_KEY) || 0); } catch (e) {}
            if (cached > 0) {
                key = 'guest:' + cached;
                loadSnapshotIntoFixed(key);
            }
        }
        const parsed = principalFromKey(key) || { id: 0, isGuest: true, key: 'guest:pending' };
        state.principalId = parsed.key;
        state.principal = parsed;
        try { localStorage.setItem(ACTIVE_PRINCIPAL_KEY, parsed.key); } catch (e) {}
    }
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
        if (!change || !change.op) return;
        if (change.op === 'upsert') {
            const song = favoriteChangeSong(change.song);
            if (!song) return;
            change = { op: 'upsert', song: song };
        }
        state.favoriteChanges.push(change);
        if (state.favoriteChanges.length > 100) state.favoriteChanges.splice(0, state.favoriteChanges.length - 100);
        if (!hasPrincipal()) {
            ensureGuest().then(() => flushFavoriteChanges());
            return;
        }
        scheduleFavoritePush();
    }

    async function flushFavoriteChanges(opts) {
        if (!hasPrincipal() || state.favoriteSending || !state.favoriteChanges.length) return;
        const userId = principalId();
        const version = state.favoriteVersion;
        const batch = state.favoriteChanges.splice(0, 50);
        state.favoriteSending = true;
        let retryScheduled = false;
        const controller = new AbortController();
        state.favoriteController = controller;
        try {
            const resp = await api('PUT', '/api/library/favorites', { changes: batch, updatedAt: Date.now() }, { keepalive: !!(opts && opts.keepalive), signal: controller.signal });
            const applied = !resp.data || resp.data.applied !== false;
            if (applied && state.favoriteVersion === version && state.principal && state.principal.id === userId) {
                const ts = readTS();
                if (resp.data && resp.data.updatedAt) {
                    ts.favorites = resp.data.updatedAt;
                    writeTS(ts);
                }
                state.lastPushed.favorites = snapshotKind('favorites');
                state.favoriteFailCount = 0;
            }
            if (!applied && state.favoriteVersion === version && state.principal && state.principal.id === userId) await pullAndRestore();
        } catch (e) {
            if (state.favoriteVersion === version && state.principal && state.principal.id === userId) {
                state.favoriteChanges = batch.concat(state.favoriteChanges).slice(-100);
                state.favoriteFailCount++;
                if (state.favoriteFailCount < 5) {
                    retryScheduled = true;
                    clearTimeout(state.favoriteTimer);
                    state.favoriteTimer = setTimeout(() => flushFavoriteChanges(), 5000);
                } else retryScheduled = true;
                if (e.status === 401) {
                    handleAuthLost();
                }
            }
        } finally {
            if (state.favoriteVersion === version) {
                state.favoriteSending = false;
                state.favoriteController = null;
            }
        }
        if (!retryScheduled && state.favoriteVersion === version && state.principal && state.principal.id === userId && state.favoriteChanges.length) flushFavoriteChanges();
    }

    function api(method, url, body, opts) {
        const o = opts || {};
        const init = { method, headers: Object.assign({}, o.headers || {}), keepalive: !!o.keepalive, signal: o.signal };
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

    function handleAuthLost() {
        const lostGuest = state.principal && state.principal.isGuest && state.principal.id > 0 ? state.principalId : '';
        if (state.principal && state.principal.isGuest) clearGuestToken();
        setUser(null);
        if (lostGuest) {
            saveActiveSnapshot(lostGuest);
            Object.keys(SNAPSHOT_KEYS).forEach(name => {
                try {
                    const raw = localStorage.getItem(snapshotKey(lostGuest, name));
                    if (raw !== null) localStorage.setItem(snapshotKey('guest:pending', name), raw);
                } catch (e) {}
            });
            state.principalId = 'guest:pending';
            state.principal = { id: 0, isGuest: true, key: 'guest:pending' };
            try { localStorage.setItem(ACTIVE_PRINCIPAL_KEY, 'guest:pending'); } catch (e) {}
        } else {
            let guestId = 0;
            try { guestId = Number(localStorage.getItem(GUEST_ID_KEY) || 0); } catch (e) {}
            if (guestId > 0 && readGuestToken()) activatePrincipal('guest:' + guestId);
            else activatePrincipal('guest:pending');
        }
        state.lastPushed = {};
        state.restoring = false;
        resetSyncState();
        resetRecommendProfile();
    }

    function clearPrincipalSnapshot(principal) {
        if (!principal) return;
        Object.keys(SNAPSHOT_KEYS).forEach(name => {
            try { localStorage.removeItem(snapshotKey(principal, name)); } catch (e) {}
        });
    }

    async function pushFavoritesFull() {
        if (!hasPrincipal()) return;
        const raw = localStorage.getItem(KIND_KEYS.favorites);
        if (raw === null) return;
        const data = JSON.parse(raw);
        const resp = await api('PUT', '/api/library/favorites', { data: data, updatedAt: Date.now() });
        const ts = readTS();
        if (resp.data && resp.data.updatedAt) ts.favorites = resp.data.updatedAt;
        writeTS(ts);
        state.lastPushed.favorites = raw;
    }

    async function bootstrapGuest() {
        if (!hasPrincipal()) return;
        const hadData = localHasData();
        try {
            const raw = localStorage.getItem(KIND_KEYS.favorites);
            const data = raw ? JSON.parse(raw) : null;
            if (Array.isArray(data) && data.length) await pushFavoritesFull();
        } catch (e) {}
        try { await pushAll(); } catch (e) {}
        if (hadData) state.guestServerData = true;
    }

    function mergeSongKey(song) {
        if (!song || typeof song !== 'object') return '';
        const platform = String(song.platform || 'cloudmusic').trim().slice(0, 40) || 'cloudmusic';
        const value = song.id !== undefined && song.id !== null ? song.id : song.songId;
        const id = value === undefined || value === null ? '' : String(value).trim();
        return id ? platform + ':id:' + id : '';
    }

    function mergeFavoriteList(target, guest) {
        const result = [];
        const seen = new Set();
        (Array.isArray(target) ? target : []).forEach(song => {
            const key = mergeSongKey(song);
            if (key && seen.has(key)) return;
            result.push(song);
            if (key) seen.add(key);
        });
        (Array.isArray(guest) ? guest : []).forEach(song => {
            const key = mergeSongKey(song);
            if (!key || seen.has(key)) return;
            result.push(song);
            seen.add(key);
        });
        return result;
    }

    function mergeHistoryList(target, guest) {
        const values = {};
        const add = song => {
            const key = mergeSongKey(song);
            if (!key) return;
            const played = Number(song && song.playedAt) || 0;
            const current = values[key];
            if (!current || played > (Number(current.playedAt) || 0)) values[key] = song;
        };
        (Array.isArray(target) ? target : []).forEach(add);
        (Array.isArray(guest) ? guest : []).forEach(add);
        return Object.keys(values).map(key => values[key])
            .sort((a, b) => (Number(b.playedAt) || 0) - (Number(a.playedAt) || 0))
            .slice(0, 200);
    }

    function playlistKey(playlist) {
        if (!playlist || typeof playlist !== 'object') return '';
        if (playlist.uuid) return 'u:' + playlist.uuid;
        if (playlist.id !== undefined && playlist.id !== null && playlist.id !== '') return 'i:' + playlist.id;
        const songs = Array.isArray(playlist.songs) ? playlist.songs : [];
        const ids = songs.map(mergeSongKey).filter(Boolean).sort().join(',');
        if (!playlist.name && !ids) return '';
        return 'f:' + (playlist.name || '') + '|' + (playlist.createTime || '') + '|' + ids;
    }

    function mergePlaylistSongs(target, guest) {
        const songs = Array.isArray(target.songs) ? target.songs.slice() : [];
        const seen = new Set(songs.map(mergeSongKey).filter(Boolean));
        (Array.isArray(guest.songs) ? guest.songs : []).forEach(song => {
            const key = mergeSongKey(song);
            if (key && seen.has(key)) return;
            songs.push(song);
            if (key) seen.add(key);
        });
        target.songs = songs.slice(0, 2000);
    }

    function mergePlaylistList(target, guest, userId) {
        const result = Array.isArray(target) ? target.slice() : [];
        const seen = new Set(result.map(playlistKey).filter(Boolean));
        (Array.isArray(guest) ? guest : []).forEach(playlist => {
            if (!playlist || typeof playlist !== 'object') return;
            const key = playlistKey(playlist);
            const match = result.find(item => playlistKey(item) === key);
            if (match) mergePlaylistSongs(match, playlist);
            else {
                const copy = playlist;
                if (!copy.uuid) copy.uuid = 'pl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
                result.push(copy);
                if (key) seen.add(key);
            }
        });
        result.forEach(playlist => { if (playlist && typeof playlist === 'object') playlist.userId = userId; });
        return result;
    }

    function mergeFavoritePlaylistList(target, guest) {
        const result = Array.isArray(target) ? target.slice() : [];
        const seen = new Set(result.map(playlistKey).filter(Boolean));
        (Array.isArray(guest) ? guest : []).forEach(playlist => {
            const key = playlistKey(playlist);
            if (!key || seen.has(key)) return;
            result.push(playlist);
            seen.add(key);
        });
        return result;
    }

    async function mergeGuestSnapshot(guestKey) {
        if (!guestKey || !guestKey.startsWith('guest:')) return;
        const readList = key => {
            try {
                const value = JSON.parse(localStorage.getItem(key) || '[]');
                return Array.isArray(value) ? value : [];
            } catch (e) { return []; }
        };
        const readSnap = name => {
            try {
                const raw = localStorage.getItem(snapshotKey(guestKey, name));
                const value = raw ? JSON.parse(raw) : [];
                return Array.isArray(value) ? value : [];
            } catch (e) { return []; }
        };
        const favorites = mergeFavoriteList(readList(KIND_KEYS.favorites), readSnap('favorites'));
        const playlists = mergePlaylistList(readList(KIND_KEYS.playlists), readSnap('playlists'), principalId());
        const history = mergeHistoryList(readList(KIND_KEYS.history), readSnap('history'));
        const favoritePlaylists = mergeFavoritePlaylistList(readList(SNAPSHOT_KEYS.favoritePlaylists), readSnap('favoritePlaylists'));
        localStorage.setItem(KIND_KEYS.favorites, JSON.stringify(favorites));
        localStorage.setItem(KIND_KEYS.playlists, JSON.stringify(playlists));
        localStorage.setItem(KIND_KEYS.history, JSON.stringify(history));
        localStorage.setItem(SNAPSHOT_KEYS.favoritePlaylists, JSON.stringify(favoritePlaylists));
        saveActiveSnapshot(state.principalId);
        hotApply(['favorites', 'favoritePlaylists', 'playlists', 'history']);
    }

    function ensureGuest() {
        if (state.user) return Promise.resolve(null);
        if (Date.now() < state.guestFailAt) return Promise.resolve(null);
        if (state.guestPromise) return state.guestPromise;
        const token = readGuestToken();
        const query = token ? '' : '?mirror=1';
        state.guestPromise = api('POST', '/api/guest/ensure' + query, undefined, {
            headers: token ? { 'X-Guest-Token': token } : {}
        }).then(async (resp) => {
            const data = resp.data || {};
            if (!data.guestId) return null;
            if (data.token) setGuestToken(data.token);
            if (state.principalId === 'guest:pending') migratePendingToGuest(data.guestId);
            else if (state.principalId !== 'guest:' + data.guestId) activatePrincipal('guest:' + data.guestId);
            state.guestServerData = !!data.hasData;
            if (!data.hasData) await bootstrapGuest();
            state.guestFailAt = 0;
            return state.principal;
        }).catch(() => {
            state.guestFailAt = Date.now() + 60000;
            return null;
        }).finally(() => { state.guestPromise = null; });
        return state.guestPromise;
    }

    async function flushPrincipal() {
        if (!hasPrincipal()) return false;
        try {
            await flushFavoriteChanges();
            await pushAll();
            await flushEvents();
            await flushEdges();
            return true;
        } catch (e) {
            return false;
        }
    }

    function guestSummary() {
        const count = key => {
            try {
                const value = JSON.parse(localStorage.getItem(key) || '[]');
                return Array.isArray(value) ? value.length : 0;
            } catch (e) { return 0; }
        };
        return {
            favorites: count(KIND_KEYS.favorites),
            playlists: count(KIND_KEYS.playlists),
            history: count(KIND_KEYS.history)
        };
    }

    async function clearGuestData() {
        const token = readGuestToken();
        const key = state.principal && state.principal.isGuest && state.principal.id > 0 ? state.principalId : '';
        try {
            await api('DELETE', '/api/guest', undefined, { headers: token ? { 'X-Guest-Token': token } : {} });
        } catch (e) {}
        clearGuestToken();
        state.guestServerData = false;
        if (state.user) return;
        if (key) clearPrincipalSnapshot(key);
        Object.keys(SNAPSHOT_KEYS).forEach(name => {
            try { localStorage.removeItem(SNAPSHOT_KEYS[name]); } catch (e) {}
            try { localStorage.removeItem(snapshotKey('guest:pending', name)); } catch (e) {}
        });
        try { sessionStorage.removeItem('AerMusic_Playlist_Deletions'); } catch (e) {}
        state.principalId = 'guest:pending';
        state.principal = { id: 0, isGuest: true, key: 'guest:pending' };
        state.lastPushed = {};
        state.restoring = false;
        try { localStorage.setItem(ACTIVE_PRINCIPAL_KEY, 'guest:pending'); } catch (e) {}
        saveActiveSnapshot('guest:pending');
        hotApply(['favorites', 'favoritePlaylists', 'playlists', 'history']);
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
        if (!hasPrincipal() || eventState.sending || !eventState.queue.length) return;
        const userId = principalId();
        const version = eventState.version;
        const batch = eventState.queue.splice(0, 50);
        eventState.sending = true;
        const controller = new AbortController();
        eventState.controller = controller;
        try {
            await api('POST', '/api/recommend/events', { events: batch }, { keepalive: true, signal: controller.signal });
            if (eventState.version === version && state.principal && state.principal.id === userId) eventState.failCount = 0;
        } catch (e) {
            if (eventState.version === version && state.principal && state.principal.id === userId) {
                eventState.queue = batch.concat(eventState.queue).slice(-100);
                eventState.failCount++;
                if (eventState.failCount < 5) {
                    scheduleEventFlush(5000);
                }
                if (e.status === 401) {
                    handleAuthLost();
                }
            }
        } finally {
            if (eventState.version === version) {
                eventState.sending = false;
                eventState.controller = null;
            }
        }
        if (eventState.version === version && state.principal && state.principal.id === userId && eventState.queue.length && !eventState.timer) scheduleEventFlush(EVENT_PUSH_DELAY_MS);
    }

    function recordEvent(event, song, extra) {
        if (!['play_start', 'play_progress', 'play_complete', 'play_skip', 'favorite_add', 'favorite_remove', 'playlist_add', 'dislike', 'dislike_remove', 'search', 'view_song', 'view_artist', 'view_album', 'playlist_create', 'playlist_update', 'playlist_delete', 'playlist_play'].includes(event)) return;
        if (!hasPrincipal() && !LOCAL_EVENT_TYPES.has(event)) return;
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
        if (!state.user) recordLocalEvent(event, base, position, duration, now);
        if (!hasPrincipal()) {
            if (Object.keys(eventState.last).length > 512) eventState.last = Object.create(null);
            ensureGuest().then((principal) => {
                if (!principal || !state.principal || state.principal.key !== principal.key) return;
                eventState.queue.push(data);
                if (eventState.queue.length > 150) eventState.queue.splice(0, eventState.queue.length - 150);
                scheduleEventFlush(EVENT_PUSH_DELAY_MS);
            });
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
            if (resp.data && resp.data.userId) activatePrincipal('user:' + resp.data.userId);
            return state.user;
        }).catch((e) => {
            if (e.status === 401) {
                setUser(null);
                let guestId = 0;
                try { guestId = Number(localStorage.getItem(GUEST_ID_KEY) || 0); } catch (err) {}
                if (guestId > 0 && readGuestToken()) activatePrincipal('guest:' + guestId);
                else activatePrincipal('guest:pending');
            }
            throw e;
        }).finally(() => { mePending = null; });
        return mePending;
    }

    async function afterAuth(data, opts) {
        const options = opts || {};
        const claim = !!options.claimGuest;
        const guestToken = readGuestToken();
        const guestKey = state.principal && state.principal.isGuest && state.principal.id > 0 ? state.principalId
            : (state.principalId === 'guest:pending' ? state.principalId : '');
        setUser(data);
        activatePrincipal('user:' + data.userId);
        resetSyncState();
        resetRecommendProfile();
        let claimed = false;
        if (claim && guestToken) {
            try {
                await api('POST', '/api/guest/claim', {}, { headers: { 'X-Guest-Token': guestToken } });
                claimed = true;
            } catch (e) {
                toast(e.message || '游客数据合并失败');
            }
        }
        await pullAndRestore(true);
        if (claim && guestKey) {
            try {
                await mergeGuestSnapshot(guestKey);
                await pushFavoritesFull();
            } catch (e) {
                toast('游客数据合并失败');
            }
            await flushPrincipal();
        }
        if (claimed) {
            clearGuestToken();
            state.guestServerData = false;
            if (guestKey) clearPrincipalSnapshot(guestKey);
            try { localStorage.removeItem(GUEST_ID_KEY); } catch (e) {}
            hotApply(['favorites', 'favoritePlaylists', 'playlists', 'history']);
        }
        try { if (window.app && window.app._ensurePlaylistIds) window.app._ensurePlaylistIds(); } catch (e) {}
        return state.user;
    }

    async function login(username, password, opts) {
        const options = opts || {};
        if (options.claimGuest) {
            await flushPrincipal();
            try { await pushFavoritesFull(); } catch (e) {}
        }
        const resp = await api('POST', '/api/user/login', { username: username, password: password });
        return afterAuth(resp.data, options);
    }

    async function register(payload, opts) {
        const options = opts || {};
        if (options.claimGuest) {
            await flushPrincipal();
            try { await pushFavoritesFull(); } catch (e) {}
        }
        const resp = await api('POST', '/api/user/register', payload);
        return afterAuth(resp.data, options);
    }

    async function logout() {
        try { await flushPrincipal(); } catch (e) {}
        try { await api('POST', '/api/user/logout'); } catch (e) {}
        setUser(null);
        resetSyncState();
        resetRecommendProfile();
        let guestId = 0;
        try { guestId = Number(localStorage.getItem(GUEST_ID_KEY) || 0); } catch (e) {}
        if (guestId > 0 && readGuestToken()) {
            activatePrincipal('guest:' + guestId);
            await pullAndRestore();
        } else {
            activatePrincipal('guest:pending');
        }
        try { if (window.app && window.app._ensurePlaylistIds) window.app._ensurePlaylistIds(); } catch (e) {}
    }

    function updateProfile(profile) { return api('PUT', '/api/user/profile', profile); }
    function sendEmailCode(email) { return api('POST', '/api/user/email/code', { email: email }); }
    function uploadAvatar(dataUrl) { return api('POST', '/api/user/avatar', { dataUrl: dataUrl }); }

    window.AerMusicCloud = {
        getUser: () => (state && state.user) ? state.user : null,
        getPrincipal: () => state.principal,
        isGuest: () => !!(state.principal && state.principal.isGuest && state.principal.id > 0),
        waitReady: () => readyPromise,
        onAuthChanged: (fn) => { if (typeof fn === 'function' && authListeners.indexOf(fn) < 0) authListeners.push(fn); },
        api: api,
        fetchMe: fetchMe,
        ensureGuest: ensureGuest,
        guestSummary: guestSummary,
        guestHasServerData: () => !!state.guestServerData,
        clearGuestData: clearGuestData,
        flush: flushPrincipal,
        refresh: async () => { if (!hasPrincipal()) return; await pullAndRestore('playlists'); },
        login: login,
        register: register,
        logout: logout,
        updateProfile: updateProfile,
        sendEmailCode: sendEmailCode,
        uploadAvatar: uploadAvatar,
        markFavoriteChange: markFavoriteChange,
        favoriteChangeSong: favoriteChangeSong
    };

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
        if (!hasPrincipal()) {
            ensureGuest().then((principal) => {
                if (principal && state.principal && state.principal.key === principal.key) flushEdges();
            });
            return;
        }
        if (edgeState.queue.length >= 20) flushEdges();
        else {
            clearTimeout(edgeState.timer);
            edgeState.timer = setTimeout(() => flushEdges(), 2000);
        }
    }

    async function flushEdges() {
        if (!hasPrincipal() || edgeState.sending || !edgeState.queue.length) return;
        const userId = principalId();
        const version = edgeState.version;
        const batch = edgeState.queue.splice(0, 50);
        edgeState.sending = true;
        const controller = new AbortController();
        edgeState.controller = controller;
        try {
            await api('POST', '/api/recommend/edges', { edges: batch }, { keepalive: true, signal: controller.signal });
            if (edgeState.version === version && state.principal && state.principal.id === userId) edgeState.failCount = 0;
        } catch (e) {
            if (edgeState.version === version && state.principal && state.principal.id === userId) {
                edgeState.queue = batch.concat(edgeState.queue).slice(-100);
                edgeState.failCount++;
                if (edgeState.failCount < 5) {
                    clearTimeout(edgeState.timer);
                    edgeState.timer = setTimeout(() => flushEdges(), 5000);
                }
                if (e.status === 401) {
                    handleAuthLost();
                }
            }
        } finally {
            if (edgeState.version === version) {
                edgeState.sending = false;
                edgeState.controller = null;
            }
        }
        if (edgeState.version === version && state.principal && state.principal.id === userId && edgeState.queue.length) flushEdges();
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
        if (kinds.indexOf('favoritePlaylists') >= 0) {
            app.favoritePlaylists = read(SNAPSHOT_KEYS.favoritePlaylists, []);
            try { if (app.page === 'favorites' && app.renderFavoritesPage) app.renderFavoritesPage(); } catch (e) {}
        }
        try { if (app._compactStoredSongs) app._compactStoredSongs(); } catch (e) {}
    }

    function pullAndRestore(forceKind) {
        if (!hasPrincipal()) return Promise.resolve();
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


    function localKindHasData(kind) {
        const raw = localStorage.getItem(KIND_KEYS[kind]);
        return raw !== null && raw !== '' && raw !== '[]' && raw !== 'null' && raw !== '{}';
    }

    function localHasData() {
        return [KIND_KEYS.favorites, KIND_KEYS.playlists, KIND_KEYS.history,
            SNAPSHOT_KEYS.favoritePlaylists, LOCAL_BEHAVIOR_KEY].some(key => {
            const raw = localStorage.getItem(key);
            return raw !== null && raw !== '' && raw !== '[]' && raw !== 'null' && raw !== '{}';
        });
    }

    async function pullOnce(forceKind) {
        if (!hasPrincipal()) return;
        const userId = principalId();
        const restoreVersion = state.restoreVersion;
        state.restoring = true;
        try {
            const resp = await api('GET', '/api/library');
            if (!state.principal || state.principal.id !== userId || state.restoreVersion !== restoreVersion) return;
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
                        if (state.principal && state.principal.isGuest && localKindHasData(kind)) return;
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
                if (state.restoreVersion === restoreVersion && state.principal && state.principal.id === userId) state.restoring = false;
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
        if (!hasPrincipal() || state.restoring) return;
        lastPushAt = Date.now();
        const userId = principalId();
        const o = opts || {};
        const ts = readTS();
        const now = Date.now();
        let anyFail = false;
        for (const kind of ['playlists', 'history']) {
            if (!state.principal || state.principal.id !== userId) return;
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
                    handleAuthLost();
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
            if (!hasPrincipal()) {
                if (localHasData() && Date.now() >= state.guestFailAt) ensureGuest();
                return;
            }
            for (const kind of ['playlists', 'history']) {
                if (snapshotKind(kind) !== state.lastPushed[kind]) { schedulePush(kind); break; }
            }
        }, 3000);
        window.addEventListener('beforeunload', () => {
            if (hasPrincipal()) {
                pushAll({ keepalive: true });
                flushFavoriteChanges({ keepalive: true });
                flushEvents({ keepalive: true });
                flushEdges();
            }
        });
        window.addEventListener('storage', (e) => {
            if (!e) return;
            if (e.key === ACTIVE_PRINCIPAL_KEY || e.key === GUEST_TOKEN_KEY) {
                toast('账号已在其他标签切换, 请刷新页面');
                return;
            }
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
            try { await fetchMe(); } catch (e) {}
            try {
                if (!state.user && !hasPrincipal() && !localHasData()) {
                    try {
                        const me = await api('GET', '/api/guest/me');
                        if (me.data && me.data.guestId) await ensureGuest();
                    } catch (e) {}
                }
                if (!state.user && (hasPrincipal() || localHasData())) await ensureGuest();
                await pullAndRestore();
                try { if (window.app && window.app._ensurePlaylistIds) window.app._ensurePlaylistIds(); } catch (e) {}
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

    initPrincipal();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
