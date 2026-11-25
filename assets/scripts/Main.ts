import { _decorator, Component, Node, Camera, Canvas, UITransform, Graphics, Label, Color, Vec3, Vec2, RenderTexture, MeshRenderer, Material, primitives, utils, view, ResolutionPolicy, Layers, input, Input, EventTouch, sys, BlockInputEvents, Sprite, SpriteFrame, resources, DirectionalLight, Vec4, JsonAsset, Texture2D, isValid, tween, Tween, ScrollView, Mask, UIOpacity, profiler } from 'cc';

import { ITEM_CATALOG, ItemDefinition, ItemCategory, PetStat, ShopSlot, findItem, itemApplies, effectText, drawShopSlots } from './ItemCatalog';

import { DAILY_TASKS, DAILY_PACK, DailyState, DailyTaskId, newDaily, restoreDaily, advanceDaily, recordDaily } from './DailyTasks';

import { RecruitState, RECRUIT_CONFIG, restoreRecruit, drawRecruit, grantRecruit, nextMilestone } from './Recruitment';

import {
    PET_BREEDS, RARITY_INFO, PET_TRAITS, PET_OUTFITS, PET_COATS, PET_NICKNAME_PRESETS,
    MAX_PET_STAR, STAR_REQUIREMENTS, starXpBonus, starAdventureBonus, sanitizeNickname,
    isTraitId, isOutfitId, isCoatId, TraitId, OutfitId, CoatId,
} from './PetCatalog';

