// Organic creature parts. Bodies, heads, shells, horns, antennae, tails and limb segments are lathe
// profiles (smooth surfaces of revolution), not primitives. Each profile is shared by every species that
// uses it; genes change proportions through instance scale and colour, never through the profile itself.
import * as THREE from 'three';
import { leafGeometry } from './parts.js';

const V = (pts) => pts.map(([r, y]) => new THREE.Vector2(r, y));
const SEG = 24;

function lathe(points, segs = SEG) {
  return new THREE.LatheGeometry(V(points), segs);
}
/** Samples a profile f(t) for t in [0,1] into [radius, height] pairs. */
function sample(n, f) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(f(t));
  }
  return out;
}
const pw = (x, p) => Math.pow(Math.max(0, x), p);

/** Long bodies: lathe along Y, then rotated so the long axis runs along X (front = +X). */
function longBody(profile, n = 26) {
  const g = lathe(sample(n, (t) => [profile(t), -1 + 2 * t]));
  g.rotateZ(-Math.PI / 2);
  return g;
}

export const CREATURE_GEO = {
  // bodies (long axis = X, unit half-length)
  'body:egg': longBody((t) => pw(Math.sin(Math.PI * t), 0.65) * (t < 0.5 ? 0.97 : 1)),
  'body:slim': longBody((t) => pw(Math.sin(Math.PI * t), 0.8) * 0.74),
  'body:stream': longBody((t) => pw(Math.sin(Math.PI * t), 0.9) * (0.7 + 0.3 * t)),
  'body:round': longBody((t) => pw(Math.sin(Math.PI * t), 0.5)),
  // heads (long axis = X, front = +X)
  'head:blunt': longBody((t) => pw(Math.sin(Math.PI * t), 0.6) * (0.62 + 0.38 * t), 18),
  'head:long': longBody((t) => pw(Math.sin(Math.PI * t), 0.55) * (0.42 + 0.2 * t), 18),
  // shells: dome on Y, base at origin
  shell: lathe(sample(18, (t) => [Math.pow(Math.cos((t * Math.PI) / 2), 0.9) * (1 + 0.035 * Math.sin(t * Math.PI * 7)), Math.sin((t * Math.PI) / 2)])),
  horn: lathe([[0.24, 0], [0.17, 0.45], [0.07, 0.8], [0.0, 1.0]], 10),
  antenna: lathe([[0.1, 0], [0.065, 0.5], [0.05, 0.9], [0.12, 1.0], [0.1, 1.07], [0.0, 1.1]], 8),
  tail: lathe([[0.3, 0], [0.22, 0.3], [0.12, 0.7], [0.03, 1.0], [0.0, 1.0]], 10),
  // limb segment: origin at the top joint, extends to y = -1 with knobbed joints
  limb: lathe([[0.2, -1], [0.13, -0.8], [0.11, -0.55], [0.15, -0.3], [0.24, -0.08], [0.22, 0]], 8),
  eye: new THREE.SphereGeometry(1, 10, 8),
  glow: lathe(sample(14, (t) => [pw(Math.sin(Math.PI * t), 0.5), -1 + 2 * t]), 12),
  fin: leafGeometry(0.5, 0.05, 8),
};

/** Which parts each species wears. Anatomy follows the species' phenotype fields at runtime. */
export const CFG = {
  grazer: { body: 'body:egg', head: 'head:blunt', shell: true, horns: true, antenna: true, tail: 'short' },
  stalker: { body: 'body:slim', head: 'head:long', antenna: true, tail: 'long' },
  skimmer: { body: 'body:stream', head: 'head:blunt', fin: true, tail: 'long' },
  mire: { body: 'body:egg', head: 'head:blunt', tail: 'short' },
  lumen: { body: 'body:round', head: 'head:blunt', antenna: true, glow: true },
  tessel: { body: 'body:stream', head: 'head:blunt', antenna: true, tail: 'short' },
};

/** Ground-hugging soft shadow blob, flat and unit-sized. */
export function blobGeometry() {
  return new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
}
