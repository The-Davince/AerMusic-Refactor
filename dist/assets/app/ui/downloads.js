
(function () {
    const STORE_KEY = 'AerMusic_Downloads';
    const MAX_TASKS = 200;
    const CROSS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="width:1em; height:1em; display:block;"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

    const state = {
        tasks: [],
        face: 'icon',
        altTimer: null,
        altShowCount: false,
        marqueeTimer: 0,
        restoreTimer: 0,
        checkTimer: 0,
        expandUntil: 0,
        pending: null,
        booted: false
    };

    const app = () => window.app;

    function load() {
        try {
            const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
            state.tasks = Array.isArray(raw) ? raw.filter(t => t && t.id != null).slice(-MAX_TASKS) : [];
        } catch (e) {
            state.tasks = [];
        }
        state.tasks.forEach(t => { if (t.status === 'downloading') t.status = 'failed'; });
    }

    function save() {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(state.tasks.slice(-MAX_TASKS)));
        } catch (e) {}
    }

    const running = () => state.tasks.filter(t => t.status === 'downloading');
    const esc = (v) => {
        const a = app();
        return a && a.escapeHtml ? a.escapeHtml(v) : String(v == null ? '' : v);
    };
    const safeCover = (v) => {
        const s = String(v == null ? '' : v);
        return /^https?:\/\//.test(s) ? s : '';
    };

    const ICON_DOWNLOAD = (cls) => `<svg class="${cls || ''}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/></svg>`;
    const ICON_CHECK = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
    const ICON_TRASH = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;

    function faceEl() {
        return document.querySelector('#dl-btn .dl-face');
    }

