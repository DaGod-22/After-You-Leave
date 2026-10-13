// Shared deterministic math utilities. No DOM access: this module runs in Node tests too.

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Seeded PRNG (mulberry32). `state` is serialisable so a world can resume deterministically. */
export class RNG {
  constructor(seed = 1) {
    this.state = (seed >>> 0) || 0x9e3779b9;
  }
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) {
    return a + (b - a) * this.next();
  }
  int(n) {
    return Math.floor(this.next() * n);
  }
  chance(p) {
    return this.next() < p;
  }
  gauss(sd = 1) {
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sd;
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sq = (x) => x * x;
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Seeded 2D value noise + fbm. Returns functions in roughly [0,1] (noise) and [-1,1] (fbm). */
export function makeNoise(rng) {
  const vals = new Float32Array(256);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    vals[i] = rng.next();
    p[i] = i;
  }
  for (let i = 255; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const lat = (ix, iy) => vals[perm[(perm[ix & 255] + iy) & 255]];
  function noise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = lat(xi, yi);
    const b = lat(xi + 1, yi);
    const c = lat(xi, yi + 1);
    const d = lat(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, oct = 4) {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * (noise(x * f, y * f) * 2 - 1);
      n += a;
      a *= 0.5;
      f *= 2.03;
    }
    return s / n;
  }
  function ridged(x, y, oct = 4) {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) {
      const v = 1 - Math.abs(noise(x * f, y * f) * 2 - 1);
      s += a * v * v;
      n += a;
      a *= 0.5;
      f *= 2.1;
    }
    return s / n; // roughly 0..1
  }
  return { noise, fbm, ridged };
}
