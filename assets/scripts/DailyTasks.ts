export type DailyTaskId =
    | 'feedCat'
    | 'feedDog'
    | 'clean'
    | 'play'
    | 'rest'
    | 'adventure'
    | 'shopBuy'
    | 'recruit'
    | 'heal'
    | 'furniture';

export interface DailyState {
    day: number;
    progress: Record<DailyTaskId, number>;
    claimed: Record<DailyTaskId, boolean>;
    adClaimed: Record<DailyTaskId, boolean>;
    packClaimed: boolean;
}

export const DAILY_TASKS: readonly { id: DailyTaskId; title: string; icon: string; currency: 'coins' | 'gems'; amount: number; target: number }[] = [
    { id: 'feedCat', title: '喂猫 5 次', icon: 'feed-cat', currency: 'coins', amount: 120, target: 5 },
    { id: 'feedDog', title: '喂狗 5 次', icon: 'feed-dog', currency: 'coins', amount: 120, target: 5 },
    { id: 'clean', title: '清洁/铲屎 5 次', icon: 'clean', currency: 'coins', amount: 100, target: 5 },
    { id: 'play', title: '陪玩 5 次', icon: 'play', currency: 'coins', amount: 100, target: 5 },
    { id: 'rest', title: '休息/睡觉 4 次', icon: 'rest', currency: 'coins', amount: 80, target: 4 },
    { id: 'adventure', title: '伙伴外出冒险 3 次', icon: 'adventure', currency: 'gems', amount: 25, target: 3 },
    { id: 'shopBuy', title: '商店购物 3 次', icon: 'play', currency: 'coins', amount: 120, target: 3 },
    { id: 'recruit', title: '招募伙伴 2 次', icon: 'adventure', currency: 'gems', amount: 30, target: 2 },
    { id: 'heal', title: '治疗伙伴 2 次', icon: 'clean', currency: 'coins', amount: 100, target: 2 },
    { id: 'furniture', title: '布置/摆放家具 2 次', icon: 'rest', currency: 'gems', amount: 20, target: 2 },
];

export const DAILY_PACK = { food: 2, soap: 1, toy: 1 } as const;

export function newDaily(day: number, consumed = false): DailyState {
    const progress = {} as Record<DailyTaskId, number>;
    const claimed = {} as Record<DailyTaskId, boolean>;
    const adClaimed = {} as Record<DailyTaskId, boolean>;
    DAILY_TASKS.forEach(t => {
        progress[t.id] = 0;
        claimed[t.id] = consumed;
        adClaimed[t.id] = consumed;
    });
    return { day, progress, claimed, adClaimed, packClaimed: consumed };
}

export function restoreDaily(value: unknown, day: number, present: boolean): DailyState {
    if (!present) return newDaily(day);
    const state = value as Partial<DailyState> | null;
    if (state && typeof state.day === 'number' && Number.isSafeInteger(state.day) && state.day >= 0 && state.day <= day &&
        typeof state.packClaimed === 'boolean' && state.progress && state.claimed) {
        const base = newDaily(state.day);
        DAILY_TASKS.forEach(task => {
            const p = (state.progress as Record<string, unknown>)[task.id];
            const c = (state.claimed as Record<string, unknown>)[task.id];
            const a = state.adClaimed ? (state.adClaimed as Record<string, unknown>)[task.id] : false;
            if (typeof p === 'number' && Number.isSafeInteger(p) && p >= 0) {
                base.progress[task.id] = Math.min(task.target, p);
            }
            if (typeof c === 'boolean') base.claimed[task.id] = c;
            if (typeof a === 'boolean' && (!a || base.claimed[task.id])) base.adClaimed[task.id] = a;
        });
        base.packClaimed = state.packClaimed;
        return advanceDaily(base, day);
    }
    return newDaily(day, true);
}

export function advanceDaily(state: DailyState, day: number): DailyState {
    return day > state.day
        ? newDaily(day)
        : {
            ...state,
            progress: { ...state.progress },
            claimed: { ...state.claimed },
            adClaimed: { ...state.adClaimed },
        };
}

export function recordDaily(state: DailyState, id: DailyTaskId, delta = 1): void {
    const task = DAILY_TASKS.find(t => t.id === id);
    if (!task) return;
    state.progress[id] = Math.min(task.target, (state.progress[id] || 0) + delta);
}

// ===== 成就任务系统（永久累计各类行为次数，分阶逐步提高目标并按阶位发放递增钻石奖励） =====
export type AchievementId =
    | 'feed'
    | 'clean'
    | 'play'
    | 'rest'
    | 'adventure'
    | 'recruit'
    | 'shop'
    | 'heal'
    | 'furniture'
    | 'star';

