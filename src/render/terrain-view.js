// Terrain mesh, pond water (3D shoreline from a per-vertex depth attribute) and static decor.
import * as THREE from 'three';
import { WORLD_SIZE, TERRAIN_RES, CELLS, CELL_SIZE, WATER_LEVEL } from '../sim/terrain.js';
import { GEOMS, PartPool } from './parts.js';

const HALF = WORLD_SIZE / 2;
const SP = WORLD_SIZE / (TERRAIN_RES - 1);
const C = (hex) => new THREE.Color(hex);
const PAL = {
  dry: C(0x9c8c64), moss: C(0x6b7a4a), jade: C(0x3f6156), rock: C(0x7d6a57),
  mineral: C(0xa6a58e), mud: C(0x4d4a3a), bed: C(0x5d5a48), shore: C(0x8f8464),
};
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ss = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
// Decor colour arrives as a 0..1 shade (rocks, pebbles), a hex number, an [r,g,b] array, or nothing.
function decorColour(c) {
  if (typeof c === 'number' && c <= 1) return new THREE.Color(0x5a4d40).lerp(new THREE.Color(0xa3978a), c); // shade 0..1
  if (typeof c === 'number') return new THREE.Color(c);
  if (Array.isArray(c) && c.length >= 3) return new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
  return new THREE.Color(0x7b6d5d);
}
function hash2(i, j) { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); }

