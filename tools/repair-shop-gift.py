"""按原图背景连通性恢复礼物，分别处理内部颜色和外缘混色。"""
from collections import deque
from io import BytesIO
from pathlib import Path
import subprocess
from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'art/generated/参考附图_为同一款可爱卡通猫狗庭院游戏制作可裁切的商店UI素_2026-11-23T15-38-18.png'
TARGET = ROOT / 'assets/resources/art/shop/stall.png'
OFFSET = (67, 32)
REGION = (475, 95, 625, 240)


def main():
    image = Image.open(TARGET).convert('RGBA')
    source = Image.open(SOURCE).convert('RGBA')
    assert image.size == (656, 947), '底板尺寸变化，请重新核对原图坐标'
    original = source.crop((*OFFSET, OFFSET[0] + image.width, OFFSET[1] + image.height))
    before = image.copy()
    width, height = image.width, 290
    pixels = original.load()
    # 只允许与画布外部连通的洋红成为背景，不按颜色删除礼物内部。
    background = set()
    queue = deque()
    for y in range(height):
        for x in range(width):
            if x in (0, width - 1) or y == 0:
                r, g, b, _ = pixels[x, y]
                if min(r - g, b - g) > 130 and b > 220:
                    background.add((x, y))
                    queue.append((x, y))
    while queue:
        x, y = queue.popleft()
        for xx, yy in ((x-1, y), (x+1, y), (x, y-1), (x, y+1)):
            if not (0 <= xx < width and 0 <= yy < height) or (xx, yy) in background:
                continue
            r, g, b, _ = pixels[xx, yy]
            if min(r - g, b - g) > 130 and b > 220:
                background.add((xx, yy))
                queue.append((xx, yy))

    def near_background(x, y, radius):
        return any((xx, yy) in background
                   for yy in range(max(0, y-radius), min(height, y+radius+1))
                   for xx in range(max(0, x-radius), min(width, x+radius+1)))

    # 主体连通域排除原资源刻意移除的独立装饰星星。
    body = {(300, 200)}
    queue = deque(body)
    while queue:
        x, y = queue.popleft()
        for point in ((x-1,y), (x+1,y), (x,y-1), (x,y+1)):
            xx, yy = point
            if 0 <= xx < width and 0 <= yy < height and point not in background and point not in body:
                body.add(point)
                queue.append(point)
    repaired = 0
    other_restored = 0
    for x, y in body:
        if REGION[0] <= x < REGION[2] and REGION[1] <= y < REGION[3]:
            continue
        if not near_background(x, y, 3) and image.getpixel((x,y)) != pixels[x,y]:
            image.putpixel((x,y), pixels[x,y])
            other_restored += 1
            repaired += 1
    baseline = Image.open(BytesIO(subprocess.check_output(['git', '-C', str(ROOT), 'show', '4a4a972:assets/resources/art/shop/stall.png']))).convert('RGBA')
    for y in range(REGION[1], REGION[3]):
        for x in range(REGION[0], REGION[2]):
            color = pixels[x, y]
            if (x, y) in background:
                color = (0, 0, 0, 0)
            if near_background(x, y, 2):
                # 保留原有抗锯齿描边；只补回不属于背景的实色缺口，避免重算透明度损坏外轮廓。
                color = baseline.getpixel((x, y))
                r, g, b, _ = pixels[x, y]
                if (x, y) not in background and not (r - g > 100 and b - g > 100):
                    color = pixels[x, y]
                cr, cg, cb, ca = color
                if 0 < ca < 255 and cr - cg > 65 and cb - cg > 65:
                    candidates = []
                    for yy in range(max(0,y-5), min(height,y+6)):
                        for xx in range(max(0,x-5), min(width,x+6)):
                            if (xx,yy) in body and not near_background(xx,yy,2):
                                candidates.append(((xx-x)**2+(yy-y)**2, pixels[xx,yy][:3]))
                    if candidates:
                        color = (*min(candidates)[1], ca)
            if color != image.getpixel((x, y)):
                repaired += 1
                image.putpixel((x, y), color)
    difference = ImageChops.difference(before, image)
    bounds = ImageChops.lighter(difference.convert('RGB').convert('L'), difference.getchannel('A')).getbbox()
    if repaired:
        image.save(TARGET)
    interior_errors = [(x, y) for y in range(REGION[1], REGION[3])
                       for x in range(REGION[0], REGION[2])
                       if (x,y) not in background and not near_background(x,y,2)
                       and image.getpixel((x,y)) != pixels[x,y]]
    outside_damage = sum(1 for x, y in body
                         if not (REGION[0] <= x < REGION[2] and REGION[1] <= y < REGION[3])
                         and not near_background(x,y,3)
                         and image.getpixel((x,y)) != pixels[x,y])
    print(f'修改像素数: {repaired}; 差异范围: {bounds}; 礼物内部原图不一致: {len(interior_errors)}; 顶部其他主体内部不一致: {outside_damage}; 其他顶部恢复: {other_restored}')
    assert not interior_errors
    crop = (460, 90, 630, 245)
    baseline = Image.open(BytesIO(subprocess.check_output(['git', '-C', str(ROOT), 'show', 'HEAD:assets/resources/art/shop/stall.png']))).convert('RGBA')
    for name, base in [('dark', (24, 29, 37)), ('light', (248, 245, 234)), ('grass', (100, 146, 63))]:
        panel = Image.new('RGB', (170*3*3, 155*3+32), base)
        draw = ImageDraw.Draw(panel)
        for index, (label, sample) in enumerate([('BEFORE', baseline), ('AFTER', image), ('SOURCE', original)]):
            view = Image.new('RGBA', (170,155), (*base,255))
            view.alpha_composite(sample.crop(crop))
            panel.paste(view.convert('RGB').resize((510,465), Image.Resampling.NEAREST), (index*510,32))
            draw.text((index*510+8,9), label, fill='white' if name=='dark' else 'black')
        panel.save(ROOT / f'art/gift-repair-{name}.png')
    top = Image.new('RGBA', (width, height), (24,29,37,255))
    top.alpha_composite(image.crop((0,0,width,height)))
    top.resize((width*2,height*2)).save(ROOT / 'art/gift-repair-top.png')


if __name__ == '__main__':
    main()
