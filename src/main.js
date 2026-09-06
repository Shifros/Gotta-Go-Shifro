import * as THREE from 'three';
import { initRoadLayout, buildRoad } from './world/road.js';
import { buildTerrain } from './world/terrain.js';
import { buildEnvironment, applyTimeOfDay, setMist, updateSunFollow, tickSky, refreshEnvironment } from './world/environment.js';
import { buildVegetation, buildHeroAlders, loadTreeGLB, makeAlderMaterials, tickVegetation } from './world/vegetation.js';
import { bakeImpostorAtlas, buildBushAtlas, buildGrassAtlas } from './world/impostors.js';
import { alderImpostorTexture } from './utils/textures.js';
import { loadGroundTextures } from './world/realMaterials.js';
import { buildCar, buildCoupeCar } from './vehicle/carFactory.js';
import { CarController } from './vehicle/controller.js';
import { initHUD, showHUD, toast, updateHUD, drawMinimap, refreshMinimapCache } from './ui/hud.js';

const loadBar = document.getElementById('load-bar');
const loadText = document.getElementById('load-text');
function progress(p, msg) {
  loadBar.style.width = `${Math.round(p * 100)}%`;
  if (msg) loadText.textContent = msg;
}
const nextFrame = () => new Promise(r => requestAnimationFrame(r));

let renderer, scene, camera, car, rig, quality = 'high', qualityLabel = 'ULTRA • R57';
const BUILD_TAG = 'R57';
let exposure = 1.0, autoQuality = false;

