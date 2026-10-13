// Animal behaviour: needs-driven decisions (flee, drink, forage, hunt, shelter, mate, rest, burrow)
// with physiology (energy, hydration, thermal stress, age) and encounter-based predation.
import { SPECIES, MAX_ANIMALS, ANIMAL_IDS } from './species.js';
import { animalPhenotype, camoMatch, inheritGenome, genomeDistance, traitKeys } from './genome.js';
import { clamp, smoothstep } from './math.js';
import { noteBirth, noteEvent } from './journal.js';
import { WATER_LEVEL } from './terrain.js';

/** prey species → species that hunt it */
export const PREDATORS = {};
for (const id of ANIMAL_IDS) for (const d of SPECIES[id].diet) (PREDATORS[d] = PREDATORS[d] || []).push(id);
for (const id of ANIMAL_IDS) PREDATORS[id] = PREDATORS[id] || [];

const LINEAGE_SPLIT = 0.11;

function plantPrefScore(spd, idx, diet) {
  const n = spd.diet.length;
  const t = n > 1 ? idx / (n - 1) : 0;
  return spd.dietWeights[idx] * (1 - 0.6 * Math.abs(diet - t));
}

export function stepAnimals(w, dt) {
  const S = w.S;
  const rng = w.rng;
  const counts = {};
  for (const a of S.animals) counts[a.sp] = (counts[a.sp] || 0) + 1;
  const n0 = S.animals.length;
  for (let i = 0; i < n0; i++) {
    const a = S.animals[i];
    if (a.dead) continue;
    const spd = SPECIES[a.sp];
    const ph = a.ph;
    const ci = w.cellIndex(a.x, a.z);
    const T = w.tempAt(ci);
    const m = w.moist[ci];
    const shade = w.shade[ci];
    const depth = w.terrain.depthAt(a.x, a.z);
    const inWater = depth > 0.04;
    const night = w.daylight < 0.22;
    a.glow = spd.glow ? (1 - w.daylight) * ph.glow : 0;

    // ── physiology ──
    let act = 1;
    if (a.bur) act = 0.3;
    else if (a.st === 'flee') act = 1.6;
    else if (a.st === 'rest' || a.st === 'shelter') act = 0.45;
    a.energy -= ph.metab * act * dt;
    if (!spd.aquatic) {
      const loss = ph.waterLoss * (0.5 + 0.05 * Math.max(0, T - 12)) * (1 - 0.5 * shade) * (a.bur ? 0.25 : 1) * (inWater ? 0.2 : 1);
      a.hyd -= loss * dt;
      if (inWater) a.hyd += 0.3 * dt;
      else if (m > 0.55) a.hyd += (m - 0.5) * 0.5 * dt * (a.bur ? 0.5 : 1); // burrowers still absorb moisture from wet soil
      a.hyd = clamp(a.hyd, 0, 1);
    } else {
      a.hyd = 1;
    }
    a.energy = clamp(a.energy, 0, 1);
    const over = Math.max(0, Math.abs(T - ph.tempOpt) - ph.tempTol);
    if (over > 0) a.health -= over * 0.025 * dt * (spd.aquatic && inWater ? 0.3 : 1) * (a.bur ? 0.2 : 1);
    if (a.hyd <= 0.02 && !spd.aquatic) a.health -= 0.12 * dt;
    if (a.energy <= 0.02) a.health -= 0.09 * dt;
    if (over === 0 && a.hyd > 0.4 && a.energy > 0.4) a.health = Math.min(1, a.health + 0.03 * dt);
    a.age += dt;
    a.cd = Math.max(0, a.cd - dt);
    a.ac = Math.max(0, a.ac - dt);
    if (a.age > ph.lifespan) { w.killAnimal(a, 'age'); continue; }
    if (a.health <= 0) {
      const cause = a.energy <= 0.02 ? 'starvation' : a.hyd <= 0.02 ? 'thirst' : over > 0 ? 'temperature' : 'exposure';
      w.killAnimal(a, cause);
      continue;
    }
    // Selective hazards set by the player (natural selection made explicit)
    let hazard = false;
    for (const pr of S.pressures) {
      if (pr.sp !== a.sp || pr.until <= S.time) continue;
      const v = a.g[pr.trait];
      const bad = pr.dir === 'high' ? v < 0.5 : v > 0.5;
      if (bad && rng.chance(pr.strength * (0.3 + 0.7 * Math.abs(v - 0.5) * 2) * dt)) hazard = true;
    }
    if (hazard) { w.killAnimal(a, 'selective hazard'); continue; }

    // ── interactions ──
    if (a.st === 'hunt' && a.tgtId != null) {
      const prey = w.byId.get(a.tgtId);
      if (prey && !prey.dead && a.ac <= 0) {
        const d = Math.hypot(prey.x - a.x, prey.z - a.z);
        if (d < 2.2 + 0.3 * ph.bodyLen) attemptCapture(w, a, prey);
      }
    }
    if (spd.kind === 'animal' && a.st === 'forage' && !spd.burrower) {
      eatPlant(w, a, dt);
    } else if (a.st === 'forage' && spd.burrower) {
      // detritivore: decomposes ground nutrients directly, and takes fungus when in reach
      eatPlant(w, a, dt);
      if (a.tgtId == null && w.nut[ci] > 0.05) {
        const take = Math.min(w.nut[ci], 0.05 * dt);
        w.nut[ci] -= take;
        a.energy = Math.min(1, a.energy + take * 1.2);
      }
    }
    if (a.st === 'mate') tryBreed(w, a, counts);

    // ── decisions ──
    a.tk -= dt;
    const invalid = a.tgtId != null && (!w.byId.get(a.tgtId) || w.byId.get(a.tgtId).dead);
    if (a.tk <= 0 || invalid || a.st === 'dead') {
      decide(w, a, { T, m, shade, inWater, night });
      a.tk = rng.range(0.4, 0.9);
    }

    // ── movement ──
    const spdMul = a.st === 'flee' ? 1.25 : a.st === 'hunt' ? 1.1 : 1;
    if (a.st === 'burrow' || a.st === 'rest' || a.bur || a.st === 'mate' && a.tgtId == null) {
      // stationary
    } else {
      let tx = a.tx, tz = a.tz;
      if (a.tgtId != null) {
        const tg = w.byId.get(a.tgtId);
        if (tg && !tg.dead) { tx = tg.x; tz = tg.z; }
      }
      if (tx != null) steer(w, a, tx, tz, spdMul * (a.st === 'wander' ? 0.45 : 1), dt);
      else wander(w, a, dt);
    }
    if (a.st === 'rest' || a.st === 'burrow' || a.bur) a.hd += 0; // posture is handled in rendering
  }
  void MAX_ANIMALS;
}

