import * as THREE from 'three';

// Photographed lawn PBR (Grass005 pack): Color + OpenGL Normal + Roughness,
// downscaled for GPU sanity (2K→1K albedo/normal, →512 roughness).
// AO/Displacement maps skipped: we bake our own AO, terrain is geometric.
// Falls back to procedural textures (textures.js) on any failure.
const GROUND_REPEAT = 320; // ≈12.5 m per tile over the valley

function downscale(tex, size, srgb, aniso) {
  const img = tex.image;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d').drawImage(img, 0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(GROUND_REPEAT, GROUND_REPEAT);
  t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.dispose();
  return t;
}

export async function loadGroundTextures(renderer) {
  const base = import.meta.env.BASE_URL || '/';
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const L = new THREE.TextureLoader();
  const [color, normal, rough] = await Promise.all([
    L.loadAsync(base + 'ground/Grass005_2K-JPG_Color.jpg'),
    L.loadAsync(base + 'ground/Grass005_2K-JPG_NormalGL.jpg'),
    L.loadAsync(base + 'ground/Grass005_2K-JPG_Roughness.jpg'),
  ]);
  return {
    map: downscale(color, 1024, true, aniso),
    normalMap: downscale(normal, 1024, false, aniso),
    roughnessMap: downscale(rough, 512, false, aniso),
  };
}
