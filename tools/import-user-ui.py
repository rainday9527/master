"""Slice and import the user-provided hand-painted UI sprite sheets into
assets/resources/art/album/ with clean Cocos Creator 3.8.8 sprite-frame metas:
- card-r.png, card-sr.png, card-ssr.png (from Sheet 1 watercolor paw cards, normalized aspect so star & bone stay 1:1)
- hero-r.png, hero-sr.png, hero-ssr.png (horizontal 9-slice frames built from Sheet 1 card textures for Pet Profile hero card)
- tab-active.png, tab-normal.png (clean blank 9-slice golden/cream pills from Sheet 1 bottom tab buttons)
- rarity-r.png, rarity-sr.png, rarity-ssr.png (hand-painted 普通/稀有/传说 medallion badges from Sheet 2 top row)
- icon-all.png, icon-cat.png, icon-dog.png (hand-painted paw/cat/dog mini icons from Sheet 2 row 3)
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SHEET1 = Path(r"D:\素材\gen-1795624919963-0.png")
SHEET2 = Path(r"D:\素材\gen-1795625023621-0.png")
OUT_DIR = ROOT / "assets" / "resources" / "art" / "album"


def ensure_sprite_meta(png_path: Path, width: int, height: int, border=(0, 0, 0, 0)):
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


def crop_tight(im: Image.Image, box: tuple[int, int, int, int], pad: int = 2) -> Image.Image:
    sub = im.crop(box)
    bb = sub.getbbox()
    if bb:
        x0 = max(0, bb[0] - pad)
        y0 = max(0, bb[1] - pad)
        x1 = min(sub.width, bb[2] + pad)
        y1 = min(sub.height, bb[3] + pad)
        sub = sub.crop((x0, y0, x1, y1))
    return sub


def compact_album_card(card: Image.Image, target_h: int = 384) -> Image.Image:
    """Shorten ONLY the clean empty middle band of the vertical 356x490 card to 356x384
    so the top-right glossy star and bottom bone nameplate remain 100% undistorted at ~0.93 aspect!"""
    w, h = card.size
    top_keep = 128      # preserves top rim + entire glossy star cleanly
    bot_keep = 136      # preserves entire bone nameplate + bottom rim cleanly
    mid_src = card.crop((0, top_keep, w, h - bot_keep))
    mid_h = max(16, target_h - top_keep - bot_keep)
    mid_resized = mid_src.resize((w, mid_h), Image.Resampling.LANCZOS)
    out = Image.new("RGBA", (w, target_h), (0, 0, 0, 0))
    out.paste(card.crop((0, 0, w, top_keep)), (0, 0))
    out.paste(mid_resized, (0, top_keep))
    out.paste(card.crop((0, h - bot_keep, w, h)), (0, top_keep + mid_h))
    return out


def build_hero_frame_from_card(card: Image.Image) -> Image.Image:
    """Create a clean 9-sliceable rounded card frame (320x320) from Sheet 1's card
    WITHOUT the top-right star or bottom bone nameplate, so wide horizontal Hero Cards
    match the exact same hand-painted watercolor & border style with ZERO stretching!"""
    w, h = card.size
    # Left side has clean top-left corner (0..120, 0..120) and clean bottom-left corner (0..120, h-120..h)
    # Wait: bottom-left has a tiny bit of the bone starting around x=45, so mirror top-left corner vertically
    # or take clean left-side border (x=0..42) and mirror top-left corner horizontally for top-right!
    # Cleanest symmetric approach:
    # - Top-left quadrant (0..160, 0..160) has ZERO star and ZERO bone!
    # - Mirror top-left horizontally for top-right -> clean star-free top half (320x160)!
    # - For bottom half, take a clean middle slice of the card + bottom-edge rim (y=h-38..h) mirrored from left-edge corners!
    cw = 320
    ch = 320
    # Crop left half of card skipping top star overhang (star sticks out ~12px above top border; top border starts at y~14)
    # Measure actual left border top y at x=80
    a = card.getchannel("A")
    y_top = 0
    while y_top < h and a.getpixel((80, y_top)) < 200:
        y_top += 1
    y_bot = h - 1
    while y_bot > 0 and a.getpixel((80, y_bot)) < 200:
        y_bot -= 1
    x_left = 0
    while x_left < w and a.getpixel((x_left, h // 2)) < 200:
        x_left += 1
    x_right = w - 1
    while x_right > 0 and a.getpixel((x_right, h // 2)) < 200:
        x_right -= 1

    # Take clean top-left 160x160 region starting at (x_left, y_top)
    tl = card.crop((x_left, y_top, x_left + 160, y_top + 160))
    tr = tl.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    # Bottom-left 160x160: compose clean inner watercolor from y=160..300 + clean bottom outer rim flipped vertically from tl
    bl = tl.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    br = tr.transpose(Image.Transpose.FLIP_TOP_BOTTOM)

    out = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    out.paste(tl, (0, 0))
    out.paste(tr, (160, 0))
    out.paste(bl, (0, 160))
    out.paste(br, (160, 160))
    return out


def make_clean_blank_pill(pill: Image.Image, out_w: int = 380, out_h: int = 104) -> Image.Image:
    """Build a 100% seamless blank 9-slice pill button from a labeled pill by keeping its exact
    full semicircular end-caps (radius = h//2) and filling the flat middle from the clean tangent column!"""
    w, h = pill.size
    # Take the exact full semicircle cap (radius = h//2) from the clean right end (which has zero icon)
    # and mirror it for the left cap -> 100% symmetric, ZERO seam, ZERO residual text/icon!
    cap = min(h // 2 + 2, w // 3)
    right_cap = pill.crop((w - cap, 0, w, h))
    # Verify if any text pixel creeps near w-cap: take clean vertical strip from right_cap's inner tangent column
    # Actually on raw_normal ("猫咪", 264x132), the text ends around x=206 while w-cap=196 -> use clean right side
    # of "全部" / "猫咪" starting 6px inside right cap edge, OR sample clean column at x=w-36? Wait: right cap curves!
    # Look at raw_active (274x132) & raw_normal (264x132): text sits in x=65..225; top/bottom edges are flat from x=66..w-66!
    # So column x=w-66 is ALREADY on the flat top/bottom tangent AND outside the text (text ends before x=w-42? Let's sample a clean column!).
    # Best guaranteed clean flat column: scan x from w-cap down to cap for the column with highest average brightness/lowest dark ink!
    px = pill.load()
    best_x = w - cap
    best_score = -1e9
    for x in range(cap, w - cap + 1):
        # Measure uniformity in vertical middle (y=h*0.25..h*0.75) -> text/icon pixels are much darker!
        vals = [px[x, y][0] + px[x, y][1] + px[x, y][2] for y in range(int(h * 0.25), int(h * 0.75))]
        score = min(vals) + sum(vals) / len(vals)
        if score > best_score:
            best_score = score
            best_x = x
    # Also take left_cap from the clean left semicircle (on raw pill, icon starts around x=52; mirror right_cap if needed!)
    # Check if left cap (0..cap) is clean or has icon; right_cap (w-cap..w) on "猫咪"/"全部" has NO icon!
    # Even better: check if right_cap inner edge (x=w-cap) is clean; if so, mirror right_cap -> left_cap!
    clean_col = pill.crop((best_x, 0, best_x + 1, h))
    # Build clean symmetric pill from clean right cap (cropped strictly outside text, or clean flat cap)
    # Use clean left edge (x=0..46) + right edge (x=w-46..w) blended smoothly at x=best_x:
    # Actually for a semicircle of radius R=h/2, curve ends at x=h/2; let's check both caps' cleanliness!
    def cap_is_clean(cimg):
        cp = cimg.load()
        cw, ch = cimg.size
        mins = [cp[cx, cy][0] + cp[cx, cy][1] + cp[cx, cy][2] for cx in range(cw) for cy in range(int(ch * 0.28), int(ch * 0.72)) if cp[cx, cy][3] > 200]
        return min(mins) > 420 if mins else True

    r_cap_img = pill.crop((w - cap, 0, w, h))
    l_cap_img = pill.crop((0, 0, cap, h))
    if not cap_is_clean(l_cap_img) and cap_is_clean(r_cap_img):
        l_cap_img = r_cap_img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    elif not cap_is_clean(r_cap_img) and cap_is_clean(l_cap_img):
        r_cap_img = l_cap_img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)

    mid_w = max(4, w - 2 * cap)
    mid = clean_col.resize((mid_w, h), Image.Resampling.NEAREST)
    blank = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    blank.paste(l_cap_img, (0, 0))
    blank.paste(mid, (cap, 0))
    blank.paste(r_cap_img, (w - cap, 0))

    # Erase any tiny residual glyph stroke inside the inner pill body (well inside the outer rim)
    # by filling the interior pill mask from clean_col (best_x), preserving 100% of the real outer border & glossy rim!
    bp = blank.load()
    cp = clean_col.load()
    # Cleanly replace interior pixels where x is inside [30, w-30] and y is inside [22, h-22]
    # and radially inside the semicircular caps so border & highlight strokes stay 100% untouched!
    cx_l = h / 2.0
    cx_r = w - h / 2.0
    cy_m = h / 2.0
    r_inner = h / 2.0 - 20.0
    for y in range(20, h - 20):
        for x in range(20, w - 20):
            inside = False
            if cx_l <= x <= cx_r:
                inside = True
            elif x < cx_l and (x - cx_l) ** 2 + (y - cy_m) ** 2 <= r_inner ** 2:
                inside = True
            elif x > cx_r and (x - cx_r) ** 2 + (y - cy_m) ** 2 <= r_inner ** 2:
                inside = True
            if inside:
                bp[x, y] = cp[0, y]

    scale = out_h / h
    sw = max(out_h, int(round(w * scale)))
    scaled = blank.resize((sw, out_h), Image.Resampling.LANCZOS)
    s_cap = int(round(cap * scale))
    out = Image.new("RGBA", (out_w, out_h), (0, 0, 0, 0))
    out.paste(scaled.crop((0, 0, s_cap, out_h)), (0, 0))
    out.paste(scaled.crop((s_cap, 0, sw - s_cap, out_h)).resize((out_w - 2 * s_cap, out_h), Image.Resampling.BICUBIC), (s_cap, 0))
    out.paste(scaled.crop((sw - s_cap, 0, sw, out_h)), (out_w - s_cap, 0))
    return out


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    s1 = Image.open(SHEET1).convert("RGBA")
    s2 = Image.open(SHEET2).convert("RGBA")

    # 1) Album rarity cards (R=green [9], SR=blue [7], SSR=gold [6]) + matching horizontal Hero frames
    card_boxes = {
        "r": (36, 780, 392, 1284),
        "sr": (404, 260, 760, 750),
        "ssr": (36, 260, 392, 750),
    }
    for key, box in card_boxes.items():
        raw = crop_tight(s1, box, pad=2)
        compact = compact_album_card(raw, target_h=384)
        p = OUT_DIR / f"card-{key}.png"
        compact.save(p, optimize=True)
        # Non-sliced exact aspect card (356x384 -> rendered at 232x248, almost 1:1!)
        ensure_sprite_meta(p, compact.width, compact.height, border=(0, 0, 0, 0))
        print("wrote", p.name, compact.size)

        hero = build_hero_frame_from_card(raw)
        hp = OUT_DIR / f"hero-{key}.png"
        hero.save(hp, optimize=True)
        ensure_sprite_meta(hp, hero.width, hero.height, border=(56, 56, 56, 56))
        print("wrote", hp.name, hero.size)

    # 2) Blank 9-slice hand-painted pill tabs from Sheet 1 [12] (golden active) & [13] (cream normal)
    raw_active = crop_tight(s1, (28, 1332, 302, 1464), pad=1)
    raw_normal = crop_tight(s1, (310, 1332, 574, 1464), pad=1)
    tab_active = make_clean_blank_pill(raw_active, out_w=380, out_h=104)
    tab_normal = make_clean_blank_pill(raw_normal, out_w=380, out_h=104)
    for name, img in (("tab-active", tab_active), ("tab-normal", tab_normal)):
        p = OUT_DIR / f"{name}.png"
        img.save(p, optimize=True)
        ensure_sprite_meta(p, img.width, img.height, border=(24, 24, 50, 50))
        print("wrote", p.name, img.size)

    # 3) Hand-painted rarity medallions from Sheet 2 top row (R=普通[3], SR=稀有[2], SSR=传说[0])
    medallion_boxes = {
        "rarity-r": (710, 216, 880, 398),
        "rarity-sr": (492, 216, 664, 398),
        "rarity-ssr": (60, 192, 232, 398),
    }
    for name, box in medallion_boxes.items():
        img = crop_tight(s2, box, pad=2)
        p = OUT_DIR / f"{name}.png"
        img.save(p, optimize=True)
        ensure_sprite_meta(p, img.width, img.height)
        print("wrote", p.name, img.size)

    # 4) Cute hand-painted tab mini-icons from Sheet 2 row 3 (paw, cat, dog)
    icon_boxes = {
        "icon-all": (50, 550, 146, 636),
        "icon-cat": (204, 552, 298, 640),
        "icon-dog": (342, 548, 456, 640),
    }
    for name, box in icon_boxes.items():
        img = crop_tight(s2, box, pad=2)
        p = OUT_DIR / f"{name}.png"
        img.save(p, optimize=True)
        ensure_sprite_meta(p, img.width, img.height)
        print("wrote", p.name, img.size)


if __name__ == "__main__":
    main()
