import { PetKind } from './ItemCatalog';
import { SlotBgTheme } from './AdventureSystem';

export type FurnitureCategory = 'bed' | 'bowl' | 'park' | 'decor';
export type FurnitureCurrency = 'coins' | 'gems';

export type FurnitureId =
    | 'cat_bed_basic'
    | 'dog_bed_basic'
    | 'cat_bed_castle'
    | 'dog_bed_villa'
    | 'cloud_bed_limited'
    | 'cat_bowl_basic'
    | 'dog_bowl_basic'
    | 'cat_bowl_fancy'
    | 'dog_bowl_fancy'
    | 'play_park_basic'
    | 'play_park_slide'
    | 'play_park_ferris'
    | 'deco_fountain'
    | 'deco_lamp'
    | 'deco_flowerbed'
    | 'deco_swing_tree';

export interface FurnitureDef {
    id: FurnitureId;
    name: string;
    category: FurnitureCategory;
    appliesTo: PetKind | 'both';
    price: number;
    currency: FurnitureCurrency;
    unlockMode?: 'buy' | 'ad';
    starter?: boolean;
    limited?: boolean;
    slotTheme: SlotBgTheme;
    effectTag: string;
    sleepRate?: number;    // 每秒睡眠恢复体力
    feedBonus?: number;    // 自动进食饱腹加成
    playBonus?: number;    // 游玩乐园心情加成
    radius: number;        // 庭院摆放占地半径（用于点击选中与防重叠参考）
    entryOffset?: [number, number]; // 宠物对齐入口/垫子前方的偏移 [dx, dz]，杜绝穿模
    hideInside?: boolean;  // 有屋顶门洞的窝（如狗屋）进入睡眠后藏身屋内仅冒 Zzz，绝不穿墙
    desc: string;
}

export interface PlacedFurniture {
    uid: number;
    id: FurnitureId;
    x: number;
    z: number;
}

