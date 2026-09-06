import * as THREE from 'three';
import { mulberry32 } from '../utils/math.js';
import { getHeight } from './terrain.js';
import { roads, roadFrameOn, ROAD_LIFT } from './road.js';

// Stunt + scenery layer: boost pads, jump ramps, houses, stunt barn.
// Positions derive from the road splines — no hand-tuned coordinates drift.
export const BOOSTS = [];
export const RAMPS = [];
export const HOUSES = [];
export const ROOFS = [];
const animated = [];

function surfYAt(road, dist, lat) {
  const f = roadFrameOn(road, dist);
  const nx = -f.tz, nz = f.tx;
  const t = Math.max(0, Math.min(1, lat / road.width + 0.5));
  const crown = Math.cos((t - 0.5) * Math.PI) * 0.06;
  return { x: f.x + nx * lat, y: f.y + ROAD_LIFT + crown, z: f.z + nz * lat, yaw: Math.atan2(f.tx, f.tz) };
}

function addBoost(road, dist, lat, target, color = '#37e0ff') {
  const p = surfYAt(road, dist, lat);
  BOOSTS.push({ ...p, r: 7, target });
  return BOOSTS[BOOSTS.length - 1];
}

function addRamp(x, z, yaw, w = 4.5, len = 11, h = 2.4) {
  RAMPS.push({ x, z, yaw, w, len, h, y: getHeight(x, z) });
  return RAMPS[RAMPS.length - 1];
}

export function checkBoost(x, z) {
  for (let i = 0; i < BOOSTS.length; i++) {
    const b = BOOSTS[i];
    const dx = x - b.x, dz = z - b.z;
    if (dx * dx + dz * dz < b.r * b.r) return b.target;
  }
  return 0;
}

// Kicked skyward when driving up a ramp face with pace.
export function checkRamp(x, z, heading, speed) {
  if (speed < 8) return 0;
  for (let i = 0; i < RAMPS.length; i++) {
    const r = RAMPS[i];
    const dx = x - r.x, dz = z - r.z;
    const fx = Math.sin(r.yaw), fz = Math.cos(r.yaw);
    const along = dx * fx + dz * fz;
    const side = -dx * fz + dz * fx;
    if (Math.abs(side) > r.w / 2 + 0.8 || along < -r.len / 2 || along > r.len / 2) continue;
    const hx = Math.sin(heading), hz = Math.cos(heading);
    if (hx * fx + hz * fz < 0.55) continue; // must hit it face-on
    return speed * 0.34 + 2;
  }
  return 0;
}

// Drivable flat roof decks (land from the air; walls block the sides).
export function groundExtra(x, z, y) {
  for (let i = 0; i < ROOFS.length; i++) {
    const r = ROOFS[i];
    if (y < r.y - 1.5) continue;
    const dx = x - r.x, dz = z - r.z;
    const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) < r.hw + 0.4 && Math.abs(lz) < r.hd + 0.4) return r.y;
  }
  return 0;
}

// Solid house bodies: rotated-rect push-out (skipped when flying over).
export function collideProps(px, pz, py) {
  for (let i = 0; i < HOUSES.length; i++) {
    const h = HOUSES[i];
    if (py > h.topY - 0.4) continue;
    const dx = px - h.x, dz = pz - h.z;
    const c = Math.cos(h.yaw), s = Math.sin(h.yaw);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const ox = h.hw + 1.0 - Math.abs(lx), oz = h.hd + 1.0 - Math.abs(lz);
    if (ox > 0 && oz > 0) {
      if (ox < oz) {
        const push = (lx > 0 ? 1 : -1) * ox;
        return { x: px + push * c, z: pz + push * -s, hard: true };
      }
      const push = (lz > 0 ? 1 : -1) * oz;
      return { x: px + push * s, z: pz + push * c, hard: true };
    }
  }
  return null;
}

