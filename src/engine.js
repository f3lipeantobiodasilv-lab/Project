import { RenderTarget, bindTexture, createProgram, getFormatDescriptors, setSampler, uniformLocations } from './gl.js';
import { buildScene, terrainApprox } from './scene.js';
import { DynamicLightBank } from './lights.js';
import { DustMotes, DebrisParticles } from './particles.js';
import { PhysicsWorld } from './physics.js';
import { AssetManager } from './assets.js';
import { SpatialAudioEngine } from './audio.js';
import {
  ADAPT_FRAGMENT,
  BLOOM_PREFILTER_FRAGMENT,
  COMPOSITE_FRAGMENT,
  COPY_FRAGMENT,
  DEBRIS_FRAGMENT,
  DEBRIS_VERTEX,
  DENOISE_FRAGMENT,
  DUST_FRAGMENT,
  DUST_VERTEX,
  FULLSCREEN_VERTEX,
  GEOMETRY_FRAGMENT,
  GEOMETRY_VERTEX,
  GODRAYS_FRAGMENT,
  KAWASE_DOWNSAMPLE_FRAGMENT,
  KAWASE_UPSAMPLE_FRAGMENT,
  LIGHTING_FRAGMENT,
  LUMINANCE_FRAGMENT
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
  debugView: 0,
  bloomEnabled: true,
  bloomThreshold: 0.72,
  bloomIntensity: 0.55,
  godRaysEnabled: true,
  godRayIntensity: 0.5,
  godRaySteps: 24,
  autoExposureEnabled: true,
  autoExposureSpeed: 2.0,
  chromaticAberration: 0.35,
  pointLightsEnabled: true,
  pointLightIntensity: 1.0,
  dustEnabled: true,
  dustIntensity: 0.75,
  dustCount: 240,
  audioEnabled: false
});

