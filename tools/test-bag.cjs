// 执行真实背包事务与六槽刷新；引擎节点为桩，不代替浏览器验收。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('D:/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript/lib/typescript.js');
let raw = null, fail = false;
const modules = new Map();
const storage = { getItem: () => raw, setItem: (_, value) => { if (fail) throw Error('保存失败'); raw = value; } };
function load(name) {
    if (modules.has(name)) return modules.get(name);
    const exports = {}; modules.set(name, exports);
    const source = fs.readFileSync(path.join(__dirname, '../assets/scripts', name + '.ts'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true } }).outputText;
    vm.runInNewContext(code, { exports, require: id => id === 'cc' ? { _decorator: { ccclass: () => type => type }, Component: class {}, isValid: () => true, sys: { localStorage: storage } } : load(id.replace('./', '')), Date, performance, console });
    return exports;
}
const { Main } = load('Main');
const { ITEM_CATALOG, findItem } = load('ItemCatalog');
function game() {
    raw = null; fail = false;
    const g = new Main(); g.toast = () => {}; g.renderHeader = () => {};
    g.open = () => { throw Error('背包操作不得重建页面'); };
    g.data = g.load(); g.commitShop(g.data); g.page = 'bag'; g.sheet = {};
    g.color = v => v; g.updateShopSprite = (s, p) => { s.path = p; };
    g.bagPageLabel = {}; g.bagTargetLabel = {}; g.bagEmpty = {};
    g.bagSlots = Array.from({ length: 6 }, () => ({ node: {}, entry: null, title: {}, icon: {}, species: {}, effect: {}, count: {}, use: {} }));
    g.updateBag(); return g;
}
let g = game();
assert.equal(g.bagEntries().length, 3, '保留全部旧版物资');
g.data.itemInventory = Object.fromEntries(ITEM_CATALOG.map(item => [item.id, 2]));
g.updateBag(); const refs = g.bagSlots.slice();
assert.ok(g.bagEntries().length > 6);
g.bagPage = 1; g.updateBag(); assert.equal(g.bagPage, 1);
for (const category of [null, 'food', 'soap', 'toy']) {
    g.bagFilter = category; g.bagPage = 99; g.updateBag();
    assert.ok(g.bagEntries().every(entry => !category || entry.item.category === category));
    assert.ok(g.bagPage < Math.max(1, Math.ceil(g.bagEntries().length / 6)));
}
g.bagFilter = null; g.bagPage = 0; g.petSelected = true; g.selected = 0; g.updateBag();
assert.ok(g.bagEntries().every(entry => entry.item.appliesTo !== 'dog'));
let item = g.bagSlots[0].entry.item;
g.data.pets[0].hunger = g.data.pets[0].clean = g.data.pets[0].energy = g.data.pets[0].joy = 0;
const count = g.data.itemInventory[item.id];
g.applyCare(item); assert.equal(g.data.itemInventory[item.id], count - 1);
refs.forEach((slot, i) => assert.equal(g.bagSlots[i], slot));
const before = JSON.stringify(g.data); fail = true; g.applyCare(item); assert.equal(JSON.stringify(g.data), before); fail = false;
g.data.pets[0].hunger = g.data.pets[0].clean = g.data.pets[0].energy = g.data.pets[0].joy = 100;
g.applyCare(item); assert.equal(g.data.itemInventory[item.id], count - 1);
const wrong = ITEM_CATALOG.find(item => item.appliesTo === 'dog'); const wrongCount = g.data.itemInventory[wrong.id];
g.applyCare(wrong); assert.equal(g.data.itemInventory[wrong.id], wrongCount);
// 用尽后槽位重新绑定，下次使用不能捕获旧道具；末页耗尽回退。
g = game(); g.petSelected = true; g.selected = 0;
g.data.itemInventory = {}; g.data.food = 1; g.data.soap = g.data.toy = 0;
g.data.pets[0].hunger = 0; g.updateBag(); const slot = g.bagSlots[0];
g.applyCare(slot.entry.item, slot.entry.legacy); assert.equal(slot.entry, null); assert.equal(g.bagEmpty.active, true); assert.equal(g.bagPage, 0);
g = game(); g.data.itemInventory = Object.fromEntries(ITEM_CATALOG.map(item => [item.id, 1])); g.bagPage = 99; g.updateBag();
const lastPage = g.bagPage;
for (const entry of g.bagEntries().slice(lastPage * 6)) { if (entry.legacy) g.data[entry.legacy] = 0; else g.data.itemInventory[entry.item.id] = 0; }
g.updateBag(); assert.ok(g.bagPage < lastPage);
// 实际购买事务进入背包，再实际使用。
g = game(); const buy = g.data.shop.slots[0].id; item = findItem(buy); g.data[item.currency] = 100000;
g.updateShopLabels = () => {}; g.buyShopItem(buy); assert.equal(g.data.itemInventory[buy], 1);
g.petSelected = true; g.selected = item.appliesTo === 'dog' ? 1 : 0;
g.data.pets[g.selected].hunger = g.data.pets[g.selected].clean = g.data.pets[g.selected].energy = g.data.pets[g.selected].joy = 0;
g.updateBag(); g.applyCare(item); assert.equal(g.data.itemInventory[buy], 0);
const source = fs.readFileSync(path.join(__dirname, '../assets/scripts/Main.ts'), 'utf8');
assert.ok(!source.slice(source.indexOf('private renderBag()'), source.indexOf('private dailySprite(')).includes("this.open('bag')"));
console.log('通过：四类筛选、物种过滤、六槽引用稳定、分页回退、实际购买使用、legacy用尽、满状态/错物种/保存失败事务；尚待引擎多帧几何与视觉验收。');
