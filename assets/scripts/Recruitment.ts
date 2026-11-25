// copies 是每种伙伴的本体总数，包含庭院中的一只；不包含升星或碎片。
export interface RecruitState { total: number; claimed: number; copies: Record<string, number>; recent: number[]; }
export const RECRUIT_CONFIG = {
    single: { count: 1, cost: 300 }, ten: { count: 10, cost: 2700 },
    milestones: [10, 30, 50, 100], repeat: 100, rewardCopies: 1,
    maxTotal: 1000000, maxCopies: 1000000,
} as const;
const int = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;
export function nextMilestone(claimed: number): number {
    return RECRUIT_CONFIG.milestones.find(n => n > claimed) || (Math.floor(claimed / RECRUIT_CONFIG.repeat) + 1) * RECRUIT_CONFIG.repeat;
}
export function restoreRecruit(value: unknown, owned: readonly number[], pool: readonly number[], present: boolean): RecruitState {
    const v = value as RecruitState | null;
    const total = v && int(v.total, RECRUIT_CONFIG.maxTotal) ? v.total : present ? RECRUIT_CONFIG.maxTotal : 0;
    const claimValid = !!v && int(v.claimed, RECRUIT_CONFIG.maxTotal) && (v.claimed === 0 || RECRUIT_CONFIG.milestones.some(n => n === v.claimed) || (v.claimed >= RECRUIT_CONFIG.repeat && v.claimed % RECRUIT_CONFIG.repeat === 0));
    // 领取记录不可信时封闭截至当前次数的权益；合法高水位永不降低。
    const high = claimValid ? v!.claimed : 0;
    const safeTotal = Math.max(total, high);
    let consumed = 0;
    for (let n = nextMilestone(0); n <= safeTotal; n = nextMilestone(n)) consumed = n;
    const claimed = !present ? 0 : claimValid && int(v!.total, RECRUIT_CONFIG.maxTotal) ? high : consumed;
    const copies: Record<string, number> = {};
    pool.forEach(id => {
        const count = v && v.copies && v.copies[id];
        copies[id] = Math.max(owned.includes(id) ? 1 : 0, int(count, RECRUIT_CONFIG.maxCopies) ? count : 0);
        // 无庭院本体的库存不凭空生成新伙伴。
        if (!owned.includes(id)) copies[id] = 0;
    });
    const recent = v && Array.isArray(v.recent) && v.recent.length <= 10 && v.recent.every(id => pool.includes(id) && owned.includes(id)) ? v.recent.slice() : [];
    return { total: safeTotal, claimed, copies, recent };
}
export function drawRecruit(pool: readonly number[], count: number, random = Math.random): number[] {
    if (!pool.length || !int(count, 20000)) throw Error('招募配置无效');
    return Array.from({ length: count }, () => {
        const r = random();
        if (!Number.isFinite(r) || r < 0 || r >= 1) throw Error('招募随机值无效');
        return pool[Math.floor(r * pool.length)];
    });
}
export function grantRecruit(state: RecruitState, ids: readonly number[], total: number, claimed = state.claimed): RecruitState | null {
    if (!int(total, RECRUIT_CONFIG.maxTotal) || total < state.total || claimed < state.claimed) return null;
    const copies = { ...state.copies };
    for (const id of ids) {
        if (!Object.prototype.hasOwnProperty.call(copies, id) || copies[id] >= RECRUIT_CONFIG.maxCopies) return null;
        copies[id]++;
    }
    return { total, claimed, copies, recent: ids.slice(-10) };
}
