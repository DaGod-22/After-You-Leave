// Sky dome with gradient, soft clouds, sun/moon glow and stars. Colours come from the day cycle.
import * as THREE from 'three';

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uTop: { value: new THREE.Color(0x2c5d66) }, uHor: { value: new THREE.Color(0xc9b996) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 0.9, 0.75) },
      uTime: { value: 0 }, uCloud: { value: 0.4 }, uNight: { value: 0 }, uRain: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 uTop, uHor, uSunDir, uSunCol; uniform float uTime, uCloud, uNight, uRain;
        varying vec3 vDir;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=0.5; } return s; }
        void main(){
          vec3 d = normalize(vDir);
          float up = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(uHor, uTop, pow(up, 0.55));
          col = mix(col, uHor * 0.92, smoothstep(0.0, -0.2, d.y) * 0.6);
          // clouds on a projected plane above the horizon
          if (d.y > 0.02) {
            vec2 cp = d.xz / (d.y + 0.15) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
            float c = fbm(cp * 0.8);
            float cover = smoothstep(1.0 - uCloud * 0.85, 1.0 - uCloud * 0.85 + 0.25, c);
            vec3 cc = mix(vec3(0.85,0.85,0.8), uHor * 1.05, 0.3);
            cc *= 0.75 + 0.25 * uSunCol.r;
            col = mix(col, cc, cover * 0.85 * smoothstep(0.02, 0.2, d.y));
          }
          float sd = max(dot(d, normalize(uSunDir)), 0.0);
          col += uSunCol * (pow(sd, 260.0) * 2.2 + pow(sd, 8.0) * 0.18) * (1.0 - uNight);
          // stars
          if (uNight > 0.01 && d.y > 0.0) {
            vec3 q = floor(d * 240.0);
            float s = h(q.xz + q.y * 3.1);
            float st = step(0.9965, s) * (0.5 + 0.5 * sin(uTime * 2.0 + s * 40.0));
            col += vec3(0.8, 0.9, 0.95) * st * uNight * smoothstep(0.0, 0.25, d.y);
          }
          col = mix(col, col * 0.7 + vec3(0.04, 0.05, 0.06) * (1.0 - uNight), uRain * 0.35);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(700, 32, 16), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);
  }
  update(sim, camPos) {
    this.mesh.position.copy(camPos);
    const u = this.uniforms;
    u.uTime.value = sim.time;
    u.uSunDir.value.copy(sim.sunDir);
    u.uSunCol.value.copy(sim.sunCol);
    u.uTop.value.copy(sim.top);
    u.uHor.value.copy(sim.horizon);
    u.uCloud.value = sim.cloud;
    u.uNight.value = sim.night;
    u.uRain.value = sim.rain;
  }
}
