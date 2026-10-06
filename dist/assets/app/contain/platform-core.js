/**
 * AerMusic 多音源平台核心系统
 * 统一管理各音乐平台适配器，提供标准化的歌曲数据格式
 */

const PlatformCore = {
    // 已注册的平台
    platforms: {},
    
    // 当前激活的平台列表（搜索时使用）
    activePlatforms: [],
    
    // 平台图标映射
    platformIcons: {
        cloudmusic: `<svg viewBox="0 0 24 24" fill="currentColor"><path fill="#ffffffff" d="M12.001 22c-5.523 0-10-4.477-10-10s4.477-10 10-10s10 4.477 10 10s-4.477 10-10 10m-1.086-10.432c.24-.84 1.075-1.541 1.99-1.648c.187.694.388 1.373.545 2.063c.053.23.037.495-.018.727c-.213.892-1.248 1.242-1.978.685c-.53-.405-.742-1.12-.539-1.827m3.817-.197c-.125-.465-.256-.927-.393-1.42c.5.13.907.36 1.255.697c1.257 1.222 1.385 3.3.294 4.732c-1.135 1.49-3.155 2.134-5.028 1.605c-2.302-.65-3.808-2.952-3.441-5.316c.274-1.768 1.27-3.004 2.9-3.733c.407-.182.58-.56.42-.93c-.157-.364-.54-.504-.944-.343c-2.721 1.088-4.32 4.134-3.67 6.987c.713 3.118 3.495 5.163 6.675 4.859c1.732-.166 3.164-.948 4.216-2.347c1.506-2.002 1.297-4.783-.463-6.499c-.666-.65-1.471-1.018-2.39-1.153c-.083-.013-.217-.052-.232-.106c-.087-.313-.18-.632-.206-.954c-.029-.357.29-.64.65-.645c.253-.003.434.13.603.3c.303.3.704.322.988.062c.29-.264.296-.678.018-1.008c-.566-.672-1.586-.891-2.43-.523c-.847.37-1.321 1.187-1.2 2.093c.038.28.11.557.167.842l-.26.072a3.86 3.86 0 0 0-2.098 1.414c-.921 1.22-.936 2.828-.041 3.947c1.274 1.594 3.747 1.284 4.523-.568c.284-.677.275-1.368.087-2.065"/></svg>`,
        kugou: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>`,
        kuwo: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3L2 12h3v9h6v-6h2v6h6v-9h3L12 3z"/></svg>`,
        qqmusic: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`,
        qishui: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`,
        joox: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9h-4v4h-2v-4H9V9h4V5h2v4h4v2z"/></svg>`,
        custom: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>`
    },
    
    /**
     * 注册平台
     * @param {Object} platform - 平台适配器对象
     */
    register(platform) {
        if (!platform.INFO || !platform.INFO.ID) {
            console.error('[PlatformCore] 平台注册失败: 缺少 INFO.ID');
            return false;
        }
        
        const id = platform.INFO.ID;
        
        // 验证必需的方法
        const requiredMethods = ['search', 'getSongDetail', 'getSongUrl'];
        for (const method of requiredMethods) {
            if (typeof platform[method] !== 'function') {
                console.error(`[PlatformCore] 平台 ${id} 缺少必需方法: ${method}`);
                return false;
            }
        }
        
        if (this.activePlatforms.includes(id)) return true;
        this.platforms[id] = platform;
        this.activePlatforms.push(id);
        this.restoreActivePlatforms();
        if (!this.activePlatforms.includes(id)) this.activePlatforms.push(id);
        
        console.log(`[PlatformCore] 平台已注册: ${platform.INFO.NAME} (${id})`);
        return true;
    },
    
    /**
     * 获取平台实例
     * @param {string} platformId 
     */
    get(platformId) {
        return this.platforms[platformId] || null;
    },
    
    /**
     * 获取所有平台信息列表
     */
    getPlatformList() {
        return Object.values(this.platforms).map(p => ({
            id: p.INFO.ID,
            name: p.INFO.NAME,
            icon: p.INFO.ICON || this.platformIcons[p.INFO.ID] || this.platformIcons.custom,
            color: p.INFO.COLOR || '#ffffff',
            enabled: this.activePlatforms.includes(p.INFO.ID)
        }));
    },
    
    /**
     * 切换平台启用状态
     */
    togglePlatform(platformId) {
        const idx = this.activePlatforms.indexOf(platformId);
        if (idx > -1) {
            this.activePlatforms.splice(idx, 1);
        } else {
            this.activePlatforms.push(platformId);
        }
        this.saveActivePlatforms();
    },
    
    /**
     * 保存激活的平台列表
     */
    saveActivePlatforms() {
        localStorage.setItem('AerMusic_ActivePlatforms', JSON.stringify(this.activePlatforms));
    },
    
    /**
     * 恢复激活的平台列表
     */
    restoreActivePlatforms() {
        const saved = localStorage.getItem('AerMusic_ActivePlatforms');
        if (saved) {
            try {
                const savedList = JSON.parse(saved);
                if (Array.isArray(savedList)) {
                    this.activePlatforms = savedList.filter(id => this.platforms[id]);
                }
            } catch (e) {
                localStorage.removeItem('AerMusic_ActivePlatforms');
            }
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
            return rawResults.map(song => this.normalizeSongData(song, platformId));
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
            // 并行获取详情和URL
            const [detail, urlData] = await Promise.all([
                platform.getSongDetail(songId),
                platform.getSongUrl(songId)
            ]);
            
            if (!detail) return null;
            
            const normalized = this.normalizeSongData(detail, platformId);
            normalized.url = urlData?.url || null;
            normalized.quality = urlData?.quality || 'unknown';
            
            // 获取歌词
            if (platform.getLyric) {
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
     * 各平台返回的数据统一转换为以下格式：
     */
    normalizeSongData(rawSong, platformId) {
        const platform = this.platforms[platformId];
        if (!platform || !rawSong) return null;
        
        // 如果平台有自己的标准化方法，优先使用
        if (platform.normalizeSong) {
            return {
                ...platform.normalizeSong(rawSong),
                platform: platformId,
                platformName: platform.INFO.NAME,
                platformColor: platform.INFO.COLOR || '#ffffff'
            };
        }
        
        // 默认标准化
        return {
            id: rawSong.id || rawSong.songId,
            name: rawSong.name || rawSong.songName || '未知歌曲',
            artist: this.formatArtists(rawSong.ar || rawSong.artists || rawSong.artist),
            album: rawSong.al?.name || rawSong.album?.name || rawSong.albumName || '',
            albumId: rawSong.al?.id || rawSong.album?.id || rawSong.albumId,
            cover: this.extractCover(rawSong),
            duration: rawSong.dt || rawSong.duration || 0,
            artists: rawSong.ar || rawSong.artists || [],
            platform: platformId,
            platformName: platform.INFO.NAME,
            platformColor: platform.INFO.COLOR || '#ffffff'
        };
    },
    
    /**
     * 提取封面URL
     */
    extractCover(song) {
        if (song.cover) return song.cover;
        if (song.al?.picUrl) return song.al.picUrl;
        if (song.album?.picUrl) return song.album.picUrl;
        if (song.albumCover) return song.albumCover;
        return '';
    },
    
    /**
     * 格式化艺术家列表
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
     * 格式化时长 mm:ss
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
            icon: this.platformIcons[p.INFO.ID] || p.INFO.ICON || '',
            color: p.INFO.COLOR || '#666',
            author: p.INFO.AUTHOR || '',
            authorUrl: p.INFO.AUTHOR_URL || '',
            enabled: this.activePlatforms.includes(p.INFO.ID)
        }));
    },
    
    /**
     * 切换平台启用状态（用于设置）
     */
    toggle(platformId, enabled) {
        const idx = this.activePlatforms.indexOf(platformId);
        if (enabled && idx === -1) {
            this.activePlatforms.push(platformId);
        } else if (!enabled && idx > -1) {
            this.activePlatforms.splice(idx, 1);
        }
        this.saveActivePlatforms();
        
        // 更新搜索标签
        if (window.app && window.app.updatePlatformTabs) {
            window.app.updatePlatformTabs();
        }

    },
    
    /**
     * 获取相似歌曲
     * @param {string} platformId 
     * @param {string} songId 
     */
    async getSimilar(platformId, songId) {
        const platform = this.platforms[platformId];
        if (!platform || !platform.getSimilar) return [];
        
        try {
            const rawResults = await platform.getSimilar(songId);
            return rawResults.map(song => this.normalizeSongData(song, platformId));
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
        // 如果未指定平台，使用第一个激活的平台
        const pid = platformId || this.activePlatforms[0];
        const platform = this.platforms[pid];
        if (!platform || !platform.getRecommend) return [];
        
        try {
            const rawResults = await platform.getRecommend();
            return rawResults.map(song => this.normalizeSongData(song, pid));
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
        if (!platform || !platform.getLyric) {
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
     * 获取当前默认平台
     */
    getDefaultPlatform() {
        return this.activePlatforms[0] || 'cloudmusic';
    }
};

// 导出到全局
window.PlatformCore = PlatformCore;
