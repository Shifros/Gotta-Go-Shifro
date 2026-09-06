import * as THREE from 'three';
import { fbm2, noise2, clamp, smoothstep } from '../utils/math.js';
import { grassDetailTexture } from '../utils/textures.js';

export const WORLD_SIZE = 4000;
export const ROAD_WIDTH = 7.5;

// Road samples injected by road module for terrain flattening.
let roadSamples = []; // {x,z,y}

// Spatial hash so per-vertex road queries are O(1).
const CELL = 40;
const grid = new Map();
const gk = (gx, gz) => gx + ':' + gz;

export function setRoadSamples(samples) {
  roadSamples = samples;
  grid.clear();
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const key = gk(Math.floor(s.x / CELL), Math.floor(s.z / CELL));
    let a = grid.get(key);
    if (!a) { a = []; grid.set(key, a); }
    a.push(i);
  }
}

// Fast corridor query: segment-interpolated road height (no steps/bumps).
function queryRoad(x, z) {
  if (!roadSamples.length || grid.size === 0) return null;
  const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
  let bi = -1, bd = 1e18;
  for (let ix = gx - 1; ix <= gx + 1; ix++) {
    for (let iz = gz - 1; iz <= gz + 1; iz++) {
      const a = grid.get(gk(ix, iz));
      if (!a) continue;
      for (let k = 0; k < a.length; k++) {
        const s = roadSamples[a[k]];
        const dx = x - s.x, dz = z - s.z;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; bi = a[k]; }
      }
    }
  }
  if (bi < 0) return null;
  if (Math.sqrt(bd) > 64) return null;
  return interpRoad(x, z, bi, bd);
}

// Project onto the two segments around sample bi, lerp height — C0 smooth.
function interpRoad(x, z, bi, bd) {
  const n = roadSamples.length;
  let bestD = bd, bestY = roadSamples[bi].y;
  const segs = [[(bi - 1 + n) % n, bi], [bi, (bi + 1) % n]];
  for (let k = 0; k < 2; k++) {
    const A = roadSamples[segs[k][0]], B = roadSamples[segs[k][1]];
    const abx = B.x - A.x, abz = B.z - A.z;
    const len2 = abx * abx + abz * abz || 1;
    let t = ((x - A.x) * abx + (z - A.z) * abz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = A.x + abx * t, pz = A.z + abz * t;
    const dx = x - px, dz = z - pz;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; bestY = A.y + (B.y - A.y) * t; }
  }
  return { d: Math.sqrt(bestD), y: bestY };
}

// Base rolling terrain — must be pure function of x,z.
export function baseHeight(x, z) {
  const r = Math.hypot(x, z);
  // Rolling valley hills (gentle near the loop, big ridges far out)
  let h = fbm2(x * 0.00055 + 13.7, z * 0.00055 + 7.1, 4) * 62;
  h += fbm2(x * 0.0021 + 3.3, z * 0.0021 + 9.9, 3) * 9;
  h += noise2(x * 0.008, z * 0.008) * 1.2;
  // Valley bowl: keep center drivable, lift rim into mountains
  h += smoothstep(1100, 2050, r) * 230;
  // Extra far ridge variation
  h += smoothstep(1500, 2600, r) * fbm2(x * 0.00035, z * 0.00035, 3) * 120;
  // Gentle tilt so the loop has climbs/descents
  h += Math.sin(x * 0.0004) * 8 + Math.cos(z * 0.00033) * 7;
  return h;
}

