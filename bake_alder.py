"""Bake film-quality Black Alder USD to web-ready GLBs.

Variants (tuned by measured face counts):
  alder_hero_c.glb  full trunk, stride 6      (~90k tris, near-road heroes)
  alder_lod1.glb    trunk@0.12m, stride 8     (~10k tris, forest mass)
  alder_bush.glb    single Twig1 cluster      (~1k tris, bushes)

No textures needed (flat USD materials) — three.js assigns bark/leaf maps.
Usage: python bake_alder.py [VARIANT]   (VARIANT = A, B, C or D; default C)
Requires: pip install usd-core numpy
"""
import json
import struct
import os
import sys
import numpy as np
from pxr import Usd, UsdGeom

VARIANT = (sys.argv[1] if len(sys.argv) > 1 else 'C').upper()
GEN = f'Tree_Black_Alder_Generic_01_{VARIANT}'
SRC = f'tree_black_alder/Tree_Black_Alder_01_{VARIANT}.usd'
ROOT = f'/Tree_Black_Alder_Generic_01_{VARIANT}'
OUTDIR = 'public/trees'

st = Usd.Stage.Open(SRC)
cache = UsdGeom.XformCache(Usd.TimeCode.Default())


def read_mesh(path):
    p = st.GetPrimAtPath(path)
    m = UsdGeom.Mesh(p)
    pts = np.array(m.GetPointsAttr().Get(), dtype=np.float64)
    fvc = np.array(m.GetFaceVertexCountsAttr().Get(), dtype=np.int64)
    fvi = np.array(m.GetFaceVertexIndicesAttr().Get(), dtype=np.int64)
    st_pv = UsdGeom.PrimvarsAPI(p).GetPrimvar('st')
    uv = None
    if st_pv and st_pv.Get():
        raw = np.array(st_pv.Get(), dtype=np.float64)
        if len(raw) == len(pts):
            uv = raw.reshape(-1, 2)
        else:
            uv = np.zeros((len(pts), 2))
            cnt = np.zeros(len(pts))
            for vi, t in zip(fvi, raw.reshape(-1, 2)):
                uv[vi] += t
                cnt[vi] += 1
            cnt[cnt == 0] = 1
            uv /= cnt[:, None]
    offs = np.zeros(len(fvc) + 1, dtype=np.int64)
    offs[1:] = np.cumsum(fvc)
    faces = [fvi[offs[i]:offs[i + 1]] for i in range(len(fvc))]
    return pts, faces, uv


def subset_faces(mesh_path):
    out = {}
    for p in st.GetPrimAtPath(mesh_path).GetChildren():
        if p.GetTypeName() != 'GeomSubset':
            continue
        idx = UsdGeom.Subset(p).GetIndicesAttr().Get()
        kind = 'leaf' if 'TwoSided' in str(p.GetPath()) else 'wood'
        for f in idx:
            out[int(f)] = kind
    return out


def cluster_mesh(pts, faces, uv, grid):
    if not faces:
        return np.zeros((0, 3)), None, []
    key = np.floor(pts / grid).astype(np.int64)
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    new_pts = np.zeros((len(uniq), 3))
    np.add.at(new_pts, inv, pts)
    counts = np.bincount(inv, minlength=len(uniq))
    new_pts /= counts[:, None]
    new_uv = None
    if uv is not None:
        new_uv = np.zeros((len(uniq), 2))
        np.add.at(new_uv, inv, uv)
        new_uv /= counts[:, None]
    new_faces = []
    for f in faces:
        g = [int(inv[v]) for v in f]
        seen, ded = set(), []
        for v in g:
            if v not in seen:
                seen.add(v)
                ded.append(v)
        if len(ded) < 3:
            continue
        for k in range(1, len(ded) - 1):
            a, b, c = ded[0], ded[k], ded[k + 1]
            pa, pb, pc = new_pts[a], new_pts[b], new_pts[c]
            e1, e2 = pb - pa, pc - pa
            if np.linalg.norm(np.cross(e1, e2)) > 1e-12:
                new_faces.append((a, b, c))
    return new_pts, new_uv, new_faces


def quat_to_mat(q):
    w, x, y, z = float(q.GetReal()), *q.GetImaginary()
    n = w * w + x * x + y * y + z * z or 1.0
    s = 2.0 / n
    return np.array([
        [1 - s * (y * y + z * z), s * (x * y - z * w), s * (x * z + y * w)],
        [s * (x * y + z * w), 1 - s * (x * x + z * z), s * (y * z - x * w)],
        [s * (x * z - y * w), s * (y * z + x * w), 1 - s * (x * x + y * y)],
    ])


def xform_mat(prim):
    m = cache.GetLocalToWorldTransform(prim)
    return np.array([[m[r][c] for c in range(4)] for r in range(4)])


TWIG_BASE = ROOT + f'/{GEN}_Instancer/Prototypes/{GEN}/Branches'
PROTOS = ['Twig1_alive', 'Twig2_alive', 'Twig3_alive']

