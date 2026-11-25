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
      const pointFor = async name => {
        const point = await page.evaluate(name => {
          const n = walk(main.ui).find(n => n.name === name && n.activeInHierarchy);
          if (!n) throw Error('缺少真实点击目标 ' + name);
          const v = new cc.Vec3(); main.uiCamera.worldToScreen(n.worldPosition, v);
          const canvas = document.querySelector('canvas'), r = canvas.getBoundingClientRect();
          return { x: r.x + v.x / canvas.width * r.width, y: r.y + (1 - v.y / canvas.height) * r.height };
        }, name);
        assert(point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= 844);
        return point;
      };
      const click = async name => { const p = await pointFor(name); await page.mouse.click(p.x, p.y); };
      const pressChecks = [];
      const pressClick = async name => {
        const read = () => page.evaluate(name => {
          const n = walk(main.sheet).find(n => n.name === name), t = n.getComponent('cc.UITransform');
          const geometry = v => {
            const t = v.getComponent('cc.UITransform'), p = v.position, s = v.scale;
            return [p.x, p.y, p.z, s.x, s.y, s.z, t.width, t.height];
          };
          return { root: geometry(n), world: [n.worldPosition.x, n.worldPosition.y, n.worldScale.x, n.worldScale.y],
            // Cocos getBoundingBoxToWorld包含子显示层，反馈时其包围盒可变化；热区以根UITransform尺寸及worldScale为准。
            bounds: [n.worldPosition.x, n.worldPosition.y, t.width * n.worldScale.x, t.height * n.worldScale.y],
            art: geometry(n.children.find(v => v.getComponent('cc.Sprite'))), visuals: n.children.map(v => ({ name:v.name, geometry:geometry(v) })), total: main.data.recruit.total, claimed: main.data.recruit.claimed };
        }, name);
        const before = await read(), p = await pointFor(name);
        await page.mouse.move(p.x, p.y); await page.mouse.down();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const down = await read();
        assert.deepEqual(down.root, before.root, name + '按下时根热区几何不变');
        assert.deepEqual(down.world, before.world); assert.deepEqual(down.bounds, before.bounds);
        assert.equal(down.total, before.total); assert.equal(down.claimed, before.claimed, '仅按下不能触发业务');
        assert(Math.abs(down.art[3] - before.art[3] * 0.94) < 1e-6 && Math.abs(down.art[4] - before.art[4] * 0.94) < 1e-6, name + '真实按下必须缩放显示层');
        down.visuals.forEach((v, i) => {
          assert.equal(v.name, before.visuals[i].name);
          assert(Math.abs(v.geometry[3] - before.visuals[i].geometry[3] * 0.94) < 1e-6, name + '所有文字、钻石及美术一同反馈：' + v.name);
        });
        await page.mouse.up();
        const up = await read();
        assert.deepEqual(up.visuals, before.visuals, '全部视觉子节点松开后恢复');
        assert.deepEqual(up.root, before.root); assert.deepEqual(up.world, before.world); assert.deepEqual(up.bounds, before.bounds);
        assert.deepEqual(up.art, before.art, name + '松开后显示层恢复');
        pressChecks.push({ name, before, down, up });
      };
      const assertStable30 = async () => {
        const result = await page.evaluate(() => new Promise(resolve => {
          let frames = 0;
          const check = () => {
            const nodes = walk(main.sheet);
            const refs = [main.sheet, main.recruitBackground, ...main.recruitLabels, main.recruitProgress, main.recruitBadge, main.recruitResult];
            const same = main.sheet === window.recruitSheet && nodes.length === window.recruitNodes.length && nodes.every((n, i) => n === window.recruitNodes[i]) && refs.length === window.recruitRefs.length && refs.every((r, i) => r === window.recruitRefs[i]);
            const geometry = JSON.stringify(nodes.map(window.recruitGeometry));
            if (!same || geometry !== window.recruitGeometryBaseline) { cc.director.off(cc.Director.EVENT_AFTER_UPDATE, check); resolve({ frames, same, geometry: geometry === window.recruitGeometryBaseline }); return; }
            if (++frames === 30) { cc.director.off(cc.Director.EVENT_AFTER_UPDATE, check); resolve({ frames, same, geometry: true }); }
          };
          cc.director.on(cc.Director.EVENT_AFTER_UPDATE, check);
        }));
        assert.deepEqual(result, { frames: 30, same: true, geometry: true }, '操作后连续30帧保持节点、组件引用及全部正文几何');
      };
      const state = () => page.evaluate(() => ({ gems: main.data.gems, total: main.data.recruit.total, claimed: main.data.recruit.claimed,
        copies: Object.values(main.data.recruit.copies).reduce((a,b) => a+b, 0), pets: main.data.pets.length, actors: main.actors.length,
        recent: main.data.recruit.recent.length, ready: main.recruitBadge.active, progress: main.recruitProgress.string,
        fill: main.sheet.getChildByName('领取招募累计奖励').getChildByName('招募累计进度填充').getComponent('cc.Sprite').fillRange,
        saved: JSON.stringify(main.data.recruit) === JSON.stringify(JSON.parse(cc.sys.localStorage.getItem(main.key)).recruit),
        same: main.sheet === window.recruitSheet && walk(main.sheet).length === window.recruitNodes.length && walk(main.sheet).every((n,i) => n === window.recruitNodes[i]),
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
        assert(bg.left <= -bg.width / 2 + 1e-4 && bg.right >= bg.width / 2 - 1e-4 && bg.bottom <= -bg.height / 2 + 1e-4 && bg.top >= bg.height / 2 - 1e-4, '背景 cover 铺满屏幕，无场景边缝');
        assert(Math.abs(bg.ratio - 1080 / 1920) < 1e-8); assert.deepEqual(bg.scale, [1, 1]);
      };
      const openingBackground = await backgroundLayout(); assertBackground(openingBackground);
      await page.waitForTimeout(350);
      const proportions = await page.evaluate(() => walk(main.sheet).filter(n => n.name.startsWith('招募素材-')).map(n => {
        const sprite = n.getComponent('cc.Sprite'), t = n.getComponent('cc.UITransform'), size = sprite.spriteFrame.originalSize;
        const parent = n.parent.getComponent('cc.UITransform');
        return { name: n.name, ratio: t.width/t.height, original: size.width/size.height, width: t.width, height: t.height,
          inside: Math.abs(n.position.x) + t.width / 2 <= parent.width / 2 + 1e-6 && Math.abs(n.position.y) + t.height / 2 <= parent.height / 2 + 1e-6 };
      }));
      proportions.forEach(p => {
        assert(Math.abs(p.ratio-p.original)<1e-6, p.name+'必须按原始frame等比显示');
        if (['招募素材-normal','招募素材-advanced'].includes(p.name)) assert(p.inside, p.name+'素材必须位于固定热区内');
      });
      const innerRegions = await page.evaluate(() => {
        const rect = n => { const t = n.getComponent('cc.UITransform'); return { left:n.position.x-t.width/2,right:n.position.x+t.width/2,bottom:n.position.y-t.height/2,top:n.position.y+t.height/2 }; };
        return ['招募大标题','招募标题描述'].map(name => ({ name, ...rect(main.sheet.getChildByName(name)) }));
      });
      const titleRegions = [ {left:-380,right:20,bottom:582,top:660}, {left:-351,right:-1,bottom:516.5,top:545.5} ];
      innerRegions.forEach((r,i) => { const inner=titleRegions[i]; assert(r.left>=inner.left && r.right<=inner.right && r.bottom>=inner.bottom && r.top<=inner.top, r.name+'必须位于源图映射的真实内区'); });
      const progressGeometry = await page.evaluate(() => {
        const reward = main.sheet.getChildByName('领取招募累计奖励');
        return ['招募累计进度槽','招募累计进度填充'].map(name => {
          const n = reward.getChildByName(name), t = n.getComponent('cc.UITransform'); return { width:t.width,height:t.height };
        });
      });
      assert(Math.abs(progressGeometry[0].width/progressGeometry[0].height - 588/120)<1e-6, '新独立进度槽保持原比例');
      assert.deepEqual(progressGeometry[1], { width: 214, height: 23.6 }, '填充严格适配新槽真实内区，不照搬外框尺寸');
      const spacing = await page.evaluate(() => {
        const preview = main.sheet.getChildByName('招募预览横栏');
        const title = preview.getChildByName('宠物预览标题');
        const details = preview.getChildByName('查看招募卡池');
        const reward = main.sheet.getChildByName('领取招募累计奖励');
        const rect = n => { const t = n.getComponent('cc.UITransform'); return { left:n.position.x-t.width/2, right:n.position.x+t.width/2, bottom:n.position.y-t.height/2, top:n.position.y+t.height/2 }; };
        const plate = (parent, label) => {
          const n = parent.getChildByName('主城素材-label0'), s = n.getComponent('cc.Sprite');
          return { bounds: rect(n), text: rect(label), loaded: !!s.spriteFrame, sliced: s.type === cc.Sprite.Type.SLICED,
            insets: [s.spriteFrame.insetLeft, s.spriteFrame.insetRight, s.spriteFrame.insetTop, s.spriteFrame.insetBottom] };
        };
        const avatars = preview.children.filter(n => n.name.startsWith('招募本体-')).map(card => {
          const avatar = card.children.find(n => n.name.startsWith('伙伴头像-'));
          return card.position.y + rect(avatar).top;
        });
        return { text: title.getComponent('cc.Label').string, title: rect(title), avatars,
          detailBounds: rect(details), details: plate(details, details.children.find(n => n.getComponent('cc.Label'))),
          reward: plate(reward, reward.getChildByName('招募奖励标题')), chest: rect(reward.getChildByName('招募素材-chest')),
          hint: rect(reward.getChildByName('招募奖励说明')) };
      });
      assert.equal(spacing.text, '宠物预览');
      spacing.avatars.forEach(top => assert(spacing.title.bottom - top >= 24 && spacing.detailBounds.bottom - top >= 8, '标题行与保留的临时头像拉开间距'));
      for (const plate of [spacing.details, spacing.reward]) {
        assert(plate.loaded && plate.sliced, '必须加载真实九宫格底板，不能只扩大热区');
        assert.deepEqual(plate.insets, [40, 40, 30, 30]);
        assert(plate.text.left >= plate.bounds.left + 14 && plate.text.right <= plate.bounds.right - 14 && plate.text.bottom >= plate.bounds.bottom + 9 && plate.text.top <= plate.bounds.top - 9, '文字完整落在扣除透明边缘后的真实底板内区');
      }
      assert(spacing.reward.bounds.right <= 150 && spacing.reward.bounds.left - spacing.chest.right >= 6, '奖励底板不超右侧并与礼物留空');
      assert(spacing.reward.bounds.bottom - spacing.hint.top >= 3, '奖励底板不挤说明');
      assert(spacing.title.top <= 138 && spacing.detailBounds.top <= 138, '上移后的标题行仍处于预览底板内');
      const layout = await page.evaluate(() => {
        const sheet = main.sheet, t = sheet.getComponent('cc.UITransform'), s = sheet.worldScale;
        window.recruitSheet = sheet; window.recruitNodes = walk(sheet);
        const rect = { left: sheet.position.x - t.width * s.x / 2, right: sheet.position.x + t.width * s.x / 2, top: sheet.position.y + t.height * s.y / 2, bottom: sheet.position.y - t.height * s.y / 2 };
        const localRect = n => {
          const t = n.getComponent('cc.UITransform');
          return { name: n.name, text: n.getComponent('cc.Label')?.string, left: n.position.x - t.width / 2, right: n.position.x + t.width / 2, top: n.position.y + t.height / 2, bottom: n.position.y - t.height / 2 };
        };
        return { rect, size: [t.width, t.height], headerBottom: main.top.position.y - 70, navTop: main.bottom.position.y + 95,
          detailsParent: walk(sheet).find(n => n.name === '查看招募卡池')?.parent.name,
          details: localRect(walk(sheet).find(n => n.name === '查看招募卡池')),
          buttons: sheet.children.filter(n => n.name.startsWith('招募按钮-')).map(n => ({ name: n.name, width: n.getComponent('cc.UITransform').width, height: n.getComponent('cc.UITransform').height,
            labels: n.children.filter(v => v.getComponent('cc.Label')).map(localRect), diamond: localRect(n.getChildByName('招募价格钻石')) })),
          removedBack: !walk(sheet).some(n => n.name === '招募返回'),
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
      await page.evaluate(() => {
        window.recruitSheet = main.sheet; window.recruitNodes = walk(main.sheet);
        window.recruitRefs = [main.sheet, main.recruitBackground, ...main.recruitLabels, main.recruitProgress, main.recruitBadge, main.recruitResult];
        window.recruitGeometry = n => {
          const t = n.getComponent('cc.UITransform'), p = n.position, s = n.scale;
          return [n.name, p.x, p.y, p.z, s.x, s.y, s.z, t.width, t.height, t.anchorX, t.anchorY];
        };
        window.recruitGeometryBaseline = JSON.stringify(window.recruitNodes.map(window.recruitGeometry));
      });
      assert.equal(layout.avatars, 6); assert.equal(layout.operations, 0); assert.equal(layout.obsolete, 0);
      assert.equal(layout.discount, '9折'); assert.equal(layout.resultWrap, true);
      assert.deepEqual(layout.art, ['background','title','description','chest','badge','normal','advanced','search','discount'].map(key => '招募素材-' + key).sort(), '新招募素材逐个加载且无旧布局拆件；头像为Graphics');
      assert.deepEqual(layout.size, [1000, 1560]); assert(layout.removedBack, '招募页只使用底部导航返回');
      assert.equal(layout.detailsParent, '招募预览横栏');
      assert(layout.details.left >= -470 && layout.details.right <= 470 && layout.details.bottom >= -138 && layout.details.top <= 138, '详情热区嵌在预览横栏内');
      const separated = (a, b) => a.right <= b.left || b.right <= a.left || a.top <= b.bottom || b.top <= a.bottom;
      for (const button of layout.buttons) {
        const expected = button.name.includes('普通') ? ['×300', '招募1次', '随机获得伙伴本体'] : ['×2700', '招募10次', '随机获得伙伴本体', '9折'];
        assert.deepEqual(button.labels.map(l => l.text), expected, '价格、招募标题、说明与折扣必须完整');
        const foot = button.labels.find(l => l.text === '随机获得伙伴本体');
        const footY = button.name.includes('普通') ? -53 : -57;
        assert(foot.left >= -145 && foot.right <= 145 && foot.bottom >= footY-15 && foot.top <= footY+15, button.name+'脚注必须完全位于素材真实深色槽内');
        const contents = [...button.labels, button.diamond];
        for (const item of contents) assert(item.left >= -button.width / 2 && item.right <= button.width / 2 && item.bottom >= -button.height / 2 && item.top <= button.height / 2, button.name + '内容超出固定热区：' + (item.text || item.name));
        for (let i = 0; i < contents.length; i++) for (let j = i + 1; j < contents.length; j++) assert(separated(contents[i], contents[j]), button.name + '价格、标题、说明、折扣和钻石不得相互叠压');
      }
      assert.equal(layout.buttons.length, 2);
      assert.equal(layout.stock.length, 6); layout.stock.forEach(text => assert.match(text, /\n本体×\d+/));
      for (const zone of layout.zones) {
        assert(zone.left >= -500 && zone.right <= 500 && zone.top <= 780 && zone.bottom >= -780, zone.name + '超出1560高正文面板');
        assert(zone.bottom >= 480 || zone.top <= -210, zone.name + '侵入主立绘留白区');
      }
      const zone = name => layout.zones.find(z => z.name === name);
      const preview = zone('招募预览横栏'), singleZone = zone('招募按钮-普通招募 · 300钻 / 1次'), tenZone = zone('招募按钮-高级招募 · 2700钻 / 10次');
      const resultZone = zone('招募最近结果'), rewardZone = zone('领取招募累计奖励');
      assert(singleZone.bottom > preview.top && tenZone.bottom > preview.top, '按钮在预览横栏之前，底边必须高于预览顶边');
      assert(tenZone.left - singleZone.right >= 20 && singleZone.top === tenZone.top);
      assert(preview.bottom - resultZone.top >= 8, '最近结果在预览下方且不叠压');
      assert(rewardZone.left > 0 && rewardZone.bottom > 0, '累计奖励位于正文右上');
      for (const name of ['招募素材-title', '招募大标题', '招募标题描述']) assert(zone(name).right < rewardZone.left && separated(zone(name), rewardZone), '左侧标题与右上奖励不得相交');
      assert.equal(resultZone.top - resultZone.bottom, 32, '最近结果限制为32高紧凑状态文本');
      await pressClick('查看招募卡池');
      const poolText = await page.evaluate(() => walk(main.dialog).find(n => n.name === '弹窗正文').getComponent('cc.Label').string);
      for (const name of ['奶糖猫','布丁犬','云朵猫','芝麻犬','橘子猫','桃桃犬']) assert(poolText.includes(name));
      assert.match(poolText, /等权/); await click('弹窗按钮-知道了'); await assertStable30();
      const rewardLayout = await page.evaluate(() => {
        const reward = main.sheet.getChildByName('领取招募累计奖励');
        const title = reward.getChildByName('招募奖励标题');
        const plate = reward.children.find(n => n.name.includes('label0'));
        const preview = main.sheet.getChildByName('招募预览横栏');
        return { title: title?.getComponent('cc.Label')?.string, plate: !!plate,
          flat: !!preview.getChildByName('招募预览半透明底板')?.getComponent('cc.Graphics'),
          noWood: !preview.getChildByName('招募素材-reward') };
      });
      assert.deepEqual(rewardLayout, { title: '招募奖励', plate: true, flat: true, noWood: true });
      await pressClick('查看累计招募奖励');
      const rewardsText = () => page.evaluate(() => walk(main.dialog).filter(n => n.getComponent('cc.Label')).map(n => n.getComponent('cc.Label').string).join('\n'));
      assert.match(await rewardsText(), /当前累计招募 29 次/);
      assert.match(await rewardsText(), /10次 · 已领/);
      for (const target of [30,50,100,200,300]) assert((await rewardsText()).includes(target+'次 · 未完成'));
      assert.equal((await state()).claimed, 10, '搜索不能冒泡触发领取');
      await page.waitForTimeout(400);
      await page.screenshot({ path: `temp/recruit-rewards-before-${width}.png` });
      await click('弹窗按钮-关闭'); await assertStable30();
      const single = '招募按钮-普通招募 · 300钻 / 1次', ten = '招募按钮-高级招募 · 2700钻 / 10次';
      await pressClick(single); const one = await state();
      assert.equal(one.gems, 19700); assert.equal(one.total, 30); assert.equal(one.copies, 3); assert(one.ready && one.same && one.saved); assert.equal(one.pets, one.actors); assert.equal(one.fill, 1);
      await click(ten); const rapid = await state(); assert.equal(rapid.gems, one.gems); assert.equal(rapid.total, one.total);
      assert.match(await page.evaluate(() => main.notice.string), /太快/); await assertStable30();
      await page.waitForTimeout(650); await pressClick(ten); const batch = await state();
      assert.equal(batch.gems, 17000); assert.equal(batch.total, 40); assert.equal(batch.copies, 13); assert.equal(batch.recent, 10); assert(batch.same && batch.saved); assert.equal(batch.pets, batch.actors); await assertStable30();
      await page.waitForTimeout(650); await pressClick('查看累计招募奖励');
      assert.match(await rewardsText(), /30次 · 可领/);
      assert.equal((await state()).claimed, 10, '可领取时搜索也不能触发领取');
      await page.waitForTimeout(400);
      await page.screenshot({ path: `temp/recruit-rewards-ready-${width}.png` });
      const dialogBeforeClaim = await page.evaluate(() => { window.rewardDialog = main.dialog; return walk(main.dialog).length; });
      await click('弹窗按钮-领取奖励'); const reward = await state();
      assert(await page.evaluate(() => main.dialog === window.rewardDialog), '领取后弹窗原位保留');
      assert.equal(await page.evaluate(() => walk(main.dialog).length), dialogBeforeClaim);
      assert.match(await rewardsText(), /30次 · 已领/);
      assert.match(await rewardsText(), /50次 · 未完成/);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `temp/recruit-rewards-claimed-${width}.png` });
      await click('弹窗按钮-关闭');
      assert.equal(reward.claimed, 30); assert.equal(reward.total, 40); assert.equal(reward.copies, 14); assert.equal(reward.gems, 17000); assert(!reward.ready && reward.same && reward.saved); assert.match(reward.progress, /50/); assert(Math.abs(reward.fill - 0.8) < 1e-6, '领奖后进度填充必须原位刷新到40/50');
      await assertStable30();
      await page.waitForTimeout(650); await click('领取招募累计奖励'); assert.deepEqual(await state(), reward); await assertStable30();
      await page.waitForTimeout(4800); // 等待操作提示消失，截图不得遮挡正文。
      await page.screenshot({ path: `temp/recruit-preview-panel-${width}.png` });
      await page.screenshot({ path: `temp/recruit-spacing-${width}.png` });
      const assertClean = async () => {
        assert(await page.evaluate(() => main.recruitBackground === null && walk(main.ui).every(n => n.name !== '招募素材-background') && main.recruitLabels.length === 0 && main.recruitProgress === null && main.recruitBadge === null && main.recruitResult === null), '离页背景与招募引用清理');
      };
      await click('导航-home'); await page.waitForFunction(() => main.page === 'home' && main.sheet === null); await assertClean();
      for (let i = 0; i < 3; i++) {
        await click('导航-recruit');
        await page.waitForFunction(() => main.recruitBackground?.getComponent('cc.Sprite')?.spriteFrame);
        assertBackground(await backgroundLayout());
        await click('导航-home'); await page.waitForFunction(() => main.page === 'home' && main.sheet === null); await assertClean();
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
      report.checks.push({ width, spacing, proportions, progressGeometry, layout, background, pressChecks, stableFrames: 30, headerClickable: true, navClickable: true, reopenCleanup: true, one, batch, reward, persisted: true, insufficientDialog: true, httpFailures: failures });
      } catch (error) {
        report.errors.push(`${width}×844：${error.message}`);
      } finally { await context.close(); }
    }
    assert.deepEqual(report.errors, []);
  } catch (error) { report.errors.push(error.message); throw error;
  } finally { fs.writeFileSync('temp/recruit-acceptance.json', JSON.stringify(report, null, 2)); await browser.close(); }
  console.log(JSON.stringify(report, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