function eatPlant(w, a, dt) {
  const spd = SPECIES[a.sp];
  const ph = a.ph;
  if (a.tgtId == null) return;
  const p = w.byId.get(a.tgtId);
  if (!p || p.dead || SPECIES[p.sp].kind !== 'plant') return;
  const d = Math.hypot(p.x - a.x, p.z - a.z);
  if (d > 1.7) return;
  // Bites scale with the plant's size: stubs are left to regrow instead of being stripped
  const bite = Math.min(p.size, 0.035 * dt * (0.6 + 0.8 * a.g.size) * Math.min(1, 0.4 + p.size * 2));
  const food = SPECIES[p.sp].foodValue;
  p.size -= bite;
  p.health -= 0.02 * dt;
  a.energy = Math.min(1, a.energy + bite * food * 2.0 * (0.6 + 0.6 * a.g.eff));
  void spd;
  if (p.size < 0.012) { w.killPlant(p, 'grazed'); a.tgtId = null; } // stubs below this size die; others regrow
  // Satiation: stop foraging once full, so herbivores don't strip the basin
  if (a.energy > 0.92) { a.tk = 0; a.tgtId = null; }
}

function attemptCapture(w, a, prey) {
  const rng = w.rng;
  const ph = a.ph, pp = prey.ph;
  const ci = w.cellIndex(prey.x, prey.z);
  const match = camoMatch(prey.g.hue, w.groundHue[ci]) * prey.g.camo;
  const speedEdge = (ph.maxSpeed - pp.maxSpeed) / Math.max(0.1, ph.maxSpeed);
  const p = clamp(0.3 + 0.25 * speedEdge - 0.5 * pp.shellDefence - 0.3 * match, 0.04, 0.75);
  a.ac = 2.5; // one lunge per encounter; the hunter then has to find another target
  if (rng.chance(p)) {
    w.killAnimal(prey, 'predation');
    a.energy = Math.min(1, a.energy + 0.4 + 0.25 * prey.g.size);
    a.tgtId = null;
    w.recordKill(a.sp);
    const rec = w.S.species[a.sp];
    if (!rec.firstKillNoted) {
      rec.firstKillNoted = true;
      noteEvent(w, 'predation', a.sp, `First recorded predation: a ${SPECIES[a.sp].common} caught a ${SPECIES[prey.sp].common} (camouflage match ${(match * 100).toFixed(0)}%, shell ${(prey.g.shell * 100).toFixed(0)}%).`, { prey: prey.sp, match: +match.toFixed(2) }, a.lin);
    }
  } else {
    prey.st = 'flee';
    prey.tk = 0.2;
    prey.tgtId = null;
  }
}

