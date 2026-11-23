export type PetKind = 'cat' | 'dog';
export type ItemCategory = 'food' | 'soap' | 'toy';
export type PetStat = 'hunger' | 'clean' | 'joy' | 'energy';
export interface ItemDefinition {
    id: string;
    name: string;
    appliesTo: PetKind | 'both';
    currency: 'coins' | 'gems';
    price: number;
    effects: Partial<Record<PetStat, number>>;
    category: ItemCategory;
    weight: number;
    limit: number;
}

// PLACEHOLDER：全部为未 playtest 的初版数值。金币基准为 100/30 状态；
// 钻石品提供较高恢复或双属性以节省操作；玩具按一轮陪玩消耗，并非永久道具。
// 权重和每轮限购同为 PLACEHOLDER：常规补给较常见、限购 3，钻石品较少、限购 1。
export const ITEM_CATALOG: readonly ItemDefinition[] = [
    { id: 'cat_food', name: '猫粮', appliesTo: 'cat', currency: 'coins', price: 100, effects: { hunger: 30 }, category: 'food', weight: 5, limit: 3 },
    { id: 'dog_food', name: '狗粮', appliesTo: 'dog', currency: 'coins', price: 100, effects: { hunger: 30 }, category: 'food', weight: 5, limit: 3 },
    { id: 'fish', name: '去刺熟鱼', appliesTo: 'both', currency: 'coins', price: 180, effects: { hunger: 40, joy: 5 }, category: 'food', weight: 3, limit: 2 },
    { id: 'fish_can', name: '鱼肉罐头', appliesTo: 'cat', currency: 'gems', price: 20, effects: { hunger: 65, joy: 15 }, category: 'food', weight: 2, limit: 1 },
    { id: 'bone_chew', name: '骨形咬胶', appliesTo: 'dog', currency: 'coins', price: 160, effects: { hunger: 15, joy: 20 }, category: 'food', weight: 3, limit: 2 },
    { id: 'dental_stick', name: '洁齿磨牙棒', appliesTo: 'dog', currency: 'gems', price: 18, effects: { hunger: 20, joy: 35 }, category: 'food', weight: 2, limit: 1 },
    { id: 'cat_wand', name: '逗猫棒', appliesTo: 'cat', currency: 'coins', price: 200, effects: { joy: 40, energy: -6 }, category: 'toy', weight: 3, limit: 2 },
    { id: 'frisbee', name: '软胶飞盘', appliesTo: 'dog', currency: 'coins', price: 220, effects: { joy: 45, energy: -8 }, category: 'toy', weight: 3, limit: 2 },
    { id: 'ball', name: '橡胶小球', appliesTo: 'both', currency: 'coins', price: 150, effects: { joy: 30, energy: -5 }, category: 'toy', weight: 4, limit: 3 },
    { id: 'rope', name: '棉绳结', appliesTo: 'dog', currency: 'gems', price: 25, effects: { joy: 70, energy: -10 }, category: 'toy', weight: 2, limit: 1 },
    { id: 'shampoo', name: '宠物香波', appliesTo: 'both', currency: 'coins', price: 120, effects: { clean: 40 }, category: 'soap', weight: 4, limit: 3 },
    { id: 'brush', name: '软毛刷', appliesTo: 'both', currency: 'gems', price: 15, effects: { clean: 30, joy: 20 }, category: 'soap', weight: 2, limit: 1 },
];

export function findItem(id: string) { return ITEM_CATALOG.find(item => item.id === id); }
export function itemApplies(item: ItemDefinition, kind: PetKind) { return item.appliesTo === 'both' || item.appliesTo === kind; }
export function effectText(item: ItemDefinition) {
    const names: Record<PetStat, string> = { hunger: '饱腹', clean: '洁净', joy: '心情', energy: '体力' };
    return (Object.keys(item.effects) as PetStat[]).map(stat => names[stat] + (item.effects[stat]! > 0 ? '+' : '') + item.effects[stat]).join(' ');
}
export interface ShopSlot { id: string; remaining: number; }
export function drawShopSlots(previous: readonly ShopSlot[] = [], random: () => number = Math.random): ShopSlot[] {
    const selected: ItemDefinition[] = [];
    const pick = (predicate: (item: ItemDefinition) => boolean) => {
        const pool = ITEM_CATALOG.filter(item => !selected.includes(item) && predicate(item));
        let roll = random() * pool.reduce((sum, item) => sum + item.weight, 0);
        const item = pool.find(entry => (roll -= entry.weight) < 0) || pool[pool.length - 1];
        selected.push(item);
    };
    const catFood = (item: ItemDefinition) => item.category === 'food' && item.currency === 'coins' && itemApplies(item, 'cat');
    const dogFood = (item: ItemDefinition) => item.category === 'food' && item.currency === 'coins' && itemApplies(item, 'dog');
    pick(catFood);
    if (!selected.some(dogFood)) pick(dogFood);
    pick(item => item.currency === 'gems');
    // 食物最多占两位，三类适用保底最多再补三位，最多六次 pick，无重试循环。
    for (const species of ['cat', 'dog', 'both'] as const) {
        if (!selected.some(item => item.appliesTo === species)) pick(item => item.appliesTo === species);
    }
    if (selected.filter(item => item.currency === 'coins').length < 2) pick(item => item.currency === 'coins');
    for (let i = selected.length; i < 6; i++) pick(() => true);
    const valid = (items: readonly ItemDefinition[]) =>
        items.filter(item => item.currency === 'coins').length >= 2 &&
        items.some(item => item.currency === 'gems') && items.some(catFood) && items.some(dogFood) &&
        ['cat', 'dog', 'both'].every(species => items.some(item => item.appliesTo === species));
    if (selected.every(item => previous.some(slot => slot.id === item.id))) {
        // 有限枚举至多 6×6 个替换，不破坏食物、货币及适用保底。
        for (let index = selected.length - 1; index >= 0; index--) {
            const replacement = ITEM_CATALOG.find(item => !selected.includes(item) &&
                valid(selected.map((current, i) => i === index ? item : current)));
            if (replacement) { selected[index] = replacement; break; }
        }
    }
    return selected.map(item => ({ id: item.id, remaining: item.limit }));
}
