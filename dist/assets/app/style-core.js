/**
 * AerMusic 播放样式核心系统
 * 支持完全自定义播放页面样式，包括布局、歌词动画等
 */

// ============================================================
// 共享 SVG 图标配置（从 theme.js 提取，供所有主题共享）
// ============================================================
(function() {
    if (window.SVGcfg) return;
    window.SVGcfg = {
        play: `<svg width="3.6vh" height="3.6vh" viewBox="0 0 36 36" fill="currentColor"><path d="M29.064 18.624L13.166 29.223C12.821 29.453 12.356 29.359 12.126 29.015C12.044 28.891 12 28.747 12 28.599V7.401C12 6.987 12.336 6.651 12.75 6.651C12.898 6.651 13.043 6.695 13.166 6.777L29.064 17.376C29.409 17.606 29.502 18.072 29.272 18.416C29.217 18.498 29.146 18.569 29.064 18.624Z" fill-opacity="0.9"/></svg>`,
        pause: `<svg width="3.6vh" height="3.6vh" viewBox="0 0 36 36" fill="currentColor"><rect x="10" y="8" width="5" height="20" rx="2" fill-opacity="0.9"/><rect x="21" y="8" width="5" height="20" rx="2" fill-opacity="0.9"/></svg>`,
        next: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" fill="none" version="1.1" width="36" height="36" viewBox="0 0 36 36"><defs><clipPath id="master_svg0_1_0854"><rect x="0" y="0" width="36" height="36" rx="0"/></clipPath></defs><g clip-path="url(#master_svg0_1_0854)"><path d="M11.6825101,26.165251C11.55597,26.25465,11.40489006,26.3025,11.25,26.3025C10.83578968,26.3025,10.5,25.966799,10.5,25.5525L10.5,10.4474401C10.5,10.2925501,10.547955036,10.1414702,10.63727975,10.01493C10.87614012,9.676529649999999,11.34410977,9.59584522,11.6825101,9.8347199L22.38195,17.387250899999998C22.451850999999998,17.436599700000002,22.512900000000002,17.4974995,22.56225,17.567550699999998C22.80105,17.9059496,22.72035,18.3738003,22.38195,18.612749100000002L11.6825101,26.165251ZM24,10.5C24,9.67158008,24.671551,9,25.5,9C26.328449,9,27,9.67158008,27,10.5L27,25.5C27,26.328449,26.328449,27,25.5,27C24.671551,27,24,26.328449,24,25.5L24,10.5Z" fill="currentColor" fill-opacity="0.5" style="mix-blend-mode:passthrough"/></g></svg>`,
        prev: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" fill="none" version="1.1" width="36" height="36" viewBox="0 0 36 36"><defs><clipPath id="master_svg0_1_0850"><rect x="0" y="0" width="36" height="36" rx="0"/></clipPath></defs><g clip-path="url(#master_svg0_1_0850)"><path d="M10.5,9C11.3284199,9,12,9.67158008,12,10.5L12,25.5C12,26.328449,11.3284199,27,10.5,27C9.67158008,27,9,26.328449,9,25.5L9,10.5C9,9.67158008,9.67158008,9,10.5,9ZM13.618034399999999,18.612749100000002C13.5481195,18.563400299999998,13.4871597,18.5023499,13.437809900000001,18.432449300000002C13.1989503,18.0940504,13.2796354,17.6261997,13.618034399999999,17.387250899999998L24.317551,9.8347199C24.443998999999998,9.74539518,24.59505,9.69744015,24.75,9.69744015C25.16415,9.69744015,25.5,10.0332298,25.5,10.4474401L25.5,25.5525C25.5,25.707451,25.452,25.858501,25.362751,25.9851C25.123802,26.3235,24.65595,26.404202,24.317551,26.165251L13.618034399999999,18.612749100000002Z" fill="currentColor" fill-opacity="0.5" style="mix-blend-mode:passthrough"/></g></svg>`,
        forward15: `<svg width="2.2vh" height="2.2vh" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12C2 17.523 6.477 22 12 22C17.523 22 22 17.523 22 12H20C20 16.418 16.418 20 12 20C7.582 20 4 16.418 4 12C4 7.582 7.582 4 12 4C14.464 4 16.668 5.114 18.135 6.865L16.5 8.5H12V12.75H14.875C15.22 12.75 15.5 13.03 15.5 13.375C15.5 13.72 15.22 14 14.875 14H12V15.5H14.875C16.049 15.5 17 14.549 17 13.375C17 12.201 16.049 11.25 14.875 11.25H13.5V10H16.75V9H22V3L19.553 5.446C17.72 3.335 15.016 2 12 2ZM8.5 8.5H10V15.5H8.5V8.5Z" fill-opacity="0.7"/></svg>`,
        backward15: `<svg width="2.2vh" height="2.2vh" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C17.523 2 22 6.477 22 12C22 17.523 17.523 22 12 22C6.477 22 2 17.523 2 12H4C4 16.418 7.582 20 12 20C16.418 20 20 16.418 20 12C20 7.582 16.418 4 12 4C9.536 4 7.332 5.114 5.865 6.865L7.5 8.5H12V12.75H9.125C8.78 12.75 8.5 13.03 8.5 13.375C8.5 13.72 8.78 14 9.125 14H12V15.5H9.125C7.951 15.5 7 14.549 7 13.375C7 12.201 7.951 11.25 9.125 11.25H10.5V10H7.25V9H2V3L4.447 5.446C6.28 3.335 8.984 2 12 2ZM15.5 8.5H14V15.5H15.5V8.5Z" fill-opacity="0.7"/></svg>`,
        listLoop: `<svg width="2.2vh" height="2.2vh" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>`,
        singleLoop: `<svg width="2.2vh" height="2.2vh" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><text x="12" y="14" text-anchor="middle" font-size="8" fill="currentColor" stroke="none">1</text></svg>`,
        random: `<svg width="2.2vh" height="2.2vh" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5"/><path d="M21 3l-7 7"/><path d="M8 21H3v-5"/><path d="M3 21l7-7"/><path d="M16 21h5v-5"/><path d="M21 21l-7-7"/></svg>`,
        speed: `<svg width="2.2vh" height="2.2vh" viewBox="0 0 24 24" fill="currentColor"><path d="M20 13C20 15.209 19.105 17.209 17.657 18.657L19.071 20.071C20.881 18.261 22 15.761 22 13C22 7.477 17.523 3 12 3C6.477 3 2 7.477 2 13C2 15.761 3.119 18.261 4.929 20.071L6.343 18.657C4.895 17.209 4 15.209 4 13C4 8.582 7.582 5 12 5C16.418 5 20 8.582 20 13ZM15.293 8.293L10.5 12.5L12.5 14.5L16.707 9.707L15.293 8.293Z" fill-opacity="0.7"/></svg>`,
        volume: (vol) => {
            if (vol === 0) return `<svg width="2.2vh" height="2.2vh" viewBox="0 0 24 24" fill="currentColor"><path d="M11 5L6 9H2V15H6L11 19V5Z" fill-opacity="0.7"/><line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="2"/><line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="2"/></svg>`;
            if (vol < 30) return `<svg width="2.2vh" height="2.2vh" viewBox="0 0 24 24" fill="currentColor"><path d="M11 5L6 9H2V15H6L11 19V5Z" fill-opacity="0.7"/><path d="M14 9.5C15.5 10.5 15.5 13.5 14 14.5" stroke="currentColor" stroke-width="2" fill="none"/></svg>`;
            if (vol < 70) return `<svg width="2.2vh" height="2.2vh" viewBox="0 0 24 24" fill="currentColor"><path d="M11 5L6 9H2V15H6L11 19V5Z" fill-opacity="0.7"/><path d="M14 8C16.5 9.5 16.5 14.5 14 16" stroke="currentColor" stroke-width="2" fill="none"/></svg>`;
            return `<svg width="2.2vh" height="2.2vh" viewBox="0 0 24 24" fill="currentColor"><path d="M11 5L6 9H2V15H6L11 19V5Z" fill-opacity="0.7"/><path d="M14 7C18 9 18 15 14 17" stroke="currentColor" stroke-width="2" fill="none"/><path d="M17 5C22 8 22 16 17 19" stroke="currentColor" stroke-width="2" fill="none"/></svg>`;
        },
        playlist: `<svg width="2.2vh" height="2.2vh" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>`,
        quality: `<svg width="2.2vh" height="2.2vh" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
        dislike: `<svg width="2.2vh" height="2.2vh" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
        add: `<svg width="2.2vh" height="2.2vh" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,
        heart: `<svg width="2.2vh" height="2.2vh" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`,
        heartOutline: `<svg viewBox="0 0 24 24" fill="var(--apple-red)" stroke="var(--apple-red)" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`,
        download: `<svg width="2.2vh" height="2.2vh" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
        share: `<svg width="2.2vh" height="2.2vh" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 22 3 22 9"/><line x1="10" y1="14" x2="22" y2="3"/></svg>`
    };
})();

const styleEsc = (value) => {
    if (window.app && typeof window.app.escapeHtml === 'function') return window.app.escapeHtml(value);
    return String(value ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
};
const styleUrl = (value) => {
    const url = String(value ?? '').trim();
    return /^https?:\/\//i.test(url) ? url : '';
};

const StyleCore = {
    // 已注册的样式
    styles: {},
    
    // 当前激活的样式
    currentStyle: null,
    
    // 自定义样式列表（用户添加的）
    customStyles: [],
    
    // 外部资源缓存
    fileCache: {},
    
    builtInStyles: [
        { id: 'default', path: 'default' },
    ],

    showToast(message) {
        if (window.app && window.app.showToast) {
            window.app.showToast(message);
        } else {
            const container = document.getElementById('toast-container');
            if (container) {
                const toast = document.createElement('div');
                toast.className = 'toast-item';
                toast.innerText = message;
                container.appendChild(toast);
                setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3000);
            } else {
                console.log('[StyleCore Toast]', message);
            }
        }
    },
    
    /**
     * 注册样式
     * @param {Object} style - 样式对象
     */
    register(style) {
        if (!style.STYLE_INFO || !style.STYLE_INFO.ID) {
            console.error('[StyleCore] 样式注册失败: 缺少 STYLE_INFO.ID');
            return false;
        }
        
        const id = style.STYLE_INFO.ID;
        
        // 验证必需方法
        if (typeof style.renderPage !== 'function') {
            console.error(`[StyleCore] 样式 ${id} 缺少必需方法: renderPage`);
            return false;
        }
        
        this.styles[id] = style;
        this._lastRegisteredStyle = style;
        console.log(`[StyleCore] 样式已注册: ${style.STYLE_INFO.NAME} (${id})`);
        return true;
    },
    
    /**
     * 初始化样式系统
     * 自动发现并加载内置样式
     */
    async init() {
        console.log('[StyleCore] 初始化样式系统...');
        
        // 恢复自定义样式
        this.restoreCustomStyles();
        
        // 自动发现并注册内置样式
        await this.discoverBuiltInStyles();
        
        // 加载当前选中的样式
        const savedStyleId = localStorage.getItem('AerMusic_CurrentStyle') || localStorage.getItem('AerMusic_PlayStyle') || 'default';
        await this.load(savedStyleId);
        
        console.log('[StyleCore] 样式系统初始化完成');
    },
    
    /**
     * 自动发现内置样式
     * 扫描 playstyle 目录下的样式并注册
     */
    async discoverBuiltInStyles() {
        const discoveredStyles = [];
        
        // 尝试加载内置样式目录
        for (const styleInfo of this.builtInStyles) {
            try {
                // 动态加载 theme.js
                const themeUrl = window.staticRef(`assets/app/playstyle/${styleInfo.path}/theme.js`);
                
                // 检查文件是否存在
                const checkRes = await fetch(themeUrl, { method: 'HEAD' });
                if (!checkRes.ok) continue;
                
                // 先清除旧的 AerTheme
                window.AerTheme = null;
                
                // 加载 JS
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = `${themeUrl}`;
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
                
                // 注册到 StyleCore
                if (window.AerTheme && window.AerTheme.STYLE_INFO) {
                    // 使用路径作为 ID，或者使用 STYLE_INFO.ID
                    const styleId = styleInfo.id;
                    window.AerTheme.STYLE_INFO.ID = styleId;
                    this.register(window.AerTheme);
                    discoveredStyles.push(styleId);
                }
            } catch (e) {
                console.warn(`[StyleCore] 加载内置样式 ${styleInfo.path} 失败:`, e);
            }
        }
        
        console.log(`[StyleCore] 发现 ${discoveredStyles.length} 个内置样式:`, discoveredStyles);
        return discoveredStyles;
    },
    
    /**
     * 加载样式（内置或自定义）
     * @param {string} styleId - 样式ID
     * @param {Object} options - 加载选项
     */
    async load(styleId, options = {}) {
        console.log('[StyleCore] 加载样式:', styleId);
        
        // 检查是否为自定义样式
        const customStyle = this.customStyles.find(s => s.id === styleId);
        
        if (customStyle) {
            return await this.loadCustomStyle(customStyle);
        }
        
        // 内置样式
        const style = this.styles[styleId];
        if (!style) {
            // 尝试从文件加载（使用路径）
            const styleInfo = this.builtInStyles.find(s => s.id === styleId);
            if (styleInfo) {
                return await this.loadFromFile(styleInfo.path);
            }
            return await this.loadFromFile(styleId);
        }
        
        this.currentStyle = style;
        
        // 加载对应的 CSS
        const styleInfo = this.builtInStyles.find(s => s.id === styleId);
        if (styleInfo) {
            const link = document.getElementById('playstyle-link');
            if (link) {
                link.href = window.staticRef(`assets/app/playstyle/${styleInfo.path}/style.css`);
            }
        }
        
        // 加载外部资源
        if (style.STYLE_INFO.FILE) {
            await this.loadExternalFiles(style.STYLE_INFO.FILE);
        }
        
        // 通知样式已加载
        if (style.onLoad) {
            style.onLoad();
        }
        
        console.log('[StyleCore] 样式加载完成:', style.STYLE_INFO.NAME);
        return true;
    },
    
    /**
     * 从文件加载样式
     * @param {string} styleId - 样式ID（路径）
     */
    async loadFromFile(styleId) {
        try {
            // 加载 JS
            const script = document.createElement('script');
            script.src = window.staticRef(`assets/app/playstyle/${styleId}/theme.js`);
            
            await new Promise((resolve, reject) => {
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
            
            // 加载 CSS（如果有）
            const link = document.getElementById('playstyle-link');
            if (link) {
                link.href = window.staticRef(`assets/app/playstyle/${styleId}/style.css`);
            }
            
            return true;
        } catch (e) {
            console.error(`[StyleCore] 加载样式失败: ${styleId}`, e);
            return false;
        }
    },
    
    /**
     * 加载自定义样式
     * @param {Object} customStyle - 自定义样式配置
     */
    async loadCustomStyle(customStyle) {
        try {
            const { id, jsSource, cssSource, cssInJs } = customStyle;
            
            // 加载 JS: 只允许 https 与站内相对路径, 拒绝 javascript:/data:/http: 等
            if (jsSource.type === 'url' && jsSource.value) {
                let target = String(jsSource.value).trim();
                let safe = false;
                try {
                    const u = new URL(target, window.location.origin);
                    safe = (u.protocol === 'https:' && u.origin !== window.location.origin) ||
                           (u.origin === window.location.origin && u.pathname.startsWith('/'));
                } catch (e) { safe = false; }
                if (!safe) {
                    console.error('[StyleCore] 拒绝加载不安全的脚本来源:', target);
                    return false;
                }
                const script = document.createElement('script');
                script.src = target;
                await new Promise((resolve, reject) => {
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
            } else if (jsSource.type === 'inline' && jsSource.value) {
                // 注意: blob: 脚本继承页面 origin, 权限与远程加载等同, 同样是执行任意代码
                const blob = new Blob([jsSource.value], { type: 'application/javascript' });
                const url = URL.createObjectURL(blob);
                const script = document.createElement('script');
                script.src = url;
                await new Promise((resolve, reject) => {
                    script.onload = () => { URL.revokeObjectURL(url); resolve(); };
                    script.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
                    document.head.appendChild(script);
                });
            }
            
            // 加载 CSS 前先清除旧的 playstyle-link
            const link = document.getElementById('playstyle-link');
            if (link) link.removeAttribute('href');
            if (!cssInJs && cssSource && cssSource.value) {
                if (cssSource.type === 'url') {
                    let cssTarget = String(cssSource.value).trim();
                    let cssSafe = false;
                    try {
                        const cu = new URL(cssTarget, window.location.origin);
                        cssSafe = cu.protocol === 'https:' || (cu.origin === window.location.origin && cu.pathname.startsWith('/'));
                    } catch (e) { cssSafe = false; }
                    if (cssSafe && link) link.href = cssTarget;
                } else if (cssSource.type === 'inline') {
                    this.injectCSS(cssSource.value);
                }
            }
            
            // 获取注册的样式: 取本次脚本新注册的那个, 而不是最后一个
            const style = this._lastRegisteredStyle || this.styles[Object.keys(this.styles).pop()];
            if (style) {
                this.currentStyle = style;
                if (style.onLoad) style.onLoad();
            }
            
            return true;
        } catch (e) {
            console.error('[StyleCore] 加载自定义样式失败:', e);
            return false;
        }
    },
    
    /**
     * 加载外部资源文件
     * @param {Object} files - 文件映射 { "file1": "url1", ... }
     */
    async loadExternalFiles(files) {
        const promises = Object.entries(files).map(async ([key, url]) => {
            try {
                const res = await fetch(url);
                const content = await res.text();
                this.fileCache[key] = content;
            } catch (e) {
                console.error(`[StyleCore] 加载外部资源失败: ${key}`, e);
            }
        });
        
        await Promise.all(promises);
    },
    
    /**
     * 获取外部资源
     * @param {string} key - 资源键名
     */
    getFile(key) {
        return this.fileCache[key] || null;
    },
    
    /**
     * 读取本地文件
     */
    readLocalFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsText(file);
        });
    },
    
    /**
     * 注入CSS到页面
     */
    injectCSS(cssContent) {
        const style = document.createElement('style');
        style.textContent = cssContent;
        document.head.appendChild(style);
    },
    
    /**
     * 渲染播放页面
     * @param {Object} song - 歌曲数据
     * @param {number} index - 歌曲索引
     * @param {HTMLElement} container - 容器元素
     */
    renderPage(song, index, container) {
        if (!this.currentStyle) {
            console.error('[StyleCore] 未加载样式');
            return;
        }
        
        // 调用样式的渲染方法
        const pageHtml = this.currentStyle.renderPage(song, index);
        
        if (typeof pageHtml === 'string') {
            container.innerHTML = pageHtml;
        } else if (pageHtml instanceof HTMLElement) {
            container.appendChild(pageHtml);
        }
        
        // 样式渲染完成回调
        if (this.currentStyle.onRendered) {
            this.currentStyle.onRendered(song, index, container);
        }
    },
    
    /**
     * 更新播放进度
     */
    updateProgress(currentTime, duration, index) {
        if (this.currentStyle?.updateProgress) {
            this.currentStyle.updateProgress(currentTime, duration, index);
        }
    },
    
    /**
     * 更新播放状态
     */
    updateStatus(isPlaying, loopMode, index) {
        if (this.currentStyle?.updateStatus) {
            this.currentStyle.updateStatus(isPlaying, loopMode, index);
        }
    },
    
    /**
     * 获取样式列表（内置 + 自定义）
     */
    getStyleList() {
        const builtIn = Object.values(this.styles).map(s => ({
            id: s.STYLE_INFO.ID,
            name: s.STYLE_INFO.NAME,
            description: s.STYLE_INFO.DC || '',
            bg: s.STYLE_INFO.BG || '',
            author: s.STYLE_INFO.AUTHOR || '',
            authorUrl: s.STYLE_INFO.AUTHOR_URL || '',
            custom: false
        }));
        
        const custom = this.customStyles.map(s => ({
            id: s.id,
            name: s.name,
            description: s.description || '',
            bg: s.bg || '',
            author: s.author || '',
            authorUrl: s.authorUrl || '',
            custom: true
        }));
        
        return [...builtIn, ...custom];
    },
    
    /**
     * 添加自定义样式
     */
    addCustomStyle(config) {
        const style = {
            id: config.id || `custom_${Date.now()}`,
            name: config.name || '自定义样式',
            description: config.description || '',
            bg: config.bg || '',
            author: config.author || '',
            authorUrl: config.authorUrl || '',
            jsSource: config.jsSource,
            cssSource: config.cssSource,
            cssInJs: config.cssInJs || false,
            createdAt: Date.now()
        };
        
        this.customStyles.push(style);
        this.saveCustomStyles();
        
        return style;
    },
    
    /**
     * 删除自定义样式
     */
    removeCustomStyle(styleId) {
        const idx = this.customStyles.findIndex(s => s.id === styleId);
        if (idx > -1) {
            this.customStyles.splice(idx, 1);
            this.saveCustomStyles();
        }
    },
    
    /**
     * 保存自定义样式到 localStorage
     */
    saveCustomStyles() {
        try {
            localStorage.setItem('AerMusic_CustomStyles', JSON.stringify(this.customStyles));
        } catch (e) {
            console.error('[StyleCore] 保存自定义样式失败(空间不足?):', e);
            if (window.app && window.app.showToast) window.app.showToast('本地空间不足, 样式保存失败');
        }
    },
    
    /**
     * 恢复自定义样式
     */
    restoreCustomStyles() {
        const saved = localStorage.getItem('AerMusic_CustomStyles');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                this.customStyles = Array.isArray(parsed) ? parsed : [];
            } catch (e) {
                console.warn('[StyleCore] 自定义样式数据损坏, 已重置');
                localStorage.removeItem('AerMusic_CustomStyles');
                this.customStyles = [];
            }
        }
    },
    
    /**
     * 生成歌词 HTML
     * @param {Object} lyricData - 歌词数据
     * @param {Object} options - 渲染选项
     */
    renderLyric(lyricData, options = {}) {
        if (!this.currentStyle?.renderLyric) {
            // 使用默认歌词渲染
            return this.defaultLyricRender(lyricData, options);
        }
        
        return this.currentStyle.renderLyric(lyricData, options);
    },
    
    /**
     * 默认歌词渲染
     */
    defaultLyricRender(lyricData, options) {
        const { lrc, tlyric, yrc, tList } = lyricData;
        const transClass = options.showTranslation ? 'show-trans' : '';
        const metaVal = (window.app && window.app.config && window.app.config.showMeta !== false) ? 'true' : 'false';
        const contribVal = (window.app && window.app.config && window.app.config.showContributors === true) ? 'true' : 'false';
        let lyricHtml = '';
        if (yrc) {
            const arc = JSON.parse(lyrictolyric({ content: yrc, lyricinput: 'packyrc', lyricoutput: 'arc' }));
            lyricHtml = safeTemplateReplace(safeTemplateReplace(safeTemplateReplace(safeTemplateReplace(safeTemplateReplace(KRC_TEMPLATE, '{{KRC_JSON}}', escapeScriptJson(JSON.stringify(arc))), '{{TLYRIC_JSON}}', escapeScriptJson(JSON.stringify(tList || []))), '{{TRANS_CLASS}}', transClass), '{{SHOW_META}}', metaVal), '{{SHOW_CONTRIBUTORS}}', contribVal);
        } else {
            const content = lrc || '[00:00.000] 暂无歌词';
            const arc = JSON.parse(lyrictolyric({ content, lyricinput: 'packlrc', lyricoutput: 'arc' }));
            lyricHtml = safeTemplateReplace(safeTemplateReplace(safeTemplateReplace(safeTemplateReplace(safeTemplateReplace(LRC_TEMPLATE, '{{LYRIC_CONTENT}}', escapeScriptEmbed(arc.lyric)), '{{TLYRIC_JSON}}', escapeScriptJson(JSON.stringify(tList || []))), '{{TRANS_CLASS}}', transClass), '{{SHOW_META}}', metaVal), '{{SHOW_CONTRIBUTORS}}', contribVal);
        }
        return lyricHtml;
    },
};

// 全局访问外部资源的辅助对象
window.asfile = {
    get: (key) => StyleCore.getFile(key)
};

// 设置渲染辅助函数
StyleCore.renderStyleList = function() {
    const grid = document.getElementById('style-grid');
    if (!grid) {
        console.warn('[StyleCore] style-grid 容器不存在');
        return;
    }
    
    const currentId = localStorage.getItem('AerMusic_CurrentStyle') || 'default';
    const styles = this.getStyleList();
    
    console.log('[StyleCore] 渲染样式列表，当前样式:', currentId, '可用样式:', styles.length);
    
    // 如果没有注册的样式，显示默认提示
    if (styles.length === 0) {
        grid.innerHTML = `
            <div style="color:rgba(255,255,255,0.5);font-size:1.4vh;padding:2vh;text-align:center;">
                正在加载样式...
            </div>
        `;
        // 延迟重新渲染(限时, 样式系统加载失败就停在提示, 不无限轮询)
        this._renderRetryCount = (this._renderRetryCount || 0) + 1;
        if (this._renderRetryCount <= 20) setTimeout(() => this.renderStyleList(), 500);
        return;
    }
    
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
        
        // 获取样式的图标/首字母
        const iconContent = style.icon || style.name.charAt(0);
        const iconColor = style.color || style.bg || '#24c8fa';
        
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
        card.addEventListener('click', () => this.selectStyle(card.dataset.styleId));
    });
    grid.querySelectorAll('[data-author-url]').forEach(el => {
        el.addEventListener('click', e => {
            e.stopPropagation();
            window.open(el.dataset.authorUrl, '_blank', 'noopener,noreferrer');
        });
    });
    const customCard = grid.querySelector('[data-style-action="custom"]');
    if (customCard) customCard.addEventListener('click', () => window.app?.showCustomStyleForm?.());
    console.log('[StyleCore] 样式列表渲染完成');
};

