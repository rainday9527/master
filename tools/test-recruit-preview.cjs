const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const report = { visual: '仅真实鼠标点击、节点几何及资源断言；未目视验收', fixture: '独立浏览器存档设置20000钻、累计29次、已领10次；不是自然游玩所得', checks: [], errors: [] };
  try {
    for (const width of [390, 430]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      try {
      const page = await context.newPage();
      page.on('pageerror', e => report.errors.push(e.message));
      const failures = [];
      page.on('response', r => { if (r.status() >= 400) failures.push([r.status(), r.url()]); });
      const attach = async () => {
        await page.waitForFunction(() => window.cc?.director?.getScene()?.children.some(n => n.components.some(c => typeof c.recruitTransaction === 'function')));
        await page.evaluate(() => {
          window.main = cc.director.getScene().children.flatMap(n => n.components).find(c => typeof c.recruitTransaction === 'function');
          window.walk = n => [n, ...n.children.flatMap(walk)];
        });
      };
      await page.goto('http://127.0.0.1:8087/index.html'); await attach();
      // 仅 fixture 设置状态；所有招募、领奖、弹窗、返回均通过真实鼠标。
      await page.evaluate(() => {
        const s = main.fresh(); s.gems = 20000; s.recruit.total = 29; s.recruit.claimed = 10;
        cc.sys.localStorage.setItem(main.key, JSON.stringify(s));
      });
      await page.reload(); await attach();
      const click = async name => {
        const point = await page.evaluate(name => {
          const n = walk(main.ui).find(n => n.name === name && n.activeInHierarchy);
          if (!n) throw Error('缺少真实点击目标 ' + name);
          const v = new cc.Vec3(); main.uiCamera.worldToScreen(n.worldPosition, v);
          const canvas = document.querySelector('canvas'), r = canvas.getBoundingClientRect();
          return { x: r.x + v.x / canvas.width * r.width, y: r.y + (1 - v.y / canvas.height) * r.height };
        }, name);
        assert(point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= 844);
        await page.mouse.click(point.x, point.y);
      };
      const state = () => page.evaluate(() => ({ gems: main.data.gems, total: main.data.recruit.total, claimed: main.data.recruit.claimed,
        copies: Object.values(main.data.recruit.copies).reduce((a,b) => a+b, 0), pets: main.data.pets.length, actors: main.actors.length,
        recent: main.data.recruit.recent.length, ready: main.recruitBadge.active, progress: main.recruitProgress.string,
        saved: JSON.stringify(main.data.recruit) === JSON.stringify(JSON.parse(cc.sys.localStorage.getItem(main.key)).recruit),
        same: main.sheet === window.recruitSheet && walk(main.sheet).every((n,i) => n === window.recruitNodes[i]),
        nodes: walk(main.sheet).length })) ;
      await click('导航-recruit');
      await page.waitForFunction(() => main.page === 'recruit' && main.sheet?.name === '招募面板');
      assert(await page.evaluate(() => !!main.recruitBackground), '当前预览必须包含独立全屏招募背景，不能使用旧构建验收');
      await page.waitForFunction(() => walk(main.ui).filter(n => n.name.startsWith('招募素材-')).every(n => n.getComponent('cc.Sprite')?.spriteFrame));
      const backgroundLayout = () => page.evaluate(() => {
        const bg = main.recruitBackground, t = bg.getComponent('cc.UITransform'), s = bg.worldScale;
        return { count: walk(main.ui).filter(n => n.name === '招募素材-background').length,
          parent: bg.parent === main.ui, outsideSheet: !walk(main.sheet).includes(bg),
          left: bg.position.x - t.width * s.x / 2, right: bg.position.x + t.width * s.x / 2,
          bottom: bg.position.y - t.height * s.y / 2, top: bg.position.y + t.height * s.y / 2,
          ratio: t.width / t.height, width: main.width, height: main.height, scale: [bg.scale.x, bg.scale.y],
          loaded: !!bg.getComponent('cc.Sprite')?.spriteFrame, blocker: !!bg.getComponent('cc.BlockInputEvents'),
          layers: [main.top, main.bottom, main.sheet].every(n => n.activeInHierarchy && n.getSiblingIndex() > bg.getSiblingIndex()) };
      });
      const assertBackground = bg => {
        assert.equal(bg.count, 1); assert(bg.parent && bg.outsideSheet && bg.loaded && bg.layers && !bg.blocker);
        assert(bg.left <= -bg.width / 2 && bg.right >= bg.width / 2 && bg.bottom <= -bg.height / 2 && bg.top >= bg.height / 2, '背景 cover 铺满屏幕，无场景边缝');
        assert(Math.abs(bg.ratio - 1024 / 1536) < 1e-8); assert.deepEqual(bg.scale, [1, 1]);
      };
      const openingBackground = await backgroundLayout(); assertBackground(openingBackground);
      await page.waitForTimeout(350);
      const layout = await page.evaluate(() => {
        const sheet = main.sheet, t = sheet.getComponent('cc.UITransform'), s = sheet.worldScale;
        window.recruitSheet = sheet; window.recruitNodes = walk(sheet);
        const rect = { left: sheet.position.x - t.width * s.x / 2, right: sheet.position.x + t.width * s.x / 2, top: sheet.position.y + t.height * s.y / 2, bottom: sheet.position.y - t.height * s.y / 2 };
        return { rect, headerBottom: main.top.position.y - 70, navTop: main.bottom.position.y + 95,
          avatars: walk(sheet).filter(n => n.name.startsWith('伙伴头像-')).length,
          sprites: walk(sheet).filter(n => n.getComponent('cc.Sprite')?.spriteFrame).length,
          art: walk(main.ui).filter(n => n.name.startsWith('招募素材-') && n.getComponent('cc.Sprite')?.spriteFrame).map(n => n.name).sort(),
          obsolete: walk(sheet).filter(n => /定向|待配置/.test(n.name)).length,
          discount: walk(sheet).find(n => n.name === '十抽9折文字牌')?.getComponent('cc.Label')?.string,
          resultWrap: main.recruitResult.enableWrapText,
          zones: sheet.children.filter(n => n.name !== '招募素材-background').map(n => {
            const t = n.getComponent('cc.UITransform');
            return { name: n.name, left: n.position.x - t.width / 2, right: n.position.x + t.width / 2, top: n.position.y + t.height / 2, bottom: n.position.y - t.height / 2 };
          }),
          stock: main.recruitLabels.map(label => label.string),
          operations: walk(main.ui).filter(n => n.name === '操作卡片' && n.activeInHierarchy).length };
      });
      assert(layout.rect.top < layout.headerBottom && layout.rect.bottom > layout.navTop, '仅正文内容区域保留在货币栏与底部导航之间');
      const background = await backgroundLayout(); assertBackground(background);
      assert.deepEqual(background, openingBackground, '背景不参与正文开场缩放');
      await click('加号-gems');
      await page.waitForFunction(() => main.dialog && walk(main.dialog).some(n => n.getComponent('cc.Label')?.string === '获取钻石'));
      await click('弹窗按钮-做任务');
      await page.waitForFunction(() => main.page === 'daily' && main.recruitBackground === null);
      assert.equal(await page.evaluate(() => walk(main.ui).filter(n => n.name === '招募素材-background').length), 0, '离页立即移除背景');
      await click('导航-recruit'); await page.waitForTimeout(350);
      assertBackground(await backgroundLayout());
      await page.evaluate(() => { window.recruitSheet = main.sheet; window.recruitNodes = walk(main.sheet); });
      assert.equal(layout.avatars, 6); assert.equal(layout.operations, 0); assert.equal(layout.obsolete, 0);
      assert.equal(layout.discount, '9折'); assert.equal(layout.resultWrap, true);
      assert.deepEqual(layout.art, ['background','title','normal','search','preview','normal','advanced','reward','chest','badge'].map(key => '招募素材-' + key).sort(), '正式背景、标题、预览栏、按钮与奖励拆件逐个加载；头像为Graphics');
      assert.equal(layout.stock.length, 6); layout.stock.forEach(text => assert.match(text, /\n本体×\d+/));
      for (const zone of layout.zones) {
        assert(zone.left >= -500 && zone.right <= 500 && zone.top <= 710 && zone.bottom >= -710, zone.name + '超出面板');
        assert(zone.bottom >= 560 || zone.top <= -210, zone.name + '侵入主立绘留白区');
      }
      const zone = name => layout.zones.find(z => z.name === name);
      const preview = zone('招募素材-preview'), singleZone = zone('招募按钮-普通招募 · 300钻 / 1次'), tenZone = zone('招募按钮-高级招募 · 2700钻 / 10次');
      const resultZone = zone('招募最近结果'), rewardZone = zone('领取招募累计奖励');
      assert(preview.bottom - singleZone.top >= 15 && preview.bottom - tenZone.top >= 15);
      assert(tenZone.left - singleZone.right >= 20 && singleZone.top === tenZone.top);
      assert(singleZone.bottom - resultZone.top >= 10 && resultZone.bottom - rewardZone.top >= 10);
      assert.equal(resultZone.top - resultZone.bottom, 48, '最近结果限制为紧凑状态文本');
      await click('查看招募卡池');
      const poolText = await page.evaluate(() => walk(main.dialog).find(n => n.name === '弹窗正文').getComponent('cc.Label').string);
      for (const name of ['奶糖猫','布丁犬','云朵猫','芝麻犬','橘子猫','桃桃犬']) assert(poolText.includes(name));
      assert.match(poolText, /等权/); await click('弹窗按钮-知道了');
      const single = '招募按钮-普通招募 · 300钻 / 1次', ten = '招募按钮-高级招募 · 2700钻 / 10次';
      await click(single); const one = await state();
      assert.equal(one.gems, 19700); assert.equal(one.total, 30); assert.equal(one.copies, 3); assert(one.ready && one.same && one.saved); assert.equal(one.pets, one.actors);
      await click(ten); const rapid = await state(); assert.equal(rapid.gems, one.gems); assert.equal(rapid.total, one.total);
      assert.match(await page.evaluate(() => main.notice.string), /太快/);
      await page.waitForTimeout(650); await click(ten); const batch = await state();
      assert.equal(batch.gems, 17000); assert.equal(batch.total, 40); assert.equal(batch.copies, 13); assert.equal(batch.recent, 10); assert(batch.same && batch.saved); assert.equal(batch.pets, batch.actors);
      await page.waitForTimeout(650); await click('领取招募累计奖励'); const reward = await state();
      assert.equal(reward.claimed, 30); assert.equal(reward.total, 40); assert.equal(reward.copies, 14); assert.equal(reward.gems, 17000); assert(!reward.ready && reward.same && reward.saved); assert.match(reward.progress, /50/);
      await page.waitForTimeout(650); await click('领取招募累计奖励'); assert.deepEqual(await state(), reward);
      await page.screenshot({ path: `temp/recruit-${width}.png` });
      const assertClean = async () => {
        assert(await page.evaluate(() => main.recruitBackground === null && walk(main.ui).every(n => n.name !== '招募素材-background') && main.recruitLabels.length === 0 && main.recruitProgress === null && main.recruitBadge === null && main.recruitResult === null), '离页背景与招募引用清理');
      };
      await click('导航-home'); await page.waitForFunction(() => main.page === 'home' && main.sheet === null); await assertClean();
      for (let i = 0; i < 3; i++) {
        await click('导航-recruit');
        await page.waitForFunction(() => main.recruitBackground?.getComponent('cc.Sprite')?.spriteFrame);
        assertBackground(await backgroundLayout());
        await click('招募返回'); await page.waitForFunction(() => main.page === 'home' && main.sheet === null); await assertClean();
      }
      await page.reload(); await attach(); await click('导航-recruit'); await page.waitForTimeout(350);
      assert.equal((await state()).claimed, 30); assert.equal((await state()).copies, 14);
      // 单独的缺钻 fixture，不把直接改数伪装成自然游玩。
      await page.evaluate(() => { const s = JSON.parse(cc.sys.localStorage.getItem(main.key)); s.gems = 0; cc.sys.localStorage.setItem(main.key, JSON.stringify(s)); });
      await page.reload(); await attach(); await click('导航-recruit'); await page.waitForTimeout(350); await click(single);
      assert.equal(await page.evaluate(() => walk(main.dialog).find(n => n.name === '弹窗独立标题').getComponent('cc.Label').string), '获取钻石');
      assert.equal((await state()).total, 40);
      await page.evaluate(() => { window.destroyedRecruitBackground = main.recruitBackground; main.destroy(); });
      await page.waitForFunction(() => !cc.isValid(window.destroyedRecruitBackground, true) && main.recruitBackground === null);
      assert.deepEqual(failures, []);
      report.checks.push({ width, layout, background, headerClickable: true, navClickable: true, reopenCleanup: true, one, batch, reward, persisted: true, insufficientDialog: true, httpFailures: failures });
      } catch (error) {
        report.errors.push(`${width}×844：${error.message}`);
      } finally { await context.close(); }
    }
    assert.deepEqual(report.errors, []);
  } catch (error) { report.errors.push(error.message); throw error;
  } finally { fs.writeFileSync('temp/recruit-acceptance.json', JSON.stringify(report, null, 2)); await browser.close(); }
  console.log(JSON.stringify(report, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
