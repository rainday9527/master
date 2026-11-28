"""Full v3.1 Flagship 3D Rig & Plush Fur Skin Generator for ALL 3 Rigs & ALL 18 Cat/Dog Breeds.
Upgrades:
- All 3 rigs: cat-rig.json, dog-rig.json, dog_upright-rig.json
  * Sculpted plush head with fuller jowls, eye-socket cradle, pillowy snout
  * Soft-pointed kitty & upright-dog ears with thick outer fur rim & central recessed pink hollow
  * High-rooted folded floppy dog ears framing cheeks snugly
  * Glass-doll 3D eyes with subtle dark-chocolate eye-rim depth ring + glossy sculpted nose + cat 3D whiskers
  * Plump bean-paws with toe scallops & warm-to-cool stylized plush vertex lighting + chin/neck AO
- All 18 breed skins (512x512 RGB PNG):
  * Radial felted plush wool fur strokes, avatar-matched eye iris & coat markings, smiling mouths, paw toe creases.
"""
from __future__ import annotations

import json
import math
import random
import importlib.util
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("bpr", ROOT / "tools" / "build-pet-rig.py")
bpr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bpr)

clamp = bpr.clamp
smoothstep = bpr.smoothstep
lerp = bpr.lerp
lerp_rgb = bpr.lerp_rgb
hex_rgb = bpr.hex_rgb
vec_norm = bpr.vec_norm
ensure_outward_winding = bpr.ensure_outward_winding
compute_smooth_normals = bpr.compute_smooth_normals
merge_meshes = bpr.merge_meshes
draw_soft_ellipse = bpr.draw_soft_ellipse
draw_soft_polygon = bpr.draw_soft_polygon
draw_soft_line = bpr.draw_soft_line


# Complete 18-breed skin catalog (12 original + 6 newer breeds)
ALL_BREED_SKINS = dict(bpr.BREED_SKINS)
ALL_BREED_SKINS.update({
    "cat_meiduan": {
        "kind": "cat",
        "base": "#B8BDC4",
        "secondary": "#959CA6",
        "stripe": "#3F434A",
        "cream": "#F7F6F3",
        "ear_outer": "#8E959F",
        "ear_inner": "#EBA4A6",
        "blush": "#EDA2A6",
        "nose": "#E88B90",
        "eye": "#221E18",
        "eye_iris": "#C9A83A",
        "mouth": "#6A5C5A",
        "pattern": "tabby_bold",
        "blaze": False,
        "socks": True,
        "tail_tip": "#3F434A",
    },
    "cat_mianyin": {
        "kind": "cat",
        "base": "#FBF9F5",
        "secondary": "#EAE5DC",
        "stripe": "#D8D2C8",
        "cream": "#FFFFFF",
        "ear_outer": "#EFEAE2",
        "ear_inner": "#F3B0B2",
        "blush": "#F4AEB2",
        "nose": "#EE9598",
        "eye": "#192638",
        "eye_iris": "#58B4F0",
        "mouth": "#8B6968",
        "pattern": "solid_white",
        "blaze": False,
        "socks": False,
        "tail_tip": "#FFFFFF",
    },
    "cat_xianluo": {
        "kind": "cat",
        "base": "#F2E7D6",
        "secondary": "#E2D2BC",
        "stripe": "#503528",
        "cream": "#FAF4EA",
        "ear_outer": "#4A3024",
        "ear_inner": "#8B685C",
        "blush": "#C48A7E",
        "nose": "#3A241C",
        "eye": "#162038",
        "eye_iris": "#428CEB",
        "mouth": "#3A241C",
        "pattern": "siamese",
        "blaze": False,
        "socks": False,
        "tail_tip": "#4A3024",
    },
    "dog_bixiong": {
        "kind": "dog",
        "base": "#FCF9F4",
        "secondary": "#ECE6DC",
        "stripe": "#DDD6CA",
        "cream": "#FFFFFF",
        "ear_outer": "#F4EFE6",
        "ear_inner": "#F2B6B6",
        "blush": "#F4B0B2",
        "nose": "#262222",
        "eye": "#1E1918",
        "eye_iris": "#5B4236",
        "mouth": "#6C4C46",
        "pattern": "solid_white",
        "blaze": False,
        "eyebrows": False,
        "socks": False,
        "tail_tip": "#FFFFFF",
    },
    "dog_hashiqi": {
        "kind": "dog",
        "base": "#7E838C",
        "secondary": "#5D626B",
        "stripe": "#444850",
        "cream": "#FAF8F4",
        "ear_outer": "#686D76",
        "ear_inner": "#E8A6A4",
        "blush": "#EBA4A2",
        "nose": "#252224",
        "eye": "#182436",
        "eye_iris": "#4CB2EE",
        "mouth": "#5E4C48",
        "pattern": "husky",
        "blaze": True,
        "eyebrows": True,
        "socks": True,
        "tail_tip": "#FAF8F4",
    },
    "dog_samoye": {
        "kind": "dog",
        "base": "#FCF9F4",
        "secondary": "#EDE7DC",
        "stripe": "#DFD7CA",
        "cream": "#FFFFFF",
        "ear_outer": "#F6F1E8",
        "ear_inner": "#F0ACA8",
        "blush": "#F4AAA8",
        "nose": "#262120",
        "eye": "#221914",
        "eye_iris": "#6C4428",
        "mouth": "#6A473E",
        "pattern": "solid_white",
        "blaze": False,
        "eyebrows": False,
        "socks": False,
        "tail_tip": "#FFFFFF",
    },
})


