"""Build articulated 3D cartoon-plushie cat & dog rigs, semantic UV templates,
plush fur breed skins, and soft contact shadow for Cocos Creator 3.8.8.

Architecture:
- ONE shared articulated 3D base rig for all cats (assets/resources/pets/cat-rig.json)
- ONE shared articulated 3D base rig for all dogs (assets/resources/pets/dog-rig.json)
- Adding any new cat or dog breed later only requires a 1024x1024 skin PNG matching
  the standardized 4-quadrant semantic UV layout + a matching avatar PNG!
"""
from __future__ import annotations

import json
import math
import random
import uuid
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
PETS_DIR = ROOT / "assets" / "resources" / "pets"
SKINS_DIR = PETS_DIR / "skins"
GEN_DIR = ROOT / "art" / "generated"

TEX_SIZE = 1024


def clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    if edge0 == edge1:
        return 0.0
    t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def lerp_rgb(c1, c2, t: float):
    t = clamp(t, 0.0, 1.0)
    return (
        int(round(c1[0] + (c2[0] - c1[0]) * t)),
        int(round(c1[1] + (c2[1] - c1[1]) * t)),
        int(round(c1[2] + (c2[2] - c1[2]) * t)),
    )


def hex_rgb(h: str):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def vec_norm(x: float, y: float, z: float):
    l = math.sqrt(x * x + y * y + z * z)
    if l < 1e-9:
        return (0.0, 1.0, 0.0)
    return (x / l, y / l, z / l)


def signed_volume(positions: list[float], indices: list[int]) -> float:
    """Compute signed volume (x6) of a closed mesh to verify outward CCW winding."""
    vol = 0.0
    for i in range(0, len(indices), 3):
        a, b, c = indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3
        ax, ay, az = positions[a], positions[a + 1], positions[a + 2]
        bx, by, bz = positions[b], positions[b + 1], positions[b + 2]
        cx, cy, cz = positions[c], positions[c + 1], positions[c + 2]
        vol += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)
    return vol


def ensure_outward_winding(positions: list[float], indices: list[int]) -> list[int]:
    if signed_volume(positions, indices) < 0.0:
        out = indices[:]
        for i in range(0, len(out), 3):
            out[i + 1], out[i + 2] = out[i + 2], out[i + 1]
        return out
    return indices


def compute_smooth_normals(positions: list[float], indices: list[int]) -> list[float]:
    n_verts = len(positions) // 3
    nx = [0.0] * n_verts
    ny = [0.0] * n_verts
    nz = [0.0] * n_verts
    for i in range(0, len(indices), 3):
        a, b, c = indices[i], indices[i + 1], indices[i + 2]
        ax, ay, az = positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2]
        bx, by, bz = positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2]
        cx, cy, cz = positions[c * 3], positions[c * 3 + 1], positions[c * 3 + 2]
        e1x, e1y, e1z = bx - ax, by - ay, bz - az
        e2x, e2y, e2z = cx - ax, cy - ay, cz - az
        fx = e1y * e2z - e1z * e2y
        fy = e1z * e2x - e1x * e2z
        fz = e1x * e2y - e1y * e2x
        nx[a] += fx; ny[a] += fy; nz[a] += fz
        nx[b] += fx; ny[b] += fy; nz[b] += fz
        nx[c] += fx; ny[c] += fy; nz[c] += fz
    out: list[float] = []
    for i in range(n_verts):
        ux, uy, uz = vec_norm(nx[i], ny[i], nz[i])
        out.extend((round(ux, 5), round(uy, 5), round(uz, 5)))
    return out


def plush_vertex_color(nx: float, ny: float, nz: float, ao: float = 1.0, unshaded: bool = False):
    """Warm cozy plushie-clay wrapped lighting baked into vertex colors.
    Decoupled from breed fur albedo so every reskin gets soft 3D volume!
    """
    if unshaded:
        return (1.0, 1.0, 1.0, 1.0)
    # Soft sunny key light from top-front-left matching garden.png
    lx, ly, lz = vec_norm(-0.28, 0.86, 0.42)
    ndotl = nx * lx + ny * ly + nz * lz
    wrap = clamp(ndotl * 0.5 + 0.5, 0.0, 1.0)
    key = 0.80 + 0.22 * (wrap ** 0.72)
    # Soft warm top sunlight + cozy meadow bounce underneath
    rim = 0.035 * smoothstep(0.25, 1.0, ny)
    bounce = 0.045 * smoothstep(0.0, -0.9, ny)
    r = clamp((key + rim + bounce * 0.88) * ao, 0.70, 1.0)
    g = clamp((key + rim * 0.97 + bounce * 0.94) * ao, 0.69, 1.0)
    b = clamp((key * 0.98 + rim * 0.90 + bounce * 0.70) * ao, 0.66, 1.0)
    return (round(r, 4), round(g, 4), round(b, 4), 1.0)


def merge_meshes(parts: list[dict]) -> dict:
    positions: list[float] = []
    normals: list[float] = []
    uvs: list[float] = []
    colors: list[float] = []
    indices: list[int] = []
    offset = 0
    for p in parts:
        positions.extend(p["positions"])
        normals.extend(p["normals"])
        uvs.extend(p["uvs"])
        colors.extend(p["colors"])
        indices.extend(i + offset for i in p["indices"])
        offset += len(p["positions"]) // 3
    return {
        "positions": [round(v, 5) for v in positions],
        "normals": [round(v, 5) for v in normals],
        "uvs": [round(v, 5) for v in uvs],
        "colors": [round(v, 4) for v in colors],
        "indices": indices,
    }


