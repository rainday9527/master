// 事务级自动化：执行真实 Main/DailyTasks 代码，cc 与存储使用桩；不代表引擎试玩。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript/lib/typescript.js');
const root = path.resolve(__dirname, '../assets/scripts');
const modules = new Map();
let raw = null, fail = false, now = Date.UTC(2026, 10, 23, 15, 59, 59);
class Clock extends Date { static now() { return now; } }
const storage = { getItem: () => raw, setItem: (_, value) => { if (fail) throw Error('磁盘写入失败'); raw = value; } };
function load(name) {
    if (modules.has(name)) return modules.get(name);
    const exports = {};
    modules.set(name, exports);
    const source = fs.readFileSync(path.join(root, name + '.ts'), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true } }).outputText;
    vm.runInNewContext(compiled, { exports, require: id => id === 'cc' ? { _decorator: { ccclass: () => type => type }, Component: class {}, sys: { localStorage: storage } } : load(id.replace('./', '')), Date: Clock, console });
    return exports;
}
const { Main } = load('Main');
const { DAILY_TASKS, restoreDaily, newDaily } = load('DailyTasks');
function game() {
    const g = new Main();
    g.toast = () => {}; g.renderHeader = () => {}; g.open = () => {};
    g.data = g.load();
    assert.equal(g.commitShop(g.data), true);
    return g;
}
function reset() { raw = null; fail = false; return game(); }
function care(g, id, category) {
    g.petSelected = true; g.selected = id;
    g.applyCare(category === 'rest' ? null : g.legacyItem(category), category);
}
let g = reset();
assert.equal(DAILY_TASKS.length, 6);
// 旧存档迁移不改余额，不自动发礼包。
const old = JSON.parse(raw); delete old.daily; old.coins = 1234; raw = JSON.stringify(old);
g = game(); assert.equal(g.data.coins, 1234); assert.equal(g.data.food, 5); assert.equal(g.data.daily.packClaimed, false);
const before = raw; fail = true; g.claimDaily('pack'); assert.equal(raw, before); assert.equal(g.data.daily.packClaimed, false); assert.equal(g.data.food, 5);
fail = false; g.claimDaily('pack'); assert.equal(g.data.food, 7); assert.equal(g.data.soap, 5); assert.equal(g.data.toy, 4);
g.claimDaily('pack'); assert.equal(g.data.food, 7);
// 失败、满状态、错误物种、库存不足均不能记进度。
g = reset(); fail = true; care(g, 0, 'food'); assert.equal(g.data.food, 5); assert.equal(g.data.daily.progress.feedCat, 0);
fail = false; g.data.pets[0].hunger = 100; care(g, 0, 'food'); assert.equal(g.data.daily.progress.feedCat, 0);
g.data.pets[0].hunger = 50;
g.applyCare(load('ItemCatalog').findItem('dog_food')); assert.equal(g.data.daily.progress.feedCat, 0);
g.data.food = 0; care(g, 0, 'food'); assert.equal(g.data.daily.progress.feedCat, 0); g.data.food = 5;
care(g, 0, 'food'); care(g, 1, 'food'); care(g, 0, 'soap'); care(g, 0, 'toy'); care(g, 0, 'rest');
for (const id of ['feedCat', 'feedDog', 'clean', 'play', 'rest']) assert.equal(g.data.daily.progress[id], 1, id);
let coins = g.data.coins; fail = true; g.claimDaily('feedCat'); assert.equal(g.data.coins, coins); assert.equal(g.data.daily.claimed.feedCat, false);
fail = false; g.claimDaily('feedCat'); assert.equal(g.data.coins, coins + 100); g.claimDaily('feedCat'); assert.equal(g.data.coins, coins + 100);
g = game(); coins = g.data.coins; g.claimDaily('feedCat'); assert.equal(g.data.coins, coins);
// 冒险开始、领取与任务同事务，失败后可重试且不重复。
g = reset(); fail = true; g.adventureAction(); assert.equal(g.data.adventureEnd, 0);
fail = false; g.adventureAction(); const end = g.data.adventureEnd;
g.adventureAction(); assert.equal(g.data.adventureEnd, end); now = end;
coins = g.data.coins; const gems = g.data.gems; fail = true; g.adventureAction(); assert.equal(g.data.coins, coins); assert.equal(g.data.adventureEnd, end); assert.equal(g.data.daily.progress.adventure, 0);
fail = false; g.adventureAction(); assert.equal(g.data.coins, coins + 80); assert.equal(g.data.gems, gems + 8); assert.equal(g.data.daily.progress.adventure, 1);
g.claimDaily('adventure'); assert.equal(g.data.gems, gems + 28); g.claimDaily('adventure'); assert.equal(g.data.gems, gems + 28);
// UTC+8 午夜，跨多天只刷新一次，回拨不恢复权益。
g.claimDaily('pack'); const day = g.data.daily.day; now += 4 * 86400000; g.claimDaily('pack'); assert.equal(g.data.daily.day, day + 4); const food = g.data.food;
now -= 5 * 86400000; g.claimDaily('pack'); assert.equal(g.data.daily.day, day + 4); assert.equal(g.data.food, food);
now = Date.UTC(2026, 10, 23, 15, 59, 59); g = reset(); care(g, 0, 'food'); g.claimDaily('feedCat'); now += 1000; g.persist(); g.claimDaily('feedCat'); assert.equal(g.data.daily.progress.feedCat, 0); assert.equal(g.data.daily.claimed.feedCat, false);
// 另一页面修改快照时拒绝覆盖；损坏每日状态保守修复。
raw += ' '; const data = g.data; g.claimDaily('pack'); assert.equal(g.data, data);
assert.equal(restoreDaily({ day: 1 }, 2, true).packClaimed, true);
assert.equal(restoreDaily(undefined, 2, false).day, 2);
assert.equal(newDaily(2).progress.adventure, 0);
// 离线UI契约：不启动HTTP服务，也不冒充浏览器几何验收。
const source = fs.readFileSync(path.join(root, 'Main.ts'), 'utf8');
const dailyUI = source.split('private renderDaily() {')[1].split('private adventureAction()')[0];
assert.match(source, /\(key === 'row' \|\| key === 'row-clean'\) \? 0\.24/);
assert.equal((dailyUI.match(/'row-clean', 0, 0, 740, 102, true/g) || []).length, 2);
assert(!/'row'|ProgressBar/.test(dailyUI), '不能使用原进度槽素材或进度条组件');
assert.match(dailyUI, /daily\.progress\[task\.id\] \+ '\/1'/, '保留实际任务文字状态');
assert.match(dailyUI, /'每日任务', -12, 400, 440, 58/);
assert.match(dailyUI, /'每日任务可视窗口', -12, -149, 740, 660/);
assert.match(dailyUI, /'art\/header\/'/);
const close = dailyUI.match(/this\.uiNode\(panel, '收起', (\d+), (\d+), (\d+), (\d+)\)/);
assert(close, '关闭区必须独立于等比图标');
const [x, y, w, h] = close.slice(1).map(Number);
assert.deepEqual([x, y, w, h], [420, 540, 128, 128]);
assert(w >= 128 && h >= 128);
assert(x + w / 2 <= 512 && y + h / 2 <= 700, '点击区不得越出面板');
assert(x - w / 2 > 208 && y - h / 2 > 429, '关闭区不得遮挡原标题');
// alpha扫描：源图y=0..199顶饰右界x=687，关闭区左界与其分离。
assert(x - w / 2 > (687 - 939 / 2) * 1024 / 939, '关闭区不得遮挡中央猫饰');
assert.match(dailyUI, /this\.dailySprite\(close, 'close', 0, 0, 112, 112, false, '关闭图标'\)/);
assert.match(source, /Math\.min\(w \/ frame\.originalSize\.width, h \/ frame\.originalSize\.height\)/);
assert.match(dailyUI, /this\.shopButton\(close, \(\) => this\.open\('home'\)\)/);
console.log('通过：六任务、旧版迁移、幂等、失败回滚、真实业务进度、冒险事务、UTC+8跨日/回拨、快照冲突、损坏修复、无槽行接入、右上关闭区128及图标112等比静态契约。cc/存储为桩；未启动服务或执行浏览器试玩。');
