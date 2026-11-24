export type DailyTaskId = 'feedCat' | 'feedDog' | 'clean' | 'play' | 'rest' | 'adventure';
export interface DailyState {
    day: number;
    progress: Record<DailyTaskId, number>;
    claimed: Record<DailyTaskId, boolean>;
    packClaimed: boolean;
}
// PLACEHOLDER：奖励及补给数量待真实试玩调整；不设置全完成或广告奖励。
export const DAILY_TASKS: readonly { id: DailyTaskId; title: string; icon: string; currency: 'coins' | 'gems'; amount: number }[] = [
    { id: 'feedCat', title: '喂猫一次', icon: 'feed', currency: 'coins', amount: 100 },
    { id: 'feedDog', title: '喂狗一次', icon: 'feed', currency: 'coins', amount: 100 },
    { id: 'clean', title: '清洁一次', icon: 'clean', currency: 'coins', amount: 80 },
    { id: 'play', title: '陪玩一次', icon: 'play', currency: 'coins', amount: 80 },
    { id: 'rest', title: '休息一次', icon: 'rest', currency: 'coins', amount: 60 },
    { id: 'adventure', title: '领取冒险奖励一次', icon: 'adventure', currency: 'gems', amount: 20 },
];
// 通用食物两份分别喂猫、喂狗，清洁包和陪玩球各供一次照顾；手动领取，不自动发放。
export const DAILY_PACK = { food: 2, soap: 1, toy: 1 } as const;
export function newDaily(day: number, consumed = false): DailyState {
    return { day, progress: { feedCat: 0, feedDog: 0, clean: 0, play: 0, rest: 0, adventure: 0 },
        claimed: { feedCat: consumed, feedDog: consumed, clean: consumed, play: consumed, rest: consumed, adventure: consumed }, packClaimed: consumed };
}
export function restoreDaily(value: unknown, day: number, present: boolean): DailyState {
    if (!present) return newDaily(day);
    const state = value as DailyState | null;
    if (state && Number.isSafeInteger(state.day) && state.day >= 0 && state.day <= day &&
        typeof state.packClaimed === 'boolean' && state.progress && state.claimed &&
        DAILY_TASKS.every(task => (state.progress[task.id] === 0 || state.progress[task.id] === 1) && typeof state.claimed[task.id] === 'boolean')) {
        return advanceDaily(state, day);
    }
    // 损坏时保留整个庭院，本日权益保守封闭，次日正常刷新。
    return newDaily(day, true);
}
export function advanceDaily(state: DailyState, day: number): DailyState {
    return day > state.day ? newDaily(day) : { ...state, progress: { ...state.progress }, claimed: { ...state.claimed } };
}
export function recordDaily(state: DailyState, id: DailyTaskId): void { state.progress[id] = 1; }
