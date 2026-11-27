// 执行 Main 的真实布局方法；几何验证不替代 Cocos 渲染或 TapTap 真机验收。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('D:/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript/lib/typescript.js');
let frame, visible, safe, host;
const policies = { FIXED_WIDTH: 4, FIXED_HEIGHT: 3 };
const view = {
    getFrameSize: () => frame,
    getVisibleSize: () => visible,
    setDesignResolutionSize: (w, h, policy) => {
        visible = policy === policies.FIXED_WIDTH ? { width: w, height: w * frame.height / frame.width } : { width: h * frame.width / frame.height, height: h };
    },
};
const modules = new Map();
function load(name) {
    if (modules.has(name)) return modules.get(name);
    const exports = {}; modules.set(name, exports);
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../assets/scripts', name + '.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    vm.runInNewContext(code, { exports, console, globalThis: host,
        require: id => id === 'cc/env' ? { DEBUG: false } : id === 'cc' ? {
            _decorator: { ccclass: () => cls => cls }, Component: class {}, view, ResolutionPolicy: policies,
            sys: { getSafeAreaRect: () => safe },
        } : load(id.replace('./', '')),
    });
    return exports;
}
function node(name, w, h, x = 0, y = 0) {
    return { name, w, h, x, y, sx: 1, sy: 1, children: [],
        setPosition(x, y) { this.x = x; this.y = y; },
        setScale(x, y) { this.sx = x; this.sy = y; },
        getChildByName(name) { return this.children.find(n => n.name === name); },
        get position() { return { x: this.x, y: this.y }; },
        get scale() { return { x: this.sx, y: this.sy }; },
        getComponent() { return { setContentSize: (w, h) => { this.w = w; this.h = h; } }; },
    };
}
function box(n, parent) {
    const sx = (parent?.sx || 1) * n.sx, sy = (parent?.sy || 1) * n.sy;
    const x = (parent?.x || 0) + n.x * (parent?.sx || 1), y = (parent?.y || 0) + n.y * (parent?.sy || 1);
    return { left: x - n.w * sx / 2, right: x + n.w * sx / 2, bottom: y - n.h * sy / 2, top: y + n.h * sy / 2 };
}
function contains(bounds, rect, label) {
    for (const [edge, sign] of [['left', 1], ['bottom', 1], ['right', -1], ['top', -1]]) {
        assert.ok((rect[edge] - bounds[edge]) * sign >= -1e-6, label + ' ' + edge + ' 超出安全区');
    }
}
let cases = 0;
for (const [w, h] of [[1080, 1920], [390, 844], [360, 800], [496, 1080], [1080, 1440], [1920, 1080]]) {
    for (const mode of ['普通', '胶囊', '胶囊回退', '非对称安全区']) {
        frame = { width: w, height: h }; visible = { width: 1080, height: 1920 };
        host = { innerWidth: w };
        if (mode.startsWith('胶囊')) host.tap = mode === '胶囊' ? { getMenuButtonBoundingClientRect: () => ({ bottom: 108 }), getSystemInfoSync: () => ({ windowWidth: w }) } : {};
        modules.clear();
        const { Main } = load('Main'); const g = new Main();
        g.adaptResolution();
        g.width = visible.width; g.height = visible.height;
        assert.ok(Math.abs(g.width / g.height - w / h) < 1e-9, '视口比例须与相机一致');
        safe = mode === '非对称安全区' ? { x: 28, y: 90, width: g.width - 84, height: g.height - 150 } : { x: 0, y: 0, width: g.width, height: g.height };
        g.ui = node('UI', g.width, g.height); g.top = node('顶栏', 1024, 228); g.bottom = node('底栏', 1080, 180);
        const names = ['庭院布置入口', '每日签到入口', '游戏设置入口', '每日任务入口', '冒险日记入口', '后院纪念角入口'];
        g.ui.children = names.map(name => node(name, 190, 174));
        const identity = g.ui.children.slice();
        g.layoutChrome(); const bounds = g.chromeBounds();
        contains(bounds, box(g.top), '顶栏'); contains(bounds, box(g.bottom), '底栏');
        for (const n of g.ui.children) contains(bounds, box(n), n.name);
        const profile = node('头像', 470, 150, -276, 17);
        contains(bounds, box(profile, g.top), '头像热区');
        for (const x of [83, 333]) contains(bounds, box(node('货币', 220, 81, x, 28), g.top), '货币及加号');
        for (const [prefix, count, width, start, step] of [['导航', 5, 190, -408, 204], ['照顾', 6, 166, -430, 172]]) {
            for (let i = 0; i < count; i++) contains(bounds, box(node(prefix, width, 174, start + i * step), g.bottom), prefix + i + '完整热区');
        }
        assert.ok(Math.abs(box(g.bottom).bottom - bounds.bottom) < 1e-6, '两类底栏均贴可用底部');
        g.layoutChrome();
        assert.ok(g.ui.children.every((n, i) => n === identity[i]), '适配不能重建入口');
        assert.ok(g.ui.children[0].y - 87 >= g.ui.children[1].y + 87, '侧入口热区不重叠');
        assert.ok(g.ui.children[0].y + 87 <= box(g.top).bottom, '侧入口不覆盖顶栏');
        // 执行页面真实 layout，不以复制公式代替验证。
        g.uiCamera = {}; g.worldCamera = {};
        for (const method of ['layoutGmPanel', 'layoutNotice', 'layoutDialog', 'layoutBackground']) g[method] = () => {};
        g.noticeUntil = Infinity;
        g.page = 'profile';
        g.sheet = node('主页', 1080, 1920);
        const bg = node('宠物主页底板', 1080, 1920);
        const viewport = node('主页安全可视区', 1040, 1840);
        viewport.children = [node('主页安全滚动内容', 1040, 1840)];
        g.sheet.children = [bg, viewport];
        g.layout();
        const bgRect = box(bg, g.sheet);
        assert.ok(bgRect.left <= -g.width / 2 && bgRect.right >= g.width / 2 && bgRect.bottom <= -g.height / 2 && bgRect.top >= g.height / 2, '主页背景必须 cover 全屏');
        contains(bounds, box(viewport, g.sheet), '主页安全可视区');
        assert.equal(viewport.children[0].h, 1840, '内容尺寸不因胶囊压缩');
        g.page = 'adventure'; g.sheet = node('冒险', g.width, g.height);
        const log = node('冒险左上实时日志卡', 370, 392);
        g.sheet.children = [log]; g.layout();
        contains(bounds, box(log), '实时冒险日志');
        assert.ok(box(log).top + 24 <= box(g.top).bottom + 1e-6, '日志避让货币顶栏');
        g.page = 'album'; g.sheet = node('图鉴', 1080, 1920);
        const albumBg = node('图鉴正式大底板', 1080, 1920);
        const title = node('图鉴标题', 440, 72);
        const close = node('收起图鉴', 104, 104);
        g.sheet.children = [albumBg, title, close]; g.layout();
        contains(bounds, box(close, g.sheet), '图鉴关闭按钮');
        const art = box(albumBg, g.sheet), label = box(title, g.sheet);
        assert.ok(Math.abs((art.top - (label.top + label.bottom) / 2) / (art.top - art.bottom) - 137 / 1920) < 1e-6, '纯文字标题随猫耳美术牌定位');
        // 证明侧入口覆盖投影点确实会造成遮挡，未假称已改生成/迁移逻辑。
        const side = box(g.ui.children[0]);
        assert.ok(side.right > side.left && side.top > side.bottom, '侧栏遮挡热区具有非零面积');
        cases++;
    }
}
const source = fs.readFileSync(path.join(__dirname, '../assets/scripts/Main.ts'), 'utf8');
assert.ok(source.includes("this.pressFeedback(button)"), '保留底栏按下反馈');
console.log(`通过：${cases} 组真实 Main 布局方法；视口比例、顶栏/头像/货币、6 个侧入口、5 个导航和 6 个照顾热区、安全区/胶囊/回退、贴底及节点复用。仅几何断言，未进行真机渲染验收。`);