export interface AchievementDef {
    id: AchievementId;
    title: string;
    verb: string;
    icon: string;
    targets: readonly number[];
    gems: readonly number[];
}

export interface AchievementState {
    counts: Record<AchievementId, number>;
    claimedTier: Record<AchievementId, number>; // 已领取的阶数（0 表示尚未领取第 1 阶）
}

const HIGH_FREQ_TARGETS = [5, 15, 35, 70, 120, 200, 350, 600] as const;
const MID_FREQ_TARGETS = [3, 10, 25, 50, 90, 150, 250, 400] as const;
const TIER_GEMS = [20, 35, 55, 80, 120, 180, 260, 400] as const;

export const ACHIEVEMENTS: readonly AchievementDef[] = [
    { id: 'feed', title: '美食饲养员', verb: '累计喂食', icon: 'feed-cat', targets: HIGH_FREQ_TARGETS, gems: TIER_GEMS },
    { id: 'clean', title: '洁净小管家', verb: '累计清洁/铲屎', icon: 'clean', targets: HIGH_FREQ_TARGETS, gems: TIER_GEMS },
    { id: 'play', title: '快乐玩伴', verb: '累计陪玩/乐园', icon: 'play', targets: HIGH_FREQ_TARGETS, gems: TIER_GEMS },
    { id: 'rest', title: '好梦守护者', verb: '累计休息/睡觉', icon: 'rest', targets: HIGH_FREQ_TARGETS, gems: TIER_GEMS },
    { id: 'adventure', title: '冒险领航员', verb: '累计伙伴外出冒险', icon: 'adventure', targets: MID_FREQ_TARGETS, gems: TIER_GEMS },
    { id: 'recruit', title: '招募达人', verb: '累计招募伙伴', icon: 'adventure', targets: MID_FREQ_TARGETS, gems: TIER_GEMS },
    { id: 'shop', title: '庭院大买手', verb: '累计商店购物', icon: 'play', targets: MID_FREQ_TARGETS, gems: TIER_GEMS },
    { id: 'heal', title: '暖心小兽医', verb: '累计治疗伙伴', icon: 'clean', targets: MID_FREQ_TARGETS, gems: TIER_GEMS },
    { id: 'furniture', title: '庭院建筑师', verb: '累计购买/布置家具', icon: 'rest', targets: MID_FREQ_TARGETS, gems: TIER_GEMS },
    { id: 'star', title: '星级培育师', verb: '累计伙伴升星', icon: 'feed-dog', targets: MID_FREQ_TARGETS, gems: TIER_GEMS },
];

export function newAchievements(): AchievementState {
    const counts = {} as Record<AchievementId, number>;
    const claimedTier = {} as Record<AchievementId, number>;
    ACHIEVEMENTS.forEach(a => { counts[a.id] = 0; claimedTier[a.id] = 0; });
    return { counts, claimedTier };
}

export function restoreAchievements(value: unknown): AchievementState {
    const base = newAchievements();
    if (!value || typeof value !== 'object') return base;
    const raw = value as Partial<AchievementState>;
    ACHIEVEMENTS.forEach(a => {
        const c = raw.counts ? (raw.counts as Record<string, unknown>)[a.id] : 0;
        const t = raw.claimedTier ? (raw.claimedTier as Record<string, unknown>)[a.id] : 0;
        if (typeof c === 'number' && Number.isSafeInteger(c) && c >= 0) base.counts[a.id] = Math.min(100000000, c);
        if (typeof t === 'number' && Number.isSafeInteger(t) && t >= 0) base.claimedTier[a.id] = Math.min(a.targets.length, t);
    });
    return base;
}

export function recordAchievement(state: AchievementState, id: AchievementId, delta = 1): void {
    state.counts[id] = Math.min(100000000, (state.counts[id] || 0) + Math.max(0, Math.floor(delta)));
}

export function achievementTierInfo(state: AchievementState, def: AchievementDef) {
    const tier = Math.min(def.targets.length, state.claimedTier[def.id] || 0);
    const maxed = tier >= def.targets.length;
    const count = state.counts[def.id] || 0;
    const target = maxed ? def.targets[def.targets.length - 1] : def.targets[tier];
    const rewardGems = maxed ? 0 : def.gems[tier];
    return {
        tier,
        level: maxed ? def.targets.length : tier + 1,
        maxLevel: def.targets.length,
        maxed,
        count,
        target,
        rewardGems,
        claimable: !maxed && count >= target,
    };
}