const { ccclass } = _decorator;
type Kind = 'cat' | 'dog';
type Currency = 'gems' | 'coins';
// 金币广告奖励暂与钻石一致；后续数值调整只改此处。
const VIDEO_REWARDS: Record<Currency, number> = { gems: 200, coins: 200 };
type Page = 'home' | 'recruit' | 'adventure' | 'album' | 'profile' | 'shop' | 'pet' | 'bag' | 'daily';
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
    star: number;
    nickname: string;
    trait: TraitId;
    outfit: OutfitId;
    coat: CoatId;
}
interface ShopState { day: number; freeUsed: number; paidUsed: number; maxTime: number; revision: number; slots: ShopSlot[]; }
interface Save {
    version: number; coins: number; gems: number; xp: number; avatar: number; pets: Pet[];
    food: number; soap: number; toy: number; itemInventory: Record<string, number>;
    adventureEnd: number; lastSeen: number; shop: ShopState; daily: DailyState; recruit: RecruitState;
    albumClaimed: Record<string, boolean>; ownedOutfits: OutfitId[]; ownedCoats: CoatId[];
}
type RigPartName = 'body' | 'head' | 'face' | 'earL' | 'earR' | 'legFL' | 'legFR' | 'legBL' | 'legBR' | 'tail';
interface PetRigAsset {
    kind: Kind;
    pivots: Record<string, [number, number, number]>;
    meshes: Record<RigPartName, ReturnType<typeof utils.createMesh>>;
}
interface ActorRig {
    kind: Kind;
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
    facing?: number;
    rig?: ActorRig;
}
interface SocialBubble { node: Node; actor: Actor; until: number; side: number; }
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
    public petCollisionRadius = 0.72;
    private socialTime = 0;
    private pairCooldowns = new Map<string, number>();
    private bubbleLayer: Node | null = null;
    private socialBubbles: SocialBubble[] = [];
    private needBubbles = new Map<number, { node: Node; icon: string; until: number; urgent: boolean }>();
    private needHistory = new Map<number, number[]>();
    private needQueue = new Map<number, { icon: string; threshold: number }[]>();
    private needZeroNextAt = new Map<number, number>();
    private needZeroCursor = new Map<number, number>();
    private materials = new Map<string, Material>();
    private meshes = new Map<string, ReturnType<typeof utils.createMesh>>();
    private petRigs = new Map<Kind, Promise<PetRigAsset | null>>();
    private petSkins = new Map<string, Promise<Texture2D | null>>();
    private petAvatars = new Map<string, Promise<SpriteFrame | null>>();
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
    private shopCards: { node: Node; id: string; title: Label; icon: Sprite; species: Label; effect: Label; stock: Label; price: Label; currency: Sprite }[] = [];
    private spriteRequests = new WeakMap<Sprite, object>();
    private header: { profile: Node; avatar: number; level: Label; xp: Label; fill: Sprite; gems: Label; coins: Label } | null = null;
    private recruitLabels: Label[] = [];
    private recruitProgress: Label | null = null;
    private recruitBadge: Node | null = null;
    private recruitResult: Label | null = null;
    private recruitClickTime = -Infinity;
    private recruitBusy = false;
    private bagPage = 0;
    private bagFilter: ItemCategory | null = null;
    private bagSlots: { node: Node; entry: { item: ItemDefinition; legacy: ItemCategory | null } | null; title: Label; icon: Sprite; species: Label; effect: Label; count: Label; use: Label }[] = [];
    private bagPageLabel: Label | null = null;
    private bagTargetLabel: Label | null = null;
    private bagEmpty: Node | null = null;
    private bagTabs: { category: ItemCategory | null; label: Label }[] = [];
    private albumFilter: 'all' | Kind = 'all';
    private profilePetId = 0;
    private profileTab: 'overview' | 'star' | 'outfit' = 'overview';
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

    private makePet(id: number, hunger = 70, clean = 80, energy = 85, joy = 75): Pet {
        return { id, hunger, clean, energy, joy, star: 1, nickname: '', trait: BREEDS[id].defaultTrait, outfit: 'none', coat: 'original' };
    }

    private petDisplayName(id: number): string {
        const pet = this.data?.pets?.find(p => p.id === id);
        return (pet && pet.nickname) ? pet.nickname : BREEDS[id].name;
    }

    private fresh(): Save {
        return { version: 1, coins: 260, gems: 100, xp: 0, avatar: 0,
            pets: [0, 1].map(id => this.makePet(id, 75, 85, 90, 80)),
            food: 5, soap: 4, toy: 3, itemInventory: {}, adventureEnd: 0, lastSeen: Date.now(), shop: this.newShop(Date.now()), daily: newDaily(this.shopDay(Date.now())),
            recruit: restoreRecruit(undefined, [0, 1], BREEDS.map((_, id) => id), false),
            albumClaimed: {}, ownedOutfits: ['none'], ownedCoats: ['original'] };
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
            const ids = new Set<number>();
            s.pets = s.pets.map(p => {
                if (!p || !validInt(p.id, BREEDS.length - 1) || ids.has(p.id) || !['hunger', 'clean', 'energy', 'joy'].every(k => typeof (p as any)[k] === 'number' && Number.isFinite((p as any)[k]) && (p as any)[k] >= 0 && (p as any)[k] <= 100)) throw Error('宠物数据无效');
                ids.add(p.id);
                const star = validInt(p.star, MAX_PET_STAR) && p.star >= 1 ? p.star : 1;
                const nickname = typeof p.nickname === 'string' ? sanitizeNickname(p.nickname) : '';
                const trait = isTraitId(p.trait) ? p.trait : BREEDS[p.id].defaultTrait;
                const outfit = isOutfitId(p.outfit) ? p.outfit : 'none';
                const coat = isCoatId(p.coat) ? p.coat : 'original';
                return { id: p.id, hunger: p.hunger, clean: p.clean, energy: p.energy, joy: p.joy, star, nickname, trait, outfit, coat };
            });
            if (!ids.has(0) || !ids.has(1) || !ids.has(s.avatar)) throw Error('初始伙伴缺失');
            if (s.adventureEnd > Date.now() + 120000) s.adventureEnd = 0;
            const hours = Math.min(12, Math.max(0, (Date.now() - s.lastSeen) / 3600000));
            s.pets.forEach(p => {
                const tr = PET_TRAITS[p.trait];
                p.hunger = Math.max(10, p.hunger - hours * 4);
                p.clean = Math.max(10, p.clean - hours * 3 * (tr.cleanDecayMult ?? 1));
                p.joy = Math.max(10, p.joy - hours * 2 * (tr.joyDecayMult ?? 1));
                p.energy = Math.min(100, p.energy + hours * 3);
            });
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
            const outfitSet = new Set<OutfitId>(['none']);
            if (Array.isArray(s.ownedOutfits)) s.ownedOutfits.forEach(o => { if (isOutfitId(o)) outfitSet.add(o); });
            if (s.pets.some(p => p.star >= 3)) outfitSet.add('gold_crown');
            s.ownedOutfits = Array.from(outfitSet);
            const coatSet = new Set<CoatId>(['original']);
            if (Array.isArray(s.ownedCoats)) s.ownedCoats.forEach(c => { if (isCoatId(c)) coatSet.add(c); });
            s.ownedCoats = Array.from(coatSet);
            s.pets.forEach(p => {
                if (!outfitSet.has(p.outfit)) p.outfit = 'none';
                if (!coatSet.has(p.coat)) p.coat = 'original';
            });
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
        this.previewCamera.orthoHeight = 1.16;
        this.previewCamera.near = 0.1; this.previewCamera.far = 40;
        this.previewCamera.visibility = this.previewLayer;
        this.previewCamera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        this.previewCamera.clearColor = new Color(0, 0, 0, 0);
        this.previewCamera.priority = 2;
        this.previewCamera.targetTexture = previewRT;
        previewCamNode.setPosition(0.55, 1.32, 3.8);
        previewCamNode.lookAt(new Vec3(0, 0.96, 0.02));
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

    private loadPetRig(kind: Kind): Promise<PetRigAsset | null> {
        let loading = this.petRigs.get(kind);
        if (!loading) {
            loading = new Promise<PetRigAsset | null>(resolve => {
                const fail = () => {
                    if (isValid(this, true)) this.toast((kind === 'cat' ? '猫咪' : '狗狗') + '模型暂未加载，已保留可互动的庭院伙伴');
                    resolve(null);
                };
                resources.load('pets/' + kind + '-rig', JsonAsset, (error, asset) => {
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
                            this.meshes.set('rig:' + kind + ':' + name, mesh);
                            meshes[name] = mesh;
                        }
                        resolve({ kind, pivots: raw.pivots, meshes });
                    } catch { fail(); }
                });
            });
            this.petRigs.set(kind, loading);
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
            // 共享基础猫/狗3D模型：顶点烘焙柔和体积光，每品种只需替换一张标准化皮肤贴图即可换肤。
            material.initialize({ effectName: 'builtin-unlit', defines: { USE_TEXTURE: true, USE_VERTEX_COLOR: true } });
            material.setProperty('mainTexture', texture);
            material.setProperty('colorScale', new Vec3(1.06, 1.05, 1.03));
            const coatDef = PET_COATS.find(c => c.id === coat) || PET_COATS[0];
            material.setProperty('mainColor', this.color(coatDef.tint));
        }
        return material;
    }

    private buildOutfitNode(outfit: OutfitId, rig: ActorRig): Node | null {
        if (outfit === 'none') return null;
        const headMounted = outfit === 'pink_bow' || outfit === 'straw_hat' || outfit === 'gold_crown';
        const parent = headMounted ? rig.head : rig.modelNode;
        if (!isValid(parent, true)) return null;
        const root = new Node('宠物装扮-' + outfit);
        root.layer = Layers.Enum.DEFAULT;
        parent.addChild(root);
        // 按猫狗骨骼实际外包尺寸（头宽1.56/头顶y=0.58、胸宽1.30）将装扮完整露于毛发外侧，确保正视与俯视均醒目。
        if (outfit === 'bell_collar') {
            this.shape(root, 'torus', '#E04338', [0, 0.54, 0.34], [1.32, 0.62, 1.28], [22, 0, 0]);
            this.shape(root, 'sphere', '#C82D26', [0, 0.48, 0.99], [0.18, 0.14, 0.14]);
            this.shape(root, 'sphere', '#F8CA42', [0, 0.36, 1.04], [0.32, 0.32, 0.32]);
            this.shape(root, 'box', '#7A4E14', [0, 0.31, 1.19], [0.14, 0.05, 0.05]);
        } else if (outfit === 'blue_scarf') {
            this.shape(root, 'torus', '#4E9AE6', [0, 0.55, 0.33], [1.34, 0.86, 1.30], [20, 0, 0]);
            this.shape(root, 'torus', '#F5FAFF', [0, 0.50, 0.35], [1.32, 0.42, 1.28], [20, 0, 0]);
            this.shape(root, 'cone', '#5EA9F4', [0, 0.30, 1.03], [0.58, 0.48, 0.22], [166, 0, 0]);
            this.shape(root, 'sphere', '#F4FAFF', [0, 0.15, 1.08], [0.15, 0.15, 0.15]);
            this.shape(root, 'box', '#3F8AD6', [0.42, 0.36, 0.86], [0.20, 0.40, 0.10], [14, 28, -22]);
        } else if (outfit === 'pink_bow') {
            this.shape(root, 'sphere', '#F47EA2', [-0.27, 0.66, 0.22], [0.46, 0.32, 0.24], [12, 0, 18]);
            this.shape(root, 'sphere', '#F47EA2', [0.27, 0.66, 0.22], [0.46, 0.32, 0.24], [12, 0, -18]);
            this.shape(root, 'sphere', '#FFD1DF', [0, 0.65, 0.28], [0.24, 0.24, 0.24]);
            this.shape(root, 'box', '#F47EA2', [-0.14, 0.55, 0.27], [0.12, 0.24, 0.07], [10, 0, 18]);
            this.shape(root, 'box', '#F47EA2', [0.14, 0.55, 0.27], [0.12, 0.24, 0.07], [10, 0, -18]);
        } else if (outfit === 'straw_hat') {
            this.shape(root, 'cylinder', '#F0CC70', [0, 0.63, 0.04], [1.54, 0.08, 1.48], [-6, 0, 0]);
            this.shape(root, 'cylinder', '#E4B854', [0, 0.80, 0.03], [0.88, 0.32, 0.84], [-6, 0, 0]);
            this.shape(root, 'sphere', '#E8BF5E', [0, 0.91, 0.02], [0.84, 0.22, 0.80], [-6, 0, 0]);
            this.shape(root, 'cylinder', '#DF5446', [0, 0.70, 0.04], [0.93, 0.11, 0.89], [-6, 0, 0]);
            this.shape(root, 'sphere', '#FFF4CE', [0.44, 0.71, 0.24], [0.18, 0.18, 0.14]);
        } else if (outfit === 'gold_crown') {
            this.shape(root, 'cylinder', '#F4C23D', [0, 0.66, 0.06], [0.58, 0.24, 0.58], [-6, 0, 0]);
            for (const ang of [0, 72, 144, 216, 288]) {
                const rad = ang * Math.PI / 180;
                this.shape(root, 'cone', '#FFD75E', [Math.sin(rad) * 0.25, 0.84, 0.06 + Math.cos(rad) * 0.25], [0.15, 0.22, 0.15]);
            }
            this.shape(root, 'sphere', '#E85D75', [0, 0.68, 0.35], [0.13, 0.13, 0.10]);
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
                const mat = this.getPetSkinMaterial(BREEDS[pet.id].skin, pet.coat, skinTex);
                pRig.renderers.forEach(r => { if (isValid(r, true)) r.setSharedMaterial(mat, 0); });
            }
            return;
        }
        const breed = BREEDS[pet.id];
        const [rig, skinTexture, shadowTex] = await Promise.all([
            this.loadPetRig(breed.kind),
            this.loadPetSkin(breed.skin),
            this.loadShadowTexture(),
        ]);
        if (!rig || !skinTexture || !isValid(this, true) || this.page !== 'profile' || this.profilePetId !== petId) return;
        this.clearProfilePreview();
        const stage = new Node('宠物主页3D舞台');
        this.node.addChild(stage);
        stage.setPosition(0, 0, 0);
        const visual = new Node('预览重心');
        stage.addChild(visual);
        const material = this.getPetSkinMaterial(breed.skin, pet.coat, skinTexture);
        const modelNode = new Node('预览卡通模型');
        visual.addChild(modelNode);
        const renderers: MeshRenderer[] = [];
        const addPart = (parent: Node, name: string, part: RigPartName, pivot?: [number, number, number]) => {
            const node = new Node(name);
            parent.addChild(node);
            if (pivot) node.setPosition(pivot[0], pivot[1], pivot[2]);
            const renderer = node.addComponent(MeshRenderer);
            renderer.mesh = rig.meshes[part];
            renderer.setSharedMaterial(material, 0);
            renderers.push(renderer);
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
            kind: breed.kind, modelNode, head, earL, earR, legFL, legFR, legBL, legBR, tail,
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
        const active = this.page === 'profile' && !this.dialog && !!this.previewRig && !!this.previewStage &&
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
            if (isCat) {
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
        const mat = skinTex ? this.getPetSkinMaterial(BREEDS[petId].skin, pet.coat, skinTex) : null;
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
        const [rig, skinTexture, shadowTex] = await Promise.all([
            this.loadPetRig(b.kind),
            this.loadPetSkin(b.skin),
            this.loadShadowTexture(),
        ]);
        if (!rig || !skinTexture || !isValid(this, true) || !isValid(actor.node, true) || !isValid(fallback, true)) return;
        let modelNode: Node | null = null;
        try {
            const material = this.getPetSkinMaterial(b.skin, actor.pet.coat, skinTexture);
            modelNode = new Node('卡通可动模型'); modelNode.layer = Layers.Enum.DEFAULT;
            actor.visual.addChild(modelNode);
            const renderers: MeshRenderer[] = [];
            const addMeshPart = (parent: Node, name: string, part: RigPartName, pivot?: [number, number, number]) => {
                const node = new Node(name); node.layer = Layers.Enum.DEFAULT;
                parent.addChild(node);
                if (pivot) node.setPosition(pivot[0], pivot[1], pivot[2]);
                const renderer = node.addComponent(MeshRenderer);
                renderer.mesh = rig.meshes[part];
                renderer.setSharedMaterial(material, 0);
                renderers.push(renderer);
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
                kind: b.kind, modelNode, head, earL, earR, legFL, legFR, legBL, legBR, tail,
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
        const b = BREEDS[pet.id], cat = b.kind === 'cat';
        const root = new Node(b.name); this.world.addChild(root);
        root.setPosition((pet.id % 3 - 1) * 1.8, 0, pet.id < 3 ? -0.65 : 0.9);
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
        this.bottom.setPosition(0, -this.height / 2 + 90, 0);
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
            if (this.page === 'daily' || this.page === 'bag' || this.page === 'album' || this.page === 'profile') this.sheet.setPosition(0, -10, 0);
            if (this.page === 'shop' || this.page === 'daily' || this.page === 'bag' || this.page === 'album' || this.page === 'profile') {
                const pw = this.page === 'daily' || this.page === 'album' || this.page === 'profile' ? 1024 : this.page === 'bag' ? 921 : 900;
                const ph = this.page === 'daily' ? 1400 : this.page === 'bag' ? 1390 : (this.page === 'album' || this.page === 'profile') ? 1372 : 1300;
                const scale = Math.min(1, (this.width - 40) / pw, (this.height - 420) / ph);
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
        const panel = this.dialog.getChildByName('通用弹窗面板')!;
        const panelHeight = panel.getComponent(UITransform)!.height;
        const scale = Math.min(1, (this.width - 40) / 900, (this.height - 40) / panelHeight);
        panel.setScale(scale, scale, 1);
    }

    private showDialog(title: string, body: string,
        actions: [{ title: string; run: () => void }] | [{ title: string; run: () => void }, { title: string; run: () => void }],
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
        const heading = this.headerText(panel, title, 0, (452 - 280) * ratio, 460 * ratio, 62 * ratio, 40);
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
            this.headerText(button, action.title, 0, 0, 300 * ratio, 50 * ratio, 28);
            this.shopButton(button, action.run);
        });
        const close = this.shopArt(panel, 'close', 480 * ratio, (452 - 335) * ratio, 71 * ratio, 72 * ratio);
        this.shopButton(close, () => this.closeDialog());
        this.layoutDialog();
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
            this.toast('完整观看成功，' + currencyName + ' +' + amount);
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
        profile.on(Node.EventType.TOUCH_END, () => this.open('album'), this);
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
        const actor = this.petSelected && (this.page === 'pet' || this.page === 'bag') ? this.actors.find(a => a.pet.id === this.selected && isValid(a.node, true)) : null;
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
                resources.load('art/' + (['feed', 'clean', 'rest', 'play', 'bag'].indexOf(name) !== -1 ? 'care/' : 'nav/') + name + '/spriteFrame', SpriteFrame, (error, frame) => resolve(error ? null : frame));
            });
            this.careIcons.set(name, loading);
        }
        const frame = await loading;
        if (frame && isValid(this, true) && isValid(sprite, true)) sprite.spriteFrame = frame;
    }

    private renderCareNav() {
        const items: [string, string, () => void][] = [
            ['feed', '喂养', () => this.care('food')], ['clean', '清洁', () => this.care('soap')],
            ['rest', '休息', () => this.care('rest')], ['play', '陪玩', () => this.care('toy')],
            ['bag', '背包', () => { if (this.page !== 'bag') this.open('bag'); }],
        ];
        void this.navArt(this.bottom, 'dock', 0, 0, 1080, 190);
        items.forEach(([icon, title, action], i) => {
            const button = this.uiNode(this.bottom, '照顾-' + icon, -408 + i * 204, 0, 190, 174);
            this.intercept(button); this.pressFeedback(button);
            void this.navArt(button, 'selected', 0, 4, 154, 150);
            button.getChildByName('主城素材-selected')!.active = this.careSelected === icon;
            const image = this.uiNode(button, '照顾图标', 0, 26, 98, 98).addComponent(Sprite);
            image.sizeMode = Sprite.SizeMode.CUSTOM; void this.loadCareIcon(image, icon);
            void this.navArt(button, 'label' + i, 0, -48, 160, 49);
            this.headerText(button, title, 0, -48, 148, 40, 30);
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
        if (page === 'home') return;
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
            this.sheet = this.uiNode(this.ui, '伙伴图鉴面板', 0, -10, 1024, 1372);
            this.intercept(this.sheet); this.renderAlbum(); this.layout(); this.animatePanelOpen(); return;
        }
        if (page === 'profile') {
            this.sheet = this.uiNode(this.ui, '宠物主页面板', 0, -10, 1024, 1372);
            this.intercept(this.sheet); this.renderProfile(); this.layout(); this.animatePanelOpen(); return;
        }
        if (page === 'pet') {
            this.sheet = this.uiNode(this.ui, '宠物状态', 0, -this.height / 2 + 350, 900, 300);
            this.headerArt(this.sheet, 'pet-status'); this.intercept(this.sheet);
            this.headerText(this.sheet, this.petDisplayName(this.selected) + ' · 小日常', -42, 84, 520, 36, 27).node.name = '宠物标题';
            const goProfile = this.uiNode(this.sheet, '宠物状态进主页', 310, 84, 132, 44);
            this.dailySprite(goProfile, 'button', 0, 0, 132, 44, true);
            this.dailyText(goProfile, '主页 ›', 0, 0, 118, 34, 21);
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
        const p = this.data.pets.find(v => v.id === this.selected)!;
        const title = this.sheet!.getChildByName('宠物标题')?.getComponent(Label);
        if (title) title.string = this.petDisplayName(this.selected) + ' ★' + p.star + ' · ' + PET_TRAITS[p.trait].name;
        const needs: [string, number][] = [['饱腹', p.hunger], ['洁净', p.clean], ['体力', p.energy], ['心情', p.joy]];
        needs.forEach(([name, value], i) => {
            const existing = this.sheet!.getChildByName(name + '-进度')?.getComponent(Sprite);
            if (existing) {
                if (existing.spriteFrame) existing.fillRange = value / 100;
                existing.color = this.color(value < 30 ? '#F0A68A' : '#FFFFFF');
                const number = this.sheet!.getChildByName(name + '-数字')?.getComponent(Label);
                if (number) number.string = String(Math.round(value));
                return;
            }
            const x = -185 + (i % 2) * 370, y = 13 - Math.floor(i / 2) * 69;
            this.headerText(this.sheet!, name, x - 125, y, 72, 34, 23);
            const bg = this.uiNode(this.sheet!, name + '-槽', x + 14, y, 192, 33);
            this.headerArt(bg, 'xp-track');
            const fillNode = this.uiNode(this.sheet!, name + '-进度', x + 14, y, 192, 33);
            const fill = fillNode.addComponent(Sprite); fill.sizeMode = Sprite.SizeMode.CUSTOM;
            resources.load('art/header/xp-fit/spriteFrame', SpriteFrame, (error, frame) => {
                if (error || !frame || !isValid(fill, true)) return;
                fill.spriteFrame = frame; fill.type = Sprite.Type.FILLED;
                const current = this.data.pets.find(pet => pet.id === this.selected)!;
                const liveValue = [current.hunger, current.clean, current.energy, current.joy][i];
                fill.fillType = Sprite.FillType.HORIZONTAL; fill.fillStart = 0; fill.fillRange = liveValue / 100;
                fill.color = this.color(liveValue < 30 ? '#F0A68A' : '#FFFFFF');
            });
            this.headerText(this.sheet!, String(Math.round(value)), x + 137, y, 58, 34, 23).node.name = name + '-数字';
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
        const names = { food: '营养餐', soap: '清洁包', toy: '陪玩球' };
        return { id: key, name: names[key], appliesTo: 'both', currency: 'coins', price: 0,
            effects: key === 'food' ? { hunger: 40 } : key === 'soap' ? { clean: 40 } : { joy: 40, energy: -8 },
            category: key, weight: 0, limit: 0 };
    }

    private applyCare(item: ItemDefinition | null, legacy: ItemCategory | 'rest' | null = null) {
        if (!this.petSelected) { this.toast('请先选择要照顾的伙伴'); return; }
        const p = this.data.pets.find(pet => pet.id === this.selected);
        if (!p) return;
        if (item && !itemApplies(item, BREEDS[p.id].kind)) { this.toast('这个道具不适合当前伙伴'); return; }
        const count = legacy && legacy !== 'rest' ? this.data[legacy] : item ? (this.data.itemInventory[item.id] || 0) : 0;
        if (legacy !== 'rest' && count <= 0) { this.toast('库存不足，去补给铺看看吧'); return; }
        const effects = item ? item.effects : { energy: 35 };
        const stats = Object.keys(effects) as PetStat[];
        if (stats.filter(stat => effects[stat]! > 0).every(stat => p[stat] >= 100)) {
            this.toast('相关状态已满，本次未消耗道具'); return;
        }
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
        if (legacy && legacy !== 'rest') candidate[legacy]--;
        else if (item) candidate.itemInventory[item.id] = count - 1;
        const category = legacy === 'rest' ? 'rest' : item?.category;
        if (category) recordDaily(candidate.daily, category === 'food' ? (BREEDS[p.id].kind === 'cat' ? 'feedCat' : 'feedDog') : category === 'soap' ? 'clean' : category === 'toy' ? 'play' : 'rest');
        if (!this.commitShop(candidate)) return;
        const actor = this.actors.find(a => a.pet.id === p.id);
        if (actor) { actor.pet = nextPet; actor.timer = -1.3; }
        this.renderHeader();
        if (this.page === 'bag') this.updateBag(); else this.open('pet');
        const tired = (effects.energy || 0) < 0 && p.energy < -(effects.energy || 0);
        const bonusHint = (statBonus => statBonus ? '（' + trait.name + '加成）' : '')(
            (legacy === 'food' || item?.category === 'food') && trait.foodBonus ||
            (legacy === 'rest' && trait.restBonus) ||
            ((legacy === 'toy' || item?.category === 'toy') && trait.playBonus)
        );
        this.toast((item ? '已使用' + item.name : '精神满满') + bonusHint + '，经验 +' + xpGain + (tired ? '（体力已降至0）' : ''));
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
            this.toast(mode === 'reward' ? '已领取累计' + claimed + '次奖励' : '招募成功，本体已保留');
        } finally { this.recruitBusy = false; }
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

    private updateRecruit() {
        this.updateRecruitRewards();
        const state = this.data.recruit;
        const pages = Math.max(1, Math.ceil(BREEDS.length / 6));
        this.recruitPreviewPage = ((this.recruitPreviewPage % pages) + pages) % pages;
        const offset = this.recruitPreviewPage * 6;
        const preview = this.sheet?.getChildByName('招募预览横栏');
        this.recruitLabels.forEach((label, slot) => {
            const id = offset + slot;
            const b = BREEDS[id];
            if (!b) return;
            label.string = b.name + '\n本体×' + (state.copies[id] || 0);
            label.color = this.statusColor((state.copies[id] || 0) > 0);
            const card = preview?.getChildByName('招募本体-' + slot);
            const avatar = card?.children.find(n => n.name.startsWith('伙伴头像-'));
            const sprite = avatar?.getChildByName('伙伴头像图')?.getComponent(Sprite);
            if (sprite && isValid(sprite, true)) {
                void this.loadPetAvatar(b.skin).then(frame => {
                    if (frame && isValid(sprite, true)) sprite.spriteFrame = frame;
                });
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
        // 背景独立于正文缩放，位于货币与底栏后方，且不拦截输入。
        this.recruitBackground = this.recruitArt(this.ui, 'background', 0, 0, 1080, 1920);
        this.recruitBackground.setSiblingIndex(0);
        this.recruitArt(panel, 'title', -180, 606, 600, 230);
        // 按1536源图真实内区映射：主牌与下方副条独立定位，不用节点矩形猜测。
        this.dailyText(panel, '猫狗招募', -180, 621, 400, 78, 64, false, true).node.name = '招募大标题';
        this.dailyText(panel, '与可爱的毛孩子相遇吧！', -176, 531, 350, 29, 24).node.name = '招募标题描述';
        // 右上奖励与进度独立，不覆盖主体猫狗立绘。
        const reward = this.uiNode(panel, '领取招募累计奖励', 330, 592, 300, 222);
        this.recruitArt(reward, 'description', 0, 0, 300, 222);
        void this.navArt(reward, 'label0', 20, 50, 150, 70);
        this.recruitArt(reward, 'chest', -88, 50, 40, 38);
        this.dailyText(reward, '招募奖励', 20, 50, 112, 30, 25).node.name = '招募奖励标题';
        const hint = this.dailyText(reward, '', 0, -14, 225, 52, 20);
        hint.node.name = '招募奖励说明'; hint.enableWrapText = true;
        const track = this.recruitArt(reward, 'progress-track', 0, -65, 240, 240 * 120 / 588);
        track.name = '招募累计进度槽';
        // 新槽真实内区约源像素525×58；填充仅适配内槽，不叠加第二层底板。
        const bar = this.uiNode(reward, '招募累计进度填充', 0, -65, 214, 23.6);
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
        this.recruitProgress = this.dailyText(reward, '', -24, -65, 166, 34, 24);
        this.recruitProgress.node.name = '招募累计进度文字';
        const search = this.uiNode(reward, '查看累计招募奖励', 96, -65, 54, 54);
        this.recruitArt(search, 'search', 0, 0, 48, 48);
        this.intercept(search); this.pressVisualFeedback(search);
        search.on(Node.EventType.TOUCH_END, () => this.showRecruitRewards(), this);
        // 两个固定热区只缩放内部美术，价格使用原有钻石图标。
        const single = this.recruitButton(panel, '', 'normal', -240, -334, 460, 216, () => this.recruitTransaction('single'));
        single.name = '招募按钮-普通招募 · 300钻 / 1次';
        const ten = this.recruitButton(panel, '', 'advanced', 240, -334, 460, 216, () => this.recruitTransaction('ten'));
        ten.name = '招募按钮-高级招募 · 2700钻 / 10次';
        for (const [node, cost, count] of [[single, '300', '1'], [ten, '2700', '10']] as const) {
            const diamond = this.uiNode(node, '招募价格钻石', -66, 62, 46, 46 * 315 / 353);
            this.headerArt(diamond, 'diamond-icon');
            this.dailyText(node, '×' + cost, 32, 62, 140, 38, 31);
            this.dailyText(node, '招募' + count + '次', 0, -2, 300, 62, 46, false, true);
            this.dailyText(node, '随机获得伙伴本体', 0, node === single ? -53 : -57, 285, 28, 23);
        }
        this.recruitArt(ten, 'discount', 170, 80, 96, 30);
        this.dailyText(ten, '9折', 170, 80, 62, 26, 22).node.name = '十抽9折文字牌';
        const preview = this.uiNode(panel, '招募预览横栏', 0, -590, 940, 276);
        const previewArt = this.uiNode(preview, '招募预览半透明底板', 0, 0, 940, 276);
        const previewFill = previewArt.addComponent(Graphics);
        previewFill.fillColor = new Color(111, 72, 43, 185);
        previewFill.roundRect(-470, -138, 940, 276, 26); previewFill.fill();
        this.dailyText(preview, '宠物预览', -300, 110, 280, 38, 28, true).node.name = '宠物预览标题';
        const details = this.uiNode(preview, '查看招募卡池', 345, 104, 230, 64);
        void this.navArt(details, 'label0', 0, 0, 170, 80);
        this.dailyText(details, '查看详情 ›', 0, 0, 132, 32, 24);
        this.intercept(details); this.pressVisualFeedback(details, details.children.slice());
        details.on(Node.EventType.TOUCH_END, () => {
            const byRarity = (r: 'SSR' | 'SR' | 'R') => BREEDS.filter(b => b.rarity === r).map(b => b.name).join('、');
            this.showDialog('招募卡池（共' + BREEDS.length + '种）',
                '【珍稀 SSR】' + byRarity('SSR') + '\n【稀有 SR】' + byRarity('SR') + '\n【普通 R】' + byRarity('R') + '\n所有伙伴等权 · 重复伙伴保留本体用于升星 · 累计满档赠本体',
                [{ title: '换一批预览', run: () => { this.recruitPreviewPage++; this.updateRecruit(); this.closeDialog(); } }, { title: '知道了', run: () => this.closeDialog() }]);
        }, this);
        for (let slot = 0; slot < 6; slot++) {
            const id = (this.recruitPreviewPage * 6 + slot) % BREEDS.length;
            const card = this.uiNode(preview, '招募本体-' + slot, -375 + slot * 150, -13, 144, 154);
            this.petAvatar(card, id, 0, 30, 94);
            const stock = this.dailyText(card, '', 0, -43, 142, 58, 21);
            stock.enableWrapText = true;
            this.recruitLabels.push(stock);
        }
        this.recruitResult = this.dailyText(panel, '', 0, -752, 900, 32, 18);
        this.recruitResult.node.name = '招募最近结果'; this.recruitResult.enableWrapText = true;
        // 招募页局部减弱浅色描边，其他界面保持原样。
        const soften = (node: Node) => {
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
        this.updateShopSprite(sprite, 'art/album/' + key);
        return node;
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

    private loadOutfitIcon(sprite: Sprite, id: OutfitId) {
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
        this.toast('领取图鉴解锁奖励：钻石 +' + reward);
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
        const nextPet: Pet = { ...pet, star: nextStar };
        const ownedOutfits = this.data.ownedOutfits.slice();
        let crownUnlocked = false;
        if (nextStar >= 3 && !ownedOutfits.includes('gold_crown')) {
            ownedOutfits.push('gold_crown');
            crownUnlocked = true;
        }
        const nextRecruit: RecruitState = {
            ...this.data.recruit,
            copies: { ...this.data.recruit.copies, [petId]: totalCopies - req.extraCopies },
        };
        const candidate: Save = {
            ...this.dailyCandidate(),
            coins: this.data.coins - req.coins,
            pets: this.data.pets.map(p => p.id === petId ? nextPet : p),
            recruit: nextRecruit,
            ownedOutfits,
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
        const nextPet: Pet = { ...pet, nickname: clean };
        const candidate: Save = {
            ...this.dailyCandidate(),
            pets: this.data.pets.map(p => p.id === petId ? nextPet : p),
        };
        if (!this.commitShop(candidate)) return false;
        const actor = this.actors.find(a => a.pet.id === petId);
        if (actor) actor.pet = nextPet;
        if (this.page === 'profile') this.refreshProfileInPlace();
        else if (this.page === 'pet') this.renderPet();
        this.toast(clean ? '已改名为「' + clean + '」' : '已恢复默认名称「' + BREEDS[petId].name + '」');
        return true;
    }

    public selectPetOutfit(petId: number, outfitId: OutfitId): boolean {
        const pet = this.data.pets.find(p => p.id === petId);
        const def = PET_OUTFITS.find(o => o.id === outfitId);
        if (!pet || !def) return false;
        let owned = this.data.ownedOutfits.includes(outfitId) || (def.freeAtStar !== undefined && pet.star >= def.freeAtStar);
        let coins = this.data.coins, gems = this.data.gems;
        const ownedOutfits = this.data.ownedOutfits.slice();
        if (!owned) {
            if (def.currency === 'coins') {
                if (coins < def.price) { this.showCoinDialog(); return false; }
                coins -= def.price;
            } else {
                if (gems < def.price) { this.showGemDialog(); return false; }
                gems -= def.price;
            }
            owned = true;
        }
        if (owned && !ownedOutfits.includes(outfitId)) ownedOutfits.push(outfitId);
        const nextPet: Pet = { ...pet, outfit: outfitId };
        const candidate: Save = {
            ...this.dailyCandidate(),
            coins, gems, ownedOutfits,
            pets: this.data.pets.map(p => p.id === petId ? nextPet : p),
        };
        if (!this.commitShop(candidate)) return false;
        void this.refreshPetAppearance(petId);
        this.renderHeader();
        if (this.page === 'profile') this.refreshProfileInPlace();
        this.toast('已为' + this.petDisplayName(petId) + '换上「' + def.name + '」');
        return true;
    }

    public selectPetCoat(petId: number, coatId: CoatId): boolean {
        const pet = this.data.pets.find(p => p.id === petId);
        const def = PET_COATS.find(c => c.id === coatId);
        if (!pet || !def) return false;
        const owned = this.data.ownedCoats.includes(coatId);
        let coins = this.data.coins, gems = this.data.gems;
        const ownedCoats = this.data.ownedCoats.slice();
        if (!owned) {
            if (def.currency === 'coins') {
                if (coins < def.price) { this.showCoinDialog(); return false; }
                coins -= def.price;
            } else {
                if (gems < def.price) { this.showGemDialog(); return false; }
                gems -= def.price;
            }
            ownedCoats.push(coatId);
        }
        const nextPet: Pet = { ...pet, coat: coatId };
        const candidate: Save = {
            ...this.dailyCandidate(),
            coins, gems, ownedCoats,
            pets: this.data.pets.map(p => p.id === petId ? nextPet : p),
        };
        if (!this.commitShop(candidate)) return false;
        void this.refreshPetAppearance(petId);
        this.renderHeader();
        if (this.page === 'profile') this.refreshProfileInPlace();
        this.toast('已切换毛色换肤「' + def.name + '」');
        return true;
    }

    private showRenameDialog(petId: number) {
        if (this.dialog) return;
        const breed = BREEDS[petId];
        const presets = PET_NICKNAME_PRESETS[breed.kind];
        this.showDialog('给伙伴改名', '当前名字：' + this.petDisplayName(petId) + '\n点击下方萌名即可立刻换名，或自定义输入（最多8字）', [
            { title: '自定义输入', run: () => {
                const inputVal = typeof window !== 'undefined' && typeof window.prompt === 'function'
                    ? window.prompt('请输入伙伴新名字（最多8个字，留空恢复默认名）：', this.petDisplayName(petId))
                    : null;
                if (inputVal !== null) { this.renamePet(petId, inputVal); this.closeDialog(); }
            } },
            { title: '恢复原名', run: () => { this.renamePet(petId, ''); this.closeDialog(); } },
        ]);
        if (!this.dialog) return;
        const content = this.dialog.getChildByName('通用弹窗面板')?.getChildByName('弹窗安全内容');
        if (!content) return;
        const body = content.getChildByName('弹窗正文');
        if (body) body.setPosition(0, 128);
        presets.slice(0, 6).forEach((name, idx) => {
            const x = -210 + (idx % 3) * 210, y = 26 - Math.floor(idx / 3) * 74;
            this.bagButton(content, name, x, y, 186, 56, () => { this.renamePet(petId, name); this.closeDialog(); });
        });
    }

    private renderAlbum() {
        const panel = this.sheet!;
        this.albumArt(panel, 'panel', 0, 0, 1024, 1372, '图鉴正式大底板');
        // 标题居中落在顶部木纹横幅内（源图 banner 中心 y=239/1170 -> +406）
        this.dailyText(panel, '伙伴图鉴', 0, 406, 420, 62, 42, false, true);
        const close = this.uiNode(panel, '收起图鉴', 386, 364, 128, 128);
        this.dailySprite(close, 'close', 0, 0, 112, 112, false, '关闭图标');
        this.shopButton(close, () => this.open('home'));

        // 顶部收集进度 + 待领解锁钻汇总（复用通用钻石图标）
        const summaryRow = this.uiNode(panel, '图鉴收集统计行', 0, 232, 720, 40);
        const summary = this.dailyText(summaryRow, '', 0, 0, 720, 38, 24);
        summary.node.name = '图鉴收集统计';
        const summaryGem = this.currencyIcon(summaryRow, 'gems', 132, 0, 28);
        summaryGem.name = '图鉴汇总钻石图标';
        summaryGem.active = false;

        // 分类筛选页签：全部 / 猫咪 / 狗狗
        const tabs: [string, 'all' | Kind][] = [
            ['全部 (' + BREEDS.length + ')', 'all'],
            ['猫咪 (' + BREEDS.filter(b => b.kind === 'cat').length + ')', 'cat'],
            ['狗狗 (' + BREEDS.filter(b => b.kind === 'dog').length + ')', 'dog'],
        ];
        tabs.forEach(([title, filter], i) => {
            const tab = this.uiNode(panel, '图鉴筛选-' + filter, -240 + i * 240, 174, 212, 58);
            this.albumArt(tab, this.albumFilter === filter ? 'tab-active' : 'tab-normal', 0, 0, 212, 58, '页签底图', true);
            const label = this.dailyText(tab, title, 0, 0, 192, 38, 23);
            label.node.name = '页签文字';
            this.intercept(tab); this.pressVisualFeedback(tab, tab.children.slice());
            tab.on(Node.EventType.TOUCH_END, () => {
                if (this.albumFilter === filter) return;
                this.albumFilter = filter;
                this.renderAlbumGrid();
            }, this);
        });

        // 奶油内区滚动网格（源图内区 y=-606..+273）
        const viewport = this.uiNode(panel, '图鉴可视窗口', 2, -220, 748, 704);
        viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        const content = this.uiNode(viewport, '图鉴滚动内容', 0, 352, 748, 704);
        content.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
        const scroll = viewport.addComponent(ScrollView);
        scroll.content = content; scroll.horizontal = false; scroll.vertical = true;
        scroll.cancelInnerEvents = true; scroll.elastic = false; scroll.inertia = false;

        this.renderAlbumGrid();
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
            summaryGem.setPosition(116, 0, 0);
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
        const cols = 3, cardW = 232, cardH = 224, gapX = 18, gapY = 18;
        const rows = Math.max(1, Math.ceil(list.length / cols));
        const totalH = Math.max(704, rows * (cardH + gapY) + 12);
        content.getComponent(UITransform)!.setContentSize(748, totalH);
        viewport!.getComponent(ScrollView)!.scrollToTop(0);

        list.forEach((b, idx) => {
            const col = idx % cols, row = Math.floor(idx / cols);
            const x = (col - 1) * (cardW + gapX);
            const y = -(cardH / 2 + 8 + row * (cardH + gapY));
            const pet = this.data.pets.find(p => p.id === b.id);
            const owned = !!pet;
            const rarity = RARITY_INFO[b.rarity];
            const canClaim = owned && !this.data.albumClaimed[b.id];

            const card = this.uiNode(content, '图鉴卡片-' + b.id, x, y, cardW, cardH);
            // 手绘本风格稀有度卡片底框（9宫格）：R 绿卡 / SR 蓝卡 / SSR 金卡。
            const cardFrame = this.albumArt(card, 'card-' + b.rarity.toLowerCase(), 0, 0, cardW, cardH, '图鉴卡片底框', true);
            const cardSprite = cardFrame.getComponent(Sprite)!;
            if (!owned) cardSprite.color = new Color(224, 226, 230, 255);

            // 质感稀有度徽章（按 180:86 原比例无拉伸显示）
            this.albumArt(card, 'rarity-' + b.rarity.toLowerCase(), -68, 86, 76, 36, '稀有度徽章-' + b.rarity);
            // 右上角：使用通用钻石图标显示解锁奖励，已领后显示星级
            if (canClaim) {
                this.diamondBadge(card, b.unlockGems, 56, 86, 98, 28, '#E05744', '#FFFDF5', 16);
            } else if (owned) {
                this.pillBadge(card, '★' + pet!.star, 72, 86, 64, 28, '#E7A23C', '#FFFDF5', 17);
            } else {
                this.diamondBadge(card, b.unlockGems, 56, 86, 98, 28, '#8E8B86', '#FFF8EC', 15);
            }

            // 中央头像（未解锁采用清晰可见的柔和灰雾+小锁）
            this.petAvatar(card, b.id, 0, 16, 106, !owned);
            // 底部名称与状态提示（留出底部手绘木框与角落装饰呼吸空间）
            const nameLabel = this.dailyText(card, owned ? this.petDisplayName(b.id) : b.name, 0, -58, 200, 30, 22);
            nameLabel.color = this.color(owned ? '#49301E' : '#6A6762');
            const subText = canClaim ? '进入主页领奖 ›' : owned ? PET_TRAITS[pet!.trait].name + ' · 主页 ›' : '未解锁 · 去招募';
            const subLabel = this.dailyText(card, subText, 0, -84, 196, 24, 16);
            subLabel.color = canClaim ? this.statusColor(true) : this.color(owned ? '#6D543D' : '#7C7A75');
            subLabel.outlineWidth = 1;

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
        this.albumArt(panel, 'panel', 0, 0, 1024, 1372, '宠物主页底板');
        this.dailyText(panel, '宠物主页', 0, 406, 420, 62, 42, false, true);
        const back = this.bagButton(panel, '‹ 图鉴', -312, 232, 136, 46, () => this.open('album'));
        back.name = '返回图鉴按钮';
        const close = this.uiNode(panel, '关闭宠物主页', 386, 364, 128, 128);
        this.dailySprite(close, 'close', 0, 0, 112, 112, false, '关闭图标');
        this.shopButton(close, () => this.open('home'));

        // 顶部总览英雄卡片 + 三页签容器（支持原位刷新不重建整面板）
        this.uiNode(panel, '主页英雄区', 2, 92, 744, 240);
        const tabs: [string, 'overview' | 'star' | 'outfit'][] = [['状态与词条', 'overview'], ['升星强化', 'star'], ['装扮换肤', 'outfit']];
        tabs.forEach(([title, key], i) => {
            const tab = this.uiNode(panel, '主页页签-' + key, -242 + i * 242, -56, 224, 58);
            this.albumArt(tab, this.profileTab === key ? 'tab-active' : 'tab-normal', 0, 0, 224, 58, '页签底图', true);
            const label = this.dailyText(tab, title, 0, 0, 200, 36, 23);
            label.node.name = '页签文字';
            this.intercept(tab); this.pressVisualFeedback(tab, tab.children.slice());
            tab.on(Node.EventType.TOUCH_END, () => {
                if (this.profileTab === key) return;
                this.profileTab = key;
                this.refreshProfileInPlace();
            }, this);
        });
        this.uiNode(panel, '主页内容区', 2, -346, 744, 500);
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

        // 刷新顶部英雄区（使用本风格手绘稀有度卡片底框 + 左侧实时 3D 模型展示舞台）
        const hero = this.sheet.getChildByName('主页英雄区')!;
        hero.children.slice().forEach(c => { c.active = false; c.removeFromParent(); c.destroy(); });
        hero.getComponent(Graphics)?.clear();
        this.albumArt(hero, 'card-' + breed.rarity.toLowerCase(), 0, 0, 744, 240, '主页英雄底框', true);

        // 左侧 3D 模型待机展示舞台（1:1 RenderTexture 承载，支持滑动旋转 & 点击互动弹跳）
        const stageBox = this.uiNode(hero, '宠物3D预览舞台', -252, 16, 212, 186);
        const sg = stageBox.addComponent(Graphics);
        sg.fillColor = this.color('#FFFBF0'); sg.strokeColor = this.color(rarity.border); sg.lineWidth = 3;
        sg.roundRect(-106, -93, 212, 186, 22); sg.fill(); sg.stroke();
        // 底部柔和草地小圆台衬托 3D 宠物
        sg.fillColor = this.color('#D8E8BF'); sg.ellipse(0, -54, 78, 22); sg.fill();
        const stageView = this.uiNode(stageBox, '宠物3D预览画面', 0, 2, 184, 184);
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
        void this.syncProfilePreview(pet.id);

        const avatarBtnTitle = this.data.avatar === pet.id ? '当前头像 ✓' : '设为头像';
        const setAv = this.bagButton(hero, avatarBtnTitle, -252, -96, 152, 36, () => {
            if (this.data.avatar === pet.id) return;
            this.data.avatar = pet.id;
            if (this.persist()) { this.renderHeader(); this.refreshProfileInPlace(); this.toast('已换上' + this.petDisplayName(pet.id) + '的头像'); }
        });
        setAv.name = '设为头像按钮';

        // 右侧信息区：名称 + 质感稀有度徽章 + 改名
        this.dailyText(hero, this.petDisplayName(pet.id), -44, 78, 176, 40, 31, true);
        this.albumArt(hero, 'rarity-' + breed.rarity.toLowerCase(), 116, 80, 96, 46, '主页稀有度徽章-' + breed.rarity);
        const renameBtn = this.bagButton(hero, '改名', 274, 78, 112, 40, () => this.showRenameDialog(pet.id));
        renameBtn.name = '宠物改名按钮';

        // 品种名 + 星级
        const stars = '★'.repeat(pet.star) + '☆'.repeat(MAX_PET_STAR - pet.star);
        const sub = this.dailyText(hero, breed.speciesTitle + '  ' + stars, 108, 32, 470, 34, 22, true);
        sub.color = this.color('#7F5328'); sub.outlineWidth = 1;

        // 性格词条
        this.pillBadge(hero, '性格·' + trait.name, -58, -14, 146, 32, trait.tagColor, C.white, 18);
        const trSummary = this.dailyText(hero, trait.summary, 184, -14, 310, 32, 20, true);
        trSummary.outlineWidth = 1;

        // 解锁钻石奖励领取按钮（使用通用钻石图标）
        if (!claimed) {
            const claimBtn = this.bagButton(hero, '领取解锁奖励       +' + breed.unlockGems, 104, -74, 412, 50, () => this.claimAlbumReward(pet.id));
            claimBtn.name = '领取图鉴解锁钻';
            this.currencyIcon(claimBtn, 'gems', 48, 0, 28);
            const lbl = claimBtn.getChildByName('文字')?.getComponent(Label);
            if (lbl) lbl.color = this.statusColor(true);
        } else {
            const doneRow = this.uiNode(hero, '图鉴已领奖励行', 104, -74, 450, 38);
            const done = this.dailyText(doneRow, '图鉴解锁奖励（      +' + breed.unlockGems + '）已领取 ✓', 0, 0, 450, 36, 21, true);
            done.color = this.statusColor(true); done.outlineWidth = 1;
            this.currencyIcon(doneRow, 'gems', -56, 0, 26);
        }

        // 更新三页签高亮与底图切换
        (['overview', 'star', 'outfit'] as const).forEach(key => {
            const tabNode = this.sheet!.getChildByName('主页页签-' + key);
            const bgSprite = tabNode?.getChildByName('页签底图')?.getComponent(Sprite);
            if (bgSprite) this.updateShopSprite(bgSprite, 'art/album/' + (this.profileTab === key ? 'tab-active' : 'tab-normal'));
            const label = tabNode?.getChildByName('页签文字')?.getComponent(Label);
            if (label) label.color = this.color(this.profileTab === key ? '#49301E' : '#856547');
        });

        // 刷新下方内容区
        const body = this.sheet.getChildByName('主页内容区')!;
        body.children.slice().forEach(c => { c.active = false; c.removeFromParent(); c.destroy(); });
        const bg = body.getComponent(Graphics) || body.addComponent(Graphics);
        bg.clear(); bg.fillColor = this.color('#FFFDF5'); bg.strokeColor = this.color('#DFC7A0'); bg.lineWidth = 3;
        bg.roundRect(-372, -250, 744, 500, 24); bg.fill(); bg.stroke();

        if (this.profileTab === 'overview') {
            this.dailyText(body, '实时状态', -260, 212, 180, 34, 25, true);
            const careBtn = this.bagButton(body, '前往照顾 ›', 260, 212, 166, 44, () => { this.selected = pet.id; this.open('pet'); });
            careBtn.name = '主页前往照顾';
            const stats: [string, number, string][] = [
                ['饱腹', pet.hunger, '#E99B4E'], ['洁净', pet.clean, '#6BB4D8'],
                ['体力', pet.energy, '#73B46F'], ['心情', pet.joy, '#EB8BA1'],
            ];
            stats.forEach(([label, val, col], i) => {
                const x = -175 + (i % 2) * 350, y = 150 - Math.floor(i / 2) * 56;
                this.dailyText(body, label, x - 134, y, 64, 32, 22, true);
                const track = this.uiNode(body, '状态槽-' + label, x + 2, y, 186, 26);
                const tg = track.addComponent(Graphics);
                tg.fillColor = this.color('#EADCC2'); tg.roundRect(-93, -13, 186, 26, 13); tg.fill();
                const fillW = Math.max(12, Math.round(182 * Math.max(0, Math.min(100, val)) / 100));
                if (val > 0) {
                    tg.fillColor = this.color(val <= 30 ? '#D96B52' : col);
                    tg.roundRect(-91, -11, fillW, 22, 11); tg.fill();
                }
                const num = this.dailyText(body, String(Math.round(val)), x + 124, y, 56, 32, 21);
                num.color = val <= 30 ? this.statusColor(false) : this.color('#49301E');
            });

            // 性格词条详解框
            const tBox = this.uiNode(body, '性格词条卡片', 0, -26, 696, 144);
            const tbg = tBox.addComponent(Graphics);
            tbg.fillColor = this.color('#FFF6E3'); tbg.strokeColor = this.color('#E7CCA0'); tbg.lineWidth = 2;
            tbg.roundRect(-348, -72, 696, 144, 20); tbg.fill(); tbg.stroke();
            this.pillBadge(tBox, '性格词条 · ' + trait.name, -206, 38, 236, 36, trait.tagColor, C.white, 20);
            const tDesc = this.dailyText(tBox, trait.detail, 0, -18, 648, 72, 22, true);
            tDesc.enableWrapText = true; tDesc.lineHeight = 32; tDesc.outlineWidth = 1;

            // 品种档案 & 星级加成
            const bioBox = this.uiNode(body, '伙伴档案卡片', 0, -172, 696, 122);
            const bbg = bioBox.addComponent(Graphics);
            bbg.fillColor = this.color('#FBF4E6'); bbg.roundRect(-348, -61, 696, 122, 18); bbg.fill();
            const bio = this.dailyText(bioBox, '【伙伴小传】' + breed.bio, 0, 20, 650, 58, 20, true);
            bio.enableWrapText = true; bio.lineHeight = 28; bio.outlineWidth = 1;
            const bonus = this.dailyText(bioBox, '当前星级加成（★' + pet.star + '）：照顾经验 +' + Math.round(starXpBonus(pet.star) * 100) + '% · 寻宝收益 +' + Math.round(starAdventureBonus(pet.star) * 100) + '%', 0, -32, 650, 32, 19, true);
            bonus.color = this.statusColor(true); bonus.outlineWidth = 1;
            return;
        }

        if (this.profileTab === 'star') {
            const req = STAR_REQUIREMENTS[pet.star];
            const totalCopies = this.data.recruit.copies[pet.id] || 1;
            const extraCopies = Math.max(0, totalCopies - 1);
            this.dailyText(body, '伙伴升星强化', 0, 206, 420, 42, 30);
            const starDisplay = this.dailyText(body, '★'.repeat(pet.star) + '☆'.repeat(MAX_PET_STAR - pet.star) + '  （当前 ' + pet.star + ' 星）', 0, 146, 640, 46, 34);
            starDisplay.color = this.color('#E09124');

            const bonusBox = this.uiNode(body, '升星加成说明', 0, 40, 680, 122);
            const bbg = bonusBox.addComponent(Graphics);
            bbg.fillColor = this.color('#FFF6E3'); bbg.roundRect(-340, -61, 680, 122, 20); bbg.fill();
            const curXp = Math.round(starXpBonus(pet.star) * 100), curAdv = Math.round(starAdventureBonus(pet.star) * 100);
            const nextXp = req ? Math.round(starXpBonus(req.nextStar) * 100) : curXp;
            const nextAdv = req ? Math.round(starAdventureBonus(req.nextStar) * 100) : curAdv;
            const line1 = this.dailyText(bonusBox, '照顾经验加成：+' + curXp + '%' + (req ? '  →  +' + nextXp + '%' : '（已满星）'), 0, 22, 640, 36, 24);
            line1.color = this.statusColor(true);
            const line2 = this.dailyText(bonusBox, '林间寻宝加成：+' + curAdv + '%' + (req ? '  →  +' + nextAdv + '%' : '（已满星）') + '   ·   3★免费解锁星光皇冠', 0, -22, 640, 36, 21);
            line2.outlineWidth = 1;

            if (!req) {
                const maxLbl = this.dailyText(body, '已达成最高星级 ★5，伙伴实力拉满！', 0, -96, 640, 48, 28);
                maxLbl.color = this.statusColor(true);
            } else {
                const copyOk = extraCopies >= req.extraCopies;
                const coinOk = this.data.coins >= req.coins;
                const c1 = this.dailyText(body, '消耗多余本体：拥有 ' + extraCopies + ' / 需要 ' + req.extraCopies + '（招募重复伙伴获得）', 0, -60, 680, 36, 23);
                c1.color = this.statusColor(copyOk);
                const coinRow = this.uiNode(body, '升星金币行', 0, -108, 680, 38);
                this.currencyIcon(coinRow, 'coins', -144, 0, 28);
                const c2 = this.dailyText(coinRow, '       消耗：拥有 ' + this.data.coins + ' / 需要 ' + req.coins, 0, 0, 640, 36, 23);
                c2.color = this.statusColor(coinOk);
                const upBtn = this.bagButton(body, '升至 ★' + req.nextStar, -130, -186, 240, 62, () => this.upgradePetStar(pet.id));
                upBtn.name = '立即升星按钮';
                const upLbl = upBtn.getChildByName('文字')?.getComponent(Label);
                if (upLbl) upLbl.color = this.statusColor(copyOk && coinOk);
                const goRec = this.bagButton(body, '去招募本体', 150, -186, 220, 62, () => this.open('recruit'));
                goRec.name = '升星去招募';
            }
            return;
        }

        // Tab 3: 装扮换肤（真实装扮图标 + 通用货币图标 + 实时 3D 预览）
        this.dailyText(body, '3D 可穿戴装扮（上方模型实时预览）', -130, 214, 460, 34, 23, true);
        PET_OUTFITS.forEach((o, i) => {
            const x = -232 + (i % 3) * 232, y = 130 - Math.floor(i / 3) * 110;
            const equipped = pet.outfit === o.id;
            const owned = this.data.ownedOutfits.includes(o.id) || (o.freeAtStar !== undefined && pet.star >= o.freeAtStar);
            const tile = this.uiNode(body, '装扮项-' + o.id, x, y, 214, 96);
            const g = tile.addComponent(Graphics);
            g.fillColor = this.color(equipped ? '#E6F5E3' : '#FFF8EA');
            g.strokeColor = this.color(equipped ? '#539C5A' : '#DFC59A'); g.lineWidth = equipped ? 4 : 2;
            g.roundRect(-107, -48, 214, 96, 18); g.fill(); g.stroke();
            const iconNode = this.uiNode(tile, '装扮图标-' + o.id, -68, 0, 64, 64);
            const iconSprite = iconNode.addComponent(Sprite); iconSprite.sizeMode = Sprite.SizeMode.CUSTOM;
            this.loadOutfitIcon(iconSprite, o.id);
            this.dailyText(tile, o.name, 30, 18, 134, 30, 20, true);
            if (equipped || owned) {
                const st = this.dailyText(tile, equipped ? '穿戴中 ✓' : '点击穿戴', 30, -18, 134, 28, 18, true);
                st.color = this.statusColor(true); st.outlineWidth = 1;
            } else {
                this.currencyIcon(tile, o.currency, -20, -18, 22);
                const st = this.dailyText(tile, String(o.price), 46, -18, 100, 28, 19, true);
                const affordable = (o.currency === 'coins' ? this.data.coins : this.data.gems) >= o.price;
                st.color = this.statusColor(affordable); st.outlineWidth = 1;
            }
            this.intercept(tile); this.pressVisualFeedback(tile, tile.children.slice());
            tile.on(Node.EventType.TOUCH_END, () => this.selectPetOutfit(pet.id, o.id), this);
        });

        this.dailyText(body, '毛色光影换肤（同款3D模型即时换肤）', -130, -82, 460, 34, 23, true);
        PET_COATS.forEach((c, i) => {
            const x = -261 + i * 174, y = -164;
            const equipped = pet.coat === c.id;
            const owned = this.data.ownedCoats.includes(c.id);
            const tile = this.uiNode(body, '毛色项-' + c.id, x, y, 162, 108);
            const g = tile.addComponent(Graphics);
            g.fillColor = this.color(equipped ? '#E6F5E3' : '#FFF8EA');
            g.strokeColor = this.color(equipped ? '#539C5A' : '#DFC59A'); g.lineWidth = equipped ? 4 : 2;
            g.roundRect(-81, -54, 162, 108, 18); g.fill(); g.stroke();
            g.fillColor = this.color(c.tint); g.strokeColor = this.color('#D4B990'); g.lineWidth = 2;
            g.circle(0, 22, 17); g.fill(); g.stroke();
            this.dailyText(tile, c.name, 0, -10, 148, 28, 20);
            if (equipped || owned) {
                const st = this.dailyText(tile, equipped ? '使用中 ✓' : '点击切换', 0, -34, 148, 24, 17);
                st.color = this.statusColor(true); st.outlineWidth = 1;
            } else {
                this.currencyIcon(tile, c.currency, -26, -34, 20);
                const st = this.dailyText(tile, String(c.price), 22, -34, 76, 24, 18, true);
                const affordable = (c.currency === 'coins' ? this.data.coins : this.data.gems) >= c.price;
                st.color = this.statusColor(affordable); st.outlineWidth = 1;
            }
            this.intercept(tile); this.pressVisualFeedback(tile, tile.children.slice());
            tile.on(Node.EventType.TOUCH_END, () => this.selectPetCoat(pet.id, c.id), this);
        });
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

    private shopClick(): boolean {
        const now = performance.now();
        if (now - this.shopClickTime < 600) return false;
        this.shopClickTime = now;
        return true;
    }

    private refreshShop() {
        if (!this.shopClick()) return;
        const now = Date.now(), shop = this.advanceShop(this.data.shop, now), cost = this.shopRefreshCost(shop);
        if (this.data.gems < cost) { this.showGemDialog(); return; }
        if (shop.revision >= Number.MAX_SAFE_INTEGER - 1 || shop.paidUsed >= Number.MAX_SAFE_INTEGER - 1) {
            this.toast('商店计数已达上限，无法刷新'); return;
        }
        const candidate: Save = { ...this.data, gems: this.data.gems - cost, lastSeen: now,
            shop: { ...shop, freeUsed: shop.freeUsed + (cost === 0 ? 1 : 0), paidUsed: shop.paidUsed + (cost > 0 ? 1 : 0),
                revision: shop.revision + 1, slots: drawShopSlots(shop.slots) } };
        if (!this.commitShop(candidate)) return;
        this.updateShopCards(); this.renderHeader(); this.toast(cost ? '刷新成功，钻石 -' + cost : '免费刷新成功');
    }

    private buyShopItem(id: string) {
        if (!this.shopClick()) return;
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
            this.shopCostLabel.node.setPosition(cost ? -24 : 0, 0, 0);
            this.shopCostLabel.node.getComponent(UITransform)!.setContentSize(cost ? 92 : 230, 42);
        }
        if (this.shopCostIcon && isValid(this.shopCostIcon, true)) this.shopCostIcon.active = cost > 0;
        this.shopCards.forEach(card => {
            const slot = shop.slots.find(entry => entry.id === card.id);
            const owned = this.data.itemInventory[card.id] || 0;
            if (isValid(card.stock, true)) {
                card.stock.string = '限购 ' + (slot?.remaining || 0) + '  持有 ' + owned;
                card.stock.color = this.statusColor(owned > 0);
            }
            const item = findItem(card.id);
            if (item && isValid(card.price, true)) card.price.color = this.statusColor(this.data[item.currency] >= item.price && (slot?.remaining || 0) > 0);
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
                this.updateShopSprite(card.icon, 'art/items/' + item.id);
                if (!previous || previous.currency !== item.currency) {
                    const aspect = item.currency === 'coins' ? 348 / 341 : 315 / 353;
                    card.currency.node.getComponent(UITransform)!.setContentSize(30, 30 * aspect);
                    this.updateShopSprite(card.currency, 'art/header/' + (item.currency === 'coins' ? 'coin-icon' : 'diamond-icon'));
                }
            }
        });
        this.updateShopLabels();
    }

    private renderShop() {
        const panel = this.sheet!;
        this.shopCards = [];
        this.shopArt(panel, 'stall', 0, 0, 900, 1300);
        // 源图 656×947 的连续奶油内板为像素 [55,410]–[600,835]，不是整张装饰摊位。
        // 映射到 900×1300 后安全范围为 x[-374.54,373.17]、y[-496.25,87.17]。
        const content = this.uiNode(panel, '商店安全内容', 0, -205, 760, 580);
        content.setScale(0.94, 0.94, 1);
        const tab = this.shopArt(panel, 'tab', -265, 190, 180, 70);
        this.headerText(tab, '道具', 0, 0, 145, 38, 28);
        const close = this.shopArt(panel, 'close', 385, 130, 71, 72);
        this.shopButton(close, () => this.open('home'));
        const goods = this.data.shop.slots.map(slot => findItem(slot.id)!);
        for (let i = 0; i < 6; i++) {
            // 抵消内容层缩放，面板内实际卡片为 210×245，行间距 20。
            const card = this.shopArt(content, 'card', (-245 + (i % 3) * 245) / 0.94,
                ((i < 3 ? -50 : -315) + 205) / 0.94, 210 / 0.94, 245 / 0.94);
            if (i >= goods.length) continue;
            const item = goods[i];
            const title = this.headerText(card, item.name, 0, 105, 210, 30, 25);
            title.lineHeight = 30; title.overflow = Label.Overflow.CLAMP;
            const icon = this.uiNode(card, '道具图标-' + item.id, 0, 48, 66, 66).addComponent(Sprite);
            icon.sizeMode = Sprite.SizeMode.CUSTOM;
            const species = this.text(card, this.speciesText(item), 0, 3, 210, 22, 18, C.muted);
            species.lineHeight = 22; species.overflow = Label.Overflow.CLAMP;
            const effect = this.text(card, effectText(item), 0, -31, 210, 44, 18, C.ink);
            effect.lineHeight = 21; effect.overflow = Label.Overflow.CLAMP;
            const stock = this.text(card, '', 0, -68, 210, 24, 18, C.muted);
            stock.lineHeight = 24; stock.overflow = Label.Overflow.CLAMP;
            const buy = this.shopArt(card, 'buy', 0, -105, 120, 120 * 120 / 321);
            const price = this.headerText(buy, String(item.price), -20, 0, 72, 36, 26);
            price.lineHeight = 32; price.overflow = Label.Overflow.CLAMP;
            const currencyAspect = item.currency === 'coins' ? 348 / 341 : 315 / 353;
            const coin = this.uiNode(buy, '购买货币图标', 38, 0, 30, 30 * currencyAspect);
            const currency = coin.addComponent(Sprite); currency.sizeMode = Sprite.SizeMode.CUSTOM;
            const binding = { node: card, id: '', title, icon, species, effect, stock, price, currency };
            this.shopCards.push(binding);
            this.shopButton(buy, () => this.buyShopItem(binding.id));
        }
        const timer = this.shopArt(panel, 'timer-panel', -195, -550, 310, 72);
        this.shopArt(timer, 'clock', -113, 0, 34, 40);
        this.shopTimerLabel = this.text(timer, '', 18, 0, 210, 40, 27, C.white);
        const refresh = this.shopArt(panel, 'buy', 205, -550, 240, 240 * 120 / 321);
        this.shopCostLabel = this.headerText(refresh, '', 0, 0, 230, 42, 25);
        this.shopCostIcon = this.uiNode(refresh, '刷新钻石图标', 52, 0, 40, 40 * 315 / 353);
        this.headerArt(this.shopCostIcon, 'diamond-icon');
        this.shopButton(refresh, () => this.refreshShop());
        this.updateShopCards();
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
        this.dailyText(panel, '我的背包', -14, 415, 370, 48, 38);
        const close = this.uiNode(panel, '收起背包', 380, 416, 84, 84);
        this.dailySprite(close, 'close', 0, 0, 78, 78);
        this.shopButton(close, () => this.open(this.petSelected ? 'pet' : 'home'));
        // 实际浅内区映射 x=-392.5..390.5、y=-659..341，内容不占顶部装饰。
        this.bagTargetLabel = this.dailyText(panel, '', 0, 302, 742, 40, 23);
        const filters: [string, ItemCategory | null][] = [['全部', null], ['喂养', 'food'], ['清洁', 'soap'], ['陪玩', 'toy']];
        filters.forEach(([name, category], index) => {
            const tab = this.uiNode(panel, '背包分类-' + name, -282 + index * 188, 245, 170, 66);
            this.shopArt(tab, 'tab', 0, 0, 170, 66);
            const label = this.dailyText(tab, name, 0, 0, 145, 40, 26);
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
            const iconNode = this.uiNode(node, '背包道具图标', -109, 12, 96, 96);
            const icon = iconNode.addComponent(Sprite); icon.sizeMode = Sprite.SizeMode.CUSTOM;
            const species = this.dailyText(node, '', 43, 35, 210, 28, 20);
            const effect = this.dailyText(node, '', 43, -3, 210, 47, 19);
            effect.enableWrapText = true; effect.lineHeight = 22;
            const count = this.dailyText(node, '', -87, -62, 140, 30, 21);
            const binding = { node, entry: null, title, icon, species, effect, count, use: null as unknown as Label } as typeof this.bagSlots[number];
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
        this.renderHeader(); this.updateDailyRows(); this.toast(id === 'pack' ? '已领取：通用食物×2、清洁包×1、陪玩球×1' : '每日任务奖励已领取');
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
            this.renderHeader(); this.updateDailyRows(); this.toast('每日任务双倍奖励已领取');
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
        // 标题投影至源图 y≈249..302，完全位于原标题牌 y=240..310 内。
        this.dailyText(panel, '任务', -12, 400, 440, 58, 42, false, true);
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

    private renderAdventure() {
        this.text(this.sheet!, '小小脚步，也能收集大大的惊喜', 0, 267, 940, 55, 29, C.muted);
        const art = this.uiNode(this.sheet!, '冒险图案', 0, 87, 880, 210); this.card(art, C.pale, 32);
        this.text(art, '庭院  —  花径  —  林间宝箱\n伙伴们正在发现生活的小美好', 0, 0, 830, 170, 34);
        this.adventureLabel = this.text(this.sheet!, '', 0, -90, 940, 100, 37, C.green);
        this.updateAdventureLabel();
        this.text(this.sheet!, '每次 60 秒 · 奖励 80 金币 / 8 钻石 / 25 经验\n无需等待在此页面，离线也会计时', 0, -218, 940, 100, 27, C.muted);
        this.button(this.sheet!, this.data.adventureEnd === 0 ? '出发寻宝' : Date.now() >= this.data.adventureEnd ? '领取本次奖励' : '查看寻宝进度', 0, -355, 850, 100, () => this.adventureAction(), C.coral);
    }
    private updateAdventureLabel() {
        if (!this.adventureLabel || !this.adventureLabel.isValid) return;
        const left = Math.ceil((this.data.adventureEnd - Date.now()) / 1000);
        this.adventureLabel.string = !this.data.adventureEnd ? '今日的风景，等你一起发现' : left > 0 ? '寻宝中  ' + Math.floor(left / 60) + ':' + ('0' + left % 60).slice(-2) : '伙伴回来啦 · 礼物等待领取';
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
        if (this.dialog || Date.now() < this.blockedUntil) return;
        const screen = new Vec3(location.x, location.y, 0), uiWorld = new Vec3(); this.uiCamera.screenToWorld(screen, uiWorld);
        const point = this.ui.getComponent(UITransform)!.convertToNodeSpaceAR(uiWorld);
        const hits = (n: Node) => {
            const size = n.getComponent(UITransform)!.contentSize;
            return Math.abs(point.x - n.position.x) <= size.width / 2 && Math.abs(point.y - n.position.y) <= size.height / 2;
        };
        if (hits(this.top) || hits(this.bottom) || (this.sheet && hits(this.sheet))) return;
        let closest: Actor | null = null, distance = 90;
        this.actors.forEach(actor => {
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
    private tick = () => {
        this.elapsed++;
        const size = view.getVisibleSize(); if (size.width !== this.width || size.height !== this.height) this.layout();
        if (this.elapsed % 20 === 0) {
            this.data.pets.forEach(p => {
                const tr = PET_TRAITS[p.trait];
                p.hunger = Math.max(0, p.hunger - 1);
                p.clean = Math.max(0, p.clean - 0.7 * (tr.cleanDecayMult ?? 1));
                p.joy = Math.max(0, p.joy - 0.5 * (tr.joyDecayMult ?? 1));
                p.energy = Math.max(0, p.energy - 0.35 * (tr.energyDecayMult ?? 1));
            });
            this.dirty = true; if (this.page === 'pet') this.open('pet');
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
        const actors = this.actors.filter(a => isValid(a.node, true));
        const clampX = (x: number) => Math.max(-2.3, Math.min(2.3, x));
        const clampZ = (z: number) => Math.max(-1.6, Math.min(1.6, z));
        const diameter = this.petCollisionRadius * 2;
        actors.forEach(a => { const p = a.node.position; a.node.setPosition(clampX(p.x), p.y, clampZ(p.z)); });
        // 子步内收敛，避免把多宠物挤压的修正留到下一帧而造成抖动。
        for (let pass = 0; pass < 64; pass++) {
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
                a.target.set(clampX(ax - dx * 1.3), 0, clampZ(az - dz * 1.3));
                b.target.set(clampX(bx + dx * 1.3), 0, clampZ(bz + dz * 1.3));
                if (a.timer >= 0) a.timer = Math.min(a.timer, 1.4);
                if (b.timer >= 0) b.timer = Math.min(b.timer, 1.4);
                a.walkAge = 0; b.walkAge = 0;
                const key = Math.min(a.pet.id, b.pet.id) + ':' + Math.max(a.pet.id, b.pet.id);
                if ((this.pairCooldowns.get(key) || 0) > this.socialTime ||
                    (a.socialUntil || 0) > this.socialTime || (b.socialUntil || 0) > this.socialTime) continue;
                this.pairCooldowns.set(key, this.socialTime + 8);
                a.socialUntil = b.socialUntil = this.socialTime + 1.4;
                a.facing = Math.atan2(dx, dz) * 180 / Math.PI;
                b.facing = Math.atan2(-dx, -dz) * 180 / Math.PI;
                this.showSocialBubble(a, -1); this.showSocialBubble(b, 1);
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
            if (!isValid(actor.node, true)) continue;
            const pet = actor.pet;
            alive.add(pet.id);
            const needs: [number, string][] = [[pet.hunger, 'feed'], [pet.clean, 'clean'], [pet.energy, 'rest'], [pet.joy, 'play']];
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
        for (let i = 0; i < steps; i++) {
            this.actors.forEach(a => {
                if (!isValid(a.node, true)) return;
                const isCat = BREEDS[a.pet.id].kind === 'cat';
                const tiredFactor = a.pet.energy <= 5 ? 0.55 : 1;
                const cruise = (isCat ? 0.86 : 0.96) * tiredFactor;
                a.idleTime = (a.idleTime || 0) + step;
                let desiredSpeed = 0;
                let happyHop = 0;
                const socializing = (a.socialUntil || 0) > this.socialTime;
                const celebrating = a.timer < 0;
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
                        let nx = pos.x, nz = pos.z;
                        for (let tries = 0; tries < 8; tries++) {
                            nx = (Math.random() - 0.5) * 4.4;
                            nz = (Math.random() - 0.5) * 3.0;
                            if (Math.hypot(nx - pos.x, nz - pos.z) >= 1.15) break;
                        }
                        a.target.set(nx, 0, nz);
                        a.timer = 0.8 + Math.random() * 1.2;
                        a.walkAge = 0;
                        dx = nx - pos.x; dz = nz - pos.z; distance = Math.hypot(dx, dz);
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
                let turnDelta = 0;
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
                // 步相按真实位移与原地转身碎步共同推进，保证脚掌踩实不滑步。
                const turnShuffle = Math.abs(turnDelta) * 0.042;
                const gaitRaw = Math.min(1, (a.speed / cruise) + Math.min(0.45, Math.abs(turnDelta) / (step * 180 + 1e-4) * 0.35));
                if (travel > 0 || turnShuffle > 0.002) {
                    a.phase = (a.phase + travel * 8.2 + turnShuffle) % (Math.PI * 2);
                }
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

                    // 耳朵：狗狗垂耳随步态上下Q弹摆动，猫咪尖耳轻缓呼应（平滑插值防跳变）
                    const earEase = 1 - Math.exp(-step * 12);
                    if (isCat) {
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
            this.resolvePetCollisions(step);
        }
        this.updateSelectionRing();
        this.updateSocialBubbles();
        this.updateNeedBubbles();
        this.updateProfilePreview(delta);
        if (Date.now() < this.noticeUntil) this.layoutNotice();
    }
    onDestroy() {
        this.clearProfilePreview();
        this.clearRecruitBackground();
        this.closeDialog();
        this.rewardedVideoProvider = null;
        input.off(Input.EventType.TOUCH_END, this.onWorldTouch, this);
        this.unscheduleAllCallbacks(); if (this.data) this.persist();
        this.socialBubbles.forEach(b => { if (isValid(b.node, true)) b.node.destroy(); });
        this.socialBubbles = []; this.pairCooldowns.clear();
        this.needBubbles.forEach(b => { if (isValid(b.node, true)) b.node.destroy(); });
        this.needBubbles.clear(); this.needHistory.clear(); this.needQueue.clear(); this.needZeroNextAt.clear(); this.needZeroCursor.clear();
        if (this.bubbleLayer && isValid(this.bubbleLayer, true)) this.bubbleLayer.destroy();
        this.bubbleLayer = null;
        if (this.selectionRing && isValid(this.selectionRing, true)) this.selectionRing.destroy();
        this.selectionRing = null; this.careIcons.clear(); this.skins.clear(); this.outfitIcons.clear();
        this.world?.destroy(); this.ui?.destroy(); this.background?.destroy();
        this.worldCamera?.node.destroy(); this.uiCamera?.node.destroy(); this.backgroundCamera?.node.destroy(); this.previewCamera?.node.destroy();
        this.previewFrame?.destroy(); this.previewTexture?.destroy();
        this.previewFrame = null; this.previewTexture = null;
        this.materials.forEach(m => m.destroy()); this.meshes.forEach(m => m.destroy());
        this.materials.clear(); this.meshes.clear(); this.petRigs.clear(); this.petSkins.clear(); this.petAvatars.clear(); this.shadowTexture = null;
    }
}
