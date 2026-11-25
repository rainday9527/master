"""Generate real 3D clothing-skin UV overlays (1024x1024 RGBA) and matching
256x256 cartoon costume icons for Cat Paradise.

Semantic UV layout (matches tools/build-pet-rig.py):
- Quadrant 1 (0..512, 0..512): Head -> 100% transparent (preserves natural breed face & fur!)
- Quadrant 2 (512..1024, 0..512): Body torso
    * x=768 is FRONT CHEST (+Z)
    * x=655 is RIGHT FLANK, x=881 is LEFT FLANK
    * x=543 & x=993 meet at RUMP (-Z)
    * y=31 is TOP BACK (+Y), y=256 is MIDLINE, y=481 is BELLY (-Y)
- Quadrant 3 (0..512, 512..1024): Ears & Tail -> 100% transparent
- Quadrant 4 left (512..812, 512..1024): Legs/Paws
    * y=512..695 is upper leg sleeves; y>700 stays transparent natural paws!
- Quadrant 4 right (812..1024, 512..1024): Eyes/Nose -> 100% transparent
"""
from __future__ import annotations

import json
import math
import random
import uuid
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SKINS_DIR = ROOT / "assets" / "resources" / "pets" / "skins"
ICONS_DIR = ROOT / "assets" / "resources" / "art" / "outfits"
S = 1024


def clamp(v: float, lo: float = 0.0, hi: float = 255.0) -> int:
    return int(round(lo if v < lo else hi if v > hi else v))


def ensure_texture_meta(png_path: Path, display_name: str):
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
            "hasAlpha": True,
            "fixAlphaTransparencyArtifacts": False,
        },
    }
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")


def ensure_sprite_meta(png_path: Path, size: int = 256):
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
                    "width": size,
                    "height": size,
                    "rawWidth": size,
                    "rawHeight": size,
                    "borderTop": 0,
                    "borderBottom": 0,
                    "borderLeft": 0,
                    "borderRight": 0,
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
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")


def add_knit_texture(img: Image.Image, seed: int, strength: float = 8.0):
    """Add cozy subtle knitted fabric weave texture ONLY to opaque cloth pixels."""
    rng = random.Random(seed)
    px = img.load()
    for y in range(S):
        row_wave = math.sin(y * 0.75) * 0.5
        for x in range(512, S):
            r, g, b, a = px[x, y]
            if a < 10:
                continue
            weave = (math.sin(x * 0.95) * math.cos(y * 0.65) + row_wave) * strength * 0.55
            grain = rng.uniform(-strength * 0.35, strength * 0.35)
            d = weave + grain
            px[x, y] = (clamp(r + d), clamp(g + d), clamp(b + d), a)


def make_torso_mask() -> Image.Image:
    """Create a tailored pet sweater/shirt coverage mask on Quadrant 2 (Body) & Quadrant 4 left (upper sleeves).
    Leaves rump near tail & lower belly open so natural fur & paws peek out naturally!
    """
    mask = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(mask)
    # Main sweater body wrapping chest (x=768), flanks (655 & 881), and back (y=31..395), leaving rump (x<588, x>948) open
    d.rounded_rectangle([588, 12, 948, 392], radius=42, fill=255)
    # Extend slightly lower on front chest for cute curved shirt front
    d.ellipse([685, 220, 851, 432], fill=255)
    # Upper leg sleeves in Quadrant 4 left (x=512..812, y=512..690)
    d.rectangle([512, 512, 812, 690], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=2.0))
    return mask


