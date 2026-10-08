/**
 * AerMusic 播放样式 - 默认主题
 * 纯渲染层: 布局 + 侧边按钮 + 皮肤(style.css). 控制栏/滑块/自动隐藏/状态驱动 归 core (ui/controls.js),
 * 弹窗/建议/模式/歌单处理 归 core (ui/*.js 与 main.min.js)
 */
(function() {
    const safeClosest = function(selector) {
        let el = this;
        while (el) {
            if (el.nodeType === 1 && typeof el.matches === 'function' && el.matches(selector)) {
                return el;
            }
            el = el.parentElement || el.parentNode;
        }
        return null;
    };
    if (typeof Node !== 'undefined' && !Node.prototype.closest) {
        Node.prototype.closest = safeClosest;
    }
    if (typeof EventTarget !== 'undefined' && !EventTarget.prototype.closest) {
        EventTarget.prototype.closest = safeClosest;
    }
})();

// SVGcfg 归 style-core.js, 此处仅为向后兼容做引用
if (!window.SVGcfg) {
    console.warn('[AerTheme] SVGcfg 未找到，请确保 style-core.js 已先加载');
    window.SVGcfg = {};
} else {SVGcfg=window.SVGcfg;}

window.AerTheme = {
    STYLE_INFO: {
        ID: 'default',
        NAME: '默认样式',
        DC: 'AerMusic 默认播放样式',
        VERSION: '3.0.0',
        AUTHOR: 'AerMusic Team',
        AUTHOR_URL: 'https://github.com/The-Davince',
        BG: 'linear-gradient(180deg, #1a1a2e, #000000)',
        FILE: {},
        FEATURES: {
            lyricAnimation: true,
            coverAnimation: true,
            customControls: true,
            responsiveLayout: true,
            autoHideControls: true
        }
    },

    getApp() {
        return window.app || null;
    },

    onLoad() {
        console.log('AerMusic > 默认样式已加载');
        document.querySelectorAll('.popup-menu').forEach(menu => {
            menu.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
            menu.addEventListener('touchmove', e => e.stopPropagation(), { passive: true });
        });
    },

    /**
     * 渲染播放页面（视觉布局）
     */
    renderPage(song, index) {
        const secondaryControls = this.getControlsHtml(song, index);
        const lyricHtml = song.lyricHtml || '';

        const _esc = (window.app && window.app.escapeHtml) ? window.app.escapeHtml : ((s) => String(s));
        const _id = (value) => /^\d{1,15}$/.test(String(value ?? '').trim()) ? String(value).trim() : '';
        const artists = song.artists || [];
        let artistHtml = '';
        if (artists.length > 0) {
            artistHtml = artists.map(a => {
                const id = _id(a.id);
                const name = _esc(a.name || a);
                return id ? `<span data-artist-id="${id}" style="cursor:pointer;transition:color 0.2s;" onmouseover="this.style.color='var(--apple-red,#ff3b30)'" onmouseout="this.style.color=''">${name}</span>` : name;
            }).join(' / ');
        } else {
            artistHtml = _esc(song.artist || '未知歌手');
        }

        return `
            <div class="song-info-side advanced-layout">
                <img src="${_esc(song.cover)}"
                     class="cover-art cover-large"
                     id="cover-${index}"
                     alt="${_esc(song.name)}">
                <div class="title-meta">
                    <h1 title="${_esc(song.name)}">${_esc(song.name)}</h1>
                    <p>${artistHtml}</p>
                </div>
                ${secondaryControls}
            </div>
            <div class="lyric-side lyric-full" onclick="app.isMobile && app.toggleLyrics()">
                <div class="mobile-click-mask" style="display:none; position:absolute; inset:0; z-index:10;"></div>
                <iframe id="iframe-${index}" srcdoc='${lyricHtml.replace(/'/g, "&apos;")}'></iframe>
            </div>
        `;
    },

    /**
     * 生成侧边控制按钮 HTML（主题特定的视觉布局）
     */
    getControlsHtml(song, index) {
        const app = this.getApp();
        const isFav = app && app.isFavoriteSong && app.isFavoriteSong(song.id);
        const isDisliked = app && app.isDislikedSong && app.isDislikedSong(song);
        const songId = song ? song.id : '';
        return `
            <div class="secondary-controls">
                <div class="btn" title="隐藏歌词" onclick="app.toggleLyrics && app.toggleLyrics()">${SVGcfg.dislike}</div>
                <div class="btn" title="添加到歌单" onclick="app.addCurrentToPlaylist && app.addCurrentToPlaylist()">${SVGcfg.add}</div>
                <div class="btn heart-btn ${isFav ? 'active' : ''}" data-song-id="${songId}" title="收藏" onclick="app.toggleFavoriteSong(${index})">${SVGcfg.heart}</div>
                <div class="btn reduce-btn ${isDisliked ? 'active' : ''}" data-song-id="${songId}" title="减少推荐" onclick="app.toggleReduceRecommend(${index})">${SVGcfg.heartOff}</div>
                <div class="btn" title="下载当前歌曲" onclick="app.downloadCurrent()">${SVGcfg.download}</div>
                <div class="btn" title="分享" onclick="app.shareSong()">${SVGcfg.share}</div>
            </div>
        `;
    },

    updateReduceBtn(songId, isDisliked) {
        document.querySelectorAll('.secondary-controls .reduce-btn').forEach(btn => {
            if (songId !== undefined && songId !== null && String(btn.dataset.songId) !== String(songId)) return;
            btn.classList.toggle('active', !!isDisliked);
        });
    },

    /**
     * 渲染完成后的视觉钩子 (控制栏由 core ui/controls.js 创建并绑定)
     */
    onRendered(song, index, container) {
        container?.querySelectorAll('[data-artist-id]').forEach(el => {
            el.addEventListener('click', e => {
                e.stopPropagation();
                this.getApp()?.openArtistPage?.(el.dataset.artistId);
            });
        });
    },
};

if (window.StyleCore) {
    window.StyleCore.register(window.AerTheme);
}
