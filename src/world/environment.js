import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { cloudSprite } from '../utils/textures.js';
import { clamp, lerpN } from '../utils/math.js';

export let sunLight = null;
export let bounceLight = null;
export let hemiLight = null;
export let ambLight = null;
export let skyMat = null;
export let sceneFog = null;
let skyMesh = null;
let cloudGroup = null;

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main(){
    vDir = position;
    vec4 mv = modelViewMatrix * vec4(position,1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const SKY_FRAG = /* glsl */`
  varying vec3 vDir;
  uniform vec3 topColor;
  uniform vec3 midColor;
  uniform vec3 horizonColor;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform float haze;
  uniform float time;
  uniform float nightAmt;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
  float hash3(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
  float vnoise(vec2 p){
    vec2 i=floor(p), f=fract(p);
    vec2 u=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y);
  }
  float fbm(vec2 p){
    float s=0., a=.5;
    for(int i=0;i<5;i++){ s+=a*vnoise(p); p*=2.03; a*=.5; }
    return s;
  }
  // stretched cirrus noise
  float cirrus(vec2 p){
    float s=0., a=.5;
    for(int i=0;i<4;i++){ s+=a*vnoise(vec2(p.x*0.55, p.y*2.6)); p*=2.13; a*=.5; }
    return s;
  }

  void main(){
    vec3 d = normalize(vDir);
    vec3 sunN = normalize(sunDir);
    float h = clamp(d.y, -0.08, 1.0);
    float sunAmount = max(dot(normalize(vec3(d.x,0.,d.z)), normalize(vec3(sunN.x,0.,sunN.z)))*0.5+0.5, 0.0);

    // vertical gradient: horizon → mid → zenith
    vec3 col = mix(horizonColor, midColor, smoothstep(0.0, 0.30, h));
    col = mix(col, topColor, smoothstep(0.24, 0.78, h));
    // warm the horizon on the sun side, cool it opposite
    vec3 warmHor = horizonColor + sunColor*0.28;
    vec3 coolHor = horizonColor*0.92 + topColor*0.10;
    col = mix(col, mix(coolHor, warmHor, pow(sunAmount,2.0)), (1.0-smoothstep(0.0,0.22,h))*0.75);
    // below horizon: dusky ground haze
    col = mix(vec3(0.23,0.20,0.22), col, smoothstep(-0.08, 0.005, d.y));

    float sunD = max(dot(d, sunN), 0.0);
    // broad forward-scatter + halo + disc
    col += sunColor * pow(sunD, 4.0) * 0.30 * (1.0+haze);
    col += sunColor * pow(sunD, 24.0) * 0.55;
    col += sunColor * pow(sunD, 90.0) * 1.1;
    col += vec3(1.0,0.93,0.87) * pow(sunD, 900.0) * 5.0;

    if(d.y > 0.008){
      vec2 cuv = d.xz / (d.y + 0.20);
      // low puffy bands drifting with time
      float cl = fbm(cuv*1.35 + vec2(time*0.005, time*0.0015));
      float band = smoothstep(0.015,0.10,d.y)*smoothstep(0.62,0.18,d.y);
      float m = smoothstep(0.52, 0.80, cl) * band;
      vec3 litEdge = mix(vec3(1.0,0.94,0.95), sunColor*1.15+vec3(0.25), pow(sunAmount,2.0)*0.8);
      vec3 cloudCol = mix(midColor*0.98, litEdge, 0.55 + 0.3*sunAmount);
      col = mix(col, cloudCol, m*0.5);
      float m2 = smoothstep(0.40,0.52,cl)*band*(1.0-m);
      col = mix(col, midColor*0.90, m2*0.28);
      // high cirrus streaks
      float ci = cirrus(cuv*0.8 + vec2(time*0.008, 0.0));
      float cband = smoothstep(0.12,0.3,d.y)*smoothstep(0.8,0.35,d.y);
      float cm = smoothstep(0.58,0.85,ci)*cband;
      col = mix(col, vec3(0.99,0.93,0.94), cm*0.35);
    }
    // distance haze lift near horizon
    col = mix(col, horizonColor, (1.0-smoothstep(0.0,0.16,abs(d.y))) * haze * 0.35);
    // starfield, faded in with night
    if (nightAmt > 0.01 && d.y > 0.03) {
      vec3 cell = floor(d * 220.0);
      float star = smoothstep(0.9965, 1.0, hash3(cell));
      float tw = 0.6 + 0.4 * sin(time * 2.0 + hash3(cell + 7.0) * 40.0);
      col += vec3(0.9, 0.93, 1.0) * star * tw * nightAmt * smoothstep(0.03, 0.35, d.y);
    }
    // dither against banding
    col += (hash(d.xy*913.7)-0.5)*0.008;

    gl_FragColor = vec4(col, 1.0);
  }
`;

// Keyframes: [tod, sunElev, sunAzim, top, mid, horizon, sun, fog, fogDensity, sunI, hemiI, night]
const KEYS = [
  { t: 0.00, elev: 6,  az: 250, top:'#2c3352', mid:'#8e7ba0', hor:'#e0a080', sun:'#ffb37a', fog:'#c99a8e', fogD: 0.00062, sunI: 1.7, hemiI: 0.5, night: 0.1 },
  { t: 0.15, elev: 12, az: 258, top:'#55679e', mid:'#bd8fb6', hor:'#f4b9c2', sun:'#ffd09e', fog:'#d8a9b4', fogD: 0.00058, sunI: 2.2, hemiI: 0.55, night: 0 },
  { t: 0.32, elev: 16, az: 268, top:'#7588bd', mid:'#c69dc2', hor:'#f3bcc8', sun:'#ffe2b2', fog:'#d9adb9', fogD: 0.00055, sunI: 2.3, hemiI: 0.75, night: 0 },
  { t: 0.55, elev: 62, az: 190, top:'#3f74d6', mid:'#8fb4e4', hor:'#cfe0ee', sun:'#fff4e0', fog:'#bccbd8', fogD: 0.00038, sunI: 2.8, hemiI: 0.85, night: 0 },
  { t: 0.80, elev: 14, az: 120, top:'#4a4a72', mid:'#a06a8e', hor:'#e8907a', sun:'#ff9a5a', fog:'#c98a80', fogD: 0.0006, sunI: 2.0, hemiI: 0.5, night: 0.15 },
  { t: 1.00, elev: -6, az: 110, top:'#04060c', mid:'#0a1024', hor:'#141b2c', sun:'#5a6a9a', fog:'#0a0e16', fogD: 0.0008, sunI: 0.0, hemiI: 0.18, night: 1 },
];

function hex(c){ return new THREE.Color(c); }

export function buildEnvironment(scene, renderer) {
  sceneFog = new THREE.FogExp2(new THREE.Color('#d9adb9'), 0.00055);
  scene.fog = sceneFog;
  scene.background = null;

  skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      topColor: { value: hex('#7588bd') },
      midColor: { value: hex('#c69dc2') },
      horizonColor: { value: hex('#f3bcc8') },
      sunDir: { value: new THREE.Vector3(0, 0.3, -1) },
      sunColor: { value: hex('#ffe2b2') },
      haze: { value: 0.5 },
      time: { value: 0 },
      nightAmt: { value: 0 },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(8500, 40, 24), skyMat);
  sky.name = 'sky';
  sky.frustumCulled = false;
  scene.add(sky);
  skyMesh = sky;

  // Warm low sun with tight, high-res shadows near the car.
  sunLight = new THREE.DirectionalLight(0xffe2b2, 2.6);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 500;
  const S = 110;
  sunLight.shadow.camera.left = -S; sunLight.shadow.camera.right = S;
  sunLight.shadow.camera.top = S; sunLight.shadow.camera.bottom = -S;
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.6;
  scene.add(sunLight);
  scene.add(sunLight.target);

  hemiLight = new THREE.HemisphereLight(new THREE.Color('#c9a2c4'), new THREE.Color('#3a4a2f'), 0.75);
  scene.add(hemiLight);
  // Warm meadow bounce from opposite the sun — kills the one-direction look.
  // No shadows: pure soft fill, follows the sun's azimuth for free.
  bounceLight = new THREE.DirectionalLight(new THREE.Color('#cfc39a'), 0.45);
  bounceLight.castShadow = false;
  scene.add(bounceLight);
  scene.add(bounceLight.target);
  ambLight = new THREE.AmbientLight(0xfff0e8, 0.12);
  scene.add(ambLight);

  // PBR reflections for car paint / glass — replaced by live scene bake below
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;
  scene.environment = envTex;

  // High, wide, barely-there cirrus billboards — tinted by the sun.
  cloudGroup = new THREE.Group();
  const spriteTex = cloudSprite();
  const rnd = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < 34; i++) {
    const m = new THREE.SpriteMaterial({
      map: spriteTex, transparent: true, depthWrite: false, fog: false,
      opacity: rnd(0.16, 0.38), color: new THREE.Color(i % 3 ? '#ffdfe8' : '#f4ecff')
    });
    const s = new THREE.Sprite(m);
    const ang = rnd(0, Math.PI * 2), r = rnd(2600, 5600);
    s.position.set(Math.cos(ang) * r, rnd(750, 1500), Math.sin(ang) * r);
    s.scale.set(rnd(900, 1700), rnd(110, 210), 1);
    cloudGroup.add(s);
  }
  scene.add(cloudGroup);

  applyTimeOfDay(0.55, scene);
  return { sunLight, hemiLight };
}


