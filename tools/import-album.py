"""Chroma-key and import the generated cartoon Album UI panel into
assets/resources/art/album/panel.png with Cocos Creator 3.8.8 9-slice sprite-frame meta.
"""
from __future__ import annotations

import collections
import json
import shutil
import sys
import uuid
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
GEN_SOURCE = ROOT / "art" / "generated" / "album-panel-v1.png"
OUT_DIR = ROOT / "assets" / "resources" / "art" / "album"


def chroma_key_magenta_flood(img: Image.Image) -> Image.Image:
    """Remove exterior magenta (#FF00FF) connected background with smooth anti-aliased edge despill."""
    rgba = img.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()

    def is_bg_seed(r, g, b):
        # Pure/near magenta: high R, high B, low G
        return r > 170 and b > 170 and g < 110 and (r - g) > 80 and (b - g) > 80

    visited = bytearray(w * h)
    bg_mask = bytearray(w * h)
    q = collections.deque()

    for x in range(w):
        for y in (0, h - 1):
            r, g, b, a = px[x, y]
            if is_bg_seed(r, g, b):
                idx = y * w + x
                if not visited[idx]:
                    visited[idx] = 1
                    q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            r, g, b, a = px[x, y]
            if is_bg_seed(r, g, b):
                idx = y * w + x
                if not visited[idx]:
                    visited[idx] = 1
                    q.append((x, y))

    while q:
        x, y = q.popleft()
        bg_mask[y * w + x] = 1
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h:
                idx = ny * w + nx
                if not visited[idx]:
                    r, g, b, a = px[nx, ny]
                    if r > 135 and b > 135 and g < 135 and (min(r, b) - g) > 35:
                        visited[idx] = 1
                        q.append((nx, ny))

    # Clear background and soften 2px boundary fringe
    for y in range(h):
        for x in range(w):
            idx = y * w + x
            if bg_mask[idx]:
                px[x, y] = (0, 0, 0, 0)
            else:
                # Check if touching bg -> despill magenta fringe
                near_bg = False
                for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1), (-1, 1), (1, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and bg_mask[ny * w + nx]:
                        near_bg = True
                        break
                if near_bg:
                    r, g, b, a = px[x, y]
                    # Compute magenta contamination
                    mag = min(r, b) - g
                    if mag > 25:
                        alpha = max(0, min(255, int(255 * (1.0 - (mag - 25) / 140.0))))
                        # Despill toward warm wood brown
                        nr = int(r * 0.85)
                        nb = int(min(b, g + 12))
                        px[x, y] = (nr, g, nb, alpha)

    # Crop tightly to non-transparent bounding box with 4px clean padding
    bbox = rgba.getbbox()
    if bbox:
        x0, y0, x1, y1 = bbox
        x0 = max(0, x0 - 4)
        y0 = max(0, y0 - 4)
        x1 = min(w, x1 + 4)
        y1 = min(h, y1 + 4)
        rgba = rgba.crop((x0, y0, x1, y1))
    return rgba


def ensure_panel_meta(png_path: Path, width: int, height: int):
    meta_path = png_path.with_suffix(png_path.suffix + ".meta")
    if meta_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        u = meta["uuid"]
    else:
        u = str(uuid.uuid4())
    hw, hh = width / 2.0, height / 2.0
    # Preserve top animal ornament + title banner & bottom wooden rim cleanly
    border_top = int(height * 0.30)
    border_bottom = int(height * 0.10)
    border_lr = int(width * 0.11)
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
                "displayName": "panel",
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
                    "borderTop": border_top,
                    "borderBottom": border_bottom,
                    "borderLeft": border_lr,
                    "borderRight": border_lr,
                    "packable": False,
                    "pixelsToUnit": 100,
                    "pivotX": 0.5,
                    "pivotY": 0.5,
                    "meshType": 0,
                    "isUuid": True,
                    "imageUuidOrDatabaseUri": f"{u}@6c48a",
                    "atlasUuid": "",
                    "vertices": {
                        "rawPosition": [-hw, -hh, 0, hw, -hh, 0, -hw, hh, 0, hw, hh, 0],
                        "indexes": [0, 1, 2, 2, 1, 3],
                        "uv": [0, height, width, height, 0, 0, width, 0],
                        "nuv": [0, 0, 1, 0, 0, 1, 1, 1],
                        "minPos": [-hw, -hh, 0],
                        "maxPos": [hw, hh, 0],
                    },
                },
                "displayName": "panel",
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
        raise FileNotFoundError(f"Missing album panel source: {GEN_SOURCE}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    raw = Image.open(GEN_SOURCE)
    cleaned = chroma_key_magenta_flood(raw)
    # Fit within 1024px wide while preserving exact aspect ratio
    if cleaned.width > 1024:
        nh = int(round(cleaned.height * 1024 / cleaned.width))
        cleaned = cleaned.resize((1024, nh), Image.Resampling.LANCZOS)
    out_png = OUT_DIR / "panel.png"
    cleaned.save(out_png, optimize=True)
    ensure_panel_meta(out_png, cleaned.width, cleaned.height)
    print(f"[album] panel.png: {cleaned.size}, {out_png.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
