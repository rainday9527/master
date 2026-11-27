// 执行真实适配器与 Main 奖励事务；不代表真机广告已播放。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('D:/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript/lib/typescript.js');
const modules = new Map(), timers = new Map();
let serial = 0, raw = null, failSave = false, now = Date.UTC(2026, 10, 27, 3);
class Clock extends Date { static now() { return now; } }
function load(name) {
    if (modules.has(name)) return modules.get(name);
    const exports = {}; modules.set(name, exports);
    const source = fs.readFileSync(path.join(__dirname, '../assets/scripts', name + '.ts'), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true } }).outputText;
    vm.runInNewContext(compiled, { exports, Date: Clock, console,
        setTimeout: cb => { timers.set(++serial, cb); return serial; }, clearTimeout: id => timers.delete(id),
        require: id => id === 'cc/env' ? { DEBUG: false } : id === 'cc' ? {
            _decorator: { ccclass: () => type => type }, Component: class {}, game: {}, isValid: () => true,
            sys: { localStorage: { getItem: () => raw, setItem: (_, v) => { if (failSave) throw Error('保存失败'); raw = v; } } }
        } : load(id.replace('./', '')) });
    return exports;
}
const { TapTapRewardedVideoProvider: Provider } = load('TapTapRewardedVideoProvider');
function sdk(options = {}) {
    const state = { creates: [], ads: [] };
    state.host = { innerWidth: 400, innerHeight: 800, tap: { createRewardedVideoAd: config => {
        state.creates.push(config);
        const callbacks = {}, ad = { callbacks, loads: 0, shows: 0, destroyed: 0,
            onLoad: cb => callbacks.load = cb, onError: cb => callbacks.error = cb, onClose: cb => callbacks.close = cb,
            load: () => { ad.loads++; return options.loadFail ? Promise.reject(Error()) : Promise.resolve(); },
            show: () => { ad.shows++; return options.showFail || (options.retry && ad.shows === 1) ? Promise.reject(Error()) : Promise.resolve(); },
            destroy: () => ad.destroyed++ };
        state.ads.push(ad); return ad;
    } } };
    return state;
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const { Main } = load('Main');
const { DAILY_TASKS, ACHIEVEMENTS } = load('DailyTasks');
function game() {
    raw = null; failSave = false;
    const g = new Main();
    for (const name of ['toast', 'renderHeader', 'showRewardGrantDialog', 'refreshTaskRedDots', 'syncActorVisibility', 'closeDialog', 'refreshMemorialEntry', 'updateDailyRows']) g[name] = () => {};
    g.data = g.load(); g.commitShop(g.data);
    g.actors = [{ pet: { id: 0 } }];
    const s = sdk(); g.setRewardedVideoProvider(new Provider(s.host));
    return { g, s };
}
function cases() {
    const list = [
        ['钻石', g => g.watchRewardedVideo('gems')], ['金币', g => g.watchRewardedVideo('coins')],
        ['签到', g => g.watchSignInRewardedVideo()],
        ['找回', g => g.recoverLostPet(0, 'ad'), g => { g.data.pets[0].lost = true; }],
        ['复活', g => g.revivePetByAd(0), g => { g.data.pets[0].dead = true; }]
    ];
    for (const t of DAILY_TASKS) list.push(['每日-' + t.id, g => g.watchDailyRewardedVideo(t.id), g => { g.data.daily.progress[t.id] = t.target; }]);
    for (const d of ACHIEVEMENTS) list.push(['成就-' + d.id, g => g.watchAchievementRewardedVideo(d.id), g => { g.data.achievements.counts[d.id] = 100000000; }]);
    for (const [module, key, method] of [['FurnitureCatalog', 'FURNITURE_CATALOG', 'unlockFurnitureByAd'], ['PetCatalog', 'PET_OUTFITS', 'unlockOutfitByAd'], ['PetCatalog', 'PET_COATS', 'unlockCoatByAd'], ['AdventureSystem', 'TOMBSTONE_CATALOG', 'unlockTombstoneByAd']]) {
        for (const d of load(module)[key].filter(d => d.unlockMode === 'ad')) list.push([method + '-' + d.id, g => g[method](d.id)]);
    }
    return list;
}
(async () => {
    for (const host of [{}, { tap: { createRewardedVideoAd: () => { throw Error('不可调用'); } } }]) {
        let result; new Provider(host).show(r => result = r); assert.equal(result, 'failed');
    }
    for (const [width, height, orientation, id] of [[800, 400, 'landscape', '1054323'], [400, 800, 'portrait', '1054324']]) {
        const s = sdk(); s.host.innerWidth = width; s.host.innerHeight = height;
        let result; const p = new Provider(s.host); p.show(r => result = r);
        assert.equal(s.creates[0].orientation, orientation); assert.equal(s.creates[0].adUnitId, id);
        s.ads[0].callbacks.load(); assert.equal(result, undefined);
        s.ads[0].callbacks.close({ isEnded: true }); assert.equal(result, 'completed');
    }
    { const s = sdk(); delete s.host.innerWidth; s.host.tap.getSystemInfoSync = () => ({ screenWidth: 800, screenHeight: 400 }); const p = new Provider(s.host); p.show(() => {}); assert.equal(s.creates[0].orientation, 'landscape'); p.destroy(); }
    for (const close of [undefined, {}, { isEnded: false }, { isEnded: 1 }]) {
        const s = sdk(); let result; new Provider(s.host).show(r => result = r); s.ads[0].callbacks.close(close); assert.equal(result, 'cancelled');
    }
    for (const options of [{ retry: true }, { showFail: true }, { showFail: true, loadFail: true }]) {
        const s = sdk(options); const result = []; const p = new Provider(s.host); p.show(r => result.push(r)); await flush();
        assert.equal(s.ads[0].shows, options.loadFail ? 1 : 2);
        if (options.retry) s.ads[0].callbacks.close({ isEnded: true });
        assert.deepEqual(result, [options.retry ? 'completed' : 'failed']); p.destroy();
    }
    { const s = sdk(); const p = new Provider(s.host), r = []; p.show(v => r.push(v)); p.show(v => r.push(v)); p.destroy(); s.ads[0].callbacks.close({ isEnded: true }); assert.deepEqual(r, ['failed', 'failed']); assert.equal(s.ads[0].destroyed, 1); }
    let count = 0;
    for (const [name, run, prepare = () => {}] of cases()) {
        for (const outcome of ['completed', 'cancelled', 'failed']) {
            const { g, s } = game(); prepare(g); const before = JSON.stringify(g.data);
            run(g); assert.equal(s.ads.length, 1, name + ' 必须调用真实适配器');
            run(g); assert.equal(s.ads.length, 1, name + ' 并发去重');
            const cb = s.ads[0].callbacks;
            if (outcome === 'failed') cb.error(); else cb.close({ isEnded: outcome === 'completed' });
            const after = JSON.stringify(g.data); cb.close({ isEnded: true }); assert.equal(JSON.stringify(g.data), after, name + ' 重复终态');
            if (outcome === 'completed') assert.notEqual(after, before, name + ' 发奖'); else assert.equal(after, before, name + ' 不发奖');
            count++;
        }
        const { g, s } = game(); prepare(g); const before = JSON.stringify(g.data); run(g); failSave = true;
        s.ads[0].callbacks.close({ isEnded: true }); failSave = false;
        assert.equal(JSON.stringify(g.data), before, name + ' 保存失败回滚');
    }
    for (const kind of ['recover', 'revive']) {
        const { g, s } = game(); const pet = g.data.pets[0]; pet[kind === 'recover' ? 'lost' : 'dead'] = true;
        if (kind === 'recover') g.recoverLostPet(0, 'ad'); else g.revivePetByAd(0);
        pet[kind === 'recover' ? 'lost' : 'dead'] = false; const before = JSON.stringify(g.data);
        s.ads[0].callbacks.close({ isEnded: true }); assert.equal(JSON.stringify(g.data), before);
    }
    { const { g, s } = game(); g.watchSignInRewardedVideo(); now += 86400000; const before = g.data.gems; s.ads[0].callbacks.close({ isEnded: true }); assert.equal(g.data.gems, before); }
    { const { g, s } = game(); const t = DAILY_TASKS[0]; g.data.daily.progress[t.id] = t.target; g.watchDailyRewardedVideo(t.id); now += 86400000; const before = g.data[t.currency]; s.ads[0].callbacks.close({ isEnded: true }); assert.equal(g.data[t.currency], before); }
    { const { g, s } = game(); g.watchRewardedVideo('gems'); const before = g.data.gems; g.setRewardedVideoProvider(null); s.ads[0].callbacks.close({ isEnded: true }); assert.equal(g.data.gems, before); assert.equal(g.rewardedVideoPending, false); }
    { const { g, s } = game(); g.watchRewardedVideo('gems'); const before = g.data.gems; for (const cb of [...timers.values()]) cb(); s.ads[0].callbacks.close({ isEnded: true }); assert.equal(g.data.gems, before); assert.equal(g.rewardedVideoPending, false); }
    for (const t of DAILY_TASKS) {
        const { g, s } = game(); g.data.daily.progress[t.id] = t.target;
        const before = g.data[t.currency]; g.watchDailyRewardedVideo(t.id); g.claimDaily(t.id);
        assert.equal(g.data[t.currency], before + t.amount);
        s.ads[0].callbacks.close({ isEnded: true }); assert.equal(g.data[t.currency], before + t.amount * 2);
    }
    for (const d of ACHIEVEMENTS) {
        const { g, s } = game(); g.data.achievements.counts[d.id] = 100000000;
        g.watchAchievementRewardedVideo(d.id); g.claimAchievement(d.id); const before = g.data.gems;
        s.ads[0].callbacks.close({ isEnded: true }); assert.equal(g.data.gems, before);
    }
    { const { g, s } = game(); g.watchRewardedVideo('gems'); const before = g.data.gems;
        g.setRewardedVideoProvider(null); g.rewardedVideoDestroyed = true;
        g.watchRewardedVideo('gems'); s.ads[0].callbacks.close({ isEnded: true }); assert.equal(g.data.gems, before); assert.equal(s.ads.length, 1); }
    assert.equal(timers.size, 0);
    console.log('通过：' + cases().length + ' 个广告入口 × 3 终态 = ' + count + '；保存回滚、重试、方向、并发、重复、跨日、状态变化、销毁/超时隔离通过');
})().catch(error => { console.error(error); process.exitCode = 1; });
