import { RenderTarget, bindTexture, createProgram, getFormatDescriptors, setSampler } from './gl.js';
import { buildScene } from './scene.js';
import {
  COMPOSITE_FRAGMENT,
  DENOISE_FRAGMENT,
  FULLSCREEN_VERTEX,
  GEOMETRY_FRAGMENT,
  GEOMETRY_VERTEX,
  LIGHTING_FRAGMENT
} from './shaders.js';

export const DEFAULT_SETTINGS = Object.freeze({
  fogDensity: 0.65,
  cloudCoverage: 0.48,
  sunIntensity: 2.4,
  windSpeed: 0.55,
  ssrIntensity: 0.75,
  exposure: 1.05,
  renderScale: 0.65,
  fogSteps: 20,
  cloudSteps: 5,
  ssrSteps: 12,
  ssrEnabled: true,
  volumesEnabled: true,
  cloudsEnabled: true,
  denoiseEnabled: true,
  adaptiveEnabled: false,
  debugView: 0
});

export const QUALITY_PRESETS = Object.freeze({
  performance: { fogSteps: 12, cloudSteps: 3, ssrSteps: 8, renderScale: 0.5 },
  balanced: { fogSteps: 20, cloudSteps: 5, ssrSteps: 12, renderScale: 0.65 },
  ultra: { fogSteps: 28, cloudSteps: 7, ssrSteps: 16, renderScale: 0.85 }
});

