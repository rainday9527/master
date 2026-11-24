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
    vm.runInNewContext(compiled, { exports, require: id => id === 'cc' ? { _decorator: { ccclass: () => type => type }, Component: class {}, isValid: () => true, sys: { localStorage: storage } } : load(id.replace('./', '')), Date: Clock, console });
    return exports;
}
const { Main } = load('Main');
const { DAILY_TASKS, restoreDaily, newDaily, advanceDaily, recordDaily } = load('DailyTasks');
function game() {
    const g = new Main();
    g.toast = () => {}; g.renderHeader = () => {}; g.open = page => { assert.notEqual(page, 'daily', '领奖不得重建任务面板'); };
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
// 真实照顾操作累加至目标，多余操作夹紧。
for (let i = 0; i < 4; i++) {
    g.data.food = 10;
    for (const [pet, category, stat] of [[0, 'food', 'hunger'], [1, 'food', 'hunger'], [0, 'soap', 'clean'], [0, 'toy', 'joy'], [0, 'rest', 'energy']]) {
        g.data.pets.find(p => p.id === pet)[stat] = 20;
        care(g, pet, category);
    }
}
for (const task of DAILY_TASKS.filter(t => t.id !== 'adventure')) assert.equal(g.data.daily.progress[task.id], task.target);
let coins = g.data.coins; fail = true; g.claimDaily('feedCat'); assert.equal(g.data.coins, coins); assert.equal(g.data.daily.claimed.feedCat, false);
fail = false; g.claimDaily('feedCat'); assert.equal(g.data.coins, coins + 100); g.claimDaily('feedCat'); assert.equal(g.data.coins, coins + 100);
g = game(); coins = g.data.coins; g.claimDaily('feedCat'); assert.equal(g.data.coins, coins);
// 冒险开始、领取与任务同事务，失败后可重试且不重复。
g = reset(); fail = true; g.adventureAction(); assert.equal(g.data.adventureEnd, 0);
fail = false; g.adventureAction(); const end = g.data.adventureEnd;
g.adventureAction(); assert.equal(g.data.adventureEnd, end); now = end;
coins = g.data.coins; const gems = g.data.gems; fail = true; g.adventureAction(); assert.equal(g.data.coins, coins); assert.equal(g.data.adventureEnd, end); assert.equal(g.data.daily.progress.adventure, 0);
fail = false; g.adventureAction(); assert.equal(g.data.coins, coins + 80); assert.equal(g.data.gems, gems + 8); assert.equal(g.data.daily.progress.adventure, 1);
g.claimDaily('adventure'); assert.equal(g.data.gems, gems + 8, '一次冒险未达到目标');
g.adventureAction(); now = g.data.adventureEnd; g.adventureAction();
assert.equal(g.data.daily.progress.adventure, 2);
const adventureGems = g.data.gems;
g.claimDaily('adventure'); assert.equal(g.data.gems, adventureGems + 20); g.claimDaily('adventure'); assert.equal(g.data.gems, adventureGems + 20);
// UTC+8 午夜，跨多天只刷新一次，回拨不恢复权益。
g.claimDaily('pack'); const day = g.data.daily.day; now += 4 * 86400000; g.claimDaily('pack'); assert.equal(g.data.daily.day, day + 4); const food = g.data.food;
now -= 5 * 86400000; g.claimDaily('pack'); assert.equal(g.data.daily.day, day + 4); assert.equal(g.data.food, food);
now = Date.UTC(2026, 10, 23, 15, 59, 59); g = reset(); care(g, 0, 'food'); g.claimDaily('feedCat'); now += 1000; g.persist(); g.claimDaily('feedCat'); assert.equal(g.data.daily.progress.feedCat, 0); assert.equal(g.data.daily.claimed.feedCat, false);
// 另一页面修改快照时拒绝覆盖；损坏每日状态保守修复。
raw += ' '; const data = g.data; g.claimDaily('pack'); assert.equal(g.data, data);
assert.equal(restoreDaily({ day: 1 }, 2, true).packClaimed, true);
assert.equal(restoreDaily(undefined, 2, false).day, 2);
assert.equal(newDaily(2).progress.adventure, 0);
// 原位刷新handler执行契约：覆盖七行成功、重复、失败，禁止任何daily重建。
for (const id of ['pack', ...DAILY_TASKS.map(t => t.id)]) {
    g = reset();
    if (id !== 'pack') g.data.daily.progress[id] = DAILY_TASKS.find(t => t.id === id).target;
    let refreshed = 0;
    const rows = g.dailyRows;
    for (const key of ['pack', ...DAILY_TASKS.map(t => t.id)]) rows.set(key, daily => {
        assert.equal(JSON.stringify(daily), JSON.stringify(g.data.daily)); refreshed++;
    });
    const before = JSON.stringify(g.data); fail = true; g.claimDaily(id);
    assert.equal(JSON.stringify(g.data), before); assert.equal(refreshed, 0);
    fail = false; g.claimDaily(id); assert.equal(refreshed, 7); assert.equal(g.dailyRows, rows);
    const once = JSON.stringify(g.data); g.claimDaily(id);
    assert.equal(JSON.stringify(g.data), once); assert.equal(refreshed, 14); assert.equal(g.dailyRows, rows);
}
// 新目标、旧0/1存档及已领取权益均保留；新进度可往返保存。
assert.deepEqual(Array.from(DAILY_TASKS, t => t.target), [3, 3, 3, 3, 2, 2]);
for (const task of DAILY_TASKS) {
    assert(!task.title.includes('一次'));
    const legacy = newDaily(10);
    delete legacy.adClaimed;
    legacy.progress[task.id] = 1; legacy.claimed[task.id] = true;
    const restored = restoreDaily(JSON.parse(JSON.stringify(legacy)), 10, true);
    assert.equal(restored.progress[task.id], 1);
    assert.equal(restored.claimed[task.id], true);
    assert.equal(restored.adClaimed[task.id], false);
    assert.equal(advanceDaily(legacy, 10).adClaimed[task.id], false);
    legacy.claimed[task.id] = false;
    assert.equal(restoreDaily(legacy, 10, true).claimed[task.id], false);
    for (let i = 0; i < 8; i++) recordDaily(legacy, task.id);
    assert.equal(legacy.progress[task.id], task.target);
    assert.equal(restoreDaily(legacy, 10, true).progress[task.id], task.target);
    assert.equal(restoreDaily(legacy, 11, true).progress[task.id], 0);
    g = reset(); g.data.daily.progress[task.id] = 1; g.data.daily.claimed[task.id] = true;
    const balance = g.data[task.currency];
    g.claimDaily(task.id); g.watchDailyRewardedVideo(task.id);
    assert.equal(g.data[task.currency], balance);
}
function ready(id = 'feedCat') {
    now = Date.UTC(2026, 10, 23, 15, 59, 59);
    const g = reset(), task = DAILY_TASKS.find(t => t.id === id);
    g.data.daily.progress[id] = task.target; assert(g.commitShop(g.data));
    return g;
}
for (const task of DAILY_TASKS) {
    g = ready(task.id);
    let refreshes = 0, callback, shows = 0;
    g.dailyRows.set(task.id, () => refreshes++);
    const balance = g.data[task.currency];
    g.watchDailyRewardedVideo(task.id);
    assert.equal(g.data[task.currency], balance); assert.equal(g.rewardedVideoPending, false);
    g.rewardedVideoProvider = { show: cb => { callback = cb; shows++; } };
    g.watchDailyRewardedVideo(task.id); g.watchDailyRewardedVideo(task.id);
    g.watchRewardedVideo('coins'); g.watchRewardedVideo('gems');
    assert.equal(shows, 1); assert.equal(g.rewardedVideoPending, true);
    callback('completed'); const saved = raw;
    assert.equal(g.data[task.currency], balance + 2 * task.amount);
    assert.equal(g.data.daily.claimed[task.id], true); assert.equal(refreshes, 1);
    assert.equal(g.data.daily.adClaimed[task.id], true);
    assert.equal(g.rewardedVideoPending, false);
    callback('completed'); callback('failed'); g.claimDaily(task.id);
    assert.equal(raw, saved); assert.equal(g.data[task.currency], balance + 2 * task.amount);
    g.watchDailyRewardedVideo(task.id); assert.equal(shows, 1);
    g = game(); assert.equal(g.data.daily.claimed[task.id], true);
    assert.equal(g.data.daily.adClaimed[task.id], true);
    g.rewardedVideoProvider = { show: () => assert.fail('已双倍不得再次播放') };
    g.watchDailyRewardedVideo(task.id); g.claimDaily(task.id);
    assert.equal(raw, saved);
}
// 普通领取后可补领广告；播放中普通领取以回调时状态结算，最多两倍。
for (const task of DAILY_TASKS) for (const duringVideo of [false, true]) {
    g = ready(task.id);
    const balance = g.data[task.currency];
    let callback, shows = 0;
    g.rewardedVideoProvider = { show: cb => { callback = cb; shows++; } };
    if (!duringVideo) g.claimDaily(task.id);
    g.watchDailyRewardedVideo(task.id);
    if (duringVideo) g.claimDaily(task.id);
    assert.equal(g.data[task.currency], balance + task.amount);
    assert.equal(g.data.daily.adClaimed[task.id], false);
    g.watchDailyRewardedVideo(task.id); g.watchDailyRewardedVideo('clean'); g.watchRewardedVideo('coins');
    assert.equal(shows, 1);
    callback('completed');
    assert.equal(g.data[task.currency], balance + 2 * task.amount);
    assert.equal(g.data.daily.claimed[task.id], true);
    assert.equal(g.data.daily.adClaimed[task.id], true);
    const saved = raw;
    callback('completed'); g.claimDaily(task.id); g.watchDailyRewardedVideo(task.id);
    assert.equal(raw, saved); assert.equal(shows, 1);
    g = game(); assert.equal(g.data.daily.adClaimed[task.id], true);
}
for (const result of ['cancelled', 'failed', 'throw', 'saveFailed', 'crossDay', 'persistedCrossDay', 'overflow', 'conflict']) {
    g = ready();
    const balance = g.data.coins;
    let callback;
    g.rewardedVideoProvider = { show: cb => { callback = cb; if (result === 'throw') throw Error('播放失败'); } };
    g.watchDailyRewardedVideo('feedCat');
    if (result === 'crossDay' || result === 'persistedCrossDay') {
        now += 1000;
        if (result === 'persistedCrossDay') {
            g.persist(); g.data.daily.progress.feedCat = 3; assert(g.commitShop(g.data));
        }
    }
    if (result === 'overflow') g.data.coins = 100000000 - 199;
    if (result === 'conflict') raw += ' ';
    const before = JSON.stringify(g.data), saved = raw;
    if (result === 'saveFailed') fail = true;
    callback(result === 'cancelled' || result === 'failed' ? result : 'completed');
    fail = false;
    assert.equal(JSON.stringify(g.data), before, result + '不改余额或领取状态');
    assert.equal(raw, saved, result + '不写入奖励');
    assert.equal(g.rewardedVideoPending, false);
    callback('completed'); assert.equal(raw, saved, '重复终态无效');
    if (['cancelled', 'failed', 'throw', 'saveFailed'].includes(result)) {
        assert.equal(g.data.daily.claimed.feedCat, false);
        g.claimDaily('feedCat'); assert.equal(g.data.coins, balance + 100);
    }
}
// 普通领取后补发按一份奖励检查上限，而非两份。
g = ready(); g.data.coins = 100000000 - 200; g.claimDaily('feedCat');
g.rewardedVideoProvider = { show: cb => cb('completed') }; g.watchDailyRewardedVideo('feedCat');
assert.equal(g.data.coins, 100000000); assert.equal(g.data.daily.adClaimed.feedCat, true);
// 已普通领取时，广告保存失败不得消耗广告权益，重试只补基础奖励。
g = ready(); g.claimDaily('feedCat'); const retryBalance = g.data.coins;
let retryCallback;
g.rewardedVideoProvider = { show: cb => { retryCallback = cb; } };
g.watchDailyRewardedVideo('feedCat'); const beforeRetry = raw;
fail = true; retryCallback('completed'); fail = false;
assert.equal(raw, beforeRetry); assert.equal(g.data.coins, retryBalance);
assert.equal(g.data.daily.claimed.feedCat, true); assert.equal(g.data.daily.adClaimed.feedCat, false);
g.watchDailyRewardedVideo('feedCat'); retryCallback('completed');
assert.equal(g.data.coins, retryBalance + 100); assert.equal(g.data.daily.adClaimed.feedCat, true);
// 真实旧存档缺失广告字段：保留普通领取及余额，恢复后仍能补领。
g = ready(); g.claimDaily('feedCat'); const legacySave = JSON.parse(raw);
delete legacySave.daily.adClaimed; raw = JSON.stringify(legacySave);
g = game(); const legacyBalance = g.data.coins;
assert.equal(g.data.daily.claimed.feedCat, true); assert.equal(g.data.daily.adClaimed.feedCat, false);
g.rewardedVideoProvider = { show: cb => cb('completed') }; g.watchDailyRewardedVideo('feedCat');
assert.equal(g.data.coins, legacyBalance + 100);
// 字段损坏或广告已领但普通未领时，全部权益封闭；次日刷新，克隆互不污染。
for (const adClaimed of [null, undefined, {}, false, { ...newDaily(10).adClaimed, feedCat: 'true' }, { ...newDaily(10).adClaimed, feedCat: true }]) {
    const damaged = { ...newDaily(10), adClaimed };
    const restored = restoreDaily(damaged, 10, true);
    for (const task of DAILY_TASKS) {
        assert.equal(restored.claimed[task.id], true);
        assert.equal(restored.adClaimed[task.id], true);
    }
    assert.equal(restored.packClaimed, true);
    assert.equal(restoreDaily(damaged, 11, true).adClaimed.feedCat, true);
    assert.equal(advanceDaily(restored, 11).adClaimed.feedCat, false);
}
const closed = newDaily(10, true), cloned = advanceDaily(closed, 10);
cloned.adClaimed.feedCat = false; assert.equal(closed.adClaimed.feedCat, true);
assert.equal(restoreDaily(closed, 11, true).adClaimed.feedCat, false);
// 金币、钻石与每日任务互斥；旧回调不能解开新播放的锁。
for (const currency of ['coins', 'gems']) {
    g = ready(); let callback, shows = 0;
    g.rewardedVideoProvider = { show: cb => { callback = cb; shows++; } };
    g.watchRewardedVideo(currency); g.watchDailyRewardedVideo('feedCat');
    assert.equal(shows, 1); callback('cancelled'); const oldCallback = callback;
    g.watchDailyRewardedVideo('feedCat'); assert.equal(shows, 2);
    oldCallback('completed'); assert.equal(g.rewardedVideoPending, true);
    callback('completed'); assert.equal(g.rewardedVideoPending, false);
}
// 未完成不得播放；普通领取也必须达到target且检查余额上限。
g = reset(); let shows = 0; g.rewardedVideoProvider = { show: () => shows++ };
g.data.daily.progress.feedCat = 1; let balance = g.data.coins;
g.claimDaily('feedCat'); g.watchDailyRewardedVideo('feedCat');
assert.equal(shows, 0); assert.equal(g.data.coins, balance);
g.data.daily.progress.feedCat = 3; g.data.coins = 100000000 - 99;
g.claimDaily('feedCat'); assert.equal(g.data.daily.claimed.feedCat, false);
g.data.coins = 100000000 - 100; g.claimDaily('feedCat'); assert.equal(g.data.coins, 100000000);
g = ready('adventure'); g.data.gems = 100000000 - 40;
g.rewardedVideoProvider = { show: cb => cb('completed') };
g.watchDailyRewardedVideo('adventure');
assert.equal(g.data.gems, 100000000); assert.equal(g.data.daily.claimed.adventure, true);
// 离线UI契约：不启动HTTP服务，也不冒充浏览器几何验收。
const source = fs.readFileSync(path.join(root, 'Main.ts'), 'utf8');
const dailyUI = source.split('private renderDaily() {')[1].split('private adventureAction()')[0];
assert.match(source, /\(key === 'row' \|\| key === 'row-clean'\) \? 0\.24/);
assert.equal((dailyUI.match(/'row-clean', 0, 0, 740, 102, true/g) || []).length, 2);
assert(!/'row'|ProgressBar/.test(dailyUI), '不能使用原进度槽素材或进度条组件');
assert.match(dailyUI, /daily\.progress\[task\.id\] \+ '\/' \+ task\.target/, '显示实际目标');
assert.match(dailyUI, /state\.progress\[task\.id\] \+ '\/' \+ task\.target/);
assert.match(dailyUI, /adButton\.active = complete;/);
assert.match(dailyUI, /adButton\.name = state\.adClaimed\[task\.id\] \? '已双倍' : '广告双倍'/);
assert.match(dailyUI, /adTitle\.string = adButton\.name/);
assert.match(dailyUI, /adTitle\.color = this\.statusColor\(state\.adClaimed\[task\.id\]\)/);
assert.match(dailyUI, /adBackground\.active = !state\.adClaimed\[task\.id\]/);
assert.match(dailyUI, /'广告双倍', 300, 6, 108, 68/);
const dailyButtonUI = source.split('private dailyButton(')[1].split('private claimDaily(')[0];
assert.match(dailyButtonUI, /this\.pressVisualFeedback\(node, node\.children\.slice\(\)\)/);
assert.equal((source.match(/private pressFeedback\(/g) || []).length, 1);
assert.equal((source.match(/private pressVisualFeedback\(/g) || []).length, 1);
assert.match(dailyUI, /'任务', -12, 400, 440, 58/);
assert.match(dailyUI, /'每日任务可视窗口', -12, -149, 740, 660/);
assert.match(dailyUI, /'art\/header\/'/);
const close = dailyUI.match(/this\.uiNode\(panel, '收起', (\d+), (\d+), (\d+), (\d+)\)/);
assert(close, '关闭区必须独立于等比图标');
const [x, y, w, h] = close.slice(1).map(Number);
assert.deepEqual([x, y, w, h], [420, 390, 128, 128]);
assert(w >= 128 && h >= 128);
assert(x + w / 2 <= 512 && y + h / 2 <= 700, '点击区不得越出面板');
assert(x - w / 2 > 208 && y + h / 2 <= 470, '关闭区应落到实际侧板且不遮挡原标题');
// alpha扫描：源图y=0..199顶饰右界x=687，关闭区左界与其分离。
assert(x - w / 2 > (687 - 939 / 2) * 1024 / 939, '关闭区不得遮挡中央猫饰');
assert.match(dailyUI, /this\.dailySprite\(close, 'close', 0, 0, 112, 112, false, '关闭图标'\)/);
assert.match(source, /Math\.min\(w \/ frame\.originalSize\.width, h \/ frame\.originalSize\.height\)/);
assert.match(dailyUI, /this\.shopButton\(close, \(\) => this\.open\('home'\)\)/);
console.log('通过：六任务target及累加夹紧、旧0/1及已领取存档、普通领取目标/上限、真实照顾与冒险事务、广告未接/双倍成功/取消/失败/抛错/重复/跨日/保存失败/快照冲突/余额上限、普通后广告补base/先广告2base/普通领取竞态、独立广告权益持久化/旧存档迁移/损坏封闭/补领失败重试、金币钻石共用锁及旧回调隔离、七行原位刷新、滚动与显示层反馈静态契约。cc/存储为桩；未构建、未启动服务或执行浏览器试玩。');
