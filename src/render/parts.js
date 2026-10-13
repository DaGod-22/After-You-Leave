// Procedural part geometry, instanced part pools, PBR materials and shader hooks
// (plant wind sway, genetic body patterns). Every organism is assembled from these parts.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Lens-shaped leaf/fin, base at origin, pointing +Y, length 1, half-width w. Double-sided. */
export function leafGeometry(w = 0.22, bend = 0.12, segs = 10) {
  const pos = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const width = w * Math.pow(Math.sin(Math.PI * Math.min(0.999, u * 0.92 + 0.04)), 0.8);
    pos.push(-width, u, bend * u * u, width, u, bend * u * u);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx.concat(idx.slice().reverse()));
  g.computeVertexNormals();
  return g;
}

function blade(w, lean, bend) {
  const g = leafGeometry(w, bend, 6);
  g.rotateX(lean);
  return g;
}

/** Irregular boulder: an icosahedron with seeded radial jitter, flattened vertically. */
export function rockGeometry(seed = 1) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const jitter = [];
  for (let i = 0; i < p.count; i++) jitter.push(0.82 + rnd() * 0.3);
  for (let i = 0; i < p.count; i++) {
    const k = jitter[i];
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

export const GEOMS = {};
export function buildGeometries() {
  if (GEOMS.stem) return GEOMS;
  GEOMS.stem = new THREE.LatheGeometry([new THREE.Vector2(0.5, 0), new THREE.Vector2(0.62, 0.3), new THREE.Vector2(0.5, 0.7), new THREE.Vector2(0.28, 1)], 6);
  GEOMS.leaf = leafGeometry(0.2, 0.12);
  GEOMS.frond = leafGeometry(0.11, 0.2, 12);
  GEOMS.broadLeaf = leafGeometry(0.34, 0.08, 10);
  // moss tuft: a fan of curved blades, merged into one geometry
  const blades = [];
  for (let i = 0; i < 7; i++) {
    const g = blade(0.09, 0.25 + (i % 3) * 0.12, 0.5 + (i % 2) * 0.3);
    g.rotateY((i / 7) * Math.PI * 2);
    g.translate(Math.cos(i * 2.1) * 0.12, 0, Math.sin(i * 2.1) * 0.12);
    blades.push(g);
  }
  GEOMS.tuft = mergeGeometries(blades);
  // onion-shaped bulb, mushroom cap with a flared edge, teardrop seed pod
  GEOMS.bulb = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.5, 0.08), new THREE.Vector2(0.95, 0.42), new THREE.Vector2(0.9, 0.74), new THREE.Vector2(0.5, 0.97), new THREE.Vector2(0, 1)], 14);
  GEOMS.cap = new THREE.LatheGeometry([new THREE.Vector2(0, 0.02), new THREE.Vector2(0.5, 0.05), new THREE.Vector2(0.9, 0.2), new THREE.Vector2(1.02, 0.36), new THREE.Vector2(0.94, 0.46), new THREE.Vector2(0.72, 0.48), new THREE.Vector2(0.0, 0.42)], 16);
  GEOMS.pad = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(1, 0), new THREE.Vector2(1.04, 0.05), new THREE.Vector2(0.9, 0.09), new THREE.Vector2(0, 0.06)], 16);
  GEOMS.pod = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.45, 0.1), new THREE.Vector2(0.6, 0.5), new THREE.Vector2(0.35, 0.9), new THREE.Vector2(0, 1)], 10);
  // static decor (rocks, pebbles, fallen branches, mineral crystals, rock arches)
  GEOMS.rock = [rockGeometry(1), rockGeometry(2), rockGeometry(3)];
  GEOMS.pebble = new THREE.IcosahedronGeometry(1, 0);
  GEOMS.branch = new THREE.CylinderGeometry(0.5, 0.7, 1, 6, 1).rotateZ(Math.PI / 2);
  GEOMS.crystal = new THREE.OctahedronGeometry(1, 0);
  GEOMS.arch = new THREE.TorusGeometry(1, 0.42, 8, 18, Math.PI);
  return GEOMS;
}

/**
 * A pool of instances for one geometry/material pair. Matrices and colours are rewritten each frame.
 * If `params` is set, each instance also carries a vec4 (aParam) read by shaders for genetic patterns.
 */
