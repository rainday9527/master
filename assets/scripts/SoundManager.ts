/**
 * SoundManager: 零外链依赖的 Web Audio API 治愈绘本风音乐与音效引擎
 * - 主城 BGM（温暖八音盒/木琴华尔兹）与冒险 BGM（轻快林间长笛与拨弦）自动无缝切换
 * - 全套交互/放置/洗澡/打架/吃饭/睡觉/生病/治疗/领奖/猫叫/狗叫音效
 * - 自动处理浏览器首次点击解锁 AudioContext，实时响应「设置」面板的背景音乐与音效开关
 */

export type BgmMode = 'none' | 'home' | 'adventure';
export type SfxName =
    | 'click'
    | 'reward'
    | 'place'
    | 'cat_meow'
    | 'dog_bark'
    | 'bath'
    | 'eat'
    | 'sleep'
    | 'fight'
    | 'sick'
    | 'heal';

// 音名频率表（Hz）
const NOTE: Record<string, number> = {
    C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, B3: 246.94,
    C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
    C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00, B5: 987.77,
    C6: 1046.50,
};

// 主城治愈八音盒旋律（C大调温暖圆舞曲，16 拍循环）
const HOME_MELODY: readonly (string | null)[] = [
    'E5', 'G5', 'A5', 'G5', 'E5', 'C5', 'D5', null,
    'F5', 'A5', 'G5', 'E5', 'D5', 'E5', 'C5', null,
    'G5', 'E5', 'C5', 'D5', 'E5', 'G5', 'A5', null,
    'G5', 'F5', 'E5', 'D5', 'C5', null, null, null,
];
const HOME_BASS: readonly (string | null)[] = [
    'C3', null, 'G3', null, 'A3', null, 'E3', null,
    'F3', null, 'C4', null, 'G3', null, 'C3', null,
    'C3', null, 'G3', null, 'A3', null, 'F3', null,
    'G3', null, 'G3', null, 'C3', null, 'G3', null,
];

// 冒险轻快林间行进旋律（G大调/C大调跳跃感，16 拍循环）
const ADV_MELODY: readonly (string | null)[] = [
    'G4', 'B4', 'D5', 'G5', 'E5', 'D5', 'B4', null,
    'C5', 'E5', 'G5', 'E5', 'D5', 'C5', 'B4', null,
    'A4', 'C5', 'E5', 'D5', 'B4', 'D5', 'G5', null,
    'E5', 'D5', 'B4', 'A4', 'G4', null, 'D5', null,
];
const ADV_BASS: readonly (string | null)[] = [
    'G3', null, 'D3', null, 'E3', null, 'B3', null,
    'C3', null, 'G3', null, 'G3', null, 'D3', null,
    'A3', null, 'E3', null, 'G3', null, 'D3', null,
    'C3', null, 'D3', null, 'G3', null, 'D3', null,
];

class SoundManagerImpl {
    private ctx: AudioContext | null = null;
    private noiseBuf: AudioBuffer | null = null;
    private bgmEnabled = true;
    private sfxEnabled = true;
    private bgmMode: BgmMode = 'home';
    private bgmTimer: ReturnType<typeof setInterval> | null = null;
    private bgmStep = 0;
    private unlocked = false;
    private unlockBound = false;
    private lastSfxAt: Partial<Record<SfxName, number>> = {};

    public init(bgmOn = true, sfxOn = true) {
        this.bgmEnabled = bgmOn;
        this.sfxEnabled = sfxOn;
        this.bindUnlockListeners();
        if (this.unlocked && this.bgmEnabled && this.bgmMode !== 'none') {
            this.startBgmLoop();
        }
    }