# preload twig prototypes once
_twig_cache = {}


def get_twig(name, leaf_grid, wood_grid):
    key = (name, leaf_grid, wood_grid)
    if key in _twig_cache:
        return _twig_cache[key]
    mp = f'{TWIG_BASE}/{name}/{name}/{name}'
    pts, faces, uv = read_mesh(mp)
    kinds = subset_faces(mp)
    leaf_faces = [f for i, f in enumerate(faces) if kinds.get(i) == 'leaf']
    wood_faces = [f for i, f in enumerate(faces) if kinds.get(i) != 'leaf']
    out = (cluster_mesh(pts, leaf_faces, uv, leaf_grid) +
           cluster_mesh(pts, wood_faces, uv, wood_grid))
    _twig_cache[key] = out
    return out


def bake(out, trunk_grid, leaf_grid, wood_grid, stride, bush=None):
    wood_P, wood_UV, wood_F = [], [], []
    leaf_P, leaf_UV, leaf_F = [], [], []
    wood_off = leaf_off = 0

    def emit(P_list, UV_list, F_list, sp, suv, sf, M, off):
        if not sf:
            return off
        hp = np.concatenate([sp, np.ones((len(sp), 1))], 1) @ M.T
        P_list.append(hp[:, :3])
        UV_list.append(suv if suv is not None else np.zeros((len(sp), 2)))
        F_list.extend([(a + off, b + off, c + off) for (a, b, c) in sf])
        return off + len(sp)

    if bush:
        lp, luv, lf, wp, wuv, wf = get_twig(bush, leaf_grid, wood_grid)
        M = np.eye(4)
        leaf_off = emit(leaf_P, leaf_UV, leaf_F, lp, luv, lf, M, leaf_off)
        wood_off = emit(wood_P, wood_UV, wood_F, wp, wuv, wf, M, wood_off)
    else:
        # trunk
        trunk_path = ROOT + f'/{GEN}_Geo/{GEN}'
        tp, tf, tuv = read_mesh(trunk_path)
        if trunk_grid:
            tp, tuv, tf = cluster_mesh(tp, tf, tuv, trunk_grid)
            tf = [tuple(int(v) for v in f) for f in tf]
        else:
            tf = [tuple(int(v) for v in f) for f in tf]
        txf = xform_mat(st.GetPrimAtPath(trunk_path))
        tri = []
        for f in tf:
            for k in range(1, len(f) - 1):
                tri.append((int(f[0]), int(f[k]), int(f[k + 1])))
        wood_off = emit(wood_P, wood_UV, wood_F, tp, tuv, tri, txf, wood_off)

        # scattered twigs
        inst_prim = st.GetPrimAtPath(ROOT + f'/{GEN}_Instancer')
        pi = UsdGeom.PointInstancer(inst_prim)
        proto_targets = [str(t) for t in pi.GetPrototypesRel().GetTargets()]
        proto_idx = np.array(pi.GetProtoIndicesAttr().Get(), dtype=np.int64)
        positions = np.array(pi.GetPositionsAttr().Get(), dtype=np.float64)
        orients = pi.GetOrientationsAttr().Get()
        scales = np.array(pi.GetScalesAttr().Get(), dtype=np.float64)
        if scales.ndim == 1:
            scales = np.repeat(scales[:, None], 3, axis=1)
        inst_world = xform_mat(inst_prim)
        proto_mats = []
        for t in proto_targets:
            rel = np.linalg.inv(inst_world) @ xform_mat(st.GetPrimAtPath(t))
            proto_mats.append(rel)
        order = [PROTOS.index(proto_targets[i].split('/')[-1]) for i in range(3)]
        twig_cache = {}
        for inst_i in range(0, len(proto_idx), stride):
            pr = order[proto_idx[inst_i]]
            name = PROTOS[pr]
            if name not in twig_cache:
                twig_cache[name] = get_twig(name, leaf_grid, wood_grid)
            lp, luv, lf, wp, wuv, wf = twig_cache[name]
            R = quat_to_mat(orients[inst_i])
            S = scales[inst_i]
            M = np.eye(4)
            M[:3, :3] = R * S[None, :]
            M[:3, 3] = positions[inst_i]
            M = proto_mats[pr] @ M
            leaf_off = emit(leaf_P, leaf_UV, leaf_F, lp, luv, lf, M, leaf_off)
            wood_off = emit(wood_P, wood_UV, wood_F, wp, wuv, wf, M, wood_off)

    def build(P_list, UV_list, F_list):
        P = np.concatenate(P_list, 0).astype(np.float32)
        UV = np.concatenate(UV_list, 0).astype(np.float32)
        F = np.array(F_list, dtype=np.uint32)
        N = np.zeros_like(P)
        v0, v1, v2 = P[F[:, 0]], P[F[:, 1]], P[F[:, 2]]
        fn = np.cross(v1 - v0, v2 - v0)
        for k in range(3):
            np.add.at(N, F[:, k], fn)
        L = np.linalg.norm(N, axis=1, keepdims=True)
        L[L < 1e-12] = 1.0
        return P, (N / L).astype(np.float32), UV, F

    wood = build(wood_P, wood_UV, wood_F)
    leaf = build(leaf_P, leaf_UV, leaf_F)
    print(f'{out}: wood {len(wood_F)} tris, leaf {len(leaf_F)} tris')
    write_glb(out, [('alderWood', *wood, False), ('alderLeaf', *leaf, True)])