async function boot() {
  progress(0.04, 'Waking renderer…');
  await nextFrame();

  const canvas = document.getElementById('scene');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  quality = coarse ? 'low' : 'high';
  qualityLabel = quality === 'high' ? 'ULTRA' : 'EFFICIENT';
  renderer.setPixelRatio(quality === 'high' ? Math.min(devicePixelRatio, 1.75) : 1);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 16000);
  camera.position.set(0, 30, -40);

  initHUD();

  progress(0.12, 'Surveying valley loop…');
  await nextFrame();
  initRoadLayout();
  refreshMinimapCache();

  progress(0.2, 'Raising mountains…');
  await nextFrame();
  buildEnvironment(scene, renderer);
  refreshEnvironment(scene, renderer); // bake the real sky into reflections

  progress(0.3, 'Laying real meadow turf…');
  await nextFrame();
  let groundMaps = null;
  try {
    groundMaps = await loadGroundTextures(renderer);
  } catch (err) { console.warn('Ground PBR unavailable — procedural fallback:', err); }

  progress(0.46, 'Shaping 16 km² of hills…');
  await nextFrame();
  await nextFrame();
  buildTerrain(scene, groundMaps);

  progress(0.58, 'Paving Hollow Lane…');
  await nextFrame();
  buildRoad(scene);

  progress(0.72, 'Planting forests & meadows…');
  await nextFrame();
  await nextFrame();
  progress(0.78, 'Planting hero black alders…');
  await nextFrame();
  try {
    await buildHeroAlders(scene, quality);
  } catch (err) { console.warn('Hero alders unavailable:', err); }

  // All 4 baked variants → shared materials → model-rendered impostor atlas.
  progress(0.80, 'Rendering impostor atlas…');
  await nextFrame();
  let vegAssets = null;
  try {
    const base = import.meta.env.BASE_URL || '/';
    const texLoader = new THREE.TextureLoader();
    const [gC, gA, gB, gD, ph1, ph2, sp1, sp2, bushPh, gr1Ph, gr2Ph] = await Promise.all([
      loadTreeGLB('trees/alder_lod1.glb'),
      loadTreeGLB('trees/alder_lod1_a.glb'),
      loadTreeGLB('trees/alder_lod1_b.glb'),
      loadTreeGLB('trees/alder_lod1_d.glb'),
      texLoader.loadAsync(base + 'trees/tree-01.png').catch(() => null),
      texLoader.loadAsync(base + 'trees/tree-02.png').catch(() => null),
      texLoader.loadAsync(base + 'trees/out-tree-01.png').catch(() => null),
      texLoader.loadAsync(base + 'trees/out-tree-02.png').catch(() => null),
      texLoader.loadAsync(base + 'ground/bush-01.png').catch(() => null),
      texLoader.loadAsync(base + 'ground/grass-01.png').catch(() => null),
      texLoader.loadAsync(base + 'ground/grass-02.png').catch(() => null),
    ]);
    const alderMats = makeAlderMaterials();
    let impostorTex = null;
    try {
      impostorTex = await bakeImpostorAtlas(
        renderer,
        [gC, gA, gB, gD].map((g) => ({ woodGeo: g.woodGeo, leafGeo: g.leafGeo })),
        alderMats,
        [
          { img: ph1 ? ph1.image : null, bg: 'black' },
          { img: ph2 ? ph2.image : null, bg: 'white' },
          { img: sp1 ? sp1.image : null, flood: 'white' },
          { img: sp2 ? sp2.image : null, flood: 'black' },
        ]
      );
    } catch (err) { console.warn('model impostors failed, painted fallback:', err); }
    if (ph1) ph1.dispose();
    if (ph2) ph2.dispose();
    if (sp1) sp1.dispose();
    if (sp2) sp2.dispose();
    // Photo groundcover atlases (skipped silently if photos are missing).
    let bushTex = null, grassTex = null;
    try {
      if (bushPh) bushTex = buildBushAtlas(bushPh.image);
    } catch (err) { console.warn('bush atlas unavailable:', err); }
    try {
      if (gr1Ph && gr2Ph) grassTex = buildGrassAtlas(gr1Ph.image, gr2Ph.image);
    } catch (err) { console.warn('grass atlas unavailable:', err); }
    if (bushPh) bushPh.dispose();
    if (gr1Ph) gr1Ph.dispose();
    if (gr2Ph) gr2Ph.dispose();
    vegAssets = {
      lodVariants: [gC, gA, gB, gD],
      mats: alderMats,
      impostorTex: impostorTex || alderImpostorTexture(),
      bushTex, grassTex,
    };
  } catch (err) { console.warn('variant LODs unavailable:', err); }

  progress(0.82, 'Growing the alder forest…');
  await nextFrame();
  await buildVegetation(scene, quality, vegAssets);

  progress(0.88, 'Detailing the sport coupe…');
  await nextFrame();
  try {
    rig = await buildCoupeCar();
  } catch (err) {
    console.warn('coupe GLB unavailable, procedural fallback:', err);
    rig = buildCar();
  }
  scene.add(rig.group);
  car = new CarController(scene, rig, camera);
  car.toggleLights = () => {
    lightsOn = !lightsOn;
    rig.setLights(lightsOn);
    document.getElementById('opt-lights').checked = lightsOn;
  };
  rig.setLights(false);

  wireUI();
  addEventListener('resize', onResize);
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    showError('GPU context lost (too much load or driver reset). Reload, or pick EFFICIENT quality.');
  });

  progress(1, 'Ready.');
  await new Promise(r => setTimeout(r, 250));
  document.getElementById('loading').classList.add('done');
  showHUD();
  toast('MANUAL DRIVE — HOLD W, G FOR AUTOSTEER', 3200);

  renderer.setAnimationLoop(loop);
}

let lightsOn = false;
let last = performance.now(), elapsed = 0, mapTick = 0;
let loopFailed = false;

