// 纯模块及真实 Main 事务；引擎仅桩化，不代替浏览器真实点击。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('D:/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript/lib/typescript.js');
let raw = null, fail = false, clock = Date.now(), rolls = [];
class Clock extends Date { static now() { return clock; } }
const math = Object.create(Math); math.random = () => rolls.length ? rolls.shift() : 0;
const modules = new Map();
function load(name) {
    if (modules.has(name)) return modules.get(name);
    const exports = {}; modules.set(name, exports);
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../assets/scripts', name + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, experimentalDecorators: true } }).outputText;
    vm.runInNewContext(code, { exports, require: id => id === 'cc' ? { _decorator: { ccclass: () => type => type }, Component: class {}, sys: { localStorage: { getItem: () => raw, setItem: (_, v) => { if (fail) throw Error('失败'); raw = v; } } } } : load(id.replace('./', '')), Date: Clock, Math: math, console });
    return exports;
}
// 正式PNG和meta必须同为9:16，且保持既有资源UUID。
const artRoot = path.join(__dirname, '../assets/resources/art/recruit');
const backgroundPNG = fs.readFileSync(path.join(artRoot, 'background.png'));
assert.equal(backgroundPNG.readUInt32BE(16), 1080); assert.equal(backgroundPNG.readUInt32BE(20), 1920);
const backgroundMeta = JSON.parse(fs.readFileSync(path.join(artRoot, 'background.png.meta')));
assert.equal(backgroundMeta.uuid, '4e7e4e59-a693-4d3a-9afc-bb3ef2875ae1');
const backgroundFrame = Object.values(backgroundMeta.subMetas).find(m => m.importer === 'sprite-frame').userData;
assert.deepEqual([backgroundFrame.width,backgroundFrame.height,backgroundFrame.rawWidth,backgroundFrame.rawHeight], [1080,1920,1080,1920]);
const { Main } = load('Main');
const R = load('Recruitment'), pool = [0, 1, 2, 3, 4, 5];
const plain = v => JSON.parse(JSON.stringify(v));
function game(saved) {
    raw = saved || null; fail = false; rolls = [];
    const g = new Main(); g.messages = []; g.spawned = []; g.dialogs = 0;
    g.toast = s => g.messages.push(s); g.renderHeader = () => {}; g.updateRecruit = () => {};
    g.spawnPet = p => { assert.equal(JSON.parse(raw).pets.some(v => v.id === p.id), true); g.spawned.push(p); };
    g.showGemDialog = () => g.dialogs++;
    g.data = g.load(); g.commitShop(g.data); return g;
}
function act(g, mode, values = []) { clock += 601; rolls = values.slice(); g.recruitTransaction(mode); }
let g = game();
assert.deepEqual(plain(g.data.recruit.copies), { 0: 1, 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 });
const legacy = plain(g.data); delete legacy.recruit;
legacy.pets.push({ ...legacy.pets[0], id: 3 });
g = game(JSON.stringify(legacy));
assert.equal(g.data.recruit.copies[3], 1); assert.equal(g.data.recruit.claimed, 0);
assert.deepEqual(plain(g.data.shop), legacy.shop); assert.deepEqual(plain(g.data.daily), legacy.daily);
assert.equal(g.data.coins, legacy.coins); assert.equal(g.data.food, legacy.food);
// 旧存档不凭空补发，单抽包含初始伙伴，重复保留。
g.data.gems = 20000;
act(g, 'single', [0]); assert.equal(g.data.gems, 19700); assert.equal(g.data.recruit.total, 1);
assert.equal(g.data.recruit.copies[0], 2); assert.equal(g.spawned.length, 0);
act(g, 'ten', [0.4, 0.4, 0.6, 0.8, 0.99, 0, 0.2, 0, 0, 0]);
assert.equal(g.data.gems, 17000); assert.equal(g.data.recruit.total, 11);
assert.equal(g.data.recruit.recent.length, 10); assert.equal(g.data.recruit.copies[2], 2);
assert.equal(g.spawned.length, 3); assert.equal(new Set(g.data.pets.map(p => p.id)).size, 6);
const snap = JSON.stringify(g.data), spawnCount = g.spawned.length;
g.recruitTransaction('ten'); assert.equal(JSON.stringify(g.data), snap); assert.match(g.messages.at(-1), /太快/);
fail = true; act(g, 'ten', [0.4]); assert.equal(JSON.stringify(g.data), snap); assert.equal(g.spawned.length, spawnCount); fail = false;
raw = '其他页面存档'; act(g, 'single'); assert.equal(JSON.stringify(g.data), snap); raw = snap; g.saveSnapshot = raw;
g.data.gems = 299; const low = JSON.stringify(g.data); act(g, 'single'); act(g, 'ten');
assert.equal(g.dialogs, 2); assert.equal(JSON.stringify(g.data), low);
// 新伙伴候选在保存失败时也不能泄漏到庭院或本体库存。
g = game(); g.data.gems = 10000;
const freshBefore = JSON.stringify(g.data); fail = true; act(g, 'ten', Array(10).fill(0.99));
assert.equal(JSON.stringify(g.data), freshBefore); assert.equal(g.spawned.length, 0); fail = false;
act(g, 'ten', Array(10).fill(0.99)); assert.equal(g.spawned.length, 1); assert.equal(g.data.recruit.copies[5], 10);
// 重入交易必须挡住，即使从持久化回调触发也不扣第二笔。
g = game(); g.data.gems = 10000;
const commit = g.commitShop.bind(g); g.commitShop = c => { g.recruitTransaction('ten'); return commit(c); };
act(g, 'ten'); assert.equal(g.data.gems, 7300); assert.equal(g.data.recruit.total, 10);
// 每档补领、不增加累计，失败不推进，重新加载也幂等。
g = game(); g.data.recruit.total = 300;
let expected = [10, 30, 50, 100, 200, 300];
for (const n of expected) {
    const before = JSON.stringify(g.data), count = g.spawned.length;
    fail = true; act(g, 'reward', [0.99]); assert.equal(JSON.stringify(g.data), before); assert.equal(g.spawned.length, count); fail = false;
    act(g, 'reward', [0.99]); assert.equal(g.data.recruit.claimed, n); assert.equal(g.data.recruit.total, 300); assert.equal(g.data.gems, 100);
}
assert.equal(g.data.recruit.copies[5], 6); assert.equal(g.spawned.length, 1);
g = game(raw); const claimed = JSON.stringify(g.data); act(g, 'reward'); assert.equal(JSON.stringify(g.data), claimed);
assert.deepEqual([0, 10, 30, 50, 100, 200, 300].map(R.nextMilestone), [10, 30, 50, 100, 200, 300, 400]);
// 所有池成员等宽区间，不加稀有率；安全上限整笔回滚。
assert.deepEqual(plain(R.drawRecruit(pool, 6, (() => { let i = 0; return () => (i++ + 0.5) / 6; })())), pool);
assert.throws(() => R.drawRecruit(pool, 1, () => 1));
g = game(); g.data.gems = 10000; g.data.recruit.copies[0] = R.RECRUIT_CONFIG.maxCopies;
let before = JSON.stringify(g.data); act(g, 'ten'); assert.equal(JSON.stringify(g.data), before);
g.data.recruit.total = R.RECRUIT_CONFIG.maxTotal; before = JSON.stringify(g.data); act(g, 'single'); assert.equal(JSON.stringify(g.data), before);
// 招募字段损坏仅修复招募；不可信领取记录封闭当前权益。
for (const recruit of [null, { total: 300, claimed: '损坏', copies: { 0: -1 }, recent: [999] }, { total: -1, claimed: 100, copies: {} }, { total: 50, claimed: 200, copies: { 0: 3, 2: 999 } }]) {
    const saved = { ...legacy, recruit };
    g = game(JSON.stringify(saved));
    assert.equal(g.data.coins, saved.coins); assert.equal(g.data.gems, saved.gems);
    assert.deepEqual({ ...plain(g.data.shop), maxTime: saved.shop.maxTime }, saved.shop); assert.deepEqual(plain(g.data.daily), saved.daily);
    assert.deepEqual(plain(g.data.pets.map(p => p.id)), saved.pets.map(p => p.id));
    assert.ok(g.data.recruit.copies[0] >= 1); assert.equal(g.data.recruit.copies[2], 0);
    const state = JSON.stringify(g.data.recruit); act(g, 'reward'); assert.equal(JSON.stringify(g.data.recruit), state);
}
const repaired = R.restoreRecruit({ total: 300, claimed: 100, copies: null, recent: ['坏'] }, [0, 1], pool, true);
assert.equal(repaired.claimed, 100); assert.equal(repaired.total, 300);
console.log('通过：旧存档迁移、全池等权、300单抽/2700十抽、重复总本体、新宠仅提交后生成、失败/冲突回滚、缺钻、节流/重入、100后档位、逐档补领/幂等、库存/次数上限、损坏保守修复。');
