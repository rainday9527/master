"""按实际连通区域导入每日任务素材；默认分析，--write 写入。"""
from collections import deque
from pathlib import Path
import argparse
import importlib.util
import json
import uuid
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'art/generated/Create_a_production_2D_mobile__2026-11-24T14-24-39.png'
spec = importlib.util.spec_from_file_location('import_items', ROOT / 'tools/import-items.py')
items = importlib.util.module_from_spec(spec)
spec.loader.exec_module(items)


def extract(image, labels, part, padding=12):
    l, t, r, b = part['bounds']
    box = (l-8, t-8, r+8, b+8)
    crop = image.crop(box)
    w, h = crop.size
    rgb = list(crop.getdata())
    distances, nearest = [-1]*(w*h), [-1]*(w*h)
    queue = deque()
    for y in range(h):
        for x in range(w):
            j = y*w+x
            sx, sy = x+box[0], y+box[1]
            label = labels[sy*image.width+sx] if 0 <= sx < image.width and 0 <= sy < image.height else 0
            red, green, blue = rgb[j]
            fringe = red-green > 65 and blue-green > 45 and red > 160 and blue > 125
            if label in part.get('labels', {part['label']}) and not fringe:
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
                    distances[k], nearest[k] = distances[j]+1, nearest[j]
                    queue.append(k)
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
        alpha = max(0.0,min(1.0,sum((color[c]-bg[c])*delta[c] for c in range(3))/max(1,sum(v*v for v in delta))))
        if alpha < 0.045:
            output.append((0,0,0,0))
            continue
        clean = tuple(round(max(0,min(255,(color[c]-(1-alpha)*bg[c])/alpha))) for c in range(3))
        if alpha < 0.35:
            clean = ref
        if clean[0]-clean[1] > 65 and clean[2]-clean[1] > 45:
            clean = (clean[0],clean[1],min(clean[2],clean[1]+44))
        output.append((*clean,round(alpha*255)))
    rgba = Image.new('RGBA', (w,h))
    rgba.putdata(output)
    bounds = rgba.getbbox()
    assert bounds
    trimmed = rgba.crop(bounds)
    canvas = Image.new('RGBA', (trimmed.width+padding*2, trimmed.height+padding*2))
    canvas.paste(trimmed, (padding,padding))
    origin = (box[0]+bounds[0]-padding, box[1]+bounds[1]-padding)
    return canvas, origin


def cream_rectangle(image, inset=12):
    # 逐像素色域约束下的最大实心矩形，再内缩避开边饰与渐变。
    w, h = image.size
    heights = [0]*w
    best, area = None, 0
    data = list(image.getdata())
    for y in range(h):
        for x in range(w):
            r,g,b,a = data[y*w+x]
            cream = a == 255 and r >= 225 and g >= 195 and b >= 155 and 15 <= r-g <= 55 and 15 <= g-b <= 50
            heights[x] = heights[x]+1 if cream else 0
        stack = []
        for x in range(w+1):
            height = heights[x] if x < w else 0
            start = x
            while stack and stack[-1][1] > height:
                left, old = stack.pop()
                if old*(x-left) > area:
                    area = old*(x-left)
                    best = (left,y-old+1,x,y+1)
                start = left
            if not stack or stack[-1][1] < height:
                stack.append((start,height))
    assert best and best[2]-best[0] > inset*2 and best[3]-best[1] > inset*2
    l,t,r,b = best
    return (l+inset,t+inset,r-inset,b-inset)