function tryBreed(w, a, counts) {
  const ph = a.ph;
  if (a.cd > 0 || a.energy < 0.45 || a.hyd < 0.3) return;
  // density dependence: crowded groups breed less often
  let crowd = 0;
  w.forNear(w.aB, a.x, a.z, 6, (o) => { if (o !== a && o.sp === a.sp && !o.dead) crowd++; return false; });
  if (crowd >= 6 && w.rng.chance(Math.min(0.85, (crowd - 4) * 0.12))) return;
  const mate = a.tgtId != null ? w.byId.get(a.tgtId) : null;
  if (!mate || mate.dead || mate.sp !== a.sp || mate.st !== 'mate') return;
  if (Math.hypot(mate.x - a.x, mate.z - a.z) > 1.8) return;
  if (mate.cd > 0 || mate.energy < 0.45) return;
  if (a.id > mate.id) return; // one parent initiates per pair
  const spd = SPECIES[a.sp];
  if ((counts[a.sp] || 0) >= spd.cap) return;
  const litter = Math.max(1, Math.floor(ph.litter * (0.5 + 0.5 * w.rng.next()) + 0.5));
  a.energy -= 0.12;
  mate.energy -= 0.12;
  a.cd = ph.breedCD;
  mate.cd = ph.breedCD;
  for (let k = 0; k < litter; k++) {
    if ((counts[a.sp] || 0) >= spd.cap) break;
    const g = inheritGenome(w.rng, a.sp, a.g, mate.g);
    const lin = a.lin;
    const child = w.spawnAnimal({ sp: a.sp, x: a.x + w.rng.range(-1, 1), z: a.z + w.rng.range(-1, 1), g, lin, par: [a.id, mate.id], born: w.S.time, energy: 0.55, hyd: 0.7 });
    if (!child) break;
    counts[a.sp] = (counts[a.sp] || 0) + 1;
    w.recordBirth(a.sp);
    // lineage: split off a new variant when the offspring is far from its lineage founder
    const L = w.S.lineages[lin];
    if (L) {
      const dist = genomeDistance(g, L.founder, traitKeys('animal'));
      if (dist > LINEAGE_SPLIT) {
        child.lin = w.newLineage(a.sp, lin, g);
        noteEvent(w, 'lineage', a.sp, `New lineage ${child.lin} split from ${lin}. Its founder differs from the ancestral form by ${(dist * 100).toFixed(0)}% on average: ${describeDiff(g, L.founder)}.`, { parent: lin }, child.lin);
      }
    }
    if (w.S.lineages[child.lin]) w.S.lineages[child.lin].count++;
    w.S.ancestry[child.id] = { sp: a.sp, p: [a.id, mate.id], b: w.S.time, lin: child.lin };
    noteBirth(w, child, a, mate, child.lin);
  }
  a.st = 'rest';
  mate.st = 'rest';
  a.tgtId = null;
  mate.tgtId = null;
}

