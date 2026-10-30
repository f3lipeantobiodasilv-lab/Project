// Áudio espacial com Web Audio API:
//  - cada emissor passa por um PannerNode em modo HRTF (posição derivada
//    das coordenadas de mundo 0..1 da engine);
//  - um ConvolverNode com resposta impulsiva gerada proceduralmente
//    (ruído com decaimento exponencial) simula a reverberação do cânion;
//  - dry/wet em paralelo para o master, como num send de reverb real.
// Nenhum asset externo é necessário: vento, hum da nave e impactos são
// sintetizados. A criação é preguiçosa (exige gesto do usuário).

export function createImpulseResponse(audioContext, duration = 1.9, decay = 2.8) {
  const sampleRate = audioContext.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * duration));
  const buffer = audioContext.createBuffer(2, length, sampleRate);
  let state = 22222;
  const random = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647 * 2 - 1;
  };
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = random() * Math.pow(1 - i / length, decay);
    }
  }
  return buffer;
}

export function worldToAudioPosition(x, y, depth = 0.4) {
  return {
    x: (x - 0.5) * 7,
    y: (y - 0.35) * 3.2,
    z: -0.6 - depth * 4.5
  };
}

export class SpatialAudioEngine {
  constructor({ audioContext } = {}) {
    const ContextClass = audioContext ? null : (globalThis.AudioContext || globalThis.webkitAudioContext);
    this.context = audioContext || (ContextClass ? new ContextClass() : null);
    if (!this.context) throw new Error('Web Audio API não está disponível neste navegador.');
    this.emitters = new Map();
    this.started = false;
    this.muted = false;

    const ctx = this.context;
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.82;
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = createImpulseResponse(ctx);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.34;
    this.dry.connect(this.master);
    this.convolver.connect(this.wet);
    this.wet.connect(this.master);
    this.master.connect(ctx.destination);
    this.setListener(0.56, 0.48, 0.16);
  }

  async start() {
    if (this.context.state === 'suspended') await this.context.resume();
    this.started = true;
    this.setMuted(this.muted);
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.85, this.context.currentTime, 0.05);
  }

  setListener(x, y, depth = 0.4) {
    const position = worldToAudioPosition(x, y, depth);
    const listener = this.context.listener;
    const now = this.context.currentTime;
    if (listener.positionX) {
      listener.positionX.setTargetAtTime(position.x, now, 0.08);
      listener.positionY.setTargetAtTime(position.y, now, 0.08);
      listener.positionZ.setTargetAtTime(position.z, now, 0.08);
      listener.forwardX.setTargetAtTime(0, now, 0.08);
      listener.forwardY.setTargetAtTime(0, now, 0.08);
      listener.forwardZ.setTargetAtTime(-1, now, 0.08);
      listener.upX.setTargetAtTime(0, now, 0.08);
      listener.upY.setTargetAtTime(1, now, 0.08);
      listener.upZ.setTargetAtTime(0, now, 0.08);
    } else if (listener.setPosition) {
      listener.setPosition(position.x, position.y, position.z);
      listener.setOrientation(0, 0, -1, 0, 1, 0);
    }
  }

  route(node) {
    node.connect(this.dry);
    node.connect(this.convolver);
  }

  createPanner(x, y, depth) {
    const position = worldToAudioPosition(x, y, depth);
    const panner = this.context.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1.1;
    panner.maxDistance = 14;
    panner.rolloffFactor = 1.15;
    if (panner.positionX) {
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
    } else {
      panner.setPosition(position.x, position.y, position.z);
    }
    this.route(panner);
    return panner;
  }

  setEmitterPosition(name, x, y, depth = 0.4) {
    const emitter = this.emitters.get(name);
    if (!emitter) return;
    const position = worldToAudioPosition(x, y, depth);
    const now = this.context.currentTime;
    if (emitter.panner.positionX) {
      emitter.panner.positionX.setTargetAtTime(position.x, now, 0.09);
      emitter.panner.positionY.setTargetAtTime(position.y, now, 0.09);
      emitter.panner.positionZ.setTargetAtTime(position.z, now, 0.09);
    } else {
      emitter.panner.setPosition(position.x, position.y, position.z);
    }
  }

  noiseBuffer(seconds = 2) {
    const ctx = this.context;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let state = 13579;
    for (let i = 0; i < data.length; i++) {
      state = (state * 16807) % 2147483647;
      data[i] = state / 2147483647 * 2 - 1;
    }
    return buffer;
  }

  addAmbientEmitters() {
    if (this.emitters.has('wind')) return;
    const ctx = this.context;

    // Vento do cânion: ruído filtrado em loop, espacializado ao centro.
    const windSource = ctx.createBufferSource();
    windSource.buffer = this.noiseBuffer(3);
    windSource.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 420;
    windFilter.Q.value = 0.55;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.045;
    const windPanner = this.createPanner(0.5, 0.42, 0.8);
    windSource.connect(windFilter).connect(windGain).connect(windPanner);
    windSource.start();
    this.emitters.set('wind', { panner: windPanner, gain: windGain, nodes: [windSource, windFilter] });

    // Hum do reator da ARES-7 + beacon periódico.
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 57;
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 180;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.016;
    const humPanner = this.createPanner(0.45, 0.47, 0.16);
    hum.connect(humFilter).connect(humGain).connect(humPanner);
    hum.start();
    this.emitters.set('ship', { panner: humPanner, gain: humGain, nodes: [hum, humFilter] });
  }

  playImpact(intensity = 0.5, x = 0.5, y = 0.3, depth = 0.45) {
    if (!this.started || this.muted) return;
    const ctx = this.context;
    const duration = 0.16 + intensity * 0.22;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer(duration);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500 + intensity * 1600;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08 + intensity * 0.3, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    const panner = this.createPanner(x, y, depth);
    source.connect(filter).connect(gain).connect(panner);
    source.start(now);
    source.stop(now + duration + 0.05);
    source.addEventListener('ended', () => {
      try { panner.disconnect(); } catch { /* nó já coletado */ }
    });
  }

  playBeacon() {
    if (!this.started || this.muted) return;
    const ctx = this.context;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1180;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.045, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    const panner = this.createPanner(0.755, 0.338, 0.2);
    osc.connect(gain).connect(panner);
    osc.start(now);
    osc.stop(now + 0.4);
  }

  dispose() {
    for (const emitter of this.emitters.values()) {
      for (const node of emitter.nodes || []) {
        try { node.stop?.(); } catch { /* já parado */ }
        try { node.disconnect(); } catch { /* idem */ }
      }
      try { emitter.panner.disconnect(); } catch { /* idem */ }
    }
    this.emitters.clear();
    if (this.context && this.context.state !== 'closed') void this.context.close();
  }
}