def write_meta(target, name, size):
    path = target / (name+'.png.meta')
    if path.exists():
        meta = json.loads(path.read_text())
    else:
        meta = json.loads((ROOT / 'assets/resources/art/care/feed.png.meta').read_text())
        meta = json.loads(json.dumps(meta).replace(meta['uuid'],str(uuid.uuid4())))
    for sub in meta['subMetas'].values():
        sub['displayName'] = name
        if sub['importer'] == 'sprite-frame':
            ud = sub['userData']
            ud.pop('vertices',None)
            for field in ('width','rawWidth'):
                ud[field] = size[0]
            for field in ('height','rawHeight'):
                ud[field] = size[1]
    path.write_text(json.dumps(meta,indent=2)+'\n')
    return meta


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--write',action='store_true')
    parser.add_argument('--task',action='store_true',help='导入独立每日任务清单图标')
    args = parser.parse_args()
    if args.task:
        source = ROOT / 'art/generated/ONE_isolated_daily_quest_check_2026-11-24T15-21-38.png'
        image = Image.open(source).convert('RGB')
        parts, labels = items.components(image)
        part = max(parts, key=lambda p: p['area'])
        canvas, _ = extract(image, labels, part)
        bad = sum(1 for r,g,b,a in canvas.getdata() if a and r-g>85 and b-g>65 and r>175 and b>140)
        assert bad == 0, '任务图标残留品红'
        print('task', canvas.size, 'magenta_pixels', bad)
        if args.write:
            target = ROOT / 'assets/resources/art/daily'
            canvas.save(target / 'task.png')
            write_meta(target, 'task', canvas.size)
        return
    image = Image.open(SOURCE).convert('RGB')
    parts, labels = items.components(image)
    ranked = sorted(parts,key=lambda p:-p['area'])
    selected = sorted(ranked[:2],key=lambda p:p['bounds'][0])
    assert selected[0]['bounds'][2] < selected[1]['bounds'][0]
    assert min(p['area'] for p in selected) > 100*ranked[2]['area']
    print('source_size',image.size,'excluded_components',len(parts)-2)
    target = ROOT / 'assets/resources/art/daily'
    if args.write:
        target.mkdir(exist_ok=True)
        directory_path = target.parent / 'daily.meta'
        if not directory_path.exists():
            directory = json.loads((ROOT / 'assets/resources/art/care.meta').read_text())
            directory['uuid'] = str(uuid.uuid4())
            directory_path.write_text(json.dumps(directory,indent=2)+'\n')
    for name, part in zip(('panel','row'),selected):
        canvas, origin = extract(image,labels,part)
        alpha_bounds = canvas.getbbox()
        w,h = canvas.size
        assert min(alpha_bounds[0],alpha_bounds[1],w-alpha_bounds[2],h-alpha_bounds[3]) >= 12
        bad = sum(1 for r,g,b,a in canvas.getdata() if a and r-g>85 and b-g>65 and r>175 and b>140)
        assert bad == 0
        safe = cream_rectangle(canvas)
        normalized = tuple(round(v/(w if i%2 == 0 else h),6) for i,v in enumerate(safe))
        print(name,json.dumps({'component':part,'texture_size':canvas.size,'source_origin':origin,'alpha_bounds':alpha_bounds,'magenta_pixels':bad,'cream_safe_ltrb':safe,'cream_safe_normalized_ltrb':normalized,'cream_safe_source_ltrb':tuple(v+origin[i%2] for i,v in enumerate(safe))}))
        if args.write:
            canvas.save(target / (name+'.png'))
            meta = write_meta(target,name,canvas.size)
            assert Image.open(target / (name+'.png')).size == canvas.size
            for key,sub in meta['subMetas'].items():
                assert sub['uuid'] == meta['uuid']+'@'+key
                if sub['importer'] == 'sprite-frame':
                    assert (sub['userData']['width'],sub['userData']['height']) == canvas.size
            print(name,'uuid',meta['uuid'])
    if args.write:
        uuids = []
        for path in (ROOT / 'assets').rglob('*.meta'):
            meta = json.loads(path.read_text(encoding='utf-8-sig'))
            if 'uuid' in meta:
                uuids.append(meta['uuid'])
        assert len(uuids) == len(set(uuids)), '资源 UUID 重复'
        print('validated_unique_asset_uuids',len(uuids))


if __name__ == '__main__':
    main()
