// Renders every living plant and animal from simulation state. Shapes come from phenotypes
// (leg count, body length, horns, fins, stature, leaf count…), colours from pigment and camouflage.
import * as THREE from 'three';
import { SPECIES } from '../sim/species.js';
import { animalPhenotype, plantPhenotype, pigment } from '../sim/genome.js';
import { WATER_LEVEL, CELLS, WORLD_SIZE } from '../sim/terrain.js';
import { PartPool, addWind } from './parts.js';
import { GEOMS } from './parts.js';

const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _q = new THREE.Quaternion(), _e = new THREE.Euler();
function M(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, order = 'XYZ') {
  _p.set(x, y, z); _s.set(sx, sy, sz); _q.setFromEuler(_e.set(rx, ry, rz, order));
  return _m.compose(_p, _q, _s);
}
const SRGB = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
const tmpC = new THREE.Color();
const DRY = new THREE.Color(0x9b8b52);

const PLANT_CAP = {
  stem: 2600, leaf: 3200, frond: 3200, broad: 1600, tuft: 2600, bulb: 1000, cap: 1000, pad: 1000, pod: 1000,
};
const ANIMAL_CAP = { body: 520, head: 520, leg: 4300, antenna: 1200, tail: 520, shell: 520, horn: 1100, fin: 1100, eye: 1100, glow: 520 };

