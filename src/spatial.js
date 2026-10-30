// Particionamento espacial + LOD para a cena 2D.
// Um grid uniforme é suficiente (e previsível) para o mundo 0..1 da engine:
// cada entidade é inserida nas células cobertas pelo seu AABB e consultas
// por viewport devolvem apenas as entidades potencialmente visíveis.

export function makeBounds(cx, cy, width, height, padding = 0) {
  const hw = width * 0.5 + padding;
  const hh = height * 0.5 + padding;
  return { minX: cx - hw, minY: cy - hh, maxX: cx + hw, maxY: cy + hh };
}

export function boundsIntersect(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export class SpatialGrid {
  constructor(cellSize = 0.125) {
    this.cellSize = Math.max(0.01, cellSize);
    this.cells = new Map();
    this.count = 0;
  }

  cellKey(cx, cy) {
    return `${cx},${cy}`;
  }

  insert(index, bounds) {
    const minCx = Math.floor(bounds.minX / this.cellSize);
    const maxCx = Math.floor(bounds.maxX / this.cellSize);
    const minCy = Math.floor(bounds.minY / this.cellSize);
    const maxCy = Math.floor(bounds.maxY / this.cellSize);
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const key = this.cellKey(cx, cy);
        let bucket = this.cells.get(key);
        if (!bucket) {
          bucket = [];
          this.cells.set(key, bucket);
        }
        bucket.push(index);
      }
    }
    this.count++;
  }

  query(bounds, out = new Set()) {
    out.clear();
    const minCx = Math.floor(bounds.minX / this.cellSize);
    const maxCx = Math.floor(bounds.maxX / this.cellSize);
    const minCy = Math.floor(bounds.minY / this.cellSize);
    const maxCy = Math.floor(bounds.maxY / this.cellSize);
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.cells.get(this.cellKey(cx, cy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) out.add(bucket[i]);
      }
    }
    return out;
  }

  clear() {
    this.cells.clear();
    this.count = 0;
  }
}

// LOD geométrico/de shader: 0 = detalhe total perto do foco ou grande em
// tela, 1 = intermediário, 2 = distante/pequeno (micro-detalhe suprimido
// no fragment shader da cena).
export function lodForBounds(bounds, focusX, focusY) {
  const cx = (bounds.minX + bounds.maxX) * 0.5;
  const cy = (bounds.minY + bounds.maxY) * 0.5;
  const size = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const distance = Math.hypot(cx - focusX, cy - focusY);
  if (size >= 0.22 || distance < 0.28) return 0;
  if (size >= 0.055 || distance < 0.52) return 1;
  return 2;
}
