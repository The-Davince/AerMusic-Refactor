/**
 * AerMusic 背景颜色流动效果
 * 类 Apple Music 的动态渐变流动背景
 */
(function() {
    const ColorFlow = {
        canvas: null,
        ctx: null,
        colors: ['#1a1a2e', '#16213e', '#0f3460'],
        targetColors: ['#1a1a2e', '#16213e', '#0f3460'],
        animFrame: null,
        speed: 0.003,
        time: 0,
        enabled: false,

        init() {
            if (this.canvas) return;
            this.canvas = document.createElement('canvas');
            this.canvas.id = 'color-flow-canvas';
            this.canvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:-2;pointer-events:none;opacity:0;transition:opacity 1.5s ease;';
            document.body.prepend(this.canvas);
            this.ctx = this.canvas.getContext('2d');
            this.resize();
            window.addEventListener('resize', () => this.resize());
        },

        resize() {
            if (!this.canvas) return;
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
        },

        setColors(mainColor) {
            if (!mainColor || typeof mainColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(mainColor.trim())) return;
            try {
                const c = mainColor.trim();
                const r = parseInt(c.slice(1, 3), 16);
                const g = parseInt(c.slice(3, 5), 16);
                const b = parseInt(c.slice(5, 7), 16);
                this.targetColors = [
                    `rgb(${r},${g},${b})`,
                    `rgb(${Math.max(0, r - 40)},${Math.max(0, g - 40)},${Math.max(0, b - 40)})`,
                    `rgb(${Math.max(0, r - 80)},${Math.max(0, g - 80)},${Math.max(0, b - 80)})`
                ];
            } catch (e) {}
        },

        enable() {
            if (this.enabled) return;
            this.enabled = true;
            this.init();
            this.canvas.style.opacity = '0.6';
            this.animate();
        },

        disable() {
            this.enabled = false;
            if (this.canvas) this.canvas.style.opacity = '0';
            if (this.animFrame) cancelAnimationFrame(this.animFrame);
        },

        animate() {
            if (!this.enabled || !this.ctx) return;
            this.time += this.speed;
            const w = this.canvas.width;
            const h = this.canvas.height;
            const ctx = this.ctx;

            ctx.clearRect(0, 0, w, h);

            for (let i = 0; i < this.targetColors.length; i++) {
                const t = this.time + i * 2;
                const x = w * 0.5 + Math.sin(t * 0.7) * w * 0.3;
                const y = h * 0.5 + Math.cos(t * 0.5) * h * 0.3;
                const radius = Math.max(w, h) * 0.6;

                const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
                grad.addColorStop(0, this.targetColors[i]);
                grad.addColorStop(1, 'transparent');

                ctx.globalAlpha = 0.4;
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, w, h);
            }

            this.animFrame = requestAnimationFrame(() => {
                try { this.animate(); } catch (e) { this.animFrame = requestAnimationFrame(() => this.animate()); }
            });
        }
    };

    window.ColorFlow = ColorFlow;
})();