// Coarse distance (used for scattering; stride keeps init fast).
export function distToRoad(x, z) {
  if (!roadSamples.length) return 1e9;
  let best = 1e9;
  for (let i = 0; i < roadSamples.length; i += 3) {
    const s = roadSamples[i];
    const dx = x - s.x, dz = z - s.z;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

export function getHeight(x, z) {
  const b = baseHeight(x, z);
  const q = queryRoad(x, z);
  if (!q || q.d > 26) return b;
  // Wide fully-flat ribbon so the 10 m terrain grid always captures the road.
  const t = smoothstep(7.5, 24, q.d);
  const blend = t * t * (3 - 2 * t);
  return q.y * (1 - blend) + b * blend;
}

export function getHeightAndNormal(x, z, out) {
  const e = 1.2;
  const h = getHeight(x, z);
  const hx = getHeight(x + e, z) - getHeight(x - e, z);
  const hz = getHeight(x, z + e) - getHeight(x, z - e);
  const n = out || new THREE.Vector3();
  n.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
  return { h, n };
}

export function isOffRoad(x, z) {
  const q = queryRoad(x, z);
  if (!q) return true;
  return q.d > ROAD_WIDTH * 0.62;
}

let terrainMesh = null;

// Deterministic per-cell hash for patchwork fields.
function hash2(ix, iz) {
  let h = ix * 374761393 + iz * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

const FIELD_COLS = [
  new THREE.Color('#5c7a34'), new THREE.Color('#6d8a3c'), new THREE.Color('#4d6c2e'),
  new THREE.Color('#7d8a4a'), new THREE.Color('#86905a'), new THREE.Color('#57683a'),
  new THREE.Color('#8a7a4e'), // hay meadow
];

export function buildTerrain(scene, groundMaps = null) {
  const SIZE = WORLD_SIZE;
  const SEG = 400; // 10 m grid — fine enough to hold the flattened road ribbon
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cA = new THREE.Color('#43612a'); // lush valley
  const cB = new THREE.Color('#71864a'); // sunlit meadow
  const cC = new THREE.Color('#8b9070'); // dry high grass
  const cD = new THREE.Color('#5d564c'); // rock
  const cTmp = new THREE.Color();
  const cField = new THREE.Color();
  const cWhite = new THREE.Color('#ffffff');

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, getHeight(x, z));
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const GRID = SEG + 1;
  const heightAt = (ix, iz) => {
    ix = Math.max(0, Math.min(SEG, ix));
    iz = Math.max(0, Math.min(SEG, iz));
    return pos.getY(iz * GRID + ix);
  };

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = nrm.getY(i);
    // Concavity AO: hollows and valley folds hold shadow, ridges stay lit.
    const ix = i % GRID, iz = (i / GRID) | 0;
    const conc = (heightAt(ix - 1, iz) + heightAt(ix + 1, iz) +
                  heightAt(ix, iz - 1) + heightAt(ix, iz + 1)) * 0.25 - y;
    const ao = Math.max(0.58, Math.min(1.0, 1 - conc * 0.10));
    const var1 = fbm2(x * 0.004 + 50, z * 0.004, 3) * 0.5 + 0.5;
    const var2 = fbm2(x * 0.0009 + 91, z * 0.0009 + 31, 3) * 0.5 + 0.5;
    cTmp.copy(cA).lerp(cB, var1).lerp(cC, smoothstep(45, 150, y) * 0.7 + var2 * 0.18);
    // rock on steeps
    const rock = smoothstep(0.82, 0.62, n);
    cTmp.lerp(cD, rock * 0.85);

    // Patchwork farmland on gentle low valley floor — the reference's quilted fields.
    const slopeFlat = smoothstep(0.965, 0.985, n);
    const lowLand = (1 - smoothstep(60, 130, y)) * smoothstep(-8, 4, y);
    if (slopeFlat > 0 && lowLand > 0) {
      const warp = fbm2(x * 0.0006 + 3, z * 0.0006 + 8, 2) * 260;
      const cu = Math.floor((x + warp) / 190), cv = Math.floor((z - warp) / 190);
      const pick = hash2(cu, cv);
      cField.copy(FIELD_COLS[(pick * FIELD_COLS.length) | 0]);
      // hedgerow darkening near cell borders
      const fu = ((x + warp) / 190) % 1, fv = ((z - warp) / 190) % 1;
      const edge = Math.min(Math.abs(fu) < 0.5 ? Math.abs(fu) : 1 - Math.abs(fu),
                            Math.abs(fv) < 0.5 ? Math.abs(fv) : 1 - Math.abs(fv));
      if (edge < 0.03) cField.multiplyScalar(0.55);
      const m = 0.6 * slopeFlat * lowLand;
      cTmp.lerp(cField, m);
    }

    cTmp.multiplyScalar((0.92 + var2 * 0.16) * ao);
    // Photographed albedo already carries mid-tone greens — lift tints
    // toward white so map × vertex stays luminous instead of double-dark.
    // Rock keeps more of its gray-brown body so crags don't read as moss.
    if (groundMaps) cTmp.lerp(cWhite, rock > 0.4 ? 0.25 : 0.5);
    colors[i * 3] = cTmp.r; colors[i * 3 + 1] = cTmp.g; colors[i * 3 + 2] = cTmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  let map, normalMap = null, roughnessMap = null;
  if (groundMaps) {
    ({ map, normalMap, roughnessMap } = groundMaps);
  } else {
    map = grassDetailTexture();
    map.repeat.set(260, 260);
  }

  // Ground = pure diffuse albedo. No normal map, no roughness map, no
  // image reflections: there is no code path left that can produce glare.
  // Detail comes from the photographed albedo + vertex tint + baked AO.
  const mat = new THREE.MeshStandardMaterial({
    map,
    vertexColors: true,
    roughness: 1.0,
    metalness: 0.0,
    envMapIntensity: 0,
  });
  terrainMesh = new THREE.Mesh(geo, mat);
  terrainMesh.receiveShadow = true;
  terrainMesh.name = 'terrain';
  scene.add(terrainMesh);

  buildFarMountains(scene);
  return terrainMesh;
}

function buildFarMountains(scene) {
  // Enclosing panorama ridges — heavily fogged like the reference.
  const geo = new THREE.CylinderGeometry(6800, 6800, 900, 96, 6, true);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ang = Math.atan2(v.z, v.x);
    const ridge = fbm2(Math.cos(ang) * 3.1 + 7, Math.sin(ang) * 3.1 + v.y * 0.002, 4) * 260;
    pos.setY(i, v.y + ridge + 120);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#7d7f8e'),
    roughness: 1,
    metalness: 0,
    side: THREE.BackSide,
    fog: true,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = -60;
  scene.add(m);

  // Second nearer forested ridge ring
  const geo2 = new THREE.CylinderGeometry(3600, 3600, 420, 96, 4, true);
  const p2 = geo2.attributes.position;
  for (let i = 0; i < p2.count; i++) {
    v.fromBufferAttribute(p2, i);
    const ang = Math.atan2(v.z, v.x);
    const ridge = fbm2(Math.cos(ang) * 5.2, Math.sin(ang) * 5.2 + 3, 4) * 150;
    p2.setY(i, v.y + ridge + 40);
  }
  geo2.computeVertexNormals();
  const mat2 = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#46543e'), roughness: 1, side: THREE.BackSide, fog: true
  });
  const m2 = new THREE.Mesh(geo2, mat2);
  m2.position.y = 20;
  scene.add(m2);
}
