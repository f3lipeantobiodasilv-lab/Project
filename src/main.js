import { Engine2D } from './engine.js';

const byId = (id) => document.getElementById(id);
const canvas = byId('glCanvas');
const canvasShell = byId('canvasShell');
const bootScreen = byId('bootScreen');
const errorScreen = byId('errorScreen');
const fpsValue = byId('fpsValue');
const frameTime = byId('frameTime');
const internalResolution = byId('internalResolution');
const drawCalls = byId('drawCalls');
const budgetFill = byId('budgetFill');
const sunHint = byId('sunHint');
const playButton = byId('playButton');
const liveLabel = byId('liveLabel');
const qualitySummary = byId('qualitySummary');
const viewButtons = Array.from(document.querySelectorAll('[data-view]'));
const qualityButtons = Array.from(document.querySelectorAll('[data-quality]'));
let engine;

const sliderDefinitions = [
  { id: 'fogDensity', key: 'fogDensity', digits: 2 },
  { id: 'cloudCoverage', key: 'cloudCoverage', digits: 2 },
  { id: 'sunIntensity', key: 'sunIntensity', digits: 2 },
  { id: 'windSpeed', key: 'windSpeed', digits: 2 },
  { id: 'ssrIntensity', key: 'ssrIntensity', digits: 2 },
  { id: 'exposure', key: 'exposure', digits: 2 },
  { id: 'renderScale', key: 'renderScale', digits: 0 }
];
const toggleDefinitions = [
  ['ssrEnabled', 'ssrEnabled'],
  ['volumesEnabled', 'volumesEnabled'],
  ['cloudsEnabled', 'cloudsEnabled'],
  ['denoiseEnabled', 'denoiseEnabled'],
  ['adaptiveEnabled', 'adaptiveEnabled']
];

function updateRangeFill(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const percent = (Number(input.value) - min) / (max - min) * 100;
  input.style.setProperty('--value', `${percent}%`);
}

function updateSlider(definition) {
  const input = byId(definition.id);
  const output = byId(`${definition.id}Value`);
  const value = Number(input.value);
  output.textContent = definition.key === 'renderScale' ? `${Math.round(value)}%` : value.toFixed(definition.digits);
  updateRangeFill(input);
}

function updateQualityLabel() {
  const settings = engine.settings;
  qualitySummary.textContent = `${settings.fogSteps} ray steps · ${settings.cloudSteps} cloud slices · ${settings.ssrSteps} SSR steps`;
}

function markQuality(name) {
  for (let i = 0; i < qualityButtons.length; i++) {
    qualityButtons[i].classList.toggle('active', qualityButtons[i].dataset.quality === name);
  }
}

function syncUI() {
  for (let i = 0; i < sliderDefinitions.length; i++) {
    const definition = sliderDefinitions[i];
    const value = engine.settings[definition.key];
    byId(definition.id).value = definition.key === 'renderScale' ? Math.round(value * 100) : value;
    updateSlider(definition);
  }
  for (let i = 0; i < toggleDefinitions.length; i++) {
    byId(toggleDefinitions[i][0]).checked = engine.settings[toggleDefinitions[i][1]];
  }
  for (let i = 0; i < viewButtons.length; i++) {
    viewButtons[i].classList.toggle('active', Number(viewButtons[i].dataset.view) === engine.settings.debugView);
  }
  byId('denoiseNode').classList.toggle('disabled', !engine.settings.denoiseEnabled);
  updateQualityLabel();
}

function setDebugView(view) {
  engine.setDebugView(view);
  for (let i = 0; i < viewButtons.length; i++) {
    viewButtons[i].classList.toggle('active', Number(viewButtons[i].dataset.view) === view);
  }
}

const graph = byId('performanceGraph');
const graphContext = graph.getContext('2d');
const graphHistory = new Float32Array(48);
let graphIndex = 0;
let graphCount = 0;