    private getCtx(): AudioContext | null {
        if (typeof window === 'undefined') return null;
        if (!this.ctx) {
            const Ctor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
                || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!Ctor) return null;
            try {
                this.ctx = new Ctor();
            } catch {
                return null;
            }
        }
        return this.ctx;
    }

    private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
        if (this.noiseBuf && this.noiseBuf.sampleRate === ctx.sampleRate) return this.noiseBuf;
        const len = Math.floor(ctx.sampleRate * 1.2);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < len; i++) {
            const white = Math.random() * 2 - 1;
            b0 = 0.997 * b0 + white * 0.029;
            b1 = 0.985 * b1 + white * 0.032;
            b2 = 0.950 * b2 + white * 0.048;
            data[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2 + white * 0.18) * 1.6));
        }
        this.noiseBuf = buf;
        return buf;
    }

    private bindUnlockListeners() {
        if (this.unlockBound || typeof window === 'undefined') return;
        this.unlockBound = true;
        const unlock = () => {
            const ctx = this.getCtx();
            if (!ctx) return;
            if (ctx.state === 'suspended') {
                ctx.resume().then(() => {
                    this.unlocked = true;
                    if (this.bgmEnabled && this.bgmMode !== 'none') this.startBgmLoop();
                }).catch(() => {});
            } else {
                this.unlocked = true;
                if (this.bgmEnabled && this.bgmMode !== 'none') this.startBgmLoop();
            }
        };
        window.addEventListener('pointerdown', unlock, { passive: true });
        window.addEventListener('touchstart', unlock, { passive: true });
        window.addEventListener('keydown', unlock, { passive: true });
    }

    public setBgmEnabled(enabled: boolean) {
        this.bgmEnabled = enabled;
        if (!enabled) {
            this.stopBgmLoop();
        } else if (this.bgmMode !== 'none') {
            const ctx = this.getCtx();
            if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
            this.startBgmLoop();
        }
    }

    public setSfxEnabled(enabled: boolean) {
        this.sfxEnabled = enabled;
    }

    public setBgmMode(mode: BgmMode) {
        if (this.bgmMode === mode) return;
        this.bgmMode = mode;
        this.bgmStep = 0;
        if (mode === 'none' || !this.bgmEnabled) {
            this.stopBgmLoop();
        } else if (this.unlocked) {
            this.stopBgmLoop();
            this.startBgmLoop();
        }
    }

    public getState() {
        return {
            bgmEnabled: this.bgmEnabled,
            sfxEnabled: this.sfxEnabled,
            bgmMode: this.bgmMode,
            bgmRunning: this.bgmTimer !== null,
            unlocked: this.unlocked,
        };
    }

    private stopBgmLoop() {
        if (this.bgmTimer !== null) {
            clearInterval(this.bgmTimer);
            this.bgmTimer = null;
        }
    }

    private startBgmLoop() {
        this.stopBgmLoop();
        if (!this.bgmEnabled || this.bgmMode === 'none') return;
        const isAdv = this.bgmMode === 'adventure';
        const stepMs = isAdv ? 245 : 370; // 冒险更轻快，主城更舒缓治愈
        const tick = () => {
            if (!this.bgmEnabled || this.bgmMode === 'none') { this.stopBgmLoop(); return; }
            const ctx = this.getCtx();
            if (!ctx || ctx.state !== 'running') return;
            const now = ctx.currentTime + 0.02;
            const melody = isAdv ? ADV_MELODY : HOME_MELODY;
            const bass = isAdv ? ADV_BASS : HOME_BASS;
            const idx = this.bgmStep % melody.length;
            this.bgmStep++;

            const mNote = melody[idx];
            if (mNote && NOTE[mNote]) {
                this.playTone(ctx, NOTE[mNote], now, isAdv ? 0.21 : 0.34, isAdv ? 'triangle' : 'sine', isAdv ? 0.055 : 0.06, isAdv ? 1800 : 1400);
                // 主城八音盒泛音点缀
                if (!isAdv) {
                    this.playTone(ctx, NOTE[mNote] * 2, now, 0.14, 'sine', 0.014, 2400);
                }
            }
            const bNote = bass[idx];
            if (bNote && NOTE[bNote]) {
                this.playTone(ctx, NOTE[bNote], now, isAdv ? 0.20 : 0.42, 'triangle', isAdv ? 0.042 : 0.036, 700);
            }
            // 冒险背景轻快小木鱼/沙锤节拍
            if (isAdv && idx % 2 === 1) {
                this.playFilteredNoise(ctx, now, 0.035, 3200, 'highpass', 0.018);
            }
        };
        tick();
        this.bgmTimer = setInterval(tick, stepMs);
    }

    private playTone(
        ctx: AudioContext,
        freq: number,
        start: number,
        dur: number,
        type: OscillatorType,
        vol: number,
        lpfFreq = 2600,
        endFreq?: number
    ) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(lpfFreq, start);
        osc.type = type;
        osc.frequency.setValueAtTime(freq, start);
        if (endFreq && endFreq !== freq) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), start + dur);
        }
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(vol, start + Math.min(0.02, dur * 0.25));
        gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + dur + 0.02);
    }

    private playFilteredNoise(
        ctx: AudioContext,
        start: number,
        dur: number,
        freq: number,
        filterType: BiquadFilterType,
        vol: number
    ) {
        const src = ctx.createBufferSource();
        src.buffer = this.getNoiseBuffer(ctx);
        const filter = ctx.createBiquadFilter();
        filter.type = filterType;
        filter.frequency.setValueAtTime(freq, start);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(vol, start + Math.min(0.025, dur * 0.3));
        gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        src.start(start);
        src.stop(start + dur + 0.02);
    }

    public playSfx(name: SfxName) {
        if (!this.sfxEnabled) return;
        const nowMs = Date.now();
        const cooldown = (name === 'cat_meow' || name === 'dog_bark') ? 450 : name === 'click' ? 60 : 140;
        if (nowMs - (this.lastSfxAt[name] || 0) < cooldown) return;
        this.lastSfxAt[name] = nowMs;

        const ctx = this.getCtx();
        if (!ctx) return;
        if (ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
            return;
        }
        const t = ctx.currentTime + 0.005;

        switch (name) {
            case 'click': {
                // 清脆温暖木质点击音
                this.playTone(ctx, 560, t, 0.065, 'sine', 0.13, 2400, 740);
                this.playTone(ctx, 980, t + 0.01, 0.045, 'triangle', 0.05, 2800);
                break;
            }
            case 'reward': {
                // 闪亮四音领奖和弦
                const notes = [523.25, 659.25, 783.99, 1046.5];
                notes.forEach((f, i) => {
                    this.playTone(ctx, f, t + i * 0.065, 0.22, 'sine', 0.12, 3200);
                    this.playTone(ctx, f * 1.5, t + i * 0.065, 0.12, 'triangle', 0.035, 3600);
                });
                break;
            }
            case 'place': {
                // 放置建筑：温润木块落地“咚” + 轻脆星光确认音
                this.playTone(ctx, 185, t, 0.11, 'sine', 0.22, 600, 78);
                this.playFilteredNoise(ctx, t, 0.055, 520, 'lowpass', 0.09);
                this.playTone(ctx, 523.25, t + 0.06, 0.12, 'triangle', 0.09, 2600);
                this.playTone(ctx, 783.99, t + 0.11, 0.16, 'sine', 0.09, 2800);
                break;
            }
            case 'cat_meow': {
                // 软萌小猫「喵~」滑音共振峰
                const base = 540 + Math.random() * 90;
                const osc = ctx.createOscillator();
                const filter = ctx.createBiquadFilter();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(base * 0.88, t);
                osc.frequency.exponentialRampToValueAtTime(base * 1.38, t + 0.10);
                osc.frequency.exponentialRampToValueAtTime(base * 0.82, t + 0.30);
                filter.type = 'bandpass';
                filter.frequency.setValueAtTime(1350, t);
                filter.Q.setValueAtTime(2.6, t);
                gain.gain.setValueAtTime(0.0001, t);
                gain.gain.linearRampToValueAtTime(0.22, t + 0.05);
                gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
                osc.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
                osc.start(t); osc.stop(t + 0.34);
                // 叠一层柔和正弦基音更圆润
                this.playTone(ctx, base, t, 0.28, 'sine', 0.09, 1800, base * 0.78);
                break;
            }
            case 'dog_bark': {
                // 活泼小狗「汪汪！」双连短吠
                const base = 270 + Math.random() * 55;
                [0, 0.14].forEach((offset, idx) => {
                    const f0 = base * (idx === 0 ? 1.0 : 1.12);
                    const osc = ctx.createOscillator();
                    const filter = ctx.createBiquadFilter();
                    const gain = ctx.createGain();
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(f0 * 0.82, t + offset);
                    osc.frequency.exponentialRampToValueAtTime(f0 * 1.42, t + offset + 0.045);
                    osc.frequency.exponentialRampToValueAtTime(f0 * 0.62, t + offset + 0.11);
                    filter.type = 'lowpass';
                    filter.frequency.setValueAtTime(1100, t + offset);
                    gain.gain.setValueAtTime(0.0001, t + offset);
                    gain.gain.linearRampToValueAtTime(0.16, t + offset + 0.018);
                    gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.12);
                    osc.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
                    osc.start(t + offset); osc.stop(t + offset + 0.13);
                });
                break;
            }
            case 'bath': {
                // 洗澡清洁：柔和哗啦水花 + 4 颗上升泡泡波波声
                this.playFilteredNoise(ctx, t, 0.32, 1600, 'bandpass', 0.11);
                [0.04, 0.11, 0.19, 0.27].forEach((off, i) => {
                    const f = 380 + i * 145 + Math.random() * 40;
                    this.playTone(ctx, f, t + off, 0.075, 'sine', 0.11, 2600, f * 1.65);
                });
                break;
            }
            case 'eat': {
                // 吃饭：三连酥脆咀嚼咔嚓声 + 满足小音符
                [0, 0.11, 0.22].forEach(off => {
                    this.playFilteredNoise(ctx, t + off, 0.06, 2200, 'bandpass', 0.14);
                    this.playTone(ctx, 290, t + off, 0.055, 'triangle', 0.08, 900, 170);
                });
                this.playTone(ctx, 520, t + 0.31, 0.09, 'sine', 0.08, 1800, 680);
                break;
            }
            case 'sleep': {
                // 睡觉：轻柔摇篮哈欠下滑音 + 柔和梦境音符
                this.playTone(ctx, 392, t, 0.26, 'sine', 0.09, 1200, 329.63);
                this.playTone(ctx, 329.63, t + 0.22, 0.34, 'sine', 0.08, 1000, 261.63);
                break;
            }
            case 'fight': {
                // 猫狗打架：卡通滚烟云吵闹声 + 弹跳“嘣” + 急促叫声
                this.playFilteredNoise(ctx, t, 0.45, 900, 'bandpass', 0.13);
                this.playTone(ctx, 220, t + 0.02, 0.12, 'sawtooth', 0.10, 950, 480);
                this.playTone(ctx, 640, t + 0.12, 0.14, 'triangle', 0.12, 1600, 360);
                this.playTone(ctx, 260, t + 0.24, 0.11, 'sawtooth', 0.10, 950, 160);
                this.playTone(ctx, 520, t + 0.33, 0.12, 'triangle', 0.10, 1500, 740);
                break;
            }
            case 'sick': {
                // 生病/受伤：低落下行提醒音
                this.playTone(ctx, 440, t, 0.16, 'sine', 0.12, 1400, 392);
                this.playTone(ctx, 349.23, t + 0.15, 0.24, 'sine', 0.12, 1200, 293.66);
                break;
            }
            case 'heal': {
                // 治疗康复：温暖上行治愈音
                [392, 493.88, 587.33, 783.99].forEach((f, i) => {
                    this.playTone(ctx, f, t + i * 0.07, 0.20, 'sine', 0.11, 2600);
                });
                break;
            }
        }
    }
}

export const SoundManager = new SoundManagerImpl();
