// 宠物核心图鉴目录：12 品种、R(普通)/SR(稀有)/SSR(史诗)/SSSR(传说) 四阶品质、解锁钻石奖励、性格词条、升星规则、装扮与毛色换肤。
export type PetKind = 'cat' | 'dog';
export type PetRarity = 'R' | 'SR' | 'SSR' | 'SSSR';
export type TraitId = 'glutton' | 'bold' | 'tidy' | 'energetic' | 'playful' | 'lucky' | 'gentle' | 'explorer' | 'hothead' | 'peacemaker';
export type OutfitId =
    | 'none'
    | 'bell_collar'
    | 'blue_scarf'
    | 'pink_bow'
    | 'straw_hat'
    | 'gold_crown'
    | 'flower_wreath'
    | 'star_glasses'
    | 'wizard_hat'
    | 'chef_hat'
    | 'cherry_beret'
    | 'explorer_hat'
    | 'angel_halo'
    | 'butterfly_wings'
    | 'royal_cape'
    | 'sakura_aura'
    | 'star_wings'
    | 'rainbow_cloud';
export type CoatId =
    | 'original'
    | 'cream_glow'
    | 'sunset_warm'
    | 'sakura_blush'
    | 'dino_hoodie'
    | 'maid_apron'
    | 'prince_suit'
    | 'fairy_dress';

export interface RarityInfo {
    id: PetRarity;
    label: string;
    unlockGems: number;
    badgeBg: string;
    badgeText: string;
    border: string;
    cardBg: string;
    lockedCardBg: string;
}

export const RARITY_INFO: Record<PetRarity, RarityInfo> = {
    R: { id: 'R', label: '普通 R', unlockGems: 50, badgeBg: '#539C5A', badgeText: '#FFFDF5', border: '#6BB272', cardBg: '#E6F5E3', lockedCardBg: '#DCE6DA' },
    SR: { id: 'SR', label: '稀有 SR', unlockGems: 80, badgeBg: '#4A86D0', badgeText: '#FFFDF5', border: '#63A0E6', cardBg: '#E3F0FC', lockedCardBg: '#DAE3EC' },
    SSR: { id: 'SSR', label: '史诗 SSR', unlockGems: 120, badgeBg: '#8E55D6', badgeText: '#FFFDF5', border: '#A574E8', cardBg: '#F0E6FC', lockedCardBg: '#E3DCEB' },
    SSSR: { id: 'SSSR', label: '传说 SSSR', unlockGems: 160, badgeBg: '#DF8E1E', badgeText: '#FFFDF5', border: '#EDA936', cardBg: '#FFF0CD', lockedCardBg: '#ECE3D0' },
};

export interface TraitDefinition {
    id: TraitId;
    name: string;
    summary: string;
    detail: string;
    tagColor: string;
    foodBonus?: number;          // 食物饱腹回复倍率加成（例如 0.25 表示 +25%）
    cleanDecayMult?: number;     // 洁净衰减系数（例如 0.6 表示慢 40%）
    energyDecayMult?: number;    // 体力衰减系数
    restBonus?: number;          // 休息体力回复加成
    joyDecayMult?: number;       // 心情衰减系数
    playBonus?: number;          // 陪玩心情回复加成
    xpBonus?: number;            // 照顾经验加成
    adventureBonusChance?: number; // 寻宝大丰收概率加成
    adventureRiskChance?: number;  // 寻宝小遇险概率加成（胆大词条特征）
    adventureCoinMult?: number;    // 寻宝金币倍率
    adventureItemChance?: number;  // 寻宝额外带回补给道具概率
    fightChance?: number;          // 庭院触发打架滚烟云事件概率加成
    peaceChance?: number;          // 庭院劝架/贴贴安抚概率加成
}

