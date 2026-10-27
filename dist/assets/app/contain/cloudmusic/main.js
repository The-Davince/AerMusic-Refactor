const __AER_UPSTREAM__ = window.__AER_UPSTREAM__ || {};
const UP_API_BASE = __AER_UPSTREAM__.apiBase || '';
const UP_LYRIC_BASE = __AER_UPSTREAM__.lyricBase || '';

const CloudMusicPlatform = {
    INFO: {
        ID: 'cloudmusic',
        NAME: '网易云音乐',
        VERSION: '5.0.0',
        AUTHOR: '达文西 The Davince',
        AUTHOR_URL: 'https://github.com/The-Davince',
        
        ICON: `<svg viewBox="0 0 24 24" fill="currentColor"><path fill="#ffffffff" d="M12.001 22c-5.523 0-10-4.477-10-10s4.477-10 10-10s10 4.477 10 10s-4.477 10-10 10m-1.086-10.432c.24-.84 1.075-1.541 1.99-1.648c.187.694.388 1.373.545 2.063c.053.23.037.495-.018.727c-.213.892-1.248 1.242-1.978.685c-.53-.405-.742-1.12-.539-1.827m3.817-.197c-.125-.465-.256-.927-.393-1.42c.5.13.907.36 1.255.697c1.257 1.222 1.385 3.3.294 4.732c-1.135 1.49-3.155 2.134-5.028 1.605c-2.302-.65-3.808-2.952-3.441-5.316c.274-1.768 1.27-3.004 2.9-3.733c.407-.182.58-.56.42-.93c-.157-.364-.54-.504-.944-.343c-2.721 1.088-4.32 4.134-3.67 6.987c.713 3.118 3.495 5.163 6.675 4.859c1.732-.166 3.164-.948 4.216-2.347c1.506-2.002 1.297-4.783-.463-6.499c-.666-.65-1.471-1.018-2.39-1.153c-.083-.013-.217-.052-.232-.106c-.087-.313-.18-.632-.206-.954c-.029-.357.29-.64.65-.645c.253-.003.434.13.603.3c.303.3.704.322.988.062c.29-.264.296-.678.018-1.008c-.566-.672-1.586-.891-2.43-.523c-.847.37-1.321 1.187-1.2 2.093c.038.28.11.557.167.842l-.26.072a3.86 3.86 0 0 0-2.098 1.414c-.921 1.22-.936 2.828-.041 3.947c1.274 1.594 3.747 1.284 4.523-.568c.284-.677.275-1.368.087-2.065"/></svg>`,
        COLOR: '#e60026',
        
        FEATURES: {
            search: true,
            lyric: true,
            recommend: true,
            similar: true,
            album: true,
            suggest: true,
            playlist: true,
            download: true,
            heartbeat: true
        },
        
        API: {
            search: UP_API_BASE + '/cloudsearch',
            detail: UP_API_BASE + '/song/detail',
            url: '/api/song/url',
            lyric: UP_LYRIC_BASE,
            similar: UP_API_BASE + '/simi/song',
            recommend: UP_API_BASE + '/recommend/songs',
            artistTopSong: UP_API_BASE + '/artist/top/song',
            simiArtist: UP_API_BASE + '/simi/artist',
            topPlaylist: UP_API_BASE + '/top/playlist',
            playlistDetail: UP_API_BASE + '/playlist/detail',
            playlistTrackAll: UP_API_BASE + '/playlist/track/all',
            personalizedNewSong: UP_API_BASE + '/personalized/newsong',
            personalized: UP_API_BASE + '/personalized',
            artistDetail: UP_API_BASE + '/artist/detail',
            artists: UP_API_BASE + '/artists',
            artistAlbum: UP_API_BASE + '/artist/album',
            album: UP_API_BASE + '/album',
            searchSuggest: UP_API_BASE + '/search/suggest'
        },
        DESCRIPTION: '发现好声音 · 音乐的力量'
    },

    _heartbeat: {
        hotPlaylistIds: [],
        hotPlaylistCursor: 0,
        similarArtistIdx: 0,
        seedArtistId: null,
        recommendProfile: null,
        recommendProfileAt: 0,
        recommendProfilePromise: null,
        recommendProfileVersion: 0,
        recommendSessionId: null,
    },

    _shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    },

    _songId(song) {
        const value = song && typeof song === 'object' ? (song.id ?? song.songId) : song;
        return value === undefined || value === null || value === '' ? '' : String(value);
    },

    _songKey(song) {
        const id = this._songId(song);
        return id ? `${song?.platform || this.INFO.ID}:id:${id}` : '';
    },

    _extractList(data, key) {
        const values = [
            data?.[key],
            data?.data?.[key],
            data?.playlist?.[key],
            data?.data?.playlist?.[key],
        ];
        return values.find(value => Array.isArray(value)) || [];
    },

    _artistIds(song) {
        const artists = Array.isArray(song?.ar) ? song.ar : (Array.isArray(song?.artists) ? song.artists : []);
        const keys = [];
        artists.forEach(artist => {
            const id = this._songId(artist);
            const name = typeof artist === 'string' ? artist : artist?.name;
            const platform = song?.platform || this.INFO.ID;
            if (id) keys.push(`${platform}:id:${id}`);
            if (typeof name === 'string' && name.trim()) keys.push(`${platform}:name:${name.trim().toLowerCase()}`);
        });
        return [...new Set(keys)];
    },

    _startRecommendProfile() {
        const hb = this._heartbeat;
        if (hb.recommendProfilePromise) return hb.recommendProfilePromise;
        if (Date.now() - hb.recommendProfileAt < 300000) return Promise.resolve(hb.recommendProfile);
        const version = hb.recommendProfileVersion;
        hb.recommendProfilePromise = this._api('/api/recommend/profile').then(data => {
            if (version !== hb.recommendProfileVersion) return;
            const profile = data?.data && !Array.isArray(data.data) ? data.data : data;
            hb.recommendProfile = profile && typeof profile === 'object' ? profile : {};
            hb.recommendProfileAt = Date.now();
        }).catch(() => {
            if (version !== hb.recommendProfileVersion) return;
            hb.recommendProfile = {};
            hb.recommendProfileAt = Date.now() - 240000;
        }).finally(() => {
            if (version === hb.recommendProfileVersion) hb.recommendProfilePromise = null;
        });
        return hb.recommendProfilePromise;
    },

    resetRecommendProfile() {
        const hb = this._heartbeat;
        hb.recommendProfileVersion++;
        hb.recommendProfile = null;
        hb.recommendProfileAt = 0;
        hb.recommendProfilePromise = null;
        hb.usedSeeds = null;
    },

    _recommendSessionId() {
        const hb = this._heartbeat;
        if (hb.recommendSessionId) return hb.recommendSessionId;
        let value = '';
        try { value = localStorage.getItem('AerMusic_Recommend_Session') || ''; } catch (e) {}
        if (!/^[A-Za-z0-9_-]{8,80}$/.test(value)) {
            value = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
            try { localStorage.setItem('AerMusic_Recommend_Session', value); } catch (e) {}
        }
        hb.recommendSessionId = value;
        return value;
    },

    _localRecommendProfile() {
        const app = window.app || {};
        const favorites = Array.isArray(app.favoriteSongs) ? app.favoriteSongs : [];
        const ids = [];
        const keys = [];
        const recentIds = [];
        const recentKeys = [];
        const likedArtists = [];
        const albums = [];
        const favoriteAlbums = [];
        const add = (song, recent = false, favorite = false) => {
            if (!song || typeof song !== 'object') return;
            const raw = song.rawSong && typeof song.rawSong === 'object' ? song.rawSong : song;
            const id = this._songId(raw);
            if (!id || !/^\d{1,15}$/.test(id)) return;
            const platform = raw.platform || this.INFO.ID;
            if (favorite) {
                if (!ids.includes(id)) ids.push(id);
                keys.push(`${platform}:id:${id}`);
            }
            if (recent && !recentIds.includes(id)) recentIds.push(id);
            if (recent) recentKeys.push(`${platform}:id:${id}`);
            const artists = Array.isArray(raw.ar) ? raw.ar : (Array.isArray(raw.artists) ? raw.artists : (raw.artist ? [raw.artist] : []));
            artists.slice(0, 4).forEach(artist => {
                const artistId = this._songId(artist);
                const name = typeof artist === 'string' ? artist : artist?.name;
                if (artistId || name) likedArtists.push({ id: artistId, name: name || '', platform });
            });
            const album = raw.al || raw.album || {};
            const albumId = this._songId(album?.id || raw.albumId);
            const albumName = album?.name || (typeof raw.album === 'string' ? raw.album : '');
            if (albumId || albumName) {
                const value = { id: albumId, name: albumName, platform };
                albums.push(value);
                if (favorite) favoriteAlbums.push(value);
            }
        };
        favorites.slice(0, 80).forEach(song => add(song, false, true));
        const playlist = Array.isArray(app.playlist) ? app.playlist : [];
        playlist.slice(Math.max(0, (app.currentIndex || 0) - 8), (app.currentIndex || 0) + 1).forEach(song => add(song, true));
        const playlistSongs = [];
        (Array.isArray(app.userPlaylists) ? app.userPlaylists : []).slice(0, 8).forEach(item => {
            if (item && Array.isArray(item.songs)) playlistSongs.push(...item.songs.slice(0, 20));
        });
        playlistSongs.slice(0, 80).forEach(song => add(song));
        let historySongs = [];
        try {
            const values = JSON.parse(localStorage.getItem('AerMusic_History') || '[]');
            if (Array.isArray(values)) historySongs = values.slice(0, 50);
        } catch (e) {}
        historySongs.forEach(song => add(song, true));
        const compactSong = song => {
            const raw = song?.rawSong && typeof song.rawSong === 'object' ? song.rawSong : song;
            const id = this._songId(raw);
            if (!id || !/^\d{1,15}$/.test(id)) return null;
            const platform = typeof raw?.platform === 'string' && raw.platform.trim() ? raw.platform.trim().slice(0, 40) : this.INFO.ID;
            const artists = Array.isArray(raw?.ar) ? raw.ar : (Array.isArray(raw?.artists) ? raw.artists : (raw?.artist ? [raw.artist] : []));
            const ar = artists.slice(0, 4).map(artist => ({ id: this._songId(artist), name: typeof artist === 'string' ? artist : String(artist?.name || '') })).filter(artist => artist.id || artist.name);
            const album = raw?.al || (raw?.album && typeof raw.album === 'object' ? raw.album : {});
            const albumId = this._songId(album?.id || raw?.albumId);
            const albumName = String(album?.name || (typeof raw?.album === 'string' ? raw.album : ''));
            return { id, platform, ar, al: { id: albumId, name: albumName } };
        };
        let dislikedKeys = [];
        try {
            const values = JSON.parse(localStorage.getItem('AerMusic_ReduceRecommend_Songs') || '[]');
            if (Array.isArray(values)) values.slice(-100).forEach(value => {
                const key = String(value || '').trim();
                if (/^[^:]{1,40}:id:\d{1,15}$/.test(key)) dislikedKeys.push(key);
                else if (/^\d{1,15}$/.test(key)) dislikedKeys.push(`${this.INFO.ID}:id:${key}`);
            });
        } catch (e) {}
        const behaviorSongs = new Map();
        const behaviorArtists = new Map();
        const behaviorAlbums = new Map();
        const behaviorDisliked = new Map();
        const behaviorDislikedTags = new Map();
        const addBehavior = (bucket, key, value, weight) => {
            if (!key || !Number.isFinite(weight)) return;
            const current = bucket.get(key) || { ...value, score: 0, count: 0 };
            current.score += weight;
            current.count++;
            bucket.set(key, current);
        };
        try {
            const values = JSON.parse(localStorage.getItem('AerMusic_Recommend_Behavior') || '[]');
            if (Array.isArray(values)) values.slice(-120).forEach(item => {
                if (!item || typeof item !== 'object' || !/^\d{1,15}$/.test(String(item.songId))) return;
                const event = String(item.event || '');
                const platform = typeof item.platform === 'string' && item.platform.trim() ? item.platform.trim().slice(0, 40) : this.INFO.ID;
                let weight = 0;
                if (event === 'play_start') weight = 0.25;
                else if (event === 'play_progress') {
                    const position = Number(item.position);
                    const duration = Number(item.duration);
                    const ratio = Number.isFinite(position) && Number.isFinite(duration) && duration > 0 ? Math.min(1, position / duration) : 0;
                    weight = 0.01 + ratio * 0.02;
                } else if (event === 'play_complete') weight = 2.5;
                else if (event === 'play_skip') weight = -1.25;
                else if (event === 'favorite_add') weight = 4;
                else if (event === 'favorite_remove') weight = -3;
                else if (event === 'playlist_add') weight = 2;
                else if (event === 'dislike') weight = -4;
                else if (event === 'dislike_remove') weight = 4;
                if (!weight) return;
                const at = Number(item.at);
                const age = Number.isFinite(at) ? Math.max(0, Date.now() - Math.min(Date.now(), at)) : 0;
                const score = weight * Math.pow(0.5, age / (30 * 24 * 60 * 60 * 1000));
                const songId = String(item.songId);
                const songKey = `${platform}:id:${songId}`;
                addBehavior(behaviorSongs, songKey, { id: songId, platform, key: songKey }, score);
                const artistId = typeof item.artistId === 'string' ? item.artistId : '';
                const artistName = typeof item.artistName === 'string' ? item.artistName.trim() : '';
                if (artistId || artistName) {
                    const artistKey = artistId ? `${platform}:id:${artistId}` : `${platform}:name:${artistName.toLowerCase()}`;
                    addBehavior(behaviorArtists, artistKey, { id: artistId, name: artistName, platform }, score);
                }
                const albumId = typeof item.albumId === 'string' ? item.albumId : '';
                const albumName = typeof item.albumName === 'string' ? item.albumName.trim() : '';
                if (albumId || albumName) {
                    const albumKey = albumId ? `${platform}:id:${albumId}` : `${platform}:name:${albumName.toLowerCase()}`;
                    addBehavior(behaviorAlbums, albumKey, { id: albumId, name: albumName, platform }, score);
                }
                if (event === 'dislike' || event === 'dislike_remove') {
                    behaviorDisliked.set(songKey, event === 'dislike');
                    if (event === 'dislike') {
                        const tags = Array.isArray(item.tags) ? item.tags.filter(tag => typeof tag === 'string' && /^(tag|genre|category):/.test(tag)).slice(0, 16) : [];
                        behaviorDislikedTags.set(songKey, tags);
                    } else {
                        behaviorDislikedTags.delete(songKey);
                    }
                }
            });
        } catch (e) {}
        const sortBehavior = values => [...values.values()].sort((a, b) => b.score - a.score || b.count - a.count).slice(0, 32);
        const behaviorDislikedKeys = [...behaviorDisliked].filter(item => item[1]).map(item => item[0]).filter(key => /^[^:]{1,40}:id:\d{1,15}$/.test(key));
        const dislikedTags = new Map();
        [...behaviorDisliked].filter(item => item[1]).forEach(([songKey]) => {
            const platform = songKey.split(':id:')[0] || this.INFO.ID;
            (behaviorDislikedTags.get(songKey) || []).forEach(tag => dislikedTags.set(`${platform}:${tag}`, { id: tag, name: tag, platform, score: -4, count: 1 }));
        });
        dislikedKeys = [...new Set(dislikedKeys.concat(behaviorDislikedKeys))].slice(-100);
        const dislikedIds = dislikedKeys.filter(key => key.startsWith(`${this.INFO.ID}:id:`)).map(key => key.split(':id:')[1]);
        return {
            favorites: { ids: ids.slice(0, 40), keys: [...new Set(keys)].slice(0, 40) },
            recentIds: recentIds.slice(-20),
            recentKeys: [...new Set(recentKeys)].slice(-20),
            likedArtists: likedArtists.slice(0, 40),
            albums: albums.slice(0, 40),
            favoriteAlbums: favoriteAlbums.slice(0, 40),
            playlistSongs: playlistSongs.map(compactSong).filter(Boolean).slice(0, 40),
            historySongs: historySongs.map(compactSong).filter(Boolean).slice(0, 30),
            behavior: { dislikedIds, dislikedKeys, dislikedTags: [...dislikedTags.values()], songs: sortBehavior(behaviorSongs), artists: sortBehavior(behaviorArtists), albums: sortBehavior(behaviorAlbums) },
        };
    },

    _recommendSignals() {
        const remoteProfile = this._heartbeat.recommendProfile || {};
        const profile = remoteProfile.behavior || remoteProfile.favorites || remoteProfile.graph || remoteProfile.likedArtists ? remoteProfile : this._localRecommendProfile();
        const app = window.app || {};
        const ids = values => new Set((Array.isArray(values) ? values : []).flatMap(value => {
            const id = this._songId(value);
            const name = typeof value === 'string' ? value : value?.name;
            const platform = typeof value === 'object' && value?.platform ? String(value.platform) : '';
            return [platform && id ? `${platform}:id:${id}` : id, platform && typeof name === 'string' && name.trim() ? `${platform}:name:${name.trim().toLowerCase()}` : (typeof name === 'string' ? name.trim().toLowerCase() : '')].filter(Boolean);
        }));
        const recentValues = Array.isArray(profile.recentKeys) && profile.recentKeys.length ? profile.recentKeys : profile.recentIds;
        const recentIds = ids(recentValues);
        const favoriteKeys = profile.favorites?.keys;
        const favoriteIds = profile.favorites?.ids;
        const favoriteValues = Array.isArray(profile.favorites) ? profile.favorites : (Array.isArray(favoriteKeys) && favoriteKeys.length ? favoriteKeys : favoriteIds);
        const favoriteSongIds = ids(favoriteValues);
        const favoriteAlbums = ids(profile.favoriteAlbums);
        const likedArtists = ids(profile.likedArtists);
        const behavior = profile.behavior || {};
        const behaviorSongs = new Map((Array.isArray(behavior.songs) ? behavior.songs : []).map(item => [item.key || this._songKey(item), Number(item.score) || 0]).filter(item => item[0]));
        const behaviorArtists = new Map((Array.isArray(behavior.artists) ? behavior.artists : []).flatMap(item => {
            const platform = item?.platform || this.INFO.ID;
            const id = this._songId(item);
            const name = typeof item?.name === 'string' ? item.name.trim().toLowerCase() : '';
            return [[id ? `${platform}:id:${id}` : '', Number(item?.score) || 0], [name ? `${platform}:name:${name}` : '', Number(item?.score) || 0]].filter(value => value[0]);
        }));
        const behaviorAlbums = new Map((Array.isArray(behavior.albums) ? behavior.albums : []).flatMap(item => {
            const platform = item?.platform || this.INFO.ID;
            const id = this._songId(item);
            const name = typeof item?.name === 'string' ? item.name.trim().toLowerCase() : '';
            return [[id ? `${platform}:id:${id}` : '', Number(item?.score) || 0], [name ? `${platform}:name:${name}` : '', Number(item?.score) || 0]].filter(value => value[0]);
        }));
        const dislikedTags = new Map((Array.isArray(behavior.dislikedTags) ? behavior.dislikedTags : []).flatMap(item => {
            const platform = item?.platform || this.INFO.ID;
            const tag = typeof item?.id === 'string' ? item.id : (typeof item?.name === 'string' ? item.name.trim().toLowerCase() : '');
            return tag ? [[`${platform}:${tag}`, Number(item?.score) || 0]] : [];
        }));
        const dislikedIds = new Set();
        (Array.isArray(behavior.dislikedKeys) ? behavior.dislikedKeys : []).forEach(key => {
            if (!key) return;
            dislikedIds.add(String(key));
        });
        (Array.isArray(behavior.dislikedIds) ? behavior.dislikedIds : []).forEach(id => {
            if (/^\d{1,15}$/.test(String(id))) dislikedIds.add(`${this.INFO.ID}:id:${String(id)}`);
        });
        try {
            const localReduce = JSON.parse(localStorage.getItem('AerMusic_ReduceRecommend_Songs') || '[]');
            if (Array.isArray(localReduce)) localReduce.forEach(key => {
                if (!key) return;
                const value = String(key).trim();
                if (/^[^:]{1,40}:id:\d{1,15}$/.test(value)) dislikedIds.add(value);
                else if (/^\d{1,15}$/.test(value)) dislikedIds.add(`${this.INFO.ID}:id:${value}`);
            });
        } catch (e) {}
        const recentArtists = new Map();
        const remoteFavs = Array.isArray(favoriteValues) ? favoriteValues : [];
        if (remoteFavs.length === 0) {
            const localFavorites = Array.isArray(app.favoriteSongs) ? app.favoriteSongs : [];
            localFavorites.forEach(item => {
                const song = item?.rawSong && typeof item.rawSong === 'object' ? item.rawSong : item;
                const songId = this._songId(item) || this._songId(song);
                if (songId) favoriteSongIds.add(this._songKey(song) || songId);
                this._artistIds(song).forEach(id => likedArtists.add(id));
                const albumId = this._songId(song?.al?.id || song?.album?.id || song?.albumId);
                if (albumId) favoriteAlbums.add(`${song?.platform || this.INFO.ID}:id:${albumId}`);
            });
        }
        const recentSongs = Array.isArray(app.playlist) ? app.playlist.slice(Math.max(0, (app.currentIndex || 0) - 8), (app.currentIndex || 0) + 1) : [];
        const recentSrcIds = new Set();
        recentSongs.forEach(song => {
            const songId = this._songId(song);
            if (songId) {
                recentIds.add(this._songKey(song) || songId);
                recentSrcIds.add(this._songKey(song) || `${song?.platform || this.INFO.ID}:id:${songId}`);
            }
            this._artistIds(song).forEach(id => recentArtists.set(id, (recentArtists.get(id) || 0) + 1));
        });
        const playedIds = new Set(recentIds);
        const edgeTargets = new Map();
        const addEdge = (dstKey, src, weight) => {
            if (!dstKey || !src || !(weight > 0)) return;
            const list = edgeTargets.get(dstKey) || [];
            const found = list.find(item => item.src === src);
            if (found) found.weight = Math.max(found.weight, weight);
            else list.push({ src, weight });
            edgeTargets.set(dstKey, list);
        };
        (Array.isArray(profile.graph?.edges) ? profile.graph.edges : []).forEach(edge => {
            if (!edge || edge.dst === undefined || edge.dst === null || edge.dst === '') return;
            const platform = edge.platform || this.INFO.ID;
            addEdge(`${platform}:id:${edge.dst}`, String(edge.src ?? ''), Number(edge.weight) || 0);
        });
        const localEdges = window.AerMusicRecommendEdges?.local;
        if (localEdges instanceof Map) localEdges.forEach((entry, dstKey) => {
            if (!entry || !(entry.srcs instanceof Map)) return;
            entry.srcs.forEach((weight, src) => addEdge(dstKey, src, weight));
        });
        return { playedIds, favoriteIds: favoriteSongIds, favoriteAlbums, likedArtists, recentArtists, behaviorSongs, behaviorArtists, behaviorAlbums, dislikedTags, dislikedIds, recentSrcIds, edgeTargets };
    },

    _behaviorScore(scores, keys, limit) {
        let raw = 0;
        keys.forEach(key => {
            const value = key ? Number(scores.get(key) || 0) : 0;
            if (Number.isFinite(value) && (!Number.isFinite(raw) || Math.abs(value) > Math.abs(raw) || (Math.abs(value) === Math.abs(raw) && value > raw))) raw = value;
        });
        const scaled = raw < 0 ? raw : Math.log2(1 + raw);
        return Math.max(-limit, Math.min(limit, scaled));
    },

    _edgeBoost(signals, keys, cap) {
        let boost = 0;
        keys.forEach(key => {
            const edges = signals.edgeTargets.get(key);
            if (!edges) return;
            edges.forEach(edge => {
                if (edge.src.startsWith('kw:') || signals.recentSrcIds.has(edge.src)) {
                    boost = Math.max(boost, Math.min(cap, edge.weight / 240));
                }
            });
        });
        return boost;
    },

    _songArtistNames(song) {
        const artists = Array.isArray(song?.ar) ? song.ar : (Array.isArray(song?.artists) ? song.artists : []);
        const names = artists.map(a => (typeof a === 'string' ? a : a?.name)).filter(Boolean).map(n => String(n).trim().toLowerCase());
        return [...new Set(names)].sort();
    },

    _songTagKeys(song) {
        const platform = song?.platform || this.INFO.ID;
        const values = [];
        const add = (value, prefix, depth = 0) => {
            if (depth > 4) return;
            if (Array.isArray(value)) return value.forEach(item => add(item, prefix, depth + 1));
            if (typeof value !== 'string') return;
            value.split(/[,，、|]/).forEach(item => {
                const text = item.trim().toLowerCase();
                if (!text) return;
                const key = /^(tag|genre|category):/.test(text) ? text : `${prefix}:${text}`;
                if (!values.includes(key)) values.push(key);
            });
        };
        add(song?.tags, 'tag');
        add(song?.tag, 'tag');
        add(song?.genre, 'genre');
        add(song?.genres, 'genre');
        add(song?.category, 'category');
        add(song?.categories, 'category');
        return values.slice(0, 16).map(tag => `${platform}:${tag}`);
    },

    _variantKey(song) {
        const base = String(song?.name || '').trim().toLowerCase()
            .replace(/\s*[（(][^（）()]*\s*(伴奏|纯音乐|纯享|instrumental|卡拉|karaoke|live|remix|remaster|master|钢琴版|吉他版|弦乐版|高音版|低音版|粤语|国语|翻唱|官方)[^（）()]*\s*[)）]\s*/g, '')
            .replace(/\s*(伴奏|纯音乐|纯享版|instrumental|卡拉\s*ok|karaoke|live\s*版?|remix|remaster[a-z]*|钢琴版|吉他版|弦乐版|高音版|低音版|粤语|国语|翻唱|官方)\s*$/g, '')
            .replace(/\s*\d{4}\s*(版|年度)?\s*$/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        return (base || String(song?.id || '')) + '#' + this._songArtistNames(song).join('|');
    },

    
    _hotness(song) {
        const pop = Math.max(0, Number(song?.popularity ?? song?.pop ?? 0));
        const plays = Math.max(0, Number(song?.playCount ?? song?.pc ?? 0));
        let score = Math.min(0.3, pop / 100 * 0.3);
        if (plays > 0) score += Math.min(0.2, Math.log10(plays + 1) / 8 * 0.2);
        return score;
    },

    _isRipOff(song) {
        const text = (String(song?.name || '') + ' ' + String(song?.alia || '')).toLowerCase();
        return /翻唱|翻录|盗版|dj版|抖音版/.test(text);
    },

    _isInstrumental(song) {
        const text = (String(song?.name || '') + ' ' + String(song?.alia || '')).toLowerCase();
        return /伴奏|纯音乐|纯享|卡拉\s*ok|karaoke|instrumental/.test(text);
    },

    _collapseVariants(items) {
        const seen = new Set();
        return items.filter(item => {
            const key = this._variantKey(item.song);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    },

    _pickDiverse(items, limit) {
        const picked = [];
        const deferred = [];
        const artistCounts = new Map();
        const albumCounts = new Map();
        const bump = (item) => {
            (item.artistIds || []).forEach(artistId => { if (artistId) artistCounts.set(artistId, (artistCounts.get(artistId) || 0) + 1); });
            const albumId = item.albumId || '';
            if (albumId) albumCounts.set(albumId, (albumCounts.get(albumId) || 0) + 1);
        };
        const overCap = (item) => {
            if ((item.artistIds || []).some(artistId => artistId && (artistCounts.get(artistId) || 0) >= 2)) return true;
            const albumId = item.albumId || '';
            return Boolean(albumId && (albumCounts.get(albumId) || 0) >= 2);
        };
        items.forEach(item => {
            if (overCap(item)) deferred.push(item);
            else { picked.push(item); bump(item); }
        });
        const result = picked.slice(0, limit);
        deferred.forEach(item => {
            if (result.length >= limit) return;
            if (!overCap(item)) { result.push(item); bump(item); }
        });
        if (result.length < limit) {
            deferred.forEach(item => {
                if (result.length < limit && !result.includes(item)) result.push(item);
            });
        }
        return result.slice(0, limit);
    },

    _rankDailySongs(songs) {
        const signals = this._recommendSignals();
        const candidates = this._dedup(songs).filter(song => {
            const id = this._songId(song);
            const key = this._songKey(song);
            return !(signals.playedIds.has(id) || signals.playedIds.has(key) || signals.dislikedIds.has(id) || signals.dislikedIds.has(key));
        }).map(song => {
            const id = this._songId(song);
            const artistIds = this._artistIds(song);
            const albumId = this._songId(song?.al?.id || song?.album?.id || song?.albumId);
            const albumKey = albumId ? `${song?.platform || this.INFO.ID}:id:${albumId}` : '';
            const recentCount = artistIds.reduce((max, artistId) => Math.max(max, signals.recentArtists.get(artistId) || 0), 0);
            let score = this._hotness(song);
            if (this._isRipOff(song)) score -= 0.35;
            if (this._isInstrumental(song)) score -= 1.2;
            if (signals.favoriteIds.has(id) || signals.favoriteIds.has(this._songKey(song))) score += 1.2;
            if (artistIds.some(artistId => signals.likedArtists.has(artistId))) score += 0.8;
            if (albumId && (signals.favoriteAlbums.has(albumId) || signals.favoriteAlbums.has(albumKey))) score += 0.55;
            score += this._behaviorScore(signals.behaviorSongs, [this._songKey(song)], 4) * 0.2;
            score += this._behaviorScore(signals.behaviorArtists, artistIds, 4) * 0.12;
            score += this._behaviorScore(signals.behaviorAlbums, [albumKey], 4) * 0.1;
            score += this._behaviorScore(signals.dislikedTags, this._songTagKeys(song), 4) * 0.1;
            score += this._edgeBoost(signals, [this._songKey(song), id], 0.5);
            score -= Math.min(0.36, recentCount * 0.12);
            return { song, artistIds, albumId: albumKey, score };
        });
        const ranked = this._shuffle(candidates).sort((a, b) => b.score - a.score);
        const collapsed = this._collapseVariants(ranked);
        return this._diversifyDaily(collapsed).map(item => item.song);
    },

    _diversifyDaily(items) {
        const result = [];
        const deferred = [];
        const artistCounts = new Map();
        const albumCounts = new Map();
        const bump = (item) => {
            (item.artistIds || []).forEach(artistId => { if (artistId) artistCounts.set(artistId, (artistCounts.get(artistId) || 0) + 1); });
            const albumId = item.albumId || '';
            if (albumId) albumCounts.set(albumId, (albumCounts.get(albumId) || 0) + 1);
        };
        const sharesArtist = (a, b) => (a.artistIds || []).some(id => id && (b.artistIds || []).includes(id));
        const underCaps = (item) => {
            if ((item.artistIds || []).some(id => id && (artistCounts.get(id) || 0) >= 2)) return false;
            const albumId = item.albumId || '';
            return !albumId || (albumCounts.get(albumId) || 0) < 2;
        };
        const farFrom = (item, index) => {
            const albumId = item.albumId || '';
            for (let i = Math.max(0, index - 1); i <= Math.min(result.length - 1, index); i++) {
                const other = result[i];
                if (sharesArtist(item, other)) return false;
                if (albumId && other.albumId === albumId) return false;
            }
            return true;
        };
        const fits = (item, index) => underCaps(item) && farFrom(item, index);
        items.forEach(item => {
            if (fits(item, result.length)) {
                result.push(item);
                bump(item);
            } else {
                deferred.push(item);
            }
        });
        deferred.forEach(item => {
            for (let i = result.length; i >= 0; i--) {
                if (!fits(item, i)) continue;
                result.splice(i, 0, item);
                bump(item);
                return;
            }
            if (underCaps(item)) {
                result.push(item);
                bump(item);
            }
        });
        return result;
    },

    _pickSeedSongs(usedKeys, signals) {
        const app = window.app || {};
        this._heartbeat.usedSeeds = this._heartbeat.usedSeeds || new Set();
        const usedSeeds = this._heartbeat.usedSeeds;
        const seen = new Set();
        const collect = (song) => {
            const raw = song?.rawSong && typeof song.rawSong === 'object' ? song.rawSong : song;
            const id = this._songId(raw);
            if (!id) return null;
            if (String(raw.platform || this.INFO.ID) !== this.INFO.ID) return null;
            const key = this._songKey(raw);
            if (usedKeys.has(id) || usedKeys.has(key) || usedSeeds.has(key) || seen.has(key)) return null;
            if (signals.dislikedIds.has(id) || signals.dislikedIds.has(key)) return null;
            seen.add(key);
            return { ...raw, __aerSeed: true };
        };
        const favorites = this._shuffle((Array.isArray(app.favoriteSongs) ? app.favoriteSongs : []).map(collect).filter(Boolean));
        const playlistSongs = [];
        (Array.isArray(app.userPlaylists) ? app.userPlaylists : []).forEach(pl => {
            if (pl && Array.isArray(pl.songs)) pl.songs.forEach(song => {
                const item = collect(song);
                if (item) playlistSongs.push(item);
            });
        });
        this._shuffle(playlistSongs);
        const seeds = [];
        for (let i = 0; seeds.length < 4 && i < Math.max(favorites.length, playlistSongs.length); i++) {
            if (favorites[i]) {
                seeds.push(favorites[i]);
                usedKeys.add(this._songId(favorites[i]));
                usedKeys.add(this._songKey(favorites[i]));
                usedSeeds.add(this._songKey(favorites[i]));
            }
            if (seeds.length < 4 && playlistSongs[i]) {
                seeds.push(playlistSongs[i]);
                usedKeys.add(this._songId(playlistSongs[i]));
                usedKeys.add(this._songKey(playlistSongs[i]));
                usedSeeds.add(this._songKey(playlistSongs[i]));
            }
        }
        return seeds;
    },

    async getRecommendMore(dailySongs) {
        if (this.useInternalRecommend()) return [];
        const base = Array.isArray(dailySongs) ? dailySongs : [];
        const signals = this._recommendSignals();
        const usedKeys = new Set(base.map(song => this._songKey(song) || this._songId(song)).filter(Boolean));
        const seeds = this._pickSeedSongs(usedKeys, signals);
        if (!seeds.length) return [];
        const similarResults = await Promise.allSettled(seeds.map(seed => this._getSimilarSongs(this._songId(seed))));
        const more = [];
        seeds.forEach((seed, index) => {
            more.push(seed);
            const result = similarResults[index];
            if (result.status !== 'fulfilled' || !Array.isArray(result.value)) return;
            const seedArtistId = this._artistIds(seed)[0] || '';
            const albumKeyOf = (song) => {
                const albumId = this._songId(song?.al?.id || song?.album?.id || song?.albumId);
                return albumId ? `${song?.platform || this.INFO.ID}:id:${albumId}` : '';
            };
            const picks = [];
            result.value.forEach(song => {
                if (picks.length >= 2) return;
                const id = this._songId(song);
                const key = this._songKey(song);
                if (!id || !key || usedKeys.has(id) || usedKeys.has(key)) return;
                if (signals.playedIds.has(id) || signals.playedIds.has(key) || signals.dislikedIds.has(id) || signals.dislikedIds.has(key)) return;
                const artistId = this._artistIds(song)[0] || '';
                const albumKey = albumKeyOf(song);
                if (artistId && artistId === seedArtistId) return;
                if (picks.length) {
                    const last = picks[picks.length - 1];
                    if (artistId && artistId === (this._artistIds(last)[0] || '')) return;
                    if (albumKey && albumKey === albumKeyOf(last)) return;
                }
                usedKeys.add(id);
                usedKeys.add(key);
                picks.push(song);
            });
            picks.forEach(song => more.push(song));
        });
        return more;
    },

    _dedup(songs) {
        const seen = new Set();
        return songs.filter(s => {
            const id = this._songId(s);
            if (!id || seen.has(id)) return false;
            seen.add(id);
            return true;
        });
    },

    async _api(endpoint, params = {}) {
        try {
            const res = await axios.get(endpoint, { params });
            return res.data;
        } catch (e) {
            console.warn(`[CloudMusic] API ${endpoint} failed:`, e.message);
            return null;
        }
    },

    

    async search(keyword, options = {}) {
        const limit = options.limit || 100;
        const type = options.type || 1;
        try {
            const res = await axios.get(this.INFO.API.search, {
                params: { keywords: keyword, limit, type }
            });
            const data = res.data;
            if (type === 10) return data.result?.albums || [];
            if (type === 100) return data.result?.artists || [];
            return data.result?.songs || [];
        } catch (e) {
            console.error('[CloudMusic] 搜索失败:', e);
            return [];
        }
    },

    async getSongDetail(songId) {
        const songs = await this.getSongDetails([songId]);
        return songs[0] || null;
    },

    async getSongDetails(ids) {
        const list = (Array.isArray(ids) ? ids : [ids]).map(id => this._songId(id)).filter(Boolean);
        if (!list.length) return [];
        try {
            const res = await axios.get(this.INFO.API.detail, {
                params: { ids: list.join(',') }
            });
            return this._extractList(res.data, 'songs');
        } catch (e) {
            console.error('[CloudMusic] 获取详情失败:', e);
            return [];
        }
    },

    useInternalRecommend() {
        return !!__AER_UPSTREAM__.internalRecommend;
    },

    async getRecommendByProfile(seedId, limit = 5) {
        try {
            const params = { limit };
            if (seedId) params.seed = seedId;
            const app = window.app || {};
            const ids = [];
            const addId = value => {
                const id = this._songId(value);
                if (/^\d{1,15}$/.test(id) && !ids.includes(id)) ids.push(id);
            };
            addId(seedId);
            const playlist = Array.isArray(app.playlist) ? app.playlist : [];
            playlist.slice(Math.max(0, (app.currentIndex || 0) - 4), (app.currentIndex || 0) + 1).forEach(addId);
            (Array.isArray(app.favoriteSongs) ? app.favoriteSongs : []).slice(0, 4).forEach(addId);
            if (ids.length > 1) params.ids = ids.slice(0, 8).join(',');
            params.session_id = this._recommendSessionId();
            params.familiarity = 0.5;
            params.profile = JSON.stringify(this._localRecommendProfile());
            const res = await axios.get('/api/recommend/get', { params });
            const songs = res.data && res.data.data ? res.data.data.songs : null;
            if (!Array.isArray(songs)) return [];
            const disliked = this._recommendSignals().dislikedIds;
            return songs.filter(song => {
                const id = this._songId(song);
                const key = this._songKey(song);
                return !disliked.has(id) && !disliked.has(key);
            });
        } catch (e) {
            console.error('[CloudMusic] 获取推荐失败:', e);
            return [];
        }
    },

    async getSongUrl(songId, options = {}) {
        const quality = options.quality || 'lossless';
        try {
            const res = await axios.get(this.INFO.API.url, {
                params: { id: songId, q: quality, w: 1, ...(options.refresh ? { refresh: 1 } : {}) }
            });
            const rawUrl = typeof res.data?.url === 'string' ? res.data.url.trim() : '';
            let url = /^https?:\/\//i.test(rawUrl) ? rawUrl : '';
            if (url) {
                if (window.app?.getFastestUrl) {
                    url = await window.app.getFastestUrl(url);
                }
            }
            return { url, quality, size: res.data.size || 0 };
        } catch (e) {
            console.error('[CloudMusic] 获取URL失败:', e);
            return { url: null, quality: 'unknown' };
        }
    },

    

    async getLyric(songId) {
        try {
            const res = await axios.get(this.INFO.API.lyric, {
                params: { id: songId }
            });
            const data = res.data;
            
            let tList = [];
            if (data.tlyric?.lyric) {
                data.tlyric.lyric.split('\n').forEach(line => {
                    const m = line.match(/\[(\d+):(\d+)[.:](\d+)\](.*)/);
                    if (m) tList.push({ time: parseInt(m[1]) * 60 + parseInt(m[2]) + parseFloat('0.' + m[3]), text: m[4].trim() });
                });
            }
            if (data.ytlyric?.lyric) {
                data.ytlyric.lyric.split('\n').forEach(line => {
                    const m = line.match(/\[(\d+):(\d+)[.:](\d+)\](.*)/);
                    if (m) tList.push({ time: parseInt(m[1]) * 60 + parseInt(m[2]) + parseFloat('0.' + m[3]), text: m[4].trim() });
                });
            }

            const lrcauthor = data.yrc?.author || data.lrc?.author || "";
            const transauthor = data.ytlyric?.author || data.tlyric?.author || "";
            const yrcauthor = data.yrc?.author || "";
            const lyricist = data.lyricist ?? "";
            const composition = data.composition ?? "";
            const textOf = (value) => Array.isArray(value) ? value.filter(Boolean).join(" / ") : String(value || "").trim();
            const metaItems = [
                { type: "作词", text: textOf(lyricist) },
                { type: "作曲", text: textOf(composition) },
                { type: "滚动歌词贡献者", text: textOf(yrcauthor || lrcauthor) },
                { type: "翻译歌词贡献者", text: textOf(transauthor) }
            ].filter(item => item.text);
            let mainLrc = data.lrc?.lyric || '';
            let yrcStr = data.yrc?.lyric || '';

            const getFirstTime = (content, isYrc = false) => {
                if (!content) return 8000;
                for (const line of content.split('\n')) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('{')) continue;
                    if (isYrc) { const m = trimmed.match(/^\[(\d+),(\d+)\]/); if (m) return parseInt(m[1]); }
                    else { const m = trimmed.match(/\[(\d+):(\d+)(?:[.:](\d{1,3}))?\]/); if (m) return (parseInt(m[1]) * 60 + parseInt(m[2])) * 1000 + parseInt((m[3] || '').padEnd(3, '0') || '0'); }
                }
                return 8000;
            };
            
            const firstTime = Math.min(yrcStr ? getFirstTime(yrcStr, true) : 8000, mainLrc ? getFirstTime(mainLrc, false) : 8000) || 8000;
            const showMeta = window.app?.config?.showMeta !== false;
            const showContributors = window.app?.config?.showContributors !== false;
            let extraCount = 0;
            if (showMeta && lyricist) extraCount++;
            if (showMeta && composition) extraCount++;
            if (showContributors && (lrcauthor || yrcauthor)) extraCount++;
            if (showContributors && transauthor) extraCount++;

            const buildTimedHead = (title, author, lineIndex) => {
                if (!author) return '';
                const timeMs = extraCount > 1 ? Math.floor(firstTime / extraCount * lineIndex) : 0;
                const min = Math.floor(timeMs / 60000); const sec = Math.floor((timeMs % 60000) / 1000); const ms = timeMs % 1000;
                return `[${min.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}.${ms.toString().padStart(3,'0')}] ${title}${author}\n`;
            };
            const buildJsonHead = (title, author, lineIndex) => {
                if (!author) return '';
                const timeMs = extraCount > 1 ? Math.floor(firstTime / extraCount * lineIndex) : 0;
                return `{"t":${timeMs},"c":[{"tx":${JSON.stringify(String(title))}},{"tx":${JSON.stringify(String(author))}}]}\n`;
            };
            const buildExtraHeaders = (isJson) => {
                const build = isJson ? buildJsonHead : buildTimedHead;
                let result = ''; let idx = 0;
                if (showMeta && lyricist) { result += build("作词: ", lyricist, idx); idx++; }
                if (showMeta && composition) { result += build("作曲: ", composition, idx); idx++; }
                if (showContributors && (lrcauthor || yrcauthor)) { result += build("滚动歌词贡献者: ", isJson ? (yrcauthor || lrcauthor) : lrcauthor, idx); idx++; }
                if (showContributors && transauthor) { result += build("翻译歌词贡献者: ", transauthor, idx); idx++; }
                return result;
            };

            const useYrc = yrcStr && yrcStr.trim().length > 0;
            mainLrc = buildExtraHeaders(false) + mainLrc;
            yrcStr = useYrc ? (buildExtraHeaders(true) + yrcStr) : '';

            return {
                lrc: mainLrc,
                tlyric: data.ytlyric?.lyric || (data.tlyric?.lyric || ''),
                yrc: yrcStr,
                ttml: data.ttml || "",
                tList, hasTranslation: tList.length > 0,
                lyricauthor: lrcauthor, transauthor,
                meta: metaItems
            };
        } catch (e) {
            console.error('[CloudMusic] 获取歌词失败:', e);
            return { lrc: '', tlyric: '', yrc: '', ttml: '', tList: [], hasTranslation: false, lyricauthor: "", transauthor: "", meta: [] };
        }
    },

    

    async getRecommend() {
        if (this.useInternalRecommend()) {
            const songs = await this.getRecommendByProfile('', 9);
            if (songs.length > 0) return songs;
        }
        this._startRecommendProfile();
        let songs = null;
        const prefetched = window.__INITIAL_DATA__?.recommend;
        if (prefetched && prefetched.length > 0) {
            console.log('[CloudMusic] 使用后端预注入的推荐数据，歌曲数:', prefetched.length);
            window.__INITIAL_DATA__.recommend = null;
            songs = prefetched.map(s => ({ ...s }));
        }
        if (!songs) {
            try {
                const res = await axios.get(this.INFO.API.recommend);
                songs = res.data?.data?.dailySongs || res.data?.dailySongs || res.data?.data?.data?.dailySongs || [];
            } catch (e) {
                console.error('[CloudMusic] 获取推荐失败:', e);
                return [];
            }
        }
        return this._rankDailySongs(songs);
    },

    

    async getSimilar(songId) {
        const detail = await this.getSongDetail(songId);
        const artistId = detail?.ar?.[0]?.id;
        this._heartbeat.seedArtistId = artistId;
        this._startRecommendProfile();

        const sources = [
            { id: 'similar', weight: 1, load: () => this._getSimilarSongs(songId) },
            { id: 'artist', weight: 0.72, load: () => this._getArtistTopSongs(artistId) },
            { id: 'new', weight: 0.42, load: () => this._getRecommendedNewSongs() },
            { id: 'similarArtist', weight: 0.64, load: () => this._getSimilarArtistSongs(artistId) },
        ];
        const results = await Promise.allSettled(sources.map(source => source.load()));
        const signals = this._recommendSignals();
        const candidateMap = new Map();
        results.forEach((result, index) => {
            if (result.status !== 'fulfilled' || !Array.isArray(result.value)) return;
            const source = sources[index];
            result.value.forEach(song => {
                const id = this._songId(song);
                const songKey = this._songKey(song);
                if (!id || signals.playedIds.has(id) || signals.playedIds.has(songKey) || signals.dislikedIds.has(id) || signals.dislikedIds.has(songKey)) return;
                const artistIds = this._artistIds(song);
                const albumId = this._songId(song?.al?.id || song?.album?.id);
                const candidate = candidateMap.get(id) || { song, id, artistIds, albumId, sources: new Set(), sourceWeight: 0 };
                candidate.sources.add(source.id);
                candidate.sourceWeight = Math.max(candidate.sourceWeight, source.weight);
                candidateMap.set(id, candidate);
            });
        });
        const candidates = [...candidateMap.values()].map(candidate => {
            const recentCount = candidate.artistIds.reduce((max, id) => Math.max(max, signals.recentArtists.get(id) || 0), 0);
            const liked = candidate.artistIds.some(id => signals.likedArtists.has(id));
            let score = candidate.sourceWeight + (candidate.sources.has('similar') ? 0.34 : 0);
            if (this._isRipOff(candidate.song)) score -= 0.35;
            if (this._isInstrumental(candidate.song)) score -= 1.2;
            if (candidate.artistIds.some(id => id === `${this.INFO.ID}:id:${artistId}`)) score += 0.18;
            if (liked) score += 0.24;
            if (signals.favoriteIds.has(candidate.id) || signals.favoriteIds.has(this._songKey(candidate.song))) score += 0.3;
            if (candidate.albumId && (signals.favoriteAlbums.has(candidate.albumId) || signals.favoriteAlbums.has(`${this.INFO.ID}:id:${candidate.albumId}`))) score += 0.16;
            score += this._behaviorScore(signals.behaviorSongs, [this._songKey(candidate.song)], 4) * 0.16;
            score += this._behaviorScore(signals.behaviorArtists, candidate.artistIds, 4) * 0.1;
            score += this._behaviorScore(signals.behaviorAlbums, [candidate.albumId ? `${candidate.song?.platform || this.INFO.ID}:id:${candidate.albumId}` : ''], 4) * 0.08;
            score += this._behaviorScore(signals.dislikedTags, this._songTagKeys(candidate.song), 4) * 0.1;
            score += this._edgeBoost(signals, [this._songKey(candidate.song), candidate.id], 0.3);
            score += this._hotness(candidate.song);
            score += Math.min(0.08, (candidate.sources.size - 1) * 0.04);
            score -= Math.min(0.42, recentCount * 0.14);
            return { ...candidate, score };
        });
        let ranked = this._shuffle(candidates).sort((a, b) => b.score - a.score);
        ranked = this._collapseVariants(ranked);
        const direct = this._pickDiverse(ranked.filter(item => item.sources.has('similar')), 19);
        const explore = this._pickDiverse(ranked.filter(item => !item.sources.has('similar')), 8);
        const selected = [];
        let directIndex = 0;
        let exploreIndex = 0;
        while (selected.length < 24 && (directIndex < direct.length || exploreIndex < explore.length)) {
            for (let i = 0; i < 2 && directIndex < direct.length && selected.length < 24; i++) selected.push(direct[directIndex++]);
            if (exploreIndex < explore.length && selected.length < 24) selected.push(explore[exploreIndex++]);
            if (directIndex >= direct.length) while (exploreIndex < explore.length && selected.length < 24) selected.push(explore[exploreIndex++]);
        }
        const pool = this._pickDiverse(selected, 24).map(item => item.song);
        const headSize = Math.min(8, pool.length);
        const head = this._shuffle(pool.slice(0, headSize));
        return head.concat(pool.slice(headSize));
    },

    async _getSimilarSongs(songId) {
        const data = await this._api(this.INFO.API.similar, { id: songId });
        return this._extractList(data, 'songs');
    },

    async _getArtistTopSongs(artistId) {
        if (!artistId) return [];
        const data = await this._api(this.INFO.API.artistTopSong, { id: artistId });
        return this._extractList(data, 'songs');
    },

    async _getSimilarArtistSongs(artistId) {
        if (!artistId) return [];
        const data = await this._api(this.INFO.API.simiArtist, { id: artistId });
        const artists = this._extractList(data, 'artists');
        if (artists.length === 0) return [];
        const picked = this._shuffle(artists).slice(0, 2);
        const results = await Promise.allSettled(picked.map(a => this._getArtistTopSongs(a.id)));
        let songs = [];
        results.forEach(r => { if (r.status === 'fulfilled') songs.push(...r.value); });
        return songs;
    },

    async _getRecommendedNewSongs() {
        const data = await this._api(this.INFO.API.personalizedNewSong, { limit: 30 });
        return this._extractList(data, 'result').map(item => item.song || item);
    },

    async _loadHotPlaylistIds() {
        try {
            const [hot, rec] = await Promise.allSettled([
                this._api(this.INFO.API.topPlaylist, { cat: '华语', limit: 30, order: 'hot' }),
                this._api(this.INFO.API.personalized, { limit: 20 }),
            ]);
            const ids = [];
            if (hot.status === 'fulfilled') ids.push(...this._extractList(hot.value, 'playlists').map(p => p.id));
            if (rec.status === 'fulfilled') ids.push(...this._extractList(rec.value, 'result').map(p => p.id));
            this._heartbeat.hotPlaylistIds = this._shuffle([...new Set(ids)]);
            this._heartbeat.hotPlaylistCursor = 0;
        } catch (e) {
            console.warn('[CloudMusic] 加载热门歌单失败:', e);
        }
    },

    async expandFromHotPlaylists(count = 2) {
        const hb = this._heartbeat;
        if (hb.hotPlaylistIds.length === 0) await this._loadHotPlaylistIds();
        let songs = [];
        for (let i = 0; i < count; i++) {
            const pid = hb.hotPlaylistIds[hb.hotPlaylistCursor % hb.hotPlaylistIds.length];
            hb.hotPlaylistCursor++;
            if (pid) {
                const data = await this._api(this.INFO.API.playlistTrackAll, { id: pid, limit: 30 });
                songs.push(...this._extractList(data, 'songs'));
            }
        }
        return this._shuffle(songs);
    },

    

    async getPlaylistDetail(playlistId) {
        const id = String(playlistId || '').trim();
        if (!/^\d{1,15}$/.test(id)) return null;
        try {
            const res = await axios.get(this.INFO.API.playlistDetail, { params: { id } });
            const data = res.data || {};
            return data.playlist || data.data?.playlist || null;
        } catch (e) {
            console.error('[CloudMusic] 获取歌单详情失败:', e);
            return null;
        }
    },

    async getPlaylistSongs(playlistId, limit = 1000) {
        const id = String(playlistId || '').trim();
        if (!/^\d{1,15}$/.test(id)) return [];
        const max = Math.min(1000, Math.max(1, Number(limit) || 1000));
        const songs = [];
        let offset = 0;
        for (let page = 0; page < 12 && songs.length < max; page++) {
            const size = Math.min(500, max - songs.length);
            let list = [];
            try {
                const res = await axios.get(this.INFO.API.playlistTrackAll, { params: { id, limit: size, offset } });
                list = this._extractList(res.data, 'songs');
            } catch (e) {
                console.error('[CloudMusic] 获取歌单歌曲失败:', e);
                break;
            }
            if (!list.length) break;
            songs.push(...list);
            offset += list.length;
        }
        return songs.slice(0, max);
    },

    async getArtistDetail(artistId) {
        try {
            const res = await axios.get(this.INFO.API.artistDetail, { params: { id: artistId } });
            return res.data.code === 200 ? res.data.data : null;
        } catch (e) { console.error('[CloudMusic] 获取歌手详情失败:', e); return null; }
    },

    async getArtistSongs(artistId) {
        try {
            const res = await axios.get(this.INFO.API.artists, { params: { id: artistId } });
            return res.data.code === 200 && res.data.hotSongs ? res.data.hotSongs : [];
        } catch (e) { console.error('[CloudMusic] 获取歌手歌曲失败:', e); return []; }
    },

    async getArtistAlbums(artistId, limit = 30) {
        try {
            const res = await axios.get(this.INFO.API.artistAlbum, { params: { id: artistId, limit } });
            return res.data.code === 200 && res.data.hotAlbums ? res.data.hotAlbums : [];
        } catch (e) { console.error('[CloudMusic] 获取歌手专辑失败:', e); return []; }
    },

    async getAlbum(albumId) {
        try {
            const res = await axios.get(this.INFO.API.album, { params: { id: albumId } });
            return res.data.code === 200 && res.data.songs ? res.data.songs : [];
        } catch (e) { console.error('[CloudMusic] 获取专辑失败:', e); return []; }
    },

    async getSearchSuggest(keyword) {
        try {
            
            const [res, mobileRes] = await Promise.all([
                axios.get(this.INFO.API.searchSuggest, { params: { keywords: keyword } }),
                axios.get(this.INFO.API.searchSuggest, { params: { keywords: keyword, type: 'mobile' } }).catch(() => null)
            ]);
            if (res.data.code !== 200 || !res.data.result) return null;
            const allMatch = mobileRes && mobileRes.data && mobileRes.data.result ? mobileRes.data.result.allMatch : null;
            res.data.result.keywords = Array.isArray(allMatch) ? allMatch.map(item => item && item.keyword).filter(word => typeof word === 'string' && word.trim()) : [];
            return res.data.result;
        } catch (e) { console.error('[CloudMusic] 获取搜索建议失败:', e); return null; }
    },

    normalizeSong(rawSong) {
        const pic = rawSong.al?.picUrl || rawSong.album?.picUrl || '';
        return {
            id: rawSong.id,
            name: rawSong.name || '未知歌曲',
            artist: this.formatArtists(rawSong.ar || rawSong.artists),
            album: rawSong.al?.name || rawSong.album?.name || '',
            cover: pic ? pic + '?param=600y600' : '',
            coverSmall: pic ? pic + '?param=200y200' : '',
            coverLarge: pic ? pic + '?param=1000y1000' : '',
            duration: rawSong.dt || 0,
            artists: (Array.isArray(rawSong.ar) ? rawSong.ar : Array.isArray(rawSong.artists) ? rawSong.artists : [])
                .map(a => ({ id: a.id, name: a.name })),
            albumId: rawSong.al?.id || rawSong.album?.id,
            platform: this.INFO.ID,
            platformName: this.INFO.NAME,
            platformColor: this.INFO.COLOR
        };
    },

    formatArtists(artists) {
        if (typeof artists === 'string') return artists || '未知歌手';
        if (!artists || !artists.length) return '未知歌手';
        return artists.map(a => a.name || a).join(' / ');
    },

    normalizeArtist(rawArtist) {
        return {
            id: rawArtist.id, name: rawArtist.name || '未知歌手',
            cover: rawArtist.picUrl || rawArtist.img1v1Url || '',
            alias: rawArtist.alias || [], description: rawArtist.briefDesc || '',
            albumSize: rawArtist.albumSize || 0, musicSize: rawArtist.musicSize || 0,
            platform: this.INFO.ID
        };
    },

    normalizeAlbum(rawAlbum) {
        return {
            id: rawAlbum.id, name: rawAlbum.name || '未知专辑',
            cover: rawAlbum.picUrl || '',
            artist: rawAlbum.artists ? rawAlbum.artists.map(a => a.name).join(' / ') : '未知歌手',
            description: rawAlbum.description || '', size: rawAlbum.size || 0,
            publishTime: rawAlbum.publishTime || 0, platform: this.INFO.ID
        };
    }
};

if (window.PlatformCore) {
    window.PlatformCore.register(CloudMusicPlatform);
} else {
    window.addEventListener('DOMContentLoaded', () => {
        if (window.PlatformCore) window.PlatformCore.register(CloudMusicPlatform);
    });
}

window.CloudMusicPlatform = CloudMusicPlatform;
