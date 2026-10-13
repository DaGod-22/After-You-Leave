// World: owns the authoritative simulation state, the ecological grid and spatial indexes.
// Rendering and UI only read from this; they never mutate simulation state directly
// (player interventions go through the methods exposed here).
import { RNG, hashString, clamp, smoothstep } from './math.js';
import { generateTerrain, CELLS, CELL_SIZE, WORLD_SIZE, WATER_LEVEL } from './terrain.js';
import { SPECIES, STARTING_SPECIES, MAX_ANIMALS, MAX_PLANTS, ANIMAL_IDS, PLANT_IDS, TRAIT_LABELS } from './species.js';
import { founderGenome, inheritGenome, plantPhenotype, animalPhenotype, genomeDistance, traitKeys } from './genome.js';
import { stepClimate, updateGrid } from './climate.js';
import { stepPlants } from './plants.js';
import { stepAnimals, PREDATORS } from './animals.js';
import { analyseSample, analyseDay, noteEvent } from './journal.js';

export const FORMAT_VERSION = 1;
export const BUCKET = 8;
const BUCKETS = Math.ceil(WORLD_SIZE / BUCKET);
export const HISTORY_EVERY = 2; // sim hours between population samples
export const HISTORY_MAX = 900;
export const JOURNAL_MAX = 1500;

