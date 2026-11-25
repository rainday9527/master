"""可复现导入六件洋红底招募素材；仅替换指定组件，保留背景与既有 UUID。"""
from pathlib import Path
import argparse
import importlib.util
import hashlib
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'art/generated/Generate_a_REPLACEMENT_UI_SPRI_2026-11-25T10-35-55.png'
spec = importlib.util.spec_from_file_location('daily', ROOT / 'tools/import-daily.py')
daily = importlib.util.module_from_spec(spec)
spec.loader.exec_module(daily)

# 固定分区只用于识别归属，不裁掉边缘；extract 从局部洋红背景反解抗锯齿覆盖度。
PARTS = {
    'title': (50, 40, 550, 255),
    'description': (600, 35, 940, 310),
    'normal': (70, 310, 530, 525),
    'advanced': (560, 325, 980, 535),
    'progress-track': (90, 560, 515, 660),
    'discount': (650, 580, 895, 660),
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    image = Image.open(SOURCE).convert('RGB')
    assert image.size == (1536, 1024), '源图尺寸变化，拒绝猜测归属'
    parts = {name: tuple(round(v * image.width / 1080) for v in box) for name, box in PARTS.items()}
    target = ROOT / 'assets/resources/art/recruit'
    assert target.is_dir()
    background = target / 'background.png'
    background_hash = hashlib.sha256(background.read_bytes()).hexdigest()
    labels = [0] * (image.width * image.height)
    for label, box in enumerate(parts.values(), 1):
        for y in range(box[1], box[3]):
            for x in range(box[0], box[2]):
                r, g, b = image.getpixel((x, y))
                # 仅将无洋红污染的像素作为前景种子；浅色内饰和脚印完整保留。
                if not (r - g > 65 and b - g > 45 and r > 160 and b > 125):
                    labels[y * image.width + x] = label
    for label, (name, box) in enumerate(parts.items(), 1):
        canvas, origin = daily.extract(image, labels, {'bounds': box, 'label': label}, padding=8)
        assert canvas.getbbox(), name
        interior = 0
        for y in range(box[1], box[3]):
            for x in range(box[0], box[2]):
                if labels[y * image.width + x] == label:
                    assert canvas.getpixel((x-origin[0], y-origin[1])) == (*image.getpixel((x,y)),255), '不得侵蚀内部浅色及脚印'
                    interior += 1
        if args.write:
            canvas.save(target / (name + '.png'))
            daily.write_meta(target, name, canvas.size)
        print(name, '尺寸', canvas.size, '源坐标原点', origin, '内部原样像素', interior,
              '抗锯齿像素', sum(0 < a < 255 for *_, a in canvas.getdata()))
    assert hashlib.sha256(background.read_bytes()).hexdigest() == background_hash, '背景必须保持不变'


if __name__ == '__main__':
    main()
