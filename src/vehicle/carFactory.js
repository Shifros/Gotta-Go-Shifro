import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { softDisc, microBump, multiplyDisc } from '../utils/textures.js';

// Hyper-detailed procedural GT coupe.
// Layered construction: sculpted hull, lens-covered light units, arches,
// grilles, seams, trim, full interior, multi-piece forged wheels.
export function buildCar() {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const bump = microBump();
  bump.repeat.set(6, 6);
  const paintMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#f2f0ec'),
    metalness: 0.12,
    roughness: 0.3,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.0,
    bumpMap: bump,
    bumpScale: 0.6,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#12161f'),
    metalness: 0.2,
    roughness: 0.05,
    clearcoat: 1,
    transparent: true,
    opacity: 0.96,
    envMapIntensity: 1.5,
  });
  const blackMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#0b0c0e'), roughness: 0.6, metalness: 0.3 });
  const satinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#17181c'), roughness: 0.45, metalness: 0.55 });
  const carbonMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#101114'), roughness: 0.35, metalness: 0.7 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#e2e4e8'), roughness: 0.12, metalness: 1.0 });
  const seamMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#060607'), roughness: 0.8 });

  // ---- Main hull ----
  const s = new THREE.Shape();
  s.moveTo(-2.30, 0.28);
  s.bezierCurveTo(-2.36, 0.55, -2.30, 0.74, -2.08, 0.80);  // tail cut
  s.bezierCurveTo(-1.86, 0.845, -1.62, 0.86, -1.30, 0.90); // decklid
  s.bezierCurveTo(-1.05, 1.00, -0.88, 1.14, -0.55, 1.22);  // C-pillar
  s.bezierCurveTo(-0.25, 1.275, 0.05, 1.28, 0.32, 1.26);   // roof
  s.bezierCurveTo(0.62, 1.235, 0.86, 1.06, 1.08, 0.885);   // windshield
  s.bezierCurveTo(1.42, 0.83, 1.80, 0.795, 2.10, 0.68);    // hood
  s.bezierCurveTo(2.30, 0.60, 2.36, 0.44, 2.26, 0.30);     // nose
  s.bezierCurveTo(2.20, 0.20, 2.05, 0.17, 1.80, 0.165);    // splitter line
  s.lineTo(-1.75, 0.15);
  s.bezierCurveTo(-2.05, 0.155, -2.26, 0.19, -2.30, 0.28);

  const hullGeo = new THREE.ExtrudeGeometry(s, {
    depth: 1.66, bevelEnabled: true, bevelThickness: 0.13, bevelSize: 0.12,
    bevelSegments: 6, steps: 1, curveSegments: 24,
  });
  hullGeo.translate(0, 0, -0.83);
  hullGeo.computeVertexNormals();
  const hull = new THREE.Mesh(hullGeo, paintMat);
  hull.rotation.y = -Math.PI / 2;
  hull.castShadow = true; hull.receiveShadow = true;
  body.add(hull);

  // ---- Glasshouse ----
  const g = new THREE.Shape();
  g.moveTo(-1.42, 0.895);
  g.bezierCurveTo(-1.10, 1.00, -0.82, 1.20, -0.42, 1.235);
  g.bezierCurveTo(-0.05, 1.255, 0.28, 1.235, 0.58, 1.10);
  g.bezierCurveTo(0.78, 1.00, 0.92, 0.93, 1.00, 0.885);
  g.lineTo(0.90, 0.855);
  g.bezierCurveTo(0.70, 0.98, 0.30, 1.16, -0.20, 1.165);
  g.bezierCurveTo(-0.65, 1.16, -0.98, 1.00, -1.32, 0.865);
  g.lineTo(-1.42, 0.895);
  const glassGeo = new THREE.ExtrudeGeometry(g, {
    depth: 1.46, bevelEnabled: true, bevelThickness: 0.055, bevelSize: 0.055,
    bevelSegments: 4, curveSegments: 20,
  });
  glassGeo.translate(0, 0, -0.73);
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.rotation.y = -Math.PI / 2;
  glass.position.y = 0.012;
  body.add(glass);

  // B-pillars (blades over the glass) + chrome beltline
  [-0.86, 0.86].forEach(x => {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, 0.14), satinMat);
    pillar.position.set(x, 1.06, -0.28); pillar.rotation.x = 0.28;
    body.add(pillar);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, 2.1), chromeMat);
    belt.position.set(x > 0 ? 0.87 : -0.87, 0.895, -0.1);
    body.add(belt);
  });

  // Windshield wipers
  [-0.25, 0.25].forEach(x => {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.015, 0.55), blackMat);
    w.position.set(x, 0.905, 0.72); w.rotation.y = x > 0 ? -0.35 : 0.15; w.rotation.x = -0.42;
    body.add(w);
  });

  // Roof fin antenna
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.14, 4), paintMat);
  fin.position.set(0, 1.33, -0.55); fin.rotation.y = Math.PI / 4; fin.scale.z = 1.8;
  body.add(fin);

  // ---- Wheel-arch liners (dark wells so wheels read properly) ----
  const archGeo = new THREE.TorusGeometry(0.44, 0.10, 10, 20, Math.PI);
  [[-0.92, 1.42], [0.92, 1.42], [-0.92, -1.42], [0.92, -1.42]].forEach(([x, z]) => {
    const arch = new THREE.Mesh(archGeo, blackMat);
    arch.position.set(x, 0.34, z);
    arch.rotation.y = Math.PI / 2;
    body.add(arch);
  });

  // ---- Front face ----
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.20, 0.12), blackMat);
  grille.position.set(0, 0.42, 2.30); body.add(grille);
  for (let i = 0; i < 3; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.022, 0.02), chromeMat);
    slat.position.set(0, 0.36 + i * 0.06, 2.365); body.add(slat);
  }
  const intakeL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.14), blackMat);
  intakeL.position.set(-0.62, 0.30, 2.28); body.add(intakeL);
  const intakeR = intakeL.clone(); intakeR.position.x = 0.62; body.add(intakeR);
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.06, 0.40), carbonMat);
  splitter.position.set(0, 0.145, 2.22); splitter.castShadow = true; body.add(splitter);

  // Headlight units: dark housing + clear lens + LED blade + projector
  const lensMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#aebdd0'), roughness: 0.05, metalness: 0,
    transparent: true, opacity: 0.45, clearcoat: 1, envMapIntensity: 1.5,
  });
  const ledMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#e8f0ff'), emissive: new THREE.Color('#d8e8ff'),
    emissiveIntensity: 3.0, roughness: 0.3,
  });
  const projMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#ffffff'), emissive: new THREE.Color('#fff4d8'),
    emissiveIntensity: 2.2, roughness: 0.2,
  });
  [-1, 1].forEach(sd => {
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.13, 0.16), blackMat);
    housing.position.set(sd * 0.58, 0.64, 2.26);
    housing.rotation.y = sd * -0.16;
    body.add(housing);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.035, 0.03), ledMat);
    blade.position.set(sd * 0.58, 0.665, 2.345);
    blade.rotation.y = sd * -0.16;
    body.add(blade);
    const proj = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.05, 14), projMat);
    proj.rotation.x = Math.PI / 2;
    proj.position.set(sd * 0.58, 0.60, 2.34);
    body.add(proj);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.12, 0.03), lensMat);
    lens.position.set(sd * 0.58, 0.635, 2.355);
    lens.rotation.y = sd * -0.16;
    body.add(lens);
  });

  // ---- Rear ----
  const tailLensMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#7a0e16'), roughness: 0.12, metalness: 0.1,
    transparent: true, opacity: 0.85, clearcoat: 1,
    emissive: new THREE.Color('#ff1a26'), emissiveIntensity: 0.55,
  });
  const tailGlowMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#3a0a0e'), emissive: new THREE.Color('#ff1a26'),
    emissiveIntensity: 1.8, roughness: 0.3,
  });
  [-1, 1].forEach(sd => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.085, 0.05), tailGlowMat);
    bar.position.set(sd * 0.44, 0.76, -2.335);
    bar.rotation.y = sd * 0.10;
    body.add(bar);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.80, 0.10, 0.03), tailLensMat);
    lens.position.set(sd * 0.44, 0.76, -2.36);
    lens.rotation.y = sd * 0.10;
    body.add(lens);
  });
  const revMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#dfe4ea'), emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.15,
  });
  [-1, 1].forEach(sd => {
    const rv = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.03), revMat);
    rv.position.set(sd * 0.30, 0.62, -2.365); body.add(rv);
  });
  const emblem = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 10, 28), chromeMat);
  emblem.position.set(0, 0.60, -2.375); body.add(emblem);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.115),
    new THREE.MeshStandardMaterial({ color: 0xf0f0ea, roughness: 0.45 }));
  plate.position.set(0, 0.44, -2.378); plate.rotation.y = Math.PI; body.add(plate);

  // Diffuser with fins + exhausts
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.20, 0.30), carbonMat);
  diffuser.position.set(0, 0.235, -2.28); body.add(diffuser);
  for (let i = -2; i <= 2; i++) {
    const finM = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.26), blackMat);
    finM.position.set(i * 0.22, 0.20, -2.30); body.add(finM);
  }
  [-1, 1].forEach(sd => {
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.062, 0.18, 18), chromeMat);
    tip.rotation.x = Math.PI / 2; tip.position.set(sd * 0.52, 0.21, -2.40);
    body.add(tip);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.19, 14), blackMat);
    inner.rotation.x = Math.PI / 2; inner.position.set(sd * 0.52, 0.21, -2.40);
    body.add(inner);
  });

  // ---- Side sculpting ----
  const skirtGeo = new THREE.BoxGeometry(0.14, 0.11, 2.45);
  [-0.94, 0.94].forEach(x => {
    const sk = new THREE.Mesh(skirtGeo, carbonMat);
    sk.position.set(x, 0.185, 0); sk.castShadow = true; body.add(sk);
  });
  // door seams + handles + mirror indicators
  [-1, 1].forEach(sd => {
    const x = sd * 0.955;
    const seamF = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.52, 0.02), seamMat);
    seamF.position.set(x, 0.58, 0.62); seamF.rotation.x = -0.12; body.add(seamF);
    const seamR = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.55, 0.02), seamMat);
    seamR.position.set(x, 0.58, -0.85); seamR.rotation.x = 0.14; body.add(seamR);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.032, 0.26), satinMat);
    handle.position.set(sd * 0.96, 0.83, -0.28); body.add(handle);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.03, 0.05), paintMat);
    arm.position.set(sd * 1.0, 0.97, 0.80); body.add(arm);
    const capM = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.10, 0.19), paintMat);
    capM.position.set(sd * 1.09, 1.015, 0.80); capM.castShadow = true; body.add(capM);
    const ind = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, 0.10),
      new THREE.MeshStandardMaterial({ color: 0x301a00, emissive: 0xff8c1a, emissiveIntensity: 1.2 }));
    ind.position.set(sd * 1.17, 1.015, 0.80); body.add(ind);
    const mir = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.075),
      new THREE.MeshStandardMaterial({ color: 0xaac0dd, roughness: 0.04, metalness: 1 }));
    mir.position.set(sd * 1.09, 1.015, 0.70); mir.rotation.y = Math.PI; body.add(mir);
  });

  // ---- Interior ----
  const intMat = new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.9 });
  const leatherMat = new THREE.MeshStandardMaterial({ color: 0x1d1e24, roughness: 0.75 });
  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.20, 0.42), intMat);
  dash.position.set(0, 0.88, 0.72); body.add(dash);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x0a0f18, emissive: 0x2a4a6a, emissiveIntensity: 0.9 }));
  screen.position.set(0, 0.93, 0.52); screen.rotation.x = -0.35; screen.rotation.y = Math.PI; body.add(screen);
  [[-0.38], [0.38]].forEach(([x]) => {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.20, 0.52), leatherMat);
    base.position.set(x, 0.60, -0.18); body.add(base);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.17), leatherMat);
    back.position.set(x, 0.95, -0.48); back.rotation.x = -0.17; body.add(back);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.10), leatherMat);
    head.position.set(x, 1.30, -0.55); body.add(head);
  });
  const swheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.026, 8, 22), intMat);
  swheel.position.set(-0.38, 0.92, 0.44); swheel.rotation.x = -0.5; body.add(swheel);

  // Undertray (blocks see-through under the car)
  const tray = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 4.2), blackMat);
  tray.rotation.x = -Math.PI / 2; tray.position.y = 0.12; body.add(tray);

  // ---- Wheels: low-profile tire + lip + split spokes + drilled disc ----
  const tireMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#121214'), roughness: 0.94 });
  const rimMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#cfd2d8'), roughness: 0.24, metalness: 0.95 });
  const darkRimMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2a2c31'), roughness: 0.4, metalness: 0.8 });
  const discMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#84878e'), roughness: 0.42, metalness: 0.9 });
  const calMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#b01818'), roughness: 0.45 });

  function makeWheel() {
    const steer = new THREE.Group();
    const spin = new THREE.Group();
    steer.add(spin);
    const tireGeo = new THREE.CylinderGeometry(0.345, 0.345, 0.26, 30);
    tireGeo.rotateZ(Math.PI / 2);
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.castShadow = true;
    spin.add(tire);
    // tread banding (alternating grooves catch sunset light)
    for (let i = 0; i < 3; i++) {
      const groove = new THREE.Mesh(new THREE.TorusGeometry(0.345, 0.008, 6, 30), darkRimMat);
      groove.rotation.y = Math.PI / 2;
      groove.position.x = -0.07 + i * 0.07;
      spin.add(groove);
    }
    // rim lip + barrel
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.028, 10, 26), rimMat);
    lip.rotation.y = Math.PI / 2; lip.position.x = 0.115; spin.add(lip);
    const lip2 = lip.clone(); lip2.position.x = -0.115; spin.add(lip2);
    const barrelGeo = new THREE.CylinderGeometry(0.20, 0.20, 0.24, 20);
    barrelGeo.rotateZ(Math.PI / 2);
    spin.add(new THREE.Mesh(barrelGeo, darkRimMat));
    // 5 split spokes (10 blades)
    for (let i = 0; i < 10; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.05, 0.062), rimMat);
      spoke.rotation.x = (i / 10) * Math.PI * 2 + 0.31 * (i % 2);
      spin.add(spoke);
    }
    const capGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.27, 12);
    capGeo.rotateZ(Math.PI / 2);
    spin.add(new THREE.Mesh(capGeo, darkRimMat));
    // brake disc + caliper
    const discGeo = new THREE.CylinderGeometry(0.155, 0.155, 0.20, 20);
    discGeo.rotateZ(Math.PI / 2);
    spin.add(new THREE.Mesh(discGeo, discMat));
    const cal = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.17, 0.09), calMat);
    cal.position.set(0, 0.10, -0.13);
    steer.add(cal);
    return { steer, spin };
  }

  const FL = makeWheel(), FR = makeWheel(), RL = makeWheel(), RR = makeWheel();
  FL.steer.position.set(-0.92, 0.345, 1.42);
  FR.steer.position.set(0.92, 0.345, 1.42);
  RL.steer.position.set(-0.92, 0.345, -1.42);
  RR.steer.position.set(0.92, 0.345, -1.42);
  group.add(FL.steer, FR.steer, RL.steer, RR.steer);

  // ---- Contact shadow: multiply-blend darkener, reads on any surface ----
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 6.0),
    new THREE.MeshBasicMaterial({ map: multiplyDisc(70), transparent: true, depthWrite: false, blending: THREE.MultiplyBlending })
  );
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.05;
  blob.renderOrder = 1;
  group.add(blob);
  // tight dark core directly under the chassis — kills the floating look
  const core = new THREE.Mesh(
    new THREE.PlaneGeometry(2.3, 4.4),
    new THREE.MeshBasicMaterial({ map: multiplyDisc(15), transparent: true, depthWrite: false, blending: THREE.MultiplyBlending })
  );
  core.rotation.x = -Math.PI / 2; core.position.y = 0.045;
  core.renderOrder = 2;
  group.add(core);

  function setPaint(hexColor) {
    paintMat.color.set(hexColor);
  }
  function setLights(on) {
    // Emissive lenses only — no spot/beam lights anywhere in the scene.
    ledMat.emissiveIntensity = on ? 3.0 : 0.3;
    projMat.emissiveIntensity = on ? 2.2 : 0.2;
  }
  function setReverse(on) {
    revMat.emissiveIntensity = on ? 2.5 : 0.15;
  }

  return {
    group, body, paintMat,
    wheels: { FL, FR, RL, RR },
    headlights: [],
    brakeMat: tailGlowMat,
    setPaint, setLights, setReverse,
  };
}