export class World {
  constructor(S) {
    this.S = S;
    this.terrain = generateTerrain(S.seed, S.config);
    this.half = WORLD_SIZE / 2;
    this.n = CELLS;
    const N = CELLS * CELLS;
    this.rng = new RNG(S.rngState >>> 0 || 1);
    // Static per-cell terrain derivatives
    this.cellH = new Float32Array(N);
    this.baseWet = new Float32Array(N);
    this.baseShade = new Float32Array(N);
    this.cellDepth = new Float32Array(N);
    this.cellCX = new Float32Array(N);
    this.cellCZ = new Float32Array(N);
    for (let j = 0; j < CELLS; j++) {
      for (let i = 0; i < CELLS; i++) {
        const ci = j * CELLS + i;
        const x = -this.half + (i + 0.5) * CELL_SIZE;
        const z = -this.half + (j + 0.5) * CELL_SIZE;
        this.cellCX[ci] = x;
        this.cellCZ[ci] = z;
        this.cellH[ci] = this.terrain.heightAt(x, z);
        this.cellDepth[ci] = Math.max(0, WATER_LEVEL - this.cellH[ci]);
        const s = this.terrain.slopeAt(x, z);
        const lowness = clamp(1 - (this.cellH[ci] - 0) / 12, 0, 1);
        this.baseWet[ci] = clamp(0.36 + 0.45 * lowness - 0.2 * s, 0.05, 0.9);
        this.baseShade[ci] = 0.05 + 0.1 * lowness;
      }
    }
    // Water distance → moisture (shore cells are wet, pond is saturated)
    const dist = new Float32Array(N).fill(99);
    const q = [];
    for (let ci = 0; ci < N; ci++) if (this.cellDepth[ci] > 0) { dist[ci] = 0; q.push(ci); this.baseWet[ci] = 1; }
    for (let qi = 0; qi < q.length; qi++) {
      const ci = q[qi], i = ci % CELLS, j = (ci / CELLS) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= CELLS || nj >= CELLS) continue;
        const nc = nj * CELLS + ni;
        if (dist[nc] > dist[ci] + 1) { dist[nc] = dist[ci] + 1; q.push(nc); }
      }
    }
    for (let ci = 0; ci < N; ci++) {
      if (dist[ci] > 0 && dist[ci] < 99) {
        const near = Math.exp(-dist[ci] * CELL_SIZE / 9);
        this.baseWet[ci] = clamp(this.baseWet[ci] + 0.45 * near, 0.05, 0.95);
        this.baseShade[ci] = clamp(this.baseShade[ci] + 0.1 * near, 0, 1);
      }
    }
    // Caves: shelter zones with strong shade and cooler air
    for (const cv of this.terrain.caves) {
      for (let ci = 0; ci < N; ci++) {
        const d = Math.hypot(this.cellCX[ci] - cv.x, this.cellCZ[ci] - cv.z);
        if (d < 9) this.baseShade[ci] = clamp(this.baseShade[ci] + 0.75 * (1 - smoothstep(3, 9, d)), 0, 1);
      }
    }
    // Dynamic per-cell state (persisted)
    this.moist = new Float32Array(N);
    this.nut = new Float32Array(N);
    if (S.grid && S.grid.moist?.length === N && S.grid.nut?.length === N) {
      this.moist.set(S.grid.moist);
      this.nut.set(S.grid.nut);
    } else {
      for (let ci = 0; ci < N; ci++) {
        this.moist[ci] = this.baseWet[ci];
        this.nut[ci] = 0.3 + 0.2 * this.baseShade[ci];
      }
    }
    // Derived (rebuilt every step)
    this.shade = new Float32Array(N);
    this.greenness = new Float32Array(N);
    this.groundHue = new Float32Array(N);
    this.fern = new Float32Array(N);
    this.cover = new Float32Array(N);
    this.pB = Array.from({ length: BUCKETS * BUCKETS }, () => []);
    this.aB = Array.from({ length: BUCKETS * BUCKETS }, () => []);
    this.byId = new Map();
    this.plantsArr = [];
    this.animalsArr = [];
    this.daylight = 0.5;
    this.temp = 18;
    this.ages = 0;
  }

  // ───────────── construction ─────────────
  static create({ name, seed, now = Date.now() }) {
    const S = {
      format: FORMAT_VERSION,
      id: 'w' + now.toString(36) + Math.floor(Math.random() * 1e6).toString(36),
      name: name || 'Untitled basin',
      seed,
      config: {},
      createdAt: now,
      savedAt: now,
      time: 0,
      rngState: (seed ^ 0x5bd1e995) >>> 0 || 7,
      seq: 0,
      nextId: 1,
      climate: { offset: 0, humidity: 0.55, rain: { on: false, intensity: 0, until: 0 }, nextRainCheck: 6, playerRainReadyAt: 0, springs: [], heatDays: 0, dryHours: 0 },
      grid: null,
      plants: [],
      animals: [],
      species: {},
      lineages: {},
      ancestry: {},
      journal: [],
      history: { every: HISTORY_EVERY, t: [], counts: {}, climate: { temp: [], hum: [], rain: [] }, traits: {} },
      pressures: [],
      bank: 4,
      day: { index: 0, births: {}, deaths: {}, kills: {}, rain: 0 },
      dayLog: [],
      lastSeen: null,
      report: null,
      paused: false,
    };
    const w = new World(S);
    w.initialise();
    return w;
  }

  static from(S) {
    return new World(S);
  }

  initialise() {
    const S = this.S;
    const rng = this.rng;
    for (const sp of PLANT_IDS.concat(ANIMAL_IDS)) {
      S.species[sp] = S.species[sp] || newSpeciesRecord();
    }
    // Starting populations: plant patches and animal founders on suitable ground.
    for (const spId of STARTING_SPECIES) {
      this.seedFounders(spId, SPECIES[spId].founders);
    }
    for (const spId of STARTING_SPECIES) {
      const rec = S.species[spId];
      rec.discovered = true;
      rec.discoveredAt = 0;
      // The founding cohort's mean genome is the "ancestral" reference for all later comparisons.
      rec.founderGenome = this.traitMeans(spId)?.means || null;
    }
    S.history.counts = {};
    for (const sp of PLANT_IDS.concat(ANIMAL_IDS)) S.history.counts[sp] = [];
    for (const sp of PLANT_IDS.concat(ANIMAL_IDS)) S.history.traits[sp] = [];
    this.index();
    // survey events
    noteEvent(this, 'survey', null, `Survey begins on basin “${S.name}”. ${STARTING_SPECIES.length} species are already present.`, { seed: S.seed });
    for (const sp of STARTING_SPECIES) {
      const rec = S.species[sp];
      const n = this.countOf(sp);
      noteEvent(this, 'discovery', sp, `${SPECIES[sp].common} catalogued in the survey (${n} individuals). ${SPECIES[sp].blurb}`, { count: n });
    }
    // Settle the basin so the first view is already alive
    this.runSteps(48, 0.2);
    S.rngState = this.rng.state;
    this.S.lastSeen = { t: this.S.time, counts: this.countsSnapshot() };
    void rng;
  }

  firstGenome(spId) {
    return founderGenome(this.rng, spId);
  }

  seedFounders(spId, n) {
    const sp = SPECIES[spId];
    if (sp.kind === 'plant') {
      let placed = 0, tries = 0;
      const clusters = Math.max(3, Math.round(n / 14));
      const centres = [];
      while (centres.length < clusters && tries < 5000) {
        tries++;
        const x = this.rng.range(-this.half + 10, this.half - 10), z = this.rng.range(-this.half + 10, this.half - 10);
        if (this.plantAllowed(spId, x, z)) centres.push([x, z]);
      }
      tries = 0;
      while (placed < n && tries < n * 60) {
        tries++;
        const c = this.rng.pick(centres.length ? centres : [[0, 0]]);
        const r = Math.sqrt(this.rng.next()) * (sp.spread * 1.2);
        const a = this.rng.range(0, Math.PI * 2);
        const x = c[0] + Math.cos(a) * r, z = c[1] + Math.sin(a) * r;
        if (!this.plantAllowed(spId, x, z)) continue;
        const g = this.firstGenome(spId);
        const p = this.spawnPlant({ sp: spId, x, z, size: this.rng.range(0.25, 0.85), g });
        if (p) p.age = this.rng.range(0, 0.5) * p.ph.lifespanEff;
        placed++;
      }
    } else {
      let placed = 0, tries = 0;
      while (placed < n && tries < n * 200) {
        tries++;
        const x = this.rng.range(-this.half + 8, this.half - 8), z = this.rng.range(-this.half + 8, this.half - 8);
        if (!this.animalAllowed(spId, x, z)) continue;
        const g = this.firstGenome(spId);
        const age = this.rng.range(0.15, 0.6) * animalPhenotype(spId, g).lifespan;
        this.spawnAnimal({ sp: spId, x, z, g, lin: null, par: null, born: this.S.time - age, energy: this.rng.range(0.55, 0.9), hyd: 0.8, age });
        placed++;
      }
    }
  }

  // ───────────── placement rules ─────────────
  plantAllowed(spId, x, z) {
    if (Math.abs(x) > this.half - 3 || Math.abs(z) > this.half - 3) return false;
    const h = this.terrain.heightAt(x, z);
    const sp = SPECIES[spId];
    if (sp.aquatic) return h < WATER_LEVEL - 0.05 && h > WATER_LEVEL - 1.8;
    return h > WATER_LEVEL + 0.15;
  }
  animalAllowed(spId, x, z) {
    if (Math.abs(x) > this.half - 3 || Math.abs(z) > this.half - 3) return false;
    const h = this.terrain.heightAt(x, z);
    const sp = SPECIES[spId];
    if (sp.aquatic) return h < WATER_LEVEL - 0.05 && h > WATER_LEVEL - 2.2;
    return h > WATER_LEVEL + 0.1;
  }

  // ───────────── indexing & derived fields ─────────────
  cellIndex(x, z) {
    const i = clamp(Math.floor((x + this.half) / CELL_SIZE), 0, CELLS - 1);
    const j = clamp(Math.floor((z + this.half) / CELL_SIZE), 0, CELLS - 1);
    return j * CELLS + i;
  }
  bucketIndex(x, z) {
    const bx = clamp(Math.floor((x + this.half) / BUCKET), 0, BUCKETS - 1);
    const bz = clamp(Math.floor((z + this.half) / BUCKET), 0, BUCKETS - 1);
    return bz * BUCKETS + bx;
  }
  /** Iterate bucket arrays within radius r of (x,z). cb(entity) returns true to stop early. */
  forNear(buckets, x, z, r, cb) {
    const bx0 = clamp(Math.floor((x - r + this.half) / BUCKET), 0, BUCKETS - 1);
    const bx1 = clamp(Math.floor((x + r + this.half) / BUCKET), 0, BUCKETS - 1);
    const bz0 = clamp(Math.floor((z - r + this.half) / BUCKET), 0, BUCKETS - 1);
    const bz1 = clamp(Math.floor((z + r + this.half) / BUCKET), 0, BUCKETS - 1);
    for (let bz = bz0; bz <= bz1; bz++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const arr = buckets[bz * BUCKETS + bx];
        for (let k = 0; k < arr.length; k++) if (cb(arr[k])) return;
      }
    }
  }
  tempAt(ci) {
    return this.temp - 2.5 * this.shade[ci] - 0.06 * Math.max(0, this.cellH[ci] - 6);
  }
  index() {
    const S = this.S;
    for (const b of this.pB) b.length = 0;
    for (const b of this.aB) b.length = 0;
    this.byId.clear();
    this.cover.fill(0);
    this.fern.fill(0);
    this.plantsArr = S.plants;
    this.animalsArr = S.animals;
    for (const p of S.plants) {
      if (!p.ph) p.ph = plantPhenotype(p.sp, p.g);
      this.pB[this.bucketIndex(p.x, p.z)].push(p);
      this.byId.set(p.id, p);
      const ci = this.cellIndex(p.x, p.z);
      this.cover[ci] += p.size * 0.22;
      if (p.sp === 'spirefern') this.fern[ci] += p.size * p.ph.canopy * 0.18;
    }
    for (const a of S.animals) {
      if (!a.ph) a.ph = animalPhenotype(a.sp, a.g);
      this.aB[this.bucketIndex(a.x, a.z)].push(a);
      this.byId.set(a.id, a);
    }
    const N = CELLS * CELLS;
    for (let ci = 0; ci < N; ci++) {
      this.shade[ci] = clamp(this.baseShade[ci] + 0.6 * this.fern[ci], 0, 1);
      this.greenness[ci] = clamp(this.cover[ci], 0, 1);
      this.groundHue[ci] = clamp(0.1 + 0.42 * this.greenness[ci] + 0.22 * this.moist[ci], 0, 1);
    }
  }

  countOf(sp) {
    let n = 0;
    const arr = SPECIES[sp].kind === 'plant' ? this.S.plants : this.S.animals;
    for (const e of arr) if (e.sp === sp) n++;
    return n;
  }
  countsSnapshot() {
    const out = {};
    for (const sp of PLANT_IDS.concat(ANIMAL_IDS)) out[sp] = 0;
    for (const p of this.S.plants) out[p.sp]++;
    for (const a of this.S.animals) out[a.sp]++;
    return out;
  }

  // ───────────── spawning / death ─────────────
  spawnPlant({ sp, x, z, size = 0.08, g, parentId = null }) {
    const S = this.S;
    if (S.plants.length >= MAX_PLANTS) return null;
    const p = { id: S.nextId++, sp, x, z, size, health: 1, age: 0, g, par: parentId };
    p.ph = plantPhenotype(sp, g);
    S.plants.push(p);
    this.pB[this.bucketIndex(x, z)].push(p);
    this.byId.set(p.id, p);
    return p;
  }
  killPlant(p, cause) {
    if (p.dead) return;
    p.dead = true;
    const ci = this.cellIndex(p.x, p.z);
    this.nut[ci] = Math.min(1.5, this.nut[ci] + 0.1 + 0.2 * p.size);
    this.recordDeath(p.sp, cause);
  }
  spawnAnimal({ sp, x, z, g, lin, par, born, energy = 0.7, hyd = 0.8, age = 0 }) {
    const S = this.S;
    if (S.animals.length >= MAX_ANIMALS) return null;
    const a = {
      id: S.nextId++, sp, x, z, hd: this.rng.range(0, Math.PI * 2), energy, hyd, health: 1, age, g,
      lin, par, born, st: 'wander', tgt: null, tgtId: null, tk: this.rng.range(0, 0.5), cd: 0, ac: 0, bur: false, glow: 0,
    };
    a.ph = animalPhenotype(sp, g);
    S.animals.push(a);
    this.aB[this.bucketIndex(x, z)].push(a);
    this.byId.set(a.id, a);
    return a;
  }
  killAnimal(a, cause) {
    if (a.dead) return;
    a.dead = true;
    a.st = 'dead';
    const ci = this.cellIndex(a.x, a.z);
    this.nut[ci] = Math.min(1.5, this.nut[ci] + 0.05 + 0.15 * a.g.size);
    this.recordDeath(a.sp, cause);
    const anc = this.S.ancestry[a.id];
    if (anc) anc.died = this.S.time;
  }
  recordDeath(sp, cause) {
    const d = this.S.day.deaths;
    d[sp] = d[sp] || {};
    d[sp][cause] = (d[sp][cause] || 0) + 1;
    const rec = this.S.species[sp];
    rec.deaths = rec.deaths || {};
    rec.deaths[cause] = (rec.deaths[cause] || 0) + 1;
  }
  recordBirth(sp) {
    const k = this.S.day.births;
    k[sp] = (k[sp] || 0) + 1;
    this.S.species[sp].births = (this.S.species[sp].births || 0) + 1;
  }
  recordKill(sp) {
    const k = this.S.day.kills;
    k[sp] = (k[sp] || 0) + 1;
    this.S.species[sp].kills = (this.S.species[sp].kills || 0) + 1;
  }

  /** Creates a child genome + lineage bookkeeping. */
  makeOffspring(parent, mate) {
    const sp = parent.sp;
    const g = inheritGenome(this.rng, sp, parent.g, mate ? mate.g : null);
    return g;
  }

  // ───────────── player interventions ─────────────
  /** Rainfall: starts a downpour; returns false if on cooldown. */
  rainfall() {
    const c = this.S.climate;
    if (this.S.time < c.playerRainReadyAt) return false;
    c.rain = { on: true, intensity: 0.9, until: this.S.time + 5, player: true };
    c.playerRainReadyAt = this.S.time + 10;
    noteEvent(this, 'intervention', null, 'You called down rain. The basin has been soaked for five hours.', {});
    return true;
  }
  rainReadyIn() {
    return Math.max(0, this.S.climate.playerRainReadyAt - this.S.time);
  }
  /** Spring: adds a long-lasting moisture source. */
  addSpring(x, z) {
    this.S.climate.springs.push({ x, z, until: this.S.time + 72 });
    noteEvent(this, 'intervention', null, `A spring was opened at ${cardinal(x, z)}. Ground nearby will stay damp for three days.`, { x, z });
  }
  /** Mulch adds nutrients to a patch of ground. */
  addMulch(x, z) {
    const r = 7;
    for (let ci = 0; ci < CELLS * CELLS; ci++) {
      const d = Math.hypot(this.cellCX[ci] - x, this.cellCZ[ci] - z);
      if (d < r) this.nut[ci] = Math.min(1.5, this.nut[ci] + 0.5 * (1 - d / r));
    }
    noteEvent(this, 'intervention', null, `Organic mulch spread at ${cardinal(x, z)}. Decomposers and fungi should respond.`, { x, z });
  }
  /** Temperature offset in °C, clamped to a sensible range. */
  setClimateOffset(v) {
    const before = this.S.climate.offset;
    this.S.climate.offset = clamp(v, -8, 10);
    const d = this.S.climate.offset - before;
    if (Math.abs(d) >= 0.5) {
      noteEvent(this, 'intervention', null, `Background temperature ${d > 0 ? 'raised' : 'lowered'} by ${Math.abs(d).toFixed(1)}°. Now ${this.S.climate.offset >= 0 ? '+' : ''}${this.S.climate.offset.toFixed(1)}° offset.`, { offset: this.S.climate.offset });
    }
  }
  /** Selective hazard: individuals far from the preferred side of a trait face extra mortality. */
  addPressure(sp, trait, dir, days = 4) {
    this.S.pressures = this.S.pressures.filter((p) => this.S.time < p.until);
    this.S.pressures.push({ sp, trait, dir, until: this.S.time + days * 24, strength: 0.03 });
    noteEvent(this, 'intervention', sp, `Selective hazard set for ${SPECIES[sp].common}: individuals with ${dir === 'high' ? 'low' : 'high'} ${traitLabel(trait)} face extra risk for ${days} days.`, { trait, dir });
  }
  /** Seeds: plant a few individuals of a species at a location. */
  plantSeeds(spId, x, z) {
    const sp = SPECIES[spId];
    let placed = 0;
    for (let k = 0; k < 14 && placed < 6; k++) {
      const a = this.rng.range(0, Math.PI * 2), r = this.rng.range(0, 4.5);
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (sp.kind === 'plant' && this.plantAllowed(spId, px, pz)) {
        this.spawnPlant({ sp: spId, x: px, z: pz, size: 0.1, g: this.firstGenome(spId) });
        placed++;
      }
    }
    if (placed) noteEvent(this, 'intervention', spId, `${placed} ${sp.common} seeds were planted at ${cardinal(x, z)}.`, { placed });
    return placed;
  }
  /** Introduce an animal founder group. Costs one specimen from the bank. */
  introduce(spId, x, z, count = 6) {
    const sp = SPECIES[spId];
    if (sp.kind !== 'animal') return 0;
    if (this.S.bank < 1) return 0;
    this.S.bank -= 1;
    const rec = this.S.species[spId];
    const firstTime = !rec.discovered;
    rec.discovered = true;
    if (firstTime) rec.discoveredAt = this.S.time;
    let placed = 0;
    let tries = 0;
    while (placed < count && tries < 400) {
      tries++;
      const a = this.rng.range(0, Math.PI * 2), r = this.rng.range(0, 6);
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (!this.animalAllowed(spId, px, pz)) continue;
      const g = this.firstGenome(spId);
      const lin = this.newLineage(spId, null, g);
      this.spawnAnimal({ sp: spId, x: px, z: pz, g, lin, par: null, born: this.S.time, energy: 0.8, hyd: 0.8 });
      placed++;
    }
    if (!rec.founderGenome) rec.founderGenome = this.traitMeans(spId)?.means || null;
    noteEvent(this, 'intervention', spId, `${placed} ${sp.common} introduced at ${cardinal(x, z)} from the specimen bank.`, { placed });
    if (firstTime) noteEvent(this, 'discovery', spId, `${sp.common} is new to this basin. ${sp.blurb}`, {});
    return placed;
  }

  // ───────────── lineages ─────────────
  newLineage(spId, parentLin, g) {
    const L = this.S.lineages;
    const code = SPECIES[spId].code;
    let idx = 0;
    while (L[code + '-' + letter(idx)]) idx++;
    const id = code + '-' + letter(idx);
    L[id] = { id, sp: spId, parent: parentLin, created: this.S.time, founder: { ...g }, count: 0 };
    return id;
  }

  // ───────────── main step ─────────────
  step(dt) {
    const S = this.S;
    this.index();
    stepClimate(this, dt);
    updateGrid(this, dt);
    stepPlants(this, dt);
    stepAnimals(this, dt);
    // compaction
    S.plants = S.plants.filter((p) => !p.dead);
    S.animals = S.animals.filter((a) => !a.dead);
    this.plantsArr = S.plants;
    this.animalsArr = S.animals;
    S.time += dt;
    this.daylight = daylightAt(S.time);
    // day roll-over
    const day = Math.floor(S.time / 24);
    if (day !== S.day.index) {
      S.dayLog.push({ day: S.day.index, t: S.day.index * 24, births: S.day.births, deaths: S.day.deaths, kills: S.day.kills, rainHours: S.day.rain });
      if (S.dayLog.length > 80) S.dayLog.shift();
      analyseDay(this);
      S.day = { index: day, births: {}, deaths: {}, kills: {}, rain: 0 };
    }
    // population sampling
    if (S.history.t.length === 0 || S.time - S.history.t[S.history.t.length - 1] >= HISTORY_EVERY - 1e-6) {
      this.sample();
    }
  }
  sample() {
    const S = this.S;
    const H = S.history;
    H.t.push(+S.time.toFixed(3));
    const counts = this.countsSnapshot();
    for (const sp of Object.keys(counts)) {
      H.counts[sp] = H.counts[sp] || [];
      H.counts[sp].push(counts[sp]);
      if (H.counts[sp].length > HISTORY_MAX) H.counts[sp].shift();
    }
    H.climate.temp.push(+this.temp.toFixed(2));
    H.climate.hum.push(+S.climate.humidity.toFixed(3));
    H.climate.rain.push(S.climate.rain.on ? +S.climate.rain.intensity.toFixed(2) : 0);
    for (const k of ['temp', 'hum', 'rain']) if (H.climate[k].length > HISTORY_MAX) H.climate[k].shift();
    if (H.t.length > HISTORY_MAX) H.t.shift();
    analyseSample(this, counts);
  }
  /** Run n fixed steps (used for settling and offline catch-up). */
  runSteps(n, dt) {
    for (let i = 0; i < n; i++) this.step(dt);
  }

  // ───────────── serialisation helpers ─────────────
  traitMeans(spId) {
    const arr = SPECIES[spId].kind === 'plant' ? this.S.plants : this.S.animals;
    const keys = traitKeys(SPECIES[spId].kind);
    const sums = {};
    let n = 0;
    for (const e of arr) {
      if (e.sp !== spId) continue;
      n++;
      for (const k of keys) sums[k] = (sums[k] || 0) + e.g[k];
    }
    if (!n) return null;
    const out = {};
    for (const k of keys) out[k] = sums[k] / n;
    return { n, means: out };
  }
  toState() {
    const S = this.S;
    S.rngState = this.rng.state >>> 0;
    S.grid = { moist: Array.from(this.moist, (v) => +v.toFixed(4)), nut: Array.from(this.nut, (v) => +v.toFixed(4)) };
    return S;
  }
}

