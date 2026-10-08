(function() {
        function waitForApp(callback) {
            if (window.app) {
                callback();
            } else {
                setTimeout(function() { waitForApp(callback); }, 100);
            }
        }
        waitForApp(function() {
            var app = window.app;
            app.showCustomStyleForm = function() {
                var formContent = `
                    <div style="display:flex;flex-direction:column;gap:12px;">
                        <div>
                            <span style="font-size:11px;color:rgba(255,255,255,0.4);font-weight:bold;">样式名称</span>
                            <input type="text" id="modal-style-name" class="meta-input" style="width:100%;margin-top:4px;font-size:13px;" placeholder="我的自定义样式">
                        </div>
                        <div>
                            <span style="font-size:11px;color:rgba(255,255,255,0.4);font-weight:bold;">样式描述</span>
                            <input type="text" id="modal-style-desc" class="meta-input" style="width:100%;margin-top:4px;font-size:13px;" placeholder="描述你的样式特点">
                        </div>
                        <div>
                            <span style="font-size:11px;color:rgba(255,255,255,0.4);font-weight:bold;">JavaScript 来源</span>
                            <div style="display:flex;gap:8px;margin-top:6px;">
                                <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;color:rgba(255,255,255,0.7);">
                                    <input type="radio" name="modal-js-type" value="url" checked style="accent-color:var(--apple-red);"> URL
                                </label>
                                <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;color:rgba(255,255,255,0.7);">
                                    <input type="radio" name="modal-js-type" value="local" style="accent-color:var(--apple-red);"> 本地文件
                                </label>
                            </div>
                            <input type="text" id="modal-js-url" class="meta-input" style="width:100%;margin-top:6px;font-size:12px;" placeholder="https://example.com/theme.js">
                            <div id="modal-js-file-wrap" style="display:none;margin-top:6px;">
                                <input type="file" id="modal-js-file" accept=".js" style="font-size:12px;">
                            </div>
                        </div>
                        <div>
                            <span style="font-size:11px;color:rgba(255,255,255,0.4);font-weight:bold;">CSS 来源</span>
                            <div style="display:flex;gap:8px;margin-top:6px;">
                                <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;color:rgba(255,255,255,0.7);">
                                    <input type="radio" name="modal-css-type" value="none" checked style="accent-color:var(--apple-red);"> 不加载
                                </label>
                                <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;color:rgba(255,255,255,0.7);">
                                    <input type="radio" name="modal-css-type" value="url" style="accent-color:var(--apple-red);"> URL
                                </label>
                                <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;color:rgba(255,255,255,0.7);">
                                    <input type="radio" name="modal-css-type" value="local" style="accent-color:var(--apple-red);"> 本地文件
                                </label>
                                <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;color:rgba(255,255,255,0.7);">
                                    <input type="radio" name="modal-css-type" value="injs" style="accent-color:var(--apple-red);"> 在JS中加载
                                </label>
                            </div>
                            <input type="text" id="modal-css-url" class="meta-input" style="width:100%;margin-top:6px;font-size:12px;display:none;" placeholder="https://example.com/style.css">
                            <div id="modal-css-file-wrap" style="display:none;margin-top:6px;">
                                <input type="file" id="modal-css-file" accept=".css" style="font-size:12px;">
                            </div>
                        </div>
                    </div>
                `;
                
                app.showAppleModal('添加自定义样式', formContent, async function(modal) {
                    var name = modal.querySelector('#modal-style-name')?.value || '自定义样式';
                    var desc = modal.querySelector('#modal-style-desc')?.value || '';
                    var jsType = modal.querySelector('input[name="modal-js-type"]:checked')?.value || 'url';
                    var cssType = modal.querySelector('input[name="modal-css-type"]:checked')?.value || 'none';
                    var jsUrl = modal.querySelector('#modal-js-url')?.value || '';
                    var cssUrl = modal.querySelector('#modal-css-url')?.value || '';
                    var jsFile = modal.querySelector('#modal-js-file')?.files[0];
                    var cssFile = modal.querySelector('#modal-css-file')?.files[0];
                    
                    if (!jsUrl && !jsFile) { app.showToast('请提供JavaScript来源'); return false; }
                    
                    var jsValue = jsUrl;
                    var finalJsType = jsType;
                    if (jsType === 'local' && jsFile) {
                        finalJsType = 'inline';
                        jsValue = await new Promise(function(r) { var reader = new FileReader(); reader.onload = function(e) { r(e.target.result); }; reader.readAsText(jsFile); });
                    }
                    var cssValue = cssUrl;
                    var finalCssType = cssType;
                    if (cssType === 'local' && cssFile) {
                        finalCssType = 'inline';
                        cssValue = await new Promise(function(r) { var reader = new FileReader(); reader.onload = function(e) { r(e.target.result); }; reader.readAsText(cssFile); });
                    }
                    
                    var config = {
                        name: name, description: desc,
                        jsSource: { type: finalJsType, value: jsValue },
                        cssSource: (finalCssType !== 'none' && finalCssType !== 'injs') ? { type: finalCssType, value: cssValue } : null,
                        cssInJs: finalCssType === 'injs'
                    };
                    if (window.StyleCore) {
                        window.StyleCore.addCustomStyle(config);
                        if (window.AerSettingsUI) {
                            window.AerSettingsUI.renderSavedStyles();
                            window.AerSettingsUI.renderStyleList();
                        }
                        app.showToast('样式已保存');
                    }
                }, null, { confirmText: '保存样式', maxWidth: '450px' });
                
                // 绑定JS类型切换
                setTimeout(function() {
                    var modal = document.getElementById('apple-music-modal');
                    if (!modal) return;
                    modal.querySelectorAll('input[name="modal-js-type"]').forEach(function(radio) {
                        radio.onchange = function() {
                            modal.querySelector('#modal-js-url').style.display = this.value === 'url' ? 'block' : 'none';
                            modal.querySelector('#modal-js-file-wrap').style.display = this.value === 'local' ? 'block' : 'none';
                        };
                    });
                    modal.querySelectorAll('input[name="modal-css-type"]').forEach(function(radio) {
                        radio.onchange = function() {
                            modal.querySelector('#modal-css-url').style.display = this.value === 'url' ? 'block' : 'none';
                            modal.querySelector('#modal-css-file-wrap').style.display = this.value === 'local' ? 'block' : 'none';
                        };
                    });
                }, 100);
            };
            app.hideCustomStyleForm = function() {
                // 已移至Apple Music弹窗，此函数保留兼容
            };
            var originalUpdateSetting = app.updateSetting;
            app.updateSetting = function(key, value) {
                if (originalUpdateSetting) {
                    originalUpdateSetting.call(app, key, value);
                }
                if (key === 'gpuAccel') {
                    localStorage.setItem('AerMusic_GPUAccel', value);
                    if (value) {
                        document.body.classList.add('gpu-accelerated');
                    } else {
                        document.body.classList.remove('gpu-accelerated');
                    }
                    app.showToast(value ? 'GPU 加速已启用' : 'GPU 加速已关闭');
                }
                
                if (key === 'transLyricColor') {
                    localStorage.setItem('AerMusic_TransLyricColor', value);
                    var picker = document.getElementById('set-trans-lyric-color-picker');
                    var hex = document.getElementById('set-trans-lyric-color-hex');
                    if (picker) picker.value = value;
                    if (hex) hex.value = value;
                    app.broadcastToLyrics && app.broadcastToLyrics({ type: 'updateTransColor', color: value });
                }
            };
            
            var originalSwitchStyle = app.switchStyle;
            app.switchStyle = function(styleId) {
                if (originalSwitchStyle) {
                    originalSwitchStyle.call(app, styleId);
                }
                if (window.StyleCore) {
                    window.StyleCore.updateActiveStyle(styleId);
                }
            };
            app.showToast = function(message) {
                var container = document.getElementById('toast-container');
                if (!container) return;
                var toast = document.createElement('div');
                toast.className = 'toast-message';
                toast.textContent = message;
                container.appendChild(toast);
                setTimeout(function() {
                    toast.classList.add('fade-out');
                    setTimeout(function() { toast.remove(); }, 300);
                }, 2000);
            };
            var gpuEnabled = localStorage.getItem('AerMusic_GPUAccel');
            if (gpuEnabled === null) {
                localStorage.setItem('AerMusic_GPUAccel', 'true');
                gpuEnabled = 'true';
            }
            if (gpuEnabled === 'true') {
                document.body.classList.add('gpu-accelerated');
            }
            var gpuSwitch = document.getElementById('set-gpu-accel');
            if (gpuSwitch) gpuSwitch.checked = gpuEnabled === 'true';
        });
    })();
