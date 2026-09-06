import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeBillboardMaterial } from './impostors.js';
import { mulberry32, fbm2 } from '../utils/math.js';
import { getHeight, distToRoad } from './terrain.js';
import { roadSamples } from './road.js';
import { barkTexture, foliageTexture, grassBladeTexture, alderImpostorTexture } from '../utils/textures.js';

export const treeColliders = [];
let grassUniforms = { uTime: { value: 0 } };

function scatter(count, seed, fn) {
  const rnd = mulberry32(seed);
  const out = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 60) {
    const r = Math.pow(rnd(), 0.6) * 1650;
    const a = rnd() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const dRoad = distToRoad(x, z);
    const res = fn(x, z, dRoad, rnd);
    if (res) out.push(res);
  }
  return out;
}

// Weld duplicated (non-indexed) vertices, sculpt, re-UV, bake AO, smooth-shade.
// This is what turns faceted low-poly blobs into organic crowns.
function smoothPoly(geo, amt, freq, seed, uvScale = [3, 2]) {
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  const g = mergeVertices(geo, 1e-4);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = fbm2(v.x * freq + seed, (v.y + v.z) * freq, 3);
    const s = 1 + n * amt;
    p.setXYZ(i, v.x * s, v.y * s, v.z * s);
  }
  // fresh spherical UVs so the foliage texture wraps the crown
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    uv[i * 2] = (Math.atan2(v.z, v.x) / (Math.PI * 2) + 0.5) * uvScale[0];
    uv[i * 2 + 1] = ((v.y - bb.min.y) / Math.max(1e-4, bb.max.y - bb.min.y)) * uvScale[1];
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  bakeFoliageAO(g, seed, 0.5);
  g.computeVertexNormals();
  return g;
}

function displaceIndexed(geo, amt, freq, seed) {
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = fbm2(v.x * freq + seed, (v.y + v.z) * freq, 3);
    const s = 1 + n * amt;
    p.setXYZ(i, v.x * s, v.y * s, v.z * s);
  }
  geo.computeVertexNormals();
  return geo;
}

// Bake vertical AO + mottling into vertex colors (multiplies instance color).
function bakeFoliageAO(geo, seed, dark = 0.55, seedLight = 1.08) {
  const p = geo.attributes.position;
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const colors = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const t = (v.y - bb.min.y) / Math.max(1e-4, bb.max.y - bb.min.y);
    const mottle = fbm2(v.x * 1.7 + seed, (v.y - v.z) * 1.7, 2) * 0.5 + 0.5;
    const shade = (dark + (1 - dark) * t) * (0.82 + mottle * 0.36) * seedLight;
    colors[i * 3] = shade * 0.98;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade * 0.88;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function flareTrunk(geo, strength = 1.8, height = 0.4) {  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < height) {
      const f = 1 + (height - y) * strength;
      p.setX(i, p.getX(i) * f);
      p.setZ(i, p.getZ(i) * f);
    }
  }
  return geo;
}

// Wind sway shared by grass + flower stems (phase from instance position).
function addSway(mat, amp) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = grassUniforms.uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       #ifdef USE_INSTANCING
         vec4 ip = instanceMatrix * vec4(0.,0.,0.,1.);
         float swayW = sin(uTime*2.2 + ip.x*0.35 + ip.z*0.27) * ${amp.toFixed(3)} * max(position.y, 0.0);
         transformed.x += swayW; transformed.z += swayW*0.6;
       #endif`
    );
  };
}

