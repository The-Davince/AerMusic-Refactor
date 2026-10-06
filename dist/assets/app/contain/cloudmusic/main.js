/**
 * 网易云音乐平台适配器 - 后端API注入版
 * AerMusic 多音源系统
 * 
 * 核心设计：
 * - 所有API请求通过后端内部路由 /api/*，前端看不到真实API地址
 * - 初始推荐数据由后端预注入 window.__INITIAL_DATA__.recommend
 * - 动态请求（搜索、歌词等）走后端内部路由
 * - 多源混合推荐系统（心动模式）
 */

const CloudMusicPlatform = {
    INFO: {
        ID: 'cloudmusic',
        NAME: '网易云音乐',
        VERSION: '5.0.0',
        AUTHOR: 'AerMusic Team',
        AUTHOR_URL: 'https://github.com/The-Davince',
        
        ICON: `<svg viewBox="0 0 24 24" fill="currentColor"><path fill="#ffffffff" d="M12.001 22c-5.523 0-10-4.477-10-10s4.477-10 10-10s10 4.477 10 10s-4.477 10-10 10m-1.086-10.432c.24-.84 1.075-1.541 1.99-1.648c.187.694.388 1.373.545 2.063c.053.23.037.495-.018.727c-.213.892-1.248 1.242-1.978.685c-.53-.405-.742-1.12-.539-1.827m3.817-.197c-.125-.465-.256-.927-.393-1.42c.5.13.907.36 1.255.697c1.257 1.222 1.385 3.3.294 4.732c-1.135 1.49-3.155 2.134-5.028 1.605c-2.302-.65-3.808-2.952-3.441-5.316c.274-1.768 1.27-3.004 2.9-3.733c.407-.182.58-.56.42-.93c-.157-.364-.54-.504-.944-.343c-2.721 1.088-4.32 4.134-3.67 6.987c.713 3.118 3.495 5.163 6.675 4.859c1.732-.166 3.164-.948 4.216-2.347c1.506-2.002 1.297-4.783-.463-6.499c-.666-.65-1.471-1.018-2.39-1.153c-.083-.013-.217-.052-.232-.106c-.087-.313-.18-.632-.206-.954c-.029-.357.29-.64.65-.645c.253-.003.434.13.603.3c.303.3.704.322.988.062c.29-.264.296-.678.018-1.008c-.566-.672-1.586-.891-2.43-.523c-.847.37-1.321 1.187-1.2 2.093c.038.28.11.557.167.842l-.26.072a3.86 3.86 0 0 0-2.098 1.414c-.921 1.22-.936 2.828-.041 3.947c1.274 1.594 3.747 1.284 4.523-.568c.284-.677.275-1.368.087-2.065"/></svg>`,
        COLOR: '#e60026',
        
        FEATURES: {
            search: true,
            lyric: true,
            recommend: true,
            similar: true,
            playlist: true,
            download: true,
            heartbeat: true
        },
        
        // 仅暴露后端内部路由，真实API地址完全不在前端代码中
        API: {
            search: '/api/search',
            detail: '/api/song/detail',
            url: '/api/song/url',
            lyric: '/api/lyric',
            similar: '/api/simi/song',
            recommend: '/api/recommend/songs',
            artistTopSong: '/api/artist/top/song',
            simiArtist: '/api/simi/artist',
            topPlaylist: '/api/top/playlist',
            playlistTrackAll: '/api/playlist/track/all',
            personalizedNewSong: '/api/personalized/newsong',
            personalized: '/api/personalized',
            artistDetail: '/api/artist/detail',
            artists: '/api/artists',
            artistAlbum: '/api/artist/album',
            album: '/api/album',
            searchSuggest: '/api/search/suggest'
        },
        
        DESCRIPTION: 'music.163.com · 心动模式增强 · 后端注入版'
    },

    _heartbeat: {
        hotPlaylistIds: [],
        hotPlaylistCursor: 0,
        similarArtistIdx: 0,
        seedArtistId: null,
    },

    _shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    },

    _dedup(songs) {
        const seen = new Set();
        return songs.filter(s => {
            if (seen.has(s.id)) return false;
            seen.add(s.id);
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

    // ========== 核心方法 ==========

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
        try {
            const res = await axios.get(this.INFO.API.detail, {
                params: { ids: songId }
            });
            return res.data.songs?.[0] || null;
        } catch (e) {
            console.error('[CloudMusic] 获取详情失败:', e);
            return null;
        }
    },

    async getSongUrl(songId, options = {}) {
        const quality = options.quality || 'lossless';
        try {
            const res = await axios.get(this.INFO.API.url, {
                params: { id: songId, q: quality, w: 1 }
            });
            let url = res.data.url;
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

    // ========== 歌词 ==========

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
            let mainLrc = data.lrc?.lyric || '';
            let yrcStr = data.yrc?.lyric || '';

            const getFirstTime = (content, isYrc = false) => {
                if (!content) return 8000;
                for (const line of content.split('\n')) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('{')) continue;
                    if (isYrc) { const m = trimmed.match(/^\[(\d+),(\d+)\]/); if (m) return parseInt(m[1]); }
                    else { const m = trimmed.match(/\[(\d+):(\d+)[.:](\d+)\]/); if (m) return (parseInt(m[1]) * 60 + parseInt(m[2])) * 1000 + parseInt(m[3]); }
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
                tList, hasTranslation: tList.length > 0,
                lyricauthor: lrcauthor, transauthor
            };
        } catch (e) {
            console.error('[CloudMusic] 获取歌词失败:', e);
            return { lrc: '', tlyric: '', yrc: '', tList: [], hasTranslation: false, lyricauthor: "", transauthor: "" };
        }
    },

    // ========== 推荐（优先读取后端预注入数据） ==========

    async getRecommend() {
        const prefetched = window.__INITIAL_DATA__?.recommend;
        if (prefetched && prefetched.length > 0) {
            console.log('[CloudMusic] 使用后端预注入的推荐数据，歌曲数:', prefetched.length);
            window.__INITIAL_DATA__.recommend = null;
            return prefetched.map(s => ({ ...s }));
        }
        try {
            const res = await axios.get(this.INFO.API.recommend);
            return res.data.data?.dailySongs || [];
        } catch (e) {
            console.error('[CloudMusic] 获取推荐失败:', e);
            return [];
        }
    },

    // ========== 相似歌曲（多源混合） ==========

    async getSimilar(songId) {
        const detail = await this.getSongDetail(songId);
        const artistId = detail?.ar?.[0]?.id;
        this._heartbeat.seedArtistId = artistId;

        const results = await Promise.allSettled([
            this._getSimilarSongs(songId),
            this._getArtistTopSongs(artistId),
            this._getRecommendedNewSongs(),
            this._getSimilarArtistSongs(artistId),
        ]);
        
        let pool = [];
        results.forEach(r => { if (r.status === 'fulfilled' && Array.isArray(r.value)) pool.push(...r.value); });
        pool = this._dedup(this._shuffle(pool));
        this._loadHotPlaylistIds();
        return pool;
    },

    async _getSimilarSongs(songId) {
        const data = await this._api(this.INFO.API.similar, { id: songId });
        return data?.data?.songs || [];
    },

    async _getArtistTopSongs(artistId) {
        if (!artistId) return [];
        const data = await this._api(this.INFO.API.artistTopSong, { id: artistId });
        return data?.songs || [];
    },

    async _getSimilarArtistSongs(artistId) {
        if (!artistId) return [];
        const data = await this._api(this.INFO.API.simiArtist, { id: artistId });
        const artists = data?.data?.artists || [];
        if (artists.length === 0) return [];
        const picked = this._shuffle(artists).slice(0, 2);
        const results = await Promise.allSettled(picked.map(a => this._getArtistTopSongs(a.id)));
        let songs = [];
        results.forEach(r => { if (r.status === 'fulfilled') songs.push(...r.value); });
        return songs;
    },

    async _getRecommendedNewSongs() {
        const data = await this._api(this.INFO.API.personalizedNewSong, { limit: 30 });
        return (data?.result || []).map(item => item.song || item);
    },

    async _loadHotPlaylistIds() {
        try {
            const [hot, rec] = await Promise.allSettled([
                this._api(this.INFO.API.topPlaylist, { cat: '华语', limit: 30, order: 'hot' }),
                this._api(this.INFO.API.personalized, { limit: 20 }),
            ]);
            const ids = [];
            if (hot.status === 'fulfilled' && hot.value?.playlist?.playlists) ids.push(...hot.value.playlist.playlists.map(p => p.id));
            if (rec.status === 'fulfilled' && rec.value?.result) ids.push(...rec.value.result.map(p => p.id));
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
                if (data?.songs) songs.push(...data.songs);
            }
        }
        return this._shuffle(songs);
    },

    // ========== 其他接口 ==========

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
            const res = await axios.get(this.INFO.API.searchSuggest, { params: { keywords: keyword } });
            return res.data.code === 200 && res.data.result ? res.data.result : null;
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
