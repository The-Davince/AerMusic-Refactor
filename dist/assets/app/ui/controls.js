





(function() {
    let autoHideTimer = null;
    let bound = false;
    let mobileOverlay = null;

    function A() { return window.app; }
    function icons() { return window.SVGcfg || {}; }

    function volIcon(v) {
        const s = icons();
        return typeof s.volume === 'function' ? s.volume(v) : (s.volume || '');
    }
    function modeIcon(m) {
        const s = icons();
        const map = { heart: s.heart || s.listLoop, list: s.listLoop, single: s.singleLoop, random: s.random };
        return map[m] || s.listLoop || '';
    }
    function modeLabel(m) {
        if (m === 'heart') return '心动模式';
        return m === 'single' ? '单曲循环' : (m === 'random' ? '随机播放' : '列表循环');
    }
    function fmtTime(t) {
        const a = A();
        return (a && a.formatTime) ? a.formatTime(t) : '0:00';
    }

    function setFillProgress(fill, ratio) {
        if (!fill) return;
        const r = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
        if (fill._aerScaleMode === undefined || fill._aerSheets !== document.styleSheets.length) {
            if (fill._aerScaleMode !== undefined) { fill.style.width = ""; fill.style.transform = ""; }
            fill._aerSheets = document.styleSheets.length;
            const c = fill.parentElement;
            const cw = c ? c.getBoundingClientRect().width : 0;
            const fw = cw > 0 ? (parseFloat(window.getComputedStyle(fill).width) || 0) : 0;
            fill._aerScaleMode = cw > 0 && fw >= cw * 0.9;
        }
        if (fill._aerScaleMode) fill.style.transform = "scaleX(" + r + ")";
        else fill.style.width = (r * 100) + "%";
    }

    
    function defaultBarHtml() {
        const a = A();
        const loopMode = a?.loopMode || 'list';
        const rate = a?.config?.playbackRate || 1;
        const volume = a && a.audio ? Math.round((a.audio.volume ?? 1) * 100) : 100;
        const s = icons();
        const qualityLabel = (a && a.getCurrentQualityLabel) ? a.getCurrentQualityLabel() : '';
        return `
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
                    <div class="btn mode-btn" data-ctl="mode" data-tooltip="播放模式">
                        <span class="mode-icon" id="mode-icon">${modeIcon(loopMode)}</span>
                        <span class="mode-label" id="mode-label">${modeLabel(loopMode)}</span>
                    </div>
                    <div class="btn" data-ctl="back15" data-tooltip="后退15秒">${s.backward15}</div>
                    <div class="btn" data-ctl="prev" data-tooltip="上一首">${s.prev}</div>
                    <div class="btn btn-play" data-ctl="play" id="fixed-play-btn" data-tooltip="播放/暂停">${s.play}</div>
                    <div class="btn" data-ctl="next" data-tooltip="下一首">${s.next}</div>
                    <div class="btn" data-ctl="fwd15" data-tooltip="前进15秒">${s.forward15}</div>
                    <div class="btn speed-btn" data-ctl="speed" data-tooltip="播放速度">
                        ${s.speed}<span class="speed-label" id="speed-label">${rate}x</span>
                    </div>
                    <div class="btn volume-btn" data-ctl="volume" data-tooltip="音量">
                        <span class="volume-icon" id="volume-icon">${volIcon(volume)}</span>
                        <span class="volume-label" id="volume-label">${volume}</span>
                    </div>
                    <div class="btn" data-ctl="list" data-tooltip="播放列表">${s.playlist}</div>
                    <div class="btn quality-btn" data-ctl="quality" data-tooltip="音质">
                        <span class="quality-icon">${(a && a.qualityIcon) ? a.qualityIcon(a.config && a.config.quality) : s.quality}</span><span class="quality-label">${qualityLabel}</span>
                    </div>
                </div>
            </div>
        `;
    }

    function mobileMiniHtml() {
        const s = icons();
        return `
            <div class="mobile-mini-content">
                <button class="mobile-mini-open" type="button" aria-label="打开播放页">
                    <img class="mobile-mini-cover" id="mobile-mini-cover" src="" alt="当前歌曲封面">
                    <span class="mobile-mini-meta">
                        <span class="mobile-mini-title" id="mobile-mini-title">未播放歌曲</span>
                        <span class="mobile-mini-artist" id="mobile-mini-artist">选择一首歌曲开始播放</span>
                    </span>
                </button>
                <div class="mobile-mini-action" data-ctl="play" id="mobile-mini-play" data-tooltip="播放/暂停">${s.play}</div>
                <div class="mobile-mini-action" data-ctl="next" data-tooltip="下一首">${s.next}</div>
            </div>
        `;
    }

    function ensureMobileOverlay() {
        if (mobileOverlay && mobileOverlay.isConnected) return mobileOverlay;
        const a = A();
        mobileOverlay = document.createElement('div');
        mobileOverlay.id = 'mobile-player-overlay';
        mobileOverlay.className = 'mobile-player-overlay';
        mobileOverlay.setAttribute('aria-hidden', 'true');
        mobileOverlay.innerHTML = `
            <div class="mobile-player-header">
                <button class="mobile-player-close" type="button" aria-label="关闭播放页">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
                </button>
                <span class="mobile-player-header-title">正在播放</span>
                <button class="mobile-player-list mobile-player-control" type="button" data-ctl="list" aria-label="播放列表">
                    ${icons().playlist || ''}
                </button>
            </div>
            <div class="mobile-player-art"><img id="mobile-player-cover" src="" alt="当前歌曲封面"></div>
            <div class="mobile-player-meta">
                <div class="mobile-player-title" id="mobile-player-title">未播放歌曲</div>
                <div class="mobile-player-artist" id="mobile-player-artist">选择一首歌曲开始播放</div>
            </div>
            <input class="mobile-player-seek" id="mobile-player-seek" type="range" min="0" max="0" step="0.1" value="0" aria-label="播放进度">
            <div class="mobile-player-time"><span id="mobile-player-cur">0:00</span><span id="mobile-player-dur">0:00</span></div>
            <div class="mobile-player-main-actions">
                <div class="mobile-player-control" data-ctl="prev" data-tooltip="上一首">${icons().prev || ''}</div>
                <div class="mobile-player-control primary" data-ctl="play" id="mobile-player-play" data-tooltip="播放/暂停">${icons().play || ''}</div>
                <div class="mobile-player-control" data-ctl="next" data-tooltip="下一首">${icons().next || ''}</div>
            </div>
            <div class="mobile-player-extra-actions">
                <div class="mobile-player-control mode-btn" id="mobile-player-mode" data-ctl="mode" data-tooltip="播放模式">${modeIcon(a?.loopMode || 'list')}</div>
                <div class="mobile-player-control volume-btn" id="mobile-player-volume" data-ctl="volume" data-tooltip="音量">${volIcon(a?.audio ? Math.round((a.audio.volume ?? 1) * 100) : 100)}</div>
                <div class="mobile-player-control speed-btn" data-ctl="speed" data-tooltip="播放速度">${icons().speed || ''}</div>
            </div>
        `;
        document.body.appendChild(mobileOverlay);
        mobileOverlay.querySelector('.mobile-player-close')?.addEventListener('click', closeMobilePlayer);
        mobileOverlay.querySelector('.mobile-player-seek')?.addEventListener('input', e => {
            const a = A();
            if (!a || !a.audio || !Number.isFinite(a.audio.duration)) return;
            a.audio.currentTime = Number(e.target.value);
            setEl('mobile-player-cur', el => el.textContent = fmtTime(a.audio.currentTime));
        });
        bindButtons(mobileOverlay);
        return mobileOverlay;
    }

    function openMobilePlayer() {
        const overlay = ensureMobileOverlay();
        overlay.classList.add('is-open');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.classList.add('mobile-player-open');
    }

    function closeMobilePlayer() {
        if (!mobileOverlay) return;
        mobileOverlay.classList.remove('is-open');
        mobileOverlay.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('mobile-player-open');
    }

    function syncMobileSong(song) {
        if (!song) return;
        const rawCover = String(song.cover || '').trim();
        const cover = /^https?:\/\//i.test(rawCover) ? rawCover : '';
        const title = song.name || '未播放歌曲';
        const artist = song.artist || '未知歌手';
        setEl('mobile-mini-cover', el => { el.src = cover; el.alt = title; });
        setEl('mobile-player-cover', el => { el.src = cover; el.alt = title; });
        setEl('mobile-mini-title', el => el.textContent = title);
        setEl('mobile-mini-artist', el => el.textContent = artist);
        setEl('mobile-player-title', el => el.textContent = title);
        setEl('mobile-player-artist', el => el.textContent = artist);
    }

    
    let barTip = null;

    function ensureBarTip() {
        if (!barTip || !barTip.isConnected) {
            barTip = document.getElementById('bar-tooltip') || document.createElement('div');
            barTip.id = 'bar-tooltip';
            if (!barTip.isConnected) document.body.appendChild(barTip);
        }
        return barTip;
    }

    function showBarTip(target) {
        const text = target.getAttribute('data-tooltip');
        if (!text) return;
        const tip = ensureBarTip();
        if (tip.dataset.text !== text) {
            tip.textContent = text;
            tip.dataset.text = text;
        }
        const r = target.getBoundingClientRect();
        const tr = tip.getBoundingClientRect();
        const bar = target.closest ? target.closest('#fixed-genius-bar') : null;
        const anchorTop = bar ? Math.min(r.top, bar.getBoundingClientRect().top) : r.top;
        let left = r.left + r.width / 2 - tr.width / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - tr.width - 8));
        tip.style.left = Math.round(left) + 'px';
        tip.style.top = Math.round(anchorTop - tr.height - 8) + 'px';
        tip.classList.add('show');
    }

    function hideBarTip() {
        if (barTip) barTip.classList.remove('show');
    }

    
    function bindBarTips(bar) {
        if (bindBarTips.done) return;
        bindBarTips.done = true;
        const isNativeTip = (el) => !!(el && el.closest && (el.closest('.side-tools') || el.closest('.result-actions')));
        document.addEventListener('mouseover', (e) => {
            const target = e.target && e.target.closest ? e.target.closest('[data-tooltip]') : null;
            if (!target) return;
            if (isNativeTip(target)) { hideBarTip(); return; }
            showBarTip(target);
        }, true);
        document.addEventListener('mouseout', (e) => {
            const target = e.target && e.target.closest ? e.target.closest('[data-tooltip]') : null;
            if (target && !isNativeTip(target)) hideBarTip();
        }, true);
        window.addEventListener('scroll', hideBarTip, true);
        window.addEventListener('resize', hideBarTip);
    }

    function bindButtons(bar) {
        bar.querySelectorAll('[data-ctl]').forEach(el => {
            const c = el.dataset.ctl;
            el.addEventListener('click', () => {
                const a = A();
                if (!a) return;
                if (c === 'play') a.togglePlay();
                else if (c === 'prev') a.prev();
                else if (c === 'next') a.next();
                else if (c === 'fwd15') a.seekForward(15);
                else if (c === 'back15') a.seekBackward(15);
                else if (c === 'mode') a.togglePlayModeMenu?.();
                else if (c === 'speed') a.toggleSpeedMenu?.();
                else if (c === 'volume') a.toggleVolumeMenu?.();
                else if (c === 'quality') a.toggleQualityMenu?.();
                else if (c === 'list') a.togglePlaylist?.();
            });
        });
    }

    function bindSlider() {
        const slider = document.getElementById('fixed-seek');
        if (!slider) return;
        const handleStart = () => { const a = A(); if (a) a.isDragging = true; resetTimer(); };
        slider.onmousedown = slider.ontouchstart = handleStart;
        slider.oninput = () => {
            const a = A();
            if (a && a.audio && !isNaN(a.audio.duration)) {
                a.isDragging = true;
                a.audio.currentTime = Number(slider.value);
                const fill = document.getElementById('fixed-seek-fill');
                if (fill) setFillProgress(fill, slider.value / a.audio.duration);
                const curTxt = document.getElementById('fixed-cur');
                if (curTxt) curTxt.innerText = fmtTime(a.audio.currentTime);
            }
        };
        const handleEnd = () => { const a = A(); if (a) a.isDragging = false; resetTimer(); };
        slider.onmouseup = slider.ontouchend = handleEnd;
    }

    function bindAutoHide() {
        const bar = document.getElementById('fixed-genius-bar');
        if (!bar) return;
        window.addEventListener('mousemove', (e) => {
            if (e.clientY > window.innerHeight * 0.85) { showBar(); resetTimer(); }
        });
        bar.onmouseenter = () => { showBar(); resetTimer(); };
        bar.onmouseleave = () => resetTimer();
    }

    function syncBarCollapsed() {
        const bar = document.getElementById('fixed-genius-bar');
        document.body.classList.toggle('aer-bar-collapsed', !!(bar && bar.classList.contains('hidden')));
    }
    function showBar() { const bar = document.getElementById('fixed-genius-bar'); if (bar) bar.classList.remove('hidden'); syncBarCollapsed(); }
    function hideBar() { const bar = document.getElementById('fixed-genius-bar'); if (bar) bar.classList.add('hidden'); syncBarCollapsed(); }
    function resetTimer() { clearTimeout(autoHideTimer); autoHideTimer = setTimeout(hideBar, 5000); }

    
    function ensureBar() {
        if (document.getElementById('fixed-genius-bar')) return;
        const theme = window.AerTheme;
        const html = (theme && typeof theme.renderControlBar === 'function') ? theme.renderControlBar({}) : defaultBarHtml();
        const bar = document.createElement('div');
        bar.id = 'fixed-genius-bar';
        bar.innerHTML = html + mobileMiniHtml();
        document.body.appendChild(bar);
        ensureMobileOverlay();
        bar.querySelector('.mobile-mini-open')?.addEventListener('click', openMobilePlayer);
        bindButtons(bar);
        bindBarTips(bar);
        bindSlider();
        bindAutoHide();
    }

    function setEl(id, fn) { const el = document.getElementById(id); if (el) fn(el); }

    
    function onStatus(p) {
        setEl('fixed-play-btn', e => e.innerHTML = p.playing ? icons().pause : icons().play);
        setEl('mobile-mini-play', e => e.innerHTML = p.playing ? icons().pause : icons().play);
        setEl('mobile-player-play', e => e.innerHTML = p.playing ? icons().pause : icons().play);
        const t = window.AerTheme;
        if (t && typeof t.updateStatus === 'function') t.updateStatus(p.playing, p.loopMode, A()?.currentIndex);
    }
    function onMode(p) {
        setEl('mode-icon', e => e.innerHTML = modeIcon(p.mode));
        setEl('mobile-player-mode', e => e.innerHTML = modeIcon(p.mode));
        setEl('mode-label', e => e.textContent = modeLabel(p.mode));
        const t = window.AerTheme;
        if (t && typeof t.updatePlayModeUI === 'function') t.updatePlayModeUI(p.mode);
    }
    function onProgress(p) {
        setEl('fixed-cur', e => e.innerText = fmtTime(p.time));
        setEl('fixed-dur', e => { if (!isNaN(p.duration)) e.innerText = fmtTime(p.duration); });
        const a = A();
        if (a && a.audio && !isNaN(a.audio.duration) && !a.isDragging) {
            const slider = document.getElementById('fixed-seek');
            const fill = document.getElementById('fixed-seek-fill');
            if (slider) { slider.max = a.audio.duration; slider.value = p.time; }
            if (fill) setFillProgress(fill, p.time / a.audio.duration);
        }
        setEl('mobile-player-seek', e => {
            if (Number.isFinite(p.duration) && p.duration > 0) e.max = p.duration;
            e.value = Number.isFinite(p.time) ? p.time : 0;
        });
        setEl('mobile-player-cur', e => e.textContent = fmtTime(p.time));
        setEl('mobile-player-dur', e => e.textContent = fmtTime(p.duration));
        const t = window.AerTheme;
        if (t && typeof t.updateProgress === 'function') t.updateProgress(p.time, p.duration, a?.currentIndex);
    }
    function onSpeed(p) {
        setEl('speed-label', e => e.textContent = `${p.rate}x`);
        const t = window.AerTheme;
        if (t && typeof t.updateSpeedUI === 'function') t.updateSpeedUI(p.rate);
    }
    function onVolume(p) {
        setEl('volume-icon', e => e.innerHTML = volIcon(p.volume));
        setEl('mobile-player-volume', e => e.innerHTML = volIcon(p.volume));
        setEl('volume-label', e => e.textContent = p.volume);
        const t = window.AerTheme;
        if (t && typeof t.updateVolumeUI === 'function') t.updateVolumeUI(p.volume);
    }
    function onPitch(p) {
        const t = window.AerTheme;
        if (t && typeof t.updatePitchUI === 'function') t.updatePitchUI(p.preserve);
    }

    function apply() {
        const a = A();
        if (!a || !a.bus || bound) return false;
        bound = true;
        a.bus.on('page:rendered', ensureBar);
        a.bus.on('play:song', ensureBar);
        a.bus.on('play:song', syncMobileSong);
        a.bus.on('play:status', onStatus);
        a.bus.on('play:mode', onMode);
        a.bus.on('play:progress', onProgress);
        a.bus.on('play:speed', onSpeed);
        a.bus.on('play:volume', onVolume);
        a.bus.on('play:pitch', onPitch);
        syncBarCollapsed();
        return true;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function tick() { if (apply()) return; setTimeout(tick, 50); });
    } else {
        (function tick() { if (apply()) return; setTimeout(tick, 50); })();
    }
})();
