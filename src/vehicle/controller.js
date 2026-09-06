import * as THREE from 'three';
import { getHeight, isOffRoad, ROAD_WIDTH } from '../world/terrain.js';
import { closestOnRoad, roadPointAhead, roadPointAheadOn, roadSamples, roadLength, roadSurfaceAt, roadFrameAt, ROAD_LIFT, ROAD_CROWN } from '../world/road.js';
import { checkBoost, checkRamp, groundExtra, collideProps } from '../world/props.js';
import { treeColliders } from '../world/vegetation.js';
import { buildGhostCar } from './carFactory.js';
import { clamp, damp, smoothstep } from '../utils/math.js';

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Full-throttle power curve, simulated to the spec splits:
// 0-60 ~7 s, 60-140 ~12, 140-200 ~18, 200-240 ~22, 240-340 ~35.
const POWER = [[0, 2.0], [16.67, 2.95], [38.89, 2.95], [55.56, 2.95], [66.67, 3.9], [94.44, 6.8]];
// SHIFT boost curve (normal driving never touches this):
// 0-60 in 2 s, 60-140 in 4, 140-340 in 10.
const BOOST_POWER = [[0, 8], [16.67, 9], [38.89, 5], [55.56, 7], [66.67, 9], [80, 12], [94.44, 16]];
function powerAtTable(table, v) {
  v = Math.abs(v);
  if (v <= table[0][0]) return table[0][1];
  for (let i = 0; i < table.length - 1; i++) {
    const [x0, y0] = table[i], [x1, y1] = table[i + 1];
    if (v <= x1) return y0 + (y1 - y0) * ((v - x0) / (x1 - x0));
  }
  return table[table.length - 1][1];
}
function powerAt(v) { return powerAtTable(POWER, v); }
function boostAt(v) { return powerAtTable(BOOST_POWER, v); }

