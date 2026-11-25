"""指定招募图集：只从画布外部连通的中性棋盘背景抠图，封闭内饰原样保留。"""
from pathlib import Path
from collections import deque
import argparse
import importlib.util
import json
import uuid
from PIL import Image, ImageOps, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'art/generated/Create_a_separated_UI_ELEMENT__2026-11-25T06-57-33.png'
spec = importlib.util.spec_from_file_location('daily', ROOT / 'tools/import-daily.py')
daily = importlib.util.module_from_spec(spec)
spec.loader.exec_module(daily)


def split():
    image = Image.open(SOURCE).convert('RGB')
    w, h = image.size
    pixels = list(image.getdata())
    external = bytearray(w*h)
    queue = deque()
    def visit(i):
        r, g, b = pixels[i]
        if not external[i] and min(r,g,b) > 210 and max(r,g,b)-min(r,g,b) < 18:
            external[i] = 1
            queue.append(i)
    for x in range(w):
        visit(x)
        visit((h-1)*w+x)
    for y in range(h):
        visit(y*w)
        visit(y*w+w-1)
    while queue:
        i = queue.popleft()
        x, y = i % w, i // w
        for xx, yy in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
            if 0 <= xx < w and 0 <= yy < h:
                visit(yy*w+xx)
    seen = bytearray(external)
    parts = []
    for start in range(w*h):
        if seen[start]:
            continue
        seen[start] = 1
        queue.append(start)
        indices = []
        while queue:
            i = queue.popleft()
            indices.append(i)
            x,y = i%w,i//w
            for xx,yy in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
                if 0 <= xx < w and 0 <= yy < h:
                    j = yy*w+xx
                    if not seen[j]:
                        seen[j] = 1
                        queue.append(j)
        if len(indices) >= 100:
            box = (min(i%w for i in indices),min(i//w for i in indices),max(i%w for i in indices)+1,max(i//w for i in indices)+1)
            mean = tuple(round(sum(pixels[i][c] for i in indices)/len(indices)) for c in range(3))
            parts.append((box,indices,mean))
    parts.sort(key=lambda p: (p[0][1]//80,p[0][0]))
    print('外部背景像素', sum(external))
    for i,(box,indices,mean) in enumerate(parts):
        print(i,box,len(indices),'平均RGB',mean)
    return image, external, parts


def clean_edge(canvas):
    # 只处理与透明外部相邻的三像素环，封闭浅色内饰及脚印连通域不参与。
    alpha = canvas.getchannel('A')
    inner = alpha.filter(ImageFilter.MinFilter(7))
    original = canvas.copy()
    changed = 0
    for y in range(canvas.height):
        for x in range(canvas.width):
            r, g, b, a = original.getpixel((x, y))
            if not a or inner.getpixel((x, y)) or max(r,g,b)-min(r,g,b) > 35:
                continue
            candidates = []
            for yy in range(max(0,y-3), min(canvas.height,y+4)):
                for xx in range(max(0,x-3), min(canvas.width,x+4)):
                    if inner.getpixel((xx,yy)):
                        color = original.getpixel((xx,yy))[:3]
                        if min(color) < 195:
                            candidates.append(((xx-x)**2+(yy-y)**2, color))
            if not candidates:
                continue
            _, foreground = min(candidates)
            # 棋盘亮度为237/251；用局部低亮格估计，只减弱可解释为混色的边缘。
            background = 237
            direction = [c-background for c in foreground]
            denominator = sum(c*c for c in direction)
            if not denominator:
                continue
            coverage = max(0.0, min(1.0, sum((c-background)*d for c,d in zip((r,g,b),direction))/denominator))
            predicted = [background+coverage*d for d in direction]
            if coverage >= 0.98 or max(abs(c-p) for c,p in zip((r,g,b),predicted)) > 12:
                continue
            # 保留覆盖度，不做整块腐蚀；反解RGB以避免白色污染在深色底上显边。
            coverage = max(0.05, coverage)
            rgb = tuple(round(max(0,min(255,(c-background*(1-coverage))/coverage))) for c in (r,g,b))
            canvas.putpixel((x,y), (*rgb, round(255*coverage)))
            changed += 1
    assert canvas.getbbox() == original.getbbox(), '不允许改变脚印或组件边界'
    for y in range(canvas.height):
        for x in range(canvas.width):
            assert bool(canvas.getpixel((x,y))[3]) == bool(original.getpixel((x,y))[3]), '不允许移除脚印或新增背景像素'
            if inner.getpixel((x,y)):
                assert canvas.getpixel((x,y)) == original.getpixel((x,y)), '浅色内部必须逐像素保留'
    return changed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--write',action='store_true')
    args = parser.parse_args()
    image,external,parts = split()
    if not args.write:
        return
    target = ROOT / 'assets/resources/art/recruit'
    assert target.parent.is_dir()
    target.mkdir(exist_ok=True)
    folder_meta = target.with_suffix('.meta')
    if not folder_meta.exists():
        meta = json.loads((target.parent / 'daily.meta').read_text())
        meta['uuid'] = str(uuid.uuid4())
        folder_meta.write_text(json.dumps(meta,indent=2)+'\n')
    names = ['title','description','chest','preview','reward','search','normal','advanced','badge']
    expected = [(82,93,776,341),(819,158,1254,429),(1309,268,1437,389),
                (94,379,752,675),(810,512,1276,637),(1328,523,1443,641),
                (95,715,740,948),(767,716,1265,947),(1308,774,1447,922)]
    assert [p[0] for p in parts] == expected, '组件边界变化，拒绝猜测归属'
    for name,(box,indices,mean) in zip(names,parts):
        l,t,r,b = box
        canvas = Image.new('RGBA',(r-l+16,b-t+16))
        out = canvas.load()
        for i in indices:
            out[i%image.width-l+8,i//image.width-t+8] = (*image.getpixel((i%image.width,i//image.width)),255)
        before = canvas.copy()
        changed = clean_edge(canvas)
        canvas.save(target / (name+'.png'))
        daily.write_meta(target,name,canvas.size)
        print('边缘统计', name, '去污染像素', changed, '半透明像素', sum(0<a<255 for *_,a in canvas.getdata()),
              '原不透明像素', sum(a==255 for *_,a in before.getdata()), 'alpha边界', canvas.getbbox())
        assert canvas.getbbox() == (8,8,canvas.width-8,canvas.height-8)
        assert all(not external[i] for i in indices)
        print('正式导入',name,canvas.size,'仅保留非外部背景连通域')
    clean = ROOT / 'art/generated/recruit-background-clean.png'
    assert clean.is_file(), '缺少清洁源，拒绝重复裁切正式资源'
    source = Image.open(clean).convert('RGB')
    assert source.size == (1024, 1536), '清洁源尺寸变化，拒绝覆盖正式资源'
    background = ImageOps.fit(source, (1080, 1920), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    background.save(target / 'background.png')
    daily.write_meta(target,'background',background.size)
    print('背景等比cover居中裁切', clean.name, source.size, '→', background.size)

if __name__ == '__main__':
    main()