StyleCore.renderPlatformList = function() {
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
};

// 更新样式选中状态
StyleCore.updateActiveStyle = function(styleId) {
    localStorage.setItem('AerMusic_CurrentStyle', styleId);
    
    // 更新 UI
    document.querySelectorAll('[data-style-id]').forEach(card => {
        card.classList.remove('active');
        if (card.dataset.styleId === styleId) {
            card.classList.add('active');
        }
    });
};

// 选择并切换样式
StyleCore.selectStyle = async function(styleId) {
    console.log('[StyleCore] 切换到样式:', styleId);
    this.updateActiveStyle(styleId);
    localStorage.setItem('AerMusic_PlayStyle', styleId);
    window.location.href = window.location.origin + window.location.pathname + window.location.search;
};

// 渲染已保存的自定义样式列表
StyleCore.renderSavedStyles = function() {
    const container = document.getElementById('saved-styles-list');
    if (!container) return;
    
    if (this.customStyles.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    container.innerHTML = this.customStyles.map(style => `
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
            this.removeCustomStyle(id);
            this.renderSavedStyles();
            this.renderStyleList();
        });
    });
};

// 初始化设置渲染（在 app 加载完成后调用）
StyleCore.initSettings = async function() {
    console.log('[StyleCore] initSettings 调用');
    
    // 先初始化样式系统（发现并注册内置样式）
    await this.init();
    
    // 渲染各个设置面板
    this.renderStyleList();
    this.renderPlatformList();
    this.renderSavedStyles();
    
    // 恢复 GPU 加速设置
    const gpuEnabled = localStorage.getItem('AerMusic_GPUAccel') !== 'false';
    const gpuSwitch = document.getElementById('set-gpu-accel');
    if (gpuSwitch) {
        gpuSwitch.checked = gpuEnabled;
    }
    
    // 恢复翻译歌词颜色
    const transLyricColor = localStorage.getItem('AerMusic_TransLyricColor') || '#aaaaaa';
    const transPicker = document.getElementById('set-trans-lyric-color-picker');
    const transHex = document.getElementById('set-trans-lyric-color-hex');
    if (transPicker) transPicker.value = transLyricColor;
    if (transHex) transHex.value = transLyricColor;
};

// 导出到全局
window.StyleCore = StyleCore;
