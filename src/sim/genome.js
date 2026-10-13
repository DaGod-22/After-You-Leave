// Genomes, inheritance, mutation and the phenotype/trade-off model.
// Traits are normalised to [0,1]. Every physical or physiological effect is derived from them
// here, so the visible body and the simulated behaviour always come from the same numbers.
import { SPECIES, ANIMAL_TRAITS, PLANT_TRAITS } from './species.js';
import { clamp, sq } from './math.js';

export const MUTATION_SD = 0.035;
export const MUTATION_BIG_CHANCE = 0.035;
export const MUTATION_BIG_SD = 0.16;

/** Founder genome drawn around the species mean. */
export function founderGenome(rng, spId) {
  const sp = SPECIES[spId];
  const traits = sp.kind === 'plant' ? PLANT_TRAITS : ANIMAL_TRAITS;
  const g = {};
  for (const t of traits) g[t] = clamp(sp.mean[t] + rng.gauss(sp.sd[t]), 0, 1);
  return g;
}

/** Offspring genome: sexual (two parents, uniform crossover) or asexual (one parent).
 *  Every trait takes a small everyday drift; rarely one trait takes a larger jump (a mutation). */
export function inheritGenome(rng, spId, pa, pb = null) {
  const sp = SPECIES[spId];
  const traits = sp.kind === 'plant' ? PLANT_TRAITS : ANIMAL_TRAITS;
  const g = {};
  for (const t of traits) {
    let v = pb ? (rng.chance(0.5) ? pa[t] : pb[t]) : pa[t];
    v += rng.gauss(MUTATION_SD);
    g[t] = clamp(v, 0, 1);
  }
  if (rng.chance(MUTATION_BIG_CHANCE)) {
    const t = rng.pick(traits);
    g[t] = clamp(g[t] + rng.gauss(MUTATION_BIG_SD), 0, 1);
  }
  return g;
}

/** Mean absolute trait difference, used for lineage splitting and mutation detection. */
export function genomeDistance(a, b, keys) {
  let s = 0;
  for (const k of keys) s += Math.abs((a[k] ?? 0) - (b[k] ?? 0));
  return s / keys.length;
}

/** Animal phenotype: morphology + physiology derived from the genome and species base. */
export function animalPhenotype(spId, g) {
  const sp = SPECIES[spId];
  const size = g.size;
  const bodyLen = sp.bodySize * (0.75 + 0.6 * size);
  const bodyH = sp.bodySize * (0.45 + 0.42 * size);
  const legLen = sp.legBase * (0.55 + 0.9 * g.legLen);
  const speedMax = sp.speed * (0.6 + 0.7 * g.speed) * (0.7 + 0.6 * legLen / Math.max(0.2, sp.legBase || 1)) * (1.1 - 0.35 * g.shell) * (1.1 - 0.25 * size);
  const metab = sp.metab * (0.45 + 0.9 * size) * (0.65 + 0.7 * g.speed) * (1.3 - 0.65 * g.eff);
  const shellAmt = clamp((g.shell - 0.3) / 0.45, 0, 1);
  const hornCount = sp.horns && g.shell > 0.5 ? sp.horns : sp.horns && size > 0.75 ? 1 : 0;
  return {
    bodyLen,
    bodyH,
    legLen,
    legThick: 0.035 + 0.02 * size,
    legs: sp.legs,
    shellAmt,
    horns: hornCount,
    hornLen: 0.25 + 0.35 * g.shell,
    antennae: sp.antennae,
    antennaLen: 0.5 + 0.7 * g.sense,
    tailLen: sp.tail * (0.6 + 0.8 * (1 - g.speed * 0.3)),
    fins: sp.fins,
    finSize: 0.5 + 0.6 * g.speed,
    eyeSize: 0.06 + 0.05 * g.sense,
    pattern: clamp((g.camo - 0.25) / 0.6, 0, 1),
    glow: sp.glow ? clamp(0.35 + 0.4 * g.sense + 0.25 * g.life, 0, 1) : 0,
    colour: pigment(clamp(sp.hueBase + (g.hue - 0.5) * sp.hueSpread, 0, 1), g.camo),
    maxSpeed: speedMax,
    metab,
    tempOpt: sp.tempOpt + (g.heatTol - 0.5) * 9,
    tempTol: sp.tempTol * (0.7 + 0.6 * g.heatTol),
    waterLoss: sp.waterLoss * (0.4 + 1.2 * g.waterNeed) * (0.8 + 0.4 * size),
    senseRange: sp.sense * (0.6 + 0.8 * g.sense),
    breedCD: sp.breedCD * (1.35 - 0.8 * g.fert),
    litter: 1 + Math.floor(g.fert * sp.litterMax + 0.15),
    lifespan: sp.lifespan * (0.7 + 0.6 * g.life),
    maturity: sp.maturity,
    camoStrength: g.camo,
    shellDefence: 0.55 * g.shell,
  };
}

/** Plant phenotype. */
export function plantPhenotype(spId, g) {
  const sp = SPECIES[spId];
  return {
    height: sp.height * (0.5 + 0.9 * g.stature),
    leaves: Math.round(3 + 9 * g.leafy),
    colour: pigment(clamp(sp.hueBase + (g.hue - 0.5) * sp.hueSpread, 0, 1), 0.5),
    lean: (g.lean - 0.5) * 0.9,
    growth: sp.growth * (0.55 + 0.9 * g.vigor),
    lifespanEff: sp.lifespan * (1.15 - 0.3 * g.vigor),
    moistNeed: clamp(sp.moistMin + 0.18 * (g.stature - 0.5), 0.02, 0.98),
    droughtFactor: 1.3 - 0.8 * g.droughtTol,
    canopy: 0.5 + g.stature * 1.2,
  };
}

// Palette ramp: pale sand → umber → sage → jade → deep teal. Used for animals and plants alike.
const RAMP = [
  [0.0, [0.73, 0.64, 0.48]],
  [0.25, [0.49, 0.41, 0.28]],
  [0.45, [0.5, 0.58, 0.41]],
  [0.65, [0.31, 0.5, 0.45]],
  [1.0, [0.18, 0.33, 0.37]],
];
export function pigment(t, camo = 0.5) {
  t = clamp(t, 0, 1);
  for (let i = 0; i < RAMP.length - 1; i++) {
    const [t0, c0] = RAMP[i];
    const [t1, c1] = RAMP[i + 1];
    if (t <= t1) {
      const u = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u];
    }
  }
  return RAMP[RAMP.length - 1][1].slice();
}

/** How well a body colour matches a ground hue (0 = sand, 1 = deep teal). Returns 0..1. */
export function camoMatch(hueVal, groundHue) {
  return clamp(1 - Math.abs(hueVal - groundHue) * 2.6, 0, 1);
}

export const ALL_KEYS = { animal: ANIMAL_TRAITS, plant: PLANT_TRAITS };
export function traitKeys(kind) {
  return kind === 'plant' ? PLANT_TRAITS : ANIMAL_TRAITS;
}
export { sq };
