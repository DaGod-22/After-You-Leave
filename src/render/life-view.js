// Renders every living plant and animal from simulation state. Animals are articulated: two-segment legs
// with a gait, breathing, head turns, feeding and flight postures. Shapes come from phenotypes; colours and
// patterns come from genes; camouflage pulls the colour toward the local ground hue.
import * as THREE from 'three';
import { SPECIES } from '../sim/species.js';
import { animalPhenotype, plantPhenotype, pigment } from '../sim/genome.js';
import { WATER_LEVEL, CELLS, WORLD_SIZE } from '../sim/terrain.js';
import { PartPool, addWind, GEOMS, buildGeometries } from './parts.js';
import { CREATURE_GEO, CFG, blobGeometry } from './creatures.js';
import { makeRadialTexture } from './textures.js';
import { MAX_ANIMALS } from '../sim/species.js';

const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const SC = Array.from({ length: 10 }, () => new THREE.Matrix4());
/** Compose translation · rotation · scale into `out`. */
function comp(out, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, order = 'XYZ') {
  _p.set(x, y, z); _s.set(sx, sy, sz); _q.setFromEuler(_e.set(rx, ry, rz, order));
  return out.compose(_p, _q, _s);
}
const mul = (a, b, out) => out.multiplyMatrices(a, b);
const SRGB = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
const tmpC = new THREE.Color();
const DRY = new THREE.Color(0x9b8b52);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const PLANT_CAP = { stem: 2600, frond: 3200, broad: 1600, tuft: 2600, bulb: 1000, cap: 1000, pad: 1000, pod: 1000 };
const capFor = (key) => (key === 'limb' ? MAX_ANIMALS * 12 : MAX_ANIMALS * 2);

