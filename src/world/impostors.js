import * as THREE from 'three';
import { alderImpostorTexture } from '../utils/textures.js';

// Renders the real baked tree models offscreen into atlas cells 0-3,
// composites the photographed alders into cells 4-5 and the spruces
// (flood-cut) into cells 6-7. Same engine, same materials, same lights —
// billboards match the 3D forest. Missing photos backfill painted.
export async function bakeImpostorAtlas(renderer, variants, mats, photos = [], cell = 512) {
  const rt = new THREE.WebGLRenderTarget(cell, cell, { samples: 4 });
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(18, 1, 0.5, 200);
  cam.position.set(0, 8, 57);
  cam.lookAt(0, 8, 0);
  scene.add(new THREE.HemisphereLight(new THREE.Color('#cfd8e8'), new THREE.Color('#3a4a2f'), 1.05));
  const key = new THREE.DirectionalLight(new THREE.Color('#ffe2b2'), 2.4);
  key.position.set(8, 24, 42); // near-frontal: bakes flat, disagrees with no sun angle
  scene.add(key);

  const woodMesh = new THREE.Mesh(variants[0].woodGeo, mats.woodMat);
  const leafMesh = new THREE.Mesh(variants[0].leafGeo, mats.leafMat);
  const group = new THREE.Group();
  group.add(woodMesh, leafMesh);
  scene.add(group);

  const COLS = 4;
  const atlas = document.createElement('canvas');
  atlas.width = cell * COLS;
  atlas.height = cell * 2;
  const ctx = atlas.getContext('2d');
  const px = new Uint8Array(cell * cell * 4);
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = cell;
  const tctx = tmp.getContext('2d');
  const cellXY = (ci) => [(ci % COLS) * cell, Math.floor(ci / COLS) * cell];

  const prevTarget = renderer.getRenderTarget();
  const prevClear = new THREE.Color();
  renderer.getClearColor(prevClear);
  const prevAlpha = renderer.getClearAlpha();
  try {
    for (let v = 0; v < 4; v++) {
      const V = variants[v] || variants[0];
      woodMesh.geometry = V.woodGeo;
      leafMesh.geometry = V.leafGeo;
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, cell, cell, px);
      const img = tctx.createImageData(cell, cell);
      img.data.set(px);
      tctx.putImageData(img, 0, 0);
      // GL pixels are bottom-up; atlas cells are top-down.
      const [cx, cy] = cellXY(v);
      ctx.save();
      ctx.translate(cx, cy + cell);
      ctx.scale(1, -1);
      ctx.drawImage(tmp, 0, 0);
      ctx.restore();
    }
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    rt.dispose();
  }

  // Photo cells 4-7 (or painted backfill when a photo is missing).
  const fallback = alderImpostorTexture();
  const fc = fallback.image;
  const wanted = [
    { img: photos[0] && photos[0].img, bg: 'black' },
    { img: photos[1] && photos[1].img, bg: 'white' },
    { img: photos[2] && photos[2].img, flood: 'white' },
    { img: photos[3] && photos[3].img, flood: 'black' },
  ];
  wanted.forEach((w, k) => {
    const cellIndex = 4 + k;
    const [cx, cy] = cellXY(cellIndex);
    if (w.img && w.flood) {
      const cut = floodCutout(w.img, w.flood);
      if (cut) blitCell(ctx, cx, cy, cell, cut, {});
      else ctx.drawImage(fc, 0, 0, 512, 512, cx, cy, cell, cell);
    }
    else if (w.img) compositePhoto(ctx, cx, cy, cell, w.img, w.bg);
    else ctx.drawImage(fc, 0, 0, 512, 512, cx, cy, cell, cell);
  });

  const tex = new THREE.CanvasTexture(atlas);
  tex.anisotropy = 4;
  return tex;
}