def draw_strawberry(d: ImageDraw.ImageDraw, cx: int, cy: int, r: int):
    # Cute miniature embroidered strawberry
    pts = [(cx, cy + int(r * 1.15)), (cx - r, cy - int(r * 0.25)), (cx - int(r * 0.6), cy - int(r * 0.85)),
           (cx + int(r * 0.6), cy - int(r * 0.85)), (cx + r, cy - int(r * 0.25))]
    d.polygon(pts, fill=(238, 86, 102, 255))
    d.line(pts + [pts[0]], fill=(168, 48, 62, 255), width=2)
    # Tiny cream seeds
    for sx, sy in ((-0.35, -0.1), (0.35, -0.1), (0, 0.38)):
        d.ellipse([cx + sx * r - 2, cy + sy * r - 2, cx + sx * r + 2, cy + sy * r + 2], fill=(255, 236, 210, 240))
    # Tiny green leaf calyx on top
    leaf = [(cx - int(r * 0.7), cy - int(r * 0.85)), (cx, cy - int(r * 0.48)),
            (cx + int(r * 0.7), cy - int(r * 0.85)), (cx, cy - int(r * 1.15))]
    d.polygon(leaf, fill=(104, 186, 94, 255))


def build_cloth_sailor() -> Image.Image:
    """Sailor Suit skin: crisp cream-white & navy striped jersey, classic navy sailor flap collar
    with twin white stripes on back, bright red bow tie on front chest, and navy sleeve cuffs."""
    raw = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(raw)

    # 1) Base crisp cream-white jersey on torso + upper legs
    d.rectangle([512, 0, 1024, 512], fill=(250, 251, 255, 255))
    d.rectangle([512, 512, 812, 720], fill=(250, 251, 255, 255))

    # 2) Classic horizontal nautical navy stripes across torso
    navy = (48, 88, 152, 255)
    navy_hi = (72, 118, 186, 255)
    for y in range(138, 410, 44):
        d.rectangle([512, y, 1024, y + 18], fill=navy)

    # 3) Classic navy sailor collar across top-back & shoulders (y=16..158)
    d.rectangle([560, 12, 976, 152], fill=navy)
    # Crisp double white sailor-collar trim stripes
    d.rectangle([575, 118, 961, 126], fill=(255, 255, 255, 255))
    d.rectangle([575, 134, 961, 142], fill=(255, 255, 255, 255))
    # Subtle golden anchor/star badge on back collar
    d.ellipse([754, 48, 782, 76], fill=(248, 206, 86, 255), outline=(146, 98, 28, 255), width=2)

    # 4) V-neck sailor lapel & bright crimson ribbon tie on FRONT CHEST (x=768)
    v_pts = [(710, 135), (826, 135), (768, 265)]
    d.polygon(v_pts, fill=navy)
    d.line([(718, 142), (768, 254), (818, 142)], fill=(255, 255, 255, 255), width=5)
    # Bright red sailor ribbon tie!
    red = (224, 62, 62, 255)
    red_dark = (158, 34, 38, 255)
    d.polygon([(768, 232), (734, 214), (734, 254)], fill=red, outline=red_dark)
    d.polygon([(768, 232), (802, 214), (802, 254)], fill=red, outline=red_dark)
    d.polygon([(762, 240), (744, 304), (760, 304), (768, 256)], fill=red, outline=red_dark)
    d.polygon([(774, 240), (792, 304), (776, 304), (768, 256)], fill=red, outline=red_dark)
    d.ellipse([756, 220, 780, 244], fill=(244, 92, 86, 255), outline=red_dark, width=2)

    # 5) Navy ribbed hem & cute navy sleeve cuffs with white trim
    d.rectangle([512, 376, 1024, 412], fill=navy_hi)
    d.rectangle([512, 646, 812, 700], fill=navy)
    d.rectangle([512, 658, 812, 668], fill=(255, 255, 255, 255))

    mask = make_torso_mask()
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(raw, (0, 0), mask)
    add_knit_texture(out, seed=101, strength=6.5)
    return out


