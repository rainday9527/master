"""Generate cohesive hand-painted Cat Paradise UI assets for Album & Pet Profile:
1. Rarity card frames (card-r.png, card-sr.png, card-ssr.png) derived from the
   authentic hand-painted texture & double-bevel geometry of art/shop/card.png,
   with cozy botanical/sparkle/royal corner ornaments and 9-slice Cocos metas.
2. Wide non-stretched tab buttons (tab-active.png, tab-normal.png) stitched from
   the authentic hand-painted art/daily/button.png & art/shop/tab.png caps so
   corners stay perfectly circular at wide 4:1 aspect ratios, with 9-slice metas.
3. Glossy hand-painted enamel & gold-rimmed rarity emblem badges
   (rarity-r.png, rarity-sr.png, rarity-ssr.png) rendered at 4x supersampling.
"""
from __future__ import annotations

import json
import math
import uuid
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SHOP_CARD = ROOT / "assets" / "resources" / "art" / "shop" / "card.png"
SHOP_TAB = ROOT / "assets" / "resources" / "art" / "shop" / "tab.png"
DAILY_BTN = ROOT / "assets" / "resources" / "art" / "daily" / "button.png"
OUT_DIR = ROOT / "assets" / "resources" / "art" / "album"


def clamp(v: float, lo: float = 0.0, hi: float = 255.0) -> int:
    return int(round(lo if v < lo else hi if v > hi else v))


def lerp_rgb(c1, c2, t: float):
    t = max(0.0, min(1.0, t))
    return (
        clamp(c1[0] + (c2[0] - c1[0]) * t),
        clamp(c1[1] + (c2[1] - c1[1]) * t),
        clamp(c1[2] + (c2[2] - c1[2]) * t),
    )


