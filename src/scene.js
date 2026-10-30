const FLOATS_PER_INSTANCE = 16;

export class SceneBatch {
  constructor(gl, maxInstances = 64) {
    this.gl = gl;
    this.maxInstances = maxInstances;
    this.count = 0;
    this.data = new Float32Array(maxInstances * FLOATS_PER_INSTANCE);
    this.vao = gl.createVertexArray();
    this.quadBuffer = gl.createBuffer();
    this.instanceBuffer = gl.createBuffer();

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const stride = FLOATS_PER_INSTANCE * 4;
    for (let i = 0; i < 4; i++) {
      const location = 1 + i;
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 4, gl.FLOAT, false, stride, i * 16);
      gl.vertexAttribDivisor(location, 1);
    }
    gl.bindVertexArray(null);
  }

  add(cx, cy, width, height, r, g, b, a, roughness, metallic, emission, type, rotation, seed, depth, variant) {
    if (this.count >= this.maxInstances) throw new Error('SceneBatch: capacidade máxima excedida');
    const offset = this.count * FLOATS_PER_INSTANCE;
    const data = this.data;
    data[offset] = cx;
    data[offset + 1] = cy;
    data[offset + 2] = width;
    data[offset + 3] = height;
    data[offset + 4] = r;
    data[offset + 5] = g;
    data[offset + 6] = b;
    data[offset + 7] = a;
    data[offset + 8] = roughness;
    data[offset + 9] = metallic;
    data[offset + 10] = emission;
    data[offset + 11] = type;
    data[offset + 12] = rotation;
    data[offset + 13] = seed;
    data[offset + 14] = depth;
    data[offset + 15] = variant;
    this.count++;
  }

  upload() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * FLOATS_PER_INSTANCE);
  }

  draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
  }
}

function terrainApprox(x) {
  let h = 0.245 + Math.sin(x * 9 + 0.4) * 0.026 + Math.sin(x * 21) * 0.014;
  h -= Math.exp(-Math.pow((x - 0.37) / 0.075, 2)) * 0.025;
  h -= Math.exp(-Math.pow((x - 0.72) / 0.055, 2)) * 0.018;
  return h;
}

export function buildScene(gl) {
  const scene = new SceneBatch(gl, 64);

  // Painter order: céu, serras distantes, regolito e finalmente objetos próximos.
  scene.add(0.5, 0.5, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0);
  scene.add(0.5, 0.5, 1, 1, 0.24, 0.12, 0.13, 1, 0.95, 0, 0, 1, 0, 2.7, 0.86, 0);
  scene.add(0.5, 0.5, 1, 1, 0.42, 0.18, 0.09, 1, 0.9, 0, 0, 2, 0, 1.3, 0.48, 0);

  // Painéis solares: baixa rugosidade e alta metalicidade para exercitar o SSR.
  let x = 0.145;
  let h = 0.105;
  scene.add(x, terrainApprox(x) + h * 0.37, 0.145, h, 0.12, 0.2, 0.28, 1, 0.2, 0.82, 0, 5, -0.09, 2.1, 0.25, 0);
  x = 0.84;
  h = 0.09;
  scene.add(x, terrainApprox(x) + h * 0.37, 0.12, h, 0.1, 0.18, 0.25, 1, 0.18, 0.88, 0, 5, 0.12, 3.4, 0.25, 0);

  // Cargas e beacon de navegação.
  x = 0.695;
  h = 0.072;
  scene.add(x, terrainApprox(x) + h * 0.37, 0.09, h, 0.32, 0.19, 0.11, 1, 0.38, 0.55, 0, 6, -0.025, 4.3, 0.2, 0);
  x = 0.755;
  h = 0.052;
  scene.add(x, terrainApprox(x) + h * 0.38, 0.064, h, 0.21, 0.24, 0.25, 1, 0.3, 0.72, 0, 6, 0.04, 7.1, 0.19, 1);
  x = 0.055;
  h = 0.09;
  scene.add(x, terrainApprox(x) + h * 0.36, 0.045, h, 0.24, 0.19, 0.15, 1, 0.5, 0.45, 0, 6, -0.06, 6.2, 0.24, 2);

  // Rochas maiores, posicionadas manualmente para compor o primeiro plano.
  const rockData = [
    [0.025, 0.10, 0.072, 0.31], [0.245, 0.065, 0.052, 0.36],
    [0.325, 0.042, 0.035, 0.39], [0.45, 0.08, 0.055, 0.35],
    [0.61, 0.038, 0.032, 0.37], [0.925, 0.115, 0.083, 0.31],
    [0.985, 0.055, 0.047, 0.34]
  ];
  for (let i = 0; i < rockData.length; i++) {
    const rock = rockData[i];
    const rx = rock[0];
    const rw = rock[1];
    const rh = rock[2];
    scene.add(rx, terrainApprox(rx) + rh * 0.29, rw, rh, 0.28, 0.13, 0.075, 1, 0.84, 0.02, 0, 3, (i - 3) * 0.055, i * 1.71 + 0.4, rock[3], 0);
  }

  // Pequenos detalhes usam o mesmo buffer e não adicionam draw calls.
  let randomState = 918273;
  for (let i = 0; i < 15; i++) {
    randomState = (randomState * 16807) % 2147483647;
    const rx = 0.04 + (randomState / 2147483647) * 0.92;
    randomState = (randomState * 16807) % 2147483647;
    const size = 0.012 + (randomState / 2147483647) * 0.018;
    scene.add(rx, terrainApprox(rx) + size * 0.16, size * 1.35, size, 0.3, 0.14, 0.08, 1, 0.9, 0, 0, 3, 0, i * 0.83 + 9.2, 0.4, 0);
  }

  // ARES-7: casco metálico, canopy emissivo e painéis modulares.
  scene.add(0.56, 0.475, 0.41, 0.245, 0.48, 0.52, 0.55, 1, 0.24, 0.88, 0, 4, -0.025, 5.7, 0.16, 0);

  scene.upload();
  return scene;
}
