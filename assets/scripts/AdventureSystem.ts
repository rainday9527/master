import { ITEM_CATALOG, ItemDefinition, PetKind, itemApplies } from './ItemCatalog';

export type TombstoneId =
    | 'tomb_stone'
    | 'tomb_wood'
    | 'tomb_wreath'
    | 'tomb_cat'
    | 'tomb_dog'
    | 'tomb_sleep'
    | 'tomb_angel'
    | 'tomb_star'
    | 'tomb_rose';

export type SlotBgTheme = 'general' | 'heal' | 'gem' | 'epic' | 'coin' | 'rainbow';

export interface TombstoneDef {
    id: TombstoneId;
    name: string;
    priceGems: number;
    unlockMode: 'gems' | 'ad';
    limited?: boolean;
    slotTheme: SlotBgTheme;
    artKey: string;
    desc: string;
}

export const TOMBSTONE_CATALOG: readonly TombstoneDef[] = [
    { id: 'tomb_stone', name: '简约爪印石碑', priceGems: 60, unlockMode: 'gems', slotTheme: 'general', artKey: 'tomb-stone', desc: '温润青灰小石碑，刻有可爱爪印' },
    { id: 'tomb_wood', name: '花草木质碑', priceGems: 90, unlockMode: 'gems', slotTheme: 'heal', artKey: 'tomb-wood', desc: '暖木庭院纪念牌，小花青草相伴' },
    { id: 'tomb_wreath', name: '四季花环碑', priceGems: 120, unlockMode: 'gems', slotTheme: 'heal', artKey: 'tomb-wreath', desc: '青苔石碑点缀绚丽四季花环' },
    { id: 'tomb_cat', name: '猫耳幸运碑', priceGems: 150, unlockMode: 'gems', slotTheme: 'gem', artKey: 'tomb-cat', desc: '猫耳造型石碑，四叶草与小鱼骨环绕' },
    { id: 'tomb_dog', name: '骨头项圈碑', priceGems: 150, unlockMode: 'gems', slotTheme: 'gem', artKey: 'tomb-dog', desc: '骨头石雕与缤纷项圈，守护忠诚记忆' },
    { id: 'tomb_sleep', name: '暖阳眠猫碑', priceGems: 220, unlockMode: 'gems', slotTheme: 'epic', artKey: 'tomb-sleep', desc: '常春藤金石台座，甜睡小猫静守庭院' },
    { id: 'tomb_angel', name: '天使羽翼碑', priceGems: 0, unlockMode: 'ad', limited: true, slotTheme: 'rainbow', artKey: 'tomb-angel', desc: '限定 · 洁白羽翼大理石碑与暖灯守望' },
    { id: 'tomb_star', name: '星光水晶罩', priceGems: 0, unlockMode: 'ad', limited: true, slotTheme: 'rainbow', artKey: 'tomb-star', desc: '限定 · 琉璃星愿花境，满载璀璨回忆' },
    { id: 'tomb_rose', name: '玫瑰圣光拱门', priceGems: 0, unlockMode: 'ad', limited: true, slotTheme: 'rainbow', artKey: 'tomb-rose', desc: '限定 · 玫瑰藤蔓拱门与金色光环永恒祝福' },
];

export function findTombstone(id: string): TombstoneDef | undefined {
    return TOMBSTONE_CATALOG.find(t => t.id === id);
}

export interface MemorialRecord {
    petId: number;
    tombstoneId: TombstoneId;
    customName: string;
    epitaph: string;
    diedAt: number;
    deathReason: string;
    erectedAt: number;
}

export type AdventureEventType =
    | 'depart'
    | 'food'
    | 'toy'
    | 'medicine'
    | 'treasure'
    | 'social'
    | 'dirty'
    | 'injured'
    | 'lost'
    | 'death_trafficker'
    | 'death_sick'
    | 'chest'
    | 'stray_bring';

export interface AdventureLogEntry {
    id: number;
    time: number;
    petId: number;
    petName: string;
    type: AdventureEventType;
    title: string;
    text: string;
    itemId?: string;
    itemCount?: number;
    coins?: number;
    gems?: number;
    resolved?: boolean;
}

export interface IdleRewardPreview {
    cappedMs: number;
    minutes: number;
    ready: boolean;
    coins: number;
    gems: number;
    itemCount: number;
}

export const MAX_IDLE_MS = 24 * 3600 * 1000;