function bilerpGrid(grid, x, z) {
  const fx = clamp01((x + HALF) / WORLD_SIZE) * CELLS - 0.5;
  const fz = clamp01((z + HALF) / WORLD_SIZE) * CELLS - 0.5;
  const i0 = Math.max(0, Math.min(CELLS - 1, Math.floor(fx)));
  const j0 = Math.max(0, Math.min(CELLS - 1, Math.floor(fz)));
  const i1 = Math.min(CELLS - 1, i0 + 1), j1 = Math.min(CELLS - 1, j0 + 1);
  const u = clamp01(fx - i0), v = clamp01(fz - j0);
  const a = grid[j0 * CELLS + i0], b = grid[j0 * CELLS + i1], c = grid[j1 * CELLS + i0], d = grid[j1 * CELLS + i1];
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

export class TerrainView {
  constructor(scene, world, mats) {
    this.scene = scene;
    this.world = world;
    const T = world.terrain;
    this.T = T;
    const R = TERRAIN_RES;
    const N = R * R;
    const pos = new Float32Array(N * 3);
    const depth = new Float32Array(N);
    this.ao = new Float32Array(N);
    this.slope = new Float32Array(N);
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < R; i++) {
        const k = j * R + i;
        const x = -HALF + i * SP, z = -HALF + j * SP;
        const h = T.heights[k];
        pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
        depth[k] = Math.max(0, WATER_LEVEL - h);
      }
    }
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < R; i++) {
        const k = j * R + i;
        const h = T.heights[k];
        let avg = 0, n = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= R || jj >= R) continue;
          avg += T.heights[jj * R + ii]; n++;
        }
        const concave = avg / n - h; // >0 means we're in a hollow
        this.ao[k] = clamp01(1 - Math.max(0, concave) * 0.35);
        const x = -HALF + i * SP, z = -HALF + j * SP;
        this.slope[k] = T.slopeAt(x, z);
      }
    }
    const idx = [];
    for (let j = 0; j < R - 1; j++) {
      for (let i = 0; i < R - 1; i++) {
        const a = j * R + i, b = a + 1, c = a + R, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.colAttr = new THREE.BufferAttribute(new Float32Array(N * 3), 3);
    g.setAttribute('color', this.colAttr);
    g.setIndex(idx);
    g.computeVertexNormals();
    this.geom = g;
    const tm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
    tm.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vWp;
        float th(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(th(i), th(i+vec2(1,0)), f.x), mix(th(i+vec2(0,1)), th(i+vec2(1,1)), f.x), f.y); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float grain = vn(vWp.xz * 0.9) * 0.6 + vn(vWp.xz * 3.7) * 0.4;
          diffuseColor.rgb *= 0.86 + 0.26 * grain;
          float speck = step(0.93, th(floor(vWp.xz * 6.0)));
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 1.2, 1.1), speck * 0.35);`);
    };
    this.mesh = new THREE.Mesh(g, tm);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'terrain';
    scene.add(this.mesh);

    // Water surface: same grid, per-vertex depth → discard above the bed gives the shoreline.
    const wg = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, R - 1, R - 1);
    wg.rotateX(-Math.PI / 2);
    // PlaneGeometry vertex order differs from ours: rebuild depth in its order
    const wp = wg.attributes.position;
    const dAttr = new Float32Array(wp.count);
    for (let k = 0; k < wp.count; k++) {
      const x = wp.getX(k), z = wp.getZ(k);
      const i = Math.round((x + HALF) / SP), j = Math.round((z + HALF) / SP);
      dAttr[k] = depth[j * R + i];
    }
    wg.setAttribute('aDepth', new THREE.BufferAttribute(dAttr, 1));
    this.waterUniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uRain: { value: 0 }, uSun: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
      uSunCol: { value: new THREE.Color(1, 0.95, 0.85) }, uSky: { value: new THREE.Color(0.6, 0.7, 0.7) },
      uShallow: { value: C(0x5f9a8c) }, uDeep: { value: C(0x1d4650) }, uFoam: { value: C(0xd9d6c2) },
      uRip: { value: Array.from({ length: 16 }, () => new THREE.Vector4(0, 0, -99, 0)) },
      uDaylight: { value: 0.8 },
    }]);
    this.ripIdx = 0;
    const wm = new THREE.ShaderMaterial({
      uniforms: this.waterUniforms, fog: true, transparent: true, depthWrite: true,
      vertexShader: `
        attribute float aDepth; varying float vDepth; varying vec3 vWp;
        #include <fog_pars_vertex>
        void main(){
          vDepth = aDepth;
          vec4 wp = modelMatrix * vec4(position, 1.0); vWp = wp.xyz;
          vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform float uTime, uRain, uDaylight; uniform vec3 uSun; uniform vec3 uSunCol, uSky, uShallow, uDeep, uFoam;
        uniform vec4 uRip[16];
        varying float vDepth; varying vec3 vWp;
        #include <fog_pars_fragment>
        float hsh(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 9183.1); }
        float nz(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(hsh(i),hsh(i+vec2(1,0)),f.x), mix(hsh(i+vec2(0,1)),hsh(i+vec2(1,1)),f.x), f.y); }
        void main(){
          if (vDepth <= 0.0) discard;
          vec2 p = vWp.xz;
          vec2 g = vec2(0.0);
          // Gentle analytic wave field
          float w1 = 0.10 * cos(dot(p, vec2(0.7, 0.3)) * 1.6 + uTime * 0.9); g += 0.10*1.6*vec2(0.7,0.3)*-sin(dot(p, vec2(0.7,0.3))*1.6 + uTime*0.9)*0.5;
          float w2 = 0.06 * cos(dot(p, vec2(-0.4, 0.8)) * 2.3 + uTime * 1.3); g += 0.06*2.3*vec2(-0.4,0.8)*-sin(dot(p, vec2(-0.4,0.8))*2.3 + uTime*1.3)*0.5;
          float nn = nz(p * 0.7 + uTime * 0.05) - 0.5; g += vec2(nn * 0.08, -nn * 0.06);
          // Rain ripples: expanding rings from each impact
          for (int k = 0; k < 16; k++) {
            vec4 r = uRip[k];
            float age = uTime - r.z;
            if (age < 0.0 || age > 3.5) continue;
            vec2 dv = p - r.xy; float d = length(dv);
            float rr = d - age * 2.6;
            float env = exp(-rr * rr * 2.5) * exp(-age * 1.1) * r.w;
            float dr = -2.0 * 2.5 * rr * env + env * 0.0;
            g += normalize(dv + 1e-4) * dr * 0.35 * cos(rr * 9.0);
          }
          vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
          vec3 V = normalize(cameraPosition - vWp);
          float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.85 + 0.05;
          float depth = vDepth;
          vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 2.6, depth));
          vec3 R = reflect(-V, N);
          vec3 sky = mix(uSky * 0.85, uSky * 1.15 + vec3(0.02), clamp(R.y, 0.0, 1.0));
          vec3 col = mix(body, sky, fres);
          float spec = pow(max(dot(R, normalize(uSun)), 0.0), 140.0) * (1.0 - uRain * 0.6);
          col += uSunCol * spec * 1.4 * uDaylight;
          float shore = 1.0 - smoothstep(0.0, 0.32, depth);
          float foamN = 0.55 + 0.45 * nz(p * 3.1 + uTime * 0.25);
          col = mix(col, uFoam, clamp(shore * foamN * 0.75, 0.0, 0.85));
          float alpha = mix(0.66, 0.93, smoothstep(0.0, 2.2, depth)) + shore * 0.25;
          alpha = clamp(alpha, 0.0, 1.0);
          gl_FragColor = vec4(col, alpha);
          #include <fog_fragment>
        }`,
    });
    this.waterMat = wm;
    this.water = new THREE.Mesh(wg, wm);
    this.water.renderOrder = 2;
    this.water.receiveShadow = false;
    scene.add(this.water);

    // Pond cells for rain-ripple placement.
    this.pondPts = [];
    for (let k = 0; k < N; k++) if (depth[k] > 0.2) this.pondPts.push([pos[k * 3], pos[k * 3 + 2]]);

    this.buildDecor(scene, mats);
    this.refreshColours();
  }

  /** Recolour terrain from the live ecology: greenness, moisture and slope. */
  refreshColours() {
    const w = this.world;
    const R = TERRAIN_RES;
    const pos = this.geom.attributes.position;
    const arr = this.colAttr.array;
    for (let k = 0; k < R * R; k++) {
      const x = pos.getX(k), z = pos.getZ(k), h = pos.getY(k);
      const gr = bilerpGrid(w.greenness, x, z);
      const m = bilerpGrid(w.moist, x, z);
      const sl = this.slope[k];
      _c.copy(PAL.dry).lerp(PAL.moss, clamp01(0.15 + gr * 0.9 + m * 0.25));
      _c.lerp(PAL.jade, clamp01((m - 0.55) * 1.4) * 0.7);
      _c.lerp(PAL.rock, ss(0.4, 0.78, sl));
      if (h < 0.6 && h > WATER_LEVEL - 1.2) _c.lerp(PAL.shore, ss(1.0, 0.1, h) * 0.6);
      if (h <= WATER_LEVEL + 0.05) _c.lerp(PAL.bed, 0.75);
      const v = 0.92 + 0.16 * hash2(x * 0.7, z * 0.7);
      _c2.copy(_c).multiplyScalar(v * this.ao[k]);
      arr[k * 3] = _c2.r; arr[k * 3 + 1] = _c2.g; arr[k * 3 + 2] = _c2.b;
    }
    this.colAttr.needsUpdate = true;
  }

  buildDecor(scene, mats) {
    const T = this.T;
    const items = T.decor || [];
    const byKind = (k) => items.filter((d) => d.k === k);
    const rocks = byKind('rock'), pebbles = byKind('pebble'), branches = byKind('branch'), minerals = byKind('mineral');
    this.decorPools = [];
    const place = (pool, d, sx, sy, sz, geomRot = 0) => {
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(d.rx || 0, d.ry || 0, d.rz || 0));
      m.compose(new THREE.Vector3(d.x, d.y + sy * 0.2, d.z), q, new THREE.Vector3(sx, sy, sz));
      const cc = decorColour(d.c);
      pool.add(m, cc.r, cc.g, cc.b);
    };
    const mk = (geo, mat, n) => {
      const p = new PartPool(geo, mat, Math.max(4, n + 4));
      scene.add(p.mesh);
      this.decorPools.push(p);
      return p;
    };
    const rockPools = GEOMS.rock.map((g, i) => mk(g, mats.rock, rocks.length));
    const pRock = rockPools;
    const pPeb = mk(GEOMS.pebble, mats.rock, pebbles.length);
    const pBr = mk(GEOMS.branch, mats.wood, branches.length);
    const pMin = mk(GEOMS.crystal, mats.mineral, minerals.length);
    const pArch = mk(GEOMS.arch, mats.cave, (T.caves || []).length);
    for (const p of pRock) p.begin();
    pPeb.begin(); pBr.begin(); pMin.begin(); pArch.begin();
    rocks.forEach((d, i) => place(pRock[i % 3], d, d.s * 1.4, d.s * 1.0, d.s * 1.2));
    pebbles.forEach((d) => place(pPeb, d, d.s * 0.7, d.s * 0.55, d.s * 0.7));
    branches.forEach((d) => place(pBr, d, d.s * 0.4, d.s * 2.4, d.s * 0.4));
    minerals.forEach((d) => place(pMin, d, d.s * 0.4, d.s * 0.9, d.s * 0.4));
    for (const cv of T.caves || []) {
      const y = T.heightAt(cv.x, cv.z);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(cv.x, y - 0.2, cv.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, cv.facing || 0, 0)), new THREE.Vector3(3.2, 3.6, 2.2));
      pArch.add(m, 0.2, 0.19, 0.18);
    }
    for (const p of pRock) p.end();
    pPeb.end(); pBr.end(); pMin.end(); pArch.end();
    this.decorPools = [...pRock, pPeb, pBr, pMin, pArch];
  }

  update(sim) {
    const u = this.waterUniforms;
    u.uTime.value = sim.time;
    u.uRain.value = sim.rain;
    u.uSun.value.copy(sim.sunDir);
    u.uSunCol.value.copy(sim.sunCol);
    u.uSky.value.copy(sim.horizon);
    u.uDaylight.value = sim.daylight;
    this.water.material.uniforms = u;
  }

  addRipple(t, strength = 1) {
    if (!this.pondPts.length) return;
    const [x, z] = this.pondPts[(Math.random() * this.pondPts.length) | 0];
    const r = this.waterUniforms.uRip.value[this.ripIdx];
    r.set(x, z, t, strength);
    this.ripIdx = (this.ripIdx + 1) % 16;
  }

  dispose() {
    this.geom.dispose();
    this.mesh.material.dispose();
    this.water.geometry.dispose();
    this.waterMat.dispose();
    this.scene.remove(this.mesh, this.water);
    for (const p of this.decorPools) { this.scene.remove(p.mesh); p.mesh.dispose(); }
  }
}
