export type PetKind = 'cat' | 'dog';
export type ItemCategory = 'food' | 'soap' | 'toy' | 'medicine';
export type PetStat = 'hunger' | 'clean' | 'joy' | 'energy' | 'health';
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
// rationale：保留原 12 项 id、数值和限购以兼容既有库存及未刷新的货架；新增品按恢复量分档。
// 食物均为宠物适用、无调味且熟制/去骨去刺的单份补给，不替代现实中的完整膳食。
// 玩具及梳洗工具均表示一次消耗的陪玩/护理体验，不代表实物损毁；洁齿品不恢复身体洁净。
// 年龄不在宠物数据中：保留约定 id，但年龄粮展示为柔软/营养粮，不进行虚假的年龄判定。
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

    // PLACEHOLDER / rationale：组 1 为单份主食与熟肉；金币 100~600 随饱腹及双恢复递增。
    { id: 'kitten_food', name: '柔软猫粮', appliesTo: 'cat', currency: 'coins', price: 100, effects: { hunger: 30 }, category: 'food', weight: 4, limit: 3 },
    { id: 'senior_cat_food', name: '营养猫粮', appliesTo: 'cat', currency: 'coins', price: 300, effects: { hunger: 65 }, category: 'food', weight: 3, limit: 2 },
    { id: 'puppy_food', name: '柔软犬粮', appliesTo: 'dog', currency: 'coins', price: 100, effects: { hunger: 30 }, category: 'food', weight: 4, limit: 3 },
    { id: 'senior_dog_food', name: '营养犬粮', appliesTo: 'dog', currency: 'coins', price: 300, effects: { hunger: 65 }, category: 'food', weight: 3, limit: 2 },
    { id: 'chicken', name: '熟鸡胸肉', appliesTo: 'both', currency: 'coins', price: 200, effects: { hunger: 45, joy: 5 }, category: 'food', weight: 3, limit: 2 },
    { id: 'turkey', name: '熟火鸡肉', appliesTo: 'both', currency: 'coins', price: 300, effects: { hunger: 60, joy: 10 }, category: 'food', weight: 3, limit: 2 },
    { id: 'beef', name: '熟牛肉粒', appliesTo: 'both', currency: 'gems', price: 26, effects: { hunger: 70, joy: 15 }, category: 'food', weight: 2, limit: 2 },
    { id: 'salmon', name: '去刺熟三文鱼', appliesTo: 'both', currency: 'gems', price: 34, effects: { hunger: 80, joy: 20 }, category: 'food', weight: 2, limit: 1 },
    { id: 'tuna', name: '去刺熟金枪鱼', appliesTo: 'both', currency: 'gems', price: 40, effects: { hunger: 90, joy: 25 }, category: 'food', weight: 2, limit: 1 },
    { id: 'duck', name: '熟鸭肉条', appliesTo: 'both', currency: 'coins', price: 300, effects: { hunger: 55, joy: 15 }, category: 'food', weight: 3, limit: 2 },
    { id: 'cat_pouch', name: '猫湿粮包', appliesTo: 'cat', currency: 'gems', price: 40, effects: { hunger: 85, joy: 30 }, category: 'food', weight: 2, limit: 1 },
    { id: 'dog_pouch', name: '狗湿粮包', appliesTo: 'dog', currency: 'gems', price: 40, effects: { hunger: 85, joy: 30 }, category: 'food', weight: 2, limit: 1 },

    // PLACEHOLDER / rationale：组 2 零食为小份奖励；玩具恢复心情，益智互动兼有少量体力恢复。
    { id: 'freeze_chicken', name: '冻干鸡肉', appliesTo: 'both', currency: 'gems', price: 30, effects: { hunger: 70, joy: 25 }, category: 'food', weight: 2, limit: 1 },
    { id: 'freeze_fish', name: '冻干鱼肉', appliesTo: 'both', currency: 'gems', price: 30, effects: { hunger: 70, joy: 25 }, category: 'food', weight: 2, limit: 1 },
    { id: 'cat_treat', name: '猫零食条', appliesTo: 'cat', currency: 'coins', price: 200, effects: { hunger: 25, joy: 25 }, category: 'food', weight: 3, limit: 2 },
    { id: 'dog_biscuit', name: '犬用饼干', appliesTo: 'dog', currency: 'coins', price: 200, effects: { hunger: 25, joy: 25 }, category: 'food', weight: 3, limit: 2 },
    { id: 'pumpkin', name: '熟南瓜小食', appliesTo: 'both', currency: 'coins', price: 100, effects: { hunger: 20, joy: 10 }, category: 'food', weight: 4, limit: 3 },
    { id: 'carrot', name: '熟胡萝卜小食', appliesTo: 'both', currency: 'coins', price: 100, effects: { hunger: 20, joy: 10 }, category: 'food', weight: 4, limit: 3 },
    { id: 'catnip_mouse', name: '猫薄荷鼠', appliesTo: 'cat', currency: 'coins', price: 300, effects: { joy: 60 }, category: 'toy', weight: 3, limit: 2 },
    { id: 'feather_ball', name: '羽毛球', appliesTo: 'cat', currency: 'coins', price: 200, effects: { joy: 40 }, category: 'toy', weight: 3, limit: 2 },
    { id: 'cat_tunnel', name: '猫隧道', appliesTo: 'cat', currency: 'gems', price: 32, effects: { joy: 85 }, category: 'toy', weight: 2, limit: 1 },
    { id: 'scratcher', name: '猫抓板', appliesTo: 'cat', currency: 'gems', price: 24, effects: { joy: 75 }, category: 'toy', weight: 2, limit: 2 },
    { id: 'treat_ball', name: '漏食球', appliesTo: 'both', currency: 'gems', price: 35, effects: { joy: 80, energy: 20 }, category: 'toy', weight: 2, limit: 1 },
    { id: 'tug_ring', name: '拔河环', appliesTo: 'dog', currency: 'coins', price: 300, effects: { joy: 60 }, category: 'toy', weight: 3, limit: 2 },

    // PLACEHOLDER / rationale：组 3 轻松互动不额外扣体力；护理恢复身体洁净，价格随总恢复递增。
    // 所有权重均为有限正数，低频高恢复品仍可被抽到；护理/玩具均只消耗背包中的一份体验。
    { id: 'squeaky_duck', name: '发声鸭', appliesTo: 'dog', currency: 'coins', price: 200, effects: { joy: 40 }, category: 'toy', weight: 3, limit: 2 },
    { id: 'plush_rabbit', name: '毛绒兔', appliesTo: 'both', currency: 'coins', price: 300, effects: { joy: 50, energy: 15 }, category: 'toy', weight: 3, limit: 2 },
    { id: 'fetch_stick', name: '软胶抛接棒', appliesTo: 'dog', currency: 'gems', price: 24, effects: { joy: 75 }, category: 'toy', weight: 2, limit: 2 },
    { id: 'snuffle_mat', name: '嗅闻垫', appliesTo: 'both', currency: 'gems', price: 45, effects: { joy: 90, energy: 30 }, category: 'toy', weight: 2, limit: 1 },
    { id: 'puzzle_feeder', name: '益智食盘', appliesTo: 'both', currency: 'gems', price: 60, effects: { hunger: 70, joy: 80 }, category: 'toy', weight: 1, limit: 1 },
    { id: 'crinkle_fish', name: '响纸鱼', appliesTo: 'cat', currency: 'coins', price: 200, effects: { joy: 40 }, category: 'toy', weight: 3, limit: 2 },
    { id: 'catnip_pillow', name: '猫薄荷枕', appliesTo: 'cat', currency: 'gems', price: 25, effects: { joy: 60, energy: 20 }, category: 'toy', weight: 2, limit: 1 },
    { id: 'grooming_glove', name: '梳毛手套', appliesTo: 'both', currency: 'coins', price: 300, effects: { clean: 55, joy: 15 }, category: 'soap', weight: 3, limit: 2 },
    { id: 'pet_wipes', name: '宠物湿巾', appliesTo: 'both', currency: 'coins', price: 100, effects: { clean: 30 }, category: 'soap', weight: 4, limit: 3 },
    { id: 'bath_foam', name: '免洗泡沫', appliesTo: 'both', currency: 'gems', price: 36, effects: { clean: 100 }, category: 'soap', weight: 2, limit: 1 },
    { id: 'pet_towel', name: '吸水毛巾', appliesTo: 'both', currency: 'gems', price: 50, effects: { clean: 90, joy: 40 }, category: 'soap', weight: 1, limit: 1 },
    { id: 'paw_cleaner', name: '洗爪杯', appliesTo: 'both', currency: 'gems', price: 26, effects: { clean: 75, joy: 10 }, category: 'soap', weight: 2, limit: 2 },

    // 治疗药品类：用于恢复健康度与治愈生病状态（金币常规品 + 钻石急救高阶品）。
    { id: 'bandage', name: '爱心创可贴', appliesTo: 'both', currency: 'coins', price: 120, effects: { health: 25 }, category: 'medicine', weight: 4, limit: 3 },
    { id: 'pet_vitamins', name: '复合维生素', appliesTo: 'both', currency: 'coins', price: 220, effects: { health: 40, energy: 10 }, category: 'medicine', weight: 3, limit: 2 },
    { id: 'cough_syrup', name: '舒缓营养液', appliesTo: 'both', currency: 'coins', price: 320, effects: { health: 55, joy: 10 }, category: 'medicine', weight: 3, limit: 2 },
    { id: 'herbal_salve', name: '草本疗愈膏', appliesTo: 'both', currency: 'gems', price: 22, effects: { health: 65, clean: 15 }, category: 'medicine', weight: 2, limit: 2 },
    { id: 'magic_elixir', name: '活力急救药水', appliesTo: 'both', currency: 'gems', price: 32, effects: { health: 85, energy: 25 }, category: 'medicine', weight: 2, limit: 1 },
    { id: 'first_aid_kit', name: '萌宠急救箱', appliesTo: 'both', currency: 'gems', price: 42, effects: { health: 100, joy: 20 }, category: 'medicine', weight: 2, limit: 1 },
];

