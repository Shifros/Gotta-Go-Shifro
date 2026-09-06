import { roadSamples, roadPointAhead, roadLength } from '../world/road.js';

let els = {};
let mapOff = null;

export function initHUD() {
  els = {
    hud: document.getElementById('hud'),
    speed: document.getElementById('speed-value'),
    odo: document.getElementById('odo-value'),
    autoPill: document.getElementById('autosteer-pill'),
    autoText: document.getElementById('autosteer-text'),
    steer: document.getElementById('steer-preview'),
    map: document.getElementById('minimap'),
    fps: document.getElementById('fps'),
    offroad: document.getElementById('offroad-warn'),
    toast: document.getElementById('toast'),
    panel: document.getElementById('panel'),
    gear: document.getElementById('gear'),
    loc: document.getElementById('location'),
  };
  // bar buttons → panels
  document.querySelectorAll('.bar-btn').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.bar-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      const p = b.dataset.panel;
      els.panel.classList.remove('hidden');
      document.querySelectorAll('.panel-page').forEach(pg => pg.classList.add('hidden'));
      document.getElementById('panel-' + p).classList.remove('hidden');
    });
  });
  document.getElementById('btn-help').addEventListener('click', () =>
    document.getElementById('help').classList.remove('hidden'));
  document.getElementById('help-close').addEventListener('click', () =>
    document.getElementById('help').classList.add('hidden'));

  buildMapCache();
  buildStats();
  return els;
}

// Segmented stat bars: pink run + green glowing tip + orange baseline.
// Top Speed is live (fills with road speed); the rest are rated values.
const STAT_SEGS = 18;
function paintBar(statEl, frac) {
  const segs = statEl.querySelectorAll('.stat-segs i');
  const filled = Math.round(Math.max(0, Math.min(1, frac)) * STAT_SEGS);
  segs.forEach((s, i) => {
    s.classList.toggle('on', i < filled);
    s.classList.toggle('hot', i < filled && i >= filled - 2 && filled > 3);
  });
}
function buildStats() {
  const ratings = { topspeed: 0, accel: 0.72, brake: 0.62, grip: 0.75 };
  document.querySelectorAll('#stats .stat').forEach((el) => {
    const box = el.querySelector('.stat-segs');
    for (let i = 0; i < STAT_SEGS; i++) box.appendChild(document.createElement('i'));
    const key = el.dataset.stat;
    if (key !== 'topspeed') paintBar(el, ratings[key] || 0);
  });
}
function updateStats(speedKmh) {
  const el = document.querySelector('#stats .stat[data-stat="topspeed"]');
  if (el) paintBar(el, speedKmh / 240);
  const val = document.getElementById('stat-topspeed-val');
  if (val) val.textContent = `${speedKmh.toFixed(0)} KM/H`;
}

// Must be called AFTER the road layout exists (road samples fill the cache).
export function refreshMinimapCache() {
  buildMapCache();
}

export function showHUD() { els.hud.classList.remove('hidden'); }

let toastTimer = 0;
export function toast(msg, ms = 2200) {
  if (!els.toast) return; // notifications removed from UI
  els.toast.textContent = msg;
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), ms);
}

function buildMapCache() {
  mapOff = document.createElement('canvas');
  mapOff.width = mapOff.height = 220;
  const c = mapOff.getContext('2d');
  c.clearRect(0, 0, 220, 220);
  c.strokeStyle = 'rgba(255,255,255,0.85)';
  c.lineWidth = 3;
  c.shadowColor = 'rgba(255,255,255,0.6)'; c.shadowBlur = 6;
  c.beginPath();
  roadSamples.forEach((s, i) => {
    const x = 110 + (s.x / 2000) * 100;
    const y = 110 + (s.z / 2000) * 100;
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  });
  c.closePath(); c.stroke();
  c.shadowBlur = 0;
  c.strokeStyle = 'rgba(255,180,200,0.25)'; c.lineWidth = 7;
  c.stroke();
}

export function drawMinimap(car, ghosts) {
  const cv = els.map; if (!cv) return;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, 220, 220);
  c.save();
  c.beginPath(); c.arc(110, 110, 104, 0, 7); c.clip();
  c.fillStyle = 'rgba(10,14,12,0.9)'; c.fillRect(0, 0, 220, 220);
  c.drawImage(mapOff, 0, 0);
  const dot = (x, z, color, r = 3) => {
    c.fillStyle = color;
    c.beginPath(); c.arc(110 + (x / 2000) * 100, 110 + (z / 2000) * 100, r, 0, 7); c.fill();
  };
  if (ghosts) ghosts.forEach(g => { if (g.mesh.visible) dot(g.mesh.position.x, g.mesh.position.z, 'rgba(255,255,255,0.55)', 2.5); });
  // player with heading wedge
  const px = 110 + (car.pos.x / 2000) * 100, py = 110 + (car.pos.z / 2000) * 100;
  c.save();
  c.translate(px, py); c.rotate(Math.atan2(Math.sin(car.heading), -Math.cos(car.heading)) + Math.PI);
  c.fillStyle = '#fff';
  c.beginPath(); c.moveTo(0, -7); c.lineTo(5, 5); c.lineTo(-5, 5); c.closePath(); c.fill();
  c.restore();
  c.restore();
  c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 1;
  c.beginPath(); c.arc(110, 110, 104, 0, 7); c.stroke();
}

export function drawSteerPreview(car, closest) {
  const cv = els.steer; if (!cv || !closest) return;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, 220, 70);
  const pts = [];
  for (let d = 4; d <= 64; d += 6) {
    const s = roadPointAhead(closest.index, d).point;
    const dx = s.x - car.pos.x, dz = s.z - car.pos.z;
    // car space: forward = +y on canvas
    const ch = car.heading;
    const lx = dx * Math.cos(ch) - dz * Math.sin(ch);
    const fwd = dx * Math.sin(ch) + dz * Math.cos(ch);
    pts.push([110 + lx * 2.4, 66 - fwd * 0.95]);
  }
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 7;
  c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke();
  c.strokeStyle = '#ffffff'; c.lineWidth = 3.5;
  c.shadowColor = '#fff'; c.shadowBlur = 10;
  c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke();
  c.shadowBlur = 0;
}

let fpsAcc = 0, fpsN = 0, fpsShown = 60, fpsTimer = 0;
export function updateHUD(car, info, dt, qualityLabel) {
  if (!els.speed) return;
  els.speed.textContent = info.speedKmh.toFixed(1);
  els.odo.textContent = car.odometer.toFixed(1);
  const on = car.autosteer;
  els.autoPill.classList.toggle('off', !on);
  els.autoText.textContent = on ? 'AUTOSTEER' : 'MANUAL';
  els.offroad.classList.add('hidden'); // all surfaces drive identically
  updateStats(info.speedKmh);
  els.gear.textContent = car.boosting ? 'BOOST ▸ 340' : car.speed < -0.5 ? 'R • REVERSE' : info.speedKmh < 1 ? 'N • IDLE' : 'D • AUTO';
  els.gear.classList.toggle('boost', !!car.boosting);
  drawSteerPreview(car, info.closest);
  // fps
  fpsAcc += dt > 0 ? 1 / dt : 60; fpsN++; fpsTimer += dt;
  if (fpsTimer > 0.5) {
    fpsShown = Math.round(fpsAcc / fpsN);
    fpsAcc = 0; fpsN = 0; fpsTimer = 0;
    els.fps.textContent = `${fpsShown} FPS • ${qualityLabel}`;
  }
  return fpsShown;
}