export function describeDiff(g, ref) {
  const keys = traitKeys('animal');
  const diffs = keys.map((k) => [k, (g[k] ?? 0) - (ref[k] ?? 0)]).sort((p, q) => Math.abs(q[1]) - Math.abs(p[1])).slice(0, 2);
  const names = { size: 'body size', legLen: 'leg length', speed: 'locomotor drive', eff: 'energy efficiency', heatTol: 'heat tolerance', waterNeed: 'moisture dependence', camo: 'camouflage', sense: 'sensory range', fert: 'fertility', life: 'lifespan genes', shell: 'shell', hue: 'pigment', diet: 'feeding preference' };
  return diffs.map(([k, v]) => `${v > 0 ? 'higher' : 'lower'} ${names[k] || k} (${v > 0 ? '+' : ''}${v.toFixed(2)})`).join(' and ');
}

function decide(w, a, ctx) {
  const rng = w.rng;
  const spd = SPECIES[a.sp];
  const ph = a.ph;
  const { T, m, shade, inWater, night } = ctx;
  a.tgtId = null;
  a.tx = null;
  a.tz = null;

  // Threat: prey flee from visible predators
  const threat = findThreat(w, a);
  if (threat) {
    const dx = a.x - threat.x, dz = a.z - threat.z;
    const d = Math.hypot(dx, dz) || 1;
    a.st = 'flee';
    a.tx = clamp(a.x + (dx / d) * 12, -w.half + 3, w.half - 3);
    a.tz = clamp(a.z + (dz / d) * 12, -w.half + 3, w.half - 3);
    return;
  }
  // Burrowers dig in when the ground dries or heats
  if (spd.burrower) {
    if (m < 0.2 || T > ph.tempOpt + ph.tempTol * 0.6) { a.bur = true; a.st = 'burrow'; return; }
    if (a.bur && (m > 0.35 && T < ph.tempOpt + ph.tempTol * 0.4)) a.bur = false;
    if (a.bur) { a.st = 'burrow'; return; }
  }
  const thirsty = a.hyd < 0.45 && !spd.aquatic;
  const hungry = a.energy < 0.6;
  const hot = T > ph.tempOpt + ph.tempTol * 0.5;
  const raining = w.S.climate.rain.on && !spd.aquatic;
  if (thirsty) {
    const c = findWetCell(w, a);
    if (c) { a.st = 'drink'; a.tx = c.x; a.tz = c.z; return; }
  }
  if (spd.diet.some((d) => SPECIES[d].kind === 'animal') && a.energy < 0.6) {
    const prey = findPrey(w, a);
    if (prey) { a.st = 'hunt'; a.tgtId = prey.id; return; }
  }
  if (spd.nocturnal && !night && !hungry) {
    const sh = findShade(w, a, 16);
    if (sh) { a.st = 'shelter'; a.tx = sh.x; a.tz = sh.z; return; }
    if (w.terrain.caves.length) {
      let best = null, bd = Infinity;
      for (const cv of w.terrain.caves) { const d = Math.hypot(cv.x - a.x, cv.z - a.z); if (d < bd) { bd = d; best = cv; } }
      a.st = 'shelter'; a.tx = best.x; a.tz = best.z; return;
    }
  }
  if (hungry || (spd.nocturnal && night) || (spd.kind === 'animal' && spd.diet.length && a.energy < 0.8)) {
    const p = findPlant(w, a);
    if (p) { a.st = 'forage'; a.tgtId = p.id; return; }
    if (spd.burrower) { a.st = 'forage'; a.tgtId = null; return; } // no fungus in reach: graze the ground's nutrients
  }
  if ((hot || raining) && !spd.aquatic) {
    const sh = findShade(w, a, 14);
    if (sh) { a.st = 'shelter'; a.tx = sh.x; a.tz = sh.z; return; }
    if (spd.nocturnal && w.terrain.caves.length) {
      // no shade nearby: head for the nearest cave (the mites' daytime refuge)
      let best = null, bd = Infinity;
      for (const cv of w.terrain.caves) { const d = Math.hypot(cv.x - a.x, cv.z - a.z); if (d < bd) { bd = d; best = cv; } }
      a.st = 'shelter'; a.tx = best.x; a.tz = best.z; return;
    }
  }
  if (a.energy > 0.5 && a.hyd > 0.35 && a.health > 0.55 && a.cd <= 0 && a.age > ph.maturity * ph.lifespan) {
    const mate = findMate(w, a);
    if (mate) { a.st = 'mate'; a.tgtId = mate.id; return; }
  }
  if (night && !spd.nocturnal && !hungry && spd.kind === 'animal') {
    a.st = 'rest';
    return;
  }
  a.st = 'wander';
  a.wanderTurn = rng.range(-2, 2);
  void inWater;
}