// High-poly grass tuft: folded, bowed, tapered blades with real segments.
// Cross-section L-C-R with a raised center ridge catches light like real blades.
export function buildBladeTuft(bladeCount, seed) {
  const rnd = mulberry32(seed);
  const P = [], UV = [], CL = [], IDX = [];
  let base = 0;
  const rows = [0, 0.5, 1.0];
  const tip = [1.0, 1.0, 0.96], bas = [0.40, 0.40, 0.38];
  for (let b = 0; b < bladeCount; b++) {
    const yaw = (b / bladeCount) * Math.PI * 2 + rnd() * 0.9;
    const h = 0.30 + rnd() * 0.28;
    const w = 0.020 + rnd() * 0.022;
    const lean = 0.10 + rnd() * 0.30;
    const bow = (rnd() - 0.2) * 0.35;
    const fold = w * (0.9 + rnd() * 0.6);
    const ring = 0.015 + rnd() * 0.05;
    const ox = Math.cos(yaw) * ring, oz = Math.sin(yaw) * ring;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const bright = 0.85 + rnd() * 0.3;
    for (let r = 0; r < rows.length; r++) {
      const t = rows[r];
      const y = h * t;
      const half = w * 0.5 * (1 - t * 0.88);
      const out = lean * h * t * t;
      const fw = bow * h * t * t;
      // local: across = X, fold = +Z — then yaw-rotate + translate
      const local = [[-half, y, fw], [0, y, fold + fw], [half, y, fw]];
      for (let k = 0; k < 3; k++) {
        const [lx, ly, lz] = local[k];
        // lean outward radially
        const gx = lx + Math.cos(yaw) * out, gz = lz + Math.sin(yaw) * out;
        P.push(ox + gx * cy + gz * sy, ly, oz - gx * sy + gz * cy);
        UV.push(k * 0.5, t);
        const s = (bas[0] + (tip[0] - bas[0]) * t) * bright;
        const s1 = (bas[1] + (tip[1] - bas[1]) * t) * bright;
        const s2 = (bas[2] + (tip[2] - bas[2]) * t) * bright;
        CL.push(Math.min(s, 1.2), Math.min(s1, 1.2), Math.min(s2, 1.2));
      }
    }
    for (let r = 0; r < rows.length - 1; r++) {
      const l0 = base + r * 3, c0 = l0 + 1, r0 = l0 + 2;
      const l1 = l0 + 3, c1 = l0 + 4, r1 = l0 + 5;
      IDX.push(l0, l1, c0, c0, l1, c1, c0, c1, r0, r0, c1, r1);
    }
    base += rows.length * 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(CL, 3));
  g.setIndex(IDX);
  g.computeVertexNormals();
  return g;
}

// Real flower head: 6 pointed cupped petals + trumpet + ovary, vertex-colored
// near-white so per-instance tints (gold / white / pink) do the variety.
export function buildFlowerHead() {
  const parts = [];
  const paint = (geo, hex, shadeFn) => {
    const c = new THREE.Color(hex);
    const p = geo.attributes.position, uvA = geo.attributes.uv;
    const cols = new Float32Array(p.count * 3);
    const vv = new THREE.Vector2();
    for (let i = 0; i < p.count; i++) {
      vv.fromBufferAttribute(uvA, i);
      const s = shadeFn(vv);
      cols[i * 3] = c.r * s; cols[i * 3 + 1] = c.g * s; cols[i * 3 + 2] = c.b * s;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return geo;
  };
  for (let k = 0; k < 6; k++) {
    const pg = new THREE.PlaneGeometry(0.085, 0.13, 1, 2);
    pg.translate(0, 0.065, 0);
    const pp = pg.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const t = pp.getY(i) / 0.13;
      pp.setX(i, pp.getX(i) * (1 - t * 0.72));
      pp.setZ(i, Math.pow(Math.max(t, 0), 2) * 0.035);
    }
    pg.rotateX(0.55);
    pg.rotateY((k / 6) * Math.PI * 2);
    pg.computeVertexNormals();
    parts.push(paint(pg, '#f6f1e2', (uv) => 0.68 + 0.32 * uv.y));
  }
  const cup = new THREE.CylinderGeometry(0.034, 0.02, 0.06, 10, 1, true);
  cup.translate(0, 0.035, 0);
  parts.push(paint(cup, '#e8961a', (uv) => 0.8 + 0.2 * uv.y));
  const ovary = new THREE.SphereGeometry(0.02, 6, 4);
  ovary.translate(0, -0.005, 0);
  parts.push(paint(ovary, '#5a7030', () => 1));
  return mergeGeometries(parts);
}

// Shared alder materials — the SAME objects shade the 3D forest and bake
// the impostor atlas, so billboards match the trees exactly.
export function makeAlderMaterials() {
  const leafTex = foliageTexture();
  const woodMat = new THREE.MeshStandardMaterial({
    map: barkTexture(), roughness: 0.95, metalness: 0, envMapIntensity: 0.3,
  });
  const leafMat = new THREE.MeshStandardMaterial({
    map: leafTex, color: new THREE.Color('#ffffff'),
    roughness: 0.9, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.5,
    emissive: new THREE.Color('#141c06'), emissiveIntensity: 0.5,
  });
  addSway(leafMat, 0.008);
  return { woodMat, leafMat, leafTex };
}