def write_glb(path, meshes):
    blob = bytearray()
    views, accs, mesh_defs, mats = [], [], [], []

    def push(arr, target):
        nonlocal_blob = blob
        pad = (-len(nonlocal_blob)) % 4
        nonlocal_blob.extend(b'\x00' * pad)
        views.append({'buffer': 0, 'byteOffset': len(nonlocal_blob),
                      'byteLength': arr.nbytes, 'target': target})
        nonlocal_blob.extend(arr.tobytes())
        return len(views) - 1

    for mi, (name, P, N, UV, F, ds) in enumerate(meshes):
        use16 = len(P) < 65536
        Fi = F.astype(np.uint16 if use16 else np.uint32)
        vP, vN, vUV, vF = push(P, 34962), push(N, 34962), push(UV, 34962), push(Fi, 34963)
        accs.extend([
            {'bufferView': vP, 'componentType': 5126, 'count': len(P), 'type': 'VEC3',
             'min': [float(x) for x in P.min(0)], 'max': [float(x) for x in P.max(0)]},
            {'bufferView': vN, 'componentType': 5126, 'count': len(N), 'type': 'VEC3'},
            {'bufferView': vUV, 'componentType': 5126, 'count': len(UV), 'type': 'VEC2'},
            {'bufferView': vF, 'componentType': 5123 if use16 else 5125,
             'count': int(Fi.size), 'type': 'SCALAR'},
        ])
        prim = {'attributes': {'POSITION': len(accs) - 4, 'NORMAL': len(accs) - 3,
                               'TEXCOORD_0': len(accs) - 2},
                'indices': len(accs) - 1, 'material': mi}
        mesh_defs.append({'name': name, 'primitives': [prim]})
        mats.append({'name': name + '_mat', 'doubleSided': bool(ds),
                     'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1],
                                              'roughnessFactor': 0.9, 'metallicFactor': 0.0}})

    doc = {'asset': {'version': '2.0', 'generator': 'alder-baker'},
           'scene': 0, 'scenes': [{'nodes': [0]}],
           'nodes': [{'children': [1, 2], 'name': 'alder'},
                     {'mesh': 0, 'name': 'wood'}, {'mesh': 1, 'name': 'leaf'}],
           'meshes': mesh_defs, 'materials': mats,
           'bufferViews': views, 'accessors': accs,
           'buffers': [{'byteLength': len(blob)}]}
    js = json.dumps(doc).encode()
    js += b' ' * ((-len(js)) % 4)
    glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob) + ((-len(blob)) % 4))
    glb += struct.pack('<II', len(js), 0x4E4F534A) + js
    pad = (-len(blob)) % 4
    glb += struct.pack('<II', len(blob) + pad, 0x004E4942) + bytes(blob) + b'\x00' * pad
    with open(path, 'wb') as f:
        f.write(glb)


os.makedirs(OUTDIR, exist_ok=True)
VL = VARIANT.lower()
# per-variant LOD tuning — denser variants get stronger thinning (same ~15k budget)
LOD_PRESETS = {
    'A': (0.22, 0.11, 0.14, 16),
    'B': (0.12, 0.07, 0.08, 10),
    'C': (0.12, 0.06, 0.08, 8),
    'D': (0.18, 0.10, 0.12, 16),
}
if VARIANT == 'C':
    bake(f'{OUTDIR}/alder_hero_c.glb', None, 0.03, 0.035, 6)
    tg, lg, wg, std = LOD_PRESETS['C']
    bake(f'{OUTDIR}/alder_lod1.glb', tg, lg, wg, std, bush=None)
    bake(f'{OUTDIR}/alder_bush.glb', None, 0.035, 0.05, 1, bush='Twig1_alive')
else:
    tg, lg, wg, std = LOD_PRESETS[VARIANT]
    bake(f'{OUTDIR}/alder_lod1_{VL}.glb', tg, lg, wg, std, bush=None)

for f in [f'{OUTDIR}/alder_hero_c.glb', f'{OUTDIR}/alder_lod1.glb',
          f'{OUTDIR}/alder_bush.glb', f'{OUTDIR}/alder_lod1_{VL}.glb']:
    if os.path.exists(f):
        print(f, round(os.path.getsize(f) / 1e6, 2), 'MB')
