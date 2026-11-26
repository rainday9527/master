import { _decorator, Component, Node, Camera, Canvas, UITransform, Graphics, Label, Color, Vec3, Vec2, RenderTexture, MeshRenderer, Material, primitives, utils, view, ResolutionPolicy, Layers, input, Input, EventTouch, sys, BlockInputEvents, Sprite, SpriteFrame, resources, DirectionalLight, Vec4, JsonAsset, Texture2D, ImageAsset, isValid, tween, Tween, ScrollView, Mask, UIOpacity, profiler, EditBox } from 'cc';

import { ITEM_CATALOG, ItemDefinition, ItemCategory, PetStat, ShopSlot, findItem, itemApplies, effectText, drawShopSlots } from './ItemCatalog';

import { DAILY_TASKS, DAILY_PACK, DailyState, DailyTaskId, newDaily, restoreDaily, advanceDaily, recordDaily } from './DailyTasks';

import { RecruitState, RECRUIT_CONFIG, restoreRecruit, drawRecruit, grantRecruit, nextMilestone } from './Recruitment';

import {
    PET_BREEDS, RARITY_INFO, PET_TRAITS, PET_OUTFITS, PET_COATS, PET_NICKNAME_PRESETS,
    MAX_PET_STAR, STAR_REQUIREMENTS, starXpBonus, starAdventureBonus, sanitizeNickname,
    isTraitId, isOutfitId, isCoatId, TraitId, OutfitId, CoatId,
} from './PetCatalog';

import {
    TombstoneId, SlotBgTheme, TOMBSTONE_CATALOG, findTombstone, MemorialRecord, AdventureLogEntry,
    calcIdleRewardPreview, rollIdleBonusItems, eventBadgeMeta, itemCategoryTag,
    makeDepartOutcome, makeLostOutcome, makeTraffickerDeathOutcome, rollAdventureEvent, RolledAdventureOutcome,
} from './AdventureSystem';

const { ccclass } = _decorator;
type Kind = 'cat' | 'dog';
type Currency = 'gems' | 'coins';
// 金币广告奖励暂与钻石一致；后续数值调整只改此处。
const VIDEO_REWARDS: Record<Currency, number> = { gems: 200, coins: 200 };
type Page = 'home' | 'recruit' | 'adventure' | 'album' | 'profile' | 'shop' | 'pet' | 'bag' | 'daily' | 'diary' | 'memorial';
export type RewardedVideoResult = 'completed' | 'cancelled' | 'failed';
export interface RewardedVideoProvider {
    // 可信边界：仅由宿主注入的平台适配器调用终态回调，并在游戏主线程执行。
    // completed 必须代表平台确认完整观看且视频已关闭；加载、开始、普通关闭不得映射为完成。
    // 取消、加载/播放失败分别回传 cancelled/failed；每次调用最终必须回传终态。
    // 此客户端接口无法验证平台凭证；不得将 UI 点击或不可信消息直接转发为 completed。
    show(onResult: (result: RewardedVideoResult) => void): void;
}
interface Pet {
    id: number;
    hunger: number;
    clean: number;
    energy: number;
    joy: number;
    health: number;
    dead?: boolean;
    lost?: boolean;
    deathReason?: string;
    diedAt?: number;
    adventuring?: boolean;
    adventureReturnAt?: number;
    star: number;
    nickname: string;
    renameCount?: number;
    trait: TraitId;
    outfit: OutfitId;
    coat: CoatId;
    ownedOutfits: OutfitId[];
    ownedCoats: CoatId[];
}
interface DialogAction { title: string; run: () => void; cost?: { currency: Currency; amount: number }; }
const LOST_PET_RECOVER_GEMS = 50;
type RewardGrantItem =
    | { kind: 'coins'; amount: number }
    | { kind: 'gems'; amount: number }
    | { kind: 'item'; itemId: string; amount: number }
    | { kind: 'care'; careType: 'food' | 'soap' | 'toy'; amount: number };
interface YardPoop {
    id: number;
    petId: number;
    x: number;
    z: number;
    createdAt: number;
}
interface ShopState { day: number; freeUsed: number; paidUsed: number; maxTime: number; revision: number; slots: ShopSlot[]; }
interface Save {
    version: number; coins: number; gems: number; xp: number; avatar: number; pets: Pet[];
    food: number; soap: number; toy: number; itemInventory: Record<string, number>;
    adventureEnd: number; lastSeen: number; shop: ShopState; daily: DailyState; recruit: RecruitState;
    albumClaimed: Record<string, boolean>;
    poops?: YardPoop[];
    adventureIdleStart?: number;
    adventureLogs?: AdventureLogEntry[];
    tombstoneInventory?: Record<string, number>;
    outfitInventory?: Record<string, number>;
    coatInventory?: Record<string, number>;
    memorials?: MemorialRecord[];
}
type RigPartName = 'body' | 'head' | 'face' | 'earL' | 'earR' | 'legFL' | 'legFR' | 'legBL' | 'legBR' | 'tail';
interface PetRigAsset {
    kind: Kind;
    pivots: Record<string, [number, number, number]>;
    meshes: Record<RigPartName, ReturnType<typeof utils.createMesh>>;
}
type RigKey = 'cat' | 'dog' | 'dog_upright';
interface ActorRig {
    kind: Kind;
    uprightEars: boolean;
    modelNode: Node;
    head: Node;
    earL: Node;
    earR: Node;
    legFL: Node;
    legFR: Node;
    legBL: Node;
    legBR: Node;
    tail: Node;
    shadow: Node | null;
    outfitNode: Node | null;
    renderers: MeshRenderer[];
    pivots: Record<string, [number, number, number]>;
}
interface Actor {
    node: Node;
    visual: Node;
    pet: Pet;
    target: Vec3;
    timer: number;
    walkAge?: number;
    phase: number;
    speed?: number;
    idleTime?: number;
    lookYaw?: number;
    lookTilt?: number;
    lookTimer?: number;
    tailPhase?: number;
    tailExcite?: number;
    socialUntil?: number;
    socialCooldownUntil?: number;
    facing?: number;
    rig?: ActorRig;
    dying?: number;
    ghostSpawned?: boolean;
}
interface SocialBubble { node: Node; actor: Actor; until: number; side: number; }
interface PoopVisual {
    node: Node;
    quad: Node;
    poop: YardPoop;
    smokes: { node: Node; mat: Material; phase: number }[];
}
interface GhostFloat {
    node: Node;
    op: UIOpacity;
    baseX: number;
    baseY: number;
    age: number;
    duration: number;
}
interface BroomSweep {
    node: Node;
    broom: Node;
    op: UIOpacity;
    sparkles: { node: Node; vx: number; vy: number; op: UIOpacity }[];
    age: number;
    duration: number;
}
const BREEDS = PET_BREEDS;
const C = { cream: '#FFF9ED', ink: '#573D2D', green: '#679B7C', pale: '#E5EFDF', coral: '#A65D45', muted: '#795F48', white: '#FFFFFF' };

@ccclass('Main')
export class Main extends Component {
    private readonly key = 'cat-paradise-save-v1';
    private data!: Save;
    private world!: Node;
    private ui!: Node;
    private top!: Node;
    private bottom!: Node;
    private sheet: Node | null = null;
    private recruitBackground: Node | null = null;
    private notice!: Label;
    private background!: Node;
    private backgroundSprite!: Sprite;
    private backgroundCamera!: Camera;
    private readonly backgroundLayer = 1 << 20;
    private worldCamera!: Camera;
    private uiCamera!: Camera;
    private actors: Actor[] = [];
    public petNodeScale = 0.48;
    public petCollisionRadius = 0.54;
    private readonly yardMinX = -3.0;
    private readonly yardMaxX = 3.0;
    private readonly yardMinZ = -3.2;
    private readonly yardMaxZ = 6.2;
    private socialTime = 0;
    private pairCooldowns = new Map<string, number>();
    private bubbleLayer: Node | null = null;
    private poopLayer: Node | null = null;
    private poopVisuals = new Map<number, PoopVisual>();
    private poopNextId = 1;
    private ghosts: GhostFloat[] = [];
    private brooms: BroomSweep[] = [];
    private advBgContainer: Node | null = null;
    private advRoadTiles: Node[] = [];
    private advChestAura: Node | null = null;
    private advChestSprite: Sprite | null = null;
    private advChestBadge: Node | null = null;
    private advTimerLabel: Label | null = null;
    private advScrollY = 0;
    private advChestOpenUntil = 0;
    private advLogNextId = 1;
    private shopTab: 'items' | 'outfits' | 'tombstones' = 'items';
    private pendingAlerts: { kind: 'lost' | 'dead'; petId: number; reason: string }[] = [];
    private socialBubbles: SocialBubble[] = [];
    private needBubbles = new Map<number, { node: Node; icon: string; until: number; urgent: boolean }>();
    private needHistory = new Map<number, number[]>();
    private needQueue = new Map<number, { icon: string; threshold: number }[]>();
    private needZeroNextAt = new Map<number, number>();
    private needZeroCursor = new Map<number, number>();
    private materials = new Map<string, Material>();
    private meshes = new Map<string, ReturnType<typeof utils.createMesh>>();
    private petRigs = new Map<RigKey, Promise<PetRigAsset | null>>();
    private petSkins = new Map<string, Promise<Texture2D | null>>();
    private compositeTextures = new Map<string, Texture2D>();
    private petAvatars = new Map<string, Promise<SpriteFrame | null>>();
    private petPortraits = new Map<string, Promise<SpriteFrame | null>>();
    private shadowTexture: Promise<Texture2D | null> | null = null;
    private page: Page = 'home';
    private selected = 0;
    private petSelected = false;
    private careSelected = '';
    private selectionRing: Node | null = null;
    private careIcons = new Map<string, Promise<SpriteFrame | null>>();
    private skins = new Map<string, Promise<SpriteFrame | null>>();
    private width = 1080;
    private height = 1920;
    private blockedUntil = 0;
    private noticeUntil = 0;
    private elapsed = 0;
    private dirty = false;
    private adventureLabel: Label | null = null;
    private saveWarning = false;
    private saveSnapshot: string | null = null;
    private saveSnapshotReady = false;
    private shopClickTime = -Infinity;
    private shopTimerLabel: Label | null = null;
    private shopCostLabel: Label | null = null;
    private shopCostIcon: Node | null = null;
    private shopCards: { node: Node; id: string; title: Label; slotBg: Sprite; icon: Sprite; species: Label; effect: Label; stock: Label; owned: Label; price: Label; currency: Sprite }[] = [];
    private tombOwnedLabels = new Map<TombstoneId, Label>();
    private spriteRequests = new WeakMap<Sprite, object>();
    private header: { profile: Node; avatar: number; level: Label; xp: Label; fill: Sprite; gems: Label; coins: Label } | null = null;
    private recruitLabels: Label[] = [];
    private recruitCards: { id: number; pill: Graphics; countLabel: Label }[] = [];
    private recruitProgress: Label | null = null;
    private recruitBadge: Node | null = null;
    private recruitResult: Label | null = null;
    private recruitClickTime = -Infinity;
    private recruitBusy = false;
    private bagPage = 0;
    private bagFilter: ItemCategory | null = null;
    private bagSlots: { node: Node; entry: { item: ItemDefinition; legacy: ItemCategory | null } | null; title: Label; slotBg: Sprite; icon: Sprite; species: Label; effect: Label; count: Label; use: Label }[] = [];
    private bagPageLabel: Label | null = null;
    private bagTargetLabel: Label | null = null;
    private bagEmpty: Node | null = null;
    private bagTabs: { category: ItemCategory | null; label: Label }[] = [];
    private albumFilter: 'all' | Kind = 'all';
    private profilePetId = 0;
    private profileTab: 'overview' | 'star' | 'outfit' = 'overview';
    private profileWardrobeTab: 'outfit' | 'coat' = 'outfit';
    private recruitPreviewPage = 0;
    private readonly previewLayer = 1 << 21;
    private previewCamera: Camera | null = null;
    private previewTexture: RenderTexture | null = null;
    private previewFrame: SpriteFrame | null = null;
    private previewStage: Node | null = null;
    private previewVisual: Node | null = null;
    private previewRig: ActorRig | null = null;
    private previewViewportNode: Node | null = null;
    private previewTime = 0;
    private previewTailPhase = 0;
    private previewDragYaw = -16;
    private previewHop = 0;
    private previewLoadedKey = '';
    private outfitIcons = new Map<string, Promise<SpriteFrame | null>>();
    public rewardedVideoProvider: RewardedVideoProvider | null = null;
    private dialog: Node | null = null;
    private gmPanel: Node | null = null;
    private rewardedVideoPending = false;

    onLoad() {
        profiler.hideStats();
        this.data = this.load();
        // 立即保存商店迁移结果；失败时后续商店事务仍须先落盘才会生效。
        this.commitShop(this.data);
        view.setDesignResolutionSize(1080, 1920, ResolutionPolicy.SHOW_ALL);
        this.world = new Node('温暖庭院');
        this.node.addChild(this.world);
        this.makeBackground();
        this.makeCamera();
        this.makeLighting();
        this.data.pets.forEach(p => this.spawnPet(p));
        this.makeUI();
        input.on(Input.EventType.TOUCH_END, this.onWorldTouch, this);
        this.schedule(this.tick, 1);
        if (this.saveWarning) this.toast('存档异常，已安全恢复为初始庭院');
    }

    private makePet(id: number, hunger = 70, clean = 80, energy = 85, joy = 75, health = 100): Pet {
        return {
            id, hunger, clean, energy, joy, health, dead: false, star: 1, nickname: '', renameCount: 0,
            trait: BREEDS[id].defaultTrait, outfit: 'none', coat: 'original',
            ownedOutfits: ['none'], ownedCoats: ['original'],
        };
    }

    private petDisplayName(id: number): string {
        const pet = this.data?.pets?.find(p => p.id === id);
        return (pet && pet.nickname) ? pet.nickname : BREEDS[id].name;
    }

    private fresh(): Save {
        const now = Date.now();
        return { version: 1, coins: 260, gems: 100, xp: 0, avatar: 0,
            pets: [0, 1].map(id => this.makePet(id, 75, 85, 90, 80, 100)),
            food: 5, soap: 4, toy: 3, itemInventory: { bandage: 2 }, adventureEnd: 0, lastSeen: now, shop: this.newShop(now), daily: newDaily(this.shopDay(now)),
            recruit: restoreRecruit(undefined, [0, 1], BREEDS.map((_, id) => id), false),
            albumClaimed: {}, poops: [],
            adventureIdleStart: now - 15 * 60000,
            adventureLogs: [{
                id: 1, time: now - 5 * 60000, petId: 0, petName: BREEDS[0].name,
                type: 'depart', title: '独自出门冒险',
                text: `「${BREEDS[0].name}」摇着尾巴悄悄钻过庭院木门，踏上了阳光花径的冒险之旅！`,
            }],
            tombstoneInventory: {}, outfitInventory: {}, coatInventory: {}, memorials: [] };
    }

    private load(): Save {
        try {
            const raw = sys.localStorage.getItem(this.key);
            this.saveSnapshot = raw; this.saveSnapshotReady = true;
            if (!raw) return this.fresh();
            const s = JSON.parse(raw) as Save;
            const validInt = (v: unknown, max = 100000000) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;
            if (!s || s.version !== 1 || !['coins', 'gems', 'xp', 'food', 'soap', 'toy'].every(k => validInt((s as any)[k])) ||
                !validInt(s.avatar, BREEDS.length - 1) || !validInt(s.adventureEnd, 9000000000000000) ||
                !validInt(s.lastSeen, 9000000000000000) || !Array.isArray(s.pets) || s.pets.length < 2 || s.pets.length > BREEDS.length) throw Error('存档无效');
            const legacyOutfits = Array.isArray((s as any).ownedOutfits) ? new Set<OutfitId>(((s as any).ownedOutfits as unknown[]).filter(isOutfitId)) : null;
            const legacyCoats = Array.isArray((s as any).ownedCoats) ? new Set<CoatId>(((s as any).ownedCoats as unknown[]).filter(isCoatId)) : null;
            const ids = new Set<number>();
            s.pets = s.pets.map(p => {
                if (!p || !validInt(p.id, BREEDS.length - 1) || ids.has(p.id) || !['hunger', 'clean', 'energy', 'joy'].every(k => typeof (p as any)[k] === 'number' && Number.isFinite((p as any)[k]) && (p as any)[k] >= 0 && (p as any)[k] <= 100)) throw Error('宠物数据无效');
                ids.add(p.id);
                const star = validInt(p.star, MAX_PET_STAR) && p.star >= 1 ? p.star : 1;
                const nickname = typeof p.nickname === 'string' ? sanitizeNickname(p.nickname) : '';
                const renameCount = validInt(p.renameCount, 1000000) ? p.renameCount! : (nickname ? 1 : 0);
                const trait = isTraitId(p.trait) ? p.trait : BREEDS[p.id].defaultTrait;
                let outfit: OutfitId = isOutfitId(p.outfit) ? p.outfit : 'none';
                let coat: CoatId = isCoatId(p.coat) ? p.coat : 'original';
                // 装扮与服装皮肤按每只宠物独立解锁，不跨宠物共享；旧存档仅保留该宠物当前正在穿戴的项。
                const petOutfits = new Set<OutfitId>(['none']);
                if (Array.isArray(p.ownedOutfits)) p.ownedOutfits.forEach(o => { if (isOutfitId(o)) petOutfits.add(o); });
                if (star >= 3) petOutfits.add('gold_crown');
                if (outfit !== 'none' && legacyOutfits?.has(outfit)) petOutfits.add(outfit);
                if (!petOutfits.has(outfit)) outfit = 'none';
                const petCoats = new Set<CoatId>(['original']);
                if (Array.isArray(p.ownedCoats)) p.ownedCoats.forEach(c => { if (isCoatId(c)) petCoats.add(c); });
                if (coat !== 'original' && legacyCoats?.has(coat)) petCoats.add(coat);
                if (!petCoats.has(coat)) coat = 'original';
                const health = typeof (p as any).health === 'number' && Number.isFinite((p as any).health) && (p as any).health >= 0 && (p as any).health <= 100 ? (p as any).health : 100;
                const dead = Boolean((p as any).dead);
                const lost = Boolean((p as any).lost);
                const deathReason = typeof (p as any).deathReason === 'string' ? (p as any).deathReason : undefined;
                const diedAt = validInt((p as any).diedAt, 9000000000000000) ? (p as any).diedAt : undefined;
                const rawReturnAt = validInt((p as any).adventureReturnAt, 9000000000000000) ? (p as any).adventureReturnAt : undefined;
                const adventuring = Boolean((p as any).adventuring) && !dead && !lost && (!rawReturnAt || rawReturnAt > Date.now());
                const adventureReturnAt = adventuring ? rawReturnAt : undefined;
                return {
                    id: p.id, hunger: p.hunger, clean: p.clean, energy: p.energy, joy: p.joy, health, dead, lost, deathReason, diedAt,
                    adventuring, adventureReturnAt,
                    star, nickname, renameCount, trait, outfit, coat,
                    ownedOutfits: Array.from(petOutfits), ownedCoats: Array.from(petCoats),
                };
            });
            if (!ids.has(0) || !ids.has(1) || !ids.has(s.avatar)) throw Error('初始伙伴缺失');
            if (s.adventureEnd > Date.now() + 120000) s.adventureEnd = 0;
            const hours = Math.min(12, Math.max(0, (Date.now() - s.lastSeen) / 3600000));
            s.pets.forEach(p => {
                if (p.dead) return;
                const tr = PET_TRAITS[p.trait];
                p.hunger = Math.max(0, p.hunger - hours * 4);
                p.clean = Math.max(0, p.clean - hours * 3 * (tr.cleanDecayMult ?? 1));
                p.joy = Math.max(0, p.joy - hours * 2 * (tr.joyDecayMult ?? 1));
                p.energy = Math.min(100, p.energy + hours * 3);
                if (p.hunger < 20 || p.clean < 30) {
                    p.health = Math.max(0, p.health - hours * 5);
                    if (p.health <= 0) p.dead = true;
                }
            });
            const validPoops: YardPoop[] = [];
            if (Array.isArray(s.poops)) {
                s.poops.slice(0, 6).forEach((pp, i) => {
                    if (pp && typeof pp.x === 'number' && typeof pp.z === 'number' && Number.isFinite(pp.x) && Number.isFinite(pp.z)) {
                        validPoops.push({ id: validInt(pp.id) ? pp.id : i + 1, petId: validInt(pp.petId, BREEDS.length - 1) ? pp.petId : 0, x: pp.x, z: pp.z, createdAt: validInt(pp.createdAt, 9000000000000000) ? pp.createdAt : Date.now() });
                    }
                });
            }
            s.poops = validPoops;
            s.adventureIdleStart = validInt((s as any).adventureIdleStart, 9000000000000000) ? (s as any).adventureIdleStart : Math.max(0, Date.now() - 10 * 60000);
            s.adventureLogs = Array.isArray((s as any).adventureLogs) ? ((s as any).adventureLogs as AdventureLogEntry[]).slice(0, 40) : [];
            this.advLogNextId = s.adventureLogs.reduce((m, e) => Math.max(m, e.id || 0), 1);
            const tombInv: Record<string, number> = {};
            TOMBSTONE_CATALOG.forEach(t => {
                const c = (s as any).tombstoneInventory && (s as any).tombstoneInventory[t.id];
                if (validInt(c)) tombInv[t.id] = c;
            });
            s.tombstoneInventory = tombInv;
            const outInv: Record<string, number> = {};
            PET_OUTFITS.forEach(o => {
                const c = (s as any).outfitInventory && (s as any).outfitInventory[o.id];
                if (validInt(c)) outInv[o.id] = c;
            });
            s.outfitInventory = outInv;
            const coatInv: Record<string, number> = {};
            PET_COATS.forEach(co => {
                const c = (s as any).coatInventory && (s as any).coatInventory[co.id];
                if (validInt(c)) coatInv[co.id] = c;
            });
            s.coatInventory = coatInv;
            s.memorials = Array.isArray((s as any).memorials) ? ((s as any).memorials as MemorialRecord[]).slice(0, BREEDS.length) : [];
            const inventory: Record<string, number> = {};
            ITEM_CATALOG.forEach(item => {
                const count = s.itemInventory && s.itemInventory[item.id];
                if (validInt(count)) inventory[item.id] = count;
            });
            s.itemInventory = inventory;
            s.shop = this.restoreShop(s.shop, Object.prototype.hasOwnProperty.call(s, 'shop'));
            s.shop = this.advanceShop(s.shop, Date.now());
            s.daily = restoreDaily(s.daily, s.shop.day, Object.prototype.hasOwnProperty.call(s, 'daily'));
            s.recruit = restoreRecruit(s.recruit, s.pets.map(p => p.id), BREEDS.map((_, id) => id), Object.prototype.hasOwnProperty.call(s, 'recruit'));
            const albumClaimed: Record<string, boolean> = {};
            if (s.albumClaimed && typeof s.albumClaimed === 'object') {
                BREEDS.forEach(b => { if (s.albumClaimed[b.id] === true && ids.has(b.id)) albumClaimed[b.id] = true; });
            }
            s.albumClaimed = albumClaimed;
            delete (s as any).ownedOutfits;
            delete (s as any).ownedCoats;
            return s;
        } catch { this.saveWarning = true; return this.fresh(); }
    }

    private shopDay(time: number) { return Math.floor((time + 8 * 3600000) / 86400000); }

    private newShop(time: number): ShopState {
        return { day: this.shopDay(time), freeUsed: 0, paidUsed: 0, maxTime: time, revision: 0, slots: drawShopSlots() };
    }

    private restoreShop(value: ShopState | undefined, present: boolean): ShopState {
        const now = Date.now();
        if (!present) return this.newShop(now);
        const int = (n: unknown, max: number) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= max;
        if (value && int(value.day, this.shopDay(8640000000000000)) && int(value.freeUsed, 3) &&
            int(value.paidUsed, Number.MAX_SAFE_INTEGER - 1) && int(value.maxTime, 8640000000000000) &&
            int(value.revision, Number.MAX_SAFE_INTEGER - 1) && value.day === this.shopDay(value.maxTime) &&
            (value.paidUsed === 0 || value.freeUsed === 3)) {
            if (Array.isArray(value.slots)) {
                const ids = new Set<string>();
                const valid = value.slots.length === 6 && value.slots.every(slot => {
                    const item = slot && findItem(slot.id);
                    if (!item || ids.has(slot.id) || !int(slot.remaining, item.limit)) return false;
                    ids.add(slot.id); return true;
                });
                if (valid) return value;
            } else {
                const remaining = (value as unknown as { remaining?: Record<string, number> }).remaining;
                if (remaining && ['food', 'soap', 'toy'].every(key => int(remaining[key], 6))) {
                    // 旧三物资商店仅迁移一次；额度、付费阶梯及版本号原样保留。
                    return { day: value.day, freeUsed: value.freeUsed, paidUsed: value.paidUsed,
                        maxTime: value.maxTime, revision: value.revision, slots: drawShopSlots() };
                }
            }
        }
        // 仅修复商店，不重建金币、钻石、背包或宠物；保留可用的高水位，避免回拨重复领取。
        const maxTime = value && int(value.maxTime, 8640000000000000) ? Math.max(now, value.maxTime) : now;
        const day = value && int(value.day, this.shopDay(8640000000000000)) ? Math.max(this.shopDay(maxTime), value.day) : this.shopDay(maxTime);
        return { day, freeUsed: 3, paidUsed: 4, maxTime: Math.max(maxTime, day * 86400000 - 8 * 3600000),
            revision: value && int(value.revision, Number.MAX_SAFE_INTEGER - 1) ? value.revision : 0,
            slots: ITEM_CATALOG.slice(0, 6).map(item => ({ id: item.id, remaining: 0 })) };
    }

    private advanceShop(shop: ShopState, now: number): ShopState {
        const maxTime = Math.max(shop.maxTime, now), day = this.shopDay(maxTime);
        // 跨过多个日期也只重置一次，不累计补发；回拨不降低日期或最高时间。
        return day > shop.day ? { ...shop, day, maxTime, freeUsed: 0, paidUsed: 0 } : { ...shop, maxTime };
    }

    private shopRefreshCost(shop: ShopState) {
        return shop.freeUsed < 3 ? 0 : [20, 50, 80, 100][Math.min(shop.paidUsed, 3)];
    }

    private dailyCandidate(now = Date.now()): Save {
        const shop = this.advanceShop(this.data.shop, now);
        return { ...this.data, shop, daily: advanceDaily(this.data.daily, shop.day), lastSeen: now };
    }

    private commitShop(candidate: Save): boolean {
        try {
            candidate = { ...candidate, daily: advanceDaily(candidate.daily, candidate.shop.day) };
            if (!this.saveSnapshotReady || sys.localStorage.getItem(this.key) !== this.saveSnapshot) {
                this.toast('存档已被其他页面修改，请重载游戏'); return false;
            }
            const raw = JSON.stringify(candidate);
            sys.localStorage.setItem(this.key, raw);
            this.saveSnapshot = raw;
            this.data = candidate; this.dirty = false;
            return true;
        } catch { this.toast('保存失败，本次操作未生效，未扣除货币或道具'); return false; }
    }

    private persist() {
        const candidate = { ...this.data, lastSeen: Date.now() };
        candidate.shop = this.advanceShop(candidate.shop, candidate.lastSeen);
        // 所有既有保存入口共用快照检查，避免自动保存覆盖另一页面的商店交易。
        return this.commitShop(candidate);
    }

    private makeBackground() {
        this.background = new Node('生图庭院背景'); this.node.addChild(this.background);
        this.background.layer = this.backgroundLayer;
        this.background.addComponent(UITransform);
        const cameraNode = new Node('背景相机'); this.node.addChild(cameraNode); cameraNode.setPosition(0, 0, 1000);
        this.backgroundCamera = cameraNode.addComponent(Camera);
        this.backgroundCamera.projection = Camera.ProjectionType.ORTHO;
        this.backgroundCamera.visibility = this.backgroundLayer;
        this.backgroundCamera.priority = 0;
        this.backgroundCamera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        this.backgroundCamera.clearColor = this.color('#DDE9CB');
        this.backgroundCamera.near = 0.1; this.backgroundCamera.far = 2000;
        const canvas = this.background.addComponent(Canvas); canvas.cameraComponent = this.backgroundCamera;
        const art = new Node('庭院画面'); art.layer = this.backgroundLayer; this.background.addChild(art);
        art.addComponent(UITransform).setContentSize(1080, 1920);
        this.backgroundSprite = art.addComponent(Sprite);
        this.backgroundSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        resources.load('art/garden/spriteFrame', SpriteFrame, (error, frame) => {
            if (!this.isValid || !this.backgroundSprite.isValid) return;
            if (error) { this.toast('庭院背景暂未加载，请检查 art/garden 资源'); return; }
            this.backgroundSprite.spriteFrame = frame;
            this.layoutBackground();
        });
        this.layoutBackground();
    }

    private layoutBackground() {
        const size = view.getVisibleSize();
        this.background.getComponent(UITransform)!.setContentSize(size.width, size.height);
        this.backgroundCamera.orthoHeight = size.height / 2;
        const source = this.backgroundSprite.spriteFrame?.originalSize;
        const width = source?.width || 1080, height = source?.height || 1920;
        const cover = Math.max(size.width / width, size.height / height);
        this.backgroundSprite.getComponent(UITransform)!.setContentSize(width * cover, height * cover);
    }

    private makeLighting() {
        const sun = new Node('柔暖日光'); this.world.addChild(sun);
        sun.setRotationFromEuler(-55, -35, 0);
        const light = sun.addComponent(DirectionalLight);
        light.color = this.color('#FFF2DB'); light.illuminance = 42000;
        const ambient = this.node.scene.globals.ambient;
        ambient.skyColor = new Vec4(0.78, 0.85, 0.96, 1);
        ambient.groundAlbedo = new Vec4(0.48, 0.56, 0.38, 1);
        ambient.skyIllum = 18000;
    }

    private makeCamera() {
        const n = new Node('庭院相机'); this.node.addChild(n);
        this.worldCamera = n.addComponent(Camera);
        this.worldCamera.projection = Camera.ProjectionType.ORTHO;
        this.worldCamera.orthoHeight = 9.5;
        this.worldCamera.near = 0.1; this.worldCamera.far = 100;
        this.worldCamera.visibility = Layers.Enum.DEFAULT;
        this.worldCamera.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
        this.worldCamera.priority = 1;
        n.setPosition(0, 22, 16); n.lookAt(new Vec3(0, 0, 0));

        // 宠物主页专属 3D 展示相机：渲染至 512×512 透明 RenderTexture，由主页展示舞台 Sprite 承载，1:1 零拉伸且严守 UI 层级。
        const previewRT = new RenderTexture();
        previewRT.reset({ width: 512, height: 512 });
        this.previewTexture = previewRT;
        const previewFrame = new SpriteFrame();
        previewFrame.texture = previewRT;
        this.previewFrame = previewFrame;

        const previewCamNode = new Node('宠物主页预览相机'); this.node.addChild(previewCamNode);
        this.previewCamera = previewCamNode.addComponent(Camera);
        this.previewCamera.projection = Camera.ProjectionType.ORTHO;
        this.previewCamera.orthoHeight = 1.52;
        this.previewCamera.near = 0.1; this.previewCamera.far = 40;
        this.previewCamera.visibility = this.previewLayer;
        this.previewCamera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        this.previewCamera.clearColor = new Color(0, 0, 0, 0);
        this.previewCamera.priority = 2;
        this.previewCamera.targetTexture = previewRT;
        previewCamNode.setPosition(0.55, 1.48, 4.2);
        previewCamNode.lookAt(new Vec3(0, 1.12, 0.02));
        this.previewCamera.enabled = false;
    }

    private color(hex: string): Color { return new Color().fromHEX(hex); }
    private shape(parent: Node, type: 'box' | 'sphere' | 'cone' | 'cylinder' | 'torus', color: string, pos: number[], scale: number[], rotation?: number[]): Node {
        const n = new Node(type); parent.addChild(n); n.layer = Layers.Enum.DEFAULT;
        n.setPosition(pos[0], pos[1], pos[2]); n.setScale(scale[0], scale[1], scale[2]);
        if (rotation) n.setRotationFromEuler(rotation[0], rotation[1], rotation[2]);
        const renderer = n.addComponent(MeshRenderer);
        let mesh = this.meshes.get(type);
        if (!mesh) {
            const geometry: primitives.IGeometry = type === 'box' ? primitives.box()
                : type === 'sphere' ? primitives.sphere(0.5, { segments: 24 })
                : type === 'cone' ? primitives.cone(0.5, 1, { radialSegments: 10 })
                : type === 'torus' ? primitives.torus(0.5, 0.13, { radialSegments: 12, tubularSegments: 28 })
                : primitives.cylinder(0.5, 0.5, 1, { radialSegments: 14 });
            // Baked soft toon lighting avoids the unsupported standard-material pipeline.
            const normals = geometry.normals || [];
            const colors: number[] = [];
            for (let i = 0; i < geometry.positions.length; i += 3) {
                const nx = normals[i] || 0, ny = normals[i + 1] || 0, nz = normals[i + 2] || 0;
                const light = Math.max(0, nx * -0.45 + ny * 0.78 + nz * 0.43);
                const shade = 0.57 + 0.43 * Math.sqrt(light);
                colors.push(shade, shade * 0.98, shade * 0.92, 1);
            }
            geometry.colors = colors;
            mesh = utils.createMesh(geometry); this.meshes.set(type, mesh);
        }
        renderer.mesh = mesh;
        let mat = this.materials.get(color);
        if (!mat) {
            mat = new Material(); mat.initialize({ effectName: 'builtin-unlit', defines: { USE_VERTEX_COLOR: true } });
            mat.setProperty('mainColor', this.color(color));
            this.materials.set(color, mat);
        }
        renderer.setSharedMaterial(mat, 0);
        return n;
    }

    private makeGarden() {
        this.shape(this.world, 'box', '#9CBD8B', [0, -0.3, 0], [15, 0.55, 17]);
        this.shape(this.world, 'box', '#BBD09C', [0, 0, 0], [14.6, 0.06, 16.6]);
        for (let z = -7; z < 8; z += 1.15) this.shape(this.world, 'cylinder', '#E8DCC1', [0.4 * Math.sin(z), 0.06, z], [1.9, 0.09, 1]);
        for (let x = -7; x <= 7; x += 0.7) for (const z of [-8, 8]) this.shape(this.world, 'box', '#F5E5C8', [x, 0.55, z], [0.18, 1.1, 0.16]);
        for (let z = -7.7; z < 8; z += 0.7) for (const x of [-7, 7]) this.shape(this.world, 'box', '#F5E5C8', [x, 0.55, z], [0.16, 1.1, 0.18]);
        for (const z of [-8, 8]) this.shape(this.world, 'box', '#D9C6A6', [0, 0.62, z], [14, 0.14, 0.12]);
        for (const x of [-7, 7]) this.shape(this.world, 'box', '#D9C6A6', [x, 0.62, 0], [0.12, 0.14, 16]);
        this.house(-4.4, -4.6, '#EDC6AA', '#BC7B68', false);
        this.house(3.7, -4.8, '#DADDBE', '#73947D', true);
        for (const [x, z, s] of [[-5.6, -0.3, 1.1], [5.4, -1.1, 1.2], [-5, 5.7, 0.9], [5.2, 5.4, 1]]) {
            this.shape(this.world, 'cylinder', '#AD8863', [x, 0.85, z], [0.35, 1.7, 0.35]);
            this.shape(this.world, 'sphere', '#7BA273', [x, 2.2, z], [2.5 * s, 2.7 * s, 2.3 * s]);
            this.shape(this.world, 'sphere', '#91B381', [x - 0.55, 2.6, z - 0.2], [1.6 * s, 1.7 * s, 1.7 * s]);
        }
        for (const side of [-1, 1]) {
            this.shape(this.world, 'box', '#B39475', [side * 3.8, 0.12, 2.6], [2.5, 0.22, 1.6]);
            this.shape(this.world, 'box', '#8F7962', [side * 3.8, 0.25, 2.6], [2.2, 0.12, 1.3]);
            for (let i = 0; i < 9; i++) {
                const x = side * 3.8 + (i % 3 - 1) * 0.65, z = 2.2 + Math.floor(i / 3) * 0.4;
                this.shape(this.world, 'cylinder', '#6D925F', [x, 0.48, z], [0.07, 0.5, 0.07]);
                this.shape(this.world, 'sphere', i % 2 ? '#F4D784' : '#EAA39B', [x, 0.78, z], [0.32, 0.22, 0.32]);
            }
        }
        this.shape(this.world, 'cylinder', '#D8C3A1', [2.5, 0.14, 6.3], [1.7, 0.22, 1.7]);
        this.shape(this.world, 'cylinder', '#99C8C4', [2.5, 0.27, 6.3], [1.4, 0.07, 1.4]);
        this.shape(this.world, 'sphere', '#E6AA7B', [-2, 0.32, 5.2], [0.6, 0.6, 0.6]);
        this.shape(this.world, 'box', '#E7D0A8', [-2.7, 0.4, -1.7], [1.8, 0.35, 1.3]);
        this.shape(this.world, 'sphere', '#D99C88', [-2.7, 0.59, -1.7], [1.4, 0.2, 1]);
    }

    private house(x: number, z: number, wall: string, roof: string, dog: boolean) {
        const n = new Node(dog ? '布丁小屋' : '奶糖小屋'); this.world.addChild(n); n.setPosition(x, 0, z);
        this.shape(n, 'box', wall, [0, 0.95, 0], [2.7, 1.9, 2.4]);
        this.shape(n, 'cone', roof, [0, 2.18, 0], [4, 1.6, 3.7], [0, 45, 0]);
        this.shape(n, 'box', '#786A58', [0, 0.65, 1.215], [0.9, 1.3, 0.04]);
        this.shape(n, 'sphere', '#786A58', [0, 1.25, 1.22], [0.9, 0.7, 0.05]);
        this.shape(n, 'box', '#F7E8C9', [-0.85, 1.25, 1.23], [0.45, 0.45, 0.06]);
        this.shape(n, 'box', '#BAD4CF', [-0.85, 1.25, 1.27], [0.3, 0.3, 0.04]);
        this.shape(n, 'cylinder', '#E5BD8F', [0.7, 0.13, 2], [0.6, 0.25, 0.6]);
        this.shape(n, 'cylinder', '#8EBAC1', [0.7, 0.27, 2], [0.45, 0.03, 0.45]);
    }

    private petRigKey(breed: { kind: Kind; skin: string }): RigKey {
        if (breed.kind === 'cat') return 'cat';
        return (breed.skin === 'dog_keji' || breed.skin === 'dog_chaiquan') ? 'dog_upright' : 'dog';
    }

    private loadPetRig(rigKey: RigKey): Promise<PetRigAsset | null> {
        let loading = this.petRigs.get(rigKey);
        if (!loading) {
            loading = new Promise<PetRigAsset | null>(resolve => {
                const fail = () => {
                    if (isValid(this, true)) this.toast((rigKey === 'cat' ? '猫咪' : '狗狗') + '模型暂未加载，已保留可互动的庭院伙伴');
                    resolve(null);
                };
                resources.load('pets/' + rigKey + '-rig', JsonAsset, (error, asset) => {
                    if (!isValid(this, true)) { resolve(null); return; }
                    if (error || !asset?.json) { fail(); return; }
                    const raw = asset.json as { pivots?: Record<string, [number, number, number]>; parts?: Record<RigPartName, primitives.IGeometry> };
                    const partNames: RigPartName[] = ['body', 'head', 'face', 'earL', 'earR', 'legFL', 'legFR', 'legBL', 'legBR', 'tail'];
                    if (!raw.pivots || !raw.parts || !partNames.every(name => raw.parts![name] && Array.isArray(raw.parts![name].positions) && raw.parts![name].positions.length)) {
                        fail(); return;
                    }
                    try {
                        const meshes = {} as Record<RigPartName, ReturnType<typeof utils.createMesh>>;
                        for (const name of partNames) {
                            const mesh = utils.createMesh(raw.parts[name]);
                            this.meshes.set('rig:' + rigKey + ':' + name, mesh);
                            meshes[name] = mesh;
                        }
                        resolve({ kind: rigKey === 'cat' ? 'cat' : 'dog', pivots: raw.pivots, meshes });
                    } catch { fail(); }
                });
            });
            this.petRigs.set(rigKey, loading);
        }
        return loading;
    }

    private loadPetSkin(skinKey: string): Promise<Texture2D | null> {
        let loading = this.petSkins.get(skinKey);
        if (!loading) {
            loading = new Promise<Texture2D | null>(resolve => {
                resources.load('pets/skins/' + skinKey + '/texture', Texture2D, (error, texture) => {
                    if (!isValid(this, true)) { resolve(null); return; }
                    resolve(error || !texture ? null : texture);
                });
            });
            this.petSkins.set(skinKey, loading);
        }
        return loading;
    }

    private loadShadowTexture(): Promise<Texture2D | null> {
        if (!this.shadowTexture) {
            this.shadowTexture = new Promise<Texture2D | null>(resolve => {
                resources.load('pets/shadow/texture', Texture2D, (error, texture) => {
                    if (!isValid(this, true)) { resolve(null); return; }
                    resolve(error || !texture ? null : texture);
                });
            });
        }
        return this.shadowTexture;
    }

    private attachPetShadow(actor: Actor, texture: Texture2D | null): Node | null {
        if (!texture || !isValid(actor.node, true)) return null;
        let mesh = this.meshes.get('pet:shadow');
        if (!mesh) {
            mesh = utils.createMesh(primitives.plane({ width: 1.9, length: 2.15, widthSegments: 1, lengthSegments: 1 }));
            this.meshes.set('pet:shadow', mesh);
        }
        let mat = this.materials.get('pet:shadow');
        if (!mat) {
            mat = new Material();
            mat.initialize({ effectName: 'builtin-unlit', technique: 1, defines: { USE_TEXTURE: true } });
            mat.setProperty('mainTexture', texture);
            mat.setProperty('mainColor', this.color(C.white));
            this.materials.set('pet:shadow', mat);
        }
        const shadow = new Node('脚底阴影');
        shadow.layer = Layers.Enum.DEFAULT;
        actor.node.addChild(shadow);
        shadow.setSiblingIndex(0);
        shadow.setPosition(0, 0.02, -0.02);
        const renderer = shadow.addComponent(MeshRenderer);
        renderer.mesh = mesh;
        renderer.setSharedMaterial(mat, 0);
        renderer.shadowCastingMode = 0;
        renderer.receiveShadow = 0;
        return shadow;
    }

    private getPetSkinMaterial(skinKey: string, coat: CoatId, texture: Texture2D): Material {
        const key = 'pet:' + skinKey + ':' + coat;
        let material = this.materials.get(key);
        if (!material) {
            material = new Material();
            this.materials.set(key, material);
            // 共享基础猫/狗3D模型：顶点烘焙柔和体积光，所有皮肤均保持自然本色不做怪异色偏。
            material.initialize({ effectName: 'builtin-unlit', defines: { USE_TEXTURE: true, USE_VERTEX_COLOR: true } });
            material.setProperty('mainTexture', texture);
            material.setProperty('colorScale', new Vec3(1.06, 1.05, 1.03));
            material.setProperty('mainColor', this.color('#FFFFFF'));
        }
        return material;
    }

    private async getCompositePetMaterial(skinKey: string, coat: CoatId, baseTexture: Texture2D): Promise<Material> {
        const coatDef = PET_COATS.find(c => c.id === coat);
        if (!coatDef || !coatDef.overlay) return this.getPetSkinMaterial(skinKey, 'original', baseTexture);
        const key = 'pet:' + skinKey + ':' + coat;
        const cached = this.materials.get(key);
        if (cached) return cached;
        const overlayTex = await this.loadPetSkin(coatDef.overlay);
        if (!overlayTex || !isValid(this, true)) return this.getPetSkinMaterial(skinKey, 'original', baseTexture);
        const cachedAfter = this.materials.get(key);
        if (cachedAfter) return cachedAfter;
        const baseData = (baseTexture.image as unknown as { data?: CanvasImageSource } | null)?.data;
        const overlayData = (overlayTex.image as unknown as { data?: CanvasImageSource } | null)?.data;
        if (!baseData || !overlayData || typeof document === 'undefined') {
            return this.getPetSkinMaterial(skinKey, 'original', baseTexture);
        }
        const w = Math.max(256, baseTexture.width || 1024);
        const h = Math.max(256, baseTexture.height || 1024);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return this.getPetSkinMaterial(skinKey, 'original', baseTexture);
        // 完整保留原品种面部、耳朵、脚掌与尾巴毛色，将透明服装皮肤精准合成至躯干与上袖 UV。
        ctx.drawImage(baseData, 0, 0, w, h);
        ctx.drawImage(overlayData, 0, 0, w, h);
        const imgAsset = new ImageAsset(canvas);
        const compTex = new Texture2D();
        compTex.image = imgAsset;
        this.compositeTextures.set(key, compTex);
        return this.getPetSkinMaterial(skinKey, coat, compTex);
    }

    private buildOutfitNode(outfit: OutfitId, rig: ActorRig): Node | null {
        // 全包式大帽（草帽、巫师帽）宽檐直接盖住头顶并收纳双耳，彻底零穿模且还原手绘大帽廓形；换回其他装扮自动恢复双耳。
        const coversEars = outfit === 'straw_hat' || outfit === 'wizard_hat';
        if (isValid(rig.earL, true)) rig.earL.active = !coversEars;
        if (isValid(rig.earR, true)) rig.earR.active = !coversEars;
        if (outfit === 'none') return null;
        const headMounted = outfit === 'pink_bow' || outfit === 'straw_hat' || outfit === 'gold_crown'
            || outfit === 'flower_wreath' || outfit === 'star_glasses' || outfit === 'wizard_hat' || outfit === 'angel_halo';
        const parent = headMounted ? rig.head : rig.modelNode;
        if (!isValid(parent, true)) return null;
        const root = new Node('宠物装扮-' + outfit);
        root.layer = Layers.Enum.DEFAULT;
        parent.addChild(root);
        // 严格对照 2D 手绘图标配色与造型还原 3D 挂件。
        if (outfit === 'bell_collar') {
            this.shape(root, 'torus', '#E24B3E', [0, 0.72, 0.34], [1.04, 0.44, 1.02], [24, 0, 0]);
            this.shape(root, 'sphere', '#C82D26', [0, 0.62, 0.90], [0.13, 0.10, 0.10]);
            this.shape(root, 'sphere', '#F8C944', [0, 0.50, 0.94], [0.24, 0.24, 0.24]);
            this.shape(root, 'torus', '#FFE278', [0, 0.50, 0.94], [0.24, 0.08, 0.24]);
            this.shape(root, 'sphere', '#6E4214', [0, 0.46, 1.05], [0.06, 0.06, 0.04]);
            this.shape(root, 'box', '#6E4214', [0, 0.46, 1.04], [0.14, 0.025, 0.03]);
        } else if (outfit === 'blue_scarf') {
            this.shape(root, 'torus', '#4E9AE6', [0, 0.72, 0.34], [1.06, 0.52, 1.04], [24, 0, 0]);
            this.shape(root, 'torus', '#88C4FA', [0, 0.69, 0.35], [1.05, 0.22, 1.03], [24, 0, 0]);
            this.shape(root, 'cone', '#5EA9F4', [0, 0.46, 0.92], [0.50, 0.42, 0.12], [164, 0, 0]);
            // 还原图标中的奶白小猫爪印花
            this.shape(root, 'sphere', '#FFF8E2', [0, 0.48, 0.98], [0.10, 0.09, 0.04]);
            for (const [px, py] of [[-0.08, 0.56], [-0.03, 0.59], [0.03, 0.59], [0.08, 0.56]] as const) {
                this.shape(root, 'sphere', '#FFF8E2', [px, py, 0.98], [0.042, 0.048, 0.03]);
            }
        } else if (outfit === 'pink_bow') {
            const bow = new Node('耳畔蝴蝶结');
            bow.layer = Layers.Enum.DEFAULT;
            root.addChild(bow);
            bow.setPosition(-0.22, 0.63, 0.32);
            bow.setRotationFromEuler(8, -18, 22);
            this.shape(bow, 'sphere', '#F47EA2', [-0.14, 0, 0], [0.25, 0.17, 0.11], [0, 0, 14]);
            this.shape(bow, 'sphere', '#F47EA2', [0.14, 0, 0], [0.25, 0.17, 0.11], [0, 0, -14]);
            this.shape(bow, 'sphere', '#FFD1DF', [0, 0, 0.04], [0.12, 0.12, 0.12]);
            this.shape(bow, 'box', '#E5638B', [-0.07, -0.10, 0.02], [0.06, 0.14, 0.04], [0, 0, 18]);
            this.shape(bow, 'box', '#E5638B', [0.07, -0.10, 0.02], [0.06, 0.14, 0.04], [0, 0, -18]);
        } else if (outfit === 'straw_hat') {
            // 宽檐大草帽：比头更宽、圆润帽冠盖住头顶与双耳，搭配红丝带与右侧双红果饰扣（还原 straw_hat.png）
            const hat = new Node('田园小草帽');
            hat.layer = Layers.Enum.DEFAULT;
            root.addChild(hat);
            hat.setPosition(0, 0.44, 0.02);
            hat.setRotationFromEuler(-8, 0, 0);
            this.shape(hat, 'cylinder', '#F4D178', [0, 0, 0], [1.62, 0.07, 1.56]);
            this.shape(hat, 'cylinder', '#E8BD5A', [0, 0.16, 0], [1.14, 0.30, 1.10]);
            this.shape(hat, 'sphere', '#F0C96A', [0, 0.28, 0], [1.12, 0.42, 1.08]);
            this.shape(hat, 'cylinder', '#E24F42', [0, 0.08, 0], [1.17, 0.11, 1.13]);
            // 右前侧双小红球饰扣
            this.shape(hat, 'sphere', '#EE5C4E', [0.38, 0.11, 0.46], [0.15, 0.15, 0.12]);
            this.shape(hat, 'sphere', '#EE5C4E', [0.49, 0.08, 0.39], [0.12, 0.12, 0.10]);
        } else if (outfit === 'gold_crown') {
            // 还原 gold_crown.png：金冠+尖顶金珠+居中红宝石+底带双蓝宝石
            const crown = new Node('迷你小皇冠');
            crown.layer = Layers.Enum.DEFAULT;
            root.addChild(crown);
            crown.setPosition(0.02, 0.69, 0.06);
            crown.setRotationFromEuler(-4, 0, -6);
            this.shape(crown, 'cylinder', '#F6C946', [0, 0, 0], [0.48, 0.18, 0.48]);
            this.shape(crown, 'cylinder', '#FFE27A', [0, -0.06, 0], [0.50, 0.08, 0.50]);
            for (const ang of [0, 72, 144, 216, 288]) {
                const rad = ang * Math.PI / 180;
                const sx = Math.sin(rad) * 0.20, sz = Math.cos(rad) * 0.20;
                this.shape(crown, 'cone', '#F6C946', [sx, 0.15, sz], [0.12, 0.20, 0.12]);
                this.shape(crown, 'sphere', '#FFE885', [sx, 0.26, sz], [0.075, 0.075, 0.075]);
            }
            this.shape(crown, 'sphere', '#EB4F66', [0, 0.03, 0.24], [0.10, 0.10, 0.07]);
            this.shape(crown, 'sphere', '#4EA8F0', [-0.13, -0.06, 0.22], [0.065, 0.065, 0.05]);
            this.shape(crown, 'sphere', '#4EA8F0', [0.13, -0.06, 0.22], [0.065, 0.065, 0.05]);
        } else if (outfit === 'flower_wreath') {
            // 还原 flower_wreath.png：嫩绿藤环+粉/黄/天蓝多瓣小花与嫩叶
            const wreath = new Node('春日花环');
            wreath.layer = Layers.Enum.DEFAULT;
            root.addChild(wreath);
            wreath.setPosition(0, 0.60, 0.06);
            wreath.setRotationFromEuler(-10, 0, 0);
            this.shape(wreath, 'torus', '#7BBF66', [0, 0, 0], [0.96, 0.18, 0.90]);
            const cols = ['#F79AB5', '#FFE066', '#8CC8F5', '#FFA6C1', '#FFE066', '#8CC8F5', '#F79AB5'];
            for (let i = 0; i < 7; i++) {
                const rad = (i * (360 / 7)) * Math.PI / 180;
                const fx = Math.sin(rad) * 0.45, fz = Math.cos(rad) * 0.42;
                const fl = new Node('花朵-' + i); fl.layer = Layers.Enum.DEFAULT; wreath.addChild(fl);
                fl.setPosition(fx, 0.03, fz);
                fl.setRotationFromEuler(0, i * (360 / 7), 0);
                this.shape(fl, 'sphere', '#FFE46B', [0, 0.02, 0.03], [0.065, 0.065, 0.05]);
                for (let p = 0; p < 5; p++) {
                    const pr = (p * 72) * Math.PI / 180;
                    this.shape(fl, 'sphere', cols[i], [Math.cos(pr) * 0.065, 0.02 + Math.sin(pr) * 0.065, 0.01], [0.075, 0.075, 0.045]);
                }
                // 侧边嫩叶
                this.shape(fl, 'sphere', '#8ED174', [0.11, -0.02, 0], [0.09, 0.045, 0.04], [0, 0, 26]);
            }
        } else if (outfit === 'star_glasses') {
            // 还原 star_glasses.png：真正五角星造型金色墨镜（每只镜片由 5 枚星芒组成）+ 金色鼻梁与镜腿
            for (const cx of [-0.24, 0.24]) {
                const star = new Node('星形镜片');
                star.layer = Layers.Enum.DEFAULT;
                root.addChild(star);
                star.setPosition(cx, 0.03, 0.80);
                this.shape(star, 'sphere', '#E89E34', [0, 0, 0], [0.15, 0.15, 0.05]);
                for (let k = 0; k < 5; k++) {
                    const deg = k * 72;
                    const rad = deg * Math.PI / 180;
                    this.shape(star, 'cone', '#E49428', [Math.sin(rad) * 0.09, Math.cos(rad) * 0.09, 0], [0.09, 0.15, 0.05], [0, 0, -deg]);
                    this.shape(star, 'cone', '#FCD36C', [Math.sin(rad) * 0.065, Math.cos(rad) * 0.065, 0.015], [0.06, 0.10, 0.035], [0, 0, -deg]);
                }
            }
            this.shape(root, 'box', '#C47B22', [0, 0.05, 0.80], [0.16, 0.035, 0.035]);
            this.shape(root, 'box', '#C47B22', [-0.41, 0.05, 0.62], [0.035, 0.035, 0.36], [0, -14, 0]);
            this.shape(root, 'box', '#C47B22', [0.41, 0.05, 0.62], [0.035, 0.035, 0.36], [0, 14, 0]);
        } else if (outfit === 'wizard_hat') {
            // 宽檐大巫师帽：比头更宽、盖住双耳，配金色丝带、右侧弯折帽尖与满天金星点缀（还原 wizard_hat.png）
            const wiz = new Node('魔法巫师帽');
            wiz.layer = Layers.Enum.DEFAULT;
            root.addChild(wiz);
            wiz.setPosition(0, 0.44, 0.02);
            wiz.setRotationFromEuler(-6, 0, 0);
            this.shape(wiz, 'cylinder', '#455A9C', [0, 0, 0], [1.66, 0.07, 1.60]);
            this.shape(wiz, 'cylinder', '#F6C648', [0, 0.08, 0], [1.14, 0.11, 1.10]);
            this.shape(wiz, 'cone', '#405494', [0, 0.42, 0], [1.12, 0.66, 1.08], [-4, 0, -10]);
            // 右侧优雅弯垂的巫师帽尖
            this.shape(wiz, 'cone', '#3B4E8C', [0.24, 0.68, -0.02], [0.44, 0.48, 0.42], [0, 0, -58]);
            // 散落金色小星星点缀（帽身与帽檐）
            for (const [sx, sy, sz] of [
                [-0.28, 0.24, 0.36], [0.16, 0.38, 0.30], [-0.06, 0.52, 0.20], [0.34, 0.22, 0.26],
                [-0.58, 0.05, 0.36], [0.56, 0.05, 0.34], [0.02, 0.05, 0.66],
            ] as const) {
                this.shape(wiz, 'sphere', '#FFE169', [sx, sy, sz], [0.085, 0.085, 0.06]);
            }
        } else if (outfit === 'angel_halo') {
            // 还原 angel_halo.png：发光金环 + 两侧多层羽翼小翅膀
            this.shape(root, 'torus', '#FFE066', [0, 1.06, 0.02], [0.78, 0.22, 0.72], [8, 0, 0]);
            for (const side of [-1, 1]) {
                this.shape(root, 'sphere', '#FFFBF0', [side * 0.48, 0.94, -0.02], [0.26, 0.14, 0.09], [0, 0, -side * 34]);
                this.shape(root, 'sphere', '#FFF4DC', [side * 0.56, 0.86, -0.03], [0.20, 0.11, 0.08], [0, 0, -side * 16]);
                this.shape(root, 'sphere', '#FFFBF0', [side * 0.40, 0.82, -0.02], [0.16, 0.13, 0.09], [0, 0, -side * 8]);
            }
        } else if (outfit === 'butterfly_wings') {
            // 还原 butterfly_wings.png：粉边+浅天蓝渐层燕尾蝶翼 + 两侧金色星芒
            this.shape(root, 'sphere', '#FFE89A', [0, 0.92, -0.32], [0.14, 0.22, 0.10]);
            for (const side of [-1, 1]) {
                // 上翅：粉色外瓣 + 浅天蓝内纹
                this.shape(root, 'sphere', '#F7B0D8', [side * 0.78, 1.16, -0.34], [0.64, 0.46, 0.07], [10, -side * 18, -side * 30]);
                this.shape(root, 'sphere', '#BCE8FC', [side * 0.68, 1.12, -0.30], [0.42, 0.28, 0.06], [10, -side * 18, -side * 30]);
                // 下翅 + 燕尾小尖
                this.shape(root, 'sphere', '#F7B0D8', [side * 0.60, 0.80, -0.38], [0.44, 0.34, 0.07], [10, -side * 16, side * 18]);
                this.shape(root, 'sphere', '#BCE8FC', [side * 0.54, 0.82, -0.34], [0.28, 0.20, 0.06], [10, -side * 16, side * 18]);
                this.shape(root, 'cone', '#F5A4D0', [side * 0.58, 0.56, -0.40], [0.11, 0.24, 0.06], [180, 0, side * 14]);
                // 浮空金星点缀
                this.shape(root, 'sphere', '#FFE066', [side * 0.96, 1.38, -0.26], [0.09, 0.09, 0.06]);
            }
        } else if (outfit === 'royal_cape') {
            // 还原 royal_cape.png：薰衣草紫翻领披风 + 金色弯月胸扣 + 金边垂坠披肩 + 金星点缀
            this.shape(root, 'torus', '#A684E0', [0, 0.74, 0.32], [1.06, 0.44, 1.02], [24, 0, 0]);
            // 金色弯月胸扣
            this.shape(root, 'sphere', '#F8CB48', [0, 0.64, 0.86], [0.17, 0.17, 0.08]);
            this.shape(root, 'sphere', '#8F6AD6', [0.05, 0.66, 0.89], [0.12, 0.12, 0.07]);
            // 环绕双肩与背部的宽幅紫色披风 + 金边镶饰
            this.shape(root, 'box', '#9A76D8', [0, 0.80, -0.42], [1.14, 0.64, 0.10], [40, 0, 0]);
            this.shape(root, 'box', '#F6C948', [0, 0.56, -0.62], [1.16, 0.08, 0.11], [40, 0, 0]);
            // 左右垂肩片（正面可见紫色金边披肩）
            for (const side of [-1, 1]) {
                this.shape(root, 'box', '#9A76D8', [side * 0.52, 0.56, 0.16], [0.22, 0.44, 0.54], [12, side * 12, -side * 18]);
                this.shape(root, 'box', '#F6C948', [side * 0.44, 0.54, 0.42], [0.06, 0.42, 0.08], [12, side * 12, -side * 16]);
                this.shape(root, 'sphere', '#FFE168', [side * 0.56, 0.58, 0.24], [0.08, 0.08, 0.06]);
            }
            for (const [sx, sy, sz] of [[-0.32, 0.78, -0.50], [0.30, 0.74, -0.52], [0, 0.88, -0.44]] as const) {
                this.shape(root, 'sphere', '#FFE168', [sx, sy, sz], [0.09, 0.09, 0.07]);
            }
        }
        return root;
    }

    private setLayerRecursive(node: Node, layer: number) {
        node.layer = layer;
        node.children.forEach(child => this.setLayerRecursive(child, layer));
    }

    private clearProfilePreview() {
        if (this.previewStage && isValid(this.previewStage, true)) {
            this.previewStage.active = false;
            this.previewStage.removeFromParent();
            this.previewStage.destroy();
        }
        this.previewStage = null;
        this.previewVisual = null;
        this.previewRig = null;
        this.previewLoadedKey = '';
        if (this.previewCamera && isValid(this.previewCamera, true)) this.previewCamera.enabled = false;
    }

    private async syncProfilePreview(petId: number, force = false) {
        const pet = this.data.pets.find(p => p.id === petId);
        if (!pet || this.page !== 'profile') { this.clearProfilePreview(); return; }
        const key = pet.id + ':' + pet.outfit + ':' + pet.coat;
        if (!force && this.previewLoadedKey === key && this.previewRig && isValid(this.previewRig.modelNode, true)) return;
        // 同一只伙伴仅切换装扮或毛色时，直接原位更新装扮与材质，绝不销毁重建舞台，杜绝闪烁与跳动。
        if (!force && this.previewLoadedKey.startsWith(pet.id + ':') && this.previewRig && isValid(this.previewRig.modelNode, true)) {
            const pRig = this.previewRig;
            if (pRig.outfitNode && isValid(pRig.outfitNode, true)) {
                pRig.outfitNode.active = false;
                pRig.outfitNode.removeFromParent();
                pRig.outfitNode.destroy();
            }
            pRig.outfitNode = this.buildOutfitNode(pet.outfit, pRig);
            if (pRig.outfitNode) this.setLayerRecursive(pRig.outfitNode, this.previewLayer);
            this.previewLoadedKey = key;
            const skinTex = await this.loadPetSkin(BREEDS[pet.id].skin);
            if (skinTex && isValid(this, true) && this.previewRig === pRig && isValid(pRig.modelNode, true)) {
                const mat = await this.getCompositePetMaterial(BREEDS[pet.id].skin, pet.coat, skinTex);
                if (isValid(this, true) && this.previewRig === pRig && isValid(pRig.modelNode, true)) {
                    pRig.renderers.forEach(r => { if (isValid(r, true)) r.setSharedMaterial(mat, 0); });
                }
            }
            return;
        }
        const breed = BREEDS[pet.id];
        const rigKey = this.petRigKey(breed);
        const [rig, skinTexture, shadowTex] = await Promise.all([
            this.loadPetRig(rigKey),
            this.loadPetSkin(breed.skin),
            this.loadShadowTexture(),
        ]);
        if (!rig || !skinTexture || !isValid(this, true) || this.page !== 'profile' || this.profilePetId !== petId) return;
        const material = await this.getCompositePetMaterial(breed.skin, pet.coat, skinTexture);
        if (!isValid(this, true) || this.page !== 'profile' || this.profilePetId !== petId) return;
        this.clearProfilePreview();
        const stage = new Node('宠物主页3D舞台');
        this.node.addChild(stage);
        stage.setPosition(0, 0, 0);
        const visual = new Node('预览重心');
        stage.addChild(visual);
        const faceMaterial = this.getPetSkinMaterial(breed.skin, 'original', skinTexture);
        const modelNode = new Node('预览卡通模型');
        visual.addChild(modelNode);
        const renderers: MeshRenderer[] = [];
        const addPart = (parent: Node, name: string, part: RigPartName, pivot?: [number, number, number]) => {
            const node = new Node(name);
            parent.addChild(node);
            if (pivot) node.setPosition(pivot[0], pivot[1], pivot[2]);
            const renderer = node.addComponent(MeshRenderer);
            renderer.mesh = rig.meshes[part];
            // 五官始终使用原版无叠色材质，确保换肤时眼睛清亮闪耀不发脏。
            renderer.setSharedMaterial(part === 'face' ? faceMaterial : material, 0);
            if (part !== 'face') renderers.push(renderer);
            return node;
        };
        addPart(modelNode, '身体', 'body');
        const head = addPart(modelNode, '头部', 'head', rig.pivots.head);
        addPart(head, '五官', 'face');
        const earL = addPart(head, '左耳', 'earL', rig.pivots.earL);
        const earR = addPart(head, '右耳', 'earR', rig.pivots.earR);
        const legFL = addPart(modelNode, '左前腿', 'legFL', rig.pivots.legFL);
        const legFR = addPart(modelNode, '右前腿', 'legFR', rig.pivots.legFR);
        const legBL = addPart(modelNode, '左后腿', 'legBL', rig.pivots.legBL);
        const legBR = addPart(modelNode, '右后腿', 'legBR', rig.pivots.legBR);
        const tail = addPart(modelNode, '尾巴', 'tail', rig.pivots.tail);
        let shadow: Node | null = null;
        if (shadowTex) {
            let smesh = this.meshes.get('pet:shadow');
            if (!smesh) {
                smesh = utils.createMesh(primitives.plane({ width: 1.9, length: 2.15, widthSegments: 1, lengthSegments: 1 }));
                this.meshes.set('pet:shadow', smesh);
            }
            let smat = this.materials.get('pet:shadow');
            if (!smat) {
                smat = new Material();
                smat.initialize({ effectName: 'builtin-unlit', technique: 1, defines: { USE_TEXTURE: true } });
                smat.setProperty('mainTexture', shadowTex);
                smat.setProperty('mainColor', this.color(C.white));
                this.materials.set('pet:shadow', smat);
            }
            shadow = new Node('预览阴影');
            stage.addChild(shadow);
            shadow.setSiblingIndex(0);
            shadow.setPosition(0, 0.02, -0.02);
            const sr = shadow.addComponent(MeshRenderer);
            sr.mesh = smesh; sr.setSharedMaterial(smat, 0);
            sr.shadowCastingMode = 0; sr.receiveShadow = 0;
        }
        const actorRig: ActorRig = {
            kind: breed.kind, uprightEars: rigKey !== 'dog', modelNode, head, earL, earR, legFL, legFR, legBL, legBR, tail,
            shadow, outfitNode: null, renderers, pivots: rig.pivots,
        };
        actorRig.outfitNode = this.buildOutfitNode(pet.outfit, actorRig);
        this.setLayerRecursive(stage, this.previewLayer);
        this.previewStage = stage;
        this.previewVisual = visual;
        this.previewRig = actorRig;
        this.previewLoadedKey = key;
        this.updateProfilePreview(0.016);
    }

    private updateProfilePreview(dt: number) {
        if (!this.previewCamera || !isValid(this.previewCamera, true)) return;
        const active = this.page === 'profile' && !this.dialog && !this.gmPanel && !!this.previewRig && !!this.previewStage &&
            isValid(this.previewStage, true) && !!this.previewViewportNode && isValid(this.previewViewportNode, true);
        if (!active) {
            this.previewCamera.enabled = false;
            return;
        }
        this.previewCamera.enabled = true;

        // 柔和待机动画：呼吸缩放、轻缓转体展示装扮、歪头张望、耳部微弹与连续平滑摇尾。
        const rig = this.previewRig!;
        const isCat = rig.kind === 'cat';
        this.previewTime += dt;
        const t = this.previewTime;
        const breath = Math.sin(t * (isCat ? 2.2 : 2.7)) * 0.02;
        let hopY = 0;
        if (this.previewHop > 0) {
            this.previewHop = Math.max(0, this.previewHop - dt);
            hopY = Math.sin((this.previewHop / 0.55) * Math.PI) * 0.22;
        }
        const sy = 1 + breath + (hopY > 0 ? Math.sin((this.previewHop / 0.55) * Math.PI * 2) * 0.05 : 0);
        const sxz = 1 / Math.sqrt(Math.max(0.88, sy));
        const idleYaw = this.previewDragYaw + Math.sin(t * 0.72) * 14;
        this.previewStage!.setRotationFromEuler(0, idleYaw, 0);
        if (this.previewVisual && isValid(this.previewVisual, true)) {
            this.previewVisual.setPosition(0, hopY, 0);
            this.previewVisual.setScale(sxz, sy, sxz);
        }
        if (isValid(rig.head, true)) {
            const headYaw = Math.sin(t * 1.05) * 11;
            const headPitch = Math.sin(t * 2.2) * 2.8 - (hopY > 0 ? 6 : 0);
            const headRoll = Math.sin(t * 0.82) * 6.5;
            rig.head.setRotationFromEuler(headPitch, headYaw, headRoll);
            if (rig.uprightEars) {
                const earWiggle = Math.sin(t * 1.9) * 2.8;
                rig.earL.setRotationFromEuler(0, 0, earWiggle);
                rig.earR.setRotationFromEuler(0, 0, -earWiggle);
            } else {
                const flap = 2.5 + Math.sin(t * 2.7) * 2.5 + hopY * 45;
                rig.earL.setRotationFromEuler(0, 0, flap);
                rig.earR.setRotationFromEuler(0, 0, -flap);
            }
            const wagFreq = isCat ? 2.5 : 4.6;
            this.previewTailPhase = (this.previewTailPhase + dt * wagFreq) % (Math.PI * 2);
            const wagAmp = isCat ? 15 : 22;
            rig.tail.setRotationFromEuler((isCat ? 4 : 5) * Math.cos(this.previewTailPhase), Math.sin(this.previewTailPhase) * wagAmp, 0);
            if (rig.shadow && isValid(rig.shadow, true)) {
                const sc = Math.max(0.76, 1 - hopY * 0.6);
                rig.shadow.setScale(sc, 1, sc);
            }
        }
    }

    private async refreshPetAppearance(petId: number) {
        const actor = this.actors.find(a => a.pet.id === petId);
        const pet = this.data.pets.find(p => p.id === petId);
        if (!pet) return;
        const skinTex = await this.loadPetSkin(BREEDS[petId].skin);
        if (!isValid(this, true)) return;
        const mat = skinTex ? await this.getCompositePetMaterial(BREEDS[petId].skin, pet.coat, skinTex) : null;
        if (!isValid(this, true)) return;
        if (actor) {
            actor.pet = pet;
            const rig = actor.rig;
            if (rig && isValid(rig.modelNode, true)) {
                if (rig.outfitNode && isValid(rig.outfitNode, true)) {
                    rig.outfitNode.active = false;
                    rig.outfitNode.removeFromParent();
                    rig.outfitNode.destroy();
                }
                rig.outfitNode = this.buildOutfitNode(pet.outfit, rig);
                if (mat) rig.renderers.forEach(r => { if (isValid(r, true)) r.setSharedMaterial(mat, 0); });
            }
        }
        // 主页 3D 预览原位无跳动替换装扮与毛色，保持待机动画连续平滑不闪烁、不弹跳。
        if (this.page === 'profile' && this.profilePetId === petId) {
            const pRig = this.previewRig;
            if (pRig && isValid(pRig.modelNode, true)) {
                if (pRig.outfitNode && isValid(pRig.outfitNode, true)) {
                    pRig.outfitNode.active = false;
                    pRig.outfitNode.removeFromParent();
                    pRig.outfitNode.destroy();
                }
                pRig.outfitNode = this.buildOutfitNode(pet.outfit, pRig);
                if (pRig.outfitNode) this.setLayerRecursive(pRig.outfitNode, this.previewLayer);
                if (mat) pRig.renderers.forEach(r => { if (isValid(r, true)) r.setSharedMaterial(mat, 0); });
                this.previewLoadedKey = pet.id + ':' + pet.outfit + ':' + pet.coat;
            } else {
                void this.syncProfilePreview(petId, true);
            }
        }
    }

    private async attachPetModel(actor: Actor, fallback: Node) {
        const b = BREEDS[actor.pet.id];
        const rigKey = this.petRigKey(b);
        const [rig, skinTexture, shadowTex] = await Promise.all([
            this.loadPetRig(rigKey),
            this.loadPetSkin(b.skin),
            this.loadShadowTexture(),
        ]);
        if (!rig || !skinTexture || !isValid(this, true) || !isValid(actor.node, true) || !isValid(fallback, true)) return;
        let modelNode: Node | null = null;
        try {
            const material = await this.getCompositePetMaterial(b.skin, actor.pet.coat, skinTexture);
            if (!isValid(this, true) || !isValid(actor.node, true) || !isValid(fallback, true)) return;
            const faceMaterial = this.getPetSkinMaterial(b.skin, 'original', skinTexture);
            modelNode = new Node('卡通可动模型'); modelNode.layer = Layers.Enum.DEFAULT;
            actor.visual.addChild(modelNode);
            const renderers: MeshRenderer[] = [];
            const addMeshPart = (parent: Node, name: string, part: RigPartName, pivot?: [number, number, number]) => {
                const node = new Node(name); node.layer = Layers.Enum.DEFAULT;
                parent.addChild(node);
                if (pivot) node.setPosition(pivot[0], pivot[1], pivot[2]);
                const renderer = node.addComponent(MeshRenderer);
                renderer.mesh = rig.meshes[part];
                renderer.setSharedMaterial(part === 'face' ? faceMaterial : material, 0);
                if (part !== 'face') renderers.push(renderer);
                return node;
            };
            addMeshPart(modelNode, '身体', 'body');
            const head = addMeshPart(modelNode, '头部', 'head', rig.pivots.head);
            addMeshPart(head, '五官', 'face');
            const earL = addMeshPart(head, '左耳', 'earL', rig.pivots.earL);
            const earR = addMeshPart(head, '右耳', 'earR', rig.pivots.earR);
            const legFL = addMeshPart(modelNode, '左前腿', 'legFL', rig.pivots.legFL);
            const legFR = addMeshPart(modelNode, '右前腿', 'legFR', rig.pivots.legFR);
            const legBL = addMeshPart(modelNode, '左后腿', 'legBL', rig.pivots.legBL);
            const legBR = addMeshPart(modelNode, '右后腿', 'legBR', rig.pivots.legBR);
            const tail = addMeshPart(modelNode, '尾巴', 'tail', rig.pivots.tail);
            const shadow = this.attachPetShadow(actor, shadowTex);
            const actorRig: ActorRig = {
                kind: b.kind, uprightEars: rigKey !== 'dog', modelNode, head, earL, earR, legFL, legFR, legBL, legBR, tail,
                shadow, outfitNode: null, renderers, pivots: rig.pivots,
            };
            actorRig.outfitNode = this.buildOutfitNode(actor.pet.outfit, actorRig);
            actor.rig = actorRig;
            fallback.active = false;
            fallback.destroy();
        } catch {
            modelNode?.destroy();
            this.toast(b.name + '模型暂不可用，已保留原有伙伴');
        }
    }

    private spawnPet(pet: Pet) {
        if (pet.dead || pet.lost) return;
        const b = BREEDS[pet.id], cat = b.kind === 'cat';
        const root = new Node(b.name); this.world.addChild(root);
        const col = pet.id % 4, row = Math.floor(pet.id / 4);
        root.setPosition(-2.4 + col * 1.6, 0, -2.5 + row * 3.6 + (col % 2 ? 0.55 : -0.35));
        root.setScale(this.petNodeScale, this.petNodeScale, this.petNodeScale);
        const visual = new Node('重心摆动'); root.addChild(visual);
        const n = new Node('Fallback'); visual.addChild(n);
        this.shape(n, 'sphere', b.color, [0, 0.64, -0.1], [1.42, 1.24, 1.5]);
        this.shape(n, 'sphere', b.color, [0, 1.06, 0.54], [1.62, 1.46, 1.38]);
        for (const x of [-0.4, 0.4]) for (const z of [-0.48, 0.43]) {
            this.shape(n, 'sphere', b.color, [x, 0.17, z], [0.38, 0.18, 0.4]);
            this.shape(n, 'sphere', '#F8E8D1', [x, 0.1, z + 0.07], [0.4, 0.18, 0.46]);
        }
        for (const side of [-1, 1]) {
            this.shape(n, 'sphere', b.accent, [side * (cat ? 0.46 : 0.66), cat ? 1.76 : 1.22, 0.56],
                cat ? [0.43, 0.53, 0.35] : [0.43, 0.82, 0.48], [0, 0, side * (cat ? -22 : 15)]);
            if (cat) this.shape(n, 'sphere', '#E8ADA4', [side * 0.46, 1.79, 0.72], [0.23, 0.32, 0.08], [0, 0, -side * 22]);
            this.shape(n, 'sphere', '#303A35', [side * 0.28, 1.3, 1.13], [0.14, 0.19, 0.09]);
            this.shape(n, 'sphere', '#FFFFFF', [side * 0.28 - 0.025, 1.35, 1.175], [0.045, 0.055, 0.03]);
            this.shape(n, 'sphere', '#E6AC9C', [side * 0.43, 1.09, 1.11], [0.22, 0.12, 0.065]);
            this.shape(n, 'sphere', '#F7E6D0', [side * 0.14, 1.03, 1.15], [cat ? 0.32 : 0.4, 0.28, cat ? 0.22 : 0.36]);
        }
        this.shape(n, 'sphere', cat ? '#BD8881' : '#4F4B43', [0, 1.12, cat ? 1.29 : 1.35], [0.17, 0.12, 0.11]);
        this.shape(n, 'sphere', '#71584C', [0, 0.98, 1.28], [0.09, 0.045, 0.055]);
        this.shape(n, 'sphere', b.accent, [0, 0.85, -0.93], cat ? [0.3, 0.86, 0.32] : [0.46, 0.46, 0.48], [-25, 0, 0]);
        if (cat) this.shape(n, 'sphere', b.accent, [0, 1.22, -1.08], [0.38, 0.34, 0.33]);
        const actor: Actor = {
            node: root, visual, pet, target: root.position.clone(),
            timer: 0.25 + (pet.id % 3) * 0.45, walkAge: 0, phase: Math.random() * Math.PI * 2,
            speed: 0, idleTime: Math.random() * 10, lookYaw: 0, lookTilt: 0,
            lookTimer: 1.2 + Math.random() * 2.0, facing: (Math.random() - 0.5) * 60,
        };
        root.setRotationFromEuler(0, actor.facing!, 0);
        this.actors.push(actor);
        this.syncActorVisibility();
        // 卡通可动 3D 模型就绪后替换几何 Fallback，加载失败不影响点击与照顾。
        void this.attachPetModel(actor, n);
    }

    private makeUI() {
        this.ui = new Node('庭院界面'); this.node.addChild(this.ui); this.ui.layer = Layers.Enum.UI_2D;
        this.ui.addComponent(UITransform);
        const cameraNode = new Node('界面相机'); this.node.addChild(cameraNode); cameraNode.setPosition(0, 0, 1000);
        this.uiCamera = cameraNode.addComponent(Camera); this.uiCamera.projection = Camera.ProjectionType.ORTHO;
        this.uiCamera.visibility = Layers.Enum.UI_2D; this.uiCamera.priority = 10;
        this.uiCamera.clearFlags = Camera.ClearFlag.DEPTH_ONLY; this.uiCamera.near = 0.1; this.uiCamera.far = 2000;
        const canvas = this.ui.addComponent(Canvas); canvas.cameraComponent = this.uiCamera;
        this.top = this.uiNode(this.ui, '顶栏', 0, 0, 1024, 140);
        this.bottom = this.uiNode(this.ui, '底栏', 0, 0, 1080, 180);
        const note = this.uiNode(this.ui, '提示', 0, 0, 980, 66);
        this.notice = this.text(note, '点击庭院里的猫猫狗狗，开始照顾它们', 0, 0, 950, 54, 27, C.ink);
        const daily = this.uiNode(this.ui, '每日任务入口', 390, 650, 190, 174);
        this.intercept(daily); this.pressFeedback(daily);
        this.dailySprite(daily, 'task', 0, 26, 108, 98, false, '每日入口图标');
        this.navCaption(daily, '任务', 0);
        daily.on(Node.EventType.TOUCH_END, () => this.open('daily'), this);

        // 冒险日记入口：位于每日任务入口正下方
        const diary = this.uiNode(this.ui, '冒险日记入口', 390, 490, 190, 174);
        this.intercept(diary); this.pressFeedback(diary);
        const diaryIcon = this.uiNode(diary, '日记入口图标', 0, 26, 98, 98).addComponent(Sprite);
        diaryIcon.sizeMode = Sprite.SizeMode.CUSTOM;
        resources.load('art/adventure/diary-icon/spriteFrame', SpriteFrame, (e, f) => { if (!e && f && isValid(diaryIcon, true)) diaryIcon.spriteFrame = f; });
        this.navCaption(diary, '日记', 1);
        diary.on(Node.EventType.TOUCH_END, () => this.open('diary'), this);

        // 后院纪念角入口：位于冒险日记下方，有离世伙伴或已购/已立墓碑时自动开放
        const memorial = this.uiNode(this.ui, '后院纪念角入口', 390, 330, 190, 174);
        this.intercept(memorial); this.pressFeedback(memorial);
        const memIcon = this.uiNode(memorial, '纪念角入口图标', 0, 26, 98, 98).addComponent(Sprite);
        memIcon.sizeMode = Sprite.SizeMode.CUSTOM;
        resources.load('art/memorial/tomb-wood/spriteFrame', SpriteFrame, (e, f) => { if (!e && f && isValid(memIcon, true)) memIcon.spriteFrame = f; });
        this.navCaption(memorial, '纪念角', 2);
        memorial.on(Node.EventType.TOUCH_END, () => this.open('memorial'), this);
        this.refreshMemorialEntry();

        // GM 预览调试悬浮入口（位于左上头像栏下方，不遮挡顶栏/底栏与主操作区）
        const gm = this.uiNode(this.ui, 'GM调试入口', -440, 730, 104, 46);
        const gmg = gm.addComponent(Graphics);
        gmg.fillColor = new Color(92, 58, 36, 215); gmg.strokeColor = this.color('#F5C86B'); gmg.lineWidth = 3;
        gmg.roundRect(-52, -23, 104, 46, 23); gmg.fill(); gmg.stroke();
        const gmLbl = this.text(gm, 'GM 调试', 0, 0, 96, 36, 20, '#FFF6DC');
        gmLbl.isBold = true; gmLbl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
        this.intercept(gm); this.pressVisualFeedback(gm, gm.children.slice());
        gm.on(Node.EventType.TOUCH_END, () => this.toggleGmPanel(), this);

        this.layout(); this.renderHeader(); this.renderNav();
    }

    private uiNode(parent: Node, name: string, x: number, y: number, w: number, h: number): Node {
        const n = new Node(name); n.layer = Layers.Enum.UI_2D; parent.addChild(n); n.setPosition(x, y, 0);
        n.addComponent(UITransform).setContentSize(w, h); return n;
    }
    private async skin(n: Node, key: string) {
        const size = n.getComponent(UITransform)!.contentSize;
        const background = this.uiNode(n, '皮肤', 0, 0, size.width, size.height);
        background.setSiblingIndex(0);
        const sprite = background.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.type = Sprite.Type.SLICED;
        let loading = this.skins.get(key);
        if (!loading) {
            loading = new Promise<SpriteFrame | null>(resolve => {
                resources.load('art/skin/' + key + '/spriteFrame', SpriteFrame, (error, frame) => resolve(error ? null : frame));
            });
            this.skins.set(key, loading);
        }
        const frame = await loading;
        if (!frame || !isValid(this, true) || !isValid(n, true) || !isValid(background, true) || !isValid(sprite, true)) return;
        sprite.spriteFrame = frame;
        n.getComponent(Graphics)?.clear();
    }
    private card(n: Node, fill = C.cream, radius = 28) {
        const size = n.getComponent(UITransform)!.contentSize;
        const g = n.getComponent(Graphics) || n.addComponent(Graphics); g.clear(); g.fillColor = this.color(fill);
        g.roundRect(-size.width / 2, -size.height / 2, size.width, size.height, radius); g.fill();
        if (n.name === '友好相遇' || n.name === '已获得' || n.name === '数值' || n.name === '每日任务面板' || n.name.startsWith('每日任务-')) return;
        const key = n.name === '底栏' ? (this.petSelected && (this.page === 'pet' || this.page === 'bag') ? 'dock' : 'navdock') : n.name === '顶栏' || n.name === '宠物状态' ? 'status' :
            n.name === '操作卡片' ? 'panel' : size.height <= 24 ? 'trough' :
            n.parent === this.bottom || size.width / size.height < 2 ? 'tile' : 'button';
        void this.skin(n, key);
    }
    private intercept(n: Node) {
        n.addComponent(BlockInputEvents);
        const block = (e: EventTouch) => { this.blockedUntil = Date.now() + 350; e.propagationStopped = true; };
        n.on(Node.EventType.TOUCH_START, block, this); n.on(Node.EventType.TOUCH_END, block, this); n.on(Node.EventType.TOUCH_CANCEL, block, this);
    }
    private text(parent: Node, value: string, x: number, y: number, w: number, h: number, font = 28, color = C.ink): Label {
        const n = this.uiNode(parent, '文字', x, y, w, h), l = n.addComponent(Label);
        l.string = value; l.fontSize = font; l.lineHeight = font + 9; l.color = this.color(color);
        l.horizontalAlign = Label.HorizontalAlign.CENTER; l.verticalAlign = Label.VerticalAlign.CENTER;
        l.overflow = Label.Overflow.SHRINK; return l;
    }
    private button(parent: Node, title: string, x: number, y: number, w: number, h: number, action: () => void, fill = C.green, font = 28) {
        const n = this.uiNode(parent, title, x, y, w, h); this.card(n, fill, 22); this.intercept(n);
        this.text(n, title, 0, 0, w - 18, h - 8, font, C.ink);
        this.pressFeedback(n);
        n.on(Node.EventType.TOUCH_END, (event: EventTouch) => { event.propagationStopped = true; this.blockedUntil = Date.now() + 350; action(); }, this);
        return n;
    }
    private clearRecruitBackground() {
        if (this.recruitBackground && isValid(this.recruitBackground, true)) {
            this.recruitBackground.active = false;
            this.recruitBackground.removeFromParent();
            this.recruitBackground.destroy();
        }
        this.recruitBackground = null;
        this.recruitLabels = []; this.recruitProgress = null; this.recruitBadge = null; this.recruitResult = null;
    }
    private clear(n: Node) {
        if (n === this.ui) this.clearRecruitBackground();
        for (const child of n.children.slice()) { child.active = false; child.removeFromParent(); child.destroy(); }
        n.getComponent(Graphics)?.clear();
    }
    private pressFeedback(n: Node) {
        // 命中区域、文字和底栏不动，只相对图标原有缩放播放反馈。
        const baseScales = new Map<Node, Vec3>();
        const animate = (scale: number, duration: number) => {
            const target = n.children.find(child => child.name === '照顾图标' || (child.name.startsWith('主城素材-') && !child.name.endsWith('selected') && !child.name.includes('label')));
            if (!target) return;
            if (!baseScales.has(target)) baseScales.set(target, target.scale.clone());
            const base = baseScales.get(target)!;
            Tween.stopAllByTarget(target);
            tween(target).to(duration, { scale: new Vec3(base.x * scale, base.y * scale, base.z) }, { easing: 'quadOut' }).start();
        };
        n.on(Node.EventType.TOUCH_START, () => animate(0.94, 0.06), this);
        n.on(Node.EventType.TOUCH_END, () => animate(1, 0.12), this);
        n.on(Node.EventType.TOUCH_CANCEL, () => animate(1, 0.10), this);
        n.on(Node.EventType.NODE_DESTROYED, () => Tween.stopAllByTarget(n));
    }
    private layout() {
        const size = view.getVisibleSize(); this.width = size.width; this.height = size.height;
        this.ui.getComponent(UITransform)!.setContentSize(this.width, this.height);
        this.uiCamera.orthoHeight = this.height / 2;
        this.top.setPosition(0, this.height / 2 - 110, 0);
        // 入口宽190：右边缘距设计画布右侧4，按确认位置进一步靠右。
        this.ui.getChildByName('每日任务入口')?.setPosition(this.width / 2 - 4 - 190 / 2, this.height / 2 - 295, 0);
        this.ui.getChildByName('冒险日记入口')?.setPosition(this.width / 2 - 4 - 190 / 2, this.height / 2 - 458, 0);
        this.ui.getChildByName('后院纪念角入口')?.setPosition(this.width / 2 - 4 - 190 / 2, this.height / 2 - 620, 0);
        this.ui.getChildByName('GM调试入口')?.setPosition(-Math.min(this.width / 2 - 72, 416), this.height / 2 - 226, 0);
        this.bottom.setPosition(0, -this.height / 2 + 90, 0);
        this.layoutGmPanel();
        if (this.page !== 'home' && Date.now() > this.noticeUntil && this.notice) {
            this.notice.string = '';
            this.notice.node.parent?.getComponent(Graphics)?.clear();
        }
        this.layoutNotice();
        this.layoutDialog();
        this.layoutBackground();
        if (this.recruitBackground) {
            const cover = Math.max(this.width / 1080, this.height / 1920);
            this.recruitBackground.getComponent(UITransform)!.setContentSize(1080 * cover, 1920 * cover);
        }
        this.worldCamera.orthoHeight = Math.max(9.5, 9.5 * this.height / 1920);
        if (this.sheet) {
            this.sheet.setPosition(0, this.page === 'pet' ? -this.height / 2 + 350 : this.page === 'shop' ? -this.height / 2 + 850 : -this.height / 2 + 640, 0);
            if (this.page === 'recruit') {
                this.sheet.setPosition(0, -10, 0);
                const scale = Math.min(1, (this.width - 40) / 1000, (this.height - 430) / 1560);
                this.sheet.setScale(scale, scale, 1);
            }
            if (this.page === 'album') {
                // 图鉴全屏铺满（与招募页一致覆盖至底部主城导航栏后方，不显示顶栏人物头像与货币）
                this.sheet.setPosition(0, 0, 0);
                const scale = Math.min(this.width / 1080, this.height / 1920);
                this.sheet.setScale(scale, scale, 1);
                const bg = this.sheet.getChildByName('图鉴正式大底板');
                if (bg) {
                    const cover = Math.max(this.width / 1080, this.height / 1920) / scale;
                    bg.getComponent(UITransform)!.setContentSize(1080 * cover, 1920 * cover);
                }
            } else if (this.page === 'profile') {
                this.sheet.setPosition(0, 0, 0);
                const scale = Math.min(this.width / 1080, this.height / 1920);
                this.sheet.setScale(scale, scale, 1);
            } else if (this.page === 'adventure') {
                this.sheet.setPosition(0, 0, 0);
                this.sheet.setScale(1, 1, 1);
                const logCard = this.sheet.getChildByName('冒险左上实时日志卡');
                if (logCard) logCard.setPosition(-this.width / 2 + 24 + 185, this.height / 2 - 266 - 196, 0);
                const chestBox = this.sheet.getChildByName('冒险右侧宝箱区');
                if (chestBox) chestBox.setPosition(Math.min(this.width / 2 - 122, 386), -this.height / 2 + 520, 0);
            } else if (this.page === 'shop' || this.page === 'daily' || this.page === 'bag' || this.page === 'diary' || this.page === 'memorial') {
                this.sheet.setPosition(0, this.page === 'shop' ? -6 : -10, 0);
            }
            if (this.page === 'shop' || this.page === 'daily' || this.page === 'bag' || this.page === 'diary' || this.page === 'memorial') {
                const pw = this.page === 'daily' ? 1024 : this.page === 'shop' ? 960 : 921;
                const ph = this.page === 'daily' ? 1400 : this.page === 'shop' ? 1260 : 1390;
                const maxScale = this.page === 'shop' ? 1.06 : 1;
                const padW = this.page === 'shop' ? 24 : 40;
                const padH = this.page === 'shop' ? 370 : 420;
                const scale = Math.min(maxScale, (this.width - padW) / pw, (this.height - padH) / ph);
                this.sheet.setScale(scale, scale, 1);
            }
        }
    }
    private loadPetAvatar(skinKey: string): Promise<SpriteFrame | null> {
        let loading = this.petAvatars.get(skinKey);
        if (!loading) {
            loading = new Promise<SpriteFrame | null>(resolve => {
                resources.load('pets/avatars/' + skinKey + '/spriteFrame', SpriteFrame, (error, frame) => {
                    if (!isValid(this, true)) { resolve(null); return; }
                    resolve(error || !frame ? null : frame);
                });
            });
            this.petAvatars.set(skinKey, loading);
        }
        return loading;
    }

    private petAvatar(parent: Node, id: number, x: number, y: number, size: number, locked = false) {
        const b = BREEDS[id];
        const n = this.uiNode(parent, '伙伴头像-' + b.kind + '-' + id, x, y, size, size);
        const g = n.addComponent(Graphics);
        g.fillColor = this.color(locked ? '#9CA2AC' : C.cream); g.circle(0, 0, size * 0.48); g.fill();
        // 同步创建头像图层，异步只赋值 spriteFrame，避免刷新时节点增删引起界面跳动。
        const art = this.uiNode(n, '伙伴头像图', 0, 0, size, size);
        const sprite = art.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        // 未解锁采用柔和灰调而非纯黑，保留宠物轮廓与表情辨识度。
        sprite.color = locked ? new Color(156, 162, 172, 240) : this.color(C.white);
        void this.loadPetAvatar(b.skin).then(frame => {
            if (!frame || !isValid(this, true) || !isValid(sprite, true)) return;
            sprite.spriteFrame = frame;
            if (isValid(g, true)) g.clear();
        });
        if (locked) {
            const overlay = this.uiNode(n, '未解锁遮罩', 0, 0, size, size), mask = overlay.addComponent(Graphics);
            // 柔和半透明灰雾遮罩，完整覆盖圆形边缘且能清晰看到底层宠物造型。
            mask.fillColor = new Color(108, 114, 126, 78); mask.circle(0, 0, size * 0.495); mask.fill();
            // 精致小锁置于右下角徽章位，不遮挡小猫小狗脸蛋。
            const lx = size * 0.27, ly = -size * 0.27, lr = size * 0.17;
            mask.fillColor = new Color(64, 72, 86, 215); mask.circle(lx, ly, lr); mask.fill();
            mask.strokeColor = this.color('#FFF0C8'); mask.lineWidth = Math.max(2, size * 0.028);
            mask.arc(lx, ly + lr * 0.20, lr * 0.36, 0, Math.PI, false); mask.stroke();
            mask.fillColor = this.color('#F5C86B'); mask.roundRect(lx - lr * 0.48, ly - lr * 0.56, lr * 0.96, lr * 0.72, lr * 0.16); mask.fill();
            mask.fillColor = this.color('#5C3B1E'); mask.circle(lx, ly - lr * 0.20, lr * 0.13); mask.fill();
        }
        return n;
    }

    private headerArt(parent: Node, key: string) {
        const image = this.uiNode(parent, '顶部素材-' + key, 0, 0, parent.getComponent(UITransform)!.width, parent.getComponent(UITransform)!.height);
        const sprite = image.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        resources.load('art/header/' + key + '/spriteFrame', SpriteFrame, (error, frame) => {
            if (!error && frame && isValid(sprite, true)) sprite.spriteFrame = frame;
        });
    }

    private headerText(parent: Node, value: string, x: number, y: number, w: number, h: number, font: number) {
        const label = this.text(parent, value, x, y, w, h, font, '#58351D');
        label.isBold = true; label.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
        label.enableOutline = true; label.outlineColor = this.color('#FFF2CC'); label.outlineWidth = 1.5;
        return label;
    }

    private currencyPlus(parent: Node, currency: 'gems' | 'coins', x: number) {
        const plus = this.uiNode(parent, '加号-' + currency, x, 0, 76, 90);
        plus.getComponent(UITransform)!.setContentSize(48, 49);
        this.headerArt(plus, 'plus');
        const art = plus.children[0];
        const animate = (scale: number, duration: number) => {
            Tween.stopAllByTarget(art);
            tween(art).to(duration, { scale: new Vec3(scale, scale, 1) }, { easing: 'backOut' }).start();
        };
        this.intercept(plus);
        plus.on(Node.EventType.TOUCH_START, () => animate(0.86, 0.07), this);
        plus.on(Node.EventType.TOUCH_CANCEL, () => animate(1, 0.14), this);
        plus.on(Node.EventType.TOUCH_END, () => animate(1, 0.16), this);
        plus.on(Node.EventType.TOUCH_END, () => {
            if (currency === 'coins') this.showCoinDialog();
            else this.showGemDialog();
        }, this);
    }

    private closeDialog() {
        if (!this.dialog) return;
        this.dialog.active = false;
        this.dialog.removeFromParent();
        this.dialog.destroy();
        this.dialog = null;
        this.blockedUntil = Date.now() + 350;
    }

    private layoutDialog() {
        if (!this.dialog) return;
        this.dialog.getComponent(UITransform)!.setContentSize(this.width, this.height);
        const shade = this.dialog.getComponent(Graphics)!;
        shade.clear(); shade.fillColor = new Color(0, 0, 0, 165);
        shade.rect(-this.width / 2, -this.height / 2, this.width, this.height); shade.fill();
        const panel = this.dialog.getChildByName('通用弹窗面板') || this.dialog.getChildByName('更换头像面板');
        if (!panel) return;
        const panelHeight = panel.getComponent(UITransform)!.height;
        const panelWidth = panel.getComponent(UITransform)!.width;
        const scale = Math.min(1, (this.width - 40) / panelWidth, (this.height - 40) / panelHeight);
        panel.setScale(scale, scale, 1);
    }

    private showDialog(title: string, body: string,
        actions: [DialogAction] | [DialogAction, DialogAction],
        reward?: { amount: number; currency: Currency; description: string }) {
        if (this.dialog) return;
        const overlay = this.uiNode(this.ui, '通用弹窗遮罩', 0, 0, this.width, this.height);
        this.dialog = overlay;
        overlay.addComponent(Graphics); this.intercept(overlay);
        const ratio = 900 / 1116;
        const panel = this.uiNode(overlay, '通用弹窗面板', 0, 0, 900, 904 * ratio);
        this.intercept(panel);
        const art = this.uiNode(panel, '弹窗底板', 0, 0, 900, 904 * ratio);
        const sprite = art.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        resources.load('art/dialog/panel/spriteFrame', SpriteFrame, (error, frame) => {
            if (!error && frame && isValid(sprite, true)) sprite.spriteFrame = frame;
        });
        // Pillow行列检测：1116×904底板的连续浅色内框为[78,370]–[1038,770]。
        // 标题独立落在猫狗中间的木牌（源图中央 y=260..300），不占正文内区。
        // 内容整体上移35设计单位；金币、钻石及其他通用弹窗共用布局。
        const content = this.uiNode(panel, '弹窗安全内容', 0, (452 - 572.5) * ratio + 35, 896 * ratio, 395 * ratio);
        const heading = this.headerText(panel, title, 0, (452 - 240) * ratio, 460 * ratio, 62 * ratio, 40);
        heading.node.name = '弹窗独立标题';
        const bodyLabel = this.text(content, body, 0, reward ? 47 : 22 * ratio, 840 * ratio, reward ? 30 : 110 * ratio, 28, C.muted);
        bodyLabel.node.name = '弹窗正文';
        if (reward) {
            bodyLabel.lineHeight = 30;
            const row = this.uiNode(content, '弹窗奖励行', 0, 9, 124, 36);
            const amount = this.headerText(row, String(reward.amount), -24, 0, 76, 36, 32);
            amount.node.name = '弹窗奖励数量';
            const isCoin = reward.currency === 'coins';
            const icon = this.uiNode(row, isCoin ? '弹窗奖励金币' : '弹窗奖励钻石', 43, 0, 38, 38 * (isCoin ? 348 / 341 : 315 / 353));
            const rewardSprite = icon.addComponent(Sprite); rewardSprite.sizeMode = Sprite.SizeMode.CUSTOM;
            resources.load('art/header/' + (isCoin ? 'coin-icon' : 'diamond-icon') + '/spriteFrame', SpriteFrame, (error, frame) => {
                if (error || !frame || !isValid(this, true) || !isValid(icon, true) || !isValid(rewardSprite, true)) return;
                rewardSprite.spriteFrame = frame;
                icon.getComponent(UITransform)!.setContentSize(38, 38 * frame.rect.height / frame.rect.width);
            });
            const description = this.text(content, reward.description, 0, -27, 840 * ratio, 25, 24, C.muted);
            description.lineHeight = 25;
            description.node.name = '弹窗任务说明';
        }
        actions.forEach((action, i) => {
            const x = actions.length === 1 ? 0 : (i === 0 ? -230 : 230) * ratio;
            const button = this.shopArt(content, 'buy', x, -160 * ratio, 380 * ratio, 380 * ratio * 120 / 321);
            button.name = '弹窗按钮-' + action.title;
            if (action.cost) {
                this.headerText(button, action.title, -52, 0, 150, 50 * ratio, 26);
                this.addPriceTag(button, action.cost.currency, action.cost.amount, 62, 0, 28);
            } else {
                this.headerText(button, action.title, 0, 0, 300 * ratio, 50 * ratio, 28);
            }
            this.shopButton(button, action.run);
        });
        const close = this.shopArt(panel, 'close', 480 * ratio, (452 - 270) * ratio, 71 * ratio, 72 * ratio);
        this.shopButton(close, () => this.closeDialog());
        this.layoutDialog();
    }

    /** 通用「货币图标 + 数字」价格标签：所有涉及金币/钻石消耗或获得的按钮与面板统一使用 */
    private addPriceTag(parent: Node, currency: Currency, amount: number, x: number, y: number, size = 28, textColor: string = '#FFFFFF') {
        const tag = this.uiNode(parent, '价格标签-' + currency, x, y, size * 3.2, size);
        const icon = this.uiNode(tag, '价格图标', -size * 0.9, 0, size, size);
        const sp = icon.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
        resources.load('art/header/' + (currency === 'coins' ? 'coin-icon' : 'diamond-icon') + '/spriteFrame', SpriteFrame, (e, f) => {
            if (!e && f && isValid(sp, true) && isValid(icon, true)) {
                sp.spriteFrame = f;
                const asp = f.rect.width / Math.max(1, f.rect.height);
                icon.getComponent(UITransform)!.setContentSize(asp >= 1 ? size : size * asp, asp >= 1 ? size / asp : size);
            }
        });
        const lbl = this.text(tag, String(amount), size * 0.55, 0, size * 1.9, size + 4, Math.round(size * 0.9), textColor);
        lbl.isBold = true; lbl.horizontalAlign = Label.HorizontalAlign.LEFT; lbl.node.name = '价格数字';
        lbl.enableOutline = true; lbl.outlineColor = this.color('#6A3E16'); lbl.outlineWidth = 2;
        return tag;
    }

    /** 浮动图标+数字获得提示（替代纯文字 toast），自动上浮淡出 */
    public showRewardToast(rewards: RewardGrantItem[], label = '获得') {
        const list = rewards.filter(r => r.amount !== 0).slice(0, 4);
        if (!list.length || !this.ui || !isValid(this.ui, true)) return;
        const old = this.ui.getChildByName('浮动奖励提示');
        if (old && isValid(old, true)) { old.destroy(); }
        const cellW = 150, w = 130 + list.length * cellW, h = 74;
        const pill = this.uiNode(this.ui, '浮动奖励提示', 0, this.height / 2 - 380, w, h);
        const g = pill.addComponent(Graphics);
        g.fillColor = new Color(76, 47, 26, 238); g.roundRect(-w / 2, -h / 2, w, h, 26); g.fill();
        g.strokeColor = this.color('#F5CC6C'); g.lineWidth = 3; g.roundRect(-w / 2, -h / 2, w, h, 26); g.stroke();
        const l = this.text(pill, label, -w / 2 + 56, 0, 90, 40, 26, '#FFE896'); l.isBold = true;
        list.forEach((rw, i) => {
            const x = -w / 2 + 120 + i * cellW + cellW / 2 - 10;
            if (rw.kind === 'coins' || rw.kind === 'gems') {
                this.addPriceTag(pill, rw.kind, rw.amount, x, 0, 34, '#FFF6DC');
            } else {
                const path = rw.kind === 'item' ? `art/items/${rw.itemId}` : `art/care/${rw.careType === 'food' ? 'feed' : rw.careType === 'soap' ? 'clean' : 'play'}`;
                const ic = this.uiNode(pill, '获得图标', x - 40, 0, 44, 44);
                const sp = ic.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
                resources.load(path + '/spriteFrame', SpriteFrame, (e, f) => { if (!e && f && isValid(sp, true)) sp.spriteFrame = f; });
                const n = this.text(pill, `×${rw.amount}`, x + 22, 0, 70, 40, 30, '#FFF6DC'); n.isBold = true;
            }
        });
        const op = pill.addComponent(UIOpacity); op.opacity = 0;
        pill.setSiblingIndex(this.ui.children.length - 1);
        tween(op).to(0.18, { opacity: 255 }).delay(1.5).to(0.4, { opacity: 0 }).call(() => { if (isValid(pill, true)) pill.destroy(); }).start();
        tween(pill).by(2.1, { position: new Vec3(0, 46, 0) }).start();
    }

    /** 统一激励视频入口：未接入 SDK 时仅提示，不发放任何奖励；接入后完整观看才回调 */
    private requestRewardedAd(onCompleted: () => void, failPrefix: string) {
        if (this.rewardedVideoPending) { this.toast('广告播放中，请勿重复请求'); return; }
        const provider = this.rewardedVideoProvider;
        if (!provider) { this.toast('激励视频暂未接入'); return; }
        this.rewardedVideoPending = true;
        let settled = false;
        const finish = (result: RewardedVideoResult) => {
            if (settled) return;
            settled = true;
            this.rewardedVideoPending = false;
            if (!isValid(this, true)) return;
            if (result !== 'completed') {
                this.toast(result === 'cancelled' ? '未完整观看广告，' + failPrefix : '广告播放失败，' + failPrefix);
                return;
            }
            onCompleted();
        };
        try { provider.show(finish); } catch { finish('failed'); }
    }

    /** 通用道具/货币槽位背景图（6 套品质/主题底框：general/heal/gem/epic/coin/rainbow） */
    private itemSlotBg(parent: Node, theme: SlotBgTheme, w: number, h: number, name = '奖励卡底图') {
        const bg = this.uiNode(parent, name, 0, 0, w, h);
        const sp = bg.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
        resources.load(`art/ui/item-bg-${theme}/spriteFrame`, SpriteFrame, (e, f) => {
            if (!e && f && isValid(sp, true)) sp.spriteFrame = f;
        });
        return bg;
    }

    /** 6 阶品质槽位底框映射：金币与钻石同为传说璀璨金，其他道具按实际效果总值分配品质阶梯 */
    private itemQualityTheme(def?: ItemDefinition | null): SlotBgTheme {
        if (!def) return 'general';
        const fx = def.effects || {};
        const power = Math.max(0, fx.hunger || 0) + Math.max(0, fx.clean || 0) + Math.max(0, fx.energy || 0)
            + Math.max(0, fx.joy || 0) + Math.max(0, fx.health || 0);
        if (power >= 95) return 'coin';
        if (power >= 75) return 'epic';
        if (power >= 55) return 'gem';
        if (power >= 40) return 'heal';
        return 'general';
    }

    private rewardSlotTheme(rw: RewardGrantItem): SlotBgTheme {
        if (rw.kind === 'gems' || rw.kind === 'coins') return 'coin';
        if (rw.kind === 'care') return 'general';
        return this.itemQualityTheme(findItem(rw.itemId));
    }

    /** 通用图标+数字奖励领取弹窗（金币、钻石、道具统一可视化展示，配通用道具槽位底图与大号清晰字样） */
    public showRewardGrantDialog(title: string, rewards: RewardGrantItem[], subtitle?: string, buttonText = '太棒了') {
        const list = rewards.filter(r => r.amount > 0);
        if (!list.length) return;
        if (this.dialog) this.closeDialog();
        this.showDialog(title, '', [{ title: buttonText, run: () => this.closeDialog() }]);
        const panel = this.dialog?.getChildByName('通用弹窗面板');
        const content = panel?.getChildByName('弹窗安全内容');
        if (!content) return;
        const bodyNode = content.getChildByName('弹窗正文');
        if (bodyNode) bodyNode.active = false;

        if (subtitle) {
            const sub = this.text(content, subtitle, 0, list.length > 4 ? 136 : 120, 680, 30, 24, '#6E4A2C');
            sub.isBold = true;
            sub.node.name = '奖励弹窗副标题';
        }

        const displayList = list.slice(0, 8);
        const rows = Math.ceil(displayList.length / 4);
        const slotSize = rows === 1 ? 134 : 94;
        const gapX = rows === 1 ? 26 : 52;
        const rowPitch = 128;
        const startY = rows === 1 ? (subtitle ? 26 : 38) : (subtitle ? 68 : 80);

        const strip = this.uiNode(content, '通用奖励图标网格', 0, 0, 680, 300);
        displayList.forEach((rw, idx) => {
            const r = Math.floor(idx / 4);
            const rowCount = Math.min(4, displayList.length - r * 4);
            const c = idx % 4;
            const x = (c - (rowCount - 1) / 2) * (slotSize + gapX);
            const y = startY - r * rowPitch;

            const card = this.uiNode(strip, `奖励图标卡-${idx}`, x, y, slotSize, slotSize);
            this.itemSlotBg(card, this.rewardSlotTheme(rw), slotSize, slotSize, '奖励卡底图');

            // 图标区
            const iconSize = rows === 1 ? 74 : 54;
            const iconY = rows === 1 ? 10 : 8;
            const iconNode = this.uiNode(card, '奖励图标', 0, iconY, iconSize, iconSize);
            const sp = iconNode.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
            let spritePath = '';
            let nameText = '';
            let qtyText = '';
            if (rw.kind === 'coins') {
                spritePath = 'art/header/coin-icon/spriteFrame';
                nameText = '金币';
                qtyText = `+${rw.amount}`;
            } else if (rw.kind === 'gems') {
                spritePath = 'art/header/diamond-icon/spriteFrame';
                nameText = '钻石';
                qtyText = `+${rw.amount}`;
            } else if (rw.kind === 'care') {
                spritePath = `art/care/${rw.careType === 'food' ? 'feed' : rw.careType === 'soap' ? 'clean' : 'play'}/spriteFrame`;
                nameText = rw.careType === 'food' ? '通用食物' : rw.careType === 'soap' ? '清洁包' : '陪玩球';
                qtyText = `×${rw.amount}`;
            } else {
                const def = findItem(rw.itemId);
                spritePath = `art/items/${rw.itemId}/spriteFrame`;
                nameText = def?.name || rw.itemId;
                qtyText = `×${rw.amount}`;
            }
            resources.load(spritePath, SpriteFrame, (err, frame) => {
                if (!err && frame && isValid(sp, true) && isValid(iconNode, true)) {
                    sp.spriteFrame = frame;
                    const aspect = frame.rect.width / Math.max(1, frame.rect.height);
                    const w = aspect >= 1 ? iconSize : iconSize * aspect;
                    const h = aspect >= 1 ? iconSize / aspect : iconSize;
                    iconNode.getComponent(UITransform)!.setContentSize(w, h);
                }
            });

            // 槽位底部醒目大号描边数字（清晰不遮挡图标）
            const qLbl = this.text(card, qtyText, 0, rows === 1 ? -40 : -28, slotSize - 12, rows === 1 ? 34 : 28, rows === 1 ? 28 : 23, C.white);
            qLbl.isBold = true; qLbl.enableOutline = true; qLbl.outlineColor = this.color('#4A2B12'); qLbl.outlineWidth = 3.5;
            qLbl.node.name = '奖励数量';

            // 物品名称置于槽位外下方干净米底上，大号加粗清晰易读
            const nLbl = this.text(card, nameText, 0, rows === 1 ? -86 : -62, slotSize + 36, rows === 1 ? 30 : 26, rows === 1 ? 24 : 20, '#4E2F1A');
            nLbl.isBold = true; nLbl.overflow = Label.Overflow.SHRINK; nLbl.enableWrapText = false;
            nLbl.node.name = '奖励名称';
        });

        // 按钮微调到底部居中，确保名称与按钮之间零重叠
        const okBtn = content.getChildByName('弹窗按钮-' + buttonText);
        if (okBtn) {
            okBtn.setPosition(0, rows === 1 ? -150 : -184);
            if (rows > 1) okBtn.setScale(0.80, 0.80, 1);
        }
    }

    private showGemDialog() {
        this.showDialog('获取钻石', '完整观看广告可获得', [
            { title: '看广告', run: () => this.watchRewardedVideo('gems') },
            { title: '做任务', run: () => this.open('daily') }
        ], { amount: VIDEO_REWARDS.gems, currency: 'gems', description: '也可完成每日照顾与冒险任务，手动领取奖励' });
    }

    private showCoinDialog() {
        this.showDialog('获取金币', '完整观看广告可获得', [
            { title: '看广告', run: () => this.watchRewardedVideo('coins') },
            { title: '去冒险', run: () => this.open('adventure') }
        ], { amount: VIDEO_REWARDS.coins, currency: 'coins', description: '也可前往林间寻宝，每次获得80金币' });
    }

    private showAvatarDialog() {
        if (this.dialog) return;
        const ownedIds = new Set(this.data.pets.map(p => p.id));
        let selectedId = ownedIds.has(this.data.avatar) ? this.data.avatar : (this.data.pets[0]?.id ?? 0);

        const overlay = this.uiNode(this.ui, '通用弹窗遮罩', 0, 0, this.width, this.height);
        this.dialog = overlay;
        overlay.addComponent(Graphics); this.intercept(overlay);

        const panelW = 880, panelH = Math.round(880 * 1154 / 900);
        const panel = this.uiNode(overlay, '更换头像面板', 0, 0, panelW, panelH);
        this.intercept(panel);
        const art = this.uiNode(panel, '更换头像底板', 0, 0, panelW, panelH);
        const sprite = art.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        resources.load('art/header/avatar-picker-panel/spriteFrame', SpriteFrame, (error, frame) => {
            if (!error && frame && isValid(sprite, true)) sprite.spriteFrame = frame;
        });

        // 顶部木牌标题（居中落在双爪印之间的弧形木牌上）
        const heading = this.text(panel, '更换头像', 0, 474, 420, 62, 44, '#FFF9E8');
        heading.isBold = true; heading.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
        heading.enableOutline = true; heading.outlineColor = this.color('#6D3B18'); heading.outlineWidth = 4;
        heading.node.name = '弹窗独立标题';

        // 右上角关闭按钮
        const close = this.shopArt(panel, 'close', 382, 444, 72, 73);
        this.shopButton(close, () => this.closeDialog());

        // 副标题说明
        const sub = this.text(panel, '点击已解锁伙伴更换头像（已解锁 ' + ownedIds.size + '/' + BREEDS.length + '）', 0, 366, 720, 34, 24, '#7A5130');
        sub.isBold = true; sub.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';

        // 4×3 全部 12 只猫狗头像网格（未解锁自动灰显并上锁）
        const refreshers: Array<() => void> = [];
        const refreshAll = () => refreshers.forEach(fn => fn());

        BREEDS.forEach((breed, idx) => {
            const col = idx % 4, row = Math.floor(idx / 4);
            const x = (col - 1.5) * 172;
            const y = 215 - row * 198;
            const owned = ownedIds.has(breed.id);
            const slot = this.uiNode(panel, '头像选项-' + breed.id, x, y, 156, 182);
            const cardBg = slot.addComponent(Graphics);
            this.petAvatar(slot, breed.id, 0, 22, 112, !owned);

            const badgeNode = this.uiNode(slot, '头像状态标', 0, -28, 82, 26);
            const badgeBg = badgeNode.addComponent(Graphics);
            const badgeLbl = this.text(badgeNode, '', 0, 0, 78, 24, 16, C.white);
            badgeLbl.isBold = true; badgeLbl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';

            const nameLbl = this.text(slot, owned ? this.petDisplayName(breed.id) : breed.name, 0, -64, 148, 30, 22, owned ? '#58351D' : '#8A8680');
            nameLbl.isBold = true; nameLbl.overflow = Label.Overflow.CLAMP;
            nameLbl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';

            const redraw = () => {
                const isEquipped = this.data.avatar === breed.id;
                const isSelected = selectedId === breed.id;
                cardBg.clear();
                cardBg.fillColor = this.color(!owned ? '#EDEAE3' : isSelected ? '#FFF3C4' : '#FFFBF0');
                cardBg.strokeColor = this.color(!owned ? '#C4BCB0' : isSelected ? '#E69924' : isEquipped ? '#38A169' : '#D9BE98');
                cardBg.lineWidth = isSelected ? 4.5 : 2.5;
                cardBg.roundRect(-78, -91, 156, 182, 20);
                cardBg.fill(); cardBg.stroke();

                badgeBg.clear();
                if (!owned) {
                    badgeNode.active = true;
                    badgeBg.fillColor = this.color('#7B828E');
                    badgeBg.roundRect(-38, -13, 76, 26, 13); badgeBg.fill();
                    badgeLbl.string = '未解锁';
                } else if (isEquipped) {
                    badgeNode.active = true;
                    badgeBg.fillColor = this.color('#2F9E44');
                    badgeBg.roundRect(-38, -13, 76, 26, 13); badgeBg.fill();
                    badgeLbl.string = '使用中';
                } else if (isSelected) {
                    badgeNode.active = true;
                    badgeBg.fillColor = this.color('#E08E1B');
                    badgeBg.roundRect(-38, -13, 76, 26, 13); badgeBg.fill();
                    badgeLbl.string = '已选中';
                } else {
                    badgeNode.active = false;
                }
            };
            refreshers.push(redraw);
            redraw();

            this.intercept(slot); this.pressVisualFeedback(slot);
            slot.on(Node.EventType.TOUCH_END, () => {
                if (!owned) {
                    this.toast('尚未解锁「' + breed.name + '」，请先通过招募获得！');
                    return;
                }
                selectedId = breed.id;
                refreshAll();
            }, this);
        });

        // 底部确认 / 取消按钮
        const okBtn = this.shopArt(panel, 'buy', -158, -396, 270, 270 * 120 / 321);
        okBtn.name = '弹窗按钮-确认更换';
        this.headerText(okBtn, '确认更换', 0, 0, 220, 44, 28);
        this.shopButton(okBtn, () => {
            if (!ownedIds.has(selectedId)) return;
            if (this.data.avatar === selectedId) {
                this.closeDialog();
                return;
            }
            this.data.avatar = selectedId;
            if (this.persist()) {
                this.renderHeader();
                if (this.page === 'album' && this.profilePetId !== null) this.refreshProfileInPlace();
                this.closeDialog();
                this.toast('已更换头像为「' + this.petDisplayName(selectedId) + '」');
            }
        });

        const cancelBtn = this.shopArt(panel, 'buy', 158, -396, 270, 270 * 120 / 321);
        cancelBtn.name = '弹窗按钮-取消';
        this.headerText(cancelBtn, '取消', 0, 0, 220, 44, 28);
        this.shopButton(cancelBtn, () => this.closeDialog());

        this.layoutDialog();
    }

    private watchRewardedVideo(currency: Currency) {
        const currencyName = currency === 'coins' ? '金币' : '钻石';
        const amount = VIDEO_REWARDS[currency];
        if (this.rewardedVideoPending) { this.toast('广告播放中，请勿重复请求'); return; }
        const provider = this.rewardedVideoProvider;
        if (!provider) { this.toast('激励视频暂未接入'); return; }
        this.rewardedVideoPending = true;
        let settled = false;
        const finish = (result: RewardedVideoResult) => {
            if (settled) return;
            settled = true;
            this.rewardedVideoPending = false;
            if (!isValid(this, true)) return;
            if (result !== 'completed') {
                this.toast((result === 'cancelled' ? '未完整观看广告，未获得' : '广告播放失败，未获得') + currencyName);
                return;
            }
            if (this.data[currency] > 100000000 - amount) { this.toast(currencyName + '接近存储上限，无法领取本次奖励'); return; }
            const balance = this.data[currency], lastSeen = this.data.lastSeen, dirty = this.dirty;
            this.data[currency] += amount;
            if (!this.persist()) {
                this.data[currency] = balance; this.data.lastSeen = lastSeen; this.dirty = dirty;
                this.toast('奖励保存失败，已回滚本次' + currencyName + '奖励');
                return;
            }
            this.renderHeader();
            this.showRewardGrantDialog('获得广告奖励', [{ kind: currency, amount }], '完整观看广告，奖励已到账！');
        };
        // 保留播放锁直到首个终态；关闭弹窗、切页不会开启另一次播放，也不会重复发奖。
        try { provider.show(finish); } catch { finish('failed'); }
    }

    private renderHeader() {
        if (this.header && isValid(this.header.profile, true)) {
            const h = this.header;
            h.level.string = 'Lv.' + (Math.floor(this.data.xp / 100) + 1);
            h.xp.string = this.data.xp % 100 + ' / 100';
            h.fill.fillRange = this.data.xp % 100 / 100;
            h.gems.string = String(this.data.gems);
            h.coins.string = String(this.data.coins);
            if (h.avatar !== this.data.avatar) {
                h.profile.getChildByName('伙伴头像-' + BREEDS[h.avatar].kind + '-' + h.avatar)?.destroy();
                this.petAvatar(h.profile, this.data.avatar, -161, 0, 126);
                h.profile.children[h.profile.children.length - 1].setSiblingIndex(0);
                h.avatar = this.data.avatar;
            }
            return;
        }
        this.top.getComponent(UITransform)!.setContentSize(1024, 228);
        if (!this.top.getComponent(BlockInputEvents)) this.intercept(this.top);
        const level = Math.floor(this.data.xp / 100) + 1, progress = this.data.xp % 100;
        const profile = this.uiNode(this.top, '头像等级经验', -276, 17, 470, 150);
        // profile.png 圆形透明窗口为 112.2×115.3（中心 x=-161.2），头像设为 126 严丝合缝铺满无缺口。
        this.petAvatar(profile, this.data.avatar, -161, 0, 126);
        this.headerArt(profile, 'profile');
        this.intercept(profile);
        profile.on(Node.EventType.TOUCH_END, () => this.showAvatarDialog(), this);
        const levelLabel = this.headerText(profile, 'Lv.' + level, -45, 25, 100, 36, 27);
        const track = this.uiNode(profile, '独立经验槽', 65, -17, 290, 50);
        this.headerArt(track, 'xp-track');
        // Both sprites share the exact canvas; xp-fit alpha is the trough's inner contour.
        const bar = this.uiNode(profile, '顶部经验进度', 65, -17, 290, 50);
        const fill = bar.addComponent(Sprite); fill.sizeMode = Sprite.SizeMode.CUSTOM;
        resources.load('art/header/xp-fit/spriteFrame', SpriteFrame, (error, frame) => {
            if (error || !frame || !isValid(fill, true)) return;
            // FILLED UV updates require a valid frame in Creator 3.8.8.
            fill.spriteFrame = frame;
            fill.type = Sprite.Type.FILLED; fill.fillType = Sprite.FillType.HORIZONTAL;
            fill.fillStart = 0; fill.fillRange = this.data.xp % 100 / 100;
        });
        const xpLabel = this.headerText(profile, progress + ' / 100', 65, -17, 262, 28, 18);
        xpLabel.color = this.color('#FFF8DF'); xpLabel.outlineColor = this.color('#704121'); xpLabel.outlineWidth = 2;
        // Align to the rectangular info plate, not the taller circular avatar rim.
        // Native 1x transforms avoid nested fractional scaling of icons and text.
        const diamond = this.uiNode(this.top, '钻石栏', 83, 28, 220, 81);
        this.headerArt(diamond, 'currency-panel');
        const gemIcon = this.uiNode(diamond, '独立钻石', -78, 0, 60, 53.5); this.headerArt(gemIcon, 'diamond-icon');
        const gemsLabel = this.headerText(diamond, String(this.data.gems), -1, 0, 100, 44, 28);
        this.currencyPlus(diamond, 'gems', 80);
        const coin = this.uiNode(this.top, '金币栏', 333, 28, 220, 81);
        this.headerArt(coin, 'currency-panel');
        const coinIcon = this.uiNode(coin, '独立金币', -78, 0, 56, 57.2); this.headerArt(coinIcon, 'coin-icon');
        const coinsLabel = this.headerText(coin, String(this.data.coins), -1, 0, 100, 44, 28);
        this.currencyPlus(coin, 'coins', 80);
        this.header = { profile, avatar: this.data.avatar, level: levelLabel, xp: xpLabel, fill, gems: gemsLabel, coins: coinsLabel };
    }
    private updateSelectionRing() {
        const actor = this.petSelected && (this.page === 'pet' || this.page === 'bag') ? this.actors.find(a => a.pet.id === this.selected && !a.pet.adventuring && !a.pet.dead && !a.pet.lost && isValid(a.node, true)) : null;
        if (!actor) { if (this.selectionRing) this.selectionRing.active = false; return; }
        if (!this.selectionRing) {
            const ring = new Node('选中宠物光圈'); ring.layer = Layers.Enum.DEFAULT; this.world.addChild(ring);
            const renderer = ring.addComponent(MeshRenderer);
            const mesh = utils.createMesh(primitives.torus(0.62, 0.025, { radialSegments: 8, tubularSegments: 64 }));
            this.meshes.set('selection-ring', mesh); renderer.mesh = mesh;
            const material = new Material(); material.initialize({ effectName: 'builtin-unlit' });
            material.setProperty('mainColor', this.color('#FFE3A1'));
            this.materials.set('selection-ring', material); renderer.setSharedMaterial(material, 0);
            renderer.shadowCastingMode = 0; renderer.receiveShadow = 0;
            this.selectionRing = ring;
        }
        this.selectionRing.active = true;
        const position = actor.node.position;
        this.selectionRing.setPosition(position.x, 0.035, position.z);
    }

    private async loadCareIcon(sprite: Sprite, name: string) {
        let loading = this.careIcons.get(name);
        if (!loading) {
            loading = new Promise<SpriteFrame | null>(resolve => {
                resources.load('art/' + (['feed', 'clean', 'rest', 'play', 'heal', 'bag'].indexOf(name) !== -1 ? 'care/' : 'nav/') + name + '/spriteFrame', SpriteFrame, (error, frame) => resolve(error ? null : frame));
            });
            this.careIcons.set(name, loading);
        }
        const frame = await loading;
        if (frame && isValid(this, true) && isValid(sprite, true)) sprite.spriteFrame = frame;
    }

    private renderCareNav() {
        const items: [string, string, () => void][] = [
            ['feed', '喂养', () => this.care('food')],
            ['clean', '清洁', () => this.care('soap')],
            ['rest', '休息', () => this.care('rest')],
            ['play', '陪玩', () => this.care('toy')],
            ['heal', '治疗', () => this.care('medicine')],
            ['bag', '背包', () => { if (this.page !== 'bag') this.open('bag'); }],
        ];
        void this.navArt(this.bottom, 'dock', 0, 0, 1080, 190);
        items.forEach(([icon, title, action], i) => {
            const button = this.uiNode(this.bottom, '照顾-' + icon, -430 + i * 172, 0, 166, 174);
            this.intercept(button); this.pressFeedback(button);
            void this.navArt(button, 'selected', 0, 4, 142, 146);
            button.getChildByName('主城素材-selected')!.active = this.careSelected === icon;
            const image = this.uiNode(button, '照顾图标', 0, 26, 86, 86).addComponent(Sprite);
            image.sizeMode = Sprite.SizeMode.CUSTOM; void this.loadCareIcon(image, icon);
            void this.navArt(button, 'label' + (i % 5), 0, -48, 146, 48);
            this.headerText(button, title, 0, -48, 136, 38, 28);
            button.on(Node.EventType.TOUCH_END, () => {
                this.careSelected = icon;
                for (const item of this.bottom.children) {
                    const ring = item.getChildByName('主城素材-selected');
                    if (ring) ring.active = item === button;
                }
                action();
            }, this);
        });
    }

    private async navArt(parent: Node, key: string, x: number, y: number, width: number, height: number) {
        const node = this.uiNode(parent, '主城素材-' + key, x, y, width, height);
        const sprite = node.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        resources.load('art/nav/' + key + '/spriteFrame', SpriteFrame, (error, frame) => {
            if (error || !frame || !isValid(node, true)) return;
            const ratio = Math.min(width / frame.originalSize.width, height / frame.originalSize.height);
            node.getComponent(UITransform)!.setContentSize(frame.originalSize.width * ratio, frame.originalSize.height * ratio);
            sprite.spriteFrame = frame;
        });
    }

    private navCaption(button: Node, name: string, index: number) {
        void this.navArt(button, 'label' + index, 0, -48, 160, 49);
        const title = this.text(button, name, 0, -48, 148, 40, 30, '#49301E');
        title.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
        title.isBold = true;
        title.enableOutline = true;
        title.outlineColor = this.color('#FFF3D5');
        title.outlineWidth = 2;
    }

    private renderNav() {
        const careMode = this.petSelected && (this.page === 'pet' || this.page === 'bag');
        if (careMode && this.bottom.getChildByName('照顾-feed')) {
            for (const button of this.bottom.children) {
                const ring = button.getChildByName('主城素材-selected');
                if (ring) ring.active = button.name === '照顾-' + this.careSelected;
            }
            return;
        }
        const existingHome = this.bottom.getChildByName('导航-home');
        const navPage: Page = this.page === 'profile' ? 'album' : this.page;
        if (!careMode && existingHome) {
            for (const button of this.bottom.children) {
                if (!button.name.startsWith('导航-')) continue;
                const selected = button.getChildByName('主城素材-selected');
                if (selected) selected.active = button.name === '导航-' + navPage;
            }
            return;
        }
        this.clear(this.bottom); if (!this.bottom.getComponent(BlockInputEvents)) this.intercept(this.bottom);
        if (careMode) { this.renderCareNav(); return; }
        void this.navArt(this.bottom, 'dock', 0, 0, 1080, 190);
        const items: [Page, string][] = [['home', '主城'], ['recruit', '招募'], ['adventure', '冒险'], ['album', '图鉴'], ['shop', '商店']];
        items.forEach(([page, name], i) => {
            const active = navPage === page;
            const button = this.uiNode(this.bottom, '导航-' + page, -408 + i * 204, 0, 190, 174);
            this.intercept(button);
            this.pressFeedback(button);
            button.on(Node.EventType.TOUCH_END, () => {
                if (this.page !== page) this.open(page);
            }, this);
            void this.navArt(button, 'selected', 0, 4, 154, 150);
            button.getChildByName('主城素材-selected')!.active = active;
            void this.navArt(button, page, 0, 26, 108, 98);
            this.navCaption(button, name, i);
        });
    }
    private dailyScroll: ScrollView | null = null;
    private dailyScrollOffset = 0;
    private dailyRows = new Map<DailyTaskId | 'pack', (daily: DailyState) => void>();

    private updateDailyRows(daily = this.dailyCandidate().daily) {
        this.dailyRows.forEach(refresh => refresh(daily));
    }

    private animatePanelOpen() {
        const panel = this.sheet;
        if (!panel || !isValid(panel, true)) return;
        const base = panel.scale.clone();
        const opacity = panel.getComponent(UIOpacity) || panel.addComponent(UIOpacity);
        opacity.opacity = 0;
        panel.setScale(base.x * 0.97, base.y * 0.97, base.z);
        tween(opacity).to(0.16, { opacity: 255 }).start();
        tween(panel).to(0.18, { scale: base }, { easing: 'quadOut' }).start();
    }

    private retirePanel(panel: Node) {
        Tween.stopAllByTarget(panel);
        const opacity = panel.getComponent(UIOpacity) || panel.addComponent(UIOpacity);
        Tween.stopAllByTarget(opacity);
        // 退出层不再参与点击；快速切换也不能让旧面板拦截新页面。
        const mute = (node: Node) => {
            node.targetOff(this);
            const blocker = node.getComponent(BlockInputEvents);
            if (blocker) blocker.enabled = false;
            node.children.forEach(mute);
        };
        mute(panel);
        tween(opacity).to(0.10, { opacity: 0 }).call(() => {
            if (isValid(panel, true)) { panel.removeFromParent(); panel.destroy(); }
        }).start();
    }

    private open(page: Page) {
        if (page === this.page && this.sheet && isValid(this.sheet, true) && (page === 'bag' || page === 'shop' || page === 'daily' || page === 'recruit')) {
            if (page === 'recruit') this.updateRecruit();
            else if (page === 'bag') this.updateBag();
            else if (page === 'shop') this.updateShopLabels();
            else this.updateDailyRows();
            return;
        }
        if (this.page === 'daily' && page === 'daily' && this.dailyScroll && isValid(this.dailyScroll, true)) {
            this.dailyScrollOffset = Math.max(0, Math.min(110, this.dailyScroll.getScrollOffset().y));
        } else {
            this.dailyScrollOffset = 0;
        }
        this.dailyScroll = null;
        this.dailyRows.clear();
        this.closeDialog();
        if (page === 'pet' && this.page === 'pet' && this.sheet?.name === '宠物状态' && isValid(this.sheet, true)) {
            this.petSelected = true;
            this.renderPet(); this.updateSelectionRing(); this.renderNav(); this.layoutNotice();
            return;
        }
        this.clearRecruitBackground();
        if (page !== 'profile') { this.previewViewportNode = null; this.clearProfilePreview(); }
        this.page = page; this.adventureLabel = null;
        this.syncActorVisibility();
        if (page === 'pet') this.petSelected = true;
        if (page === 'home') { this.petSelected = false; this.careSelected = ''; }
        if (this.sheet) {
            this.retirePanel(this.sheet);
            this.sheet = null;
        }
        this.updateSelectionRing(); this.renderNav();
        if (this.page !== 'home' && Date.now() > this.noticeUntil && this.notice) {
            this.notice.string = '';
            this.notice.node.parent?.getComponent(Graphics)?.clear();
        }
        this.layoutNotice();
        const dailyEntry = this.ui.getChildByName('每日任务入口');
        if (dailyEntry) dailyEntry.active = page === 'home';
        const diaryEntry = this.ui.getChildByName('冒险日记入口');
        if (diaryEntry) diaryEntry.active = page === 'home';
        this.refreshMemorialEntry();
        const gmEntry = this.ui.getChildByName('GM调试入口');
        if (gmEntry) gmEntry.active = page !== 'album' && page !== 'profile';
        if (this.top) this.top.active = page !== 'album' && page !== 'profile';
        if (this.bottom) this.bottom.active = page !== 'profile';
        if (page !== 'adventure') {
            this.clearAdventureBackground();
            this.advChestAura = null; this.advChestSprite = null; this.advChestBadge = null;
            this.advTimerLabel = null;
        }
        if (page === 'home') { this.checkMainCityAlerts(); return; }
        if (page === 'adventure') {
            this.sheet = this.uiNode(this.ui, '冒险挂机全屏层', 0, 0, this.width, this.height);
            this.renderAdventure(); this.layout();
            this.placeAdventureFormation(true);
            if (this.bottom) this.bottom.setSiblingIndex(this.ui.children.length - 1);
            return;
        }
        if (page === 'diary') {
            this.sheet = this.uiNode(this.ui, '冒险日记面板', 0, -10, 921, 1390);
            this.intercept(this.sheet); this.renderAdventureDiary(); this.layout(); this.animatePanelOpen(); return;
        }
        if (page === 'memorial') {
            this.sheet = this.uiNode(this.ui, '后院纪念角面板', 0, -10, 921, 1390);
            this.intercept(this.sheet); this.renderMemorialCorner(); this.layout(); this.animatePanelOpen(); return;
        }
        if (page === 'recruit') {
            this.sheet = this.uiNode(this.ui, '招募面板', 0, 0, 1000, 1560);
            this.intercept(this.sheet); this.renderRecruit(); this.layout(); this.animatePanelOpen(); return;
        }
        if (page === 'bag') {
            this.sheet = this.uiNode(this.ui, '背包面板', 0, -10, 921, 1390);
            this.intercept(this.sheet); this.renderBag(); this.layout(); this.animatePanelOpen(); return;
        }
        if (page === 'daily') {
            this.sheet = this.uiNode(this.ui, '每日任务面板', 0, -10, 1024, 1400);
            this.intercept(this.sheet); this.renderDaily(); this.layout(); this.animatePanelOpen(); return;
        }
        if (page === 'shop') {
            this.sheet = this.uiNode(this.ui, '商店摊位', 0, -this.height / 2 + 850, 900, 1300);
            this.intercept(this.sheet); this.renderShop(); this.layout(); this.animatePanelOpen(); return;
        }
        if (page === 'album') {
            this.sheet = this.uiNode(this.ui, '伙伴图鉴面板', 0, 0, 1080, 1920);
            this.intercept(this.sheet); this.renderAlbum(); this.layout();
            if (this.bottom) this.bottom.setSiblingIndex(this.ui.children.length - 1);
            this.animatePanelOpen(); return;
        }
        if (page === 'profile') {
            this.sheet = this.uiNode(this.ui, '宠物主页面板', 0, 0, 1080, 1920);
            this.intercept(this.sheet); this.renderProfile(); this.layout(); this.animatePanelOpen(); return;
        }
        if (page === 'pet') {
            this.sheet = this.uiNode(this.ui, '宠物状态', 0, -this.height / 2 + 356, 960, 334);
            this.headerArt(this.sheet, 'pet-status-pill'); this.intercept(this.sheet);
            const goProfile = this.uiNode(this.sheet, '宠物状态进主页', 332, 82, 118, 42);
            const gpb = goProfile.addComponent(Graphics);
            gpb.fillColor = this.color('#FFD666'); gpb.strokeColor = this.color('#8A562C'); gpb.lineWidth = 2.5;
            gpb.roundRect(-59, -21, 118, 42, 21); gpb.fill(); gpb.stroke();
            const gpl = this.text(goProfile, '主页 ›', 0, 0, 108, 30, 21, '#5B3418');
            gpl.isBold = true; gpl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
            this.intercept(goProfile); this.pressVisualFeedback(goProfile, goProfile.children.slice());
            goProfile.on(Node.EventType.TOUCH_END, () => this.openProfile(this.selected), this);
            this.renderPet();
            this.animatePanelOpen();
            return;
        }
        this.sheet = this.uiNode(this.ui, '操作卡片', 0, -this.height / 2 + 640, 1024, 866); this.card(this.sheet); this.intercept(this.sheet);
        const titles: Record<string, string> = { pet: this.petDisplayName(this.selected) + '的小日常', recruit: '遇见新的毛茸茸', adventure: '任务区 · 林间寻宝', album: '伙伴图鉴', shop: '庭院补给铺', bag: '我的背包' };
        this.text(this.sheet, titles[page], -60, 363, 760, 64, 40);
        this.button(this.sheet, '收起', 405, 363, 150, 66, () => this.open('home'), C.pale, 27);
        if (page === 'adventure') this.renderAdventure();
        this.animatePanelOpen();
    }

    private renderPet() {
        const p = this.data.pets.find(v => v.id === this.selected && !v.dead);
        if (!p || !this.sheet) return;

        // 顶部信息行：宠物名字 + 真实阶位星级图标 + 彩色性格标签 + 生病/疲惫警示标签
        const hdrName = '状态卡顶部信息行';
        const dispName = this.petDisplayName(this.selected);
        const trait = PET_TRAITS[p.trait];
        const statusFlag = p.health < 30 ? '生病中' : p.energy <= 0 ? '疲惫' : '';
        const hdrKey = `${p.id}|${dispName}|${p.star}|${p.trait}|${statusFlag}`;
        const existingHdr = this.sheet.getChildByName(hdrName);
        if (!existingHdr || (existingHdr as any)._hdrKey !== hdrKey) {
            if (existingHdr) existingHdr.destroy();
            const hdr = this.uiNode(this.sheet, hdrName, 0, 82, 540, 44);
            (hdr as any)._hdrKey = hdrKey;
            const nameW = Math.min(168, Math.max(76, dispName.length * 27 + 6));
            const nameLeft = -134;
            const nameLbl = this.text(hdr, dispName, nameLeft + nameW / 2, 0, nameW, 36, 25, '#5E3A1E');
            nameLbl.isBold = true; nameLbl.horizontalAlign = Label.HorizontalAlign.LEFT;
            nameLbl.overflow = Label.Overflow.CLAMP;
            nameLbl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
            nameLbl.node.name = '宠物标题';

            // 星级图标徽章（使用与图鉴/主页一致的 6 阶星级图标）
            const starCenterX = nameLeft + nameW + 30;
            this.starTierBadge(hdr, p.star, starCenterX, 0, 30);

            // 性格彩色胶囊标签
            const traitW = 104;
            const traitCenterX = starCenterX + (p.star % 5 === 0 ? 74 : 92);
            this.pillBadge(hdr, trait.name, traitCenterX, 0, traitW, 32, trait.color || '#3B8EA5', '#FFFFFF', 18);

            // 生病/疲惫彩色警示标签
            if (statusFlag) {
                const flagW = statusFlag.length >= 3 ? 78 : 62;
                const flagX = traitCenterX + traitW / 2 + 8 + flagW / 2;
                if (flagX + flagW / 2 <= 264) {
                    this.pillBadge(hdr, statusFlag, flagX, 0, flagW, 30, '#E05246', '#FFFFFF', 16);
                }
            }
        }

        // 左侧绿色圆框内的宠物头像（可点击直接进入宠物主页）
        const avHolderName = '状态卡宠物头像';
        const existingAv = this.sheet.getChildByName(avHolderName);
        if (!existingAv || (existingAv as any)._petId !== p.id) {
            if (existingAv) existingAv.destroy();
            const holder = this.uiNode(this.sheet, avHolderName, -316, 0, 232, 232);
            (holder as any)._petId = p.id;
            this.petAvatar(holder, p.id, 0, 0, 224);
            this.intercept(holder); this.pressVisualFeedback(holder);
            holder.on(Node.EventType.TOUCH_END, () => this.openProfile(p.id), this);
        }

        // 5 项扁平可爱图标 + 饱满圆角胶囊彩色进度条
        const specs: { name: string; icon: string; value: number; fill: string; lowFill: string; ix: number; bx: number; bw: number; bh: number; y: number; nx: number }[] = [
            { name: '饱腹', icon: 'stat-hunger', value: p.hunger, fill: '#F59E1D', lowFill: '#E05246', ix: -116, bx: -4, bw: 176, bh: 24, y: 30, nx: 108 },
            { name: '洁净', icon: 'stat-clean', value: p.clean, fill: '#45B6E5', lowFill: '#E05246', ix: 158, bx: 270, bw: 176, bh: 24, y: 30, nx: 384 },
            { name: '体力', icon: 'stat-energy', value: p.energy, fill: '#E8B923', lowFill: '#E05246', ix: -116, bx: -4, bw: 176, bh: 24, y: -24, nx: 108 },
            { name: '心情', icon: 'stat-joy', value: p.joy, fill: '#F26D7D', lowFill: '#E05246', ix: 158, bx: 270, bw: 176, bh: 24, y: -24, nx: 384 },
            { name: '健康', icon: 'stat-health', value: p.health, fill: '#6AB836', lowFill: '#E05246', ix: -116, bx: 132, bw: 448, bh: 26, y: -78, nx: 384 },
        ];

        const drawPillBar = (g: Graphics, w: number, h: number, ratio: number, fillHex: string) => {
            g.clear();
            const r = h / 2;
            // 柔和米灰底槽
            g.fillColor = this.color('#D8CCB8');
            g.roundRect(-w / 2, -h / 2, w, h, r); g.fill();
            // 彩色胶囊填充
            const clamped = Math.max(0, Math.min(1, ratio));
            if (clamped > 0.01) {
                const fw = Math.max(h, w * clamped);
                g.fillColor = this.color(fillHex);
                g.roundRect(-w / 2, -h / 2, fw, h, r); g.fill();
                // 顶部柔和光泽高光条
                g.fillColor = new Color(255, 255, 255, 65);
                g.roundRect(-w / 2 + 4, 2, Math.max(6, fw - 8), h * 0.28, r * 0.5); g.fill();
            }
        };

        specs.forEach(s => {
            const fillColor = s.value < 30 ? s.lowFill : s.fill;
            const existing = this.sheet!.getChildByName(s.name + '-进度')?.getComponent(Graphics);
            if (existing) {
                drawPillBar(existing, s.bw, s.bh, s.value / 100, fillColor);
                const num = this.sheet!.getChildByName(s.name + '-数字')?.getComponent(Label);
                if (num) {
                    num.string = String(Math.round(s.value));
                    num.color = this.color(s.value < 30 ? '#C93832' : '#6A472B');
                }
                return;
            }
            const iconNode = this.uiNode(this.sheet!, s.name + '-图标', s.ix, s.y, 38, 38);
            this.headerArt(iconNode, s.icon);
            const barNode = this.uiNode(this.sheet!, s.name + '-进度', s.bx, s.y, s.bw, s.bh);
            const barG = barNode.addComponent(Graphics);
            drawPillBar(barG, s.bw, s.bh, s.value / 100, fillColor);
            const numLbl = this.text(this.sheet!, String(Math.round(s.value)), s.nx, s.y, 52, 30, 21, s.value < 30 ? '#C93832' : '#6A472B');
            numLbl.isBold = true; numLbl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
            numLbl.node.name = s.name + '-数字';
        });
    }
    private care(item: ItemCategory | 'rest') {
        if (item !== 'rest') {
            const changed = this.bagFilter !== item;
            this.bagFilter = item;
            if (changed || this.page !== 'bag') this.bagPage = 0;
            if (this.page === 'bag') this.updateBag(); else this.open('bag');
            return;
        }
        this.applyCare(null, 'rest');
    }

    private legacyItem(key: ItemCategory): ItemDefinition {
        const names: Record<ItemCategory, string> = { food: '营养餐', soap: '清洁包', toy: '陪玩球', medicine: '急救包' };
        return { id: key, name: names[key], appliesTo: 'both', currency: 'coins', price: 0,
            effects: key === 'food' ? { hunger: 40 } : key === 'soap' ? { clean: 40 } : key === 'medicine' ? { health: 35 } : { joy: 40, energy: -8 },
            category: key, weight: 0, limit: 0 };
    }

    private applyCare(item: ItemDefinition | null, legacy: ItemCategory | 'rest' | null = null) {
        if (!this.petSelected) { this.toast('请先选择要照顾的伙伴'); return; }
        const p = this.data.pets.find(pet => pet.id === this.selected && !pet.dead);
        if (!p) return;
        const catCheck = legacy === 'rest' ? 'rest' : item?.category;
        if (p.energy <= 0 && catCheck !== 'rest' && catCheck !== 'medicine') {
            this.toast(this.petDisplayName(p.id) + ' 太疲惫了，请先让它休息恢复活力！');
            return;
        }
        if (item && !itemApplies(item, BREEDS[p.id].kind)) { this.toast('这个道具不适合当前伙伴'); return; }
        const count = legacy && legacy !== 'rest' && legacy !== 'medicine' ? this.data[legacy] : item ? (this.data.itemInventory[item.id] || 0) : 0;
        if (legacy !== 'rest' && count <= 0) { this.toast('库存不足，去补给铺看看吧'); return; }
        const effects = item ? item.effects : { energy: 35 };
        const stats = Object.keys(effects) as PetStat[];
        if (stats.filter(stat => effects[stat]! > 0).every(stat => p[stat] >= 100)) {
            this.toast('相关状态已满，本次未消耗道具'); return;
        }
        const wasSick = p.health < 30;
        const nextPet = { ...p };
        const trait = PET_TRAITS[p.trait];
        stats.forEach(stat => {
            let delta = effects[stat]!;
            if (delta > 0) {
                if (stat === 'hunger' && (legacy === 'food' || item?.category === 'food') && trait.foodBonus) {
                    delta = Math.round(delta * (1 + trait.foodBonus));
                } else if (stat === 'energy' && legacy === 'rest' && trait.restBonus) {
                    delta = Math.round(delta * (1 + trait.restBonus));
                } else if (stat === 'joy' && (legacy === 'toy' || item?.category === 'toy') && trait.playBonus) {
                    delta = Math.round(delta * (1 + trait.playBonus));
                }
            }
            nextPet[stat] = Math.max(0, Math.min(100, p[stat] + delta));
        });
        const xpGain = Math.round(15 * (1 + starXpBonus(p.star) + (trait.xpBonus || 0)));
        const xp = Math.min(100000000, this.data.xp + xpGain);
        const levels = Math.floor(xp / 100) - Math.floor(this.data.xp / 100);
        const candidate: Save = { ...this.dailyCandidate(), xp,
            coins: Math.min(100000000, this.data.coins + levels * 60),
            gems: Math.min(100000000, this.data.gems + levels * 12),
            pets: this.data.pets.map(pet => pet.id === p.id ? nextPet : pet),
            itemInventory: { ...this.data.itemInventory } };
        if (legacy && legacy !== 'rest' && legacy !== 'medicine') candidate[legacy]--;
        else if (item) candidate.itemInventory[item.id] = count - 1;
        const category = legacy === 'rest' ? 'rest' : item?.category;
        if (category && category !== 'medicine') recordDaily(candidate.daily, category === 'food' ? (BREEDS[p.id].kind === 'cat' ? 'feedCat' : 'feedDog') : category === 'soap' ? 'clean' : category === 'toy' ? 'play' : 'rest');
        if (!this.commitShop(candidate)) return;
        const actor = this.actors.find(a => a.pet.id === p.id);
        if (actor) { actor.pet = nextPet; actor.timer = -1.2; actor.tailExcite = 1; }
        this.renderHeader();
        if (this.page === 'bag') this.updateBag(); else if (this.page === 'pet') this.open('pet');
        if (category === 'medicine') {
            this.toast(wasSick && nextPet.health >= 30 ? '治疗成功！' + this.petDisplayName(p.id) + ' 恢复健康啦！' : '使用「' + (item?.name || '治疗') + '」，健康度 +' + (effects.health || 0));
        } else {
            this.toast((item ? '使用「' + item.name + '」' : '休息完成') + '，经验 +' + xpGain + (levels > 0 ? '，升级啦！' : ''));
        }
    }
    private gainXP(amount: number) {
        const old = Math.floor(this.data.xp / 100); this.data.xp = Math.min(100000000, this.data.xp + amount);
        const gained = Math.floor(this.data.xp / 100) - old;
        if (gained > 0) { this.data.gems = Math.min(100000000, this.data.gems + gained * 12); this.data.coins = Math.min(100000000, this.data.coins + gained * 60); }
    }
    private recruitArt(parent: Node, key: string, x: number, y: number, w: number, h: number) {
        const node = this.uiNode(parent, '招募素材-' + key, x, y, w, h);
        const sprite = node.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        resources.load('art/recruit/' + key + '/spriteFrame', SpriteFrame, (error, frame) => {
            if (error || !frame || !isValid(sprite, true)) return;
            sprite.spriteFrame = frame;
            if (key !== 'background') {
                const size = frame.originalSize;
                const fit = Math.min(w / size.width, h / size.height);
                node.getComponent(UITransform)!.setContentSize(size.width * fit, size.height * fit);
            }
        });
        return node;
    }

    private recruitButton(parent: Node, title: string, key: string, x: number, y: number, w: number, h: number, action: () => void) {
        const node = this.uiNode(parent, '招募按钮-' + title, x, y, w, h);
        this.recruitArt(node, key, 0, 0, w, h);
        if (title) {
            const label = this.dailyText(node, title, 0, 0, w - 20, h - 12, 27);
            resources.load('art/recruit/' + key + '/spriteFrame', SpriteFrame, (error, frame) => {
                if (error || !frame || !isValid(label, true)) return;
                const size = frame.originalSize, fit = Math.min(w / size.width, h / size.height);
                label.node.getComponent(UITransform)!.setContentSize(size.width * fit * 0.75, size.height * fit * 0.50);
            });
        }
        this.intercept(node); this.pressVisualFeedback(node);
        node.on(Node.EventType.TOUCH_END, action, this);
        return node;
    }

    private recruitTransaction(mode: 'single' | 'ten' | 'reward') {
        const now = Date.now();
        if (this.recruitBusy || now - this.recruitClickTime < 600) { this.toast('操作太快啦，请稍候'); return; }
        this.recruitClickTime = now;
        this.recruitBusy = true;
        try {
            const state = this.data.recruit;
            let count: number, cost = 0, total = state.total, claimed = state.claimed;
            if (mode === 'reward') {
                const next = nextMilestone(claimed);
                if (next > total) { this.toast('尚未达到下一档累计奖励'); return; }
                // 每次领取最早未领档位，可连续补领；高水位确保此前档位不会重发。
                claimed = next; count = RECRUIT_CONFIG.rewardCopies;
            } else {
                const config = RECRUIT_CONFIG[mode];
                count = config.count; cost = config.cost; total += count;
                if (this.data.gems < cost) { this.showGemDialog(); return; }
            }
            if (total > RECRUIT_CONFIG.maxTotal) { this.toast('招募次数已达安全上限'); return; }
            const ids = drawRecruit(BREEDS.map((_, id) => id), count);
            const recruit = grantRecruit(state, ids, total, claimed);
            if (!recruit) { this.toast('本体库存已达安全上限，本次未扣费'); return; }
            const pets = this.data.pets.slice();
            const added: Pet[] = [];
            ids.forEach(id => {
                if (pets.some(p => p.id === id)) return;
                const pet = this.makePet(id);
                pets.push(pet); added.push(pet);
            });
            const candidate = { ...this.dailyCandidate(now), gems: this.data.gems - cost, pets, recruit };
            if (!this.commitShop(candidate)) return;
            added.forEach(p => this.spawnPet(p));
            this.renderHeader(); this.updateRecruit();
            if (this.ui && isValid(this.ui, true) && (mode !== 'reward' || !this.dialog)) {
                this.showRecruitResultDialog(mode, ids, new Set(added.map(p => p.id)), claimed);
            } else {
                this.toast(mode === 'reward' ? '已领取累计' + claimed + '次奖励' : '招募成功，本体已保留');
            }
        } finally { this.recruitBusy = false; }
    }

    private showRecruitResultDialog(mode: 'single' | 'ten' | 'reward', ids: number[], newIds: Set<number>, claimedMilestone = 0) {
        if (this.dialog) this.closeDialog();
        const isTen = ids.length > 1;
        const title = mode === 'reward' ? '累计' + claimedMilestone + '次奖励' : isTen ? '十连招募结果' : '招募成功！';
        const actions: [{ title: string; run: () => void }] | [{ title: string; run: () => void }, { title: string; run: () => void }] =
            mode === 'reward'
                ? [{ title: '开心收下', run: () => this.closeDialog() }]
                : [
                    { title: isTen ? '再抽10次' : '再抽1次', run: () => { this.recruitClickTime = 0; this.closeDialog(); this.recruitTransaction(mode); } },
                    { title: '开心收下', run: () => this.closeDialog() },
                ];
        this.showDialog(title, '', actions);
        if (!this.dialog) return;

        const panel = this.dialog.getChildByName('通用弹窗面板')!;
        const ratio = 900 / 1116;
        const panelH = isTen ? 1140 : 1080;
        panel.getComponent(UITransform)!.setContentSize(900, panelH);
        const art = panel.getChildByName('弹窗底板')!;
        const sprite = art.getComponent(Sprite)!;
        resources.load('art/dialog/panel/spriteFrame', SpriteFrame, (error, frame) => {
            if (error || !frame || !isValid(sprite, true)) return;
            const sliced = frame.clone();
            sliced.insetTop = 370; sliced.insetBottom = 134;
            sliced.insetLeft = 78; sliced.insetRight = 78;
            sprite.spriteFrame = sliced; sprite.type = Sprite.Type.SLICED;
            art.getComponent(UITransform)!.setContentSize(1116, panelH / ratio);
            art.setScale(ratio, ratio, 1);
        });
        panel.getChildByName('弹窗独立标题')!.setPosition(0, panelH / 2 - 280 * ratio);
        panel.getChildByName('商店素材-close')?.setPosition(480 * ratio, panelH / 2 - 335 * ratio);

        const content = panel.getChildByName('弹窗安全内容')!;
        content.setPosition(0, 0);
        content.getComponent(UITransform)!.setContentSize(750, panelH - 380);
        content.getChildByName('弹窗正文')!.active = false;

        const state = this.data.recruit;
        if (!isTen) {
            const id = ids[0];
            const b = BREEDS[id];
            const rarity = RARITY_INFO[b.rarity];
            const trait = PET_TRAITS[b.defaultTrait];
            const isNew = newIds.has(id);
            const copies = state.copies[id] || 0;

            const cardW = 304, cardH = 328;
            const card = this.uiNode(content, '招募结果卡片-' + id, 0, 56, cardW, cardH);
            this.albumArt(card, 'card-' + b.rarity.toLowerCase(), 0, 0, cardW, cardH, '图鉴卡片底框', false);
            const badgeH = b.rarity === 'SSR' ? 72 : 64;
            this.albumArt(card, 'rarity-' + b.rarity.toLowerCase(), -102, 112, 60, badgeH, '稀有度徽章-' + b.rarity);

            const tag = this.uiNode(card, '招募结果状态标', 24, 116, 108, 32);
            const tg = tag.addComponent(Graphics);
            tg.fillColor = this.color(isNew ? '#E55243' : '#4F9B58');
            tg.roundRect(-54, -16, 108, 32, 16); tg.fill();
            const tagLbl = this.text(tag, isNew ? 'NEW 新伙伴' : '本体 +1', 0, 0, 104, 26, 16, '#FFFDF5');
            tagLbl.isBold = true; tagLbl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';

            this.petAvatar(card, id, 0, 15, 148, false);
            const nameLbl = this.dailyText(card, b.name, 0, -114, 184, 38, 27);
            nameLbl.color = this.color('#49301E');
            card.setScale(0.76, 0.76, 1);
            tween(card).to(0.18, { scale: new Vec3(1.04, 1.04, 1) }, { easing: 'quadOut' }).to(0.1, { scale: new Vec3(1, 1, 1) }).start();

            const info = this.uiNode(content, '招募单抽详情条', 0, -172, 620, 96);
            const ig = info.addComponent(Graphics);
            ig.fillColor = this.color('#FFF8EB'); ig.strokeColor = this.color('#DCC097'); ig.lineWidth = 2.5;
            ig.roundRect(-310, -48, 620, 96, 18); ig.fill(); ig.stroke();
            const line1Text = (b.kind === 'cat' ? '猫咪' : '狗狗') + ' · ' + rarity.label + (isNew ? '  ·  新伙伴已入驻庭院！' : '  ·  已保留升星本体（现有 ×' + copies + '）');
            const line1 = this.text(info, line1Text, isNew ? -48 : 0, 21, isNew ? 480 : 590, 30, 20, rarity.badgeBg);
            line1.isBold = true; line1.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
            if (isNew) this.diamondBadge(info, b.unlockGems, 236, 21, 104, 28, '#E05744', '#FFFDF5', 15);
            const line2 = this.text(info, '性格·' + trait.name + '  ' + trait.summary, 0, -19, 590, 28, 19, '#6C4D33');
            line2.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
        } else {
            const ssrCount = ids.filter(id => BREEDS[id].rarity === 'SSR').length;
            const srCount = ids.filter(id => BREEDS[id].rarity === 'SR').length;
            const rCount = ids.length - ssrCount - srCount;
            const summary = '共获 ' + ids.length + ' 位伙伴' + (newIds.size > 0 ? ' · 新解锁 ' + newIds.size + ' 位' : '') + ' · SSR×' + ssrCount + '  SR×' + srCount + '  R×' + rCount;
            this.dailyText(content, summary, 0, 240, 720, 38, 23);

            const cols = 5, cardW = 136, cardH = 148, gapX = 12, gapY = 18;
            const seenNew = new Set<number>();
            ids.forEach((id, idx) => {
                const b = BREEDS[id];
                const col = idx % cols, row = Math.floor(idx / cols);
                const x = (col - 2) * (cardW + gapX);
                const y = 112 - row * (cardH + gapY);
                const isFirstNew = newIds.has(id) && !seenNew.has(id);
                if (isFirstNew) seenNew.add(id);

                const card = this.uiNode(content, '招募结果卡片-' + idx + '-' + id, x, y, cardW, cardH);
                this.albumArt(card, 'card-' + b.rarity.toLowerCase(), 0, 0, cardW, cardH, '图鉴卡片底框', false);
                const badgeH = b.rarity === 'SSR' ? 36 : 32;
                this.albumArt(card, 'rarity-' + b.rarity.toLowerCase(), -45, 51, 30, badgeH, '稀有度徽章-' + b.rarity);

                const pillW = isFirstNew ? 48 : 38;
                const tag = this.uiNode(card, '招募结果状态标', 10, 52, pillW, 20);
                const tg = tag.addComponent(Graphics);
                tg.fillColor = this.color(isFirstNew ? '#E55243' : '#4F9B58');
                tg.roundRect(-pillW / 2, -10, pillW, 20, 10); tg.fill();
                const tagLbl = this.text(tag, isFirstNew ? 'NEW' : '+1', 0, 0, pillW - 4, 18, 12, '#FFFDF5');
                tagLbl.isBold = true; tagLbl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';

                this.petAvatar(card, id, 0, 6, 68, false);
                const nameLbl = this.dailyText(card, b.name, 0, -51, 94, 22, 14);
                nameLbl.color = this.color('#49301E');
                card.setScale(0.75, 0.75, 1);
                tween(card).delay(idx * 0.035).to(0.15, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'quadOut' }).to(0.09, { scale: new Vec3(1, 1, 1) }).start();
            });

            const foot = this.text(content, newIds.size > 0 ? '新解锁伙伴已入驻庭院，前往图鉴可领取钻石奖励！' : '所有重复伙伴已自动保留为升星本体', 0, -206, 700, 30, 20, '#7C5A3E');
            foot.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
        }

        const btnY = isTen ? -342 : -314;
        actions.forEach((action, i) => {
            const btn = content.getChildByName('弹窗按钮-' + action.title)!;
            btn.setPosition(actions.length === 1 ? 0 : (i === 0 ? -186 : 186), btnY);
            btn.off(Node.EventType.TOUCH_START); btn.off(Node.EventType.TOUCH_CANCEL); btn.off(Node.EventType.TOUCH_END);
            const btnArt = this.shopArt(btn, 'buy', 0, 0, 380 * ratio, 380 * ratio * 120 / 321);
            btnArt.setSiblingIndex(0);
            btn.getComponent(Sprite)!.enabled = false;
            this.pressVisualFeedback(btn, btn.children.slice());
            btn.on(Node.EventType.TOUCH_END, action.run, this);
        });
        this.layoutDialog();
    }

    private showRecruitRewards() {
        if (this.dialog) return;
        this.showDialog('累计招募奖励', '', [
            { title: '领取奖励', run: () => this.recruitTransaction('reward') },
            { title: '关闭', run: () => this.closeDialog() }
        ]);
        if (!this.dialog) return;
        const panel = this.dialog.getChildByName('通用弹窗面板')!;
        const ratio = 900 / 1116;
        panel.getComponent(UITransform)!.setContentSize(900, 1100);
        const art = panel.getChildByName('弹窗底板')!;
        const sprite = art.getComponent(Sprite)!;
        // 只拉伸浅色中段，保留顶饰、木牌和底部边框原比例；不修改共享frame。
        resources.load('art/dialog/panel/spriteFrame', SpriteFrame, (error, frame) => {
            if (error || !frame || !isValid(sprite, true)) return;
            const sliced = frame.clone();
            sliced.insetTop = 370; sliced.insetBottom = 134;
            sliced.insetLeft = 78; sliced.insetRight = 78;
            sprite.spriteFrame = sliced; sprite.type = Sprite.Type.SLICED;
            art.getComponent(UITransform)!.setContentSize(1116, 1100 / ratio);
            art.setScale(ratio, ratio, 1);
        });
        panel.getChildByName('弹窗独立标题')!.setPosition(0, 550 - 280 * ratio);
        panel.getChildByName('商店素材-close')?.setPosition(480 * ratio, 550 - 335 * ratio);
        const content = panel.getChildByName('弹窗安全内容')!;
        content.setPosition(0, 0);
        content.getComponent(UITransform)!.setContentSize(720, 690);
        content.getChildByName('弹窗正文')!.active = false;
        this.dailyText(content, '', 0, 210, 680, 44, 32).node.name = '累计招募当前次数';
        const viewport = this.uiNode(content, '累计奖励可视窗口', 0, -15, 700, 350);
        viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        const rows = this.uiNode(viewport, '累计奖励滚动内容', 0, 175, 700, 0);
        rows.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
        const scroll = viewport.addComponent(ScrollView);
        scroll.content = rows; scroll.horizontal = false; scroll.vertical = true;
        scroll.cancelInnerEvents = true; scroll.elastic = false; scroll.inertia = false;
        this.dailyText(content, '每档奖励：随机宠物本体 ×1', 0, -224, 690, 34, 26);
        this.dailyText(content, '100次后每100次一档 · 按顺序领取 · 上滑查看更多', 0, -261, 700, 32, 24);
        content.getChildByName('弹窗按钮-领取奖励')!.setPosition(-186, -340);
        content.getChildByName('弹窗按钮-关闭')!.setPosition(186, -340);
        for (const [name, action] of [
            ['弹窗按钮-领取奖励', () => this.recruitTransaction('reward')],
            ['弹窗按钮-关闭', () => this.closeDialog()]
        ] as const) {
            const button = content.getChildByName(name)!;
            button.off(Node.EventType.TOUCH_START); button.off(Node.EventType.TOUCH_CANCEL); button.off(Node.EventType.TOUCH_END);
            const art = this.shopArt(button, 'buy', 0, 0, 380 * ratio, 380 * ratio * 120 / 321);
            art.setSiblingIndex(0);
            button.getComponent(Sprite)!.enabled = false;
            this.pressVisualFeedback(button, button.children.slice());
            button.on(Node.EventType.TOUCH_END, action, this);
        }
        this.appendRecruitRewardRows(rows, 0);
        scroll.node.on(ScrollView.EventType.SCROLL_TO_BOTTOM, () => {
            const count = rows.children.filter(n => n.name.startsWith('累计招募档位-')).length;
            this.appendRecruitRewardRows(rows, count);
            this.updateRecruitRewards();
        }, this);
        this.updateRecruitRewards();
        this.layoutDialog();
    }

    private appendRecruitRewardRows(rows: Node, start: number) {
        // 每批12档，最多120行；继续翻页覆盖极端存档，而不是创建上万个节点。
        const existing = rows.children.filter(n => n.name.startsWith('累计招募档位-'));
        if (existing.length >= 120) return;
        const base = Number(rows.name.split(':')[1] || 0);
        const targetAt = (index: number) => index < 3 ? [10, 30, 50][index] : (index - 2) * 100;
        const end = Math.min(start + 12, 120);
        let added = 0;
        for (let index = start; index < end; index++) {
            const target = targetAt(base + index);
            if (target > RECRUIT_CONFIG.maxTotal) break;
            added++;
            const row = this.uiNode(rows, '累计招募档位-' + target, 0, -68 - index * 146, 700, 136);
            this.dailySprite(row, 'row-clean', 0, 0, 700, 136, true, '累计奖励行板');
            this.recruitArt(row, 'chest', -288, 5, 76, 72);
            this.dailyText(row, '累计招募' + target + '次', -76, 39, 310, 34, 29, true).node.name = '档位标题';
            this.dailyText(row, '随机宠物本体 ×1', -76, 2, 310, 32, 25, true);
            this.dailyText(row, '', -76, -33, 310, 30, 24, true).node.name = '档位进度';
            this.dailyText(row, '', 254, 5, 140, 38, 27).node.name = '档位状态';
        }
        rows.getComponent(UITransform)!.setContentSize(700, (start + added) * 146);
        if (start + added === 120 && targetAt(base + 120) <= RECRUIT_CONFIG.maxTotal) {
            const more = this.dailyButton(rows, '查看后续档位', 0, -120 * 146 - 38, 320, 68, () => {
                rows.children.slice().forEach(child => child.destroy());
                rows.removeAllChildren();
                rows.name = '累计奖励滚动内容:' + (base + 120);
                this.appendRecruitRewardRows(rows, 0);
                rows.parent!.getComponent(ScrollView)!.scrollToTop(0);
                this.updateRecruitRewards();
            });
            more.name = '累计奖励后续档位';
            rows.getComponent(UITransform)!.setContentSize(700, 120 * 146 + 80);
        }
    }

    private updateRecruitRewards() {
        if (!this.dialog) return;
        const panel = this.dialog.getChildByName('通用弹窗面板');
        if (panel?.getChildByName('弹窗独立标题')?.getComponent(Label)?.string !== '累计招募奖励') return;
        const content = panel.getChildByName('弹窗安全内容')!;
        const state = this.data.recruit, next = nextMilestone(state.claimed);
        content.getChildByName('累计招募当前次数')!.getComponent(Label)!.string = '当前累计招募 ' + state.total + ' 次';
        const rows = content.getChildByName('累计奖励可视窗口')!.getComponent(ScrollView)!.content!;
        rows.children.filter(n => n.name.startsWith('累计招募档位-')).forEach(row => {
            const target = Number(row.name.slice('累计招募档位-'.length));
            const claimed = state.claimed >= target, ready = state.total >= target;
            row.getChildByName('档位进度')!.getComponent(Label)!.string = '进度 ' + Math.min(state.total, target) + ' / ' + target;
            const status = row.getChildByName('档位状态')!.getComponent(Label)!;
            status.string = claimed ? '已领取' : ready ? '可领取' : '未完成';
            status.color = this.statusColor(claimed || ready);
        });
        const button = content.getChildByName('弹窗按钮-领取奖励')!;
        const label = button.children.find(n => n.getComponent(Label))!.getComponent(Label)!;
        label.string = state.total >= next ? '领取' + next + '次奖励' : '未达标';
        label.color = this.statusColor(state.total >= next);
    }

    private recruitPoolOrder(): number[] {
        const rank: Record<'SSR' | 'SR' | 'R', number> = { SSR: 0, SR: 1, R: 2 };
        return BREEDS.map(b => b.id).sort((a, b) => rank[BREEDS[a].rarity] - rank[BREEDS[b].rarity] || a - b);
    }

    private showRecruitPoolDialog(focusBreedId?: number) {
        if (this.dialog) return;
        this.showDialog('招募卡池详情', '', [
            { title: '知道了', run: () => this.closeDialog() }
        ]);
        if (!this.dialog) return;
        const panel = this.dialog.getChildByName('通用弹窗面板')!;
        const ratio = 900 / 1116;
        panel.getComponent(UITransform)!.setContentSize(900, 1120);
        const art = panel.getChildByName('弹窗底板')!;
        const sprite = art.getComponent(Sprite)!;
        resources.load('art/dialog/panel/spriteFrame', SpriteFrame, (error, frame) => {
            if (error || !frame || !isValid(sprite, true)) return;
            const sliced = frame.clone();
            sliced.insetTop = 370; sliced.insetBottom = 134;
            sliced.insetLeft = 78; sliced.insetRight = 78;
            sprite.spriteFrame = sliced; sprite.type = Sprite.Type.SLICED;
            art.getComponent(UITransform)!.setContentSize(1116, 1120 / ratio);
            art.setScale(ratio, ratio, 1);
        });
        panel.getChildByName('弹窗独立标题')!.setPosition(0, 560 - 280 * ratio);
        panel.getChildByName('商店素材-close')?.setPosition(480 * ratio, 560 - 335 * ratio);

        const content = panel.getChildByName('弹窗安全内容')!;
        content.setPosition(0, 0);
        content.getComponent(UITransform)!.setContentSize(740, 720);
        content.getChildByName('弹窗正文')!.active = false;

        this.dailyText(content, '共 ' + BREEDS.length + ' 位猫狗伙伴 · 左右滑动卡片查看详情', 0, 232, 700, 38, 25);
        const sub = this.dailyText(content, '所有伙伴等权抽取 · 重复伙伴自动转为本体用于升星', 0, 194, 700, 30, 20);
        sub.color = this.color('#876447'); sub.outlineWidth = 0;

        const viewW = 716, viewH = 420;
        const viewport = this.uiNode(content, '招募卡池可视窗口', 0, -28, viewW, viewH);
        viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        const track = this.uiNode(viewport, '招募卡池滚动内容', -viewW / 2, 0, viewW, viewH);
        track.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
        const scroll = viewport.addComponent(ScrollView);
        scroll.content = track; scroll.horizontal = true; scroll.vertical = false;
        scroll.cancelInnerEvents = true; scroll.elastic = true; scroll.inertia = true;

        const order = this.recruitPoolOrder();
        const slotW = 282, slotH = 408, gap = 20, pad = 16;
        const pitch = slotW + gap;
        const totalW = Math.max(viewW, pad * 2 + order.length * slotW + (order.length - 1) * gap);
        track.getComponent(UITransform)!.setContentSize(totalW, viewH);

        order.forEach((id, idx) => {
            const b = BREEDS[id];
            const rarity = RARITY_INFO[b.rarity];
            const trait = PET_TRAITS[b.defaultTrait];
            const copies = this.data.recruit.copies[id] || 0;
            const owned = this.data.pets.some(p => p.id === id);
            const x = pad + slotW / 2 + idx * pitch;
            const slot = this.uiNode(track, '卡池详情卡片-' + id, x, 0, slotW, slotH);

            // 上半部分：原版手绘稀有度图鉴卡片（零变形）
            const cardW = 274, cardH = 296;
            const cardBox = this.uiNode(slot, '卡池图鉴卡面', 0, 50, cardW, cardH);
            this.albumArt(cardBox, 'card-' + b.rarity.toLowerCase(), 0, 0, cardW, cardH, '图鉴卡片底框', false);
            const badgeH = b.rarity === 'SSR' ? 66 : 58;
            this.albumArt(cardBox, 'rarity-' + b.rarity.toLowerCase(), -92, 101, 55, badgeH, '稀有度徽章-' + b.rarity);

            // 右上拥有/本体胶囊（居中落在左上徽章与右上星星之间，不压星角）
            const pill = this.uiNode(cardBox, '卡池拥有状态', 22, 105, 96, 28);
            const pg = pill.addComponent(Graphics);
            pg.fillColor = this.color(owned ? '#4F9B58' : '#8B7460');
            pg.roundRect(-48, -14, 96, 28, 14); pg.fill();
            const pillLbl = this.text(pill, owned ? '本体 ×' + copies : '未获得', 0, 0, 90, 24, 16, '#FFFDF5');
            pillLbl.isBold = true; pillLbl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';

            // 中央头像 + 骨头铭牌名称
            this.petAvatar(cardBox, id, 0, 14, 134, false);
            const nameLbl = this.dailyText(cardBox, b.name, 0, -102, 164, 34, 24);
            nameLbl.color = this.color('#49301E');

            // 下半部分：紧凑详情卡条（品类/稀有度、图鉴首获钻石、性格词条）
            const info = this.uiNode(slot, '卡池详情信息条', 0, -152, 274, 88);
            const ig = info.addComponent(Graphics);
            ig.fillColor = this.color('#FFF8EB'); ig.strokeColor = this.color('#DCC097'); ig.lineWidth = 2.5;
            ig.roundRect(-137, -44, 274, 88, 16); ig.fill(); ig.stroke();
            const meta = this.text(info, (b.kind === 'cat' ? '猫咪' : '狗狗') + ' · ' + rarity.label, -48, 19, 164, 28, 18, rarity.badgeBg);
            meta.isBold = true; meta.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
            this.diamondBadge(info, b.unlockGems, 80, 19, 92, 25, '#E05744', '#FFFDF5', 14);
            const traitLbl = this.text(info, '性格·' + trait.name + '  ' + trait.summary, 0, -18, 258, 28, 16, '#6C4D33');
            traitLbl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
        });

        // 左右快捷翻卡箭头（兼顾触屏滑动与鼠标轻点翻页）
        const maxScroll = Math.max(0, totalW - viewW);
        const nudge = (dir: number) => {
            const cur = scroll.getScrollOffset().x;
            const next = Math.max(0, Math.min(maxScroll, -cur + dir * pitch));
            scroll.scrollToOffset(new Vec2(next, 0), 0.22);
        };
        for (const [label, dir, ax] of [['‹', -1, -356], ['›', 1, 356]] as const) {
            const arrow = this.uiNode(content, dir < 0 ? '卡池左滑按钮' : '卡池右滑按钮', ax, -28, 46, 72);
            const ag = arrow.addComponent(Graphics);
            ag.fillColor = new Color(111, 72, 43, 195);
            ag.roundRect(-23, -36, 46, 72, 23); ag.fill();
            const txt = this.text(arrow, label, 0, 2, 40, 48, 36, '#FFF8E8');
            txt.isBold = true;
            this.intercept(arrow); this.pressVisualFeedback(arrow);
            arrow.on(Node.EventType.TOUCH_END, () => nudge(dir), this);
        }

        if (focusBreedId !== undefined) {
            const idx = order.indexOf(focusBreedId);
            if (idx >= 0) {
                const centerX = pad + slotW / 2 + idx * pitch;
                const target = Math.max(0, Math.min(maxScroll, centerX - viewW / 2));
                scroll.scrollToOffset(new Vec2(target, 0), 0);
            } else {
                scroll.scrollToLeft(0);
            }
        } else {
            scroll.scrollToLeft(0);
        }

        const closeBtn = content.getChildByName('弹窗按钮-知道了')!;
        closeBtn.setPosition(0, -334);
        closeBtn.off(Node.EventType.TOUCH_START); closeBtn.off(Node.EventType.TOUCH_CANCEL); closeBtn.off(Node.EventType.TOUCH_END);
        const btnArt = this.shopArt(closeBtn, 'buy', 0, 0, 380 * ratio, 380 * ratio * 120 / 321);
        btnArt.setSiblingIndex(0);
        closeBtn.getComponent(Sprite)!.enabled = false;
        this.pressVisualFeedback(closeBtn, closeBtn.children.slice());
        closeBtn.on(Node.EventType.TOUCH_END, () => this.closeDialog(), this);
        this.layoutDialog();
    }

    private updateRecruit() {
        this.updateRecruitRewards();
        const state = this.data.recruit;
        this.recruitCards.forEach(item => {
            const count = state.copies[item.id] || 0;
            item.countLabel.string = '×' + count;
            if (isValid(item.pill, true)) {
                item.pill.clear();
                item.pill.fillColor = this.color(count > 0 ? '#4F9B58' : '#8B7460');
                item.pill.roundRect(-29, -12, 58, 24, 12);
                item.pill.fill();
            }
        });
        const next = nextMilestone(state.claimed), ready = state.total >= next;
        if (this.recruitProgress) this.recruitProgress.string = state.total + ' / ' + next;
        const rewardHint = this.sheet?.getChildByName('领取招募累计奖励')?.getChildByName('招募奖励说明')?.getComponent(Label);
        if (rewardHint) rewardHint.string = ready ? '已达标，点击领取\n获得1只伙伴本体' : '再招募 ' + (next - state.total) + ' 次\n达标送1只伙伴本体';
        if (this.recruitBadge) this.recruitBadge.active = ready;
        const fill = this.sheet?.getChildByName('领取招募累计奖励')?.getChildByName('招募累计进度填充')?.getComponent(Sprite);
        if (fill) fill.fillRange = Math.min(1, state.total / next);
        if (this.recruitResult) {
            const counts = BREEDS.map((b, id) => ({ name: b.name, count: state.recent.filter(value => value === id).length })).filter(item => item.count);
            this.recruitResult.string = counts.length ? '最近获得：' + counts.map(item => item.name + '×' + item.count).join('、') : '重复伙伴保留本体供升星 · 现含' + BREEDS.length + '种猫狗';
        }
    }

    private renderRecruit() {
        const panel = this.sheet!;
        this.recruitLabels = [];
        this.recruitCards = [];
        // 背景独立于正文缩放，位于货币与底栏后方，且不拦截输入。
        this.recruitBackground = this.recruitArt(this.ui, 'background', 0, 0, 1080, 1920);
        this.recruitBackground.setSiblingIndex(0);
        // 招牌向左移并与左上玩家头像左缘对齐（(-236-300)*0.9551 ≈ -512 ≈ 头像框左缘 -511）。
        this.recruitArt(panel, 'title', -236, 606, 600, 230);
        // 按1536源图真实内区映射：主牌与下方副条独立定位，居中落入木牌与丝带框内。
        this.dailyText(panel, '猫狗招募', -236, 632, 400, 78, 62, false, true).node.name = '招募大标题';
        this.dailyText(panel, '与可爱的毛孩子相遇吧！', -236, 536, 350, 29, 24).node.name = '招募标题描述';
        // 招募奖励整个功能面板向右移，与左侧招牌形成舒展对称留白，不遮挡中央猫狗立绘。
        const reward = this.uiNode(panel, '领取招募累计奖励', 388, 592, 300, 222);
        this.recruitArt(reward, 'description', 0, 0, 300, 222);
        void this.navArt(reward, 'label0', 22, 52, 152, 64);
        this.recruitArt(reward, 'chest', -86, 52, 40, 38);
        this.dailyText(reward, '招募奖励', 22, 54, 118, 30, 24).node.name = '招募奖励标题';
        const hint = this.dailyText(reward, '', 0, -8, 228, 52, 20);
        hint.node.name = '招募奖励说明'; hint.enableWrapText = true;
        const track = this.recruitArt(reward, 'progress-track', -18, -66, 204, 204 * 120 / 588);
        track.name = '招募累计进度槽';
        // 填充仅适配内槽，右侧留出独立放大镜图标位避免压槽出框。
        const bar = this.uiNode(reward, '招募累计进度填充', -18, -66, 182, 22);
        const fill = bar.addComponent(Sprite); fill.sizeMode = Sprite.SizeMode.CUSTOM;
        resources.load('art/header/xp-fit/spriteFrame', SpriteFrame, (error, frame) => {
            if (error || !frame || !isValid(fill, true)) return;
            fill.spriteFrame = frame; fill.type = Sprite.Type.FILLED;
            fill.fillType = Sprite.FillType.HORIZONTAL; fill.fillStart = 0;
            fill.fillRange = Math.min(1, this.data.recruit.total / nextMilestone(this.data.recruit.claimed));
        });
        this.intercept(reward); this.pressVisualFeedback(reward);
        reward.on(Node.EventType.TOUCH_END, () => this.recruitTransaction('reward'), this);
        this.recruitBadge = this.recruitArt(reward, 'badge', 131, 92, 40, 43);
        this.recruitBadge.active = false;
        this.recruitProgress = this.dailyText(reward, '', -18, -66, 156, 32, 22);
        this.recruitProgress.node.name = '招募累计进度文字';
        const search = this.uiNode(reward, '查看累计招募奖励', 108, -66, 48, 48);
        this.recruitArt(search, 'search', 0, 0, 42, 42);
        this.intercept(search); this.pressVisualFeedback(search);
        search.on(Node.EventType.TOUCH_END, () => this.showRecruitRewards(), this);
        // 两个固定热区只缩放内部美术，价格使用原有钻石图标。
        const single = this.recruitButton(panel, '', 'normal', -240, -334, 460, 216, () => this.recruitTransaction('single'));
        single.name = '招募按钮-普通招募 · 300钻 / 1次';
        const ten = this.recruitButton(panel, '', 'advanced', 240, -334, 460, 216, () => this.recruitTransaction('ten'));
        ten.name = '招募按钮-高级招募 · 2700钻 / 10次';
        for (const [node, cost, count] of [[single, '300', '1'], [ten, '2700', '10']] as const) {
            const diamond = this.uiNode(node, '招募价格钻石', -64, 64, 44, 44 * 315 / 353);
            this.headerArt(diamond, 'diamond-icon');
            this.dailyText(node, '×' + cost, 30, 64, 140, 38, 30);
            this.dailyText(node, '招募' + count + '次', 0, 2, 300, 62, 46, false, true);
            this.dailyText(node, '随机获得伙伴本体', 0, -50, 285, 28, 22);
        }
        this.recruitArt(ten, 'discount', 170, 80, 96, 32);
        this.dailyText(ten, '9折', 170, 81, 62, 26, 22).node.name = '十抽9折文字牌';
        const preview = this.uiNode(panel, '招募预览横栏', 0, -594, 964, 296);
        const previewArt = this.uiNode(preview, '招募预览半透明底板', 0, 0, 964, 296);
        const previewFill = previewArt.addComponent(Graphics);
        previewFill.fillColor = new Color(111, 72, 43, 185);
        previewFill.roundRect(-482, -148, 964, 296, 26); previewFill.fill();
        this.dailyText(preview, '宠物预览', -340, 112, 220, 38, 28, true).node.name = '宠物预览标题';
        const swipeHint = this.text(preview, '左右滑动卡片浏览 · 点击看详情', -20, 112, 340, 28, 19, '#FFF3DC');
        swipeHint.node.name = '招募预览滑动提示';
        swipeHint.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
        swipeHint.outlineColor = this.color('#4A2B14'); swipeHint.outlineWidth = 1.5;
        const details = this.uiNode(preview, '查看招募卡池', 368, 112, 200, 56);
        void this.navArt(details, 'label0', 0, 0, 168, 62);
        this.dailyText(details, '查看详情 ›', 0, 2, 132, 30, 23);
        this.intercept(details); this.pressVisualFeedback(details, details.children.slice());
        details.on(Node.EventType.TOUCH_END, () => this.showRecruitPoolDialog(), this);

        // 招募预览采用正式手绘稀有度图鉴卡片 + 横向流畅滑动条，展示全部 12 位猫狗伙伴。
        const viewW = 928, viewH = 204;
        const viewport = this.uiNode(preview, '招募预览可视窗口', 0, -28, viewW, viewH);
        viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        const strip = this.uiNode(viewport, '招募预览滚动内容', -viewW / 2, 0, viewW, viewH);
        strip.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
        const previewScroll = viewport.addComponent(ScrollView);
        previewScroll.content = strip; previewScroll.horizontal = true; previewScroll.vertical = false;
        previewScroll.cancelInnerEvents = true; previewScroll.elastic = true; previewScroll.inertia = true;

        const order = this.recruitPoolOrder();
        const cardW = 172, cardH = 186, gap = 12, pad = 10;
        const totalW = Math.max(viewW, pad * 2 + order.length * cardW + (order.length - 1) * gap);
        strip.getComponent(UITransform)!.setContentSize(totalW, viewH);

        order.forEach((id, idx) => {
            const b = BREEDS[id];
            const x = pad + cardW / 2 + idx * (cardW + gap);
            const card = this.uiNode(strip, '招募本体-' + id, x, 0, cardW, cardH);
            this.albumArt(card, 'card-' + b.rarity.toLowerCase(), 0, 0, cardW, cardH, '图鉴卡片底框', false);
            const badgeH = b.rarity === 'SSR' ? 45 : 40;
            this.albumArt(card, 'rarity-' + b.rarity.toLowerCase(), -58, 65, 38, badgeH, '稀有度徽章-' + b.rarity);
            const pillNode = this.uiNode(card, '招募本体数标签', 12, 67, 58, 24);
            const pill = pillNode.addComponent(Graphics);
            const countLabel = this.text(pillNode, '×0', 0, 0, 54, 22, 15, '#FFFDF5');
            countLabel.isBold = true; countLabel.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
            this.petAvatar(card, id, 0, 9, 86, false);
            const nameLabel = this.dailyText(card, b.name, 0, -64, 114, 26, 17);
            nameLabel.color = this.color('#49301E');
            this.pressVisualFeedback(card, card.children.slice());
            this.scrollTap(card, () => this.showRecruitPoolDialog(id));
            this.recruitLabels.push(countLabel);
            this.recruitCards.push({ id, pill, countLabel });
        });
        previewScroll.scrollToLeft(0);

        this.recruitResult = this.dailyText(panel, '', 0, -756, 900, 32, 18);
        this.recruitResult.node.name = '招募最近结果'; this.recruitResult.enableWrapText = true;
        // 招募页局部减弱浅色描边，其他界面保持原样。
        const soften = (node: Node) => {
            if (node.name === '招募本体数标签' || node.name === '招募预览滑动提示') return;
            const label = node.getComponent(Label);
            if (label) label.outlineWidth = 1;
            node.children.forEach(soften);
        };
        soften(panel);
        this.updateRecruit();
    }
    private albumArt(parent: Node, key: string, x: number, y: number, w: number, h: number, name = '图鉴素材-' + key, sliced = false) {
        const node = this.uiNode(parent, name, x, y, w, h);
        const sprite = node.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        if (sliced) sprite.type = Sprite.Type.SLICED;
        const request = {};
        this.spriteRequests.set(sprite, request);
        resources.load('art/album/' + key + '/spriteFrame', SpriteFrame, (error, frame) => {
            if (error || !frame || !isValid(node, true) || !isValid(sprite, true) || this.spriteRequests.get(sprite) !== request) return;
            sprite.spriteFrame = frame;
            if (sliced) {
                // 等比缩放九宫格节点，防止高分辨率圆角贴图在较矮的页签/横卡上被纵向压扁成尖角。
                const scale = Math.min(1, w / frame.originalSize.width, h / frame.originalSize.height);
                node.getComponent(UITransform)!.setContentSize(w / scale, h / scale);
                node.setScale(scale, scale, 1);
            }
        });
        return node;
    }

    private closeGmPanel() {
        if (!this.gmPanel) return;
        this.gmPanel.active = false;
        this.gmPanel.removeFromParent();
        this.gmPanel.destroy();
        this.gmPanel = null;
        this.blockedUntil = Date.now() + 300;
    }

    private layoutGmPanel() {
        if (!this.gmPanel || !isValid(this.gmPanel, true)) return;
        this.gmPanel.getComponent(UITransform)!.setContentSize(this.width, this.height);
        const shade = this.gmPanel.getComponent(Graphics)!;
        shade.clear(); shade.fillColor = new Color(0, 0, 0, 150);
        shade.rect(-this.width / 2, -this.height / 2, this.width, this.height); shade.fill();
        const card = this.gmPanel.getChildByName('GM卡片');
        if (card) {
            const scale = Math.min(1, (this.width - 40) / 860, (this.height - 80) / 1180);
            card.setScale(scale, scale, 1);
        }
    }

    public toggleGmPanel() {
        if (this.gmPanel) { this.closeGmPanel(); return; }
        const overlay = this.uiNode(this.ui, 'GM调试面板', 0, 0, this.width, this.height);
        this.gmPanel = overlay;
        overlay.addComponent(Graphics); this.intercept(overlay);
        const card = this.uiNode(overlay, 'GM卡片', 0, 0, 860, 1120);
        this.intercept(card);
        const bg = card.addComponent(Graphics);
        bg.fillColor = this.color('#FFF9EC'); bg.strokeColor = this.color('#B87B44'); bg.lineWidth = 6;
        bg.roundRect(-430, -560, 860, 1120, 32); bg.fill(); bg.stroke();
        this.dailyText(card, 'GM 预览调试面板', 0, 500, 480, 54, 38);
        const closeBtn = this.bagButton(card, '关闭', 330, 500, 120, 52, () => this.closeGmPanel());
        closeBtn.name = '关闭GM按钮';

        const refreshVisible = () => {
            this.renderHeader();
            if (this.page === 'album') this.renderAlbumGrid();
            else if (this.page === 'profile') this.refreshProfileInPlace();
            else if (this.page === 'pet') this.renderPet();
            else if (this.page === 'bag') this.updateBag();
            else if (this.page === 'recruit') this.updateRecruit();
            else if (this.page === 'adventure') this.updateAdventureLabel();
            else if (this.page === 'shop') this.updateShopLabels();
        };
        const activePetId = () => (this.page === 'profile' ? this.profilePetId : this.selected);

        const actions: [string, () => void][] = [
            ['钻石 +10000', () => {
                const c = this.dailyCandidate();
                c.gems = Math.min(100000000, c.gems + 10000);
                if (this.commitShop(c)) { refreshVisible(); this.toast('GM：钻石 +10000'); }
            }],
            ['金币 +10000', () => {
                const c = this.dailyCandidate();
                c.coins = Math.min(100000000, c.coins + 10000);
                if (this.commitShop(c)) { refreshVisible(); this.toast('GM：金币 +10000'); }
            }],
            ['解锁全部 12 伙伴', () => {
                const c = this.dailyCandidate();
                const owned = new Set(c.pets.map(p => p.id));
                const added: Pet[] = [];
                const copies = { ...c.recruit.copies };
                BREEDS.forEach(b => {
                    if (!owned.has(b.id)) {
                        const np = this.makePet(b.id, 78, 84, 88, 82);
                        c.pets = [...c.pets, np];
                        added.push(np);
                        copies[b.id] = Math.max(1, copies[b.id] || 0);
                    }
                });
                c.recruit = { ...c.recruit, copies };
                if (this.commitShop(c)) {
                    added.forEach(p => this.spawnPet(p));
                    refreshVisible();
                    this.toast('GM：已解锁全部 ' + BREEDS.length + ' 只伙伴');
                }
            }],
            ['全伙伴本体 +5', () => {
                const c = this.dailyCandidate();
                const copies = { ...c.recruit.copies };
                BREEDS.forEach(b => { copies[b.id] = Math.min(999, (copies[b.id] || 0) + 5); });
                c.recruit = { ...c.recruit, copies };
                if (this.commitShop(c)) { refreshVisible(); this.toast('GM：全伙伴升星本体 +5'); }
            }],
            ['当前伙伴升 1 星', () => {
                const pid = activePetId();
                const pet = this.data.pets.find(p => p.id === pid);
                if (!pet) { this.toast('请先选中已解锁伙伴'); return; }
                const nextStar = Math.min(MAX_PET_STAR, pet.star + 1);
                const ownedOutfits = pet.ownedOutfits.slice();
                if (nextStar >= 3 && !ownedOutfits.includes('gold_crown')) ownedOutfits.push('gold_crown');
                const nextPet: Pet = { ...pet, star: nextStar, ownedOutfits };
                const c = this.dailyCandidate();
                c.pets = c.pets.map(p => p.id === pid ? nextPet : p);
                if (this.commitShop(c)) {
                    const a = this.actors.find(x => x.pet.id === pid);
                    if (a) a.pet = nextPet;
                    refreshVisible();
                    this.toast('GM：' + this.petDisplayName(pid) + ' 已升至 ' + nextStar + ' 星');
                }
            }],
            ['重置图鉴领奖', () => {
                const c = this.dailyCandidate();
                c.albumClaimed = {};
                if (this.commitShop(c)) { refreshVisible(); this.toast('GM：图鉴解锁钻石已可重新领取'); }
            }],
            ['全伙伴状态回满', () => {
                const c = this.dailyCandidate();
                c.pets = c.pets.map(p => ({ ...p, hunger: 100, clean: 100, energy: 100, joy: 100 }));
                if (this.commitShop(c)) {
                    c.pets.forEach(p => { const a = this.actors.find(x => x.pet.id === p.id); if (a) a.pet = p; });
                    refreshVisible(); this.toast('GM：全部伙伴状态已回满 100');
                }
            }],
            ['全状态降到 50', () => {
                const c = this.dailyCandidate();
                c.pets = c.pets.map(p => ({ ...p, hunger: 50, clean: 50, energy: 50, joy: 50 }));
                if (this.commitShop(c)) {
                    c.pets.forEach(p => { const a = this.actors.find(x => x.pet.id === p.id); if (a) a.pet = p; });
                    refreshVisible(); this.toast('GM：全部状态已设为 50（偏低状态）');
                }
            }],
            ['全状态归 0', () => {
                const c = this.dailyCandidate();
                c.pets = c.pets.map(p => ({ ...p, hunger: 0, clean: 0, energy: 0, joy: 0 }));
                if (this.commitShop(c)) {
                    c.pets.forEach(p => { const a = this.actors.find(x => x.pet.id === p.id); if (a) a.pet = p; });
                    refreshVisible(); this.toast('GM：全部状态已归 0（危急气泡测试）');
                }
            }],
            ['触发相遇气泡', () => {
                this.closeGmPanel();
                this.open('home');
                this.actors.slice(0, 4).forEach((a, i) => this.showSocialBubble(a, i % 2 === 0 ? -1 : 1));
                this.toast('GM：已触发庭院相遇气泡');
            }],
            ['当前宠全装扮皮肤', () => {
                const pid = activePetId();
                const pet = this.data.pets.find(p => p.id === pid);
                if (!pet) { this.toast('请先选中已解锁伙伴'); return; }
                const allOutfits = PET_OUTFITS.map(o => o.id);
                const allCoats = PET_COATS.map(co => co.id);
                const nextPet: Pet = { ...pet, ownedOutfits: allOutfits, ownedCoats: allCoats };
                const c = this.dailyCandidate();
                c.pets = c.pets.map(p => p.id === pid ? nextPet : p);
                if (this.commitShop(c)) {
                    const a = this.actors.find(x => x.pet.id === pid);
                    if (a) a.pet = nextPet;
                    refreshVisible(); this.toast('GM：已为' + this.petDisplayName(pid) + '解锁全部装扮与服装皮肤');
                }
            }],
            ['全伙伴随机换装', () => {
                const outfits = PET_OUTFITS.filter(o => o.id !== 'none').map(o => o.id);
                const coats = PET_COATS.filter(co => co.id !== 'original').map(co => co.id);
                const c = this.dailyCandidate();
                c.pets = c.pets.map((p, idx) => {
                    const o = outfits[idx % outfits.length];
                    const co = coats[idx % coats.length];
                    const ownedOutfits = Array.from(new Set<OutfitId>([...p.ownedOutfits, o]));
                    const ownedCoats = Array.from(new Set<CoatId>([...p.ownedCoats, co]));
                    return { ...p, outfit: o, coat: co, ownedOutfits, ownedCoats };
                });
                if (this.commitShop(c)) {
                    c.pets.forEach(p => { void this.refreshPetAppearance(p.id); });
                    refreshVisible(); this.toast('GM：已为全部伙伴换上随机装扮与皮肤');
                }
            }],
            ['全道具 +5 / 经验+100', () => {
                const c = this.dailyCandidate();
                const inv = { ...c.itemInventory };
                ITEM_CATALOG.forEach(item => { inv[item.id] = Math.min(9999, (inv[item.id] || 0) + 5); });
                c.itemInventory = inv;
                c.food += 5; c.soap += 5; c.toy += 5;
                c.xp = Math.min(100000000, c.xp + 100);
                if (this.commitShop(c)) { refreshVisible(); this.toast('GM：全道具 +5，玩家经验 +100'); }
            }],
            ['冒险快进+6小时', () => {
                const c = this.dailyCandidate();
                c.adventureIdleStart = Math.max(0, (c.adventureIdleStart || Date.now()) - 6 * 3600000);
                if (this.commitShop(c)) {
                    const p0 = this.data.pets.find(p => !p.dead && !p.lost);
                    if (p0) this.triggerAdventureOutcome(p0, rollAdventureEvent(this.petDisplayName(p0.id), BREEDS[p0.id].kind, p0.health, p0.joy));
                    refreshVisible(); this.toast('GM：挂机冒险快进 +6 小时，快去开宝箱看日记！');
                }
            }],
            ['庭院拉便便', () => {
                const alive = this.actors.find(a => !a.pet.dead && !a.dying);
                const x = alive ? alive.node.position.x : 0.2;
                const z = alive ? alive.node.position.z : 1.4;
                this.spawnYardPoop(alive ? alive.pet.id : 0, x, z);
                this.closeGmPanel();
                this.open('home');
                this.toast('GM：庭院出现一坨便便，点击即可清理！');
            }],
            ['当前宠生病(健康20)', () => {
                const pid = activePetId();
                const c = this.dailyCandidate();
                const pet = c.pets.find(p => p.id === pid && !p.dead);
                if (!pet) { this.toast('请先选中存活伙伴'); return; }
                pet.health = 20; pet.clean = 18; pet.hunger = 15;
                if (this.commitShop(c)) {
                    const a = this.actors.find(x => x.pet.id === pid);
                    if (a) a.pet = pet;
                    refreshVisible(); this.toast('GM：' + this.petDisplayName(pid) + ' 健康度已设为 20（生病中）');
                }
            }],
            ['触发死亡鬼魂演示', () => {
                const pid = activePetId();
                const pet = this.data.pets.find(p => p.id === pid && !p.dead);
                if (!pet) { this.toast('请先选中存活伙伴'); return; }
                this.closeGmPanel();
                this.open('home');
                this.triggerPetDeath(pet);
            }],
            ['复活全部伙伴', () => {
                const c = this.dailyCandidate();
                let revived = 0;
                c.pets = c.pets.map(p => {
                    if (!p.dead) return p;
                    revived++;
                    return { ...p, dead: false, health: 100, hunger: 85, clean: 85, energy: 90, joy: 85 };
                });
                if (this.commitShop(c)) {
                    c.pets.forEach(p => {
                        if (!this.actors.some(a => a.pet.id === p.id)) this.spawnPet(p);
                    });
                    refreshVisible(); this.toast(revived > 0 ? 'GM：已复活 ' + revived + ' 只伙伴并满血回归！' : 'GM：全部伙伴均健在');
                }
            }],
        ];

        actions.forEach(([title, run], idx) => {
            const col = idx % 2, row = Math.floor(idx / 2);
            const x = col === 0 ? -195 : 195;
            const y = 416 - row * 94;
            const btn = this.bagButton(card, title, x, y, 360, 74, run);
            btn.name = 'GM按钮-' + title;
        });

        const resetBtn = this.bagButton(card, '清空存档重置初始态', 0, -492, 460, 68, () => {
            const fresh = this.fresh();
            if (!this.commitShop(fresh)) return;
            this.actors.forEach(a => { if (isValid(a.node, true)) a.node.destroy(); });
            this.actors = [];
            this.data.pets.forEach(p => this.spawnPet(p));
            this.selected = 0; this.petSelected = false;
            this.closeGmPanel();
            this.open('home');
            this.renderHeader();
            this.toast('GM：已重置为初始庭院存档');
        });
        resetBtn.name = 'GM重置存档按钮';
        const rLbl = resetBtn.getChildByName('文字')?.getComponent(Label);
        if (rLbl) rLbl.color = this.statusColor(false);

        this.layoutGmPanel();
    }

    private scrollTap(node: Node, action: () => void) {
        let start: Vec2 | null = null;
        let moved = false;
        node.on(Node.EventType.TOUCH_START, (event: EventTouch) => {
            start = event.getUILocation().clone(); moved = false;
            this.blockedUntil = Date.now() + 350;
        }, this);
        node.on(Node.EventType.TOUCH_MOVE, (event: EventTouch) => {
            if (start && Vec2.distance(start, event.getUILocation()) > 12) moved = true;
        }, this);
        node.on(Node.EventType.TOUCH_CANCEL, () => { start = null; moved = true; }, this);
        node.on(Node.EventType.TOUCH_END, (event: EventTouch) => {
            this.blockedUntil = Date.now() + 350;
            const tap = start && !moved && Vec2.distance(start, event.getUILocation()) <= 12;
            start = null;
            if (tap) action();
        }, this);
    }

    private currencyIcon(parent: Node, currency: Currency, x: number, y: number, size: number) {
        const key = currency === 'gems' ? 'diamond-icon' : 'coin-icon';
        const aspect = currency === 'gems' ? 315 / 353 : 348 / 341;
        const w = aspect >= 1 ? size / aspect : size;
        const h = aspect >= 1 ? size : size * aspect;
        const node = this.uiNode(parent, '货币图标-' + currency, x, y, w, h);
        this.headerArt(node, key);
        return node;
    }

    private loadOutfitIcon(sprite: Sprite, id: string) {
        let loading = this.outfitIcons.get(id);
        if (!loading) {
            loading = new Promise<SpriteFrame | null>(resolve => {
                resources.load('art/outfits/' + id + '/spriteFrame', SpriteFrame, (error, frame) => {
                    if (!isValid(this, true)) { resolve(null); return; }
                    resolve(error || !frame ? null : frame);
                });
            });
            this.outfitIcons.set(id, loading);
        }
        void loading.then(frame => {
            if (frame && isValid(this, true) && isValid(sprite, true)) sprite.spriteFrame = frame;
        });
    }

    private pillBadge(parent: Node, text: string, x: number, y: number, w: number, h: number, bg: string, fg = C.white, font = 18) {
        const node = this.uiNode(parent, '标签-' + text, x, y, w, h);
        const g = node.addComponent(Graphics);
        g.fillColor = this.color(bg);
        g.roundRect(-w / 2, -h / 2, w, h, h / 2); g.fill();
        const label = this.text(node, text, 0, 0, w - 8, h - 2, font, fg);
        label.isBold = true; label.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
        return node;
    }

    private diamondBadge(parent: Node, amount: number, x: number, y: number, w: number, h: number, bg: string, fg = C.white, font = 17) {
        const node = this.uiNode(parent, '钻石标签-' + amount, x, y, w, h);
        const g = node.addComponent(Graphics);
        g.fillColor = this.color(bg);
        g.roundRect(-w / 2, -h / 2, w, h, h / 2); g.fill();
        this.currencyIcon(node, 'gems', -w / 2 + 19, 0, 22);
        const label = this.text(node, '+' + amount, 10, 0, w - 34, h - 2, font, fg);
        label.isBold = true; label.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
        return node;
    }

    private starTierBadge(parent: Node, star: number, x: number, y: number, size: number) {
        // 每 5 星进阶一阶图标：5★金星(star-1)、10★蓝星(star-2)、15★紫星(star-3)、20★粉星(star-4)、25★金冠(star-5)、30★羽翼皇冠(star-6)。
        // 整 5 星时仅显示一颗对应阶位星标；中间星级旁标注当前星数。
        const s = Math.max(1, Math.floor(star));
        const tier = Math.max(1, Math.min(6, Math.ceil(s / 5)));
        const aspect = tier === 6 ? 202 / 150 : tier === 5 ? 158 / 150 : 150 / 148;
        const iconW = Math.round(size * aspect);
        const showNum = s % 5 !== 0;
        const wrap = this.uiNode(parent, '星级图标-' + s, x, y, showNum ? iconW + 34 : iconW, size);
        this.albumArt(wrap, 'star-' + tier, showNum ? -14 : 0, 0, iconW, size, '星阶图标-' + tier);
        if (showNum) {
            const num = this.dailyText(wrap, String(s), iconW / 2 - 2, 0, 36, size, Math.max(16, Math.round(size * 0.56)));
            num.color = this.color('#D9781E');
        }
        return wrap;
    }

    public openProfile(petId: number, tab: 'overview' | 'star' | 'outfit' = 'overview') {
        if (!this.data.pets.some(p => p.id === petId)) {
            this.toast('尚未解锁该伙伴，去招募看看吧');
            this.open('recruit');
            return;
        }
        this.profilePetId = petId;
        this.profileTab = tab;
        this.open('profile');
    }

    public claimAlbumReward(petId: number): boolean {
        const breed = BREEDS[petId];
        if (!breed || !this.data.pets.some(p => p.id === petId)) {
            this.toast('请先解锁该伙伴'); return false;
        }
        if (this.data.albumClaimed[petId]) {
            this.toast('已领取过该伙伴的图鉴解锁奖励'); return false;
        }
        const reward = breed.unlockGems;
        if (this.data.gems > 100000000 - reward) {
            this.toast('钻石接近存储上限，暂时无法领取'); return false;
        }
        const candidate: Save = {
            ...this.dailyCandidate(),
            gems: this.data.gems + reward,
            albumClaimed: { ...this.data.albumClaimed, [petId]: true },
        };
        if (!this.commitShop(candidate)) return false;
        this.renderHeader();
        if (this.page === 'profile') this.refreshProfileInPlace();
        else if (this.page === 'album') this.renderAlbumGrid();
        this.showRewardGrantDialog('图鉴解锁奖励', [{ kind: 'gems', amount: reward }], `解锁「${breed.name}」图鉴专属奖励`);
        return true;
    }

    public upgradePetStar(petId: number): boolean {
        const pet = this.data.pets.find(p => p.id === petId);
        if (!pet) { this.toast('尚未解锁该伙伴'); return false; }
        const req = STAR_REQUIREMENTS[pet.star];
        if (!req || pet.star >= MAX_PET_STAR) { this.toast('已达到最高星级 ★5'); return false; }
        const totalCopies = this.data.recruit.copies[petId] || 1;
        const extraCopies = Math.max(0, totalCopies - 1);
        if (extraCopies < req.extraCopies) {
            this.toast('多余本体不足（需要 ' + req.extraCopies + ' 个，可前往招募获得）'); return false;
        }
        if (this.data.coins < req.coins) {
            this.showCoinDialog(); return false;
        }
        const nextStar = req.nextStar;
        const ownedOutfits = pet.ownedOutfits.slice();
        let crownUnlocked = false;
        if (nextStar >= 3 && !ownedOutfits.includes('gold_crown')) {
            ownedOutfits.push('gold_crown');
            crownUnlocked = true;
        }
        const nextPet: Pet = { ...pet, star: nextStar, ownedOutfits };
        const nextRecruit: RecruitState = {
            ...this.data.recruit,
            copies: { ...this.data.recruit.copies, [petId]: totalCopies - req.extraCopies },
        };
        const candidate: Save = {
            ...this.dailyCandidate(),
            coins: this.data.coins - req.coins,
            pets: this.data.pets.map(p => p.id === petId ? nextPet : p),
            recruit: nextRecruit,
        };
        if (!this.commitShop(candidate)) return false;
        const actor = this.actors.find(a => a.pet.id === petId);
        if (actor) { actor.pet = nextPet; actor.timer = -1.3; }
        this.renderHeader();
        if (this.page === 'profile') this.refreshProfileInPlace();
        this.toast(this.petDisplayName(petId) + ' 升至 ★' + nextStar + '！' + (crownUnlocked ? '并免费解锁【星光小皇冠】装扮！' : '照顾经验与寻宝收益已提升'));
        return true;
    }

    public renamePet(petId: number, rawName: string): boolean {
        const pet = this.data.pets.find(p => p.id === petId);
        if (!pet) return false;
        const clean = sanitizeNickname(rawName);
        if (!clean) { this.toast('请输入新名字（1~8个字）'); return false; }
        if (clean === this.petDisplayName(petId)) { this.toast('新名字和当前名字一样哦'); return false; }
        const used = pet.renameCount || 0;
        const cost = used === 0 ? 0 : 100;
        if (cost > 0 && this.data.gems < cost) {
            this.closeDialog();
            this.showGemDialog();
            return false;
        }
        const nextPet: Pet = { ...pet, nickname: clean, renameCount: used + 1 };
        const candidate: Save = {
            ...this.dailyCandidate(),
            gems: this.data.gems - cost,
            pets: this.data.pets.map(p => p.id === petId ? nextPet : p),
        };
        if (!this.commitShop(candidate)) return false;
        const actor = this.actors.find(a => a.pet.id === petId);
        if (actor) actor.pet = nextPet;
        this.renderHeader();
        if (this.page === 'profile') this.refreshProfileInPlace();
        else if (this.page === 'pet') this.renderPet();
        else if (this.page === 'album') this.renderAlbumGrid();
        this.toast(cost > 0 ? '已改名为「' + clean + '」（消耗 100 钻石）' : '首次免费改名为「' + clean + '」');
        return true;
    }

    public selectPetOutfit(petId: number, outfitId: OutfitId): boolean {
        const pet = this.data.pets.find(p => p.id === petId);
        const def = PET_OUTFITS.find(o => o.id === outfitId);
        if (!pet || !def) return false;
        let owned = pet.ownedOutfits.includes(outfitId) || (def.freeAtStar !== undefined && pet.star >= def.freeAtStar);
        let coins = this.data.coins, gems = this.data.gems;
        const ownedOutfits = pet.ownedOutfits.slice();
        const outInv = { ...(this.data.outfitInventory || {}) };
        let usedBag = false;
        if (!owned) {
            if ((outInv[outfitId] || 0) > 0) {
                outInv[outfitId] = outInv[outfitId] - 1;
                owned = true;
                usedBag = true;
            } else if (def.unlockMode === 'ad') {
                this.unlockOutfitByAd(outfitId, petId);
                return false;
            } else if (def.currency === 'coins') {
                if (coins < def.price) { this.showCoinDialog(); return false; }
                coins -= def.price;
                owned = true;
            } else {
                if (gems < def.price) { this.showGemDialog(); return false; }
                gems -= def.price;
                owned = true;
            }
        }
        if (owned && !ownedOutfits.includes(outfitId)) ownedOutfits.push(outfitId);
        const nextPet: Pet = { ...pet, outfit: outfitId, ownedOutfits };
        const candidate: Save = {
            ...this.dailyCandidate(),
            coins, gems, outfitInventory: outInv,
            pets: this.data.pets.map(p => p.id === petId ? nextPet : p),
        };
        if (!this.commitShop(candidate)) return false;
        void this.refreshPetAppearance(petId);
        this.renderHeader();
        if (this.page === 'profile') this.refreshProfileInPlace();
        this.toast(usedBag ? `使用背包库存为${this.petDisplayName(petId)}免费解锁「${def.name}」` : '已为' + this.petDisplayName(petId) + '换上「' + def.name + '」');
        return true;
    }

    public selectPetCoat(petId: number, coatId: CoatId): boolean {
        const pet = this.data.pets.find(p => p.id === petId);
        const def = PET_COATS.find(c => c.id === coatId);
        if (!pet || !def) return false;
        let owned = pet.ownedCoats.includes(coatId);
        let coins = this.data.coins, gems = this.data.gems;
        const ownedCoats = pet.ownedCoats.slice();
        const coatInv = { ...(this.data.coatInventory || {}) };
        let usedBag = false;
        if (!owned) {
            if ((coatInv[coatId] || 0) > 0) {
                coatInv[coatId] = coatInv[coatId] - 1;
                owned = true;
                usedBag = true;
            } else if (def.currency === 'coins') {
                if (coins < def.price) { this.showCoinDialog(); return false; }
                coins -= def.price;
                owned = true;
            } else {
                if (gems < def.price) { this.showGemDialog(); return false; }
                gems -= def.price;
                owned = true;
            }
            if (owned) ownedCoats.push(coatId);
        }
        const nextPet: Pet = { ...pet, coat: coatId, ownedCoats };
        const candidate: Save = {
            ...this.dailyCandidate(),
            coins, gems, coatInventory: coatInv,
            pets: this.data.pets.map(p => p.id === petId ? nextPet : p),
        };
        if (!this.commitShop(candidate)) return false;
        void this.refreshPetAppearance(petId);
        this.renderHeader();
        if (this.page === 'profile') this.refreshProfileInPlace();
        this.toast(usedBag ? `使用背包库存为${this.petDisplayName(petId)}免费解锁「${def.name}」` : '已换上皮肤「' + def.name + '」');
        return true;
    }

    private showRenameDialog(petId: number) {
        if (this.dialog) return;
        const pet = this.data.pets.find(p => p.id === petId);
        if (!pet) return;
        const isFree = (pet.renameCount || 0) === 0;
        let editBox: EditBox | null = null;
        this.showDialog('改名', '', [
            { title: '确认', run: () => {
                const val = editBox ? editBox.string : '';
                if (this.renamePet(petId, val)) this.closeDialog();
            } },
            { title: '取消', run: () => this.closeDialog() },
        ]);
        if (!this.dialog) return;
        const content = this.dialog.getChildByName('通用弹窗面板')?.getChildByName('弹窗安全内容');
        if (!content) return;
        const body = content.getChildByName('弹窗正文');
        if (body) body.active = false;

        // 顶部引导提示
        const tip = this.text(content, '请输入新的宠物名称（最多8个字）', 0, 102, 640, 34, 24, '#6E4627');
        tip.isBold = true; tip.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';

        // 原生 EditBox 单行输入框：先将节点置为 inactive 再挂载组件并配置 inputMode=SINGLE_LINE，
        // 避免 addComponent 立即触发 onLoad 按默认 InputMode.ANY 创建多行 <textarea> 且强行设为顶对齐。
        const boxNode = this.uiNode(content, '改名输入框', 0, 32, 540, 70);
        boxNode.active = false;
        const bg = boxNode.addComponent(Graphics);
        bg.fillColor = this.color('#FFFDF7'); bg.strokeColor = this.color('#B88652'); bg.lineWidth = 3.5;
        bg.roundRect(-270, -35, 540, 70, 18); bg.fill(); bg.stroke();

        const txtNode = this.uiNode(boxNode, 'TEXT_LABEL', -268, 35, 536, 70);
        txtNode.getComponent(UITransform)!.setAnchorPoint(0, 1);
        const txtLbl = txtNode.addComponent(Label);
        txtLbl.fontSize = 28; txtLbl.lineHeight = 36; txtLbl.color = this.color('#4E2F1A');
        txtLbl.horizontalAlign = Label.HorizontalAlign.CENTER;
        txtLbl.verticalAlign = Label.VerticalAlign.CENTER;
        txtLbl.overflow = Label.Overflow.CLAMP;
        txtLbl.enableWrapText = false;
        txtLbl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';

        const phNode = this.uiNode(boxNode, 'PLACEHOLDER_LABEL', -268, 35, 536, 70);
        phNode.getComponent(UITransform)!.setAnchorPoint(0, 1);
        const phLbl = phNode.addComponent(Label);
        phLbl.fontSize = 26; phLbl.lineHeight = 36; phLbl.color = this.color('#A99278');
        phLbl.horizontalAlign = Label.HorizontalAlign.CENTER;
        phLbl.verticalAlign = Label.VerticalAlign.CENTER;
        phLbl.overflow = Label.Overflow.CLAMP;
        phLbl.enableWrapText = false;
        phLbl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';

        editBox = boxNode.addComponent(EditBox);
        editBox.inputMode = EditBox.InputMode.SINGLE_LINE;
        editBox.returnType = EditBox.KeyboardReturnType.DONE;
        editBox.textLabel = txtLbl;
        editBox.placeholderLabel = phLbl;
        editBox.maxLength = 8;
        editBox.placeholder = '点击输入新名字（1~8字）';
        editBox.string = this.petDisplayName(petId);
        boxNode.active = true;

        // 费用说明行：未改过名显示「首次改名免费」，已改过名仅显示「本次改名消耗 [💎] 100」（拆分为独立节点避免图标与文字重叠）
        if (isFree) {
            const costLbl = this.text(content, '首次改名免费', 0, -34, 600, 34, 24, '#228B3C');
            costLbl.isBold = true; costLbl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
        } else {
            const costRow = this.uiNode(content, '改名费用提示行', 0, -34, 600, 36);
            const canAfford = this.data.gems >= 100;
            const col = canAfford ? '#228B3C' : '#C93832';
            const preLbl = this.text(costRow, '本次改名消耗', -56, 0, 170, 34, 24, col);
            preLbl.isBold = true; preLbl.horizontalAlign = Label.HorizontalAlign.RIGHT;
            preLbl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
            this.currencyIcon(costRow, 'gems', 48, 0, 28);
            const numLbl = this.text(costRow, '100', 100, 0, 72, 34, 24, col);
            numLbl.isBold = true; numLbl.horizontalAlign = Label.HorizontalAlign.LEFT;
            numLbl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
        }
    }

    private renderAlbum() {
        const panel = this.sheet!;
        // 全屏铺满图鉴底板（1080×1920，参考招募页无缝铺至底栏后方，不显示上方头像与货币栏）
        this.albumArt(panel, 'panel', 0, 0, 1080, 1920, '图鉴正式大底板');
        // 标题居中落在顶部猫耳黄色标题牌内（1536×2752 -> 1080×1920，标题牌中心 y=+823）
        this.dailyText(panel, '宠物图鉴', 0, 823, 440, 72, 48, false, true);
        const close = this.uiNode(panel, '收起图鉴', 462, 832, 104, 104);
        this.dailySprite(close, 'close', 0, 0, 92, 92, false, '关闭图标');
        this.shopButton(close, () => this.open('home'));

        // 顶部奶油横条内展示收集进度 + 待领解锁钻汇总（避开左侧手绘小猫爪印与右侧逗猫棒）
        const summaryRow = this.uiNode(panel, '图鉴收集统计行', 66, 660, 680, 44);
        const summary = this.dailyText(summaryRow, '', 0, 0, 680, 40, 25);
        summary.node.name = '图鉴收集统计';
        const summaryGem = this.currencyIcon(summaryRow, 'gems', 120, 0, 28);
        summaryGem.name = '图鉴汇总钻石图标';
        summaryGem.active = false;

        // 分类筛选页签：全部 / 猫咪 / 狗狗（位于内层奶油框顶部 y=+558）
        const tabs: [string, 'all' | Kind, string][] = [
            ['全部(' + BREEDS.length + ')', 'all', 'icon-all'],
            ['猫咪(' + BREEDS.filter(b => b.kind === 'cat').length + ')', 'cat', 'icon-cat'],
            ['狗狗(' + BREEDS.filter(b => b.kind === 'dog').length + ')', 'dog', 'icon-dog'],
        ];
        tabs.forEach(([title, filter, iconKey], i) => {
            const tab = this.uiNode(panel, '图鉴筛选-' + filter, -264 + i * 264, 558, 238, 60);
            this.albumArt(tab, this.albumFilter === filter ? 'tab-active' : 'tab-normal', 0, 0, 238, 60, '页签底图', false);
            this.albumArt(tab, iconKey, -72, 0, 36, 32, '页签图标-' + filter);
            const label = this.dailyText(tab, title, 18, 0, 150, 40, 24);
            label.node.name = '页签文字';
            this.intercept(tab); this.pressVisualFeedback(tab, tab.children.slice());
            tab.on(Node.EventType.TOUCH_END, () => {
                if (this.albumFilter === filter) return;
                this.albumFilter = filter;
                this.renderAlbumGrid();
            }, this);
        });

        // 内层圆角奶油区滚动网格（y=-490..+506，完整保留底部小猫简笔画、猫砂盆与主城底栏空间）
        const viewport = this.uiNode(panel, '图鉴可视窗口', 0, 8, 880, 996);
        viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        const content = this.uiNode(viewport, '图鉴滚动内容', 0, 498, 880, 996);
        content.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
        const scroll = viewport.addComponent(ScrollView);
        scroll.content = content; scroll.horizontal = false; scroll.vertical = true;
        scroll.cancelInnerEvents = true; scroll.elastic = false; scroll.inertia = false;

        this.renderAlbumGrid();
    }

    private loadPetPortrait(skinKey: string): Promise<SpriteFrame | null> {
        let loading = this.petPortraits.get(skinKey);
        if (!loading) {
            loading = new Promise<SpriteFrame | null>(resolve => {
                resources.load('pets/portraits/' + skinKey + '/spriteFrame', SpriteFrame, (error, frame) => {
                    if (!isValid(this, true)) { resolve(null); return; }
                    resolve(error || !frame ? null : frame);
                });
            });
            this.petPortraits.set(skinKey, loading);
        }
        return loading;
    }

    private petPortrait(parent: Node, id: number, x: number, y: number, size: number, locked = false) {
        const b = BREEDS[id];
        const n = this.uiNode(parent, '伙伴立绘-' + b.kind + '-' + id, x, y, size, size);
        const art = this.uiNode(n, '伙伴头像图', 0, 0, size, size);
        const sprite = art.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        if (locked) sprite.color = new Color(156, 162, 172, 255);
        void this.loadPetPortrait(b.skin).then(frame => {
            if (!isValid(n, true) || !isValid(sprite, true)) return;
            if (frame) sprite.spriteFrame = frame;
        });
        if (locked) {
            const lock = this.uiNode(n, '未解锁遮罩', size * 0.28, -size * 0.28, 42, 42);
            const lg = lock.addComponent(Graphics);
            lg.fillColor = new Color(68, 72, 82, 220);
            lg.circle(0, 0, 20); lg.fill();
            lg.strokeColor = this.color('#F5E6C8'); lg.lineWidth = 3;
            lg.arc(0, 4, 6.5, 0, Math.PI, false); lg.stroke();
            lg.fillColor = this.color('#F5C85B');
            lg.roundRect(-8.5, -10, 17, 13, 3.5); lg.fill();
            lg.fillColor = new Color(68, 72, 82, 255);
            lg.circle(0, -3.5, 2.3); lg.fill();
        }
        return n;
    }

    private renderAlbumGrid() {
        if (this.page !== 'album' || !this.sheet || !isValid(this.sheet, true)) return;
        const panel = this.sheet;
        const unclaimedGems = this.data.pets.reduce((sum, p) => sum + (this.data.albumClaimed[p.id] ? 0 : BREEDS[p.id].unlockGems), 0);
        const summaryRow = panel.getChildByName('图鉴收集统计行');
        const summary = summaryRow?.getChildByName('图鉴收集统计')?.getComponent(Label);
        const summaryGem = summaryRow?.getChildByName('图鉴汇总钻石图标');
        if (summary) {
            summary.string = unclaimedGems > 0
                ? '已收集 ' + this.data.pets.length + ' / ' + BREEDS.length + '  ·  可领奖励       +' + unclaimedGems
                : '已收集 ' + this.data.pets.length + ' / ' + BREEDS.length + '  ·  点击已解锁伙伴进入主页';
            summary.color = unclaimedGems > 0 ? this.statusColor(true) : this.color('#5B3E26');
        }
        if (summaryGem) {
            summaryGem.active = unclaimedGems > 0;
            summaryGem.setPosition(120, 0, 0);
        }
        (['all', 'cat', 'dog'] as const).forEach(filter => {
            const tabNode = panel.getChildByName('图鉴筛选-' + filter);
            const bgSprite = tabNode?.getChildByName('页签底图')?.getComponent(Sprite);
            if (bgSprite) this.updateShopSprite(bgSprite, 'art/album/' + (this.albumFilter === filter ? 'tab-active' : 'tab-normal'));
            const label = tabNode?.getChildByName('页签文字')?.getComponent(Label);
            if (label) label.color = this.color(this.albumFilter === filter ? '#49301E' : '#856547');
        });
        const viewport = panel.getChildByName('图鉴可视窗口');
        const content = viewport?.getChildByName('图鉴滚动内容');
        if (!content) return;
        content.children.slice().forEach(child => { child.active = false; child.removeFromParent(); child.destroy(); });

        const list = BREEDS.filter(b => this.albumFilter === 'all' || b.kind === this.albumFilter);
        // 参考竖版长条图鉴卡片（268×360）：上方稀有度底色框 + 全身立绘 + 全星级展示 + 可升星/领奖红点标签 + 底部白条名字
        const cols = 3, cardW = 268, cardH = 360, gapX = 20, gapY = 20;
        const rows = Math.max(1, Math.ceil(list.length / cols));
        const totalH = Math.max(996, rows * (cardH + gapY) + 16);
        content.getComponent(UITransform)!.setContentSize(880, totalH);
        viewport!.getComponent(ScrollView)!.scrollToTop(0);

        const rarityTint: Record<'R' | 'SR' | 'SSR', string> = { R: '#E0F1DB', SR: '#E0EBFC', SSR: '#FFF0C2' };

        list.forEach((b, idx) => {
            const col = idx % cols, row = Math.floor(idx / cols);
            const x = (col - 1) * (cardW + gapX);
            const y = -(cardH / 2 + 8 + row * (cardH + gapY));
            const pet = this.data.pets.find(p => p.id === b.id);
            const owned = !!pet;
            const rarity = RARITY_INFO[b.rarity];
            const canClaim = owned && !this.data.albumClaimed[b.id];
            const req = pet ? STAR_REQUIREMENTS[pet.star] : undefined;
            const extraCopies = Math.max(0, (this.data.recruit.copies[b.id] || 0) - 1);
            const canUpgrade = !!pet && !!req && extraCopies >= req.extraCopies && this.data.coins >= req.coins;

            const card = this.uiNode(content, '图鉴卡片-' + b.id, x, y, cardW, cardH);
            // 竖版圆角白底外框 + 深棕手绘描边
            const cg = card.addComponent(Graphics);
            cg.fillColor = this.color('#FFFDF8');
            cg.strokeColor = this.color(owned ? '#6E4226' : '#96938E');
            cg.lineWidth = 3.5;
            cg.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 22);
            cg.fill(); cg.stroke();
            // 上方稀有度柔和底色区（承载全身立绘与所有星级）
            cg.fillColor = this.color(owned ? rarityTint[b.rarity] : '#E2E5EB');
            cg.roundRect(-cardW / 2 + 12, -cardH / 2 + 66, cardW - 24, cardH - 78, 16);
            cg.fill();

            // 左上角：手绘立体稀有度徽章
            const badgeH = b.rarity === 'SSR' ? 62 : 56;
            this.albumArt(card, 'rarity-' + b.rarity.toLowerCase(), -92, 134, 54, badgeH, '稀有度徽章-' + b.rarity);

            // 右上角：待领图鉴钻显示醒目「领奖」提醒胶囊+红点（引导进主页领奖）；未解锁显示首获钻石
            if (canClaim) {
                const claimTag = this.uiNode(card, '图鉴领奖提醒-' + b.id, 72, 134, 96, 44);
                const tg = claimTag.addComponent(Graphics);
                tg.fillColor = this.color('#E55243'); tg.strokeColor = this.color('#FFFDF5'); tg.lineWidth = 2.5;
                tg.roundRect(-48, -22, 96, 44, 22); tg.fill(); tg.stroke();
                this.currencyIcon(claimTag, 'gems', -26, 0, 26);
                const tLbl = this.text(claimTag, '领奖', 16, 0, 56, 30, 20, '#FFFDF5');
                tLbl.isBold = true; tLbl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
                // 右上小红点
                tg.fillColor = this.color('#FF3B30'); tg.circle(42, 18, 8); tg.fill();
            } else if (!owned) {
                this.diamondBadge(card, b.unlockGems, 68, 138, 96, 28, '#8E8B86', '#FFF8EC', 15);
            }

            // 中央：全新手绘全身猫狗立绘（未解锁为清晰柔和灰雾+小锁）
            this.petPortrait(card, b.id, 0, 36, 186, !owned);

            // 立绘下方：完整展示当前阶位所有星级（1~5颗金/蓝/紫/粉星或皇冠，绝不省略！）
            if (owned && pet) {
                const tier = Math.max(1, Math.min(6, Math.ceil(pet.star / 5)));
                const litCount = ((pet.star - 1) % 5) + 1;
                const starAspect = tier === 6 ? 202 / 150 : tier === 5 ? 158 / 150 : 150 / 148;
                const starSize = 36;
                const starW = Math.round(starSize * starAspect);
                const step = Math.min(40, Math.round(starW + 4));
                const startX = -((litCount - 1) * step) / 2;
                const starRow = this.uiNode(card, '图鉴全星级行-' + b.id, 0, -82, 236, 42);
                for (let s = 0; s < litCount; s++) {
                    this.albumArt(starRow, 'star-' + tier, startX + s * step, 0, starW, starSize, '卡片星标-' + s);
                }
                // 可升星提醒标签 + 红点（位于星级右侧偏上，完全复刻参考图）
                if (canUpgrade) {
                    const upTag = this.uiNode(card, '图鉴可升星标签-' + b.id, 78, -42, 88, 32);
                    const ug = upTag.addComponent(Graphics);
                    ug.fillColor = this.color('#E55243'); ug.strokeColor = this.color('#FFFDF5'); ug.lineWidth = 2;
                    ug.roundRect(-44, -16, 88, 32, 16); ug.fill(); ug.stroke();
                    const uLbl = this.text(upTag, '可升星', 0, 0, 80, 26, 18, '#FFFDF5');
                    uLbl.isBold = true; uLbl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
                    ug.fillColor = this.color('#FF3B30'); ug.circle(40, 14, 7); ug.fill();
                }
            } else {
                const lockHint = this.text(card, '未解锁', 0, -82, 140, 28, 19, '#7A7E86');
                lockHint.isBold = true; lockHint.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
            }

            // 底部白条：居中展示清晰大号伙伴名称
            const nameLabel = this.text(card, owned ? this.petDisplayName(b.id) : b.name, 0, -146, 220, 38, 26, owned ? '#4E2F1A' : '#6A6762');
            nameLabel.isBold = true; nameLabel.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';

            this.pressVisualFeedback(card, card.children.slice());
            this.scrollTap(card, () => {
                if (owned) this.openProfile(b.id);
                else { this.toast(b.name + '（' + rarity.label + '）尚未解锁，快去招募遇见它吧'); this.open('recruit'); }
            });
        });
    }

    private renderProfile() {
        const panel = this.sheet!;
        const pet = this.data.pets.find(p => p.id === this.profilePetId);
        if (!pet) { this.open('album'); return; }
        // 全屏温馨宠物房间背景（1080×1920，猫爬架、木柜、发光爪印地毯、食盆、橙色背包）
        this.albumArt(panel, 'profile-bg', 0, 0, 1080, 1920, '宠物主页底板');

        // 中央发光地毯上的实时 3D 宠物展示舞台（扩大至 580×560 视野，确保巫师帽/光环/翅膀/披风全貌完整呈现）
        const stageBox = this.uiNode(panel, '宠物3D预览舞台', 0, 335, 580, 560);
        const stageView = this.uiNode(stageBox, '宠物3D预览画面', 0, 0, 560, 560);
        const stageSprite = stageView.addComponent(Sprite);
        stageSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        if (this.previewFrame) stageSprite.spriteFrame = this.previewFrame;
        this.intercept(stageBox);
        let dragLastX: number | null = null, dragged = false;
        stageBox.on(Node.EventType.TOUCH_START, (e: EventTouch) => { dragLastX = e.getUILocation().x; dragged = false; }, this);
        stageBox.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
            const x = e.getUILocation().x;
            if (dragLastX !== null && Math.abs(x - dragLastX) > 2) {
                this.previewDragYaw += (x - dragLastX) * 0.7;
                dragged = true;
            }
            dragLastX = x;
        }, this);
        stageBox.on(Node.EventType.TOUCH_END, () => {
            if (!dragged) this.previewHop = 0.55;
            dragLastX = null;
        }, this);
        stageBox.on(Node.EventType.TOUCH_CANCEL, () => { dragLastX = null; }, this);
        this.previewViewportNode = stageBox;

        // 动态 UI 层（顶栏、名称星级、右侧性格词条、宠物切换箭头、中间升星区、底部装扮衣帽间、底栏状态条）
        this.uiNode(panel, '主页动态层', 0, 0, 1080, 1920);
        this.previewDragYaw = -16;
        this.refreshProfileInPlace();
    }

    private refreshProfileInPlace() {
        if (this.page !== 'profile' || !this.sheet || !isValid(this.sheet, true)) return;
        const pet = this.data.pets.find(p => p.id === this.profilePetId);
        if (!pet) { this.open('album'); return; }
        const breed = BREEDS[pet.id];
        const rarity = RARITY_INFO[breed.rarity];
        const trait = PET_TRAITS[pet.trait];
        const claimed = !!this.data.albumClaimed[pet.id];
        void this.syncProfilePreview(pet.id);

        const layer = this.sheet.getChildByName('主页动态层')!;
        layer.children.slice().forEach(c => { c.active = false; c.removeFromParent(); c.destroy(); });

        const drawCard = (parent: Node, name: string, x: number, y: number, w: number, h: number, fill: string, stroke = '#6E4226', line = 4, r = 26) => {
            const n = this.uiNode(parent, name, x, y, w, h);
            const g = n.addComponent(Graphics);
            g.fillColor = this.color(fill); g.strokeColor = this.color(stroke); g.lineWidth = line;
            g.roundRect(-w / 2, -h / 2, w, h, r); g.fill();
            if (line > 0) g.stroke();
            return n;
        };

        // 1) 顶部栏：左上圆角黄底返回按钮 + 右上金币/钻石暗棕胶囊（对齐参考图顶部）
        const back = drawCard(layer, '返回图鉴按钮', -442, 862, 92, 92, '#FFD768', '#6E4226', 4, 24);
        const backLbl = this.dailyText(back, '‹', -2, 4, 60, 66, 56);
        backLbl.color = this.color('#5B3418');
        this.intercept(back); this.pressVisualFeedback(back);
        back.on(Node.EventType.TOUCH_END, () => this.open('album'), this);

        for (const [currency, px, val, openDlg] of [
            ['coins', 136, this.data.coins, () => this.showCoinDialog()],
            ['gems', 386, this.data.gems, () => this.showGemDialog()],
        ] as const) {
            const pill = drawCard(layer, '主页货币-' + currency, px, 862, 224, 64, '#6A462B', '#4D2E18', 3, 32);
            this.currencyIcon(pill, currency, -72, 0, 44);
            const num = this.text(pill, String(val), 22, 0, 146, 44, 30, '#FFF8E8');
            num.isBold = true; num.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
            this.intercept(pill); this.pressVisualFeedback(pill);
            pill.on(Node.EventType.TOUCH_END, openDlg, this);
        }

        // 2) 中上方：稀有度徽章 + 宠物名称胶囊 + 红色改名按钮 + 五星展示行（去掉原参考图左侧升星角标）
        const badgeH = breed.rarity === 'SSR' ? 68 : 60;
        this.albumArt(layer, 'rarity-' + breed.rarity.toLowerCase(), -224, 766, 58, badgeH, '主页稀有度徽章-' + breed.rarity);
        const namePill = drawCard(layer, '宠物名称胶囊', -6, 766, 336, 74, '#FFF6DC', '#B98C5A', 3, 37);
        const nameLbl = this.dailyText(namePill, this.petDisplayName(pet.id), 0, 0, 310, 52, 40);
        nameLbl.color = this.color('#4E2F1A');
        const renameBtn = drawCard(layer, '宠物改名按钮', 234, 766, 114, 54, '#E05744', '#7C2B1E', 3, 27);
        const renLbl = this.text(renameBtn, '改名', 0, 0, 96, 36, 26, '#FFFDF5');
        renLbl.isBold = true; renLbl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
        this.intercept(renameBtn); this.pressVisualFeedback(renameBtn);
        renameBtn.on(Node.EventType.TOUCH_END, () => this.showRenameDialog(pet.id), this);

        // 高清晰手绘星级展示条：5 槽手绘爪星/皇冠图标（空槽 star-empty，点亮槽按 5★一阶显示金/蓝/紫/粉星及金/羽翼皇冠）
        const curTier = Math.max(1, Math.min(6, Math.ceil(pet.star / 5)));
        const litCount = ((pet.star - 1) % 5) + 1;
        const starsPill = drawCard(layer, '宠物星级展示行', 0, 680, 412, 66, '#FFF7E2', '#B98C5A', 3, 33);
        const starAspect = curTier === 6 ? 202 / 150 : curTier === 5 ? 158 / 150 : 150 / 148;
        for (let s = 1; s <= 5; s++) {
            const sx = -152 + (s - 1) * 58;
            const filled = s <= litCount;
            const iconKey = filled ? ('star-' + curTier) : 'star-empty';
            const iconH = 48;
            const iconW = filled ? Math.round(iconH * starAspect) : 48;
            this.albumArt(starsPill, iconKey, sx, 0, iconW, iconH, '星级槽-' + s);
        }
        const starBadge = drawCard(starsPill, '星级数字标', 148, 0, 82, 40, '#F3A93A', '#6E4226', 2, 20);
        const sbLbl = this.text(starBadge, pet.star + '星', 0, 0, 74, 30, 22, '#FFFDF5');
        sbLbl.isBold = true; sbLbl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';

        // 左侧紧凑实用胶囊：设为头像 + 领解锁钻（不占中央地毯、无左侧升星大标）
        const avTitle = this.data.avatar === pet.id ? '当前头像 ✓' : '设为头像';
        const setAv = drawCard(layer, '设为头像按钮', -404, 650, 168, 46, this.data.avatar === pet.id ? '#E6F5E3' : '#FFF7E4', '#8B5E38', 2.5, 23);
        const avLbl = this.text(setAv, avTitle, 0, 0, 156, 30, 21, this.data.avatar === pet.id ? '#228B3C' : '#5E3A1E');
        avLbl.isBold = true; avLbl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
        this.intercept(setAv); this.pressVisualFeedback(setAv);
        setAv.on(Node.EventType.TOUCH_END, () => {
            if (this.data.avatar === pet.id) return;
            this.data.avatar = pet.id;
            if (this.persist()) { this.renderHeader(); this.refreshProfileInPlace(); this.toast('已换上' + this.petDisplayName(pet.id) + '的头像'); }
        }, this);

        if (!claimed) {
            const claimBtn = drawCard(layer, '领取图鉴解锁钻', -404, 586, 168, 48, '#E05744', '#7C2B1E', 2.5, 24);
            this.currencyIcon(claimBtn, 'gems', -50, 0, 26);
            const cLbl = this.text(claimBtn, '领 +' + breed.unlockGems, 20, 0, 108, 30, 20, '#FFFDF5');
            cLbl.isBold = true; cLbl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
            this.intercept(claimBtn); this.pressVisualFeedback(claimBtn);
            claimBtn.on(Node.EventType.TOUCH_END, () => this.claimAlbumReward(pet.id), this);
        }

        // 3) 右侧独立「性格词条」浮卡（严格保留参考图右侧性格卡，去掉右侧装扮卡）
        const traitCard = drawCard(layer, '性格词条浮卡', 392, 542, 206, 224, '#FFF9EA', '#6E4226', 4, 24);
        const traitHead = drawCard(traitCard, '性格词条卡头', 0, 82, 198, 52, '#F7CC6B', '#6E4226', 0, 20);
        const thLbl = this.dailyText(traitHead, '性格词条', 0, 0, 180, 36, 25);
        thLbl.color = this.color('#573218');
        this.pillBadge(traitCard, trait.name, 0, 22, 166, 40, trait.tagColor, '#FFFDF5', 22);
        const trSum = this.text(traitCard, trait.summary, 0, -48, 176, 86, 20, '#6A4426');
        trSum.enableWrapText = true; trSum.lineHeight = 27; trSum.isBold = true;
        trSum.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';

        // 4) 地毯下方宠物快捷切换条（◀ 宠物名 ▶，支持直接左右切已解锁伙伴）
        const ownedPets = this.data.pets;
        const curIdx = ownedPets.findIndex(p => p.id === pet.id);
        const switchRow = this.uiNode(layer, '宠物切换行', 0, 24, 440, 58);
        const switchName = this.dailyText(switchRow, this.petDisplayName(pet.id), 0, 0, 260, 46, 36);
        switchName.color = this.color('#4E2F1A');
        if (ownedPets.length > 1) {
            for (const [sym, dir, ax] of [['◀', -1, -168], ['▶', 1, 168]] as const) {
                const arr = drawCard(switchRow, dir < 0 ? '切换上一只' : '切换下一只', ax, 0, 54, 54, '#FFD15C', '#6E4226', 3, 16);
                const aLbl = this.text(arr, sym, 0, 2, 44, 42, 28, '#5B3418');
                aLbl.isBold = true;
                this.intercept(arr); this.pressVisualFeedback(arr);
                arr.on(Node.EventType.TOUCH_END, () => {
                    const nextPet = ownedPets[(curIdx + dir + ownedPets.length) % ownedPets.length];
                    this.profilePetId = nextPet.id;
                    this.refreshProfileInPlace();
                }, this);
            }
        }

        // 5) 中间大卡片：伙伴升星区（去掉“升级”字样，横向三栏：星级跃升 | 消耗材料 | 大号橙色升星按钮）
        const starCard = drawCard(layer, '升星区卡片', 0, -166, 984, 276, '#FFF9EA', '#6E4226', 5, 28);
        const starTag = drawCard(starCard, '升星区标题条', -308, 102, 276, 52, '#E99B48', '#6E4226', 3, 18);
        const stTitle = this.text(starTag, '伙伴升星区', 0, 0, 250, 36, 26, '#FFFDF5');
        stTitle.isBold = true; stTitle.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';

        const req = STAR_REQUIREMENTS[pet.star];
        const totalCopies = this.data.recruit.copies[pet.id] || 1;
        const extraCopies = Math.max(0, totalCopies - 1);
        const curXp = Math.round(starXpBonus(pet.star) * 100);
        const curAdv = Math.round(starAdventureBonus(pet.star) * 100);

        // 左栏：当前星级 -> 下一星级（配对应阶位手绘星标）+ 星级加成
        const lvPill = drawCard(starCard, '星级跃升条', -296, 20, 316, 62, '#FDECC2', '#DFB66E', 2, 18);
        if (req) {
            const nextTier = Math.max(1, Math.min(6, Math.ceil(req.nextStar / 5)));
            this.albumArt(lvPill, 'star-' + curTier, -118, 0, 36, 36, '当前阶星标');
            const lvLbl = this.dailyText(lvPill, pet.star + '星  ➔  ' + req.nextStar + '星', 0, 0, 194, 40, 27);
            lvLbl.color = this.color('#5B3418');
            this.albumArt(lvPill, 'star-' + nextTier, 118, 0, 36, 36, '下阶星标');
        } else {
            this.albumArt(lvPill, 'star-6', -92, 0, 44, 34, '满星阶星标');
            const lvLbl = this.dailyText(lvPill, '已满星 ' + MAX_PET_STAR + '星', 26, 0, 200, 40, 27);
            lvLbl.color = this.color('#D9781E');
        }

        const bonusPill = drawCard(starCard, '星级加成条', -296, -62, 316, 64, '#FDECC2', '#DFB66E', 2, 18);
        const bonusStr = req
            ? '经验 +' + curXp + '%→+' + Math.round(starXpBonus(req.nextStar) * 100) + '%  寻宝 +' + Math.round(starAdventureBonus(req.nextStar) * 100) + '%'
            : '照顾经验 +' + curXp + '% · 寻宝 +' + curAdv + '%';
        const bLbl = this.text(bonusPill, bonusStr, 0, 0, 298, 48, 19, '#5B3418');
        bLbl.isBold = true; bLbl.enableWrapText = true; bLbl.lineHeight = 23;
        bLbl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';

        // 中栏 + 右栏：消耗材料与大号橙色升星按钮
        const matBox = drawCard(starCard, '升星材料底框', 174, -14, 566, 206, '#FCECC8', '#E5C384', 2, 22);
        const matHead = this.text(matBox, req ? '消耗材料' : '伙伴已达最高星级', -154, 72, 240, 34, 24, '#5B3418');
        matHead.isBold = true; matHead.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
        if (req) {
            const copyOk = extraCopies >= req.extraCopies;
            const coinOk = this.data.coins >= req.coins;
            this.albumArt(matBox, 'icon-all', -222, 14, 42, 38, '本体爪印图标');
            const c1 = this.text(matBox, '本体 ' + extraCopies + ' / ' + req.extraCopies, -96, 14, 196, 36, 26, copyOk ? '#228B3C' : '#C93832');
            c1.isBold = true; c1.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
            this.currencyIcon(matBox, 'coins', -222, -48, 40);
            const c2 = this.text(matBox, '× ' + req.coins, -108, -48, 176, 36, 26, coinOk ? '#228B3C' : '#C93832');
            c2.isBold = true; c2.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';

            const tipText = req.nextStar === 3 ? '3★免费送星光皇冠' : (req.nextStar % 5 === 0 ? req.nextStar + '★进阶新星标！' : '经验与寻宝加成提升');
            const tip = this.text(matBox, tipText, 152, 62, 236, 30, 20, '#7B4F28');
            tip.isBold = true; tip.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';

            const upBtn = drawCard(matBox, '立即升星按钮', 152, -22, 212, 92, (copyOk && coinOk) ? '#F37A2D' : '#C99E76', '#6E3212', 4, 24);
            const upLbl = this.text(upBtn, '升星', 0, 0, 180, 48, 36, '#FFFDF5');
            upLbl.isBold = true; upLbl.outlineColor = this.color('#6E3212'); upLbl.outlineWidth = 2;
            upLbl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
            this.intercept(upBtn); this.pressVisualFeedback(upBtn);
            upBtn.on(Node.EventType.TOUCH_END, () => this.upgradePetStar(pet.id), this);
        } else {
            const maxNote = this.text(matBox, '★' + MAX_PET_STAR + ' 羽翼皇冠满阶，实力已达巅峰！', 0, -18, 520, 42, 25, '#228B3C');
            maxNote.isBold = true; maxNote.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
        }

        // 6) 下方大卡片：原第一张参考图的「互动区」按要求改为「装扮衣帽间」（横向滑动卡片 + 3D装扮 / 服装换肤双切）
        const wardCard = drawCard(layer, '装扮衣帽间卡片', 0, -504, 984, 344, '#FFF9EA', '#6E4226', 5, 28);
        const wardTag = drawCard(wardCard, '装扮区标题条', -308, 134, 276, 52, '#E99B48', '#6E4226', 3, 18);
        const wTitle = this.text(wardTag, '装扮衣帽间', 0, 0, 250, 36, 26, '#FFFDF5');
        wTitle.isBold = true; wTitle.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';

        // 装扮卡片右上双切页签：3D 装扮 | 服装换肤
        for (const [label, key, tx] of [['3D 装扮', 'outfit', 164], ['服装换肤', 'coat', 356]] as const) {
            const active = this.profileWardrobeTab === key;
            const subTab = drawCard(wardCard, '衣帽间切页-' + key, tx, 134, 174, 48, active ? '#FFD25A' : '#F3E3C2', '#6E4226', 3, 24);
            const tLbl = this.text(subTab, label, 0, 0, 158, 32, 22, active ? '#4E2F1A' : '#856547');
            tLbl.isBold = true; tLbl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
            this.intercept(subTab); this.pressVisualFeedback(subTab);
            subTab.on(Node.EventType.TOUCH_END, () => {
                if (this.profileWardrobeTab === key) return;
                this.profileWardrobeTab = key;
                this.refreshProfileInPlace();
            }, this);
        }

        // 横向可滑动装扮/皮肤卡片区
        const viewW = 928, viewH = 236;
        const viewport = this.uiNode(wardCard, '衣帽间可视窗口', 0, -24, viewW, viewH);
        viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        const strip = this.uiNode(viewport, '衣帽间滚动内容', -viewW / 2, 0, viewW, viewH);
        strip.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
        const wScroll = viewport.addComponent(ScrollView);
        wScroll.content = strip; wScroll.horizontal = true; wScroll.vertical = false;
        wScroll.cancelInnerEvents = true; wScroll.elastic = true; wScroll.inertia = true;

        const cardW = 212, cardH = 220, gap = 16, pad = 10;
        if (this.profileWardrobeTab === 'outfit') {
            const totalW = Math.max(viewW, pad * 2 + PET_OUTFITS.length * cardW + (PET_OUTFITS.length - 1) * gap);
            strip.getComponent(UITransform)!.setContentSize(totalW, viewH);
            PET_OUTFITS.forEach((o, i) => {
                const x = pad + cardW / 2 + i * (cardW + gap);
                const equipped = pet.outfit === o.id;
                const owned = pet.ownedOutfits.includes(o.id) || (o.freeAtStar !== undefined && pet.star >= o.freeAtStar);
                const tile = drawCard(strip, '装扮项-' + o.id, x, 0, cardW, cardH, equipped ? '#EAF7E6' : '#FFFDF6', equipped ? '#469A50' : '#7D5132', equipped ? 4 : 3, 22);
                const iconBg = drawCard(tile, '装扮图标底', 0, 32, 178, 120, '#FBEFD7', '#E8D0A8', 1.5, 16);
                const iconNode = this.uiNode(iconBg, '装扮图标-' + o.id, 0, 0, 96, 96);
                const iconSprite = iconNode.addComponent(Sprite); iconSprite.sizeMode = Sprite.SizeMode.CUSTOM;
                this.loadOutfitIcon(iconSprite, o.id);
                if (equipped) {
                    const chk = drawCard(tile, '已穿戴勾', 76, 82, 40, 40, '#469A50', '#FFFDF5', 3, 20);
                    const cTxt = this.text(chk, '✓', 0, 0, 34, 34, 24, '#FFFDF5');
                    cTxt.isBold = true;
                }
                const nm = this.text(tile, o.name, 0, -48, 196, 30, 22, '#4E2F1A');
                nm.isBold = true; nm.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
                const bagCnt = (this.data.outfitInventory || {})[o.id] || 0;
                if (equipped || owned) {
                    const stPill = drawCard(tile, '装扮状态条', 0, -84, 156, 34, equipped ? '#469A50' : '#85C47B', '#FFFFFF', 0, 17);
                    const st = this.text(stPill, equipped ? '穿戴中 ✓' : '已拥有', 0, 0, 146, 28, 19, '#FFFDF5');
                    st.isBold = true; st.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
                } else if (bagCnt > 0) {
                    const stPill = drawCard(tile, '装扮背包解锁条', 0, -84, 166, 34, '#3B9E5A', '#FFFFFF', 0, 17);
                    const st = this.text(stPill, `背包×${bagCnt} 解锁`, 0, 0, 156, 28, 18, '#FFFDF5');
                    st.isBold = true; st.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
                } else if (o.unlockMode === 'ad') {
                    const stPill = drawCard(tile, '装扮广告条', 0, -84, 166, 34, '#D94343', '#FFFFFF', 0, 17);
                    const st = this.text(stPill, '限定·看广告', 0, 0, 156, 28, 18, '#FFFDF5');
                    st.isBold = true; st.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
                } else {
                    const affordable = (o.currency === 'coins' ? this.data.coins : this.data.gems) >= o.price;
                    const stPill = drawCard(tile, '装扮价格条', 0, -84, 156, 34, '#F7DE9C', '#D1A452', 1.5, 17);
                    this.currencyIcon(stPill, o.currency, -36, 0, 24);
                    const st = this.text(stPill, String(o.price), 22, 0, 96, 28, 21, affordable ? '#228B3C' : '#C93832');
                    st.isBold = true; st.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
                }
                this.pressVisualFeedback(tile, tile.children.slice());
                this.scrollTap(tile, () => this.selectPetOutfit(pet.id, o.id));
            });
        } else {
            const totalW = Math.max(viewW, pad * 2 + PET_COATS.length * cardW + (PET_COATS.length - 1) * gap);
            strip.getComponent(UITransform)!.setContentSize(totalW, viewH);
            PET_COATS.forEach((c, i) => {
                const x = pad + cardW / 2 + i * (cardW + gap);
                const equipped = pet.coat === c.id;
                const owned = pet.ownedCoats.includes(c.id);
                const tile = drawCard(strip, '毛色项-' + c.id, x, 0, cardW, cardH, equipped ? '#EAF7E6' : '#FFFDF6', equipped ? '#469A50' : '#7D5132', equipped ? 4 : 3, 22);
                const iconBg = drawCard(tile, '皮肤图标底', 0, 32, 178, 120, '#FBEFD7', '#E8D0A8', 1.5, 16);
                const skinIcon = this.uiNode(iconBg, '皮肤图标-' + c.id, 0, 0, 92, 92).addComponent(Sprite);
                skinIcon.sizeMode = Sprite.SizeMode.CUSTOM;
                this.loadOutfitIcon(skinIcon, c.icon);
                if (equipped) {
                    const chk = drawCard(tile, '已穿戴勾', 76, 82, 40, 40, '#469A50', '#FFFDF5', 3, 20);
                    const cTxt = this.text(chk, '✓', 0, 0, 34, 34, 24, '#FFFDF5');
                    cTxt.isBold = true;
                }
                const nm = this.text(tile, c.name, 0, -48, 196, 30, 22, '#4E2F1A');
                nm.isBold = true; nm.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
                const bagCnt = (this.data.coatInventory || {})[c.id] || 0;
                if (equipped || owned) {
                    const stPill = drawCard(tile, '皮肤状态条', 0, -84, 156, 34, equipped ? '#469A50' : '#85C47B', '#FFFFFF', 0, 17);
                    const st = this.text(stPill, equipped ? '穿戴中 ✓' : '已拥有', 0, 0, 146, 28, 19, '#FFFDF5');
                    st.isBold = true; st.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
                } else if (bagCnt > 0) {
                    const stPill = drawCard(tile, '皮肤背包解锁条', 0, -84, 166, 34, '#3B9E5A', '#FFFFFF', 0, 17);
                    const st = this.text(stPill, `背包×${bagCnt} 解锁`, 0, 0, 156, 28, 18, '#FFFDF5');
                    st.isBold = true; st.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
                } else {
                    const affordable = (c.currency === 'coins' ? this.data.coins : this.data.gems) >= c.price;
                    const stPill = drawCard(tile, '皮肤价格条', 0, -84, 156, 34, '#F7DE9C', '#D1A452', 1.5, 17);
                    this.currencyIcon(stPill, c.currency, -36, 0, 24);
                    const st = this.text(stPill, String(c.price), 22, 0, 96, 28, 21, affordable ? '#228B3C' : '#C93832');
                    st.isBold = true; st.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
                }
                this.pressVisualFeedback(tile, tile.children.slice());
                this.scrollTap(tile, () => this.selectPetCoat(pet.id, c.id));
            });
        }
        wScroll.scrollToLeft(0);

        // 7) 最底部状态汇总与照顾快捷条（居中落在左下粉色食盆与右下橙色背包之间，呼应参考图底部条）
        const footBar = drawCard(layer, '底部状态条', 0, -764, 580, 82, '#FFF8E8', '#6E4226', 4, 28);
        const statText = pet.dead
            ? '该伙伴已离开庭院（可在GM面板复活）'
            : '饱腹 ' + Math.round(pet.hunger) + ' · 洁净 ' + Math.round(pet.clean) + ' · 体力 ' + Math.round(pet.energy) + ' · 心情 ' + Math.round(pet.joy) + ' · 健康 ' + Math.round(pet.health);
        const sLbl = this.text(footBar, statText, -74, 0, 410, 34, 18, pet.health < 30 || pet.dead ? '#C93832' : '#5E3A1E');
        sLbl.isBold = true; sLbl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
        const careBtn = drawCard(footBar, '主页前往照顾', 206, 0, 134, 52, '#FFD25A', '#6E4226', 3, 20);
        const cbLbl = this.text(careBtn, '去照顾 ›', 0, 0, 120, 32, 22, '#5B3418');
        cbLbl.isBold = true; cbLbl.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
        this.intercept(careBtn); this.pressVisualFeedback(careBtn);
        careBtn.on(Node.EventType.TOUCH_END, () => { this.selected = pet.id; this.open('pet'); }, this);
    }
    private shopArt(parent: Node, key: string, x: number, y: number, w: number, h: number) {
        const node = this.uiNode(parent, '商店素材-' + key, x, y, w, h);
        const sprite = node.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        resources.load('art/shop/' + key + '/spriteFrame', SpriteFrame, (error, frame) => {
            if (!error && frame && isValid(sprite, true)) sprite.spriteFrame = frame;
        });
        return node;
    }

    private shopButton(node: Node, action: () => void) {
        this.intercept(node);
        let base: Vec3 | null = null;
        const restore = () => { if (base) { node.setScale(base); base = null; } };
        node.on(Node.EventType.TOUCH_START, () => {
            if (!base) base = node.scale.clone();
            node.setScale(base.x * 0.94, base.y * 0.94, base.z);
        }, this);
        node.on(Node.EventType.TOUCH_CANCEL, restore, this);
        node.on(Node.EventType.TOUCH_END, () => { restore(); action(); }, this);
    }

    private shopClick(cooldownMs = 160): boolean {
        const now = performance.now();
        if (now - this.shopClickTime < cooldownMs) return false;
        this.shopClickTime = now;
        return true;
    }

    private refreshShop() {
        if (!this.shopClick(350)) return;
        const now = Date.now(), shop = this.advanceShop(this.data.shop, now), cost = this.shopRefreshCost(shop);
        if (this.data.gems < cost) { this.showGemDialog(); return; }
        if (shop.revision >= Number.MAX_SAFE_INTEGER - 1 || shop.paidUsed >= Number.MAX_SAFE_INTEGER - 1) {
            this.toast('商店计数已达上限，无法刷新'); return;
        }
        const candidate: Save = { ...this.data, gems: this.data.gems - cost, lastSeen: now,
            shop: { ...shop, freeUsed: shop.freeUsed + (cost === 0 ? 1 : 0), paidUsed: shop.paidUsed + (cost > 0 ? 1 : 0),
                revision: shop.revision + 1, slots: drawShopSlots(shop.slots) } };
        if (!this.commitShop(candidate)) return;
        this.updateShopCards(); this.renderHeader(); if (cost) this.showRewardToast([{ kind: 'gems', amount: -cost }], '消耗'); else this.toast('免费刷新成功');
    }

    private buyShopItem(id: string) {
        if (!this.shopClick(160)) return;
        const item = findItem(id);
        if (!item) return;
        const now = Date.now(), shop = this.advanceShop(this.data.shop, now);
        const slot = shop.slots.find(entry => entry.id === id);
        if (!slot || slot.remaining <= 0) { this.toast('本轮限购已售罄，请刷新补给'); return; }
        if (this.data[item.currency] < item.price) {
            if (item.currency === 'gems') this.showGemDialog(); else this.showCoinDialog();
            return;
        }
        const count = this.data.itemInventory[id] || 0;
        if (count >= 100000000) { this.toast('背包已经装满啦'); return; }
        if (shop.revision >= Number.MAX_SAFE_INTEGER - 1) { this.toast('商店计数已达上限，无法购买'); return; }
        const candidate: Save = { ...this.data, [item.currency]: this.data[item.currency] - item.price, lastSeen: now,
            itemInventory: { ...this.data.itemInventory, [id]: count + 1 },
            shop: { ...shop, revision: shop.revision + 1,
                slots: shop.slots.map(entry => entry.id === id ? { ...entry, remaining: entry.remaining - 1 } : entry) } };
        if (!this.commitShop(candidate)) return;
        this.updateShopLabels(); this.renderHeader(); this.toast('已购买' + item.name);
    }

    private statusColor(ready: boolean) {
        return this.color(ready ? '#268344' : '#C43D35');
    }

    private updateShopLabels() {
        if (this.page !== 'shop' || !this.sheet || !isValid(this.sheet, true)) return;
        const now = Date.now(), shop = this.advanceShop(this.data.shop, now), cost = this.shopRefreshCost(shop);
        const seconds = Math.max(0, Math.ceil(((shop.day + 1) * 86400000 - 8 * 3600000 - now) / 1000));
        const pad = (n: number) => ('0' + n).slice(-2);
        if (this.shopTimerLabel && isValid(this.shopTimerLabel, true)) {
            this.shopTimerLabel.string = Math.floor(seconds / 3600) + ':' + pad(Math.floor(seconds / 60) % 60) + ':' + pad(seconds % 60);
        }
        if (this.shopCostLabel && isValid(this.shopCostLabel, true)) {
            this.shopCostLabel.string = cost ? String(cost) : '免费刷新（' + (3 - shop.freeUsed) + '/3）';
            this.shopCostLabel.node.setPosition(cost ? -28 : 0, 0, 0);
            this.shopCostLabel.node.getComponent(UITransform)!.setContentSize(cost ? 112 : 268, 48);
        }
        if (this.shopCostIcon && isValid(this.shopCostIcon, true)) this.shopCostIcon.active = cost > 0;
        this.shopCards.forEach(card => {
            const slot = shop.slots.find(entry => entry.id === card.id);
            const remaining = slot?.remaining || 0;
            const owned = this.data.itemInventory[card.id] || 0;
            const item = findItem(card.id);
            const canBuy = !!item && remaining > 0 && this.data[item.currency] >= item.price;
            // 限购文字独立显示：可购买时绿色，无法购买（售罄或货币不足）时红色；与玩家持有数量分离，不再混用颜色。
            if (isValid(card.stock, true)) {
                card.stock.string = '限购 ' + remaining;
                card.stock.color = this.color(canBuy ? '#228B3C' : '#C93832');
            }
            if (isValid(card.owned, true)) {
                card.owned.string = '持有 ' + owned;
                card.owned.color = this.color('#6E533C');
            }
            if (item && isValid(card.price, true)) card.price.color = this.statusColor(canBuy);
        });
    }

    private updateShopSprite(sprite: Sprite, path: string) {
        const request = {};
        this.spriteRequests.set(sprite, request);
        // 保留上一张有效贴图直到新图就绪；过期请求不能覆盖新的 slot。
        resources.load(path + '/spriteFrame', SpriteFrame, (error, frame) => {
            if (!error && frame && isValid(sprite, true) && this.spriteRequests.get(sprite) === request) sprite.spriteFrame = frame;
        });
    }

    private updateShopCards() {
        if (this.page !== 'shop' || !this.sheet || !isValid(this.sheet, true)) return;
        this.shopCards.forEach((card, index) => {
            const item = findItem(this.data.shop.slots[index].id)!;
            if (card.id !== item.id) {
                const previous = findItem(card.id);
                card.id = item.id;
                card.title.string = item.name;
                card.species.string = this.speciesText(item);
                card.effect.string = effectText(item);
                card.price.string = String(item.price);
                card.icon.node.name = '道具图标-' + item.id;
                this.updateShopSprite(card.slotBg, 'art/ui/item-bg-' + this.itemQualityTheme(item));
                this.updateShopSprite(card.icon, 'art/items/' + item.id);
                if (!previous || previous.currency !== item.currency) {
                    const aspect = item.currency === 'coins' ? 348 / 341 : 315 / 353;
                    card.currency.node.getComponent(UITransform)!.setContentSize(38, 38 * aspect);
                    this.updateShopSprite(card.currency, 'art/header/' + (item.currency === 'coins' ? 'coin-icon' : 'diamond-icon'));
                }
            }
        });
        this.updateShopLabels();
    }

    private renderShop() {
        const panel = this.sheet!;
        this.shopCards = [];
        this.tombOwnedLabels.clear();
        // 全新宽敞手绘商店大底板（960×1260，内区奶油展柜宽 789×高 861，顶部空白木牌居中显示「商店」）
        this.shopArt(panel, 'stall', 0, 0, 960, 1260);
        const signTitle = this.headerText(panel, '商  店', 0, 428, 360, 62, 46);
        signTitle.node.name = '商店木牌标题';

        let tabItemsLbl!: Label;
        let tabOutfitsLbl!: Label;
        let tabTombLbl!: Label;
        const renderTabBody = () => {
            this.shopCards = [];
            this.tombOwnedLabels.clear();
            this.shopTimerLabel = null;
            this.shopCostLabel = null;
            this.shopCostIcon = null;
            const prevBody = panel.getChildByName('商店页签内容层');
            if (prevBody && isValid(prevBody, true)) { prevBody.removeFromParent(); prevBody.destroy(); }

            tabItemsLbl.color = this.color(this.shopTab === 'items' ? '#4E2C15' : '#8A6B4F');
            tabOutfitsLbl.color = this.color(this.shopTab === 'outfits' ? '#4E2C15' : '#8A6B4F');
            tabTombLbl.color = this.color(this.shopTab === 'tombstones' ? '#4E2C15' : '#8A6B4F');

            const body = this.uiNode(panel, '商店页签内容层', 0, 0, 960, 1260);
            const content = this.uiNode(body, '商店安全内容', 0, -165, 764, 830);

            if (this.shopTab === 'outfits') {
                this.renderShopOutfits(body, content);
                return;
            }
            if (this.shopTab === 'tombstones') {
                this.renderShopTombstones(body, content);
                return;
            }
            const goods = this.data.shop.slots.map(slot => findItem(slot.id)!);
            for (let i = 0; i < 6; i++) {
                const col = i % 3, row = Math.floor(i / 3);
                const card = this.shopArt(content, 'card', (col - 1) * 252, row === 0 ? 186 : -116, 240, 288);
                if (i >= goods.length) continue;
                const item = goods[i];
                const title = this.headerText(card, item.name, 0, 120, 224, 34, 26);
                title.lineHeight = 34; title.overflow = Label.Overflow.SHRINK; title.enableWrapText = false;
                const slotBox = this.uiNode(card, '商店道具品质槽', 0, 56, 98, 98);
                const slotBg = this.itemSlotBg(slotBox, this.itemQualityTheme(item), 98, 98, '商店道具底图').getComponent(Sprite)!;
                const icon = this.uiNode(slotBox, '道具图标-' + item.id, 0, 0, 86, 86).addComponent(Sprite);
                icon.sizeMode = Sprite.SizeMode.CUSTOM;
                const species = this.text(card, this.speciesText(item), 0, -4, 222, 26, 20, C.muted);
                species.lineHeight = 26; species.overflow = Label.Overflow.CLAMP;
                const effect = this.text(card, effectText(item), 0, -32, 224, 28, 21, C.ink);
                effect.isBold = true; effect.lineHeight = 28; effect.overflow = Label.Overflow.SHRINK; effect.enableWrapText = false;
                const stock = this.text(card, '', -52, -62, 110, 26, 21, '#228B3C');
                stock.node.name = '限购状态文字';
                stock.isBold = true; stock.lineHeight = 26; stock.overflow = Label.Overflow.CLAMP;
                const owned = this.text(card, '', 54, -62, 110, 26, 21, '#6E533C');
                owned.node.name = '持有数量文字';
                owned.isBold = true; owned.lineHeight = 26; owned.overflow = Label.Overflow.CLAMP;
                const buy = this.shopArt(card, 'buy', 0, -108, 172, 172 * 120 / 321);
                const price = this.headerText(buy, String(item.price), -24, 0, 98, 42, 32);
                price.lineHeight = 38; price.overflow = Label.Overflow.CLAMP;
                const currencyAspect = item.currency === 'coins' ? 348 / 341 : 315 / 353;
                const coin = this.uiNode(buy, '购买货币图标', 48, 0, 38, 38 * currencyAspect);
                const currency = coin.addComponent(Sprite); currency.sizeMode = Sprite.SizeMode.CUSTOM;
                const binding = { node: card, id: '', title, slotBg, icon, species, effect, stock, owned, price, currency };
                this.shopCards.push(binding);
                this.shopButton(buy, () => this.buyShopItem(binding.id));
            }
            const timer = this.shopArt(body, 'timer-panel', -194, -526, 330, 82);
            this.shopArt(timer, 'clock', -120, 0, 40, 47);
            this.shopTimerLabel = this.text(timer, '', 20, 0, 220, 46, 32, C.white);
            this.shopTimerLabel.isBold = true;
            const refresh = this.shopArt(body, 'buy', 202, -526, 270, 270 * 120 / 321);
            this.shopCostLabel = this.headerText(refresh, '', 0, 0, 250, 46, 29);
            this.shopCostIcon = this.uiNode(refresh, '刷新钻石图标', 58, 0, 42, 42 * 315 / 353);
            this.headerArt(this.shopCostIcon, 'diamond-icon');
            this.shopButton(refresh, () => this.refreshShop());
            this.updateShopCards();
        };

        const switchShopTab = (next: 'items' | 'outfits' | 'tombstones') => {
            if (this.shopTab === next) return;
            this.shopTab = next;
            // 原地切换页签内容层，不重建外框面板，彻底消除切页跳动
            renderTabBody();
        };
        const tabItems = this.shopArt(panel, 'tab', -254, 214, 178, 66);
        tabItems.name = '商店页签-道具';
        tabItemsLbl = this.headerText(tabItems, '道具', 0, 0, 144, 42, 28);
        this.shopButton(tabItems, () => switchShopTab('items'));

        const tabOutfits = this.shopArt(panel, 'tab', -64, 214, 178, 66);
        tabOutfits.name = '商店页签-装扮';
        tabOutfitsLbl = this.headerText(tabOutfits, '装扮', 0, 0, 144, 42, 28);
        this.shopButton(tabOutfits, () => switchShopTab('outfits'));

        const tabTomb = this.shopArt(panel, 'tab', 126, 214, 178, 66);
        tabTomb.name = '商店页签-墓碑';
        tabTombLbl = this.headerText(tabTomb, '墓碑', 0, 0, 144, 42, 28);
        this.shopButton(tabTomb, () => switchShopTab('tombstones'));

        const close = this.shopArt(panel, 'close', 392, 278, 82, 83);
        this.shopButton(close, () => this.open('home'));

        renderTabBody();
    }
    private speciesText(item: ItemDefinition) {
        return item.appliesTo === 'both' ? '猫狗通用' : item.appliesTo === 'cat' ? '猫咪专用' : '狗狗专用';
    }

    private itemIcon(parent: Node, id: string, x: number, y: number, size: number) {
        const image = this.uiNode(parent, '道具图标-' + id, x, y, size, size).addComponent(Sprite);
        image.sizeMode = Sprite.SizeMode.CUSTOM;
        resources.load('art/items/' + id + '/spriteFrame', SpriteFrame, (error, frame) => {
            if (!error && frame && isValid(image, true)) image.spriteFrame = frame;
        });
    }

    private bagArt(parent: Node, key: string, x: number, y: number, w: number, h: number) {
        const node = this.uiNode(parent, '背包素材-' + key, x, y, w, h);
        const sprite = node.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this.updateShopSprite(sprite, 'art/bag/' + key);
        return node;
    }

    private pressVisualFeedback(node: Node, visuals?: Node[]) {
        // 只缩放显示层，点击热区与布局节点不变；保留各素材九宫格自身缩放。
        let bases: { node: Node; scale: Vec3 }[] = [];
        const restore = () => {
            bases.forEach(entry => { if (isValid(entry.node, true)) entry.node.setScale(entry.scale); });
            bases = [];
        };
        node.on(Node.EventType.TOUCH_START, () => {
            if (bases.length) return;
            bases = (visuals ?? node.children).filter(n => isValid(n, true)).map(n => ({ node: n, scale: n.scale.clone() }));
            bases.forEach(entry => entry.node.setScale(entry.scale.x * 0.94, entry.scale.y * 0.94, entry.scale.z));
        }, this);
        node.on(Node.EventType.TOUCH_CANCEL, restore, this);
        node.on(Node.EventType.TOUCH_END, restore, this);
    }

    private bagButton(parent: Node, title: string, x: number, y: number, w: number, h: number, action: () => void) {
        const node = this.uiNode(parent, title, x, y, w, h);
        // 复用已确认的任务按钮九宫格，不再使用背包参考图裁出的临时按钮。
        this.dailySprite(node, 'button', 0, 0, w, h, true);
        this.dailyText(node, title, 0, 0, w - 18, h - 6, 24);
        this.intercept(node);
        this.pressVisualFeedback(node, node.children.slice());
        node.on(Node.EventType.TOUCH_END, action, this);
        return node;
    }

    private bagEntries() {
        return [
            ...ITEM_CATALOG.map(item => ({ item, count: this.data.itemInventory[item.id] || 0, legacy: null as ItemCategory | null })),
            ...(['food', 'soap', 'toy'] as ItemCategory[]).map(key => ({ item: this.legacyItem(key), count: this.data[key], legacy: key })),
        ].filter(entry => entry.count > 0 && (!this.bagFilter || entry.item.category === this.bagFilter) &&
            (!this.petSelected || itemApplies(entry.item, BREEDS[this.selected].kind)));
    }

    private updateBag() {
        if (this.page !== 'bag' || !this.sheet || !isValid(this.sheet, true)) return;
        const entries = this.bagEntries(), pages = Math.max(1, Math.ceil(entries.length / 6));
        this.bagPage = Math.max(0, Math.min(this.bagPage, pages - 1));
        if (this.bagPageLabel) this.bagPageLabel.string = (this.bagPage + 1) + ' / ' + pages;
        if (this.bagTargetLabel) {
            const pet = this.data.pets.find(p => p.id === this.selected);
            this.bagTargetLabel.string = this.petSelected && pet ? BREEDS[this.selected].name + ' · 饱腹' + Math.round(pet.hunger) + ' 洁净' + Math.round(pet.clean) + ' 体力' + Math.round(pet.energy) + ' 心情' + Math.round(pet.joy) : '请先选择伙伴 · 查看全部库存';
        }
        if (this.bagEmpty) this.bagEmpty.active = entries.length === 0;
        this.bagTabs.forEach(tab => tab.label.color = this.color(this.bagFilter === tab.category ? '#49301E' : '#94714F'));
        this.bagSlots.forEach((slot, index) => {
            const entry = entries[this.bagPage * 6 + index];
            slot.node.active = !!entry;
            if (!entry) { slot.entry = null; return; }
            const changed = slot.entry?.item.id !== entry.item.id;
            slot.entry = entry;
            slot.title.string = entry.item.name;
            slot.species.string = this.speciesText(entry.item);
            slot.effect.string = effectText(entry.item);
            slot.count.string = '持有 ×' + entry.count;
            slot.count.color = this.statusColor(entry.count > 0);
            const pet = this.data.pets.find(p => p.id === this.selected);
            const full = pet && (Object.keys(entry.item.effects) as PetStat[]).filter(stat => entry.item.effects[stat]! > 0).every(stat => pet[stat] >= 100);
            slot.use.string = !this.petSelected ? '先选伙伴' : full ? '状态已满' : '使用';
            if (changed) {
                const path = entry.legacy ? 'art/care/' + (entry.legacy === 'food' ? 'feed' : entry.legacy === 'soap' ? 'clean' : 'play') : 'art/items/' + entry.item.id;
                const theme: SlotBgTheme = entry.legacy ? 'general' : this.itemQualityTheme(entry.item);
                this.updateShopSprite(slot.slotBg, 'art/ui/item-bg-' + theme);
                this.updateShopSprite(slot.icon, path);
            }
        });
    }

    private renderBag() {
        const panel = this.sheet!;
        this.bagSlots = []; this.bagTabs = [];
        // 大底板直接复用任务页已清除内置行框的正式底图，只保留这一层。
        this.dailySprite(panel, 'panel-clean', 0, 0, 921, 1390, true, '背包任务大底板');
        // 标题与内容独立绘制。
        this.dailyText(panel, '我的背包', 0, 422, 370, 48, 38);
        const close = this.uiNode(panel, '收起背包', 380, 416, 84, 84);
        this.dailySprite(close, 'close', 0, 0, 78, 78);
        this.shopButton(close, () => this.open(this.petSelected ? 'pet' : 'home'));
        // 实际浅内区映射 x=-392.5..390.5、y=-659..341，内容不占顶部装饰。
        this.bagTargetLabel = this.dailyText(panel, '', 0, 302, 742, 40, 23);
        const filters: [string, ItemCategory | null][] = [['全部', null], ['喂养', 'food'], ['清洁', 'soap'], ['陪玩', 'toy'], ['治疗', 'medicine']];
        filters.forEach(([name, category], index) => {
            const tab = this.uiNode(panel, '背包分类-' + name, -304 + index * 152, 245, 142, 66);
            this.shopArt(tab, 'tab', 0, 0, 142, 66);
            const label = this.dailyText(tab, name, 0, 0, 126, 40, 24);
            this.bagTabs.push({ category, label });
            this.intercept(tab);
            this.pressVisualFeedback(tab, tab.children.slice());
            tab.on(Node.EventType.TOUCH_END, () => { this.bagFilter = category; this.bagPage = 0; this.updateBag(); }, this);
        });
        for (let i = 0; i < 6; i++) {
            const node = this.bagArt(panel, 'card', i % 2 ? 190 : -190, 98 - Math.floor(i / 2) * 244, 366, 230);
            node.name = '背包槽位-' + i;
            // 恢复原物品卡，本轮仅替换承载六格的大底板。
            const title = this.dailyText(node, '', 0, 76, 320, 33, 25);
            const slotBox = this.uiNode(node, '背包道具品质槽', -109, 12, 102, 102);
            const slotBg = this.itemSlotBg(slotBox, 'general', 102, 102, '背包道具底图').getComponent(Sprite)!;
            const iconNode = this.uiNode(slotBox, '背包道具图标', 0, 0, 82, 82);
            const icon = iconNode.addComponent(Sprite); icon.sizeMode = Sprite.SizeMode.CUSTOM;
            const species = this.dailyText(node, '', 43, 35, 210, 28, 20);
            const effect = this.dailyText(node, '', 43, -3, 210, 47, 19);
            effect.enableWrapText = true; effect.lineHeight = 22;
            const count = this.dailyText(node, '', -87, -62, 140, 30, 21);
            const binding = { node, entry: null, title, slotBg, icon, species, effect, count, use: null as unknown as Label } as typeof this.bagSlots[number];
            const use = this.bagButton(node, '使用', 76, -64, 140, 43, () => {
                if (binding.entry) this.applyCare(binding.entry.item, binding.entry.legacy);
            });
            binding.use = use.getChildByName('文字')!.getComponent(Label)!;
            this.bagSlots.push(binding);
        }
        this.bagEmpty = this.dailyText(panel, '暂无适用物资，可前往补给铺购买', 0, -50, 710, 70, 26).node;
        this.bagButton(panel, '上一页', -245, -540, 190, 58, () => { this.bagPage = Math.max(0, this.bagPage - 1); this.updateBag(); });
        this.bagPageLabel = this.dailyText(panel, '', 0, -540, 180, 40, 26);
        this.bagButton(panel, '下一页', 245, -540, 190, 58, () => { this.bagPage++; this.updateBag(); });
        this.bagButton(panel, '补充物资', -190, -608, 300, 64, () => this.open('shop'));
        this.bagButton(panel, this.petSelected ? '返回伙伴' : '选择伙伴', 190, -608, 300, 64, () => this.open(this.petSelected ? 'pet' : 'home'));
        this.updateBag();
    }
    private dailySprite(parent: Node, key: string, x: number, y: number, w: number, h: number, sliced = false, name = '每日任务底图') {
        const node = this.uiNode(parent, name, x, y, w, h);
        const sprite = node.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        if (sliced) sprite.type = Sprite.Type.SLICED;
        resources.load('art/daily/' + key + '/spriteFrame', SpriteFrame, (error, frame) => {
            if (error || !frame || !isValid(node, true)) return;
            sprite.spriteFrame = frame;
            if (sliced) {
                // 面板顶饰等比；任务行缩小厚边框并拉伸中心，为双行文字留出浅色内区。
                const scale = (key === 'panel' || key === 'panel-clean') ? w / frame.originalSize.width : (key === 'row' || key === 'row-clean') ? 0.24 : Math.min(1, h / frame.originalSize.height);
                node.getComponent(UITransform)!.setContentSize(w / scale, h / scale);
                node.setScale(scale, scale, 1);
            } else {
                const scale = Math.min(w / frame.originalSize.width, h / frame.originalSize.height);
                node.getComponent(UITransform)!.setContentSize(frame.originalSize.width * scale, frame.originalSize.height * scale);
            }
        });
        return node;
    }

    private dailyText(parent: Node, value: string, x: number, y: number, w: number, h: number, font = 28, left = false, bold = false): Label {
        const label = this.text(parent, value, x, y, w, h, font, '#49301E');
        label.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
        label.isBold = true; label.lineHeight = font + 6;
        label.horizontalAlign = left ? Label.HorizontalAlign.LEFT : Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.enableWrapText = false; label.overflow = Label.Overflow.CLAMP;
        label.enableOutline = true; label.outlineColor = this.color('#FFF3D5'); label.outlineWidth = 2;
        label.enableShadow = false;
        return label;
    }

    private dailyButton(parent: Node, title: string, x: number, y: number, w: number, h: number, action: () => void, font = 26) {
        const node = this.uiNode(parent, title, x, y, w, h);
        this.dailySprite(node, 'button', 0, 0, w, h, true);
        this.dailyText(node, title, 0, 0, w - 20, h - 10, font, false, true);
        this.pressVisualFeedback(node, node.children.slice());
        let start: Vec2 | null = null;
        let moved = false;
        node.on(Node.EventType.TOUCH_START, (event: EventTouch) => {
            start = event.getUILocation().clone(); moved = false;
            this.blockedUntil = Date.now() + 350;
        }, this);
        node.on(Node.EventType.TOUCH_MOVE, (event: EventTouch) => {
            if (start && Vec2.distance(start, event.getUILocation()) > 10) moved = true;
        }, this);
        node.on(Node.EventType.TOUCH_CANCEL, () => { start = null; moved = true; }, this);
        node.on(Node.EventType.TOUCH_END, (event: EventTouch) => {
            this.blockedUntil = Date.now() + 350;
            const tap = start && !moved && Vec2.distance(start, event.getUILocation()) <= 10;
            start = null;
            if (tap) action();
        }, this);
        return node;
    }

    private claimDaily(id: DailyTaskId | 'pack') {
        const candidate = this.dailyCandidate();
        if (id === 'pack') {
            if (candidate.daily.packClaimed) { this.updateDailyRows(candidate.daily); return; }
            if ((Object.keys(DAILY_PACK) as ItemCategory[]).some(key => candidate[key] > 100000000 - DAILY_PACK[key])) {
                this.toast('物资接近存储上限，暂时无法领取'); return;
            }
            candidate.daily.packClaimed = true;
            (Object.keys(DAILY_PACK) as ItemCategory[]).forEach(key => candidate[key] += DAILY_PACK[key]);
        } else {
            const task = DAILY_TASKS.find(task => task.id === id)!;
            if (candidate.daily.claimed[id] || candidate.daily.progress[id] < task.target) { this.updateDailyRows(candidate.daily); return; }
            if (candidate[task.currency] > 100000000 - task.amount) { this.toast('货币接近存储上限，暂时无法领取'); return; }
            candidate.daily.claimed[id] = true; candidate[task.currency] += task.amount;
        }
        if (!this.commitShop(candidate)) return;
        this.renderHeader(); this.updateDailyRows();
        if (id === 'pack') {
            this.showRewardGrantDialog('每日补给礼包', [
                { kind: 'care', careType: 'food', amount: DAILY_PACK.food },
                { kind: 'care', careType: 'soap', amount: DAILY_PACK.soap },
                { kind: 'care', careType: 'toy', amount: DAILY_PACK.toy },
            ], '每日免费庭院照顾补给已收下！');
        } else {
            const task = DAILY_TASKS.find(t => t.id === id)!;
            this.showRewardGrantDialog('每日任务奖励', [{ kind: task.currency, amount: task.amount }], `完成任务：${task.title}`);
        }
    }

    private watchDailyRewardedVideo(id: DailyTaskId) {
        if (this.rewardedVideoPending) { this.toast('广告播放中，请勿重复请求'); return; }
        const task = DAILY_TASKS.find(task => task.id === id)!;
        const daily = this.dailyCandidate().daily;
        if (daily.adClaimed[id] || daily.progress[id] < task.target) { this.updateDailyRows(daily); return; }
        const provider = this.rewardedVideoProvider;
        if (!provider) { this.toast('激励视频暂未接入'); return; }
        this.rewardedVideoPending = true;
        let settled = false;
        const finish = (result: RewardedVideoResult) => {
            if (settled) return;
            settled = true;
            this.rewardedVideoPending = false;
            if (!isValid(this, true)) return;
            if (result !== 'completed') {
                this.toast(result === 'cancelled' ? '未完整观看广告，仍可普通领取' : '广告播放失败，仍可普通领取');
                return;
            }
            const candidate = this.dailyCandidate();
            // 使用当前余额与权益，不让旧日回调或播放期间的普通领取重复发奖。
            if (candidate.daily.day !== daily.day || candidate.daily.adClaimed[id] || candidate.daily.progress[id] < task.target) {
                this.updateDailyRows(candidate.daily); return;
            }
            const amount = task.amount * (candidate.daily.claimed[id] ? 1 : 2);
            if (candidate[task.currency] > 100000000 - amount) { this.toast('货币接近存储上限，暂时无法领取'); return; }
            candidate[task.currency] += amount;
            candidate.daily.claimed[id] = true;
            candidate.daily.adClaimed[id] = true;
            if (!this.commitShop(candidate)) return;
            this.renderHeader(); this.updateDailyRows();
            this.showRewardGrantDialog('每日双倍奖励', [{ kind: task.currency, amount }], `完成任务「${task.title}」双倍领取！`);
        };
        try { provider.show(finish); } catch { finish('failed'); }
    }

    private goDaily(id: DailyTaskId) {
        if (id === 'adventure') { this.open('adventure'); return; }
        const kind = id === 'feedCat' ? 'cat' : id === 'feedDog' ? 'dog' : null;
        const pet = this.data.pets.find(p => (!kind || BREEDS[p.id].kind === kind) && p[id === 'clean' ? 'clean' : id === 'play' ? 'joy' : id === 'rest' ? 'energy' : 'hunger'] < 100)
            || this.data.pets.find(p => !kind || BREEDS[p.id].kind === kind);
        if (!pet) return;
        this.selected = pet.id; this.open('pet');
        if (id !== 'rest') { this.bagFilter = id === 'clean' ? 'soap' : id === 'play' ? 'toy' : 'food'; this.bagPage = 0; this.open('bag'); }
    }

    private renderDaily() {
        const panel = this.sheet!;
        const daily = this.dailyCandidate().daily;
        this.dailySprite(panel, 'panel-clean', 0, 0, 1024, 1400, true);
        // 1024×1400 九宫格缩放后木牌中心位于 y=382，文字完全居中不超框。
        this.dailyText(panel, '任务', 0, 382, 440, 58, 42, false, true);
        const close = this.uiNode(panel, '收起', 420, 390, 128, 128);
        this.dailySprite(close, 'close', 0, 0, 112, 112, false, '关闭图标');
        this.shopButton(close, () => this.open('home'));
        const countdown = this.dailyText(panel, '', -12, 280, 650, 36, 24);
        const updateCountdown = () => {
            if (!isValid(countdown, true)) { this.unschedule(updateCountdown); return; }
            const seconds = Math.max(0, Math.ceil(((this.shopDay(Date.now()) + 1) * 86400000 - 8 * 3600000 - Date.now()) / 1000));
            const pad = (n: number) => ('0' + n).slice(-2);
            countdown.string = pad(Math.floor(seconds / 3600)) + ':' + pad(Math.floor(seconds / 60) % 60) + ':' + pad(seconds % 60) + ' 后刷新（UTC+8）';
        };
        updateCountdown(); this.schedule(updateCountdown, 1);
        // 六行各占 110，高度包含行间距；第七行礼包完全位于遮罩之外。
        const viewport = this.uiNode(panel, '每日任务可视窗口', -12, -149, 740, 660);
        viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        const content = this.uiNode(viewport, '每日任务滚动内容', 0, 330, 740, 770);
        content.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
        const scroll = viewport.addComponent(ScrollView);
        scroll.content = content; scroll.horizontal = false; scroll.vertical = true;
        scroll.cancelInnerEvents = true; scroll.elastic = false; scroll.inertia = false;
        this.dailyScroll = scroll;
        this.scheduleOnce(() => {
            if (isValid(scroll, true)) scroll.scrollToOffset(new Vec2(0, this.dailyScrollOffset), 0);
        }, 0);
        DAILY_TASKS.forEach((task, index) => {
            const row = this.uiNode(content, '每日任务-' + task.id, 0, -55 - index * 110, 740, 102);
            this.dailySprite(row, 'row-clean', 0, 0, 740, 102, true);
            // 0.24 倍九宫格的浅色内区：x=-356..358、y=-31..42，文字均置于其中。
            this.dailySprite(row, task.id === 'feedCat' ? 'feed-cat' : task.id === 'feedDog' ? 'feed-dog' : task.id, -315, 6, 64, 64, false, '每日任务图标');
            this.dailyText(row, task.title, -173, 22, 180, 38, 26, true);
            const progress = this.dailyText(row, daily.progress[task.id] + '/' + task.target, -173, -14, 180, 32, 24, true);
            this.dailyText(row, String(task.amount), 0, 6, 64, 40, 26);
            const currency = this.uiNode(row, '奖励货币', 52, 6, 36, 36);
            const sprite = currency.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            resources.load('art/header/' + (task.currency === 'coins' ? 'coin-icon' : 'diamond-icon') + '/spriteFrame', SpriteFrame, (error, frame) => {
                if (error || !frame || !isValid(currency, true)) return;
                sprite.spriteFrame = frame;
                const scale = Math.min(36 / frame.originalSize.width, 36 / frame.originalSize.height);
                currency.getComponent(UITransform)!.setContentSize(frame.originalSize.width * scale, frame.originalSize.height * scale);
            });
            const button = this.dailyButton(row, '前往', 182, 6, 100, 68, () => {
                const state = this.dailyCandidate().daily;
                if (state.claimed[task.id]) return;
                if (state.progress[task.id] >= task.target) this.claimDaily(task.id);
                else this.goDaily(task.id);
            }, 22);
            const adButton = this.dailyButton(row, '广告双倍', 300, 6, 108, 68, () => this.watchDailyRewardedVideo(task.id), 20);
            const title = button.getChildByName('文字')!.getComponent(Label)!;
            const background = button.getChildByName('每日任务底图')!;
            const adTitle = adButton.getChildByName('文字')!.getComponent(Label)!;
            const adBackground = adButton.getChildByName('每日任务底图')!;
            this.dailyRows.set(task.id, state => {
                const claimed = state.claimed[task.id];
                const complete = state.progress[task.id] >= task.target;
                const text = claimed ? '已领取' : complete ? '领取' : '前往';
                progress.string = state.progress[task.id] + '/' + task.target;
                const ready = claimed || complete;
                progress.color = this.statusColor(ready);
                title.color = this.statusColor(ready);
                button.name = text; title.string = text; background.active = !claimed;
                adButton.active = complete;
                adButton.name = state.adClaimed[task.id] ? '已双倍' : '广告双倍';
                adTitle.string = adButton.name;
                adTitle.color = this.statusColor(state.adClaimed[task.id]);
                adBackground.active = !state.adClaimed[task.id];
            });
        });
        const pack = this.uiNode(content, '每日免费照顾包', 0, -715, 740, 102);
        this.dailySprite(pack, 'row-clean', 0, 0, 740, 102, true);
        this.dailySprite(pack, 'adventure', -315, 6, 64, 64, false, '每日礼包图标');
        this.dailyText(pack, '每日免费照顾包', -50, 22, 430, 38, 28, true);
        this.dailyText(pack, '食物×2  清洁×1  球×1', -50, -14, 430, 32, 24, true);
        const button = this.dailyButton(pack, '免费领取', 282, 6, 150, 68, () => this.claimDaily('pack'));
        const title = button.getChildByName('文字')!.getComponent(Label)!;
        const background = button.getChildByName('每日任务底图')!;
        this.dailyRows.set('pack', state => {
            button.name = state.packClaimed ? '已领取' : '免费领取';
            title.string = button.name; title.color = this.statusColor(true);
            background.active = !state.packClaimed;
        });
        this.updateDailyRows(daily);
        this.dailyText(panel, '上下滑动查看免费补给 · 完成后手动领奖', -12, -530, 680, 36, 24);
    }

    private adventureAction() {
        const candidate = this.dailyCandidate();
        if (!candidate.adventureEnd) {
            const alivePets = candidate.pets.filter(p => !p.dead);
            if (!alivePets.length) { this.toast('庭院里目前没有可出行的伙伴'); return; }
            if (alivePets.every(p => p.hunger < 20)) { this.toast('伙伴饱腹度低于 20，请先喂饱后再外出冒险！'); return; }
            candidate.adventureEnd = Date.now() + 60000;
            if (!this.commitShop(candidate)) return;
            this.open('adventure'); this.toast('寻宝出发，60 秒后带回礼物'); return;
        }
        if (Date.now() < candidate.adventureEnd) { this.toast('伙伴正在路上，稍后再来看看'); return; }
        const lead = candidate.pets.find(p => p.id === this.selected) || candidate.pets[0];
        const trait = lead ? PET_TRAITS[lead.trait] : null;
        const starMult = lead ? 1 + starAdventureBonus(lead.star) : 1;
        let coinGain = Math.round(80 * starMult * (trait?.adventureCoinMult ?? 1));
        let gemGain = Math.round(8 * starMult);
        let note = '';
        let bonusItemName = '';
        if (trait?.adventureBonusChance && Math.random() < trait.adventureBonusChance) {
            coinGain += 40; gemGain += 6;
            note = '（' + trait.name + '大丰收！）';
        } else if (trait?.adventureRiskChance && Math.random() < trait.adventureRiskChance && lead) {
            coinGain = Math.max(40, coinGain - 15);
            candidate.pets = candidate.pets.map(p => p.id === lead.id ? { ...p, energy: Math.max(0, p.energy - 10) } : p);
            note = '（' + trait.name + '小遇险，体力-10）';
        }
        if (trait?.adventureItemChance && Math.random() < trait.adventureItemChance && ITEM_CATALOG.length) {
            const gift = ITEM_CATALOG[Math.floor(Math.random() * ITEM_CATALOG.length)];
            const inv = { ...candidate.itemInventory };
            inv[gift.id] = Math.min(100000000, (inv[gift.id] || 0) + 1);
            candidate.itemInventory = inv;
            bonusItemName = gift.name;
        }
        const xp = Math.min(100000000, candidate.xp + 25);
        const levels = Math.floor(xp / 100) - Math.floor(candidate.xp / 100);
        candidate.adventureEnd = 0; candidate.xp = xp;
        candidate.coins = Math.min(100000000, candidate.coins + coinGain + levels * 60);
        candidate.gems = Math.min(100000000, candidate.gems + gemGain + levels * 12);
        recordDaily(candidate.daily, 'adventure');
        if (!this.commitShop(candidate)) return;
        this.renderHeader(); this.open('adventure');
        this.toast('寻宝成功' + note + '！金币 +' + coinGain + '，钻石 +' + gemGain + '，经验 +25' + (bonusItemName ? '，带回【' + bonusItemName + '】×1' : ''));
    }

    /** 商店「装扮」页签：纯售卖展柜（不绑定特定宠物），买进背包后在任意宠物主页直接点选解锁免重复购买；含 3 款限定广告效果装扮 */
    private renderShopOutfits(_body: Node, content: Node) {
        const tip = this.text(content, '购买或看广告解锁装扮后存入背包，前往任意伙伴主页即可免费点选穿戴', 0, 326, 740, 28, 19, '#6E4B2F');
        tip.isBold = true; tip.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';

        const vp = this.uiNode(content, '装扮商品滚动视口', 0, -34, 760, 684);
        vp.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        const outfitList = PET_OUTFITS.filter(o => o.id !== 'none');
        const coatList = PET_COATS.filter(c => c.id !== 'original');
        type ShopOutfitEntry =
            | { kind: 'outfit'; id: OutfitId; name: string; icon: string; price: number; currency: Currency; unlockMode?: 'buy' | 'ad'; limited?: boolean; effectTag?: string; theme: SlotBgTheme }
            | { kind: 'coat'; id: CoatId; name: string; icon: string; price: number; currency: Currency; unlockMode?: 'buy' | 'ad'; limited?: boolean; effectTag?: string; theme: SlotBgTheme };
        const entries: ShopOutfitEntry[] = [
            ...outfitList.map(o => ({
                kind: 'outfit' as const, id: o.id, name: o.name, icon: o.id, price: o.price, currency: o.currency,
                unlockMode: o.unlockMode, limited: o.limited, effectTag: o.effectTag,
                theme: (o.limited ? 'rainbow' : o.id === 'wizard_hat' || o.freeAtStar ? 'coin' : o.currency === 'gems' ? 'epic' : o.price >= 240 ? 'gem' : 'heal') as SlotBgTheme,
            })),
            ...coatList.map(c => ({
                kind: 'coat' as const, id: c.id, name: c.name, icon: c.icon, price: c.price, currency: c.currency,
                theme: (c.price >= 200 ? 'gem' : c.price >= 150 ? 'heal' : 'general') as SlotBgTheme,
            })),
        ];

        const rows = Math.ceil(entries.length / 3);
        const cardW = 240, cardH = 316, gapX = 12, gapY = 12;
        const totalH = Math.max(684, rows * (cardH + gapY) + 24);
        const grid = this.uiNode(vp, '装扮商品网格', 0, 342, 760, totalH);
        grid.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
        const scroll = vp.addComponent(ScrollView);
        scroll.content = grid; scroll.horizontal = false; scroll.vertical = true;
        scroll.cancelInnerEvents = true; scroll.elastic = true;

        const updaters: Array<() => void> = [];
        const refreshAll = () => updaters.forEach(fn => fn());

        entries.forEach((entry, idx) => {
            const col = idx % 3, row = Math.floor(idx / 3);
            const x = (col - 1) * (cardW + gapX);
            const y = -12 - cardH / 2 - row * (cardH + gapY);

            const card = this.shopArt(grid, 'card', x, y, cardW, cardH);
            card.name = '装扮商品卡-' + entry.id;
            const title = this.headerText(card, entry.name, 0, 128, 224, 30, 22);
            title.overflow = Label.Overflow.SHRINK; title.enableWrapText = false;

            const slotBox = this.uiNode(card, '装扮图标槽', 0, 52, 114, 114);
            this.itemSlotBg(slotBox, entry.theme, 114, 114, '装扮槽底图');
            const sp = this.uiNode(slotBox, '装扮商品图标', 0, 2, 90, 90).addComponent(Sprite);
            sp.sizeMode = Sprite.SizeMode.CUSTOM;
            this.loadOutfitIcon(sp, entry.icon);

            if (entry.limited) {
                this.pillBadge(card, '限定', 76, 98, 62, 24, '#D94343', C.white, 15);
            }

            // 效果词条（如有）或品类说明
            const effLbl = this.text(card, entry.effectTag || (entry.kind === 'coat' ? '3D 服装换肤' : '3D 时尚配饰'), 0, -24, 220, 24, 17, entry.effectTag ? '#B85A18' : '#8A6D52');
            effLbl.isBold = !!entry.effectTag; effLbl.overflow = Label.Overflow.SHRINK; effLbl.enableWrapText = false;

            const ownedLbl = this.text(card, '', 0, -52, 210, 24, 18, '#6E533C');
            ownedLbl.isBold = true;

            const buyBtn = this.shopArt(card, 'buy', 0, -108, 190, 66);
            buyBtn.name = entry.unlockMode === 'ad' ? '装扮广告按钮-' + entry.id : '装扮购买按钮-' + entry.id;
            if (entry.unlockMode === 'ad') {
                this.headerText(buyBtn, '看广告解锁', 0, 0, 176, 36, 22);
                this.shopButton(buyBtn, () => this.unlockOutfitByAd(entry.id as OutfitId, undefined, refreshAll));
            } else {
                this.addPriceTag(buyBtn, entry.currency, entry.price, 8, 0, 30, '#FFFFFF');
                this.shopButton(buyBtn, () => {
                    const ok = entry.kind === 'outfit'
                        ? this.buyOutfitToBag(entry.id)
                        : this.buyCoatToBag(entry.id);
                    if (ok) refreshAll();
                });
            }

            updaters.push(() => {
                const cnt = entry.kind === 'outfit'
                    ? ((this.data.outfitInventory || {})[entry.id] || 0)
                    : ((this.data.coatInventory || {})[entry.id] || 0);
                ownedLbl.string = '背包已存 ×' + cnt;
                ownedLbl.color = this.color(cnt > 0 ? '#228B3C' : '#6E533C');
            });
        });
        refreshAll();
    }

    public buyOutfitToBag(id: OutfitId): boolean {
        const def = PET_OUTFITS.find(o => o.id === id);
        if (!def || def.id === 'none' || def.unlockMode === 'ad') return false;
        if (def.currency === 'coins' && this.data.coins < def.price) { this.showCoinDialog(); return false; }
        if (def.currency === 'gems' && this.data.gems < def.price) { this.showGemDialog(); return false; }
        const c = this.dailyCandidate();
        if (def.currency === 'coins') c.coins -= def.price; else c.gems -= def.price;
        c.outfitInventory = { ...(c.outfitInventory || {}), [id]: ((c.outfitInventory || {})[id] || 0) + 1 };
        if (!this.commitShop(c)) return false;
        this.renderHeader();
        if (def.price > 0) this.showRewardToast([{ kind: def.currency, amount: -def.price }], '消耗');
        this.toast('已购入「' + def.name + '」存入背包，可在任意伙伴主页免费解锁穿戴');
        return true;
    }

    public buyCoatToBag(id: CoatId): boolean {
        const def = PET_COATS.find(co => co.id === id);
        if (!def || def.id === 'original') return false;
        if (def.currency === 'coins' && this.data.coins < def.price) { this.showCoinDialog(); return false; }
        if (def.currency === 'gems' && this.data.gems < def.price) { this.showGemDialog(); return false; }
        const c = this.dailyCandidate();
        if (def.currency === 'coins') c.coins -= def.price; else c.gems -= def.price;
        c.coatInventory = { ...(c.coatInventory || {}), [id]: ((c.coatInventory || {})[id] || 0) + 1 };
        if (!this.commitShop(c)) return false;
        this.renderHeader();
        if (def.price > 0) this.showRewardToast([{ kind: def.currency, amount: -def.price }], '消耗');
        this.toast('已购入「' + def.name + '」存入背包，可在任意伙伴主页免费解锁穿戴');
        return true;
    }

    public unlockOutfitByAd(id: OutfitId, equipPetId?: number, onDone?: () => void) {
        const def = PET_OUTFITS.find(o => o.id === id);
        if (!def || def.unlockMode !== 'ad') return;
        this.requestRewardedAd(() => {
            const c = this.dailyCandidate();
            if (equipPetId !== undefined) {
                const pet = c.pets.find(p => p.id === equipPetId);
                if (pet) {
                    const ownedOutfits = pet.ownedOutfits.includes(id) ? pet.ownedOutfits : [...pet.ownedOutfits, id];
                    c.pets = c.pets.map(p => p.id === equipPetId ? { ...p, outfit: id, ownedOutfits } : p);
                }
            } else {
                c.outfitInventory = { ...(c.outfitInventory || {}), [id]: ((c.outfitInventory || {})[id] || 0) + 1 };
            }
            if (!this.commitShop(c)) return;
            if (equipPetId !== undefined) void this.refreshPetAppearance(equipPetId);
            this.renderHeader();
            if (this.page === 'profile') this.refreshProfileInPlace();
            onDone?.();
            this.toast('限定装扮解锁成功！已获得「' + def.name + '」');
        }, '暂未解锁限定装扮');
    }

    private renderShopTombstones(panel: Node, content: Node) {
        this.tombOwnedLabels.clear();
        const tip = this.text(content, '购买或看广告解锁限定纪念碑，在「后院纪念角」立碑刻字', 0, 324, 740, 30, 20, '#6E4B2F');
        tip.isBold = true; tip.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
        const inv = this.data.tombstoneInventory || {};

        // 3列可滚动展柜：宽敞展示全部 9 款高质感手绘纪念碑，与底部按钮完全分离零遮挡
        const vp = this.uiNode(content, '墓碑商品滚动视口', 0, -2, 760, 616);
        vp.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        const rows = Math.ceil(TOMBSTONE_CATALOG.length / 3);
        const cardW = 240, cardH = 304, gapX = 12, gapY = 12;
        const totalH = Math.max(616, rows * (cardH + gapY) + 24);
        const grid = this.uiNode(vp, '墓碑商品网格', 0, 308, 760, totalH);
        grid.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
        const scroll = vp.addComponent(ScrollView);
        scroll.content = grid; scroll.horizontal = false; scroll.vertical = true;
        scroll.cancelInnerEvents = true; scroll.elastic = true;

        TOMBSTONE_CATALOG.forEach((tomb, idx) => {
            const col = idx % 3, row = Math.floor(idx / 3);
            const x = (col - 1) * (cardW + gapX);
            const y = -12 - cardH / 2 - row * (cardH + gapY);

            const card = this.shopArt(grid, 'card', x, y, cardW, cardH);
            card.name = '墓碑商品卡-' + tomb.id;
            const title = this.headerText(card, tomb.name, 0, 124, 224, 30, 21);
            title.overflow = Label.Overflow.SHRINK; title.enableWrapText = false;

            // 通用品质底框 + 清晰墓碑图标
            const slotBox = this.uiNode(card, '墓碑图标槽', 0, 42, 126, 126);
            this.itemSlotBg(slotBox, tomb.slotTheme, 126, 126, '墓碑槽底图');
            const icon = this.uiNode(slotBox, '墓碑图标', 0, 2, 100, 100).addComponent(Sprite);
            icon.sizeMode = Sprite.SizeMode.CUSTOM;
            resources.load('art/memorial/' + tomb.artKey + '/spriteFrame', SpriteFrame, (e, f) => {
                if (!e && f && isValid(icon, true)) icon.spriteFrame = f;
            });

            if (tomb.limited) {
                this.pillBadge(card, '限定', 76, 94, 62, 26, '#D94343', C.white, 16);
            }

            const owned = inv[tomb.id] || 0;
            const ownLbl = this.text(card, '已拥有 ×' + owned, 0, -40, 200, 26, 19, owned > 0 ? '#228B3C' : '#6E533C');
            ownLbl.isBold = true;
            this.tombOwnedLabels.set(tomb.id, ownLbl);

            const buy = this.shopArt(card, 'buy', 0, -102, 190, 68);
            buy.name = tomb.unlockMode === 'ad' ? '墓碑广告按钮-' + tomb.id : '墓碑购买按钮-' + tomb.id;
            if (tomb.unlockMode === 'ad') {
                this.headerText(buy, '看广告解锁', 0, 0, 176, 36, 22);
                this.shopButton(buy, () => this.unlockTombstoneByAd(tomb.id));
            } else {
                this.addPriceTag(buy, 'gems', tomb.priceGems, 8, 0, 30, '#FFFFFF');
                this.shopButton(buy, () => this.buyTombstone(tomb.id));
            }
        });

        const goMem = this.shopArt(panel, 'buy', 0, -534, 340, 340 * 120 / 321);
        goMem.name = '商店进纪念角按钮';
        this.headerText(goMem, '前往后院纪念角 ›', 0, 0, 310, 44, 26);
        this.shopButton(goMem, () => this.open('memorial'));
    }

    private refreshTombstoneOwnedLabel(id: TombstoneId) {
        const lbl = this.tombOwnedLabels.get(id);
        if (!lbl || !isValid(lbl, true)) return;
        const owned = (this.data.tombstoneInventory || {})[id] || 0;
        lbl.string = '已拥有 ×' + owned;
        lbl.color = this.color(owned > 0 ? '#228B3C' : '#6E533C');
    }

    public unlockTombstoneByAd(id: TombstoneId) {
        const tomb = findTombstone(id);
        if (!tomb || tomb.unlockMode !== 'ad') return;
        this.requestRewardedAd(() => {
            const c = this.dailyCandidate();
            c.tombstoneInventory = { ...(c.tombstoneInventory || {}), [id]: ((c.tombstoneInventory || {})[id] || 0) + 1 };
            if (!this.commitShop(c)) return;
            this.renderHeader();
            this.refreshMemorialEntry();
            this.refreshTombstoneOwnedLabel(id);
            this.toast('限定解锁成功！已获得「' + tomb.name + '」');
        }, '暂未解锁限定纪念碑');
    }

    private buyTombstone(id: TombstoneId): boolean {
        const tomb = findTombstone(id);
        if (!tomb) return false;
        if (tomb.unlockMode === 'ad') { this.unlockTombstoneByAd(id); return false; }
        if (this.data.gems < tomb.priceGems) { this.showGemDialog(); return false; }
        const c = this.dailyCandidate();
        c.gems -= tomb.priceGems;
        c.tombstoneInventory = { ...(c.tombstoneInventory || {}), [id]: ((c.tombstoneInventory || {})[id] || 0) + 1 };
        if (!this.commitShop(c)) return false;
        this.renderHeader();
        this.refreshMemorialEntry();
        this.refreshTombstoneOwnedLabel(id);
        this.showRewardToast([{ kind: 'gems', amount: -tomb.priceGems }], '消耗');
        this.toast('已购入「' + tomb.name + '」，可在后院纪念角为伙伴立碑纪念');
        return true;
    }

    private clearAdventureBackground() {
        if (this.advBgContainer && isValid(this.advBgContainer, true)) {
            this.advBgContainer.active = false;
        }
        if (this.backgroundSprite && isValid(this.backgroundSprite.node, true)) {
            this.backgroundSprite.node.active = true;
        }
    }

    private ensureAdventureBackground() {
        if (!this.background || !isValid(this.background, true)) return;
        if (this.backgroundSprite && isValid(this.backgroundSprite.node, true)) {
            this.backgroundSprite.node.active = false;
        }
        if (!this.advBgContainer || !isValid(this.advBgContainer, true)) {
            this.advBgContainer = new Node('冒险竖向循环路背景');
            this.advBgContainer.layer = this.backgroundLayer;
            this.background.addChild(this.advBgContainer);
            this.advBgContainer.addComponent(UITransform).setContentSize(this.width, this.height);
            this.advRoadTiles = [];
            for (let i = 0; i < 2; i++) {
                const tile = new Node('冒险竖路-' + i);
                tile.layer = this.backgroundLayer;
                this.advBgContainer.addChild(tile);
                tile.addComponent(UITransform).setContentSize(this.width, this.height);
                const sp = tile.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
                resources.load('art/adventure/road-bg/spriteFrame', SpriteFrame, (e, f) => {
                    if (!e && f && isValid(sp, true)) sp.spriteFrame = f;
                });
                this.advRoadTiles.push(tile);
            }
        }
        this.advBgContainer.active = true;
        this.layoutAdventureBackground();
    }

    private layoutAdventureBackground() {
        if (!this.advBgContainer || !isValid(this.advBgContainer, true)) return;
        const size = view.getVisibleSize();
        const cover = Math.max(size.width / 1080, size.height / 1920);
        const tw = 1080 * cover, th = 1920 * cover;
        this.advRoadTiles.forEach((tile, i) => {
            if (!isValid(tile, true)) return;
            tile.getComponent(UITransform)!.setContentSize(tw, th + 2);
            tile.setPosition(0, i * th - (this.advScrollY % th), 0);
        });
    }

    private renderAdventure() {
        const layer = this.sheet!;
        // 1) 开启全屏竖向无缝循环冒险小路（位于背景相机层，我们的真实 3D 猫狗模型在中间小路上循环前行！）
        this.ensureAdventureBackground();

        // 2) 左上方（GM 调试下方）挂钩手账风「实时冒险日志」卡片，点击可查看完整冒险日记
        this.renderAdventureLiveLogCard(layer);

        // 3) 右侧悬浮挂机宝箱 + 旋转金光 + 宝箱下方挂机时间
        const chestBox = this.uiNode(layer, '冒险右侧宝箱区', Math.min(this.width / 2 - 122, 386), -this.height / 2 + 520, 230, 320);

        // 旋转金光光环（可领取时亮起旋转）
        const aura = this.uiNode(chestBox, '宝箱金光', 0, 26, 340, 340);
        const ag = aura.addComponent(Graphics);
        for (let r = 0; r < 12; r++) {
            const a0 = (r * Math.PI * 2) / 12;
            const a1 = a0 + 0.2;
            ag.fillColor = new Color(255, 214, 70, r % 2 === 0 ? 205 : 120);
            ag.moveTo(0, 0); ag.lineTo(Math.cos(a0) * 168, Math.sin(a0) * 168); ag.lineTo(Math.cos(a1) * 168, Math.sin(a1) * 168); ag.close(); ag.fill();
        }
        ag.fillColor = new Color(255, 246, 170, 215); ag.circle(0, 0, 96); ag.fill();
        ag.fillColor = new Color(255, 255, 236, 170); ag.circle(0, 0, 58); ag.fill();
        this.advChestAura = aura;

        const chestNode = this.uiNode(chestBox, '冒险挂机宝箱', 0, 26, 184, 184);
        const chestSp = chestNode.addComponent(Sprite); chestSp.sizeMode = Sprite.SizeMode.CUSTOM;
        resources.load('art/adventure/chest-closed/spriteFrame', SpriteFrame, (e, f) => {
            if (!e && f && isValid(chestSp, true)) chestSp.spriteFrame = f;
        });
        this.advChestSprite = chestSp;
        this.intercept(chestNode); this.pressFeedback(chestNode);
        chestNode.on(Node.EventType.TOUCH_END, () => this.claimAdventureChest(), this);

        // 可开启红标（悬浮在宝箱顶部）
        const badge = this.uiNode(chestBox, '宝箱可领标', 0, 128, 122, 34);
        const bgG = badge.addComponent(Graphics);
        bgG.fillColor = this.color('#E05744'); bgG.strokeColor = this.color('#FFF6DC'); bgG.lineWidth = 3;
        bgG.roundRect(-61, -17, 122, 34, 17); bgG.fill(); bgG.stroke();
        const bLbl = this.text(badge, '可领取!', 0, 0, 114, 28, 20, C.white); bLbl.isBold = true;
        this.advChestBadge = badge;

        // 挂机时间与宝箱名紧贴宝箱正下方
        const timerPill = this.uiNode(chestBox, '宝箱挂机时间牌', 0, -92, 204, 72);
        const tpg = timerPill.addComponent(Graphics);
        tpg.fillColor = new Color(74, 44, 22, 222); tpg.strokeColor = this.color('#F5CC6C'); tpg.lineWidth = 3.5;
        tpg.roundRect(-102, -36, 204, 72, 20); tpg.fill(); tpg.stroke();
        const tTitle = this.text(timerPill, '挂机宝箱', 0, 15, 190, 26, 20, '#FFE896'); tTitle.isBold = true;
        this.advTimerLabel = this.text(timerPill, '00:00 / 24h', 0, -15, 194, 28, 21, '#FFFDF2');
        this.advTimerLabel.isBold = true;
        this.intercept(timerPill); this.pressFeedback(timerPill);
        timerPill.on(Node.EventType.TOUCH_END, () => this.claimAdventureChest(), this);

        this.updateAdventureLabel();
    }

    /** 绘制冒险场景左上方（GM 调试下方）的挂钩手账风「实时冒险日志」卡片 */
    private renderAdventureLiveLogCard(layer: Node) {
        const existing = layer.getChildByName('冒险左上实时日志卡');
        if (existing && isValid(existing, true)) { existing.removeFromParent(); existing.destroy(); }

        const cardW = 370, cardH = 392;
        const card = this.uiNode(layer, '冒险左上实时日志卡', -this.width / 2 + 24 + cardW / 2, this.height / 2 - 266 - cardH / 2, cardW, cardH);
        const g = card.addComponent(Graphics);

        // 柔和投影
        g.fillColor = new Color(62, 38, 16, 56);
        g.roundRect(-cardW / 2 + 4, -cardH / 2 - 6, cardW, cardH, 26); g.fill();

        // 暖米白纸底
        g.fillColor = this.color('#FBF4DF');
        g.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 26); g.fill();

        // 顶部暖蜜黄标题带
        const hdrH = 64;
        g.fillColor = this.color('#F0CF86');
        g.roundRect(-cardW / 2, cardH / 2 - hdrH, cardW, hdrH, 24); g.fill();
        g.fillRect(-cardW / 2, cardH / 2 - hdrH, cardW, 18);
        // 标题底部分割线
        g.strokeColor = this.color('#C79A59'); g.lineWidth = 2.5;
        g.moveTo(-cardW / 2 + 4, cardH / 2 - hdrH); g.lineTo(cardW / 2 - 4, cardH / 2 - hdrH); g.stroke();

        // 外圈暖棕描边
        g.strokeColor = this.color('#7D542E'); g.lineWidth = 3.5;
        g.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 26); g.stroke();

        // 内圈手工虚线缝边
        g.strokeColor = this.color('#D4B88C'); g.lineWidth = 2;
        const ix0 = -cardW / 2 + 12, ix1 = cardW / 2 - 12, iy0 = -cardH / 2 + 12, iy1 = cardH / 2 - hdrH - 8;
        for (let x = ix0; x < ix1 - 8; x += 14) {
            g.moveTo(x, iy0); g.lineTo(Math.min(x + 8, ix1), iy0);
        }
        for (let y = iy0; y < iy1 - 8; y += 14) {
            g.moveTo(ix0, y); g.lineTo(ix0, Math.min(y + 8, iy1));
            g.moveTo(ix1, y); g.lineTo(ix1, Math.min(y + 8, iy1));
        }
        g.stroke();

        // 顶部左右两枚木质挂钩圆环
        for (const px of [-114, 114]) {
            g.fillColor = this.color('#6F4724');
            g.circle(px, cardH / 2 - 14, 10); g.fill();
            g.fillColor = this.color('#B8844F');
            g.roundRect(px - 6, cardH / 2 - 16, 12, 30, 6); g.fill();
            g.strokeColor = this.color('#5A381B'); g.lineWidth = 2.5;
            g.roundRect(px - 6, cardH / 2 - 16, 12, 30, 6); g.stroke();
        }

        // 标题两侧小爪印装饰
        for (const side of [-1, 1]) {
            const cx = side * 116, cy = cardH / 2 - 33;
            g.fillColor = new Color(184, 134, 66, 150);
            g.circle(cx, cy - 3, 6.5); g.fill();
            g.circle(cx - 7, cy + 5, 3.2); g.fill();
            g.circle(cx, cy + 8, 3.2); g.fill();
            g.circle(cx + 7, cy + 5, 3.2); g.fill();
        }

        const titleLbl = this.text(card, '实时冒险日志', 0, cardH / 2 - 33, 220, 34, 25, '#4B2D16');
        titleLbl.isBold = true;

        // 中部展示最近 2 条实时冒险记录（宠物头像 + 名字 + 简短收获）
        const logs = this.data.adventureLogs || [];
        const recent = logs.slice(0, 2);
        recent.forEach((log, idx) => {
            const ry = 88 - idx * 72;
            const row = this.uiNode(card, `实时日志行-${idx}`, 0, ry, cardW - 36, 62);
            const breed = BREEDS[log.petId] || BREEDS[0];
            const avNode = this.uiNode(row, '日志宠物头像', -132, 0, 52, 52);
            const avSp = avNode.addComponent(Sprite); avSp.sizeMode = Sprite.SizeMode.CUSTOM;
            void this.loadPetPortrait(breed.skin).then(f => {
                if (f && isValid(avSp, true)) avSp.spriteFrame = f;
            });

            const nameLbl = this.text(row, log.petName || breed.name, 26, 15, 236, 26, 20, '#4B2D16');
            nameLbl.isBold = true; nameLbl.horizontalAlign = Label.HorizontalAlign.LEFT;
            nameLbl.overflow = Label.Overflow.SHRINK; nameLbl.enableWrapText = false;

            let summary = log.title;
            if (log.itemId) {
                const it = findItem(log.itemId);
                summary = `捡到了 ${it?.name || log.itemId} ×${log.itemCount || 1}`;
            } else if (log.coins && log.gems) {
                summary = `收获 金币+${log.coins} 钻石+${log.gems}`;
            } else if (log.coins) {
                summary = `捡到了 金币 +${log.coins}`;
            } else if (log.gems) {
                summary = `捡到了 钻石 +${log.gems}`;
            }
            const descLbl = this.text(row, summary, 26, -14, 236, 24, 18, '#6B4829');
            descLbl.horizontalAlign = Label.HorizontalAlign.LEFT;
            descLbl.overflow = Label.Overflow.SHRINK; descLbl.enableWrapText = false;
        });

        if (!recent.length) {
            this.text(card, '伙伴们正在林间快乐探险中…', 0, 54, 300, 32, 19, '#8B6846');
        }

        // 底部 3 格实物收获展示框（与参考图一致：图标 + 物品名）
        const trayW = 332, trayH = 116;
        const tray = this.uiNode(card, '实时日志实物格区', 0, -116, trayW, trayH);
        const tg = tray.addComponent(Graphics);
        tg.fillColor = this.color('#F2E5C3');
        tg.roundRect(-trayW / 2, -trayH / 2, trayW, trayH, 18); tg.fill();
        tg.strokeColor = this.color('#C4A16E'); tg.lineWidth = 2.5;
        tg.roundRect(-trayW / 2, -trayH / 2, trayW, trayH, 18); tg.stroke();

        // 收集最近 3 件实际收获物品/货币（不足 3 件时用默认展示补齐视觉，按 6 阶品质配底框）
        const showcase: { spritePath: string; name: string; theme: SlotBgTheme }[] = [];
        for (const l of logs) {
            if (showcase.length >= 3) break;
            if (l.itemId) {
                const it = findItem(l.itemId);
                showcase.push({ spritePath: `art/items/${l.itemId}/spriteFrame`, name: it?.name || l.itemId, theme: this.itemQualityTheme(it) });
            } else if (l.coins) {
                showcase.push({ spritePath: 'art/header/coin-icon/spriteFrame', name: `金币+${l.coins}`, theme: 'coin' });
            } else if (l.gems) {
                showcase.push({ spritePath: 'art/header/diamond-icon/spriteFrame', name: `钻石+${l.gems}`, theme: 'coin' });
            }
        }
        const fallbackIds = ['fish', 'ball', 'bone_chew'];
        for (const fid of fallbackIds) {
            if (showcase.length >= 3) break;
            if (showcase.some(s => s.spritePath === `art/items/${fid}/spriteFrame`)) continue;
            const it = findItem(fid);
            if (it) showcase.push({ spritePath: `art/items/${it.id}/spriteFrame`, name: it.name, theme: this.itemQualityTheme(it) });
        }

        showcase.slice(0, 3).forEach((entry, idx) => {
            const sx = (idx - 1) * 106;
            const slot = this.uiNode(tray, `实时日志实物格-${idx}`, sx, 0, 96, 98);
            this.itemSlotBg(slot, entry.theme, 96, 98, '实物格底图');

            const iconNode = this.uiNode(slot, '实物图标', 0, 12, 54, 54);
            const sp = iconNode.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
            resources.load(entry.spritePath, SpriteFrame, (e, f) => {
                if (!e && f && isValid(sp, true) && isValid(iconNode, true)) {
                    sp.spriteFrame = f;
                    const aspect = f.rect.width / Math.max(1, f.rect.height);
                    const w = aspect >= 1 ? 54 : 54 * aspect;
                    const h = aspect >= 1 ? 54 / aspect : 54;
                    iconNode.getComponent(UITransform)!.setContentSize(w, h);
                }
            });
            const nLbl = this.text(slot, entry.name, 0, -32, 88, 22, 15, '#5C3B20');
            nLbl.overflow = Label.Overflow.SHRINK; nLbl.enableWrapText = false;
        });

        this.intercept(card); this.pressFeedback(card);
        card.on(Node.EventType.TOUCH_END, () => this.open('diary'), this);
    }

    /** 计算并摆放冒险道路上的 3D 宠物队列（与右侧宝箱齐平，snap=true 时立即落位消除切页错位） */
    private placeAdventureFormation(snap: boolean, step = 0.016) {
        const visibleAdv = this.actors.filter(x => isValid(x.node, true) && x.node.active && !x.dying);
        const rows = Math.max(1, Math.ceil(visibleAdv.length / 2));
        // 与右侧宝箱（屏幕中下方）齐平：单只/双只落在 z=+3.85，多只以 z=+3.85 为中心前后错开
        const baseZ = Math.max(1.8, 3.85 - (rows - 1) * 0.48);
        const blendPos = snap ? 1 : 1 - Math.exp(-step * 8.0);
        const blendYaw = snap ? 1 : 1 - Math.exp(-step * 10.0);

        visibleAdv.forEach((a, idx) => {
            const row = Math.floor(idx / 2);
            const isLastOdd = idx === visibleAdv.length - 1 && visibleAdv.length % 2 === 1;
            const swayX = snap ? 0 : Math.sin(this.socialTime * 1.1 + idx * 1.7) * 0.07;
            const laneX = (isLastOdd ? 0 : (idx % 2 === 0 ? -0.46 : 0.46)) + swayX;
            const laneZ = baseZ + row * 1.05;
            const pos = a.node.position;
            a.node.setPosition(
                snap ? laneX : pos.x + (laneX - pos.x) * blendPos,
                0,
                snap ? laneZ : pos.z + (laneZ - pos.z) * blendPos,
            );
            const targetYaw = 180 + (snap ? 0 : Math.sin(this.socialTime * 2.2 + idx) * 6);
            a.facing = 180;
            a.target.set(laneX, 0, laneZ);
            a.socialUntil = 0;
            a.timer = 0;
            a.lookYaw = 0;
            a.lookTilt = 0;
            if (snap) {
                a.node.setRotationFromEuler(0, 180, 0);
                a.visual.setPosition(0, 0, 0);
                a.visual.setRotationFromEuler(0, 0, 0);
                a.visual.setScale(1, 1, 1);
                if (a.rig && isValid(a.rig.head, true)) a.rig.head.setRotationFromEuler(0, 0, 0);
            } else {
                const yaw = a.node.eulerAngles.y;
                const diff = ((targetYaw - yaw + 540) % 360) - 180;
                a.node.setRotationFromEuler(0, yaw + diff * blendYaw, 0);
            }
        });
    }

    private updateAdventureLabel() {
        const start = this.data.adventureIdleStart || Date.now();
        const aliveCount = this.data.pets.filter(p => !p.dead && !p.lost).length;
        const preview = calcIdleRewardPreview(Date.now() - start, aliveCount);
        const totalSec = Math.floor(preview.cappedMs / 1000);
        const hh = ('0' + Math.floor(totalSec / 3600)).slice(-2);
        const mm = ('0' + Math.floor((totalSec % 3600) / 60)).slice(-2);
        const ss = ('0' + (totalSec % 60)).slice(-2);
        if (this.advTimerLabel && isValid(this.advTimerLabel, true)) {
            this.advTimerLabel.string = preview.minutes >= 60 ? `${hh}:${mm} / 24h` : `${mm}:${ss} / 24h`;
        }
        if (this.advChestAura && isValid(this.advChestAura, true)) {
            this.advChestAura.active = preview.ready || Date.now() < this.advChestOpenUntil;
        }
        if (this.advChestBadge && isValid(this.advChestBadge, true)) {
            this.advChestBadge.active = preview.ready;
        }
    }

    private updateAdventureScene(dt: number) {
        if (this.page !== 'adventure') return;
        const size = view.getVisibleSize();
        const cover = Math.max(size.width / 1080, size.height / 1920);
        const th = 1920 * cover;
        if (this.advRoadTiles.length === 2) {
            // 背景小路向下无缝循环滚动，营造猫狗向前奔跑探险的真实挂机体验
            this.advScrollY = (this.advScrollY + dt * 240) % th;
            this.advRoadTiles[0].setPosition(0, -this.advScrollY, 0);
            this.advRoadTiles[1].setPosition(0, th - this.advScrollY, 0);
        }
        if (this.advChestAura && isValid(this.advChestAura, true) && this.advChestAura.active) {
            const z = this.advChestAura.eulerAngles.z - dt * 42;
            this.advChestAura.setRotationFromEuler(0, 0, z);
            const pulse = 0.94 + Math.sin(Date.now() * 0.006) * 0.08;
            this.advChestAura.setScale(pulse, pulse, 1);
        }
        if (this.advChestSprite && isValid(this.advChestSprite, true) && this.advChestOpenUntil > 0 && Date.now() >= this.advChestOpenUntil) {
            this.advChestOpenUntil = 0;
            resources.load('art/adventure/chest-closed/spriteFrame', SpriteFrame, (e, f) => {
                if (!e && f && isValid(this.advChestSprite, true)) this.advChestSprite!.spriteFrame = f;
            });
        }
    }

    public claimAdventureChest(): boolean {
        const start = this.data.adventureIdleStart || Date.now();
        const aliveCount = this.data.pets.filter(p => !p.dead && !p.lost).length;
        const preview = calcIdleRewardPreview(Date.now() - start, aliveCount);
        if (!preview.ready) {
            this.toast('挂机满 1 分钟才能开启宝箱哦（离线也会累计）');
            return false;
        }
        const bonusItems = rollIdleBonusItems(preview.itemCount);
        const outfitAdvBonus = this.data.pets.filter(p => !p.dead && !p.lost).reduce((acc, p) => acc + (PET_OUTFITS.find(o => o.id === p.outfit)?.adventureBonus || 0), 0);
        const outfitXpBonus = this.data.pets.filter(p => !p.dead && !p.lost).reduce((acc, p) => acc + (PET_OUTFITS.find(o => o.id === p.outfit)?.xpBonus || 0), 0);
        const finalCoins = Math.round(preview.coins * (1 + Math.min(0.8, outfitAdvBonus)));
        const finalGems = Math.round(preview.gems * (1 + Math.min(0.5, outfitAdvBonus * 0.5)));
        const c = this.dailyCandidate();
        c.coins = Math.min(100000000, c.coins + finalCoins);
        c.gems = Math.min(100000000, c.gems + finalGems);
        c.xp = Math.min(100000000, c.xp + Math.round(Math.max(15, Math.min(200, preview.minutes * 2)) * (1 + Math.min(0.8, outfitXpBonus))));
        c.adventureIdleStart = Date.now();
        c.itemInventory = { ...c.itemInventory };
        bonusItems.forEach(bi => { c.itemInventory[bi.id] = (c.itemInventory[bi.id] || 0) + bi.count; });
        recordDaily(c.daily, 'adventure');
        if (!this.commitShop(c)) return false;

        // 切换为开启发光宝箱（在开箱弹跳瞬间翻盖）+ 记录到冒险日记
        this.advChestOpenUntil = Date.now() + 2800;
        const firstItem = bonusItems[0];
        const itemSummary = bonusItems.map(bi => `${findItem(bi.id)?.name || bi.id}×${bi.count}`).join('、');
        this.recordAdventureLog({
            petId: this.data.pets[0]?.id ?? 0,
            petName: '冒险小队',
            type: 'chest',
            title: '开启挂机宝箱',
            text: `开启了累计 ${preview.minutes} 分钟的冒险宝箱：金币 +${finalCoins}、钻石 +${finalGems}${itemSummary ? '，带回 ' + itemSummary : ''}！`,
            itemId: firstItem?.id,
            itemCount: firstItem?.count,
            coins: finalCoins,
            gems: finalGems,
        });
        this.renderHeader();
        this.updateAdventureLabel();
        const grantRewards: RewardGrantItem[] = [];
        if (finalCoins > 0) grantRewards.push({ kind: 'coins', amount: finalCoins });
        if (finalGems > 0) grantRewards.push({ kind: 'gems', amount: finalGems });
        bonusItems.forEach(bi => grantRewards.push({ kind: 'item', itemId: bi.id, amount: bi.count }));
        this.playChestOpenEffect();
        const dialogTitle = `累计挂机 ${preview.minutes} 分钟 · 满载而归！`;
        // 先完整播放分段开箱特效，再弹出带通用底图的图标+数字奖励面板
        this.scheduleOnce(() => {
            if (isValid(this, true)) this.showRewardGrantDialog('冒险宝箱已开启！', grantRewards, dialogTitle, '太棒了');
        }, 1.35);
        return true;
    }

    /** 宝箱开启特效：蓄力摇晃 → 翻盖弹跳 → 背后柔光扩散 + 真实金币/钻石/星光从箱口喷涌而出（绝不遮挡宝箱主体） */
    private playChestOpenEffect() {
        const layer = this.sheet;
        if (!layer || !isValid(layer, true) || this.page !== 'adventure') return;
        const box = layer.getChildByName('冒险右侧宝箱区');
        if (!box) return;
        const chest = box.getChildByName('冒险挂机宝箱');

        // 清理上一次残留特效
        box.getChildByName('宝箱背光特效')?.destroy();
        box.getChildByName('宝箱开启特效')?.destroy();

        // 1) 背后柔和金光环（插在宝箱最底层，绝不遮盖宝箱与时间牌）
        const fxBack = this.uiNode(box, '宝箱背光特效', 0, 26, 10, 10);
        fxBack.setSiblingIndex(0);
        const ring = this.uiNode(fxBack, '扩散光环', 0, 0, 10, 10);
        const rg = ring.addComponent(Graphics);
        rg.strokeColor = new Color(255, 224, 96, 210); rg.lineWidth = 10; rg.circle(0, 0, 74); rg.stroke();
        rg.fillColor = new Color(255, 236, 138, 92); rg.circle(0, 0, 88); rg.fill();
        const rop = ring.addComponent(UIOpacity); rop.opacity = 0;
        ring.setScale(0.55, 0.55, 1);

        // 2) 前景粒子层（从箱口上方喷涌，不盖住宝箱正面）
        const fx = this.uiNode(box, '宝箱开启特效', 0, 44, 10, 10);

        // 阶段一（0~0.30s）：闭合宝箱蓄力晃动挤压
        if (chest && isValid(chest, true)) {
            Tween.stopAllByTarget(chest);
            chest.setScale(1, 1, 1); chest.angle = 0;
            tween(chest)
                .to(0.07, { angle: 8, scale: new Vec3(1.06, 0.94, 1) })
                .to(0.07, { angle: -8, scale: new Vec3(1.10, 0.90, 1) })
                .to(0.07, { angle: 6, scale: new Vec3(1.14, 0.86, 1) })
                .to(0.08, { angle: 0, scale: new Vec3(1.22, 0.78, 1) })
                // 阶段二（0.30s）：翻盖弹起爆发！
                .call(() => {
                    if (this.advChestSprite && isValid(this.advChestSprite, true)) {
                        resources.load('art/adventure/chest-open/spriteFrame', SpriteFrame, (e, f) => {
                            if (!e && f && isValid(this.advChestSprite, true)) this.advChestSprite!.spriteFrame = f;
                        });
                    }
                    // 背后光环绽放
                    if (isValid(ring, true)) {
                        tween(rop).to(0.14, { opacity: 255 }).delay(0.45).to(0.55, { opacity: 0 }).start();
                        tween(ring).to(0.85, { scale: new Vec3(2.15, 2.15, 1) }, { easing: 'quadOut' }).start();
                    }
                })
                .to(0.15, { scale: new Vec3(0.92, 1.24, 1) }, { easing: 'backOut' })
                .to(0.14, { scale: new Vec3(1.06, 0.97, 1) })
                .to(0.12, { scale: new Vec3(1, 1, 1) })
                .start();
        }

        // 3) 0.30s 瞬间：金币图标、钻石图标与四角星光从箱口向上弧线喷涌！
        this.scheduleOnce(() => {
            if (!isValid(fx, true)) return;
            // 喷出 6 枚真实金币 + 4 颗真实钻石图标
            const burstIcons = [
                'art/header/coin-icon/spriteFrame', 'art/header/diamond-icon/spriteFrame',
                'art/header/coin-icon/spriteFrame', 'art/header/coin-icon/spriteFrame',
                'art/header/diamond-icon/spriteFrame', 'art/header/coin-icon/spriteFrame',
                'art/header/diamond-icon/spriteFrame', 'art/header/coin-icon/spriteFrame',
            ];
            burstIcons.forEach((path, i) => {
                const ic = this.uiNode(fx, '喷涌宝物', (Math.random() - 0.5) * 32, 10, 42, 42);
                const sp = ic.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
                resources.load(path, SpriteFrame, (e, f) => {
                    if (!e && f && isValid(sp, true)) sp.spriteFrame = f;
                });
                const op = ic.addComponent(UIOpacity); op.opacity = 255;
                ic.setScale(0.35, 0.35, 1);
                const spreadX = -155 + (i / (burstIcons.length - 1)) * 240 + (Math.random() - 0.5) * 24;
                const peakY = 140 + Math.random() * 115;
                const endY = peakY - 48 - Math.random() * 40;
                tween(ic)
                    .delay(i * 0.03)
                    .to(0.36, { position: new Vec3(spreadX * 0.65, peakY, 0), scale: new Vec3(1.08, 1.08, 1), angle: (Math.random() - 0.5) * 40 }, { easing: 'quadOut' })
                    .to(0.45, { position: new Vec3(spreadX, endY, 0), scale: new Vec3(0.85, 0.85, 1) }, { easing: 'quadIn' })
                    .start();
                tween(op).delay(0.55 + i * 0.02).to(0.35, { opacity: 0 }).start();
            });

            // 16 颗清晰柔和的四芒星光向上散开
            for (let i = 0; i < 16; i++) {
                const star = this.uiNode(fx, '星光', (Math.random() - 0.5) * 40, 12, 10, 10);
                const sg = star.addComponent(Graphics);
                const s = 10 + Math.random() * 10;
                sg.fillColor = i % 2 === 0 ? new Color(255, 255, 240, 255) : new Color(255, 218, 72, 255);
                sg.moveTo(0, s); sg.lineTo(s * 0.28, s * 0.28); sg.lineTo(s, 0); sg.lineTo(s * 0.28, -s * 0.28);
                sg.lineTo(0, -s); sg.lineTo(-s * 0.28, -s * 0.28); sg.lineTo(-s, 0); sg.lineTo(-s * 0.28, s * 0.28); sg.close(); sg.fill();
                const op = star.addComponent(UIOpacity); op.opacity = 255;
                const dx = -170 + Math.random() * 270;
                const dy = 70 + Math.random() * 210;
                tween(star).delay(Math.random() * 0.14).to(0.75 + Math.random() * 0.25, { position: new Vec3(dx, dy, 0), angle: 160 }, { easing: 'quadOut' }).start();
                tween(op).delay(0.48 + Math.random() * 0.2).to(0.42, { opacity: 0 }).start();
            }
        }, 0.29);

        this.scheduleOnce(() => {
            if (isValid(fxBack, true)) fxBack.destroy();
            if (isValid(fx, true)) fx.destroy();
        }, 1.85);
    }

    /** 同步主城与冒险场景中 3D 宠物的可见性：外出冒险的伙伴不显示在主城庭院，只在冒险道路上奔跑 */
    public syncActorVisibility() {
        const hasOut = this.actors.some(a => !a.pet.dead && !a.pet.lost && !!a.pet.adventuring);
        this.actors.forEach(a => {
            if (!isValid(a.node, true)) return;
            if (a.dying) { a.node.active = this.page !== 'adventure'; return; }
            if (a.pet.dead || a.pet.lost) { a.node.active = false; return; }
            if (this.page === 'adventure') {
                // 若有宠物处于外出冒险状态，则冒险页只展示外出冒险的小队；否则全员结队展示
                a.node.active = hasOut ? !!a.pet.adventuring : true;
            } else {
                // 主城及其他页面：外出冒险中的小猫小狗不显示在主城
                a.node.active = !a.pet.adventuring;
            }
        });
        if (this.bubbleLayer && isValid(this.bubbleLayer, true)) {
            this.bubbleLayer.active = this.page !== 'adventure';
        }
        if (this.page === 'adventure') {
            this.placeAdventureFormation(true);
        }
    }

    /** 派出或召回宠物冒险：派出后从主城隐藏、记录冒险出发日记，并在冒险页小路上现身 */
    public setPetAdventuring(petId: number, out: boolean, durationMs = 120000): boolean {
        const pet = this.data.pets.find(p => p.id === petId);
        if (!pet || pet.dead || pet.lost) return false;
        if (Boolean(pet.adventuring) === out) { this.syncActorVisibility(); return true; }
        pet.adventuring = out;
        pet.adventureReturnAt = out ? Date.now() + durationMs : undefined;
        const actor = this.actors.find(a => a.pet.id === petId);
        if (actor) actor.pet = pet;
        if (out) {
            const dep = makeDepartOutcome(this.petDisplayName(pet.id));
            this.recordAdventureLog({ petId: pet.id, petName: this.petDisplayName(pet.id), type: dep.type, title: dep.title, text: dep.text });
            if (this.selected === petId && (this.page === 'pet' || this.page === 'bag')) this.open('home');
        }
        this.dirty = true;
        this.persist();
        this.syncActorVisibility();
        this.updateSelectionRing();
        return true;
    }

    private recordAdventureLog(partial: Omit<AdventureLogEntry, 'id' | 'time'>): AdventureLogEntry {
        const entry: AdventureLogEntry = { id: ++this.advLogNextId, time: Date.now(), ...partial };
        if (!this.data.adventureLogs) this.data.adventureLogs = [];
        this.data.adventureLogs.unshift(entry);
        if (this.data.adventureLogs.length > 40) this.data.adventureLogs.length = 40;
        this.dirty = true;
        this.persist();
        if (this.page === 'adventure' && this.sheet && isValid(this.sheet, true)) {
            this.renderAdventureLiveLogCard(this.sheet);
        }
        return entry;
    }

    public triggerAdventureOutcome(pet: Pet, outcome: RolledAdventureOutcome) {
        const name = this.petDisplayName(pet.id);
        const c = this.dailyCandidate();
        const target = c.pets.find(p => p.id === pet.id);
        if (!target) return;
        if (outcome.coins) c.coins = Math.min(100000000, c.coins + outcome.coins);
        if (outcome.gems) c.gems = Math.min(100000000, c.gems + outcome.gems);
        if (outcome.item) {
            c.itemInventory = { ...c.itemInventory, [outcome.item.id]: (c.itemInventory[outcome.item.id] || 0) + (outcome.itemCount || 1) };
        }
        if (outcome.cleanSetMax !== undefined) target.clean = Math.min(target.clean, outcome.cleanSetMax);
        if (outcome.cleanDelta) target.clean = Math.max(0, Math.min(100, target.clean + outcome.cleanDelta));
        if (outcome.healthDelta) target.health = Math.max(0, Math.min(100, target.health + outcome.healthDelta));
        if (outcome.joyDelta) target.joy = Math.max(0, Math.min(100, target.joy + outcome.joyDelta));
        if (outcome.setLost) { target.lost = true; target.adventuring = false; target.adventureReturnAt = undefined; }
        if (outcome.setDead) {
            target.dead = true; target.health = 0; target.adventuring = false; target.adventureReturnAt = undefined;
            target.deathReason = outcome.deathReason || '冒险遭遇意外';
            target.diedAt = Date.now();
        }
        if (!this.commitShop(c)) return;
        const actor = this.actors.find(a => a.pet.id === pet.id);
        if (outcome.setLost && actor) {
            if (isValid(actor.node, true)) { actor.node.active = false; actor.node.destroy(); }
            this.actors = this.actors.filter(a => a !== actor);
        } else if (outcome.setDead && actor) {
            if (this.page === 'home' || this.page === 'pet') { actor.dying = 0.001; actor.ghostSpawned = false; }
            else { if (isValid(actor.node, true)) { actor.node.active = false; actor.node.destroy(); } this.actors = this.actors.filter(a => a !== actor); }
        } else if (actor) {
            actor.pet = target;
        }
        this.recordAdventureLog({
            petId: pet.id, petName: name, type: outcome.type, title: outcome.title, text: outcome.text,
            itemId: outcome.item?.id, itemCount: outcome.itemCount, coins: outcome.coins, gems: outcome.gems,
            resolved: !(outcome.setLost || outcome.setDead),
        });
        this.renderHeader();
        this.refreshMemorialEntry();
        {
            const gained: RewardGrantItem[] = [];
            if (outcome.coins) gained.push({ kind: 'coins', amount: outcome.coins });
            if (outcome.gems) gained.push({ kind: 'gems', amount: outcome.gems });
            if (outcome.item) gained.push({ kind: 'item', itemId: outcome.item.id, amount: outcome.itemCount || 1 });
            if (gained.length && (this.page === 'home' || this.page === 'adventure')) this.showRewardToast(gained, name + ' 带回');
        }
        if (outcome.setLost) {
            this.pendingAlerts.push({ kind: 'lost', petId: pet.id, reason: outcome.text });
            this.checkMainCityAlerts();
        } else if (outcome.setDead) {
            this.pendingAlerts.push({ kind: 'dead', petId: pet.id, reason: outcome.deathReason || '冒险途中遭遇猫狗贩子' });
            this.checkMainCityAlerts();
        }
    }

    private checkMainCityAlerts() {
        if (this.page !== 'home' || this.dialog || !this.pendingAlerts.length) return;
        const alert = this.pendingAlerts.shift()!;
        const pet = this.data.pets.find(p => p.id === alert.petId);
        if (!pet) return;
        if (alert.kind === 'lost' && !pet.lost) return;
        if (alert.kind === 'dead' && !pet.dead) return;
        this.showPetCrisisDialog(alert.kind, pet.id, alert.reason);
    }

    public showPetCrisisDialog(kind: 'lost' | 'dead', petId: number, reason: string) {
        if (this.dialog) this.closeDialog();
        const name = this.petDisplayName(petId);
        if (kind === 'lost') {
            this.showDialog('走失警报！', `「${name}」在冒险中贪玩走丢了！\n观看广告可免费找回，或消耗钻石立刻找回。`, [
                { title: '看广告找回', run: () => this.recoverLostPet(petId, 'ad') },
                { title: '钻石找回', cost: { currency: 'gems', amount: LOST_PET_RECOVER_GEMS }, run: () => this.recoverLostPet(petId, 'gems') },
            ]);
        } else {
            this.showDialog('离别提醒', `「${name}」因【${reason}】离开了庭院……\n可以观看广告奇迹复活，或前往后院纪念角立碑纪念。`, [
                { title: '看广告复活', run: () => this.revivePetByAd(petId) },
                { title: '购买墓碑纪念', run: () => { this.closeDialog(); this.open('memorial'); this.showErectTombstoneDialog(petId); } },
            ]);
        }
    }

    private recoverLostPet(petId: number, mode: 'ad' | 'gems') {
        const pet = this.data.pets.find(p => p.id === petId);
        if (!pet || !pet.lost) { this.closeDialog(); return; }
        const finish = () => {
            const c = this.dailyCandidate();
            if (mode === 'gems') {
                if (c.gems < LOST_PET_RECOVER_GEMS) { this.closeDialog(); this.showGemDialog(); return; }
                c.gems -= LOST_PET_RECOVER_GEMS;
            }
            const target = c.pets.find(p => p.id === petId);
            if (!target) return;
            target.lost = false; target.adventuring = false; target.adventureReturnAt = undefined; target.joy = Math.min(100, target.joy + 20);
            (c.adventureLogs || []).forEach(l => { if (l.petId === petId && l.type === 'lost') l.resolved = true; });
            if (!this.commitShop(c)) return;
            if (!this.actors.some(a => a.pet.id === petId)) this.spawnPet(target);
            this.syncActorVisibility();
            this.closeDialog();
            this.renderHeader();
            if (this.page === 'diary') { if (this.sheet) { this.sheet.destroy(); this.sheet = null; } this.open('diary'); }
            this.toast('太好了！「' + this.petDisplayName(petId) + '」已经平安回到庭院啦！');
            if (mode === 'gems') this.showRewardToast([{ kind: 'gems', amount: -LOST_PET_RECOVER_GEMS }], '消耗');
        };
        if (mode === 'gems') {
            if (this.data.gems < LOST_PET_RECOVER_GEMS) { this.closeDialog(); this.showGemDialog(); return; }
            finish(); return;
        }
        this.requestRewardedAd(finish, '暂未找回');
    }

    public revivePetByAd(petId: number) {
        const pet = this.data.pets.find(p => p.id === petId);
        if (!pet || !pet.dead) { this.closeDialog(); return; }
        const finish = () => {
            const c = this.dailyCandidate();
            const target = c.pets.find(p => p.id === petId);
            if (!target) return;
            target.dead = false; target.lost = false; target.adventuring = false; target.adventureReturnAt = undefined;
            target.health = 100; target.hunger = 80; target.clean = 80; target.energy = 90; target.joy = 85;
            (c.adventureLogs || []).forEach(l => { if (l.petId === petId && (l.type === 'death_trafficker' || l.type === 'death_sick')) l.resolved = true; });
            if (!this.commitShop(c)) return;
            if (!this.actors.some(a => a.pet.id === petId)) this.spawnPet(target);
            this.syncActorVisibility();
            this.closeDialog();
            this.renderHeader();
            this.refreshMemorialEntry();
            if (this.page === 'diary' || this.page === 'memorial') {
                const pg = this.page;
                if (this.sheet) { this.sheet.destroy(); this.sheet = null; }
                this.open(pg);
            }
            this.toast('奇迹发生！「' + this.petDisplayName(petId) + '」满血复活回到庭院啦！');
        };
        this.requestRewardedAd(finish, '未能复活');
    }

    private refreshMemorialEntry() {
        const node = this.ui?.getChildByName('后院纪念角入口');
        if (!node) return;
        const hasDead = this.data.pets.some(p => p.dead);
        const hasMem = (this.data.memorials || []).length > 0;
        const hasTomb = Object.values(this.data.tombstoneInventory || {}).some(v => v > 0);
        node.active = this.page === 'home' && (hasDead || hasMem || hasTomb);
    }

    private renderAdventureDiary() {
        const panel = this.sheet!;
        this.dailySprite(panel, 'panel-clean', 0, 0, 921, 1390, true, '冒险日记底板');
        this.dailyText(panel, '冒险日记', 0, 422, 360, 48, 38);
        const close = this.uiNode(panel, '关闭日记', 380, 416, 84, 84);
        this.dailySprite(close, 'close', 0, 0, 78, 78);
        this.shopButton(close, () => this.open('home'));

        const logs = this.data.adventureLogs || [];
        const sub = this.dailyText(panel, `共记录 ${logs.length} 条冒险见闻（点击实物卡片可查看背包）`, 0, 316, 740, 34, 21);
        sub.node.name = '日记副标题';

        const vp = this.uiNode(panel, '日记滚动视口', 0, -142, 770, 840);
        vp.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        const content = this.uiNode(vp, '日记滚动内容', 0, 420, 770, Math.max(840, logs.length * 204 + 40));
        content.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
        const scroll = vp.addComponent(ScrollView);
        scroll.content = content; scroll.horizontal = false; scroll.vertical = true;
        scroll.cancelInnerEvents = true; scroll.elastic = true;

        if (!logs.length) {
            this.text(content, '还没有冒险记录，去林间挂机冒险看看吧！', 0, -240, 680, 44, 26, C.muted);
            return;
        }

        let curY = -12;
        logs.forEach((log) => {
            const pet = this.data.pets.find(p => p.id === log.petId);
            const hasItem = !!log.itemId && !!findItem(log.itemId);
            const needsAction = (log.type === 'lost' && pet?.lost) || ((log.type === 'death_trafficker' || log.type === 'death_sick') && pet?.dead);
            const cardH = hasItem ? 210 : needsAction ? 198 : 138;
            const card = this.uiNode(content, '日记条目-' + log.id, 0, curY - cardH / 2, 744, cardH);
            curY -= (cardH + 14);

            const bg = card.addComponent(Graphics);
            bg.fillColor = this.color(needsAction ? '#FFF3EE' : '#FFFBF0');
            bg.strokeColor = this.color(needsAction ? '#D96B52' : '#D9BE98');
            bg.lineWidth = needsAction ? 3.5 : 2.5;
            bg.roundRect(-372, -cardH / 2, 744, cardH, 20); bg.fill(); bg.stroke();

            const topY = cardH / 2 - 30;
            const d = new Date(log.time);
            const pad = (n: number) => ('0' + n).slice(-2);
            const timeStr = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
            const meta = eventBadgeMeta(log.type);
            this.pillBadge(card, meta.label, -304, topY, 112, 30, meta.color, C.white, 17);
            const titleLbl = this.text(card, `${log.petName} · ${log.title}`, -36, topY, 390, 32, 22, '#58351D');
            titleLbl.isBold = true; titleLbl.horizontalAlign = Label.HorizontalAlign.LEFT;
            const timeLbl = this.text(card, timeStr, 290, topY, 136, 26, 18, '#8C7055');
            timeLbl.horizontalAlign = Label.HorizontalAlign.RIGHT;

            const bodyLbl = this.text(card, log.text, 0, topY - 48, 700, 52, 20, '#634329');
            bodyLbl.horizontalAlign = Label.HorizontalAlign.LEFT; bodyLbl.enableWrapText = true; bodyLbl.lineHeight = 25;

            if (hasItem) {
                const item = findItem(log.itemId!)!;
                const itemCard = this.uiNode(card, '日志实物卡-' + item.id, 0, -cardH / 2 + 44, 696, 68);
                const ig = itemCard.addComponent(Graphics);
                ig.fillColor = this.color('#FFF4D6'); ig.strokeColor = this.color('#D8A85A'); ig.lineWidth = 2.5;
                ig.roundRect(-348, -34, 696, 68, 16); ig.fill(); ig.stroke();
                const slotBox = this.uiNode(itemCard, '日记道具槽', -306, 0, 58, 58);
                this.itemSlotBg(slotBox, this.itemQualityTheme(item), 58, 58, '日记道具底图');
                this.itemIcon(slotBox, item.id, 0, 0, 44);
                const il = this.text(itemCard, `${item.name} ×${log.itemCount || 1}`, -110, 10, 310, 28, 21, '#58351D');
                il.isBold = true; il.horizontalAlign = Label.HorizontalAlign.LEFT;
                const ef = this.text(itemCard, effectText(item), -110, -16, 310, 24, 17, '#7A5B3E');
                ef.horizontalAlign = Label.HorizontalAlign.LEFT;
                this.pillBadge(itemCard, itemCategoryTag(item), 156, 0, 86, 28, '#5C9B68', C.white, 17);
                const goBag = this.text(itemCard, '查看背包 ›', 284, 0, 110, 28, 19, '#B86420'); goBag.isBold = true;
                this.intercept(itemCard); this.pressVisualFeedback(itemCard);
                itemCard.on(Node.EventType.TOUCH_END, () => { this.bagFilter = item.category; this.open('bag'); }, this);
            } else if (needsAction) {
                const btnY = -cardH / 2 + 38;
                if (log.type === 'lost') {
                    this.bagButton(card, '看广告找回', -150, btnY, 240, 50, () => this.recoverLostPet(log.petId, 'ad'));
                    const gemBtn = this.bagButton(card, '钻石找回', 150, btnY, 240, 50, () => this.recoverLostPet(log.petId, 'gems'));
                    const gemLbl = gemBtn.children.find(ch => ch.getComponent(Label));
                    if (gemLbl) gemLbl.setPosition(-38, 0, 0);
                    this.addPriceTag(gemBtn, 'gems', LOST_PET_RECOVER_GEMS, 56, 0, 28, '#FFFFFF');
                } else {
                    this.bagButton(card, '看广告复活', -150, btnY, 240, 50, () => this.revivePetByAd(log.petId));
                    this.bagButton(card, '立碑纪念', 150, btnY, 240, 50, () => { this.open('memorial'); this.showErectTombstoneDialog(log.petId); });
                }
            }
        });
        content.getComponent(UITransform)!.setContentSize(770, Math.max(840, -curY + 24));
    }

    private renderMemorialCorner() {
        const panel = this.sheet!;
        this.dailySprite(panel, 'panel-clean', 0, 0, 921, 1390, true, '后院纪念角底板');
        this.dailyText(panel, '后院纪念角', 0, 422, 360, 48, 38);
        const close = this.uiNode(panel, '关闭纪念角', 380, 416, 84, 84);
        this.dailySprite(close, 'close', 0, 0, 78, 78);
        this.shopButton(close, () => this.open('home'));

        this.dailyText(panel, '点击已立墓碑可重温生平照片与冒险高光记录', -70, 316, 560, 34, 21);
        const buyTombBtn = this.bagButton(panel, '去买墓碑 ›', 282, 316, 174, 46, () => { this.shopTab = 'tombstones'; this.open('shop'); });
        buyTombBtn.name = '纪念角买墓碑按钮';

        const memorials = this.data.memorials || [];
        const deadUnmemorialized = this.data.pets.filter(p => p.dead && !memorials.some(m => m.petId === p.id));

        const vp = this.uiNode(panel, '纪念角视口', 0, -142, 770, 840);
        vp.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        const content = this.uiNode(vp, '纪念角内容', 0, 420, 770, 840);
        content.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
        const scroll = vp.addComponent(ScrollView);
        scroll.content = content; scroll.horizontal = false; scroll.vertical = true;
        scroll.cancelInnerEvents = true; scroll.elastic = true;

        let curY = -16;
        if (deadUnmemorialized.length) {
            deadUnmemorialized.forEach(pet => {
                const row = this.uiNode(content, '待立碑伙伴-' + pet.id, 0, curY - 62, 740, 118);
                curY -= 132;
                const rg = row.addComponent(Graphics);
                rg.fillColor = this.color('#FFF5EA'); rg.strokeColor = this.color('#D89A6C'); rg.lineWidth = 3;
                rg.roundRect(-370, -59, 740, 118, 22); rg.fill(); rg.stroke();
                this.petAvatar(row, pet.id, -296, 0, 88);
                const nl = this.text(row, `${this.petDisplayName(pet.id)}（${pet.deathReason || '已离世'}）`, -40, 18, 390, 32, 22, '#58351D');
                nl.isBold = true; nl.horizontalAlign = Label.HorizontalAlign.LEFT;
                const sl = this.text(row, '可立碑刻字永远纪念，或观看广告复活', -40, -18, 390, 26, 18, '#7A5B3E');
                sl.horizontalAlign = Label.HorizontalAlign.LEFT;
                const erectBtn = this.bagButton(row, '立碑纪念', 248, 22, 168, 44, () => this.showErectTombstoneDialog(pet.id));
                erectBtn.name = '立碑按钮-' + pet.id;
                this.bagButton(row, '广告复活', 248, -26, 168, 42, () => this.revivePetByAd(pet.id));
            });
        }

        if (!memorials.length && !deadUnmemorialized.length) {
            this.text(content, '庭院里所有伙伴都健康陪伴着你！\n若伙伴不幸离世，可在此立碑刻字永远纪念。', 0, -240, 680, 96, 24, C.muted);
        } else if (memorials.length) {
            memorials.forEach((rec, idx) => {
                const col = idx % 2, rowIdx = Math.floor(idx / 2);
                const cx = col === 0 ? -186 : 186;
                const cy = curY - 196 - rowIdx * 404;
                const card = this.uiNode(content, '已立墓碑-' + rec.petId, cx, cy, 356, 384);
                const cardBgSp = this.uiNode(card, '墓碑纪念卡底图', 0, 0, 356, 384).addComponent(Sprite);
                cardBgSp.sizeMode = Sprite.SizeMode.CUSTOM;
                resources.load('art/memorial/memorial-card-bg/spriteFrame', SpriteFrame, (e, f) => {
                    if (!e && f && isValid(cardBgSp, true)) cardBgSp.spriteFrame = f;
                });
                const tomb = findTombstone(rec.tombstoneId) || TOMBSTONE_CATALOG[0];
                const tsp = this.uiNode(card, '墓碑图', 0, 62, 166, 166).addComponent(Sprite);
                tsp.sizeMode = Sprite.SizeMode.CUSTOM;
                resources.load('art/memorial/' + tomb.artKey + '/spriteFrame', SpriteFrame, (e, f) => {
                    if (!e && f && isValid(tsp, true)) tsp.spriteFrame = f;
                });
                const nLbl = this.text(card, rec.customName, 0, -44, 300, 34, 25, '#4E3422'); nLbl.isBold = true;
                const eLbl = this.text(card, `「${rec.epitaph}」`, 0, -90, 290, 50, 18, '#6D5239');
                eLbl.enableWrapText = true; eLbl.lineHeight = 23;
                const hint = this.text(card, '点击重温生平与冒险高光 ›', 0, -138, 280, 26, 17, '#3D7A38'); hint.isBold = true;
                this.intercept(card); this.pressVisualFeedback(card);
                card.on(Node.EventType.TOUCH_END, () => this.showMemorialDetailDialog(rec), this);
            });
            curY -= Math.ceil(memorials.length / 2) * 404 + 24;
        }
        content.getComponent(UITransform)!.setContentSize(770, Math.max(840, -curY + 24));
    }

    public showErectTombstoneDialog(petId: number) {
        if (this.dialog) this.closeDialog();
        const pet = this.data.pets.find(p => p.id === petId);
        if (!pet) return;
        const overlay = this.uiNode(this.ui, '通用弹窗遮罩', 0, 0, this.width, this.height);
        this.dialog = overlay;
        overlay.addComponent(Graphics); this.intercept(overlay);

        const panel = this.uiNode(overlay, '通用弹窗面板', 0, 0, 880, 1120);
        this.intercept(panel);
        const panelBg = this.uiNode(panel, '立碑弹窗底图', 0, 0, 880, 1120).addComponent(Sprite);
        panelBg.sizeMode = Sprite.SizeMode.CUSTOM;
        resources.load('art/memorial/memorial-dialog-bg/spriteFrame', SpriteFrame, (e, f) => {
            if (!e && f && isValid(panelBg, true)) panelBg.spriteFrame = f;
        });
        this.headerText(panel, '立碑刻字纪念', 0, 478, 420, 48, 36).node.name = '弹窗独立标题';
        const close = this.shopArt(panel, 'close', 386, 356, 68, 69);
        this.shopButton(close, () => this.closeDialog());

        let selectedTomb: TombstoneId = TOMBSTONE_CATALOG.find(t => ((this.data.tombstoneInventory || {})[t.id] || 0) > 0)?.id || 'tomb_stone';
        const redraws: Array<() => void> = [];
        const svVp = this.uiNode(panel, '立碑选碑视口', 0, 198, 720, 256);
        svVp.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        const slotW = 216, slotGap = 16;
        const totalW = Math.max(720, TOMBSTONE_CATALOG.length * (slotW + slotGap) + 24);
        const svContent = this.uiNode(svVp, '立碑选碑列表', -360, 0, totalW, 252);
        svContent.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
        const sv = svVp.addComponent(ScrollView);
        sv.content = svContent; sv.horizontal = true; sv.vertical = false; sv.cancelInnerEvents = true; sv.elastic = true;

        TOMBSTONE_CATALOG.forEach((tomb, idx) => {
            const x = 16 + slotW / 2 + idx * (slotW + slotGap);
            const slot = this.uiNode(svContent, '选墓碑-' + tomb.id, x, 0, slotW, 242);
            const sg = slot.addComponent(Graphics);
            const iconSlot = this.uiNode(slot, '选碑图标槽', 0, 38, 114, 114);
            this.itemSlotBg(iconSlot, tomb.slotTheme, 114, 114, '选碑槽底图');
            const sp = this.uiNode(iconSlot, '墓碑预览', 0, 2, 92, 92).addComponent(Sprite);
            sp.sizeMode = Sprite.SizeMode.CUSTOM;
            resources.load('art/memorial/' + tomb.artKey + '/spriteFrame', SpriteFrame, (e, f) => { if (!e && f && isValid(sp, true)) sp.spriteFrame = f; });
            if (tomb.limited) this.pillBadge(slot, '限定', 66, 94, 58, 24, '#D94343', C.white, 15);
            const nl = this.text(slot, tomb.name, 0, -44, 200, 28, 19, '#58351D');
            nl.isBold = true; nl.overflow = Label.Overflow.SHRINK; nl.enableWrapText = false;
            const owned = (this.data.tombstoneInventory || {})[tomb.id] || 0;
            if (owned > 0) {
                const pl = this.text(slot, `已拥有 ×${owned}`, 0, -82, 196, 26, 18, '#228B3C'); pl.isBold = true;
            } else if (tomb.unlockMode === 'ad') {
                const pl = this.text(slot, '商店看广告解锁', 0, -82, 196, 26, 17, '#C94A29'); pl.isBold = true;
            } else {
                this.addPriceTag(slot, 'gems', tomb.priceGems, 4, -82, 24, '#C96A22');
            }
            const redraw = () => {
                const active = selectedTomb === tomb.id;
                sg.clear();
                sg.fillColor = this.color(active ? '#FFF1C2' : '#FFFDF7');
                sg.strokeColor = this.color(active ? '#E69924' : '#D9BE98');
                sg.lineWidth = active ? 4.5 : 2.5;
                sg.roundRect(-slotW / 2, -121, slotW, 242, 20); sg.fill(); sg.stroke();
            };
            redraws.push(redraw); redraw();
            this.intercept(slot); this.pressVisualFeedback(slot);
            slot.on(Node.EventType.TOUCH_END, () => { selectedTomb = tomb.id; redraws.forEach(fn => fn()); }, this);
        });

        const makeSingleInput = (labelText: string, y: number, initVal: string, maxLen: number, ph: string): EditBox => {
            const lbl = this.text(panel, labelText, -270, y + 48, 220, 30, 22, '#6E4627');
            lbl.isBold = true; lbl.horizontalAlign = Label.HorizontalAlign.LEFT;
            const box = this.uiNode(panel, '立碑输入-' + labelText, 0, y, 740, 64);
            box.active = false;
            const g = box.addComponent(Graphics);
            g.fillColor = this.color('#FFFDF7'); g.strokeColor = this.color('#B88652'); g.lineWidth = 3;
            g.roundRect(-370, -32, 740, 64, 16); g.fill(); g.stroke();
            const tn = this.uiNode(box, 'TEXT_LABEL', -354, 32, 708, 64);
            tn.getComponent(UITransform)!.setAnchorPoint(0, 1);
            const tl = tn.addComponent(Label);
            tl.fontSize = 24; tl.lineHeight = 32; tl.color = this.color('#4E2F1A');
            tl.horizontalAlign = Label.HorizontalAlign.CENTER; tl.verticalAlign = Label.VerticalAlign.CENTER;
            tl.overflow = Label.Overflow.CLAMP; tl.enableWrapText = false;
            const pn = this.uiNode(box, 'PLACEHOLDER_LABEL', -354, 32, 708, 64);
            pn.getComponent(UITransform)!.setAnchorPoint(0, 1);
            const pl = pn.addComponent(Label);
            pl.fontSize = 22; pl.lineHeight = 32; pl.color = this.color('#A99278');
            pl.horizontalAlign = Label.HorizontalAlign.CENTER; pl.verticalAlign = Label.VerticalAlign.CENTER;
            pl.overflow = Label.Overflow.CLAMP; pl.enableWrapText = false;
            const eb = box.addComponent(EditBox);
            eb.inputMode = EditBox.InputMode.SINGLE_LINE; eb.returnType = EditBox.KeyboardReturnType.DONE;
            eb.textLabel = tl; eb.placeholderLabel = pl; eb.maxLength = maxLen; eb.placeholder = ph; eb.string = initVal;
            box.active = true;
            return eb;
        };

        const nameEb = makeSingleInput('刻字名字', 16, this.petDisplayName(petId), 10, '输入宠物名字');
        const epitaphEb = makeSingleInput('纪念墓志铭', -120, '永远记得陪我度过的每一个晴天', 28, '写下想对它说的话');

        const confirmBtn = this.shopArt(panel, 'buy', -160, -390, 270, 270 * 120 / 321);
        confirmBtn.name = '弹窗按钮-确认立碑';
        this.headerText(confirmBtn, '确认立碑', 0, 0, 220, 44, 28);
        this.shopButton(confirmBtn, () => {
            const tomb = findTombstone(selectedTomb)!;
            const owned = (this.data.tombstoneInventory || {})[selectedTomb] || 0;
            if (owned <= 0 && tomb.unlockMode === 'ad') {
                this.unlockTombstoneByAd(selectedTomb); return;
            }
            if (owned <= 0 && this.data.gems < tomb.priceGems) {
                this.closeDialog(); this.showGemDialog(); return;
            }
            const customName = (nameEb.string || '').trim() || this.petDisplayName(petId);
            const epitaph = (epitaphEb.string || '').trim() || '永远怀念你，我的好伙伴';
            const c = this.dailyCandidate();
            c.tombstoneInventory = { ...(c.tombstoneInventory || {}) };
            if (owned > 0) c.tombstoneInventory[selectedTomb] = owned - 1;
            else c.gems -= tomb.priceGems;
            const nextRec: MemorialRecord = {
                petId, tombstoneId: selectedTomb, customName, epitaph,
                diedAt: pet.diedAt || Date.now(), deathReason: pet.deathReason || '已离开庭院', erectedAt: Date.now(),
            };
            c.memorials = [...(c.memorials || []).filter(m => m.petId !== petId), nextRec];
            if (!this.commitShop(c)) return;
            this.closeDialog();
            this.renderHeader();
            this.refreshMemorialEntry();
            if (this.sheet && isValid(this.sheet, true)) { this.sheet.removeFromParent(); this.sheet.destroy(); this.sheet = null; }
            this.open('memorial');
            this.toast('已为「' + customName + '」立碑纪念');
        });

        const cancelBtn = this.shopArt(panel, 'buy', 160, -390, 270, 270 * 120 / 321);
        cancelBtn.name = '弹窗按钮-取消';
        this.headerText(cancelBtn, '取消', 0, 0, 220, 44, 28);
        this.shopButton(cancelBtn, () => this.closeDialog());
        this.layoutDialog();
    }

    private showMemorialDetailDialog(rec: MemorialRecord) {
        if (this.dialog) this.closeDialog();
        const pet = this.data.pets.find(p => p.id === rec.petId);
        const breed = BREEDS[rec.petId];
        const tomb = findTombstone(rec.tombstoneId) || TOMBSTONE_CATALOG[0];
        const highlights = (this.data.adventureLogs || []).filter(l => l.petId === rec.petId).slice(0, 3);

        const overlay = this.uiNode(this.ui, '通用弹窗遮罩', 0, 0, this.width, this.height);
        this.dialog = overlay;
        overlay.addComponent(Graphics); this.intercept(overlay);
        const panel = this.uiNode(overlay, '通用弹窗面板', 0, 0, 880, 1120);
        this.intercept(panel);
        const panelBg = this.uiNode(panel, '怀念弹窗底图', 0, 0, 880, 1120).addComponent(Sprite);
        panelBg.sizeMode = Sprite.SizeMode.CUSTOM;
        resources.load('art/memorial/memorial-dialog-bg/spriteFrame', SpriteFrame, (e, f) => {
            if (!e && f && isValid(panelBg, true)) panelBg.spriteFrame = f;
        });
        this.headerText(panel, `怀念 · ${rec.customName}`, 0, 478, 480, 48, 34).node.name = '弹窗独立标题';
        const close = this.shopArt(panel, 'close', 386, 356, 68, 69);
        this.shopButton(close, () => this.closeDialog());

        // 左侧墓碑（带品质槽底框）+ 右侧生平全身照
        const tombSlot = this.uiNode(panel, '追思墓碑槽', -168, 210, 206, 206);
        this.itemSlotBg(tombSlot, tomb.slotTheme, 206, 206, '追思墓碑底图');
        const tsp = this.uiNode(tombSlot, '追思墓碑图', 0, 4, 168, 168).addComponent(Sprite);
        tsp.sizeMode = Sprite.SizeMode.CUSTOM;
        resources.load('art/memorial/' + tomb.artKey + '/spriteFrame', SpriteFrame, (e, f) => { if (!e && f && isValid(tsp, true)) tsp.spriteFrame = f; });
        const photoFrame = this.uiNode(panel, '生平照片框', 164, 210, 206, 206);
        this.itemSlotBg(photoFrame, 'general', 206, 206, '生平照片底框');
        const psp = this.uiNode(photoFrame, '生平全身照', 0, 0, 174, 174).addComponent(Sprite);
        psp.sizeMode = Sprite.SizeMode.CUSTOM;
        void this.loadPetPortrait(breed.skin).then(f => { if (f && isValid(psp, true)) psp.spriteFrame = f; });

        // 墓志铭铭牌
        const epBox = this.uiNode(panel, '墓志铭卡片', 0, 32, 680, 114);
        const ebg = epBox.addComponent(Graphics);
        ebg.fillColor = this.color('#F5EFDE'); ebg.strokeColor = this.color('#C8B48E'); ebg.lineWidth = 2.5;
        ebg.roundRect(-340, -57, 680, 114, 18); ebg.fill(); ebg.stroke();
        const epLbl = this.text(epBox, `“ ${rec.epitaph} ”`, 0, 14, 640, 50, 23, '#4E3422'); epLbl.isBold = true; epLbl.enableWrapText = true;
        this.text(epBox, `${tomb.name} · 离别原因：${rec.deathReason}`, 0, -34, 640, 26, 18, '#8A745E');

        // 冒险高光记录
        this.headerText(panel, '生平冒险高光记录', 0, -64, 360, 36, 24);
        if (!highlights.length) {
            this.text(panel, '它曾静静陪伴你度过庭院里的温暖时光。', 0, -162, 660, 40, 21, C.muted);
        } else {
            highlights.forEach((h, i) => {
                const hl = this.text(panel, `• [${eventBadgeMeta(h.type).label}] ${h.text}`, 0, -118 - i * 68, 660, 58, 19, '#5E4028');
                hl.horizontalAlign = Label.HorizontalAlign.LEFT; hl.enableWrapText = true; hl.lineHeight = 24;
            });
        }

        if (pet?.dead) {
            const rev = this.shopArt(panel, 'buy', -154, -408, 252, 252 * 120 / 321);
            this.headerText(rev, '看广告复活', 0, 0, 210, 40, 26);
            this.shopButton(rev, () => this.revivePetByAd(rec.petId));
        }
        const ok = this.shopArt(panel, 'buy', pet?.dead ? 154 : 0, -408, 252, 252 * 120 / 321);
        this.headerText(ok, '收起怀念', 0, 0, 210, 40, 26);
        this.shopButton(ok, () => this.closeDialog());
        this.layoutDialog();
    }
    private layoutNotice() {
        const panel = this.notice?.node.parent;
        if (!panel) return;
        panel.setPosition(0, -this.height / 2 + 555, 0);
        panel.setSiblingIndex(this.ui.children.length - 1);
    }

    private toast(message: string) {
        if (!this.notice) return;
        const panel = this.notice.node.parent!;
        if (this.page !== 'home' && Date.now() > this.noticeUntil && this.notice) {
            this.notice.string = '';
            this.notice.node.parent?.getComponent(Graphics)?.clear();
        }
        this.layoutNotice();
        const g = panel.getComponent(Graphics) || panel.addComponent(Graphics);
        g.clear(); g.fillColor = new Color(76, 47, 26, 240);
        g.roundRect(-480, -37, 960, 74, 22); g.fill();
        this.notice.color = this.color('#FFF5D9'); this.notice.isBold = true;
        this.notice.fontSize = 30; this.notice.lineHeight = 39;
        this.notice.enableOutline = true; this.notice.outlineColor = this.color('#442A19'); this.notice.outlineWidth = 2;
        this.notice.string = message; this.noticeUntil = Date.now() + 4500;
    }

    private onWorldTouch(event: EventTouch) {
        const location = event.getLocation();
        if (this.dialog || this.gmPanel || Date.now() < this.blockedUntil) return;
        const screen = new Vec3(location.x, location.y, 0), uiWorld = new Vec3(); this.uiCamera.screenToWorld(screen, uiWorld);
        const point = this.ui.getComponent(UITransform)!.convertToNodeSpaceAR(uiWorld);
        const hits = (n: Node) => {
            const size = n.getComponent(UITransform)!.contentSize;
            return Math.abs(point.x - n.position.x) <= size.width / 2 && Math.abs(point.y - n.position.y) <= size.height / 2;
        };
        if (hits(this.top) || hits(this.bottom) || (this.sheet && hits(this.sheet))) return;
        // 优先检测是否点中庭院 3D 便便，点击即可清理。
        if (this.page === 'home' || this.page === 'pet') {
            let closestPoop: YardPoop | null = null, poopDist = 56;
            (this.data.poops || []).forEach(pp => {
                const proj = new Vec3();
                this.worldCamera.worldToScreen(new Vec3(pp.x, 0.16, pp.z), proj);
                const d = Vec2.distance(location, new Vec2(proj.x, proj.y));
                if (proj.z >= 0 && proj.z <= 1 && d < poopDist) { poopDist = d; closestPoop = pp; }
            });
            if (closestPoop) { this.cleanYardPoop((closestPoop as YardPoop).id); return; }
        }
        let closest: Actor | null = null, distance = 90;
        this.actors.forEach(actor => {
            if (!isValid(actor.node, true) || !actor.node.active || actor.pet.adventuring || actor.pet.dead || actor.pet.lost) return;
            const projected = new Vec3(); this.worldCamera.worldToScreen(new Vec3(actor.node.worldPosition.x, actor.node.worldPosition.y + 0.48, actor.node.worldPosition.z), projected);
            const d = Vec2.distance(location, new Vec2(projected.x, projected.y));
            if (projected.z >= 0 && projected.z <= 1 && d < distance) { distance = d; closest = actor; }
        });
        if (closest) {
            const id = (closest as Actor).pet.id;
            if (this.selected !== id) this.careSelected = '';
            if (this.page !== 'pet' || !this.petSelected || this.selected !== id) { this.selected = id; this.open('pet'); }
        } else if (this.petSelected && (this.page === 'pet' || this.page === 'bag')) this.open('home');
    }
    private spawnYardPoop(petId: number, x: number, z: number) {
        if (!this.data.poops) this.data.poops = [];
        if (this.data.poops.length >= 6) return;
        const id = ++this.poopNextId;
        const clampedX = Math.max(this.yardMinX + 0.25, Math.min(this.yardMaxX - 0.25, x));
        const clampedZ = Math.max(this.yardMinZ + 0.25, Math.min(this.yardMaxZ - 0.25, z));
        this.data.poops.push({ id, petId, x: clampedX, z: clampedZ, createdAt: Date.now() });
        this.dirty = true;
        this.persist();
        if (this.data.poops.length >= 3 && (this.page === 'home' || this.page === 'pet')) {
            this.toast('庭院便便过多，伙伴清洁度正在加速下降，快点击清理吧！');
        }
    }

    private cleanYardPoop(poopId: number) {
        if (!this.data.poops) return;
        const poop = this.data.poops.find(p => p.id === poopId);
        if (!poop) return;
        const c = this.dailyCandidate();
        c.poops = (c.poops || []).filter(p => p.id !== poopId);
        c.coins = Math.min(100000000, c.coins + 5);
        c.xp = Math.min(100000000, c.xp + 4);
        const targetPet = c.pets.find(p => p.id === poop.petId && !p.dead) || c.pets.find(p => !p.dead);
        if (targetPet) {
            targetPet.clean = Math.min(100, targetPet.clean + 8);
            const actor = this.actors.find(a => a.pet.id === targetPet.id);
            if (actor) actor.pet = targetPet;
        }
        recordDaily(c.daily, 'clean');
        if (!this.commitShop(c)) return;
        this.playBroomSweep(new Vec3(poop.x, 0.16, poop.z));
        const vis = this.poopVisuals.get(poopId);
        if (vis) {
            vis.smokes.forEach(s => s.mat.destroy());
            if (isValid(vis.node, true)) { vis.node.active = false; vis.node.destroy(); }
            this.poopVisuals.delete(poopId);
        }
        this.renderHeader();
        if (this.page === 'pet') this.open('pet');
        this.toast('清理便便成功，庭院更干净啦'); this.showRewardToast([{ kind: 'coins', amount: 5 }]);
    }

    private getPoopMaterial(): Material {
        let mat = this.materials.get('yard:poop');
        if (!mat) {
            mat = new Material();
            mat.initialize({
                effectName: 'builtin-unlit',
                technique: 1,
                defines: { USE_TEXTURE: true },
                states: {
                    rasterizerState: { cullMode: 0 },
                    depthStencilState: { depthTest: true, depthWrite: false },
                },
            });
            mat.setProperty('mainColor', this.color(C.white));
            this.materials.set('yard:poop', mat);
            resources.load('art/yard/poop/texture', Texture2D, (err, tex) => {
                if (!err && tex && isValid(this, true)) mat!.setProperty('mainTexture', tex);
            });
        }
        return mat;
    }

    private syncYardPoops(dt: number) {
        if (!isValid(this.world, true) || !this.worldCamera) return;
        const list = this.data.poops || [];
        const activeIds = new Set(list.map(p => p.id));

        // 清理已消失的 3D 便便节点
        this.poopVisuals.forEach((vis, id) => {
            if (!activeIds.has(id) || !isValid(vis.node, true)) {
                vis.smokes.forEach(s => s.mat.destroy());
                if (isValid(vis.node, true)) { vis.node.active = false; vis.node.destroy(); }
                this.poopVisuals.delete(id);
            }
        });
        if (!list.length) return;

        let quadMesh = this.meshes.get('yard:poop-quad');
        if (!quadMesh) {
            quadMesh = utils.createMesh(primitives.quad());
            this.meshes.set('yard:poop-quad', quadMesh);
        }
        let smokeMesh = this.meshes.get('yard:poop-smoke');
        if (!smokeMesh) {
            smokeMesh = utils.createMesh(primitives.sphere(0.072, { segments: 10 }));
            this.meshes.set('yard:poop-smoke', smokeMesh);
        }
        const poopMat = this.getPoopMaterial();
        const camRot = this.worldCamera.node.worldRotation;

        for (const poop of list) {
            let vis = this.poopVisuals.get(poop.id);
            if (!vis) {
                // 直接挂载在 3D world 场景中，尺寸小巧（约小猫小狗的 1/3）且自带真实 3D 深度前后遮挡。
                const root = new Node('庭院便便-' + poop.id);
                root.layer = Layers.Enum.DEFAULT;
                this.world.addChild(root);
                root.setPosition(poop.x, 0, poop.z);

                const quad = new Node('便便3D片');
                quad.layer = Layers.Enum.DEFAULT;
                root.addChild(quad);
                quad.setPosition(0, 0.16, 0);
                // Cocos 3.8 primitives.quad() 纹理 V 轴与 Texture2D 相反，Y 取负值使便便尖端朝上正立。
                quad.setScale(0.38, -0.38, 0.38);
                const mr = quad.addComponent(MeshRenderer);
                mr.mesh = quadMesh;
                mr.setSharedMaterial(poopMat, 0);
                mr.shadowCastingMode = 0; mr.receiveShadow = 0;

                // 3 缕 3D 飘升臭烟（随小猫小狗一起参与真实深度排序）
                const smokes: PoopVisual['smokes'] = [];
                for (let s = 0; s < 3; s++) {
                    const sn = new Node('便便3D烟-' + s);
                    sn.layer = Layers.Enum.DEFAULT;
                    root.addChild(sn);
                    const smr = sn.addComponent(MeshRenderer);
                    smr.mesh = smokeMesh;
                    const smat = new Material();
                    smat.initialize({
                        effectName: 'builtin-unlit',
                        technique: 1,
                        states: { depthStencilState: { depthTest: true, depthWrite: false } },
                    });
                    smat.setProperty('mainColor', new Color(172, 192, 126, 145));
                    smr.setSharedMaterial(smat, 0);
                    smr.shadowCastingMode = 0; smr.receiveShadow = 0;
                    smokes.push({ node: sn, mat: smat, phase: s / 3 });
                }
                vis = { node: root, quad, poop, smokes };
                this.poopVisuals.set(poop.id, vis);
            }
            // 冒险全屏模式下隐藏庭院便便，避免浮现在冒险小路上
            vis.node.active = this.page !== 'adventure';
            if (!vis.node.active) continue;
            // Billboard 始终面向主摄像机
            vis.quad.setWorldRotation(camRot);
            // 更新 3D 飘烟上升、摇曳与淡出
            vis.smokes.forEach((sm, idx) => {
                sm.phase = (sm.phase + dt * 0.85) % 1;
                const t = sm.phase;
                const swayX = Math.sin(t * Math.PI * 2 + idx * 2.1) * (0.06 + t * 0.05);
                const swayZ = Math.cos(t * Math.PI * 2 + idx * 1.7) * 0.03;
                sm.node.setPosition(swayX, 0.24 + t * 0.56, swayZ);
                const sc = 0.55 + t * 1.05;
                sm.node.setScale(sc, sc * 0.85, sc);
                const alpha = Math.round(Math.sin(t * Math.PI) * 195);
                sm.mat.setProperty('mainColor', new Color(196, 214, 146, alpha));
            });
        }
    }

    private playPetGhostRise(worldPos: Vec3) {
        if (!isValid(this.ui, true) || !this.worldCamera || !this.uiCamera) return;
        if (!this.bubbleLayer || !isValid(this.bubbleLayer, true)) {
            this.bubbleLayer = this.uiNode(this.ui, '伙伴相遇气泡层', 0, 0, this.width, this.height);
            this.bubbleLayer.setSiblingIndex(0);
        }
        const screen = this.worldCamera.worldToScreen(new Vec3(worldPos.x, worldPos.y + 0.55, worldPos.z), new Vec3());
        const uiWorld = this.uiCamera.screenToWorld(screen, new Vec3());
        const local = this.bubbleLayer.getComponent(UITransform)!.convertToNodeSpaceAR(uiWorld);
        const ghostNode = this.uiNode(this.bubbleLayer, '宠物鬼魂', local.x, local.y, 128, 128);
        const sp = ghostNode.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
        resources.load('art/yard/pet-ghost/spriteFrame', SpriteFrame, (err, frame) => {
            if (!err && frame && isValid(sp, true)) sp.spriteFrame = frame;
        });
        const op = ghostNode.addComponent(UIOpacity);
        op.opacity = 235;
        this.ghosts.push({ node: ghostNode, op, baseX: local.x, baseY: local.y, age: 0, duration: 2.6 });
    }

    private updateGhosts(dt: number) {
        if (!this.ghosts.length) return;
        this.ghosts = this.ghosts.filter(g => {
            if (!isValid(g.node, true)) return false;
            g.age += dt;
            if (g.age >= g.duration) {
                g.node.active = false; g.node.destroy();
                return false;
            }
            const t = g.age / g.duration;
            const sway = Math.sin(t * Math.PI * 3.5) * 24;
            g.node.setPosition(g.baseX + sway, g.baseY + t * 280, 0);
            const sc = 0.65 + Math.sin(Math.min(1, t * 2) * Math.PI * 0.5) * 0.42;
            g.node.setScale(sc, sc, 1);
            g.op.opacity = Math.round((t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8) * 235);
            return true;
        });
    }

    private playBroomSweep(worldPos: Vec3) {
        if (!isValid(this.ui, true) || !this.worldCamera || !this.uiCamera) return;
        if (!this.bubbleLayer || !isValid(this.bubbleLayer, true)) {
            this.bubbleLayer = this.uiNode(this.ui, '伙伴相遇气泡层', 0, 0, this.width, this.height);
            this.bubbleLayer.setSiblingIndex(0);
        }
        const screen = this.worldCamera.worldToScreen(worldPos, new Vec3());
        const uiWorld = this.uiCamera.screenToWorld(screen, new Vec3());
        const local = this.bubbleLayer.getComponent(UITransform)!.convertToNodeSpaceAR(uiWorld);
        const root = this.uiNode(this.bubbleLayer, '扫把清扫特效', local.x, local.y, 160, 160);
        const op = root.addComponent(UIOpacity);
        op.opacity = 255;

        const broom = this.uiNode(root, '扫把图', 22, 34, 118, 118);
        const sp = broom.addComponent(Sprite); sp.sizeMode = Sprite.SizeMode.CUSTOM;
        resources.load('art/yard/broom/spriteFrame', SpriteFrame, (err, frame) => {
            if (!err && frame && isValid(sp, true)) sp.spriteFrame = frame;
        });

        // 7 颗闪亮星星与洁净泡泡随清扫飞溅散开
        const sparkles: BroomSweep['sparkles'] = [];
        for (let i = 0; i < 7; i++) {
            const sn = this.uiNode(root, '清扫星光-' + i, (i - 3) * 10, -4, 24, 24);
            const g = sn.addComponent(Graphics);
            const isStar = i % 2 === 0;
            g.fillColor = this.color(isStar ? '#FFE678' : '#E8F9FF');
            if (isStar) {
                g.moveTo(0, 10); g.lineTo(3, 3); g.lineTo(10, 0); g.lineTo(3, -3);
                g.lineTo(0, -10); g.lineTo(-3, -3); g.lineTo(-10, 0); g.lineTo(-3, 3); g.close(); g.fill();
            } else {
                g.circle(0, 0, 6.5); g.fill();
                g.fillColor = this.color('#FFFFFF'); g.circle(-2, 2, 2); g.fill();
            }
            const sop = sn.addComponent(UIOpacity);
            const ang = (Math.PI * 0.15) + (i / 6) * (Math.PI * 0.7);
            const spd = 75 + (i % 3) * 28;
            sparkles.push({ node: sn, vx: Math.cos(ang) * spd * (i % 2 ? 1 : -1), vy: Math.sin(ang) * spd + 25, op: sop });
        }
        this.brooms.push({ node: root, broom, op, sparkles, age: 0, duration: 0.82 });
    }

    private updateBrooms(dt: number) {
        if (!this.brooms.length) return;
        this.brooms = this.brooms.filter(b => {
            if (!isValid(b.node, true)) return false;
            b.age += dt;
            if (b.age >= b.duration) {
                b.node.active = false; b.node.destroy();
                return false;
            }
            const t = b.age / b.duration;
            // 来回两下轻快清扫摆动（左右位移 + 倾斜扫动）
            const sweep = Math.sin(t * Math.PI * 4);
            b.broom.setPosition(18 + sweep * 34, 34 + Math.abs(sweep) * 10, 0);
            b.broom.setRotationFromEuler(0, 0, -14 + sweep * 26);
            b.op.opacity = Math.round((t < 0.15 ? t / 0.15 : t > 0.72 ? (1 - t) / 0.28 : 1) * 255);
            b.sparkles.forEach(s => {
                const pos = s.node.position;
                s.node.setPosition(pos.x + s.vx * dt, pos.y + s.vy * dt, 0);
                s.vy -= 140 * dt;
                const sc = 0.75 + Math.sin(t * Math.PI) * 0.45;
                s.node.setScale(sc, sc, 1);
                s.op.opacity = Math.round((1 - t) * 245);
            });
            return true;
        });
    }

    public triggerPetDeath(pet: Pet, reason = '长期未喂养/清洁导致重病') {
        if (pet.dead) return;
        pet.dead = true;
        pet.health = 0;
        pet.deathReason = reason;
        pet.diedAt = Date.now();
        this.dirty = true;
        this.persist();
        this.recordAdventureLog({
            petId: pet.id, petName: this.petDisplayName(pet.id), type: 'death_sick',
            title: '重病离世', text: `「${this.petDisplayName(pet.id)}」因${reason}离开了庭院……`, resolved: false,
        });
        this.refreshMemorialEntry();
        const actor = this.actors.find(a => a.pet.id === pet.id);
        const inYard = this.page === 'home' || this.page === 'pet';
        if (this.selected === pet.id && (this.page === 'pet' || this.page === 'bag')) {
            this.open('home');
        }
        if (actor && isValid(actor.node, true)) {
            if (inYard) {
                actor.dying = 0.001;
                actor.ghostSpawned = false;
                this.toast('「' + this.petDisplayName(pet.id) + '」因' + reason + '离开了庭院…');
            } else {
                actor.node.active = false;
                actor.node.destroy();
                this.actors = this.actors.filter(a => a !== actor);
            }
        }
    }

    private tick = () => {
        this.elapsed++;
        const size = view.getVisibleSize(); if (size.width !== this.width || size.height !== this.height) this.layout();
        if (this.elapsed % 20 === 0) {
            const poopCount = (this.data.poops || []).length;
            const toDie: Pet[] = [];
            this.data.pets.forEach(p => {
                if (p.dead) return;
                const tr = PET_TRAITS[p.trait];
                p.hunger = Math.max(0, p.hunger - 1);
                // 小院便便越多，清洁度下降越快（3坨及以上触发加速惩罚）。
                const poopPenalty = poopCount >= 3 ? poopCount * 1.15 : poopCount * 0.6;
                p.clean = Math.max(0, p.clean - (0.7 + poopPenalty) * (tr.cleanDecayMult ?? 1));
                const outfitDef = PET_OUTFITS.find(o => o.id === p.outfit);
                const outfitDecay = outfitDef?.decayMult ?? 1;
                p.joy = Math.max(0, p.joy - (0.5 + (p.hunger < 20 ? 0.5 : 0) + (p.clean < 30 ? 0.4 : 0)) * (tr.joyDecayMult ?? 1) * outfitDecay);
                p.energy = Math.max(0, p.energy - 0.35 * (tr.energyDecayMult ?? 1));
                if (p.hunger < 20 || p.clean < 30) {
                    const hDrop = ((p.hunger < 20 ? 1.6 : 0) + (p.clean < 30 ? 1.8 : 0) + (poopCount >= 3 ? 0.6 : 0)) * outfitDecay;
                    p.health = Math.max(0, p.health - hDrop);
                    if (p.health <= 0) toDie.push(p);
                }
            });
            toDie.forEach(p => this.triggerPetDeath(p));
            this.dirty = true; if (this.page === 'pet') this.open('pet');
        }
        // 检查外出冒险的伙伴是否到点归来
        let returnedAny = false;
        const nowTick = Date.now();
        this.data.pets.forEach(p => {
            if (p.adventuring && p.adventureReturnAt && nowTick >= p.adventureReturnAt) {
                p.adventuring = false;
                p.adventureReturnAt = undefined;
                returnedAny = true;
                if (this.page === 'home') this.toast(`「${this.petDisplayName(p.id)}」冒险归来回到庭院啦！`);
            }
        });
        if (returnedAny) { this.dirty = true; this.syncActorVisibility(); }
        // 庭院中存活且在场的猫狗每隔 35 秒随机拉一次便便（最多同时存在 5 坨）
        if (this.elapsed > 0 && this.elapsed % 35 === 0 && (this.data.poops || []).length < 5) {
            const aliveActors = this.actors.filter(a => !a.pet.dead && !a.pet.lost && !a.pet.adventuring && !a.dying && isValid(a.node, true));
            if (aliveActors.length) {
                const chosen = aliveActors[Math.floor(Math.random() * aliveActors.length)];
                this.spawnYardPoop(chosen.pet.id, chosen.node.position.x, chosen.node.position.z);
            }
        }
        // 每隔 45 秒自动触发一次伙伴林间冒险见闻事件，丰富冒险日记并带回食物/玩具/宝藏
        if (this.elapsed > 0 && this.elapsed % 45 === 0) {
            const outPets = this.data.pets.filter(p => !p.dead && !p.lost && p.adventuring);
            const candidates = outPets.length ? outPets : this.data.pets.filter(p => !p.dead && !p.lost && p.hunger >= 20);
            if (candidates.length) {
                const chosen = candidates[Math.floor(Math.random() * candidates.length)];
                if (!chosen.adventuring && this.data.pets.filter(p => !p.dead && !p.lost).length >= 2) {
                    this.setPetAdventuring(chosen.id, true, 90000);
                } else {
                    const out = rollAdventureEvent(this.petDisplayName(chosen.id), BREEDS[chosen.id].kind, chosen.health, chosen.joy);
                    this.triggerAdventureOutcome(chosen, out);
                }
            }
        }
        if (this.elapsed % 10 === 0 && this.dirty) this.persist();
        if (this.page === 'adventure' && this.data.adventureEnd && Date.now() >= this.data.adventureEnd && this.adventureLabel && this.adventureLabel.string.indexOf('伙伴回来') !== 0) this.open('adventure');
        this.updateAdventureLabel();
        const shopNow = Date.now();
        if (this.shopDay(shopNow) > this.data.shop.day || (this.elapsed % 10 === 0 && shopNow > this.data.shop.maxTime)) {
            const shop = this.advanceShop(this.data.shop, shopNow);
            const previousDay = this.data.daily.day;
            if (this.commitShop({ ...this.data, shop, lastSeen: shopNow }) && this.page === 'daily' && previousDay !== this.data.daily.day) this.updateDailyRows();
        }
        this.updateShopLabels();
        if (Date.now() > this.noticeUntil) {
            this.notice.string = '';
            this.notice.node.parent?.getComponent(Graphics)?.clear();
        }
    };
    public resolvePetCollisions(dt: number) {
        this.socialTime += Math.max(0, Math.min(dt, 0.1));
        const actors = this.actors.filter(a => isValid(a.node, true) && a.node.active && !a.pet.adventuring);
        const clampX = (x: number) => Math.max(this.yardMinX, Math.min(this.yardMaxX, x));
        const clampZ = (z: number) => Math.max(this.yardMinZ, Math.min(this.yardMaxZ, z));
        const diameter = this.petCollisionRadius * 2;
        actors.forEach(a => { const p = a.node.position; a.node.setPosition(clampX(p.x), p.y, clampZ(p.z)); });
        // 子步内收敛，避免把多宠物挤压的修正留到下一帧而造成抖动。
        for (let pass = 0; pass < 48; pass++) {
            let overlapping = false;
            for (let i = 0; i < actors.length; i++) for (let j = i + 1; j < actors.length; j++) {
                const a = actors[i], b = actors[j], p = a.node.position.clone(), q = b.node.position.clone();
                let dx = q.x - p.x, dz = q.z - p.z;
                const distance = Math.hypot(dx, dz);
                if (distance >= diameter - 0.00001) continue;
                overlapping = true;
                if (distance < 0.00001) {
                    const angle = ((a.pet.id + 1) * 2.399 + b.pet.id) % (Math.PI * 2);
                    dx = Math.cos(angle); dz = Math.sin(angle);
                } else { dx /= distance; dz /= distance; }
                const correction = (diameter - distance + 0.00002) / 2;
                let ax = clampX(p.x - dx * correction), az = clampZ(p.z - dz * correction);
                let bx = clampX(q.x + dx * correction), bz = clampZ(q.z + dz * correction);
                // 边界吃掉的一半位移交由另一方承担。
                const aLost = correction - ((p.x - ax) * dx + (p.z - az) * dz);
                const bLost = correction - ((bx - q.x) * dx + (bz - q.z) * dz);
                bx = clampX(bx + dx * aLost); bz = clampZ(bz + dz * aLost);
                ax = clampX(ax - dx * bLost); az = clampZ(az - dz * bLost);
                a.node.setPosition(ax, p.y, az); b.node.setPosition(bx, q.y, bz);
                if (pass !== 0) continue;
                // 擦肩错开方向，避免两只一直互相顶住停滞
                const key = Math.min(a.pet.id, b.pet.id) + ':' + Math.max(a.pet.id, b.pet.id);
                const canSocialize =
                    (this.pairCooldowns.get(key) || 0) <= this.socialTime &&
                    (a.socialUntil || 0) <= this.socialTime && (b.socialUntil || 0) <= this.socialTime &&
                    (a.socialCooldownUntil || 0) <= this.socialTime && (b.socialCooldownUntil || 0) <= this.socialTime &&
                    this.socialBubbles.length < 4;
                if (canSocialize) {
                    this.pairCooldowns.set(key, this.socialTime + 16);
                    a.socialUntil = b.socialUntil = this.socialTime + 1.3;
                    // 单宠个人社交冷却 10 秒，避免多宠物场景下连锁停步卡死。
                    a.socialCooldownUntil = b.socialCooldownUntil = this.socialTime + 10;
                    a.facing = Math.atan2(dx, dz) * 180 / Math.PI;
                    b.facing = Math.atan2(-dx, -dz) * 180 / Math.PI;
                    a.target.set(clampX(ax - dx * 1.6), 0, clampZ(az - dz * 1.6));
                    b.target.set(clampX(bx + dx * 1.6), 0, clampZ(bz + dz * 1.6));
                    if (a.timer >= 0) a.timer = Math.min(a.timer, 1.0);
                    if (b.timer >= 0) b.timer = Math.min(b.timer, 1.0);
                    a.walkAge = 0; b.walkAge = 0;
                    this.showSocialBubble(a, -1); this.showSocialBubble(b, 1);
                } else if ((a.socialUntil || 0) <= this.socialTime && (b.socialUntil || 0) <= this.socialTime) {
                    // 冷却期直接顺滑错身绕开继续散步
                    const pushDist = 1.4;
                    a.target.set(clampX(ax - dx * pushDist - dz * 0.6), 0, clampZ(az - dz * pushDist + dx * 0.6));
                    b.target.set(clampX(bx + dx * pushDist + dz * 0.6), 0, clampZ(bz + dz * pushDist - dx * 0.6));
                    a.walkAge = 0; b.walkAge = 0;
                }
            }
            if (!overlapping) break;
        }
    }

    public pickSocialSpeech(pet: Pet): { text: string; level: 'zero' | 'low' | 'normal'; stat?: PetStat } {
        const stats: [PetStat, number][] = [
            ['hunger', pet.hunger],
            ['energy', pet.energy],
            ['clean', pet.clean],
            ['joy', pet.joy],
        ];
        const zeroPhrases: Record<PetStat, string[]> = {
            hunger: ['快饿死啦！', '快饿扁啦！', '肚子空空要晕啦', '救命想吃东西！'],
            energy: ['累瘫走不动了！', '没一点力气了…', '困到睁不开眼！', '电量彻底耗尽！'],
            clean: ['全身脏兮兮啦！', '急需洗香香！', '毛毛黏糊糊的！', '快帮我洗个澡！'],
            joy: ['超级孤单难过…', '好无聊快发霉了', '求抱抱陪我玩！', '委屈巴巴想玩耍'],
        };
        const lowPhrases: Record<PetStat, string[]> = {
            hunger: ['有点饿啦~', '肚子咕咕叫了', '想吃小零食', '该开饭了吧？'],
            energy: ['有点没活力~', '稍微有点困了', '想打个小盹', '走得有点累啦'],
            clean: ['毛毛有点乱了', '该洗香香啦~', '有点灰扑扑的', '想泡泡澡呀'],
            joy: ['有点小无聊~', '想找人一起玩', '好想追小球呀', '陪我玩一会儿嘛'],
        };
        const zeros = stats.filter(([, v]) => v <= 0);
        if (zeros.length) {
            const [stat] = zeros[Math.floor(Math.random() * zeros.length)];
            const list = zeroPhrases[stat];
            return { text: list[Math.floor(Math.random() * list.length)], level: 'zero', stat };
        }
        const lows = stats.filter(([, v]) => v <= 50);
        if (lows.length) {
            lows.sort((a, b) => a[1] - b[1]);
            const minVal = lows[0][1];
            const candidates = lows.filter(([, v]) => v <= minVal + 8);
            const [stat] = candidates[Math.floor(Math.random() * candidates.length)];
            const list = lowPhrases[stat];
            return { text: list[Math.floor(Math.random() * list.length)], level: 'low', stat };
        }
        const common = ['好朋友~', '一起玩呀！', '今天好开心', '见到你真好', '贴贴蹭蹭~', '阳光好暖呀', '一起去散步！', '你好可爱呀', '草地软绵绵~', '今天也要开心'];
        const extra = BREEDS[pet.id].kind === 'cat'
            ? ['喵呜~贴贴', '呼噜呼噜~', '一起晒太阳喵', '蹭蹭你好朋友']
            : ['汪！一起跑呀', '摇尾巴打招呼', '汪呜~好开心', '咱们去探险吧'];
        const pool = common.concat(extra);
        return { text: pool[Math.floor(Math.random() * pool.length)], level: 'normal' };
    }

    private showSocialBubble(actor: Actor, side: number) {
        if (!isValid(this.ui, true)) return;
        if (!this.bubbleLayer || !isValid(this.bubbleLayer, true)) {
            this.bubbleLayer = this.uiNode(this.ui, '伙伴相遇气泡层', 0, 0, this.width, this.height);
            this.bubbleLayer.setSiblingIndex(0);
        }
        const speech = this.pickSocialSpeech(actor.pet);
        const node = this.uiNode(this.bubbleLayer, '友好相遇', 0, 0, 186, 52);
        const bgHex = speech.level === 'zero' ? '#FFF0EC' : speech.level === 'low' ? '#FFF6E2' : C.cream;
        const borderHex = speech.level === 'zero' ? '#D96B52' : speech.level === 'low' ? '#D9A15B' : '';
        const textHex = speech.level === 'zero' ? '#C43D35' : speech.level === 'low' ? '#B35B2B' : C.coral;
        this.card(node, bgHex, 22);
        const g = node.getComponent(Graphics)!;
        if (borderHex) {
            g.strokeColor = this.color(borderHex); g.lineWidth = 3;
            g.roundRect(-93, -26, 186, 52, 22); g.stroke();
        }
        g.fillColor = this.color(bgHex);
        g.moveTo(-8, -23); g.lineTo(0, -33); g.lineTo(10, -23); g.close(); g.fill();
        g.fillColor = this.color(textHex); g.strokeColor = this.color(textHex); g.lineWidth = 2.2;
        if (speech.level === 'zero') {
            // 危急状态：醒目感叹号圆徽章
            g.circle(-68, 0, 12); g.fill();
            g.fillColor = this.color(C.white);
            g.roundRect(-70, -1, 4, 9, 2); g.fill();
            g.circle(-68, -6, 2.2); g.fill();
        } else if (speech.level === 'low') {
            // 偏低提醒：水滴/委屈提示小徽章
            g.circle(-68, -2, 10); g.stroke();
            g.circle(-71.5, 1, 1.5); g.fill(); g.circle(-64.5, 1, 1.5); g.fill();
            g.moveTo(-72, -6); g.bezierCurveTo(-70, -3, -66, -3, -64, -6); g.stroke();
        } else if (Math.random() < 0.5) {
            g.moveTo(-68, -9);
            g.bezierCurveTo(-93, 6, -76, 20, -68, 9);
            g.bezierCurveTo(-60, 20, -43, 6, -68, -9); g.close(); g.fill();
        } else {
            g.circle(-68, 1, 12); g.stroke();
            g.circle(-72, 5, 1.6); g.fill(); g.circle(-64, 5, 1.6); g.fill();
            g.moveTo(-74, -1); g.bezierCurveTo(-71, -7, -65, -7, -62, -1); g.stroke();
        }
        const label = this.text(node, speech.text, 16, 0, 138, 40, 20, textHex);
        label.isBold = speech.level === 'zero';
        this.socialBubbles.push({ node, actor, until: this.socialTime + (speech.level === 'zero' ? 2.6 : 2.2), side });
    }

    private updateNeedBubbles() {
        if (!isValid(this.ui, true)) return;
        const alive = new Set<number>();
        for (const actor of this.actors) {
            if (!isValid(actor.node, true) || actor.pet.dead || actor.dying) continue;
            const pet = actor.pet;
            alive.add(pet.id);
            const needs: [number, string][] = [[pet.hunger, 'feed'], [pet.clean, 'clean'], [pet.energy, 'rest'], [pet.joy, 'play'], [pet.health, 'heal']];
            const previous = this.needHistory.get(pet.id);
            let queue = this.needQueue.get(pet.id) || [];
            if (previous) {
                needs.forEach(([value, icon], index) => {
                    // Crossing detection also handles fractional decay and reaching zero.
                    const crossed = [0, 30, 50, 80].find(threshold => previous[index] > threshold && value <= threshold);
                    if (crossed !== undefined) {
                        queue = queue.filter(item => item.icon !== icon);
                        queue.push({ icon, threshold: crossed });
                        if (crossed === 0) this.needZeroNextAt.set(pet.id, this.socialTime + 30);
                    }
                });
            }
            this.needHistory.set(pet.id, needs.map(item => item[0]));
            // 任意状态跌到 0 时每隔 30 秒温和提醒一次（不刷屏），避免玩家不知道需要照顾。
            const zeroNeeds = needs.filter(([value]) => value <= 0);
            if (!zeroNeeds.length) {
                this.needZeroNextAt.delete(pet.id);
            } else {
                const nextAt = this.needZeroNextAt.get(pet.id);
                if (nextAt === undefined) {
                    // 首次发现已有 0 状态时错开几秒再温和提醒一次。
                    this.needZeroNextAt.set(pet.id, this.socialTime + 5 + (pet.id % 3) * 3);
                } else if (this.socialTime >= nextAt && !this.needBubbles.has(pet.id)) {
                    const cursor = this.needZeroCursor.get(pet.id) || 0;
                    const [, icon] = zeroNeeds[cursor % zeroNeeds.length];
                    this.needZeroCursor.set(pet.id, cursor + 1);
                    if (!queue.some(item => item.icon === icon)) queue.push({ icon, threshold: 0 });
                    this.needZeroNextAt.set(pet.id, this.socialTime + 30);
                }
            }
            // A care action cancels pending reminders for the recovered need.
            queue = queue.filter(item => needs.find(need => need[1] === item.icon)![0] <= item.threshold);
            queue.sort((a, b) => a.threshold - b.threshold);
            this.needQueue.set(pet.id, queue);
            let bubble = this.needBubbles.get(pet.id);
            const recovered = bubble && previous && needs.some(([value, icon], index) => icon === bubble!.icon && value > previous[index]);
            if (bubble && (recovered || this.socialTime >= bubble.until || !isValid(bubble.node, true))) {
                if (isValid(bubble.node, true)) { bubble.node.active = false; bubble.node.destroy(); }
                this.needBubbles.delete(pet.id); bubble = undefined;
            }
            const visiblePage = this.page === 'home' || this.page === 'pet';
            if (!bubble && (!queue.length || !visiblePage)) continue;
            if (!bubble) {
                const nextItem = queue.shift()!;
                const icon = nextItem.icon;
                const urgent = nextItem.threshold <= 0;
                if (!this.bubbleLayer || !isValid(this.bubbleLayer, true)) {
                    this.bubbleLayer = this.uiNode(this.ui, '伙伴相遇气泡层', 0, 0, this.width, this.height);
                    this.bubbleLayer.setSiblingIndex(0);
                }
                const node = this.uiNode(this.bubbleLayer, '照顾需求-' + pet.id, 0, 0, 94, 94);
                const g = node.addComponent(Graphics);
                g.fillColor = this.color(urgent ? '#FFF1EC' : C.cream);
                g.strokeColor = this.color(urgent ? '#D96B52' : '#D9B88B'); g.lineWidth = urgent ? 4 : 3;
                g.roundRect(-47, -47, 94, 94, 26); g.fill(); g.stroke();
                g.moveTo(-10, -46); g.lineTo(0, -59); g.lineTo(12, -46); g.close(); g.fill();
                const image = this.uiNode(node, '照顾图标', 0, 0, 74, 74).addComponent(Sprite);
                image.sizeMode = Sprite.SizeMode.CUSTOM;
                void this.loadCareIcon(image, icon);
                this.intercept(node); this.pressFeedback(node);
                node.on(Node.EventType.TOUCH_END, () => {
                    const alreadySelected = this.page === 'pet' && this.petSelected && this.selected === pet.id;
                    this.selected = pet.id;
                    if (!alreadySelected) this.open('pet');
                }, this);
                bubble = { node, icon, until: this.socialTime + (urgent ? 2.6 : 2.0), urgent }; this.needBubbles.set(pet.id, bubble);
            }
            const world = actor.node.worldPosition.clone(); world.y += 1.1;
            const screen = this.worldCamera.worldToScreen(world, new Vec3());
            const uiWorld = this.uiCamera.screenToWorld(screen, new Vec3());
            const local = this.bubbleLayer!.getComponent(UITransform)!.convertToNodeSpaceAR(uiWorld);
            const minY = -this.height / 2 + 260, maxY = this.height / 2 - 500;
            const social = this.socialBubbles.some(b => b.actor === actor && b.until > this.socialTime);
            bubble.node.active = screen.z >= 0 && screen.z <= 1 && (this.page === 'home' || this.page === 'pet') && maxY > minY;
            bubble.node.setPosition(Math.max(-this.width / 2 + 65, Math.min(this.width / 2 - 65, local.x)),
                Math.max(minY, Math.min(maxY, local.y + (social ? 135 : 70))), 0);
        }
        this.needHistory.forEach((_, id) => {
            if (!alive.has(id)) {
                this.needHistory.delete(id); this.needQueue.delete(id);
                this.needZeroNextAt.delete(id); this.needZeroCursor.delete(id);
            }
        });
        this.needBubbles.forEach((bubble, id) => {
            if (alive.has(id)) return;
            if (isValid(bubble.node, true)) { bubble.node.active = false; bubble.node.destroy(); }
            this.needBubbles.delete(id);
        });
    }

    private updateSocialBubbles() {
        this.socialBubbles = this.socialBubbles.filter(bubble => {
            if (!isValid(bubble.node, true)) return false;
            if (!isValid(bubble.actor.node, true) || this.socialTime >= bubble.until) { bubble.node.destroy(); return false; }
            const world = bubble.actor.node.worldPosition.clone(); world.y += 1.1;
            const screen = this.worldCamera.worldToScreen(world, new Vec3());
            const uiWorld = this.uiCamera.screenToWorld(screen, new Vec3());
            const local = this.bubbleLayer!.getComponent(UITransform)!.convertToNodeSpaceAR(uiWorld);
            const x = local.x + bubble.side * 96, y = local.y + 20;
            const minY = -this.height / 2 + 230, maxY = this.height / 2 - 335;
            bubble.node.active = screen.z >= 0 && screen.z <= 1 && this.page === 'home' && maxY > minY;
            bubble.node.setPosition(Math.max(-this.width / 2 + 98, Math.min(this.width / 2 - 98, x)), Math.max(minY, Math.min(maxY, y)), 0);
            return true;
        });
    }

    update(dt: number) {
        const delta = Math.max(0, Math.min(dt, 0.1));
        const steps = Math.max(1, Math.ceil(delta / (1 / 60))), step = delta / steps;
        const expiredActors: Actor[] = [];
        for (let i = 0; i < steps; i++) {
            this.actors.forEach(a => {
                if (!isValid(a.node, true)) return;
                if (a.dying && a.dying > 0) {
                    a.dying += step;
                    const fallT = Math.min(1, a.dying / 0.55);
                    const roll = fallT * fallT * 86;
                    a.visual.setRotationFromEuler(0, 0, roll);
                    a.node.setPosition(a.node.position.x, fallT * 0.14, a.node.position.z);
                    if (!a.ghostSpawned && a.dying >= 0.35) {
                        a.ghostSpawned = true;
                        this.playPetGhostRise(a.node.worldPosition);
                    }
                    if (a.dying >= 2.2) {
                        const fade = Math.max(0, 1 - (a.dying - 2.2) / 0.6);
                        const sc = this.petNodeScale * fade;
                        a.node.setScale(sc, sc, sc);
                    }
                    if (a.dying >= 2.8 && expiredActors.indexOf(a) === -1) expiredActors.push(a);
                    return;
                }
                const isCat = BREEDS[a.pet.id].kind === 'cat';
                const tiredFactor = a.pet.energy <= 5 ? 0.55 : a.pet.health < 30 ? 0.50 : 1;
                const cruise = (isCat ? 0.86 : 0.96) * tiredFactor;
                a.idleTime = (a.idleTime || 0) + step;
                let desiredSpeed = 0;
                let happyHop = 0;
                let turnDelta = 0;
                const socializing = this.page !== 'adventure' && (a.socialUntil || 0) > this.socialTime;
                const celebrating = this.page !== 'adventure' && a.timer < 0;
                if (this.page === 'adventure') {
                    // 全屏冒险模式：仅在路上的 3D 猫狗模型在中间石板小路上与宝箱齐平持续奔跑！
                    if (!a.node.active) return;
                    a.speed = cruise;
                    a.phase = (a.phase + step * 8.6) % (Math.PI * 2);
                    a.tailExcite = 0.55;
                    a.facing = 180;
                } else {
                if (celebrating) {
                    a.timer = Math.min(0, a.timer + step);
                    happyHop = Math.abs(Math.sin(a.timer * 7.8)) * 0.22;
                    a.node.setPosition(a.node.position.x, happyHop, a.node.position.z);
                } else if (socializing) {
                    a.node.setPosition(a.node.position.x, 0, a.node.position.z);
                } else {
                    const pos = a.node.position;
                    let dx = a.target.x - pos.x, dz = a.target.z - pos.z, distance = Math.hypot(dx, dz);
                    const pickNewTarget = () => {
                        let bestX = pos.x, bestZ = pos.z, bestScore = -1e9;
                        const spanX = (this.yardMaxX - this.yardMinX) - 0.3;
                        const spanZ = (this.yardMaxZ - this.yardMinZ) - 0.3;
                        for (let tries = 0; tries < 6; tries++) {
                            const cx = this.yardMinX + 0.15 + Math.random() * spanX;
                            const cz = this.yardMinZ + 0.15 + Math.random() * spanZ;
                            const distSelf = Math.hypot(cx - pos.x, cz - pos.z);
                            let minOther = 99;
                            for (const o of this.actors) {
                                if (o === a || !isValid(o.node, true)) continue;
                                const d = Math.hypot(cx - o.node.position.x, cz - o.node.position.z);
                                if (d < minOther) minOther = d;
                            }
                            const score = Math.min(minOther, 2.5) * 1.4 + Math.min(distSelf, 3.2) * 0.5;
                            if (score > bestScore) { bestScore = score; bestX = cx; bestZ = cz; }
                        }
                        a.target.set(bestX, 0, bestZ);
                        a.timer = 0.7 + Math.random() * 1.3;
                        a.walkAge = 0;
                        dx = bestX - pos.x; dz = bestZ - pos.z; distance = Math.hypot(dx, dz);
                    };
                    if (distance <= 0.16) {
                        a.walkAge = 0;
                        a.timer -= step;
                        if (a.timer <= 0) pickNewTarget();
                    } else {
                        a.walkAge = (a.walkAge || 0) + step;
                        // 防止被同伴或边界阻挡导致一直走不到目标而原地僵住。
                        if (a.walkAge > 6.5) pickNewTarget();
                    }
                    if (distance > 0.16) {
                        a.facing = Math.atan2(dx, dz) * 180 / Math.PI;
                        const yaw = a.node.eulerAngles.y;
                        const angleErr = Math.abs(((a.facing - yaw + 540) % 360) - 180);
                        // 大角度转向时先原地小碎步转正再迈步前行，避免横移滑步。
                        const align = Math.max(0.12, Math.min(1, 1 - Math.max(0, angleErr - 28) / 70));
                        const approach = Math.max(0.28, Math.min(1, (distance - 0.10) / 0.45));
                        desiredSpeed = cruise * align * approach;
                    }
                    a.node.setPosition(pos.x, 0, pos.z);
                }
                // 平滑加减速与弧线转向
                const speedBlend = 1 - Math.exp(-step * (desiredSpeed > (a.speed || 0) ? 5.5 : 8.5));
                a.speed = (a.speed || 0) + (desiredSpeed - (a.speed || 0)) * speedBlend;
                if (a.facing !== undefined) {
                    const yaw = a.node.eulerAngles.y;
                    const difference = ((a.facing - yaw + 540) % 360) - 180;
                    const turnRate = socializing || celebrating ? 8.5 : 6.2;
                    turnDelta = difference * (1 - Math.exp(-step * turnRate));
                    a.node.setRotationFromEuler(0, yaw + turnDelta, 0);
                }
                let travel = 0;
                if (!celebrating && !socializing && a.speed > 0.015) {
                    const pos = a.node.position, dx = a.target.x - pos.x, dz = a.target.z - pos.z, distance = Math.hypot(dx, dz);
                    if (distance > 0.10) {
                        travel = Math.min(distance - 0.10, a.speed * step);
                        a.node.setPosition(pos.x + dx / distance * travel, 0, pos.z + dz / distance * travel);
                    }
                }
                if (travel > 0 || Math.abs(turnDelta) * 0.042 > 0.002) {
                    a.phase = (a.phase + travel * 8.2 + Math.abs(turnDelta) * 0.042) % (Math.PI * 2);
                }
                }
                // 步相按真实位移与原地转身碎步共同推进，保证脚掌踩实不滑步。
                const gaitRaw = Math.min(1, (a.speed / cruise) + Math.min(0.45, Math.abs(turnDelta) / (step * 180 + 1e-4) * 0.35));
                // 闲置时偶尔俏皮转头歪头张望
                a.lookTimer = (a.lookTimer ?? 2) - step;
                if (a.lookTimer <= 0) {
                    a.lookTimer = 2.0 + Math.random() * 2.8;
                    if (gaitRaw < 0.15 && !socializing && !celebrating) {
                        a.lookYaw = (Math.random() - 0.5) * 30;
                        a.lookTilt = (Math.random() - 0.5) * 16;
                    } else {
                        a.lookYaw = 0; a.lookTilt = 0;
                    }
                }
                const settle = 1 - Math.exp(-step * 14);
                const gait = celebrating ? 0 : gaitRaw;
                const t = a.idleTime;
                const breath = Math.sin(t * (isCat ? 2.2 : 2.8)) * 0.018 * (1 - gait * 0.7);
                const bounce = gait * Math.abs(Math.sin(a.phase)) * (isCat ? 0.052 : 0.064);
                const roll = gait * Math.sin(a.phase) * (isCat ? 4.4 : 5.4);
                const sway = gait * Math.cos(a.phase) * (isCat ? 3.2 : 4.0);
                const pitch = gait * (isCat ? 2.4 : 3.2) + (celebrating ? -Math.sin(a.timer * 7.8) * 10 : 0);
                const squashY = celebrating
                    ? 1 + Math.sin(a.timer * 15.6) * 0.075
                    : 1 + breath + gait * (Math.abs(Math.sin(a.phase)) - 0.45) * 0.055;
                const squashXZ = 1 / Math.sqrt(Math.max(0.85, squashY));
                a.visual.setPosition(0, a.visual.position.y + (bounce - a.visual.position.y) * settle, 0);
                a.visual.setRotationFromEuler(
                    a.visual.eulerAngles.x + (pitch - a.visual.eulerAngles.x) * settle,
                    a.visual.eulerAngles.y + (sway - a.visual.eulerAngles.y) * settle,
                    a.visual.eulerAngles.z + (roll - a.visual.eulerAngles.z) * settle,
                );
                a.visual.setScale(
                    a.visual.scale.x + (squashXZ - a.visual.scale.x) * settle,
                    a.visual.scale.y + (squashY - a.visual.scale.y) * settle,
                    a.visual.scale.z + (squashXZ - a.visual.scale.z) * settle,
                );

                // 关节级卡通走路、摇尾、抖耳与互动动画
                const rig = a.rig;
                if (rig && isValid(rig.head, true)) {
                    const sA = Math.sin(a.phase), sB = -sA;
                    const swingAmp = (isCat ? 28 : 32) * gait;
                    const legA = celebrating ? -18 : sA * swingAmp;
                    const legB = celebrating ? -18 : sB * swingAmp;
                    const liftA = celebrating ? 0 : Math.max(0, Math.cos(a.phase)) * 0.048 * gait;
                    const liftB = celebrating ? 0 : Math.max(0, -Math.cos(a.phase)) * 0.048 * gait;
                    const poseLeg = (leg: Node, key: string, rotX: number, liftY: number) => {
                        const p = rig.pivots[key];
                        leg.setRotationFromEuler(leg.eulerAngles.x + (rotX - leg.eulerAngles.x) * settle, 0, 0);
                        leg.setPosition(p[0], p[1] + liftY, p[2]);
                    };
                    poseLeg(rig.legFL, 'legFL', legA, liftA);
                    poseLeg(rig.legBR, 'legBR', legA, liftA);
                    poseLeg(rig.legFR, 'legFR', legB, liftB);
                    poseLeg(rig.legBL, 'legBL', legB, liftB);

                    // 头部：转向先行引导 + 迈步轻点 + 社交点头 + 闲置歪头张望
                    const diffYaw = a.facing !== undefined ? ((a.facing - a.node.eulerAngles.y + 540) % 360) - 180 : 0;
                    const targetHeadYaw = gait > 0.1 ? Math.max(-22, Math.min(22, diffYaw * 0.4)) : (socializing ? Math.sin(t * 5) * 6 : (a.lookYaw || 0));
                    const targetHeadPitch = celebrating ? -10 : socializing ? Math.sin(t * 7.5) * 8 : gait * Math.cos(a.phase * 2) * 3.8 + breath * 95;
                    const targetHeadRoll = celebrating ? Math.sin(t * 9) * 10 : gait > 0.1 ? -Math.sin(a.phase) * 3.0 * gait : (a.lookTilt || 0);
                    const headEase = 1 - Math.exp(-step * 8);
                    rig.head.setRotationFromEuler(
                        rig.head.eulerAngles.x + (targetHeadPitch - rig.head.eulerAngles.x) * headEase,
                        rig.head.eulerAngles.y + (targetHeadYaw - rig.head.eulerAngles.y) * headEase,
                        rig.head.eulerAngles.z + (targetHeadRoll - rig.head.eulerAngles.z) * headEase,
                    );

                    // 耳朵：垂耳狗狗随步态上下Q弹摆动，猫咪及立耳狗狗（柯基/柴犬）轻缓呼应（平滑插值防跳变）
                    const earEase = 1 - Math.exp(-step * 12);
                    if (rig.uprightEars) {
                        const earBounce = gait * Math.sin(a.phase - 0.6) * 5.0;
                        const earTargetX = earBounce * 0.6;
                        const earTargetZL = earBounce;
                        const earTargetZR = -earBounce;
                        rig.earL.setRotationFromEuler(
                            rig.earL.eulerAngles.x + (earTargetX - rig.earL.eulerAngles.x) * earEase, 0,
                            rig.earL.eulerAngles.z + (earTargetZL - rig.earL.eulerAngles.z) * earEase,
                        );
                        rig.earR.setRotationFromEuler(
                            rig.earR.eulerAngles.x + (earTargetX - rig.earR.eulerAngles.x) * earEase, 0,
                            rig.earR.eulerAngles.z + (earTargetZR - rig.earR.eulerAngles.z) * earEase,
                        );
                    } else {
                        const flap = (gait * Math.abs(Math.sin(a.phase - 0.5)) * 11) + (celebrating ? 12 : 0) + Math.sin(t * 2.6) * 2.0;
                        const earSwingX = gait * Math.sin(a.phase - 0.4) * 6.0;
                        rig.earL.setRotationFromEuler(
                            rig.earL.eulerAngles.x + (earSwingX - rig.earL.eulerAngles.x) * earEase, 0,
                            rig.earL.eulerAngles.z + (flap - rig.earL.eulerAngles.z) * earEase,
                        );
                        rig.earR.setRotationFromEuler(
                            rig.earR.eulerAngles.x + (earSwingX - rig.earR.eulerAngles.x) * earEase, 0,
                            rig.earR.eulerAngles.z + (-flap - rig.earR.eulerAngles.z) * earEase,
                        );
                    }

                    // 尾巴：用独立相位积分推进，避免频率变化乘以总时间导致抽搐。
                    const targetExcite = celebrating || socializing ? 1 : gait * 0.65;
                    a.tailExcite = (a.tailExcite ?? targetExcite) + (targetExcite - (a.tailExcite ?? targetExcite)) * (1 - Math.exp(-step * 4.5));
                    const wagFreq = isCat ? (2.4 + a.tailExcite * 1.8) : (4.2 + a.tailExcite * 3.4);
                    a.tailPhase = ((a.tailPhase ?? (a.pet.id * 1.7)) + step * wagFreq) % (Math.PI * 2);
                    const wagAmp = isCat ? (13 + a.tailExcite * 9) : (18 + a.tailExcite * 12);
                    const tailY = Math.sin(a.tailPhase) * wagAmp;
                    const tailX = (isCat ? 4 : 5) * Math.cos(a.tailPhase) + (celebrating ? 8 : 0);
                    const tailEase = 1 - Math.exp(-step * 14);
                    rig.tail.setRotationFromEuler(
                        rig.tail.eulerAngles.x + (tailX - rig.tail.eulerAngles.x) * tailEase,
                        rig.tail.eulerAngles.y + (tailY - rig.tail.eulerAngles.y) * tailEase,
                        0,
                    );

                    // 地面阴影贴地且随弹跳柔和缩放
                    if (rig.shadow && isValid(rig.shadow, true)) {
                        const totalY = Math.max(0, a.node.position.y + a.visual.position.y * this.petNodeScale);
                        const shadowScale = Math.max(0.72, 1 - totalY * 0.55);
                        rig.shadow.setPosition(0, 0.02 - a.node.position.y / this.petNodeScale, -0.02);
                        rig.shadow.setScale(shadowScale, 1, shadowScale);
                    }
                }
            });
            if (this.page === 'adventure') {
                this.socialTime += step;
                this.placeAdventureFormation(false, step);
            } else {
                this.resolvePetCollisions(step);
            }
        }
        if (expiredActors.length) {
            expiredActors.forEach(a => {
                if (isValid(a.node, true)) { a.node.active = false; a.node.destroy(); }
            });
            this.actors = this.actors.filter(a => expiredActors.indexOf(a) === -1);
        }
        this.updateSelectionRing();
        this.updateSocialBubbles();
        this.updateNeedBubbles();
        this.syncYardPoops(delta);
        this.updateGhosts(delta);
        this.updateBrooms(delta);
        this.updateAdventureScene(delta);
        this.updateProfilePreview(delta);
        if (Date.now() < this.noticeUntil) this.layoutNotice();
    }
    onDestroy() {
        this.clearProfilePreview();
        this.clearRecruitBackground();
        this.closeGmPanel();
        this.closeDialog();
        this.rewardedVideoProvider = null;
        input.off(Input.EventType.TOUCH_END, this.onWorldTouch, this);
        this.unscheduleAllCallbacks(); if (this.data) this.persist();
        this.socialBubbles.forEach(b => { if (isValid(b.node, true)) b.node.destroy(); });
        this.socialBubbles = []; this.pairCooldowns.clear();
        this.needBubbles.forEach(b => { if (isValid(b.node, true)) b.node.destroy(); });
        this.needBubbles.clear(); this.needHistory.clear(); this.needQueue.clear(); this.needZeroNextAt.clear(); this.needZeroCursor.clear();
        this.poopVisuals.forEach(v => { v.smokes.forEach(s => s.mat.destroy()); if (isValid(v.node, true)) v.node.destroy(); });
        this.poopVisuals.clear();
        if (this.poopLayer && isValid(this.poopLayer, true)) this.poopLayer.destroy();
        this.poopLayer = null;
        this.ghosts.forEach(g => { if (isValid(g.node, true)) g.node.destroy(); });
        this.ghosts = [];
        this.brooms.forEach(b => { if (isValid(b.node, true)) b.node.destroy(); });
        this.brooms = [];
        if (this.bubbleLayer && isValid(this.bubbleLayer, true)) this.bubbleLayer.destroy();
        this.bubbleLayer = null;
        if (this.selectionRing && isValid(this.selectionRing, true)) this.selectionRing.destroy();
        this.selectionRing = null; this.careIcons.clear(); this.skins.clear(); this.outfitIcons.clear();
        this.world?.destroy(); this.ui?.destroy(); this.background?.destroy();
        this.worldCamera?.node.destroy(); this.uiCamera?.node.destroy(); this.backgroundCamera?.node.destroy(); this.previewCamera?.node.destroy();
        this.previewFrame?.destroy(); this.previewTexture?.destroy();
        this.previewFrame = null; this.previewTexture = null;
        this.materials.forEach(m => m.destroy()); this.meshes.forEach(m => m.destroy());
        this.compositeTextures.forEach(t => t.destroy()); this.compositeTextures.clear();
        this.materials.clear(); this.meshes.clear(); this.petRigs.clear(); this.petSkins.clear(); this.petAvatars.clear(); this.shadowTexture = null;
    }
}