function findThreat(w, a) {
  const pred = PREDATORS[a.sp];
  if (!pred || pred.length === 0) return null;
  const range = Math.min(4 + 6 * a.g.sense, 9);
  let best = null, bd = Infinity;
  w.forNear(w.aB, a.x, a.z, range, (o) => {
    if (o === a || o.dead || !pred.includes(o.sp)) return false;
    const d = Math.hypot(o.x - a.x, o.z - a.z);
    if (d < range && d < bd) { bd = d; best = o; }
    return false;
  });
  return best;
}

function findPrey(w, a) {
  const spd = SPECIES[a.sp];
  const preyIds = spd.diet.filter((d) => SPECIES[d].kind === 'animal');
  const range = Math.min(a.ph.senseRange, 9);
  let best = null, bs = -Infinity;
  w.forNear(w.aB, a.x, a.z, range, (o) => {
    if (o === a || o.dead || !preyIds.includes(o.sp) || o.bur) return false;
    const d = Math.hypot(o.x - a.x, o.z - a.z);
    if (d > range) return false;
    const ci = w.cellIndex(o.x, o.z);
    const match = camoMatch(o.g.hue, w.groundHue[ci]) * o.g.camo;
    // dense canopy and caves are refuges: a prey animal in deep shade is hard to see unless close
    const refuge = w.shade[ci] > 0.55 && d > 3 ? 0.4 : 1;
    const visible = d < range * (1 - 0.45 * match) * refuge;
    if (!visible) return false;
    const score = -d * (0.6 + 0.4 * (1 - o.g.shell));
    if (score > bs) { bs = score; best = o; }
    return false;
  });
  return best;
}

function findPlant(w, a) {
  const spd = SPECIES[a.sp];
  const range = a.ph.senseRange;
  let best = null, bs = -Infinity;
  w.forNear(w.pB, a.x, a.z, range, (p) => {
    if (p.dead) return false;
    const idx = spd.diet.indexOf(p.sp);
    if (idx < 0 || p.size < 0.08) return false;
    const d = Math.hypot(p.x - a.x, p.z - a.z);
    if (d > range) return false;
    const pref = plantPrefScore(spd, idx, a.g.diet) * SPECIES[p.sp].foodValue;
    const score = pref / (0.5 + d / 4) * (0.5 + p.size);
    if (score > bs) { bs = score; best = p; }
    return false;
  });
  return best;
}

function findWetCell(w, a) {
  // animals remember where water is: the search reaches well beyond their everyday sense range
  const range = Math.max(a.ph.senseRange * 1.4, 22);
  let best = null, bs = -Infinity;
  const step = 2.5;
  for (let dz = -range; dz <= range; dz += step) {
    for (let dx = -range; dx <= range; dx += step) {
      const x = a.x + dx, z = a.z + dz;
      if (Math.abs(x) > w.half - 3 || Math.abs(z) > w.half - 3) continue;
      const ci = w.cellIndex(x, z);
      const wet = w.cellDepth[ci] > 0 ? 1 : w.moist[ci];
      if (wet < 0.55) continue;
      const d = Math.hypot(dx, dz);
      const s = wet * 3 - d * 0.06;
      if (s > bs) { bs = s; best = { x: w.cellCX[ci], z: w.cellCZ[ci] }; }
    }
  }
  return best;
}