export async function buildVegetation(scene, quality = 'high', assets = null) {
  // NOTE: heroes plant first (main boot order) and own their ground;
  // colliders accumulate across both — do not reset here.
  const isHigh = quality !== 'low';
  const leafTex = assets && assets.mats ? assets.mats.leafTex : foliageTexture();
  const lodVariants = (assets && assets.lodVariants) || [await loadTreeGLB('trees/alder_lod1.glb')];
  const alderMats = (assets && assets.mats) || (() => {
    const woodMat = new THREE.MeshStandardMaterial({
      map: barkTexture(), roughness: 0.95, metalness: 0, envMapIntensity: 0.3,
    });
    const leafMat = new THREE.MeshStandardMaterial({
      map: leafTex, color: new THREE.Color('#ffffff'),
      roughness: 0.9, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.5,
      emissive: new THREE.Color('#141c06'), emissiveIntensity: 0.5,
    });
    addSway(leafMat, 0.008);
    return { woodMat, leafMat, leafTex };
  })();

  // ---------- BLACK ALDER FOREST — all 4 baked variants, round-robin ----------
  const broadSpots = scatter(isHigh ? 220 : 140, 101, (x, z, dRoad, rnd) => {
    if (dRoad < 11) return null;
    for (let hi = 0; hi < heroSpots.length; hi++) {
      const dx = x - heroSpots[hi].x, dz = z - heroSpots[hi].z;
      if (dx * dx + dz * dz < 26 * 26) return null; // heroes own this ground
    }
    if (dRoad > 420 && rnd() < 0.7) return null;
    const forest = fbm2(x * 0.0011 + 5, z * 0.0011, 3);
    if (forest < -0.25 && dRoad > 60) return null;
    const y = getHeight(x, z);
    if (y > 170) return null;
    return { x, y, z, s: 0.62 + rnd() * 0.5, rot: rnd() * Math.PI * 2, tint: rnd(), v: (rnd() * 4) | 0 };
  });

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3(), P = new THREE.Vector3();
  const C = new THREE.Color();
  const perVariant = lodVariants.map(() => []);
  broadSpots.forEach((t) => perVariant[t.v % lodVariants.length].push(t));
  perVariant.forEach((list, vi) => {
    const V = lodVariants[vi];
    const wood = new THREE.InstancedMesh(V.woodGeo, alderMats.woodMat, Math.max(1, list.length));
    const leaf = new THREE.InstancedMesh(V.leafGeo, alderMats.leafMat, Math.max(1, list.length));
    wood.castShadow = true; wood.receiveShadow = true;
    leaf.castShadow = false;
    list.forEach((t, i) => {
      E.set(0, t.rot, 0); Q.setFromEuler(E);
      S.set(t.s, t.s * (0.9 + t.tint * 0.2), t.s);
      P.set(t.x, t.y - 0.15, t.z);
      M.compose(P, Q, S);
      wood.setMatrixAt(i, M);
      leaf.setMatrixAt(i, M);
      C.setHSL(0.22 + t.tint * 0.05, 0.4, 0.42 + t.tint * 0.12);
      leaf.setColorAt(i, C);
      treeColliders.push({ x: t.x, z: t.z, r: 0.7 * t.s });
    });
    wood.instanceMatrix.needsUpdate = true;
    leaf.instanceMatrix.needsUpdate = true;
    if (leaf.instanceColor) leaf.instanceColor.needsUpdate = true;
    scene.add(wood, leaf);
  });

  // ---------- FAR FOREST MASS (same alder species, twig-cluster canopy) ----------
  const bushGLB = await loadTreeGLB('trees/alder_bush.glb');
  await buildForestCarpet(scene, isHigh, bushGLB);

  // ---------- GROVE IMPOSTORS (thousands of camera-facing alders, 1 draw) ----------
  buildImpostorForest(scene, isHigh, broadSpots, assets && assets.impostorTex);

  // ---------- BUSHES (decimated alder twig clusters — same species) ----------
  const bushSpots = scatter(isHigh ? 800 : 400, 303, (x, z, dRoad, rnd) => {
    if (dRoad < 8 || dRoad > 120) return null;
    return { x, y: getHeight(x, z), z, s: 1.6 + rnd() * 1.1, rot: rnd() * 6.28, tint: rnd() };
  });
  const bushWoodMat = new THREE.MeshStandardMaterial({
    map: barkTexture(), roughness: 0.95, metalness: 0, envMapIntensity: 0.3,
  });
  const bushLeafMat = new THREE.MeshStandardMaterial({
    map: leafTex, color: new THREE.Color('#ffffff'),
    roughness: 0.9, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.4,
    emissive: new THREE.Color('#141c06'), emissiveIntensity: 0.5,
  });
  addSway(bushLeafMat, 0.04);
  const bushWood = new THREE.InstancedMesh(bushGLB.woodGeo, bushWoodMat, Math.max(1, bushSpots.length));
  const bushLeaf = new THREE.InstancedMesh(bushGLB.leafGeo, bushLeafMat, Math.max(1, bushSpots.length));
  bushWood.receiveShadow = true;
  bushLeaf.receiveShadow = true; bushLeaf.castShadow = false;
  bushSpots.forEach((t, i) => {
    E.set(0, t.rot, 0); Q.setFromEuler(E);
    S.set(t.s * (0.9 + t.tint * 0.3), t.s * 0.72, t.s * (0.9 + (1 - t.tint) * 0.3));
    P.set(t.x, t.y + 0.05, t.z);
    M.compose(P, Q, S);
    bushWood.setMatrixAt(i, M);
    bushLeaf.setMatrixAt(i, M);
    C.setHSL(0.22 + t.tint * 0.05, 0.38, 0.4 + t.tint * 0.12);
    bushLeaf.setColorAt(i, C);
  });
  bushWood.instanceMatrix.needsUpdate = true;
  bushLeaf.instanceMatrix.needsUpdate = true;
  if (bushLeaf.instanceColor) bushLeaf.instanceColor.needsUpdate = true;
  scene.add(bushWood, bushLeaf);

  // ---------- PHOTO GROUNDCOVER (billboard bushes + grass clumps) ----------
  if (assets && assets.bushTex) {
    buildGroundLayer(scene, {
      tex: assets.bushTex, target: isHigh ? 8000 : 3000, seed: 1201,
      minRoad: 6, maxRoad: 80, wMin: 1.2, wMax: 2.6, hMin: 0.9, hMax: 1.8,
      sway: 0.06, sink: 0.05,
      tint: (C, t) => C.setHSL(0.22 + t * 0.04, 0.25, 0.78 + t * 0.18),
    });
  }
  if (assets && assets.grassTex) {
    buildGroundLayer(scene, {
      tex: assets.grassTex, target: isHigh ? 100000 : 40000, seed: 1202,
      minRoad: 3.9, maxRoad: 55, wMin: 0.5, wMax: 1.1, hMin: 0.45, hMax: 1.0,
      sway: 0.05, sink: 0.03,
      tint: (C, t) => C.setHSL(0.23 + t * 0.04, 0.2, 0.82 + t * 0.16),
    });
  }

  // ---------- FLOWERS (petals + trumpet + stem leaves, gently swaying) ----------
  const flowerSpots = scatter(isHigh ? 2400 : 1200, 404, (x, z, dRoad, rnd) => {
    if (dRoad < 4.6 || dRoad > 26) return null;
    return { x, y: getHeight(x, z), z, kind: rnd(), lean: (rnd() - 0.5) * 0.35, h: 0.32 + rnd() * 0.3 };
  });
  const stemGeo = new THREE.CylinderGeometry(0.012, 0.02, 1, 5);
  stemGeo.translate(0, 0.5, 0);
  const stemMat = new THREE.MeshLambertMaterial({ color: new THREE.Color('#3d5a24'), envMapIntensity: 0.3 });
  addSway(stemMat, 0.03);
  const stems = new THREE.InstancedMesh(stemGeo, stemMat, flowerSpots.length);
  // two small leaves per stem, sharing the swaying stem material
  const leafGeoF = new THREE.PlaneGeometry(0.055, 0.14, 1, 2);
  leafGeoF.translate(0, 0.07, 0);
  {
    const lp = leafGeoF.attributes.position;
    for (let i = 0; i < lp.count; i++) {
      const t = lp.getY(i) / 0.14;
      lp.setZ(i, t * t * 0.05);
      lp.setX(i, lp.getX(i) * (1 - t * 0.5));
    }
    leafGeoF.computeVertexNormals();
  }
  const stemLeaves = new THREE.InstancedMesh(leafGeoF, stemMat, flowerSpots.length * 2);
  const headGeo = buildFlowerHead();
  const headMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.55, side: THREE.DoubleSide, envMapIntensity: 0.4,
  });
  const heads = new THREE.InstancedMesh(headGeo, headMat, flowerSpots.length);
  flowerSpots.forEach((t, i) => {
    E.set(t.lean, t.kind * 6.28, 0); Q.setFromEuler(E);
    S.set(1, t.h / 0.45, 1); P.set(t.x, t.y, t.z);
    M.compose(P, Q, S); stems.setMatrixAt(i, M);
    for (let l = 0; l < 2; l++) {
      E.set(1.05, t.kind * 6.28 + l * 2.4 + t.lean, 0); Q.setFromEuler(E);
      const ls = 0.8 + ((t.kind * 5 + l * 0.37) % 1) * 0.6;
      S.set(ls, ls, ls);
      P.set(t.x, t.y + t.h * (0.35 + l * 0.2), t.z);
      M.compose(P, Q, S); stemLeaves.setMatrixAt(i * 2 + l, M);
    }
    E.set(0, t.kind * 6.28, 0); Q.setFromEuler(E);
    const s = 0.7 + ((t.kind * 7) % 1) * 0.5;
    S.set(s, s, s); P.set(t.x + t.lean * 0.2, t.y + t.h - 0.01, t.z);
    M.compose(P, Q, S);
    heads.setMatrixAt(i, M);
    if (t.kind > 0.8) C.set('#f5c518');       // daffodil gold
    else if (t.kind > 0.62) C.set('#ffffff'); // meadow white
    else if (t.kind > 0.5) C.set('#f0c4da');  // clover pink
    else C.set('#e6e2c8');
    heads.setColorAt(i, C);
  });
  stems.instanceMatrix.needsUpdate = true;
  stemLeaves.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
  scene.add(stems, stemLeaves, heads);

  // ---------- GRASS TUFTS (folded high-poly blades + surface texture) ----------
  const grassCount = isHigh ? 22000 : 10000;
  const grassSpots = scatter(grassCount, 505, (x, z, dRoad, rnd) => {
    if (dRoad < 4.0 || dRoad > 42) return null;
    return { x, y: getHeight(x, z), z, s: 0.55 + rnd() * 1.0, rot: rnd() * 6.28, tint: rnd() };
  });
  const tuft = buildBladeTuft(isHigh ? 7 : 5, 606);
  const bladeTex = grassBladeTexture();
  const grassMat = new THREE.MeshStandardMaterial({
    map: bladeTex, vertexColors: true, side: THREE.DoubleSide,
    roughness: 0.85, metalness: 0, envMapIntensity: 0.35,
    emissive: new THREE.Color('#141c06'), emissiveIntensity: 0.6,
  });
  addSway(grassMat, 0.10);
  const grass = new THREE.InstancedMesh(tuft, grassMat, Math.max(1, grassSpots.length));
  grass.receiveShadow = true;
  grassSpots.forEach((t, i) => {
    E.set(0, t.rot, 0); Q.setFromEuler(E);
    S.set(t.s * 0.9, t.s * 0.55 * (0.7 + t.tint * 0.4), t.s * 0.9);
    P.set(t.x, t.y - 0.02, t.z);
    M.compose(P, Q, S); grass.setMatrixAt(i, M);
    C.setHSL(0.24 + t.tint * 0.05, 0.16, 0.88 + t.tint * 0.12);
    grass.setColorAt(i, C);
  });
  grass.instanceMatrix.needsUpdate = true;
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
  scene.add(grass);

  return { broadSpots };
}

