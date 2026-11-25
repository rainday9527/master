"""Render 6 super-crisp, 4x supersampled plump cartoon outfit icons (256x256 RGBA)
into assets/resources/art/outfits/ with Cocos Creator 3.8.8 sprite-frame metas.
"""
from __future__ import annotations

import json
import math
import uuid
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "assets" / "resources" / "art" / "outfits"
SS = 1024  # 4x supersampling for razor-sharp anti-aliasing -> 256x256
OUT = 256
OUTLINE = (98, 58, 32, 255)


def soft_shadow(img: Image.Image, bbox, blur=18, alpha=70):
    s = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(s).ellipse(bbox, fill=(85, 55, 30, alpha))
    s = s.filter(ImageFilter.GaussianBlur(radius=blur))
    img.alpha_composite(s)


def draw_highlight(img: Image.Image, bbox, alpha=145, blur=14):
    h = Image.new("RGBA", img.size, (255, 255, 255, 0))
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).ellipse(bbox, fill=alpha)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=blur))
    h.putalpha(mask)
    img.alpha_composite(h)


def draw_star(d: ImageDraw.ImageDraw, cx, cy, r_out, r_in, fill, outline=None, width=8):
    pts = []
    for i in range(8):
        ang = i * math.pi / 4 - math.pi / 2
        r = r_out if i % 2 == 0 else r_in
        pts.append((cx + math.cos(ang) * r, cy + math.sin(ang) * r))
    d.polygon(pts, fill=fill, outline=outline, width=width if outline else 0)


def icon_none() -> Image.Image:
    """原生态萌毛: plump honey-cream cartoon paw + twin golden sparkles."""
    img = Image.new("RGBA", (SS, SS), (0, 0, 0, 0))
    soft_shadow(img, [210, 740, 814, 880], blur=22, alpha=60)
    d = ImageDraw.Draw(img)
    cream = (255, 232, 192, 255)
    pad = (242, 166, 152, 255)
    # Main big paw cushion
    d.ellipse([240, 440, 784, 830], fill=cream, outline=OUTLINE, width=22)
    d.ellipse([325, 530, 699, 775], fill=pad)
    # 4 cute round toe beans
    toes = [(255, 395, 108, 132), (425, 275, 102, 128), (599, 275, 102, 128), (769, 395, 108, 132)]
    for cx, cy, rx, ry in toes:
        d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=cream, outline=OUTLINE, width=20)
        d.ellipse([cx - rx * 0.56, cy - ry * 0.52, cx + rx * 0.56, cy + ry * 0.58], fill=pad)
    draw_highlight(img, [380, 540, 620, 650], alpha=120, blur=16)
    # Cute golden sparkles
    d = ImageDraw.Draw(img)
    draw_star(d, 845, 210, 86, 30, (255, 218, 92, 255), outline=OUTLINE, width=10)
    draw_star(d, 178, 225, 60, 22, (255, 226, 120, 255), outline=OUTLINE, width=8)
    return img.resize((OUT, OUT), Image.Resampling.LANCZOS)


def icon_bell_collar() -> Image.Image:
    """红绳金铃铛: thick cozy red collar + shiny golden round jingle bell."""
    img = Image.new("RGBA", (SS, SS), (0, 0, 0, 0))
    soft_shadow(img, [220, 790, 804, 910], blur=22, alpha=65)
    d = ImageDraw.Draw(img)
    # Back loop of red collar
    d.ellipse([140, 195, 884, 595], fill=(168, 44, 40, 255), outline=OUTLINE, width=22)
    d.ellipse([235, 265, 789, 515], fill=(0, 0, 0, 0), outline=OUTLINE, width=18)
    # Punch inner hole cleanly
    mask = Image.new("L", (SS, SS), 255)
    ImageDraw.Draw(mask).ellipse([246, 275, 778, 505], fill=0)
    img.putalpha(Image.composite(img.getchannel("A"), Image.new("L", (SS, SS), 0), mask))
    d = ImageDraw.Draw(img)
    # Plump front crimson strap
    d.pieslice([140, 195, 884, 625], 12, 168, fill=(224, 68, 58, 255), outline=OUTLINE, width=22)
    d.ellipse([235, 255, 789, 515], fill=(0, 0, 0, 0))
    # Redraw crisp front band arc cleanly
    d.arc([185, 235, 839, 585], 15, 165, fill=(242, 92, 80, 255), width=92)
    d.arc([140, 195, 884, 625], 12, 168, fill=OUTLINE, width=22)
    d.arc([230, 272, 794, 540], 16, 164, fill=OUTLINE, width=20)
    # Golden connector ring
    d.ellipse([462, 532, 562, 620], fill=(245, 194, 58, 255), outline=OUTLINE, width=16)
    # Plump shiny golden jingle bell
    d.ellipse([348, 570, 676, 888], fill=(248, 196, 56, 255), outline=OUTLINE, width=22)
    # Bell equatorial rim
    d.rounded_rectangle([342, 706, 682, 762], radius=28, fill=(255, 218, 92, 255), outline=OUTLINE, width=16)
    # Bell sound slit & hole
    d.ellipse([478, 768, 546, 832], fill=OUTLINE)
    d.line([(416, 802), (608, 802)], fill=OUTLINE, width=16)
    draw_highlight(img, [404, 608, 535, 695], alpha=185, blur=10)
    return img.resize((OUT, OUT), Image.Resampling.LANCZOS)