export function buildProps(scene) {
  const loop = roads[0], highway = roads[1], lane = roads[2];
  const rnd = mulberry32(77);

  // --- boost pads: highway flyers + loop straight + ramp feeder ---
  addBoost(highway, 900, 0, 48);
  addBoost(highway, 2600, -1.5, 48);
  addBoost(loop, 400, 1.5, 42);

  // --- stunt barn off the loop (dist 1500, left side) + feeder ramp ---
  {
    const f = roadFrameOn(loop, 1500);
    const nx = -f.tz, nz = f.tx;
    const bx = f.x + nx * 20, bz = f.z + nz * 20;
    const by = getHeight(bx, bz);
    const yaw = Math.atan2(f.tx, f.tz);
    HOUSES.push({ x: bx, z: bz, y: by, yaw, hw: 6, hd: 4.2, topY: by + 4.4, barn: true });
    ROOFS.push({ x: bx, z: bz, yaw, hw: 6.2, hd: 4.4, y: by + 3.55 });
    const dirx = bx - f.x, dirz = bz - f.z;
    const dl = Math.hypot(dirx, dirz) || 1;
    addRamp(bx - (dirx / dl) * 24, bz - (dirz / dl) * 24, Math.atan2(dirx / dl, dirz / dl));
    addBoost(loop, 1470, 2.0, 44);
  }
  // --- highway kicker + meadow kicker (pure airtime, safe landings) ---
  {
    const f = roadFrameOn(highway, 3100);
    addRamp(f.x - f.tz * 2.5, f.z + f.tx * 2.5, Math.atan2(f.tx, f.tz));
    const g = roadFrameOn(loop, 2800);
    addRamp(g.x + g.tz * 2.4, g.z - g.tx * 2.4, Math.atan2(g.tx, g.tz));
  }
  // --- village along the meadow lane + one loop homestead ---
  const village = [[120, -18], [300, 20], [480, -16], [650, 18]];
  village.forEach(([d, lat], i) => {
    const f = roadFrameOn(lane, d);
    const nx = -f.tz, nz = f.tx;
    const x = f.x + nx * lat, z = f.z + nz * lat;
    const y = getHeight(x, z);
    HOUSES.push({
      x, z, y, yaw: Math.atan2(f.tx, f.tz) + (rnd() - 0.5) * 0.8,
      hw: 3.4 + rnd() * 1.2, hd: 2.8 + rnd() * 1.0,
      wallH: 2.6 + rnd() * 0.5, topY: y + 5.2, tint: rnd(),
    });
  });
  {
    const f = roadFrameOn(loop, 4200);
    const x = f.x + f.tz * 20, z = f.z - f.tx * 20;
    HOUSES.push({
      x, z, y: getHeight(x, z), yaw: Math.atan2(f.tx, f.tz) + 0.4,
      hw: 3.8, hd: 3.0, wallH: 2.7, topY: getHeight(x, z) + 5.4, tint: 0.7,
    });
  }

  buildHouses(scene);
  buildRamps(scene);
  buildBoostPads(scene);
}

