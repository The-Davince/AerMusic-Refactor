(function (global) {
  "use strict";

  const CONFIG = {
    flowSpeed: 0.5,
    maxFPS: 60,
    lowFreqVolume: 0.0,
    subDivisions: 50,
  };

  const meshVertSrc = `
      precision highp float;
      attribute vec2 a_pos;
      attribute vec3 a_color;
      attribute vec2 a_uv;
      varying vec3 v_color;
      varying vec2 v_uv;
      uniform float u_aspect;
      void main() {
          v_color = a_color;
          v_uv = a_uv;
          vec2 pos = a_pos;
          if (u_aspect > 1.0) { pos.y *= u_aspect; } else { pos.x /= u_aspect; }
          gl_Position = vec4(pos, 0.0, 1.0);
      }
  `;

  const meshFragSrc = `
      precision highp float;
      varying vec3 v_color;
      varying vec2 v_uv;
      uniform sampler2D u_texture;
      uniform float u_time;
      uniform float u_volume;
      uniform float u_alpha;
      const float INV_255 = 1.0 / 255.0;
      const float HALF_INV_255 = 0.5 / 255.0;
      const float GRADIENT_NOISE_A = 52.9829189;
      const vec2 GRADIENT_NOISE_B = vec2(0.06711056, 0.00583715);
      float gradientNoise(in vec2 uv) {
          return fract(GRADIENT_NOISE_A * fract(dot(uv, GRADIENT_NOISE_B)));
      }
      vec2 rot(vec2 v, float angle) {
          float s = sin(angle);
          float c = cos(angle);
          return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
      }
      void main() {
          float volumeEffect = u_volume * 2.0;
          float timeVolume = u_time + u_volume;
          float dither = INV_255 * gradientNoise(gl_FragCoord.xy) - HALF_INV_255;
          vec2 centeredUV = v_uv - vec2(0.2);
          vec2 rotatedUV = rot(centeredUV, timeVolume * 2.0);
          vec2 finalUV = rotatedUV * max(0.001, 1.0 - volumeEffect) + vec2(0.5);
          vec4 result = texture2D(u_texture, finalUV);
          float alphaVolumeFactor = u_alpha * max(0.5, 1.0 - u_volume * 0.5);
          result.rgb *= v_color * alphaVolumeFactor;
          result.a *= alphaVolumeFactor;
          result.rgb += vec3(dither);
          float dist = distance(v_uv, vec2(0.5));
          float vignette = smoothstep(0.8, 0.3, dist);
          float mask = 0.6 + vignette * 0.4;
          result.rgb *= mask;
          gl_FragColor = result;
      }
  `;

  const BEZIER_B = [
    [-1, 3, -3, 1],
    [3, -6, 3, 0],
    [-3, 3, 0, 0],
    [1, 0, 0, 0],
  ];

  function bezierBasis(t) {
    const t2 = t * t, t3 = t2 * t;
    const vec = [t3, t2, t, 1];
    const out = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        out[i] += BEZIER_B[j][i] * vec[j];
      }
    }
    return out;
  }

  function makeControlPoints() {
    const cps = [];
    const offsets = [
      [0.00, 0.00], [-0.05, 0.08], [0.06, -0.05], [0.00, 0.00],
      [0.07, -0.06], [0.12, 0.10], [-0.08, 0.13], [-0.05, 0.07],
      [-0.06, 0.09], [-0.10, -0.07], [0.11, -0.12], [0.04, -0.08],
      [0.00, 0.00], [0.05, -0.07], [-0.06, 0.04], [0.00, 0.00],
    ];
    for (let j = 0; j < 4; j++) {
      const row = [];
      for (let i = 0; i < 4; i++) {
        const idx = j * 4 + i;
        const baseX = (i / 3) * 1.6 - 0.3;
        const baseY = (j / 3) * 1.6 - 0.3;
        const off = offsets[idx];
        row.push({ x: baseX + off[0], y: baseY + off[1], u: i / 3, v: j / 3 });
      }
      cps.push(row);
    }
    return cps;
  }

  function buildMesh(controlPoints, sub) {
    const gridSize = sub + 1;
    const vertices = new Float32Array(gridSize * gridSize * 7);
    let vi = 0;
    for (let j = 0; j < gridSize; j++) {
      const v = j / sub;
      const bv = bezierBasis(v);
      for (let i = 0; i < gridSize; i++) {
        const u = i / sub;
        const bu = bezierBasis(u);
        let posX = 0, posY = 0, texU = 0, texV = 0;
        for (let jj = 0; jj < 4; jj++) {
          for (let ii = 0; ii < 4; ii++) {
            const cp = controlPoints[jj][ii];
            const w = bu[ii] * bv[jj];
            posX += cp.x * w;
            posY += cp.y * w;
            texU += cp.u * w;
            texV += cp.v * w;
          }
        }
        vertices[vi++] = posX * 2 - 1;
        vertices[vi++] = posY * 2 - 1;
        vertices[vi++] = 1.0;
        vertices[vi++] = 1.0;
        vertices[vi++] = 1.0;
        vertices[vi++] = texU;
        vertices[vi++] = texV;
      }
    }
    const indices = new Uint16Array(sub * sub * 6);
    let ii = 0;
    for (let j = 0; j < sub; j++) {
      for (let i = 0; i < sub; i++) {
        const a = j * gridSize + i;
        const b = j * gridSize + i + 1;
        const c = (j + 1) * gridSize + i;
        const d = (j + 1) * gridSize + i + 1;
        indices[ii++] = a; indices[ii++] = c; indices[ii++] = b;
        indices[ii++] = b; indices[ii++] = c; indices[ii++] = d;
      }
    }
    return { vertices, indices, indexCount: indices.length };
  }

  function boxBlur(imageData, radius, quality) {
    const w = imageData.width, h = imageData.height;
    const data = imageData.data;
    const temp = new Uint8ClampedArray(data.length);
    for (let q = 0; q < quality; q++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let r = 0, g = 0, b = 0, a = 0, count = 0;
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = Math.min(w - 1, Math.max(0, x + dx));
            const idx = (y * w + nx) * 4;
            r += data[idx]; g += data[idx + 1]; b += data[idx + 2]; a += data[idx + 3];
            count++;
          }
          const idx = (y * w + x) * 4;
          temp[idx] = r / count; temp[idx + 1] = g / count; temp[idx + 2] = b / count; temp[idx + 3] = a / count;
        }
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let r = 0, g = 0, b = 0, a = 0, count = 0;
          for (let dy = -radius; dy <= radius; dy++) {
            const ny = Math.min(h - 1, Math.max(0, y + dy));
            const idx = (ny * w + x) * 4;
            r += temp[idx]; g += temp[idx + 1]; b += temp[idx + 2]; a += temp[idx + 3];
            count++;
          }
          const idx = (y * w + x) * 4;
          data[idx] = r / count; data[idx + 1] = g / count; data[idx + 2] = b / count; data[idx + 3] = a / count;
        }
      }
    }
  }

  function processCoverPixels(img) {
    const c = document.createElement("canvas");
    c.width = 32; c.height = 32;
    const cx = c.getContext("2d");
    cx.drawImage(img, 0, 0, 32, 32);
    const imageData = cx.getImageData(0, 0, 32, 32);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i], g = data[i + 1], b = data[i + 2];
      r = (r - 128) * 0.4 + 128; g = (g - 128) * 0.4 + 128; b = (b - 128) * 0.4 + 128;
      const gray = r * 0.3 + g * 0.59 + b * 0.11;
      r = gray * -2.0 + r * 3.0; g = gray * -2.0 + g * 3.0; b = gray * -2.0 + b * 3.0;
      r = (r - 128) * 1.7 + 128; g = (g - 128) * 1.7 + 128; b = (b - 128) * 1.7 + 128;
      r *= 0.75; g *= 0.75; b *= 0.75;
      data[i] = Math.max(0, Math.min(255, r));
      data[i + 1] = Math.max(0, Math.min(255, g));
      data[i + 2] = Math.max(0, Math.min(255, b));
    }
    boxBlur(imageData, 2, 4);
    return new Uint8Array(imageData.data.buffer);
  }

  class FlowBg {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = canvas.getContext("webgl", { antialias: true, premultipliedAlpha: false });
      this.program = null;
      this.loc = null;
      this.vertexBuffer = null;
      this.indexBuffer = null;
      this.indexCount = 0;
      this.texture = null;
      this.textureKey = "";
      this.pixels = null;
      this.fadeFrom = null;
      this.fadeTo = null;
      this.fadeElapsed = 0;
      this.fadeDuration = 700;
      this.alpha = 0;
      this.frameTime = 0;
      this.lastTickTime = 0;
      this.lastFrameTime = 0;
      this.raf = 0;
      this.ready = false;
      this.coverQueue = null;
      this.onCoverError = null;
      if (this.gl) this._initGL();
    }

    _initGL() {
      const gl = this.gl;
      const compile = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error("shader: " + gl.getShaderInfoLog(sh));
        return sh;
      };
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, meshVertSrc));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, meshFragSrc));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("link: " + gl.getProgramInfoLog(p));
      this.program = p;
      this.loc = {
        a_pos: gl.getAttribLocation(p, "a_pos"),
        a_color: gl.getAttribLocation(p, "a_color"),
        a_uv: gl.getAttribLocation(p, "a_uv"),
        u_aspect: gl.getUniformLocation(p, "u_aspect"),
        u_texture: gl.getUniformLocation(p, "u_texture"),
        u_time: gl.getUniformLocation(p, "u_time"),
        u_volume: gl.getUniformLocation(p, "u_volume"),
        u_alpha: gl.getUniformLocation(p, "u_alpha"),
      };
      this._uploadMesh();
      this._resize();
      this.onResize = this._resize.bind(this);
      window.addEventListener("resize", this.onResize);
      this.ready = true;
    }

    _uploadMesh() {
      const gl = this.gl;
      const mesh = buildMesh(makeControlPoints(), CONFIG.subDivisions);
      this.indexCount = mesh.indexCount;
      this.vertexBuffer = gl.createBuffer();
      this.indexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    }

    _resize() {
      const gl = this.gl;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
      this.canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
      this.canvas.style.width = window.innerWidth + "px";
      this.canvas.style.height = window.innerHeight + "px";
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    _drawMesh() {
      const gl = this.gl;
      const L = this.loc;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      const stride = 7 * 4;
      gl.enableVertexAttribArray(L.a_pos);
      gl.vertexAttribPointer(L.a_pos, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(L.a_color);
      gl.vertexAttribPointer(L.a_color, 3, gl.FLOAT, false, stride, 2 * 4);
      gl.enableVertexAttribArray(L.a_uv);
      gl.vertexAttribPointer(L.a_uv, 2, gl.FLOAT, false, stride, 5 * 4);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
    }

    setCover(url) {
      if (!this.ready || !url) return;
      if (url === this.textureKey) return;
      this.textureKey = url;
      const gl = this.gl;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        if (this.textureKey !== url) return;
        const pixels = processCoverPixels(img);
        if (!this.texture) {
          
          this.alpha = 0;
          this.pixels = pixels;
          this.texture = this._createTexture(pixels);
          if (this.onCoverReady) this.onCoverReady(pixels);
          return;
        }
        
        this.fadeFrom = this.pixels ? new Uint8Array(this.pixels) : new Uint8Array(pixels);
        this.fadeTo = pixels;
        this.fadeElapsed = 0;
        if (this.onCoverReady) this.onCoverReady(pixels);
      };
      img.onerror = () => { if (this.onCoverError) this.onCoverError(url); };
      img.src = url;
    }

    _createTexture(pixels) {
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 32, 32, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
      return tex;
    }

    _stepFade(delta) {
      if (!this.fadeTo || !this.texture) return;
      this.fadeElapsed += delta;
      const t = Math.min(1, this.fadeElapsed / this.fadeDuration);
      const k = -(Math.cos(Math.PI * t) - 1) / 2;
      const from = this.fadeFrom;
      const to = this.fadeTo;
      const out = this.pixels && this.pixels.length === to.length ? this.pixels : new Uint8Array(to.length);
      for (let i = 0; i < to.length; i++) out[i] = from[i] + (to[i] - from[i]) * k;
      this.pixels = out;
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 32, 32, 0, gl.RGBA, gl.UNSIGNED_BYTE, out);
      if (t >= 1) { this.fadeTo = null; this.fadeFrom = null; }
    }

    start() {
      if (!this.ready || this.raf) return;
      this.lastTickTime = 0;
      this.lastFrameTime = 0;
      const tick = (now) => {
        this.raf = requestAnimationFrame(tick);
        if (!this.lastTickTime) this.lastTickTime = now;
        const interval = 1000 / CONFIG.maxFPS;
        if (now - this.lastTickTime < interval) return;
        const delta = now - this.lastFrameTime || 16;
        this.lastFrameTime = now;
        this.lastTickTime = now;
        this.frameTime += delta * CONFIG.flowSpeed;
        this._redraw(this.frameTime, delta);
      };
      this.raf = requestAnimationFrame(tick);
    }

    stop() {
      if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    }

    _redraw(tickTime, delta) {
      const gl = this.gl;
      if (this.texture) this.alpha = Math.min(1, this.alpha + delta / 500);
      this._stepFade(delta);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!this.texture || !this.vertexBuffer) return;
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.program);
      const aspect = this.canvas.width / this.canvas.height;
      gl.uniform1f(this.loc.u_aspect, aspect);
      gl.uniform1i(this.loc.u_texture, 0);
      gl.uniform1f(this.loc.u_time, tickTime / 10000);
      gl.uniform1f(this.loc.u_volume, CONFIG.lowFreqVolume);
      const a = Math.max(0, Math.min(1, this.alpha));
      const eased = -(Math.cos(Math.PI * a) - 1) / 2;
      gl.uniform1f(this.loc.u_alpha, eased);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      this._drawMesh();
      gl.flush();
    }

    dispose() {
      this.stop();
      if (this.onResize) window.removeEventListener("resize", this.onResize);
      if (this.texture) { this.gl.deleteTexture(this.texture); this.texture = null; }
      if (this.vertexBuffer) this.gl.deleteBuffer(this.vertexBuffer);
      if (this.indexBuffer) this.gl.deleteBuffer(this.indexBuffer);
    }
  }

  global.FlowBg = FlowBg;
})(typeof window !== "undefined" ? window : this);