def icon_blue_scarf() -> Image.Image:
    """海盐小围巾: sky-blue folded bandana scarf with cream paw print."""
    img = Image.new("RGBA", (SS, SS), (0, 0, 0, 0))
    soft_shadow(img, [230, 770, 794, 900], blur=22, alpha=60)
    d = ImageDraw.Draw(img)
    # Main triangular sky-blue kerchief
    tri = [(150, 310), (874, 310), (512, 865)]
    d.polygon(tri, fill=(96, 168, 232, 255))
    d.line(tri + [tri[0]], fill=OUTLINE, width=22, joint="curve")
    # Inner lighter stripe border
    tri2 = [(210, 355), (814, 355), (512, 805)]
    d.line(tri2 + [tri2[0]], fill=(154, 208, 250, 255), width=12, joint="curve")
    # Cozy rolled neck collar fold at top
    d.rounded_rectangle([128, 218, 896, 354], radius=68, fill=(78, 148, 216, 255), outline=OUTLINE, width=22)
    draw_highlight(img, [220, 240, 740, 292], alpha=125, blur=12)
    # Cute cream paw print emblem in center
    d = ImageDraw.Draw(img)
    cream = (255, 246, 224, 255)
    d.ellipse([444, 520, 580, 640], fill=cream)
    for tx, ty in [(426, 476), (484, 440), (542, 440), (598, 476)]:
        d.ellipse([tx - 26, ty - 30, tx + 26, ty + 30], fill=cream)
    return img.resize((OUT, OUT), Image.Resampling.LANCZOS)


def icon_pink_bow() -> Image.Image:
    """草莓蝴蝶结: plump pastel strawberry-coral ribbon bow + pearl center."""
    img = Image.new("RGBA", (SS, SS), (0, 0, 0, 0))
    soft_shadow(img, [200, 740, 824, 875], blur=22, alpha=60)
    d = ImageDraw.Draw(img)
    pink = (246, 134, 156, 255)
    pink_dark = (224, 102, 128, 255)
    # Cute fluttering bottom ribbon tails
    d.polygon([(470, 540), (310, 815), (415, 770), (485, 825), (515, 560)], fill=pink_dark, outline=OUTLINE, width=20)
    d.polygon([(554, 540), (714, 815), (609, 770), (539, 825), (509, 560)], fill=pink_dark, outline=OUTLINE, width=20)
    # Left & right plump rounded bow loops
    d.ellipse([118, 250, 510, 620], fill=pink, outline=OUTLINE, width=22)
    d.ellipse([514, 250, 906, 620], fill=pink, outline=OUTLINE, width=22)
    # Soft inner crease lines
    d.arc([230, 355, 480, 520], 130, 230, fill=pink_dark, width=20)
    d.arc([544, 355, 794, 520], -50, 50, fill=pink_dark, width=20)
    draw_highlight(img, [185, 290, 410, 400], alpha=145, blur=14)
    draw_highlight(img, [614, 290, 839, 400], alpha=145, blur=14)
    # Plump center pearl knot
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([422, 340, 602, 535], radius=76, fill=(255, 212, 222, 255), outline=OUTLINE, width=22)
    draw_highlight(img, [456, 365, 550, 435], alpha=165, blur=10)
    return img.resize((OUT, OUT), Image.Resampling.LANCZOS)


