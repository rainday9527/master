// 宠物核心图鉴目录：12 品种、R/SR/SSR 品质、解锁钻石奖励、性格词条、升星规则、装扮与毛色换肤。
export type PetKind = 'cat' | 'dog';
export type PetRarity = 'R' | 'SR' | 'SSR';
export type TraitId = 'glutton' | 'bold' | 'tidy' | 'energetic' | 'playful' | 'lucky' | 'gentle' | 'explorer';
export type OutfitId = 'none' | 'bell_collar' | 'blue_scarf' | 'pink_bow' | 'straw_hat' | 'gold_crown';
export type CoatId = 'original' | 'cream_glow' | 'sunset_warm' | 'sakura_blush';

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
    SSR: { id: 'SSR', label: '珍稀 SSR', unlockGems: 120, badgeBg: '#DF8E1E', badgeText: '#FFFDF5', border: '#EDA936', cardBg: '#FFF0CD', lockedCardBg: '#ECE3D0' },
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
};

export const TRAIT_IDS: TraitId[] = Object.keys(PET_TRAITS) as TraitId[];

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
    { id: 6, name: '蓝胖英短', speciesTitle: '英国短毛蓝猫', kind: 'cat', skin: 'cat_yingduan', rarity: 'SR', unlockGems: 80, defaultTrait: 'glutton', color: '#7F93A8', accent: '#5D6E82', cost: 75, bio: '拥有圆嘟嘟发腮脸蛋的英短蓝猫，琥珀大眼睛超治愈。' },
    { id: 7, name: '奶油布偶', speciesTitle: '重点色布偶猫', kind: 'cat', skin: 'cat_buou', rarity: 'SSR', unlockGems: 120, defaultTrait: 'tidy', color: '#FAF2E6', accent: '#6B4E3F', cost: 120, bio: '蓝宝石眼眸的仙女布偶猫，性格温柔黏人，自带优雅气场。' },
    { id: 8, name: '团子三花', speciesTitle: '中华田园三花猫', kind: 'cat', skin: 'cat_sanhua', rarity: 'SR', unlockGems: 80, defaultTrait: 'lucky', color: '#F8F3EA', accent: '#E08642', cost: 80, bio: '橘黑奶白相间的幸运三花团子，传说能给庭院带来好运。' },
    { id: 9, name: '短腿柯基', speciesTitle: '彭布罗克柯基犬', kind: 'dog', skin: 'dog_keji', rarity: 'SR', unlockGems: 80, defaultTrait: 'energetic', color: '#E89B48', accent: '#FFF7EC', cost: 85, bio: '小短腿迈着超快节奏的微笑柯基，走到哪都是开心果。' },
    { id: 10, name: '赤毛柴犬', speciesTitle: '赤色柴犬', kind: 'dog', skin: 'dog_chaiquan', rarity: 'SR', unlockGems: 80, defaultTrait: 'bold', color: '#D9823B', accent: '#FFF5E3', cost: 90, bio: '自带可爱豆豆眉的赤柴，胆大自信又爱到处探险。' },
    { id: 11, name: '阳光金毛', speciesTitle: '黄金巡回猎犬', kind: 'dog', skin: 'dog_jinmao', rarity: 'SSR', unlockGems: 120, defaultTrait: 'lucky', color: '#E8B256', accent: '#C4842E', cost: 120, bio: '笑容像午后阳光般温暖的金毛宝宝，是庭院里最贴心的暖男。' },
];

export const MAX_PET_STAR = 5;

export interface StarRequirement {
    nextStar: number;
    extraCopies: number; // 需要消耗的多余本体数（庭院本体保留不消耗）
    coins: number;
}

export const STAR_REQUIREMENTS: Record<number, StarRequirement> = {
    1: { nextStar: 2, extraCopies: 1, coins: 100 },
    2: { nextStar: 3, extraCopies: 2, coins: 250 },
    3: { nextStar: 4, extraCopies: 3, coins: 500 },
    4: { nextStar: 5, extraCopies: 4, coins: 1000 },
};

export function starXpBonus(star: number): number {
    return Math.max(0, star - 1) * 0.15;
}

export function starAdventureBonus(star: number): number {
    return Math.max(0, star - 1) * 0.10;
}

export interface OutfitDefinition {
    id: OutfitId;
    name: string;
    price: number;
    currency: 'coins' | 'gems';
    freeAtStar?: number;
    desc: string;
    swatch: string;
}

export const PET_OUTFITS: OutfitDefinition[] = [
    { id: 'none', name: '原生态萌毛', price: 0, currency: 'coins', desc: '清爽自然，展示本色绒毛。', swatch: '#EBD9BE' },
    { id: 'bell_collar', name: '红绳金铃铛', price: 120, currency: 'coins', desc: '经典招财红项圈配小金铃。', swatch: '#D64B42' },
    { id: 'blue_scarf', name: '海盐小围巾', price: 180, currency: 'coins', desc: '软萌天蓝色可爱三角围巾。', swatch: '#5E9FE0' },
    { id: 'pink_bow', name: '草莓蝴蝶结', price: 240, currency: 'coins', desc: '别在耳畔的立体粉色蝴蝶结。', swatch: '#F088A4' },
    { id: 'straw_hat', name: '田园小草帽', price: 320, currency: 'coins', desc: '遮阳又俏皮的夏日小草帽。', swatch: '#E7C475' },
    { id: 'gold_crown', name: '星光小皇冠', price: 60, currency: 'gems', freeAtStar: 3, desc: '闪耀小金冠（3★免费解锁）。', swatch: '#F2BC3C' },
];

export interface CoatDefinition {
    id: CoatId;
    name: string;
    tint: string;
    price: number;
    currency: 'coins' | 'gems';
    desc: string;
}

export const PET_COATS: CoatDefinition[] = [
    { id: 'original', name: '原版毛色', tint: '#FFFFFF', price: 0, currency: 'coins', desc: '品种原本的自然毛色。' },
    { id: 'cream_glow', name: '焦糖蜜糖', tint: '#F5BC6B', price: 100, currency: 'coins', desc: '暖金焦糖蜜绒换肤，像香甜小布丁。' },
    { id: 'sunset_warm', name: '薄荷星云', tint: '#9AE6D8', price: 150, currency: 'coins', desc: '清新马卡龙薄荷青换肤，梦幻治愈。' },
    { id: 'sakura_blush', name: '樱花甜粉', tint: '#FF9EC2', price: 200, currency: 'coins', desc: '高饱和樱花粉绒换肤，一眼心动。' },
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