export function calcIdleRewardPreview(elapsedMs: number, alivePetCount: number): IdleRewardPreview {
    const cappedMs = Math.max(0, Math.min(MAX_IDLE_MS, elapsedMs));
    const minutes = Math.floor(cappedMs / 60000);
    const petMult = 1 + Math.min(6, Math.max(1, alivePetCount) - 1) * 0.14;
    const coins = minutes >= 1 ? Math.max(15, Math.round(minutes * 3.2 * petMult)) : 0;
    // 挂机钻石产出大幅提升：每分钟随存活伙伴数成长，每小时约 45~75 钻，24 小时满挂机可达 900~1500+ 钻
    const gems = minutes >= 1 ? Math.max(3, Math.round(minutes * 0.65 * petMult) + Math.floor(minutes / 60) * 10) : 0;
    const itemCount = minutes >= 30 ? Math.min(6, Math.floor(minutes / 30)) : (minutes >= 5 ? 1 : 0);
    return { cappedMs, minutes, ready: minutes >= 1, coins, gems, itemCount };
}

export function rollIdleBonusItems(count: number, random: () => number = Math.random): { id: string; count: number }[] {
    if (count <= 0) return [];
    const map = new Map<string, number>();
    for (let i = 0; i < count; i++) {
        const item = ITEM_CATALOG[Math.floor(random() * ITEM_CATALOG.length)];
        map.set(item.id, (map.get(item.id) || 0) + 1);
    }
    return Array.from(map.entries()).map(([id, c]) => ({ id, count: c }));
}

export interface RolledAdventureOutcome {
    type: AdventureEventType;
    title: string;
    text: string;
    item?: ItemDefinition;
    itemCount?: number;
    coins?: number;
    gems?: number;
    cleanDelta?: number;
    cleanSetMax?: number;
    healthDelta?: number;
    joyDelta?: number;
    setLost?: boolean;
    setDead?: boolean;
    deathReason?: string;
    bringStray?: boolean;
}

export function eventBadgeMeta(type: AdventureEventType): { label: string; color: string } {
    switch (type) {
        case 'depart': return { label: '探险出发', color: '#4B9CD3' };
        case 'food': return { label: '美食收获', color: '#E69128' };
        case 'toy': return { label: '玩具收获', color: '#8A63D2' };
        case 'medicine': return { label: '医药发现', color: '#2F9E44' };
        case 'treasure': return { label: '路边宝藏', color: '#D49B1A' };
        case 'social': return { label: '奇遇趣事', color: '#E26D8A' };
        case 'dirty': return { label: '脏污事件', color: '#8C6239' };
        case 'injured': return { label: '打架受伤', color: '#D9534F' };
        case 'lost': return { label: '走失警报', color: '#C94A29' };
        case 'death_trafficker': return { label: '遭遇贩子', color: '#6E2B2B' };
        case 'death_sick': return { label: '重病离世', color: '#5A5560' };
        case 'chest': return { label: '宝箱收获', color: '#C98A1A' };
        case 'stray_bring': return { label: '带回流浪', color: '#E07A3F' };
    }
}

export function itemCategoryTag(item: ItemDefinition): string {
    return item.category === 'food' ? '食物' : item.category === 'toy' ? '玩具' : item.category === 'soap' ? '清洁' : '药品';
}

export function makeDepartOutcome(petName: string): RolledAdventureOutcome {
    const lines = [
        `「${petName}」摇着尾巴悄悄钻过庭院木门，独自踏上了阳光花径的冒险之旅！`,
        `「${petName}」背起小行囊，趁着微风出门去林间小路探险啦！`,
        `「${petName}」听见远处小鸟叽喳叫，好奇地跑出小院开始巡逻探险！`,
    ];
    return { type: 'depart', title: '独自出门冒险', text: lines[Math.floor(Math.random() * lines.length)] };
}

export function makeLostOutcome(petName: string): RolledAdventureOutcome {
    return {
        type: 'lost',
        title: '贪玩走丢了',
        text: `「${petName}」追着一只蓝蝴蝶跑进陌生巷口迷路了，暂时没有回到庭院！快去把它找回来吧。`,
        setLost: true,
    };
}

export function makeTraffickerDeathOutcome(petName: string): RolledAdventureOutcome {
    return {
        type: 'death_trafficker',
        title: '遭遇猫狗贩子',
        text: `「${petName}」在偏远路口冒险时不幸遭遇猫狗贩子，永远离开了小院……`,
        setDead: true,
        deathReason: '冒险途中遭遇猫狗贩子',
    };
}

