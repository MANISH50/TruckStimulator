// Natural sky: gradient dome with sun (or moon) glow, stars at night and soft drifting clouds.
// Also provides the "ground detail" material: world-space noise on vertex colours so grass,
// soil and asphalt look natural without any texture files.
import * as THREE from 'three';
import { canvasTexture, rng } from '../util.js';

export const SKY = {
  day: { top: '#3d7fd6', horizon: '#cfe0ec', sun: '#fff4d8', sunDir: [-0.35, 0.62, 0.7], sunSize: 0.9994, glow: 0.55, stars: 0, clouds: 0.95, cloudTint: '#ffffff' },
  evening: { top: '#3a4f8a', horizon: '#f2a46c', sun: '#ffb070', sunDir: [-0.6, 0.12, 0.78], sunSize: 0.9988, glow: 1.2, stars: 0, clouds: 0.85, cloudTint: '#ffc9a0' },
  night: { top: '#0d1b3d', horizon: '#34486e', sun: '#e8eeff', sunDir: [0.3, 0.55, 0.78], sunSize: 0.9996, glow: 0.35, stars: 1, clouds: 0.35, cloudTint: '#6a7aa0' },
};

const vert = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // always behind everything
}`;
const frag = `
uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunCol; uniform vec3 sunDir;
uniform float sunSize; uniform float glow; uniform float stars;
varying vec3 vDir;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.55));
  col = mix(col, ground, smoothstep(0.0, -0.08, h));
  float sd = dot(d, normalize(sunDir));
  col += sunCol * glow * pow(max(sd, 0.0), 12.0) * 0.45;
  col += sunCol * glow * pow(max(sd, 0.0), 160.0) * 0.6;
  col = mix(col, sunCol * 1.6, smoothstep(sunSize, sunSize + 0.0004, sd));
  if (stars > 0.0 && h > 0.05) {
    vec3 c = floor(d * 380.0);
    float s = hash(c);
    col += vec3(step(0.9975, s) * stars * (0.5 + 0.5 * hash(c + 3.1)) * smoothstep(0.05, 0.3, h));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

let _cloudTex = null;
function cloudTexture() {
  if (_cloudTex) return _cloudTex;
  _cloudTex = canvasTexture(256, 128, (g, w, h) => {
    const R = rng(11);
    for (let i = 0; i < 26; i++) {
      const x = w * (0.15 + R() * 0.7), y = h * (0.45 + R() * 0.3), r = 18 + R() * 34;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
  });
  return _cloudTex;
}

export class Sky {
  constructor(scene, tod) {
    const P = SKY[tod] || SKY.day;
    this.P = P;
    this.uniforms = {
      top: { value: new THREE.Color(P.top) }, horizon: { value: new THREE.Color(P.horizon) }, ground: { value: new THREE.Color(P.horizon) },
      sunCol: { value: new THREE.Color(P.sun) }, sunDir: { value: new THREE.Vector3(...P.sunDir).normalize() },
      sunSize: { value: P.sunSize }, glow: { value: P.glow }, stars: { value: P.stars },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag, side: THREE.BackSide, depthWrite: false, fog: false });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);
    // clouds
    this.clouds = [];
    const R = rng(7);
    const ctex = cloudTexture();
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctex, color: P.cloudTint, transparent: true, opacity: P.clouds * (0.55 + R() * 0.45), depthWrite: false, fog: false }));
      const a = R() * Math.PI * 2, r = 420 + R() * 380;
      m.userData = { ox: Math.cos(a) * r, oz: Math.sin(a) * r, y: 140 + R() * 160, speed: 1 + R() * 2 };
      const sc = 180 + R() * 220;
      m.scale.set(sc, sc * 0.42, 1);
      scene.add(m);
      this.clouds.push(m);
    }
    this.scene = scene;
  }
  get horizon() { return this.uniforms.horizon.value; }
  get sunDir() { return this.uniforms.sunDir.value; }
  // tint the horizon toward the state's haze colour (dusty Rajasthan, green Kerala...)
  setHaze(col, amt) {
    const base = new THREE.Color(this.P.horizon);
    this.uniforms.horizon.value.copy(base.lerp(col, amt));
    this.uniforms.ground.value.copy(this.uniforms.horizon.value);
  }
  update(camPos, t) {
    this.dome.position.copy(camPos);
    for (const c of this.clouds) {
      const u = c.userData;
      const drift = (t * u.speed) % 1600 - 800;
      c.position.set(camPos.x + u.ox + drift * 0.3, u.y + camPos.y * 0.3, camPos.z + u.oz);
    }
  }
  dispose() {
    this.scene.remove(this.dome);
    for (const c of this.clouds) this.scene.remove(c);
  }
}

// Lambert + vertex colours + subtle world-space noise (grass/soil/asphalt texture without images)
export function makeDetailMaterial(strength = 0.16) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.userData.detail = { value: strength };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.detail = mat.userData.detail;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos; uniform float detail;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{ vec2 q = vWPos.xz;
  float n = vnoise(q * 0.09) * 0.5 + vnoise(q * 0.55) * 0.3 + vnoise(q * 3.1) * 0.2;
  diffuseColor.rgb *= 1.0 + (n - 0.5) * 2.0 * detail; }`);
  };
  return mat;
}
