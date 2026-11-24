"""拆分只读背包参考：空白外框、空白卡片、独立按钮；保持已有 UUID。"""
from collections import deque
from pathlib import Path
import argparse
import importlib.util
import json
import uuid
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'art/generated/Create_ONE_polished_production_2026-11-24T16-57-35.png'
spec = importlib.util.spec_from_file_location('daily', ROOT / 'tools/import-daily.py')
daily = importlib.util.module_from_spec(spec)
spec.loader.exec_module(daily)


def texture_fill(image, rect, sample):
    patch = image.crop(sample)
    for y in range(rect[1], rect[3]):
        sy = (y - rect[1]) % (patch.height * 2)
        sy = min(sy, patch.height * 2 - 1 - sy)
        for x in range(rect[0], rect[2]):
            sx = (x - rect[0]) % (patch.width * 2)
            sx = min(sx, patch.width * 2 - 1 - sx)
            image.putpixel((x, y), patch.getpixel((sx, sy)))


def is_magenta(color):
    r, g, b, a = color
    return a and r-g > 65 and b-g > 45


def extract_without_blue_clamp(source, labels, main):
    # 保持原提取器的轮廓和投影去底，只移除其压蓝分支。
    l, t, r, b = main['bounds']
    box = (l-8, t-8, r+8, b+8)
    crop = source.crop(box)
    w, h = crop.size
    rgb = list(crop.getdata())
    distances, nearest = [-1]*(w*h), [-1]*(w*h)
    queue = deque()
    for y in range(h):
        for x in range(w):
            i = y*w+x
            sx, sy = x+box[0], y+box[1]
            label = labels[sy*source.width+sx] if 0 <= sx < source.width and 0 <= sy < source.height else 0
            red, green, blue = rgb[i]
            fringe = red-green > 65 and blue-green > 45 and red > 160 and blue > 125
            if label in main.get('labels', {main['label']}) and not fringe:
                distances[i], nearest[i] = 0, i
                queue.append(i)
    while queue:
        i = queue.popleft()
        if distances[i] >= 5:
            continue
        x, y = i % w, i // w
        for xx, yy in ((x-1, y), (x+1, y), (x, y-1), (x, y+1)):
            if 0 <= xx < w and 0 <= yy < h:
                j = yy*w+xx
                if distances[j] < 0:
                    distances[j], nearest[j] = distances[i]+1, nearest[i]
                    queue.append(j)
    border = [rgb[y*w+x] for y in range(h) for x in range(w)
              if x < 2 or y < 2 or x >= w-2 or y >= h-2]
    bg = tuple(sorted(c[cx] for c in border)[len(border)//2] for cx in range(3))
    output = []
    for i, color in enumerate(rgb):
        if distances[i] < 0:
            output.append((0, 0, 0, 0))
            continue
        if distances[i] == 0:
            output.append((*color, 255))
            continue
        ref = rgb[nearest[i]]
        delta = tuple(ref[c]-bg[c] for c in range(3))
        alpha = max(0.0, min(1.0, sum((color[c]-bg[c])*delta[c] for c in range(3))/max(1, sum(v*v for v in delta))))
        if alpha < 0.045:
            output.append((0, 0, 0, 0))
            continue
        clean = tuple(round(max(0, min(255, (color[c]-(1-alpha)*bg[c])/alpha))) for c in range(3))
        output.append((*(ref if alpha < 0.35 else clean), round(alpha*255)))
    rgba = Image.new('RGBA', (w, h))
    rgba.putdata(output)
    bounds = rgba.getbbox()
    assert bounds
    trimmed = rgba.crop(bounds)
    canvas = Image.new('RGBA', (trimmed.width+24, trimmed.height+24))
    canvas.paste(trimmed, (12, 12))
    return canvas, (box[0]+bounds[0]-12, box[1]+bounds[1]-12)


def rounded_cutout(image, radius):
    scale = 4
    mask = Image.new('L', (image.width*scale, image.height*scale))
    ImageDraw.Draw(mask).rounded_rectangle(
        (3*scale, 3*scale, (image.width-3)*scale-1, (image.height-3)*scale-1),
        radius*scale, fill=255)
    mask = mask.resize(image.size, Image.Resampling.LANCZOS)
    # 去掉滤波旁瓣；外部 RGB 一并清空，避免纹理采样露出棕色方底。
    mask = mask.point(lambda a: 0 if a < 4 else 255 if a > 251 else a)
    image.putalpha(mask)
    image.putdata([(r, g, b, a) if a else (0, 0, 0, 0) for r, g, b, a in image.getdata()])


def despill_edges(image):
    pixels = list(image.getdata())
    w, h = image.size
    bad = {i for i, color in enumerate(pixels) if is_magenta(color)}
    for i in sorted(bad):
        x, y = i % w, i // w
        assert any(0 <= x+dx < w and 0 <= y+dy < h and
                   pixels[(y+dy)*w+x+dx][3] == 0
                   for dy in range(-5, 6) for dx in range(-5, 6)
                   if abs(dx)+abs(dy) <= 5), ('内饰品红不得自动修改', x, y)
        queue = deque([(x, y)])
        seen = {(x, y)}
        while queue:
            xx, yy = queue.popleft()
            j = yy*w+xx
            if j not in bad and pixels[j][3] == 255:
                image.putpixel((x, y), (*pixels[j][:3], pixels[i][3]))
                break
            for nx, ny in ((xx-1, yy), (xx+1, yy), (xx, yy-1), (xx, yy+1)):
                if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen:
                    seen.add((nx, ny))
                    queue.append((nx, ny))
        else:
            raise AssertionError('缺少非品红邻色')
    return len(bad)


def generate():
    source = Image.open(SOURCE).convert('RGB')
    parts, labels = daily.items.components(source)
    main = max(parts, key=lambda p: p['area'])
    print('主组件', main, '排除全部独立水印组件', len(parts)-1)
    clean, origin = extract_without_blue_clamp(source, labels, main)
    full = Image.new('RGBA', source.size)
    full.paste(clean, origin)
    # 真实浅内区 x=120..903；顶牌 source=(280,285,715,347)。
    panel = full.copy()
    # 参考右上自带关闭图标，运行时使用 daily 独立关闭图标，不能叠两套。
    panel.paste((0, 0, 0, 0), (866, 210, 973, 318))
    texture_fill(panel, (120, 390, 903, 1390), (300, 398, 800, 416))
    panel.paste(full.crop((110, 1235, 914, 1269)), (110, 1380))
    panel.paste((0, 0, 0, 0), (0, 1414, 1024, 1536))
    # 下沿使用原上沿木框，不保留参考自带的底部按钮。
    panel = panel.crop((52, 36, 973, 1426))
    card = full.crop((122, 664, 516, 956))
    texture_fill(card, (24, 28, 369, 262), (30, 185, 350, 195))
    button = full.crop((347, 868, 495, 924))
    texture_fill(button, (19, 15, 132, 40), (24, 16, 37, 30))
    # 保守外圆角只裁掉相邻底色，保留原始木边，不重画皮肤。
    for image, radius in ((card, 20), (button, 18)):
        rounded_cutout(image, radius)
    # 先清理旧边缘，再向底边外侧延伸三像素 alpha，不动闭合木边及内区。
    print('panel 边缘邻色去污染', despill_edges(panel))
    for x in range(panel.width):
        r, g, b, a = panel.getpixel((x, 1377))
        for offset, alpha in enumerate((160, 72, 20), 1):
            assert panel.getpixel((x, 1377+offset))[3] == 0
            if a:
                panel.putpixel((x, 1377+offset), (r, g, b, round(a*alpha/255)))
    # tab 复用同材质按钮，不引入额外道具或货币。
    return {'panel': panel, 'card': card, 'button': button, 'tab': button.copy()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    target = ROOT / 'assets/resources/art/bag'
    if args.write:
        target.mkdir(exist_ok=True)
        directory = target.parent / 'bag.meta'
        if not directory.exists():
            meta = json.loads((target.parent / 'daily.meta').read_text())
            meta['uuid'] = str(uuid.uuid5(uuid.NAMESPACE_URL, 'catParadise/art/bag'))
            directory.write_text(json.dumps(meta, indent=2)+'\n')
    for name, image in generate().items():
        bad = sum(bool(is_magenta(color)) for color in image.getdata())
        assert bad == 0, (name, bad)
        w, h = image.size
        assert all(image.getpixel(point)[3] == 0 for point in ((0, 0), (w-1, 0), (0, h-1), (w-1, h-1))), name
        assert image.getpixel((w//2, h//2))[3] == 255, name
        if name == 'panel':
            assert [image.getpixel((w//2, y))[3] for y in range(1377, 1382)] == [255, 160, 72, 20, 0]
        else:
            assert any(0 < a < 255 for r, g, b, a in image.getdata()), name
        meta_path = target / (name+'.png.meta')
        metadata = meta_path.read_bytes()
        meta = json.loads(metadata)
        for key, sub in meta['subMetas'].items():
            assert sub['uuid'] == meta['uuid']+'@'+key
            if sub['importer'] == 'sprite-frame':
                assert (sub['userData']['width'], sub['userData']['height']) == image.size
        if args.write:
            image.save(target / (name+'.png'))
        saved = Image.open(target / (name+'.png')).convert('RGBA')
        assert saved.size == image.size and saved.tobytes() == image.tobytes(), name
        assert meta_path.read_bytes() == metadata, '元数据及 UUID 不得改变'
        print(name, image.size, 'alpha', image.getbbox(), '品红', bad, 'uuid', meta['uuid'])
    print('通过：可复现像素一致；不代表目视验收。')


if __name__ == '__main__':
    main()
