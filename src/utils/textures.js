import * as THREE from 'three';
import { mulberry32 } from './math.js';

// All textures are procedural canvas-based — no external assets, crisp + tileable.

function makeCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function grassDetailTexture() {
  return makeCanvas(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(42);
    ctx.fillStyle = '#5a7a3a';
    ctx.fillRect(0, 0, w, h);
    // large mottling
    for (let i = 0; i < 900; i++) {
      const x = rnd() * w, y = rnd() * h, r = 4 + rnd() * 22;
      const g = 90 + rnd() * 70, rr = 70 + rnd() * 50;
      ctx.fillStyle = `rgba(${rr|0},${g|0},${40 + rnd() * 30|0},0.16)`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
    // fine blades
    for (let i = 0; i < 9000; i++) {
      const x = rnd() * w, y = rnd() * h;
      const l = 2 + rnd() * 5, a = rnd() * Math.PI;
      const shade = 60 + rnd() * 110;
      ctx.strokeStyle = `rgba(${shade*0.6|0},${shade|0},${shade*0.35|0},0.55)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l - 2);
      ctx.stroke();
    }
  });
}

export function asphaltTexture() {
  // u across road (0..1): edge lines + double center. v along road repeats.
  // 1024px tile ≈ 7.5 m × 9 m — dense aggregate, polished wheel tracks,
  // heavily worn markings. Large unique damage lives in decal geometry.
  return makeCanvas(1024, 1024, (ctx, w, h) => {
    const rnd = mulberry32(7);
    ctx.fillStyle = '#333338';
    ctx.fillRect(0, 0, w, h);
    // layered aggregate speckle — ultra detailed
    for (let i = 0; i < 42000; i++) {
      const x = rnd() * w, y = rnd() * h;
      const v = 32 + rnd() * 62;
      ctx.fillStyle = `rgba(${v|0},${v|0},${(v+5)|0},${0.5 + rnd()*0.5})`;
      const s = rnd() < 0.06 ? 2.2 : 1.2;
      ctx.fillRect(x, y, s, s);
    }
    // pale quartz flecks that catch the sun
    for (let i = 0; i < 1600; i++) {
      const v = 120 + rnd() * 80;
      ctx.fillStyle = `rgba(${v|0},${v|0},${v|0},${0.25 + rnd()*0.4})`;
      ctx.fillRect(rnd()*w, rnd()*h, 1.4, 1.4);
    }
    // dark pores / air holes
    for (let i = 0; i < 2200; i++) {
      const x = rnd()*w, y=rnd()*h, r=1+rnd()*2.6;
      ctx.fillStyle = `rgba(14,14,18,0.4)`;
      ctx.beginPath(); ctx.arc(x,y,r,0,7); ctx.fill();
    }
    // polished wheel tracks (darker, will also be smoother in roughness map)
    const tracks = (cx, wd) => {
      const g2 = ctx.createLinearGradient(w*cx-wd, 0, w*cx+wd, 0);
      g2.addColorStop(0, 'rgba(0,0,0,0)');
      g2.addColorStop(0.5, 'rgba(12,12,15,0.30)');
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(w*cx-wd, 0, wd*2, h);
    };
    tracks(0.30, w*0.09); tracks(0.70, w*0.09);
    // faint oil mist down the lane centers
    tracks(0.26, w*0.05); tracks(0.74, w*0.05);

    // edge lines (worn country white)
    ctx.fillStyle = '#e3e0d8';
    ctx.fillRect(w*0.045, 0, 9, h);
    ctx.fillRect(w*0.955-9, 0, 9, h);
    // double center lines
    ctx.fillRect(w*0.472, 0, 10, h);
    ctx.fillRect(w*0.518, 0, 10, h);
    // heavy wear: punch out chips along all paint
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 5200; i++) {
      const zone = rnd();
      let x;
      if (zone < 0.3) x = w*0.045 + rnd()*10;
      else if (zone < 0.6) x = w*0.955-9 + rnd()*10;
      else if (zone < 0.8) x = w*0.472 + rnd()*10;
      else x = w*0.518 + rnd()*10;
      // wheel paths erase paint fastest
      ctx.fillStyle = `rgba(0,0,0,${0.35 + rnd()*0.5})`;
      const s = 1 + rnd()*4;
      ctx.fillRect(x, rnd()*h, s, s*0.7);
    }
    // hairline cracks in the tile (short, so repetition is invisible)
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(12,12,14,0.55)';
    for (let i = 0; i < 26; i++) {
      ctx.lineWidth = 0.8 + rnd()*1.2;
      ctx.beginPath();
      let x = rnd()*w, y = rnd()*h;
      ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) { x += (rnd()-0.5)*36; y += (rnd()-0.5)*36; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  });
}

// Dedicated roughness: polished wheel tracks turn to subtle sunset streaks.
export function asphaltRoughnessTexture() {
  const t = makeCanvas(512, 512, (ctx, w, h) => {
    const rnd = mulberry32(13);
    ctx.fillStyle = '#ececec'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const v = 210 + rnd() * 45;
      ctx.fillStyle = `rgb(${v|0},${v|0},${v|0})`;
      ctx.fillRect(rnd()*w, rnd()*h, 1.5, 1.5);
    }
    const band = (cx, wd, dark) => {
      const g2 = ctx.createLinearGradient(w*cx-wd, 0, w*cx+wd, 0);
      g2.addColorStop(0, 'rgba(0,0,0,0)');
      g2.addColorStop(0.5, dark);
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(w*cx-wd, 0, wd*2, h);
    };
    band(0.30, w*0.10, 'rgba(90,90,90,0.85)');
    band(0.70, w*0.10, 'rgba(90,90,90,0.85)');
    band(0.26, w*0.05, 'rgba(120,120,120,0.7)');
    band(0.74, w*0.05, 'rgba(120,120,120,0.7)');
  });
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// Normal map from blurred noise height — aggregate relief in low sun.
export function asphaltNormalTexture() {
  const S = 256;
  const rnd = mulberry32(29);
  const hz = new Float32Array(S * S);
  for (let i = 0; i < hz.length; i++) hz[i] = rnd();
  // two box-blur passes → smooth lumps, then re-add sharp grain
  for (let p = 0; p < 2; p++) {
    const src = Float32Array.from(hz);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let s = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++)
        s += src[((y + oy + S) % S) * S + ((x + ox + S) % S)];
      hz[y * S + x] = s / 9;
    }
  }
  for (let i = 0; i < hz.length; i++) hz[i] = hz[i] * 0.8 + rnd() * 0.2;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const strength = 2.2;
  const H = (x, y) => hz[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
    const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const inv = 1 / Math.hypot(dx, dy, 1);
    const o = (y * S + x) * 4;
    img.data[o] = (-dx * inv * 0.5 + 0.5) * 255;
    img.data[o + 1] = (-dy * inv * 0.5 + 0.5) * 255;
    img.data[o + 2] = inv * 255;
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function stoneTexture() {
  // Cotswold-style pale dry-stone like the reference wall.
  return makeCanvas(512, 256, (ctx, w, h) => {
    const rnd = mulberry32(99);
    ctx.fillStyle = '#4a4238'; ctx.fillRect(0,0,w,h);
    let y = 0;
    while (y < h) {
      const rh = 24 + rnd()*20;
      let x = -10 + rnd()*20;
      while (x < w) {
        const rw = 30 + rnd()*46;
        const base = 118 + rnd()*52;
        const warm = base + rnd()*16;
        ctx.fillStyle = `rgb(${warm|0},${base*0.96|0},${base*0.87|0})`;
        ctx.beginPath();
        const r = 4;
        if (ctx.roundRect) ctx.roundRect(x+1.5, y+1.5, rw-3, rh-3, r);
        else ctx.rect(x+1.5, y+1.5, rw-3, rh-3);
        ctx.fill();
        // sunlit top edge / shaded bottom for chiselled relief
        ctx.fillStyle = 'rgba(255,250,238,0.20)';
        ctx.fillRect(x+3, y+2.5, rw-6, 2.5);
        ctx.fillStyle = 'rgba(20,12,8,0.30)';
        ctx.fillRect(x+3, y+rh-5, rw-6, 2.5);
        // lichen + speckle
        for (let i=0;i<20;i++){
          ctx.fillStyle = rnd() < 0.12
            ? `rgba(140,150,110,${0.10+rnd()*0.12})`
            : `rgba(30,22,16,${0.06+rnd()*0.12})`;
          ctx.fillRect(x+rnd()*rw, y+rnd()*rh, 1.6, 1.6);
        }
        x += rw;
      }
      y += rh;
    }
  });
}

export function barkTexture() {
  return makeCanvas(256, 256, (ctx,w,h)=>{
    const rnd = mulberry32(5);
    ctx.fillStyle='#4a3b2e'; ctx.fillRect(0,0,w,h);
    for(let i=0;i<160;i++){
      const x=rnd()*w;
      ctx.strokeStyle=`rgba(${20+rnd()*30|0},${15+rnd()*20|0},${10+rnd()*14|0},0.8)`;
      ctx.lineWidth=1+rnd()*3;
      ctx.beginPath();ctx.moveTo(x,0);
      ctx.bezierCurveTo(x+8*rnd(),h*0.3,x-8*rnd(),h*0.6,x+4*rnd(),h);
      ctx.stroke();
    }
  });
}

export function leafSprite() {
  const c=document.createElement('canvas');c.width=c.height=128;
  const ctx=c.getContext('2d');
  const rnd=mulberry32(21);
  for(let i=0;i<900;i++){
    const x=14+rnd()*100,y=14+rnd()*100;
    const g=90+rnd()*110;
    ctx.fillStyle=`rgba(${g*0.45|0},${g|0},${g*0.3|0},0.9)`;
    const r=1+rnd()*3;
    ctx.beginPath();ctx.ellipse(x,y,r,r*1.6,rnd()*3,0,7);ctx.fill();
  }
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;
  return t;
}

export function softDisc() {  const c=document.createElement('canvas');c.width=c.height=128;
  const ctx=c.getContext('2d');
  const g=ctx.createRadialGradient(64,64,4,64,64,62);
  g.addColorStop(0,'rgba(0,0,0,0.55)');g.addColorStop(0.6,'rgba(0,0,0,0.28)');g.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=g;ctx.fillRect(0,0,128,128);
  return new THREE.CanvasTexture(c);
}

// White-ground contact texture for MULTIPLY blending: white = no change,
// dark center = proportional darkening. Unlike alpha-black blobs this reads
// on any surface, moonless tarmac included.
export function multiplyDisc(center = 70) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 128, 128);
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  const cc = `rgb(${center},${center},${center})`;
  g.addColorStop(0, cc); g.addColorStop(0.55, 'rgb(150,150,150)'); g.addColorStop(1, '#ffffff');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function cloudSprite() {
  // Wide, flat, wispy streak — tinted at runtime. Much softer than a blob.
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(11);
  for (let i = 0; i < 90; i++) {
    const x = 30 + rnd() * 452, y = 44 + (rnd() - 0.5) * 44;
    const rx = 26 + rnd() * 70, ry = 6 + rnd() * 13;
    const g = ctx.createRadialGradient(x, y, 1, x, y, rx);
    g.addColorStop(0, 'rgba(255,255,255,0.16)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx); ctx.translate(-x, -y);
    ctx.beginPath(); ctx.arc(x, y, rx, 0, 7); ctx.fill();
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Linear (non-color) micro noise — orange-peel bump for car paint.
export function microBump() {  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(256, 256);
  const rnd = mulberry32(77);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 118 + rnd() * 20;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Billboard alder atlas: 8 canopy variants in a 4x2 grid, alpha cutout.
// Cells 0-5 broadleaf, 6-7 painted spruces (the photo spruces land there).
// Bright/detail paint — per-instance green tints do the hue work.
// (Fallback if model-baked impostors fail; same layout either way.)
export function alderImpostorTexture() {
  return makeCanvas(2048, 1024, (ctx, w, h) => {
    const rnd = mulberry32(700);
    ctx.clearRect(0, 0, w, h);
    const blob = (x, y, r, style) => {
      ctx.fillStyle = style;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.78, (rnd() - 0.5) * 0.6, 0, 7); ctx.fill();
    };
    for (let v = 0; v < 8; v++) {
      const ox = (v % 4) * 512, oy = Math.floor(v / 4) * 512;
      const cx = ox + 256;
      if (v >= 6) {
        // painted spruce: stacked triangular whorls + trunk
        ctx.fillStyle = '#8a6f52';
        ctx.fillRect(cx - 10, oy + 430, 20, 70);
        for (let t = 0; t < 5; t++) {
          const ty = oy + 430 - t * 72, tw = 150 - t * 22;
          const g = 70 + rnd() * 40 + t * 12;
          ctx.fillStyle = `rgba(${g * 0.75 | 0},${g | 0},${g * 0.6 | 0},0.96)`;
          ctx.beginPath();
          ctx.moveTo(cx - tw / 2, ty); ctx.lineTo(cx + tw / 2, ty); ctx.lineTo(cx, ty - 84);
          ctx.closePath(); ctx.fill();
        }
        for (let i = 0; i < 160; i++) {
          const x = cx + (rnd() - 0.5) * 280, y = oy + 120 + rnd() * 330;
          const g = 110 + rnd() * 70;
          blob(x, y, 4 + rnd() * 10, `rgba(${g * 0.75 | 0},${g | 0},${g * 0.62 | 0},0.9)`);
        }
        continue;
      }
      // trunk: warm pale (green instance tint pulls it back to bark brown)
      ctx.fillStyle = '#b99878';
      ctx.beginPath();
      ctx.moveTo(cx - 13, oy + 500); ctx.lineTo(cx - 8, oy + 300);
      ctx.lineTo(cx + 8, oy + 300); ctx.lineTo(cx + 13, oy + 500);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#a08060';
      ctx.fillRect(cx - 26, oy + 330, 52, 10); // branch bar
      // canopy mass: dark core → mid → sunlit rim, with sky holes
      const top = oy + 120 + (v % 3) * 25, spread = 165 - (v % 2) * 20;
      for (let i = 0; i < 90; i++) {
        const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.6) * spread;
        const x = cx + Math.cos(a) * r, y = top + 90 + Math.sin(a) * r * 0.72;
        const g = 60 + rnd() * 50;
        blob(x, y, 14 + rnd() * 26, `rgba(${g * 0.8 | 0},${g | 0},${g * 0.62 | 0},0.95)`);
      }
      for (let i = 0; i < 170; i++) {
        const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.7) * spread;
        const x = cx + Math.cos(a) * r, y = top + 90 + Math.sin(a) * r * 0.72;
        const g = 105 + rnd() * 60;
        blob(x, y, 8 + rnd() * 18, `rgba(${g * 0.78 | 0},${g | 0},${g * 0.66 | 0},0.95)`);
      }
      for (let i = 0; i < 120; i++) {
        const a = rnd() * Math.PI * 2, r = 0.55 + rnd() * 0.45;
        const x = cx + Math.cos(a) * r * spread, y = top + 90 - Math.abs(Math.sin(a)) * r * spread * 0.6 - 20;
        const g = 185 + rnd() * 55;
        blob(x, y, 6 + rnd() * 13, `rgba(${g | 0},${g | 0},${g * 0.88 | 0},0.95)`);
      }
    }
  });
}
// Grass blade surface: vertical growth gradient, pale center vein, dark
// edges, fine speckle. Carries the green hue; geometry vertex colors add AO.
export function grassBladeTexture() {
  return makeCanvas(128, 256, (ctx, w, h) => {
    const rnd = mulberry32(500);
    const grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0.0, '#2c4016');
    grad.addColorStop(0.4, '#4a6a24');
    grad.addColorStop(0.75, '#628531');
    grad.addColorStop(1.0, '#89ab49');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    // pale center vein
    const vein = ctx.createLinearGradient(w * 0.38, 0, w * 0.62, 0);
    vein.addColorStop(0, 'rgba(255,255,230,0)');
    vein.addColorStop(0.5, 'rgba(255,255,225,0.28)');
    vein.addColorStop(1, 'rgba(255,255,230,0)');
    ctx.fillStyle = vein; ctx.fillRect(w * 0.38, 0, w * 0.24, h);
    // dark cut edges
    const edge = ctx.createLinearGradient(0, 0, w, 0);
    edge.addColorStop(0, 'rgba(10,20,4,0.55)');
    edge.addColorStop(0.12, 'rgba(10,20,4,0)');
    edge.addColorStop(0.88, 'rgba(10,20,4,0)');
    edge.addColorStop(1, 'rgba(10,20,4,0.55)');
    ctx.fillStyle = edge; ctx.fillRect(0, 0, w, h);
    // fine speckle
    for (let i = 0; i < 1400; i++) {
      const v = rnd();
      ctx.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,220,0.08)';
      ctx.fillRect(rnd() * w, rnd() * h, 1, 1 + rnd() * 3);
    }
  });
}
// Dense leaf-cluster surface for broadleaf crowns.
// Bright/detail-only: multiplies vertex + instance color without shifting hue.
// Speckles wrap-drawn so the texture tiles seamlessly.
export function foliageTexture() {
  return makeCanvas(256, 256, (ctx, w, h) => {
    const rnd = mulberry32(300);
    ctx.fillStyle = '#ccd6ba'; ctx.fillRect(0, 0, w, h);
    const dot = (x, y, r, style) => {
      ctx.fillStyle = style;
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
        ctx.beginPath(); ctx.ellipse(x + ox, y + oy, r, r * 0.7, rnd() * 3, 0, 7); ctx.fill();
      }
    };
    // shadow gaps deep in the crown
    for (let i = 0; i < 260; i++) {
      const g = 70 + rnd() * 50;
      dot(rnd() * w, rnd() * h, 2 + rnd() * 5, `rgba(${g*0.75|0},${g|0},${g*0.6|0},0.5)`);
    }
    // mid leaves
    for (let i = 0; i < 1500; i++) {
      const g = 105 + rnd() * 70;
      dot(rnd() * w, rnd() * h, 1 + rnd() * 2.6, `rgba(${g*0.72|0},${g|0},${g*0.62|0},0.85)`);
    }
    // sunlit flecks
    for (let i = 0; i < 420; i++) {
      const g = 200 + rnd() * 55;
      dot(rnd() * w, rnd() * h, 0.8 + rnd() * 1.6, `rgba(${g|0},${g|0},${g*0.92|0},0.9)`);
    }
  });
}

// Fine conifer needle streaks for pine cones. Vertical lines tile both ways.
export function needleTexture() {
  return makeCanvas(256, 256, (ctx, w, h) => {
    const rnd = mulberry32(400);
    ctx.fillStyle = '#bcc7a6'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const x = rnd() * w, y = rnd() * h, l = 4 + rnd() * 10;
      const dark = rnd() < 0.55;
      const g = dark ? 60 + rnd() * 45 : 165 + rnd() * 60;
      ctx.strokeStyle = dark
        ? `rgba(${g*0.7|0},${g|0},${g*0.6|0},0.6)`
        : `rgba(${g|0},${g|0},${g*0.9|0},0.55)`;
      ctx.lineWidth = 0.8 + rnd();
      for (const ox of [-w, 0, w]) {
        ctx.beginPath();
        ctx.moveTo(x + ox, y);
        ctx.lineTo(x + ox + (rnd() - 0.5) * 3, y + l);
        ctx.stroke();
      }
    }
  });
}