export class PartPool {
  constructor(geometry, material, capacity, { castShadow = true, params = false, receiveShadow = true } = {}) {
    this.cap = capacity;
    let geo = geometry;
    this.params = params;
    if (params) geo = geometry.clone();
    this.mesh = new THREE.InstancedMesh(geo, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    if (params) {
      this.pAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
      this.pAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aParam', this.pAttr);
      this.p = this.pAttr.array;
    }
    this.mesh.count = 0;
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = receiveShadow;
    this.mesh.frustumCulled = false;
    this.n = 0;
    this.owner = [];
    this.m = this.mesh.instanceMatrix.array;
    this.c = this.mesh.instanceColor.array;
  }
  begin() {
    this.n = 0;
  }
  /** Writes matrix, colour and optional parameters. Returns the instance index or -1 when full. */
  add(mat, r, g, b, q) {
    if (this.n >= this.cap) return -1;
    const i = this.n++;
    this.m.set(mat.elements, i * 16);
    this.c[i * 3] = r;
    this.c[i * 3 + 1] = g;
    this.c[i * 3 + 2] = b;
    if (this.p && q) { this.p[i * 4] = q[0]; this.p[i * 4 + 1] = q[1]; this.p[i * 4 + 2] = q[2]; this.p[i * 4 + 3] = q[3]; }
    return i;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    if (this.pAttr) this.pAttr.needsUpdate = true;
  }
}

export function makeMaterials() {
  return {
    plant: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.74, metalness: 0, side: THREE.DoubleSide }),
    animal: applyPattern(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.0 })),
    shell: applyPattern(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.34, metalness: 0.04 })),
    eye: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0.0 }),
    glow: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
    rock: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 }),
    mineral: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.1 }),
    wood: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 }),
    cave: new THREE.MeshStandardMaterial({ color: 0x2e302c, roughness: 1, metalness: 0 }),
  };
}

const NOISE_GLSL = `
float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
float vn3(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  float a = mix(mix(h3(i), h3(i+vec3(1,0,0)), f.x), mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), f.x), f.y);
  float b = mix(mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), f.x), mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), f.x), f.y);
  return mix(a, b, f.z);
}`;

/**
 * Genetic surface patterns for animals. aParam = (pattern amount, pattern type, seed, wetness).
 * Spots and bands are computed in object space so they stay attached to the body while it moves.
 */
export function applyPattern(material) {
  material.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n#ifdef USE_INSTANCING\n attribute vec4 aParam;\n#else\n attribute vec4 aParam;\n#endif\n varying vec4 vParam; varying vec3 vObj;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n vParam = aParam; vObj = position;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec4 vParam; varying vec3 vObj;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float seed = vParam.z * 17.0;
        float pn = vn3(vObj * 4.0 + seed);
        float pn2 = vn3(vObj * 9.0 + seed * 1.7);
        float spots = smoothstep(0.66, 0.74, pn2) * step(0.5, vParam.y);
        float bands = smoothstep(0.55, 0.7, 0.5 + 0.5 * sin(vObj.x * 7.0 + pn * 4.0)) * (1.0 - step(0.5, vParam.y));
        float pat = max(spots, bands) * vParam.x;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.42, 0.44, 0.48) + vec3(0.015), pat * 0.85);
        diffuseColor.rgb *= 0.92 + 0.16 * pn;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n roughnessFactor = clamp(roughnessFactor - vParam.w * 0.35, 0.08, 1.0);`);
  };
  material.customProgramCacheKey = () => 'animal-pattern-v1';
  return material;
}

/** Adds a sway-in-wind vertex displacement to plant materials (phase from the instance position). */
export function addWind(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform float uWind;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ipos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 ipos = vec3(0.0);
        #endif
        float hgt = max(position.y, 0.0);
        float ph = ipos.x * 0.37 + ipos.z * 0.29;
        float gust = 0.6 + 0.4 * sin(uTime * 0.31 + ipos.x * 0.05);
        transformed.x += (sin(uTime * 1.7 + ph) * 0.8 + sin(uTime * 3.1 + ph * 2.0) * 0.2) * uWind * gust * hgt * 0.22;
        transformed.z += cos(uTime * 1.3 + ph * 1.3) * uWind * gust * hgt * 0.14;`,
      );
  };
  material.customProgramCacheKey = () => 'wind-v2';
}