export const PET_TRAITS: Record<TraitId, TraitDefinition> = {
    glutton: {
        id: 'glutton', name: '贪吃', tagColor: '#D97B38',
        summary: '食物回复 +25%',
        detail: '最爱干饭！使用食物类道具时饱腹恢复额外 +25%。',
        foodBonus: 0.25,
    },
    bold: {
        id: 'bold', name: '胆大', tagColor: '#C95A49',
        summary: '寻宝奇遇高 · 略易遇险',
        detail: '林间寻宝带回大丰收/好东西概率 +35%，但小遇险率略高 (+15%)。',
        adventureBonusChance: 0.35,
        adventureRiskChance: 0.15,
        adventureItemChance: 0.20,
    },
    tidy: {
        id: 'tidy', name: '爱干净', tagColor: '#4E98A8',
        summary: '洁净下降 -40%',
        detail: '每天都会仔细舔毛打理，洁净度自然下降速度减缓 40%。',
        cleanDecayMult: 0.60,
    },
    energetic: {
        id: 'energetic', name: '元气满满', tagColor: '#5B9D64',
        summary: '体力消耗 -35% · 休息 +20%',
        detail: '活力十足！体力自然消耗减慢 35%，休息恢复额外 +20%。',
        energyDecayMult: 0.65,
        restBonus: 0.20,
    },
    playful: {
        id: 'playful', name: '粘人爱玩', tagColor: '#CC6B96',
        summary: '陪玩 +25% · 照顾经验 +15%',
        detail: '最喜欢互动玩耍，陪玩心情恢复 +25%，每次照顾经验 +15%。',
        playBonus: 0.25,
        xpBonus: 0.15,
    },
    lucky: {
        id: 'lucky', name: '招财锦鲤', tagColor: '#D49428',
        summary: '寻宝金币 +25%',
        detail: '自带幸运光环，林间寻宝结算金币额外 +25%。',
        adventureCoinMult: 1.25,
        adventureBonusChance: 0.15,
    },
    gentle: {
        id: 'gentle', name: '温顺乖巧', tagColor: '#7C74BD',
        summary: '心情下降 -40%',
        detail: '性格温柔软萌，心情自然下降速度减缓 40%。',
        joyDecayMult: 0.60,
    },
    explorer: {
        id: 'explorer', name: '探险家', tagColor: '#5882B8',
        summary: '寻宝带回道具 +30%',
        detail: '嗅觉灵敏，林间寻宝额外带回随机照顾道具的概率提升 30%。',
        adventureItemChance: 0.30,
        adventureBonusChance: 0.15,
    },
    hothead: {
        id: 'hothead', name: '小暴脾气', tagColor: '#E05248',
        summary: '庭院爱打闹 · 寻宝奇遇 +20%',
        detail: '一言不合就在庭院滚烟云打闹，但胆大心细寻宝奇遇 +20%。',
        adventureBonusChance: 0.20,
        fightChance: 0.42,
    },
    peacemaker: {
        id: 'peacemaker', name: '和事佬', tagColor: '#4BAE78',
        summary: '庭院劝架贴贴 · 心情下降 -25%',
        detail: '庭院里的暖心调解员，遇到小摩擦会主动贴贴劝架，心情缓降 25%。',
        joyDecayMult: 0.75,
        peaceChance: 0.65,
    },
};

export const TRAIT_IDS: TraitId[] = Object.keys(PET_TRAITS) as TraitId[];

/** 为每个品种生成 2~3 条不重复的性格词条（主词条固定为 defaultTrait，稀有度越高词条越丰富） */
export function defaultTraitsForBreed(breedId: number): TraitId[] {
    const breed = PET_BREEDS[breedId];
    if (!breed) return ['gentle', 'peacemaker'];
    const secondaryPool: Record<number, TraitId[]> = {
        0: ['peacemaker'],
        1: ['hothead'],
        2: ['gentle'],
        3: ['playful'],
        4: ['hothead'],
        5: ['peacemaker', 'energetic'],
        6: ['tidy', 'lucky'],
        7: ['peacemaker', 'lucky'],
        8: ['playful'],
        9: ['hothead', 'playful'],
        10: ['hothead', 'explorer'],
        11: ['peacemaker', 'gentle'],
        12: ['hothead'],
        13: ['bold', 'tidy'],
        14: ['peacemaker', 'tidy'],
        15: ['gentle'],
        16: ['hothead', 'energetic'],
        17: ['peacemaker', 'lucky'],
    };
    const out: TraitId[] = [breed.defaultTrait];
    (secondaryPool[breedId] || []).forEach(t => { if (!out.includes(t)) out.push(t); });
    return out;
}