function buildForestCarpet(scene, isHigh, bushGLB) {
  // Distant ridges clothed in the same alder species: giant twig-clusters.
  // Fog does the rest — no shadows, no colliders, two draw calls.
  const rnd = mulberry32(808);
  const count = isHigh ? 3000 : 1000;
  const woodMat = new THREE.MeshLambertMaterial({ map: barkTexture() });
  const leafMat = new THREE.MeshLambertMaterial({
    map: foliageTexture(), color: new THREE.Color('#7a9a52'),
  });
  const wood = new THREE.InstancedMesh(bushGLB.woodGeo, woodMat, count);
  const leaf = new THREE.InstancedMesh(bushGLB.leafGeo, leafMat, count);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const S = new THREE.Vector3(), P = new THREE.Vector3(), C = new THREE.Color();
  let placed = 0, guard = 0;
  while (placed < count && guard++ < count * 30) {
    const a = rnd() * Math.PI * 2;
    const r = 1750 + rnd() * 900;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = getHeight(x, z);
    if (y < 40) continue; // only on the raised rim
    E.set(0, rnd() * 6.28, 0); Q.setFromEuler(E);
    const s = 9 + rnd() * 9; // 6–12 m canopy masses
    S.set(s * (0.9 + rnd() * 0.3), s * 0.75, s * (0.9 + rnd() * 0.3));
    P.set(x, y - 1.5, z);
    M.compose(P, Q, S);
    wood.setMatrixAt(placed, M);
    leaf.setMatrixAt(placed, M);
    C.set(rnd() < 0.5 ? '#4d6338' : '#576e3e').offsetHSL(0, 0, (rnd() - 0.5) * 0.05);
    leaf.setColorAt(placed, C);
    placed++;
  }
  wood.count = placed;
  leaf.count = placed;
  wood.instanceMatrix.needsUpdate = true;
  leaf.instanceMatrix.needsUpdate = true;
  if (leaf.instanceColor) leaf.instanceColor.needsUpdate = true;
  scene.add(wood, leaf);
}

