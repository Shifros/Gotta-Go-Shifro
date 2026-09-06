# Aura Valley — Ultra Realistic Open World Drive

A high-fidelity, free-roam driving game for the browser. Cruise a 4 km × 4 km
(16 km²) sunset valley in a detailed GT coupe: winding valley loop, dry-stone
walls, wind-blown meadows, broadleaf + pine forests, wildflowers, haze, ghost
traffic and a full day-cycle — all procedural, zero external assets.

Inspired by the reference shot: pink sunset sky, rolling green hills, stone
wall on the left, tall grass + daffodils on the right, white coupe on a
winding asphalt loop with the minimal `31.5 KILOMETERS / 60.0 KM/H / AUTOSTEER`
HUD.

## Run it

```bash
npm install
npm run dev      # → http://localhost:5173
```

Production build:

```bash
npm run build
npm run preview  # → http://localhost:4173
```

No build step is strictly required for the source — it is standard Vite + Three.js
ES modules.

## Real-world assets (yours, wired in)

| Pack | Used for | Files served from `public/` |
|---|---|---|
| `tree-01/02.png`, `bush-01.png`, `grass-01/02.png` | Photo billboard layers: keyed/cropped into atlases at boot (trees join the 3×2 impostor atlas, bush + grass get their own) — 4k bushes + 6k grass clumps for ~2 extra draw calls | `public/trees/`, `public/ground/` |
|---|---|---|
| `EveningSkyHDRI032A_2K` | Image-based lighting (all PBR reflections), the visible sky itself, auto-matched sun position/color, fog + haze tint | `public/hdri/*.exr` (+ tonemapped JPG as loading backdrop) |
| `Grass005_2K-JPG` | Terrain albedo + OpenGL normal + roughness (downscaled to 1K/1K/512 for GPU sanity). AO/Displacement skipped — we bake our own AO and the terrain is already geometric | `public/ground/*.jpg` |
| `tree_black_alder` (USD) | Baked via `bake_alder.py` (OpenUSD + numpy) into `public/trees/alder_hero_c.glb` — 90k-tri hero specimens planted near the road. Full 57M-face scatter is unusable on any GPU, so the stylized forest carries the background mass | `public/trees/*.glb` |

All three degrade gracefully: if an asset fails to load, the procedural
fallback (shader sky, canvas turf, stylized trees) takes over silently.

Re-bake the alder with `python bake_alder.py [A|B|C|D]` (requires `pip install usd-core numpy`).
Tune `LOD_PRESETS` in that file for size vs fidelity. All four variants ship
as LODs (`alder_lod1[_a|_b|_d].glb`); at boot each one is rendered offscreen
into a 4-cell impostor atlas (`src/world/impostors.js`), so the 3,500 grove
billboards are exact renders of your models — painted canvas fallback included.

## Controls

| Key | Action |
|---|---|
| `W / ↑` | Throttle |
| `S / ↓` | Brake / reverse |
| `A D / ← →` | Steer |
| `SPACE` | Handbrake |
| `G` | Autosteer cruise (60 km/h, like the reference) |
| `C` | Camera: Chase / Sport / Hood |
| `R` | Reset to road |
| `H` | Headlights |
| `M` | Sound on/off |

Free roam: leave the tarmac anywhere — meadows, hills and forest floor are all
drivable with reduced grip. Touch controls appear on mobile.

## Tech

- `three@0.160` — PBR + clear-coat paint, ACES tone mapping, PCF soft shadows,
  PMREM room environment for reflections.
- Procedural everything: FBM valley heightfield with road-corridor flattening,
  Catmull-Rom loop road with crowned asphalt + worn markings, granite wall +
  fence, gradient sunset sky shader with animated clouds, instanced broadleaf /
  pine / bushes / flowers / 26k wind-swayed grass tufts.
- Arcade vehicle model: speed-sensitive steering, slope + surface drag,
  handbrake slides, suspension roll/pitch/bounce, tree + wall collision,
  chase/hood cameras with terrain clamping, procedural engine + wind audio.
- HUD: odometer, speed + cruise cap, live steering-path preview, circular
  minimap, WORLD / STYLE / VEHICLE panels (time-of-day, mist, exposure,
  paint, quality, ghosts).

## Structure

```
index.html            HUD + loading + importmap
src/main.js           boot + game loop + quality governor
src/styles.css        sunset-glass UI
src/utils/math.js     seeded noise / fbm
src/utils/textures.js canvas textures (asphalt, grass, stone, bark…)
src/world/terrain.js  16 km² heightfield + far mountain rings
src/world/road.js     valley loop + shoulders + stone wall
src/world/environment.js sky shader, sun/fog, clouds, day cycle
src/world/vegetation.js instanced forests, grass, flowers
src/vehicle/carFactory.js detailed GT coupe + ghost cars
src/vehicle/controller.js physics, camera, audio, traffic
src/ui/hud.js         speed/odo, steer preview, minimap, toasts
```