export interface BreedDefinition {
    id: number;
    name: string;
    speciesTitle: string;
    kind: PetKind;
    skin: string;
    rarity: PetRarity;
    unlockGems: number;
    defaultTrait: TraitId;
    color: string;
    accent: string;
    cost: number;
    bio: string;
}

export const PET_BREEDS: BreedDefinition[] = [
    { id: 0, name: '奶糖猫', speciesTitle: '中华田园奶糖猫', kind: 'cat', skin: 'cat_naitang', rarity: 'R', unlockGems: 50, defaultTrait: 'gentle', color: '#E6A54E', accent: '#A66630', cost: 0, bio: '软糯暖甜的小奶糖田园猫，最喜欢晒着太阳打呼噜。' },
    { id: 1, name: '布丁犬', speciesTitle: '中华田园布丁犬', kind: 'dog', skin: 'dog_buding', rarity: 'R', unlockGems: 50, defaultTrait: 'bold', color: '#BD773C', accent: '#70452D', cost: 0, bio: '元气勇敢的焦糖布丁田园犬，见到新朋友就疯狂摇尾巴。' },
    { id: 2, name: '云朵猫', speciesTitle: '英短银渐层', kind: 'cat', skin: 'cat_yunduo', rarity: 'SR', unlockGems: 80, defaultTrait: 'tidy', color: '#F6F4EF', accent: '#A5B3BC', cost: 35, bio: '毛茸茸像云朵一样的英短银渐层，最爱把自己理得一尘不染。' },
    { id: 3, name: '芝麻犬', speciesTitle: '田园黑白芝麻犬', kind: 'dog', skin: 'dog_zhima', rarity: 'R', unlockGems: 50, defaultTrait: 'explorer', color: '#777F89', accent: '#E5D3BA', cost: 45, bio: '聪明机灵的小芝麻犬，庭院里的每块石板都逃不过它的探索。' },
    { id: 4, name: '橘子猫', speciesTitle: '中华田园大橘猫', kind: 'cat', skin: 'cat_juzi', rarity: 'R', unlockGems: 50, defaultTrait: 'glutton', color: '#EFA65C', accent: '#B36F37', cost: 55, bio: '圆滚滚的中华田园橘猫，听见开罐头的声音就会飞奔而来。' },
    { id: 5, name: '桃桃犬', speciesTitle: '蜜桃奶油小犬', kind: 'dog', skin: 'dog_taotao', rarity: 'SR', unlockGems: 80, defaultTrait: 'playful', color: '#EACBB9', accent: '#B99183', cost: 65, bio: '脸蛋粉扑扑的蜜桃小狗，最喜欢叼着小球找你玩耍。' },
    { id: 6, name: '蓝胖英短', speciesTitle: '英国短毛蓝猫', kind: 'cat', skin: 'cat_yingduan', rarity: 'SSR', unlockGems: 120, defaultTrait: 'glutton', color: '#7F93A8', accent: '#5D6E82', cost: 95, bio: '拥有圆嘟嘟发腮脸蛋的英短蓝猫，琥珀大眼睛超治愈。' },
    { id: 7, name: '奶油布偶', speciesTitle: '重点色布偶猫', kind: 'cat', skin: 'cat_buou', rarity: 'SSSR', unlockGems: 160, defaultTrait: 'tidy', color: '#FAF2E6', accent: '#6B4E3F', cost: 140, bio: '蓝宝石眼眸的仙女布偶猫，性格温柔黏人，自带优雅气场。' },
    { id: 8, name: '团子三花', speciesTitle: '中华田园三花猫', kind: 'cat', skin: 'cat_sanhua', rarity: 'SR', unlockGems: 80, defaultTrait: 'lucky', color: '#F8F3EA', accent: '#E08642', cost: 80, bio: '橘黑奶白相间的幸运三花团子，传说能给庭院带来好运。' },
    { id: 9, name: '短腿柯基', speciesTitle: '彭布罗克柯基犬', kind: 'dog', skin: 'dog_keji', rarity: 'SR', unlockGems: 80, defaultTrait: 'energetic', color: '#E89B48', accent: '#FFF7EC', cost: 85, bio: '小短腿迈着超快节奏的微笑柯基，走到哪都是开心果。' },
    { id: 10, name: '赤毛柴犬', speciesTitle: '赤色柴犬', kind: 'dog', skin: 'dog_chaiquan', rarity: 'SSR', unlockGems: 120, defaultTrait: 'bold', color: '#D9823B', accent: '#FFF5E3', cost: 100, bio: '自带可爱豆豆眉的赤柴，胆大自信又爱到处探险。' },
    { id: 11, name: '阳光金毛', speciesTitle: '黄金巡回猎犬', kind: 'dog', skin: 'dog_jinmao', rarity: 'SSSR', unlockGems: 160, defaultTrait: 'lucky', color: '#E8B256', accent: '#C4842E', cost: 140, bio: '笑容像午后阳光般温暖的金毛宝宝，是庭院里最贴心的暖男。' },
    { id: 12, name: '暹罗猫', speciesTitle: '重点色暹罗猫', kind: 'cat', skin: 'cat_xianluo', rarity: 'SR', unlockGems: 80, defaultTrait: 'explorer', color: '#EEDEC8', accent: '#6B4D3B', cost: 85, bio: '挖煤小脸配蓝宝石大眼睛的机灵暹罗，好奇心爆棚。' },
    { id: 13, name: '美短虎斑', speciesTitle: '银虎斑美短猫', kind: 'cat', skin: 'cat_meiduan', rarity: 'SSR', unlockGems: 120, defaultTrait: 'energetic', color: '#C8CED6', accent: '#5E6570', cost: 105, bio: '披着银灰大理石虎斑纹的运动小健将，元气满满爱奔跑。' },
    { id: 14, name: '雪白缅因', speciesTitle: '纯白长毛缅因猫', kind: 'cat', skin: 'cat_mianyin', rarity: 'SSSR', unlockGems: 160, defaultTrait: 'lucky', color: '#FCFBF8', accent: '#E8B856', cost: 150, bio: '毛茸茸如冬日初雪的仙气大缅因，温柔大气自带锦鲤好运。' },
    { id: 15, name: '软萌比熊', speciesTitle: '卷毛棉花糖比熊', kind: 'dog', skin: 'dog_bixiong', rarity: 'SR', unlockGems: 80, defaultTrait: 'playful', color: '#FDFBF7', accent: '#E2D4C4', cost: 85, bio: '顶着蓬松棉花糖大脑袋的小比熊，最爱黏着主人撒娇玩耍。' },
    { id: 16, name: '奶萌哈士奇', speciesTitle: '西伯利亚雪橇犬', kind: 'dog', skin: 'dog_hashiqi', rarity: 'SSR', unlockGems: 120, defaultTrait: 'bold', color: '#E6EAF0', accent: '#768292', cost: 105, bio: '冰蓝眼眸的奶凶小哈士奇，外表帅气内心是个爱拆家的憨憨。' },
    { id: 17, name: '微笑萨摩耶', speciesTitle: '纯白微笑萨摩耶', kind: 'dog', skin: 'dog_samoye', rarity: 'SSSR', unlockGems: 160, defaultTrait: 'gentle', color: '#FEFCF9', accent: '#F2C6B8', cost: 150, bio: '自带治愈微笑天使光环的雪白萨摩耶，一眼融化所有烦恼。' },
];

