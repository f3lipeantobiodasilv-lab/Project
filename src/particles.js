// Partículas atmosféricas em dois sistemas complementares:
//  - DustMotes: poeira ambiente 100% GPU (posição derivada de seed + tempo
//    no vertex shader; brilho amostrado do buffer de luz acumulada).
//  - DebrisParticles: pool CPU para eventos — explosões de impacto da
//    física e o rastro do corpo em queda. Sem alocação no loop: os arrays
//    são pré-alocados e partículas mortas saem por swap-with-last.

const QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);

function createQuadBuffer(gl) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
  return buffer;
}

export class DustMotes {
  constructor(gl, maxCount = 384) {
    this.gl = gl;
    this.maxCount = maxCount;
    this.activeCount = maxCount;
    this.vao = gl.createVertexArray();
    this.quadBuffer = createQuadBuffer(gl);
    this.seedBuffer = gl.createBuffer();

    const seeds = new Float32Array(maxCount * 4);
    let state = 1234567;
    for (let i = 0; i < seeds.length; i++) {
      state = (state * 16807) % 2147483647;
      seeds[i] = state / 2147483647;
    }
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.seedBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
  }

  // LOD dinâmico: presets e resolução adaptativa reduzem a contagem ativa
  // em vez de pagar o custo total das partículas fora de tela/detalhe.
  setActiveCount(count) {
    this.activeCount = Math.max(0, Math.min(this.maxCount, Math.round(count)));
  }

  draw(gl) {
    if (this.activeCount <= 0) return;
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.activeCount);
  }

  dispose(gl) {
    gl.deleteBuffer(this.quadBuffer);
    gl.deleteBuffer(this.seedBuffer);
    gl.deleteVertexArray(this.vao);
  }
}

export class DebrisParticles {
  constructor(gl, maxCount = 256) {
    this.gl = gl;
    this.maxCount = maxCount;
    this.alive = 0;
    this.positions = new Float32Array(maxCount * 2);
    this.velocities = new Float32Array(maxCount * 2);
    this.lifetimes = new Float32Array(maxCount * 2); // idade, vida total
    this.sizes = new Float32Array(maxCount);
    this.kinds = new Float32Array(maxCount);
    this.instanceData = new Float32Array(maxCount * 4);
    this.instanceMeta = new Float32Array(maxCount * 4);
    this.randomState = 987654321;

    this.vao = gl.createVertexArray();
    this.quadBuffer = createQuadBuffer(gl);
    this.dataBuffer = gl.createBuffer();
    this.metaBuffer = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dataBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.metaBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceMeta.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
  }

  random() {
    this.randomState = (this.randomState * 16807) % 2147483647;
    return this.randomState / 2147483647;
  }

  spawn(x, y, vx, vy, life, size, kind = 0) {
    if (this.alive >= this.maxCount) return;
    const i = this.alive++;
    this.positions[i * 2] = x;
    this.positions[i * 2 + 1] = y;
    this.velocities[i * 2] = vx;
    this.velocities[i * 2 + 1] = vy;
    this.lifetimes[i * 2] = 0;
    this.lifetimes[i * 2 + 1] = life;
    this.sizes[i] = size;
    this.kinds[i] = kind;
  }

  spawnBurst(x, y, intensity = 0.5, nx = 0, ny = 1) {
    const count = Math.round(6 + intensity * 22);
    const speed = 0.05 + intensity * 0.22;
    for (let i = 0; i < count; i++) {
      const spread = (this.random() - 0.5) * 1.7;
      const vx = (nx + spread * 0.8) * speed * (0.35 + this.random());
      const vy = (Math.abs(ny) + this.random() * 0.7) * speed * (0.35 + this.random());
      this.spawn(
        x, y, vx, vy,
        0.55 + this.random() * 1.15,
        0.004 + this.random() * 0.010,
        0
      );
    }
  }

  spawnProbeMarker(x, y) {
    this.spawn(x, y, 0, 0, 0.14, 0.013, 1);
  }

  clear() {
    this.alive = 0;
  }

  update(dt, wind = 0.4) {
    const gravity = -0.16;
    let i = 0;
    while (i < this.alive) {
      const age = this.lifetimes[i * 2] + dt;
      if (age >= this.lifetimes[i * 2 + 1] || this.positions[i * 2 + 1] < 0.02) {
        // Swap-with-last: O(1), sem alocação e sem buracos no buffer.
        const last = --this.alive;
        if (i !== last) {
          this.positions[i * 2] = this.positions[last * 2];
          this.positions[i * 2 + 1] = this.positions[last * 2 + 1];
          this.velocities[i * 2] = this.velocities[last * 2];
          this.velocities[i * 2 + 1] = this.velocities[last * 2 + 1];
          this.lifetimes[i * 2] = this.lifetimes[last * 2];
          this.lifetimes[i * 2 + 1] = this.lifetimes[last * 2 + 1];
          this.sizes[i] = this.sizes[last];
          this.kinds[i] = this.kinds[last];
        }
        continue;
      }
      this.lifetimes[i * 2] = age;
      // Debris (kind 0) cai e deriva com o vento; o marcador do corpo
      // (kind 1) é re-emitido a cada frame e não integra física própria.
      if (this.kinds[i] < 0.5) {
        this.velocities[i * 2 + 1] += gravity * dt * 0.35;
        this.velocities[i * 2] += wind * dt * 0.012;
        this.positions[i * 2] += this.velocities[i * 2] * dt;
        this.positions[i * 2 + 1] += this.velocities[i * 2 + 1] * dt;
      }
      i++;
    }
  }

  upload(gl) {
    for (let i = 0; i < this.alive; i++) {
      const lifeRatio = 1 - this.lifetimes[i * 2] / Math.max(this.lifetimes[i * 2 + 1], 0.001);
      this.instanceData[i * 4] = this.positions[i * 2];
      this.instanceData[i * 4 + 1] = this.positions[i * 2 + 1];
      this.instanceData[i * 4 + 2] = this.sizes[i] * (1 + (1 - lifeRatio) * 1.6);
      this.instanceData[i * 4 + 3] = lifeRatio;
      this.instanceMeta[i * 4] = this.kinds[i];
      this.instanceMeta[i * 4 + 1] = (i % 17) / 17;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dataBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData, 0, this.alive * 4);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.metaBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceMeta, 0, this.alive * 4);
  }

  draw(gl) {
    if (this.alive <= 0) return;
    this.upload(gl);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.alive);
  }

  dispose(gl) {
    gl.deleteBuffer(this.quadBuffer);
    gl.deleteBuffer(this.dataBuffer);
    gl.deleteBuffer(this.metaBuffer);
    gl.deleteVertexArray(this.vao);
  }
}