export class LifeView {
  constructor(scene, world, mats) {
    this.world = world;
    this.scene = scene;
    this.mats = mats;
    this.windU = { uTime: { value: 0 }, uWind: { value: 0.6 } };
    addWind(mats.plant, this.windU);
    buildGeometries();
    this.plant = {};
    const pg = { stem: GEOMS.stem, frond: GEOMS.frond, broad: GEOMS.broadLeaf, tuft: GEOMS.tuft, bulb: GEOMS.bulb, cap: GEOMS.cap, pad: GEOMS.pad, pod: GEOMS.pod };
    for (const k of Object.keys(PLANT_CAP)) {
      this.plant[k] = new PartPool(pg[k], mats.plant, PLANT_CAP[k], { castShadow: k !== 'pad' });
      scene.add(this.plant[k].mesh);
    }
    // animal pools are created on demand, keyed by profile (shared by species that use the same shape)
    this.animal = new Map();
    this.bodyPools = [];
    this.blobTex = makeRadialTexture(128);
    this.blob = new PartPool(blobGeometry(), new THREE.MeshBasicMaterial({ color: 0x000000, map: this.blobTex, transparent: true, opacity: 0.5, depthWrite: false }), MAX_ANIMALS, { castShadow: false, receiveShadow: false });
    this.blob.mesh.renderOrder = 1;
    scene.add(this.blob.mesh);
    // lumen halos: additive points, only lit after dark
    this.haloCap = 320;
    this.haloPos = new Float32Array(this.haloCap * 3);
    this.haloCol = new Float32Array(this.haloCap * 3);
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(this.haloPos, 3));
    hg.setAttribute('color', new THREE.BufferAttribute(this.haloCol, 3));
    hg.setDrawRange(0, 0);
    this.halo = new THREE.Points(hg, new THREE.PointsMaterial({ size: 9, sizeAttenuation: true, map: this.blobTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.halo.frustumCulled = false;
    scene.add(this.halo);
    this.render = new Map();
    this.ripples = []; // [x, z, strength] queued by aquatic movement, consumed by the engine
    this.plantPh = new WeakMap();
    this.animalCache = new WeakMap();
    this.selectedId = null;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xe0b35a, transparent: true, opacity: 0.85, depthWrite: false }));
    ring.visible = false;
    ring.renderOrder = 5;
    this.ring = ring;
    scene.add(ring);
  }

  plantPhenoOf(p) {
    let ph = this.plantPh.get(p);
    if (!ph) {
      const base = plantPhenotype(p.sp, p.g);
      ph = { ...base, col: SRGB(...base.colour) };
      this.plantPh.set(p, ph);
    }
    return ph;
  }

  animalPhenoOf(a) {
    let c = this.animalCache.get(a);
    if (!c) {
      const ph = a.ph || animalPhenotype(a.sp, a.g);
      c = { ph, col: SRGB(...ph.colour) };
      this.animalCache.set(a, c);
    }
    return c;
  }

  /** Rebuild all plant parts (every few frames; plants change slowly). */
  buildPlants(S, w) {
    for (const k in this.plant) this.plant[k].begin();
    const T = w.terrain;
    for (const p of S.plants) {
      const ph = this.plantPhenoOf(p);
      const size = p.size;
      const ground = T.heightAt(p.x, p.z);
      const hgt = ph.height * (0.4 + size) * 1.5;
      const hl = 0.45 + 0.55 * p.health;
      tmpC.copy(ph.col).lerp(DRY, (1 - hl) * 0.8);
      const cr = tmpC.r, cg = tmpC.g, cb = tmpC.b;
      const jitter = (p.id * 0.618) % 1;
      const base = comp(new THREE.Matrix4(), p.x, ground - 0.05, p.z, 0, jitter * Math.PI * 2, ph.lean * 0.3);
      const put = (pool, local, r, g, b) => {
        mul(base, local, SC[0]);
        pool.add(SC[0], r, g, b);
      };
      const sp = p.sp;
      if (sp === 'veilmoss') {
        const n = 2 + (size > 0.4 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const a = jitter * 9 + i * 2.1, rr = 0.25 + 0.3 * size;
          const r = (0.42 + 0.45 * size) * (0.8 + 0.2 * Math.sin(i + p.id));
          put(this.plant.tuft, comp(SC[1], Math.cos(a) * rr, 0, Math.sin(a) * rr, 0, a, 0, r * 1.1, r * 0.8, r * 1.1), cr, cg, cb);
        }
      } else if (sp === 'spirefern') {
        const trunkH = hgt * 0.9;
        put(this.plant.stem, comp(SC[1], 0, 0, 0, 0, 0, 0, 0.06 + 0.03 * size, trunkH, 0.06 + 0.03 * size), cr * 0.8, cg * 0.85, cb * 0.8);
        const n = Math.max(3, ph.leaves);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + jitter * 2;
          const L = hgt * (0.45 + 0.1 * Math.sin(i * 1.7)) * (0.6 + 0.5 * size);
          put(this.plant.frond, comp(SC[1], 0, trunkH * 0.92, 0, 1.0, a, 0, 1.6, L, 1, 'YXZ'), cr, cg, cb);
        }
      } else if (sp === 'tallowbulb') {
        const br = hgt * 0.3;
        put(this.plant.bulb, comp(SC[1], 0, br * 0.1, 0, 0, 0, 0, br, br * 1.05, br), cr * 0.9, cg * 0.9, cb * 0.8);
        const n = Math.min(7, Math.max(4, ph.leaves - 2));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + jitter;
          const L = hgt * (0.6 + 0.12 * (i % 3)) * (0.7 + 0.4 * size);
          put(this.plant.broad, comp(SC[1], 0, br * 0.4, 0, 0.9, a, 0, 1.0, L, 1, 'YXZ'), cr, cg, cb);
        }
      } else if (sp === 'capfungus') {
        const sh = hgt * 0.62;
        const sr = 0.07 + 0.05 * size;
        put(this.plant.stem, comp(SC[1], 0, 0, 0, 0, 0, 0, sr, sh, sr), cr * 0.95, cg * 0.92, cb * 0.85);
        const capR = 0.28 + 0.36 * size;
        put(this.plant.cap, comp(SC[1], 0, sh, 0, 0, jitter, 0, capR, capR * 1.1, capR), cr, cg, cb);
        if (size > 0.45) {
          const ang = jitter * 6;
          put(this.plant.cap, comp(SC[1], Math.cos(ang) * capR * 0.9, sh * 0.6, Math.sin(ang) * capR * 0.9, 0, 0, 0, capR * 0.5, capR * 0.6, capR * 0.5), cr * 1.05, cg * 1.02, cb * 0.95);
        }
      } else if (sp === 'reedlily') {
        const reedH = hgt * 1.8;
        for (let i = 0; i < 3; i++) {
          const a = jitter * 7 + i * 2.1, rr = 0.25 + 0.2 * (i % 2);
          const ox = Math.cos(a) * rr, oz = Math.sin(a) * rr;
          const ry = w.terrain.heightAt(p.x + ox, p.z + oz);
          const hh = Math.max(0.3, WATER_LEVEL + reedH * (0.5 + 0.2 * (i % 2)) - ry);
          put(this.plant.stem, comp(SC[1], ox, ry - ground + 0.05, oz, 0, 0, 0, 0.05 + 0.02 * size, hh, 0.05 + 0.02 * size), cr * 0.9, cg, cb * 0.9);
          if (i === 0) put(this.plant.pod, comp(SC[1], ox, ry - ground + hh + 0.05, oz, 0, 0, 0, 0.1 + 0.06 * size, 0.24 + 0.1 * size, 0.1 + 0.06 * size), cr * 1.1, cg * 1.05, cb * 0.85);
        }
        const padR = 0.25 + 0.3 * size;
        put(this.plant.pad, comp(SC[1], 0, WATER_LEVEL - ground + 0.02, 0, 0, jitter, 0, padR, 1, padR), cr * 0.85, cg * 1.0, cb * 0.85);
      } else {
        put(this.plant.tuft, comp(SC[1], 0, 0.1, 0, 0, 0, 0, 0.3 + size, 0.2 + size, 0.3 + size), cr, cg, cb);
      }
    }
    for (const k in this.plant) this.plant[k].end();
  }

  groundColour(w, x, z) {
    const cell = WORLD_SIZE / CELLS;
    const fi = clamp(Math.floor((x + WORLD_SIZE / 2) / cell), 0, CELLS - 1);
    const fj = clamp(Math.floor((z + WORLD_SIZE / 2) / cell), 0, CELLS - 1);
    return pigment(w.groundHue[fj * CELLS + fi], 0.5);
  }

  /** Smooth animal render state towards simulation positions. */
  animalState(a, dt) {
    let rs = this.render.get(a.id);
    if (!rs) { rs = { x: a.x, z: a.z, hd: a.hd, v: 0, gait: a.id * 1.37 }; this.render.set(a.id, rs); }
    const dx = a.x - rs.x, dz = a.z - rs.z;
    if (dx * dx + dz * dz > 36) { rs.x = a.x; rs.z = a.z; rs.v = 0; } else {
      const k = 1 - Math.exp(-dt * 9);
      const mx = rs.x, mz = rs.z;
      rs.x += dx * k; rs.z += dz * k;
      const v = Math.hypot(rs.x - mx, rs.z - mz) / Math.max(dt, 1e-4);
      rs.v += (v - rs.v) * Math.min(1, dt * 4);
    }
    let dh = a.hd - rs.hd;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    rs.hd += dh * (1 - Math.exp(-dt * 10));
    rs.gait += dt * (2 + rs.v * 2.2) * Math.PI;
    rs.rip = (rs.rip ?? 0) - dt;
    return rs;
  }

  /** Animal pool for a geometry profile, created on first use. */
  pool(key, castShadow = true) {
    let p = this.animal.get(key);
    if (!p) {
      const geo = CREATURE_GEO[key];
      const mat = key === 'shell' ? this.mats.shell : key === 'eye' ? this.mats.eye : key === 'glow' ? this.mats.glow : this.mats.animal;
      p = new PartPool(geo, mat, capFor(key), { castShadow: castShadow && key !== 'glow', params: key !== 'eye' && key !== 'glow' });
      this.animal.set(key, p);
      this.scene.add(p.mesh);
      if (key.startsWith('body:')) this.bodyPools.push(p);
    }
    return p;
  }

  buildAnimals(S, w, env, dt) {
    for (const p of this.animal.values()) p.begin();
    this.blob.begin();
    const T = w.terrain;
    const night = env.night;
    const t = env.clock;
    const alive = new Set();
    let halos = 0;
    const put = (key, local, r, g, b, owner, q) => {
      const pool = this.pool(key, key !== 'glow' && key !== 'eye' && key !== 'horn');
      mul(this._root, local, SC[9]);
      const i = pool.add(SC[9], r, g, b, q);
      if (key.startsWith('body:') && i >= 0) pool.owner[i] = owner;
    };
    for (const a of S.animals) {
      alive.add(a.id);
      const { ph, col } = this.animalPhenoOf(a);
      const rs = this.animalState(a, dt);
      const cfg = CFG[a.sp] || CFG.grazer;
      const aquatic = SPECIES[a.sp].aquatic;
      const gy0 = T.heightAt(rs.x, rs.z);
      const moveAmp = Math.min(1, rs.v * 1.6);
      if (aquatic && rs.v > 0.25 && rs.rip <= 0 && this.ripples.length < 48) {
        this.ripples.push(rs.x, rs.z, Math.min(1.2, 0.3 + rs.v * 0.3));
        rs.rip = 0.3 + ((a.id * 0.37) % 1) * 0.3;
      }
      const sleepy = a.st === 'rest' || a.st === 'shelter';
      const burrowed = a.st === 'burrow' || a.bur;
      const feeding = a.st === 'forage' ? 1 : 0;
      const legs = ph.legs;
      const legLen = legs ? Math.max(ph.legLen, 0.08) : 0;
      const bodyLen = ph.bodyLen, bodyH = ph.bodyH;
      let baseY = gy0;
      if (aquatic) baseY = Math.max(gy0, WATER_LEVEL - 0.6 * bodyH);
      const lowered = burrowed ? 1.1 : sleepy ? 0.25 : 0;
      const breath = 1 + 0.025 * Math.sin(t * 2.2 + a.id);
      const bob = legs ? Math.abs(Math.sin(rs.gait)) * 0.02 * moveAmp * bodyH * 4 : 0;
      this._root = comp(new THREE.Matrix4(), rs.x, baseY - lowered * bodyH * 0.45 + bob, rs.z, 0, -rs.hd, 0).clone();
      const root = this._root;
      const bodyCY = legs ? legLen * (sleepy ? 0.82 : 1) + bodyH * 0.5 : bodyH * 0.5 * (sleepy ? 0.9 : 1);
      // colour: pigment pulled toward the local ground hue by camouflage — selection acts on this
      const gcol = this.groundColour(w, rs.x, rs.z);
      tmpC.copy(col).lerp(SRGB(...gcol), ph.camoStrength * 0.55);
      tmpC.multiplyScalar((0.75 + 0.25 * a.health) * (burrowed ? 0.55 : 1));
      const cr = tmpC.r, cg = tmpC.g, cb = tmpC.b;
      // genetic pattern: amount from camo gene, type and seed from size/id
      const patType = a.g.size > 0.5 ? 1 : 0;
      const pq = [ph.pattern, patType, (a.id * 0.6180339) % 1, clamp(a.health, 0, 1) * 0];
      const wet = 0.25 + 0.5 * clamp(a.hyd, 0, 1);
      pq[3] = wet;

      // blob shadow on the ground (or water surface)
      const bq = comp(SC[8], rs.x, baseY + 0.03, rs.z, 0, -rs.hd, 0, bodyLen * 1.9, 1, bodyH * 2.4);
      this.blob.add(bq, 1, 1, 1);

      // body, head and shell are lathe profiles; proportions come from the phenotype
      const cb2 = bodyLen * 0.5, ch = bodyH * 0.5 * breath, cz = bodyH * 0.45;
      const bodyLocal = comp(SC[7], 0, bodyCY + (burrowed ? -bodyH * 0.45 : 0), 0, 0, 0, 0, cb2, burrowed ? bodyH * 0.25 : ch, cz);
      put(`body:${cfg.body.split(':')[1]}`, bodyLocal, cr, cg, cb, a.id, pq);
      const hs = bodyH * 0.6;
      const headY = bodyCY + bodyH * 0.08 - feeding * hs * 0.55;
      const headYaw = Math.sin(t * 0.37 + a.id) * 0.22 * (1 - moveAmp);
      const headKey = cfg.head;
      const headLocal = comp(SC[6], bodyLen * 0.5 + hs * 0.35, headY, 0, 0, headYaw, 0, hs * (headKey === 'head:long' ? 1.9 : 0.95), hs * 0.85, hs * 0.85);
      put(headKey, headLocal, cr * 0.92, cg * 0.92, cb * 0.92, a.id, pq);
      // eyes: dark glossy domes on the head's front
      const eyeR = bodyH * (0.1 + ph.eyeSize * 0.8);
      for (const sd of [-1, 1]) {
        const eyeLocal = comp(SC[5], bodyLen * 0.5 + hs * 0.8 * (headKey === 'head:long' ? 1.6 : 1), headY + hs * 0.22, sd * hs * 0.4, 0, headYaw, 0, eyeR, eyeR, eyeR);
        put('eye', eyeLocal, 0.08, 0.08, 0.07, a.id, null);
      }
      if (ph.shellAmt > 0.05 && cfg.shell) {
        const sr = ph.shellAmt;
        put('shell', comp(SC[5], -bodyLen * 0.04, bodyCY + bodyH * 0.12, 0, 0, 0, 0, bodyLen * 0.5 * 0.94, bodyH * 0.62 * sr + 0.02, bodyH * 0.5 * 0.98), cr * 1.06, cg * 1.06, cb * 1.0, a.id, pq);
      }
      if (ph.antennae && cfg.antenna) {
        for (const sd of [-1, 1]) {
          const aLen = ph.antennaLen * bodyH * 0.95;
          const wave = Math.sin(t * 1.3 + sd + a.id) * 0.08 + (fleeing(a) ? -0.3 : 0) + Math.sin(rs.gait * 0.5 + sd) * 0.06 * moveAmp;
          put('antenna', comp(SC[5], bodyLen * 0.5 + hs * 0.55, headY + hs * 0.45, sd * hs * 0.3, 0, 0, -0.55 + wave, bodyH * 0.04, aLen, bodyH * 0.04), cr, cg, cb, a.id, null);
        }
      }
      if (ph.horns && cfg.horns) {
        for (const sd of [-1, 1]) {
          const hl = ph.hornLen * bodyH * 1.1;
          put('horn', comp(SC[5], bodyLen * 0.5 + hs * 0.05, headY + hs * 0.4, sd * hs * 0.32, 0, 0, -0.35, bodyH * 0.09, hl, bodyH * 0.09), cr * 0.7, cg * 0.7, cb * 0.65, a.id, null);
          if (ph.horns === 1) break;
        }
      }
      // legs: each limb is two articulated segments with a knee; the gait phase drives swing and bend
      if (legs) {
        const pairs = Math.ceil(legs / 2);
        const thick = Math.max(0.014, bodyH * 0.16);
        const fold = sleepy || burrowed ? 0.45 : 1;
        const Lu = legLen * 0.56 * fold, Ll = legLen * 0.5 * fold;
        for (let i = 0; i < legs; i++) {
          const side = i % 2 ? 1 : -1;
          const k = Math.floor(i / 2);
          const lx = pairs > 1 ? bodyLen * (0.38 - 0.76 * (k / (pairs - 1))) : 0;
          const phase = rs.gait + k * Math.PI * 0.9 + (side > 0 ? Math.PI : 0);
          const amp = moveAmp * (sleepy ? 0 : 1);
          const swing = Math.sin(phase) * 0.45 * amp;
          const knee = (0.35 + 0.35 * Math.sin(phase - 0.9)) * amp - 0.05 * (1 - amp) + (sleepy ? 0.9 : 0);
          const top = comp(SC[4], lx, bodyCY - bodyH * 0.3, side * bodyH * 0.42, 0, 0, swing);
          put('limb', comp(SC[3], 0, 0, 0, 0, 0, 0, thick, Lu, thick).premultiply(top), cr * 0.85, cg * 0.85, cb * 0.85, a.id, null);
          const lower = mul(top, comp(SC[2], 0, -Lu, 0, 0, 0, knee), SC[1]);
          put('limb', comp(SC[3], 0, 0, 0, 0, 0, 0, thick * 0.82, Ll, thick * 0.82).premultiply(lower), cr * 0.8, cg * 0.8, cb * 0.8, a.id, null);
        }
      }
      if (ph.tailLen > 0.02 && cfg.tail) {
        const wag = Math.sin(rs.gait * 0.7) * 0.25 * (0.4 + moveAmp);
        const long = cfg.tail === 'long' ? 1.5 : 1;
        const tl = ph.tailLen * bodyLen * 0.9 * long;
        put('tail', comp(SC[5], -bodyLen * 0.45, bodyCY - bodyH * 0.1, 0, 0, 0, Math.PI / 2 - 0.2 + wag, bodyH * 0.26, tl, bodyH * 0.26), cr * 0.9, cg * 0.9, cb * 0.9, a.id, pq);
      }
      if (ph.fins && cfg.fin !== false && a.sp === 'skimmer') {
        for (const sd of [-1, 1]) {
          const flap = Math.sin(rs.gait * 1.2 + sd) * 0.35;
          put('fin', comp(SC[5], 0, bodyCY - bodyH * 0.1, sd * bodyH * 0.42, 0, 0, Math.PI / 2 + flap, bodyH * ph.finSize * 0.6, bodyLen * 0.8, 1), cr, cg, cb, a.id, null);
        }
      }
      // lumens: a soft body glow plus an additive halo that only shows after dark
      if (ph.glow > 0) {
        const g = ph.glow * (0.4 + 0.6 * night);
        put('glow', comp(SC[5], -bodyLen * 0.2, bodyCY + bodyH * 0.25, 0, 0, 0, 0, bodyH * 0.42, bodyH * 0.42, bodyH * 0.42), 0.55 * g, 1.0 * g, 0.82 * g, a.id, null);
        if (halos < this.haloCap) {
          const k = halos++;
          this.haloPos[k * 3] = rs.x; this.haloPos[k * 3 + 1] = baseY + bodyCY + bodyH * 0.25; this.haloPos[k * 3 + 2] = rs.z;
          this.haloCol[k * 3] = 0.42 * g; this.haloCol[k * 3 + 1] = 0.9 * g; this.haloCol[k * 3 + 2] = 0.72 * g;
        }
      }
    }
    for (const p of this.animal.values()) p.end();
    this.blob.end();
    this.halo.geometry.setDrawRange(0, halos);
    this.halo.geometry.attributes.position.needsUpdate = true;
    this.halo.geometry.attributes.color.needsUpdate = true;
    this.halo.material.size = 3.2 + 4.0 * night;
    for (const id of this.render.keys()) if (!alive.has(id)) this.render.delete(id);
    const sel = this.selectedId != null ? this.render.get(this.selectedId) : null;
    if (sel) {
      const a = S.animals.find((q) => q.id === this.selectedId);
      if (a) {
        const ph = this.animalPhenoOf(a).ph;
        this.ring.visible = true;
        this.ring.position.set(sel.x, T.heightAt(sel.x, sel.z) + 0.05, sel.z);
        this.ring.scale.setScalar(Math.max(1.2, ph.bodyLen * 1.3));
      } else this.ring.visible = false;
    } else this.ring.visible = false;
  }

  update(S, w, env, dt, frame) {
    this.windU.uTime.value = env.clock;
    this.windU.uWind.value = 0.45 + 0.5 * env.rain;
    if (frame % 3 === 0) this.buildPlants(S, w);
    this.buildAnimals(S, w, env, dt);
  }

  /** Returns the animal id whose body is under the ray, or null. */
  pick(raycaster) {
    const meshes = this.bodyPools.map((p) => p.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const h = hits[0];
    const pool = this.bodyPools.find((p) => p.mesh === h.object);
    const id = pool ? pool.owner[h.instanceId] : null;
    return id == null ? null : id;
  }

  dispose() {
    for (const k in this.plant) { this.scene.remove(this.plant[k].mesh); this.plant[k].mesh.dispose(); }
    for (const p of this.animal.values()) { this.scene.remove(p.mesh); p.mesh.dispose(); }
    this.scene.remove(this.blob.mesh, this.halo, this.ring);
    this.blobTex.dispose();
  }
}

function fleeing(a) { return a.st === 'flee'; }