def ensure_sprite_meta(png_path: Path, width: int, height: int, border=(0, 0, 0, 0)):
    """Write or preserve Cocos Creator 3.8.8 image + texture + sprite-frame meta."""
    meta_path = png_path.with_suffix(png_path.suffix + ".meta")
    if meta_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        u = meta["uuid"]
    else:
        u = str(uuid.uuid4())
    bt, bb, bl, br = border
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
                "displayName": png_path.stem,
                "id": "6c48a",
                "name": "texture",
            },
            "f9941": {
                "ver": "1.0.12",
                "importer": "sprite-frame",
                "uuid": f"{u}@f9941",
                "imported": True,
                "files": [".json"],
                "subMetas": {},
                "userData": {
                    "trimType": "none",
                    "trimThreshold": 1,
                    "rotated": False,
                    "offsetX": 0,
                    "offsetY": 0,
                    "trimX": 0,
                    "trimY": 0,
                    "width": width,
                    "height": height,
                    "rawWidth": width,
                    "rawHeight": height,
                    "borderTop": bt,
                    "borderBottom": bb,
                    "borderLeft": bl,
                    "borderRight": br,
                    "packable": True,
                    "pixelsToUnit": 100,
                    "pivotX": 0.5,
                    "pivotY": 0.5,
                    "meshType": 0,
                    "isUuid": True,
                    "imageUuidOrDatabaseUri": f"{u}@6c48a",
                },
                "displayName": png_path.stem,
                "id": "f9941",
                "name": "spriteFrame",
            },
        },
        "userData": {
            "type": "sprite-frame",
            "fixAlphaTransparencyArtifacts": True,
            "hasAlpha": True,
            "redirect": f"{u}@f9941",
            "compressSettings": {"useCompressTexture": False, "presetId": ""},
        },
    }
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def stitch_pill(src_path: Path, out_w: int, out_h: int, tint_fn=None) -> Image.Image:
    """Create a wide pill button from an existing hand-painted pill by keeping
    exact circular end-caps and smoothly tiling/stretching only the flat center."""
    src = Image.open(src_path).convert("RGBA")
    # Crop tight to alpha
    bb = src.getbbox()
    if bb:
        src = src.crop(bb)
    sw, sh = src.size
    # Scale source so its height matches out_h exactly -> preserves exact circular cap proportions!
    scale = out_h / sh
    scaled_w = max(out_h, int(round(sw * scale)))
    scaled = src.resize((scaled_w, out_h), Image.Resampling.LANCZOS)
    cap = min(int(out_h * 0.52), scaled_w // 3)
    left_cap = scaled.crop((0, 0, cap, out_h))
    right_cap = scaled.crop((scaled_w - cap, 0, scaled_w, out_h))
    mid_src = scaled.crop((cap, 0, scaled_w - cap, out_h))
    mid_w = max(2, out_w - 2 * cap)
    mid = mid_src.resize((mid_w, out_h), Image.Resampling.BICUBIC)
    canvas = Image.new("RGBA", (out_w, out_h), (0, 0, 0, 0))
    canvas.paste(left_cap, (0, 0))
    canvas.paste(mid, (cap, 0))
    canvas.paste(right_cap, (out_w - cap, 0))
    if tint_fn is not None:
        px = canvas.load()
        for y in range(out_h):
            for x in range(out_w):
                r, g, b, a = px[x, y]
                if a > 0:
                    nr, ng, nb = tint_fn(r, g, b, x / out_w, y / out_h)
                    px[x, y] = (nr, ng, nb, a)
    return canvas


def build_tabs():
    # Exact 2x resolution for 212x58 / 224x56 wide pill tabs -> 448x116 (ratio 3.86:1)
    w, h = 448, 116
    # Active tab: warm golden toasted-honey wooden pill from daily/button.png with sunny top glow
    def active_tint(r, g, b, u, v):
        # Slightly warmer honey-amber brightening on upper half for clear active highlight
        lift = 1.0 + 0.08 * max(0.0, 0.55 - v)
        nr = clamp(r * 1.07 * lift)
        ng = clamp(g * 1.06 * lift + 4)
        nb = clamp(b * 0.96 * lift)
        return (nr, ng, nb)

    active = stitch_pill(DAILY_BTN, w, h, active_tint)
    # Normal tab: soft warm cream parchment wooden pill from shop/tab.png (slightly softer/lighter)
    def normal_tint(r, g, b, u, v):
        nr = clamp(r * 0.99 + 3)
        ng = clamp(g * 0.98 + 3)
        nb = clamp(b * 0.99 + 4)
        return (nr, ng, nb)

    normal = stitch_pill(SHOP_TAB, w, h, normal_tint)

    for name, img in (("tab-active", active), ("tab-normal", normal)):
        p = OUT_DIR / f"{name}.png"
        img.save(p)
        ensure_sprite_meta(p, w, h, border=(32, 32, 58, 58))
        print("wrote", p.name, img.size)


def draw_star(draw: ImageDraw.ImageDraw, cx, cy, r_out, r_in, fill, outline=None, width=2, points=4):
    pts = []
    for i in range(points * 2):
        ang = -math.pi / 2 + i * math.pi / points
        r = r_out if i % 2 == 0 else r_in
        pts.append((cx + math.cos(ang) * r, cy + math.sin(ang) * r))
    draw.polygon(pts, fill=fill)
    if outline:
        draw.line(pts + [pts[0]], fill=outline, width=width, joint="curve")


def draw_leaf_pair(draw: ImageDraw.ImageDraw, cx, cy, size, fill, hi, outline, flip_x=1):
    # Two cute hand-drawn mini clover/leaf accents tucked cleanly into corner rim
    for ang_deg, scale in ((-38, 1.0), (14, 0.82)):
        ang = math.radians(ang_deg)
        lx = cx + flip_x * math.cos(ang) * size * 0.55 * scale
        ly = cy + math.sin(ang) * size * 0.55 * scale
        rx = size * 0.48 * scale
        ry = size * 0.28 * scale
        pts = []
        for k in range(16):
            t = k * 2 * math.pi / 16
            px = math.cos(t) * rx
            py = math.sin(t) * ry
            # rotate by ang
            c, s = math.cos(ang), math.sin(ang)
            pts.append((lx + flip_x * (px * c - py * s), ly + (px * s + py * c)))
        draw.polygon(pts, fill=fill)
        draw.line(pts + [pts[0]], fill=outline, width=3)
        # tiny specular vein
        draw.line([(cx, cy), (lx, ly)], fill=hi, width=2)


def build_rarity_cards():
    """Transform authentic hand-painted art/shop/card.png into cohesive R / SR / SSR
    hand-painted storybook cards while preserving its organic wood/parchment grain
    and double-bevel border!"""
    base = Image.open(SHOP_CARD).convert("RGBA")
    bb = base.getbbox()
    if bb:
        base = base.crop(bb)
    # Render at 360x360 so 9-slice borders stay crisp on both 232x224 Album cards & 744x240 Hero card
    W, H = 360, 360
    base = base.resize((W, H), Image.Resampling.LANCZOS)

    # Measure luminance & border-vs-inner region from base card (shop/card.png has cream center ~(246,227,196)
    # and darker warm amber border ~(160,120,38) + specular white highlight ~(255,248,232))
    configs = {
        "card-r": {
            # Cozy meadow-sage green hand-painted card (R)
            "dark_rim": (78, 118, 66),     # warm mossy-olive outline
            "mid_rim": (118, 178, 108),    # sage green painted wood border
            "hi_rim": (214, 245, 198),     # sunny mint bevel highlight
            "inner_lo": (222, 243, 212),   # soft sage-cream paper shadow
            "inner_hi": (244, 252, 237),   # luminous pale mint-cream center
            "accent": "leaf",
        },
        "card-sr": {
            # Dreamy sky-azure hand-painted card (SR)
            "dark_rim": (64, 102, 152),    # warm slate-sapphire outline
            "mid_rim": (106, 166, 228),    # storybook sky-blue painted wood border
            "hi_rim": (216, 240, 255),     # crisp sky specular highlight
            "inner_lo": (220, 237, 252),   # soft azure-cream paper shadow
            "inner_hi": (243, 250, 255),   # luminous pale sky-cream center
            "accent": "sparkle",
        },
        "card-ssr": {
            # Radiant honey-gold royal hand-painted card (SSR)
            "dark_rim": (146, 90, 24),     # rich toasted-amber outline
            "mid_rim": (236, 176, 66),     # warm golden-honey painted wood border
            "hi_rim": (255, 247, 200),     # radiant champagne-gold specular highlight
            "inner_lo": (252, 232, 184),   # warm honey-parchment edge glow
            "inner_hi": (255, 249, 229),   # luminous warm-ivory center
            "accent": "star",
        },
    }

    bpx = base.load()
    for name, cfg in configs.items():
        img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        px = img.load()
        for y in range(H):
            for x in range(W):
                r, g, b, a = bpx[x, y]
                if a == 0:
                    continue
                # Normalized distance to nearest edge (0 at outer edge, 1 inside)
                dx = min(x, W - 1 - x)
                dy = min(y, H - 1 - y)
                edge_d = min(dx, dy)
                # Also corner radial distance
                cr = 44.0
                cx = max(cr - dx, 0.0)
                cy = max(cr - dy, 0.0)
                if cx > 0 and cy > 0:
                    edge_d = max(0.0, cr - math.hypot(cx, cy))

                # Original luminance (0..1) preserves 100% of hand-painted paper grain & bevel shading!
                lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
                # Saturation separates golden rim groove from pale parchment center
                sat = (max(r, g, b) - min(r, g, b)) / max(1.0, float(max(r, g, b)))

                # Rim mask: outer 25px belongs to the painted beveled wood frame; smooth transition 20..30px
                rim_t = 1.0 - max(0.0, min(1.0, (edge_d - 20.0) / 10.0))

                # Compute rim color from original bevel luminance
                if lum < 0.72:
                    t = max(0.0, min(1.0, (lum - 0.36) / 0.36))
                    rim_c = lerp_rgb(cfg["dark_rim"], cfg["mid_rim"], t)
                else:
                    t = max(0.0, min(1.0, (lum - 0.72) / 0.28))
                    rim_c = lerp_rgb(cfg["mid_rim"], cfg["hi_rim"], t)

                # Compute parchment inner color preserving subtle paper texture & soft vignette
                inner_t = max(0.0, min(1.0, (lum - 0.80) / 0.16))
                # Soft warm top-to-bottom + radial glow inside parchment
                rad_center = math.hypot((x - W / 2) / (W * 0.55), (y - H / 2) / (H * 0.55))
                vig = max(0.0, min(1.0, 1.0 - rad_center * 0.42))
                inner_c = lerp_rgb(cfg["inner_lo"], cfg["inner_hi"], 0.35 * inner_t + 0.65 * vig)

                out_c = lerp_rgb(inner_c, rim_c, rim_t)
                px[x, y] = (out_c[0], out_c[1], out_c[2], a)

        # Add delicate subtle storybook corner ornaments on bottom-left & bottom-right corners
        # (kept strictly inside the 9-slice corner margins so stretching never distorts them!)
        orn = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        od = ImageDraw.Draw(orn)
        if cfg["accent"] == "leaf":
            draw_leaf_pair(od, 24, H - 24, 18, (112, 184, 96, 235), (218, 248, 198, 220), (68, 108, 56, 240), flip_x=1)
            draw_leaf_pair(od, W - 24, H - 24, 18, (112, 184, 96, 235), (218, 248, 198, 220), (68, 108, 56, 240), flip_x=-1)
        elif cfg["accent"] == "sparkle":
            draw_star(od, 25, H - 25, 11, 4.5, (238, 250, 255, 245), (72, 122, 184, 235), width=2, points=4)
            draw_star(od, W - 25, H - 25, 11, 4.5, (238, 250, 255, 245), (72, 122, 184, 235), width=2, points=4)
            draw_star(od, 41, H - 18, 5.5, 2.2, (164, 214, 255, 230), None, points=4)
            draw_star(od, W - 41, H - 18, 5.5, 2.2, (164, 214, 255, 230), None, points=4)
        elif cfg["accent"] == "star":
            draw_star(od, 26, H - 26, 12, 5.4, (255, 238, 146, 250), (156, 94, 24, 245), width=2, points=5)
            draw_star(od, W - 26, H - 26, 12, 5.4, (255, 238, 146, 250), (156, 94, 24, 245), width=2, points=5)
            draw_star(od, 44, H - 19, 6.0, 2.5, (255, 248, 200, 240), None, points=4)
            draw_star(od, W - 44, H - 19, 6.0, 2.5, (255, 248, 200, 240), None, points=4)

        img = Image.alpha_composite(img, orn)
        p = OUT_DIR / f"{name}.png"
        img.save(p)
        # 9-slice preserves corners & ornaments cleanly on both Album cards & Hero card!
        ensure_sprite_meta(p, W, H, border=(56, 56, 56, 56))
        print("wrote", p.name, img.size)


def load_bold_font(size: int):
    candidates = [
        r"C:\Windows\Fonts\ariblk.ttf",
        r"C:\Windows\Fonts\seguibl.ttf",
        r"C:\Windows\Fonts\msyhbd.ttc",
        r"C:\Windows\Fonts\arialbd.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
    return ImageFont.load_default()


def render_rarity_badge(text: str, cfg: dict) -> Image.Image:
    """Render a 4x supersampled glossy beveled enamel & gold-rimmed rarity badge."""
    S = 4
    w, h = 180, 86
    W, H = w * S, h * S
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    pad_x = 14 * S
    top_y = 18 * S if text == "SSR" else 14 * S
    bot_y = 10 * S
    x0, y0, x1, y1 = pad_x, top_y, W - pad_x, H - bot_y
    rad = (y1 - y0) // 2

    # 1) Soft warm drop shadow underneath
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    sd.rounded_rectangle([x0, y0 + 5 * S, x1, y1 + 5 * S], radius=rad, fill=(78, 46, 18, 95))
    sh = sh.filter(ImageFilter.GaussianBlur(radius=3.5 * S))
    img = Image.alpha_composite(img, sh)
    d = ImageDraw.Draw(img)

    # 2) Outer warm dark-brown ink outline
    d.rounded_rectangle([x0 - 4 * S, y0 - 4 * S, x1 + 4 * S, y1 + 4 * S], radius=rad + 4 * S, fill=cfg["ink"])

    # 3) Metallic gold / silver outer bevel ring (vertical gradient!)
    rim_mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(rim_mask).rounded_rectangle([x0, y0, x1, y1], radius=rad, fill=255)
    rim_grad = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rdraw = ImageDraw.Draw(rim_grad)
    for y in range(y0, y1 + 1):
        t = (y - y0) / max(1, y1 - y0)
        if t < 0.45:
            c = lerp_rgb(cfg["rim_top"], cfg["rim_mid"], t / 0.45)
        else:
            c = lerp_rgb(cfg["rim_mid"], cfg["rim_bot"], (t - 0.45) / 0.55)
        rdraw.line([(x0, y), (x1, y)], fill=(*c, 255))
    img.paste(rim_grad, (0, 0), rim_mask)

    # 4) Inner glossy enamel face
    inset = 5 * S
    ix0, iy0, ix1, iy1 = x0 + inset, y0 + inset, x1 - inset, y1 - inset
    irad = (iy1 - iy0) // 2
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([ix0 - 2 * S, iy0 - 2 * S, ix1 + 2 * S, iy1 + 2 * S], radius=irad + 2 * S, fill=cfg["inner_groove"])

    face_mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(face_mask).rounded_rectangle([ix0, iy0, ix1, iy1], radius=irad, fill=255)
    face_grad = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    fdraw = ImageDraw.Draw(face_grad)
    for y in range(iy0, iy1 + 1):
        t = (y - iy0) / max(1, iy1 - iy0)
        c = lerp_rgb(cfg["face_top"], cfg["face_bot"], t ** 0.95)
        fdraw.line([(ix0, y), (ix1, y)], fill=(*c, 255))
    img.paste(face_grad, (0, 0), face_mask)

    # 5) Curved top glossy candy highlight inside enamel
    gloss = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(gloss)
    gx0, gy0, gx1, gy1 = ix0 + 8 * S, iy0 + 3 * S, ix1 - 8 * S, iy0 + int((iy1 - iy0) * 0.46)
    gd.rounded_rectangle([gx0, gy0, gx1, gy1], radius=(gy1 - gy0) // 2, fill=(255, 255, 255, 115))
    gloss = gloss.filter(ImageFilter.GaussianBlur(radius=1.5 * S))
    gloss_clipped = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gloss_clipped.paste(gloss, (0, 0), face_mask)
    img = Image.alpha_composite(img, gloss_clipped)

    # 6) Subtle decorative side rivets / sparkles inside badge
    d = ImageDraw.Draw(img)
    cy = (iy0 + iy1) // 2
    for side in (-1, 1):
        sx = (ix0 + 18 * S) if side < 0 else (ix1 - 18 * S)
        if text == "SSR":
            draw_star(d, sx, cy, 8 * S, 3.2 * S, (255, 248, 198, 245), cfg["ink"], width=2 * S, points=4)
        elif text == "SR":
            draw_star(d, sx, cy, 7 * S, 2.8 * S, (236, 250, 255, 240), cfg["ink"], width=int(1.6 * S), points=4)
        else:
            # Cute glossy gem rivet dot for R
            r_dot = 4.5 * S
            d.ellipse([sx - r_dot, cy - r_dot, sx + r_dot, cy + r_dot], fill=(230, 255, 212, 235), outline=cfg["ink"], width=int(1.6 * S))

    # 7) Extra tiny crown accent perched on top rim for SSR!
    if text == "SSR":
        cx = W // 2
        crown_pts = [
            (cx - 18 * S, y0 + 2 * S),
            (cx - 21 * S, y0 - 9 * S),
            (cx - 9 * S, y0 - 3 * S),
            (cx, y0 - 11 * S),
            (cx + 9 * S, y0 - 3 * S),
            (cx + 21 * S, y0 - 9 * S),
            (cx + 18 * S, y0 + 2 * S),
        ]
        d.polygon(crown_pts, fill=(255, 224, 96, 255))
        d.line(crown_pts + [crown_pts[0]], fill=cfg["ink"], width=3 * S, joint="curve")

    # 8) Bold embossed typography centered cleanly
    font_size = int((34 if len(text) == 1 else 31 if len(text) == 2 else 28) * S)
    font = load_bold_font(font_size)
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (W - tw) // 2 - bbox[0]
    ty = (iy0 + iy1 - th) // 2 - bbox[1] - 1 * S
    # Warm dark outline + drop shadow + bright cream/white face
    for ox in (-3, -2, 0, 2, 3):
        for oy in (-3, -2, 0, 2, 3, 4):
            if ox * ox + oy * oy <= 18:
                d.text((tx + ox * S * 0.75, ty + oy * S * 0.75), text, font=font, fill=cfg["text_outline"])
    d.text((tx, ty), text, font=font, fill=cfg["text_fill"])

    return img.resize((w, h), Image.Resampling.LANCZOS)


def build_rarity_badges():
    badges = {
        "rarity-r": ("R", {
            "ink": (54, 86, 44, 255),
            "rim_top": (255, 246, 198),
            "rim_mid": (236, 192, 92),
            "rim_bot": (176, 122, 42),
            "inner_groove": (62, 118, 56, 255),
            "face_top": (122, 208, 102),
            "face_bot": (64, 146, 68),
            "text_outline": (42, 86, 40, 255),
            "text_fill": (255, 253, 240, 255),
        }),
        "rarity-sr": ("SR", {
            "ink": (44, 72, 118, 255),
            "rim_top": (244, 250, 255),
            "rim_mid": (196, 224, 250),
            "rim_bot": (122, 162, 212),
            "inner_groove": (52, 102, 168, 255),
            "face_top": (108, 186, 250),
            "face_bot": (54, 118, 206),
            "text_outline": (34, 68, 124, 255),
            "text_fill": (255, 254, 248, 255),
        }),
        "rarity-ssr": ("SSR", {
            "ink": (118, 62, 16, 255),
            "rim_top": (255, 252, 212),
            "rim_mid": (252, 206, 86),
            "rim_bot": (192, 118, 26),
            "inner_groove": (168, 92, 18, 255),
            "face_top": (255, 196, 68),
            "face_bot": (218, 112, 28),
            "text_outline": (112, 52, 12, 255),
            "text_fill": (255, 252, 226, 255),
        }),
    }
    for name, (txt, cfg) in badges.items():
        img = render_rarity_badge(txt, cfg)
        p = OUT_DIR / f"{name}.png"
        img.save(p)
        ensure_sprite_meta(p, img.width, img.height)
        print("wrote", p.name, img.size)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    build_tabs()
    build_rarity_cards()
    build_rarity_badges()


if __name__ == "__main__":
    main()
