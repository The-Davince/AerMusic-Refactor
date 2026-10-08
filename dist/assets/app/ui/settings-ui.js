/**
 * 设置面板渲染 (从 StyleCore 上移到 core 壳层)
 * 样式卡片 / 音源卡片 / 已存样式列表 + GPU/翻译色设置恢复
 */
(function() {
    const styleEsc = (value) => {
        if (window.app && typeof window.app.escapeHtml === 'function') return window.app.escapeHtml(value);
        return String(value ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
    };
    const styleUrl = (value) => {
        const url = String(value ?? '').trim();
        return /^https?:\/\//i.test(url) ? url : '';
    };

    const ui = {
        renderStyleList() {
            const grid = document.getElementById('style-grid');
            if (!grid) {
                console.warn('[SettingsUI] style-grid 容器不存在');
                return;
            }

            const currentId = localStorage.getItem('AerMusic_CurrentStyle') || 'default';
            const styles = window.StyleCore.getStyleList();

            if (styles.length === 0) {
                grid.innerHTML = `
                    <div style="color:rgba(255,255,255,0.5);font-size:1.4vh;padding:2vh;text-align:center;">
                        正在加载样式...
                    </div>
                `;
                /* 限时重渲, 样式系统加载失败就停在提示, 不无限轮询 */
                ui._renderRetryCount = (ui._renderRetryCount || 0) + 1;
                if (ui._renderRetryCount <= 20) setTimeout(() => ui.renderStyleList(), 500);
                return;
            }
            ui._renderRetryCount = 0;

            grid.innerHTML = styles.map(style => {
                const isActive = style.id === currentId;
                const bgStyle = style.bg
                    ? (style.bg.startsWith('#') || style.bg.startsWith('rgb') || style.bg.startsWith('linear')
                        ? `background:${style.bg};`
                        : `background-image:url(${style.bg});background-size:cover;`)
                    : 'background:#333;';

                const author = style.author || '';
                const authorUrl = style.authorUrl || '';
                const safeAuthorUrl = styleUrl(authorUrl);
                const authorHtml = author ? `<div style="font-size:1.1vh;color:rgba(255,255,255,0.4);margin-top:0.3vh;${safeAuthorUrl ? 'cursor:pointer;text-decoration:underline;' : ''}" ${safeAuthorUrl ? `data-author-url="${styleEsc(safeAuthorUrl)}"` : ''}>${styleEsc(author)}</div>` : '';

                const iconContent = style.icon || style.name.charAt(0);

                return `
                    <div class="platform-setting-item" data-style-action="select" data-style-id="${styleEsc(style.id)}" style="cursor:pointer;${isActive ? 'border:1px solid var(--apple-red,#24c8fa);' : ''}">
                        <div class="platform-icon" style="${styleEsc(bgStyle)}width:4vh;height:4vh;border-radius:1vh;display:flex;align-items:center;justify-content:center;">
                            <span style="color:#fff;font-size:1.8vh;font-weight:700;">${styleEsc(iconContent)}</span>
                        </div>
                        <div class="platform-details">
                            <div class="platform-name">${styleEsc(style.name)} ${isActive ? '✓' : ''}</div>
                            <div class="platform-desc">${styleEsc(style.description || '')}</div>
                        </div>
                        ${style.custom ? '<div style="font-size:1vh;background:rgba(255,255,255,0.15);padding:0.2vh 0.6vh;border-radius:0.5vh;color:#fff;">自定义</div>' : ''}
                    </div>
                `;
            }).join('') + `
                <div class="platform-setting-item" data-style-action="custom" style="cursor:pointer;border:1px dashed rgba(255,255,255,0.15);">
                    <div class="platform-icon" style="width:4vh;height:4vh;border-radius:1vh;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.05);">
                        <svg width="2vh" height="2vh" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </div>
                    <div class="platform-details">
                        <div class="platform-name" style="color:rgba(255,255,255,0.5);">添加自定义样式</div>
                        <div class="platform-desc">点击添加你的自定义播放样式</div>
                    </div>
                </div>
            `;

            grid.querySelectorAll('[data-style-action="select"]').forEach(card => {
                card.addEventListener('click', () => window.StyleCore.selectStyle(card.dataset.styleId));
            });
            grid.querySelectorAll('[data-author-url]').forEach(el => {
                el.addEventListener('click', e => {
                    e.stopPropagation();
                    window.open(el.dataset.authorUrl, '_blank', 'noopener,noreferrer');
                });
            });
            const customCard = grid.querySelector('[data-style-action="custom"]');
            if (customCard) customCard.addEventListener('click', () => window.app?.showCustomStyleForm?.());
        },

        renderPlatformList() {
            const container = document.getElementById('platform-settings');
            if (!container || !window.PlatformCore) return;

            const platforms = window.PlatformCore.getAvailablePlatforms();

            if (platforms.length === 0) {
                container.innerHTML = '<div style="color:rgba(255,255,255,0.5);font-size:1.4vh;">暂无已注册的音源平台</div>';
                return;
            }

            container.innerHTML = platforms.map(platform => {
                const author = platform.author || '';
                const authorUrl = platform.authorUrl || '';
                const safeAuthorUrl = styleUrl(authorUrl);
                const authorHtml = author ? `<div style="font-size:1.1vh;color:rgba(255,255,255,0.4);margin-top:0.3vh;${safeAuthorUrl ? 'cursor:pointer;text-decoration:underline;' : ''}" ${safeAuthorUrl ? `data-author-url="${styleEsc(safeAuthorUrl)}"` : ''}>${styleEsc(author)}</div>` : '';
                const iconHtml = platform.icon && platform.icon.includes('<svg') ? platform.icon : `<span style="color:#fff;font-size:1.6vh;">${styleEsc(platform.icon || platform.name.charAt(0))}</span>`;

                return `
                    <div class="platform-setting-item" style="position:relative;">
                        <div class="platform-icon" style="background:${styleEsc(platform.color || '#666')};width:4vh;height:4vh;border-radius:1vh;display:flex;align-items:center;justify-content:center;color:#fff;">
                            ${iconHtml}
                        </div>
                        <div class="platform-details">
                            <div class="platform-name">${styleEsc(platform.name)}</div>
                            <div class="platform-desc">${styleEsc(platform.description || '')}</div>
                            ${authorHtml}
                        </div>
                    </div>
                `;
            }).join('');

            container.innerHTML += `
                <div class="platform-setting-item" data-platform-action="add" style="cursor:pointer;border:1px dashed rgba(255,255,255,0.15);">
                    <div class="platform-icon" style="width:4vh;height:4vh;border-radius:1vh;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.05);">
                        <svg width="2vh" height="2vh" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </div>
                    <div class="platform-details">
                        <div class="platform-name" style="color:rgba(255,255,255,0.5);">添加自定义音源</div>
                        <div class="platform-desc">点击添加你的自定义音源平台</div>
                    </div>
                </div>
            `;
            container.querySelectorAll('[data-author-url]').forEach(el => {
                el.addEventListener('click', e => {
                    e.stopPropagation();
                    window.open(el.dataset.authorUrl, '_blank', 'noopener,noreferrer');
                });
            });
            const addPlatform = container.querySelector('[data-platform-action="add"]');
            if (addPlatform) addPlatform.addEventListener('click', () => window.app?.showAddPlatformModal?.());
        },

        renderSavedStyles() {
            const container = document.getElementById('saved-styles-list');
            if (!container) return;

            if (window.StyleCore.customStyles.length === 0) {
                container.innerHTML = '';
                return;
            }

            container.innerHTML = window.StyleCore.customStyles.map(style => `
                <div class="saved-style-item" data-style-id="${styleEsc(style.id)}">
                    <div class="saved-style-info">
                        <span class="saved-style-name">${styleEsc(style.name)}</span>
                        <span class="saved-style-desc">${styleEsc(style.description || '')}</span>
                    </div>
                    <div class="saved-style-actions">
                        <div class="saved-style-btn" data-style-action="use">使用</div>
                        <div class="saved-style-btn delete" data-style-action="delete">删除</div>
                    </div>
                </div>
            `).join('');
            container.querySelectorAll('.saved-style-item').forEach(item => {
                const id = item.dataset.styleId;
                item.querySelector('[data-style-action="use"]')?.addEventListener('click', () => window.app?.switchStyle?.(id));
                item.querySelector('[data-style-action="delete"]')?.addEventListener('click', () => {
                    window.StyleCore.removeCustomStyle(id);
                    ui.renderSavedStyles();
                    ui.renderStyleList();
                });
            });
        },

        renderAll() {
            ui.renderStyleList();
            ui.renderPlatformList();
            ui.renderSavedStyles();
        },

        /* 原 StyleCore.initSettings 的设置恢复部分 */
        restoreSettingsUi() {
            const gpuEnabled = localStorage.getItem('AerMusic_GPUAccel') !== 'false';
            const gpuSwitch = document.getElementById('set-gpu-accel');
            if (gpuSwitch) {
                gpuSwitch.checked = gpuEnabled;
            }
            const transLyricColor = localStorage.getItem('AerMusic_TransLyricColor') || '#aaaaaa';
            const transPicker = document.getElementById('set-trans-lyric-color-picker');
            const transHex = document.getElementById('set-trans-lyric-color-hex');
            if (transPicker) transPicker.value = transLyricColor;
            if (transHex) transHex.value = transLyricColor;
        },

        async initSettings() {
            console.log('[SettingsUI] initSettings 调用');
            await window.StyleCore.init();
            ui.renderAll();
            ui.restoreSettingsUi();
        }
    };

    window.AerSettingsUI = ui;
})();