export const QUALITY_PRESETS = Object.freeze({
  performance: { fogSteps: 12, cloudSteps: 3, ssrSteps: 8, renderScale: 0.5, godRaySteps: 16, dustCount: 140 },
  balanced: { fogSteps: 20, cloudSteps: 5, ssrSteps: 12, renderScale: 0.65, godRaySteps: 24, dustCount: 240 },
  ultra: { fogSteps: 28, cloudSteps: 7, ssrSteps: 16, renderScale: 0.85, godRaySteps: 32, dustCount: 340 }
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
    this.postSourceTarget = null;
    this.bloomTargets = [];
    this.luminanceTargets = [];
    this.adaptedTargets = [];
    this.adaptedIndex = 0;
    this.godRayTarget = null;
    this.frameDrawCalls = 0;
    this.lastDt = 1 / 60;
    this.probeTrailTime = 0;
    this.assets = new AssetManager();
    this.audio = null;
    this.lights = new DynamicLightBank();

    this.formats = getFormatDescriptors(gl);
    this.geometryProgram = createProgram(gl, GEOMETRY_VERTEX, GEOMETRY_FRAGMENT);
    this.lightingProgram = createProgram(gl, FULLSCREEN_VERTEX, LIGHTING_FRAGMENT);
    this.denoiseProgram = createProgram(gl, FULLSCREEN_VERTEX, DENOISE_FRAGMENT);
    this.compositeProgram = createProgram(gl, FULLSCREEN_VERTEX, COMPOSITE_FRAGMENT);
    this.copyProgram = createProgram(gl, FULLSCREEN_VERTEX, COPY_FRAGMENT);
    this.luminanceProgram = createProgram(gl, FULLSCREEN_VERTEX, LUMINANCE_FRAGMENT);
    this.adaptProgram = createProgram(gl, FULLSCREEN_VERTEX, ADAPT_FRAGMENT);
    this.bloomPrefilterProgram = createProgram(gl, FULLSCREEN_VERTEX, BLOOM_PREFILTER_FRAGMENT);
    this.kawaseDownProgram = createProgram(gl, FULLSCREEN_VERTEX, KAWASE_DOWNSAMPLE_FRAGMENT);
    this.kawaseUpProgram = createProgram(gl, FULLSCREEN_VERTEX, KAWASE_UPSAMPLE_FRAGMENT);
    this.godRaysProgram = createProgram(gl, FULLSCREEN_VERTEX, GODRAYS_FRAGMENT);
    this.dustProgram = createProgram(gl, DUST_VERTEX, DUST_FRAGMENT);
    this.debrisProgram = createProgram(gl, DEBRIS_VERTEX, DEBRIS_FRAGMENT);
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
    setSampler(gl, this.compositeProgram, 'tBloom', 4);
    setSampler(gl, this.compositeProgram, 'tGodRays', 5);
    setSampler(gl, this.compositeProgram, 'tAdapted', 6);
    setSampler(gl, this.copyProgram, 'tColor', 0);
    setSampler(gl, this.luminanceProgram, 'tColor', 0);
    setSampler(gl, this.adaptProgram, 'tAverage', 0);
    setSampler(gl, this.adaptProgram, 'tPrevious', 1);
    setSampler(gl, this.bloomPrefilterProgram, 'tColor', 0);
    setSampler(gl, this.kawaseDownProgram, 'tColor', 0);
    setSampler(gl, this.kawaseUpProgram, 'tColor', 0);
    setSampler(gl, this.godRaysProgram, 'tColor', 0);
    setSampler(gl, this.godRaysProgram, 'tDepth', 1);
    setSampler(gl, this.dustProgram, 'tLightAccum', 0);

    this.luminanceUniforms = uniformLocations(gl, this.luminanceProgram, ['uTexel', 'uLogInput']);
    this.adaptUniforms = uniformLocations(gl, this.adaptProgram, ['uAdaptParams']);
    this.kawaseDownUniforms = uniformLocations(gl, this.kawaseDownProgram, ['uTexel']);
    this.kawaseUpUniforms = uniformLocations(gl, this.kawaseUpProgram, ['uTexel', 'uRadius']);
    this.lightUniforms = this.lights.locations(gl, this.lightingProgram);
    this.dustLightUniforms = this.lights.locations(gl, this.dustProgram);

    this.uboData = new Float32Array(32);
    this.ubo = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, this.uboData.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.ubo);

    this.clearAlbedo = new Float32Array([0, 0, 0, 0]);
    this.clearNormal = new Float32Array([0.5, 0.5, 1, 0]);
    this.clearDepth = new Float32Array([1, 0, 0, 1]);
    this.scene = buildScene(gl);
    this.dust = new DustMotes(gl);
    this.debris = new DebrisParticles(gl);
    this.physics = new PhysicsWorld({
      terrainHeight: terrainApprox,
      statics: [
        { minX: 0.355, minY: 0.352, maxX: 0.765, maxY: 0.598, kind: 'ship' },
        { minX: 0.073, minY: 0.245, maxX: 0.218, maxY: 0.385, kind: 'solar-panel' },
        { minX: 0.780, minY: 0.245, maxX: 0.900, maxY: 0.375, kind: 'solar-panel' },
        { minX: 0.650, minY: 0.235, maxX: 0.740, maxY: 0.335, kind: 'cargo' }
      ],
      onImpact: (event) => this.handlePhysicsImpact(event)
    });

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
      this.callbacks.onReady(this.scene.totalCount, this.formats.floatColor, this.rendererName);
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
    // O mínimo permite arrastar o sol para *abaixo* do horizonte da cena
    // (y ≈ 0.245 nos shaders): é isso que dispara a noite (dayFactor → 0).
    this.sunY = Math.min(0.92, Math.max(0.02, 1 - (event.clientY - rect.top) / rect.height));
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
    this.createPostTargets(internalWidth, internalHeight);
    const spatialStats = this.scene.setViewport({ x: 0, y: 0, width: 1, height: 1 });
    if (this.callbacks.onSpatialStats) this.callbacks.onSpatialStats(spatialStats, this.scene.totalCount);
    this.dust.setActiveCount(this.settings.dustCount * (this.settings.renderScale < 0.55 ? 0.65 : 1));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  disposePostTargets() {
    const gl = this.gl;
    if (this.postSourceTarget) this.postSourceTarget.dispose();
    if (this.godRayTarget) this.godRayTarget.dispose();
    for (let i = 0; i < this.bloomTargets.length; i++) this.bloomTargets[i].dispose();
    for (let i = 0; i < this.luminanceTargets.length; i++) this.luminanceTargets[i].dispose();
    for (let i = 0; i < this.adaptedTargets.length; i++) this.adaptedTargets[i].dispose();
    this.postSourceTarget = null;
    this.godRayTarget = null;
    this.bloomTargets = [];
    this.luminanceTargets = [];
    this.adaptedTargets = [];
    this.adaptedIndex = 0;
    void gl;
  }

  createPostTargets(width, height) {
    const gl = this.gl;
    this.disposePostTargets();
    this.postSourceTarget = new RenderTarget(gl, width, height, [this.formats.lighting], 'PostSource');

    // Pirâmide Kawase: 5 níveis, metade da resolução a cada passo.
    let bloomWidth = Math.max(2, width >> 1);
    let bloomHeight = Math.max(2, height >> 1);
    for (let i = 0; i < 5; i++) {
      this.bloomTargets.push(new RenderTarget(gl, bloomWidth, bloomHeight, [this.formats.lighting], `Bloom${i}`));
      bloomWidth = Math.max(2, bloomWidth >> 1);
      bloomHeight = Math.max(2, bloomHeight >> 1);
    }

    // Cadeia de luminância: internal/4 → … → 1×1 (média log).
    let lumWidth = Math.max(1, width >> 2);
    let lumHeight = Math.max(1, height >> 2);
    for (;;) {
      this.luminanceTargets.push(new RenderTarget(gl, lumWidth, lumHeight, [this.formats.lighting], `Luminance${lumWidth}x${lumHeight}`));
      if (lumWidth === 1 && lumHeight === 1) break;
      lumWidth = Math.max(1, lumWidth >> 1);
      lumHeight = Math.max(1, lumHeight >> 1);
    }

    // Exposição adaptada: ping-pong 1×1, inicializada neutra (1.0).
    const neutralExposure = new Float32Array([1, 0.3, 1, 1]);
    for (let i = 0; i < 2; i++) {
      const target = new RenderTarget(gl, 1, 1, [this.formats.lighting], `Adapted${i}`);
      target.bind();
      gl.clearBufferfv(gl.COLOR, 0, neutralExposure);
      this.adaptedTargets.push(target);
    }

    this.godRayTarget = new RenderTarget(gl, Math.max(2, width >> 1), Math.max(2, height >> 1), [this.formats.lighting], 'GodRays');
    this.godRayTarget.bind();
    gl.clearBufferfv(gl.COLOR, 0, new Float32Array([0, 0, 0, 1]));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  handlePhysicsImpact(event) {
    this.debris.spawnBurst(event.x, event.y, event.intensity, event.nx, event.ny);
    if (this.audio && this.settings.audioEnabled) {
      this.audio.playImpact(event.intensity, event.x, event.y, event.surface === 'terrain' ? 0.48 : 0.22);
    }
    if (this.callbacks.onImpact) this.callbacks.onImpact(event);
  }

  async setAudioEnabled(enabled) {
    this.settings.audioEnabled = Boolean(enabled);
    try {
      if (enabled) {
        if (!this.audio) this.audio = new SpatialAudioEngine();
        await this.audio.start();
        this.audio.addAmbientEmitters();
        this.audio.setMuted(false);
      } else if (this.audio) {
        this.audio.setMuted(true);
      }
    } catch (error) {
      this.settings.audioEnabled = false;
      console.warn('Áudio espacial indisponível:', error);
    }
    if (this.callbacks.onAudioChange) this.callbacks.onAudioChange(this.settings.audioEnabled);
    return this.settings.audioEnabled;
  }

  update(dt) {
    this.lastDt = dt;
    if (this.paused) return;
    this.time += dt;
    this.physics.step(dt);
    this.debris.update(dt, this.settings.windSpeed);
    if (this.physics.probe.active) {
      this.probeTrailTime += dt;
      if (this.probeTrailTime > 0.045) {
        this.probeTrailTime = 0;
        this.debris.spawnProbeMarker(this.physics.probe.x, this.physics.probe.y);
      }
    }
    if (this.audio && this.settings.audioEnabled) {
      this.audio.setListener(0.56, 0.475, 0.16);
      this.audio.setEmitterPosition('ship', 0.45, 0.47, 0.16);
      this.audio.setEmitterPosition('wind', 0.5, 0.42, 0.8);
    }
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
    data[24] = settings.bloomThreshold;
    data[25] = 0.18;
    data[26] = settings.godRaysEnabled ? settings.godRayIntensity : 0;
    data[27] = settings.chromaticAberration;
    data[28] = settings.autoExposureEnabled ? 1 : 0;
    data[29] = settings.godRaySteps;
    data[30] = settings.dustEnabled ? settings.dustIntensity : 0;
    data[31] = settings.bloomEnabled ? 1 : 0;
    const gl = this.gl;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, data);
  }

  drawFullscreen() {
    const gl = this.gl;
    gl.bindVertexArray(this.fullscreenVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.frameDrawCalls++;
  }

  renderDustAndDebris(sourceTexture) {
    const gl = this.gl;
    this.postSourceTarget.bind();
    gl.useProgram(this.copyProgram);
    bindTexture(gl, 0, sourceTexture);
    this.drawFullscreen();

    // Partículas aditivas sobre a cópia — a fonte (luz acumulada) é uma
    // textura diferente do destino, sem feedback loop de framebuffer.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    if (this.settings.dustEnabled) {
      gl.useProgram(this.dustProgram);
      this.lights.apply(gl, this.dustLightUniforms, this.settings.pointLightsEnabled ? this.settings.pointLightIntensity : 0);
      bindTexture(gl, 0, sourceTexture);
      this.dust.draw(gl);
      this.frameDrawCalls++;
    }
    if (this.debris.alive > 0) {
      gl.useProgram(this.debrisProgram);
      this.debris.draw(gl);
      this.frameDrawCalls++;
    }
    gl.disable(gl.BLEND);
    return this.postSourceTarget.textures[0];
  }

  renderLuminanceAdaptation(sourceTexture) {
    const gl = this.gl;
    if (!this.settings.autoExposureEnabled || this.luminanceTargets.length === 0) return;
    let inputTexture = sourceTexture;
    let inputWidth = this.internalWidth;
    let inputHeight = this.internalHeight;
    gl.useProgram(this.luminanceProgram);
    for (let i = 0; i < this.luminanceTargets.length; i++) {
      const target = this.luminanceTargets[i];
      target.bind();
      bindTexture(gl, 0, inputTexture);
      if (this.luminanceUniforms.uTexel) gl.uniform2f(this.luminanceUniforms.uTexel, 1 / inputWidth, 1 / inputHeight);
      if (this.luminanceUniforms.uLogInput) gl.uniform1f(this.luminanceUniforms.uLogInput, i === 0 ? 0 : 1);
      this.drawFullscreen();
      inputTexture = target.textures[0];
      inputWidth = target.width;
      inputHeight = target.height;
    }

    const nextIndex = 1 - this.adaptedIndex;
    this.adaptedTargets[nextIndex].bind();
    gl.useProgram(this.adaptProgram);
    bindTexture(gl, 0, inputTexture);
    bindTexture(gl, 1, this.adaptedTargets[this.adaptedIndex].textures[0]);
    if (this.adaptUniforms.uAdaptParams) {
      gl.uniform4f(this.adaptUniforms.uAdaptParams, Math.max(this.lastDt, 0.001), this.settings.autoExposureSpeed, 0.55, 1.65);
    }
    this.drawFullscreen();
    this.adaptedIndex = nextIndex;
  }

  renderBloomPyramid(sourceTexture) {
    const gl = this.gl;
    if (!this.settings.bloomEnabled || this.bloomTargets.length === 0) return;
    this.bloomTargets[0].bind();
    gl.useProgram(this.bloomPrefilterProgram);
    bindTexture(gl, 0, sourceTexture);
    this.drawFullscreen();

    gl.useProgram(this.kawaseDownProgram);
    for (let i = 1; i < this.bloomTargets.length; i++) {
      const previous = this.bloomTargets[i - 1];
      this.bloomTargets[i].bind();
      bindTexture(gl, 0, previous.textures[0]);
      if (this.kawaseDownUniforms.uTexel) gl.uniform2f(this.kawaseDownUniforms.uTexel, 1 / previous.width, 1 / previous.height);
      this.drawFullscreen();
    }

    // Upsample aditivo de volta pela pirâmide (Kawase): cada nível soma
    // o borrão mais largo ao mais fino, produzindo o raio orgânico final.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.kawaseUpProgram);
    for (let i = this.bloomTargets.length - 2; i >= 0; i--) {
      const finer = this.bloomTargets[i];
      const coarser = this.bloomTargets[i + 1];
      finer.bind();
      bindTexture(gl, 0, coarser.textures[0]);
      if (this.kawaseUpUniforms.uTexel) gl.uniform2f(this.kawaseUpUniforms.uTexel, 1 / coarser.width, 1 / coarser.height);
      if (this.kawaseUpUniforms.uRadius) gl.uniform1f(this.kawaseUpUniforms.uRadius, 2.0);
      this.drawFullscreen();
    }
    gl.disable(gl.BLEND);
  }

  renderGodRays(sourceTexture) {
    const gl = this.gl;
    if (!this.settings.godRaysEnabled || !this.godRayTarget) return;
    this.godRayTarget.bind();
    gl.useProgram(this.godRaysProgram);
    bindTexture(gl, 0, sourceTexture);
    bindTexture(gl, 1, this.gbuffer.textures[2]);
    this.drawFullscreen();
  }

  render() {
    const gl = this.gl;
    this.updateGlobals();
    this.frameDrawCalls = 0;

    // PASS 1 — geometria e materiais em resolução nativa, três MRT attachments.
    this.gbuffer.bind();
    gl.clearBufferfv(gl.COLOR, 0, this.clearAlbedo);
    gl.clearBufferfv(gl.COLOR, 1, this.clearNormal);
    gl.clearBufferfv(gl.COLOR, 2, this.clearDepth);
    gl.useProgram(this.geometryProgram);
    this.scene.draw();
    this.frameDrawCalls++;

    // PASS 2 — PBR + luzes pontuais, shadow march, SSR, névoa e nuvens.
    this.lightingTarget.bind();
    gl.useProgram(this.lightingProgram);
    this.lights.update(this.time, this.settings.pointLightsEnabled, 1);
    this.lights.apply(gl, this.lightUniforms, this.settings.pointLightsEnabled ? this.settings.pointLightIntensity : 0);
    bindTexture(gl, 0, this.gbuffer.textures[0]);
    bindTexture(gl, 1, this.gbuffer.textures[1]);
    bindTexture(gl, 2, this.gbuffer.textures[2]);
    this.drawFullscreen();

    // PASS 3 — denoiser bilateral 5×5 guiado por depth + normais.
    let outputTexture = this.lightingTarget.textures[0];
    if (this.settings.denoiseEnabled) {
      this.denoiseTarget.bind();
      gl.useProgram(this.denoiseProgram);
      bindTexture(gl, 0, this.lightingTarget.textures[0]);
      bindTexture(gl, 1, this.gbuffer.textures[1]);
      bindTexture(gl, 2, this.gbuffer.textures[2]);
      this.drawFullscreen();
      outputTexture = this.denoiseTarget.textures[0];
    }

    // PASS 4 — poeira volumétrica + debris da física sobre a luz acumulada.
    if (this.settings.dustEnabled || this.debris.alive > 0) {
      outputTexture = this.renderDustAndDebris(outputTexture);
    }

    // PASS 5 — cadeia HDR: luminância/adaptação, bloom Kawase e god rays.
    this.renderLuminanceAdaptation(outputTexture);
    this.renderBloomPyramid(outputTexture);
    this.renderGodRays(outputTexture);

    // PASS 6 — Uber-post no canvas: CA, bloom+god rays, auto-exposição,
    // ACES, gama, vinheta e grão (ou views de diagnóstico do G-Buffer).
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.compositeProgram);
    bindTexture(gl, 0, outputTexture);
    bindTexture(gl, 1, this.gbuffer.textures[0]);
    bindTexture(gl, 2, this.gbuffer.textures[1]);
    bindTexture(gl, 3, this.gbuffer.textures[2]);
    bindTexture(gl, 4, this.bloomTargets.length ? this.bloomTargets[0].textures[0] : outputTexture);
    bindTexture(gl, 5, this.godRayTarget ? this.godRayTarget.textures[0] : outputTexture);
    bindTexture(gl, 6, this.adaptedTargets.length ? this.adaptedTargets[this.adaptedIndex].textures[0] : outputTexture);
    this.drawFullscreen();
    this.drawCalls = this.frameDrawCalls;
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
    this.settings.godRaySteps = preset.godRaySteps;
    this.settings.dustCount = preset.dustCount;
    this.dust.setActiveCount(preset.dustCount * (preset.renderScale < 0.55 ? 0.65 : 1));
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
    const audio = this.settings.audioEnabled;
    Object.assign(this.settings, DEFAULT_SETTINGS);
    this.settings.adaptiveEnabled = adaptive;
    this.settings.audioEnabled = audio;
    this.sunX = 0.78;
    this.sunY = 0.78;
    this.time = 0;
    this.physics.reset();
    this.debris.clear();
    this.dust.setActiveCount(this.settings.dustCount);
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
    this.disposePostTargets();
    this.dust.dispose(this.gl);
    this.debris.dispose(this.gl);
    if (this.audio) this.audio.dispose();
    this.gl.deleteBuffer(this.ubo);
    this.gl.deleteVertexArray(this.fullscreenVao);
    this.gl.deleteProgram(this.geometryProgram);
    this.gl.deleteProgram(this.lightingProgram);
    this.gl.deleteProgram(this.denoiseProgram);
    this.gl.deleteProgram(this.compositeProgram);
    this.gl.deleteProgram(this.copyProgram);
    this.gl.deleteProgram(this.luminanceProgram);
    this.gl.deleteProgram(this.adaptProgram);
    this.gl.deleteProgram(this.bloomPrefilterProgram);
    this.gl.deleteProgram(this.kawaseDownProgram);
    this.gl.deleteProgram(this.kawaseUpProgram);
    this.gl.deleteProgram(this.godRaysProgram);
    this.gl.deleteProgram(this.dustProgram);
    this.gl.deleteProgram(this.debrisProgram);
  }
}