// Real film-quality coupe (generic_sport_coupe_car.glb) as the player car.
// Auto-orients (headlights → +Z), auto-scales to 4.5 m, grounds at y = 0,
// and re-rigs the 4 named wheel assemblies for steering + spin.
export async function buildCoupeCar() {
  const base = import.meta.env.BASE_URL || '/';
  const gltf = await new GLTFLoader().loadAsync(base + 'cars/sport_coupe_r26.glb');
  const model = gltf.scene;
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  body.add(model);

  const paintMats = new Set(), brakeMats = new Set(), headMats = new Set();
  const paintMeshes = new Set();
  const tmpV = new THREE.Vector3();
  const box = new THREE.Box3();

  // Definitive boot census: node/mesh counts, name sample, native size.
  {
    let nNodes = 0, nMesh = 0;
    const samp = [];
    model.traverse((o) => {
      nNodes++;
      if (o.isMesh) nMesh++;
      if (samp.length < 10) samp.push(o.type + ':' + (o.name || '(noname)'));
    });
    const b0 = new THREE.Box3().setFromObject(model);
    const s0 = b0.getSize(new THREE.Vector3());
    console.info('[coupe] nodes:', nNodes, 'meshes:', nMesh,
      'native:', s0.x.toFixed(2) + 'x' + s0.y.toFixed(2) + 'x' + s0.z.toFixed(2),
      'e.g.', samp.join(' | '));
  }

  const collect = () => {
    paintMats.clear(); brakeMats.clear(); headMats.clear();
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      const nmd = (o.name || '').toLowerCase();
      const isHeadMesh = nmd.includes('headlight') || nmd.includes('headlamp') || nmd.includes('drl');
      const isTailMesh = nmd.includes('taillight') || nmd.includes('tail-light') || nmd.includes('rear-lamp');
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        const nm = (m.name || '').toLowerCase();
        if (nm.includes('car-body') || nm.includes('car_body') || nm.includes('carpaint') || nm === 'paint') {
          paintMats.add(m);
          if (o.isMesh) paintMeshes.add(o);
        }
        if (isTailMesh) {
          brakeMats.add(m);
          if (m.emissive && m.emissive.getHex() === 0) m.emissive.setRGB(0.55, 0.03, 0.03);
        }
        if (isHeadMesh) {
          headMats.add(m);
          if (m.emissive && m.emissive.getHex() === 0) m.emissive.setRGB(0.85, 0.9, 1.0);
        }
      });
    });
  };
  // (orientation measured inline below — closed loop)

