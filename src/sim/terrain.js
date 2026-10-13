// Procedural island habitat: a rimmed basin with rolling hills, terraced cliffs, a winding pond,
// a handful of cave sites and static decor (rocks, pebbles, fallen branches, mineral crystals).
// Everything is derived from the world seed + config, so terrain is regenerated on load rather than saved.
import { RNG, hashString, makeNoise, smoothstep, clamp, lerp } from './math.js';

export const WORLD_SIZE = 160;
export const TERRAIN_RES = 129; // vertices per side
export const WATER_LEVEL = 0;
export const CELLS = 64; // ecological grid resolution
export const CELL_SIZE = WORLD_SIZE / CELLS;

export class Terrain {
  constructor(data) {
    this.size = WORLD_SIZE;
    this.half = WORLD_SIZE / 2;
    this.res = TERRAIN_RES;
    this.spacing = WORLD_SIZE / (TERRAIN_RES - 1);
    this.heights = data.heights;
    this.waterLevel = WATER_LEVEL;
    this.caves = data.caves;
    this.decor = data.decor;
    this.pond = data.pond;
    this.config = data.config;
  }
  /** Bilinear height sample. */
  heightAt(x, z) {
    const fx = clamp((x + this.half) / this.spacing, 0, this.res - 1.001);
    const fz = clamp((z + this.half) / this.spacing, 0, this.res - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const H = this.heights, R = this.res;
    const a = H[j * R + i], b = H[j * R + i + 1], c = H[(j + 1) * R + i], d = H[(j + 1) * R + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  /** Surface normal from finite differences (y-up). */
  normalAt(x, z) {
    const e = this.spacing;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const n = [-dx / (2 * e), 1, -dz / (2 * e)];
    const l = Math.hypot(n[0], n[1], n[2]);
    return [n[0] / l, n[1] / l, n[2] / l];
  }
  slopeAt(x, z) {
    const n = this.normalAt(x, z);
    return Math.sqrt(1 - n[1] * n[1]);
  }
  depthAt(x, z) {
    return Math.max(0, this.waterLevel - this.heightAt(x, z));
  }
  inBounds(x, z) {
    return Math.abs(x) < this.half - 1 && Math.abs(z) < this.half - 1;
  }
}

export function generateTerrain(seed, configOverride = {}) {
  const rng = new RNG(hashString('terrain:' + seed));
  const N = makeNoise(rng);
  const half = WORLD_SIZE / 2;
  const R = TERRAIN_RES;
  const sp = WORLD_SIZE / (R - 1);
  const config = {
    relief: configOverride.relief ?? rng.range(0.85, 1.2),
    pondSize: configOverride.pondSize ?? rng.range(0.85, 1.2),
    pondX: rng.range(-16, 16),
    pondZ: rng.range(-14, 14),
    offX: rng.range(-40, 40),
    offZ: rng.range(-40, 40),
  };
  const ph = [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)];
  const pondR0 = 15 * config.pondSize;
  const pondRadius = (th) =>
    pondR0 * (1 + 0.2 * Math.sin(2 * th + ph[0]) + 0.12 * Math.sin(3 * th + ph[1]) + 0.06 * Math.sin(5 * th + ph[2]));
  const pondSDF = (x, z) => {
    const dx = x - config.pondX, dz = z - config.pondZ;
    return Math.hypot(dx, dz) - pondRadius(Math.atan2(dz, dx));
  };

  function heightFn(x, z) {
    const u = x / half, v = z / half;
    const r = Math.hypot(u, v);
    const wob = N.fbm(x * 0.02 + config.offX, z * 0.02 + config.offZ, 3) * 0.16;
    const island = 1 - smoothstep(0.68, 0.98, r * (1 + wob));
    const rim = smoothstep(0.8, 1.0, r);
    const hills = 0.5 + 0.5 * N.fbm(x * 0.03 + 7, z * 0.03 - 3, 4);
    const ridge = N.ridged(x * 0.05 + 3, z * 0.05 + 11, 4);
    let h = 1.6 + island * (5.5 * hills + 6.5 * ridge * config.relief) + rim * 13;
    // Gentle valley around the pond so the water sits in a basin.
    const dpx = x - config.pondX, dpz = z - config.pondZ;
    h -= 3.2 * Math.exp(-(dpx * dpx + dpz * dpz) / (2 * 15 * 15));
    // Terraced cliffs on part of the island.
    const tt = h / 2.4;
    const fl = Math.floor(tt);
    const terr = (fl + smoothstep(0.55, 0.85, tt - fl)) * 2.4;
    const cliffMask = island * smoothstep(0.42, 0.7, N.noise(x * 0.035 + 20, z * 0.035 - 9)) * 0.75;
    h = lerp(h, terr, cliffMask);
    // Pond carve with soft shoreline.
    const sdf = pondSDF(x, z);
    const depthT = smoothstep(0.0, -6.5, sdf);
    const bed = WATER_LEVEL - 0.12 - 2.6 * depthT + 0.35 * N.fbm(x * 0.12, z * 0.12, 2);
    h = lerp(h, Math.min(h, bed), 1 - smoothstep(-0.6, 2.8, sdf));
    // Fine ground variation.
    h += 0.18 * N.fbm(x * 0.22 + 40, z * 0.22 - 17, 2);
    return h;
  }

  const heights = new Float32Array(R * R);
  for (let j = 0; j < R; j++) {
    for (let i = 0; i < R; i++) {
      heights[j * R + i] = heightFn(-half + i * sp, -half + j * sp);
    }
  }
  const terrain = new Terrain({ heights, caves: [], decor: [], pond: { cx: config.pondX, cz: config.pondZ }, config });

  // Cave sites: steep spots on the upper inner slopes.
  const caves = [];
  const cands = [];
  for (let k = 0; k < 500; k++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = rng.range(0.45, 0.72) * half;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const s = terrain.slopeAt(x, z);
    const h = terrain.heightAt(x, z);
    if (h > 3.5 && s > 0.45) cands.push({ x, z, s, h });
  }
  cands.sort((p, q) => q.s - p.s);
  for (const c of cands) {
    if (caves.length >= 2) break;
    if (caves.every((o) => Math.hypot(o.x - c.x, o.z - c.z) > 45)) {
      const n = terrain.normalAt(c.x, c.z);
      const facing = Math.atan2(n[2], n[0]);
      caves.push({ x: c.x, z: c.z, facing, id: caves.length });
    }
  }
  terrain.caves = caves;

  // Decor
  const decor = [];
  const place = (k, x, z, s, c) => {
    const y = terrain.heightAt(x, z);
    decor.push({ k, x, y, z, s, ry: rng.range(0, Math.PI * 2), rx: rng.range(-0.25, 0.25), rz: rng.range(-0.25, 0.25), c });
  };
  let tries = 0;
  let rocks = 0;
  while (rocks < 70 && tries < 4000) {
    tries++;
    const x = rng.range(-half + 6, half - 6), z = rng.range(-half + 6, half - 6);
    const h = terrain.heightAt(x, z);
    if (h < 0.5) continue;
    const s = terrain.slopeAt(x, z);
    if (s > 0.9) continue;
    place('rock', x, z, rng.range(0.5, 1.9) * (s > 0.5 ? 1.3 : 1), rng.range(0, 1));
    rocks++;
  }
  for (let i = 0; i < 90; i++) {
    // pebbles around the shoreline
    const a = rng.range(0, Math.PI * 2);
    const rr = pondR0 * rng.range(0.9, 1.15);
    const x = config.pondX + Math.cos(a) * rr, z = config.pondZ + Math.sin(a) * rr;
    if (Math.abs(x) > half - 6 || Math.abs(z) > half - 6) continue;
    place('pebble', x, z, rng.range(0.15, 0.4), rng.range(0, 1));
  }
  for (let i = 0; i < 14; i++) {
    const x = rng.range(-half + 12, half - 12), z = rng.range(-half + 12, half - 12);
    if (terrain.heightAt(x, z) < 1) continue;
    place('branch', x, z, rng.range(2.2, 4.2), rng.range(0, 1));
  }
  let minerals = 0;
  for (let i = 0; i < 1500 && minerals < 14; i++) {
    const x = rng.range(-half + 8, half - 8), z = rng.range(-half + 8, half - 8);
    if (terrain.slopeAt(x, z) > 0.55 && terrain.heightAt(x, z) > 2) {
      place('mineral', x, z, rng.range(0.6, 1.3), rng.range(0, 1));
      minerals++;
    }
  }
  for (const cv of caves) place('cavearch', cv.x, cv.z, 1.0, 0.5);
  terrain.decor = decor;
  return terrain;
}