def plush_vertex_color_v3(nx: float, ny: float, nz: float, ao: float = 1.0, unshaded: bool = False):
    if unshaded:
        return (1.0, 1.0, 1.0, 1.0)
    lx, ly, lz = vec_norm(-0.26, 0.82, 0.50)
    ndotl = nx * lx + ny * ly + nz * lz
    wrap = clamp(ndotl * 0.5 + 0.5, 0.0, 1.0)
    key = 0.74 + 0.27 * (wrap ** 0.80)
    rim = 0.045 * smoothstep(0.30, 1.0, ny) * smoothstep(-0.2, 0.6, -nz)
    bounce = 0.055 * smoothstep(0.05, -0.92, ny)
    r = clamp((key * 1.01 + rim + bounce * 0.96) * ao, 0.64, 1.0)
    g = clamp((key * 0.99 + rim * 0.96 + bounce * 0.86) * ao, 0.61, 1.0)
    b = clamp((key * 0.95 + rim * 0.90 + bounce * 0.78) * ao, 0.58, 1.0)
    return (round(r, 4), round(g, 4), round(b, 4), 1.0)


def make_grid_mesh_v3(nu: int, nv: int, eval_fn, ao_fn=None, unshaded: bool = False):
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
        c = plush_vertex_color_v3(normals[k * 3], normals[k * 3 + 1], normals[k * 3 + 2], aos[k], unshaded=unshaded)
        colors.extend(c)
    return {
        "positions": [round(v, 5) for v in positions],
        "normals": normals,
        "uvs": [round(v, 5) for v in uvs],
        "colors": colors,
        "indices": indices,
    }


def make_ellipsoid_v3(center, radii, uv_box, rot_euler=(0.0, 0.0, 0.0), nu=16, nv=12, unshaded=False):
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
        return cx + x3, cy + y2, cz + z3, lerp(u0, u1, px), lerp(v0, v1, py)

    return make_grid_mesh_v3(nu, nv, eval_fn, unshaded=unshaded)


def build_body_v3(kind: str) -> dict:
    is_cat = kind == "cat"
    rx_base = 0.54
    ry_base = 0.45
    rz_base = 0.66 if is_cat else 0.65
    cy, cz = 0.62, -0.10

    def eval_fn(uf: float, vf: float):
        theta = lerp(0.015, math.pi - 0.015, vf)
        az = (uf - 0.5) * 2.0 * math.pi
        st, ct = math.sin(theta), math.cos(theta)
        sa, ca = math.sin(az), math.cos(az)
        rear_full = 1.0 + 0.10 * smoothstep(0.25, -0.7, ca)
        chest_puff = 1.0 + 0.06 * math.exp(-((ca - 0.78) / 0.34) ** 2)
        x = rx_base * rear_full * st * sa
        y_raw = ry_base * chest_puff * ct
        if y_raw < 0:
            y_raw *= 0.87
        y = cy + y_raw + 0.032 * smoothstep(-0.1, -0.85, ca) * (st ** 1.2)
        z = cz + rz_base * st * ca
        return x, y, z, 0.53 + uf * 0.44, 0.03 + vf * 0.44

    def ao_fn(x: float, y: float, z: float, uf: float, vf: float):
        ao = lerp(0.80, 1.0, smoothstep(0.18, 0.54, y))
        neck_d = math.hypot(x * 1.1, (y - 0.88) * 1.35, (z - 0.48) * 1.3)
        return ao * lerp(0.80, 1.0, smoothstep(0.16, 0.48, neck_d))

    return make_grid_mesh_v3(38, 26, eval_fn, ao_fn)


