// Species roster. Numbers here are the *founding* biology; the simulation derives everything else
// from these values plus each organism's heritable genome (see genome.js).

export const PLANT_TRAITS = ['stature', 'leafy', 'hue', 'vigor', 'droughtTol', 'lean'];
export const ANIMAL_TRAITS = ['size', 'legLen', 'speed', 'eff', 'heatTol', 'waterNeed', 'camo', 'sense', 'fert', 'life', 'shell', 'hue', 'diet'];

export const TRAIT_LABELS = {
  size: 'Body size',
  legLen: 'Leg length',
  speed: 'Locomotor drive',
  eff: 'Energy efficiency',
  heatTol: 'Heat tolerance',
  waterNeed: 'Moisture dependence',
  camo: 'Camouflage',
  sense: 'Sensory range',
  fert: 'Fertility',
  life: 'Lifespan genes',
  shell: 'Shell / plating',
  hue: 'Pigment (sand → teal)',
  diet: 'Feeding preference',
  stature: 'Stature',
  leafy: 'Leaf density',
  vigor: 'Growth vigour',
  droughtTol: 'Drought tolerance',
  lean: 'Lean / habit',
};

// Trait sd values are for the founding population; "mean" is the founding mean.
export const SPECIES = {
  // ───────────── PLANTS ─────────────
  veilmoss: {
    id: 'veilmoss', kind: 'plant', code: 'VMS', common: 'Veil Moss', role: 'Producer · ground cover',
    blurb: 'A low, plush carpet that thickens where the ground stays damp. It spreads by spores on the breeze.',
    growth: 0.11, moistMin: 0.28, moistOpt: 0.6, tempOpt: 17, tempTol: 9, shadePref: 0.3, shadeTol: 0.6,
    lifespan: 900, spread: 4.2, seedRate: 0.05, seedMinSize: 0.45, cap: 300, founders: 150, foodValue: 0.55,
    height: 0.35, hueBase: 0.42, hueSpread: 0.25, aquatic: false, nutNeed: 0.5,
    mean: { stature: 0.25, leafy: 0.55, hue: 0.45, vigor: 0.5, droughtTol: 0.4, lean: 0.5 },
    sd: { stature: 0.10, leafy: 0.12, hue: 0.14, vigor: 0.12, droughtTol: 0.12, lean: 0.2 },
  },
  spirefern: {
    id: 'spirefern', kind: 'plant', code: 'SPF', common: 'Spire Fern', role: 'Producer · canopy tree-fern',
    blurb: 'Tall branching fronds that shade the ground beneath them. Its shade favours mosses and fungi.',
    growth: 0.04, moistMin: 0.40, moistOpt: 0.7, tempOpt: 16, tempTol: 8, shadePref: 0.25, shadeTol: 0.6,
    lifespan: 1400, spread: 9, seedRate: 0.025, seedMinSize: 0.7, cap: 95, founders: 46, foodValue: 0.9,
    height: 2.8, hueBase: 0.5, hueSpread: 0.3, aquatic: false, nutNeed: 0.4,
    mean: { stature: 0.55, leafy: 0.6, hue: 0.5, vigor: 0.45, droughtTol: 0.35, lean: 0.5 },
    sd: { stature: 0.14, leafy: 0.14, hue: 0.12, vigor: 0.12, droughtTol: 0.12, lean: 0.2 },
  },
  tallowbulb: {
    id: 'tallowbulb', kind: 'plant', code: 'TBL', common: 'Tallow Bulb', role: 'Producer · succulent storage plant',
    blurb: 'A drought-hardy succulent that stores water in swollen bulbs. Grazers rely on it in dry seasons.',
    growth: 0.035, moistMin: 0.08, moistOpt: 0.25, tempOpt: 25, tempTol: 10, shadePref: 0.1, shadeTol: 0.6,
    lifespan: 1100, spread: 7, seedRate: 0.02, seedMinSize: 0.6, cap: 85, founders: 34, foodValue: 1.0,
    height: 0.9, hueBase: 0.3, hueSpread: 0.25, aquatic: false, nutNeed: 0.3,
    mean: { stature: 0.4, leafy: 0.45, hue: 0.3, vigor: 0.4, droughtTol: 0.7, lean: 0.5 },
    sd: { stature: 0.12, leafy: 0.12, hue: 0.12, vigor: 0.12, droughtTol: 0.1, lean: 0.2 },
  },
  capfungus: {
    id: 'capfungus', kind: 'plant', code: 'UCF', common: 'Umber Cap Fungus', role: 'Fungal producer · decomposer',
    blurb: 'Fruiting caps that feed on dead matter. They thrive in shade and wet soil and release spores into the air.',
    growth: 0.07, moistMin: 0.5, moistOpt: 0.8, tempOpt: 14, tempTol: 8, shadePref: 0.2, shadeTol: 0.8,
    lifespan: 520, spread: 3.2, seedRate: 0.05, seedMinSize: 0.5, cap: 120, founders: 60, foodValue: 0.8,
    height: 0.55, hueBase: 0.2, hueSpread: 0.2, aquatic: false, nutNeed: 0.8,
    mean: { stature: 0.35, leafy: 0.3, hue: 0.22, vigor: 0.55, droughtTol: 0.2, lean: 0.5 },
    sd: { stature: 0.12, leafy: 0.12, hue: 0.1, vigor: 0.12, droughtTol: 0.1, lean: 0.2 },
  },
  reedlily: {
    id: 'reedlily', kind: 'plant', code: 'RLY', common: 'Pond Reed-Lily', role: 'Aquatic producer · shoreline',
    blurb: 'Pad-leaved reeds rooted in the shallows. Pond skimmers graze their seed heads and young leaves.',
    growth: 0.09, moistMin: 0.9, moistOpt: 1, tempOpt: 18, tempTol: 10, shadePref: 0.2, shadeTol: 0.8,
    lifespan: 800, spread: 3.2, seedRate: 0.06, seedMinSize: 0.5, cap: 70, founders: 42, foodValue: 0.7,
    height: 1.1, hueBase: 0.6, hueSpread: 0.25, aquatic: true, nutNeed: 0.4,
    mean: { stature: 0.45, leafy: 0.6, hue: 0.6, vigor: 0.5, droughtTol: 0.5, lean: 0.5 },
    sd: { stature: 0.12, leafy: 0.12, hue: 0.12, vigor: 0.12, droughtTol: 0.1, lean: 0.2 },
  },

  // ───────────── ANIMALS ─────────────
  grazer: {
    id: 'grazer', kind: 'animal', code: 'GRZ', common: 'Shelled Grazer', role: 'Herbivore · grazer',
    blurb: 'A slow, six-legged grazer with a domed back plate. It needs regular water and rests in shade during heat.',
    diet: ['veilmoss', 'spirefern', 'tallowbulb'], dietWeights: [1, 0.7, 0.5],
    speed: 11, metab: 0.017, lifespan: 480, maturity: 0.25, breedCD: 80, litterMax: 2, sense: 9, cap: 115, founders: 50,
    waterLoss: 0.024, tempOpt: 18, tempTol: 9, hueBase: 0.42, hueSpread: 0.6, legs: 6, bodySize: 1.0, legBase: 0.9,
    shellable: true, horns: 2, antennae: 2, tail: 0.5, fins: 0, glow: false, aquatic: false, nocturnal: false, burrower: false,
    mean: { size: 0.55, legLen: 0.45, speed: 0.5, eff: 0.55, heatTol: 0.5, waterNeed: 0.5, camo: 0.4, sense: 0.5, fert: 0.5, life: 0.5, shell: 0.6, hue: 0.45, diet: 0.3 },
    sd: { size: 0.1, legLen: 0.1, speed: 0.1, eff: 0.1, heatTol: 0.1, waterNeed: 0.1, camo: 0.12, sense: 0.1, fert: 0.1, life: 0.1, shell: 0.1, hue: 0.14, diet: 0.15 },
  },
  stalker: {
    id: 'stalker', kind: 'animal', code: 'STK', common: 'Long-legged Stalker', role: 'Predator · ambush hunter',
    blurb: 'A long-legged hunter that tracks grazers by movement. It is fast on open ground but needs a lot of food.',
    diet: ['grazer', 'tessel', 'lumen', 'skimmer'], dietWeights: [1, 1, 0.6, 0.7],
    speed: 19, metab: 0.014, mealValue: 0.55, lifespan: 420, maturity: 0.3, breedCD: 100, litterMax: 2, sense: 14, cap: 16, founders: 8,
    waterLoss: 0.022, tempOpt: 17, tempTol: 10, hueBase: 0.3, hueSpread: 0.5, legs: 4, bodySize: 1.1, legBase: 1.5,
    shellable: false, horns: 0, antennae: 2, tail: 1.1, fins: 0, glow: false, aquatic: false, nocturnal: false, burrower: false,
    mean: { size: 0.5, legLen: 0.75, speed: 0.7, eff: 0.4, heatTol: 0.45, waterNeed: 0.4, camo: 0.5, sense: 0.7, fert: 0.4, life: 0.45, shell: 0.1, hue: 0.4, diet: 0.5 },
    sd: { size: 0.1, legLen: 0.1, speed: 0.1, eff: 0.1, heatTol: 0.1, waterNeed: 0.1, camo: 0.12, sense: 0.1, fert: 0.1, life: 0.1, shell: 0.06, hue: 0.14, diet: 0.15 },
  },
  mire: {
    id: 'mire', kind: 'animal', code: 'MIR', common: 'Mire Burrower', role: 'Detritivore · moisture-sensitive burrower',
    blurb: 'A soft-bodied recycler that feeds on fungus and decay. It burrows out of sight when the ground dries.',
    diet: ['capfungus'], dietWeights: [1],
    speed: 3.5, metab: 0.008, lifespan: 800, maturity: 0.3, breedCD: 110, litterMax: 1, sense: 5, cap: 110, founders: 50,
    waterLoss: 0.03, tempOpt: 16, tempTol: 7, hueBase: 0.12, hueSpread: 0.4, legs: 0, bodySize: 0.85, legBase: 0,
    shellable: false, horns: 0, antennae: 2, tail: 0.2, fins: 0, glow: false, aquatic: false, nocturnal: false, burrower: true,
    mean: { size: 0.4, legLen: 0.2, speed: 0.3, eff: 0.6, heatTol: 0.35, waterNeed: 0.75, camo: 0.35, sense: 0.4, fert: 0.4, life: 0.6, shell: 0.25, hue: 0.2, diet: 0.5 },
    sd: { size: 0.1, legLen: 0.08, speed: 0.1, eff: 0.1, heatTol: 0.1, waterNeed: 0.1, camo: 0.12, sense: 0.1, fert: 0.1, life: 0.1, shell: 0.1, hue: 0.12, diet: 0.15 },
  },
  skimmer: {
    id: 'skimmer', kind: 'animal', code: 'SKM', common: 'Pond Skimmer', role: 'Aquatic herbivore · shallow-water grazer',
    blurb: 'A finned grazer that skims the shallows for reed-lily tissue. It cannot leave the water.',
    diet: ['reedlily'], dietWeights: [1],
    speed: 10, metab: 0.013, lifespan: 400, maturity: 0.25, breedCD: 70, litterMax: 2, sense: 8, cap: 40, founders: 20,
    waterLoss: 0, tempOpt: 19, tempTol: 9, hueBase: 0.55, hueSpread: 0.45, legs: 0, bodySize: 0.8, legBase: 0,
    shellable: false, horns: 0, antennae: 0, tail: 0.9, fins: 2, glow: false, aquatic: true, nocturnal: false, burrower: false,
    mean: { size: 0.45, legLen: 0.2, speed: 0.55, eff: 0.5, heatTol: 0.5, waterNeed: 0.9, camo: 0.45, sense: 0.5, fert: 0.5, life: 0.45, shell: 0.2, hue: 0.55, diet: 0.5 },
    sd: { size: 0.1, legLen: 0.08, speed: 0.1, eff: 0.1, heatTol: 0.1, waterNeed: 0.04, camo: 0.12, sense: 0.1, fert: 0.1, life: 0.1, shell: 0.1, hue: 0.12, diet: 0.15 },
  },
  lumen: {
    id: 'lumen', kind: 'animal', code: 'LMN', common: 'Lumen Mite', role: 'Nocturnal detritivore · cave-dweller',
    blurb: 'A rare, nocturnal fungus-eater that gathers in cool shelters. Its pale glow appears only after dark.',
    diet: ['capfungus'], dietWeights: [1],
    speed: 6, metab: 0.010, lifespan: 360, maturity: 0.3, breedCD: 60, litterMax: 2, sense: 6, cap: 80, founders: 40,
    waterLoss: 0.03, tempOpt: 16, tempTol: 9, hueBase: 0.7, hueSpread: 0.35, legs: 6, bodySize: 0.5, legBase: 0.6,
    shellable: false, horns: 0, antennae: 2, tail: 0, fins: 0, glow: true, aquatic: false, nocturnal: true, burrower: false,
    mean: { size: 0.3, legLen: 0.4, speed: 0.4, eff: 0.6, heatTol: 0.4, waterNeed: 0.6, camo: 0.3, sense: 0.6, fert: 0.5, life: 0.4, shell: 0.15, hue: 0.7, diet: 0.5 },
    sd: { size: 0.08, legLen: 0.1, speed: 0.1, eff: 0.1, heatTol: 0.1, waterNeed: 0.1, camo: 0.1, sense: 0.1, fert: 0.1, life: 0.1, shell: 0.08, hue: 0.12, diet: 0.15 },
  },
  tessel: {
    id: 'tessel', kind: 'animal', code: 'TSL', common: 'Tessel Hopper', role: 'Herbivore · fast-breeding grazer (introduced)',
    blurb: 'A light, fast-breeding grazer from elsewhere. It multiplies quickly on moss and crashes when the moss runs out.',
    diet: ['veilmoss'], dietWeights: [1],
    speed: 15, metab: 0.012, lifespan: 200, maturity: 0.15, breedCD: 24, litterMax: 3, sense: 8, cap: 220, founders: 0,
    waterLoss: 0.035, tempOpt: 20, tempTol: 9, hueBase: 0.6, hueSpread: 0.4, legs: 4, bodySize: 0.7, legBase: 0.9,
    shellable: false, horns: 0, antennae: 2, tail: 0.4, fins: 0, glow: false, aquatic: false, nocturnal: false, burrower: false,
    mean: { size: 0.3, legLen: 0.6, speed: 0.65, eff: 0.3, heatTol: 0.55, waterNeed: 0.4, camo: 0.2, sense: 0.6, fert: 0.85, life: 0.25, shell: 0.1, hue: 0.6, diet: 0.1 },
    sd: { size: 0.08, legLen: 0.1, speed: 0.1, eff: 0.1, heatTol: 0.1, waterNeed: 0.1, camo: 0.1, sense: 0.1, fert: 0.06, life: 0.08, shell: 0.06, hue: 0.12, diet: 0.1 },
  },
};

export const PLANT_IDS = Object.keys(SPECIES).filter((k) => SPECIES[k].kind === 'plant');
export const ANIMAL_IDS = Object.keys(SPECIES).filter((k) => SPECIES[k].kind === 'animal');
/** Species that start in a new world. The rest are introduced by the player. */
export const STARTING_SPECIES = ['veilmoss', 'spirefern', 'tallowbulb', 'capfungus', 'reedlily', 'grazer', 'stalker', 'mire', 'skimmer', 'lumen'];
export const INTRODUCABLE = ['veilmoss', 'spirefern', 'tallowbulb', 'capfungus', 'reedlily', 'grazer', 'stalker', 'mire', 'skimmer', 'lumen', 'tessel'];

export const MAX_ANIMALS = 460;
export const MAX_PLANTS = 900;
