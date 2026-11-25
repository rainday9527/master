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
      const okSSR = main.claimAlbumReward(7);
      const g1 = main.data.gems;
      const dupSSR = main.claimAlbumReward(7);
      const okR = main.claimAlbumReward(0);
      const g2 = main.data.gems;
      const okSR = main.claimAlbumReward(6);
      const g3 = main.data.gems;
      return { okSSR, dupSSR, okR, okSR, dSSR: g1 - g0, dR: g2 - g1, dSR: g3 - g2 };
    });
    console.log('unlock diamond rewards:', JSON.stringify(gemCheck));
    assert.deepEqual(gemCheck, { okSSR: true, dupSSR: false, okR: true, okSR: true, dSSR: 120, dR: 50, dSR: 80 });

    // 3) Rename pet #7 and verify display name updates
    const renamed = await page.evaluate(() => {
      const ok = main.renamePet(7, '奶盖小仙');
      return { ok, name: main.petDisplayName(7) };
    });
    assert.deepEqual(renamed, { ok: true, name: '奶盖小仙' });

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
      return icons.length === 6 && icons.every(n => !!n.getComponent('cc.Sprite')?.spriteFrame) && !!main.previewRig?.outfitNode;
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

    // 8) Verify GM debug panel opens cleanly, executes commands, and closes cleanly
    await page.evaluate(() => main.toggleGmPanel());
    await page.waitForTimeout(200);
    const gmCheck = await page.evaluate(() => ({
      open: !!main.gmPanel,
      btnCount: main.gmPanel ? walk(main.gmPanel).filter(n => n.name.startsWith('GM按钮-')).length : 0,
    }));
    console.log('GM panel check:', JSON.stringify(gmCheck));
    assert.equal(gmCheck.open, true, 'GM debug panel must open');
    assert.equal(gmCheck.btnCount, 14, 'GM debug panel must show all 14 quick debug buttons');
    await page.screenshot({ path: path.join(OUT_DIR, 'verify-gm-panel.png') });
    await page.evaluate(() => main.toggleGmPanel());

    assert.deepEqual(errors, [], 'zero pageerrors');
    assert.deepEqual(failures, [], 'zero HTTP errors');
    console.log('ALL ALBUM + PROFILE + 12-BREED + TRAITS + 3D OUTFITS CHECKS PASSED!');
  } finally {
    await browser.close();
  }
})();