def make_grid_mesh(nu: int, nv: int, eval_fn, ao_fn=None, unshaded: bool = False):
    """Build a smooth parametric grid mesh with guaranteed outward winding, smooth normals & plush shading."""
    positions: list[float] = []
    uvs: list[float] = []
    aos: list[float] = []
    for j in range(nv + 1):
        vf = j / nv
        for i in range(nu + 1):
            uf = i / nu
            x, y, z, u, v = eval_fn(uf, vf)
            positions.extend((x, y, z))
            uvs.extend((u, v))
            aos.append(ao_fn(x, y, z, uf, vf) if ao_fn else 1.0)
    indices: list[int] = []
    stride = nu + 1
    for j in range(nv):
        for i in range(nu):
            a = j * stride + i
            b = a + 1
            c = a + stride
            d = c + 1
            indices.extend((a, c, b, b, c, d))
    indices = ensure_outward_winding(positions, indices)
    normals = compute_smooth_normals(positions, indices)
    colors: list[float] = []
    for k in range(len(positions) // 3):
        c = plush_vertex_color(normals[k * 3], normals[k * 3 + 1], normals[k * 3 + 2], aos[k], unshaded=unshaded)
        colors.extend(c)
    return {
        "positions": [round(v, 5) for v in positions],
        "normals": normals,
        "uvs": [round(v, 5) for v in uvs],
        "colors": colors,
        "indices": indices,
    }


def build_body(kind: str) -> dict:
    """Plump chubby pear-loaf plushie torso (poles at dorsal top +Y and belly bottom -Y -> ZERO rump/chest pinch!).
    UV Quadrant 2: u in [0.53, 0.97], v in [0.03, 0.47]
    - u = 0.75 is FRONT CHEST (+Z), u = 0.53 & 0.97 meet cleanly at center of RUMP (-Z)
    - v = 0.03 is TOP BACK (+Y), v = 0.25 is sides/chest/rump midline, v = 0.47 is BELLY (-Y)
    """
    is_cat = kind == "cat"
    rx_base = 0.64 if is_cat else 0.62
    ry_base = 0.50 if is_cat else 0.49
    rz_base = 0.76 if is_cat else 0.72
    cy = 0.67 if is_cat else 0.66
    cz = -0.10

    def eval_fn(uf: float, vf: float):
        # vf: 0 (+Y top of back) -> 1 (-Y bottom of belly)
        theta = lerp(0.015, math.pi - 0.015, vf)
        # uf: 0 (-pi rump) -> 0.5 (0 front chest +Z) -> 1 (+pi rump)
        az = (uf - 0.5) * 2.0 * math.pi
        st = math.sin(theta)
        ct = math.cos(theta)  # +1 back top, -1 belly bottom
        sa = math.sin(az)
        ca = math.cos(az)  # +1 chest (+Z), -1 rump (-Z)

        # Plump pear-loaf body: slightly fuller at rear flanks & lower belly
        rear_full = 1.0 + 0.09 * smoothstep(0.25, -0.7, ca)
        chest_puff = 1.0 + 0.05 * math.exp(-((ca - 0.75) / 0.35) ** 2)
        x = rx_base * rear_full * st * sa
        y_raw = ry_base * chest_puff * ct
        if y_raw < 0:
            y_raw *= 0.88
        # Gentle cute rounded rump lift
        y_lift = 0.03 * smoothstep(-0.1, -0.85, ca) * (st ** 1.2)
        y = cy + y_raw + y_lift
        z = cz + rz_base * st * ca

        u = 0.53 + uf * 0.44
        v = 0.03 + vf * 0.44
        return x, y, z, u, v

    def ao_fn(x: float, y: float, z: float, uf: float, vf: float):
        ao = lerp(0.86, 1.0, smoothstep(0.20, 0.52, y))
        neck_d = math.hypot(x * 1.1, (y - 0.86) * 1.3, (z - 0.50) * 1.3)
        ao *= lerp(0.90, 1.0, smoothstep(0.18, 0.46, neck_d))
        return ao

    return make_grid_mesh(38, 26, eval_fn, ao_fn)


def build_head(kind: str) -> dict:
    """Adorable sculpted chubby plushie head in HeadPivot local space.
    Matches the exact round chubby-cheek silhouette of our generated avatars!
    UV Quadrant 1: u in [0.03, 0.47], v in [0.03, 0.47]
    - u = 0.25 is dead-center front face (+Z)
    - v = 0.03 is top crown, v = 0.25 is eye/cheek midline, v = 0.47 is chin
    """
    is_cat = kind == "cat"
    rx_base = 0.69 if is_cat else 0.64
    ry_base = 0.58 if is_cat else 0.57
    rz_base = 0.59 if is_cat else 0.59

    def eval_fn(uf: float, vf: float):
        theta = lerp(0.015, math.pi - 0.015, vf)
        az = (uf - 0.5) * 2.0 * math.pi
        st = math.sin(theta)
        ct = math.cos(theta)
        sa = math.sin(az)
        ca = math.cos(az)

        ux = st * sa
        uy = ct
        uz = st * ca

        # 1) Plump chubby lower cheeks (extra kawaii roundness!)
        cheek_band = math.exp(-((uy + 0.24) / 0.42) ** 2)
        cheek_side = (abs(ux) ** 1.15) * smoothstep(-0.35, 0.75, uz + 0.35)
        rx = rx_base * (1.0 + 0.14 * cheek_band * (0.50 + 0.50 * cheek_side) - 0.05 * smoothstep(0.35, 0.95, uy))
        x = ux * rx
        y = uy * ry_base
        z = uz * rz_base

        # 2) Soft plush muzzle / snout cushion on front-lower face
        if uz > 0.1:
            muzzle_w = 0.36 if is_cat else 0.33
            muzzle_h = 0.26 if is_cat else 0.29
            muzzle_y = -0.17 if is_cat else -0.15
            dm = ((ux / muzzle_w) ** 2) + (((uy - muzzle_y) / muzzle_h) ** 2)
            muzzle_puff = math.exp(-dm * 1.85) * smoothstep(0.25, 0.85, uz)
            z += (0.095 if is_cat else 0.155) * muzzle_puff
            y -= (0.012 if is_cat else 0.020) * muzzle_puff

            # Twin cute ":3" whisker pads
            for sx in (-1.0, 1.0):
                px = sx * (0.15 if is_cat else 0.13)
                py = -0.21 if is_cat else -0.20
                dp = ((ux - px) / 0.17) ** 2 + ((uy - py) / 0.14) ** 2
                pad = math.exp(-dp * 2.3) * smoothstep(0.50, 0.92, uz)
                z += (0.048 if is_cat else 0.044) * pad

        # 3) Soft cheek puff bulge
        for sx in (-1.0, 1.0):
            dc = ((ux - sx * 0.72) / 0.38) ** 2 + ((uy + 0.24) / 0.35) ** 2 + ((uz - 0.25) / 0.65) ** 2
            puff = math.exp(-dc * 1.45)
            x += sx * (0.050 if is_cat else 0.042) * puff
            z += 0.022 * puff

        if y < -0.46:
            y = -0.46 + (y + 0.46) * 0.68

        u = 0.03 + uf * 0.44
        v = 0.03 + vf * 0.44
        return x, y, z, u, v

    def ao_fn(x: float, y: float, z: float, uf: float, vf: float):
        return lerp(0.88, 1.0, smoothstep(-0.56, -0.20, y))

    return make_grid_mesh(44, 30, eval_fn, ao_fn)


def build_cat_ear(side: int) -> dict:
    """Chubby, wide, rounded plush kitty ear with cozy rosy pink front inner dish!
    Matches cat_naitang / cat_juzi / cat_yunduo avatars (NOT tall pointy ears!).
    """
    ear_h = 0.35
    ear_w = 0.25
    ear_d = 0.13

    def eval_fn(uf: float, vf: float):
        # vf: 0 (base embedded in head) -> 1 (plump rounded tip)
        t = lerp(0.015, 0.99, vf)
        angle = (uf - 0.5) * 2.0 * math.pi
        sa = math.sin(angle)
        ca = math.cos(angle)  # +1 front face (+Z), -1 back face (-Z)

        # Wide, soft, chubby rounded-triangle profile (plump rounded tip!)
        env_w = math.sin(lerp(0.18, math.pi - 0.02, t)) ** 0.75 * (1.0 - 0.48 * (t ** 1.3))
        env_d = math.sin(lerp(0.18, math.pi - 0.02, t)) ** 0.70 * (1.0 - 0.45 * t)
        width_env = ear_w * max(0.03, env_w)
        depth_env = ear_d * max(0.025, env_d)

        lx = width_env * sa
        lz = depth_env * ca
        ly = ear_h * (t ** 0.90) - 0.06

        # Cozy concave front inner ear pocket
        front_mask = smoothstep(0.15, 0.85, ca) * smoothstep(0.10, 0.35, t) * smoothstep(0.88, 0.58, t)
        lz -= 0.048 * front_mask * (1.0 - sa * sa)

        # Gentle outward kawaii tilt
        tilt = math.radians(side * -24.0)
        rx = lx * math.cos(tilt) - ly * math.sin(tilt)
        ry = lx * math.sin(tilt) + ly * math.cos(tilt)
        rz = lz + 0.025 * t

        # Front dish maps to Ear Inner UV [0.27..0.47, 0.53..0.73], back/rim -> Ear Outer [0.03..0.23, 0.53..0.73]
        if ca >= 0.12:
            u = 0.37 + sa * 0.088
            v = 0.72 - t * 0.175
        else:
            u = 0.13 + sa * 0.088
            v = 0.72 - t * 0.175
        return rx, ry, rz, u, v

    def ao_fn(x: float, y: float, z: float, uf: float, vf: float):
        angle = (uf - 0.5) * 2.0 * math.pi
        ca = math.cos(angle)
        inner = smoothstep(0.2, 0.9, ca) * smoothstep(0.1, 0.4, vf) * smoothstep(0.9, 0.55, vf)
        return lerp(1.0, 0.91, inner)

    return make_grid_mesh(26, 16, eval_fn, ao_fn)


def build_dog_ear(side: int) -> dict:
    """Super cute thick pillowy rounded floppy puppy ear!
    Matches dog_buding / dog_zhima / dog_taotao avatars!
    Guaranteed outward CCW winding via ensure_outward_winding!
    """
    ear_len = 0.48
    ear_w = 0.22
    ear_thick = 0.11

    def eval_fn(uf: float, vf: float):
        t = lerp(0.015, 0.985, vf)
        angle = (uf - 0.5) * 2.0 * math.pi
        sa = math.sin(angle)
        ca = math.cos(angle)

        # Pillowy rounded teardrop flap: gently wider near bottom, plush rounded tip
        flap_env = (math.sin(t * math.pi) ** 0.56) * (0.76 + 0.34 * t)
        thick_env = math.sin(t * math.pi) ** 0.52

        # Centerline starts high on side of head, arches out & drapes cozily alongside chubby cheek
        cx = side * (0.03 + 0.15 * math.sin(t * math.pi * 0.62) + 0.05 * t)
        cy = -ear_len * (t ** 1.02) + 0.07 * math.sin(t * math.pi * 0.45)
        cz = 0.06 * math.sin(t * math.pi * 0.85) + 0.07 * (t ** 1.3)

        lx = ear_thick * thick_env * ca * side
        lz = ear_w * flap_env * sa
        ly = 0.025 * thick_env * math.cos(t * math.pi)

        x = cx + lx
        y = cy + ly
        z = cz + lz

        u = 0.13 + sa * 0.088
        v = 0.54 + t * 0.18
        return x, y, z, u, v

    def ao_fn(x: float, y: float, z: float, uf: float, vf: float):
        angle = (uf - 0.5) * 2.0 * math.pi
        inner = smoothstep(0.0, -0.8, math.cos(angle))
        return lerp(1.0, 0.88, inner)

    return make_grid_mesh(24, 16, eval_fn, ao_fn)


def build_leg(kind: str, is_front: bool, side: int) -> dict:
    """Chubby stubby plush leg + rounded paw with cute front toe scallops."""
    is_cat = kind == "cat"
    leg_len = 0.42
    top_r = 0.175 if is_cat else 0.185
    mid_r = 0.155 if is_cat else 0.165
    paw_r = 0.185 if is_cat else 0.195

    def eval_fn(uf: float, vf: float):
        angle = (uf - 0.5) * 2.0 * math.pi
        sa = math.sin(angle)
        ca = math.cos(angle)

        if vf < 0.20:
            s = vf / 0.20
            ang = lerp(0.03, math.pi * 0.5, s)
            r = top_r * math.sin(ang)
            y = 0.12 * math.cos(ang)
            z_off = 0.0
        elif vf < 0.82:
            s = (vf - 0.20) / 0.62
            y = -s * (leg_len - 0.09)
            paw_bulge = smoothstep(0.45, 1.0, s)
            r = lerp(top_r, mid_r, smoothstep(0.0, 0.5, s)) + (paw_r - mid_r) * paw_bulge
            z_off = 0.055 * paw_bulge
            if paw_bulge > 0.2 and ca > 0.2:
                toe_wave = abs(math.cos(sa * math.pi * 1.45)) * smoothstep(0.25, 0.9, ca)
                r += 0.015 * paw_bulge * toe_wave
        else:
            s = (vf - 0.82) / 0.18
            ang = lerp(0.0, math.pi * 0.5 - 0.02, s)
            r = paw_r * math.cos(ang)
            y = -(leg_len - 0.09) - 0.09 * math.sin(ang)
            z_off = 0.055 * math.cos(ang)

        x = r * sa
        z = r * ca * 1.08 + z_off
        u = 0.53 + uf * 0.24
        v = 0.53 + vf * 0.44
        return x, y, z, u, v

    def ao_fn(x: float, y: float, z: float, uf: float, vf: float):
        top_ao = lerp(0.86, 1.0, smoothstep(0.05, 0.40, vf))
        bot_ao = lerp(1.0, 0.90, smoothstep(0.82, 1.0, vf))
        return top_ao * bot_ao

    return make_grid_mesh(20, 18, eval_fn, ao_fn)


def build_tail(kind: str) -> dict:
    """Cute fluffy curved plush tail in TailPivot local space."""
    is_cat = kind == "cat"
    n_len = 22
    n_rad = 16

    def spine(t: float):
        if is_cat:
            y = 0.02 + 0.60 * math.sin(t * math.pi * 0.55) + 0.15 * (t ** 1.4)
            z = -0.08 - 0.42 * math.sin(t * math.pi * 0.72) + 0.16 * (t ** 2.6)
            r = 0.128 + 0.052 * math.sin(t * math.pi * 0.85) + 0.035 * smoothstep(0.65, 0.92, t)
            if t < 0.08:
                r *= math.sin((t / 0.08) * math.pi * 0.5)
            elif t > 0.88:
                r *= math.cos(clamp((t - 0.88) / 0.12, 0.0, 1.0) * math.pi * 0.5)
            return (0.0, y, z, max(0.0, r))
        else:
            y = 0.02 + 0.38 * (t ** 0.85)
            z = -0.05 - 0.22 * math.sin(t * math.pi * 0.68) + 0.06 * (t ** 2.2)
            r = 0.135 * (0.74 + 0.42 * math.sin(t * math.pi * 0.75))
            if t < 0.08:
                r *= math.sin((t / 0.08) * math.pi * 0.5)
            elif t > 0.84:
                r *= math.cos(clamp((t - 0.84) / 0.16, 0.0, 1.0) * math.pi * 0.5)
            return (0.0, y, z, max(0.0, r))

    def eval_fn(uf: float, vf: float):
        t = vf
        cx, cy, cz, r = spine(t)
        dt = 0.01
        _, y0, z0, _ = spine(max(0.0, t - dt))
        _, y1, z1, _ = spine(min(1.0, t + dt))
        ty, tz = y1 - y0, z1 - z0
        tl = math.hypot(ty, tz) or 1.0
        ty /= tl; tz /= tl
        ny_v, nz_v = -tz, ty
        angle = (uf - 0.5) * 2.0 * math.pi
        sa = math.sin(angle)
        ca = math.cos(angle)
        x = cx + r * sa
        y = cy + r * ca * ny_v
        z = cz + r * ca * nz_v
        u = 0.03 + vf * 0.44
        v = 0.77 + uf * 0.20
        return x, y, z, u, v

    def ao_fn(x: float, y: float, z: float, uf: float, vf: float):
        return lerp(0.88, 1.0, smoothstep(0.0, 0.25, vf))

    return make_grid_mesh(n_rad, n_len, eval_fn, ao_fn)


def make_ellipsoid_part(center, radii, uv_box, rot_euler=(0.0, 0.0, 0.0), nu=16, nv=12, unshaded=False):
    cx, cy, cz = center
    rx, ry, rz = radii
    u0, v0, u1, v1 = uv_box
    ex, ey, ez = [math.radians(a) for a in rot_euler]
    cxr, sxr = math.cos(ex), math.sin(ex)
    cyr, syr = math.cos(ey), math.sin(ey)
    czr, szr = math.cos(ez), math.sin(ez)

    def eval_fn(uf: float, vf: float):
        theta = lerp(0.02, math.pi - 0.02, vf)
        az = (uf - 0.5) * 2.0 * math.pi
        lx = rx * math.sin(theta) * math.sin(az)
        ly = ry * math.cos(theta)
        lz = rz * math.sin(theta) * math.cos(az)
        x1 = lx * czr - ly * szr
        y1 = lx * szr + ly * czr
        z1 = lz
        y2 = y1 * cxr - z1 * sxr
        z2 = y1 * sxr + z1 * cxr
        x3 = x1 * cyr + z2 * syr
        z3 = -x1 * syr + z2 * cyr
        px = clamp(math.sin(theta) * math.sin(az) * 0.5 + 0.5, 0.02, 0.98)
        py = clamp(0.5 - math.cos(theta) * 0.5, 0.02, 0.98)
        u = lerp(u0, u1, px)
        v = lerp(v0, v1, py)
        return cx + x3, cy + y2, cz + z3, u, v

    return make_grid_mesh(nu, nv, eval_fn, unshaded=unshaded)


def build_face_accents(kind: str) -> dict:
    """Crisp, glossy 3D eyes (with UV-mapped twin catchlights) + cute 3D button nose.
    Tucked snugly into the sculpted face with zero protruding mouth bump!
    """
    is_cat = kind == "cat"
    parts = []
    # 1) Glossy big kawaii eyes tucked warmly into the face
    eye_x = 0.245 if is_cat else 0.225
    eye_y = 0.00 if is_cat else 0.02
    eye_z = 0.545 if is_cat else 0.565
    eye_r = (0.088, 0.098, 0.052) if is_cat else (0.086, 0.095, 0.052)
    for sx in (-1.0, 1.0):
        parts.append(
            make_ellipsoid_part(
                center=(sx * eye_x, eye_y, eye_z),
                radii=eye_r,
                uv_box=(0.815, 0.535, 0.965, 0.685),
                rot_euler=(0.0, sx * 20.0, 0.0),
                nu=18,
                nv=14,
                unshaded=True,
            )
        )
    # 2) Cute sculpted 3D button nose
    nose_y = -0.095 if is_cat else -0.075
    nose_z = 0.655 if is_cat else 0.720
    nose_r = (0.062, 0.044, 0.042) if is_cat else (0.082, 0.058, 0.052)
    parts.append(
        make_ellipsoid_part(
            center=(0.0, nose_y, nose_z),
            radii=nose_r,
            uv_box=(0.815, 0.725, 0.965, 0.835),
            rot_euler=(8.0, 0.0, 0.0),
            nu=16,
            nv=12,
            unshaded=True,
        )
    )
    return merge_meshes(parts)


def build_rig(kind: str) -> dict:
    is_cat = kind == "cat"
    head_pivot = [0.0, 0.96 if is_cat else 0.94, 0.51 if is_cat else 0.50]
    ear_l_pivot = [0.35, 0.42, 0.04] if is_cat else [0.44, 0.34, 0.04]
    ear_r_pivot = [-ear_l_pivot[0], ear_l_pivot[1], ear_l_pivot[2]]
    leg_y = 0.42
    leg_x = 0.28 if is_cat else 0.27
    leg_fz = 0.34 if is_cat else 0.32
    leg_bz = -0.44 if is_cat else -0.42
    tail_pivot = [0.0, 0.72, -0.74 if is_cat else -0.70]

    parts = {
        "body": build_body(kind),
        "head": build_head(kind),
        "face": build_face_accents(kind),
        "earL": build_cat_ear(1) if is_cat else build_dog_ear(1),
        "earR": build_cat_ear(-1) if is_cat else build_dog_ear(-1),
        "legFL": build_leg(kind, True, 1),
        "legFR": build_leg(kind, True, -1),
        "legBL": build_leg(kind, False, 1),
        "legBR": build_leg(kind, False, -1),
        "tail": build_tail(kind),
    }

    total_verts = sum(len(m["positions"]) // 3 for m in parts.values())
    total_tris = sum(len(m["indices"]) // 3 for m in parts.values())
    return {
        "version": 1,
        "kind": kind,
        "height": 1.85,
        "pivots": {
            "head": head_pivot,
            "earL": ear_l_pivot,
            "earR": ear_r_pivot,
            "legFL": [leg_x, leg_y, leg_fz],
            "legFR": [-leg_x, leg_y, leg_fz],
            "legBL": [leg_x, leg_y, leg_bz],
            "legBR": [-leg_x, leg_y, leg_bz],
            "tail": tail_pivot,
        },
        "stats": {"vertices": total_verts, "triangles": total_tris},
        "parts": parts,
    }


# ---------------------------------------------------------------------------
# Plush Fur Cartoon Skin Generator (1024x1024 Semantic UV Atlas)
# ---------------------------------------------------------------------------

BREED_SKINS = {
    "cat_naitang": {
        "kind": "cat",
        "base": "#EBB678",
        "secondary": "#D29252",
        "stripe": "#B47138",
        "cream": "#FFF7E8",
        "ear_outer": "#D99A5B",
        "ear_inner": "#F4A9A4",
        "blush": "#F29D8E",
        "nose": "#EC9694",
        "eye": "#2B1E17",
        "eye_iris": "#6B4329",
        "mouth": "#8E5746",
        "pattern": "tabby_soft",
        "blaze": True,
        "socks": True,
        "tail_tip": "#FFF7E8",
    },
    "dog_buding": {
        "kind": "dog",
        "base": "#E4A850",
        "secondary": "#CF8D38",
        "stripe": "#B17228",
        "cream": "#FFF6E2",
        "ear_outer": "#D6943E",
        "ear_inner": "#E7A196",
        "blush": "#F09B88",
        "nose": "#3E2920",
        "eye": "#261A14",
        "eye_iris": "#633D26",
        "mouth": "#6A4234",
        "pattern": "pudding_dog",
        "blaze": True,
        "eyebrows": True,
        "socks": True,
        "tail_tip": "#FFF6E2",
    },
    "cat_yunduo": {
        "kind": "cat",
        "base": "#F8F9FB",
        "secondary": "#DFE6F0",
        "stripe": "#AABACC",
        "cream": "#FFFFFF",
        "ear_outer": "#BCC9DA",
        "ear_inner": "#F6B4BC",
        "blush": "#F698A8",
        "nose": "#F296A4",
        "eye": "#232533",
        "eye_iris": "#587EA8",
        "mouth": "#996A6E",
        "pattern": "cloud_soft",
        "blaze": False,
        "socks": False,
        "tail_tip": "#C8D4E2",
    },
    "dog_zhima": {
        "kind": "dog",
        "base": "#44474E",
        "secondary": "#383B42",
        "stripe": "#2E3138",
        "cream": "#FAF2E2",
        "ear_outer": "#3A3D44",
        "ear_inner": "#D99A98",
        "blush": "#E69790",
        "nose": "#262222",
        "eye": "#1D1918",
        "eye_iris": "#58443A",
        "mouth": "#694B43",
        "pattern": "sesame_collie",
        "blaze": True,
        "eyebrows": False,
        "socks": True,
        "tail_tip": "#FAF2E2",
    },
    "cat_juzi": {
        "kind": "cat",
        "base": "#F3A04A",
        "secondary": "#E2832E",
        "stripe": "#C4631E",
        "cream": "#FFF7E8",
        "ear_outer": "#E58934",
        "ear_inner": "#F6A7A3",
        "blush": "#F49484",
        "nose": "#EF908E",
        "eye": "#291D16",
        "eye_iris": "#8B5424",
        "mouth": "#8D523E",
        "pattern": "tabby_bold",
        "blaze": True,
        "socks": True,
        "tail_tip": "#FFF7E8",
    },
    "dog_taotao": {
        "kind": "dog",
        "base": "#F1B98E",
        "secondary": "#E5A278",
        "stripe": "#C88262",
        "cream": "#FFF8EE",
        "ear_outer": "#9E644C",
        "ear_inner": "#F0A8AA",
        "blush": "#F28B8C",
        "nose": "#4E3028",
        "eye": "#2B1D1A",
        "eye_iris": "#764638",
        "mouth": "#7E4B42",
        "pattern": "peach_dog",
        "blaze": True,
        "eyebrows": False,
        "socks": True,
        "tail_tip": "#FFF8EE",
    },
    "cat_yingduan": {
        "kind": "cat",
        "base": "#8596A8",
        "secondary": "#6E7F92",
        "stripe": "#5C6D80",
        "cream": "#DCE3EC",
        "ear_outer": "#728496",
        "ear_inner": "#EBAAB2",
        "blush": "#EBA4AE",
        "nose": "#6A5C63",
        "eye": "#281D12",
        "eye_iris": "#E09A2E",
        "mouth": "#5E545A",
        "pattern": "british_blue",
        "blaze": False,
        "socks": False,
        "tail_tip": "#6E7F92",
    },
    "cat_buou": {
        "kind": "cat",
        "base": "#FBF5EB",
        "secondary": "#EFE4D3",
        "stripe": "#6B4E3F",
        "cream": "#FFFDF8",
        "ear_outer": "#684B3C",
        "ear_inner": "#EBB0B2",
        "blush": "#F3A0A8",
        "nose": "#5C4034",
        "eye": "#1D2842",
        "eye_iris": "#4D8EE6",
        "mouth": "#755547",
        "pattern": "ragdoll_point",
        "blaze": False,
        "socks": True,
        "tail_tip": "#6B4E3F",
    },
    "cat_sanhua": {
        "kind": "cat",
        "base": "#FAF6EE",
        "secondary": "#F0E8DA",
        "stripe": "#E68A3E",
        "patch_dark": "#564741",
        "cream": "#FFFFFF",
        "ear_outer": "#E2843A",
        "ear_inner": "#F5A8AC",
        "blush": "#F4999B",
        "nose": "#EE9596",
        "eye": "#2A1F18",
        "eye_iris": "#8E5E2D",
        "mouth": "#8C5B4D",
        "pattern": "calico",
        "blaze": False,
        "socks": True,
        "tail_tip": "#564741",
    },
    "dog_keji": {
        "kind": "dog",
        "base": "#E79443",
        "secondary": "#D27928",
        "stripe": "#B8641C",
        "cream": "#FFF9EF",
        "ear_outer": "#DE8534",
        "ear_inner": "#F4AAA8",
        "blush": "#F39A8E",
        "nose": "#32231D",
        "eye": "#241914",
        "eye_iris": "#6B4326",
        "mouth": "#6C4535",
        "pattern": "corgi",
        "blaze": True,
        "eyebrows": False,
        "socks": True,
        "tail_tip": "#FFF9EF",
    },
    "dog_chaiquan": {
        "kind": "dog",
        "base": "#DA8238",
        "secondary": "#C26B24",
        "stripe": "#A8591C",
        "cream": "#FFF5E2",
        "ear_outer": "#C9722A",
        "ear_inner": "#EFA69E",
        "blush": "#F09784",
        "nose": "#2B201C",
        "eye": "#221814",
        "eye_iris": "#5F3B24",
        "mouth": "#664032",
        "pattern": "shiba",
        "blaze": False,
        "eyebrows": True,
        "socks": True,
        "tail_tip": "#FFF5E2",
    },
    "dog_jinmao": {
        "kind": "dog",
        "base": "#EDB95E",
        "secondary": "#DBA042",
        "stripe": "#C1842A",
        "cream": "#FFF3D8",
        "ear_outer": "#CE8D34",
        "ear_inner": "#E8A698",
        "blush": "#F29D8A",
        "nose": "#3B2820",
        "eye": "#251A13",
        "eye_iris": "#6E4624",
        "mouth": "#724936",
        "pattern": "golden",
        "blaze": False,
        "eyebrows": False,
        "socks": False,
        "tail_tip": "#FFF3D8",
    },
}


def generate_fur_noise(size: int, seed: int) -> Image.Image:
    rng = random.Random(seed)
    small = size // 2
    img = Image.new("L", (small, small), 128)
    px = img.load()
    for y in range(small):
        for x in range(small):
            px[x, y] = 128 + rng.randint(-11, 11)
    img = img.resize((size, size), Image.Resampling.BILINEAR)
    img = img.filter(ImageFilter.GaussianBlur(radius=0.85))
    return img


def _blend_mask(base_img: Image.Image, mask: Image.Image, color, alpha: int, blur: float):
    """Alpha-composite a solid color through a blurred L-mask -> ZERO dark halo artifacts!"""
    if blur > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(radius=blur))
    if alpha < 255:
        mask = mask.point(lambda a: int(a * alpha / 255))
    solid = Image.new("RGBA", base_img.size, (*color, 255))
    solid.putalpha(mask)
    base_img.alpha_composite(solid)


def draw_soft_ellipse(overlay: Image.Image, cx, cy, rx, ry, color, alpha=255, blur=8):
    mask = Image.new("L", overlay.size, 0)
    ImageDraw.Draw(mask).ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=255)
    _blend_mask(overlay, mask, color, alpha, blur)


def draw_soft_polygon(overlay: Image.Image, pts, color, alpha=255, blur=6):
    mask = Image.new("L", overlay.size, 0)
    ImageDraw.Draw(mask).polygon(pts, fill=255)
    _blend_mask(overlay, mask, color, alpha, blur)


def draw_soft_line(overlay: Image.Image, pts, color, width=10, alpha=255, blur=4):
    mask = Image.new("L", overlay.size, 0)
    ImageDraw.Draw(mask).line(pts, fill=255, width=width, joint="curve")
    _blend_mask(overlay, mask, color, alpha, blur)


def generate_skin_texture(skin_key: str, cfg: dict, fur_noise: Image.Image) -> Image.Image:
    S = TEX_SIZE
    base = hex_rgb(cfg["base"])
    sec = hex_rgb(cfg["secondary"])
    stripe = hex_rgb(cfg["stripe"])
    cream = hex_rgb(cfg["cream"])
    ear_outer = hex_rgb(cfg["ear_outer"])
    ear_inner = hex_rgb(cfg["ear_inner"])
    blush = hex_rgb(cfg["blush"])
    nose = hex_rgb(cfg["nose"])
    eye = hex_rgb(cfg["eye"])
    eye_iris = hex_rgb(cfg["eye_iris"])
    mouth = hex_rgb(cfg["mouth"])
    tail_tip = hex_rgb(cfg["tail_tip"])
    pattern = cfg["pattern"]

    img = Image.new("RGBA", (S, S), (*base, 255))

    # =========================================================================
    # QUADRANT 1: HEAD  (x: 0..512, y: 0..512; face center at x=256, y=256)
    # =========================================================================
    draw_soft_ellipse(img, 256, 118, 260, 140, sec, alpha=145, blur=36)
    draw_soft_ellipse(img, 36, 240, 90, 210, sec, alpha=110, blur=32)
    draw_soft_ellipse(img, 476, 240, 90, 210, sec, alpha=110, blur=32)

    if pattern in ("tabby_soft", "tabby_bold"):
        alpha_s = 175 if pattern == "tabby_soft" else 220
        for sx in (-1, 1):
            draw_soft_line(img, [(256 + sx * 11, 198), (256 + sx * 22, 145), (256 + sx * 36, 102)], stripe, width=13, alpha=alpha_s, blur=4)
            draw_soft_line(img, [(256 + sx * 42, 188), (256 + sx * 56, 134), (256 + sx * 68, 95)], stripe, width=12, alpha=alpha_s, blur=4)
            draw_soft_line(img, [(256 + sx * 92, 260), (256 + sx * 146, 254)], stripe, width=11, alpha=alpha_s - 25, blur=4)
            draw_soft_line(img, [(256 + sx * 96, 284), (256 + sx * 148, 288)], stripe, width=10, alpha=alpha_s - 35, blur=4)
    elif pattern == "cloud_soft":
        # Soft pastel powder-blue crown wash & wisps matching Cloud Cat avatar!
        draw_soft_ellipse(img, 256, 128, 195, 105, sec, alpha=185, blur=32)
        for sx in (-1, 1):
            draw_soft_line(img, [(256 + sx * 14, 178), (256 + sx * 24, 125)], stripe, width=11, alpha=150, blur=5)
            draw_soft_line(img, [(256 + sx * 40, 168), (256 + sx * 52, 122)], stripe, width=10, alpha=135, blur=5)
    elif pattern == "sesame_collie":
        draw_soft_ellipse(img, 256, 145, 235, 145, sec, alpha=170, blur=24)
    elif pattern == "ragdoll_point":
        # Iconic soft chocolate-seal face mask centered around eyes/muzzle!
        draw_soft_ellipse(img, 256, 250, 96, 68, stripe, alpha=210, blur=22)
        draw_soft_ellipse(img, 256, 285, 62, 42, stripe, alpha=185, blur=16)
    elif pattern == "calico":
        # Distinct cute asymmetric ginger-orange (left) & charcoal-brown (right) calico patches!
        dark_patch = hex_rgb(cfg["patch_dark"])
        draw_soft_ellipse(img, 165, 155, 88, 72, stripe, alpha=240, blur=14)
        draw_soft_ellipse(img, 348, 155, 86, 70, dark_patch, alpha=235, blur=14)
        draw_soft_ellipse(img, 120, 230, 56, 48, dark_patch, alpha=195, blur=14)
    elif pattern == "british_blue":
        draw_soft_ellipse(img, 256, 145, 220, 130, sec, alpha=140, blur=32)

    # Fluffy cream muzzle, lower cheeks, chin (ZERO grey halo!)
    muzzle_alpha = 145 if pattern == "british_blue" else 135 if pattern == "ragdoll_point" else 252
    draw_soft_ellipse(img, 256, 345, 170, 118, cream, alpha=muzzle_alpha, blur=16)
    if pattern != "ragdoll_point":
        draw_soft_ellipse(img, 256, 304, 98, 60, cream, alpha=muzzle_alpha, blur=12)
    draw_soft_ellipse(img, 256, 440, 245, 90, cream, alpha=250 if pattern != "british_blue" else 180, blur=18)

    if cfg.get("blaze"):
        top_y = 66 if cfg["kind"] == "dog" else 118
        blaze_pts = [(256, top_y), (280, 185), (296, 298), (216, 298), (232, 185)]
        draw_soft_polygon(img, blaze_pts, cream, alpha=250, blur=9)

    if cfg.get("eyebrows"):
        for sx in (-1, 1):
            draw_soft_ellipse(img, 256 + sx * 42, 198, 14, 9, cream, alpha=240, blur=3.5)

    # Sweet rosy cartoon cheek blush!
    blush_a = 165 if skin_key in ("cat_yunduo", "dog_taotao") else 115
    for sx in (-1, 1):
        draw_soft_ellipse(img, 256 + sx * 76, 286, 24, 15, blush, alpha=blush_a, blur=10)

    # Crisp adorable ":3" smile painted softly onto front of muzzle pads
    draw_soft_line(img, [(256, 290), (256, 308)], mouth, width=4, alpha=185, blur=0.8)
    draw_soft_line(img, [(235, 305), (245, 314), (256, 307), (267, 314), (277, 305)], mouth, width=4, alpha=195, blur=0.8)

    # =========================================================================
    # QUADRANT 2: BODY (x: 512..1024, y: 0..512)
    # New Y-axis wrap:
    # - y = 16..180: TOP BACK (dorsal spine, no rump pinch!)
    # - x = 768, y = 200..340: FRONT CHEST (+Z)
    # - x = 528..640 & 896..1008, y = 180..340: RUMP (-Z)
    # - y = 370..512: FLUFFY CREAM BELLY UNDERSIDE (-Y)
    # =========================================================================
    draw_soft_ellipse(img, 768, 95, 255, 115, sec, alpha=155, blur=36)

    if pattern in ("tabby_soft", "tabby_bold"):
        alpha_s = 155 if pattern == "tabby_soft" else 205
        # Soft curved dorsal tabby stripes across back flanks
        for r_off in (55, 110, 165):
            draw_soft_line(img, [(565, 85 + r_off // 2), (660, 130 + r_off // 2), (768, 145 + r_off // 2), (876, 130 + r_off // 2), (971, 85 + r_off // 2)], stripe, width=20, alpha=alpha_s, blur=8)
    elif pattern in ("pudding_dog", "peach_dog", "sesame_collie", "corgi", "shiba", "golden", "british_blue"):
        draw_soft_ellipse(img, 768, 125, 220, 120, sec, alpha=145, blur=34)
    elif pattern == "calico":
        dark_patch = hex_rgb(cfg["patch_dark"])
        draw_soft_ellipse(img, 650, 145, 95, 78, stripe, alpha=235, blur=16)
        draw_soft_ellipse(img, 885, 165, 92, 76, dark_patch, alpha=230, blur=16)
        draw_soft_ellipse(img, 768, 85, 84, 58, stripe, alpha=210, blur=16)
    elif pattern == "ragdoll_point":
        draw_soft_ellipse(img, 768, 125, 210, 100, sec, alpha=165, blur=34)

    # Fluffy white chest bib (front +Z centered at x=768, y=240..420)
    chest_rx = 148 if pattern == "corgi" else 108
    draw_soft_ellipse(img, 768, 310, chest_rx, 115, cream, alpha=250 if pattern != "british_blue" else 175, blur=18)
    # Fluffy cream belly band along the bottom of Quadrant 2 (y=415..512) -> ZERO rump pinch!
    d = ImageDraw.Draw(img)
    draw_soft_ellipse(img, 768, 475, 285, 78, cream, alpha=252, blur=18)

    # =========================================================================
    # QUADRANT 3: EARS & TAIL  (x: 0..512, y: 512..1024)
    # =========================================================================
    d = ImageDraw.Draw(img)
    d.rectangle([0, 512, 256, 768], fill=(*ear_outer, 255))
    draw_soft_ellipse(img, 128, 555 if cfg["kind"] == "cat" else 730, 115, 65, stripe if cfg["kind"] == "cat" else sec, alpha=130, blur=24)

    d = ImageDraw.Draw(img)
    d.rectangle([256, 512, 512, 768], fill=(*ear_outer, 255))
    draw_soft_ellipse(img, 384, 655, 88, 88, ear_inner, alpha=248, blur=12)
    draw_soft_ellipse(img, 384, 675, 58, 52, lerp_rgb(ear_inner, (255, 232, 232), 0.35), alpha=180, blur=10)

    d = ImageDraw.Draw(img)
    d.rectangle([0, 768, 512, 1024], fill=(*base, 255))
    draw_soft_ellipse(img, 240, 896, 200, 110, sec, alpha=125, blur=28)
    if pattern in ("tabby_soft", "tabby_bold"):
        for x_ring in (130, 215, 300, 380):
            draw_soft_line(img, [(x_ring, 770), (x_ring, 1020)], stripe, width=26, alpha=180, blur=6)
    draw_soft_ellipse(img, 468, 896, 95, 145, tail_tip, alpha=250, blur=18)

    # =========================================================================
    # QUADRANT 4 (LEFT): PAWS / LEGS  (x: 512..812, y: 512..1024)
    # =========================================================================
    d = ImageDraw.Draw(img)
    d.rectangle([512, 512, 812, 1024], fill=(*base, 255))
    draw_soft_ellipse(img, 660, 620, 150, 95, sec, alpha=105, blur=24)
    if cfg.get("socks"):
        draw_soft_ellipse(img, 662, 925, 190, 126, cream, alpha=255, blur=12)
        d = ImageDraw.Draw(img)
        d.rectangle([512, 898, 812, 1024], fill=(*cream, 255))
    toe_col = lerp_rgb(cream if cfg.get("socks") else base, (130, 100, 85), 0.24)
    for tx in (644, 684):
        draw_soft_line(img, [(tx, 875), (tx, 932)], toe_col, width=4, alpha=125, blur=2)

    # =========================================================================
    # PLUSH FELT MICRO-FUR GRAIN ON ALL FUR AREAS
    # =========================================================================
    img_px = img.load()
    n_px = fur_noise.load()
    for y in range(S):
        for x in range(S):
            if x >= 812 and y >= 512:
                continue
            r, g, b, a = img_px[x, y]
            delta = (n_px[x, y] - 128) * 0.42
            img_px[x, y] = (
                int(clamp(r + delta, 0, 255)),
                int(clamp(g + delta, 0, 255)),
                int(clamp(b + delta, 0, 255)),
                255,
            )

    # =========================================================================
    # QUADRANT 4 (RIGHT): CRISP FACE ACCENTS (x: 812..1024, y: 512..1024)
    # =========================================================================
    d = ImageDraw.Draw(img)
    d.rectangle([812, 512, 1024, 718], fill=(*eye, 255))
    draw_soft_ellipse(img, 912, 655, 42, 26, eye_iris, alpha=190, blur=10)
    draw_soft_ellipse(img, 886, 594, 20, 22, (255, 255, 255), alpha=255, blur=0.8)
    draw_soft_ellipse(img, 944, 658, 8, 9, (255, 255, 255), alpha=235, blur=0.8)

    d = ImageDraw.Draw(img)
    d.rectangle([812, 718, 1024, 875], fill=(*nose, 255))
    nose_hi = lerp_rgb(nose, (255, 248, 244), 0.50)
    nose_lo = lerp_rgb(nose, (30, 18, 18), 0.25)
    draw_soft_ellipse(img, 912, 772, 46, 18, nose_hi, alpha=175, blur=8)
    draw_soft_ellipse(img, 912, 838, 60, 24, nose_lo, alpha=140, blur=10)

    d = ImageDraw.Draw(img)
    d.rectangle([812, 875, 1024, 1024], fill=(*mouth, 255))

    return img


def generate_uv_template(rig: dict, out_path: Path):
    S = TEX_SIZE
    img = Image.new("RGBA", (S, S), (250, 247, 240, 255))
    d = ImageDraw.Draw(img)
    guides = [
        ((24, 24, 488, 488), (255, 232, 210, 120)),
        ((536, 24, 1000, 488), (222, 242, 222, 120)),
        ((24, 536, 244, 756), (226, 232, 252, 120)),
        ((268, 536, 488, 756), (255, 224, 232, 120)),
        ((24, 780, 488, 1000), (248, 236, 205, 120)),
        ((536, 536, 796, 1000), (235, 226, 248, 120)),
        ((824, 536, 1000, 1000), (230, 230, 230, 140)),
    ]
    for box, col in guides:
        d.rectangle(box, fill=col, outline=(180, 165, 150, 200), width=2)
    for name, part in rig["parts"].items():
        uvs = part["uvs"]
        idx = part["indices"]
        col = (90, 65, 45, 130)
        for i in range(0, len(idx), 3):
            a, b, c = idx[i], idx[i + 1], idx[i + 2]
            pts = [
                (uvs[a * 2] * S, uvs[a * 2 + 1] * S),
                (uvs[b * 2] * S, uvs[b * 2 + 1] * S),
                (uvs[c * 2] * S, uvs[c * 2 + 1] * S),
            ]
            if max(abs(pts[0][0] - pts[1][0]), abs(pts[1][0] - pts[2][0]), abs(pts[2][0] - pts[0][0])) > S * 0.25:
                continue
            d.polygon(pts, outline=col)
    img.save(out_path)


def generate_shadow_texture(out_path: Path):
    S = 256
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    px = img.load()
    cx = cy = (S - 1) / 2.0
    for y in range(S):
        for x in range(S):
            dx = (x - cx) / (S * 0.48)
            dy = (y - cy) / (S * 0.42)
            r = math.hypot(dx, dy)
            if r >= 1.0:
                continue
            a = math.exp(-(r * r) * 3.1) * (1.0 - smoothstep(0.62, 1.0, r))
            px[x, y] = (54, 62, 34, int(clamp(a * 118, 0, 255)))
    img.save(out_path)


def ensure_json_meta(json_path: Path):
    meta_path = json_path.with_suffix(json_path.suffix + ".meta")
    if meta_path.exists():
        return
    meta = {
        "ver": "1.0.2",
        "importer": "json",
        "imported": True,
        "uuid": str(uuid.uuid4()),
        "files": [".json"],
        "subMetas": {},
        "userData": {},
    }
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")


def ensure_texture_meta(png_path: Path, display_name: str, has_alpha: bool = True):
    meta_path = png_path.with_suffix(png_path.suffix + ".meta")
    if meta_path.exists():
        return
    u = str(uuid.uuid4())
    meta = {
        "ver": "1.0.27",
        "importer": "image",
        "imported": True,
        "uuid": u,
        "files": [".json", ".png"],
        "subMetas": {
            "6c48a": {
                "ver": "1.0.22",
                "importer": "texture",
                "uuid": f"{u}@6c48a",
                "imported": True,
                "files": [".json"],
                "subMetas": {},
                "userData": {
                    "wrapModeS": "clamp-to-edge",
                    "wrapModeT": "clamp-to-edge",
                    "minfilter": "linear",
                    "magfilter": "linear",
                    "mipfilter": "none",
                    "isUuid": True,
                    "imageUuidOrDatabaseUri": u,
                    "visible": False,
                    "anisotropy": 0,
                },
                "displayName": display_name,
                "id": "6c48a",
                "name": "texture",
            }
        },
        "userData": {
            "type": "texture",
            "redirect": f"{u}@6c48a",
            "hasAlpha": has_alpha,
            "fixAlphaTransparencyArtifacts": False,
        },
    }
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")


def main():
    PETS_DIR.mkdir(parents=True, exist_ok=True)
    SKINS_DIR.mkdir(parents=True, exist_ok=True)
    GEN_DIR.mkdir(parents=True, exist_ok=True)

    for kind in ("cat", "dog"):
        rig = build_rig(kind)
        out_json = PETS_DIR / f"{kind}-rig.json"
        out_json.write_text(json.dumps(rig, separators=(",", ":")), encoding="utf-8")
        ensure_json_meta(out_json)
        generate_uv_template(rig, GEN_DIR / f"pet-uv-template-{kind}.png")
        print(f"[rig] {kind}-rig.json: {rig['stats']['vertices']} verts, {rig['stats']['triangles']} tris, {out_json.stat().st_size // 1024} KB")

    shadow_path = PETS_DIR / "shadow.png"
    generate_shadow_texture(shadow_path)
    ensure_texture_meta(shadow_path, "shadow", has_alpha=True)
    print(f"[shadow] {shadow_path.name} generated")

    fur_noise = generate_fur_noise(TEX_SIZE, seed=20261125)
    for skin_key, cfg in BREED_SKINS.items():
        skin_img = generate_skin_texture(skin_key, cfg, fur_noise)
        out_png = SKINS_DIR / f"{skin_key}.png"
        skin_img.save(out_png, optimize=True)
        ensure_texture_meta(out_png, skin_key, has_alpha=False)
        print(f"[skin] {skin_key}.png ({out_png.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
