const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const report = { visual: '仅真实鼠标点击、节点几何及资源断言；未目视验收', checks: [], errors: [] };
  try {
    for (const width of [390, 430]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await context.newPage();
      page.on('pageerror', e => report.errors.push(e.message));
      const failures = [];
      page.on('response', r => { if (r.status() >= 400) failures.push([r.status(), r.url()]); });
      await page.goto('http://127.0.0.1:8087/index.html');
      await page.waitForFunction(() => !!window.cc?.director);
      await page.waitForFunction(() => cc.director.getScene()?.children.some(n => n.components.some(c => typeof c.updateRecruit === 'function')));
      await page.evaluate(() => {
        window.main = cc.director.getScene().children.flatMap(n => n.components).find(c => typeof c.updateRecruit === 'function');
        window.walk = n => [n, ...n.children.flatMap(walk)];
      });
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
      await click('导航-recruit');
      await page.waitForFunction(() => main.page === 'recruit' && main.sheet?.name === '招募面板');
      await page.waitForFunction(() => walk(main.sheet).filter(n => n.name.startsWith('招募素材-') && n.activeInHierarchy).every(n => n.getComponent('cc.Sprite')?.spriteFrame));
      await page.waitForTimeout(350);
      const layout = await page.evaluate(() => {
        const sheet = main.sheet, t = sheet.getComponent('cc.UITransform'), s = sheet.worldScale;
        window.recruitSheet = sheet;
        window.recruitNodes = walk(sheet);
        const rect = { left: sheet.position.x - t.width * s.x / 2, right: sheet.position.x + t.width * s.x / 2, top: sheet.position.y + t.height * s.y / 2, bottom: sheet.position.y - t.height * s.y / 2 };
        const headerBottom = main.top.position.y - 70, navTop = main.bottom.position.y + 95;
        return { rect, headerBottom, navTop, avatars: walk(sheet).filter(n => n.name.startsWith('伙伴头像-')).length, sprites: walk(sheet).filter(n => n.getComponent('cc.Sprite')?.spriteFrame).length, operations: walk(main.ui).filter(n => n.name === '操作卡片' && n.activeInHierarchy).length, costs: main.recruitLabels.map(l => l.string), nodes: walk(sheet).length };
      });
      assert(layout.rect.top < layout.headerBottom && layout.rect.bottom > layout.navTop, '招募背景侵入header或导航');
      assert.equal(layout.avatars, 8);
      assert.equal(layout.operations, 0);
      assert(layout.sprites >= 20, '正式招募底板、按钮、图标均应加载');
      await click('招募按钮-普通招募 · 待配置');
      assert.match(await page.evaluate(() => main.notice.string), /待配置/);
      await page.evaluate(() => {
        window.beforeRecruit = { gems: main.data.gems, count: main.data.pets.length, owned: main.data.pets.some(p => p.id === 2) };
      });
      await click('定向迎接-2');
      const update = await page.evaluate(() => ({
        before: beforeRecruit, gems: main.data.gems, count: main.data.pets.length,
        same: main.sheet === recruitSheet && walk(main.sheet).every((n,i) => n === recruitNodes[i]),
        label: main.recruitLabels[0].string,
      }));
      assert(update.same, '数据更新重建招募节点');
      if (!update.before.owned && update.before.gems >= 35) {
        assert.equal(update.gems, update.before.gems - 35);
        assert.equal(update.count, update.before.count + 1);
        assert.equal(update.label, '已经在家');
        await click('定向迎接-2');
        assert.equal(await page.evaluate(() => main.data.gems), update.gems);
      }
      await page.screenshot({ path: `temp/recruit-${width}.png` });
      await click('招募返回');
      await page.waitForFunction(() => main.page === 'home' && main.sheet === null);
      assert.deepEqual(failures, []);
      report.checks.push({ width, layout, update, returnedHome: true, httpFailures: failures });
      await context.close();
    }
    assert.deepEqual(report.errors, []);
  } catch (error) {
    report.errors.push(error.message);
    throw error;
  } finally {
    fs.writeFileSync('temp/recruit-acceptance.json', JSON.stringify(report, null, 2));
    await browser.close();
  }
  console.log(JSON.stringify(report, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
