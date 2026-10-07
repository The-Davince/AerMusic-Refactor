/**
 * AerMusic 播放样式 - 高级长条控制栏
 * 底部悬浮控制栏设计，更沉浸的歌词体验
 * 
 * [REFACTORED] 本文件仅包含主题特定的视觉渲染代码
 * 系统级函数已移至 app (main.min.js)
 * 共享 SVG 图标已移至 StyleCore (style-core.js)
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

// SVGcfg 已移至 style-core.js，此处仅为向后兼容做引用
// 如果 SVGcfg 未加载（极端情况），提供空对象防止报错
if (!window.SVGcfg) {
    console.warn('[AerTheme] SVGcfg 未找到，请确保 style-core.js 已先加载');
    window.SVGcfg = {};
} else {SVGcfg=window.SVGcfg;}

window.AerTheme = {
    STYLE_INFO: {
        ID: 'default',
        NAME: '默认样式',
        DC: 'AerMusic 默认播放样式',
        VERSION: '2.0.0',
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

    autoHideTimer: null,

    getApp() {
        return window.app || null;
    },

    // [REMOVED] closeAllPopupsExcept() → 已移至 app.closeAllPopupsExcept()
    // [REMOVED] formatTime() → 使用 app.formatTime()
    // [REMOVED] showToast() → 使用 app.showToast()
    // [REMOVED] duplicate toggleSpeedMenu() → 保留一个版本在 app.toggleSpeedMenu()

    /**
     * 主题加载入口
     */
    onLoad() {
        console.log('AerMusic > 默认样式已加载');
        this.injectCustomStyles();
        this.alignSidebar();
        this.bindAppMethods();
        this.injectSideToolButtons();
        this.injectOnlyLyricsCard();
        this.initStates();
        this.initPageObserver();
        this.initTooltipObserver();
        this.initSearchSuggest();
        this.initSidebarAutoClose();
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
        
        // 构建可点击的歌手名
        const _esc = app.escapeHtml || ((s) => String(s));
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
     * 生成控制按钮 HTML（主题特定的视觉布局）
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
     * 渲染完成后的回调（仅主题特定的视觉初始化）
     */
    onRendered(song, index, container) {
        container?.querySelectorAll('[data-artist-id]').forEach(el => {
            el.addEventListener('click', e => {
                e.stopPropagation();
                this.getApp()?.openArtistPage?.(el.dataset.artistId);
            });
        });
        this.updateOlCard();
        if (document.getElementById("fixed-genius-bar")) return;

        const bar = document.createElement("div");
        bar.id = "fixed-genius-bar";
        bar.className = "";
        const app = this.getApp();
        const loopMode = app?.loopMode || 'list';
        const quality = app?.config?.quality || '320k';
        const playbackRate = app?.config?.playbackRate || 1;
        const volume = app && app.audio ? Math.round((app.audio.volume ?? 1) * 100) : 100;
        bar.innerHTML = `
            <div class="genius-progress-container">
                <div class="genius-progress-fill" id="fixed-seek-fill"></div>
                <input type="range" class="fixed-seek-input" id="fixed-seek" value="0" step="0.1">
            </div>
            <div class="fixed-genius-content">
                <div class="fixed-time-box">
                    <span id="fixed-cur">0:00</span>
                    <span id="fixed-dur" style="opacity:0.4">0:00</span>
                </div>
                <div class="fixed-actions">
                    <div class="btn mode-btn" onclick="app.togglePlayModeMenu()" title="播放模式">
                        <span class="mode-icon" id="mode-icon">${this.getModeIcon(loopMode)}</span>
                        <span class="mode-label" id="mode-label">${this.getModeLabel(loopMode)}</span>
                    </div>

                    <div class="btn" onclick="app.seekBackward(15)" title="后退15秒">
                        ${SVGcfg.backward15}
                    </div>

                    <div class="btn" onclick="app.prev()" title="上一首">${SVGcfg.prev}</div>

                    <div class="btn btn-play" onclick="app.togglePlay()" id="fixed-play-btn" title="播放/暂停">
                        ${SVGcfg.play}
                    </div>

                    <div class="btn" onclick="app.next()" title="下一首">${SVGcfg.next}</div>

                    <div class="btn" onclick="app.seekForward(15)" title="前进15秒">
                        ${SVGcfg.forward15}
                    </div>

                    <div class="btn speed-btn" onclick="app.toggleSpeedMenu()" title="播放速度">
                        ${SVGcfg.speed}
                        <span class="speed-label" id="speed-label">${playbackRate}x</span>
                    </div>

                    <div class="btn volume-btn" onclick="app.toggleVolumeMenu()" title="音量">
                        <span class="volume-icon" id="volume-icon">${SVGcfg.volume(volume)}</span>
                        <span class="volume-label" id="volume-label">${volume}</span>
                    </div>

                    <div class="btn" onclick="app.togglePlaylist()" title="播放列表">
                        ${SVGcfg.playlist}
                    </div>

                    <div class="btn quality-btn" onclick="app.toggleQualityMenu()" title="音质">
                        ${SVGcfg.quality}
                        <span class="quality-label">${app.getCurrentQualityLabel()}</span>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(bar);
        this.setupSlider();
        this.setupAutoHide();
    },

    /**
     * 设置进度条滑块（主题特定交互）
     */
    setupSlider() {
        const self = this;
        const slider = document.getElementById("fixed-seek");
        if (!slider) return;
        const handleStart = () => {
            const _app = self.getApp();
            if (_app) _app.isDragging = true;
            self.resetTimer();
        };
        slider.onmousedown = slider.ontouchstart = handleStart;
        slider.oninput = () => {
            const _app = self.getApp();
            if (_app && _app.audio && !isNaN(_app.audio.duration)) {
                _app.isDragging = true;
                _app.audio.currentTime = Number(slider.value);
                const percent = (slider.value / _app.audio.duration) * 100;
                const fill = document.getElementById("fixed-seek-fill");
                if (fill) fill.style.width = `${percent}%`;

                const curTxt = document.getElementById("fixed-cur");
                if (curTxt) curTxt.innerText = _app.formatTime(_app.audio.currentTime);
            }
        };
        const handleEnd = () => {
            const _app = self.getApp();
            if (_app) _app.isDragging = false;
            self.resetTimer();
        };
        slider.onmouseup = slider.ontouchend = handleEnd;
    },

    /**
     * 设置自动隐藏行为（主题特定）
     */
    setupAutoHide() {
        const self = this;
        const bar = document.getElementById("fixed-genius-bar");
        if (!bar) return;

        window.addEventListener("mousemove", (e) => {
            const threshold = window.innerHeight * 0.85;
            if (e.clientY > threshold) {
                self.showBar();
                self.resetTimer();
            }
        });

        bar.onmouseenter = () => { self.showBar(); self.resetTimer(); };
        bar.onmouseleave = () => self.resetTimer();

    },

    showBar() {
        const bar = document.getElementById("fixed-genius-bar");
        if (bar) bar.classList.remove("hidden");
    },

    hideBar() {
        const bar = document.getElementById("fixed-genius-bar");
        if (bar) bar.classList.add("hidden");
    },

    resetTimer() {
        clearTimeout(this.autoHideTimer);
        this.autoHideTimer = setTimeout(() => this.hideBar(), 5000);
    },

    /**
     * 获取播放模式图标（主题特定的 SVG 渲染）
     */
    getModeIcon(mode) {
        const icons = { list: SVGcfg.listLoop, single: SVGcfg.singleLoop, random: SVGcfg.random };
        return icons[mode] || SVGcfg.listLoop;
    },

    /**
     * 获取播放模式标签（主题特定的文本）
     */
    getModeLabel(mode) {
        const labels = { list: '列表循环', single: '单曲循环', random: '随机' };
        return labels[mode] || '列表循环';
    },

    /**
     * 更新播放模式 UI（主题特定的 DOM 更新）
     */
    updatePlayModeUI(mode) {
        const icon = document.getElementById('mode-icon');
        const label = document.getElementById('mode-label');
        if (icon) icon.innerHTML = this.getModeIcon(mode);
        if (label) label.textContent = this.getModeLabel(mode);
    },

    /**
     * 更新倍速 UI（主题特定的 DOM 更新）
     */
    updateSpeedUI(rate) {
        const label = document.getElementById('speed-label');
        if (label) label.textContent = `${rate}x`;
    },

    /**
     * 更新音量 UI（主题特定的 DOM 更新）
     */
    updateVolumeUI(vol) {
        const icon = document.getElementById('volume-icon');
        const label = document.getElementById('volume-label');
        if (icon) icon.innerHTML = SVGcfg.volume(vol);
        if (label) label.textContent = vol;
    },

    /**
     * 更新进度条（主题特定的视觉更新）
     */
    updateProgress(currentTime, duration, index) {
        const curTxt = document.getElementById("fixed-cur");
        const durTxt = document.getElementById("fixed-dur");
        const fill = document.getElementById("fixed-seek-fill");
        const slider = document.getElementById("fixed-seek");

        if (curTxt) curTxt.innerText = this.getApp()?.formatTime(currentTime) || '0:00';
        if (durTxt && !isNaN(duration)) durTxt.innerText = this.getApp()?.formatTime(duration) || '0:00';

        const app = this.getApp();
        if (app && app.audio && !isNaN(app.audio.duration) && !app.isDragging) {
            if (slider) slider.max = app.audio.duration;
            if (!app.isDragging) {
                const percent = (currentTime / app.audio.duration) * 100;
                if (fill) fill.style.width = `${percent}%`;
                if (slider) slider.value = currentTime;
            }
        }
    },

    /**
     * 更新播放状态（主题特定的图标更新）
     */
    updateStatus(isPlaying, loopMode, index) {
        const playBtn = document.getElementById("fixed-play-btn");
        if (playBtn) {
            playBtn.innerHTML = isPlaying ? SVGcfg.pause : SVGcfg.play;
        }

        this.updatePlayModeUI(loopMode);
    },

    // ============================================================
    // 以下为主题特定的辅助功能（纯视觉/UI层面）
    // ============================================================

    injectCustomStyles() {
        if (document.getElementById('aer-theme-custom-patch')) return;
        const style = document.createElement('style');
        style.id = 'aer-theme-custom-patch';
        style.textContent = `
            #initial-loader {
                z-index: 11000 !important;
            }
            body.search-active #app-logo,
            body.settings-active #app-logo {
                opacity: 0 !important;
                pointer-events: none !important;
            }
            /* 搜索页时搜索框应该显示，只有设置页时才隐藏 */
            body.settings-active .search-container {
                opacity: 0 !important;
                pointer-events: none !important;
                visibility: hidden !important;
            }
            /* 搜索页时确保搜索框可见 */
            body.search-active .search-container {
                opacity: 1 !important;
                pointer-events: auto !important;
                visibility: visible !important;
            }
            body.only-lyrics-enabled.page-recommend #top-bar {
                opacity: 0 !important;
                pointer-events: none !important;
                background: transparent !important;
                transition: opacity 0.3s cubic-bezier(0.25, 1, 0.5, 1) !important;
            }
            /* 只显示歌词模式下，鼠标移过标题区域渐显标题 */
            body.only-lyrics-enabled.page-recommend #top-bar #app-logo {
                opacity: 0 !important;
                pointer-events: none !important;
                transition: opacity 0.3s ease !important;
            }
            body.only-lyrics-enabled.page-recommend #top-bar:hover #app-logo {
                opacity: 0 !important;
            }
            body.only-lyrics-enabled.page-recommend #app-logo:hover {
                opacity: 1 !important;
                pointer-events: auto !important;
            }
            /* 只显示歌词模式下，鼠标移过搜索框区域渐显搜索框 */
            body.only-lyrics-enabled.page-recommend .search-container {
                opacity: 0 !important;
                pointer-events: none !important;
                transition: opacity 0.3s ease !important;
            }
            body.only-lyrics-enabled.page-recommend #top-bar:hover .search-container {
                opacity: 0 !important;
            }
            body.only-lyrics-enabled.page-recommend .search-container:hover {
                opacity: 1 !important;
                pointer-events: auto !important;
            }
            .side-tools {
                transition: opacity 0.5s cubic-bezier(0.25, 1, 0.5, 1), transform 0.5s cubic-bezier(0.25, 1, 0.5, 1), visibility 0.5s ease;
            }
            .side-tools.hidden-tools {
                opacity: 0 !important;
                pointer-events: none !important;
                visibility: hidden !important;
                transform: translateX(30px) !important;
            }
            body:not(.page-recommend) #fixed-genius-bar {
                opacity: 1 !important;
                pointer-events: auto !important;
                visibility: visible !important;
            }
            body.settings-active #fixed-genius-bar {
                opacity: 0 !important;
                pointer-events: none !important;
                visibility: hidden !important;
            }
            body.ui-hide-enabled #top-bar,
            body.ui-hide-enabled .side-tools:not(.hidden-tools),
            body.ui-hide-enabled #fixed-genius-bar,
            body.ui-hide-enabled #sys-sidebar {
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.5s cubic-bezier(0.25, 1, 0.5, 1) !important;
            }
            body.ui-hide-enabled #top-bar.ui-visible,
            body.ui-hide-enabled .side-tools:not(.hidden-tools).ui-visible,
            body.ui-hide-enabled #fixed-genius-bar.ui-visible,
            body.ui-hide-enabled #sys-sidebar.ui-visible {
                opacity: 1 !important;
                pointer-events: auto !important;
            }
            body.only-lyrics-enabled .song-info-side {
                opacity: 0 !important;
                pointer-events: none !important;
                visibility: hidden !important;
                width: 0 !important;
                flex: 0 !important;
                padding: 0 !important;
                margin: 0 !important;
            }
            body.only-lyrics-enabled .lyric-side {
                margin-left: 0 !important;
                max-width: 80vw !important;
                width: 80vw !important;
                flex: 1 !important;
                transform: translateX(0) !important;
            }
            body.only-lyrics-enabled .song-page {
                justify-content: center !important;
            }
            .only-lyrics-card-trigger {
                position: fixed;
                top: 0;
                left: 30vw;
                width: 40vw;
                height: 12vh;
                z-index: 10004;
                background: transparent;
                display: none;
            }
            body.only-lyrics-enabled.page-recommend .only-lyrics-card-trigger {
                display: block;
            }
            .only-lyrics-card {
                position: fixed;
                top: 2.5vh;
                left: 50%;
                transform: translateX(-50%) translateY(-10px);
                background: rgba(25, 25, 25, 0.75);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 12px;
                padding: 8px 16px;
                display: none;
                align-items: center;
                gap: 12px;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.3s cubic-bezier(0.25, 1, 0.5, 1), transform 0.3s cubic-bezier(0.25, 1, 0.5, 1);
                z-index: 10005;
                box-shadow: 0 8px 24px rgba(0,0,0,0.3);
            }
            body.only-lyrics-enabled.page-recommend .only-lyrics-card {
                display: flex;
            }
            body.only-lyrics-enabled.page-recommend .only-lyrics-card-trigger:hover + .only-lyrics-card,
            body.only-lyrics-enabled.page-recommend .only-lyrics-card:hover {
                opacity: 1 !important;
                pointer-events: auto !important;
                transform: translateX(-50%) translateY(0) !important;
            }
            .only-lyrics-card img {
                width: 4.5vh;
                height: 4.5vh;
                border-radius: 6px;
                object-fit: cover;
            }
            .only-lyrics-card .ol-card-info {
                display: flex;
                flex-direction: column;
                justify-content: center;
                text-align: left;
            }
            .only-lyrics-card .ol-card-title {
                font-size: 1.6vh;
                font-weight: bold;
                color: #fff;
                cursor: pointer;
                transition: color 0.2s;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 250px;
            }
            .only-lyrics-card .ol-card-title:hover {
                color: var(--apple-red);
            }
            .only-lyrics-card .ol-card-artist {
                font-size: 1.2vh;
                color: rgba(255, 255, 255, 0.6);
                cursor: pointer;
                transition: color 0.2s;
                margin-top: 2px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 250px;
            }
            .only-lyrics-card .ol-card-artist:hover {
                color: var(--apple-red);
            }
            .side-tools .tool-btn {
                position: relative;
                transition: transform 0.2s ease, background 0.2s ease, color 0.2s ease, opacity 0.2s ease !important;
            }
            .side-tools .tool-btn:not(.active):hover {
                background: rgba(255, 255, 255, 0.15) !important;
                color: #ffffff !important;
                transform: scale(1.08);
            }
            .side-tools .tool-btn.active:hover {
                opacity: 0.75;
                transform: scale(1.08);
            }
            .side-tools .tool-btn::after {
                content: attr(data-tooltip);
                position: absolute;
                right: 130%;
                top: 50%;
                transform: translateY(-50%) translateX(8px);
                background: rgba(18, 18, 18, 0.82);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                color: #ffffff;
                padding: 6px 12px;
                border-radius: 8px;
                font-size: 1.3vh;
                font-weight: 500;
                white-space: nowrap;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.25s cubic-bezier(0.25, 1, 0.5, 1), transform 0.25s cubic-bezier(0.25, 1, 0.5, 1);
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
            }
            .side-tools .tool-btn:hover::after {
                opacity: 1;
                transform: translateY(-50%) translateX(0);
            }
            .result-actions .action-btn {
                position: relative;
                transition: transform 0.2s ease, background-color 0.2s ease !important;
            }
            .result-actions .action-btn:hover {
                background-color: rgba(255, 255, 255, 0.15) !important;
                transform: scale(1.1);
            }
            .result-actions .action-btn::after {
                content: attr(data-tooltip);
                position: absolute;
                bottom: 130%;
                left: 50%;
                transform: translateX(-50%) translateY(8px);
                background: rgba(18, 18, 18, 0.85);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.12);
                color: #ffffff;
                padding: 4px 10px;
                border-radius: 6px;
                font-size: 1.2vh;
                font-weight: 500;
                white-space: nowrap;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.25s cubic-bezier(0.25, 1, 0.5, 1), transform 0.25s cubic-bezier(0.25, 1, 0.5, 1);
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
                z-index: 1000;
            }
            .result-actions .action-btn:hover::after {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }
            #favorites-content.playlists-grid-view {
                grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)) !important;
                gap: 20px !important;
            }
            #favorites-content.playlists-grid-view .song-card {
                max-width: 130px !important;
                width: 100% !important;
                margin: 0 auto !important;
                padding: 8px !important;
                border-radius: 12px !important;
                background: rgba(25, 25, 25, 0.3) !important;
                border: 1px solid rgba(255, 255, 255, 0.05) !important;
                box-shadow: 0 4px 12px rgba(0,0,0,0.2) !important;
            }
            #favorites-content.playlists-grid-view .song-card img {
                max-height: 114px !important;
                max-width: 114px !important;
                width: 100% !important;
                aspect-ratio: 1/1 !important;
                object-fit: cover !important;
                margin: 0 auto 6px auto !important;
                display: block !important;
                border-radius: 8px !important;
            }
            body:not(.sidebar-expanded) .sys-sidebar {
                width: 70px !important;
                padding: 3vh 0 !important;
                left: -70px !important;
            }
            body.sidebar-visible:not(.sidebar-expanded) .sys-sidebar {
                transform: translateX(70px) !important;
            }
            body:not(.sidebar-expanded) .sidebar-item {
                width: 44px !important;
                height: 44px !important;
                margin: 0 auto 0.8vh auto !important;
                padding: 0 !important;
                justify-content: center !important;
                border-radius: 12px !important;
            }
            body:not(.sidebar-expanded) .sidebar-item .icon-wrapper {
                margin: 0 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
            }
            body:not(.sidebar-expanded) .sidebar-item .sidebar-text {
                display: none !important;
            }
            body:not(.sidebar-expanded) .sidebar-item {
                position: relative;
            }
            body:not(.sidebar-expanded) .sidebar-item::after {
                content: attr(title);
                position: absolute;
                left: 130%;
                top: 50%;
                transform: translateY(-50%) translateX(8px);
                background: rgba(18, 18, 18, 0.85);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                color: #ffffff;
                padding: 6px 12px;
                border-radius: 8px;
                font-size: 1.2vh;
                font-weight: 500;
                white-space: nowrap;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.25s ease, transform 0.25s ease;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
                z-index: 10000;
            }
            body:not(.sidebar-expanded) .sidebar-item:hover::after {
                opacity: 1;
                transform: translateY(-50%) translateX(0);
            }
            body:not(.sidebar-expanded) .sidebar-logo-placeholder {
                opacity: 0 !important;
                transition: opacity 0.3s ease !important;
            }
            body.sidebar-expanded .sidebar-logo-placeholder {
                opacity: 1 !important;
                transition: opacity 0.3s ease 0.1s !important;
            }
            /* 底部留白防止控制栏遮挡 */
            #search-overlay .result-grid-container,
            #favorites-overlay .result-grid-container,
            #playlists-overlay .result-grid-container {
                padding-bottom: 16vh !important;
            }
            .page-footer-text {
                text-align: center;
                padding: 3vh 0 12vh;
                font-size: 1.2vh;
                color: rgba(255,255,255,0.25);
                line-height: 1.8;
                grid-column: 1 / -1;
            }
            .page-footer-text a {
                color: rgba(255,255,255,0.35);
                text-decoration: none;
                transition: color 0.2s;
            }
            .page-footer-text a:hover {
                color: var(--apple-red, #ff3b30);
            }
            .search-container {
                position: relative;
                overflow: visible !important;
            }
            /* 侧边栏高亮平滑过渡 */
            .sidebar-menu {
                position: relative;
            }
            .sidebar-item {
                position: relative;
                transition: background 0.3s ease, color 0.3s ease !important;
            }
            /* 搜索分类标签平滑过渡 */
            .platform-tab {
                transition: all 0.3s cubic-bezier(0.25, 1, 0.5, 1) !important;
            }
            .platform-tab.active .name {
                transition: color 0.3s ease !important;
            }
            .search-suggest-popup {
                position: absolute;
                top: 115%;
                left: 0;
                right: 0;
                background: rgba(28, 28, 30, 0.88);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 14px;
                box-shadow: 0 10px 32px rgba(0, 0, 0, 0.45);
                max-height: 320px;
                overflow-y: auto;
                z-index: 10006;
                display: none;
                opacity: 0;
                visibility: hidden;
                transform: translateY(-0.5vh);
                transition: opacity 0.18s ease, visibility 0.18s ease, transform 0.18s ease;
                flex-direction: column;
                padding: 6px;
                box-sizing: border-box;
            }
            .search-suggest-popup.is-open { opacity: 1; visibility: visible; transform: translateY(0); }
            .search-suggest-popup.is-closing { opacity: 0; visibility: hidden; transform: translateY(-0.5vh); pointer-events: none; }
            .suggest-title {
                font-size: 11px;
                color: rgba(255, 255, 255, 0.35);
                padding: 6px 12px 2px 12px;
                font-family: "MiSans Semibold";
                text-transform: uppercase;
                text-align: left;
                pointer-events: none;
            }
            .suggest-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 10px 12px;
                border-radius: 10px;
                cursor: pointer;
                transition: background-color 0.2s ease;
                text-align: left;
            }
            .suggest-item:hover {
                background-color: rgba(255, 255, 255, 0.08);
            }
            .suggest-item .name {
                font-size: 13px;
                color: #ffffff;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 170px;
            }
            .suggest-item .artist {
                font-size: 11px;
                color: rgba(255, 255, 255, 0.45);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                margin-left: auto;
                max-width: 100px;
            }
        `;
        document.head.appendChild(style);
    },

    alignSidebar() {
        const menu = document.querySelector('.sidebar-menu');
        const favBtn = document.getElementById('sidebar-fav-btn');
        const playlistsBtn = document.getElementById('sidebar-playlists-btn');
        if (menu && favBtn && playlistsBtn) {
            menu.appendChild(favBtn);
            menu.appendChild(playlistsBtn);
        }
    },

    injectSideToolButtons() {
        const sideTools = document.querySelector('.side-tools');
        const themeBtn = document.getElementById('theme-btn');
        if (!sideTools || !themeBtn) return;

        if (document.getElementById('only-lyrics-btn')) return;

        const onlyLyricsBtn = document.createElement('div');
        onlyLyricsBtn.id = 'only-lyrics-btn';
        onlyLyricsBtn.className = 'tool-btn';
        onlyLyricsBtn.title = '只显示歌词';
        onlyLyricsBtn.onclick = () => this.toggleOnlyLyrics();
        onlyLyricsBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 6h16M4 12h16M4 18h7"/>
            </svg>
        `;

        const hideUiBtn = document.createElement('div');
        hideUiBtn.id = 'hide-ui-btn';
        hideUiBtn.className = 'tool-btn';
        hideUiBtn.title = '隐藏UI';
        hideUiBtn.onclick = () => this.toggleHideUI();
        hideUiBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
        `;

        sideTools.insertBefore(onlyLyricsBtn, themeBtn);
        sideTools.insertBefore(hideUiBtn, themeBtn);
    },

    injectOnlyLyricsCard() {
        if (document.getElementById('only-lyrics-card')) return;

        const trigger = document.createElement('div');
        trigger.className = 'only-lyrics-card-trigger';

        const card = document.createElement('div');
        card.id = 'only-lyrics-card';
        card.className = 'only-lyrics-card';
        card.innerHTML = `
            <img id="ol-card-cover" src="" alt="封面">
            <div class="ol-card-info">
                <div id="ol-card-title" class="ol-card-title"></div>
                <div id="ol-card-artist" class="ol-card-artist"></div>
            </div>
        `;

        document.body.appendChild(trigger);
        document.body.appendChild(card);

        const titleEl = card.querySelector('#ol-card-title');
        const artistEl = card.querySelector('#ol-card-artist');
        if (titleEl) titleEl.onclick = () => this.searchFromCard(titleEl.innerText);
        if (artistEl) artistEl.onclick = () => this.searchFromCard(artistEl.innerText);
    },

    initStates() {
        this.hideUIActive = localStorage.getItem('AerMusic_HideUI') === 'true';
        this.onlyLyricsActive = localStorage.getItem('AerMusic_OnlyLyrics') === 'true';
        this.hideUITimers = { top: null, bottom: null, left: null, right: null };

        this.updateHideUIState();
        this.updateOnlyLyricsState();
    },

    initAppHooks() {
        const app = this.getApp();
        if (!app) return;
        const originalSearch = app.search;
        app.search = (kw) => {
            if (kw && kw.trim()) {
                app.switchPage('search');
            }
            if (originalSearch) originalSearch.call(app, kw);
        };
        const hideSearchBtn = document.getElementById('hideSearch');
        if (hideSearchBtn) {
            hideSearchBtn.onclick = () => {
                app.closeOverlay('search-overlay');
                app.switchPage('recommend');
                document.body.classList.remove("search-active");
            };
        }
    },

    toggleHideUI() {
        this.hideUIActive = !this.hideUIActive;
        localStorage.setItem('AerMusic_HideUI', this.hideUIActive);
        this.updateHideUIState();
    },

    updateHideUIState() {
        const btn = document.getElementById('hide-ui-btn');
        if (btn) btn.classList.toggle('active', this.hideUIActive);

        if (this.hideUIActive) {
            document.body.classList.add('ui-hide-enabled');
            const app = this.getApp();
            if (app?.showToast) app.showToast("已启用无UI模式");
            this.applyHideUILogic();
        } else {
            document.body.classList.remove('ui-hide-enabled');
            const app = this.getApp();
            if (app?.showToast) app.showToast("已关闭无UI模式");
            this.clearHideUILogic();
        }
    },

    applyHideUILogic() {
        if (!this.hideUIListener) {
            this.hideUIListener = (e) => {
                if (!this.hideUIActive) return;
                const x = e.clientX;
                const y = e.clientY;
                const w = window.innerWidth;
                const h = window.innerHeight;
                const isSideToolsHidden = document.querySelector('.side-tools')?.classList.contains('hidden-tools');

                if (y < 100) this.showUIArea('top', '#top-bar');
                if (y > h - 100) this.showUIArea('bottom', '#fixed-genius-bar');
                if (x < 100) this.showUIArea('left', '#sys-sidebar');
                if (x > w - 100 && !isSideToolsHidden) this.showUIArea('right', '.side-tools');
            };
            window.addEventListener('mousemove', this.hideUIListener);
        }
    },

    showUIArea(area, selector) {
        const el = document.querySelector(selector);
        if (!el) return;
        el.classList.add('ui-visible');
        clearTimeout(this.hideUITimers[area]);
        this.hideUITimers[area] = setTimeout(() => {
            el.classList.remove('ui-visible');
        }, 3000);
    },

    clearHideUILogic() {
        ['top', 'bottom', 'left', 'right'].forEach(area => {
            clearTimeout(this.hideUITimers[area]);
        });
        document.querySelectorAll('#top-bar, .side-tools, #fixed-genius-bar, #sys-sidebar').forEach(el => {
            el.classList.remove('ui-visible');
        });
    },

    toggleOnlyLyrics() {
        this.onlyLyricsActive = !this.onlyLyricsActive;
        localStorage.setItem('AerMusic_OnlyLyrics', this.onlyLyricsActive);
        this.updateOnlyLyricsState();
    },

    updateOnlyLyricsState() {
        const btn = document.getElementById('only-lyrics-btn');
        if (btn) btn.classList.toggle('active', this.onlyLyricsActive);
        const app = this.getApp();

        if (this.onlyLyricsActive) {
            /* 记录进入前的歌词隐藏状态，以便退出时恢复 */
            this._prevLyricsHidden = app?.lyricVisible === false;
            /* 如果当前处于歌词隐藏模式，先移除 lyrics-hidden 强制显示歌词 */
            if (app && app.lyricVisible === false) {
                app.lyricVisible = true;
                document.querySelectorAll('.song-page').forEach(page => {
                    page.classList.remove('lyrics-hidden');
                });
            }
            document.body.classList.add('only-lyrics-enabled');
            if (app?.showToast) app.showToast("已启用纯净歌词模式");
        } else {
            document.body.classList.remove('only-lyrics-enabled');
            /* 恢复之前的歌词隐藏状态 */
            if (this._prevLyricsHidden && app) {
                app.lyricVisible = false;
                document.querySelectorAll('.song-page').forEach(page => {
                    page.classList.add('lyrics-hidden');
                });
            }
            if (app?.showToast) app.showToast("已关闭纯净歌词模式");
        }
        this.updateOlCard();
    },

    updateOlCard() {
        const app = this.getApp();
        if (app && app.playlist && app.playlist[app.currentIndex]) {
            const song = app.playlist[app.currentIndex];
            const olCover = document.getElementById('ol-card-cover');
            const olTitle = document.getElementById('ol-card-title');
            const olArtist = document.getElementById('ol-card-artist');
            if (olCover) olCover.src = song.cover;
            if (olTitle) olTitle.innerText = song.name;
            if (olArtist) {
                // 构建可点击的歌手名
                const artists = song.artists || [];
                if (artists.length > 0) {
                    const _id = (value) => /^\d{1,15}$/.test(String(value ?? '').trim()) ? String(value).trim() : '';
                    const _esc = app.escapeHtml || ((s) => String(s));
                    olArtist.innerHTML = artists.map(a => {
                        const id = _id(a.id);
                        const name = _esc(a.name || a);
                        return id ? `<span data-artist-id="${id}" style="cursor:pointer;transition:color 0.2s;" onmouseover="this.style.color='var(--apple-red,#ff3b30)'" onmouseout="this.style.color=''">${name}</span>` : name;
                    }).join(' / ');
                    olArtist.querySelectorAll('[data-artist-id]').forEach(el => {
                        el.addEventListener('click', e => {
                            e.stopPropagation();
                            app.openArtistPage(el.dataset.artistId);
                        });
                    });
                } else {
                    olArtist.innerText = song.artist || '未知歌手';
                }
            }
        }
    },

    searchFromCard(keyword) {
        const app = this.getApp();
        if (app && keyword) {
            const searchInp = document.getElementById('searchInp');
            if (searchInp) {
                searchInp.value = keyword;
                app.search(keyword);
            }
        }
    },

    bindAppMethods() {
        const app = this.getApp();
        if (!app) return;

        // 绑定主题特定的 UI 方法到 app
        app.toggleHideUI = () => this.toggleHideUI();
        app.toggleOnlyLyrics = () => this.toggleOnlyLyrics();
        app.searchFromCard = (keyword) => this.searchFromCard(keyword);

        app.escapeHtml = function(str) {
            if (!str || typeof str !== 'string') return str || '';
            return str
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        };

        app.formatArtists = function(artists) {
            if (!artists) return "未知歌手";
            if (typeof artists === 'string') return artists;
            if (Array.isArray(artists)) {
                return artists.map(a => {
                    if (!a) return "";
                    return typeof a === 'object' ? (a.name || "") : String(a);
                }).filter(Boolean).join(' / ') || "未知歌手";
            }
            return "未知歌手";
        };

        // 覆盖 toggleFavoriteSong 以支持 index 调用和 UI 更新
        const originalToggleFavoriteSong = app.toggleFavoriteSong.bind(app);
        app.toggleFavoriteSong = function(songOrIndex) {
            let song = songOrIndex;
            // 支持传入 index（来自 onclick="app.toggleFavoriteSong(0)"）
            if (typeof songOrIndex === 'number') {
                song = app.playlist && app.playlist[songOrIndex];
            }
            if (!song) {
                console.warn('toggleFavoriteSong: 未找到歌曲', songOrIndex);
                return;
            }
            if (song.rawSong) {
                if (!song.rawSong.album) song.rawSong.album = song.rawSong.al?.name || '未知专辑';
            }
            if (!song.album) song.album = song.al?.name || '未知专辑';
            originalToggleFavoriteSong(song);
        };

        // 覆盖 addSongToQueue 以增强封面处理
        const originalAddSongToQueue = app.addSongToQueue;
        app.addSongToQueue = async function(songObj, isFromSimi = false) {
            if (!songObj) return;
            let coverUrl = songObj.cover || '';
            if (!coverUrl) {
                coverUrl = songObj.al ? songObj.al.picUrl : (songObj.album && typeof songObj.album === 'object' ? songObj.album.picUrl : '');
            }
            if (coverUrl && !coverUrl.includes('?param=')) {
                coverUrl = coverUrl + '?param=600y600';
            }
            if (!songObj.al) {
                songObj.al = { picUrl: coverUrl };
            }
            if (originalAddSongToQueue) {
                return originalAddSongToQueue.call(app, songObj, isFromSimi);
            }
        };



        // 覆盖 switchFavTab 以增强 UI
        const originalSwitchFavTab = app.switchFavTab;
        app.switchFavTab = function(tabName) {
            if (originalSwitchFavTab) originalSwitchFavTab.call(app, tabName);
            const content = document.getElementById('favorites-content');
            if (content) {
                if (tabName === 'playlists') {
                    content.classList.add('playlists-grid-view');
                } else {
                    content.classList.remove('playlists-grid-view');
                }
            }
            /* 排列方式只在歌单标签页显示 */
            const viewToggleBtns = document.querySelector('#fav-songs-actions .view-toggle-btns');
            if (viewToggleBtns) {
                viewToggleBtns.style.display = tabName === 'playlists' ? 'flex' : 'none';
            }
        };

        // 添加到当前播放队列
        app.addToCurrentPlayQueue = function(song) {
            if (!song) return;
            if (this.playlist.some(s => String(s.id) === String(song.id))) {
                this.showToast("该歌曲已在当前播放队列中");
                return;
            }
            this.addSongToQueue(song, false);
            this.showToast("已添加至当前播放队列");
        };

        // createSearchResultItem 别名（兼容 main.min.js 中的调用）
        app.createSearchResultItem = app.createResultItem;

        // 增强 createResultItem
        const originalCreateResultItem = app.createResultItem;
        app.createResultItem = function(song, index) {
            const item = originalCreateResultItem.call(app, song, index);
            item.setAttribute('data-song-id', song.id);
            item.setAttribute('data-index-val', index);
            let rawDuration = song.dt || song.duration || 0;
            if (rawDuration > 0 && rawDuration < 36000) rawDuration = rawDuration * 1000;
            const formattedDuration = app.formatDuration(rawDuration);
            const durationEl = item.querySelector('.result-duration');
            if (durationEl) durationEl.textContent = formattedDuration;
            const albumName = song.album || song.al?.name || song.albumName || '未知专辑';
            const albumEl = item.querySelector('.result-album');
            if (albumEl) albumEl.textContent = albumName;

            const actionsDiv = item.querySelector('.result-actions');
            if (actionsDiv) {
                const isFav = app.isFavoriteSong(song.id);
                const heartSvg = isFav
                    ? `<svg viewBox="0 0 24 24" fill="var(--apple-red)" stroke="var(--apple-red)" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`
                    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;

                actionsDiv.innerHTML = `
                    <div class="action-btn" data-tooltip="添加到当前播放">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                    </div>
                    <div class="action-btn" title="添加到歌单">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 15h12M3 10h18M3 5h18M18 13v6M15 16h6"/></svg>
                    </div>
                    <div class="action-btn ${isFav ? 'active' : ''}" title="收藏">
                        ${heartSvg}
                    </div>
                    <div class="action-btn" title="下载">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                    </div>
                `;
                const btns = actionsDiv.querySelectorAll('.action-btn');
                const stop = (e) => e.stopPropagation();
                btns[0].addEventListener('click', (e) => { stop(e); app.addToCurrentPlayQueue(song); });
                btns[1].addEventListener('click', (e) => { stop(e); app.addToPlaylistHandler(String(song.id)); });
                btns[2].addEventListener('click', (e) => { stop(e); app.collectSongHandler(String(song.id)); });
                btns[2].classList.add(`collect-heart-${String(song.id).replace(/[^a-zA-Z0-9_-]/g, '')}`);
                btns[3].addEventListener('click', (e) => { stop(e); app.downloadSongHandler(String(song.id)); });
            }
            return item;
        };
        // 更新别名，指向增强后的版本
        app.createSearchResultItem = app.createResultItem;

        // Apple Music 风格模态框（增强版）
        app.showAppleModal = function(title, contentHtml, onConfirm, onCancel, options) {
            let modal = document.getElementById('apple-music-modal');
            if (modal) {
                if (typeof modal.close === 'function') modal.close();
                else modal.remove();
            }
            
            const opts = options || {};
            const confirmText = opts.confirmText || '确定';
            const cancelText = opts.cancelText || '取消';
            const hideFooter = opts.hideFooter || false;
            const width = opts.width || '90%';
            const maxWidth = opts.maxWidth || '400px';

            modal = document.createElement('div');
            modal.id = 'apple-music-modal';
            modal.style.cssText = `
                position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
                display: flex; align-items: center; justify-content: center;
                z-index: 200000; opacity: 0; transition: opacity 0.3s cubic-bezier(0.25, 1, 0.5, 1);
            `;
            modal.innerHTML = `
                <div style="background: rgba(28, 28, 30, 0.88); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 20px; box-shadow: 0 24px 64px rgba(0,0,0,0.55); width: ${width}; max-width: ${maxWidth}; padding: 24px; box-sizing: border-box; display: flex; flex-direction: column; gap: 16px; transform: scale(0.95); transition: transform 0.3s cubic-bezier(0.25, 1, 0.5, 1); max-height: 80vh; overflow-y: auto;" id="apple-modal-panel">
                    <div style="font-size: 18px; font-weight: bold; color: #fff; text-align: center; font-family: 'MiSans Semibold';">${title}</div>
                    <div style="color: rgba(255, 255, 255, 0.85); font-size: 14px; text-align: left;" id="apple-modal-body">${contentHtml}</div>
                    ${hideFooter ? '' : `
                    <div style="display: flex; gap: 12px; margin-top: 10px;">
                        <button id="apple-modal-cancel" style="flex: 1; background: rgba(255, 255, 255, 0.08); color: #fff; font-weight: bold; padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.04); cursor: pointer; transition: background 0.2s; font-size: 14px;">${cancelText}</button>
                        <button id="apple-modal-confirm" style="flex: 1; background: var(--apple-red, #24c8fa); color: #fff; font-weight: bold; padding: 12px; border-radius: 12px; border: none; cursor: pointer; transition: opacity 0.2s; font-size: 14px;">${confirmText}</button>
                    </div>`}
                </div>
            `;
            document.body.appendChild(modal);
            const panel = modal.querySelector('#apple-modal-panel');
            setTimeout(() => {
                if (!modal.isConnected) return;
                modal.style.opacity = '1';
                panel.style.transform = 'scale(1)';
            }, 10);
            const close = () => {
                if (!modal.isConnected || modal.dataset.closing === '1') return;
                modal.dataset.closing = '1';
                clearTimeout(modal._closeTimer);
                modal.style.opacity = '0';
                panel.style.transform = 'scale(0.95)';
                modal._closeTimer = setTimeout(() => {
                    if (modal.isConnected) modal.remove();
                    delete modal.dataset.closing;
                }, 300);
            };
            modal.close = close;
            app.closeAppleModal = close;
            if (!hideFooter) {
                modal.querySelector('#apple-modal-cancel').onclick = () => { if (onCancel) onCancel(); close(); };
                modal.querySelector('#apple-modal-confirm').onclick = () => {
                    let result;
                    try {
                        if (onConfirm) result = onConfirm(modal);
                    } finally {
                        if (result !== false) close();
                    }
                };
            }
            modal.onclick = (e) => { if (e.target === modal) close(); };
            return { modal, close };
        };

        // 添加到歌单处理器
        app.addToPlaylistHandler = function(songId) {
            let foundSong = null;
            if (this.searchResults) {
                for (const platformSongs of Object.values(this.searchResults)) {
                    if (platformSongs) {
                        const song = platformSongs.find(s => String(s.id) === String(songId));
                        if (song) { foundSong = song; break; }
                    }
                }
            }
            if (!foundSong && this.playlist) foundSong = this.playlist.find(s => String(s.id) === String(songId));
            if (!foundSong && this.favoriteSongs) {
                const fav = this.favoriteSongs.find(s => String(s.id) === String(songId));
                if (fav) foundSong = fav.rawSong || fav;
            }
            if (!foundSong) { this.showToast("未定位到歌曲信息"); return; }
            if (this.userPlaylists.length === 0) {
                app.showAppleModal("新建歌单", "您目前还没有任何歌单，是否新建一个？", () => { app.createNewPlaylist(); });
                return;
            }
            const optionsHtml = this.userPlaylists.map((pl, idx) => `
                <label style="display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 10px; background: rgba(255,255,255,0.03); margin-bottom: 8px; cursor: pointer; border: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;">
                    <input type="radio" name="apple-playlist-select" value="${idx}" ${idx === 0 ? 'checked' : ''} style="accent-color: var(--apple-red); cursor: pointer;">
                    <div style="flex:1; text-align: left;">
                        <div style="font-weight: bold; color: #fff; font-size: 14px;">${app.escapeHtml(pl.name || '未命名歌单')}</div>
                        <div style="font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 2px;">${pl.songs?.length || 0} 首歌曲</div>
                    </div>
                </label>
            `).join('');
            app.showAppleModal("添加到歌单", `<div style="max-height: 250px; overflow-y: auto; padding-right: 4px; box-sizing: border-box;">${optionsHtml}</div>`, (modal) => {
                const selectedIdx = modal.querySelector('input[name="apple-playlist-select"]:checked')?.value;
                if (selectedIdx === undefined) return;
                const targetPl = this.userPlaylists[parseInt(selectedIdx)];
                if (!targetPl) return;
                if (!targetPl.songs) targetPl.songs = [];
                if (targetPl.songs.some(s => String(s.id) === String(foundSong.id))) { this.showToast("歌单里已经有这首歌啦"); return; }
                targetPl.songs.push(foundSong);
                localStorage.setItem('AerMusic_Playlists', JSON.stringify(this.userPlaylists));
                this.showToast(`已添加至歌单 [${targetPl.name}]`);
            });
        };

        // 新建歌单
        app.createNewPlaylist = function() {
            app.showAppleModal("新建歌单", `
                <div style="display:flex; flex-direction:column; gap:12px; font-family: inherit;">
                    <div>
                        <span style="font-size:11px; color:rgba(255,255,255,0.4); font-weight:bold; text-transform:uppercase;">歌单名称</span>
                        <input type="text" id="new-pl-name" class="meta-input" style="width:100%; margin-top:4px; font-size:13px;" placeholder="我的新歌单">
                    </div>
                    <div>
                        <span style="font-size:11px; color:rgba(255,255,255,0.4); font-weight:bold; text-transform:uppercase;">歌单介绍</span>
                        <input type="text" id="new-pl-desc" class="meta-input" style="width:100%; margin-top:4px; font-size:13px;" placeholder="描述你的歌单">
                    </div>
                    <div>
                        <span style="font-size:11px; color:rgba(255,255,255,0.4); font-weight:bold; text-transform:uppercase;">歌单封面 (支持本地上传/URL)</span>
                        <div style="display:flex; gap:8px; margin-top:4px; align-items:center;">
                            <input type="text" id="new-pl-cover" class="meta-input" style="flex:1; font-size:11px; padding:6px 10px; background:rgba(255,255,255,0.03);" placeholder="输入封面图片 URL">
                            <label class="apple-btn" style="padding:6px 12px; font-size:11px; background:rgba(255,255,255,0.1); cursor:pointer; border-radius:6px; white-space:nowrap; border:1px solid rgba(255,255,255,0.06);">
                                本地上传
                                <input type="file" accept="image/*" style="display:none;" id="new-pl-file" onchange="
                                    const file = this.files[0];
                                    if (file) {
                                        if (file.size > 1.5 * 1024 * 1024) { alert('图片大小不能超过 1.5MB'); return; }
                                        const reader = new FileReader();
                                        reader.onload = (e) => { document.getElementById('new-pl-cover').value = e.target.result; window.app.showToast('本地图片解析完成'); };
                                        reader.readAsDataURL(file);
                                    }
                                ">
                            </label>
                        </div>
                    </div>
                </div>
            `, (modal) => {
                const nameInput = modal.querySelector('#new-pl-name')?.value;
                if (!nameInput || !nameInput.trim()) { this.showToast("歌单名称不能为空"); return false; }
                const name = app.escapeHtml(nameInput);
                const desc = app.escapeHtml(modal.querySelector('#new-pl-desc')?.value || "");
                const cover = app.escapeHtml(modal.querySelector('#new-pl-cover')?.value || "");
                const newPl = {
                    id: 'playlist_' + Date.now(), name: name.trim(), description: desc.trim(), cover: cover.trim(),
                    isPublic: true, createTime: new Date().toISOString(), shareCount: 0, playCount: 0, browseCount: 0, favoriteCount: 0, songs: []
                };
                this.userPlaylists.push(newPl);
                localStorage.setItem('AerMusic_Playlists', JSON.stringify(this.userPlaylists));
                this.showToast("新建歌单成功");
                this.renderPlaylistsPage();
            });
        };

        // 本地封面上传
        app.handleLocalCoverUpload = function(input, pId) {
            const file = input.files[0];
            if (!file) return;
            if (file.size > 1.5 * 1024 * 1024) { this.showToast("图片大小不能超过 1.5MB"); return; }
            const reader = new FileReader();
            reader.onload = (e) => {
                const base64Data = e.target.result;
                const pl = this.userPlaylists.find(p => String(p.id) === String(pId));
                if (pl) {
                    pl.cover = base64Data;
                    localStorage.setItem('AerMusic_Playlists', JSON.stringify(this.userPlaylists));
                    const img = document.getElementById('detail-pl-cover-img');
                    if (img) img.src = base64Data;
                    const inputField = document.getElementById('detail-pl-cover-input');
                    if (inputField) inputField.value = base64Data;
                    this.showToast("本地封面更新成功");
                }
            };
            reader.readAsDataURL(file);
        };

        // 覆盖 viewPlaylistDetail
        const originalViewPlaylistDetail = app.viewPlaylistDetail;
        app.viewPlaylistDetail = function(pId) {
            if (originalViewPlaylistDetail) originalViewPlaylistDetail.call(app, pId);
            const pl = this.userPlaylists.find(p => String(p.id) === String(pId));
            if (!pl) return;
            const coverRow = document.getElementById('detail-pl-cover-input')?.parentNode;
            if (coverRow) {
                coverRow.style.cssText = "margin-top:8px; display:flex; flex-direction:column; gap:4px;";
                coverRow.innerHTML = `
                    <span class="meta-label">封面图片 (本地/网络外链)</span>
                    <div style="display:flex; gap:8px; align-items:center; width:100%;">
                        <input type="text" class="meta-input" id="detail-pl-cover-input" style="flex:1; font-size:11px; padding:6px 10px; background:rgba(255,255,255,0.03);" placeholder="封面URL地址" value="${pl.cover || ''}" onchange="app.savePlaylistMetadata('${pl.id}')">
                        <label class="apple-btn" style="padding:6px 12px; font-size:11px; background:rgba(255,255,255,0.1); cursor:pointer; border-radius:6px; white-space:nowrap; border:1px solid rgba(255,255,255,0.06);">
                            本地上传
                            <input type="file" accept="image/*" style="display:none;" id="detail-pl-file-input" onchange="app.handleLocalCoverUpload(this, '${pl.id}')">
                        </label>
                    </div>
                `;
            }
        };

        // 覆盖 deletePlaylist
        const originalDeletePlaylist = app.deletePlaylist;
        app.deletePlaylist = function(pId) {
            app.showAppleModal("删除歌单",
                `<div style="text-align: center; font-size: 14px; color: rgba(255, 255, 255, 0.85); line-height: 1.6;">确定要删除这个歌单吗？<br><strong style="color: var(--apple-red, #ff3b30);">此操作不可逆！</strong></div>`,
                () => {
                    const exists = this.userPlaylists.findIndex(p => String(p.id) === String(pId));
                    if (exists !== -1) this.userPlaylists.splice(exists, 1);
                    const favIdx = this.favoritePlaylists.findIndex(p => String(p.id) === String(pId));
                    if (favIdx !== -1) this.favoritePlaylists.splice(favIdx, 1);
                    localStorage.setItem('AerMusic_Playlists', JSON.stringify(this.userPlaylists));
                    localStorage.setItem('AerMusic_Favorites_Playlists', JSON.stringify(this.favoritePlaylists));
                    this.showToast("删除歌单成功");
                    this.showPlaylistsList();
                }
            );
        };

        // 覆盖 showPlaylistsList
        const originalShowPlaylistsList = app.showPlaylistsList;
        app.showPlaylistsList = function() {
            if (originalShowPlaylistsList) originalShowPlaylistsList.call(app);
            const backBtn = document.getElementById('playlist-back-btn');
            if (backBtn) backBtn.style.setProperty('display', 'flex', 'important');
        };

        // 覆盖 savePlaylistMetadata
        const originalSavePlaylistMetadata = app.savePlaylistMetadata;
        app.savePlaylistMetadata = function(pId) {
            const nameEl = document.getElementById('detail-pl-name');
            const descEl = document.getElementById('detail-pl-desc');
            const coverEl = document.getElementById('detail-pl-cover-input');
            if (nameEl) nameEl.value = String(nameEl.value || '');
            if (descEl) descEl.value = String(descEl.value || '');
            if (coverEl) coverEl.value = String(coverEl.value || '');
            if (originalSavePlaylistMetadata) originalSavePlaylistMetadata.call(app, pId);
        };

        // 覆盖 play 以增强封面 blob 处理
        const originalPlay = app.play;
        const theme = this;
        app.play = async function(index) {
            if (originalPlay) originalPlay.call(app, index);
            theme.updateOlCard();
            if (app.updatePlayingHighlight) app.updatePlayingHighlight();
        };

        // 更新搜索结果播放高亮
        app.updatePlayingHighlight = function() {
            const currentSong = this.playlist[this.currentIndex];
            if (!currentSong) return;
            const currentId = String(currentSong.id);
            document.querySelectorAll('.result-item').forEach(item => {
                const songId = String(item.getAttribute('data-song-id') || '');
                const indexVal = item.getAttribute('data-index-val') || '';
                const indexEl = item.querySelector('.result-index');
                if (songId === currentId) {
                    item.classList.add('playing');
                    if (indexEl) {
                        indexEl.innerHTML = `<svg width="1.5vh" height="1.5vh" viewBox="0 0 24 24" fill="var(--apple-red)"><rect x="3" y="10" width="3" height="10"><animate attributeName="height" values="5;15;5" dur="0.6s" repeatCount="indefinite" /><animate attributeName="y" values="15;5;15" dur="0.6s" repeatCount="indefinite" /></rect><rect x="10" y="5" width="3" height="15"><animate attributeName="height" values="15;5;15" dur="0.8s" repeatCount="indefinite" /><animate attributeName="y" values="5;15;5" dur="0.8s" repeatCount="indefinite" /></rect><rect x="17" y="8" width="3" height="12"><animate attributeName="height" values="10;18;10" dur="0.7s" repeatCount="indefinite" /><animate attributeName="y" values="12;4;12" dur="0.7s" repeatCount="indefinite" /></rect></svg>`;
                    }
                } else {
                    item.classList.remove('playing');
                    if (indexEl && indexVal) indexEl.textContent = String(indexVal).padStart(2, '0');
                }
            });
        };

        // 播放建议歌曲
        app.playSuggestSong = async function(song) {
            if (!song) return;
            const artistName = song.artists ? song.artists.map(a => a.name).join('/') : '未知歌手';
            const targetSong = { id: song.id, name: song.name, artist: artistName, cover: '', platformId: 'cloudmusic' };
            this.showToast("正在获取歌曲数据...");
            const platform = window.PlatformCore?.get('cloudmusic');
            if (platform) {
                const detail = await platform.getSongDetail(song.id);
                if (detail) {
                    const normalized = window.PlatformCore.normalizeSongData(detail, 'cloudmusic');
                    app.playSearchResult(normalized);
                    return;
                }
            }
            app.playSearchResult(targetSong);
        };

        // 加载建议专辑（通过 PlatformCore）
        app.loadSuggestAlbum = async function(albumId, albumName) {
            this.showToast("正在加载专辑歌曲...");
            try {
                const platform = window.PlatformCore?.get('cloudmusic');
                if (!platform || !platform.getAlbum) {
                    this.showToast("该平台不支持专辑功能");
                    return;
                }
                const rawSongs = await platform.getAlbum(albumId);
                if (rawSongs && rawSongs.length > 0) {
                    const songs = rawSongs.map(s => window.PlatformCore.normalizeSongData(s, 'cloudmusic'));
                    const _esc2 = window.app && window.app.escapeHtml ? window.app.escapeHtml : ((x) => String(x));
                    const songsHtml = songs.map((s, idx) => `
                        <div data-play-idx="${idx}" style="display:flex; align-items:center; gap:10px; padding:8px; border-radius:8px; background:rgba(255,255,255,0.03); margin-bottom:6px; cursor:pointer;">
                            <span style="font-size:11px; color:rgba(255,255,255,0.4); width:20px; text-align:center;">${(idx+1).toString().padStart(2, '0')}</span>
                            <div style="flex:1; overflow:hidden; text-align: left;">
                                <div style="font-size:13px; font-weight:bold; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${_esc2(s.name || '')}</div>
                                <div style="font-size:11px; color:rgba(255,255,255,0.5); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px;">${_esc2(s.artist || '')}</div>
                            </div>
                        </div>
                    `).join('');
                    app.showAppleModal(`专辑: ${_esc2(albumName)}`, `<div style="max-height: 250px; overflow-y: auto; padding-right: 4px; box-sizing: border-box;">${songsHtml}</div>`, () => {
                        if (songs.length > 0) {
                            app.playlist = songs;
                            app.currentIndex = 0;
                            app.rebuildViewport();
                            app.play(0);
                            app.showToast(`正在播放专辑 《${albumName}》`);
                        }
                    });
                    const confirmBtn = document.getElementById('apple-modal-confirm');
                    if (confirmBtn) confirmBtn.textContent = "播放整张专辑";
                    const modalPanel = document.getElementById('apple-music-modal');
                    if (modalPanel) {
                        modalPanel.querySelectorAll('[data-play-idx]').forEach(row => {
                            row.addEventListener('click', (e) => {
                                e.stopPropagation();
                                const s = songs[Number(row.dataset.playIdx)];
                                if (!s) return;
                                app.closeAppleModal();
                                app.playSearchResult(s);
                            });
                        });
                    }
                }
            } catch (e) {
                this.showToast("加载专辑失败");
            }
        };
    },

    injectHoverTriggers() {},

    initPageObserver() {
        const app = this.getApp();
        if (!app) return;

        let currentPage = app.page || 'recommend';

        Object.defineProperty(app, 'page', {
            get() { return currentPage; },
            set(val) {
                currentPage = val;
                document.querySelectorAll('.sidebar-menu .sidebar-item').forEach(item => item.classList.remove('active'));
                if (val === 'recommend') document.getElementById('sidebar-home-btn')?.classList.add('active');
                else if (val === 'search') document.getElementById('sidebar-search-btn')?.classList.add('active');
                else if (val === 'favorites') document.getElementById('sidebar-fav-btn')?.classList.add('active');
                else if (val === 'playlists') document.getElementById('sidebar-playlists-btn')?.classList.add('active');
                // settings 页面保留 search-active 和 theme-overlay，不清理
                if (val !== 'search' && val !== 'settings') {
                    const searchOverlay = document.getElementById('search-overlay');
                    if (searchOverlay) app.closeOverlay(searchOverlay);
                    document.body.classList.remove('search-active', 'page-search', 'page-search-center', 'page-search-results');
                }
                if (val === 'recommend') {
                    document.body.classList.add('page-recommend');
                } else {
                    document.body.classList.remove('page-recommend');
                    if (val === 'favorites') document.body.classList.add('favorites-active');
                    if (val === 'playlists') document.body.classList.add('playlists-active');
                }
                const sideTools = document.querySelector('.side-tools');
                if (sideTools) {
                    if (val === 'recommend') sideTools.classList.remove('hidden-tools');
                    else sideTools.classList.add('hidden-tools');
                }
                setTimeout(() => { if (app.updatePlayingHighlight) app.updatePlayingHighlight(); }, 50);
            },
            configurable: true,
            enumerable: true
        });
        app.page = currentPage;
    },

    initTooltipObserver() {
        document.querySelectorAll('.side-tools .tool-btn').forEach(btn => {
            const title = btn.getAttribute('title') || btn.getAttribute('data-tooltip');
            if (title) { btn.setAttribute('data-tooltip', title); btn.removeAttribute('title'); }
        });
        const observer = new MutationObserver(() => {
            document.querySelectorAll('.result-actions .action-btn, .playlist-detail-songs .action-btn').forEach(btn => {
                const title = btn.getAttribute('title') || btn.getAttribute('data-tooltip');
                if (title) { btn.setAttribute('data-tooltip', title); btn.removeAttribute('title'); }
            });
        });
        const searchRes = document.getElementById('searchRes');
        if (searchRes) observer.observe(searchRes, { childList: true, subtree: true });
        const favContent = document.getElementById('favorites-content');
        if (favContent) observer.observe(favContent, { childList: true, subtree: true });
        const playlistSongs = document.getElementById('playlist-detail-songs');
        if (playlistSongs) observer.observe(playlistSongs, { childList: true, subtree: true });
    },

    initSidebarAutoClose() {
        document.addEventListener('click', (e) => {
            if (!e.target || typeof e.target.closest !== 'function') return;
            if (document.body.classList.contains('sidebar-expanded')) {
                const sidebar = document.getElementById('sys-sidebar');
                const toggleBtn = document.getElementById('sidebar-toggle-btn');
                if (sidebar && !sidebar.contains(e.target) && (!toggleBtn || !toggleBtn.contains(e.target))) {
                    document.body.classList.remove('sidebar-expanded');
                    document.body.classList.remove('sidebar-visible');
                    const collapseIcon = document.querySelector('.toggle-icon-collapse');
                    const expandIcon = document.querySelector('.toggle-icon-expand');
                    if (collapseIcon) collapseIcon.style.display = 'block';
                    if (expandIcon) expandIcon.style.display = 'none';
                }
            }
        });
    },

    initSearchSuggest() {
        const searchInp = document.getElementById('searchInp');
        const container = document.querySelector('.search-container');
        if (!searchInp || !container) return;
        let popup = document.getElementById('search-suggest-popup');
        if (!popup) {
            popup = document.createElement('div');
            popup.id = 'search-suggest-popup';
            popup.className = 'search-suggest-popup';
            container.appendChild(popup);
        }
        const showSuggest = () => {
            clearTimeout(popup._closeTimer);
            delete popup.dataset.closing;
            popup.classList.remove('is-closing');
            popup.style.display = 'flex';
            requestAnimationFrame(() => popup.classList.add('is-open'));
        };
        const hideSuggest = () => {
            if (popup.dataset.closing === '1') return;
            popup.dataset.closing = '1';
            popup.classList.remove('is-open');
            popup.classList.add('is-closing');
            popup._closeTimer = setTimeout(() => {
                popup.style.display = 'none';
                popup.classList.remove('is-closing');
                delete popup.dataset.closing;
            }, 180);
        };
        this.showSearchSuggest = showSuggest;
        this.hideSearchSuggest = hideSuggest;
        let fetchTimer = null;
        const app = this.getApp();
        
        // 搜索历史管理
        const getHistory = () => {
            try {
                const value = JSON.parse(localStorage.getItem('AerMusic_SearchHistory') || '[]');
                return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
            } catch (e) {
                try { localStorage.removeItem('AerMusic_SearchHistory'); } catch (e) {}
                return [];
            }
        };
        const addToHistory = (kw) => {
            if (!kw || !kw.trim()) return;
            let history = getHistory().filter(h => h !== kw.trim());
            history.unshift(kw.trim());
            if (history.length > 20) history = history.slice(0, 20);
            localStorage.setItem('AerMusic_SearchHistory', JSON.stringify(history));
        };
        const removeFromHistory = (kw) => {
            let history = getHistory().filter(h => h !== kw);
            localStorage.setItem('AerMusic_SearchHistory', JSON.stringify(history));
        };
        const clearHistory = () => {
            localStorage.removeItem('AerMusic_SearchHistory');
        };
        
        const renderHistory = () => {
            const history = getHistory();
            if (history.length === 0) { hideSuggest(); return; }
            popup.innerHTML = '';
            const title = document.createElement('div');
            title.className = 'suggest-title';
            title.style.display = 'flex';
            title.style.justifyContent = 'space-between';
            title.style.alignItems = 'center';
            title.innerHTML = `<span>搜索历史</span><span data-clear-history style="cursor:pointer;opacity:0.5;font-size:10px;">清空</span>`;
            popup.appendChild(title);
            title.querySelector('[data-clear-history]').onclick = (e) => {
                e.stopPropagation();
                clearHistory();
                hideSuggest();
            };
            history.forEach(kw => {
                const item = document.createElement('div');
                item.className = 'suggest-item';
                item.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:1.6vh; height:1.6vh; opacity:0.5; flex-shrink:0;"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                    <span class="name" style="flex:1;" title="${app.escapeHtml(kw)}">${app.escapeHtml(kw)}</span>
                    <span data-del-hist style="cursor:pointer;opacity:0.3;font-size:12px;padding:2px 6px;">✕</span>
                `;
                item.querySelector('[data-del-hist]').addEventListener('click', (e) => {
                    e.stopPropagation();
                    const h = getHistory().filter(x => x !== kw);
                    localStorage.setItem('AerMusic_SearchHistory', JSON.stringify(h));
                    item.remove();
                });
                item.onclick = (e) => { 
                    if (e.target.closest('[data-del-hist]')) return;
                    e.stopPropagation(); 
                    hideSuggest();
                    document.getElementById('searchInp').value = kw; 
                    addToHistory(kw);
                    app.search(kw); 
                };
                popup.appendChild(item);
            });
            showSuggest();
        };
        
        const fetchSuggest = async (query) => {
            if (!query || !query.trim()) { renderHistory(); return; }
            try {
                const cleanQuery = app.escapeHtml(query);
                const platform = window.PlatformCore?.get('cloudmusic');
                if (!platform || !platform.getSearchSuggest) {
                    hideSuggest();
                    return;
                }
                const result = await platform.getSearchSuggest(cleanQuery);
                if (result) this.renderSuggestions(result);
                else hideSuggest();
            } catch (e) { hideSuggest(); }
        };
        
        // 保存原始搜索函数并增强
        const originalSearch = app.search.bind(app);
        app.search = (kw) => {
            if (kw && kw.trim()) addToHistory(kw);
            originalSearch(kw);
        };
        
        searchInp.oninput = (e) => {
            const val = e.target.value;
            clearTimeout(fetchTimer);
            fetchTimer = setTimeout(() => fetchSuggest(val), 250);
        };
        searchInp.onfocus = () => { 
            if (searchInp.value.trim() !== '') fetchSuggest(searchInp.value); 
            else renderHistory();
        };
        document.addEventListener('click', (e) => { if (!container.contains(e.target)) hideSuggest(); });
    },

    renderSuggestions(result) {
        const popup = document.getElementById('search-suggest-popup');
        const app = this.getApp();
        if (!popup || !app) return;
        popup.innerHTML = '';
        const { songs, albums, order } = result;
        if (!order || order.length === 0) { this.hideSearchSuggest?.(); return; }
        let hasData = false;
        order.forEach(type => {
            if (type === 'songs' && songs && songs.length > 0) {
                hasData = true;
                const title = document.createElement('div');
                title.className = 'suggest-title';
                title.textContent = '单曲建议';
                popup.appendChild(title);
                songs.forEach(song => {
                    const artist = song.artists ? song.artists.map(a => a.name).join('/') : '未知歌手';
                    const item = document.createElement('div');
                    item.className = 'suggest-item';
                    item.innerHTML = `
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:1.6vh; height:1.6vh; opacity:0.5; flex-shrink:0;"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                        <span class="name" title="${app.escapeHtml(song.name)}">${app.escapeHtml(song.name)}</span>
                        <span class="artist" title="${app.escapeHtml(artist)}">${app.escapeHtml(artist)}</span>
                    `;
                    item.onclick = (e) => { e.stopPropagation(); this.hideSearchSuggest?.(); document.getElementById('searchInp').value = song.name; app.playSuggestSong(song); };
                    popup.appendChild(item);
                });
            }
            if (type === 'albums' && albums && albums.length > 0) {
                hasData = true;
                const title = document.createElement('div');
                title.className = 'suggest-title';
                title.textContent = '专集 / 歌单';
                popup.appendChild(title);
                albums.forEach(album => {
                    const artist = album.artist ? album.artist.name : '未知歌手';
                    const item = document.createElement('div');
                    item.className = 'suggest-item';
                    item.innerHTML = `
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:1.6vh; height:1.6vh; opacity:0.5; flex-shrink:0;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="12" cy="12" r="3"/></svg>
                        <span class="name" title="${app.escapeHtml(album.name)}">${app.escapeHtml(album.name)}</span>
                        <span class="artist" title="${app.escapeHtml(artist)}">${app.escapeHtml(artist)}</span>
                    `;
                    item.onclick = (e) => { e.stopPropagation(); this.hideSearchSuggest?.(); document.getElementById('searchInp').value = album.name; app.loadSuggestAlbum(album.id, album.name); };
                    popup.appendChild(item);
                });
            }
        });
        if (hasData) this.showSearchSuggest?.();
        else this.hideSearchSuggest?.();
    }
};

if (window.StyleCore) {
    window.StyleCore.register(window.AerTheme);
}