export function findItem(id: string) { return ITEM_CATALOG.find(item => item.id === id); }
export function itemApplies(item: ItemDefinition, kind: PetKind) { return item.appliesTo === 'both' || item.appliesTo === kind; }
export function effectText(item: ItemDefinition) {
    const names: Record<PetStat, string> = { hunger: '饱腹', clean: '洁净', joy: '心情', energy: '体力', health: '健康' };
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
    // 每轮货架保底至少 1 格治疗药品，方便玩家及时购买治病道具。
    pick(item => item.category === 'medicine');
    // 每轮 6 格货架保底至少 2 格钻石高阶品 + 至少 3 格金币常规品，均衡金币与钻石消费体验。
    while (selected.filter(item => item.currency === 'gems').length < 2) pick(item => item.currency === 'gems');
    const coinsNeeded = () => Math.max(0, 3 - selected.filter(item => item.currency === 'coins').length);
    for (const species of ['cat', 'dog', 'both'] as const) {
        if (selected.length < 6 && !selected.some(item => item.appliesTo === species)) {
            // 剩余格位不足以再补齐金币保底时，物种保底只从金币品中抽取。
            const mustCoin = 6 - selected.length <= coinsNeeded();
            pick(item => item.appliesTo === species && (!mustCoin || item.currency === 'coins'));
        }
    }
    while (selected.length < 6 && selected.filter(item => item.currency === 'coins').length < 3) pick(item => item.currency === 'coins');
    for (let i = selected.length; i < 6; i++) pick(() => true);
    const valid = (items: readonly ItemDefinition[]) =>
        items.filter(item => item.currency === 'coins').length >= 3 &&
        items.filter(item => item.currency === 'gems').length >= 2 && items.some(catFood) && items.some(dogFood) &&
        items.some(item => item.category === 'medicine') &&
        ['cat', 'dog', 'both'].every(species => items.some(item => item.appliesTo === species));
    if (selected.every(item => previous.some(slot => slot.id === item.id))) {
        // 有限枚举至多 6×ITEM_CATALOG.length 个替换，不破坏食物、货币及适用保底。
        for (let index = selected.length - 1; index >= 0; index--) {
            const replacement = ITEM_CATALOG.find(item => !selected.includes(item) &&
                valid(selected.map((current, i) => i === index ? item : current)));
            if (replacement) { selected[index] = replacement; break; }
        }
    }
    return selected.map(item => ({ id: item.id, remaining: item.limit }));
}
