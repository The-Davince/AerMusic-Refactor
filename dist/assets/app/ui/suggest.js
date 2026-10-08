/**
 * 搜索建议子系统 (从默认主题上移到 core)
 * 建议弹窗 DOM/事件 + 搜索历史 + getSearchSuggest (经 PlatformCore.features 门控)
 */
(function() {
    function getHistory() {
        try {
            const value = JSON.parse(localStorage.getItem('AerMusic_SearchHistory') || '[]');
            return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
        } catch (e) {
            try { localStorage.removeItem('AerMusic_SearchHistory'); } catch (err) {}
            return [];
        }
    }
    function addToHistory(kw) {
        if (!kw || !kw.trim()) return;
        let history = getHistory().filter(h => h !== kw.trim());
        history.unshift(kw.trim());
        if (history.length > 20) history = history.slice(0, 20);
        localStorage.setItem('AerMusic_SearchHistory', JSON.stringify(history));
    }

    let popup = null;
    let showSuggest = null;
    let hideSuggest = null;

    function ensurePopup() {
        if (popup) return;
        const container = document.querySelector('.search-container');
        if (!container) return;
        popup = document.createElement('div');
        popup.id = 'search-suggest-popup';
        popup.className = 'search-suggest-popup';
        container.appendChild(popup);

        showSuggest = () => {
            clearTimeout(popup._closeTimer);
            delete popup.dataset.closing;
            popup.classList.remove('is-closing');
            popup.style.display = 'flex';
            requestAnimationFrame(() => popup.classList.add('is-open'));
        };
        hideSuggest = () => {
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
        document.addEventListener('click', (e) => { if (!container.contains(e.target)) hideSuggest(); });
    }

    function renderHistory(app) {
        ensurePopup();
        const history = getHistory();
        if (!popup || history.length === 0) { hideSuggest(); return; }
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
            localStorage.removeItem('AerMusic_SearchHistory');
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
    }

    function renderSuggestions(app, result) {
        ensurePopup();
        if (!popup) return;
        popup.innerHTML = '';
        const { songs, albums, order } = result;
        if (!order || order.length === 0) { hideSuggest(); return; }
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
                    item.onclick = (e) => { e.stopPropagation(); hideSuggest(); document.getElementById('searchInp').value = song.name; app.playSuggestSong(song); };
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
                    item.onclick = (e) => { e.stopPropagation(); hideSuggest(); document.getElementById('searchInp').value = album.name; app.loadSuggestAlbum(album.id, album.name); };
                    popup.appendChild(item);
                });
            }
        });
        if (hasData) showSuggest();
        else hideSuggest();
    }

    async function fetchSuggest(app, query) {
        const kw = String(query ?? '').trim();
        if (!kw) { renderHistory(app); return; }
        try {
            /* 请求走上游原始词, HTML 转义只在渲染结果时做 */
            const platformId = window.PlatformCore ? window.PlatformCore.getDefaultPlatform() : 'cloudmusic';
            const result = await window.PlatformCore.getSearchSuggest(platformId, kw);
            if (result) renderSuggestions(app, result);
            else hideSuggest();
        } catch (e) { hideSuggest(); }
    }

    function apply() {
        const app = window.app;
        if (!app || app._suggestBound || !document.getElementById('searchInp')) return false;
        app._suggestBound = true;
        const searchInp = document.getElementById('searchInp');

        const originalSearch = app.search.bind(app);
        app.search = (kw) => {
            if (kw && kw.trim()) addToHistory(kw);
            originalSearch(kw);
        };

        let fetchTimer = null;
        searchInp.oninput = (e) => {
            const val = e.target.value;
            clearTimeout(fetchTimer);
            fetchTimer = setTimeout(() => fetchSuggest(app, val), 250);
        };
        searchInp.onfocus = () => {
            if (searchInp.value.trim() !== '') fetchSuggest(app, searchInp.value);
            else renderHistory(app);
        };
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