function buildHouses(scene) {
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const S = new THREE.Vector3(), P = new THREE.Vector3(), C = new THREE.Color();
  // shared unit parts, instanced across the village
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  wallGeo.translate(0, 0.5, 0);
  const roofGeo = new THREE.CylinderGeometry(1, 1, 1, 3, 1);
  roofGeo.rotateX(Math.PI / 2);
  const winGeo = new THREE.BoxGeometry(1, 0.5, 0.08);
  const chimGeo = new THREE.BoxGeometry(0.5, 1.4, 0.5);
  const walls = new THREE.InstancedMesh(wallGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 }), HOUSES.length);
  const roofs = new THREE.InstancedMesh(roofGeo,
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a3f4a'), roughness: 0.85 }), HOUSES.length);
  const wins = new THREE.InstancedMesh(winGeo,
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#2a2c30'), emissive: new THREE.Color('#ffdf9e'), emissiveIntensity: 0.7, roughness: 0.4 }), HOUSES.length * 2);
  const chims = new THREE.InstancedMesh(chimGeo,
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#6a5a4e'), roughness: 0.9 }), HOUSES.length);
  walls.castShadow = true; walls.receiveShadow = true;
  roofs.castShadow = true;
  const plasters = ['#d8cfc0', '#c9b8a6', '#b9c0c9', '#d0c4b2'].map((c) => new THREE.Color(c));
  HOUSES.forEach((h, i) => {
    const wallH = h.wallH || 3.0, roofH = h.barn ? 1.2 : 1.6;
    E.set(0, h.yaw, 0); Q.setFromEuler(E);
    const W = h.hw * 2, D = h.hd * 2;
    S.set(W, wallH, D); P.set(h.x, h.y - 0.1, h.z);
    M.compose(P, Q, S); walls.setMatrixAt(i, M);
    C.copy(plasters[i % plasters.length]).offsetHSL(0, 0, ((h.tint || 0.5) - 0.5) * 0.08);
    if (h.barn) C.set('#8a4a3a');
    walls.setColorAt(i, C);
    S.set(W * 0.62, roofH, D * 0.5 + 0.5); P.set(h.x, h.y - 0.1 + wallH + roofH * 0.32, h.z);
    M.compose(P, Q, S); roofs.setMatrixAt(i, M);
    // glowing windows on the road face
    for (let k = 0; k < 2; k++) {
      const side = k ? 1 : -1;
      S.set(1.1, 1, 1);
      const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
      P.set(h.x + fx * (D / 2 + 0.02) + -fz * side * W * 0.22, h.y + 1.3, h.z + fz * (D / 2 + 0.02) + fx * side * W * 0.22);
      E.set(0, h.yaw, 0); Q.setFromEuler(E);
      M.compose(P, Q, S); wins.setMatrixAt(i * 2 + k, M);
    }
    S.set(1, 1, 1); P.set(h.x + Math.cos(h.yaw) * W * 0.22, h.y + wallH + 0.4, h.z - Math.sin(h.yaw) * W * 0.22);
    E.set(0, h.yaw, 0); Q.setFromEuler(E);
    M.compose(P, Q, S); chims.setMatrixAt(i, M);
    if (!h.topY) h.topY = h.y + wallH + roofH + 1;
  });
  [walls, roofs, wins, chims].forEach((m) => {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    scene.add(m);
  });
  // stunt barn loft deck (flat, drivable — the roof in ROOFS)
  const barn = HOUSES.find((h) => h.barn);
  if (barn) {
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(barn.hw * 2 + 0.5, 0.3, barn.hd * 2 + 0.5),
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#6a5138'), roughness: 0.9 })
    );
    deck.position.set(barn.x, barn.y + 3.4, barn.z);
    deck.rotation.y = barn.yaw;
    deck.castShadow = true; deck.receiveShadow = true;
    scene.add(deck);
  }
}

function buildRamps(scene) {
  RAMPS.forEach((r) => {
    const g = new THREE.Group();
    // sloped wedge: tilted slab sunk at the lip, flying at the tail
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(r.w, 0.35, Math.hypot(r.len, r.h)),
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#2e2e34'), roughness: 0.85 })
    );
    slab.position.y = r.h / 2 - 0.35;
    slab.rotation.x = -Math.atan2(r.h, r.len);
    slab.castShadow = true; slab.receiveShadow = true;
    g.add(slab);
    // warning chevrons up the face
    const chevMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#111111'), emissive: new THREE.Color('#ffcf1a'),
      emissiveIntensity: 1.4, roughness: 0.5,
    });
    for (let k = 0; k < 3; k++) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(r.w * 0.8, 0.06, 0.5), chevMat);
      const t = 0.25 + k * 0.25;
      stripe.position.set(0, (r.h + 0.1) * t - 0.1, -r.len / 2 + r.len * t);
      stripe.rotation.x = -Math.atan2(r.h, r.len);
      g.add(stripe);
    }
    g.position.set(r.x, r.y, r.z);
    g.rotation.y = r.yaw;
    scene.add(g);
  });
}

function buildBoostPads(scene) {
  BOOSTS.forEach((b) => {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 3.4, 24),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#37e0ff'), transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.12;
    g.add(ring);
    const arrow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 3.2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#bff4ff'), transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
    );
    arrow.rotation.x = -Math.PI / 2;
    arrow.rotation.z = -b.yaw + Math.PI;
    arrow.position.y = 0.14;
    g.add(arrow);
    g.position.set(b.x, b.y, b.z);
    scene.add(g);
    animated.push({ ring, arrow, seed: b.x * 0.13 + b.z * 0.29 });
  });
}

export function tickProps(elapsed) {
  animated.forEach((a) => {
    const p = 0.6 + 0.4 * Math.sin(elapsed * 3 + a.seed);
    a.ring.material.opacity = 0.45 + 0.4 * p;
    a.arrow.material.opacity = 0.5 + 0.4 * p;
  });
}