// Live image-based lighting baked from THIS valley: pink sky dome + hot
// sun disc + green ground bounce. Car paint/glass/chrome reflect the real
// scene, and re-baking on time-of-day change keeps them in sync.
let envScene = null, envRT = null, envGroundMat = null, envBandMat = null;
function ensureEnvScene(night = 0) {
  if (!envScene) {
    envScene = new THREE.Scene();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 20), skyMat);
    envScene.add(dome);
    envGroundMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#4d5c33') });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(880, 40), envGroundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -8;
    envScene.add(ground);
    // tree-line band on the horizon for green/multi-tone reflections
    envBandMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#3d4c2e'), side: THREE.BackSide });
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(860, 860, 60, 48, 1, true), envBandMat
    );
    band.position.y = 22;
    envScene.add(band);
  }
  // dim the baked bounce to a whisper at night
  const dim = 1 - night * 0.93;
  envGroundMat.color.set('#4d5c33').multiplyScalar(dim);
  envBandMat.color.set('#3d4c2e').multiplyScalar(dim);
  return envScene;
}
export function refreshEnvironment(scene, renderer, night = 0) {
  ensureEnvScene(night);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0.04, 1, 3000);
  if (envRT) envRT.dispose();
  envRT = rt;
  scene.environment = rt.texture;
  pmrem.dispose();
}