def build_cloth_bee() -> Image.Image:
    """Honeybee Sweater skin: warm sunny-yellow & espresso-brown chunky striped knit hoodie,
    cozy brown ribbed cuffs/hem, and cute cream-white fairy bee wing emblem on back."""
    raw = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(raw)

    honey = (252, 206, 72, 255)
    cocoa = (92, 56, 34, 255)
    cocoa_hi = (118, 76, 46, 255)
    cream = (255, 248, 224, 255)

    # 1) Base warm sunny honey-yellow sweater
    d.rectangle([512, 0, 1024, 512], fill=honey)
    d.rectangle([512, 512, 812, 720], fill=honey)

    # 2) Bold chunky espresso-brown honeybee stripes across back, flanks & chest
    for y in (95, 195, 295):
        d.rectangle([512, y, 1024, y + 42], fill=cocoa)

    # 3) Cozy brown knitted collar & front chest honey-heart pocket
    d.rectangle([680, 128, 856, 168], fill=cocoa_hi)
    # Cute cream front pocket with tiny honey drop
    d.rounded_rectangle([722, 232, 814, 318], radius=22, fill=cream, outline=cocoa, width=5)
    d.ellipse([754, 258, 782, 292], fill=(246, 178, 42, 255), outline=cocoa, width=3)

    # 4) Adorable white translucent-look little bee wings painted on TOP BACK (y=28..120)!
    for sx in (-1, 1):
        cx = 768 + sx * 66
        d.ellipse([cx - 52, 30, cx + 52, 108], fill=(246, 252, 255, 245), outline=(146, 184, 214, 255), width=4)
        d.ellipse([cx - 32, 46, cx + 32, 92], fill=(224, 244, 255, 240))

    # 5) Cozy brown ribbed bottom hem & leg cuffs
    d.rectangle([512, 376, 1024, 412], fill=cocoa)
    d.rectangle([512, 650, 812, 700], fill=cocoa)

    mask = make_torso_mask()
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(raw, (0, 0), mask)
    add_knit_texture(out, seed=202, strength=9.0)
    return out


def build_cloth_strawberry() -> Image.Image:
    """Strawberry Knit Cardigan skin: soft pastel milk-pink knit sweater, scalloped cream Peter Pan
    collar, vertical cardigan placket with pearl buttons on front chest, and tiny embroidered strawberries."""
    raw = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(raw)

    pink = (252, 206, 220, 255)
    pink_rib = (238, 164, 188, 255)
    pink_line = (212, 128, 156, 255)
    cream = (255, 251, 242, 255)

    # 1) Base soft pastel strawberry-milk knit
    d.rectangle([512, 0, 1024, 512], fill=pink)
    d.rectangle([512, 512, 812, 720], fill=pink)

    # 2) Subtle cream polka dots + adorable embroidered strawberries across back & flanks
    for sy in (84, 182, 286):
        for sx in (625, 705, 832, 912):
            draw_strawberry(d, sx, sy, 15)
    for sy in (132, 236, 336):
        for sx in (664, 872):
            d.ellipse([sx - 7, sy - 7, sx + 7, sy + 7], fill=cream)

    # 3) Cute scalloped cream Peter Pan collar wrapping around top neckline
    for cx in range(600, 944, 34):
        d.ellipse([cx - 22, 118, cx + 22, 162], fill=cream, outline=pink_line, width=3)
    d.rectangle([580, 108, 956, 144], fill=cream)

    # 4) Cardigan front placket + 3 cute cream pearl buttons down front chest (x=768)
    d.rectangle([752, 156, 784, 412], fill=(255, 238, 244, 255), outline=pink_line, width=3)
    for by in (200, 260, 320):
        d.ellipse([758, by - 10, 778, by + 10], fill=cream, outline=pink_line, width=3)

    # 5) Ribbed hem & cream lace cuffs on upper legs
    d.rectangle([512, 376, 1024, 412], fill=pink_rib)
    d.rectangle([512, 646, 812, 700], fill=cream)
    d.rectangle([512, 646, 812, 658], fill=pink_rib)

    mask = make_torso_mask()
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(raw, (0, 0), mask)
    add_knit_texture(out, seed=303, strength=8.0)
    return out


# ---------------------------------------------------------------------------
# Crisp 4x Supersampled 256x256 Cartoon Costume Icons for UI Tiles
# ---------------------------------------------------------------------------