def icon_straw_hat() -> Image.Image:
    """田园小草帽: warm golden woven straw sunhat + red ribbon band."""
    img = Image.new("RGBA", (SS, SS), (0, 0, 0, 0))
    soft_shadow(img, [130, 690, 894, 855], blur=22, alpha=65)
    d = ImageDraw.Draw(img)
    straw = (242, 204, 118, 255)
    straw_shade = (224, 178, 88, 255)
    # Wide sunlit rounded brim
    d.ellipse([96, 485, 928, 790], fill=straw, outline=OUTLINE, width=22)
    d.arc([148, 528, 876, 750], 10, 170, fill=straw_shade, width=16)
    # Rounded hat crown dome
    d.pieslice([248, 225, 776, 705], 180, 360, fill=straw, outline=OUTLINE, width=22)
    d.rectangle([248, 460, 776, 565], fill=straw)
    d.line([(248, 460), (248, 565)], fill=OUTLINE, width=22)
    d.line([(776, 460), (776, 565)], fill=OUTLINE, width=22)
    # Subtle woven straw texture rings
    for y in (320, 385, 445):
        d.arc([285, y - 35, 739, y + 55], 15, 165, fill=straw_shade, width=10)
    # Cozy crimson-red ribbon band around crown
    d.rounded_rectangle([242, 478, 782, 572], radius=34, fill=(224, 76, 66, 255), outline=OUTLINE, width=20)
    # Tiny cute bow on right side of hat band
    d.ellipse([660, 468, 760, 560], fill=(240, 96, 86, 255), outline=OUTLINE, width=14)
    d.ellipse([730, 488, 818, 574], fill=(240, 96, 86, 255), outline=OUTLINE, width=14)
    draw_highlight(img, [320, 260, 620, 380], alpha=140, blur=16)
    return img.resize((OUT, OUT), Image.Resampling.LANCZOS)


def icon_gold_crown() -> Image.Image:
    """星光小皇冠: shiny royal mini golden crown with ruby heart gem."""
    img = Image.new("RGBA", (SS, SS), (0, 0, 0, 0))
    soft_shadow(img, [200, 760, 824, 885], blur=22, alpha=65)
    d = ImageDraw.Draw(img)
    gold = (250, 198, 56, 255)
    gold_hi = (255, 228, 114, 255)
    # Crown body polygon with 3 royal peaks
    pts = [(190, 700), (145, 340), (360, 495), (512, 235), (664, 495), (879, 340), (834, 700)]
    d.polygon(pts, fill=gold)
    d.line(pts + [pts[0]], fill=OUTLINE, width=22, joint="curve")
    # Plush base band
    d.rounded_rectangle([182, 636, 842, 775], radius=52, fill=gold_hi, outline=OUTLINE, width=22)
    # Pearl tips atop the 3 peaks
    for px, py, r in [(145, 316, 48), (512, 212, 58), (879, 316, 48)]:
        d.ellipse([px - r, py - r, px + r, py + r], fill=gold_hi, outline=OUTLINE, width=18)
    # Center ruby gem + side sapphire gems
    d.ellipse([446, 512, 578, 636], fill=(236, 72, 92, 255), outline=OUTLINE, width=16)
    d.ellipse([286, 668, 356, 738], fill=(92, 174, 240, 255), outline=OUTLINE, width=12)
    d.ellipse([668, 668, 738, 738], fill=(92, 174, 240, 255), outline=OUTLINE, width=12)
    draw_highlight(img, [468, 530, 526, 576], alpha=190, blur=6)
    draw_highlight(img, [240, 656, 680, 700], alpha=125, blur=10)
    return img.resize((OUT, OUT), Image.Resampling.LANCZOS)


def ensure_sprite_frame_meta(png_path: Path, display_name: str, size: int = 256):
    meta_path = png_path.with_suffix(png_path.suffix + ".meta")
    if meta_path.exists():
        return
    u = str(uuid.uuid4())
    half = size // 2
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
                    "packable": False,
                    "pixelsToUnit": 100,
                    "pivotX": 0.5,
                    "pivotY": 0.5,
                    "meshType": 0,
                    "isUuid": True,
                    "imageUuidOrDatabaseUri": f"{u}@6c48a",
                    "atlasUuid": "",
                    "vertices": {
                        "rawPosition": [-half, -half, 0, half, -half, 0, -half, half, 0, half, half, 0],
                        "indexes": [0, 1, 2, 2, 1, 3],
                        "uv": [0, size, size, size, 0, 0, size, 0],
                        "nuv": [0, 0, 1, 0, 0, 1, 1, 1],
                        "minPos": [-half, -half, 0],
                        "maxPos": [half, half, 0],
                    },
                },
                "displayName": display_name,
                "id": "f9941",
                "name": "spriteFrame",
            },
        },
        "userData": {
            "type": "sprite-frame",
            "redirect": f"{u}@6c48a",
            "hasAlpha": True,
            "fixAlphaTransparencyArtifacts": False,
        },
    }
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    builders = {
        "none": icon_none,
        "bell_collar": icon_bell_collar,
        "blue_scarf": icon_blue_scarf,
        "pink_bow": icon_pink_bow,
        "straw_hat": icon_straw_hat,
        "gold_crown": icon_gold_crown,
    }
    for key, fn in builders.items():
        im = fn()
        out_png = OUT_DIR / f"{key}.png"
        im.save(out_png, optimize=True)
        ensure_sprite_frame_meta(out_png, key, OUT)
        print(f"[outfit] {key}.png ({out_png.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
