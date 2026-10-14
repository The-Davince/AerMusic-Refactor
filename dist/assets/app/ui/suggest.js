



(function() {
    const CLOCK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:1.6vh; height:1.6vh; opacity:0.5; flex-shrink:0;"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
    const SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:1.6vh; height:1.6vh; opacity:0.5; flex-shrink:0;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    const CROSS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="width:1.6vh; height:1.6vh; flex-shrink:0;"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

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

    
    function highlightKw(text, key, escape) {
        const raw = String(text ?? '');
        const word = String(key ?? '').trim().toLowerCase();
        const low = raw.toLowerCase();
        const at = word && low.length === raw.length ? low.indexOf(word) : -1;
        if (at < 0) return escape(raw);
        return escape(raw.slice(0, at)) + '<span class="suggest-hl">' + escape(raw.slice(at, at + word.length)) + '</span>' + escape(raw.slice(at + word.length));
    }

    function matchHistory(kw, history) {
        const word = kw.toLowerCase();
        const hit = [];
        history.forEach((item, idx) => {
            const low = item.toLowerCase();
            if (low === word) return;
            const at = low.indexOf(word);
            if (at < 0) return;
            hit.push({ kw: item, level: at === 0 ? 0 : 1, idx });
        });
        return hit.sort((a, b) => a.level - b.level || a.idx - b.idx).slice(0, 2).map(h => h.kw);
    }

    let popup = null;
    let showSuggest = null;
    let hideSuggest = null;
    let fetchSeq = 0;

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
        popup.addEventListener('mousedown', (e) => {
            if (e.target && e.target.closest && e.target.closest('.suggest-item')) e.preventDefault();
        });
    }

    function makeTermItem(app, kw, key, icon, withDel) {
        const item = document.createElement('div');
        item.className = 'suggest-item';
        item.innerHTML = `
            ${icon}
            <span class="name" style="flex:1;" title="${app.escapeHtml(kw)}">${highlightKw(kw, key, app.escapeHtml)}</span>
            ${withDel ? `<span class="suggest-del" data-del-hist>${CROSS_ICON}</span>` : ''}
        `;
        if (withDel) {
            item.querySelector('[data-del-hist]').addEventListener('click', (e) => {
                e.stopPropagation();
                const left = getHistory().filter(x => x !== kw);
                localStorage.setItem('AerMusic_SearchHistory', JSON.stringify(left));
                item.remove();
                if (popup && !popup.querySelector('.suggest-item')) hideSuggest();
            });
        }
        item.onclick = (e) => {
            if (e.target.closest('[data-del-hist]')) return;
            e.stopPropagation();
            hideSuggest();
            document.getElementById('searchInp').value = kw;
            addToHistory(kw);
            app.search(kw);
        };
        return item;
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
        history.forEach(kw => popup.appendChild(makeTermItem(app, kw, '', CLOCK_ICON, true)));
        showSuggest();
    }

    function renderSuggestions(app, kw, result) {
        ensurePopup();
        if (!popup) return;
        popup.innerHTML = '';
        popup.appendChild(makeTermItem(app, kw, kw, SEARCH_ICON, false));
        matchHistory(kw, getHistory()).forEach(h => popup.appendChild(makeTermItem(app, h, kw, CLOCK_ICON, true)));
        const { songs, artists, albums } = result || {};
        const order = result && Array.isArray(result.order) ? result.order : [];
        order.forEach(type => {
            if (type === 'songs' && songs && songs.length > 0) {
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
                        <span class="name" title="${app.escapeHtml(song.name)}">${highlightKw(song.name, kw, app.escapeHtml)}</span>
                        <span class="artist" title="${app.escapeHtml(artist)}">${app.escapeHtml(artist)}</span>
                    `;
                    item.onclick = (e) => { e.stopPropagation(); hideSuggest(); document.getElementById('searchInp').value = song.name; app.playSuggestSong(song); };
                    popup.appendChild(item);
                });
            }
            if (type === 'artists' && artists && artists.length > 0) {
                const title = document.createElement('div');
                title.className = 'suggest-title';
                title.textContent = '歌手建议';
                popup.appendChild(title);
                artists.forEach(artist => {
                    const item = document.createElement('div');
                    item.className = 'suggest-item';
                    item.innerHTML = `
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:1.6vh; height:1.6vh; opacity:0.5; flex-shrink:0;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                        <span class="name" title="${app.escapeHtml(artist.name)}">${highlightKw(artist.name, kw, app.escapeHtml)}</span>
                    `;
                    item.onclick = (e) => { e.stopPropagation(); hideSuggest(); document.getElementById('searchInp').value = artist.name; app.openArtistPage(artist.id); };
                    popup.appendChild(item);
                });
            }
            if (type === 'albums' && albums && albums.length > 0) {
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
                        <span class="name" title="${app.escapeHtml(album.name)}">${highlightKw(album.name, kw, app.escapeHtml)}</span>
                        <span class="artist" title="${app.escapeHtml(artist)}">${app.escapeHtml(artist)}</span>
                    `;
                    item.onclick = (e) => { e.stopPropagation(); hideSuggest(); document.getElementById('searchInp').value = album.name; app.loadSuggestAlbum(album.id, album.name); };
                    popup.appendChild(item);
                });
            }
        });
        const words = result && Array.isArray(result.keywords) ? result.keywords : [];
        const lower = kw.toLowerCase();
        const wordList = words.filter(word => typeof word === 'string' && word.trim() && word.trim().toLowerCase() !== lower);
        if (wordList.length > 0) {
            const title = document.createElement('div');
            title.className = 'suggest-title';
            title.textContent = '词条建议';
            popup.appendChild(title);
            wordList.forEach(word => popup.appendChild(makeTermItem(app, word.trim(), kw, SEARCH_ICON, false)));
        }
        showSuggest();
    }

    async function fetchSuggest(app, query) {
        const kw = String(query ?? '').trim();
        const seq = ++fetchSeq;
        if (!kw) { renderHistory(app); return; }
        try {
            const platformId = window.PlatformCore ? window.PlatformCore.getDefaultPlatform() : 'cloudmusic';
            const result = await window.PlatformCore.getSearchSuggest(platformId, kw);
            if (seq !== fetchSeq) return;
            renderSuggestions(app, kw, result);
        } catch (e) { if (seq === fetchSeq) renderSuggestions(app, kw, null); }
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
        searchInp.onfocus = () => fetchSuggest(app, searchInp.value);
        searchInp.addEventListener('blur', () => {
            ensurePopup();
            if (hideSuggest) hideSuggest();
        });
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