// Luma-key a cutout photo (black or white studio backdrop) into an atlas
// cell: auto-crop to content, un-premultiply fringe, contain-fit, warm grade.
function compositePhoto(ctx, cx, cy, cell, img, bg) {
  const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
  const work = document.createElement('canvas');
  work.width = sw; work.height = sh;
  const wctx = work.getContext('2d', { willReadFrequently: true });
  wctx.drawImage(img, 0, 0);
  const data = wctx.getImageData(0, 0, sw, sh);
  const d = data.data;
  let x0 = sw, y0 = sh, x1 = 0, y1 = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    let a;
    if (bg === 'black') {
      const m = Math.max(r, g, b);
      a = Math.max(0, Math.min(1, (m - 10) / 30));
    } else {
      const m = Math.min(r, g, b);
      a = Math.max(0, Math.min(1, (245 - m) / 30));
    }
    if (a > 0.05) {
      // un-premultiply against the known backdrop to kill halo fringe
      const inv = 1 - a;
      let nr = r, ng = g, nb = b;
      if (bg === 'black') { nr = r / Math.max(a, 1e-3); ng = g / Math.max(a, 1e-3); nb = b / Math.max(a, 1e-3); }
      else {
        nr = (r - inv * 255) / Math.max(a, 1e-3);
        ng = (g - inv * 255) / Math.max(a, 1e-3);
        nb = (b - inv * 255) / Math.max(a, 1e-3);
      }
      d[i] = Math.max(0, Math.min(255, nr));
      d[i + 1] = Math.max(0, Math.min(255, ng));
      d[i + 2] = Math.max(0, Math.min(255, nb));
      d[i + 3] = Math.round(a * 255);
      const pxI = (i / 4) | 0, xx = pxI % sw, yy = (pxI / sw) | 0;
      if (xx < x0) x0 = xx; if (xx > x1) x1 = xx;
      if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
    } else {
      d[i + 3] = 0;
    }
  }
  wctx.putImageData(data, 0, 0);
  if (x1 <= x0 || y1 <= y0) return; // nothing keyed — leave cell transparent
  const pad = 8;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(sw - 1, x1 + pad); y1 = Math.min(sh - 1, y1 + pad);
  const cw = x1 - x0, ch = y1 - y0;
  const fit = Math.min(cell / cw, cell / ch);
  const dw = cw * fit, dh = ch * fit;
  ctx.save();
  // Hard sunset grade: noon photos meet the warm dim model renders halfway.
  ctx.filter = 'brightness(0.9) saturate(1.12) sepia(0.38)';
  // BOTTOM-ANCHOR: trunk base lands exactly on the quad's bottom edge
  // (= terrain level). Centering would leave trees floating in mid-air.
  ctx.drawImage(work, x0, y0, cw, ch, cx + (cell - dw) / 2, cy + (cell - dh), dw, dh);
  ctx.restore();
}

// ---- Groundcover pipeline (bush + grass photos) ----