// Manual orientation override (radians) — applied after auto-detection.
const COUPE_YAW = 0;

  // Full filtered name dump: settles every naming question in one line.
  {
    const dump = [];
    model.traverse((o) => {
      const nm = (o.name || '').toLowerCase();
      if (/wheel|tire|tyre|rim|hub|light|lamp|drl|exhaust|muffler|paint|glass|car-body|brake|caliper|door|mirror|arch|grille|bumper/.test(nm)) {
        if (dump.length < 80) dump.push((o.isMesh ? 'M:' : 'G:') + o.name);
      }
    });
    console.info('[coupe] names(' + dump.length + '):', dump.join(' | '));
    // Unique materials + base colors: paint matching without guessing.
    const seenM = new Map();
    model.traverse((o) => {
      if (!o.isMesh) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        if (!seenM.has(m.name)) {
          let bc = '?';
          try { bc = m.color ? '#' + m.color.getHexString() : 'nocolor'; } catch (e) { /* noop */ }
          seenM.set(m.name, bc + (m.map ? '+MAP' : ''));
        }
      });
    });
    console.info('[coupe] materials(' + seenM.size + '):',
      [...seenM.entries()].map(([k, v]) => k + '=' + v).join(' | '));
  }

  // 1-2. Orient: length onto Z, headlights toward +Z, exhausts toward -Z.
  // Measure → rotate → RE-MEASURE → correct again: closed loop, plus log.
  model.rotation.set(0, 0, 0);
  const measure = () => {
    model.updateMatrixWorld(true);
    box.setFromObject(model);
    const sz = box.getSize(new THREE.Vector3());
    let hx = 0, hz = 0, hn = 0, tx = 0, tz = 0, tn = 0, ex = 0, ez = 0, en = 0;
    model.traverse((o) => {
      if (!o.isMesh) return;
      const nm = (o.name || '').toLowerCase();
      o.updateWorldMatrix(true, false);
      tmpV.setFromMatrixPosition(o.matrixWorld);
      if (nm.includes('headlight') || nm.includes('headlamp') || nm.includes('drl')) { hx += tmpV.x; hz += tmpV.z; hn++; }
      else if (nm.includes('taillight') || nm.includes('tail-light') || nm.includes('tail_light') || nm.includes('rear-lamp')) { tx += tmpV.x; tz += tmpV.z; tn++; }
      else if (nm.includes('exhaust') || nm.includes('muffler')) { ex += tmpV.x; ez += tmpV.z; en++; }
    });
    return { sz, hx, hz, hn, tx, tz, tn, ex, ez, en };
  };
  let mm = measure();
  if (mm.sz.x >= mm.sz.z) model.rotation.y = Math.PI / 2;
  mm = measure();
  if (mm.hn > 0 && mm.tn > 0 && mm.hz / mm.hn < mm.tz / mm.tn) model.rotation.y += Math.PI;
  mm = measure();
  // verify: if headlights STILL trail taillights, flip back — converges correct
  if (mm.hn > 0 && mm.tn > 0 && mm.hz / mm.hn < mm.tz / mm.tn) model.rotation.y += Math.PI;
  model.rotation.y += COUPE_YAW;
  mm = measure();
  // independent second cue: exhausts must sit behind (z < 0)
  if (mm.en > 0 && mm.ez / mm.en > 0.3) model.rotation.y += Math.PI;
  mm = measure();
  // FINAL ARBITER (baked geometry truth, not node transforms): the hood
  // mesh must sit ahead of the trunk mesh. Both names verified in the dump.
  {
    let hood = null, trunk = null;
    model.traverse((o) => {
      if (!o.isMesh) return;
      const nm = (o.name || '').toLowerCase();
      if (!hood && nm.includes('hood')) hood = o;
      if (!trunk && nm.includes('trunk')) trunk = o;
    });
    if (hood && trunk) {
      const hb = new THREE.Box3().setFromObject(hood);
      const tb2 = new THREE.Box3().setFromObject(trunk);
      const hz = (hb.min.z + hb.max.z) / 2, tz = (tb2.min.z + tb2.max.z) / 2;
      console.info('[coupe] arbiter hoodZ=', +hz.toFixed(2), 'trunkZ=', +tz.toFixed(2));
      if (hz < tz) model.rotation.y += Math.PI;
      mm = measure();
    }
  }
  console.info('[coupe] yaw=', +model.rotation.y.toFixed(3),
    'size=', mm.sz.x.toFixed(2) + 'x' + mm.sz.z.toFixed(2),
    'head_n=', mm.hn, 'headZ=', (mm.hz / Math.max(1, mm.hn)).toFixed(2),
    'tail_n=', mm.tn, 'tailZ=', (mm.tz / Math.max(1, mm.tn)).toFixed(2),
    'exh_n=', mm.en, 'exhaustZ=', (mm.ez / Math.max(1, mm.en)).toFixed(2));
  // 3. Scale to a 4.5 m coupe.
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const len = Math.max(size.x, size.z);
  model.scale.multiplyScalar(4.5 / Math.max(0.1, len));
  // 4. Ground at y = 0.
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  model.position.y -= box.min.y;
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  const L = Math.max(size.x, size.z) * (4.5 / Math.max(0.1, len));
  const W = Math.min(size.x, size.z) * (4.5 / Math.max(0.1, len));
  collect();

  // 5. Wheels: proportion hubs + torus-filtered pile hardware. Parts already
  // at the corners are never touched; origin-piled spares get relocated.
  group.updateMatrixWorld(true);
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  const carC = box.getCenter(new THREE.Vector3());
  const carMinY = box.min.y;
  const carLen = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
  const carWid = Math.min(box.max.x - box.min.x, box.max.z - box.min.z);
  const wheels = {};
  const tb = new THREE.Box3(), tc = new THREE.Vector3(), ts = new THREE.Vector3();
  const worldBox = (o) => { tb.setFromObject(o); return tb; };

  // 5a. Pile: small roundish parts stacked near the car center (unplaced rig
  // spares). Correctly placed corner hardware is automatically excluded.
  const pile = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    worldBox(o).getSize(ts); worldBox(o).getCenter(tc);
    const maxD = Math.max(ts.x, ts.y, ts.z);
    const hd = Math.hypot(tc.x - carC.x, tc.z - carC.z);
    if (maxD > 0.35 && maxD < 1.05 && tc.y < 0.65 && hd < 1.3) {
      pile.push({ o, vol: ts.x * ts.y * ts.z });
    }
  });
  pile.sort((a, b) => b.vol - a.vol);

  // 5b. Hubs: PURE body proportions — deterministic, symmetric, no arch
  // roulette. (±0.31L, wheelR, ±(W/2−0.30) matches the design's own hubs.)
  // wheel radius from the biggest torus-filtered pile part (or default)
  let wheelR = 0.36;
  const torus = [];
  {
    const pb = new THREE.Box3(), pc = new THREE.Vector3(), ps = new THREE.Vector3();
    pile.forEach((p) => {
      pb.setFromObject(p.o); pb.getSize(ps); pb.getCenter(pc);
      const d = [ps.x, ps.y, ps.z].sort((a, b) => a - b);
      if (d[2] > 0.5 && d[2] < 1.05 && d[0] > 0.18 && d[0] < 0.5 &&
          Math.abs(d[1] - d[2]) < 0.3 && pc.y < 0.65) torus.push(p);
    });
    torus.sort((a, b) => b.vol - a.vol);
    if (torus.length) {
      tb.setFromObject(torus[0].o); tb.getSize(ts);
      wheelR = Math.max(0.25, Math.min(0.45, ts.y / 2));
    }
  }
  // Hubs: track on X, wheelbase on Z. (±0.84, ±1.4 on this car — the
  // design's own tire coordinates. Transposing these parks wheels
  // outboard of the body, which is exactly the freakshow we just saw.)
  const hubFor = (qx, qz) => new THREE.Vector3(
    carC.x + qx * (carWid / 2 - 0.22), wheelR + carMinY, carC.z + qz * 0.31 * carLen);
  const carAxle = (box.max.x - box.min.x) <= (box.max.z - box.min.z) ? 'x' : 'z';
  const wheelLog = [];
  // Pair-split by HALVES: volume-sorted pile is [tires…, rims…], so each
  // hub takes bigs[i] + smalls[i] = one tire + one rim. (Even/odd split
  // deals tire+tire to the front and rim+rim to the rear — the exact bug
  // we just saw.)
  const half = Math.ceil(torus.length / 2);
  const bigs = torus.slice(0, half);
  const smalls = torus.slice(half);
  [['FL', -1, 1], ['FR', 1, 1], ['RL', -1, -1], ['RR', 1, -1]].forEach(([key, qx, qz], wi) => {
    const steer = new THREE.Group();
    const spin = new THREE.Group();
    steer.add(spin);
    group.add(steer);
    const H = hubFor(qx, qz);
    group.worldToLocal(H);
    steer.position.copy(H);
    // pair-split: each hub gets one big + one small (tire + rim). If the
    // pile is empty (sane file), nothing moves and placed wheels stay put.
    const claimed = [];
    if (bigs[wi]) claimed.push(bigs[wi].o);
    if (smalls[wi]) claimed.push(smalls[wi].o);
    claimed.forEach((m) => {
      // rigid translate: part CENTER → hub, orientation untouched.
      // (Resetting position/rotation destroys baked offsets — the old bug
      // that parked tires on the roof.)
      spin.attach(m);
      // Stand the part up: its WORLD thin axis must end up on the car axle.
      // (Flat-lying spares arrive axle-vertical; upright ones pass through.)
      const wb = new THREE.Box3().setFromObject(m);
      const ws = wb.getSize(new THREE.Vector3());
      let wa = 'x';
      if (ws.y <= ws.x && ws.y <= ws.z) wa = 'y';
      else if (ws.z <= ws.x && ws.z <= ws.y) wa = 'z';
      if (wa !== carAxle) {
        if (wa === 'y') {
          if (carAxle === 'x') m.rotateZ(Math.PI / 2);
          else m.rotateX(Math.PI / 2);
        } else {
          m.rotateY(Math.PI / 2);
        }
        m.updateWorldMatrix(true, false);
      }
      const pb = new THREE.Box3().setFromObject(m);
      const pc = pb.getCenter(new THREE.Vector3());
      const d = new THREE.Vector3().subVectors(H, pc);
      m.position.add(d);
      const tm = m.material;
      (Array.isArray(tm) ? tm : [tm]).forEach((t) => {
        if (t && 'roughness' in t) t.roughness = 0.95;
      });
    });
    wheels[key] = { steer, spin, axis: carAxle };
    // audit: spin-content center vs hub (group is identity at build, so
    // rig-local H compares directly against world centers)
    const ab = new THREE.Box3().setFromObject(spin);
    const ac = ab.getCenter(new THREE.Vector3());
    const res = Math.hypot(ac.x - H.x, ac.y - H.y, ac.z - H.z);
    wheelLog.push(`${key}@${H.toArray().map((v) => +v.toFixed(2)).join(',')}x${claimed.length}/${carAxle}/res=${res.toFixed(2)}`);
  });
  console.info('[coupe] wheels:', wheelLog.join(' '), 'r=', +wheelR.toFixed(3), 'pile=', pile.length);

  // Contact shadows sized to the measured car (kept tight: blob + shadow
  // stacking reads as one black slab otherwise).
  const blobTexA = multiplyDisc(70), blobTexB = multiplyDisc(50);
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(W + 1.0, L + 0.8),
    new THREE.MeshBasicMaterial({ map: blobTexA, transparent: true, depthWrite: false, blending: THREE.MultiplyBlending })
  );
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.05;
  blob.renderOrder = 1;
  group.add(blob);
  const core = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 0.8, L * 0.72),
    new THREE.MeshBasicMaterial({ map: blobTexB, transparent: true, depthWrite: false, blending: THREE.MultiplyBlending })
  );
  core.rotation.x = -Math.PI / 2; core.position.y = 0.045;
  core.renderOrder = 2;
  group.add(core);

  // Real headlight beams for the night (no shadows: pure illumination).
  const beamL = new THREE.SpotLight(0xcfe0ff, 0, 120, 0.5, 0.6, 1.4);
  const beamR = new THREE.SpotLight(0xcfe0ff, 0, 120, 0.5, 0.6, 1.4);
  beamL.position.set(-0.58, 0.64, 2.2); beamR.position.set(0.58, 0.64, 2.2);
  const tgtL = new THREE.Object3D(); tgtL.position.set(-1.8, 0.0, 26);
  const tgtR = new THREE.Object3D(); tgtR.position.set(1.8, 0.0, 26);
  group.add(beamL, beamR, tgtL, tgtR);
  beamL.target = tgtL; beamR.target = tgtR;

  // Premium paint: ONE shared clearcoat physical material across every
  // single-material body panel — showroom reflections of the live valley.
  const paintMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#f2f0ec'),
    metalness: 0.15,
    roughness: 0.28,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.35,
  });
  paintMeshes.forEach((o) => {
    if (!Array.isArray(o.material)) o.material = paintMat;
  });
  const setPaint = (hex) => {
    paintMat.color.set(hex);
    paintMats.forEach((m) => m.color && m.color.set(hex));
  };
  setPaint('#14171e'); // black default
  const setLights = (on) => {
    headMats.forEach((m) => { if ('emissiveIntensity' in m) m.emissiveIntensity = on ? 2.4 : 0.25; });
    beamL.intensity = beamR.intensity = on ? 90 : 0;
  };
  const setReverse = () => {};
  const brakeMat = {
    _mats: [...brakeMats],
    _i: 1.6,
    get emissiveIntensity() { return this._i; },
    set emissiveIntensity(v) {
      this._i = v;
      this._mats.forEach((m) => { if ('emissiveIntensity' in m) m.emissiveIntensity = v; });
    },
  };
  return { group, body, paintMat, wheels, brakeMat, setPaint, setLights, setReverse, wheelR };
}

