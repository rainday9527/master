"""以源图真实纸面纹理清除任务行内置进度槽；源 row.png 只读。"""
from pathlib import Path
import argparse
import hashlib
import json
import uuid
from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'assets/resources/art/daily'
# 像素扫描：槽体深色边缘 x=61..417、y=134..169；留出抗锯齿过渡。
RECT = (57, 130, 422, 174)
SAMPLE_Y = (80, 124)


def generate(source):
    result = source.copy()
    left, top, right, bottom = RECT
    for y in range(top, bottom):
        for x in range(left, right):
            weight = min(1, (x - left) / 3, (right - 1 - x) / 3,
                         (y - top) / 3, (bottom - 1 - y) / 3)
            old = source.getpixel((x, y))
            texture = source.getpixel((x, SAMPLE_Y[0] + y - top))
            result.putpixel((x, y), tuple(round(a * (1 - weight) + b * weight)
                                         for a, b in zip(old, texture)))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    source_path = TARGET / 'row.png'
    source_hash = hashlib.sha256(source_path.read_bytes()).hexdigest()
    source = Image.open(source_path).convert('RGBA')
    assert source.size == (475, 210)
    clean = generate(source)
    dest = TARGET / 'row-clean.png'
    meta_path = TARGET / 'row-clean.png.meta'
    if args.write:
        clean.save(dest)
        if not meta_path.exists():
            meta = json.loads((TARGET / 'row.png.meta').read_text(encoding='utf-8-sig'))
            identity = str(uuid.uuid5(uuid.NAMESPACE_URL, 'catParadise/daily/row-clean'))
            meta = json.loads(json.dumps(meta).replace(meta['uuid'], identity))
            for sub in meta['subMetas'].values():
                sub['displayName'] = 'row-clean'
            meta_path.write_text(json.dumps(meta, indent=2) + '\n', encoding='utf-8')
    saved = Image.open(dest).convert('RGBA')
    assert saved.tobytes() == clean.tobytes(), '正式素材不可复现'
    assert hashlib.sha256(source_path.read_bytes()).hexdigest() == source_hash, '源素材被修改'
    diff = ImageChops.difference(source, saved).convert('RGB')
    assert diff.getbbox() == (58, 131, 421, 173), '修改越出进度槽清理区域'
    assert source.getchannel('A').tobytes() == saved.getchannel('A').tobytes(), '外框透明轮廓改变'
    for y in range(134, 170):
        assert all(saved.getpixel((x, y))[1] >= 190 for x in range(61, 418)), '仍有棕色进度槽'
    assert min(ImageStat.Stat(saved.crop((65, 134, 415, 170))).stddev[:3]) > 1, '真实纹理丢失'
    meta = json.loads(meta_path.read_text(encoding='utf-8-sig'))
    frame = meta['subMetas']['f9941']['userData']
    assert meta['userData']['redirect'] == meta['uuid'] + '@6c48a'
    assert meta['subMetas']['6c48a']['userData']['imageUuidOrDatabaseUri'] == meta['uuid']
    assert frame['imageUuidOrDatabaseUri'] == meta['uuid'] + '@6c48a'
    assert [frame[k] for k in ['borderLeft', 'borderRight', 'borderTop', 'borderBottom']] == [56, 52, 38, 82]
    assert [frame[k] for k in ['width', 'height', 'rawWidth', 'rawHeight']] == [475, 210, 475, 210]
    print(json.dumps({'source_sha256': source_hash, 'source_size': source.size,
                      'cleanup_ltrb': RECT, 'actual_diff_ltrb': diff.getbbox(),
                      'texture_sample_y': SAMPLE_Y,
                      'original_slot_center_rgba': source.getpixel((237, 150)),
                      'clean_slot_center_rgba': saved.getpixel((237, 150)),
                      'preserved': '清理区外全部像素、透明通道、外框、底部装饰和九宫格边距不变',
                      'visual': '仅像素断言；未进行目视或浏览器验收'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