export function makeStrayBringOutcome(petName: string): RolledAdventureOutcome {
    const lines = [
        `「${petName}」在林间小路遇见一只瑟瑟发抖的流浪毛孩子，一路护送着把它带回了庭院门口！`,
        `「${petName}」冒险途中被一只瘦弱的流浪小伙伴黏住了，干脆把它领回院子等你决定去留！`,
    ];
    return {
        type: 'stray_bring',
        title: '带回流浪小伙伴',
        text: lines[Math.floor(Math.random() * lines.length)],
        joyDelta: 6,
        bringStray: true,
    };
}

export function rollAdventureEvent(
    petName: string,
    petKind: PetKind,
    health: number,
    joy: number,
    random: () => number = Math.random,
): RolledAdventureOutcome {
    const r = random();
    const pickCat = (cat: ItemDefinition['category']) => {
        const pool = ITEM_CATALOG.filter(it => it.category === cat && itemApplies(it, petKind));
        return pool[Math.floor(random() * pool.length)] || ITEM_CATALOG[0];
    };

    // 高危极端事件：仅当健康与心情均极低时有极低概率触发猫狗贩子
    if (health < 25 && joy < 25 && r < 0.04) {
        return makeTraffickerDeathOutcome(petName);
    }
    // 走丢事件（约 4%）
    if (r < 0.08) {
        return makeLostOutcome(petName);
    }
    // 捡到吃的（24%）
    if (r < 0.32) {
        const item = pickCat('food');
        const lines = [
            `「${petName}」在面包店后门嗅到了香气，惊喜地捡回了一份【${item.name}】！`,
            `「${petName}」帮路边老奶奶赶走了偷吃的小松鼠，获赠一份【${item.name}】！`,
            `「${petName}」在草丛野餐垫旁发现了完好的【${item.name}】，开心叼回仓库！`,
        ];
        return { type: 'food', title: '捡到美味食物', text: lines[Math.floor(random() * lines.length)], item, itemCount: 1, joyDelta: 6 };
    }
    // 捡到玩的（20%）
    if (r < 0.52) {
        const item = pickCat('toy');
        const lines = [
            `「${petName}」在公园长椅下翻出一个崭新的【${item.name}】，一路蹦跳着带回家！`,
            `「${petName}」和路过的小朋友玩捉迷藏，收获了心仪的【${item.name}】！`,
        ];
        return { type: 'toy', title: '捡到有趣玩具', text: lines[Math.floor(random() * lines.length)], item, itemCount: 1, joyDelta: 10 };
    }
    // 捡到药品/清洁护理（12%）
    if (r < 0.64) {
        const item = pickCat(random() < 0.6 ? 'medicine' : 'soap');
        return {
            type: 'medicine',
            title: '发现贴心补给',
            text: `「${petName}」在宠物驿站门口捡到一份爱心补给【${item.name}】，已存入背包！`,
            item,
            itemCount: 1,
        };
    }
    // 路边宝藏（14%）
    if (r < 0.78) {
        const coins = 35 + Math.floor(random() * 55);
        const gems = random() < 0.45 ? 3 + Math.floor(random() * 6) : 0;
        return {
            type: 'treasure',
            title: '发现林间小宝藏',
            text: `「${petName}」在石板缝里刨出一枚闪闪发亮的旧钱袋，带回金币 +${coins}${gems > 0 ? `、钻石 +${gems}` : ''}！`,
            coins,
            gems,
            joyDelta: 8,
        };
    }
    // 带回流浪猫狗（8%）
    if (r < 0.86) {
        return makeStrayBringOutcome(petName);
    }
    // 掉进垃圾桶需要清洁（6%）
    if (r < 0.92) {
        return {
            type: 'dirty',
            title: '掉进垃圾桶弄脏了',
            text: `「${petName}」好奇钻进路边垃圾桶翻找，结果滚得满身脏兮兮的，回家后急需洗澡清洁！`,
            cleanSetMax: 10,
            joyDelta: -8,
        };
    }
    // 与其他猫狗打架受伤（4%）
    if (r < 0.96) {
        return {
            type: 'injured',
            title: '与其他伙伴打架受伤',
            text: `「${petName}」在林间小道为争抢一根漂亮树枝和流浪霸王发生了小冲突，健康度大幅下降，快给它治疗吧！`,
            healthDelta: -32,
            joyDelta: -10,
        };
    }
    // 温暖奇遇（4%）
    return {
        type: 'social',
        title: '花海晒太阳奇遇',
        text: `「${petName}」在向日葵花田里结识了一只温柔的小刺猬，一起晒了会儿太阳，心情变得超好！`,
        joyDelta: 15,
        coins: 20,
    };
}
