// End-to-end verification for 12-breed Album, locked blackened silhouettes,
// Pet Profile (unlock diamond rewards by rarity R=50/SR=80/SSR=120, star upgrade,
// renaming, trait bonuses, 3D visible outfits & coat skinning) on live 127.0.0.1:8087.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

const OUT_DIR = path.resolve(__dirname, '../art/generated');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  const failures = [];
  try {
    const context = await browser.newContext({ viewport: { width: 430, height: 844 } });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400) failures.push([r.status(), r.url()]); });

    const attach = async () => {
      await page.waitForFunction(() => window.cc?.director?.getScene()?.children.some(n => n.components.some(c => typeof c.openProfile === 'function')), { timeout: 20000 });
      await page.evaluate(() => {
        window.main = cc.director.getScene().children.flatMap(n => n.components).find(c => typeof c.openProfile === 'function');
        window.walk = n => [n, ...n.children.flatMap(walk)];
      });
    };

    await page.goto('http://127.0.0.1:8087/index.html?v=album1', { waitUntil: 'domcontentloaded' });
    await attach();

    // Seed mixed unlocked (R: 0,1,4; SR: 6,9; SSR: 7,11) & locked (2,3,5,8,10) so Album displays both bright unlocked cards & blackened locked silhouettes!
    await page.evaluate(() => {
      const s = main.fresh();
      s.coins = 5000; s.gems = 500;
      const unlockedIds = [0, 1, 4, 6, 7, 9, 11];
      s.pets = unlockedIds.map(id => main.makePet(id, 72, 82, 88, 78));
      s.recruit.copies = Object.fromEntries(Array.from({ length: 12 }, (_, id) => [id, unlockedIds.includes(id) ? 5 : 0]));
      cc.sys.localStorage.setItem(main.key, JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await attach();
    await page.waitForFunction(() => main.actors.length === 7 && main.actors.every(a => a.rig), { timeout: 15000 });

    // 1) Open Album and verify formal panel + 12 cards (7 unlocked, 5 blackened locked silhouettes)
    await page.evaluate(() => main.open('album'));
    await page.waitForFunction(() => {
      const panel = main.sheet?.getChildByName('图鉴正式大底板')?.getComponent('cc.Sprite')?.spriteFrame;
      const cards = walk(main.sheet).filter(n => n.name.startsWith('图鉴卡片-'));
      const imgs = walk(main.sheet).filter(n => n.name === '伙伴头像图');
      return !!panel && cards.length === 12 && imgs.length === 12 && imgs.every(n => !!n.getComponent('cc.Sprite')?.spriteFrame);
    }, { timeout: 15000 });
    await page.waitForTimeout(300);

    const albumStats = await page.evaluate(() => {
      const lockedCard = walk(main.sheet).find(n => n.name === '图鉴卡片-2');
      const unlockedCard = walk(main.sheet).find(n => n.name === '图鉴卡片-7');
      const lockedSprite = walk(lockedCard).find(n => n.name === '伙伴头像图').getComponent('cc.Sprite');
      const unlockedSprite = walk(unlockedCard).find(n => n.name === '伙伴头像图').getComponent('cc.Sprite');
      const gemIcons = walk(main.sheet).filter(n => n.name === '顶部素材-diamond-icon' && !!n.getComponent('cc.Sprite')?.spriteFrame).length;
      return {
        lockedRgb: [lockedSprite.color.r, lockedSprite.color.g, lockedSprite.color.b],
        unlockedRgb: [unlockedSprite.color.r, unlockedSprite.color.g, unlockedSprite.color.b],
        hasLockOverlay: !!walk(lockedCard).find(n => n.name === '未解锁遮罩'),
        gemIcons,
      };
    });
    console.log('album silhouette & icon check:', JSON.stringify(albumStats));
    assert.ok(albumStats.lockedRgb[0] >= 130 && albumStats.lockedRgb[0] <= 180 && albumStats.hasLockOverlay, 'locked pet must use readable soft grey veil + padlock');
    assert.deepEqual(albumStats.unlockedRgb, [255, 255, 255], 'unlocked pet must render bright color');
    assert.ok(albumStats.gemIcons >= 10, 'album must reuse header diamond-icon across reward badges');
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-new-album.png') });

    // 2) Open SSR Ragdoll Cat (#7) Profile -> verify live 3D preview camera + idle animation + unlock diamond rewards!
    await page.evaluate(() => main.openProfile(7, 'overview'));
    await page.waitForFunction(() => !!main.previewRig && !!main.previewCamera?.enabled, { timeout: 10000 });
    await page.waitForTimeout(350);
    const previewCheck = await page.evaluate(() => {
      const stageSprite = walk(main.sheet).find(n => n.name === '宠物3D预览画面')?.getComponent('cc.Sprite');
      return {
        camEnabled: !!main.previewCamera?.enabled,
        hasTargetRT: !!main.previewCamera?.targetTexture && main.previewCamera.targetTexture === main.previewTexture,
        rtSize: main.previewTexture ? [main.previewTexture.width, main.previewTexture.height] : null,
        spriteBound: !!stageSprite && stageSprite.spriteFrame === main.previewFrame,
        hasRig: !!main.previewRig,
        tailY: +main.previewRig.tail.eulerAngles.y.toFixed(2),
      };
    });
    console.log('profile 3D preview check:', JSON.stringify(previewCheck));
    assert.equal(previewCheck.camEnabled, true, '3D preview camera must be enabled on Pet Profile');
    assert.equal(previewCheck.hasTargetRT, true, '3D preview camera must render into RenderTexture');
    assert.equal(previewCheck.spriteBound, true, '3D preview stage sprite must bind previewFrame');
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-pet-profile-overview.png') });

    const gemCheck = await page.evaluate(() => {
      const g0 = main.data.gems;
      const okSSSR = main.claimAlbumReward(7);
      const g1 = main.data.gems;
      const dupSSSR = main.claimAlbumReward(7);
      const okR = main.claimAlbumReward(0);
      const g2 = main.data.gems;
      const okSSR = main.claimAlbumReward(6);
      const g3 = main.data.gems;
      const okSR = main.claimAlbumReward(9);
      const g4 = main.data.gems;
      return { okSSSR, dupSSSR, okR, okSSR, okSR, dSSSR: g1 - g0, dR: g2 - g1, dSSR: g3 - g2, dSR: g4 - g3 };
    });
    console.log('unlock diamond rewards:', JSON.stringify(gemCheck));
    assert.deepEqual(gemCheck, { okSSSR: true, dupSSSR: false, okR: true, okSSR: true, okSR: true, dSSSR: 160, dR: 50, dSSR: 120, dSR: 80 });

    // 3) Open Rename dialog -> verify title "改名", single-line EditBox input, 确认/取消 buttons, free 1st rename & 100-gem 2nd rename!
    await page.evaluate(() => { main.closeDialog(); main.showRenameDialog(7); });
    await page.waitForTimeout(250);
    const renameDlg = await page.evaluate(() => {
      const eb = walk(main.dialog).find(n => n.name === '改名输入框')?.getComponent('cc.EditBox');
      return {
        title: walk(main.dialog).find(n => n.name === '弹窗独立标题')?.getComponent('cc.Label')?.string,
        hasInput: !!eb,
        singleLine: eb?.inputMode === 6,
        vAlignCenter: eb?.textLabel?.verticalAlign === 1,
        domTag: eb?._impl?._edTxt?.tagName || 'NONE',
        hasOk: !!walk(main.dialog).find(n => n.name === '弹窗按钮-确认'),
        hasCancel: !!walk(main.dialog).find(n => n.name === '弹窗按钮-取消'),
      };
    });
    console.log('rename dialog check:', JSON.stringify(renameDlg));
    assert.deepEqual(renameDlg, { title: '改名', hasInput: true, singleLine: true, vAlignCenter: true, domTag: 'INPUT', hasOk: true, hasCancel: true });
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-rename-dialog.png') });
    const renamedFree = await page.evaluate(() => {
      main.closeDialog();
      const g0 = main.data.gems;
      const ok1 = main.renamePet(7, '奶盖小仙');
      const g1 = main.data.gems;
      return { ok1, freeCost: g0 - g1 };
    });
    // Open Rename dialog a 2nd time -> verify paid-rename prompt ("本次改名消耗 [💎] 100", no free hint)
    await page.evaluate(() => main.showRenameDialog(7));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-rename-dialog-paid.png') });
    const renamed = await page.evaluate((rf) => {
      main.closeDialog();
      const g1 = main.data.gems;
      const ok2 = main.renamePet(7, '布偶小仙');
      const g2 = main.data.gems;
      return { ok1: rf.ok1, freeCost: rf.freeCost, ok2, secondCost: g1 - g2, name: main.petDisplayName(7) };
    }, renamedFree);
    console.log('rename cost check:', JSON.stringify(renamed));
    assert.deepEqual(renamed, { ok1: true, freeCost: 0, ok2: true, secondCost: 100, name: '布偶小仙' });

    // 4) Switch to Star Upgrade tab -> upgrade #7 from ★1 -> ★2 -> ★3 (auto-unlocks gold_crown!)
    await page.evaluate(() => { main.openProfile(7, 'star'); });
    await page.waitForTimeout(260);
    const starRes = await page.evaluate(() => {
      const c0 = main.data.recruit.copies[7];
      const up2 = main.upgradePetStar(7);
      const up3 = main.upgradePetStar(7);
      const pet = main.data.pets.find(p => p.id === 7);
      const pet0 = main.data.pets.find(p => p.id === 0);
      return {
        up2, up3, star: pet.star, copiesLeft: main.data.recruit.copies[7], copiesSpent: c0 - main.data.recruit.copies[7],
        hasCrown: pet.ownedOutfits.includes('gold_crown'),
        otherPetHasCrown: pet0.ownedOutfits.includes('gold_crown'),
      };
    });
    console.log('star upgrade:', JSON.stringify(starRes));
    assert.deepEqual(starRes, { up2: true, up3: true, star: 3, copiesLeft: 2, copiesSpent: 3, hasCrown: true, otherPetHasCrown: false });
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-pet-profile-star.png') });

    // 5) Switch to Outfit & Skin tab -> buy/equip 3D outfits & verify NO jump on equip + all outfits visible!
    const hopCheck = await page.evaluate(() => {
      main.openProfile(7, 'outfit');
      main.previewHop = 0;
      main.selectPetOutfit(7, 'blue_scarf');
      const hopAfterScarf = main.previewHop;
      return { hopAfterScarf };
    });
    assert.equal(hopCheck.hopAfterScarf, 0, 'equipping outfit must NOT trigger jump/hop');
    await page.waitForFunction(() => {
      const icons = walk(main.sheet).filter(n => n.name.startsWith('装扮图标-'));
      return icons.length === 12 && icons.every(n => !!n.getComponent('cc.Sprite')?.spriteFrame) && !!main.previewRig?.outfitNode;
    }, { timeout: 10000 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-pet-profile-scarf.png') });

    await page.evaluate(() => {
      main.selectPetOutfit(7, 'bell_collar');
    });
    await page.waitForTimeout(220);
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-pet-profile-collar.png') });

    await page.evaluate(() => {
      main.selectPetOutfit(7, 'straw_hat');
    });
    await page.waitForTimeout(220);
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-pet-profile-hat.png') });

    await page.evaluate(() => {
      main.openProfile(0, 'outfit');
      main.selectPetOutfit(0, 'none');
      main.selectPetCoat(0, 'cream_glow');
    });
    const perPetIsolation = await page.evaluate(() => {
      const p0 = main.data.pets.find(p => p.id === 0);
      const p7 = main.data.pets.find(p => p.id === 7);
      return {
        p0OwnsScarf: p0.ownedOutfits.includes('blue_scarf'),
        p7OwnsScarf: p7.ownedOutfits.includes('blue_scarf'),
        p0OwnsSailor: p0.ownedCoats.includes('cream_glow'),
        p7OwnsSailor: p7.ownedCoats.includes('cream_glow'),
      };
    });
    console.log('per-pet outfit/skin isolation:', JSON.stringify(perPetIsolation));
    assert.deepEqual(perPetIsolation, { p0OwnsScarf: false, p7OwnsScarf: true, p0OwnsSailor: true, p7OwnsSailor: false });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-pet-skin-sailor.png') });

    await page.evaluate(() => {
      main.selectPetCoat(0, 'sunset_warm');
    });
    await page.waitForTimeout(260);
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-pet-skin-bee.png') });

    await page.evaluate(() => {
      main.openProfile(7, 'outfit');
      main.selectPetOutfit(7, 'gold_crown');
      main.selectPetCoat(7, 'sakura_blush');
      main.selectPetOutfit(0, 'bell_collar');
      main.selectPetOutfit(9, 'straw_hat');
      main.selectPetOutfit(11, 'blue_scarf');
      main.selectPetOutfit(6, 'pink_bow');
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-pet-profile-outfit.png') });

    // 6) Verify trait gameplay effect (glutton #4 gets +25% hunger on food care!)
    const traitCheck = await page.evaluate(() => {
      const p4 = main.data.pets.find(p => p.id === 4);
      p4.hunger = 20;
      main.petSelected = true; main.selected = 4;
      main.applyCare(main.legacyItem('food'), 'food');
      const after = main.data.pets.find(p => p.id === 4).hunger;
      return { trait: p4.trait, gained: after - 20 };
    });
    console.log('trait bonus check:', JSON.stringify(traitCheck));
    assert.equal(traitCheck.trait, 'glutton');
    assert.equal(traitCheck.gained, 50, 'glutton +25% turns 40 hunger gain into 50');

    // 7) Return home and verify 3D outfits attached on live 3D pets + capture garden screenshot!
    await page.evaluate(() => {
      main.open('home');
      const spots = [[-1.7, -0.9], [0, -0.9], [1.7, -0.9], [-1.7, 0.3], [0, 0.3], [1.7, 0.3], [0, 1.3]];
      main.actors.forEach((a, i) => {
        a.node.setPosition(spots[i][0], 0, spots[i][1]);
        a.node.setRotationFromEuler(0, 18, 0);
        a.facing = 18;
      });
    });
    await page.waitForTimeout(350);
    const outfitsOnYard = await page.evaluate(() => main.actors.map(a => ({ id: a.pet.id, outfit: a.pet.outfit, attached: !!a.rig?.outfitNode })));
    console.log('3D outfits on yard:', JSON.stringify(outfitsOnYard));
    assert.ok(outfitsOnYard.find(x => x.id === 7).attached, 'SSR Ragdoll #7 has 3D crown attached');
    assert.ok(outfitsOnYard.find(x => x.id === 9).attached, 'Corgi #9 has 3D straw hat attached');
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-garden-newbreeds-outfits.png') });

    // 8) Verify GM debug panel opens, unlocks all 12 pets, and 12 pets roam freely across the spacious lawn without social deadlock!
    await page.evaluate(() => main.toggleGmPanel());
    await page.waitForTimeout(200);
    const gmCheck = await page.evaluate(() => ({
      open: !!main.gmPanel,
      btnCount: main.gmPanel ? walk(main.gmPanel).filter(n => n.name.startsWith('GM按钮-')).length : 0,
    }));
    console.log('GM panel check:', JSON.stringify(gmCheck));
    assert.equal(gmCheck.open, true, 'GM debug panel must open');
    assert.equal(gmCheck.btnCount, 18, 'GM debug panel must show all 18 quick debug buttons');
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-gm-panel.png') });
    // Trigger GM "解锁全部 12 伙伴" and test 12-pet roaming freedom over 2.5 seconds!
    await page.evaluate(() => {
      const btn = walk(main.gmPanel).find(n => n.name === 'GM按钮-解锁全部 12 伙伴');
      btn.emit(cc.Node.EventType.TOUCH_END, { propagationStopped: false });
      main.toggleGmPanel();
    });
    await page.waitForFunction(() => main.actors.length === 12, { timeout: 10000 });
    const pos0 = await page.evaluate(() => main.actors.map(a => [a.node.position.x, a.node.position.z]));
    await page.waitForTimeout(2400);
    const crowdStats = await page.evaluate((p0) => {
      let moved = 0, socializing = 0;
      main.actors.forEach((a, i) => {
        if (Math.hypot(a.node.position.x - p0[i][0], a.node.position.z - p0[i][1]) > 0.25) moved++;
        if ((a.socialUntil || 0) > main.socialTime) socializing++;
      });
      const zs = main.actors.map(a => a.node.position.z);
      return { total: main.actors.length, moved, socializing, zSpan: +(Math.max(...zs) - Math.min(...zs)).toFixed(2), bubbles: main.socialBubbles.length };
    }, pos0);
    console.log('12-pet crowd roaming check:', JSON.stringify(crowdStats));
    assert.equal(crowdStats.total, 12);
    assert.ok(crowdStats.moved >= 8, 'at least 8 of 12 pets must actively walk instead of freezing in social deadlock');
    assert.ok(crowdStats.bubbles <= 4, 'concurrent social bubbles must be capped cleanly');
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-garden-12pets-roaming.png') });

    // 9) Verify Recruit page: signboard aligned left with avatar, reward panel shifted right, Album cards in preview strip, and swipeable card details dialog!
    await page.evaluate(() => main.open('recruit'));
    await page.waitForFunction(() => {
      if (main.page !== 'recruit' || !main.sheet) return false;
      const cards = walk(main.sheet).filter(n => n.name.startsWith('招募本体-'));
      const frames = walk(main.sheet).filter(n => n.name === '图鉴卡片底框');
      const badges = walk(main.sheet).filter(n => n.name.startsWith('稀有度徽章-'));
      const avatars = walk(main.sheet).filter(n => n.name === '伙伴头像图');
      const titleArt = walk(main.sheet).find(n => n.name === '招募素材-title');
      return cards.length === 12 && frames.length === 12 && badges.length === 12 && avatars.length === 12
        && frames.every(n => !!n.getComponent('cc.Sprite')?.spriteFrame)
        && badges.every(n => !!n.getComponent('cc.Sprite')?.spriteFrame)
        && avatars.every(n => !!n.getComponent('cc.Sprite')?.spriteFrame)
        && !!titleArt?.getComponent('cc.Sprite')?.spriteFrame;
    }, { timeout: 15000 });
    await page.waitForTimeout(300);
    const recruitLayout = await page.evaluate(() => {
      const sheet = main.sheet;
      const titleArt = sheet.getChildByName('招募素材-title');
      const reward = sheet.getChildByName('领取招募累计奖励');
      const profile = main.top.getChildByName('头像等级经验');
      const vp = walk(sheet).find(n => n.name === '招募预览可视窗口');
      const sv = vp?.getComponent('cc.ScrollView');
      const titleLeft = (titleArt.position.x - titleArt.getComponent('cc.UITransform').width / 2) * sheet.scale.x;
      const profileLeft = profile.position.x - profile.getComponent('cc.UITransform').width / 2;
      return {
        titleX: titleArt.position.x,
        rewardX: reward.position.x,
        titleLeft: +titleLeft.toFixed(1),
        profileLeft: +profileLeft.toFixed(1),
        previewHorizontal: !!sv?.horizontal,
        previewCards: walk(sheet).filter(n => n.name.startsWith('招募本体-')).length,
      };
    });
    console.log('recruit layout check:', JSON.stringify(recruitLayout));
    assert.ok(Math.abs(recruitLayout.titleLeft - recruitLayout.profileLeft) <= 8, 'signboard left edge must align with top-left avatar');
    assert.ok(recruitLayout.rewardX >= 380, 'recruit reward panel must be shifted right');
    assert.equal(recruitLayout.previewHorizontal, true, 'recruit preview must use horizontal scrollable Album cards');
    assert.equal(recruitLayout.previewCards, 12, 'recruit preview must include all 12 Album cards');
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-recruit-after.png') });

    // Open swipeable Card Details dialog via "查看详情 ›"
    await page.evaluate(() => {
      const detailsBtn = walk(main.sheet).find(n => n.name === '查看招募卡池');
      detailsBtn.emit(cc.Node.EventType.TOUCH_END, { propagationStopped: false });
    });
    await page.waitForFunction(() => {
      if (!main.dialog) return false;
      const cards = walk(main.dialog).filter(n => n.name.startsWith('卡池详情卡片-'));
      const frames = walk(main.dialog).filter(n => n.name === '图鉴卡片底框');
      return cards.length === 12 && frames.length === 12 && frames.every(n => !!n.getComponent('cc.Sprite')?.spriteFrame);
    }, { timeout: 15000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-recruit-details.png') });
    // Verify swiping / scrolling horizontally advances the card carousel!
    const swipeCheck = await page.evaluate(() => {
      const vp = walk(main.dialog).find(n => n.name === '招募卡池可视窗口');
      const sv = vp.getComponent('cc.ScrollView');
      const before = sv.getScrollOffset().x;
      const nextBtn = walk(main.dialog).find(n => n.name === '卡池右滑按钮');
      nextBtn.emit(cc.Node.EventType.TOUCH_END, { propagationStopped: false });
      return { horizontal: sv.horizontal, cards: walk(main.dialog).filter(n => n.name.startsWith('卡池详情卡片-')).length, before };
    });
    await page.waitForTimeout(350);
    const afterSwipe = await page.evaluate(() => walk(main.dialog).find(n => n.name === '招募卡池可视窗口').getComponent('cc.ScrollView').getScrollOffset().x);
    console.log('recruit details swipe check:', JSON.stringify({ ...swipeCheck, after: +afterSwipe.toFixed(1) }));
    assert.equal(swipeCheck.horizontal, true, 'details dialog must be horizontally swipeable');
    assert.equal(swipeCheck.cards, 12, 'details dialog must render all 12 swipeable Album cards');
    assert.ok(afterSwipe < swipeCheck.before - 100, 'swiping right must advance the card carousel');

    // 10) Verify clicking Normal Recruit (1-draw) and Advanced Recruit (10-draw) open Recruit Result Popups with pet cards!
    await page.evaluate(() => {
      main.closeDialog();
      main.data.gems = 10000;
      main.renderHeader();
      main.recruitClickTime = 0;
      const singleBtn = walk(main.sheet).find(n => n.name.startsWith('招募按钮-普通招募'));
      singleBtn.emit(cc.Node.EventType.TOUCH_END, { propagationStopped: false });
    });
    await page.waitForFunction(() => {
      if (!main.dialog) return false;
      const cards = walk(main.dialog).filter(n => n.name.startsWith('招募结果卡片-'));
      const frames = walk(main.dialog).filter(n => n.name === '图鉴卡片底框');
      return cards.length === 1 && frames.length === 1 && frames.every(n => !!n.getComponent('cc.Sprite')?.spriteFrame);
    }, { timeout: 10000 });
    await page.waitForTimeout(450);
    const singlePop = await page.evaluate(() => ({
      title: walk(main.dialog).find(n => n.name === '弹窗独立标题')?.getComponent('cc.Label')?.string,
      cards: walk(main.dialog).filter(n => n.name.startsWith('招募结果卡片-')).length,
    }));
    console.log('single recruit popup check:', JSON.stringify(singlePop));
    assert.equal(singlePop.cards, 1, '1-draw must open result popup with 1 pet card');
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-recruit-result-single.png') });

    await page.evaluate(() => {
      main.closeDialog();
      main.recruitClickTime = 0;
      const tenBtn = walk(main.sheet).find(n => n.name.startsWith('招募按钮-高级招募'));
      tenBtn.emit(cc.Node.EventType.TOUCH_END, { propagationStopped: false });
    });
    await page.waitForFunction(() => {
      if (!main.dialog) return false;
      const cards = walk(main.dialog).filter(n => n.name.startsWith('招募结果卡片-'));
      const frames = walk(main.dialog).filter(n => n.name === '图鉴卡片底框');
      return cards.length === 10 && frames.length === 10 && frames.every(n => !!n.getComponent('cc.Sprite')?.spriteFrame);
    }, { timeout: 10000 });
    await page.waitForTimeout(700);
    const tenPop = await page.evaluate(() => ({
      title: walk(main.dialog).find(n => n.name === '弹窗独立标题')?.getComponent('cc.Label')?.string,
      cards: walk(main.dialog).filter(n => n.name.startsWith('招募结果卡片-')).length,
    }));
    console.log('ten recruit popup check:', JSON.stringify(tenPop));
    assert.equal(tenPop.cards, 10, '10-draw must open result popup with 10 pet cards');
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-recruit-result-ten.png') });

    // 11) Verify Shop page: green stock when purchasable, blue stock when unpurchasable (independent of owned count), snappy rapid buy, and larger mobile layout!
    await page.evaluate(() => {
      main.closeDialog();
      main.data.coins = 260; main.data.gems = 100;
      main.open('shop');
    });
    await page.waitForFunction(() => main.page === 'shop' && main.shopCards.length === 6 && main.shopCards.every(c => !!c.icon.spriteFrame), { timeout: 10000 });
    await page.waitForTimeout(300);
    const shopBefore = await page.evaluate(() => {
      const s = main.data.shop;
      return main.shopCards.map(c => {
        const slot = s.slots.find(e => e.id === c.id);
        const col = c.stock.color;
        const ownCol = c.owned.color;
        return {
          id: c.id,
          stockText: c.stock.string,
          ownedText: c.owned.string,
          stockRgb: [col.r, col.g, col.b],
          ownedRgb: [ownCol.r, ownCol.g, ownCol.b],
          remaining: slot.remaining,
          iconSize: c.icon.node.getComponent('cc.UITransform').width,
          buyW: c.price.node.parent.getComponent('cc.UITransform').width,
        };
      });
    });
    console.log('shop cards check:', JSON.stringify(shopBefore.slice(0, 3)));
    assert.ok(shopBefore.every(c => c.iconSize >= 86 && c.buyW >= 170), 'shop icons and buy buttons must be enlarged for mobile');
    assert.ok(shopBefore.every(c => c.stockText.startsWith('限购 ') && c.ownedText.startsWith('持有 ')), 'stock and owned must be separate labels');
    // Test rapid buying (200ms apart) of an affordable item until sold out, then verify stock turns blue!
    const buyTarget = await page.evaluate(() => {
      main.data.coins = 5000; main.data.gems = 5000;
      main.updateShopLabels();
      const first = main.shopCards[0];
      const slot = main.data.shop.slots.find(e => e.id === first.id);
      return { id: first.id, initialRem: slot.remaining, greenRgb: [first.stock.color.r, first.stock.color.g, first.stock.color.b] };
    });
    assert.deepEqual(buyTarget.greenRgb, [34, 139, 60], 'purchasable stock label must be green');
    for (let k = 0; k < buyTarget.initialRem; k++) {
      await page.waitForTimeout(200);
      await page.evaluate(id => main.buyShopItem(id), buyTarget.id);
    }
    const afterRapidBuy = await page.evaluate(id => {
      const card = main.shopCards.find(c => c.id === id);
      const slot = main.data.shop.slots.find(e => e.id === id);
      return {
        remaining: slot.remaining,
        stockText: card.stock.string,
        ownedText: card.owned.string,
        soldOutRgb: [card.stock.color.r, card.stock.color.g, card.stock.color.b],
        ownedRgb: [card.owned.color.r, card.owned.color.g, card.owned.color.b],
      };
    }, buyTarget.id);
    console.log('shop rapid buy & sold-out color check:', JSON.stringify(afterRapidBuy));
    assert.equal(afterRapidBuy.remaining, 0, 'rapid clicking 200ms apart must smoothly buy out every stock');
    assert.deepEqual(afterRapidBuy.soldOutRgb, [201, 56, 50], 'sold-out stock label must turn red');
    assert.deepEqual(afterRapidBuy.ownedRgb, [110, 83, 60], 'owned label must stay neutral brown independent of stock');
    // Verify refreshed shop shelf guarantees balanced coin (>=3) and gem (>=2) slots!
    await page.evaluate(() => { main.shopClickTime = 0; main.refreshShop(); });
    await page.waitForTimeout(350);
    const currencyMix = await page.evaluate(() => {
      let coins = 0, gems = 0;
      main.shopCards.forEach(c => {
        const iconName = c.currency.spriteFrame?.name || '';
        if (iconName.includes('diamond')) gems++; else coins++;
      });
      return { coins, gems };
    });
    console.log('shop currency mix check:', JSON.stringify(currencyMix));
    assert.ok(currencyMix.gems >= 2 && currencyMix.coins >= 3, 'shop shelf must balance gem (>=2) and coin (>=3) items');
    await page.evaluate(() => { main.data.coins = 260; main.data.gems = 100; main.updateShopLabels(); main.renderHeader(); });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-shop-after.png') });

    // 14) Avatar Picker dialog + Earless HUD frame check:
    // Go back to home with 7 unlocked & 5 locked pets so we verify both unlocked & locked states in the picker!
    await page.evaluate(() => {
      main.open('home');
      main.data.pets = main.data.pets.filter(p => p.id < 7);
      main.data.avatar = 0;
      main.renderHeader();
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-hud-earless.png') });
    // Trigger click on top-left player avatar -> must open Avatar Picker dialog, NOT jump to Album!
    await page.evaluate(() => {
      const prof = main.top.getChildByName('头像等级经验');
      prof.emit('touch-end', {});
    });
    await page.waitForTimeout(450);
    const avCheck = await page.evaluate(() => {
      const panel = main.dialog?.getChildByName('更换头像面板');
      const slots = panel ? panel.children.filter(c => c.name.startsWith('头像选项-')) : [];
      const locked = slots.filter(s => !!walk(s).find(n => n.name === '未解锁遮罩')).length;
      const unlocked = slots.length - locked;
      return {
        page: main.page,
        title: panel?.getChildByName('弹窗独立标题')?.getComponent('cc.Label')?.string,
        totalSlots: slots.length,
        unlocked,
        locked,
        hasConfirm: !!panel?.getChildByName('弹窗按钮-确认更换'),
        hasCancel: !!panel?.getChildByName('弹窗按钮-取消'),
      };
    });
    console.log('avatar picker check:', JSON.stringify(avCheck));
    assert.deepEqual(avCheck, { page: 'home', title: '更换头像', totalSlots: 12, unlocked: 7, locked: 5, hasConfirm: true, hasCancel: true });
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-avatar-picker.png') });
    // Clicking a locked avatar must NOT change equipped avatar; clicking unlocked avatar + 确认更换 MUST equip it!
    const avSwap = await page.evaluate(() => {
      const panel = main.dialog.getChildByName('更换头像面板');
      panel.getChildByName('头像选项-8').emit('touch-end', {}); // locked
      panel.getChildByName('弹窗按钮-确认更换').emit('touch-end', {});
      const afterLocked = main.data.avatar;
      // Re-open, select unlocked pet #4, confirm
      main.showAvatarDialog();
      const panel2 = main.dialog.getChildByName('更换头像面板');
      panel2.getChildByName('头像选项-4').emit('touch-end', {});
      panel2.getChildByName('弹窗按钮-确认更换').emit('touch-end', {});
      return { afterLocked, afterUnlocked: main.data.avatar, dialogClosed: !main.dialog };
    });
    console.log('avatar swap check:', JSON.stringify(avSwap));
    assert.deepEqual(avSwap, { afterLocked: 0, afterUnlocked: 4, dialogClosed: true });

    // 15) Health / Sickness / Heal Action / Medicine Shop / Yard Poop + Smoke / Pet Death + Ghost animation!
    await page.evaluate(() => {
      main.open('home');
      const p0 = main.data.pets.find(p => p.id === 0);
      p0.health = 20; p0.clean = 22; p0.hunger = 18;
      const a0 = main.actors.find(a => a.pet.id === 0);
      if (a0) a0.pet = p0;
      main.data.itemInventory.bandage = 2;
      main.spawnYardPoop(0, -0.4, 1.2);
      main.spawnYardPoop(1, 0.7, 2.0);
      main.selected = 0;
      main.open('pet');
    });
    await page.waitForTimeout(450);
    const careHealthCheck = await page.evaluate(() => ({
      hasHealthBar: !!main.sheet?.getChildByName('健康-进度'),
      hasHealBtn: !!main.bottom?.getChildByName('照顾-heal'),
      poopCount: (main.data.poops || []).length,
      poopNodes: main.poopVisuals ? main.poopVisuals.size : 0,
    }));
    console.log('health & poop check:', JSON.stringify(careHealthCheck));
    assert.deepEqual(careHealthCheck, { hasHealthBar: true, hasHealBtn: true, poopCount: 2, poopNodes: 2 });
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-yard-poop-and-heal.png') });

    // Clean a poop (verify broom sweep animation!) & heal the sick pet with bandage
    const cleanStep = await page.evaluate(() => {
      const pid = main.data.poops[0].id;
      const c0 = main.data.coins;
      main.cleanYardPoop(pid);
      return { poopsAfter: main.data.poops.length, coinGain: main.data.coins - c0, broomActive: main.brooms.length };
    });
    await page.waitForTimeout(260);
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-broom-sweep.png') });
    const healAndClean = await page.evaluate((cs) => {
      const h0 = main.data.pets.find(p => p.id === 0).health;
      // Direct care('medicine') consumes bandage without forcing Bag open!
      main.care('medicine');
      const stayedOnPet = main.page === 'pet';
      const h1 = main.data.pets.find(p => p.id === 0).health;
      const healToast = main.notice?.string || '';
      // Out of stock -> auto jump to Shop!
      main.data.itemInventory.bandage = 0;
      ['pet_vitamins','cough_syrup','herbal_salve','magic_elixir','first_aid_kit'].forEach(k => { main.data.itemInventory[k] = 0; });
      main.care('medicine');
      const jumpedToShop = main.page === 'shop';
      // Bag screen still retains Medicine tab for manual selection
      main.open('bag');
      const hasMedTab = !!walk(main.sheet).find(n => n.name === '背包分类-治疗');
      // Check shop guarantees at least 1 medicine item
      main.shopClickTime = 0; main.refreshShop();
      const medInShop = main.data.shop.slots.some(s => ['bandage','pet_vitamins','cough_syrup','herbal_salve','magic_elixir','first_aid_kit'].includes(s.id));
      return { poopsAfter: cs.poopsAfter, coinGain: cs.coinGain, broomActive: cs.broomActive, stayedOnPet, jumpedToShop, hasMedTab, healthBefore: h0, healthAfter: h1, medInShop, hasUsedItemToast: healToast.includes('爱心创可贴') || healToast.includes('治疗成功') };
    }, cleanStep);
    console.log('heal & clean check:', JSON.stringify(healAndClean));
    assert.deepEqual(healAndClean, { poopsAfter: 1, coinGain: 5, broomActive: 1, stayedOnPet: true, jumpedToShop: true, hasMedTab: true, healthBefore: 20, healthAfter: 45, medInShop: true, hasUsedItemToast: true });

    // Trigger pet death in yard -> capture fallen pet + rising ghost screenshot -> verify pet disappears after animation!
    await page.evaluate(() => {
      main.open('home');
      const p1 = main.data.pets.find(p => p.id === 1);
      main.data.recruit.copies[1] = 1; // 无多余本体，验证正常离世与纪念角流程
      const a1 = main.actors.find(a => a.pet.id === 1);
      if (a1) a1.node.setPosition(0.0, 0, 1.5);
      main.triggerPetDeath(p1);
    });
    await page.waitForTimeout(850);
    const midDeath = await page.evaluate(() => ({
      deadFlag: !!main.data.pets.find(p => p.id === 1)?.dead,
      ghostCount: main.ghosts.length,
      actorDying: (main.actors.find(a => a.pet.id === 1)?.dying || 0) > 0,
    }));
    console.log('mid-death ghost check:', JSON.stringify(midDeath));
    assert.deepEqual(midDeath, { deadFlag: true, ghostCount: 1, actorDying: true });
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-pet-death-ghost.png') });
    await page.waitForTimeout(2300);
    const afterDeath = await page.evaluate(() => ({
      stillInActors: main.actors.some(a => a.pet.id === 1),
      ghostCleared: main.ghosts.length === 0,
    }));
    console.log('after-death vanish check:', JSON.stringify(afterDeath));
    assert.deepEqual(afterDeath, { stillInActors: false, ghostCleared: true });

    // 16) Looping Idle Adventure + Adventuring Pet Hidden in Main Yard + Glowing Treasure Chest with Icon+Number Reward Dialog + Diary + Shop Tombstones + Memorial Corner!
    await page.evaluate(() => {
      main.data.gems = 800;
      main.data.adventureIdleStart = Date.now() - 6 * 3600000; // 6 hours idle
      const p0 = main.data.pets.find(p => p.id === 0);
      // Send pet #0 out on adventure -> must NOT be visible in Main Yard, MUST be visible on Adventure Road!
      main.open('home');
      main.setPetAdventuring(0, true, 120000);
      // Record a food item find so Diary shows embedded visual item card
      main.triggerAdventureOutcome(p0, {
        type: 'food', title: '捡到美味食物',
        text: '「奶糖猫」在草丛野餐垫旁发现了完好的【去刺熟鱼】，开心叼回仓库！',
        item: { id: 'fish', name: '去刺熟鱼', appliesTo: 'both', currency: 'coins', price: 180, effects: { hunger: 40, joy: 5 }, category: 'food', weight: 3, limit: 2 },
        itemCount: 1, joyDelta: 6,
      });
    });
    await page.waitForTimeout(200);
    const outCheckHome = await page.evaluate(() => ({
      p0ActiveOnHome: !!main.actors.find(a => a.pet.id === 0)?.node?.active,
      p2ActiveOnHome: !!main.actors.find(a => a.pet.id === 2)?.node?.active,
    }));
    console.log('adventuring pet hidden on home check:', JSON.stringify(outCheckHome));
    assert.deepEqual(outCheckHome, { p0ActiveOnHome: false, p2ActiveOnHome: true }, 'adventuring pet must be hidden in Main Yard while non-adventuring pets stay visible');

    await page.evaluate(() => { main.open('adventure'); });
    await page.waitForTimeout(750);
    const advCheck = await page.evaluate(() => ({
      roadTiles: main.advRoadTiles.length,
      bgActive: !!main.advBgContainer?.active,
      auraActive: !!main.advChestAura?.active,
      hasChest: !!walk(main.sheet).find(n => n.name === '冒险挂机宝箱'),
      hasTimer: !!walk(main.sheet).find(n => n.name === '宝箱挂机时间牌'),
      hasLiveLogCard: !!walk(main.sheet).find(n => n.name === '冒险左上实时日志卡'),
      liveLogItems: walk(main.sheet).filter(n => n.name.startsWith('实时日志实物格-')).length,
      p0ActiveOnAdv: !!main.actors.find(a => a.pet.id === 0)?.node?.active,
      p0Z: +(main.actors.find(a => a.pet.id === 0)?.node?.position?.z ?? -99).toFixed(2),
      p2ActiveOnAdv: !!main.actors.find(a => a.pet.id === 2)?.node?.active,
      hasDiaryEntryOnHome: !!main.ui.getChildByName('冒险日记入口'),
      hasMemorialEntryOnHome: !!main.ui.getChildByName('后院纪念角入口'),
    }));
    console.log('adventure loop check:', JSON.stringify(advCheck));
    assert.ok(advCheck.p0Z >= 3.0 && advCheck.p0Z <= 4.6, 'marching pet must be lowered to match Treasure Chest height');
    assert.deepEqual({ ...advCheck, p0Z: 3.85 }, { roadTiles: 2, bgActive: true, auraActive: true, hasChest: true, hasTimer: true, hasLiveLogCard: true, liveLogItems: 3, p0ActiveOnAdv: true, p0Z: 3.85, p2ActiveOnAdv: false, hasDiaryEntryOnHome: true, hasMemorialEntryOnHome: true });
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-adventure-loop.png') });

    // Claim idle treasure chest -> verify coins/gems/items granted AND universal Icon+Number reward cards rendered!
    const chestRes = await page.evaluate(() => {
      const c0 = main.data.coins, g0 = main.data.gems;
      const ok = main.claimAdventureChest();
      return { ok, coinGain: main.data.coins - c0, gemGain: main.data.gems - g0, dialogOpen: !!main.dialog };
    });
    await page.waitForTimeout(620);
    const fxCheck = await page.evaluate(() => ({
      fx: !!walk(main.sheet).find(n => n.name === '宝箱开启特效'),
      sparks: walk(main.sheet).filter(n => n.name === '星光').length,
      dialogDeferred: !main.dialog,
    }));
    console.log('chest open effect check:', JSON.stringify(fxCheck));
    assert.ok(fxCheck.fx && fxCheck.sparks >= 12 && fxCheck.dialogDeferred, 'chest effect must play before reward dialog');
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-chest-open-effect.png') });
    await page.waitForTimeout(1300);
    chestRes.dialogOpen = await page.evaluate(() => !!main.dialog);
    const rewardCardsCheck = await page.evaluate(() => {
      const cards = main.dialog ? walk(main.dialog).filter(n => n.name.startsWith('奖励图标卡-')) : [];
      const iconsLoaded = cards.filter(c => !!c.getChildByName('奖励图标')?.getComponent('cc.Sprite')?.spriteFrame).length;
      const bgsLoaded = cards.filter(c => !!c.getChildByName('奖励卡底图')?.getComponent('cc.Sprite')?.spriteFrame).length;
      const bodyHidden = !walk(main.dialog).find(n => n.name === '弹窗正文')?.active;
      return { cardCount: cards.length, iconsLoaded, bgsLoaded, bodyHidden };
    });
    console.log('adventure chest claim check:', JSON.stringify({ ...chestRes, ...rewardCardsCheck }));
    assert.ok(chestRes.ok && chestRes.coinGain > 500 && chestRes.gemGain >= 20 && chestRes.dialogOpen, '6h idle chest must grant rich coins & gems');
    assert.ok(rewardCardsCheck.cardCount >= 3 && rewardCardsCheck.iconsLoaded === rewardCardsCheck.cardCount && rewardCardsCheck.bgsLoaded === rewardCardsCheck.cardCount && rewardCardsCheck.bodyHidden, 'chest reward dialog must show themed universal slot background + Icon+Number visual cards');
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-chest-reward-dialog.png') });

    // Crisis dialogs: no SDK -> ad buttons only toast; lost pet recovers with gems (icon+number), never coins
    await page.evaluate(() => { main.closeDialog(); main.rewardedVideoProvider = null; });
    const adGate = await page.evaluate(() => {
      const before = !!main.data.pets.find(p => p.id === 1)?.dead;
      main.revivePetByAd(1);
      return { before, after: !!main.data.pets.find(p => p.id === 1)?.dead, notice: main.notice.string };
    });
    console.log('ad gate check:', JSON.stringify(adGate));
    assert.deepEqual(adGate, { before: true, after: true, notice: '激励视频暂未接入' });
    const lostRes = await page.evaluate(() => {
      const p0 = main.data.pets.find(p => p.id === 0);
      p0.lost = true;
      main.showPetCrisisDialog('lost', 0, '');
      const tag = walk(main.dialog).find(n => n.name === '价格标签-gems');
      const num = tag?.getChildByName('价格数字')?.getComponent('cc.Label')?.string;
      const coinBtn = !!walk(main.dialog).find(n => n.name.indexOf('金币') >= 0 && n.name.startsWith('弹窗按钮-'));
      const g0 = main.data.gems;
      main.recoverLostPet(0, 'ad');
      const stillLost = main.data.pets.find(p => p.id === 0).lost;
      main.recoverLostPet(0, 'gems');
      return { hasGemTag: !!tag, num, coinBtn, stillLost, recovered: !main.data.pets.find(p => p.id === 0).lost, gemSpent: g0 - main.data.gems };
    });
    console.log('lost recover check:', JSON.stringify(lostRes));
    assert.deepEqual(lostRes, { hasGemTag: true, num: '50', coinBtn: false, stillLost: true, recovered: true, gemSpent: 50 });
    await page.waitForTimeout(300);

    // Open Adventure Diary -> verify item card + death log
    await page.evaluate(() => { main.closeDialog(); main.open('diary'); });
    await page.waitForTimeout(450);
    const diaryCheck = await page.evaluate(() => ({
      logCount: (main.data.adventureLogs || []).length,
      hasItemCard: !!walk(main.sheet).find(n => n.name.startsWith('日志实物卡-')),
      sheetY: main.sheet?.position?.y,
    }));
    console.log('adventure diary check:', JSON.stringify(diaryCheck));
    assert.ok(diaryCheck.logCount >= 3 && diaryCheck.hasItemCard && diaryCheck.sheetY === -10, 'diary must be centered at y=-10 and show logs with embedded visual item card');
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-adventure-diary.png') });

    // Open Shop -> switch to Tombstones tab -> verify 9 tombstones (3 limited ad-unlocked + 6 gem-bought), buy tomb_sleep, and verify SDK-gated ad unlock for tomb_angel!
    await page.evaluate(() => { main.shopTab = 'tombstones'; main.open('shop'); });
    await page.waitForTimeout(500);
    const tombShop = await page.evaluate(() => {
      const cards = walk(main.sheet).filter(n => n.name.startsWith('墓碑商品卡-'));
      const adBtns = walk(main.sheet).filter(n => n.name.startsWith('墓碑广告按钮-'));
      const sheetBefore = main.sheet;
      const boughtSleep = main.buyTombstone('tomb_sleep');
      const noJumpSameSheet = main.sheet === sheetBefore;
      main.rewardedVideoProvider = null;
      main.unlockTombstoneByAd('tomb_angel');
      const blockedNotice = main.notice.string;
      const ownedAngelBefore = main.data.tombstoneInventory?.tomb_angel || 0;
      main.rewardedVideoProvider = { show: cb => cb('completed') };
      main.unlockTombstoneByAd('tomb_angel');
      return {
        tombCards: cards.length,
        limitedAdBtns: adBtns.length,
        boughtSleep,
        noJumpSameSheet,
        blockedNotice,
        ownedAngelBefore,
        ownedAngel: main.data.tombstoneInventory?.tomb_angel || 0,
      };
    });
    console.log('shop tombstones check:', JSON.stringify(tombShop));
    assert.deepEqual(tombShop, { tombCards: 9, limitedAdBtns: 3, boughtSleep: true, noJumpSameSheet: true, blockedNotice: '激励视频暂未接入', ownedAngelBefore: 0, ownedAngel: 1 });
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-shop-tombstones.png') });

    // Switch to Shop Outfits tab in-place -> verify pure store (no pet switcher), 14 outfit/coat cards, buy into bag, & free unlock on pet profile!
    const outfitTabRes = await page.evaluate(() => {
      const sheetBefore = main.sheet;
      const tabBtn = walk(main.sheet).find(n => n.name === '商店页签-装扮');
      tabBtn.emit('touch-end', {});
      const cards = walk(main.sheet).filter(n => n.name.startsWith('装扮商品卡-')).length;
      const adBtns = walk(main.sheet).filter(n => n.name.startsWith('装扮广告按钮-')).length;
      const noPetBar = !walk(main.sheet).find(n => n.name === '装扮伙伴切换栏');
      main.data.coins += 1000;
      const boughtToBag = main.buyOutfitToBag('flower_wreath');
      const bagCntAfterBuy = main.data.outfitInventory?.flower_wreath || 0;
      const cBeforeEquip = main.data.coins;
      const freeUnlocked = main.selectPetOutfit(0, 'flower_wreath');
      const coinsSpentOnEquip = cBeforeEquip - main.data.coins;
      const bagCntAfterEquip = main.data.outfitInventory?.flower_wreath || 0;
      return { sameSheet: main.sheet === sheetBefore, cards, adBtns, noPetBar, boughtToBag, bagCntAfterBuy, freeUnlocked, coinsSpentOnEquip, bagCntAfterEquip };
    });
    console.log('shop outfits tab check:', JSON.stringify(outfitTabRes));
    assert.deepEqual(outfitTabRes, { sameSheet: true, cards: 14, adBtns: 3, noPetBar: true, boughtToBag: true, bagCntAfterBuy: 1, freeUnlocked: true, coinsSpentOnEquip: 0, bagCntAfterEquip: 0 });
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-shop-outfits.png') });

    // Open Memorial Corner -> erect tombstone for dead pet #1 with custom epitaph -> verify!
    await page.evaluate(() => {
      main.open('memorial');
      main.showErectTombstoneDialog(1);
    });
    await page.waitForTimeout(300);
    const memRes = await page.evaluate(() => {
      const okBtn = walk(main.dialog).find(n => n.name === '弹窗按钮-确认立碑');
      okBtn.emit('touch-end', {});
      return {
        memorials: (main.data.memorials || []).length,
        tombId: main.data.memorials?.[0]?.tombstoneId,
        epitaph: main.data.memorials?.[0]?.epitaph,
        sheetY: main.sheet?.position?.y,
      };
    });
    console.log('memorial erect check:', JSON.stringify(memRes));
    assert.deepEqual(memRes, { memorials: 1, tombId: 'tomb_sleep', epitaph: '永远记得陪我度过的每一个晴天', sheetY: -10 });
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-memorial-corner.png') });
    // Open Memorial Detail dialog -> verify hand-painted modal art loaded!
    await page.evaluate(() => {
      const card = walk(main.sheet).find(n => n.name === '已立墓碑-1');
      card.emit('touch-end', {});
    });
    await page.waitForTimeout(450);
    const detailBgLoaded = await page.evaluate(() => !!walk(main.dialog).find(n => n.name === '怀念弹窗底图')?.getComponent('cc.Sprite')?.spriteFrame);
    assert.equal(detailBgLoaded, true, 'memorial detail dialog must load hand-painted modal background');
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-memorial-detail-dialog.png') });

    // 14) All pets dead (with no spare copies) -> verify yard empty reminder dialog with Recruit & Revive buttons!
    const allDeadRes = await page.evaluate(() => {
      main.closeDialog();
      main.data.pets.forEach(p => { p.dead = true; p.health = 0; main.data.recruit.copies[p.id] = 1; });
      main.allDeadPrompted = false;
      main.open('home');
      const title = walk(main.dialog).find(n => n.name === '弹窗独立标题')?.getComponent('cc.Label')?.string;
      const hasRecruitBtn = !!walk(main.dialog).find(n => n.name === '弹窗按钮-去招募领养');
      const hasReviveBtn = !!walk(main.dialog).find(n => n.name === '弹窗按钮-去复活伙伴');
      return { title, hasRecruitBtn, hasReviveBtn };
    });
    console.log('all pets dead reminder check:', JSON.stringify(allDeadRes));
    assert.deepEqual(allDeadRes, { title: '庭院空荡荡的', hasRecruitBtn: true, hasReviveBtn: true });
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-all-dead-dialog.png') });
    const navAfterClick = await page.evaluate(() => {
      walk(main.dialog).find(n => n.name === '弹窗按钮-去招募领养').emit('touch-end', {});
      const p1 = main.page;
      main.allDeadPrompted = false;
      main.open('home');
      walk(main.dialog).find(n => n.name === '弹窗按钮-去复活伙伴').emit('touch-end', {});
      const p2 = main.page;
      return { toRecruit: p1, toMemorial: p2 };
    });
    assert.deepEqual(navAfterClick, { toRecruit: 'recruit', toMemorial: 'memorial' });

    // 15) Recruit after all pets died -> previously-owned dead breeds MUST respawn in yard, strictly 1 actor per breed!
    const respawnRes = await page.evaluate(() => {
      main.closeDialog();
      main.open('recruit');
      main.data.gems += 3000;
      main.recruitClickTime = 0;
      main.recruitTransaction('ten');
      main.closeDialog();
      main.open('home');
      const aliveIds = main.data.pets.filter(p => !p.dead && !p.lost).map(p => p.id);
      const activeActors = main.actors.filter(a => a.node && a.node.active && !a.pet.dead && !a.pet.lost);
      const actorIds = activeActors.map(a => a.pet.id);
      const uniqueActorIds = [...new Set(actorIds)];
      return {
        aliveCount: aliveIds.length,
        activeActorCount: activeActors.length,
        uniqueMatchesAlive: uniqueActorIds.length === aliveIds.length && actorIds.length === uniqueActorIds.length,
      };
    });
    console.log('recruit respawn after all-dead check:', JSON.stringify(respawnRes));
    assert.ok(respawnRes.aliveCount > 0, 'recruiting after all pets died must bring drawn breeds back alive');
    assert.equal(respawnRes.uniqueMatchesAlive, true, 'yard must display strictly 1 actor per living breed');

    // 16) Auto-respawn from existing spare recruit copies WITHOUT needing to recruit again!
    const spareRes = await page.evaluate(() => {
      main.data.pets.forEach(p => { p.dead = true; p.health = 0; main.data.recruit.copies[p.id] = 1; });
      main.data.recruit.copies[0] = 3; // 2 spare copies for pet 0
      main.data.recruit.copies[7] = 2; // 1 spare copy for pet 7
      main.allDeadPrompted = false;
      main.open('home');
      const p0Alive = !main.data.pets.find(p => p.id === 0)?.dead;
      const p7Alive = !main.data.pets.find(p => p.id === 7)?.dead;
      const p1StillDead = !!main.data.pets.find(p => p.id === 1)?.dead;
      const activeIds = main.actors.filter(a => a.node && a.node.active).map(a => a.pet.id).sort((a, b) => a - b);
      return {
        p0Alive, p7Alive, p1StillDead,
        c0Left: main.data.recruit.copies[0],
        c7Left: main.data.recruit.copies[7],
        activeIds,
      };
    });
    console.log('auto-respawn from spare copies check:', JSON.stringify(spareRes));
    assert.deepEqual(spareRes, { p0Alive: true, p7Alive: true, p1StillDead: true, c0Left: 2, c7Left: 1, activeIds: [0, 7] });

    assert.deepEqual(errors, [], 'zero pageerrors');
    assert.deepEqual(failures, [], 'zero HTTP errors');
    console.log('ALL ALBUM + PROFILE + 12-BREED + TRAITS + 3D OUTFITS CHECKS PASSED!');
  } finally {
    await browser.close();
  }
})();
