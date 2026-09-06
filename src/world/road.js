import * as THREE from 'three';
import { baseHeight, setRoadSamples, ROAD_WIDTH } from './terrain.js';
import { asphaltTexture, asphaltRoughnessTexture, stoneTexture, grassDetailTexture } from '../utils/textures.js';
import { mulberry32 } from '../utils/math.js';

export let roadCurve = null;
export let roadSamples = []; // {x,y,z,tx,tz,dist}
export let roadLength = 0;

export const WALL_START = 80;
export const WALL_END = 330;

const LIFT = 0.34;  // road surface above the flattened ribbon — never buried
const CROWN = 0.06; // rain-shedding crown at the centerline
export const ROAD_LIFT = LIFT;
export const ROAD_CROWN = CROWN;

const CONTROL = [
  [0, -880], [430, -740], [740, -430], [840, -40], [650, 330],
  [710, 690], [330, 830], [-90, 730], [-430, 830], [-770, 570],
  [-890, 140], [-730, -290], [-490, -530], [-190, -740]
];

export function initRoadLayout() {
  const pts = CONTROL.map(([x, z]) => {
    const y = baseHeight(x, z);
    return new THREE.Vector3(x, y, z);
  });
  roadCurve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.6);
  const N = 1400;
  const spaced = roadCurve.getSpacedPoints(N);
  spaced.pop(); // closed: last == first
  roadSamples = [];
  let dist = 0;
  let prev = null;
  // Smooth heights hard — the tarmac must ride glass-smooth.
  // ±100 m window: keeps real valley grades, kills ground ripple entirely.
  const rawY = spaced.map(p => baseHeight(p.x, p.z) + 0.25);
  const W = 25;
  const smoothY = rawY.map((_, i) => {
    let s = 0;
    for (let k = -W; k <= W; k++) s += rawY[(i + k + spaced.length) % spaced.length];
    return s / (W * 2 + 1);
  });
  for (let i = 0; i < spaced.length; i++) {
    const p = spaced[i];
    const y = smoothY[i];
    if (prev) dist += Math.hypot(p.x - prev.x, p.z - prev.z);
    roadSamples.push({ x: p.x, y, z: p.z, dist });
    prev = p;
  }
  roadLength = dist + Math.hypot(spaced[0].x - prev.x, spaced[0].z - prev.z);
  for (let i = 0; i < roadSamples.length; i++) {
    const a = roadSamples[(i - 1 + roadSamples.length) % roadSamples.length];
    const b = roadSamples[(i + 1) % roadSamples.length];
    const tx = b.x - a.x, tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    roadSamples[i].tx = tx / l; roadSamples[i].tz = tz / l;
  }
  setRoadSamples(roadSamples);
  return { roadSamples, roadLength };
}

export function closestOnRoad(x, z) {
  let bi = 0, bd = 1e18;
  for (let i = 0; i < roadSamples.length; i++) {
    const s = roadSamples[i];
    const dx = x - s.x, dz = z - s.z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; bi = i; }
  }
  const s = roadSamples[bi];
  return { index: bi, dist: Math.sqrt(bd), point: s };
}

export function roadPointAhead(index, meters) {
  const n = roadSamples.length;
  let target = roadSamples[index].dist + meters;
  if (target >= roadLength) target -= roadLength;
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (roadSamples[mid].dist < target) lo = mid + 1; else hi = mid;
  }
  return { point: roadSamples[lo % n], index: lo % n };
}

// Surface height of the finished tarmac at a lateral offset from a sample.
function surfY(s, lat) {
  const t = Math.max(0, Math.min(1, lat / ROAD_WIDTH + 0.5));
  return s.y + LIFT + Math.cos((t - 0.5) * Math.PI) * CROWN;
}