// Mid-poly traffic car: the hero silhouette (extruded hull, glasshouse,
// arches, LED bars, forged-style wheels) with all geometry shared across
// every NPC and zero spotlights — ~26 meshes each, wheels actually spin.
let trafficCache = null;
function trafficAssets() {
  if (trafficCache) return trafficCache;
  const s = new THREE.Shape();
  s.moveTo(-2.30, 0.28);
  s.bezierCurveTo(-2.36, 0.55, -2.30, 0.74, -2.08, 0.80);
  s.bezierCurveTo(-1.86, 0.845, -1.62, 0.86, -1.30, 0.90);
  s.bezierCurveTo(-1.05, 1.00, -0.88, 1.14, -0.55, 1.22);
  s.bezierCurveTo(-0.25, 1.275, 0.05, 1.28, 0.32, 1.26);
  s.bezierCurveTo(0.62, 1.235, 0.86, 1.06, 1.08, 0.885);
  s.bezierCurveTo(1.42, 0.83, 1.80, 0.795, 2.10, 0.68);
  s.bezierCurveTo(2.30, 0.60, 2.36, 0.44, 2.26, 0.30);
  s.bezierCurveTo(2.20, 0.20, 2.05, 0.17, 1.80, 0.165);
  s.lineTo(-1.75, 0.15);
  s.bezierCurveTo(-2.05, 0.155, -2.26, 0.19, -2.30, 0.28);
  const hullGeo = new THREE.ExtrudeGeometry(s, {
    depth: 1.66, bevelEnabled: true, bevelThickness: 0.13, bevelSize: 0.12,
    bevelSegments: 3, steps: 1, curveSegments: 12,
  });
  hullGeo.translate(0, 0, -0.83);
  hullGeo.computeVertexNormals();

  const g = new THREE.Shape();
  g.moveTo(-1.42, 0.895);
  g.bezierCurveTo(-1.10, 1.00, -0.82, 1.20, -0.42, 1.235);
  g.bezierCurveTo(-0.05, 1.255, 0.28, 1.235, 0.58, 1.10);
  g.bezierCurveTo(0.78, 1.00, 0.92, 0.93, 1.00, 0.885);
  g.lineTo(0.90, 0.855);
  g.bezierCurveTo(0.70, 0.98, 0.30, 1.16, -0.20, 1.165);
  g.bezierCurveTo(-0.65, 1.16, -0.98, 1.00, -1.32, 0.865);
  g.lineTo(-1.42, 0.895);
  const glassGeo = new THREE.ExtrudeGeometry(g, {
    depth: 1.46, bevelEnabled: true, bevelThickness: 0.055, bevelSize: 0.055,
    bevelSegments: 2, curveSegments: 10,
  });
  glassGeo.translate(0, 0, -0.73);

  // one merged silver wheel face + one dark barrel, shared by all wheels
  const silver = [];
  const lipA = new THREE.TorusGeometry(0.205, 0.028, 8, 20);
  lipA.rotateY(Math.PI / 2); lipA.translate(0.115, 0, 0); silver.push(lipA);
  const lipB = new THREE.TorusGeometry(0.205, 0.028, 8, 20);
  lipB.rotateY(Math.PI / 2); lipB.translate(-0.115, 0, 0); silver.push(lipB);
  for (let i = 0; i < 5; i++) {
    const sp = new THREE.BoxGeometry(0.25, 0.06, 0.12);
    sp.rotateX((i / 5) * Math.PI * 2);
    silver.push(sp);
  }
  const cap = new THREE.CylinderGeometry(0.055, 0.055, 0.27, 10);
  cap.rotateZ(Math.PI / 2); silver.push(cap);
  const silverGeo = mergeGeometries(silver);
  const barrel = new THREE.CylinderGeometry(0.20, 0.20, 0.24, 14);
  barrel.rotateZ(Math.PI / 2);
  const disc = new THREE.CylinderGeometry(0.15, 0.15, 0.20, 12);
  disc.rotateZ(Math.PI / 2);
  const darkGeo = mergeGeometries([barrel, disc]);
  const tireGeo = new THREE.CylinderGeometry(0.345, 0.345, 0.26, 22);
  tireGeo.rotateZ(Math.PI / 2);

  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  trafficCache = {
    hullGeo, glassGeo, silverGeo, darkGeo, tireGeo,
    housingGeo: box(0.58, 0.13, 0.16),
    bladeGeo: box(0.5, 0.035, 0.03),
    tailGeo: box(0.78, 0.085, 0.05),
    grilleGeo: box(1.15, 0.20, 0.12),
    splitterGeo: box(1.86, 0.06, 0.40),
    diffuserGeo: box(1.55, 0.20, 0.30),
    mirrorGeo: box(0.15, 0.10, 0.19),
    plateGeo: new THREE.PlaneGeometry(0.44, 0.115),
    archGeo: new THREE.TorusGeometry(0.44, 0.10, 8, 14, Math.PI),
    exhaustGeo: (() => { const e = new THREE.CylinderGeometry(0.058, 0.062, 0.18, 12); e.rotateX(Math.PI / 2); return e; })(),
    tireMat: new THREE.MeshStandardMaterial({ color: new THREE.Color('#121214'), roughness: 0.94 }),
    rimMat: new THREE.MeshStandardMaterial({ color: new THREE.Color('#cfd2d8'), roughness: 0.3, metalness: 0.9 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: new THREE.Color('#2a2c31'), roughness: 0.45, metalness: 0.8 }),
    glassMat: new THREE.MeshStandardMaterial({ color: new THREE.Color('#10141c'), roughness: 0.08, metalness: 0.2, envMapIntensity: 1.2 }),
    blackMat: new THREE.MeshStandardMaterial({ color: new THREE.Color('#0b0c0e'), roughness: 0.6, metalness: 0.3 }),
    chromeMat: new THREE.MeshStandardMaterial({ color: new THREE.Color('#e2e4e8'), roughness: 0.15, metalness: 1.0 }),
    headMat: new THREE.MeshStandardMaterial({ color: new THREE.Color('#e8f0ff'), emissive: new THREE.Color('#d8e8ff'), emissiveIntensity: 2.6, roughness: 0.3 }),
    tailMat: new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a0a0e'), emissive: new THREE.Color('#ff1a26'), emissiveIntensity: 1.6, roughness: 0.3 }),
    plateMat: new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5 }),
    blobGeo: new THREE.PlaneGeometry(3.6, 6.0),
    blobMat: new THREE.MeshBasicMaterial({ map: multiplyDisc(70), transparent: true, depthWrite: false, blending: THREE.MultiplyBlending }),
    coreGeo: new THREE.PlaneGeometry(2.3, 4.4),
    coreMat: new THREE.MeshBasicMaterial({ map: multiplyDisc(15), transparent: true, depthWrite: false, blending: THREE.MultiplyBlending }),
  };
  return trafficCache;
}

