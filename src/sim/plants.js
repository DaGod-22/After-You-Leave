// Plant population: logistic growth limited by moisture, temperature, shade, nutrients and crowding.
// Plants reproduce by seed dispersal; seeds may fail on unsuitable ground.
import { SPECIES } from './species.js';
import { inheritGenome } from './genome.js';
import { clamp, smoothstep } from './math.js';
import { noteBirth } from './journal.js';

export function plantSuit(spd, ph, m, shade, nut, T) {
  const need = ph.moistNeed;
  let fm;
  if (m < need * 0.45) fm = 0;
  else if (m < need) fm = (m - need * 0.45) / (need * 0.55);
  else fm = m > 0.97 ? 0.85 : 1;
  const ft = Math.exp(-Math.pow((T - spd.tempOpt) / spd.tempTol, 2));
  const fsh = clamp(1 - Math.abs(shade - spd.shadePref) / spd.shadeTol, 0.3, 1);
  const fn = 1 - spd.nutNeed * 0.7 * (1 - clamp(nut / 0.6, 0, 1));
  return fm * ft * fsh * fn;
}

export function stepPlants(w, dt) {
  const S = w.S;
  const rng = w.rng;
  const counts = {};
  for (const p of S.plants) counts[p.sp] = (counts[p.sp] || 0) + 1;
  const n0 = S.plants.length;
  for (let i = 0; i < n0; i++) {
    const p = S.plants[i];
    if (p.dead) continue;
    const spd = SPECIES[p.sp];
    const ph = p.ph;
    const ci = w.cellIndex(p.x, p.z);
    const T = w.tempAt(ci);
    let suit;
    if (spd.aquatic) {
      const depth = w.terrain.depthAt(p.x, p.z);
      suit = depth > 0.04 && depth < 2 ? 1 - smoothstep(1.2, 2.0, depth) * 0.6 : 0;
      suit *= Math.exp(-Math.pow((T - spd.tempOpt) / spd.tempTol, 2));
    } else {
      suit = plantSuit(spd, ph, w.moist[ci], w.shade[ci], w.nut[ci], T);
    }
    let nb = 0;
    w.forNear(w.pB, p.x, p.z, 3.2, (q) => {
      if (q !== p && q.sp === p.sp) nb++;
      return false;
    });
    const comp = 1 / (1 + 0.2 * nb);
    const grow = ph.growth * suit * comp * p.health * (0.25 + p.size) * (1 - p.size) * dt * 1.6;
    p.size = clamp(p.size + grow, 0, 1);
    w.nut[ci] = Math.max(0, w.nut[ci] - grow * 0.4);

    if (suit < 0.25) p.health -= (0.25 - suit) * 0.22 * ph.droughtFactor * dt;
    else p.health = clamp(p.health + 0.04 * dt, 0, 1);
    p.age += dt;
    const life = ph.lifespanEff;
    if (p.age > life) { w.killPlant(p, 'senescence'); continue; }
    if (p.health <= 0 || (p.size < 0.02 && suit < 0.1)) { w.killPlant(p, 'stress'); continue; }

    // Seed dispersal
    if (p.size >= spd.seedMinSize && p.health > 0.5 && rng.chance(spd.seedRate * dt * 2.2 * (0.5 + p.size))) {
      const a = rng.range(0, Math.PI * 2);
      const dist = spd.spread * (0.35 + 0.9 * rng.next()) * (0.75 + 0.5 * p.g.stature);
      const tx = clamp(p.x + Math.cos(a) * dist, -w.half + 2, w.half - 2);
      const tz = clamp(p.z + Math.sin(a) * dist, -w.half + 2, w.half - 2);
      if (!w.plantAllowed(p.sp, tx, tz)) continue;
      const tci = w.cellIndex(tx, tz);
      const tsuit = spd.aquatic ? 0.5 : plantSuit(spd, ph, w.moist[tci], w.shade[tci], w.nut[tci], w.tempAt(tci));
      if (tsuit < 0.2) continue; // seed fell on unsuitable ground
      if ((counts[p.sp] || 0) >= spd.cap) continue;
      const g = inheritGenome(rng, p.sp, p.g);
      const child = w.spawnPlant({ sp: p.sp, x: tx, z: tz, size: 0.07, g, parentId: p.id });
      if (child) {
        counts[p.sp] = (counts[p.sp] || 0) + 1;
        w.recordBirth(p.sp);
        noteBirth(w, child, p, null, null);
      }
    }
  }
}