// Interpolated frame at an exact road distance — lerps between samples so
// followers glide instead of snapping sample-to-sample.
export function roadFrameAt(dist) {
  const n = roadSamples.length;
  const t = ((dist % roadLength) + roadLength) % roadLength;
  // segment start = last sample with dist <= t (handles the wrap segment too)
  let lo = 0, hi = n - 1, ans = n - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (roadSamples[m].dist <= t) { ans = m; lo = m + 1; } else hi = m - 1;
  }
  const A = roadSamples[ans];
  const B = roadSamples[(ans + 1) % n];
  let bDist = B.dist;
  if (bDist <= A.dist) bDist += roadLength; // wrap segment
  let tt = t;
  if (tt < A.dist) tt += roadLength;
  const f = Math.max(0, Math.min(1, (tt - A.dist) / Math.max(1e-6, bDist - A.dist)));
  const tx = A.tx + (B.tx - A.tx) * f, tz = A.tz + (B.tz - A.tz) * f;
  const tl = Math.hypot(tx, tz) || 1;
  return {
    x: A.x + (B.x - A.x) * f,
    y: A.y + (B.y - A.y) * f,
    z: A.z + (B.z - A.z) * f,
    tx: tx / tl, tz: tz / tl,
  };
}
// This is what cars must drive on — terrain height alone leaves wheels buried.
export function roadSurfaceAt(x, z) {
  const n = roadSamples.length;
  if (!n) return null;
  let bi = 0, bd = 1e18;
  for (let i = 0; i < n; i++) {
    const s = roadSamples[i];
    const dx = x - s.x, dz = z - s.z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; bi = i; }
  }
  if (Math.sqrt(bd) > 60) return null;
  let bestD = bd, bestY = roadSamples[bi].y, bx = roadSamples[bi].x, bz = roadSamples[bi].z;
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
    if (d < bestD) { bestD = d; bestY = A.y + (B.y - A.y) * t; bx = px; bz = pz; }
  }
  const s = roadSamples[bi];
  const nx = -s.tz, nz = s.tx;
  const lat = (x - bx) * nx + (z - bz) * nz;
  const t = Math.max(0, Math.min(1, lat / ROAD_WIDTH + 0.5));
  return {
    y: bestY + LIFT + Math.cos((t - 0.5) * Math.PI) * CROWN,
    lat, dist: Math.sqrt(bestD), index: bi,
  };
}

