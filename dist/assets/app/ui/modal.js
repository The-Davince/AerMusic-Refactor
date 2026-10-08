/**
 * 弹窗系统 (从默认主题上移到 core)
 * app.showAppleModal / app.closeAppleModal
 */
(function() {
    function apply() {
        const app = window.app;
        if (!app || app.showAppleModal) return true;

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
                z-index: 200003; opacity: 0; transition: opacity 0.3s cubic-bezier(0.25, 1, 0.5, 1);
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