function sampleKeys(t) {
  let a = KEYS[0], b = KEYS[KEYS.length - 1];
  for (let i = 0; i < KEYS.length - 1; i++) {
    if (t >= KEYS[i].t && t <= KEYS[i + 1].t) { a = KEYS[i]; b = KEYS[i + 1]; break; }
  }
  const span = Math.max(1e-5, b.t - a.t);
  const f = clamp((t - a.t) / span, 0, 1);
  const mixC = (ca, cb) => hex(ca).lerp(hex(cb), f);
  return {
    f,
    elev: lerpN(a.elev, b.elev, f),
    az: lerpN(a.az, b.az, f),
    top: mixC(a.top, b.top), mid: mixC(a.mid, b.mid),
    hor: mixC(a.hor, b.hor), sun: mixC(a.sun, b.sun), fog: mixC(a.fog, b.fog),
    fogD: lerpN(a.fogD, b.fogD, f),
    sunI: lerpN(a.sunI, b.sunI, f), hemiI: lerpN(a.hemiI, b.hemiI, f),
    night: lerpN(a.night || 0, b.night || 0, f),
  };
}

let fogScale = 0.5;
export function setMist(v) { fogScale = v; }

export function applyTimeOfDay(t, scene) {
  const k = sampleKeys(t);
  const night = clamp(k.night || 0, 0, 1);
  const azR = THREE.MathUtils.degToRad(k.az);
  const elR = THREE.MathUtils.degToRad(k.elev);
  const sunDir = new THREE.Vector3(
    Math.cos(elR) * Math.sin(azR),
    Math.sin(elR),
    Math.cos(elR) * Math.cos(azR)
  );
  // moon takes over as the sun drops: same disc shader, cool light
  const moonDir = new THREE.Vector3(0.55, 0.62, -0.45).normalize();
  const moonCol = new THREE.Color('#9db8ff');
  const dir = sunDir.clone().lerp(moonDir, night).normalize();
  const lightCol = k.sun.clone().lerp(moonCol, night);
  skyMat.uniforms.topColor.value.copy(k.top);
  skyMat.uniforms.midColor.value.copy(k.mid);
  skyMat.uniforms.horizonColor.value.copy(k.hor);
  skyMat.uniforms.sunColor.value.copy(lightCol);
  skyMat.uniforms.sunDir.value.copy(dir);
  skyMat.uniforms.haze.value = fogScale;
  skyMat.uniforms.nightAmt.value = night;

  sunLight.color.copy(lightCol);
  sunLight.intensity = k.sunI * (1 - night) + 0.55 * night;
  sunLight.position.copy(dir).multiplyScalar(300);

  hemiLight.color.copy(k.mid).lerp(new THREE.Color('#ffffff'), 0.25);
  hemiLight.groundColor.set('#3a4a2f');
  hemiLight.intensity = k.hemiI;

  bounceLight.intensity = 0.45 * (1 - night) + 0.05;
  ambLight.intensity = 0.12 * (1 - night) + 0.03;

  sceneFog.color.copy(k.fog);
  sceneFog.density = k.fogD * (0.55 + fogScale * 0.9);
}

// Keep sun shadow frustum glued to the car (+ bounce opposed to the sun).
export function updateSunFollow(carPos) {
  if (!sunLight) return;
  const dir = skyMat.uniforms.sunDir.value;
  sunLight.position.copy(carPos).addScaledVector(dir, 280);
  sunLight.target.position.copy(carPos);
  sunLight.target.updateMatrixWorld();
  if (bounceLight) {
    bounceLight.position.set(carPos.x - dir.x * 280, carPos.y + 150, carPos.z - dir.z * 280);
    bounceLight.target.position.copy(carPos);
    bounceLight.target.updateMatrixWorld();
  }
}

export function tickSky(dt, elapsed) {
  if (skyMat) skyMat.uniforms.time.value = elapsed;
  if (cloudGroup) {
    cloudGroup.children.forEach((s, i) => {
      s.position.x += dt * (1.2 + (i % 5) * 0.3);
      if (s.position.x > 6000) s.position.x = -6000;
    });
  }
}