export function buildGhostCar(color = '#9aa2b8') {
  const A = trafficAssets();
  const grp = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color), metalness: 0.15, roughness: 0.35,
    clearcoat: 0.8, clearcoatRoughness: 0.15, envMapIntensity: 1.0,
  });
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    grp.add(m);
    return m;
  };
  const hull = add(A.hullGeo, paint, 0, 0.02, 0);
  hull.rotation.y = -Math.PI / 2;
  hull.castShadow = true;
  const glass = add(A.glassGeo, A.glassMat, 0, 0.032, 0);
  glass.rotation.y = -Math.PI / 2;
  add(A.grilleGeo, A.blackMat, 0, 0.42, 2.30);
  add(A.splitterGeo, A.blackMat, 0, 0.145, 2.22);
  [-1, 1].forEach((sd) => {
    const h = add(A.housingGeo, A.blackMat, sd * 0.58, 0.64, 2.26);
    h.rotation.y = sd * -0.16;
    const b = add(A.bladeGeo, A.headMat, sd * 0.58, 0.665, 2.345);
    b.rotation.y = sd * -0.16;
    const t = add(A.tailGeo, A.tailMat, sd * 0.44, 0.76, -2.335);
    t.rotation.y = sd * 0.10;
    const arch = add(A.archGeo, A.blackMat, sd * 0.92, 0.34, 1.42);
    arch.rotation.y = Math.PI / 2;
    const arch2 = add(A.archGeo, A.blackMat, sd * 0.92, 0.34, -1.42);
    arch2.rotation.y = Math.PI / 2;
    const mir = add(A.mirrorGeo, paint, sd * 1.09, 1.015, 0.80);
    mir.castShadow = false;
    add(A.exhaustGeo, A.chromeMat, sd * 0.52, 0.21, -2.40);
  });
  add(A.diffuserGeo, A.blackMat, 0, 0.235, -2.28);
  const plate = add(A.plateGeo, A.plateMat, 0, 0.44, -2.378);
  plate.rotation.y = Math.PI;

  const spins = [];
  [[-0.92, 1.42], [0.92, 1.42], [-0.92, -1.42], [0.92, -1.42]].forEach(([x, z]) => {
    const spin = new THREE.Group();
    spin.position.set(x, 0.345, z);
    spin.add(new THREE.Mesh(A.tireGeo, A.tireMat));
    spin.add(new THREE.Mesh(A.silverGeo, A.rimMat));
    spin.add(new THREE.Mesh(A.darkGeo, A.darkMetal));
    grp.add(spin);
    spins.push(spin);
  });
  const blob = add(A.blobGeo, A.blobMat, 0, 0.05, 0);
  blob.rotation.x = -Math.PI / 2;
  blob.renderOrder = 1;
  const core = add(A.coreGeo, A.coreMat, 0, 0.045, 0);
  core.rotation.x = -Math.PI / 2;
  core.renderOrder = 2;
  return { group: grp, spins, paint };
}