def build_head_v3(kind: str) -> dict:
    is_cat = kind == "cat"
    rx_base = 0.66 if is_cat else 0.63
    ry_base = 0.61 if is_cat else 0.62
    rz_base = 0.60 if is_cat else 0.61

    def eval_fn(uf: float, vf: float):
        theta = lerp(0.015, math.pi - 0.015, vf)
        az = (uf - 0.5) * 2.0 * math.pi
        st, ct = math.sin(theta), math.cos(theta)
        sa, ca = math.sin(az), math.cos(az)
        ux, uy, uz = st * sa, ct, st * ca

        cheek_band = math.exp(-((uy + 0.22) / 0.44) ** 2)
        crown_round = 0.038 * math.exp(-((uy - 0.46) / 0.34) ** 2)
        rx = rx_base * (1.0 + (0.105 if is_cat else 0.110) * cheek_band + crown_round)
        x = ux * rx
        y = uy * ry_base
        if uy > 0.60:
            y -= 0.020 * smoothstep(0.60, 1.0, uy)
        z = uz * rz_base

        if uz > 0.3:
            ex_t = 0.31 if is_cat else 0.29
            ey_t = 0.03 if is_cat else 0.06
            for sx in (-1.0, 1.0):
                de = ((ux - sx * ex_t) / 0.19) ** 2 + ((uy - ey_t) / 0.18) ** 2
                z -= 0.018 * math.exp(-de * 2.2) * smoothstep(0.45, 0.90, uz)

        if uz > 0.1:
            muzzle_w = 0.32 if is_cat else 0.36
            muzzle_h = 0.24 if is_cat else 0.29
            muzzle_y = -0.15 if is_cat else -0.12
            dm = ((ux / muzzle_w) ** 2) + (((uy - muzzle_y) / muzzle_h) ** 2)
            muzzle_puff = math.exp(-dm * 1.75) * smoothstep(0.20, 0.85, uz)
            z += (0.105 if is_cat else 0.245) * muzzle_puff
            y -= (0.012 if is_cat else 0.020) * muzzle_puff

            for sx in (-1.0, 1.0):
                px = sx * (0.135 if is_cat else 0.130)
                py = -0.195 if is_cat else -0.190
                dp = ((ux - px) / 0.165) ** 2 + ((uy - py) / 0.135) ** 2
                pad = math.exp(-dp * 2.3) * smoothstep(0.42, 0.92, uz)
                z += (0.064 if is_cat else 0.062) * pad

        for sx in (-1.0, 1.0):
            dc = ((ux - sx * 0.65) / 0.42) ** 2 + ((uy + 0.25) / 0.36) ** 2 + ((uz - 0.25) / 0.65) ** 2
            puff = math.exp(-dc * 1.50)
            x += sx * (0.048 if is_cat else 0.052) * puff
            z += 0.032 * puff

        if y < -0.50:
            y = -0.50 + (y + 0.50) * 0.70

        return x, y, z, 0.03 + uf * 0.44, 0.03 + vf * 0.44

    def ao_fn(x: float, y: float, z: float, uf: float, vf: float):
        return lerp(0.80, 1.0, smoothstep(-0.58, -0.14, y))

    return make_grid_mesh_v3(46, 32, eval_fn, ao_fn)


