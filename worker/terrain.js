export function createTerrain({ clamp }) {
  function sampleTerrainElevation(state, x, y) {
    const terrain = state.terrain;
    if (!terrain || !Array.isArray(terrain.grid)) {
      return null;
    }
    const w = terrain.width;
    const h = terrain.height;
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 2 || h < 2) {
      return null;
    }
    const u = clamp(x / state.width, 0, 1);
    const v = clamp(y / state.height, 0, 1);
    const gx = u * (w - 1);
    const gy = v * (h - 1);
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const x1 = Math.min(w - 1, x0 + 1);
    const y1 = Math.min(h - 1, y0 + 1);
    const tx = gx - x0;
    const ty = gy - y0;

    const idx00 = y0 * w + x0;
    const idx10 = y0 * w + x1;
    const idx01 = y1 * w + x0;
    const idx11 = y1 * w + x1;

    const z00 = terrain.grid[idx00];
    const z10 = terrain.grid[idx10];
    const z01 = terrain.grid[idx01];
    const z11 = terrain.grid[idx11];

    if (
      !Number.isFinite(z00) ||
      !Number.isFinite(z10) ||
      !Number.isFinite(z01) ||
      !Number.isFinite(z11)
    ) {
      const candidates = [
        { z: z00, dx: tx, dy: ty },
        { z: z10, dx: 1 - tx, dy: ty },
        { z: z01, dx: tx, dy: 1 - ty },
        { z: z11, dx: 1 - tx, dy: 1 - ty },
      ].filter((item) => Number.isFinite(item.z));

      if (candidates.length === 0) {
        return null;
      }

      candidates.sort(
        (a, b) => a.dx * a.dx + a.dy * a.dy - (b.dx * b.dx + b.dy * b.dy)
      );
      return candidates[0].z;
    }

    const z0 = z00 + (z10 - z00) * tx;
    const z1 = z01 + (z11 - z01) * tx;
    return z0 + (z1 - z0) * ty;
  }

  function applyTerrainToNode(state, node, force = false) {
    if (!state.terrain) {
      return;
    }
    if (!force && !node.terrainDriven && node.elevation !== null) {
      return;
    }
    node.elevation = sampleTerrainElevation(state, node.x, node.y);
  }

  function rebuildTerrainLayer(state) {
    const terrain = state.terrain;
    if (
      !terrain ||
      !Array.isArray(terrain.grid) ||
      !Number.isFinite(terrain.width) ||
      !Number.isFinite(terrain.height)
    ) {
      state.terrainLayer = null;
      return;
    }

    const w = terrain.width;
    const h = terrain.height;
    const grid = terrain.grid;
    if (grid.length !== w * h) {
      state.terrainLayer = null;
      return;
    }

    const min =
      Number.isFinite(terrain.min_elevation_m) ? terrain.min_elevation_m : null;
    const max =
      Number.isFinite(terrain.max_elevation_m) ? terrain.max_elevation_m : null;
    const range = min !== null && max !== null ? max - min : null;

    if (typeof OffscreenCanvas !== "function") {
      state.terrainLayer = null;
      return;
    }

    const layer = new OffscreenCanvas(w, h);
    const layerCtx = layer.getContext("2d");
    const image = layerCtx.createImageData(w, h);
    const data = image.data;

    for (let i = 0; i < grid.length; i += 1) {
      const z = grid[i];
      const offset = i * 4;
      if (!Number.isFinite(z) || min === null || max === null || range === null) {
        data[offset + 3] = 0;
        continue;
      }
      const t = range > 0 ? clamp((z - min) / range, 0, 1) : 0.5;
      const shade = Math.round(35 + t * 200);
      data[offset] = shade;
      data[offset + 1] = shade;
      data[offset + 2] = shade;
      data[offset + 3] = 255;
    }

    layerCtx.putImageData(image, 0, 0);
    state.terrainLayer = layer;
  }

  return { sampleTerrainElevation, applyTerrainToNode, rebuildTerrainLayer };
}