// Variant pool: photographed trees (cells 4-5) weighted ~48% for presence,
// baked USD renders (cells 0-3) fill the rest.
function pickVariant(rnd) {
  const r = rnd();
  if (r < 0.24) return 4;
  if (r < 0.48) return 5;
  return (rnd() * 4) | 0;
}

// Thousands of camera-facing alder billboards in randomized groves.
// One InstancedMesh, one draw call, ~2 tris each — real sun + fog response.
function buildImpostorForest(scene, isHigh, forestSpots, atlasTex) {
  const target = isHigh ? 27000 : 12000;
  const rnd = mulberry32(909);
  const spots = [];
  const clusters = 60;
  let guard = 0, ci = 0;
  // pre-roll cluster centers so groves vary in position/size/density
  const centers = [];
  for (let c = 0; c < clusters; c++) {
    const ca = rnd() * Math.PI * 2;
    const cr = 150 + Math.pow(rnd(), 0.7) * 1300;
    centers.push({
      x: Math.cos(ca) * cr, z: Math.sin(ca) * cr,
      sigma: 60 + rnd() * 130, density: 200 + ((rnd() * 700) | 0),
    });
  }
  while (spots.length < target && guard++ < target * 4) {
    const cc = centers[ci++ % clusters];
    if (rnd() * 900 > cc.density) continue; // sparse groves stay sparse
    const gx = ((rnd() + rnd() + rnd()) - 1.5) / 1.5 * cc.sigma * 1.6;
    const gz = ((rnd() + rnd() + rnd()) - 1.5) / 1.5 * cc.sigma * 1.6;
    const x = cc.x + gx, z = cc.z + gz;
    if (Math.hypot(x, z) > 1650) continue;
    const dRoad = distToRoad(x, z);
    if (dRoad < 14) continue;
    const y = getHeight(x, z);
    if (y > 170) continue;
    if (fbm2(x * 0.0011 + 5, z * 0.0011, 3) < -0.3 && dRoad > 80) continue;
    let bad = false;
    for (let k = 0; k < heroSpots.length; k++) {
      const dx = x - heroSpots[k].x, dz = z - heroSpots[k].z;
      if (dx * dx + dz * dz < 400) { bad = true; break; }
    }
    if (!bad) for (let k = 0; k < forestSpots.length; k++) {
      const dx = x - forestSpots[k].x, dz = z - forestSpots[k].z;
      if (dx * dx + dz * dz < 144) { bad = true; break; }
    }
    if (bad) continue;
    spots.push({ x, y, z, s: 0.7 + rnd() * 0.6, variant: pickVariant(rnd), tint: rnd(), phase: rnd() * 6.28 });
  }

  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0, 0.5, 0);
  const n = Math.max(1, spots.length);
  const variant = new Float32Array(n);
  const phase = new Float32Array(n);
  const mat = new THREE.MeshLambertMaterial({
    map: atlasTex || alderImpostorTexture(), alphaTest: 0.45,
    side: THREE.DoubleSide, envMapIntensity: 0,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = grassUniforms.uTime;
    sh.vertexShader = ('uniform float uTime;\nattribute float aVariant;\nattribute float aPhase;\n') +
      sh.vertexShader
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          vMapUv = vec2(uv.x / 3.0 + mod(aVariant, 3.0) / 3.0, uv.y * 0.5 + (1.0 - floor(aVariant / 3.0)) * 0.5);`)
        .replace('#include <defaultnormal_vertex>', `
          vec4 impC = instanceMatrix * vec4(0., 0., 0., 1.);
          vec3 impLook = cameraPosition - impC.xyz; impLook.y = 0.0;
          impLook = normalize(impLook + vec3(0.0001, 0., 0.));
          vec3 impFace = normalize(cross(vec3(0., 1., 0.), impLook));
          vec3 transformedNormal = normalize((viewMatrix * vec4(impLook, 0.0)).xyz);`)
        .replace('#include <project_vertex>', `
          float impSX = length(instanceMatrix[0].xyz);
          float impSY = length(instanceMatrix[1].xyz);
          float impSway = sin(uTime * 1.3 + aPhase + impC.x * 0.05 + impC.z * 0.04) * 0.35 * uv.y * uv.y;
          vec3 impW = impC.xyz + impFace * position.x * impSX + vec3(0., 1., 0.) * (position.y * impSY + impSway);
          vec4 mvPosition = viewMatrix * vec4(impW, 1.0);
          gl_Position = projectionMatrix * mvPosition;`);
  };
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.frustumCulled = false; // spans the valley; one call either way
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const S = new THREE.Vector3(), P = new THREE.Vector3(), C = new THREE.Color();
  spots.forEach((t, i) => {
    E.set(0, 0, 0); Q.setFromEuler(E);
    S.set(8 + t.s * 6, 10 + t.s * 8, 1); // 8–14 m wide, 10–18 m tall
    P.set(t.x, t.y - 0.6, t.z); // bury quad base; trunk feet land on dirt
    M.compose(P, Q, S);
    mesh.setMatrixAt(i, M);
    variant[i] = t.variant;
    phase[i] = t.phase;
    C.setHSL(0.22 + t.tint * 0.05, 0.3, 0.58 + t.tint * 0.14);
    mesh.setColorAt(i, C);
  });
  geo.setAttribute('aVariant', new THREE.InstancedBufferAttribute(variant, 1));
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}

// Generic photo groundcover: instanced camera-facing billboards (bushes,
// grass clumps). Two tris each, one draw call per layer.
// Roadside placement: random loop point + lateral offset fills exact counts
// in linear time (no valley-wide rejection sampling).
function buildGroundLayer(scene, o) {
  const rnd = mulberry32(o.seed);
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0, 0.5, 0);
  const spots = [];
  const nRoad = roadSamples.length;
  let guard = 0;
  while (spots.length < o.target && guard++ < o.target * 3) {
    const s = roadSamples[(rnd() * nRoad) | 0];
    const side = rnd() < 0.5 ? -1 : 1;
    const lat = side * (o.minRoad + rnd() * (o.maxRoad - o.minRoad));
    const x = s.x + -s.tz * lat, z = s.z + s.tx * lat;
    const y = getHeight(x, z);
    if (y > 170) continue;
    spots.push({
      x, y, z,
      w: o.wMin + rnd() * (o.wMax - o.wMin),
      h: o.hMin + rnd() * (o.hMax - o.hMin),
      variant: (rnd() * 2) | 0, tint: rnd(), phase: rnd() * 6.28,
    });
  }
  const n = Math.max(1, spots.length);
  const variant = new Float32Array(n), phase = new Float32Array(n);
  const mat = makeBillboardMaterial(o.tex, 2, 1, grassUniforms.uTime, o.sway);
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.frustumCulled = false;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const S = new THREE.Vector3(), P = new THREE.Vector3(), C = new THREE.Color();
  spots.forEach((t, i) => {
    E.set(0, 0, 0); Q.setFromEuler(E);
    S.set(t.w, t.h, 1);
    P.set(t.x, t.y - o.sink, t.z);
    M.compose(P, Q, S);
    mesh.setMatrixAt(i, M);
    variant[i] = t.variant;
    phase[i] = t.phase;
    o.tint(C, t.tint);
    mesh.setColorAt(i, C);
  });
  geo.setAttribute('aVariant', new THREE.InstancedBufferAttribute(variant, 1));
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}

export const heroSpots = [];
export async function loadTreeGLB(path) {
  const base = import.meta.env.BASE_URL || '/';
  const gltf = await new GLTFLoader().loadAsync(base + path);
  // Parts identified by baked material name (alderWood_mat / alderLeaf_mat).
  let woodGeo = null, leafGeo = null;
  const found = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    found.push(o);
    const mn = (o.material && o.material.name) || '';
    if (/wood/i.test(mn) && !woodGeo) woodGeo = o.geometry;
    if (/leaf/i.test(mn) && !leafGeo) leafGeo = o.geometry;
  });
  if (!woodGeo && found[0]) woodGeo = found[0].geometry;
  if (!leafGeo && found[1]) leafGeo = found[1].geometry;
  if (!woodGeo || !leafGeo) throw new Error('tree GLB missing meshes: ' + path);
  return { woodGeo, leafGeo };
}

export function tickVegetation(elapsed) {
  grassUniforms.uTime.value = elapsed;
}

// Baked film-quality Black Alders (see bake_alder.py): a few hero specimens
// near the road where detail is visible. The stylized forest carries the mass
// behind them — full replacement would exceed any GPU budget (57M faces/tree).
export async function buildHeroAlders(scene, quality = 'high') {
  const { woodGeo, leafGeo } = await loadTreeGLB('trees/alder_hero_c.glb');

  const woodMat = new THREE.MeshStandardMaterial({
    map: barkTexture(), roughness: 0.95, metalness: 0, envMapIntensity: 0.3,
  });
  const leafMat = new THREE.MeshStandardMaterial({
    map: foliageTexture(), color: new THREE.Color('#a3c174'),
    roughness: 0.9, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.5,
    emissive: new THREE.Color('#1a2408'), emissiveIntensity: 0.5,
  });
  addSway(leafMat, 0.008); // canopy breath, trunk stays planted

  const N = quality === 'low' ? 4 : 8;
  const rnd = mulberry32(7001);
  const wood = new THREE.InstancedMesh(woodGeo, woodMat, N);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, N);
  wood.castShadow = true; wood.receiveShadow = true;
  leaves.castShadow = true;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const S = new THREE.Vector3(), P = new THREE.Vector3();
  const n = roadSamples.length;
  heroSpots.length = 0;
  for (let k = 0; k < N; k++) {
    const si = (k * 131 + 37) % n;
    const s = roadSamples[si];
    const side = k % 2 ? 1 : -1;
    const off = 13 + rnd() * 12;
    const x = s.x + -s.tz * off * side;
    const z = s.z + s.tx * off * side;
    const sc = 0.72 + rnd() * 0.33; // 10–14.5 m specimens
    E.set(0, rnd() * Math.PI * 2, 0); Q.setFromEuler(E);
    S.set(sc, sc * (0.92 + rnd() * 0.16), sc);
    P.set(x, getHeight(x, z) - 0.15, z);
    M.compose(P, Q, S);
    wood.setMatrixAt(k, M);
    leaves.setMatrixAt(k, M);
    treeColliders.push({ x, z, r: 1.3 * sc });
    heroSpots.push({ x, z });
  }
  wood.instanceMatrix.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;
  scene.add(wood, leaves);
  return { wood, leaves };
}