function findShade(w, a, range) {
  let best = null, bs = -Infinity;
  const step = 2.5;
  for (let dz = -range; dz <= range; dz += step) {
    for (let dx = -range; dx <= range; dx += step) {
      const x = a.x + dx, z = a.z + dz;
      if (Math.abs(x) > w.half - 3 || Math.abs(z) > w.half - 3) continue;
      const ci = w.cellIndex(x, z);
      if (w.cellDepth[ci] > 0) continue;
      const d = Math.hypot(dx, dz);
      const s = w.shade[ci] * 3 - d * 0.12;
      if (s > bs) { bs = s; best = { x: w.cellCX[ci], z: w.cellCZ[ci] }; }
    }
  }
  return best && bs > 0.35 ? best : null;
}

function findMate(w, a) {
  const range = a.ph.senseRange;
  let best = null, bd = Infinity;
  w.forNear(w.aB, a.x, a.z, range, (o) => {
    if (o === a || o.dead || o.sp !== a.sp) return false;
    if (o.energy < 0.45 || o.hyd < 0.3 || o.cd > 0 || o.age < o.ph.maturity * o.ph.lifespan) return false;
    const d = Math.hypot(o.x - a.x, o.z - a.z);
    if (d < bd) { bd = d; best = o; }
    return false;
  });
  return best;
}

function steer(w, a, tx, tz, speedMul, dt) {
  const ph = a.ph;
  const spd = SPECIES[a.sp];
  const dx = tx - a.x, dz = tz - a.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.12) { a.hd = a.hd; return true; }
  const want = Math.atan2(dz, dx);
  let diff = want - a.hd;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  const turn = clamp(diff, -9 * dt, 9 * dt);
  a.hd += turn;
  const speed = ph.maxSpeed * speedMul * (a.st === 'shelter' || a.st === 'drink' ? 0.9 : 1);
  const step = Math.min(d, speed * dt);
  const nx = a.x + Math.cos(a.hd) * step;
  const nz = a.z + Math.sin(a.hd) * step;
  return tryMove(w, a, nx, nz, step, spd);
}

function wander(w, a, dt) {
  const rng = w.rng;
  a.hd += rng.gauss(1) * 1.2 * dt + (a.wanderTurn || 0) * 0.02 * dt;
  const step = ph_speed(a) * 0.35 * dt;
  const nx = a.x + Math.cos(a.hd) * step;
  const nz = a.z + Math.sin(a.hd) * step;
  if (!tryMove(w, a, nx, nz, step, SPECIES[a.sp])) a.hd += rng.range(1.2, 2.6);
}
function ph_speed(a) {
  return a.ph.maxSpeed;
}

function tryMove(w, a, nx, nz, step, spd) {
  const half = w.half - 2.5;
  if (Math.abs(nx) > half || Math.abs(nz) > half) {
    a.hd += Math.PI * 0.6;
    return false;
  }
  const depthN = w.terrain.depthAt(nx, nz);
  if (spd.aquatic) {
    if (depthN < 0.04 || depthN > 2.6) { a.hd += Math.PI * 0.7 * (w.rng.next() < 0.5 ? 1 : -1); return false; }
  } else if (depthN > 0.08) {
    a.hd += Math.PI * 0.55 * (w.rng.next() < 0.5 ? 1 : -1);
    return false;
  }
  const h0 = w.terrain.heightAt(a.x, a.z);
  const h1 = w.terrain.heightAt(nx, nz);
  const climb = h1 - h0;
  const maxClimb = Math.max(0.35, step * (0.9 + a.ph.legLen * 0.9));
  if (climb > maxClimb && climb > 0.3 && !spd.aquatic) {
    a.hd += Math.PI * 0.4 * (w.rng.next() < 0.5 ? 1 : -1);
    return false;
  }
  a.x = nx;
  a.z = nz;
  return true;
}

export { animalPhenotype, WATER_LEVEL, smoothstep, LINEAGE_SPLIT };
