// Banco de luzes pontuais dinâmicas consumido pelo lighting pass (PBR) e
// pelo passe de poeira. Os dados viajam como dois arrays vec4:
//   A = posição xy, altura z, raio        B = cor rgb, intensidade
// A avaliação por-pixel (atenuação + sombra) vive no GLSL; aqui ficam a
// definição das luzes da cena e a animação temporal (flicker/pulso/sweep).

export const MAX_POINT_LIGHTS = 4;

const LIGHT_DEFINITIONS = Object.freeze([
  { name: 'headlight', position: [0.758, 0.492, 0.20, 0.44], color: [0.72, 0.85, 1.00], intensity: 2.7 },
  { name: 'engine', position: [0.352, 0.442, 0.16, 0.36], color: [1.00, 0.36, 0.10], intensity: 2.1 },
  { name: 'beacon', position: [0.755, 0.338, 0.13, 0.27], color: [1.00, 0.20, 0.05], intensity: 1.6 },
  { name: 'worklight', position: [0.148, 0.368, 0.14, 0.31], color: [0.30, 0.76, 0.92], intensity: 1.5 }
]);

export class DynamicLightBank {
  constructor() {
    this.dataA = new Float32Array(MAX_POINT_LIGHTS * 4);
    this.dataB = new Float32Array(MAX_POINT_LIGHTS * 4);
    this.lights = LIGHT_DEFINITIONS.map((definition) => ({
      name: definition.name,
      position: definition.position.slice(),
      color: definition.color.slice(),
      intensity: definition.intensity
    }));
  }

  locations(gl, program) {
    return {
      a: gl.getUniformLocation(program, 'uPointLightsA[0]'),
      b: gl.getUniformLocation(program, 'uPointLightsB[0]'),
      global: gl.getUniformLocation(program, 'uPointLightGlobal')
    };
  }

  apply(gl, locations, globalIntensity) {
    if (!locations) return;
    if (locations.a) gl.uniform4fv(locations.a, this.dataA);
    if (locations.b) gl.uniform4fv(locations.b, this.dataB);
    if (locations.global) gl.uniform1f(locations.global, globalIntensity);
  }

  update(time, enabled, globalIntensity = 1) {
    const a = this.dataA;
    const b = this.dataB;
    for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
      const light = this.lights[i];
      const offset = i * 4;
      let x = light.position[0];
      let y = light.position[1];
      let multiplier = enabled ? globalIntensity : 0;

      if (light.name === 'headlight') {
        // Varredura lenta do farol da nave.
        x += Math.sin(time * 0.43) * 0.010;
        y += Math.sin(time * 0.71) * 0.006;
      } else if (light.name === 'engine') {
        // Flicker de exaustão: soma de senos dessincronizados, sem ruído caro.
        multiplier *= 0.82 + 0.13 * Math.sin(time * 31.0) + 0.05 * Math.sin(time * 47.3 + 1.7);
      } else if (light.name === 'beacon') {
        const pulse = Math.pow(0.5 + 0.5 * Math.sin(time * 2.4), 6.0);
        multiplier *= 0.18 + pulse * 1.5;
      }

      a[offset] = x;
      a[offset + 1] = y;
      a[offset + 2] = light.position[2];
      a[offset + 3] = light.position[3];
      b[offset] = light.color[0];
      b[offset + 1] = light.color[1];
      b[offset + 2] = light.color[2];
      b[offset + 3] = light.intensity * multiplier;
    }
    return { a: this.dataA, b: this.dataB };
  }

  // Estimativa JS da iluminação pontual num ponto — útil para telemetria,
  // áudio reativo e testes; o caminho quente usa a versão GLSL.
  estimateAt(x, y) {
    let total = 0;
    for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
      const offset = i * 4;
      const dx = this.dataA[offset] - x;
      const dy = this.dataA[offset + 1] - y;
      const dz = this.dataA[offset + 2];
      const radius = this.dataA[offset + 3];
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance >= radius) continue;
      const cutoff = Math.max(0, 1 - Math.pow(distance / radius, 4));
      total += this.dataB[offset + 3] / (1 + 0.9 * distance + 6 * distance * distance) * cutoff * cutoff;
    }
    return total;
  }
}