export class LifeView {
  constructor(scene, world, mats) {
    this.world = world;
    this.scene = scene;
    const pm = mats.plant;
    this.windU = { uTime: { value: 0 }, uWind: { value: 0.6 } };
    this.plantMat = pm;
    addWind(pm, this.windU);
    this.plant = {};
    const pg = {
      stem: GEOMS.stem, leaf: GEOMS.leaf, frond: GEOMS.frond, broad: GEOMS.broadLeaf, tuft: GEOMS.tuft,
      bulb: GEOMS.bulb, cap: GEOMS.cap, pad: GEOMS.pad, pod: GEOMS.pod,
    };
    for (const k of Object.keys(PLANT_CAP)) {
      this.plant[k] = new PartPool(pg[k], pm, PLANT_CAP[k], { castShadow: k !== 'pad' });
      scene.add(this.plant[k].mesh);
    }
    const am = mats.animal;
    const ag = {
      body: [GEOMS.body, am], head: [GEOMS.head, am], leg: [GEOMS.leg, am], antenna: [GEOMS.antenna, am], tail: [GEOMS.tail, am],
      shell: [GEOMS.shell, mats.shell], horn: [GEOMS.horn, am], fin: [GEOMS.fin, am], eye: [GEOMS.eye, mats.eye],
      glow: [GEOMS.glow, mats.glow],
    };
    this.animal = {};
    for (const k of Object.keys(ANIMAL_CAP)) {
      this.animal[k] = new PartPool(ag[k][0], ag[k][1], ANIMAL_CAP[k], { castShadow: k !== 'glow' && k !== 'eye' });
      scene.add(this.animal[k].mesh);
    }
    this.animal.glow.mesh.castShadow = false;
    this.bodyOwner = [];
    this.render = new Map();
    this.plantPh = new WeakMap();
    this.animalCache = new WeakMap();
    this.frame = 0;
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

  /** Rebuild all plant parts (called every few frames; plants change slowly). */
  buildPlants(S, w) {
    for (const k in this.plant) this.plant[k].begin();
    const T = w.terrain;
    for (const p of S.plants) {
      const ph = this.plantPhenoOf(p);
      const size = p.size;
      const ground = T.heightAt(p.x, p.z);
      const hgt = ph.height * (0.4 + size) * 1.5;
      const hl = 0.45 + 0.55 * p.health; // health tints toward dry yellow
      tmpC.copy(ph.col).lerp(DRY, (1 - hl) * 0.8);
      const cr = tmpC.r, cg = tmpC.g, cb = tmpC.b;
      const jitter = (p.id * 0.618) % 1;
      const rot = jitter * Math.PI * 2;
      const base = M(p.x, ground - 0.05, p.z, 0, rot, ph.lean * 0.3).clone();
      const sp = p.sp;
      if (sp === 'veilmoss') {
        const n = 2 + (size > 0.4 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const a = jitter * 9 + i * 2.1, rr = 0.25 + 0.3 * size;
          const r = (0.35 + 0.45 * size) * (0.8 + 0.2 * Math.sin(i + p.id));
          const tm = _r.multiplyMatrices(base, M(Math.cos(a) * rr, 0.04 * r, Math.sin(a) * rr, 0, a, 0, r * 1.2, r * 0.42, r * 1.2));
          this.plant.tuft.add(tm, cr, cg, cb);
        }
      } else if (sp === 'spirefern') {
        const trunkH = hgt * 0.9;
        this.plant.stem.add(_r.multiplyMatrices(base, M(0, 0, 0, 0, 0, 0, 0.05 + 0.03 * size, trunkH, 0.05 + 0.03 * size)), cr * 0.8, cg * 0.85, cb * 0.8);
        const n = Math.max(3, ph.leaves);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + jitter * 2;
          const L = hgt * (0.45 + 0.1 * Math.sin(i * 1.7)) * (0.6 + 0.5 * size);
          const f = _r.multiplyMatrices(base, M(0, trunkH * 0.92, 0, 1.0, a, 0, 1.6, L, 1, 'YXZ'));
          this.plant.frond.add(f, cr, cg, cb);
        }
      } else if (sp === 'tallowbulb') {
        const br = hgt * 0.28;
        this.plant.bulb.add(_r.multiplyMatrices(base, M(0, br * 0.55, 0, 0, 0, 0, br, br * 0.9, br)), cr * 0.9, cg * 0.9, cb * 0.8);
        const n = Math.min(7, Math.max(4, ph.leaves - 2));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + jitter;
          const L = hgt * (0.6 + 0.12 * (i % 3)) * (0.7 + 0.4 * size);
          this.plant.broad.add(_r.multiplyMatrices(base, M(0, br * 0.4, 0, 0.9, a, 0, 1.0, L, 1, 'YXZ')), cr, cg, cb);
        }
      } else if (sp === 'capfungus') {
        const sh = hgt * 0.62;
        const sr = 0.07 + 0.05 * size;
        this.plant.stem.add(_r.multiplyMatrices(base, M(0, 0, 0, 0, 0, 0, sr, sh, sr)), cr * 0.95, cg * 0.92, cb * 0.85);
        const capR = 0.28 + 0.36 * size;
        this.plant.cap.add(_r.multiplyMatrices(base, M(0, sh, 0, 0, 0, 0, capR, capR * 0.55, capR)), cr, cg, cb);
        if (size > 0.45) {
          const ang = jitter * 6;
          this.plant.cap.add(_r.multiplyMatrices(base, M(Math.cos(ang) * capR * 0.9, sh * 0.6, Math.sin(ang) * capR * 0.9, 0, 0, 0, capR * 0.5, capR * 0.3, capR * 0.5)), cr * 1.05, cg * 1.02, cb * 0.95);
        }
      } else if (sp === 'reedlily') {
        const reedH = hgt * 1.8;
        for (let i = 0; i < 3; i++) {
          const a = jitter * 7 + i * 2.1, rr = 0.25 + 0.2 * (i % 2);
          const ox = Math.cos(a) * rr, oz = Math.sin(a) * rr;
          const ry = w.terrain.heightAt(p.x + ox, p.z + oz);
          const hh = Math.max(0.3, WATER_LEVEL + reedH * (0.5 + 0.2 * (i % 2)) - ry);
          this.plant.stem.add(_r.multiplyMatrices(base, M(ox, ry - ground + 0.05, oz, 0, 0, 0, 0.04 + 0.02 * size, hh, 0.04 + 0.02 * size)), cr * 0.9, cg, cb * 0.9);
          if (i === 0) this.plant.pod.add(_r.multiplyMatrices(base, M(ox, ry - ground + hh + 0.05, oz, 0, 0, 0, 0.09 + 0.06 * size, 0.2 + 0.1 * size, 0.09 + 0.06 * size)), cr * 1.1, cg * 1.05, cb * 0.85);
        }
        const padR = 0.25 + 0.3 * size;
        this.plant.pad.add(_r.multiplyMatrices(base, M(0, WATER_LEVEL - ground + 0.02, 0, 0, jitter, 0, padR, 1, padR)), cr * 0.85, cg * 1.0, cb * 0.85);
      } else {
        this.plant.tuft.add(_r.multiplyMatrices(base, M(0, 0.1, 0, 0, 0, 0, 0.3 + size, 0.2 + size, 0.3 + size)), cr, cg, cb);
      }
    }
    for (const k in this.plant) this.plant[k].end();
  }

  groundColour(w, x, z) {
    const fi = Math.max(0, Math.min(CELLS - 1, Math.floor((x + WORLD_SIZE / 2) / (WORLD_SIZE / CELLS))));
    const fj = Math.max(0, Math.min(CELLS - 1, Math.floor((z + WORLD_SIZE / 2) / (WORLD_SIZE / CELLS))));
    const gh = w.groundHue[fj * CELLS + fi];
    return pigment(gh, 0.5);
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
    return rs;
  }

  buildAnimals(S, w, env, dt) {
    for (const k in this.animal) this.animal[k].begin();
    this.bodyOwner.length = 0;
    const T = w.terrain;
    const night = env.night;
    const alive = new Set();
    for (const a of S.animals) {
      alive.add(a.id);
      const { ph, col } = this.animalPhenoOf(a);
      const rs = this.animalState(a, dt);
      const aquatic = SPECIES[a.sp].aquatic;
      const gy0 = T.heightAt(rs.x, rs.z);
      const moveAmp = Math.min(1, rs.v * 1.6);
      const sleepy = a.st === 'rest' || a.st === 'shelter';
      const burrowed = a.st === 'burrow' || a.bur;
      const feeding = a.st === 'forage' ? 1 : 0;
      const fleeing = a.st === 'flee';
      const legs = ph.legs;
      const legLen = legs ? Math.max(ph.legLen, 0.08) : 0;
      const bodyLen = ph.bodyLen, bodyH = ph.bodyH;
      let baseY = gy0;
      if (aquatic) baseY = Math.max(gy0, WATER_LEVEL - 0.6 * bodyH) ;
      let lowered = sleepy ? 0.25 : 0;
      if (burrowed) lowered = 1.1;
      const bob = legs ? Math.abs(Math.sin(rs.gait)) * 0.02 * moveAmp * bodyH * 4 : 0;
      const root = M(rs.x, baseY - lowered * bodyH * 0.45 + bob, rs.z, 0, -rs.hd, 0).clone();
      const bodyCY = legs ? legLen * (sleepy ? 0.82 : 1) + bodyH * 0.5 : bodyH * 0.5 * (sleepy ? 0.9 : 1);
      // colour: pigment, pulled toward the local ground hue by camouflage (this is what selection acts on)
      const gcol = this.groundColour(w, rs.x, rs.z);
      tmpC.copy(col).lerp(SRGB(...gcol), ph.camoStrength * 0.55);
      const healthTint = 0.75 + 0.25 * a.health;
      tmpC.multiplyScalar(healthTint);
      if (burrowed) tmpC.multiplyScalar(0.55);
      const cr = tmpC.r, cg = tmpC.g, cb = tmpC.b;
      const idx = this.animal.body.n;
      // body
      const bodyLocal = burrowed
        ? M(0, bodyCY - bodyH * 0.55, 0, 0, 0, 0, bodyLen * 0.5, bodyH * 0.25, bodyH * 0.45)
        : M(0, bodyCY, 0, 0, 0, 0, bodyLen * 0.5, bodyH * 0.5, bodyH * 0.45);
      const bodyM = _m.multiplyMatrices(root, bodyLocal).clone();
      this.animal.body.add(bodyM, cr, cg, cb);
      this.bodyOwner[idx] = a.id;
      // head
      const hs = bodyH * 0.6;
      const headY = bodyCY + bodyH * 0.08 - feeding * hs * 0.55;
      const headLocal = M(bodyLen * 0.5 + hs * 0.35, headY, 0, 0, 0, 0, hs * 0.9, hs * 0.85, hs * 0.85);
      this.animal.head.add(_r.multiplyMatrices(root, headLocal).clone(), cr * 0.92, cg * 0.92, cb * 0.92);
      // eyes
      const eyeR = bodyH * (0.1 + ph.eyeSize * 0.8);
      for (const sd of [-1, 1]) {
        this.animal.eye.add(_r.multiplyMatrices(root, M(bodyLen * 0.5 + hs * 0.8, headY + hs * 0.22, sd * hs * 0.4, 0, 0, 0, eyeR, eyeR, eyeR)).clone(), 0.08, 0.08, 0.07);
      }
      // antennae
      if (ph.antennae) {
        for (const sd of [-1, 1]) {
          const aLen = ph.antennaLen * bodyH * 0.9;
          this.animal.antenna.add(_r.multiplyMatrices(root, M(bodyLen * 0.5 + hs * 0.55, headY + hs * 0.45, sd * hs * 0.3, 0, 0, -0.55 + Math.sin(rs.gait * 0.5 + sd) * 0.08 * moveAmp, bodyH * 0.035, aLen, bodyH * 0.035)).clone(), cr, cg, cb);
        }
      }
      // horns
      if (ph.horns) {
        for (const sd of [-1, 1]) {
          const hl = ph.hornLen * bodyH * 1.1;
          this.animal.horn.add(_r.multiplyMatrices(root, M(bodyLen * 0.5 + hs * 0.05, headY + hs * 0.4, sd * hs * 0.32, 0, 0, -0.35, bodyH * 0.08, hl, bodyH * 0.08)).clone(), cr * 0.7, cg * 0.7, cb * 0.65);
          if (ph.horns === 1) break;
        }
      }
      // legs
      if (legs) {
        const pairs = Math.ceil(legs / 2);
        const thick = Math.max(0.012, bodyH * 0.16);
        for (let i = 0; i < legs; i++) {
          const side = i % 2 ? 1 : -1;
          const k = Math.floor(i / 2);
          const lx = pairs > 1 ? bodyLen * (0.38 - 0.76 * (k / (pairs - 1))) : 0;
          const phase = rs.gait + k * Math.PI * 0.9 + (side > 0 ? Math.PI : 0);
          const swing = Math.sin(phase) * 0.5 * moveAmp * (sleepy ? 0 : 1);
          const fold = sleepy || burrowed ? 0.45 : 1;
          const lm = M(lx, bodyCY - bodyH * 0.3, side * bodyH * 0.42, 0, 0, swing, thick, legLen * fold, thick);
          this.animal.leg.add(_r.multiplyMatrices(root, lm).clone(), cr * 0.85, cg * 0.85, cb * 0.85);
        }
      }
      // shell
      if (ph.shellAmt > 0.05) {
        const sr = ph.shellAmt;
        this.animal.shell.add(_r.multiplyMatrices(root, M(-bodyLen * 0.04, bodyCY + bodyH * 0.1, 0, 0, 0, 0, bodyLen * 0.56, bodyH * 0.6 * sr + 0.02, bodyH * 0.52)).clone(), cr * 1.08, cg * 1.08, cb * 1.02);
      }
      // tail
      if (ph.tailLen > 0.02) {
        const wag = Math.sin(rs.gait * 0.7) * 0.25 * (0.4 + moveAmp);
        const tl = ph.tailLen * bodyLen * 0.9;
        this.animal.tail.add(_r.multiplyMatrices(root, M(-bodyLen * 0.45, bodyCY - bodyH * 0.1, 0, 0, 0, Math.PI / 2 - 0.2 + wag, bodyH * 0.26, tl, bodyH * 0.26)).clone(), cr * 0.9, cg * 0.9, cb * 0.9);
      }
      // fins (aquatic)
      if (ph.fins) {
        for (const sd of [-1, 1]) {
          const flap = Math.sin(rs.gait * 1.2 + sd) * 0.35;
          this.animal.fin.add(_r.multiplyMatrices(root, M(0, bodyCY - bodyH * 0.1, sd * bodyH * 0.42, 0, 0, Math.PI / 2 + flap, bodyH * ph.finSize * 0.6, bodyLen * 0.8, 1)).clone(), cr, cg, cb);
        }
      }
      // glow (lumens): brightest after dark
      if (ph.glow > 0 && night > 0.02) {
        const g = ph.glow * (0.4 + 0.6 * night);
        this.animal.glow.add(_r.multiplyMatrices(root, M(-bodyLen * 0.25, bodyCY + bodyH * 0.45, 0, 0, 0, 0, bodyH * 0.32, bodyH * 0.32, bodyH * 0.32)).clone(), 0.55 * g, 1.0 * g, 0.82 * g);
      }
    }
    for (const k in this.animal) this.animal[k].end();
    for (const id of this.render.keys()) if (!alive.has(id)) this.render.delete(id);
    // selection ring
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
    if (frame % 3 === 0 || this.plantDirty) this.buildPlants(S, w);
    this.buildAnimals(S, w, env, dt);
  }

  /** Returns animal id under a ray (body instances), or null. */
  pick(raycaster) {
    const hits = raycaster.intersectObject(this.animal.body.mesh, false);
    if (!hits.length) return null;
    const id = this.bodyOwner[hits[0].instanceId];
    return id == null ? null : id;
  }

  dispose() {
    for (const k in this.plant) { this.scene.remove(this.plant[k].mesh); this.plant[k].mesh.dispose(); }
    for (const k in this.animal) { this.scene.remove(this.animal[k].mesh); this.animal[k].mesh.dispose(); }
    this.scene.remove(this.ring);
  }
}
