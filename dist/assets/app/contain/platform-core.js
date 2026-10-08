/**
 * AerMusic 多音源平台核心系统
 * 统一管理各音乐平台适配器，提供标准化的歌曲数据格式
 * v2: 视觉资源归适配器(INFO.ICON), 不再调 window.app, 改事件总线
 */

const PlatformCore = {
    // 已注册的平台
    platforms: {},

    // 当前激活的平台列表（搜索时使用）
    activePlatforms: [],

    /**
     * 注册平台
     * @param {Object} platform - 平台适配器对象
     */
    register(platform) {
        if (!platform || !platform.INFO || !platform.INFO.ID) {
            console.error('[PlatformCore] 平台注册失败: 缺少 INFO.ID');
            return false;
        }

        const id = platform.INFO.ID;

        const requiredMethods = ['search', 'getSongDetail', 'getSongUrl', 'normalizeSong'];
        for (const method of requiredMethods) {
            if (typeof platform[method] !== 'function') {
                console.error(`[PlatformCore] 平台 ${id} 缺少必需方法: ${method}`);
                return false;
            }
        }

        this.platforms[id] = platform;
        this._rebuildActive();

        console.log(`[PlatformCore] 平台已注册: ${platform.INFO.NAME} (${id})`);
        return true;
    },

    // 无保存记录(null)时全部平台默认启用, 有记录(含空列表)则严格跟随用户开关
    _rebuildActive() {
        const saved = this._readSaved();
        const all = Object.keys(this.platforms);
        this.activePlatforms = saved === null ? all : all.filter(pid => saved.includes(pid));
    },

    /**
     * 获取平台实例
     * @param {string} platformId
     */
    get(platformId) {
        return this.platforms[platformId] || null;
    },

    // 能力表: 优先读适配器声明的 INFO.FEATURES, 缺的按方法存在性补齐
    features(platformId) {
        const platform = this.platforms[platformId];
        if (!platform) return null;
        if (platform.features) return platform.features;
        const f = platform.INFO.FEATURES ? { ...platform.INFO.FEATURES } : {};
        const optMap = { getLyric: 'lyric', getSimilar: 'similar', getRecommend: 'recommend', getAlbum: 'album', getSearchSuggest: 'suggest' };
        for (const [method, key] of Object.entries(optMap)) {
            if (typeof platform[method] === 'function') f[key] = true;
        }
        platform.features = f;
        return f;
    },

    /**
     * 切换平台启用状态
     */
    toggle(platformId) {
        const idx = this.activePlatforms.indexOf(platformId);
        if (idx > -1) {
            this.activePlatforms.splice(idx, 1);
        } else {
            this.activePlatforms.push(platformId);
        }
        this._saveActive();
        if (window.app && window.app.bus) window.app.bus.emit('platforms:changed', this.getAvailablePlatforms());
    },

    _saveActive() {
        localStorage.setItem('AerMusic_ActivePlatforms', JSON.stringify(this.activePlatforms));
    },

    _readSaved() {
        const raw = localStorage.getItem('AerMusic_ActivePlatforms');
        if (raw === null) return null;
        try {
            const saved = JSON.parse(raw);
            return Array.isArray(saved) ? saved : null;
        } catch (e) {
            localStorage.removeItem('AerMusic_ActivePlatforms');
            return null;
        }
    },

    /**
     * 统一搜索接口 - 并行搜索所有激活平台
     * @param {string} keyword
     * @param {Object} options
     */
    async searchAll(keyword, options = {}) {
        const limit = options.limit || 100;
        const results = {};

        const searchPromises = this.activePlatforms.map(async platformId => {
            const platform = this.platforms[platformId];
            if (!platform) return;

            try {
                const rawResults = await platform.search(keyword, { limit, type: options.type });
                results[platformId] = [];
                for (const song of (rawResults || [])) {
                    try {
                        results[platformId].push(this.normalizeSongData(song, platformId));
                    } catch (e) {
                        console.warn(`[PlatformCore] ${platformId} 单条结果转换失败:`, e);
                    }
                }
            } catch (e) {
                console.error(`[PlatformCore] ${platformId} 搜索失败:`, e);
                results[platformId] = [];
            }
        });

        await Promise.all(searchPromises);
        return results;
    },

    /**
     * 单平台搜索
     */
    async search(platformId, keyword, options = {}) {
        const platform = this.platforms[platformId];
        if (!platform) {
            console.error(`[PlatformCore] 平台不存在: ${platformId}`);
            return [];
        }

        try {
            const rawResults = await platform.search(keyword, options);
            return (rawResults || []).map(song => this.normalizeSongData(song, platformId));
        } catch (e) {
            console.error(`[PlatformCore] ${platformId} 搜索失败:`, e);
            return [];
        }
    },

    /**
     * 获取歌曲详情（含播放URL）
     * @param {string} platformId
     * @param {string} songId
     */
    async getFullSongData(platformId, songId) {
        const platform = this.platforms[platformId];
        if (!platform) return null;

        try {
            const [detail, urlData] = await Promise.all([
                platform.getSongDetail(songId),
                platform.getSongUrl(songId)
            ]);

            if (!detail) return null;

            const normalized = this.normalizeSongData(detail, platformId);
            normalized.url = urlData?.url || null;
            normalized.quality = urlData?.quality || 'unknown';

            if (this.features(platformId)?.lyric) {
                const lyricData = await platform.getLyric(songId);
                normalized.lyricData = lyricData;
            }

            return normalized;
        } catch (e) {
            console.error(`[PlatformCore] 获取歌曲数据失败:`, e);
            return null;
        }
    },

    /**
     * 标准化歌曲数据格式
     * 必须经适配器自己的 normalizeSong 转换, core 只合入平台元数据
     */
    normalizeSongData(rawSong, platformId) {
        const platform = this.platforms[platformId];
        if (!platform || !rawSong) return null;

        if (typeof platform.normalizeSong !== 'function') {
            console.error(`[PlatformCore] 平台 ${platformId} 缺少 normalizeSong, 无法标准化数据`);
            return null;
        }

        return {
            ...platform.normalizeSong(rawSong),
            platform: platformId,
            platformName: platform.INFO.NAME,
            platformColor: platform.INFO.COLOR || '#ffffff'
        };
    },

    /**
     * 提取封面URL（供适配器复用的通用工具）
     */
    extractCover(song) {
        if (song.cover) return song.cover;
        if (song.al?.picUrl) return song.al.picUrl;
        if (song.album?.picUrl) return song.album.picUrl;
        if (song.albumCover) return song.albumCover;
        return '';
    },

    /**
     * 格式化艺术家列表（供适配器复用的通用工具）
     */
    formatArtists(artists) {
        if (!artists) return '未知歌手';
        if (typeof artists === 'string') return artists;
        if (Array.isArray(artists)) {
            return artists.map(a => a.name || a).join(' / ');
        }
        return '未知歌手';
    },

    /**
     * 格式化时长 mm:ss（供适配器复用的通用工具）
     */
    formatDuration(ms) {
        if (!ms || isNaN(ms)) return '00:00';
        const totalSec = Math.floor(ms / 1000);
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        return `${min}:${sec.toString().padStart(2, '0')}`;
    },

    /**
     * 获取可用平台列表（用于设置渲染）
     */
    getAvailablePlatforms() {
        return Object.values(this.platforms).map(p => ({
            id: p.INFO.ID,
            name: p.INFO.NAME,
            description: p.INFO.DESCRIPTION || '',
            icon: p.INFO.ICON || '',
            color: p.INFO.COLOR || '#666',
            author: p.INFO.AUTHOR || '',
            authorUrl: p.INFO.AUTHOR_URL || '',
            enabled: this.activePlatforms.includes(p.INFO.ID)
        }));
    },

    /**
     * 获取相似歌曲
     * @param {string} platformId
     * @param {string} songId
     */
    async getSimilar(platformId, songId) {
        const platform = this.platforms[platformId];
        if (!platform || !this.features(platformId)?.similar) return [];

        try {
            const rawResults = await platform.getSimilar(songId);
            return (rawResults || []).map(song => this.normalizeSongData(song, platformId));
        } catch (e) {
            console.error(`[PlatformCore] 获取相似歌曲失败:`, e);
            return [];
        }
    },

    /**
     * 获取每日推荐
     * @param {string} platformId
     */
    async getRecommend(platformId) {
        const pid = platformId || this.activePlatforms[0];
        const platform = this.platforms[pid];
        if (!platform || !this.features(pid)?.recommend) return [];

        try {
            const rawResults = await platform.getRecommend();
            return (rawResults || []).map(song => this.normalizeSongData(song, pid));
        } catch (e) {
            console.error(`[PlatformCore] 获取推荐失败:`, e);
            return [];
        }
    },

    /**
     * 获取歌词
     * @param {string} platformId
     * @param {string} songId
     */
    async getLyric(platformId, songId) {
        const platform = this.platforms[platformId];
        if (!platform || !this.features(platformId)?.lyric) {
            return { lrc: '', tlyric: '', yrc: '', tList: [], hasTranslation: false };
        }

        try {
            return await platform.getLyric(songId);
        } catch (e) {
            console.error(`[PlatformCore] 获取歌词失败:`, e);
            return { lrc: '', tlyric: '', yrc: '', tList: [], hasTranslation: false };
        }
    },

    /**
     * 获取专辑歌曲
     */
    async getAlbum(platformId, albumId) {
        const platform = this.platforms[platformId];
        if (!platform || !this.features(platformId)?.album) return [];

        try {
            const rawResults = await platform.getAlbum(albumId);
            return (rawResults || []).map(song => this.normalizeSongData(song, platformId));
        } catch (e) {
            console.error(`[PlatformCore] 获取专辑歌曲失败:`, e);
            return [];
        }
    },

    /**
     * 获取搜索建议
     */
    async getSearchSuggest(platformId, keyword) {
        const platform = this.platforms[platformId];
        if (!platform || !this.features(platformId)?.suggest) return null;

        try {
            return await platform.getSearchSuggest(keyword);
        } catch (e) {
            console.error(`[PlatformCore] 获取搜索建议失败:`, e);
            return null;
        }
    },

    /**
     * 获取当前默认平台
     */
    getDefaultPlatform() {
        return this.activePlatforms[0] || 'cloudmusic';
    }
};

// 导出到全局
window.PlatformCore = PlatformCore;