def draw_shirt_silhouette(d: ImageDraw.ImageDraw, W: int, H: int, fill, outline, lw: int):
    # Cute chibi pet t-shirt/sweater icon silhouette
    pts = [
        (int(W * 0.32), int(H * 0.18)),
        (int(W * 0.68), int(H * 0.18)),
        (int(W * 0.90), int(H * 0.36)),
        (int(W * 0.80), int(H * 0.54)),
        (int(W * 0.72), int(H * 0.48)),
        (int(W * 0.72), int(H * 0.84)),
        (int(W * 0.28), int(H * 0.84)),
        (int(W * 0.28), int(H * 0.48)),
        (int(W * 0.20), int(H * 0.54)),
        (int(W * 0.10), int(H * 0.36)),
    ]
    d.polygon(pts, fill=fill)
    d.line(pts + [pts[0]], fill=outline, width=lw, joint="curve")
    return pts


def render_skin_icon(kind: str) -> Image.Image:
    S4 = 4
    W = H = 256 * S4
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    ink = (96, 58, 36, 255)
    lw = 11 * S4

    if kind == "original":
        # Cute fluffy cream-gold fur puff / natural plush badge
        cx, cy = W // 2, H // 2
        for ang in range(0, 360, 45):
            rad = math.radians(ang)
            px = cx + int(math.cos(rad) * 56 * S4)
            py = cy + int(math.sin(rad) * 50 * S4)
            d.ellipse([px - 42 * S4, py - 42 * S4, px + 42 * S4, py + 42 * S4], fill=(255, 242, 214, 255), outline=ink, width=lw)
        d.ellipse([cx - 64 * S4, cy - 58 * S4, cx + 64 * S4, cy + 58 * S4], fill=(255, 246, 226, 255))
        # Cute little sparkle + warm paw heart inside
        d.ellipse([cx - 26 * S4, cy - 8 * S4, cx + 26 * S4, cy + 34 * S4], fill=(242, 168, 146, 255))
        for tx, ty in ((-28, -22), (0, -32), (28, -22)):
            d.ellipse([cx + (tx - 11) * S4, cy + (ty - 12) * S4, cx + (tx + 11) * S4, cy + (ty + 12) * S4], fill=(242, 168, 146, 255))
    elif kind == "sailor":
        pts = draw_shirt_silhouette(d, W, H, (250, 252, 255, 255), ink, lw)
        # Clip stripes inside shirt
        m = Image.new("L", (W, H), 0)
        ImageDraw.Draw(m).polygon(pts, fill=255)
        ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        od = ImageDraw.Draw(ov)
        navy = (52, 96, 166, 255)
        for y in (int(H * 0.42), int(H * 0.56), int(H * 0.70)):
            od.rectangle([0, y, W, y + 18 * S4], fill=navy)
        # Navy sailor V-collar
        od.polygon([(int(W * 0.28), int(H * 0.16)), (int(W * 0.72), int(H * 0.16)), (int(W * 0.50), int(H * 0.44))], fill=navy)
        od.line([(int(W * 0.34), int(H * 0.20)), (int(W * 0.50), int(H * 0.40)), (int(W * 0.66), int(H * 0.20))], fill=(255, 255, 255, 255), width=6 * S4)
        ov_clipped = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ov_clipped.paste(ov, (0, 0), m)
        img = Image.alpha_composite(img, ov_clipped)
        d = ImageDraw.Draw(img)
        d.line(pts + [pts[0], pts[1]], fill=ink, width=lw, joint="curve")
        # Red sailor bow tie
        cx, cy = W // 2, int(H * 0.41)
        red = (228, 66, 66, 255)
        d.polygon([(cx, cy), (cx - 26 * S4, cy - 14 * S4), (cx - 26 * S4, cy + 14 * S4)], fill=red, outline=ink, width=5 * S4)
        d.polygon([(cx, cy), (cx + 26 * S4, cy - 14 * S4), (cx + 26 * S4, cy + 14 * S4)], fill=red, outline=ink, width=5 * S4)
        d.ellipse([cx - 10 * S4, cy - 10 * S4, cx + 10 * S4, cy + 10 * S4], fill=(246, 98, 92, 255), outline=ink, width=4 * S4)
    elif kind == "bee":
        pts = draw_shirt_silhouette(d, W, H, (254, 210, 74, 255), ink, lw)
        m = Image.new("L", (W, H), 0)
        ImageDraw.Draw(m).polygon(pts, fill=255)
        ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        od = ImageDraw.Draw(ov)
        cocoa = (92, 56, 34, 255)
        for y in (int(H * 0.34), int(H * 0.52), int(H * 0.70)):
            od.rectangle([0, y, W, y + 24 * S4], fill=cocoa)
        ov_clipped = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ov_clipped.paste(ov, (0, 0), m)
        img = Image.alpha_composite(img, ov_clipped)
        d = ImageDraw.Draw(img)
        d.line(pts + [pts[0], pts[1]], fill=ink, width=lw, joint="curve")
        # Little cute translucent wings peeking behind shoulders
        for sx in (-1, 1):
            wx = W // 2 + sx * 42 * S4
            d.ellipse([wx - 22 * S4, int(H * 0.24), wx + 22 * S4, int(H * 0.38)], fill=(242, 252, 255, 240), outline=(120, 166, 206, 255), width=5 * S4)
    elif kind == "strawberry":
        pts = draw_shirt_silhouette(d, W, H, (254, 208, 222, 255), ink, lw)
        m = Image.new("L", (W, H), 0)
        ImageDraw.Draw(m).polygon(pts, fill=255)
        ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        od = ImageDraw.Draw(ov)
        cream = (255, 250, 240, 255)
        # Cream Peter Pan collar
        od.ellipse([int(W * 0.28), int(H * 0.14), int(W * 0.52), int(H * 0.32)], fill=cream, outline=(206, 126, 152, 255), width=5 * S4)
        od.ellipse([int(W * 0.48), int(H * 0.14), int(W * 0.72), int(H * 0.32)], fill=cream, outline=(206, 126, 152, 255), width=5 * S4)
        # Front cardigan placket + buttons
        od.rectangle([int(W * 0.47), int(H * 0.28), int(W * 0.53), int(H * 0.86)], fill=(255, 236, 242, 255), outline=(212, 128, 156, 255), width=4 * S4)
        for by in (int(H * 0.42), int(H * 0.56), int(H * 0.70)):
            od.ellipse([int(W * 0.48), by - 7 * S4, int(W * 0.52), by + 7 * S4], fill=cream, outline=(200, 118, 144, 255), width=3 * S4)
        # Two cute strawberries on left/right chest
        draw_strawberry(od, int(W * 0.38), int(H * 0.56), 14 * S4)
        draw_strawberry(od, int(W * 0.62), int(H * 0.56), 14 * S4)
        ov_clipped = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ov_clipped.paste(ov, (0, 0), m)
        img = Image.alpha_composite(img, ov_clipped)
        d = ImageDraw.Draw(img)
        d.line(pts + [pts[0], pts[1]], fill=ink, width=lw, joint="curve")

    return img.resize((256, 256), Image.Resampling.LANCZOS)


def main():
    SKINS_DIR.mkdir(parents=True, exist_ok=True)
    ICONS_DIR.mkdir(parents=True, exist_ok=True)

    for name, fn in (
        ("cloth_sailor", build_cloth_sailor),
        ("cloth_bee", build_cloth_bee),
        ("cloth_strawberry", build_cloth_strawberry),
    ):
        img = fn()
        p = SKINS_DIR / f"{name}.png"
        img.save(p, optimize=True)
        ensure_texture_meta(p, name)
        print("wrote skin overlay:", p.name, p.stat().st_size // 1024, "KB")

    for kind in ("original", "sailor", "bee", "strawberry"):
        icon = render_skin_icon(kind)
        p = ICONS_DIR / f"skin_{kind}.png"
        icon.save(p, optimize=True)
        ensure_sprite_meta(p, 256)
        print("wrote skin icon:", p.name)


if __name__ == "__main__":
    main()
