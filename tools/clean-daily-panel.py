"""从只读 panel 采样真实纹理，清除正文内置任务框；不修改源图。"""
from pathlib import Path
import argparse
import hashlib
import json
import uuid
from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'assets/resources/art/daily'
# 多列扫描确认：外侧深框位于 x=45..56 和 883..895；仅修改其间。
RECT = (58, 378, 883, 1420)
SAMPLE = (80, 390, 865, 470)


def generate(source):
    result = source.copy()
    left, top, right, bottom = RECT
    texture = source.crop(SAMPLE)
    for y in range(top, bottom):
        # 镜像往返采样避免块边跳变，保留原图纸面噪声而非纯色填充。
        phase = (y - top) % (texture.height * 2)
        sy = phase if phase < texture.height else texture.height * 2 - phase - 1
        weight = min(1, (y - top) / 16, (bottom - 1 - y) / 16)
        for x in range(left, right):
            phase_x = (x - SAMPLE[0]) % (texture.width * 2)
            sx = phase_x if phase_x < texture.width else texture.width * 2 - phase_x - 1
            old, new = source.getpixel((x, y)), texture.getpixel((sx, sy))
            result.putpixel((x, y), tuple(round(a * (1 - weight) + b * weight) for a, b in zip(old, new)))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    source = Image.open(TARGET / 'panel.png').convert('RGBA')
    clean = generate(source)
    dest = TARGET / 'panel-clean.png'
    meta_path = TARGET / 'panel-clean.png.meta'
    if args.write:
        clean.save(dest)
        if not meta_path.exists():
            meta = json.loads((TARGET / 'panel.png.meta').read_text(encoding='utf-8-sig'))
            identity = str(uuid.uuid5(uuid.NAMESPACE_URL, 'catParadise/daily/panel-clean'))
            meta = json.loads(json.dumps(meta).replace(meta['uuid'], identity))
            for sub in meta['subMetas'].values():
                sub['displayName'] = 'panel-clean'
            meta_path.write_text(json.dumps(meta, indent=2) + '\n', encoding='utf-8')
    saved = Image.open(dest).convert('RGBA')
    assert saved.tobytes() == clean.tobytes(), '正式素材与可复现变换不一致'
    meta = json.loads(meta_path.read_text(encoding='utf-8-sig'))
    frame = meta['subMetas']['f9941']['userData']
    assert meta['userData']['redirect'] == meta['uuid'] + '@6c48a'
    assert meta['subMetas']['6c48a']['userData']['imageUuidOrDatabaseUri'] == meta['uuid']
    assert frame['imageUuidOrDatabaseUri'] == meta['uuid'] + '@6c48a'
    assert [frame[k] for k in ['borderLeft', 'borderRight', 'borderTop', 'borderBottom']] == [140, 140, 378, 207]
    diff = ImageChops.difference(source, saved).convert('RGB')
    assert diff.getbbox() == (58, 379, 883, 1419)
    for y in range(394, 1404):
        assert not any(saved.getpixel((x, y))[0] < 200 for x in range(80, 865)), '正文仍有深色框线'
    assert min(ImageStat.Stat(saved.crop((100, 400, 800, 1200))).stddev[:3]) > 1, '纸面纹理丢失'
    evidence = {'source_sha256': hashlib.sha256((TARGET / 'panel.png').read_bytes()).hexdigest(),
                'source_size': source.size, 'cleanup_ltrb': RECT, 'actual_diff_ltrb': diff.getbbox(),
                'texture_sample_ltrb': SAMPLE, 'preserved': 'x<58、x>=883、y<=378、y>=1419逐像素不变；猫、标题牌、侧框、底饰保留',
                'boundary_scan_rgb': {y: {x: source.getpixel((x, y))[:3] for x in [45, 50, 56, 58, 65, 80, 470, 865, 880, 883, 890, 900]} for y in [390, 450, 532, 600, 713, 900, 1089, 1284, 1300, 1410]},
                'original_dark_bands': [532, 713, 900, 1089, 1284],
                'clean_band_dark_pixels': {y: sum(saved.getpixel((x, y))[0] < 180 for x in range(80, 865)) for y in [532, 713, 900, 1089, 1284]},
                'visual': '像素与几何断言，不冒充目视验收'}
    print(json.dumps(evidence, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
