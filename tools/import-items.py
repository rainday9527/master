"""按像素连通区域导入物品图集；默认仅统计，--write 写入资源。"""
from collections import deque
from pathlib import Path
from PIL import Image
import argparse
import copy
import json
import uuid

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'art/generated/制作猫狗庭院养成手游12个独立物品图标素材图集_严格4列3行_2026-11-23T17-40-15.png'
IDS = ['cat_food', 'dog_food', 'fish', 'fish_can', 'bone_chew', 'dental_stick', 'cat_wand', 'frisbee', 'ball', 'rope', 'shampoo', 'brush']


def background(c):
    r, g, b = c
    return r > 175 and b > 140 and g < 125 and r - g > 85 and b - g > 65


def components(image):
    w, h = image.size
    data = list(image.getdata())
    labels = [0] * (w * h)
    result = []
    for i, color in enumerate(data):
        if labels[i] or background(color):
            continue
        label = len(result) + 1
        labels[i] = label
        queue = deque([i])
        count = 0
        left = right = i % w
        top = bottom = i // w
        while queue:
            j = queue.popleft()
            x, y = j % w, j // w
            count += 1
            left, right = min(left, x), max(right, x)
            top, bottom = min(top, y), max(bottom, y)
            for xx, yy in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
                if 0 <= xx < w and 0 <= yy < h:
                    k = yy*w+xx
                    if not labels[k] and not background(data[k]):
                        labels[k] = label
                        queue.append(k)
        result.append({'label': label, 'area': count, 'bounds': (left, top, right+1, bottom+1)})
    return result, labels


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    image = Image.open(SOURCE).convert('RGB')
    print('source', image.size)
    parts, labels = components(image)
    for part in sorted(parts, key=lambda p: -p['area']):
        if part['area'] >= 12:
            print(part)
    mains = [p for p in parts if p['area'] > 2000]
    assert len(mains) == 12
    mains.sort(key=lambda p: ((p['bounds'][1] + p['bounds'][3]) // 2 // 340, p['bounds'][0]))
    if not args.write:
        return
    target = ROOT / 'assets/resources/art/items'
    target.mkdir(exist_ok=True)
    template = json.loads((ROOT / 'assets/resources/art/care/feed.png.meta').read_text())
    directory = json.loads((ROOT / 'assets/resources/art/care.meta').read_text())
    directory['uuid'] = str(uuid.uuid4())
    (target.parent / 'items.meta').write_text(json.dumps(directory, indent=2) + '\n')
    for name, main in zip(IDS, mains):
        l, t, r, b = main['bounds']
        # 真实主体附近的独立小部件一并保留，不按单个最大连通块裁切。
        group = [p for p in parts if p['area'] >= 2 and p['bounds'][0] >= l-12 and p['bounds'][1] >= t-12 and p['bounds'][2] <= r+12 and p['bounds'][3] <= b+12]
        selected = {p['label'] for p in group}
        l = min(p['bounds'][0] for p in group)
        t = min(p['bounds'][1] for p in group)
        r = max(p['bounds'][2] for p in group)
        b = max(p['bounds'][3] for p in group)
        crop_box = (max(0,l-6), max(0,t-6), min(image.width,r+6), min(image.height,b+6))
        crop = image.crop(crop_box)
        w, h = crop.size
        rgb = list(crop.getdata())
        # 在明确属于主体的像素上建立距离场；仅处理边界附近，不模糊或侵蚀内部。
        distances = [-1] * (w*h)
        nearest = [-1] * (w*h)
        queue = deque()
        for y in range(h):
            for x in range(w):
                j = y*w+x
                source_label = labels[(y+crop_box[1])*image.width+x+crop_box[0]]
                red, green, blue = rgb[j]
                fringe = red-green > 65 and blue-green > 45 and red > 160 and blue > 125
                if source_label in selected and not fringe:
                    distances[j] = 0
                    nearest[j] = j
                    queue.append(j)
        while queue:
            j = queue.popleft()
            if distances[j] >= 5:
                continue
            x, y = j % w, j // w
            for xx, yy in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
                if 0 <= xx < w and 0 <= yy < h:
                    k = yy*w+xx
                    if distances[k] < 0:
                        distances[k] = distances[j]+1
                        nearest[k] = nearest[j]
                        queue.append(k)
        # 每张图外围的背景中位数，保留抗锯齿混合覆盖率并反解品红底色。
        border = [rgb[y*w+x] for y in range(h) for x in range(w) if x < 2 or y < 2 or x >= w-2 or y >= h-2]
        bg = tuple(sorted(c[cx] for c in border)[len(border)//2] for cx in range(3))
        output = []
        for j, color in enumerate(rgb):
            if distances[j] < 0:
                output.append((0,0,0,0))
                continue
            if distances[j] == 0:
                output.append((*color,255))
                continue
            ref = rgb[nearest[j]]
            delta = tuple(ref[c]-bg[c] for c in range(3))
            denominator = sum(v*v for v in delta)
            alpha = max(0.0,min(1.0,sum((color[c]-bg[c])*delta[c] for c in range(3))/max(1,denominator)))
            if alpha < 0.045:
                output.append((0,0,0,0))
                continue
            clean = tuple(round(max(0,min(255,(color[c]-(1-alpha)*bg[c])/alpha))) for c in range(3))
            # 极低覆盖率下压缩噪声对边缘颜色的影响，不改变透明度。
            if alpha < 0.35:
                clean = ref
            if background(clean):
                clean = (clean[0],clean[1],min(clean[2],clean[1]+44))
            output.append((*clean,round(alpha*255)))
        rgba = Image.new('RGBA', (w,h))
        rgba.putdata(output)
        bbox = rgba.getbbox()
        assert bbox
        rgba = rgba.crop(bbox)
        scale = min(1.0,272/max(rgba.size))
        if scale < 1:
            rgba = rgba.resize(tuple(round(v*scale) for v in rgba.size), Image.Resampling.LANCZOS)
        canvas = Image.new('RGBA',(320,320))
        canvas.paste(rgba,((320-rgba.width)//2,(320-rgba.height)//2))
        canvas.save(target / (name+'.png'))
        meta = copy.deepcopy(template)
        old_uuid = meta['uuid']
        new_uuid = str(uuid.uuid4())
        meta = json.loads(json.dumps(meta).replace(old_uuid,new_uuid))
        for sub in meta['subMetas'].values():
            sub['displayName'] = name
            if sub['importer'] == 'sprite-frame':
                ud = sub['userData']
                ud.pop('vertices',None)
                for field in ('width','height','rawWidth','rawHeight'):
                    ud[field] = 320
        (target / (name+'.png.meta')).write_text(json.dumps(meta,indent=2)+'\n')
        alpha_bounds = canvas.getbbox()
        assert alpha_bounds and min(alpha_bounds[0],alpha_bounds[1],320-alpha_bounds[2],320-alpha_bounds[3]) >= 20
        bad = sum(1 for red,green,blue,a in canvas.getdata() if a and red-green>85 and blue-green>65 and red>175 and blue>140)
        print(name, 'bounds=',(l,t,r,b),'source_size=',(r-l,b-t),'components=',[(p['area'],p['bounds']) for p in group],'alpha_bounds=',alpha_bounds,'magenta=',bad)
        assert bad == 0, name+' 存在品红残色'


if __name__ == '__main__':
    main()
