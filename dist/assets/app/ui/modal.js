



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
            modal.className = 'aer-modal-overlay';
            modal.style.cssText = `opacity: 0; transition: opacity 0.3s cubic-bezier(0.25, 1, 0.5, 1);`;
            modal.innerHTML = `
                <div class="aer-modal-card" id="apple-modal-panel" style="width: ${width}; max-width: ${maxWidth};">
                    <div class="aer-modal-title" style="font-size: 18px;">${title}</div>
                    <div class="aer-modal-text" id="apple-modal-body" style="font-size: 14px; text-align: left;">${contentHtml}</div>
                    ${hideFooter ? '' : `
                    <div class="aer-modal-actions" style="margin-top: 10px;">
                        <button id="apple-modal-cancel" class="aer-modal-btn ghost" style="font-size: 14px;">${cancelText}</button>
                        <button id="apple-modal-confirm" class="aer-modal-btn accent" style="font-size: 14px;">${confirmText}</button>
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
