/**
 * 无UI模式 / 纯净歌词模式 (从默认主题上移到 core)
 * 状态机 + body class + 侧边工具按钮 + 歌词小卡片, 主题只出 CSS 皮肤
 */
(function() {
    const state = {
        hideUIActive: false,
        onlyLyricsActive: false,
        hideUITimers: { top: null, bottom: null, left: null, right: null }
    };
    let hideUIListener = null;

    function esc(value) {
        const app = window.app;
        return app && app.escapeHtml ? app.escapeHtml(value) : String(value ?? '');
    }

    function showUIArea(area, selector) {
        const el = document.querySelector(selector);
        if (!el) return;
        el.classList.add('ui-visible');
        clearTimeout(state.hideUITimers[area]);
        state.hideUITimers[area] = setTimeout(() => {
            el.classList.remove('ui-visible');
        }, 3000);
    }

    function applyHideUILogic() {
        if (!hideUIListener) {
            hideUIListener = (e) => {
                if (!state.hideUIActive) return;
                const x = e.clientX;
                const y = e.clientY;
                const w = window.innerWidth;
                const h = window.innerHeight;
                const isSideToolsHidden = document.querySelector('.side-tools')?.classList.contains('hidden-tools');

                if (y < 100) showUIArea('top', '#top-bar');
                if (y > h - 100) showUIArea('bottom', '#fixed-genius-bar');
                if (x < 100) showUIArea('left', '#sys-sidebar');
                if (x > w - 100 && !isSideToolsHidden) showUIArea('right', '.side-tools');
            };
            window.addEventListener('mousemove', hideUIListener);
        }
    }

    function clearHideUILogic() {
        ['top', 'bottom', 'left', 'right'].forEach(area => {
            clearTimeout(state.hideUITimers[area]);
        });
        document.querySelectorAll('#top-bar, .side-tools, #fixed-genius-bar, #sys-sidebar').forEach(el => {
            el.classList.remove('ui-visible');
        });
    }

    function updateHideUIState(notify = true) {
        const btn = document.getElementById('hide-ui-btn');
        if (btn) btn.classList.toggle('active', state.hideUIActive);

        if (state.hideUIActive) {
            document.body.classList.add('ui-hide-enabled');
            if (notify) window.app?.showToast("已启用无UI模式");
            applyHideUILogic();
        } else {
            document.body.classList.remove('ui-hide-enabled');
            if (notify) window.app?.showToast("已关闭无UI模式");
            clearHideUILogic();
        }
    }

    function toggleHideUI() {
        state.hideUIActive = !state.hideUIActive;
        localStorage.setItem('AerMusic_HideUI', state.hideUIActive);
        updateHideUIState();
    }

    function updateOlCard() {
        const app = window.app;
        if (!app || !app.playlist || !app.playlist[app.currentIndex]) return;
        const song = app.playlist[app.currentIndex];
        const olCover = document.getElementById('ol-card-cover');
        const olTitle = document.getElementById('ol-card-title');
        const olArtist = document.getElementById('ol-card-artist');
        if (olCover) olCover.src = song.cover;
        if (olTitle) olTitle.innerText = song.name;
        if (olArtist) {
            const artists = song.artists || [];
            if (artists.length > 0) {
                const safeId = (value) => /^\d{1,15}$/.test(String(value ?? '').trim()) ? String(value).trim() : '';
                olArtist.innerHTML = artists.map(a => {
                    const id = safeId(a.id);
                    const name = esc(a.name || a);
                    return id ? `<span data-artist-id="${id}" style="cursor:pointer;transition:color 0.2s;" onmouseover="this.style.color='var(--apple-red,#ff3b30)'" onmouseout="this.style.color=''">${name}</span>` : name;
                }).join(' / ');
                olArtist.querySelectorAll('[data-artist-id]').forEach(el => {
                    el.addEventListener('click', (e) => {
                        e.stopPropagation();
                        app.openArtistPage(el.dataset.artistId);
                    });
                });
            } else {
                olArtist.innerText = song.artist || '未知歌手';
            }
        }
    }

    function searchFromCard(keyword) {
        const app = window.app;
        if (app && keyword) {
            const searchInp = document.getElementById('searchInp');
            if (searchInp) {
                searchInp.value = keyword;
                app.search(keyword);
            }
        }
    }

    function updateOnlyLyricsState(notify = true) {
        const app = window.app;
        const btn = document.getElementById('only-lyrics-btn');
        if (btn) btn.classList.toggle('active', state.onlyLyricsActive);

        if (state.onlyLyricsActive) {
            /* 记录进入前的歌词隐藏状态, 以便退出时恢复 */
            state._prevLyricsHidden = app?.lyricVisible === false;
            if (app && app.lyricVisible === false) {
                app.lyricVisible = true;
                document.querySelectorAll('.song-page').forEach(page => {
                    page.classList.remove('lyrics-hidden');
                });
            }
            document.body.classList.add('only-lyrics-enabled');
            if (notify && app?.showToast) app.showToast("已启用纯净歌词模式");
        } else {
            document.body.classList.remove('only-lyrics-enabled');
            if (state._prevLyricsHidden && app) {
                app.lyricVisible = false;
                document.querySelectorAll('.song-page').forEach(page => {
                    page.classList.add('lyrics-hidden');
                });
            }
            if (notify && app?.showToast) app.showToast("已关闭纯净歌词模式");
        }
        updateOlCard();
    }

    function toggleOnlyLyrics() {
        state.onlyLyricsActive = !state.onlyLyricsActive;
        localStorage.setItem('AerMusic_OnlyLyrics', state.onlyLyricsActive);
        updateOnlyLyricsState();
    }

    function injectButtons() {
        const sideTools = document.querySelector('.side-tools');
        const themeBtn = document.getElementById('theme-btn');
        if (!sideTools || !themeBtn) return;
        if (document.getElementById('only-lyrics-btn')) return;

        const onlyLyricsBtn = document.createElement('div');
        onlyLyricsBtn.id = 'only-lyrics-btn';
        onlyLyricsBtn.className = 'tool-btn';
        onlyLyricsBtn.title = '只显示歌词';
        onlyLyricsBtn.onclick = () => toggleOnlyLyrics();
        onlyLyricsBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 6h16M4 12h16M4 18h7"/>
            </svg>
        `;

        const hideUiBtn = document.createElement('div');
        hideUiBtn.id = 'hide-ui-btn';
        hideUiBtn.className = 'tool-btn';
        hideUiBtn.title = '隐藏UI';
        hideUiBtn.onclick = () => toggleHideUI();
        hideUiBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
        `;

        sideTools.insertBefore(onlyLyricsBtn, themeBtn);
        sideTools.insertBefore(hideUiBtn, themeBtn);
    }

    function injectOlCard() {
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

        card.querySelector('#ol-card-title').onclick = () => searchFromCard(card.querySelector('#ol-card-title').innerText);
        card.querySelector('#ol-card-artist').onclick = () => searchFromCard(card.querySelector('#ol-card-artist').innerText);
    }

    function apply() {
        const app = window.app;
        if (!app || app._modesBound || !document.getElementById('theme-btn')) return false;
        app._modesBound = true;

        state.hideUIActive = localStorage.getItem('AerMusic_HideUI') === 'true';
        state.onlyLyricsActive = localStorage.getItem('AerMusic_OnlyLyrics') === 'true';

        injectButtons();
        injectOlCard();
        /* 恢复持久化状态(静默, 不弹 toast), 仅用户主动切换时才提示 */
        updateHideUIState(false);
        updateOnlyLyricsState(false);

        /* index.html 静态按钮/ol-card 的内联 onclick 依赖这三个方法 */
        app.toggleHideUI = toggleHideUI;
        app.toggleOnlyLyrics = toggleOnlyLyrics;
        app.searchFromCard = searchFromCard;

        /* 切歌时刷新歌词小卡片 (原主题 play 包装的职责) */
        app.bus.on('play:song', updateOlCard);

        return true;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function tick() {
            if (apply()) return;
            setTimeout(tick, 50);
        });
    } else {
        (function tick() {
            if (apply()) return;
            setTimeout(tick, 50);
        })();
    }
})();
