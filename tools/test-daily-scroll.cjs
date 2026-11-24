const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const output = path.resolve(__dirname, '../temp');
const currencyUUIDs = Object.fromEntries(['coins', 'gems'].map(currency => {
  const key = currency === 'coins' ? 'coin-icon' : 'diamond-icon';
  const meta = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../assets/resources/art/header/' + key + '.png.meta'), 'utf8'));
  return [currency, meta.subMetas.f9941.uuid];
}));
const report = {
  fixtures: '各视口使用独立浏览器context；预设初始猫狗四项状态20、通用物资各10、空道具库存及未完成daily。六项完成和领奖全用page.mouse真实点击；冒险真实出发后仅将adventureEnd设为过期并保存，不等待60秒。逻辑测试独立列出，不冒充真实输入。',
  visual: '仅自动检查SpriteFrame、几何边界与截图；未进行人工视觉验收。',
  checks: [], errors: [],
};
const record = (name, data) => {
  report.checks.push({ name, data });
  fs.writeFileSync(path.join(output, 'daily-acceptance.json'), JSON.stringify(report, null, 2));
  console.log(name, JSON.stringify(data));
};

(async () => {
  const material = require('node:child_process').execFileSync('python', [path.resolve(__dirname, 'clean-daily-panel.py')], { encoding: 'utf8' });
  record('真实面板纹理及内框清除断言', JSON.parse(material));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [390, 430]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await context.newPage();
      page.on('pageerror', e => report.errors.push({ width, message: e.message }));
      let frame;
      const boot = async () => {
        await page.goto(process.env.DAILY_PREVIEW_URL || 'http://127.0.0.1:8084/index.html');
        await page.waitForFunction(() => !!document.querySelector('iframe') || !!window.cc?.director);
        const element = await page.locator('iframe').count() ? await page.locator('iframe').first().elementHandle() : null;
        frame = element ? await element.contentFrame() : page.mainFrame();
        assert(frame, '预览页面未创建');
        await frame.waitForFunction(() => window.cc?.director?.getScene()?.children.some(n => n.components.some(c => typeof c.claimDaily === 'function')));
        await frame.evaluate(async () => {
          window.main = cc.director.getScene().children.flatMap(n => n.components).find(c => typeof c.claimDaily === 'function');
          window.walk = n => [n, ...n.children.flatMap(walk)];
          window.dailyModule = await System.import('chunks:///_virtual/DailyTasks.ts');
        });
      };
      const state = () => frame.evaluate(() => JSON.parse(JSON.stringify(main.data)));
      const textTarget = (text, root = 'main.sheet') => `walk(${root}).find(n => n.activeInHierarchy && n.getComponent(cc.Label)?.string === ${JSON.stringify(text)})?.parent`;
      const row = id => `walk(main.sheet).find(n => n.name === '每日任务-${id}')`;
      const screenPoint = async expression => {
        await page.waitForTimeout(700);
        const point = await frame.evaluate(expression => {
          const node = eval(expression);
          if (!node?.activeInHierarchy) throw Error('点击目标不存在或不可见：' + expression);
          const v = new cc.Vec3(); main.uiCamera.worldToScreen(node.worldPosition, v);
          const canvas = document.querySelector('canvas'), r = canvas.getBoundingClientRect();
          return { x: r.x + v.x / canvas.width * r.width, y: r.y + (1 - v.y / canvas.height) * r.height, width: innerWidth, height: innerHeight };
        }, expression);
        const box = frame === page.mainFrame() ? { x: 0, y: 0, width, height: 844 } : await page.locator('iframe').first().boundingBox();
        assert(box, '预览页面不可见');
        const x = box.x + point.x * box.width / point.width, y = box.y + point.y * box.height / point.height;
        assert(x >= 0 && x <= width && y >= 0 && y <= 844, '真实点击坐标超出视口：' + expression);
        return { x, y };
      };
      const click = async expression => {
        const { x, y } = await screenPoint(expression);
        await page.mouse.click(x, y);
        await page.waitForTimeout(160);
      };
      const drag = async (expression, dy) => {
        const { x, y } = await screenPoint(expression);
        await page.mouse.move(x, y); await page.mouse.down();
        await page.mouse.move(x, y + dy, { steps: 20 }); await page.mouse.up();
        await page.waitForTimeout(250);
      };
      const openDaily = async () => {
        await click("walk(main.top).find(n => n.name === '加号-gems')");
        await click(textTarget('做任务', 'main.dialog'));
        assert.equal(await frame.evaluate(() => main.page), 'daily');
        assert.equal(await frame.evaluate(() => !!main.dialog), false, '做任务必须关闭钻石弹窗');
      };
      await boot();
      await frame.evaluate(() => {
        const s = JSON.parse(localStorage.getItem(main.key));
        s.coins = 5000; s.gems = 5000; s.xp = 0; s.food = s.soap = s.toy = 10; s.itemInventory = {}; s.adventureEnd = 0;
        s.pets.forEach(p => { p.hunger = p.clean = p.joy = p.energy = 20; });
        if (!s.pets.some(p => p.id === 0) || !s.pets.some(p => p.id === 1)) throw Error('测试需要初始猫0与狗1');
        s.daily = dailyModule.newDaily(s.shop.day);
        localStorage.setItem(main.key, JSON.stringify(s));
      });
      await boot();
      await frame.waitForFunction(() => walk(main.ui.getChildByName('每日任务入口')).some(n => n.getComponent(cc.Sprite)?.spriteFrame?.name === 'task'));
      await click("main.ui.getChildByName('每日任务入口')");
      assert.equal(await frame.evaluate(() => main.page), 'daily');
      await frame.waitForFunction(() => {
        const nodes = walk(main.sheet).filter(n => n.activeInHierarchy && (n.name === '每日任务底图' || n.name === '每日任务图标' || n.name === '每日礼包图标' || n.name === '奖励货币'));
        return nodes.length >= 14 && nodes.every(n => (n.getComponent(cc.Sprite) || n.children.find(c => c.getComponent(cc.Sprite))?.getComponent(cc.Sprite))?.spriteFrame?.texture);
      });
      const header = await frame.evaluate(currencyUUIDs => {
        const title = main.sheet.children.find(n => n.getComponent(cc.Label)?.string === '每日任务');
        const countdown = main.sheet.children.find(n => n.getComponent(cc.Label)?.string.includes('后刷新（UTC+8）'));
        const viewport = main.sheet.getChildByName('每日任务可视窗口');
        const first = main.dailyScroll.content.children[0];
        const bounds = n => n.getComponent('cc.UITransform').getBoundingBoxToWorld();
        const t = bounds(title), c = bounds(countdown), v = bounds(viewport), r = bounds(first);
        const violations = [];
        const scale = viewport.worldScale.y;
        const gaps = { titleToCountdown: (t.y - c.y - c.height) / scale,
          countdownToViewport: (c.y - v.y - v.height) / scale,
          viewportToFirst: (v.y + v.height - r.y - r.height) / scale,
          countdownToFirst: (c.y - r.y - r.height) / scale };
        if (gaps.titleToCountdown < 20 || gaps.countdownToViewport < 50 || gaps.countdownToFirst < 50 || gaps.viewportToFirst < -1) violations.push('头部与首行缺少明确间隔');
        if (title.position.y !== 400 || countdown.position.y !== 280 || main.sheet.getChildByName('收起').position.y !== 400) violations.push('独立头部坐标异常');
        const panelSprite = main.sheet.children.find(n => n.getComponent(cc.Sprite)?.spriteFrame?.name === 'panel-clean');
        if (!panelSprite) violations.push('未使用清除内框的正式素材');
        const sourceTitle = [(700 - title.position.y - 29) * 939 / 1024, (700 - title.position.y + 29) * 939 / 1024];
        if (sourceTitle[0] < 240 || sourceTitle[1] > 310) violations.push('标题越出真实原标题牌');
        if (walk(main.sheet).filter(n => n.getComponent(cc.Sprite)?.spriteFrame?.name === 'row').length !== 7) violations.push('独立行框数量异常');
        const currencies = main.dailyScroll.content.children.slice(0, 6).map((row, index) => {
          const currency = dailyModule.DAILY_TASKS[index].currency;
          const node = row.getChildByName('奖励货币'), sprite = node.getComponent(cc.Sprite), frame = sprite.spriteFrame;
          const size = node.getComponent('cc.UITransform');
          if (frame?._uuid !== currencyUUIDs[currency]) violations.push(row.name + '未复用既有header货币UUID');
          if (Math.abs(size.width / size.height - frame.originalSize.width / frame.originalSize.height) > 0.001) violations.push(row.name + '货币图标变形');
          return { row: row.name, currency, uuid: frame?._uuid, expected: currencyUUIDs[currency], width: size.width, height: size.height };
        });
        return { sourceTitle, panelFrame: panelSprite?.getComponent(cc.Sprite).spriteFrame.name, titleY: title.position.y, countdownY: countdown.position.y, viewport: { x: viewport.position.x, y: viewport.position.y, width: viewport.getComponent('cc.UITransform').width, height: viewport.getComponent('cc.UITransform').height }, gaps, currencies, violations };
      }, currencyUUIDs);
      record('独立头部间隔与既有货币UUID ' + width, header);
      assert.deepEqual(header.violations, []);
      assert.deepEqual(header.viewport, { x: -12, y: -149, width: 740, height: 660 });
      const geometry = await frame.evaluate(() => {
        const bounds = n => { const transform = n.getComponent('cc.UITransform'); if (!transform) return { x: n.worldPosition.x - main.width / 2, y: n.worldPosition.y - main.height / 2, w: main.width, h: main.height }; const r = transform.getBoundingBoxToWorld(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
        const inside = (a, b) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;
        const violations = [], panel = bounds(main.sheet), ui = bounds(main.ui), top = bounds(main.top), bottom = bounds(main.bottom);
        const overlap = (a,b) => Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>1 && Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>1;
        const rows = walk(main.sheet).filter(n => /^每日任务-(feedCat|feedDog|clean|play|rest|adventure)$/.test(n.name) || n.name === '每日免费照顾包');
        for (const n of rows) {
          const b = bounds(n); if (!inside(b, panel) || !inside(b, ui)) violations.push(n.name + '越出面板或画布');
          if (overlap(b,top) || overlap(b,bottom)) violations.push(n.name + '与顶部或底部重叠');
          for (const child of n.children.filter(c => c.activeInHierarchy && (c.getComponent('cc.UITransform')))) {
            if (!inside(bounds(child), b)) violations.push(n.name + '/' + child.name + '内容越界');
          }
        }
        for(const n of main.sheet.children.filter(n => n.activeInHierarchy && n.getComponent(cc.Label))) if(!inside(bounds(n),panel)) violations.push('面板文字越界：'+n.getComponent(cc.Label).string);
        const sprites = walk(main.sheet).filter(n => n.activeInHierarchy && n.getComponent(cc.Sprite)).map(n => ({ name: n.name, frame: n.getComponent(cc.Sprite).spriteFrame?.name || null }));
        return { panel, rows: rows.map(n => ({ name: n.name, bounds: bounds(n) })), sprites, violations };
      });
      record('布局与贴图 ' + width, geometry);
      assert.equal(geometry.rows.length, 7); assert.deepEqual(geometry.violations, []); assert(geometry.sprites.every(s => s.frame), '存在空SpriteFrame');
      const typography = await frame.evaluate(() => {
        const violations = [], labels = walk(main.sheet).filter(n => n.activeInHierarchy && n.getComponent(cc.Label));
        const details = labels.map(n => {
          const l = n.getComponent(cc.Label), t = n.getComponent('cc.UITransform');
          const r = t.getBoundingBoxToWorld();
          if (l.fontFamily !== 'Microsoft YaHei, SimHei, sans-serif' || !l.isBold || !l.enableOutline || l.outlineWidth !== 2 || l.color.toHEX('#rrggbb') !== '49301e' || l.outlineColor.toHEX('#rrggbb') !== 'fff3d5' || l.enableShadow || l.lineHeight !== l.fontSize + 6 || l.overflow !== cc.Label.Overflow.CLAMP) violations.push('字体配置异常：' + l.string);
          const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
          context.font = (l.isBold ? 'bold ' : '') + l.fontSize + 'px ' + l.fontFamily;
          if (context.measureText(l.string).width > t.width + 1) violations.push('文字宽度溢出：' + l.string);
          return { text: l.string, font: l.fontFamily, fontSize: l.fontSize, lineHeight: l.lineHeight, x: r.x, y: r.y, width: r.width, height: r.height };
        });
        const rows = walk(main.sheet).filter(n => n.name.startsWith('每日任务-') || n.name === '每日免费照顾包');
        for (const row of rows) {
          const children = row.children.filter(n => n.name !== '每日任务底图');
          for (const n of children) {
            const t = n.getComponent('cc.UITransform'), x = n.position.x, y = n.position.y;
            if (x-t.width/2 < -356.56-1 || x+t.width/2 > 357.52+1 || y-t.height/2 < -31.32-1 || y+t.height/2 > 41.88+1) violations.push('越出行浅色区：'+row.name+'/'+n.name);
          }
          for(let i=0;i<children.length;i++) for(let j=i+1;j<children.length;j++) {
            const a=children[i],b=children[j],ta=a.getComponent('cc.UITransform'),tb=b.getComponent('cc.UITransform');
            if(Math.abs(a.position.x-b.position.x)<(ta.width+tb.width)/2-1 && Math.abs(a.position.y-b.position.y)<(ta.height+tb.height)/2-1) violations.push('行列重叠：'+row.name+'/'+a.name+'/'+b.name);
          }
          const action=children.find(n=>['领取','前往'].includes(n.name) || n.getComponent(cc.Label)?.string==='已领取' || n.name==='免费领取');
          if(!action || action.position.x!==282) violations.push('操作列未对齐：'+row.name);
        }
        return { details, violations };
      });
      record('实际字体及浅色安全区 ' + width, typography);
      assert.deepEqual(typography.violations, []);
      await page.screenshot({ path: path.join(output, `daily-${width}.png`) });
      const initial = await frame.evaluate(() => {
        const viewport = walk(main.sheet).find(n => n.name === '每日任务可视窗口');
        const vt = viewport.getComponent('cc.UITransform');
        const low = vt.convertToWorldSpaceAR(new cc.Vec3(-370,-330,0));
        const high = vt.convertToWorldSpaceAR(new cc.Vec3(370,330,0));
        const v = {y:low.y,height:high.y-low.y};
        const rows = main.dailyScroll.content.children.map(n => ({name:n.name, r:n.getComponent('cc.UITransform').getBoundingBoxToWorld()}));
        return { height: viewport.getComponent('cc.UITransform').height, mask: viewport.getComponent(cc.Mask).type,
          visible: rows.filter(({r}) => r.y >= v.y && r.y+r.height <= v.y+v.height).map(n=>n.name),
          packHidden: rows[6].r.y+rows[6].r.height < v.y, offset: main.dailyScroll.getScrollOffset().y };
      });
      assert.equal(initial.height,660); assert.equal(initial.mask,0); assert.equal(initial.visible.length,6);
      assert(initial.packHidden); assert.equal(initial.offset,0);
      const packBefore = await state();
      await click(textTarget('免费领取'));
      assert.deepEqual((await state()).daily,packBefore.daily,'遮罩外礼包按钮竟可领取');
      await drag(textTarget('前往', row('rest')), -100);
      assert.equal(await frame.evaluate(()=>main.page),'daily','拖动前往按钮不应跳转');
      assert.deepEqual((await state()).daily,packBefore.daily,'拖动不得领奖');
      assert((await frame.evaluate(()=>main.dailyScroll.getScrollOffset().y))>100,'真实拖动未滚到礼包');
      const offset = await frame.evaluate(()=>main.dailyScroll.getScrollOffset().y);
      await drag(textTarget('免费领取'), -35);
      assert.equal((await state()).daily.packClaimed,false,'拖动礼包按钮不得领取');
      await click(textTarget('免费领取'));
      assert(Math.abs(await frame.evaluate(()=>main.dailyScroll.getScrollOffset().y)-offset)<1,'领奖重建丢失滚动位置');
      record('六行遮罩和真实按钮拖动 '+width,initial);
      await drag("walk(main.sheet).find(n=>n.name==='每日任务可视窗口')",100);
      assert.equal(await frame.evaluate(()=>main.dailyScroll.getScrollOffset().y),0);
      const packAfter = await state();
      assert.equal(packAfter.daily.packClaimed, true);
      for (const [key, amount] of Object.entries({ food: 2, soap: 1, toy: 1 })) assert.equal(packAfter[key], packBefore[key] + amount);
      assert.deepEqual(packAfter.daily.progress, packBefore.daily.progress, '礼包不能冒充照顾任务');
      record('真实入口及礼包 ' + width, { before: packBefore.daily, after: packAfter.daily });
      const tasks = await frame.evaluate(() => dailyModule.DAILY_TASKS);
      for (const task of tasks) {
        await click(textTarget('前往', row(task.id)));
        if (task.id === 'adventure') {
          assert.equal(await frame.evaluate(() => main.page), 'adventure');
          await click(textTarget('出发寻宝'));
          assert((await state()).adventureEnd > Date.now(), '冒险必须真实出发');
          await frame.evaluate(() => { main.data.adventureEnd = Date.now() - 1000; if (!main.persist()) throw Error('冒险过期fixture保存失败'); });
          await frame.waitForFunction(() => walk(main.sheet).some(n => n.getComponent(cc.Label)?.string === '领取本次奖励'));
          await click(textTarget('领取本次奖励'));
          assert.equal((await state()).adventureEnd, 0);
        } else if (task.id === 'rest') {
          assert.equal(await frame.evaluate(() => main.page), 'pet');
          await click("main.bottom.getChildByName('照顾-rest')");
        } else {
          assert.equal(await frame.evaluate(() => main.page), 'bag');
          const key = task.id.startsWith('feed') ? 'food' : task.id === 'clean' ? 'soap' : 'toy';
          if (task.id.startsWith('feed')) assert.equal(await frame.evaluate(() => main.selected), task.id === 'feedCat' ? 0 : 1);
          const before = await state();
          await click(textTarget('使用', `main.sheet.getChildByName('库存-${key}')`));
          assert.equal((await state())[key], before[key] - 1);
        }
        const completed = await state();
        assert.equal(completed.daily.progress[task.id], 1); assert.equal(completed.daily.claimed[task.id], false);
        await openDaily();
        const before = await state();
        await click(textTarget('领取', row(task.id)));
        const after = await state();
        assert.equal(after.daily.claimed[task.id], true); assert.equal(after[task.currency], before[task.currency] + task.amount);
        record('真实完成并手动领奖 ' + width + ' ' + task.id, { progress: after.daily.progress[task.id], reward: after[task.currency] - before[task.currency] });
      }
      const saved = await state(); await boot(); await click("main.ui.getChildByName('每日任务入口')");
      const loaded = await state(); assert.deepEqual(loaded.daily, saved.daily);
      for (const key of ['coins','gems','food','soap','toy','itemInventory']) assert.deepEqual(loaded[key], saved[key]);
      assert.equal(await frame.evaluate(() => walk(main.sheet).filter(n => n.getComponent(cc.Label)?.string === '已领取').length), 7);
      record('重载保留七项已领取 ' + width, loaded.daily);
      await page.screenshot({ path: path.join(output, `daily-claimed-${width}.png`) });

      // 以下全部为同步运行时逻辑测试，不属于真实鼠标输入覆盖。
      const logic = await frame.evaluate(() => {
        const clone = v => JSON.parse(JSON.stringify(v));
        const check = (condition, message) => { if (!condition) throw Error(message); };
        const equal = (a,b,message) => check(JSON.stringify(a)===JSON.stringify(b),message);
        const originalData = clone(main.data), originalNow = Date.now, originalSet = Storage.prototype.setItem;
        const originalRaw = localStorage.getItem(main.key), originalDirty = main.dirty;
        const results = [];
        const baseTime = originalNow();
        const fixture = (time = baseTime) => {
          Date.now = () => time;
          main.data = clone(originalData); main.data.shop = main.newShop(time);
          main.data.daily = dailyModule.newDaily(main.data.shop.day); main.data.food = main.data.soap = main.data.toy = 10;
          main.data.coins = main.data.gems = 5000; main.data.adventureEnd = 0;
          main.data.pets.forEach(p => { p.hunger = p.clean = p.joy = p.energy = 20; });
          const raw = JSON.stringify(main.data); originalSet.call(localStorage, main.key, raw);
          main.saveSnapshot = raw; main.saveSnapshotReady = true; main.dirty = false;
        };
        const rollback = (label, action) => {
          const before = clone(main.data), raw = localStorage.getItem(main.key), snapshot = main.saveSnapshot;
          Storage.prototype.setItem = function() { throw Error('每日验收注入保存失败'); };
          try { action(); equal(main.data,before,label+'内存未完整回滚'); equal(localStorage.getItem(main.key),raw,label+'存档改变'); equal(main.saveSnapshot,snapshot,label+'快照改变'); }
          finally { Storage.prototype.setItem = originalSet; }
          results.push(label);
        };
        try {
          fixture(); rollback('礼包保存失败完全回滚',()=>main.claimDaily('pack'));
          main.claimDaily('pack');check(main.data.daily.packClaimed&&main.data.food===12&&main.data.soap===11&&main.data.toy===11,'礼包失败后重试无法准确发一份');
          for(const task of dailyModule.DAILY_TASKS) {
            fixture(); main.data.daily.progress[task.id]=1;
            rollback(task.id+'领奖保存失败完全回滚',()=>main.claimDaily(task.id));
          }
          for(const key of ['food','soap','toy']) {
            fixture(); main.data[key]=100000000;
            const before=clone(main.data);main.claimDaily('pack');equal(main.data,before,'礼包'+key+'溢出不是全量拒绝');
          }
          results.push('礼包任一物资溢出全量拒绝');
          fixture(); main.claimDaily('pack'); const once=clone(main.data);main.claimDaily('pack');equal(main.data,once,'礼包重复领取');
          for(const task of dailyModule.DAILY_TASKS) {
            fixture();const before=clone(main.data);main.claimDaily(task.id);equal(main.data,before,'未完成竟可领奖'+task.id);
            main.data.daily.progress[task.id]=1;main.claimDaily(task.id);const claimed=clone(main.data);main.claimDaily(task.id);equal(main.data,claimed,'重复领奖'+task.id);
            fixture();main.data.daily.progress[task.id]=1;main.data[task.currency]=100000000;const full=clone(main.data);main.claimDaily(task.id);equal(main.data,full,'货币溢出'+task.id);
          }
          results.push('礼包及六任务重复领奖/未完成/上限保护');
          fixture(); main.selected=0;main.petSelected=true;
          for(const key of ['food','soap','toy','rest']) rollback('照顾'+key+'不消耗不记进度',()=>main.applyCare(key==='rest'?null:main.legacyItem(key),key));
          main.data.adventureEnd=Date.now()-1;rollback('冒险领奖不记进度不发奖',()=>main.adventureAction());
          // UTC+8午夜前后，失败的第一次跨日操作不能提前清空昨日权益。
          const day=main.shopDay(baseTime), midnight=(day+1)*86400000-8*3600000;
          fixture(midnight-1);main.data.daily=dailyModule.newDaily(day,true);Object.keys(main.data.daily.progress).forEach(k=>main.data.daily.progress[k]=1);
          main.persist(); Date.now=()=>midnight;
          rollback('跨日礼包保存失败保留完整昨日状态',()=>main.claimDaily('pack'));
          main.claimDaily('pack');check(main.data.daily.day===day+1,'午夜未刷新');check(main.data.daily.packClaimed,'新日礼包未入账');
          check(main.data.food===12&&main.data.soap===11&&main.data.toy===11,'跨日礼包数量错误');
          check(Object.values(main.data.daily.progress).every(v=>v===0)&&Object.values(main.data.daily.claimed).every(v=>v===false),'新日任务未清空');
          const future=clone(main.data);Date.now=()=>midnight-86400000*3;main.claimDaily('pack');equal(main.data,future,'回拨重复领礼包');
          const candidate=main.dailyCandidate();check(candidate.daily.day===day+1&&candidate.shop.day===day+1,'回拨降低日期高水位');
          Date.now=()=>midnight+86400000*4;main.tick();check(main.data.daily.day===day+5,'tick跨日失败');
          check(!main.data.daily.packClaimed&&Object.values(main.data.daily.progress).every(v=>v===0),'跳多日累计权益或未清空');
          check(main.data.food===12&&main.data.soap===11&&main.data.toy===11,'跨日自动发了礼包');
          main.claimDaily('pack');check(main.data.food===14,'跳多日礼包应只发一份');
          results.push('UTC+8午夜、跨日失败回滚、回拨高水位、tick多日仅刷新一次');
          fixture(midnight-1);main.data.daily.progress.feedCat=1;main.persist();Date.now=()=>midnight;
          const beforeMidnightClaim=main.data.coins;main.claimDaily('feedCat');check(main.data.coins===beforeMidnightClaim,'跨日错误领取昨日完成任务');
          main.selected=0;main.petSelected=true;
          rollback('跨日照顾失败同时保留旧日进度和库存',()=>main.applyCare(main.legacyItem('food'),'food'));
          main.applyCare(main.legacyItem('food'),'food');check(main.data.daily.day===day+1&&main.data.daily.progress.feedCat===1&&!main.data.daily.claimed.feedCat,'跨日照顾未记入新日');
          check(main.data.food===9,'跨日照顾消耗错误');main.claimDaily('feedCat');check(main.data.coins===beforeMidnightClaim+dailyModule.DAILY_TASKS.find(t=>t.id==='feedCat').amount,'跨日新任务奖励错误');
          results.push('昨日未领奖进度不可跨日领取，新日真实业务事务重新记进度');
          fixture();const external=JSON.stringify({...main.data,coins:4321});originalSet.call(localStorage,main.key,external);
          const conflict=clone(main.data);main.claimDaily('pack');equal(main.data,conflict,'快照冲突仍发礼包');equal(localStorage.getItem(main.key),external,'覆盖外部存档');
          results.push('存档快照冲突不覆盖不发礼包');
          return results;
        } finally {
          Date.now=originalNow;Storage.prototype.setItem=originalSet;
          originalSet.call(localStorage,main.key,originalRaw);main.data=originalData;main.saveSnapshot=originalRaw;main.saveSnapshotReady=true;main.dirty=originalDirty;
          main.renderHeader();main.open('daily');
        }
      });
      record('运行时逻辑测试（非真实输入） ' + width, logic);
      await context.close();
    }
    assert.deepEqual(report.errors, []); record('验收完成', { errors: report.errors });
  } finally { await browser.close(); }
})().catch(error => {
  report.failure = error.stack;
  fs.writeFileSync(path.join(output, 'daily-acceptance.json'), JSON.stringify(report, null, 2));
  console.error(error); process.exitCode = 1;
});
