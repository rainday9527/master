export type RewardedVideoResult = 'completed' | 'cancelled' | 'failed';
export interface RewardedVideoProvider {
    show(onResult: (result: RewardedVideoResult) => void): void;
    destroy?(): void;
}

type Handler = (result?: { isEnded?: boolean }) => void;
interface RewardedAd {
    onLoad(cb: Handler): void;
    onError(cb: Handler): void;
    onClose(cb: Handler): void;
    offLoad?(cb: Handler): void;
    offError?(cb: Handler): void;
    offClose?(cb: Handler): void;
    load(): Promise<unknown>;
    show(): Promise<unknown>;
    destroy(): void;
}
interface Host {
    innerWidth?: number;
    innerHeight?: number;
    tap?: {
        createRewardedVideoAd(options: { adUnitId: string; orientation: 'landscape' | 'portrait' }): RewardedAd;
        getSystemInfoSync?(): { windowWidth?: number; windowHeight?: number; screenWidth?: number; screenHeight?: number };
    };
}

// 只使用宿主注入的官方 SDK，不向浏览器注入脚本，也不模拟广告完成。
export class TapTapRewardedVideoProvider implements RewardedVideoProvider {
    private disposed = false;
    private active: { ad: RewardedAd; finish: (result: RewardedVideoResult) => void } | null = null;

    constructor(private host: Host = globalThis as unknown as Host) {}

    show(onResult: (result: RewardedVideoResult) => void): void {
        if (this.disposed || this.active) { onResult('failed'); return; }
        const tap = this.host.tap;
        if (!tap || typeof tap.createRewardedVideoAd !== 'function') { onResult('failed'); return; }
        let width = this.host.innerWidth, height = this.host.innerHeight;
        if (!(Number.isFinite(width) && width! > 0 && Number.isFinite(height) && height! > 0)) {
            try {
                const info = tap.getSystemInfoSync?.();
                width = info?.windowWidth; height = info?.windowHeight;
                if (!(Number.isFinite(width) && width! > 0 && Number.isFinite(height) && height! > 0)) {
                    width = info?.screenWidth; height = info?.screenHeight;
                }
            } catch { onResult('failed'); return; }
        }
        if (!(Number.isFinite(width) && width! > 0 && Number.isFinite(height) && height! > 0)) { onResult('failed'); return; }
        const orientation = width! > height! ? 'landscape' : 'portrait';
        let ad: RewardedAd;
        try {
            ad = tap.createRewardedVideoAd({ adUnitId: orientation === 'landscape' ? '1054323' : '1054324', orientation });
        } catch { onResult('failed'); return; }
        let settled = false;
        let timer: ReturnType<typeof setTimeout>;
        const loaded: Handler = () => {};
        const error: Handler = () => finish('failed');
        const closed: Handler = result => finish(result && result.isEnded === true ? 'completed' : 'cancelled');
        const finish = (result: RewardedVideoResult) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            this.active = null;
            try { ad.offLoad?.(loaded); } catch {}
            try { ad.offError?.(error); } catch {}
            try { ad.offClose?.(closed); } catch {}
            try { ad.destroy(); } catch {}
            onResult(result);
        };
        this.active = { ad, finish };
        timer = setTimeout(() => finish('failed'), 180000);
        try {
            ad.onLoad(loaded); ad.onError(error); ad.onClose(closed);
            // 预加载失败不视为观看完成；show 失败仅允许恢复重试一次。
            Promise.resolve(ad.load()).catch(() => {});
            Promise.resolve(ad.show()).catch(() => {
                if (settled || this.disposed) return;
                return Promise.resolve(ad.load()).then(() => {
                    if (!settled && !this.disposed) return ad.show();
                }).catch(() => finish('failed'));
            });
        } catch { finish('failed'); }
    }

    destroy(): void {
        this.disposed = true;
        this.active?.finish('failed');
    }
}
