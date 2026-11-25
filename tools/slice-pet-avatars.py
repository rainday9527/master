"""Slice the generated 3x2 cartoon pet portrait sheet into 6 crisp circular
256x256 PNG avatars under assets/resources/pets/avatars/ with Cocos 3.8.8 sprite-frame metas.
"""
from __future__ import annotations

import json
import shutil
import sys
import uuid
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
GEN_SOURCE = ROOT / "art" / "generated" / "pet-avatars-6breeds-v1.jpg"
AVATARS_DIR = ROOT / "assets" / "resources" / "pets" / "avatars"

GRID_ORDER = [
    ("cat_naitang", 0, 0),
    ("dog_buding", 1, 0),
    ("cat_yunduo", 2, 0),
    ("dog_zhima", 0, 1),
    ("cat_juzi", 1, 1),
    ("dog_taotao", 2, 1),
]


def detect_card_boxes(img: Image.Image) -> list[tuple[int, int, int, int]]:
    """Detect exact bounding boxes of the 6 inner cream portrait cards via background diff."""
    w, h = img.size
    rgb = img.convert("RGB")
    px = rgb.load()
    # Outer background sampled at corners
    bg = px[4, 4]

    def is_bg(c):
        return abs(c[0] - bg[0]) + abs(c[1] - bg[1]) + abs(c[2] - bg[2]) <= 10

    # Find the 2 row bands and 3 col bands where non-bg pixels appear
    row_has = [any(not is_bg(px[x, y]) for x in range(0, w, 4)) for y in range(h)]
    col_has = [any(not is_bg(px[x, y]) for y in range(0, h, 4)) for x in range(w)]

    def spans(arr):
        out = []
        start = None
        for i, v in enumerate(arr):
            if v and start is None:
                start = i
            elif not v and start is not None:
                if i - start > 60:
                    out.append((start, i - 1))
                start = None
        if start is not None and len(arr) - start > 60:
            out.append((start, len(arr) - 1))
        return out

    ys = spans(row_has)
    xs = spans(col_has)
    if len(xs) == 3 and len(ys) == 2:
        boxes = []
        for row_idx in range(2):
            for col_idx in range(3):
                x0, x1 = xs[col_idx]
                y0, y1 = ys[row_idx]
                boxes.append((x0, y0, x1, y1))
        return boxes
    # Safe fallback to clean 3x2 inset boxes
    cw, ch = w / 3.0, h / 2.0
    boxes = []
    for r in range(2):
        for c in range(3):
            x0 = int(c * cw + cw * 0.08)
            y0 = int(r * ch + ch * 0.08)
            x1 = int((c + 1) * cw - cw * 0.08)
            y1 = int((r + 1) * ch - ch * 0.08)
            boxes.append((x0, y0, x1, y1))
    return boxes


def make_circular_avatar(crop: Image.Image, out_size: int = 256) -> Image.Image:
    """Create a crisp circular portrait with subtle warm rim border for header/album/recruit."""
    # Center-crop to square
    w, h = crop.size
    side = min(w, h)
    # Trim 4% outer card rounded-corner margin so circle is completely filled with warm card tone
    inset = int(side * 0.03)
    cx, cy = w // 2, h // 2
    half = side // 2 - inset
    sq = crop.crop((cx - half, cy - half, cx + half, cy + half)).convert("RGBA")

    # Supersample 4x for razor-sharp anti-aliased circle mask
    ss = out_size * 4
    sq = sq.resize((ss, ss), Image.Resampling.LANCZOS)

    mask = Image.new("L", (ss, ss), 0)
    md = ImageDraw.Draw(mask)
    pad = int(ss * 0.02)
    md.ellipse([pad, pad, ss - pad, ss - pad], fill=255)

    out = Image.new("RGBA", (ss, ss), (0, 0, 0, 0))
    out.paste(sq, (0, 0), mask)

    # Subtle cozy warm honey-cream circular outline so avatars pop cleanly on any panel
    ring = Image.new("RGBA", (ss, ss), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    rd.ellipse([pad + 2, pad + 2, ss - pad - 2, ss - pad - 2], outline=(245, 224, 185, 235), width=max(10, ss // 64))
    out.alpha_composite(ring)

    return out.resize((out_size, out_size), Image.Resampling.LANCZOS)


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
    if len(sys.argv) > 1:
        src = Path(sys.argv[1])
        GEN_SOURCE.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, GEN_SOURCE)
    if not GEN_SOURCE.exists():
        raise FileNotFoundError(f"Missing avatar sheet: {GEN_SOURCE}")

    AVATARS_DIR.mkdir(parents=True, exist_ok=True)
    img = Image.open(GEN_SOURCE)
    boxes = detect_card_boxes(img)
    print(f"Sheet {img.size}, detected {len(boxes)} boxes: {boxes}")
    for idx, (skin_key, col, row) in enumerate(GRID_ORDER):
        box = boxes[row * 3 + col]
        crop = img.crop(box)
        avatar = make_circular_avatar(crop, 256)
        out_png = AVATARS_DIR / f"{skin_key}.png"
        avatar.save(out_png, optimize=True)
        ensure_sprite_frame_meta(out_png, skin_key, 256)
        print(f"[avatar] {skin_key}.png ({out_png.stat().st_size // 1024} KB) from {box}")


if __name__ == "__main__":
    main()