export const FURNITURE_CATALOG: readonly FurnitureDef[] = [
    // 默认赠送的基础 5 件套（1 猫窝 + 1 狗窝 + 1 猫盆 + 1 狗盆 + 1 游玩乐园），同时也可在商店增购多个
    { id: 'cat_bed_basic', name: '奶油猫窝', category: 'bed', appliesTo: 'cat', price: 140, currency: 'coins', starter: true, slotTheme: 'general', effectTag: '猫窝 · 约10分回满', sleepRate: 0.17, radius: 0.72, entryOffset: [0.0, 0.28], desc: '软绵绵的奶油毛绒猫窝，小猫没体力时会自动钻进来睡觉，约 10 分钟恢复满体力。' },
    { id: 'dog_bed_basic', name: '暖木狗窝', category: 'bed', appliesTo: 'dog', price: 140, currency: 'coins', starter: true, slotTheme: 'general', effectTag: '狗窝 · 约10分回满', sleepRate: 0.17, radius: 0.78, entryOffset: [-0.36, 0.44], hideInside: true, desc: '温馨小木屋造型狗窝，小狗累了会自动从门洞钻进去打盹，约 10 分钟恢复满体力。' },
    { id: 'cat_bowl_basic', name: '小鱼猫盆', category: 'bowl', appliesTo: 'cat', price: 110, currency: 'coins', starter: true, slotTheme: 'heal', effectTag: '猫盆 · 自动喂食', feedBonus: 0, radius: 0.52, entryOffset: [0.0, 0.56], desc: '小猫饿了会自动走到猫盆前，消耗背包猫粮/通用食物进食。' },
    { id: 'dog_bowl_basic', name: '骨头狗盆', category: 'bowl', appliesTo: 'dog', price: 110, currency: 'coins', starter: true, slotTheme: 'heal', effectTag: '狗盆 · 自动喂食', feedBonus: 0, radius: 0.52, entryOffset: [0.0, 0.56], desc: '小狗饿了会自动走到狗盆前，消耗背包狗粮/通用食物进食。' },
    { id: 'play_park_basic', name: '秋千游玩乐园', category: 'park', appliesTo: 'both', price: 220, currency: 'coins', starter: true, slotTheme: 'heal', effectTag: '乐园 · 自动玩耍', playBonus: 0, radius: 0.95, entryOffset: [0.0, 0.58], desc: '猫猫狗狗会自动跑进乐园消耗玩具道具开心玩耍，恢复心情。' },

    // 进阶功能家具（蓝/绿框金币购，紫/金框钻石购，粉金彩限定看广告解锁）
    { id: 'cat_bed_castle', name: '星空猫爬架窝', category: 'bed', appliesTo: 'cat', price: 55, currency: 'gems', slotTheme: 'epic', effectTag: '猫窝 · 约7分回满', sleepRate: 0.24, radius: 0.84, entryOffset: [0.0, 0.46], desc: '多层星空绒布猫爬架窝，小猫睡眠回复加速，约 7 分钟恢复满体力。' },
    { id: 'dog_bed_villa', name: '小木屋狗窝', category: 'bed', appliesTo: 'dog', price: 60, currency: 'gems', slotTheme: 'epic', effectTag: '狗窝 · 约7分回满', sleepRate: 0.24, radius: 0.88, entryOffset: [-0.34, 0.50], hideInside: true, desc: '红瓦斜顶豪华小木屋狗窝，小狗睡眠回复加速，约 7 分钟恢复满体力。' },
    { id: 'cloud_bed_limited', name: '云朵梦境大床', category: 'bed', appliesTo: 'both', price: 0, currency: 'gems', unlockMode: 'ad', limited: true, slotTheme: 'rainbow', effectTag: '通用 · 约5分极速回满', sleepRate: 0.33, radius: 0.92, entryOffset: [0.0, 0.34], desc: '限定 · 猫狗通用的星月云朵大床，约 5 分钟即可极速恢复满体力。' },
    { id: 'cat_bowl_fancy', name: '陶瓷双格猫盆', category: 'bowl', appliesTo: 'cat', price: 240, currency: 'coins', slotTheme: 'gem', effectTag: '猫盆 · 饱腹+20%', feedBonus: 0.20, radius: 0.58, entryOffset: [0.0, 0.58], desc: '粉嫩蝴蝶结陶瓷双碗，小猫自动进食时饱腹回复额外 +20%。' },
    { id: 'dog_bowl_fancy', name: '皇家餐台狗盆', category: 'bowl', appliesTo: 'dog', price: 260, currency: 'coins', slotTheme: 'gem', effectTag: '狗盆 · 饱腹+20%', feedBonus: 0.20, radius: 0.60, entryOffset: [0.0, 0.60], desc: '实木皇冠垫高双餐台，小狗自动进食时饱腹回复额外 +20%。' },
    { id: 'play_park_slide', name: '彩虹滑梯乐园', category: 'park', appliesTo: 'both', price: 75, currency: 'gems', slotTheme: 'coin', effectTag: '乐园 · 心情+25%', playBonus: 0.25, radius: 1.05, entryOffset: [-0.24, 0.64], desc: '七彩大滑梯宠物游乐场，猫狗自动游玩时心情恢复额外 +25%。' },
    { id: 'play_park_ferris', name: '摩天轮梦幻乐园', category: 'park', appliesTo: 'both', price: 0, currency: 'gems', unlockMode: 'ad', limited: true, slotTheme: 'rainbow', effectTag: '梦幻乐园 · 心情+40%', playBonus: 0.40, radius: 1.12, entryOffset: [0.0, 0.66], desc: '限定 · 自带小摩天轮的梦幻宠物乐园，猫狗游玩心情恢复额外 +40%。' },

    // 场景装饰建筑
    { id: 'deco_fountain', name: '爪印喷泉', category: 'decor', appliesTo: 'both', price: 280, currency: 'coins', slotTheme: 'gem', effectTag: '庭院水景装饰', radius: 0.78, desc: '清凉叮咚的石雕爪印小喷泉，让庭院充满生机。' },
    { id: 'deco_lamp', name: '萤火路灯', category: 'decor', appliesTo: 'both', price: 180, currency: 'coins', slotTheme: 'general', effectTag: '庭院暖灯装饰', radius: 0.46, desc: '铁艺暖黄童话小路灯，点亮庭院温馨角落。' },
    { id: 'deco_flowerbed', name: '绣球花坛', category: 'decor', appliesTo: 'both', price: 160, currency: 'coins', slotTheme: 'heal', effectTag: '庭院花境装饰', radius: 0.68, desc: '盛开粉紫绣球花的木框花坛，装点清新花园。' },
    { id: 'deco_swing_tree', name: '樱花凉亭', category: 'decor', appliesTo: 'both', price: 0, currency: 'gems', unlockMode: 'ad', limited: true, slotTheme: 'rainbow', effectTag: '限定樱花庭院建筑', radius: 1.05, desc: '限定 · 落英缤纷的浪漫樱花小凉亭，打造高颜值梦幻主城。' },
];

export function findFurniture(id: string): FurnitureDef | undefined {
    return FURNITURE_CATALOG.find(f => f.id === id);
}

export function isFurnitureId(v: unknown): v is FurnitureId {
    return typeof v === 'string' && FURNITURE_CATALOG.some(f => f.id === v);
}

export function defaultPlacedFurniture(): PlacedFurniture[] {
    return [
        { uid: 1, id: 'cat_bed_basic', x: -4.4, z: -2.6 },
        { uid: 2, id: 'dog_bed_basic', x: 4.4, z: -2.6 },
        { uid: 3, id: 'cat_bowl_basic', x: -4.2, z: 3.6 },
        { uid: 4, id: 'dog_bowl_basic', x: 4.2, z: 3.6 },
        { uid: 5, id: 'play_park_basic', x: 0.0, z: 0.4 },
    ];
}

export function furnitureMatchesPet(def: FurnitureDef, kind: PetKind): boolean {
    return def.appliesTo === 'both' || def.appliesTo === kind;
}