// 6 阶 × 5 星 = 最高 30 星：每满 5 星进阶下一颜色/皇冠图标（5★金星、10★蓝星、15★紫星、20★粉星、25★金冠、30★羽翼皇冠）。
export const MAX_PET_STAR = 30;

export function starTier(star: number): number {
    return Math.max(1, Math.min(6, Math.ceil(Math.max(1, Math.floor(star)) / 5)));
}

export interface StarRequirement {
    nextStar: number;
    extraCopies: number; // 需要消耗的多余本体数（庭院本体保留不消耗）
    coins: number;
}

const TIER_COPIES: readonly (readonly number[])[] = [
    [1, 2, 2, 3],          // 1→2, 2→3, 3→4, 4→5（金星阶）
    [2, 2, 3, 3, 4],       // 5→6..9→10（蓝星阶）
    [3, 3, 4, 4, 5],       // 10→11..14→15（紫星阶）
    [4, 4, 5, 5, 6],       // 15→16..19→20（粉星阶）
    [5, 5, 6, 6, 8],       // 20→21..24→25（金冠阶）
    [6, 6, 8, 8, 10],      // 25→26..29→30（羽翼皇冠阶）
];
const TIER_COINS: readonly (readonly number[])[] = [
    [100, 200, 320, 480],
    [600, 750, 900, 1100, 1400],
    [1600, 1900, 2200, 2600, 3000],
    [3400, 3900, 4400, 5000, 5800],
    [6600, 7500, 8500, 9600, 11000],
    [12500, 14000, 16000, 18000, 22000],
];