def build_upright_ear_v3(side: int, is_dog: bool = False) -> dict:
    ear_h = 0.54 if is_dog else 0.50
    ear_w = 0.31 if is_dog else 0.30
    ear_d = 0.17 if is_dog else 0.165
    tilt_deg = -16.0 if is_dog else -18.0

    def eval_fn(uf: float, vf: float):
        t = lerp(0.015, 0.99, vf)
        angle = (uf - 0.5) * 2.0 * math.pi
        sa, ca = math.sin(angle), math.cos(angle)

        env_w = math.sin(lerp(0.16, math.pi - 0.02, t)) ** 0.64 * (1.0 - 0.56 * (t ** 1.18))
        env_d = math.sin(lerp(0.16, math.pi - 0.02, t)) ** 0.62 * (1.0 - 0.44 * t)
        lx = ear_w * max(0.026, env_w) * sa
        lz = ear_d * max(0.024, env_d) * ca
        ly = ear_h * (t ** 0.92) - 0.08

        front_mask = smoothstep(0.32, 0.88, ca) * smoothstep(0.12, 0.32, t) * smoothstep(0.84, 0.52, t) * smoothstep(0.82, 0.35, abs(sa))
        lz -= 0.068 * front_mask

        tilt = math.radians(side * tilt_deg)
        rx = lx * math.cos(tilt) - ly * math.sin(tilt)
        ry = lx * math.sin(tilt) + ly * math.cos(tilt)
        rz = lz + 0.028 * t

        in_inner = ca >= 0.46 and abs(sa) <= 0.70 and 0.14 <= t <= 0.78
        if in_inner:
            u = 0.37 + (sa / 0.70) * 0.068
            v = 0.70 - ((t - 0.14) / 0.64) * 0.13
        else:
            u = 0.13 + sa * 0.088
            v = 0.72 - t * 0.175
        return rx, ry, rz, u, v

    def ao_fn(x: float, y: float, z: float, uf: float, vf: float):
        angle = (uf - 0.5) * 2.0 * math.pi
        ca, sa = math.cos(angle), math.sin(angle)
        inner = smoothstep(0.36, 0.90, ca) * smoothstep(0.12, 0.40, vf) * smoothstep(0.84, 0.50, vf) * smoothstep(0.75, 0.25, abs(sa))
        return lerp(1.0, 0.80, inner)

    return make_grid_mesh_v3(28, 18, eval_fn, ao_fn)


def build_dog_floppy_ear_v3(side: int) -> dict:
    ear_len = 0.68
    ear_w = 0.33
    ear_thick = 0.135

    def eval_fn(uf: float, vf: float):
        t = lerp(0.015, 0.985, vf)
        angle = (uf - 0.5) * 2.0 * math.pi
        sa, ca = math.sin(angle), math.cos(angle)

        flap_env = (math.sin(t * math.pi) ** 0.42) * (0.76 + 0.38 * t)
        thick_env = (math.sin(t * math.pi) ** 0.48) * (1.05 - 0.20 * t)

        cx = side * (0.02 + 0.24 * math.sin(t * math.pi * 0.62) + 0.04 * (t ** 1.3))
        cy = -ear_len * (t ** 1.15) + 0.17 * math.sin(t * math.pi * 0.58)
        cz = 0.04 + 0.10 * math.sin(t * math.pi * 0.80) + 0.14 * (t ** 1.10)

        lx = ear_thick * thick_env * ca * side + 0.045 * flap_env * sa * side
        lz = ear_w * flap_env * sa
        ly = 0.025 * thick_env * math.cos(t * math.pi)
        return cx + lx, cy + ly, cz + lz, 0.13 + sa * 0.088, 0.54 + t * 0.18

    def ao_fn(x: float, y: float, z: float, uf: float, vf: float):
        ca = math.cos((uf - 0.5) * 2.0 * math.pi)
        inner = smoothstep(0.05, -0.80, ca)
        fold_ao = 1.0 - 0.10 * math.exp(-((vf - 0.24) / 0.14) ** 2) * smoothstep(0.0, -0.7, ca)
        return lerp(1.0, 0.78, inner) * fold_ao

    return make_grid_mesh_v3(28, 20, eval_fn, ao_fn)


def build_leg_v3(kind: str, is_front: bool, side: int) -> dict:
    is_cat = kind == "cat"
    leg_len = 0.41
    top_r = 0.168 if is_cat else 0.178
    mid_r = 0.148 if is_cat else 0.158
    paw_r = 0.194 if is_cat else 0.204

    def eval_fn(uf: float, vf: float):
        angle = (uf - 0.5) * 2.0 * math.pi
        sa, ca = math.sin(angle), math.cos(angle)
        if vf < 0.20:
            s = vf / 0.20
            ang = lerp(0.03, math.pi * 0.5, s)
            r = top_r * math.sin(ang)
            y = 0.12 * math.cos(ang)
            z_off = 0.0
        elif vf < 0.80:
            s = (vf - 0.20) / 0.60
            y = -s * (leg_len - 0.095)
            paw_bulge = smoothstep(0.40, 1.0, s)
            r = lerp(top_r, mid_r, smoothstep(0.0, 0.45, s)) + (paw_r - mid_r) * paw_bulge
            z_off = 0.068 * paw_bulge
            if paw_bulge > 0.2 and ca > 0.15:
                toe_wave = abs(math.cos(sa * math.pi * 1.5)) * smoothstep(0.20, 0.90, ca)
                r += 0.020 * paw_bulge * toe_wave
        else:
            s = (vf - 0.80) / 0.20
            ang = lerp(0.0, math.pi * 0.5 - 0.02, s)
            r = paw_r * math.cos(ang)
            y = -(leg_len - 0.095) - 0.095 * math.sin(ang)
            z_off = 0.068 * math.cos(ang)
        return r * sa, y, r * ca * 1.10 + z_off, 0.53 + uf * 0.24, 0.53 + vf * 0.44

    def ao_fn(x: float, y: float, z: float, uf: float, vf: float):
        return lerp(0.80, 1.0, smoothstep(0.05, 0.42, vf)) * lerp(1.0, 0.86, smoothstep(0.82, 1.0, vf))

    return make_grid_mesh_v3(22, 18, eval_fn, ao_fn)