export class Engine2D {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    });
    if (!this.gl) throw new Error('WebGL2 não pôde ser inicializado neste navegador.');

    const gl = this.gl;
    this.settings = { ...DEFAULT_SETTINGS };
    this.sunX = 0.78;
    this.sunY = 0.78;
    this.time = 0;
    this.frameNumber = 0;
    this.paused = false;
    this.running = false;
    this.dragging = false;
    this.drawCalls = 4;
    this.lastTime = 0;
    this.statsTime = 0;
    this.statsFrames = 0;
    this.adaptiveTime = 0;
    this.adaptiveStableWindows = 0;
    this.adaptiveCeiling = this.settings.renderScale;
    this.width = 0;
    this.height = 0;
    this.internalWidth = 0;
    this.internalHeight = 0;
    this.gbuffer = null;
    this.lightingTarget = null;
    this.denoiseTarget = null;

    this.formats = getFormatDescriptors(gl);
    this.geometryProgram = createProgram(gl, GEOMETRY_VERTEX, GEOMETRY_FRAGMENT);
    this.lightingProgram = createProgram(gl, FULLSCREEN_VERTEX, LIGHTING_FRAGMENT);
    this.denoiseProgram = createProgram(gl, FULLSCREEN_VERTEX, DENOISE_FRAGMENT);
    this.compositeProgram = createProgram(gl, FULLSCREEN_VERTEX, COMPOSITE_FRAGMENT);
    this.fullscreenVao = gl.createVertexArray();

    setSampler(gl, this.lightingProgram, 'tAlbedo', 0);
    setSampler(gl, this.lightingProgram, 'tNormalMaterial', 1);
    setSampler(gl, this.lightingProgram, 'tDepth', 2);
    setSampler(gl, this.denoiseProgram, 'tColor', 0);
    setSampler(gl, this.denoiseProgram, 'tNormalMaterial', 1);
    setSampler(gl, this.denoiseProgram, 'tDepth', 2);
    setSampler(gl, this.compositeProgram, 'tColor', 0);
    setSampler(gl, this.compositeProgram, 'tAlbedo', 1);
    setSampler(gl, this.compositeProgram, 'tNormalMaterial', 2);
    setSampler(gl, this.compositeProgram, 'tDepth', 3);

    this.uboData = new Float32Array(24);
    this.ubo = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, this.uboData.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.ubo);

    this.clearAlbedo = new Float32Array([0, 0, 0, 0]);
    this.clearNormal = new Float32Array([0.5, 0.5, 1, 0]);
    this.clearDepth = new Float32Array([1, 0, 0, 1]);
    this.scene = buildScene(gl);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.disable(gl.DITHER);

    this.frame = this.frame.bind(this);
    this.resize = this.resize.bind(this);
    this.updateSunFromPointer = this.updateSunFromPointer.bind(this);
    this.installInteraction();
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
    this.rendererName = this.detectRenderer();

    if (this.callbacks.onReady) {
      this.callbacks.onReady(this.scene.count, this.formats.floatColor, this.rendererName);
    }
  }

  detectRenderer() {
    const gl = this.gl;
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    if (extension) return gl.getParameter(extension.UNMASKED_RENDERER_WEBGL);
    return gl.getParameter(gl.RENDERER) || 'WebGL2 GPU';
  }

  installInteraction() {
    this.canvas.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      this.canvas.setPointerCapture(event.pointerId);
      this.updateSunFromPointer(event);
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (this.dragging) this.updateSunFromPointer(event);
    });
    const stopDragging = () => { this.dragging = false; };
    this.canvas.addEventListener('pointerup', stopDragging);
    this.canvas.addEventListener('pointercancel', stopDragging);
  }

  updateSunFromPointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.sunX = Math.min(0.94, Math.max(0.06, (event.clientX - rect.left) / rect.width));
    this.sunY = Math.min(0.92, Math.max(0.12, 1 - (event.clientY - rect.top) / rect.height));
    if (this.callbacks.onSunChange) this.callbacks.onSunChange(this.sunX, this.sunY);
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(2, Math.round(rect.width * dpr));
    const height = Math.max(2, Math.round(rect.height * dpr));
    const internalWidth = Math.max(2, Math.round(width * this.settings.renderScale));
    const internalHeight = Math.max(2, Math.round(height * this.settings.renderScale));
    if (width === this.width && height === this.height && internalWidth === this.internalWidth && internalHeight === this.internalHeight) return;

    const gl = this.gl;
    const fullSizeChanged = width !== this.width || height !== this.height;
    this.width = width;
    this.height = height;
    this.internalWidth = internalWidth;
    this.internalHeight = internalHeight;
    this.canvas.width = width;
    this.canvas.height = height;

    if (!this.gbuffer || fullSizeChanged) {
      if (this.gbuffer) this.gbuffer.dispose();
      this.gbuffer = new RenderTarget(gl, width, height, [this.formats.albedo, this.formats.data, this.formats.data], 'GBuffer');
    }
    if (this.lightingTarget) {
      this.lightingTarget.dispose();
      this.denoiseTarget.dispose();
    }
    this.lightingTarget = new RenderTarget(gl, internalWidth, internalHeight, [this.formats.lighting], 'Lighting');
    this.denoiseTarget = new RenderTarget(gl, internalWidth, internalHeight, [this.formats.lighting], 'Denoise');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  update(dt) {
    if (!this.paused) this.time += dt;
  }

  updateGlobals() {
    const data = this.uboData;
    const settings = this.settings;
    data[0] = this.width;
    data[1] = this.height;
    data[2] = this.time;
    data[3] = this.frameNumber;
    data[4] = this.sunX;
    data[5] = this.sunY;
    data[6] = this.settings.sunIntensity;
    data[7] = this.width / this.height;
    data[8] = settings.fogDensity;
    data[9] = settings.cloudCoverage;
    data[10] = settings.windSpeed;
    data[11] = settings.exposure;
    data[12] = settings.ssrIntensity;
    data[13] = 0.85;
    data[14] = 0.24;
    data[15] = settings.debugView;
    data[16] = settings.fogSteps;
    data[17] = settings.cloudSteps;
    data[18] = settings.renderScale;
    data[19] = settings.ssrSteps;
    data[20] = settings.ssrEnabled ? 1 : 0;
    data[21] = settings.volumesEnabled ? 1 : 0;
    data[22] = settings.cloudsEnabled ? 1 : 0;
    data[23] = settings.denoiseEnabled ? 1 : 0;
    const gl = this.gl;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, data);
  }

  render() {
    const gl = this.gl;
    this.updateGlobals();

    // PASS 1 — geometria e materiais em resolução nativa, três MRT attachments.
    this.gbuffer.bind();
    gl.clearBufferfv(gl.COLOR, 0, this.clearAlbedo);
    gl.clearBufferfv(gl.COLOR, 1, this.clearNormal);
    gl.clearBufferfv(gl.COLOR, 2, this.clearDepth);
    gl.useProgram(this.geometryProgram);
    this.scene.draw();

    // PASS 2 — PBR, shadow march, SSR, névoa e nuvens em resolução interna.
    this.lightingTarget.bind();
    gl.useProgram(this.lightingProgram);
    bindTexture(gl, 0, this.gbuffer.textures[0]);
    bindTexture(gl, 1, this.gbuffer.textures[1]);
    bindTexture(gl, 2, this.gbuffer.textures[2]);
    gl.bindVertexArray(this.fullscreenVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // PASS 3 — denoiser bilateral 5×5 guiado por depth + normais.
    let outputTexture = this.lightingTarget.textures[0];
    this.drawCalls = 3;
    if (this.settings.denoiseEnabled) {
      this.denoiseTarget.bind();
      gl.useProgram(this.denoiseProgram);
      bindTexture(gl, 0, this.lightingTarget.textures[0]);
      bindTexture(gl, 1, this.gbuffer.textures[1]);
      bindTexture(gl, 2, this.gbuffer.textures[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      outputTexture = this.denoiseTarget.textures[0];
      this.drawCalls = 4;
    }

    // PASS 4 — upsampling, ACES e composição no canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.compositeProgram);
    bindTexture(gl, 0, outputTexture);
    bindTexture(gl, 1, this.gbuffer.textures[0]);
    bindTexture(gl, 2, this.gbuffer.textures[1]);
    bindTexture(gl, 3, this.gbuffer.textures[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  frame(now) {
    if (!this.running) return;
    if (this.lastTime === 0) {
      this.lastTime = now;
      this.statsTime = now;
    }
    const elapsed = now - this.lastTime;
    const dt = Math.min(elapsed * 0.001, 0.05);
    this.lastTime = now;
    this.update(dt);
    this.render();
    this.frameNumber++;
    this.statsFrames++;

    const statsElapsed = now - this.statsTime;
    if (statsElapsed >= 500) {
      const fps = this.statsFrames * 1000 / statsElapsed;
      const frameMs = statsElapsed / this.statsFrames;
      if (this.callbacks.onStats) {
        this.callbacks.onStats(fps, frameMs, this.internalWidth, this.internalHeight, this.drawCalls, this.settings.renderScale);
      }
      if (this.settings.adaptiveEnabled && !this.paused) {
        this.adaptiveTime += statsElapsed;
        if (this.adaptiveTime >= 2000) {
          this.adaptResolution(fps);
          this.adaptiveTime = 0;
        }
      }
      this.statsFrames = 0;
      this.statsTime = now;
    }
    requestAnimationFrame(this.frame);
  }

  adaptResolution(fps) {
    if (fps < 49 && this.settings.renderScale > 0.4) {
      this.adaptiveStableWindows = 0;
      this.setRenderScale(this.settings.renderScale - 0.05, true);
    } else if (fps > 58.5 && this.settings.renderScale < this.adaptiveCeiling) {
      this.adaptiveStableWindows++;
      if (this.adaptiveStableWindows >= 2) {
        this.setRenderScale(Math.min(this.adaptiveCeiling, this.settings.renderScale + 0.05), true);
        this.adaptiveStableWindows = 0;
      }
    } else {
      this.adaptiveStableWindows = 0;
    }
  }

  setRenderScale(value, fromAdaptive = false) {
    const scale = Math.min(1, Math.max(0.4, Math.round(value * 20) / 20));
    if (scale === this.settings.renderScale) return;
    this.settings.renderScale = scale;
    if (!fromAdaptive) this.adaptiveCeiling = scale;
    this.resize();
    if (this.callbacks.onScaleChange) this.callbacks.onScaleChange(scale, fromAdaptive);
  }

  setQuality(name) {
    const preset = QUALITY_PRESETS[name];
    if (!preset) return;
    this.settings.fogSteps = preset.fogSteps;
    this.settings.cloudSteps = preset.cloudSteps;
    this.settings.ssrSteps = preset.ssrSteps;
    this.setRenderScale(preset.renderScale);
  }

  setDebugView(view) {
    this.settings.debugView = Math.max(0, Math.min(3, view | 0));
  }

  setPaused(paused) {
    this.paused = paused;
    if (this.callbacks.onPauseChange) this.callbacks.onPauseChange(paused);
  }

  reset() {
    const adaptive = this.settings.adaptiveEnabled;
    Object.assign(this.settings, DEFAULT_SETTINGS);
    this.settings.adaptiveEnabled = adaptive;
    this.sunX = 0.78;
    this.sunY = 0.78;
    this.time = 0;
    this.adaptiveCeiling = this.settings.renderScale;
    this.resize();
    if (this.callbacks.onReset) this.callbacks.onReset();
    if (this.callbacks.onSunChange) this.callbacks.onSunChange(this.sunX, this.sunY);
  }

  run() {
    if (this.running) return;
    this.running = true;
    this.lastTime = 0;
    requestAnimationFrame(this.frame);
  }

  dispose() {
    this.running = false;
    this.resizeObserver.disconnect();
    this.scene && this.gl.deleteBuffer(this.scene.instanceBuffer);
    this.scene && this.gl.deleteBuffer(this.scene.quadBuffer);
    this.scene && this.gl.deleteVertexArray(this.scene.vao);
    if (this.gbuffer) this.gbuffer.dispose();
    if (this.lightingTarget) this.lightingTarget.dispose();
    if (this.denoiseTarget) this.denoiseTarget.dispose();
    this.gl.deleteBuffer(this.ubo);
    this.gl.deleteVertexArray(this.fullscreenVao);
    this.gl.deleteProgram(this.geometryProgram);
    this.gl.deleteProgram(this.lightingProgram);
    this.gl.deleteProgram(this.denoiseProgram);
    this.gl.deleteProgram(this.compositeProgram);
  }
}