export const STAR_REQUIREMENTS: Record<number, StarRequirement> = (() => {
    const map: Record<number, StarRequirement> = {};
    let cur = 1;
    for (let t = 0; t < TIER_COPIES.length; t++) {
        for (let step = 0; step < TIER_COPIES[t].length; step++) {
            map[cur] = { nextStar: cur + 1, extraCopies: TIER_COPIES[t][step], coins: TIER_COINS[t][step] };
            cur++;
        }
    }
    return map;
})();

export function starXpBonus(star: number): number {
    const s = Math.max(1, Math.min(MAX_PET_STAR, Math.floor(star)));
    const milestones = Math.floor(s / 5);
    return (s - 1) * 0.04 + milestones * 0.05;
}

export function starAdventureBonus(star: number): number {
    const s = Math.max(1, Math.min(MAX_PET_STAR, Math.floor(star)));
    const milestones = Math.floor(s / 5);
    return (s - 1) * 0.03 + milestones * 0.04;
}

export interface OutfitDefinition {
    id: OutfitId;
    name: string;
    price: number;
    currency: 'coins' | 'gems';
    freeAtStar?: number;
    unlockMode?: 'buy' | 'ad';
    limited?: boolean;
    effectTag?: string;
    adventureBonus?: number; // 冒险收益加成（如 0.20 = +20%）
    xpBonus?: number;        // 照顾经验加成（如 0.18 = +18%）
    decayMult?: number;      // 心情/健康衰减倍率（如 0.75 = 慢 25%）
    desc: string;
    swatch: string;
}