export class CarController {
  constructor(scene, rig, camera) {
    this.scene = scene;
    this.rig = rig;
    this.camera = camera;

    const start = roadSamples[10];
    const nxt = roadSamples[14];
    this.pos = new THREE.Vector3(start.x, start.y, start.z);
    this.heading = Math.atan2(nxt.x - start.x, nxt.z - start.z);
    this.rear = {
      x: this.pos.x - Math.sin(this.heading) * 1.42,
      z: this.pos.z - Math.cos(this.heading) * 1.42,
    };
    this.y = start.y + 0.4; // finished surface, not dirt
    this.speed = 0;
    this.steer = 0;
    this.steerAngle = 0;
    this.throttleVis = 0;
    this.odometer = 0;
    this.boosting = false;
    this.autosteer = false; // manual by default — G engages cruise
    this.cruise = 16.7; // remembered pace: set on engage, W/S adjust it live
    this.yawSm = 0; this.rollV = 0; this.pitchV = 0;
    this.vy = 0; this.airborne = false;
    this.camMode = 0;
    this.crashed = 0;

    this.input = { up: false, down: false, left: false, right: false, handbrake: false, boost: false };
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.camInit = false;
    this.fov = 62;

    // velocity streaks: rushing air past 140 km/h (1 draw call, 120 quads)
    const streakGeo = new THREE.BoxGeometry(0.025, 0.025, 1);
    this.streakMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffffff'), transparent: true, opacity: 0, depthWrite: false,
    });
    this.streaks = new THREE.InstancedMesh(streakGeo, this.streakMat, 120);
    this.streaks.frustumCulled = false;
    this.streaks.visible = false;
    this.streakData = [];
    for (let i = 0; i < 120; i++) {
      this.streakData.push({
        r: 2 + Math.random() * 8, a: Math.random() * Math.PI * 2,
        d: 5 + Math.random() * 35, len: 2 + Math.random() * 4,
      });
    }
    scene.add(this.streaks);

    this.bindInput();
    this.initAudio();
    this.initGhosts(scene);
  }

  bindInput() {
    const set = (code, down) => {
      const i = this.input;
      switch (code) {
        case 'KeyW': case 'ArrowUp': i.up = down; break;
        case 'KeyS': case 'ArrowDown': i.down = down; break;
        case 'KeyA': case 'ArrowLeft': i.left = down; break;
        case 'KeyD': case 'ArrowRight': i.right = down; break;
        case 'Space': i.handbrake = down; break;
        case 'ShiftLeft': case 'ShiftRight': i.boost = down; break;
      }
      if (down) this.ensureAudio();
    };
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      set(e.code, true);
      if (e.code === 'KeyG') this.toggleAutosteer();
      if (e.code === 'KeyC') this.cycleCamera();
      if (e.code === 'KeyR') this.resetToRoad();
      if (e.code === 'KeyH') this.toggleLights?.();
      if (e.code === 'KeyM') this.toggleMute();
    });
    window.addEventListener('keyup', (e) => set(e.code, false));

    // touch
    const hold = (id, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      const on = (e) => { e.preventDefault(); this.input[key] = true; this.ensureAudio(); };
      const off = (e) => { e.preventDefault(); this.input[key] = false; };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointerleave', off);
    };
    hold('t-gas', 'up'); hold('t-brake', 'down');
    hold('t-left', 'left'); hold('t-right', 'right');
  }

  initGhosts(scene) {
    this.ghosts = [];
    this.ghostOn = true;
    const defs = [
      { d: 500, v: 15.5, off: -1.7, color: '#5a6a8a' },
      { d: 1800, v: 13.0, off: -1.7, color: '#8a4a4a' },
      { d: 3200, v: 17.0, off: -1.7, color: '#3a3f4a' },
    ];
    defs.forEach(df => {
      const { group, spins } = buildGhostCar(df.color);
      scene.add(group);
      this.ghosts.push({ ...df, mesh: group, spins, yaw: null, vEff: df.v });
    });
  }

  // ---------- audio (fully procedural) ----------
  initAudio() {
    this.audio = null; this.muted = false;
  }
  ensureAudio() {
    if (this.audio || this.muted) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      // master chain with a limiter: distortion without the broken-radio clip
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.knee.value = 22;
      comp.ratio.value = 8; comp.attack.value = 0.004; comp.release.value = 0.16;
      comp.connect(ctx.destination);
      const master = ctx.createGain(); master.gain.value = 0.55; master.connect(comp);
      // engine: detuned saw pair + sine sub through soft saturation
      const engGain = ctx.createGain(); engGain.gain.value = 0.0;
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const x = i / 128 - 1;
        curve[i] = Math.tanh(2.2 * x);
      }
      shaper.curve = curve;
      const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 420; filt.Q.value = 1.1;
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 55; o1.detune.value = -5;
      const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 55; o2.detune.value = 8;
      const o3 = ctx.createOscillator(); o3.type = 'sine'; o3.frequency.value = 28;
      const g3 = ctx.createGain(); g3.gain.value = 0.7;
      o1.connect(shaper); o2.connect(shaper); o3.connect(g3); g3.connect(shaper);
      shaper.connect(filt); filt.connect(engGain); engGain.connect(master);
      o1.start(); o2.start(); o3.start();
      // wind
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.6;
      const wGain = ctx.createGain(); wGain.gain.value = 0;
      noise.connect(bp); bp.connect(wGain); wGain.connect(master);
      noise.start();
      // tire scrub: same noise through a highpass, wakes up in slides
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
      const sGain = ctx.createGain(); sGain.gain.value = 0;
      noise.connect(hp); hp.connect(sGain); sGain.connect(master);
      this.audio = { ctx, master, engGain, filt, o1, o2, o3, wGain, bp, sGain };
    } catch { /* no audio */ }
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.audio) this.audio.master.gain.value = this.muted ? 0 : 0.6;
    return this.muted;
  }

  toggleAutosteer() {
    this.autosteer = !this.autosteer;
    if (this.autosteer) {
      // cruise inherits whatever you were doing: parked/low speed → 60,
      // otherwise your exact current pace becomes the new limit
      this.cruise = Math.abs(this.speed) < 8 ? 16.7 : clamp(Math.abs(this.speed), 8, 66.7);
    }
    return this.autosteer;
  }
  cycleCamera() { this.camMode = (this.camMode + 1) % 3; return this.camMode; }

  resetToRoad() {
    const c = closestOnRoad(this.pos.x, this.pos.z);
    this.pos.set(c.point.x, c.point.y, c.point.z);
    const nxt = roadSamples[(c.index + 8) % roadSamples.length];
    this.heading = Math.atan2(nxt.x - c.point.x, nxt.z - c.point.z);
    this.rear = {
      x: this.pos.x - Math.sin(this.heading) * 1.42,
      z: this.pos.z - Math.cos(this.heading) * 1.42,
    };
    this.speed = 0; this.y = c.point.y + 0.4;
  }

  update(dt, elapsed) {
    dt = Math.min(dt, 0.05);
    const inp = this.input;
    const closest = closestOnRoad(this.pos.x, this.pos.z);
    const offroad = closest.dist > closest.road.halfW + 0.9;

    // ----- steering / throttle -----
    // Screen-relative: pressing LEFT must turn the car toward screen-left.
    // With forward = (sin h, cos h), screen-left is +heading, so LEFT = +1.
    let steerTarget = (inp.left ? 1 : 0) + (inp.right ? -1 : 0);
    let throttle = inp.up ? 1 : 0;
    let brake = inp.down ? 1 : 0;
    let autoActive = false;

    if (this.autosteer) {
      autoActive = true;
      const look = 11 + Math.abs(this.speed) * 1.25;
      const ahead = roadPointAheadOn(closest.road, closest.index, look).point;
      const desired = Math.atan2(ahead.x - this.pos.x, ahead.z - this.pos.z);
      const err = wrapAngle(desired - this.heading);
      const autoSteer = clamp(err * 2.0, -1, 1);
      // blend: auto dominates, driver can nudge
      steerTarget = clamp(autoSteer * 0.95 + steerTarget * 0.45, -1, 1);
      // cruise memory: W pushes pace up and it sticks, S drags it down
      const cap = this.cruise;
      if (inp.up) {
        throttle = 1;
        if (this.speed > this.cruise) this.cruise = Math.min(66.7, this.speed);
      } else if (this.speed < cap - 0.5) throttle = Math.max(throttle, err > 0.6 ? 0.3 : 0.66);
      else if (this.speed > cap + 1.2) { brake = Math.max(brake, 0.5); throttle = 0; }
      else throttle = Math.max(throttle, 0.17); // feather the cruise
      if (inp.down) {
        throttle = 0;
        if (this.speed < this.cruise) this.cruise = Math.max(8, this.speed);
      }
      if ((inp.left || inp.right) && Math.abs(this.speed) > 4) {
        // strong driver input momentarily softens auto so you can overtake / leave road
        steerTarget = clamp(autoSteer * 0.45 + steerTarget * 0.9, -1, 1);
      }
    }

    const spd = Math.abs(this.speed);
    // true road-car steering curve: full lock parking, alive everywhere
    const maxSteer = 0.62 / (1 + Math.pow(spd / 13, 1.6));
    // steering column: rate-limited, slower hands at speed (weight feel)
    const steerRate = THREE.MathUtils.lerp(4.5, 2.2, clamp(spd / 65, 0, 1));
    const sWant = clamp(steerTarget, -1, 1);
    const sMax = steerRate * dt;
    this.steer += clamp(sWant - this.steer, -sMax, sMax);
    this.steerAngle = this.steer * maxSteer;
    // numb steering in the air — you set the attitude at takeoff
    const effSteer = this.airborne ? this.steerAngle * 0.35 : this.steerAngle;

    // ----- longitudinal (surface-independent: grass never slows you) -----
    // Cruise ceiling 140 km/h; hold SHIFT with throttle to boost to 240.
    this.boosting = !!(inp.boost && throttle > 0 && this.speed > 4);
    const cap = this.boosting ? 94.44 : 38.9; // 340 / 140 km/h
    let accel = throttle * (this.boosting ? boostAt(this.speed) : powerAt(this.speed) * 0.62);
    if (brake > 0) {
      if (this.speed > 1.2) accel -= brake * 19;
      else accel -= brake * 7.5; // reverse
    }
    // resistance (identical on every surface) — tuned so 140 cruise and
    // 240 boost sit above drag equilibrium, with soft caps governing
    accel -= 0.02 * this.speed + 0.00045 * this.speed * Math.abs(this.speed);
    // engine braking: lift off and the drivetrain drags you down to a stop
    if (throttle <= 0 && brake <= 0 && !autoActive) {
      accel -= Math.sign(this.speed) * (1.2 + Math.min(2.5, Math.abs(this.speed) * 0.12));
    }
    if (inp.handbrake) accel -= Math.sign(this.speed) * 11;
    // stunt: boost pads slingshot toward their target pace
    const boostT = checkBoost(this.pos.x, this.pos.z);
    if (boostT > 0 && this.speed < boostT && this.speed > -1) {
      this.speed += (boostT - this.speed) * Math.min(1, 4 * dt);
    }
    // slope
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const hA = getHeight(this.pos.x + fx * 4, this.pos.z + fz * 4);
    const hB = getHeight(this.pos.x - fx * 4, this.pos.z - fz * 4);
    accel -= 9.81 * ((hA - hB) / 8) * 0.65;

    this.speed = this.speed + accel * dt;
    if (this.speed < -13) this.speed = -13;
    // soft ceiling: manual caps, or the remembered cruise in autosteer
    const ceiling = autoActive ? Math.max(cap, this.cruise) : cap;
    if (this.speed > ceiling) {
      this.speed = Math.max(ceiling, this.speed - Math.max(0, this.speed - ceiling) * 1.6 * dt - 1.2 * dt);
    }
    if (!inp.up && !inp.down && !this.autosteer && spd < 0.35) this.speed *= 1 - 3 * dt;
    if (throttle <= 0 && brake <= 0 && !autoActive && Math.abs(this.speed) < 0.5) this.speed = 0;
    if (inp.handbrake && spd < 0.6) this.speed *= 1 - 4 * dt;
    this.throttleVis = damp(this.throttleVis, throttle, 6, dt);

    // ----- yaw: honest bicycle — front axle steers, rear axle tracks -----
    if (Math.abs(this.speed) > 0.15) {
      const rawYaw = (this.speed / 2.84) * Math.tan(effSteer);
      const latG = Math.abs(this.speed * rawYaw);
      const gripU = clamp(1 - Math.pow(latG / 30, 2), 0.8, 1) * (inp.handbrake ? 0.55 : 1.0);
      this.yawSm = damp(this.yawSm, rawYaw * gripU, 9, dt); // rubber takes a beat to bite
      this.heading = wrapAngle(this.heading + this.yawSm * dt);
    } else {
      this.yawSm = damp(this.yawSm, 0, 9, dt);
    }

    // ----- integrate: rear axle tracks the heading, nose carves around it.
    // Classic bicycle geometry — the back follows the front, always.
    const WB2 = 1.42;
    const nx = Math.sin(this.heading), nz = Math.cos(this.heading);
    this.rear.x += nx * this.speed * dt;
    this.rear.z += nz * this.speed * dt;
    this.pos.x = this.rear.x + nx * WB2;
    this.pos.z = this.rear.z + nz * WB2;
    this.pos.x = clamp(this.pos.x, -1950, 1950);
    this.pos.z = clamp(this.pos.z, -1950, 1950);
    this.odometer += Math.abs(this.speed) * dt / 1000;

    // ----- collisions: trees (grounded only — jumps sail over) -----
    this.crashed = Math.max(0, this.crashed - dt * 2);
    if (!this.airborne) {
    for (let i = 0; i < treeColliders.length; i++) {
      const t = treeColliders[i];
      const dx = this.pos.x - t.x, dz = this.pos.z - t.z;
      const rr = t.r + 1.0;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = rr - d;
        this.pos.x += (dx / d) * push;
        this.pos.z += (dz / d) * push;
        if (Math.abs(this.speed) > 6) this.crashed = 1;
        this.speed *= 0.55;
      }
    }
    }
    // ----- stone wall: guardrail slide, never a full stop -----
    // Push out of the stones, scrub a little speed like a real rub, and let
    // the rail guide the heading. Grinding the wall costs pace, never motion.
    if (closest.road.kind === 'loop' && closest.index >= 78 && closest.index <= 332) {
      const s = closest.point;
      const lnx = -s.tz, lnz = s.tx; // left normal
      const lat = (this.pos.x - s.x) * lnx + (this.pos.z - s.z) * lnz;
      const wallOff = ROAD_WIDTH / 2 + 1.9;
      const HALF = 1.2; // car half-width + stone face, so contact reads true
      const pen = HALF - Math.abs(lat - wallOff);
      if (pen > 0) {
        // 1. out of the stones
        const side = lat > wallOff ? 1 : -1;
        this.pos.x += lnx * side * pen;
        this.pos.z += lnz * side * pen;
        // 2. how hard are we hitting it, laterally?
        const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
        const vN = (fx * lnx + fz * lnz) * this.speed;
        const intoWall = (lat - wallOff) * vN < 0 && Math.abs(vN) > 0.5;
        // 3. scrub: rolling loss while rubbing + a slice of hard impacts.
        // Throttle always refills it, so this can never stall the car.
        const loss = Math.abs(this.speed) * 0.004 + (intoWall ? Math.abs(vN) * 0.04 : 0);
        this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), loss);
        // 4. guide: rotate the nose toward the rail's direction of travel
        if (this.speed > 0.5) {
          const fwdT = fx * s.tx + fz * s.tz;
          const sense = fwdT >= 0 ? 1 : -1;
          const railA = Math.atan2(s.tx * sense, s.tz * sense);
          this.heading += wrapAngle(railA - this.heading) * (1 - Math.exp(-3.5 * dt));
        }
        // 5. crash shake only on genuine slams, never on rubs
        if (intoWall && Math.abs(vN) > 7) this.crashed = Math.max(this.crashed, 0.7);
      }
    }
    // ----- houses: solid walls, fly-over roofs -----
    const hit = collideProps(this.pos.x, this.pos.z, this.y);
    if (hit) {
      this.pos.x = hit.x; this.pos.z = hit.z;
      if (Math.abs(this.speed) > 6) this.crashed = 1;
      this.speed *= 0.6;
    }
    // keep the rigid body consistent after collision pushes
    this.rear.x = this.pos.x - nx * WB2;
    this.rear.z = this.pos.z - nz * WB2;

    // ----- ground + airtime: tarmac, dirt, roofs, sky -----
    const terrH = getHeight(this.pos.x, this.pos.z);
    let groundY = terrH;
    const rs = roadSurfaceAt(this.pos.x, this.pos.z);
    if (rs) {
      const hw = rs.road.halfW;
      const a = Math.abs(rs.lat);
      if (a < hw + 1.6) {
        const b = 1 - smoothstep(hw - 0.5, hw + 1.6, a);
        groundY = terrH * (1 - b) + rs.y * b;
      }
    }
    const roofY = groundExtra(this.pos.x, this.pos.z, this.y);
    if (roofY > 0) groundY = Math.max(groundY, roofY);
    if (!this.airborne) {
      const vy0 = checkRamp(this.pos.x, this.pos.z, this.heading, this.speed);
      if (vy0 > 0) { this.vy = vy0; this.airborne = true; }
    }
    if (this.airborne) {
      this.vy -= 18 * dt;
      this.y += this.vy * dt;
      if (this.y <= groundY) {
        this.y = groundY;
        const fall = -this.vy;
        this.vy = 0; this.airborne = false;
        if (fall > 9) this.crashed = Math.max(this.crashed, 0.8);
        this.speed *= 0.92;
      }
    } else {
      this.y = damp(this.y, groundY, 20, dt);
    }
    const rig = this.rig;
    rig.group.position.set(this.pos.x, this.y, this.pos.z);
    rig.group.rotation.y = this.heading;

    const bumpy = offroad ? Math.min(1, spd / 14) : 0;
    const bounce = (Math.sin(elapsed * 23) * 0.5 + Math.sin(elapsed * 37.7) * 0.5) * 0.035 * bumpy;
    // sprung body mass: pitch dives under brakes, roll barely whispers
    const rollT = clamp(-this.yawSm * this.speed * 0.003, -0.02, 0.02);
    this.rollV += ((rollT - rig.body.rotation.z) * 34 - this.rollV * 8.5) * dt;
    rig.body.rotation.z = clamp(rig.body.rotation.z + this.rollV * dt, -0.14, 0.14);
    const pitchT = clamp(-accel * 0.0024, -0.035, 0.045);
    this.pitchV += ((pitchT - rig.body.rotation.x) * 30 - this.pitchV * 8) * dt;
    rig.body.rotation.x = clamp(rig.body.rotation.x + this.pitchV * dt, -0.07, 0.08);
    rig.body.position.y = -0.15 + bounce + Math.sin(elapsed * 1.7) * 0.004;

    // wheels (spin about each hub's measured axle)
    const wheelR = rig.wheelR || 0.345;
    const spin = (this.speed / wheelR) * dt;
    ['FL', 'FR', 'RL', 'RR'].forEach((kw) => {
      const w = rig.wheels[kw];
      if (w && w.spin) w.spin.rotation[w.axis || 'x'] += spin;
    });
    rig.wheels.FL.steer.rotation.y = this.steerAngle;
    rig.wheels.FR.steer.rotation.y = this.steerAngle;
    const braking = brake > 0 && this.speed > 1;
    rig.brakeMat.emissiveIntensity = braking ? 3.4 : autoActive ? 1.6 : 1.1;
    rig.setReverse?.(this.speed < -0.5);

    this.updateCamera(dt, elapsed, offroad);
    this.updateStreaks(dt, Math.abs(this.speed) * 3.6);
    this.updateGhosts(dt, closest);
    this.updateAudio(offroad);

    return { closest, offroad, speedKmh: Math.abs(this.speed) * 3.6, autoActive, throttle };
  }

  updateCamera(dt, elapsed, offroad) {
    const cam = this.camera;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    if (this.camMode === 2) {
      // hood
      const px = this.pos.x + fx * 0.35, pz = this.pos.z + fz * 0.35;
      const py = this.y + 1.32;
      this.camPos.set(px, py, pz);
      cam.position.copy(this.camPos);
      const lx = this.pos.x + fx * 40, lz = this.pos.z + fz * 40;
      this.camLook.set(lx, this.y + 1.0, lz);
      cam.lookAt(this.camLook);
    } else {
      // glued chase: ~1 m gap behind the bumper, identical at any speed
      const dist = this.camMode === 0 ? 3.3 : 3.0;
      // high enough to read the roof + the road ahead in one frame
      const h = this.camMode === 0 ? 2.6 : 2.2;
      const px = this.pos.x - fx * dist, pz = this.pos.z - fz * dist;
      let py = this.y + h;
      py = Math.max(py, getHeight(px, pz) + 1.15);
      const shake = this.crashed * 0.25 + (offroad ? Math.min(0.12, Math.abs(this.speed) * 0.006) : 0);
      const jx = shake ? Math.sin(elapsed * 61) * shake : 0;
      const jy = shake ? Math.abs(Math.sin(elapsed * 53)) * shake : 0;
      const ideal = new THREE.Vector3(px + jx, py + jy, pz);
      if (!this.camInit) { this.camPos.copy(ideal); this.camInit = true; }
      else {
        // follow stiffness grows with speed: kills the elastic-band lag
        // (v/lambda trail) that lets the car shrink into the distance
        const spdC = Math.abs(this.speed);
        const k = 1 - Math.exp(-(6 + spdC * 0.25) * dt);
        this.camPos.lerp(ideal, k);
        this.camPos.y = Math.max(this.camPos.y, getHeight(this.camPos.x, this.camPos.z) + 1.0);
      }
      cam.position.copy(this.camPos);
      const lookIdeal = new THREE.Vector3(
        this.pos.x + fx * 7.5, this.y + 0.9, this.pos.z + fz * 7.5
      );
      const kl = 1 - Math.exp(-(8 + Math.abs(this.speed) * 0.2) * dt);
      this.camLook.lerp(lookIdeal, this.camInit ? kl : 1);
      cam.lookAt(this.camLook);
    }
    // near-flat FOV: zoom-out is what miniaturizes the car, not distance
    const targetFov = this.camMode === 2 ? 68 : clamp(63 + Math.abs(this.speed) * 0.04 + (this.boosting ? 1 : 0), 63, 66);
    this.fov = damp(this.fov, targetFov, 4, dt);
    if (Math.abs(cam.fov - this.fov) > 0.05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }

  updateStreaks(dt, speedKmh) {
    const on = speedKmh > 135 && this.camMode !== 2;
    this.streaks.visible = on;
    if (!on) return;
    this.streakMat.opacity = clamp((speedKmh - 140) / 50, 0, 1) * 0.32;
    const cam = this.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const right = new THREE.Vector3().crossVectors(dir, cam.up);
    if (right.lengthSq() < 1e-8) return; // degenerate view — skip streaks
    right.normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
    const look = new THREE.Vector3();
    const flow = Math.abs(this.speed) * 1.4;
    for (let i = 0; i < this.streakData.length; i++) {
      const s = this.streakData[i];
      s.d -= flow * dt;
      if (s.d < 1) {
        s.d = 38 + Math.random() * 6;
        s.a = Math.random() * Math.PI * 2;
        s.r = 2 + Math.random() * 8;
      }
      P.copy(cam.position)
        .addScaledVector(dir, s.d)
        .addScaledVector(right, Math.cos(s.a) * s.r)
        .addScaledVector(up, Math.sin(s.a) * s.r);
      // orient along travel, stretch with speed
      look.copy(P).add(dir);
      M.lookAt(P, look, up);
      Q.setFromRotationMatrix(M);
      S.set(1, 1, s.len + Math.abs(this.speed) * 0.15);
      M.compose(P, Q, S);
      this.streaks.setMatrixAt(i, M);
    }
    this.streaks.instanceMatrix.needsUpdate = true;
  }

  updateGhosts(dt, playerClosest) {
    if (!this.ghosts) return;
    const playerDist = playerClosest ? playerClosest.point.dist : -1;
    const playerV = Math.max(0, this.speed);
    for (const gh of this.ghosts) {
      if (!this.ghostOn) { gh.mesh.visible = false; continue; }
      gh.mesh.visible = true;
      // Gentle follow: ease off when catching the player ahead in-lane.
      let v = gh.v;
      if (playerDist >= 0) {
        const ahead = (playerDist - gh.d + roadLength) % roadLength;
        if (ahead > 0.5 && ahead < 16) v = Math.min(v, playerV * 0.92);
      }
      gh.vEff = damp(gh.vEff, Math.max(0, v), 2.5, dt);
      gh.d = (gh.d + gh.vEff * dt) % roadLength;
      // Exact interpolated frame — no sample snapping, ever.
      const f = roadFrameAt(gh.d);
      const nx = -f.tz, nz = f.tx;
      const t = Math.max(0, Math.min(1, gh.off / ROAD_WIDTH + 0.5));
      const y = f.y + ROAD_LIFT + Math.cos((t - 0.5) * Math.PI) * ROAD_CROWN;
      gh.mesh.position.set(f.x + nx * gh.off, y, f.z + nz * gh.off);
      // Critically-damped heading — no orientation pops.
      const targetYaw = Math.atan2(f.tx, f.tz);
      if (gh.yaw === null || gh.yaw === undefined) gh.yaw = targetYaw;
      else gh.yaw += wrapAngle(targetYaw - gh.yaw) * (1 - Math.exp(-5 * dt));
      gh.mesh.rotation.y = gh.yaw;
      // Rolling wheels sell the glide.
      const spin = (gh.vEff / 0.345) * dt;
      for (const s of gh.spins) s.rotation.x += spin;
    }
  }

  updateAudio(offroad) {
    if (!this.audio || this.muted) return;
    const a = this.audio;
    const t = a.ctx.currentTime;
    const spd = Math.abs(this.speed);
    // 6 gears across the pace range: pitch climbs each gear, drops on shift —
    // idle growl at 0, scream toward 340
    const spans = [11, 20, 30, 42, 55, 95];
    let g = 5;
    for (let i = 0; i < spans.length; i++) {
      if (spd <= spans[i]) { g = i; break; }
    }
    const lo = g === 0 ? 0 : spans[g - 1], hi = spans[g];
    const inGear = Math.max(0, Math.min(1, (spd - lo) / Math.max(0.1, hi - lo)));
    const base = 42 + inGear * 165 + this.throttleVis * 18 + (this.boosting ? 26 : 0);
    a.o1.frequency.setTargetAtTime(base, t, 0.05);
    a.o2.frequency.setTargetAtTime(base * 1.005 + 2, t, 0.05);
    a.o3.frequency.setTargetAtTime(base * 0.5, t, 0.05);
    a.filt.frequency.setTargetAtTime(320 + inGear * 2300 + this.throttleVis * 900, t, 0.08);
    a.engGain.gain.setTargetAtTime(0.05 + this.throttleVis * 0.075 + inGear * 0.03, t, 0.09);
    a.wGain.gain.setTargetAtTime(Math.pow(spd / 60, 2) * 0.2 + (offroad ? 0.02 : 0), t, 0.2);
    // tire scrub when loaded up laterally
    const latG = Math.abs(this.yawSm * spd);
    a.sGain.gain.setTargetAtTime(Math.min(0.12, Math.max(0, latG - 9) * 0.012), t, 0.08);
  }
}