export function buildRoad(scene) {
  const W = ROAD_WIDTH;
  const ACROSS = 11;
  const n = roadSamples.length;
  const verts = [], uvs = [], idx = [];

  for (let i = 0; i <= n; i++) {
    const s = roadSamples[i % n];
    const nx = -s.tz, nz = s.tx; // left normal
    for (let j = 0; j < ACROSS; j++) {
      const t = j / (ACROSS - 1);
      const off = (t - 0.5) * W;
      verts.push(s.x + nx * off, surfY(s, off), s.z + nz * off);
      uvs.push(t, s.dist / 9);
    }
  }
  for (let j = 0; j < ACROSS; j++) {
    uvs[(n * ACROSS + j) * 2 + 1] = roadLength / 9;
  }
  // NOTE: rings run forward, j runs right→left. Up-facing order is (a, a+1, b).
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < ACROSS - 1; j++) {
      const a = i * ACROSS + j, b = a + ACROSS;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const map = asphaltTexture();
  const rough = asphaltRoughnessTexture();
  const mat = new THREE.MeshStandardMaterial({
    map,
    roughnessMap: rough,
    roughness: 1.0, // modulated by roughnessMap
    metalness: 0.0,
    envMapIntensity: 0.05,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'road';
  scene.add(mesh);

  buildVerge(scene);
  buildStuds(scene);
  buildWeathering(scene);
  buildStoneWall(scene);
  buildFence(scene);
  return mesh;
}

function buildVerge(scene) {
  // Gravel verge that melts into the meadow — vertex colors gravel→grass.
  const W = ROAD_WIDTH;
  const ACROSS = 5;
  const EXTRA = 1.3;
  const n = roadSamples.length;
  const verts = [], cols = [], uvs = [], idx = [];
  const cGravel = new THREE.Color('#4a463a');
  const cGrass = new THREE.Color('#556b33');
  const cTmp = new THREE.Color();
  for (let i = 0; i <= n; i++) {
    const s = roadSamples[i % n];
    const nx = -s.tz, nz = s.tx;
    for (let j = 0; j < ACROSS; j++) {
      const t = j / (ACROSS - 1); // 0 outer-right … 1 outer-left
      const edge = Math.abs(t - 0.5) * 2; // 0 center → 1 outer
      const off = (t - 0.5) * (W + EXTRA * 2);
      // shallow drainage swale along the outer third — catches light + water
      const dip = edge > 0.7 ? ((edge - 0.7) / 0.3) * ((edge - 0.7) / 0.3) * 0.16 : 0;
      const y = surfY(s, Math.max(-W / 2, Math.min(W / 2, off))) - 0.07 - edge * edge * 0.12 - dip;
      verts.push(s.x + nx * off, y, s.z + nz * off);
      uvs.push(t * 2, s.dist / 6);
      // ragged grass intrusion
      const ragged = 0.45 + 0.3 * Math.sin(i * 1.7 + j * 3.1);
      cTmp.copy(cGravel).lerp(cGrass, Math.max(0, Math.min(1, (edge - ragged) / (1 - ragged + 1e-3))));
      cols.push(cTmp.r, cTmp.g, cTmp.b);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < ACROSS - 1; j++) {
      const a = i * ACROSS + j, b = a + ACROSS;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const vmap = grassDetailTexture();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    map: vmap, vertexColors: true, roughness: 1, metalness: 0,
    side: THREE.DoubleSide, envMapIntensity: 0.05,
  }));
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function buildStuds(scene) {
  // Reflective road studs between the center lines — emissive material,
  // no lights. They read the lane at dusk when everything else goes dark.
  const geo = new THREE.BoxGeometry(0.09, 0.05, 0.14);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#3a3a3a'), emissive: new THREE.Color('#fff0c0'),
    emissiveIntensity: 1.6, roughness: 0.4, metalness: 0,
  });
  const step = 12;
  const count = Math.floor(roadLength / step);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const S = new THREE.Vector3(1, 1, 1), P = new THREE.Vector3();
  for (let k = 0; k < count; k++) {
    const f = roadFrameAt(k * step);
    E.set(0, Math.atan2(f.tx, f.tz), 0); Q.setFromEuler(E);
    P.set(f.x, f.y + LIFT + CROWN + 0.02, f.z);
    M.compose(P, Q, S);
    mesh.setMatrixAt(k, M);
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
}

function buildWeathering(scene) {
  // Unique per-location wear: repair patches, tar snakes, oil drips.
  // Merged ribbons draped exactly on the surface — no tiling repetition.
  const rnd = mulberry32(2024);
  const n = roadSamples.length;
  const pos = [], col = [], idx = [];
  let vi = 0;
  const C = new THREE.Color();

  // Ribbon of `count` sample-steps starting at si, centered at lat, width w.
  function ribbon(si, count, lat, w, shade) {
    C.set(shade);
    const base = vi;
    for (let k = 0; k <= count; k++) {
      const s = roadSamples[(si + k) % n];
      const nx = -s.tz, nz = s.tx;
      const y0 = surfY(s, lat - w / 2) + 0.025;
      const y1 = surfY(s, lat + w / 2) + 0.025;
      pos.push(s.x + nx * (lat - w / 2), y0, s.z + nz * (lat - w / 2));
      pos.push(s.x + nx * (lat + w / 2), y1, s.z + nz * (lat + w / 2));
      col.push(C.r, C.g, C.b, C.r, C.g, C.b);
      vi += 2;
      if (k < count) {
        const a = base + k * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }

  // asphalt repair patches (dark rectangles, staggered lanes)
  for (let k = 0; k < 26; k++) {
    const si = (k * 173 + 41) % n;
    const lat = (rnd() - 0.5) * (ROAD_WIDTH - 2.6);
    ribbon(si, 1 + ((rnd() * 2) | 0), lat, 1.1 + rnd() * 1.6, rnd() < 0.5 ? '#17171b' : '#1e1e23');
  }
  // tar snakes — wandering crack sealant
  for (let k = 0; k < 22; k++) {
    let si = (k * 251 + 7) % n;
    let lat = (rnd() - 0.5) * (ROAD_WIDTH - 1.6);
    const steps = 4 + ((rnd() * 6) | 0);
    const w = 0.07 + rnd() * 0.06;
    for (let st = 0; st < steps; st++) {
      ribbon(si, 1, lat, w, '#0c0c0e');
      si = (si + 1) % n;
      lat += (rnd() - 0.5) * 0.9;
      lat = Math.max(-ROAD_WIDTH / 2 + 0.6, Math.min(ROAD_WIDTH / 2 - 0.6, lat));
    }
  }
  // oil drips down the wheel lines
  for (let k = 0; k < 40; k++) {
    const si = (k * 89 + 300) % n;
    const lat = (k % 2 ? 1.05 : -1.05) + (rnd() - 0.5) * 0.3;
    ribbon(si, 1, lat, 0.35 + rnd() * 0.3, '#0a0a0c');
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // force all normals up (ribbons are near-planar; avoids shading seams)
  const nrm = geo.attributes.normal;
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, transparent: true, opacity: 0.55,
    roughness: 0.85, metalness: 0.05, envMapIntensity: 0.3, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
  }));
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  scene.add(mesh);
}

function buildStoneWall(scene) {
  const tex = stoneTexture();
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0, envMapIntensity: 0.35 });
  const segGeo = new THREE.BoxGeometry(0.62, 1.15, 3.35, 1, 2, 2);
  const p = segGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setX(i, p.getX(i) + Math.sin(i * 12.9) * 0.05);
    p.setY(i, p.getY(i) + Math.cos(i * 7.7) * 0.04);
  }
  segGeo.computeVertexNormals();
  const count = WALL_END - WALL_START;
  const wall = new THREE.InstancedMesh(segGeo, mat, count);
  wall.castShadow = true; wall.receiveShadow = true;
  const capGeo = new THREE.BoxGeometry(0.78, 0.16, 3.1);
  const cap = new THREE.InstancedMesh(capGeo, mat, count);
  cap.castShadow = true; cap.receiveShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const sc = new THREE.Vector3(), pos = new THREE.Vector3();
  let k = 0;
  for (let i = WALL_START; i < WALL_END; i++) {
    const s = roadSamples[i];
    const nx = -s.tz, nz = s.tx;
    const off = ROAD_WIDTH / 2 + 1.9;
    const yaw = Math.atan2(s.tx, s.tz);
    const h = 0.92 + (Math.sin(i * 12.3) * 0.5 + 0.5) * 0.22;
    pos.set(s.x + nx * off, s.y + 0.52, s.z + nz * off);
    e.set(0, yaw + Math.sin(i * 3.3) * 0.015, 0); q.setFromEuler(e);
    sc.set(1, h, 1); m.compose(pos, q, sc);
    wall.setMatrixAt(k, m);
    pos.y = s.y + 0.52 + (1.15 * h) / 2 + 0.06;
    e.set(Math.sin(i * 9.1) * 0.05, yaw + 0.03, Math.cos(i * 5.7) * 0.05); q.setFromEuler(e);
    sc.set(1, 1, 1); m.compose(pos, q, sc);
    cap.setMatrixAt(k, m);
    k++;
  }
  wall.instanceMatrix.needsUpdate = true;
  cap.instanceMatrix.needsUpdate = true;
  scene.add(wall, cap);
}