export const PET_OUTFITS: OutfitDefinition[] = [
    { id: 'none', name: '原生态萌毛', price: 0, currency: 'coins', desc: '清爽自然，展示本色绒毛。', swatch: '#EBD9BE' },
    { id: 'bell_collar', name: '红绳金铃铛', price: 120, currency: 'coins', desc: '经典招财红项圈配小金铃。', swatch: '#D64B42' },
    { id: 'blue_scarf', name: '海盐小围巾', price: 180, currency: 'coins', desc: '软萌天蓝色可爱三角围巾。', swatch: '#5E9FE0' },
    { id: 'pink_bow', name: '草莓蝴蝶结', price: 240, currency: 'coins', desc: '别在耳畔的立体粉色蝴蝶结。', swatch: '#F088A4' },
    { id: 'straw_hat', name: '田园小草帽', price: 320, currency: 'coins', desc: '遮阳又俏皮的夏日小草帽。', swatch: '#E7C475' },
    { id: 'flower_wreath', name: '春日花环', price: 280, currency: 'coins', effectTag: '心情缓降15%', decayMult: 0.85, desc: '清新花朵编织花环，佩戴后心情下降减缓 15%。', swatch: '#F2A2B8' },
    { id: 'star_glasses', name: '星光墨镜', price: 45, currency: 'gems', effectTag: '冒险+12%', adventureBonus: 0.12, desc: '酷萌星星墨镜，冒险带回金币与宝箱加成 +12%。', swatch: '#E5A33C' },
    { id: 'gold_crown', name: '星光小皇冠', price: 60, currency: 'gems', freeAtStar: 3, effectTag: '经验+10%', xpBonus: 0.10, desc: '闪耀小金冠（3★免费解锁），照顾经验 +10%。', swatch: '#F2BC3C' },
    { id: 'wizard_hat', name: '魔法巫师帽', price: 80, currency: 'gems', effectTag: '经验+18%', xpBonus: 0.18, desc: '星辰尖顶魔法帽，照顾伙伴获得经验 +18%。', swatch: '#4B63A6' },
    { id: 'chef_hat', name: '甜点厨师帽', price: 360, currency: 'coins', effectTag: '状态缓降18%', decayMult: 0.82, desc: '蓬松奶油甜点厨师帽，心情与健康衰减减缓 18%。', swatch: '#FFF5E2' },
    { id: 'cherry_beret', name: '樱桃贝雷帽', price: 55, currency: 'gems', effectTag: '经验+15%', xpBonus: 0.15, desc: '酒红毛呢樱桃贝雷帽，照顾伙伴获得经验 +15%。', swatch: '#B83446' },
    { id: 'explorer_hat', name: '探险家圆帽', price: 65, currency: 'gems', effectTag: '冒险+16%', adventureBonus: 0.16, desc: '指南针徽章探险家帽，冒险寻宝收益 +16%。', swatch: '#CFA976' },
    { id: 'angel_halo', name: '圣光天使环', price: 0, currency: 'gems', unlockMode: 'ad', limited: true, effectTag: '缓降25%·圣光特效', decayMult: 0.75, desc: '限定 · 圣光环绕粒子特效，心情与健康衰减减缓 25%。', swatch: '#FFE066' },
    { id: 'butterfly_wings', name: '蝶梦小翅膀', price: 0, currency: 'gems', unlockMode: 'ad', limited: true, effectTag: '冒险+20%·蝶翼特效', adventureBonus: 0.20, desc: '限定 · 灵动扇动蝶翼与星尘特效，冒险收益 +20%。', swatch: '#F5A6D6' },
    { id: 'royal_cape', name: '星月披风', price: 0, currency: 'gems', unlockMode: 'ad', limited: true, effectTag: '双+20%·星月特效', xpBonus: 0.20, adventureBonus: 0.20, desc: '限定 · 环绕星月粒子特效，经验与冒险收益双 +20%。', swatch: '#9E7AE0' },
    { id: 'sakura_aura', name: '樱花仙子环', price: 0, currency: 'gems', unlockMode: 'ad', limited: true, effectTag: '缓降28%·樱瓣特效', decayMult: 0.72, desc: '限定 · 飘舞樱花花瓣环绕特效，状态衰减减缓 28%。', swatch: '#FFB6CE' },
    { id: 'star_wings', name: '星辰精灵翼', price: 0, currency: 'gems', unlockMode: 'ad', limited: true, effectTag: '冒险+25%·流星特效', adventureBonus: 0.25, desc: '限定 · 闪耀流星环绕的精灵透明翼，冒险收益 +25%。', swatch: '#A6E0FF' },
    { id: 'rainbow_cloud', name: '彩虹云朵冠', price: 0, currency: 'gems', unlockMode: 'ad', limited: true, effectTag: '双+25%·彩虹特效', xpBonus: 0.25, adventureBonus: 0.25, desc: '限定 · 悬浮彩虹白云与七彩星光特效，经验与冒险双 +25%。', swatch: '#FFD480' },
];