def build_face_accents_v3(kind: str) -> dict:
    is_cat = kind == "cat"
    parts = []
    eye_x = 0.208 if is_cat else 0.194
    eye_y = 0.015 if is_cat else 0.040
    eye_z = 0.576 if is_cat else 0.598
    eye_r = (0.106, 0.112, 0.058) if is_cat else (0.100, 0.106, 0.056)

    for sx in (-1.0, 1.0):
        parts.append(
            make_ellipsoid_v3(
                center=(sx * eye_x, eye_y + 0.004, eye_z - 0.010),
                radii=(eye_r[0] * 1.11, eye_r[1] * 1.11, eye_r[2] * 0.72),
                uv_box=(0.82, 0.88, 0.96, 0.98),
                rot_euler=(0.0, sx * 15.0, 0.0),
                nu=18, nv=14, unshaded=True,
            )
        )
        parts.append(
            make_ellipsoid_v3(
                center=(sx * eye_x, eye_y, eye_z),
                radii=eye_r,
                uv_box=(0.810, 0.525, 0.975, 0.690),
                rot_euler=(0.0, sx * 15.0, 0.0),
                nu=22, nv=18, unshaded=True,
            )
        )

    nose_y = -0.078 if is_cat else -0.055
    nose_z = 0.674 if is_cat else 0.812
    nose_r = (0.056, 0.040, 0.040) if is_cat else (0.095, 0.068, 0.060)
    parts.append(
        make_ellipsoid_v3(
            center=(0.0, nose_y, nose_z),
            radii=nose_r,
            uv_box=(0.810, 0.720, 0.975, 0.840),
            rot_euler=(10.0, 0.0, 0.0),
            nu=18, nv=14, unshaded=True,
        )
    )

    if is_cat:
        for sx in (-1.0, 1.0):
            for idx, (wy, ang_z) in enumerate([(-0.145, 7.0), (-0.185, -2.0), (-0.225, -11.0)]):
                parts.append(
                    make_ellipsoid_v3(
                        center=(sx * 0.34, wy, 0.548 - idx * 0.012),
                        radii=(0.165, 0.0085, 0.0085),
                        uv_box=(0.24, 0.36, 0.26, 0.38),
                        rot_euler=(0.0, -sx * 24.0, sx * ang_z),
                        nu=8, nv=6, unshaded=True,
                    )
                )
    return merge_meshes(parts)


