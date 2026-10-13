// Procedural part geometry and instanced part pools. Every organism is assembled from these parts,
// so body plans, limb counts and proportions all come from genome-driven parameters.
import * as THREE from 'three';

/** Lens-shaped leaf/fin, base at origin, pointing +Y, length 1, half-width w. */
export function leafGeometry(w = 0.22, bend = 0.12, segs = 10) {
  const pos = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const width = w * Math.pow(Math.sin(Math.PI * Math.min(0.999, u * 0.92 + 0.04)), 0.8);
    const y = u;
    const z = bend * u * u;
    pos.push(-width, y, z, width, y, z);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // double-sided by winding the reverse faces too
  const rev = idx.slice().reverse();
  const idx2 = idx.concat(rev);
  g.setIndex(idx2);
  g.computeVertexNormals();
  return g;
}

export function baseCyl(rTop, rBot, segs = 6) {
  const g = new THREE.CylinderGeometry(rTop, rBot, 1, segs, 1);
  g.translate(0, 0.5, 0);
  return g;
}
export function domeGeometry(segs = 14) {
  return new THREE.SphereGeometry(1, segs, Math.max(6, segs / 2 | 0), 0, Math.PI * 2, 0, Math.PI / 2);
}
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
  GEOMS.stem = baseCyl(0.5, 0.7, 5);
  GEOMS.leaf = leafGeometry(0.2, 0.12);
  GEOMS.frond = leafGeometry(0.11, 0.2, 12);
  GEOMS.broadLeaf = leafGeometry(0.34, 0.08, 10);
  GEOMS.bulb = new THREE.SphereGeometry(1, 12, 9);
  GEOMS.cap = domeGeometry(14);
  GEOMS.pad = new THREE.CylinderGeometry(1, 1, 0.06, 14);
  GEOMS.tuft = new THREE.IcosahedronGeometry(1, 1);
  GEOMS.pod = new THREE.SphereGeometry(1, 7, 6);
  // animals
  GEOMS.body = new THREE.SphereGeometry(1, 16, 12);
  GEOMS.head = new THREE.SphereGeometry(1, 12, 9);
  GEOMS.leg = new THREE.CylinderGeometry(0.55, 0.28, 1, 5, 1);
  GEOMS.leg.translate(0, -0.5, 0); // hangs down from its origin
  GEOMS.shell = domeGeometry(16);
  GEOMS.antenna = new THREE.CylinderGeometry(0.5, 0.12, 1, 4, 1);
  GEOMS.antenna.translate(0, 0.5, 0);
  GEOMS.tail = new THREE.CylinderGeometry(0.12, 0.55, 1, 6, 1);
  GEOMS.tail.translate(0, 0.5, 0);
  GEOMS.horn = new THREE.ConeGeometry(0.5, 1, 6, 1);
  GEOMS.horn.translate(0, 0.5, 0);
  GEOMS.fin = leafGeometry(0.5, 0.05, 8);
  GEOMS.eye = new THREE.SphereGeometry(1, 8, 6);
  GEOMS.glow = new THREE.SphereGeometry(1, 8, 6);
  GEOMS.rock = [rockGeometry(1), rockGeometry(2), rockGeometry(3)];
  GEOMS.pebble = new THREE.IcosahedronGeometry(1, 0);
  GEOMS.branch = new THREE.CylinderGeometry(0.5, 0.7, 1, 6, 1);
  GEOMS.branch.rotateZ(Math.PI / 2);
  GEOMS.crystal = new THREE.OctahedronGeometry(1, 0);
  GEOMS.arch = new THREE.TorusGeometry(1, 0.42, 8, 18, Math.PI);
  return GEOMS;
}

/** A pool of instances for one geometry/material pair. Matrices & colours are written per frame. */
export class PartPool {
  constructor(geometry, material, capacity, { castShadow = true } = {}) {
    this.cap = capacity;
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.n = 0;
    this.m = this.mesh.instanceMatrix.array;
    this.c = this.mesh.instanceColor.array;
  }
  begin() {
    this.n = 0;
  }
  /** Writes matrix (THREE.Matrix4) and colour. Returns the instance index or -1 when full. */
  add(mat, r, g, b) {
    if (this.n >= this.cap) return -1;
    const i = this.n++;
    this.m.set(mat.elements, i * 16);
    this.c[i * 3] = r;
    this.c[i * 3 + 1] = g;
    this.c[i * 3 + 2] = b;
    return i;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

export function makeMaterials() {
  return {
    plant: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0, side: THREE.DoubleSide }),
    animal: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.0 }),
    shell: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.36, metalness: 0.05 }),
    eye: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.0 }),
    glow: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
    rock: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 }),
    mineral: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.1 }),
    wood: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 }),
    cave: new THREE.MeshStandardMaterial({ color: 0x2e302c, roughness: 1, metalness: 0 }),
  };
}

/** Adds a sway-in-wind vertex displacement to plant materials (in part-local space, phase from instance). */
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
  material.customProgramCacheKey = () => 'wind';
}