export interface CoatDefinition {
    id: CoatId;
    name: string;
    tint: string;
    overlay: string | null;
    icon: string;
    price: number;
    currency: 'coins' | 'gems';
    unlockMode?: 'buy' | 'ad';
    limited?: boolean;
    effectTag?: string;
    adventureBonus?: number;
    xpBonus?: number;
    decayMult?: number;
    desc: string;
}

export const PET_COATS: CoatDefinition[] = [
    { id: 'original', name: '原版毛毛', tint: '#FFFFFF', overlay: null, icon: 'skin_original', price: 0, currency: 'coins', desc: '品种原本的自然绒毛与花纹。' },
    { id: 'cream_glow', name: '水手小套装', tint: '#FFFFFF', overlay: 'cloth_sailor', icon: 'skin_sailor', price: 100, currency: 'coins', desc: '蓝白条纹海魂水手服配红色小领结，保留原品种脸蛋毛色。' },
    { id: 'sunset_warm', name: '小蜜蜂卫衣', tint: '#FFFFFF', overlay: 'cloth_bee', icon: 'skin_bee', price: 150, currency: 'coins', desc: '暖黄可可棕条纹小蜜蜂卫衣配背后小翅膀纹饰。' },
    { id: 'sakura_blush', name: '草莓针织衣', tint: '#FFFFFF', overlay: 'cloth_strawberry', icon: 'skin_strawberry', price: 200, currency: 'coins', desc: '奶油粉草莓针织开衫配蕾丝娃娃领与珍珠扣。' },
    { id: 'dino_hoodie', name: '小恐龙连体衣', tint: '#FFFFFF', overlay: 'cloth_dino', icon: 'skin_dino', price: 260, currency: 'coins', effectTag: '状态缓降10%', decayMult: 0.90, desc: '薄荷绿软萌小恐龙连体服，状态衰减减缓 10%。' },
    { id: 'maid_apron', name: '甜心小围裙', tint: '#FFFFFF', overlay: 'cloth_maid', icon: 'skin_maid', price: 50, currency: 'gems', effectTag: '经验+12%', xpBonus: 0.12, desc: '薰衣草紫蕾丝荷叶边小围裙，照顾经验 +12%。' },
    { id: 'prince_suit', name: '星耀小礼服', tint: '#FFFFFF', overlay: 'cloth_prince', icon: 'skin_prince', price: 0, currency: 'gems', unlockMode: 'ad', limited: true, effectTag: '星光特效 · 冒险+15%', adventureBonus: 0.15, desc: '限定 · 皇家藏青金肩章小礼服，自带环绕星光特效，冒险收益 +15%。' },
    { id: 'fairy_dress', name: '花仙子纱裙', tint: '#FFFFFF', overlay: 'cloth_fairy', icon: 'skin_fairy', price: 0, currency: 'gems', unlockMode: 'ad', limited: true, effectTag: '花灵特效 · 经验状态+15%', xpBonus: 0.15, decayMult: 0.85, desc: '限定 · 粉蓝渐层花仙子蓬蓬裙，自带梦幻花灵星光特效，经验 +15% 且状态缓降 15%。' },
];

export const PET_NICKNAME_PRESETS: Record<PetKind, string[]> = {
    cat: ['小团子', '布丁咪', '糯米糍', '奶盖', '泡芙', '麻薯', '咪宝', '小年糕'],
    dog: ['旺财宝', '小饼干', '肉桂卷', '蛋挞', '曲奇', '豆包', '奶昔', '小太阳'],
};

export function sanitizeNickname(raw: string): string {
    return raw.replace(/[\r\n\t]/g, ' ').trim().slice(0, 8);
}

export function isTraitId(v: unknown): v is TraitId {
    return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PET_TRAITS, v);
}

export function isOutfitId(v: unknown): v is OutfitId {
    return typeof v === 'string' && PET_OUTFITS.some(o => o.id === v);
}

export function isCoatId(v: unknown): v is CoatId {
    return typeof v === 'string' && PET_COATS.some(c => c.id === v);
}