function setFaceIcon() {
    state.face = 'icon';
    const face = faceEl();
    if (!face) return;
    face.classList.remove('dl-cover');
    face.style.backgroundImage = '';
    face.innerHTML = ICON_DOWNLOAD(running().length > 0 ? 'dl-bounce' : '');
}

    function setFaceCover(cover) {
        const url = safeCover(cover);
        if (!url) { setFaceIcon(); return; }
        state.face = 'cover';
        const face = faceEl();
        if (!face) return;
        face.classList.add('dl-cover');
        face.innerHTML = '';
        face.style.backgroundImage = `url("${url}")`;
    }

    function setFaceCount() {
        state.face = 'count';
        const face = faceEl();
        if (!face) return;
        face.classList.remove('dl-cover');
        face.style.backgroundImage = '';
        face.innerHTML = `<span class="dl-count">${running().length}</span>`;
    }

    function setFaceCheck() {
        state.face = 'check';
        const face = faceEl();
        if (!face) return;
        face.classList.remove('dl-cover');
        face.style.backgroundImage = '';
        face.innerHTML = ICON_CHECK;
    }

    function updateButton() {
        const btn = document.getElementById('dl-btn');
        if (!btn) return;
        const list = running();
        const avg = list.length ? Math.round(list.reduce((s, t) => s + (t.progress || 0), 0) / list.length) : 0;
        btn.style.setProperty('--dl-progress', String(avg));
        btn.classList.toggle('dl-active', list.length > 0);
        btn.classList.toggle('dl-empty', state.tasks.length === 0);
        btn.setAttribute('aria-label', list.length > 0 ? `下载管理, ${list.length} 个任务进行中` : '下载管理');
        const hasRunning = list.length > 0;
        if (hasRunning && !state.altTimer) {
            state.altTimer = setInterval(() => {
                if (running().length === 0) return;
                if (Date.now() < state.expandUntil) return;
                if (state.face === 'cover' || state.face === 'check') return;
                state.altShowCount = !state.altShowCount;
                if (state.altShowCount) setFaceCount();
                else setFaceIcon();
            }, 3000);
        }
        if (!hasRunning && state.altTimer) {
            clearInterval(state.altTimer);
            state.altTimer = null;
            state.altShowCount = false;
        }
        
        if (!hasRunning && Date.now() >= state.expandUntil && state.face !== 'check' && state.face !== 'icon') {
            setFaceIcon();
        }
    }

    function dissolve(el, apply) {
        if (!el) { apply(); return; }
        el.classList.add('dl-dissolving');
        setTimeout(() => {
            apply();
            el.classList.remove('dl-dissolving');
        }, 240);
    }

    function applyToastText(task) {
        const box = document.getElementById('dl-toast');
        const nameEl = box ? box.querySelector('.dl-toast-name') : null;
        if (!box || !nameEl) return;
        nameEl.textContent = task.name || '未知歌曲';
        nameEl.classList.remove('dl-marquee-on');
        const wide = nameEl.scrollWidth > 360;
        box.style.setProperty('--dl-w', Math.min(nameEl.scrollWidth, 360) + 'px');
        box.classList.toggle('dl-need-marquee', wide);
        if (wide) {
            nameEl.style.setProperty('--dl-shift', (nameEl.scrollWidth - 360) + 'px');
        } else {
            nameEl.style.removeProperty('--dl-shift');
        }
        return wide;
    }

    function celebrate(task) {
        const box = document.getElementById('dl-toast');
        const nameEl = box ? box.querySelector('.dl-toast-name') : null;
        const wasOpen = Date.now() < state.expandUntil;
        clearTimeout(state.marqueeTimer);
        clearTimeout(state.restoreTimer);
        if (wasOpen) {
            dissolve(faceEl(), () => setFaceCover(task.cover));
            dissolve(nameEl, () => applyToastText(task));
        } else {
            setFaceCover(task.cover);
            const wide = applyToastText(task);
            if (box) box.classList.add('dl-open');
            state.marqueeTimer = setTimeout(() => {
                if (wide && nameEl) nameEl.classList.add('dl-marquee-on');
            }, 1500);
        }
        state.expandUntil = Date.now() + 5000;
        state.pending = task;
        state.restoreTimer = setTimeout(restoreFromExpand, 5000);
        updateButton();
        renderPanel();
    }

    function restoreFromExpand() {
        if (Date.now() < state.expandUntil - 40) return;
        const box = document.getElementById('dl-toast');
        const nameEl = box ? box.querySelector('.dl-toast-name') : null;
        state.pending = null;
        dissolve(nameEl, () => {
            if (nameEl) {
                nameEl.textContent = '';
                nameEl.classList.remove('dl-marquee-on');
            }
        });
        setTimeout(() => { if (box && Date.now() >= state.expandUntil - 40) box.classList.remove('dl-open'); }, 260);
        setTimeout(() => {
            if (Date.now() < state.expandUntil - 40) return;
            if (running().length > 0) {
                setFaceIcon();
                return;
            }
            setFaceCheck();
            clearTimeout(state.checkTimer);
            state.checkTimer = setTimeout(() => {
                if (Date.now() < state.expandUntil - 40) return;
                dissolve(faceEl(), setFaceIcon);
            }, 5000);
        }, 540);
    }

    async function start(song) {
        if (!song || !song.id) return;
        if (!song.url) { app()?.showToast('当前歌曲暂无下载源'); return; }
        const task = {
            key: String(song.id) + '_' + Date.now(),
            id: String(song.id),
            name: song.name || '未知歌曲',
            artist: song.artist || '',
            cover: song.cover || '',
            status: 'downloading',
            progress: 0,
            at: Date.now()
        };
        state.tasks.push(task);
        save();
        updateButton();
        renderPanel();
        try {
            const quality = (app()?.config && app().config.quality) || '320k';
            const response = await fetch(song.url);
            if (!response.ok) throw new Error('status ' + response.status);
            const total = +response.headers.get('Content-Length') || 0;
            const reader = response.body.getReader();
            const chunks = [];
            let received = 0;
            for (;;) {
                const step = await reader.read();
                if (step.done) break;
                chunks.push(step.value);
                received += step.value.length;
                task.progress = total ? Math.min(99, Math.round(received / total * 100)) : 0;
                updateButton();
                updateRow(task);
            }
            const blob = new Blob(chunks);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const ext = ['lossless', 'hires', 'master'].includes(quality) ? 'flac' : 'mp3';
            a.href = url;
            a.download = (task.name + ' - ' + task.artist).replace(/[\\/:*?"<>|]/g, '') + '.' + ext;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                a.remove();
                URL.revokeObjectURL(url);
            }, 1000);
            task.status = 'done';
            task.progress = 100;
            save();
            updateButton();
            celebrate(task);
        } catch (err) {
            console.error('下载失败:', err);
            task.status = 'failed';
            save();
            updateButton();
            renderPanel();
            app()?.showToast(`${task.name} | 下载失败`);
            try { window.open(song.url, '_blank'); } catch (e) {}
        }
    }

    
    function rowEl(task) {
        const row = document.createElement('div');
        row.className = 'playlist-item dl-row';
        row.dataset.key = task.key;
        const cover = safeCover(task.cover);
        row.innerHTML = `
            <div class="item-cover-box dl-row-cover">
                <img src="${esc(cover)}" class="item-cover" onerror="this.style.opacity='0'">
            </div>
            <div class="item-info">
                <span class="item-name">${esc(task.name)}</span>
                <span class="item-artist">${esc(task.artist || '未知歌手')}</span>
            </div>
            <div class="item-duration dl-row-status">${statusText(task)}</div>
        `;
        return row;
    }

    function statusText(task) {
        if (task.status === 'downloading') return task.progress ? task.progress + '%' : '下载中';
        if (task.status === 'done') return '已完成';
        return '失败';
    }

    function updateRow(task) {
        const row = document.querySelector(`#dl-items .dl-row[data-key="${task.key}"]`);
        if (!row) return;
        const cell = row.querySelector('.dl-row-status');
        if (cell) cell.textContent = statusText(task);
    }

    function renderPanel() {
        const panel = document.getElementById('dl-panel');
        if (!panel) return;
        const items = panel.querySelector('#dl-items');
        const title = panel.querySelector('.playlist-title');
        if (title) title.textContent = `下载任务 (${state.tasks.length})`;
        if (!items) return;
        if (state.tasks.length === 0) {
            items.innerHTML = '<div class="playlist-empty">暂无下载任务</div>';
            return;
        }
        items.innerHTML = '';
        state.tasks.slice().reverse().forEach(t => items.appendChild(rowEl(t)));
    }

    function closePanel() {
        const panel = document.getElementById('dl-panel');
        if (!panel) return;
        if (app()?.closePopup) app().closePopup(panel);
        else panel.remove();
    }

    function togglePanel() {
        const exist = document.getElementById('dl-panel');
        if (exist) { closePanel(); return; }
        const panel = document.createElement('div');
        panel.id = 'dl-panel';
        panel.className = 'playlist-panel';
        panel.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
        panel.addEventListener('touchmove', e => e.stopPropagation(), { passive: true });
        panel.innerHTML = `
            <div class="playlist-header">
                <span class="playlist-title">下载任务 (${state.tasks.length})</span>
                <div class="playlist-actions">
                    <button class="playlist-btn" type="button" data-dl-clear>清空</button>
                    <button class="playlist-close" type="button" data-dl-close>${CROSS_ICON}</button>
                </div>
            </div>
            <div class="playlist-items" id="dl-items"></div>
        `;
        document.body.appendChild(panel);
        
        (function positionPanel() {
            const btn = document.getElementById('dl-btn');
            if (!btn) return;
            const r = btn.getBoundingClientRect();
            const width = panel.offsetWidth || 0;
            const height = panel.offsetHeight || 0;
            let left = r.left;
            if (left + width > window.innerWidth - 10) left = Math.max(10, r.right - width);
            panel.style.position = 'fixed';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            panel.style.top = Math.round(r.bottom + 10) + 'px';
            panel.style.left = Math.round(left) + 'px';
            const maxH = Math.max(160, Math.round(window.innerHeight - r.bottom - 40));
            panel.style.maxHeight = Math.min(400, maxH) + 'px';
        })();
        panel.querySelector('[data-dl-close]').onclick = closePanel;
        panel.querySelector('[data-dl-clear]').onclick = () => {
            state.tasks = state.tasks.filter(t => t.status === 'downloading');
            save();
            renderPanel();
            updateButton();
        };
        renderPanel();
    }

    function buildButton() {
        const topBar = document.getElementById('top-bar');
        const logo = document.getElementById('app-logo');
        if (!topBar || !logo || document.getElementById('dl-btn')) return;
        const wrap = document.createElement('div');
        wrap.id = 'dl-wrap';
        wrap.innerHTML = `
            <button id="dl-btn" class="dl-empty" type="button" aria-label="下载管理" title="下载管理">
                <span class="dl-ring"></span>
                <span class="dl-face"></span>
            </button>
            <div id="dl-toast" class="dl-toast"><span class="dl-toast-name"></span><span class="dl-toast-suffix"> 下载完成</span></div>
        `;
        if (logo.nextSibling) topBar.insertBefore(wrap, logo.nextSibling);
        else topBar.appendChild(wrap);
        document.getElementById('dl-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            togglePanel();
        });
        document.addEventListener('click', (e) => {
            const panel = document.getElementById('dl-panel');
            if (!panel) return;
            if (e.target.closest('#dl-panel') || e.target.closest('#dl-btn')) return;
            closePanel();
        }, true);
        setFaceIcon();
        updateButton();
        renderPanel();
    }

    function boot() {
        if (state.booted) return;
        state.booted = true;
        load();
        buildButton();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    window.AerMusicDownloads = {
        start: start,
        getTasks: () => state.tasks.slice()
    };
})();
