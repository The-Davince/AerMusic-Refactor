/**
 * 播放控制栏 (从默认主题 onRendered 上移到 core)
 * 默认控制栏 markup + data-ctl 行为绑定 + 进度滑块/自动隐藏 + 总线驱动数值槽
 * 主题可通过 renderControlBar(ctx) 提供自定义 markup (约定 data-ctl / 数值槽 id)
 * 旧接口主题 (实现 updateStatus/updateProgress/...) 经 v1 兼容桥继续工作
 */
(function() {
    let autoHideTimer = null;
    let bound = false;

    function A() { return window.app; }
    function icons() { return window.SVGcfg || {}; }

    function volIcon(v) {
        const s = icons();
        return typeof s.volume === 'function' ? s.volume(v) : (s.volume || '');
    }
    function modeIcon(m) {
        const s = icons();
        const map = { list: s.listLoop, single: s.singleLoop, random: s.random };
        return map[m] || s.listLoop || '';
    }
    function modeLabel(m) {
        return m === 'single' ? '单曲循环' : (m === 'random' ? '随机' : '列表循环');
    }
    function fmtTime(t) {
        const a = A();
        return (a && a.formatTime) ? a.formatTime(t) : '0:00';
    }

    /* 默认控制栏 markup (主题 v1 原样, 交互改 data-ctl, 由 core 绑定) */
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
                    <div class="btn mode-btn" data-ctl="mode" title="播放模式">
                        <span class="mode-icon" id="mode-icon">${modeIcon(loopMode)}</span>
                        <span class="mode-label" id="mode-label">${modeLabel(loopMode)}</span>
                    </div>
                    <div class="btn" data-ctl="back15" title="后退15秒">${s.backward15}</div>
                    <div class="btn" data-ctl="prev" title="上一首">${s.prev}</div>
                    <div class="btn btn-play" data-ctl="play" id="fixed-play-btn" title="播放/暂停">${s.play}</div>
                    <div class="btn" data-ctl="next" title="下一首">${s.next}</div>
                    <div class="btn" data-ctl="fwd15" title="前进15秒">${s.forward15}</div>
                    <div class="btn speed-btn" data-ctl="speed" title="播放速度">
                        ${s.speed}<span class="speed-label" id="speed-label">${rate}x</span>
                    </div>
                    <div class="btn volume-btn" data-ctl="volume" title="音量">
                        <span class="volume-icon" id="volume-icon">${volIcon(volume)}</span>
                        <span class="volume-label" id="volume-label">${volume}</span>
                    </div>
                    <div class="btn" data-ctl="list" title="播放列表">${s.playlist}</div>
                    <div class="btn quality-btn" data-ctl="quality" title="音质">
                        ${s.quality}<span class="quality-label">${qualityLabel}</span>
                    </div>
                </div>
            </div>
        `;
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
                const percent = (slider.value / a.audio.duration) * 100;
                const fill = document.getElementById('fixed-seek-fill');
                if (fill) fill.style.width = `${percent}%`;
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

    function showBar() { const bar = document.getElementById('fixed-genius-bar'); if (bar) bar.classList.remove('hidden'); }
    function hideBar() { const bar = document.getElementById('fixed-genius-bar'); if (bar) bar.classList.add('hidden'); }
    function resetTimer() { clearTimeout(autoHideTimer); autoHideTimer = setTimeout(hideBar, 5000); }

    /* 主题未自建控制栏时, core 出默认栏 */
    function ensureBar() {
        if (document.getElementById('fixed-genius-bar')) return;
        const theme = window.AerTheme;
        const html = (theme && typeof theme.renderControlBar === 'function') ? theme.renderControlBar({}) : defaultBarHtml();
        const bar = document.createElement('div');
        bar.id = 'fixed-genius-bar';
        bar.innerHTML = html;
        document.body.appendChild(bar);
        bindButtons(bar);
        bindSlider();
        bindAutoHide();
    }

    function setEl(id, fn) { const el = document.getElementById(id); if (el) fn(el); }

    /* 数值槽 + v1 兼容桥 */
    function onStatus(p) {
        setEl('fixed-play-btn', e => e.innerHTML = p.playing ? icons().pause : icons().play);
        const t = window.AerTheme;
        if (t && typeof t.updateStatus === 'function') t.updateStatus(p.playing, p.loopMode, A()?.currentIndex);
    }
    function onMode(p) {
        setEl('mode-icon', e => e.innerHTML = modeIcon(p.mode));
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
            if (fill) fill.style.width = `${(p.time / a.audio.duration) * 100}%`;
        }
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
        a.bus.on('play:status', onStatus);
        a.bus.on('play:mode', onMode);
        a.bus.on('play:progress', onProgress);
        a.bus.on('play:speed', onSpeed);
        a.bus.on('play:volume', onVolume);
        a.bus.on('play:pitch', onPitch);
        return true;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function tick() { if (apply()) return; setTimeout(tick, 50); });
    } else {
        (function tick() { if (apply()) return; setTimeout(tick, 50); })();
    }
})();
