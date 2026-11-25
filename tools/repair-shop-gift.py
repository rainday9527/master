"""从商店原图恢复紫色礼物内部被色键误删的像素，不重新导入其他素材。"""
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'art/generated/参考附图_为同一款可爱卡通猫狗庭院游戏制作可裁切的商店UI素_2026-11-23T15-38-18.png'
TARGET = ROOT / 'assets/resources/art/shop/stall.png'
OFFSET = (67, 32)
REGION = (489, 145, 589, 231)


def main():
    image = Image.open(TARGET).convert('RGBA')
    source = Image.open(SOURCE).convert('RGBA')
    assert image.size == (656, 947), '底板尺寸变化，请重新核对原图坐标'
    original = source.crop((*OFFSET, OFFSET[0] + image.width, OFFSET[1] + image.height))
    # 紫色盒身不能与洋红背景共用色键。轮廓取自原图内部，避开外缘抗锯齿。
    patch = original.crop(REGION)
    mask = Image.new('L', patch.size)
    # 盒身轮廓外的相邻蝴蝶结和侧边仅采用严格非背景掩膜。
    from PIL import ImageFilter
    mask.putdata([0 if r - g > 100 and b - g > 100 else 255
                  for r, g, b, _ in patch.getdata()])
    mask = mask.filter(ImageFilter.MinFilter(5))
    outline = [(489, 151), (506, 151), (522, 151), (545, 158),
               (566, 158), (578, 163), (583, 170), (580, 181),
               (573, 187), (568, 203), (560, 211), (552, 219),
               (531, 228), (509, 228), (501, 210), (494, 188)]
    ImageDraw.Draw(mask).polygon([(x - REGION[0], y - REGION[1])
                                  for x, y in outline], fill=255)
    before = image.copy()
    restored = 0
    for y in range(patch.height):
        for x in range(patch.width):
            point = (x + REGION[0], y + REGION[1])
            if mask.getpixel((x, y)) == 255 and image.getpixel(point) != original.getpixel(point):
                image.putpixel(point, original.getpixel(point))
                restored += 1
    difference = ImageChops.difference(before, image)
    if restored:
        image.save(TARGET)
    print(f'恢复像素数: {restored}; 差异范围: {difference.getbbox()}')


if __name__ == '__main__':
    main()
