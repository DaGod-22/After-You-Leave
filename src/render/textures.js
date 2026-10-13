// Procedural textures generated once at start-up: a tileable normal/height detail map for the ground
// and a soft radial alpha for contact shadows and lumen halos. No downloaded assets are needed.
import * as THREE from 'three';

function hash2(ix, iy, seed) {
  const s = Math.sin(ix * 127.1 + iy * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
/** Tileable value noise on a lattice of period P (0..P). */
function vnoise(x, y, P, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(((xi % P) + P) % P, ((yi % P) + P) % P, seed);
  const b = hash2((((xi + 1) % P) + P) % P, ((yi % P) + P) % P, seed);
  const c = hash2(((xi % P) + P) % P, (((yi + 1) % P) + P) % P, seed);
  const d = hash2((((xi + 1) % P) + P) % P, (((yi + 1) % P) + P) % P, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function makeDetailNormalMap(size = 256, seed = 3, strength = 2.2) {
  const h = new Float32Array(size * size);
  const octaves = [[8, 0.55], [16, 0.3], [32, 0.15]];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let s = 0;
      for (const [P, w] of octaves) s += w * vnoise((x / size) * P, (y / size) * P, P, seed + P);
      h[y * size + x] = s;
    }
  }
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
      const d = h[((y - 1 + size) % size) * size + x], u = h[((y + 1) % size) * size + x];
      let nx = -(r - l) * strength, ny = -(u - d) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** White disc with a soft falloff; used as an alpha map (shadows, halos). */
export function makeRadialTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.65)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