function updateGraph(fps) {
  graphHistory[graphIndex] = fps;
  graphIndex = (graphIndex + 1) % graphHistory.length;
  graphCount = Math.min(graphCount + 1, graphHistory.length);
  const ctx = graphContext;
  const width = graph.width;
  const height = graph.height;
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = '#25302f';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const targetY = height - 60 / 90 * height;
  ctx.moveTo(0, targetY);
  ctx.lineTo(width, targetY);
  ctx.stroke();
  if (graphCount < 2) return;
  ctx.strokeStyle = fps >= 50 ? '#6cba93' : fps >= 30 ? '#d5a45e' : '#df7659';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  const start = (graphIndex - graphCount + graphHistory.length) % graphHistory.length;
  for (let i = 0; i < graphCount; i++) {
    const value = graphHistory[(start + i) % graphHistory.length];
    const x = i / (graphHistory.length - 1) * width;
    const y = height - Math.min(value, 90) / 90 * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

const callbacks = {
  onReady(instances, floatColor, renderer) {
    byId('instanceCount').textContent = instances;
    byId('rendererName').textContent = renderer.replace(/^ANGLE \(/, '').replace(/\)$/, '');
    byId('rendererName').title = `${renderer} · ${floatColor ? 'RGBA16F' : 'RGBA8 fallback'}`;
    document.querySelector('.api-badge').title = floatColor ? 'EXT_color_buffer_float disponível: dados em RGBA16F' : 'Fallback RGBA8 ativo';
  },
  onStats(fps, ms, width, height, calls) {
    fpsValue.textContent = Math.round(fps);
    frameTime.textContent = `${ms.toFixed(1)} ms / frame`;
    internalResolution.textContent = `${width} × ${height}`;
    drawCalls.textContent = `${calls} / frame`;
    const budget = Math.min(100, ms / 16.7 * 100);
    budgetFill.style.width = `${budget}%`;
    const color = ms <= 16.7 ? '#7fd4a5' : ms <= 25 ? '#d5a45e' : '#df7659';
    budgetFill.style.background = color;
    fpsValue.style.color = color;
    updateGraph(fps);
  },
  onScaleChange(scale, adaptive) {
    const definition = sliderDefinitions[sliderDefinitions.length - 1];
    byId('renderScale').value = Math.round(scale * 100);
    updateSlider(definition);
    if (!adaptive) markQuality('custom');
  },
  onSunChange(x, y) {
    sunHint.style.left = `${x * 100}%`;
    sunHint.style.top = `${(1 - y) * 100}%`;
  },
  onPauseChange(paused) {
    playButton.querySelector('use').setAttribute('href', paused ? '#i-play' : '#i-pause');
    playButton.setAttribute('aria-label', paused ? 'Retomar simulação' : 'Pausar simulação');
    playButton.title = paused ? 'Retomar (Espaço)' : 'Pausar (Espaço)';
    canvasShell.classList.toggle('paused', paused);
    liveLabel.textContent = paused ? 'SIMULATION PAUSED' : 'LIVE RENDER';
  },
  onReset() {
    markQuality('balanced');
    syncUI();
  }
};

try {
  engine = new Engine2D(canvas, callbacks);
  window.aether = engine;

  for (let i = 0; i < sliderDefinitions.length; i++) {
    const definition = sliderDefinitions[i];
    const input = byId(definition.id);
    input.addEventListener('input', () => {
      const value = Number(input.value);
      if (definition.key === 'renderScale') engine.setRenderScale(value / 100);
      else engine.settings[definition.key] = value;
      updateSlider(definition);
    });
    updateSlider(definition);
  }

  for (let i = 0; i < toggleDefinitions.length; i++) {
    const definition = toggleDefinitions[i];
    const input = byId(definition[0]);
    input.addEventListener('change', () => {
      engine.settings[definition[1]] = input.checked;
      if (definition[1] === 'adaptiveEnabled') {
        engine.adaptiveCeiling = engine.settings.renderScale;
        engine.adaptiveTime = 0;
        engine.adaptiveStableWindows = 0;
      }
      if (definition[1] === 'denoiseEnabled') {
        byId('denoiseNode').classList.toggle('disabled', !input.checked);
      }
    });
  }

  for (let i = 0; i < qualityButtons.length; i++) {
    qualityButtons[i].addEventListener('click', () => {
      const name = qualityButtons[i].dataset.quality;
      engine.setQuality(name);
      markQuality(name);
      byId('renderScale').value = Math.round(engine.settings.renderScale * 100);
      updateSlider(sliderDefinitions[sliderDefinitions.length - 1]);
      updateQualityLabel();
    });
  }

  for (let i = 0; i < viewButtons.length; i++) {
    viewButtons[i].addEventListener('click', () => setDebugView(Number(viewButtons[i].dataset.view)));
  }

  playButton.addEventListener('click', () => engine.setPaused(!engine.paused));
  byId('resetButton').addEventListener('click', () => engine.reset());
  byId('fullscreenButton').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await canvasShell.requestFullscreen();
    } catch (error) {
      console.warn('Tela cheia não disponível:', error);
    }
  });

  const dialog = byId('architectureDialog');
  byId('architectureButton').addEventListener('click', () => dialog.showModal());
  byId('closeDialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement || dialog.open) return;
    if (event.code === 'Space') {
      event.preventDefault();
      engine.setPaused(!engine.paused);
    } else if (event.key.toLowerCase() === 'r') {
      engine.reset();
    } else if (event.key >= '1' && event.key <= '4') {
      setDebugView(Number(event.key) - 1);
    }
  });

  syncUI();
  callbacks.onSunChange(engine.sunX, engine.sunY);
  engine.run();
  requestAnimationFrame(() => requestAnimationFrame(() => bootScreen.classList.add('loaded')));
} catch (error) {
  console.error(error);
  bootScreen.classList.add('loaded');
  errorScreen.hidden = false;
  byId('errorMessage').textContent = error.message;
  liveLabel.textContent = 'RENDER OFFLINE';
}
