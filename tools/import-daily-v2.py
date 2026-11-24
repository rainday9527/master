"""从新版十二格图集提取每日任务独立素材，不写入 items。"""
from pathlib import Path
import argparse
import importlib.util
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('daily', ROOT / 'tools/import-daily.py')
daily = importlib.util.module_from_spec(spec)
spec.loader.exec_module(daily)
REGIONS = {
    'row': (663, 295, 1112, 480),
    'button': (1155, 349, 1424, 471),
    'close': (1225, 571, 1347, 694),
    'feed-cat': (137, 892, 318, 1019),
    'feed-dog': (460, 863, 704, 1027),
    'clean': (813, 861, 1030, 1060),
    'play': (1189, 864, 1391, 1056),
    'rest': (118, 1226, 343, 1419),
    'adventure': (485, 1234, 678, 1428),
    'coin': (845, 1260, 995, 1412),
    'gem': (1198, 1281, 1347, 1412),
}
IDS = ['panel', *REGIONS]
# 原图像素：面板顶饰及拱肩保护到 y=378；左右框含阴影，行底部厚边保留到 y=128。
SLICE_BORDERS = {
    'panel': (140, 140, 378, 207),
    'row': (56, 52, 38, 82),
    'button': (65, 65, 45, 45),
}
DISPLAY_SIZES = {'panel': [(1024, 1400)], 'row': [(820, 116), (820, 130)],
                 'button': [(150, 68), (210, 86)]}


def validate_slices(name, size):
    left, right, top, bottom = SLICE_BORDERS[name]
    assert left + right < size[0] and top + bottom < size[1]
    for width, height in DISPLAY_SIZES[name]:
        # 与 Main.dailySprite 一致：先在原始像素空间切片，再整体等比显示。
        scale = width / size[0] if name == 'panel' else min(1, height / size[1])
        assert width / scale >= left + right
        assert height / scale >= top + bottom
        print(name, 'slice_display', (width, height), 'scale', scale,
              'slice_size', (width / scale, height / scale))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    image = Image.open(ROOT / 'art/generated/Strict_PRODUCTION_GAME_UI_SPRI_2026-11-24T14-45-56.png').convert('RGB')
    parts, labels = daily.items.components(image)
    print('source_size', image.size)
    cells = {'panel': []}
    # 图集布局并不均匀；显式区域内的所有连通组件均保留，包括清洁图标的小组件。
    for name, (left, top, right, bottom) in REGIONS.items():
        cells[name] = [part for part in parts
                       if left <= part['bounds'][0] and top <= part['bounds'][1]
                       and part['bounds'][2] <= right and part['bounds'][3] <= bottom]
        assert cells[name], name + ' 缺少区域内组件'
    selected = [part['label'] for cell in cells.values() for part in cell]
    assert len(selected) == len(set(selected)), '组件归属重复'
    target = ROOT / 'assets/resources/art/daily'
    assert target.is_dir()
    for name in IDS:
        cell = cells[name]
        source, source_labels = image, labels
        if name == 'panel':
            source = Image.open(ROOT / 'art/generated/ONE_isolated_high_resolution_t_2026-11-24T14-48-08.png').convert('RGB')
            panel_parts, source_labels = daily.items.components(source)
            cell = [max(panel_parts, key=lambda p: p['area'])]
        main = max(cell, key=lambda p: p['area'])
        group = cell
        part = dict(main)
        part['labels'] = {p['label'] for p in group}
        part['bounds'] = (min(p['bounds'][0] for p in group), min(p['bounds'][1] for p in group), max(p['bounds'][2] for p in group), max(p['bounds'][3] for p in group))
        canvas, origin = daily.extract(source, source_labels, part)
        bad = sum(1 for r,g,b,a in canvas.getdata() if a and r-g>85 and b-g>65 and r>175 and b>140)
        assert bad == 0
        info = {'size': canvas.size, 'source_origin': origin, 'component_bounds': part['bounds'],
                'components': len(group), 'alpha_bounds': canvas.getbbox(), 'magenta': bad}
        bounds = canvas.getbbox()
        assert min(bounds[0], bounds[1], canvas.width-bounds[2], canvas.height-bounds[3]) >= 12
        if name in ('panel', 'row', 'button'):
            try:
                info['cream_safe_ltrb'] = daily.cream_rectangle(canvas, 6)
            except AssertionError:
                info['cream_safe_ltrb'] = None
        if name in SLICE_BORDERS:
            validate_slices(name, canvas.size)
            info['slice_borders_lrtb'] = SLICE_BORDERS[name]
        print(name, json.dumps(info))
        if args.write:
            canvas.save(target / (name+'.png'))
            meta = daily.write_meta(target, name, canvas.size)
            if name in SLICE_BORDERS:
                borders = SLICE_BORDERS[name]
                for sub in meta['subMetas'].values():
                    if sub['importer'] == 'sprite-frame':
                        for field, value in zip(('borderLeft', 'borderRight', 'borderTop', 'borderBottom'), borders):
                            sub['userData'][field] = value
                (target / (name+'.png.meta')).write_text(json.dumps(meta, indent=2)+'\n')
        saved = Image.open(target / (name+'.png')).convert('RGBA')
        assert saved.size == canvas.size and saved.tobytes() == canvas.tobytes(), name + ' 未同步最新源图'
        meta = json.loads((target / (name+'.png.meta')).read_text(encoding='utf-8-sig'))
        for key, sub in meta['subMetas'].items():
            assert sub['uuid'] == meta['uuid'] + '@' + key, name + ' 子资源 UUID 错误'
            if sub['importer'] == 'sprite-frame':
                data = sub['userData']
                assert (data['width'], data['height']) == canvas.size, name + ' 尺寸不匹配'
                assert data['trimType'] == 'none', name + ' 不应自动裁边'
                if name in ('panel', 'row', 'button'):
                    left, right, top, bottom = (data[field] for field in ('borderLeft', 'borderRight', 'borderTop', 'borderBottom'))
                    assert min(left, right, top, bottom) > 0, name + ' 缺少真实九宫格参数'
                    assert left + right < canvas.width and top + bottom < canvas.height, name + ' 九宫格中心无效'
    uuids = [json.loads(path.read_text(encoding='utf-8-sig'))['uuid'] for path in (ROOT / 'assets').rglob('*.meta')]
    assert len(uuids) == len(set(uuids)), '资源 UUID 重复'
    print('通过：十二项实际组件与源图像素一致、透明留白、无洋红残留、元数据尺寸、九宫格中心及全资源 UUID 唯一。')


if __name__ == '__main__':
    main()