function buildFence(scene) {
  const postGeo = new THREE.CylinderGeometry(0.075, 0.095, 1.05, 8);
  const woodMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#4f3d2b'), roughness: 0.92, envMapIntensity: 0.3 });
  const railGeo = new THREE.BoxGeometry(0.07, 0.11, 1);
  const railMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#5a4632'), roughness: 0.9, envMapIntensity: 0.3 });

  const posts = [];
  for (let i = WALL_START; i < WALL_END; i += 2) posts.push(i);
  const postMesh = new THREE.InstancedMesh(postGeo, woodMat, posts.length);
  postMesh.castShadow = true;
  const railMesh = new THREE.InstancedMesh(railGeo, railMat, posts.length * 2);
  railMesh.castShadow = true;

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const sc = new THREE.Vector3(), pos = new THREE.Vector3(), mid = new THREE.Vector3();
  posts.forEach((si, k) => {
    const s = roadSamples[si];
    const nx = -s.tz, nz = s.tx;
    const off = ROAD_WIDTH / 2 + 1.6;
    pos.set(s.x - nx * off, s.y + 0.42, s.z - nz * off);
    e.set(Math.sin(si) * 0.03, 0, Math.cos(si * 1.7) * 0.03); q.setFromEuler(e);
    sc.set(1, 1, 1); m.compose(pos, q, sc);
    postMesh.setMatrixAt(k, m);
  });
  let r = 0;
  for (let k = 0; k < posts.length - 1; k++) {
    const a = roadSamples[posts[k]], b = roadSamples[posts[k + 1]];
    const anx = a.tz, anz = -a.tx;
    mid.set(
      (a.x - anx * (ROAD_WIDTH / 2 + 1.6) + b.x - anx * (ROAD_WIDTH / 2 + 1.6)) / 2,
      0,
      (a.z - anz * (ROAD_WIDTH / 2 + 1.6) + b.z - anz * (ROAD_WIDTH / 2 + 1.6)) / 2
    );
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    [0.62, 0.92].forEach(h => {
      mid.y = (a.y + b.y) / 2 + h;
      e.set(0, yaw, 0); q.setFromEuler(e);
      sc.set(1, 1, len); m.compose(mid, q, sc);
      railMesh.setMatrixAt(r++, m);
    });
  }
  railMesh.count = r;
  postMesh.instanceMatrix.needsUpdate = true;
  railMesh.instanceMatrix.needsUpdate = true;
  scene.add(postMesh, railMesh);
}