export function newSpeciesRecord() {
  return { discovered: false, discoveredAt: null, founderGenome: null, deaths: {}, births: 0, kills: 0, name: null, boom: false, collapse: null, extinct: false, peak: 0, nearExt: false, traitFlags: {} };
}
export function daylightAt(t) {
  const hour = ((t % 24) + 24) % 24;
  const sunElev = Math.sin((2 * Math.PI * (hour - 6)) / 24);
  return smoothstep(-0.12, 0.25, sunElev);
}
export function letter(i) {
  let s = '';
  i = i + 0;
  do {
    s = String.fromCharCode(65 + (i % 26)) + s;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return s;
}
export function cardinal(x, z) {
  const ns = z < -10 ? 'north' : z > 10 ? 'south' : '';
  const ew = x < -10 ? 'west' : x > 10 ? 'east' : '';
  const s = [ns, ew].filter(Boolean).join('-');
  return s ? `the ${s} ground` : 'the basin centre';
}
export function traitLabel(t) {
  return TRAIT_LABELS[t] || t;
}
export function seedFromText(text) {
  const t = String(text).trim();
  if (/^[0-9a-z]{1,8}$/i.test(t) && t.length >= 4) {
    const v = parseInt(t, 36);
    if (Number.isFinite(v)) return v >>> 0;
  }
  return hashString(t) >>> 0;
}
export function seedCode(seed) {
  return (seed >>> 0).toString(36).toUpperCase().padStart(7, '0');
}
export { ANIMAL_IDS, PLANT_IDS, MAX_ANIMALS, MAX_PLANTS, PREDATORS, genomeDistance };