function showError(msg) {
  const el = document.getElementById('errbar');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function loop(now) {
  try {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; elapsed += dt;

    const info = car.update(dt, elapsed);
    tickSky(dt, elapsed);
    tickVegetation(elapsed);
    updateSunFollow(car.pos);

    const fps = updateHUD(car, info, dt, autoQuality ? `AUTO • ${qualityLabel}` : qualityLabel);
    autoTune(fps, dt);

    if ((mapTick += dt) > 0.12) { mapTick = 0; drawMinimap(car, car.ghosts); }
    renderer.render(scene, camera);
  } catch (err) {
    console.error('frame failed:', err);
    if (!loopFailed) {
      loopFailed = true;
      showError('Render loop failed: ' + (err && err.message ? err.message : err) +
        '\nPaste this + F12 Console (red lines) back for a one-shot fix.');
    }
  }
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

function applyQuality(q) {
  quality = q;
  if (q === 'high') {
    qualityLabel = 'ULTRA • ' + BUILD_TAG;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.shadowMap.enabled = true;
  } else {
    qualityLabel = 'EFFICIENT • ' + BUILD_TAG;
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
  }
  document.querySelectorAll('[data-q]').forEach(b =>
    b.classList.toggle('active', b.dataset.q === (autoQuality ? 'auto' : q)));
}

// Auto: drop pixel ratio if sustained low fps.
let lowTime = 0, hiTime = 0;
function autoTune(fps, dt) {
  if (!autoQuality) { lowTime = hiTime = 0; return; }
  if (fps < 42) { lowTime += dt; hiTime = 0; } else if (fps > 57) { hiTime += dt; lowTime = 0; }
  else { lowTime = hiTime = 0; }
  if (lowTime > 2.5 && quality !== 'low') { applyQuality('low'); lowTime = 0; toast('AUTO QUALITY → EFFICIENT'); }
  if (hiTime > 12 && quality !== 'high') { applyQuality('high'); hiTime = 0; toast('AUTO QUALITY → ULTRA'); }
}

function wireUI() {
  // panels default
  document.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => {
    const q = b.dataset.q;
    if (q === 'auto') { autoQuality = true; qualityLabel = quality === 'high' ? 'ULTRA' : 'EFFICIENT'; }
    else { autoQuality = false; applyQuality(q); }
    document.querySelectorAll('[data-q]').forEach(x => x.classList.toggle('active', x === b));
  }));
  document.querySelector('.bar-btn[data-panel="vehicle"]')?.click();

  let envTimer = 0;
  const todNight = () => {
    const t = parseFloat(document.getElementById('opt-tod').value);
    return t >= 0.9 ? (t - 0.9) / 0.1 : 0; // ramps in over the last stretch
  };
  const refreshEnvSoon = () => {
    clearTimeout(envTimer);
    envTimer = setTimeout(() => refreshEnvironment(scene, renderer, todNight()), 350);
  };
  document.getElementById('opt-tod').addEventListener('input', (e) => {
    applyTimeOfDay(parseFloat(e.target.value), scene);
    refreshEnvSoon();
  });
  document.querySelectorAll('[data-tod]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-tod]').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    const v = parseFloat(b.dataset.tod);
    document.getElementById('opt-tod').value = v;
    applyTimeOfDay(v, scene);
    refreshEnvSoon();
    // headlights come on with the night
    if (v >= 0.99 && rig) {
      lightsOn = true;
      rig.setLights(true);
      document.getElementById('opt-lights').checked = true;
    }
  }));
  document.getElementById('opt-fog').addEventListener('input', (e) => {
    setMist(parseFloat(e.target.value));
    applyTimeOfDay(parseFloat(document.getElementById('opt-tod').value), scene);
    refreshEnvSoon();
  });
  document.getElementById('opt-exposure').addEventListener('input', (e) => {
    exposure = parseFloat(e.target.value);
    renderer.toneMappingExposure = exposure;
  });
  document.getElementById('opt-lights').addEventListener('change', (e) => {
    lightsOn = e.target.checked; rig.setLights(lightsOn);
  });
  document.getElementById('opt-ghost').addEventListener('change', (e) => {
    car.ghostOn = e.target.checked;
  });
  document.querySelectorAll('.swatch').forEach(sw => sw.addEventListener('click', () => {
    document.querySelectorAll('.swatch').forEach(x => x.classList.remove('active'));
    sw.classList.add('active');
    rig.setPaint(sw.dataset.color);
    toast('PAINT — PEARL RESPRAY');
  }));
  document.getElementById('btn-reset').addEventListener('click', () => { car.resetToRoad(); toast('BACK ON HOLLOW LANE'); });
  const btnAuto = document.getElementById('btn-auto');
  const syncAuto = () => btnAuto.classList.toggle('active', car.autosteer);
  btnAuto.addEventListener('click', () => { car.toggleAutosteer(); syncAuto(); });
  addEventListener('keydown', (e) => { if (e.code === 'KeyG') syncAuto(); });

  document.getElementById('btn-mute').addEventListener('click', function () {
    const m = car.toggleMute(); this.textContent = m ? '✕' : '♪'; this.style.opacity = m ? 0.5 : 1;
  });
  document.getElementById('btn-cam').addEventListener('click', () => {
    const m = ['CHASE', 'SPORT', 'HOOD'][car.cycleCamera()];
    toast('CAMERA — ' + m);
  });
  document.getElementById('btn-quality').addEventListener('click', () => {
    applyQuality(quality === 'high' ? 'low' : 'high');
    toast('QUALITY — ' + qualityLabel);
  });
}

boot().catch(err => {
  console.error(err);
  loadText.textContent = 'Failed to start: ' + err.message;
});
