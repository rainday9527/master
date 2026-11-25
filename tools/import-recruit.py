"""指定招募图集：只从画布外部连通的中性棋盘背景抠图，封闭内饰原样保留。"""
from pathlib import Path
from collections import deque
import argparse
import importlib.util
import json
import uuid
from PIL import Image

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
        canvas.save(target / (name+'.png'))
        meta_path = target / (name+'.png.meta')
        if not meta_path.exists():
            daily.write_meta(target,name,canvas.size)
        assert canvas.getbbox() == (8,8,canvas.width-8,canvas.height-8)
        assert all(not external[i] for i in indices)
        print('正式导入',name,canvas.size,'仅保留非外部背景连通域')
    clean = ROOT / 'art/generated/recruit-background-clean.png'
    source = clean if clean.is_file() else target / 'background.png'
    assert source.is_file(), '缺少清理来源或正式背景，拒绝回退到未清理原图'
    background = Image.open(source)
    assert background.size == (1024, 1536), '背景尺寸变化，拒绝覆盖正式资源'
    background.save(target / 'background.png')
    if not (target / 'background.png.meta').exists():
        daily.write_meta(target,'background',background.size)
    print('背景原尺寸接入，优先使用清理后的稳定来源', source.name)

if __name__ == '__main__':
    main()