// Flood-fill background removal: BFS from the borders through
// backdrop-colored pixels. Kills isolated noise specks that luma
// thresholding would leave floating, and handles JPEG-fringed edges.
export function floodCutout(img, bg) {
  const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
  const work = document.createElement('canvas');
  work.width = sw; work.height = sh;
  const wctx = work.getContext('2d', { willReadFrequently: true });
  wctx.drawImage(img, 0, 0);
  const data = wctx.getImageData(0, 0, sw, sh);
  const d = data.data;
  const bgness = (i) => bg === 'black'
    ? Math.max(d[i], d[i + 1], d[i + 2])
    : 255 - Math.min(d[i], d[i + 1], d[i + 2]);
  const isBg = (x, y) => {
    if (x < 0 || y < 0 || x >= sw || y >= sh) return false;
    const i = (y * sw + x) * 4;
    return bgness(i) < 26;
  };
  const mask = new Uint8Array(sw * sh); // 1 = backdrop
  const stack = [];
  for (let x = 0; x < sw; x++) {
    if (isBg(x, 0)) { mask[x] = 1; stack.push(x); }
    if (isBg(x, sh - 1)) { mask[(sh - 1) * sw + x] = 1; stack.push((sh - 1) * sw + x); }
  }
  for (let y = 0; y < sh; y++) {
    if (isBg(0, y)) { mask[y * sw] = 1; stack.push(y * sw); }
    if (isBg(sw - 1, y)) { mask[y * sw + sw - 1] = 1; stack.push(y * sw + sw - 1); }
  }
  while (stack.length) {
    const p = stack.pop();
    const x = p % sw, y = (p / sw) | 0;
    const nb = [p - 1, p + 1, p - sw, p + sw];
    const nxy = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (let k = 0; k < 4; k++) {
      const q = nb[k];
      if (nxy[k][0] < 0 || nxy[k][1] < 0 || nxy[k][0] >= sw || nxy[k][1] >= sh) continue;
      if (!mask[q] && isBg(nxy[k][0], nxy[k][1])) { mask[q] = 1; stack.push(q); }
    }
  }
  let x0 = sw, y0 = sh, x1 = 0, y1 = 0;
  const rim = new Uint8Array(sw * sh); // content pixels touching backdrop
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const p = y * sw + x, i = p * 4;
    if (mask[p]) { d[i + 3] = 0; continue; }
    if (x > 0 && mask[p - 1] || x < sw - 1 && mask[p + 1] || y > 0 && mask[p - sw] || y < sh - 1 && mask[p + sw]) {
      rim[p] = 1;
    }
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  // un-premultiply rim fringe against the known backdrop color
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const p = y * sw + x;
    if (!rim[p]) continue;
    const i = p * 4;
    const a = bg === 'black'
      ? Math.max(0, Math.min(1, (Math.max(d[i], d[i + 1], d[i + 2]) - 6) / 40))
      : Math.max(0, Math.min(1, ((255 - Math.min(d[i], d[i + 1], d[i + 2])) - 6) / 40));
    const inv = 1 - a;
    let nr = d[i], ng = d[i + 1], nb2 = d[i + 2];
    if (bg === 'black') { nr = d[i] / Math.max(a, 1e-3); ng = d[i + 1] / Math.max(a, 1e-3); nb2 = d[i + 2] / Math.max(a, 1e-3); }
    else {
      nr = (d[i] - inv * 255) / Math.max(a, 1e-3);
      ng = (d[i + 1] - inv * 255) / Math.max(a, 1e-3);
      nb2 = (d[i + 2] - inv * 255) / Math.max(a, 1e-3);
    }
    d[i] = Math.max(0, Math.min(255, nr));
    d[i + 1] = Math.max(0, Math.min(255, ng));
    d[i + 2] = Math.max(0, Math.min(255, nb2));
    d[i + 3] = Math.round(a * 255);
  }
  wctx.putImageData(data, 0, 0);
  if (x1 <= x0 || y1 <= y0) return null;
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(sw - 1, x1 + pad); y1 = Math.min(sh - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0; out.height = y1 - y0;
  out.getContext('2d').drawImage(work, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

// Luma-key cutout → tightly cropped canvas (sRGB bytes, halo-corrected).
export function keyCutout(img, bg) {
  const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
  const work = document.createElement('canvas');
  work.width = sw; work.height = sh;
  const wctx = work.getContext('2d', { willReadFrequently: true });
  wctx.drawImage(img, 0, 0);
  const data = wctx.getImageData(0, 0, sw, sh);
  const d = data.data;
  let x0 = sw, y0 = sh, x1 = 0, y1 = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const m = bg === 'black' ? Math.max(r, g, b) : Math.min(r, g, b);
    const a = bg === 'black'
      ? Math.max(0, Math.min(1, (m - 10) / 30))
      : Math.max(0, Math.min(1, (245 - m) / 30));
    if (a > 0.05) {
      const inv = 1 - a;
      let nr = r, ng = g, nb = b;
      if (bg === 'black') { nr = r / Math.max(a, 1e-3); ng = g / Math.max(a, 1e-3); nb = b / Math.max(a, 1e-3); }
      else {
        nr = (r - inv * 255) / Math.max(a, 1e-3);
        ng = (g - inv * 255) / Math.max(a, 1e-3);
        nb = (b - inv * 255) / Math.max(a, 1e-3);
      }
      d[i] = Math.max(0, Math.min(255, nr));
      d[i + 1] = Math.max(0, Math.min(255, ng));
      d[i + 2] = Math.max(0, Math.min(255, nb));
      d[i + 3] = Math.round(a * 255);
      const pxI = (i / 4) | 0, xx = pxI % sw, yy = (pxI / sw) | 0;
      if (xx < x0) x0 = xx; if (xx > x1) x1 = xx;
      if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
    } else {
      d[i + 3] = 0;
    }
  }
  wctx.putImageData(data, 0, 0);
  if (x1 <= x0 || y1 <= y0) return null;
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(sw - 1, x1 + pad); y1 = Math.min(sh - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0; out.height = y1 - y0;
  out.getContext('2d').drawImage(work, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

// Crop to existing alpha (for PNGs that already carry transparency).
export function alphaCutout(img, thresh = 12) {
  const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
  const work = document.createElement('canvas');
  work.width = sw; work.height = sh;
  const wctx = work.getContext('2d', { willReadFrequently: true });
  wctx.drawImage(img, 0, 0);
  const d = wctx.getImageData(0, 0, sw, sh).data;
  let x0 = sw, y0 = sh, x1 = 0, y1 = 0;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] > thresh) {
      const pxI = ((i - 3) / 4) | 0, xx = pxI % sw, yy = (pxI / sw) | 0;
      if (xx < x0) x0 = xx; if (xx > x1) x1 = xx;
      if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
    }
  }
  if (x1 <= x0 || y1 <= y0) return null;
  const pad = 4;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(sw - 1, x1 + pad); y1 = Math.min(sh - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0; out.height = y1 - y0;
  out.getContext('2d').drawImage(work, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

// Contain-fit a cutout into an atlas cell, bottom-anchored. toLinear converts
// sRGB photo bytes to linear so the atlas stays color-managed.
export function blitCell(ctx, cx, cy, cell, cropped, { grade = true, flip = false, toLinear = true } = {}) {
  if (!cropped) return;
  const cw = cropped.width, ch = cropped.height;
  const fit = Math.min(cell / cw, cell / ch);
  const dw = cw * fit, dh = ch * fit;
  const dx = cx + (cell - dw) / 2, dy = cy + (cell - dh);
  ctx.save();
  if (grade) ctx.filter = 'brightness(0.9) saturate(1.12) sepia(0.38)';
  if (flip) {
    ctx.translate(cx + cell / 2, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(cropped, 0, 0, cw, ch, (cell - dw) / 2 - cell / 2, dy, dw, dh);
  } else {
    ctx.drawImage(cropped, 0, 0, cw, ch, dx, dy, dw, dh);
  }
  ctx.restore();
  if (toLinear) {
    const data = ctx.getImageData(cx, cy, cell, cell);
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      d[i] = 255 * Math.pow(d[i] / 255, 2.2);
      d[i + 1] = 255 * Math.pow(d[i + 1] / 255, 2.2);
      d[i + 2] = 255 * Math.pow(d[i + 2] / 255, 2.2);
    }
    ctx.putImageData(data, cx, cy);
  }
}

// Bush atlas: keyed photo + mirrored twin (free variety), 2x1.
export function buildBushAtlas(bushImg) {
  if (!bushImg) throw new Error('bush photo missing');
  const cell = 512;
  const atlas = document.createElement('canvas');
  atlas.width = cell * 2; atlas.height = cell;
  const ctx = atlas.getContext('2d');
  const cut = keyCutout(bushImg, 'black');
  if (!cut) throw new Error('bush keying found nothing');
  blitCell(ctx, 0, 0, cell, cut, {});
  blitCell(ctx, cell, 0, cell, cut, { flip: true });
  const tex = new THREE.CanvasTexture(atlas);
  tex.anisotropy = 4;
  return tex;
}

// Grass atlas: alpha-carried tuft + keyed blades, 2x1.
export function buildGrassAtlas(g1Img, g2Img) {
  if (!g1Img || !g2Img) throw new Error('grass photos missing');
  const cell = 512;
  const atlas = document.createElement('canvas');
  atlas.width = cell * 2; atlas.height = cell;
  const ctx = atlas.getContext('2d');
  blitCell(ctx, 0, 0, cell, alphaCutout(g1Img), { grade: false });
  blitCell(ctx, cell, 0, cell, keyCutout(g2Img, 'black'), {});
  const tex = new THREE.CanvasTexture(atlas);
  tex.anisotropy = 4;
  return tex;
}

// Generalized camera-facing billboard material (any cols x rows atlas).
export function makeBillboardMaterial(map, cols, rows, uTimeUniform, swayAmp) {
  const mat = new THREE.MeshLambertMaterial({
    map, alphaTest: 0.45, side: THREE.DoubleSide, envMapIntensity: 0,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTimeUniform;
    sh.vertexShader = ('uniform float uTime;\nattribute float aVariant;\nattribute float aPhase;\n') +
      sh.vertexShader
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          vMapUv = vec2((uv.x + mod(aVariant, ${cols}.0)) / ${cols}.0, (uv.y + (${rows}.0 - 1.0 - floor(aVariant / ${cols}.0))) / ${rows}.0);`)
        .replace('#include <defaultnormal_vertex>', `
          vec4 impC = instanceMatrix * vec4(0., 0., 0., 1.);
          vec3 impLook = cameraPosition - impC.xyz; impLook.y = 0.0;
          impLook = normalize(impLook + vec3(0.0001, 0., 0.));
          vec3 impFace = normalize(cross(vec3(0., 1., 0.), impLook));
          vec3 transformedNormal = normalize((viewMatrix * vec4(impLook, 0.0)).xyz);`)
        .replace('#include <project_vertex>', `
          float impSX = length(instanceMatrix[0].xyz);
          float impSY = length(instanceMatrix[1].xyz);
          float impSway = sin(uTime * 1.3 + aPhase + impC.x * 0.05 + impC.z * 0.04) * ${swayAmp} * uv.y * uv.y;
          vec3 impW = impC.xyz + impFace * position.x * impSX + vec3(0., 1., 0.) * (position.y * impSY + impSway);
          vec4 mvPosition = viewMatrix * vec4(impW, 1.0);
          gl_Position = projectionMatrix * mvPosition;`);
  };
  return mat;
}