def build_rig_v3(kind: str) -> dict:
    is_cat = kind == "cat"
    is_upright_dog = kind == "dog_upright"
    body_kind = "cat" if is_cat else "dog"
    head_pivot = [0.0, 1.04 if is_cat else 1.02, 0.44]
    if is_cat:
        ear_l_pivot = [0.34, 0.44, 0.04]
    elif is_upright_dog:
        ear_l_pivot = [0.34, 0.45, 0.04]
    else:
        ear_l_pivot = [0.36, 0.49, 0.06]
    ear_r_pivot = [-ear_l_pivot[0], ear_l_pivot[1], ear_l_pivot[2]]
    leg_y, leg_x = 0.40, 0.25
    leg_fz = 0.30 if is_cat else 0.29
    leg_bz = -0.40 if is_cat else -0.39
    tail_pivot = [0.0, 0.68, -0.68 if is_cat else -0.64]

    ear_l = build_upright_ear_v3(1, False) if is_cat else (build_upright_ear_v3(1, True) if is_upright_dog else build_dog_floppy_ear_v3(1))
    ear_r = build_upright_ear_v3(-1, False) if is_cat else (build_upright_ear_v3(-1, True) if is_upright_dog else build_dog_floppy_ear_v3(-1))

    parts = {
        "body": build_body_v3(body_kind),
        "head": build_head_v3(body_kind),
        "face": build_face_accents_v3(body_kind),
        "earL": ear_l,
        "earR": ear_r,
        "legFL": build_leg_v3(body_kind, True, 1),
        "legFR": build_leg_v3(body_kind, True, -1),
        "legBL": build_leg_v3(body_kind, False, 1),
        "legBR": build_leg_v3(body_kind, False, -1),
        "tail": bpr.build_tail(body_kind),
    }
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
        "stats": {
            "vertices": sum(len(m["positions"]) // 3 for m in parts.values()),
            "triangles": sum(len(m["indices"]) // 3 for m in parts.values()),
        },
        "parts": parts,
    }


def generate_radial_plush_fur(size: int, seed: int) -> Image.Image:
    rng = random.Random(seed)
    img = Image.new("L", (size, size), 128)
    d = ImageDraw.Draw(img)
    for _ in range(14000):
        x = rng.randint(0, 511)
        y = rng.randint(0, 511)
        ang = math.atan2(y - 265, x - 256) + rng.uniform(-0.22, 0.22)
        length = rng.uniform(5.0, 11.0)
        v = 128 + rng.choice([-22, -16, -11, 11, 16, 22])
        d.line([(x, y), (x + math.cos(ang) * length, y + math.sin(ang) * length)], fill=v, width=1)
    for _ in range(12000):
        x = rng.randint(0, size - 1)
        y = rng.randint(0, size - 1)
        if x < 512 and y < 512:
            continue
        v = 128 + rng.choice([-18, -13, 13, 18])
        d.line([(x, y), (x + rng.randint(-2, 2), y + rng.randint(4, 10))], fill=v, width=1)
    return img.filter(ImageFilter.GaussianBlur(radius=0.65))


def paint_doll_eye_and_nose(img: Image.Image, cfg: dict):
    eye = hex_rgb(cfg["eye"])
    iris = hex_rgb(cfg["eye_iris"])
    nose = hex_rgb(cfg["nose"])
    mouth = hex_rgb(cfg["mouth"])

    eye_box = Image.new("RGBA", (220, 220), (*eye, 255))
    draw_soft_ellipse(eye_box, 110, 132, 70, 58, iris, alpha=225, blur=14)
    draw_soft_ellipse(eye_box, 110, 146, 54, 34, lerp_rgb(iris, (255, 240, 215), 0.35), alpha=160, blur=10)
    draw_soft_ellipse(eye_box, 110, 104, 44, 46, (16, 12, 10), alpha=245, blur=4)
    draw_soft_ellipse(eye_box, 72, 70, 26, 24, (255, 255, 255), alpha=255, blur=1.2)
    draw_soft_ellipse(eye_box, 146, 142, 11, 10, (255, 252, 245), alpha=235, blur=1.0)
    img.paste(eye_box.resize((209, 208), Image.Resampling.LANCZOS), (815, 512))

    nose_box = Image.new("RGBA", (210, 152), (*nose, 255))
    nose_hi = lerp_rgb(nose, (255, 248, 242), 0.52)
    nose_lo = lerp_rgb(nose, (20, 12, 10), 0.38)
    draw_soft_ellipse(nose_box, 105, 42, 58, 22, nose_hi, alpha=185, blur=8)
    draw_soft_ellipse(nose_box, 92, 36, 26, 10, (255, 252, 248), alpha=150, blur=4)
    draw_soft_ellipse(nose_box, 105, 122, 84, 34, nose_lo, alpha=165, blur=12)
    draw_soft_ellipse(nose_box, 74, 86, 13, 8, nose_lo, alpha=145, blur=3)
    draw_soft_ellipse(nose_box, 136, 86, 13, 8, nose_lo, alpha=145, blur=3)
    img.paste(nose_box.resize((209, 152), Image.Resampling.LANCZOS), (815, 720))

    rim_col = lerp_rgb(mouth, (38, 22, 16), 0.65)
    img.paste(Image.new("RGBA", (209, 152), (*rim_col, 255)), (815, 872))


def generate_skin_v3(skin_key: str, cfg: dict, fur_noise: Image.Image) -> Image.Image:
    # Base body/ears/legs/tail from bpr
    bpr_cfg = dict(cfg)
    if bpr_cfg["pattern"] in ("solid_white", "siamese", "husky"):
        bpr_cfg["pattern"] = "ragdoll_point" if bpr_cfg["pattern"] == "siamese" else "sesame_collie" if bpr_cfg["pattern"] == "husky" else "golden"
    img = bpr.generate_skin_texture(skin_key, bpr_cfg, fur_noise)

    base = hex_rgb(cfg["base"])
    sec = hex_rgb(cfg["secondary"])
    stripe = hex_rgb(cfg["stripe"])
    cream = hex_rgb(cfg["cream"])
    blush = hex_rgb(cfg["blush"])
    mouth = hex_rgb(cfg["mouth"])
    tongue = hex_rgb("#EB8288")
    pattern = cfg["pattern"]
    is_cat = cfg["kind"] == "cat"
    shadow_warm = lerp_rgb(sec, (78, 48, 28), 0.36)

    q1 = Image.new("RGBA", (512, 512), (*base, 255))
    draw_soft_ellipse(q1, 256, 114, 268, 148, sec, alpha=165, blur=36)
    draw_soft_ellipse(q1, 28, 242, 100, 218, sec, alpha=125, blur=30)
    draw_soft_ellipse(q1, 484, 242, 100, 218, sec, alpha=125, blur=30)

    # Pattern-specific head coat markings
    if pattern in ("tabby_soft", "tabby_bold"):
        alpha_s = 215 if pattern == "tabby_soft" else 235
        for sx in (-1, 1):
            draw_soft_line(q1, [(256 + sx * 12, 202), (256 + sx * 24, 140), (256 + sx * 38, 86)], stripe, width=18, alpha=alpha_s, blur=4)
            draw_soft_line(q1, [(256 + sx * 44, 194), (256 + sx * 60, 132), (256 + sx * 76, 84)], stripe, width=15, alpha=alpha_s - 12, blur=4)
            draw_soft_line(q1, [(256 + sx * 82, 254), (256 + sx * 154, 242)], stripe, width=17, alpha=alpha_s - 10, blur=4)
            draw_soft_line(q1, [(256 + sx * 88, 282), (256 + sx * 158, 288)], stripe, width=13, alpha=alpha_s - 35, blur=4)
    elif pattern == "cloud_soft":
        draw_soft_ellipse(q1, 256, 126, 198, 108, sec, alpha=190, blur=30)
        for sx in (-1, 1):
            draw_soft_line(q1, [(256 + sx * 14, 178), (256 + sx * 24, 122)], stripe, width=12, alpha=160, blur=5)
            draw_soft_line(q1, [(256 + sx * 40, 168), (256 + sx * 52, 118)], stripe, width=11, alpha=145, blur=5)
    elif pattern == "ragdoll_point":
        draw_soft_ellipse(q1, 256, 244, 96, 68, stripe, alpha=215, blur=20)
        draw_soft_ellipse(q1, 256, 282, 62, 42, stripe, alpha=190, blur=15)
    elif pattern == "siamese":
        draw_soft_ellipse(q1, 256, 252, 112, 86, stripe, alpha=245, blur=18)
        draw_soft_ellipse(q1, 256, 294, 72, 54, stripe, alpha=245, blur=14)
    elif pattern == "calico":
        dark_patch = hex_rgb(cfg["patch_dark"])
        draw_soft_ellipse(q1, 160, 152, 92, 76, stripe, alpha=245, blur=13)
        draw_soft_ellipse(q1, 352, 152, 90, 74, dark_patch, alpha=240, blur=13)
        draw_soft_ellipse(q1, 116, 232, 58, 48, dark_patch, alpha=205, blur=13)
    elif pattern in ("sesame_collie", "husky"):
        draw_soft_ellipse(q1, 256, 148, 240, 148, sec, alpha=195, blur=22)

    # Lower cheek & muzzle cream mask (kept cleanly BELOW the eye line y=250 so breed fur wraps around eyes!)
    if pattern == "golden":
        gl = lerp_rgb(base, cream, 0.58)
        draw_soft_ellipse(q1, 256, 370, 168, 102, gl, alpha=165, blur=22)
        draw_soft_ellipse(q1, 256, 310, 82, 52, gl, alpha=175, blur=14)
        draw_soft_ellipse(q1, 256, 450, 235, 82, gl, alpha=155, blur=20)
    elif pattern in ("british_blue", "solid_white"):
        lt = lerp_rgb(base, cream, 0.50)
        draw_soft_ellipse(q1, 256, 370, 160, 100, lt, alpha=125, blur=22)
        draw_soft_ellipse(q1, 256, 450, 225, 78, lt, alpha=125, blur=20)
    elif pattern == "siamese":
        # Siamese keeps dark chocolate snout & cheeks; no white overlay on muzzle!
        pass
    else:
        m_alpha = 130 if pattern == "ragdoll_point" else 252
        draw_soft_ellipse(q1, 256, 372, 178, 106, cream, alpha=m_alpha, blur=15)
        if pattern != "ragdoll_point":
            draw_soft_ellipse(q1, 256, 312, 74, 50, cream, alpha=m_alpha, blur=11)
        draw_soft_ellipse(q1, 256, 452, 250, 84, cream, alpha=250, blur=18)

    if cfg.get("blaze"):
        top_y = 74 if not is_cat else 148
        blaze_pts = [(256, top_y), (273, 198), (280, 300), (232, 300), (239, 198)]
        draw_soft_polygon(q1, blaze_pts, cream, alpha=252, blur=7)

    if cfg.get("eyebrows"):
        for sx in (-1, 1):
            draw_soft_ellipse(q1, 256 + sx * 45, 203, 18, 14, shadow_warm, alpha=82, blur=4)
            draw_soft_ellipse(q1, 256 + sx * 45, 198, 17, 14, cream, alpha=252, blur=2.2)

    # Eye-socket plush cradle shadow + rosy blush
    eye_cy = 248 if is_cat else 244
    eye_dx = 47 if is_cat else 45
    blush_a = 155 if skin_key in ("cat_yunduo", "dog_taotao") else (65 if pattern == "siamese" else 112)
    for sx in (-1, 1):
        draw_soft_ellipse(q1, 256 + sx * eye_dx, eye_cy, 25, 23, shadow_warm, alpha=82, blur=8)
        draw_soft_ellipse(q1, 256 + sx * 78, 298, 25, 16, blush, alpha=blush_a, blur=10)

    # Adorable smiling mouth + subtle rosy open smile tongue
    if is_cat:
        if pattern != "siamese":
            draw_soft_ellipse(q1, 256, 294, 10.5, 7.2, tongue, alpha=225, blur=1.0)
        draw_soft_line(q1, [(256, 268), (256, 286)], mouth, width=4, alpha=225, blur=0.7)
        draw_soft_line(q1, [(236, 284), (246, 293), (256, 286), (266, 293), (276, 284)], mouth, width=4, alpha=235, blur=0.7)
    else:
        draw_soft_ellipse(q1, 256, 312, 34, 12, shadow_warm, alpha=42, blur=6)
        draw_soft_ellipse(q1, 256, 298, 14, 9.5, tongue, alpha=235, blur=1.0)
        draw_soft_line(q1, [(256, 266), (256, 286)], mouth, width=4, alpha=225, blur=0.7)
        draw_soft_line(q1, [(228, 284), (242, 296), (256, 285), (270, 296), (284, 284)], mouth, width=5, alpha=235, blur=0.8)

    # Apply radial plush wool micro-fibers to Q1
    q1_noise = fur_noise.crop((0, 0, 512, 512))
    q1_px = q1.load()
    n_px = q1_noise.load()
    fur_amp = 0.72 if pattern == "solid_white" else 0.95
    for y in range(512):
        for x in range(512):
            r, g, b, a = q1_px[x, y]
            d = (n_px[x, y] - 128) * fur_amp
            q1_px[x, y] = (int(clamp(r + d, 0, 255)), int(clamp(g + d, 0, 255)), int(clamp(b + d, 0, 255)), a)

    img.paste(q1, (0, 0))
    toe_col = lerp_rgb(cream, shadow_warm, 0.35)
    for tx in (644, 676):
        draw_soft_line(img, [(tx, 900), (tx, 958)], toe_col, width=4, alpha=130, blur=1.5)

    paint_doll_eye_and_nose(img, cfg)
    return img.resize((512, 512), Image.Resampling.LANCZOS).convert("RGB")


def main():
    pets_dir = ROOT / "assets" / "resources" / "pets"
    skins_dir = pets_dir / "skins"

    for kind in ("cat", "dog", "dog_upright"):
        rig = build_rig_v3(kind)
        out_json = pets_dir / f"{kind}-rig.json"
        out_json.write_text(json.dumps(rig, separators=(",", ":")), encoding="utf-8")
        print(f"[rig-v3.1] {kind}-rig.json: {rig['stats']['vertices']} verts, {rig['stats']['triangles']} tris")

    fur_noise = generate_radial_plush_fur(1024, seed=20261129)
    for skin_key, cfg in ALL_BREED_SKINS.items():
        skin_img = generate_skin_v3(skin_key, cfg, fur_noise)
        out_png = skins_dir / f"{skin_key}.png"
        skin_img.save(out_png, optimize=True)
        print(f"[skin-v3.1] {skin_key}.png ({out_png.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
