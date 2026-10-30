// AssetManager assíncrono: fila nomeada de texturas, áudio e shaders com
// progresso por item e por bytes (quando o servidor informa Content-Length
// e o corpo pode ser lido em stream). fetch/createImageBitmap são
// injetáveis para permitir teste fora do navegador.
//
// Exemplo:
//   const assets = new AssetManager();
//   assets.register('shipSkin', 'texture', './textures/ship.webp');
//   assets.onProgress((event) => console.log(event.fraction));
//   const { texture } = await assets.loadTexture('shipSkin', gl);

export function uploadTexture(gl, image, { flipY = true, mipmap = true } = {}) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (mipmap && image.width > 0 && (image.width & (image.width - 1)) === 0 && (image.height & (image.height - 1)) === 0) {
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return texture;
}

export class AssetManager {
  constructor({ fetchImpl, createImageBitmapImpl, baseUrl = '' } = {}) {
    this.fetchImpl = fetchImpl || ((...args) => globalThis.fetch(...args));
    this.createImageBitmapImpl = createImageBitmapImpl || ((...args) => globalThis.createImageBitmap(...args));
    this.baseUrl = baseUrl;
    this.entries = new Map();
    this.progressListeners = new Set();
    this.loadedCount = 0;
  }

  register(name, type, url, options = {}) {
    if (!['texture', 'audio', 'shader', 'json', 'text'].includes(type)) {
      throw new Error(`AssetManager: tipo não suportado "${type}".`);
    }
    this.entries.set(name, { name, type, url: this.baseUrl + url, options, status: 'idle', data: null, error: null });
    return this;
  }

  onProgress(listener) {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  emitProgress(event) {
    const total = Math.max(1, this.entries.size);
    const payload = { ...event, loadedItems: this.loadedCount, totalItems: total, fraction: this.loadedCount / total };
    for (const listener of this.progressListeners) listener(payload);
  }

  async readBytes(response, entry) {
    const contentLength = Number(response.headers?.get?.('content-length')) || 0;
    const reader = response.body?.getReader?.();
    if (!reader) {
      const buffer = await response.arrayBuffer();
      this.emitProgress({ name: entry.name, type: entry.type, bytesLoaded: buffer.byteLength, bytesTotal: contentLength || buffer.byteLength });
      return new Uint8Array(buffer);
    }
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      this.emitProgress({ name: entry.name, type: entry.type, bytesLoaded: loaded, bytesTotal: contentLength });
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  async load(name, context = {}) {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`AssetManager: asset "${name}" não registrado.`);
    if (entry.status === 'ready') return entry.data;
    entry.status = 'loading';
    try {
      const response = await this.fetchImpl(entry.url);
      if (!response.ok) throw new Error(`HTTP ${response.status} ao carregar ${entry.url}`);
      const bytes = await this.readBytes(response, entry);
      let data;
      if (entry.type === 'texture') {
        const blob = new Blob([bytes], { type: response.headers?.get?.('content-type') || 'image/png' });
        const image = await this.createImageBitmapImpl(blob);
        data = { image, texture: context.gl ? uploadTexture(context.gl, image, entry.options) : null };
      } else if (entry.type === 'audio') {
        if (!context.audioContext) throw new Error('AssetManager: audioContext é obrigatório para assets de áudio.');
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        data = { audioBuffer: await context.audioContext.decodeAudioData(buffer) };
      } else if (entry.type === 'json') {
        data = { json: JSON.parse(new TextDecoder().decode(bytes)) };
      } else {
        // 'shader' e 'text' chegam como fonte pronta para compilar/usar.
        data = { source: new TextDecoder().decode(bytes) };
      }
      entry.data = data;
      entry.status = 'ready';
      this.loadedCount++;
      this.emitProgress({ name, type: entry.type, bytesLoaded: bytes.byteLength, bytesTotal: bytes.byteLength, done: true });
      return data;
    } catch (error) {
      entry.status = 'error';
      entry.error = error;
      this.emitProgress({ name, type: entry.type, error });
      throw error;
    }
  }

  async loadTexture(name, gl) {
    const entry = this.entries.get(name);
    if (!entry) this.register(name, 'texture', name);
    const data = await this.load(name, { gl });
    return data;
  }

  // Carrega tudo que foi registrado; falhas individuais não derrubam a
  // fila — o chamador decide o que é crítico inspecionando os resultados.
  async loadAll(context = {}) {
    const names = Array.from(this.entries.keys());
    const results = await Promise.allSettled(names.map((name) => this.load(name, context)));
    const summary = new Map();
    for (let i = 0; i < names.length; i++) {
      summary.set(names[i], results[i].status === 'fulfilled'
        ? { status: 'ready', data: results[i].value }
        : { status: 'error', error: results[i].reason });
    }
    return summary;
  }

  get(name) {
    const entry = this.entries.get(name);
    return entry && entry.status === 'ready' ? entry.data : null;
  }

  getStatus(name) {
    const entry = this.entries.get(name);
    return entry ? entry.status : 'missing';
  }
}
