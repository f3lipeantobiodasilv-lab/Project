// Física 2D mínima e determinística o bastante para gameplay:
// círculos dinâmicos contra o heightfield do terreno e AABBs estáticos,
// com resposta por impulso (restituição + atrito tangencial). Impactos
// fortes são publicados via onImpact — a engine converte isso em debris,
// poeira e áudio espacial sem a física conhecer renderização.

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class PhysicsWorld {
  constructor({ gravity = -0.62, terrainHeight, statics = [], onImpact = null, random = Math.random } = {}) {
    if (typeof terrainHeight !== 'function') throw new Error('PhysicsWorld: terrainHeight é obrigatório.');
    this.gravity = gravity;
    this.terrainHeight = terrainHeight;
    this.statics = statics.slice();
    this.onImpact = onImpact;
    this.random = random;
    this.bodies = [];
    this.time = 0;
    this.probe = this.addCircle({
      x: 0.3, y: 0.95, radius: 0.016, vx: 0.015, vy: 0,
      restitution: 0.42, friction: 0.72, kind: 'probe'
    });
    this.probeTimer = 0;
    this.probeImpacts = 0;
  }

  addCircle({ x, y, radius, vx = 0, vy = 0, restitution = 0.35, friction = 0.8, kind = 'body' }) {
    const body = { x, y, radius, vx, vy, restitution, friction, kind, active: true, resting: false };
    this.bodies.push(body);
    return body;
  }

  addStaticAABB(minX, minY, maxX, maxY, kind = 'static') {
    const box = { minX, minY, maxX, maxY, kind };
    this.statics.push(box);
    return box;
  }

  respawnProbe() {
    const probe = this.probe;
    probe.x = 0.12 + this.random() * 0.76;
    probe.y = 0.92 + this.random() * 0.05;
    probe.vx = (this.random() - 0.5) * 0.05;
    probe.vy = 0;
    probe.active = true;
    probe.resting = false;
    this.probeImpacts = 0;
    this.probeTimer = 0;
  }

  reset() {
    this.time = 0;
    this.respawnProbe();
  }

  emitImpact(body, impactSpeed, nx, ny, surface) {
    if (impactSpeed < 0.08 || !this.onImpact) return;
    this.onImpact({
      x: body.x, y: body.y,
      intensity: clamp((impactSpeed - 0.08) * 2.4, 0.08, 1),
      impactSpeed, nx, ny, surface, kind: body.kind, time: this.time
    });
    if (body.kind === 'probe') this.probeImpacts++;
  }

  collideTerrain(body) {
    const floor = this.terrainHeight(body.x) + body.radius;
    if (body.y >= floor) return;
    const impactSpeed = body.vy < 0 ? -body.vy : 0;
    body.y = floor;
    // Normal aproximada do heightfield por diferença central.
    const slope = (this.terrainHeight(body.x + 0.004) - this.terrainHeight(body.x - 0.004)) / 0.008;
    const invLength = 1 / Math.hypot(slope, 1);
    const nx = -slope * invLength;
    const ny = invLength;
    const vn = body.vx * nx + body.vy * ny;
    if (vn < 0) {
      const impulse = -(1 + body.restitution) * vn;
      body.vx += impulse * nx;
      body.vy += impulse * ny;
      // Atrito tangencial proporcional ao impulso normal.
      const tx = -ny;
      const ty = nx;
      const vt = body.vx * tx + body.vy * ty;
      body.vx -= vt * (1 - body.friction) * tx;
      body.vy -= vt * (1 - body.friction) * ty;
      this.emitImpact(body, impactSpeed, nx, ny, 'terrain');
    }
    body.resting = Math.abs(body.vy) < 0.018 && Math.abs(body.vx) < 0.018;
  }

  collideStatics(body) {
    for (let i = 0; i < this.statics.length; i++) {
      const box = this.statics[i];
      const closestX = clamp(body.x, box.minX, box.maxX);
      const closestY = clamp(body.y, box.minY, box.maxY);
      const dx = body.x - closestX;
      const dy = body.y - closestY;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq >= body.radius * body.radius) continue;

      let nx;
      let ny;
      let penetration;
      if (distanceSq > 1e-10) {
        const distance = Math.sqrt(distanceSq);
        nx = dx / distance;
        ny = dy / distance;
        penetration = body.radius - distance;
      } else {
        // Centro dentro da caixa: sai pelo lado de menor penetração.
        const left = body.x - box.minX;
        const right = box.maxX - body.x;
        const bottom = body.y - box.minY;
        const top = box.maxY - body.y;
        const min = Math.min(left, right, bottom, top);
        nx = min === left ? -1 : min === right ? 1 : 0;
        ny = min === bottom ? -1 : min === top ? 1 : 0;
        penetration = min + body.radius;
      }
      body.x += nx * penetration;
      body.y += ny * penetration;
      const vn = body.vx * nx + body.vy * ny;
      if (vn < 0) {
        const impactSpeed = -vn;
        const impulse = -(1 + body.restitution) * vn;
        body.vx += impulse * nx;
        body.vy += impulse * ny;
        const tx = -ny;
        const ty = nx;
        const vt = body.vx * tx + body.vy * ty;
        body.vx -= vt * (1 - body.friction) * tx;
        body.vy -= vt * (1 - body.friction) * ty;
        this.emitImpact(body, impactSpeed, nx, ny, box.kind);
      }
    }
  }

  step(dt) {
    if (!(dt > 0)) return;
    const clamped = Math.min(dt, 0.05);
    const substeps = Math.max(1, Math.min(4, Math.ceil(clamped / (1 / 120))));
    const stepDt = clamped / substeps;
    this.time += clamped;

    if (!this.probe.active) {
      this.probeTimer += clamped;
      if (this.probeTimer > 1.4) this.respawnProbe();
    }

    for (let s = 0; s < substeps; s++) {
      for (let i = 0; i < this.bodies.length; i++) {
        const body = this.bodies[i];
        if (!body.active) continue;
        body.vy += this.gravity * stepDt;
        body.x += body.vx * stepDt;
        body.y += body.vy * stepDt;
        if (body.x < body.radius) { body.x = body.radius; body.vx = Math.abs(body.vx) * body.restitution; }
        if (body.x > 1 - body.radius) { body.x = 1 - body.radius; body.vx = -Math.abs(body.vx) * body.restitution; }
        this.collideStatics(body);
        this.collideTerrain(body);
      }
    }

    if (this.probe.active && (this.probe.resting || this.probeImpacts >= 4)) {
      this.probe.active = false;
      this.probeTimer = 0;
    }
  }
}
