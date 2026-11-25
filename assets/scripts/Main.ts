import { _decorator, Component, Node, Camera, Canvas, UITransform, Graphics, Label, Color, Vec3, Vec2, MeshRenderer, Material, primitives, utils, view, ResolutionPolicy, Layers, input, Input, EventTouch, sys, BlockInputEvents, Sprite, SpriteFrame, resources, DirectionalLight, Vec4, JsonAsset, Texture2D, isValid, tween, Tween, ScrollView, Mask, UIOpacity } from 'cc';

import { ITEM_CATALOG, ItemDefinition, ItemCategory, PetStat, ShopSlot, findItem, itemApplies, effectText, drawShopSlots } from './ItemCatalog';

import { DAILY_TASKS, DAILY_PACK, DailyState, DailyTaskId, newDaily, restoreDaily, advanceDaily, recordDaily } from './DailyTasks';

import { RecruitState, RECRUIT_CONFIG, restoreRecruit, drawRecruit, grantRecruit, nextMilestone } from './Recruitment';

const { ccclass } = _decorator;
type Kind = 'cat' | 'dog';
type Currency = 'gems' | 'coins';
// 金币广告奖励暂与钻石一致；后续数值调整只改此处。
const VIDEO_REWARDS: Record<Currency, number> = { gems: 200, coins: 200 };
type Page = 'home' | 'recruit' | 'adventure' | 'album' | 'shop' | 'pet' | 'bag' | 'daily';
export type RewardedVideoResult = 'completed' | 'cancelled' | 'failed';
export interface RewardedVideoProvider {
    // 可信边界：仅由宿主注入的平台适配器调用终态回调，并在游戏主线程执行。
    // completed 必须代表平台确认完整观看且视频已关闭；加载、开始、普通关闭不得映射为完成。
    // 取消、加载/播放失败分别回传 cancelled/failed；每次调用最终必须回传终态。
    // 此客户端接口无法验证平台凭证；不得将 UI 点击或不可信消息直接转发为 completed。
    show(onResult: (result: RewardedVideoResult) => void): void;
}
interface Pet { id: number; hunger: number; clean: number; energy: number; joy: number; }
interface ShopState { day: number; freeUsed: number; paidUsed: number; maxTime: number; revision: number; slots: ShopSlot[]; }
interface Save { version: number; coins: number; gems: number; xp: number; avatar: number; pets: Pet[]; food: number; soap: number; toy: number; itemInventory: Record<string, number>; adventureEnd: number; lastSeen: number; shop: ShopState; daily: DailyState; recruit: RecruitState; }
interface Actor { node: Node; visual: Node; pet: Pet; target: Vec3; timer: number; phase: number; socialUntil?: number; facing?: number; }
interface SocialBubble { node: Node; actor: Actor; until: number; side: number; }
const BREEDS: { name: string; kind: Kind; color: string; accent: string; cost: number }[] = [
    { name: '奶糖猫', kind: 'cat', color: '#E6A54E', accent: '#A66630', cost: 0 },
    { name: '布丁犬', kind: 'dog', color: '#BD773C', accent: '#70452D', cost: 0 },
    { name: '云朵猫', kind: 'cat', color: '#F6F4EF', accent: '#A5B3BC', cost: 35 },
    { name: '芝麻犬', kind: 'dog', color: '#777F89', accent: '#E5D3BA', cost: 45 },
    { name: '橘子猫', kind: 'cat', color: '#EFA65C', accent: '#B36F37', cost: 55 },
    { name: '桃桃犬', kind: 'dog', color: '#EACBB9', accent: '#B99183', cost: 65 },
];
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
    private needBubbles = new Map<number, { node: Node; icon: string; until: number }>();
    private needHistory = new Map<number, number[]>();
    private needQueue = new Map<number, { icon: string; threshold: number }[]>();
    private materials = new Map<string, Material>();
    private meshes = new Map<string, ReturnType<typeof utils.createMesh>>();
    private petModels = new Map<Kind, Promise<{ mesh: ReturnType<typeof utils.createMesh>; texture: Texture2D } | null>>();
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
    public rewardedVideoProvider: RewardedVideoProvider | null = null;
    private dialog: Node | null = null;
    private rewardedVideoPending = false;

    onLoad() {
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

    private fresh(): Save {
        return { version: 1, coins: 260, gems: 100, xp: 0, avatar: 0,
            pets: [0, 1].map(id => ({ id, hunger: 75, clean: 85, energy: 90, joy: 80 })),
            food: 5, soap: 4, toy: 3, itemInventory: {}, adventureEnd: 0, lastSeen: Date.now(), shop: this.newShop(Date.now()), daily: newDaily(this.shopDay(Date.now())),
            recruit: restoreRecruit(undefined, [0, 1], BREEDS.map((_, id) => id), false) };
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
            s.pets.forEach(p => {
                if (!p || !validInt(p.id, BREEDS.length - 1) || ids.has(p.id) || !['hunger', 'clean', 'energy', 'joy'].every(k => typeof (p as any)[k] === 'number' && Number.isFinite((p as any)[k]) && (p as any)[k] >= 0 && (p as any)[k] <= 100)) throw Error('宠物数据无效');
                ids.add(p.id);
            });
            if (!ids.has(0) || !ids.has(1) || !ids.has(s.avatar)) throw Error('初始伙伴缺失');
            if (s.adventureEnd > Date.now() + 120000) s.adventureEnd = 0;
            const hours = Math.min(12, Math.max(0, (Date.now() - s.lastSeen) / 3600000));
            s.pets.forEach(p => { p.hunger = Math.max(10, p.hunger - hours * 4); p.clean = Math.max(10, p.clean - hours * 3); p.joy = Math.max(10, p.joy - hours * 2); p.energy = Math.min(100, p.energy + hours * 3); });
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
    }

    private color(hex: string): Color { return new Color().fromHEX(hex); }
    private shape(parent: Node, type: 'box' | 'sphere' | 'cone' | 'cylinder', color: string, pos: number[], scale: number[], rotation?: number[]): Node {
        const n = new Node(type); parent.addChild(n); n.layer = Layers.Enum.DEFAULT;
        n.setPosition(pos[0], pos[1], pos[2]); n.setScale(scale[0], scale[1], scale[2]);
        if (rotation) n.setRotationFromEuler(rotation[0], rotation[1], rotation[2]);
        const renderer = n.addComponent(MeshRenderer);
        let mesh = this.meshes.get(type);
        if (!mesh) {
            const geometry = type === 'box' ? primitives.box() : type === 'sphere' ? primitives.sphere(0.5, { segments: 24 }) : type === 'cone' ? primitives.cone(0.5, 1, { radialSegments: 8 }) : primitives.cylinder(0.5, 0.5, 1, { radialSegments: 10 });
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

    private loadPetModel(kind: Kind) {
        let loading = this.petModels.get(kind);
        if (!loading) {
            loading = new Promise<{ mesh: ReturnType<typeof utils.createMesh>; texture: Texture2D } | null>(resolve => {
                const fail = () => {
                    if (isValid(this, true)) this.toast((kind === 'cat' ? '猫咪' : '狗狗') + '模型暂未加载，已保留可互动的庭院伙伴');
                    resolve(null);
                };
                resources.load('pets/' + kind, JsonAsset, (error, asset) => {
                    if (!isValid(this, true)) { resolve(null); return; }
                    if (error || !asset?.json) { fail(); return; }
                    const geometry = asset.json as primitives.IGeometry;
                    if (!Array.isArray(geometry.positions) || !geometry.positions.length || !Array.isArray(geometry.indices) || !geometry.indices.length || !Array.isArray(geometry.uvs)) { fail(); return; }
                    resources.load('pets/' + kind + '/texture', Texture2D, (textureError, texture) => {
                        if (!isValid(this, true)) { resolve(null); return; }
                        if (textureError || !texture) { fail(); return; }
                        try {
                            const mesh = utils.createMesh(geometry);
                            this.meshes.set('pet:' + kind, mesh);
                            resolve({ mesh, texture });
                        } catch { fail(); }
                    });
                });
            });
            this.petModels.set(kind, loading);
        }
        return loading;
    }

    private async attachPetModel(actor: Actor, fallback: Node) {
        const b = BREEDS[actor.pet.id];
        const model = await this.loadPetModel(b.kind);
        if (!model || !isValid(this, true) || !isValid(actor.node, true) || !isValid(fallback, true)) return;
        const key = 'pet:' + actor.pet.id;
        let material = this.materials.get(key);
        let modelNode: Node | null = null;
        try {
            if (!material) {
                material = new Material();
                this.materials.set(key, material);
                material.initialize({ effectName: 'builtin-unlit', defines: { USE_TEXTURE: true } });
                material.setProperty('mainTexture', model.texture);
                // Fur shadows are selectively graded during import; avoid washing out eyes/highlights.
                material.setProperty('colorScale', new Vec3(1.06, 1.05, 1.03));
                const tint = actor.pet.id < 2 ? C.white : ['#FFFFFF', '#FFFFFF', '#F5F7FF', '#CDD3DF', '#FFE3BF', '#FFE8E3'][actor.pet.id];
                material.setProperty('mainColor', this.color(tint));
            }
            modelNode = new Node('AI模型'); modelNode.layer = Layers.Enum.DEFAULT;
            actor.visual.addChild(modelNode);
            // Wider cheeks/body and a lower silhouette, keeping the paws on the ground.
            modelNode.setScale(1.13, 0.88, 1.08);
            const renderer = modelNode.addComponent(MeshRenderer);
            renderer.mesh = model.mesh;
            renderer.setSharedMaterial(material, 0);
            fallback.active = false;
            fallback.destroy();
        } catch {
            modelNode?.destroy();
            if (material) { this.materials.delete(key); material.destroy(); }
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
        const actor: Actor = { node: root, visual, pet, target: root.position.clone(), timer: 2 + Math.random() * 3, phase: Math.random() * 6 };
        this.actors.push(actor);
        // AI 模型就绪后替换几何 Fallback，加载失败不影响点击与照顾。
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
                const scale = Math.min(1, (this.width - 40) / 1000, (this.height - 430) / 1420);
                this.sheet.setScale(scale, scale, 1);
            }
            if (this.page === 'daily' || this.page === 'bag') this.sheet.setPosition(0, -10, 0);
            if (this.page === 'shop' || this.page === 'daily' || this.page === 'bag') {
                const scale = Math.min(1, (this.width - 40) / (this.page === 'daily' ? 1024 : this.page === 'bag' ? 921 : 900), (this.height - 420) / (this.page === 'daily' ? 1400 : this.page === 'bag' ? 1390 : 1300));
                this.sheet.setScale(scale, scale, 1);
            }
        }
    }
    private petAvatar(parent: Node, id: number, x: number, y: number, size: number, locked = false) {
        const b = BREEDS[id], s = size / 100;
        const n = this.uiNode(parent, '伙伴头像-' + b.kind + '-' + id, x, y, size, size), g = n.addComponent(Graphics);
        g.fillColor = this.color(C.cream); g.circle(0, 0, size * 0.48); g.fill();
        g.fillColor = this.color(b.accent);
        if (b.kind === 'cat') {
            for (const side of [-1, 1]) {
                g.moveTo(side * 34 * s, 12 * s); g.lineTo(side * 29 * s, 42 * s); g.lineTo(side * 8 * s, 27 * s); g.close(); g.fill();
            }
            g.fillColor = this.color('#E8ADA4');
            for (const side of [-1, 1]) {
                g.moveTo(side * 28 * s, 20 * s); g.lineTo(side * 26 * s, 34 * s); g.lineTo(side * 16 * s, 26 * s); g.close(); g.fill();
            }
        } else {
            for (const side of [-1, 1]) { g.ellipse(side * 31 * s, 10 * s, 13 * s, 25 * s); g.fill(); }
        }
        g.fillColor = this.color(b.color); g.ellipse(0, 2 * s, 35 * s, 32 * s); g.fill();
        g.fillColor = this.color('#F7E6D0'); g.ellipse(0, -11 * s, 20 * s, 13 * s); g.fill();
        g.fillColor = this.color('#303A35');
        for (const side of [-1, 1]) { g.circle(side * 13 * s, 7 * s, 3.5 * s); g.fill(); }
        g.fillColor = this.color(C.white);
        for (const side of [-1, 1]) { g.circle((side * 13 - 1) * s, 8 * s, 1.1 * s); g.fill(); }
        g.fillColor = this.color(b.kind === 'cat' ? '#BD8881' : '#4F4B43'); g.ellipse(0, -7 * s, 4.5 * s, 3.2 * s); g.fill();
        g.strokeColor = this.color('#71584C'); g.lineWidth = 1.8 * s;
        g.moveTo(0, -10 * s); g.lineTo(0, -14 * s); g.moveTo(0, -14 * s); g.lineTo(-5 * s, -17 * s); g.moveTo(0, -14 * s); g.lineTo(5 * s, -17 * s); g.stroke();
        if (locked) {
            const overlay = this.uiNode(n, '未解锁遮罩', 0, 0, size, size), mask = overlay.addComponent(Graphics);
            mask.fillColor = new Color(66, 91, 80, 175); mask.circle(0, 0, size * 0.48); mask.fill();
            mask.strokeColor = this.color(C.cream); mask.lineWidth = size * 0.045;
            mask.arc(0, size * 0.045, size * 0.1, 0, Math.PI, false); mask.stroke();
            mask.fillColor = this.color(C.cream); mask.roundRect(-size * 0.15, -size * 0.18, size * 0.3, size * 0.24, size * 0.04); mask.fill();
        }
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
        const scale = Math.min(1, (this.width - 40) / 900, (this.height - 40) / (904 * 900 / 1116));
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
                this.petAvatar(h.profile, this.data.avatar, -159, 0, 102);
                h.profile.children[h.profile.children.length - 1].setSiblingIndex(0);
                h.avatar = this.data.avatar;
            }
            return;
        }
        this.top.getComponent(UITransform)!.setContentSize(1024, 228);
        if (!this.top.getComponent(BlockInputEvents)) this.intercept(this.top);
        const level = Math.floor(this.data.xp / 100) + 1, progress = this.data.xp % 100;
        const profile = this.uiNode(this.top, '头像等级经验', -276, 17, 470, 150);
        this.petAvatar(profile, this.data.avatar, -159, 0, 102);
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
        if (!careMode && existingHome) {
            for (const button of this.bottom.children) {
                if (!button.name.startsWith('导航-')) continue;
                const selected = button.getChildByName('主城素材-selected');
                if (selected) selected.active = button.name === '导航-' + this.page;
            }
            return;
        }
        this.clear(this.bottom); if (!this.bottom.getComponent(BlockInputEvents)) this.intercept(this.bottom);
        if (careMode) { this.renderCareNav(); return; }
        void this.navArt(this.bottom, 'dock', 0, 0, 1080, 190);
        const items: [Page, string][] = [['home', '主城'], ['recruit', '招募'], ['adventure', '冒险'], ['album', '图鉴'], ['shop', '商店']];
        items.forEach(([page, name], i) => {
            const active = this.page === page;
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
        this.page = page; this.adventureLabel = null;
        if (page === 'pet') this.petSelected = true;
        if (page === 'home') { this.petSelected = false; this.careSelected = ''; }
        if (this.sheet) {
            this.retirePanel(this.sheet);
            this.sheet = null;
        }
        this.updateSelectionRing(); this.renderNav();
        this.layoutNotice();
        const dailyEntry = this.ui.getChildByName('每日任务入口');
        if (dailyEntry) dailyEntry.active = page === 'home';
        if (page === 'home') return;
        if (page === 'recruit') {
            this.sheet = this.uiNode(this.ui, '招募面板', 0, 0, 1000, 1420);
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
        if (page === 'pet') {
            this.sheet = this.uiNode(this.ui, '宠物状态', 0, -this.height / 2 + 350, 900, 300);
            this.headerArt(this.sheet, 'pet-status'); this.intercept(this.sheet);
            this.headerText(this.sheet, BREEDS[this.selected].name + ' · 小日常', 0, 84, 600, 36, 27).node.name = '宠物标题';
            this.renderPet();
            this.animatePanelOpen();
            return;
        }
        this.sheet = this.uiNode(this.ui, '操作卡片', 0, -this.height / 2 + 640, 1024, 866); this.card(this.sheet); this.intercept(this.sheet);
        const titles: Record<string, string> = { pet: BREEDS[this.selected].name + '的小日常', recruit: '遇见新的毛茸茸', adventure: '任务区 · 林间寻宝', album: '伙伴图鉴', shop: '庭院补给铺', bag: '我的背包' };
        this.text(this.sheet, titles[page], -60, 363, 760, 64, 40);
        this.button(this.sheet, '收起', 405, 363, 150, 66, () => this.open('home'), C.pale, 27);
        if (page === 'album') this.renderAlbum();
        if (page === 'adventure') this.renderAdventure();
        this.animatePanelOpen();
    }

    private renderPet() {
        const p = this.data.pets.find(v => v.id === this.selected)!;
        const title = this.sheet!.getChildByName('宠物标题')?.getComponent(Label);
        if (title) title.string = BREEDS[this.selected].name + ' · 小日常';
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
        stats.forEach(stat => { nextPet[stat] = Math.max(0, Math.min(100, p[stat] + effects[stat]!)); });
        const xp = Math.min(100000000, this.data.xp + 15);
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
        this.toast((item ? '已使用' + item.name : '精神满满') + '，经验 +15' + (tired ? '（体力已降至0）' : ''));
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
        this.intercept(node); this.pressVisualFeedback(node, node.children.slice());
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
                const pet = { id, hunger: 70, clean: 80, energy: 85, joy: 75 };
                pets.push(pet); added.push(pet);
            });
            const candidate = { ...this.dailyCandidate(now), gems: this.data.gems - cost, pets, recruit };
            if (!this.commitShop(candidate)) return;
            added.forEach(p => this.spawnPet(p));
            this.renderHeader(); this.updateRecruit();
            this.toast(mode === 'reward' ? '已领取累计' + claimed + '次奖励' : '招募成功，本体已保留');
        } finally { this.recruitBusy = false; }
    }

    private updateRecruit() {
        const state = this.data.recruit;
        this.recruitLabels.forEach((label, id) => { label.string = BREEDS[id].name + '\n本体×' + state.copies[id]; });
        const next = nextMilestone(state.claimed), ready = state.total >= next;
        if (this.recruitProgress) this.recruitProgress.string = '累计 ' + state.total + ' / ' + next + ' 次 · ' + (ready ? '领取1只伙伴' : '达标送1只伙伴');
        if (this.recruitBadge) this.recruitBadge.active = ready;
        const fill = this.sheet?.getChildByName('领取招募累计奖励')?.getChildByName('招募累计进度填充')?.getComponent(Sprite);
        if (fill) fill.fillRange = Math.min(1, state.total / next);
        if (this.recruitResult) {
            const counts = BREEDS.map((b, id) => ({ name: b.name, count: state.recent.filter(value => value === id).length })).filter(item => item.count);
            this.recruitResult.string = counts.length ? '最近获得：' + counts.map(item => item.name + '×' + item.count).join('、') : '重复伙伴保留本体 · 可在头像下查看库存';
        }
    }

    private renderRecruit() {
        const panel = this.sheet!;
        this.recruitLabels = [];
        // 背景独立于正文缩放，位于货币与底栏后方，且不拦截输入。
        this.recruitBackground = this.recruitArt(this.ui, 'background', 0, 0, 1080, 1920);
        this.recruitBackground.setSiblingIndex(0);
        this.recruitArt(panel, 'title', 0, 632, 400, 140);
        this.dailyText(panel, '遇见新的毛茸茸', 0, 632, 370, 46, 34);
        const back = this.recruitButton(panel, '返回', 'normal', -408, 638, 154, 70, () => this.open('home'));
        back.name = '招募返回';
        const search = this.recruitButton(panel, '', 'search', 420, 638, 78, 80, () => this.showDialog('招募卡池', BREEDS.map(b => b.name).join('、') + '\n普通与高级共用卡池，所有伙伴等权', [{ title: '知道了', run: () => this.closeDialog() }]));
        search.name = '查看招募卡池';
        // y=560 至 -210 留给背景立绘，不叠加说明板或库存卡片。
        this.recruitArt(panel, 'preview', 0, -300, 916, 160);
        BREEDS.forEach((b, id) => {
            const x = -375 + id * 150;
            const card = this.uiNode(panel, '招募本体-' + id, x, -300, 144, 160);
            this.petAvatar(card, id, 0, 25, 86);
            const stock = this.dailyText(card, '', 0, -44, 142, 54, 20);
            stock.enableWrapText = true;
            this.recruitLabels.push(stock);
        });
        this.recruitButton(panel, '普通招募 · 300钻 / 1次', 'normal', -235, -470, 430, 144, () => this.recruitTransaction('single'));
        const ten = this.recruitButton(panel, '高级招募 · 2700钻 / 10次', 'advanced', 235, -470, 430, 144, () => this.recruitTransaction('ten'));
        this.dailyText(ten, '9折', 100, 40, 70, 26, 22).node.name = '十抽9折文字牌';
        this.recruitResult = this.dailyText(panel, '', 0, -578, 880, 48, 18);
        this.recruitResult.node.name = '招募最近结果';
        this.recruitResult.enableWrapText = true;
        const reward = this.uiNode(panel, '领取招募累计奖励', 0, -656, 900, 88);
        const track = this.uiNode(reward, '招募累计进度槽', 0, 0, 500, 500 * 134 / 784);
        this.headerArt(track, 'xp-track');
        const bar = this.uiNode(reward, '招募累计进度填充', 0, 0, 500, 500 * 134 / 784);
        const fill = bar.addComponent(Sprite); fill.sizeMode = Sprite.SizeMode.CUSTOM;
        resources.load('art/header/xp-fit/spriteFrame', SpriteFrame, (error, frame) => {
            if (error || !frame || !isValid(fill, true)) return;
            fill.spriteFrame = frame; fill.type = Sprite.Type.FILLED;
            fill.fillType = Sprite.FillType.HORIZONTAL; fill.fillStart = 0;
            fill.fillRange = Math.min(1, this.data.recruit.total / nextMilestone(this.data.recruit.claimed));
        });
        this.intercept(reward); this.pressVisualFeedback(reward, reward.children.slice());
        reward.on(Node.EventType.TOUCH_END, () => this.recruitTransaction('reward'), this);
        this.recruitArt(reward, 'chest', -350, 0, 84, 80);
        this.recruitBadge = this.recruitArt(reward, 'badge', 351, 0, 44, 46);
        this.recruitBadge.active = false;
        this.recruitProgress = this.dailyText(reward, '', 0, 0, 440, 42, 22);
        this.updateRecruit();
    }
    private renderAlbum() {
        this.text(this.sheet!, '已拥有 ' + this.data.pets.length + ' / ' + BREEDS.length + ' · 点击已拥有伙伴切换头像', 0, 268, 940, 50, 27, C.muted);
        BREEDS.forEach((b, i) => {
            const owned = this.data.pets.some(p => p.id === i), x = -250 + (i % 2) * 500, y = 127 - Math.floor(i / 2) * 190;
            const tile = this.button(this.sheet!, '', x, y, 455, 158, () => {
                if (!owned) { this.open('recruit'); return; }
                this.data.avatar = i; this.persist(); this.renderHeader(); this.open('album'); this.toast('已换上' + b.name + '的头像');
            }, owned ? C.green : C.pale, 29);
            this.petAvatar(tile, i, -150, 0, 122, !owned);
            this.text(tile, b.name + '\n' + (owned ? (this.data.avatar === i ? '当前头像' : '设为头像') : '尚未相遇'), 66, 0, 278, 118, 29, C.ink);
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

    private pressVisualFeedback(node: Node, visuals: Node[]) {
        // 只缩放显示层，点击热区与布局节点不变；保留各素材九宫格自身缩放。
        let bases: { node: Node; scale: Vec3 }[] = [];
        const restore = () => {
            bases.forEach(entry => { if (isValid(entry.node, true)) entry.node.setScale(entry.scale); });
            bases = [];
        };
        node.on(Node.EventType.TOUCH_START, () => {
            if (bases.length) return;
            bases = visuals.filter(n => isValid(n, true)).map(n => ({ node: n, scale: n.scale.clone() }));
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
        const xp = Math.min(100000000, candidate.xp + 25);
        const levels = Math.floor(xp / 100) - Math.floor(candidate.xp / 100);
        candidate.adventureEnd = 0; candidate.xp = xp;
        candidate.coins = Math.min(100000000, candidate.coins + 80 + levels * 60);
        candidate.gems = Math.min(100000000, candidate.gems + 8 + levels * 12);
        recordDaily(candidate.daily, 'adventure');
        if (!this.commitShop(candidate)) return;
        this.renderHeader(); this.open('adventure'); this.toast('寻宝成功！金币 +80，钻石 +8，经验 +25');
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
            this.data.pets.forEach(p => { p.hunger = Math.max(0, p.hunger - 1); p.clean = Math.max(0, p.clean - 0.7); p.joy = Math.max(0, p.joy - 0.5); p.energy = Math.max(0, p.energy - 0.35); });
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
                if (a.timer >= 0) a.timer = Math.max(a.timer, 4);
                if (b.timer >= 0) b.timer = Math.max(b.timer, 4);
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

    private showSocialBubble(actor: Actor, side: number) {
        if (!isValid(this.ui, true)) return;
        if (!this.bubbleLayer || !isValid(this.bubbleLayer, true)) {
            this.bubbleLayer = this.uiNode(this.ui, '伙伴相遇气泡层', 0, 0, this.width, this.height);
            this.bubbleLayer.setSiblingIndex(0);
        }
        const node = this.uiNode(this.bubbleLayer, '友好相遇', 0, 0, 146, 48);
        this.card(node, C.cream, 20);
        const g = node.getComponent(Graphics)!;
        g.fillColor = this.color(C.cream);
        g.moveTo(-8, -21); g.lineTo(0, -31); g.lineTo(10, -21); g.close(); g.fill();
        g.fillColor = this.color(C.coral); g.strokeColor = this.color(C.coral); g.lineWidth = 2;
        if (Math.random() < 0.5) {
            g.moveTo(-48, -9);
            g.bezierCurveTo(-73, 6, -56, 20, -48, 9);
            g.bezierCurveTo(-40, 20, -23, 6, -48, -9); g.close(); g.fill();
        } else {
            g.circle(-48, 1, 12); g.stroke();
            g.circle(-52, 5, 1.6); g.fill(); g.circle(-44, 5, 1.6); g.fill();
            g.moveTo(-54, -1); g.bezierCurveTo(-51, -7, -45, -7, -42, -1); g.stroke();
        }
        const phrases = ['好朋友', '一起玩', '好开心', '见到你真好'];
        this.text(node, phrases[Math.floor(Math.random() * phrases.length)], 15, 0, 104, 38, 21, C.coral);
        this.socialBubbles.push({ node, actor, until: this.socialTime + 2, side });
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
                    }
                });
            }
            this.needHistory.set(pet.id, needs.map(item => item[0]));
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
                const icon = queue.shift()!.icon;
                if (!this.bubbleLayer || !isValid(this.bubbleLayer, true)) {
                    this.bubbleLayer = this.uiNode(this.ui, '伙伴相遇气泡层', 0, 0, this.width, this.height);
                    this.bubbleLayer.setSiblingIndex(0);
                }
                const node = this.uiNode(this.bubbleLayer, '照顾需求-' + pet.id, 0, 0, 94, 94);
                const g = node.addComponent(Graphics);
                g.fillColor = this.color(C.cream); g.strokeColor = this.color('#D9B88B'); g.lineWidth = 3;
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
                bubble = { node, icon, until: this.socialTime + 2 }; this.needBubbles.set(pet.id, bubble);
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
            if (!alive.has(id)) { this.needHistory.delete(id); this.needQueue.delete(id); }
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
            const x = local.x + bubble.side * 78, y = local.y + 20;
            const minY = -this.height / 2 + 230, maxY = this.height / 2 - 335;
            bubble.node.active = screen.z >= 0 && screen.z <= 1 && this.page === 'home' && maxY > minY;
            bubble.node.setPosition(Math.max(-this.width / 2 + 80, Math.min(this.width / 2 - 80, x)), Math.max(minY, Math.min(maxY, y)), 0);
            return true;
        });
    }

    update(dt: number) {
        const delta = Math.max(0, Math.min(dt, 0.1));
        const steps = Math.max(1, Math.ceil(delta / (1 / 60))), step = delta / steps;
        for (let i = 0; i < steps; i++) {
            this.actors.forEach(a => {
                if (!isValid(a.node, true)) return;
                let moving = false;
                if (a.timer < 0) {
                    a.timer = Math.min(0, a.timer + step);
                    a.node.setPosition(a.node.position.x, Math.abs(Math.sin(a.timer * 9)) * 0.22, a.node.position.z);
                } else if ((a.socialUntil || 0) > this.socialTime) {
                    a.node.setPosition(a.node.position.x, 0, a.node.position.z);
                } else {
                    a.timer -= step;
                    if (a.timer <= 0) { a.target.set((Math.random() - 0.5) * 4.6, 0, (Math.random() - 0.5) * 3.2); a.timer = 4 + Math.random() * 5; }
                    const pos = a.node.position, dx = a.target.x - pos.x, dz = a.target.z - pos.z, distance = Math.hypot(dx, dz);
                    if (distance > 0.15 && a.pet.energy > 5) {
                        const travel = Math.min(distance - 0.15, step * 0.65);
                        a.node.setPosition(pos.x + dx / distance * travel, 0, pos.z + dz / distance * travel);
                        a.facing = Math.atan2(dx, dz) * 180 / Math.PI;
                        // 按实际行进距离推进步相，静止不继续摇摆。
                        a.phase = (a.phase + travel * 10) % (Math.PI * 2);
                        moving = travel > 0;
                    } else a.node.setPosition(pos.x, 0, pos.z);
                }
                if (a.facing !== undefined) {
                    const yaw = a.node.eulerAngles.y;
                    const difference = ((a.facing - yaw + 540) % 360) - 180;
                    a.node.setRotationFromEuler(0, yaw + difference * (1 - Math.exp(-step * 7)), 0);
                }
                const settle = 1 - Math.exp(-step * 14);
                const lift = moving ? (1 - Math.cos(a.phase * 2)) * 0.006 : 0;
                const roll = moving ? Math.sin(a.phase) * 1.3 : 0;
                a.visual.setPosition(0, a.visual.position.y + (lift - a.visual.position.y) * settle, 0);
                a.visual.setRotationFromEuler(0, 0, a.visual.eulerAngles.z + (roll - a.visual.eulerAngles.z) * settle);
            });
            this.resolvePetCollisions(step);
        }
        this.updateSelectionRing();
        this.updateSocialBubbles();
        this.updateNeedBubbles();
        if (Date.now() < this.noticeUntil) this.layoutNotice();
    }
    onDestroy() {
        this.clearRecruitBackground();
        this.closeDialog();
        this.rewardedVideoProvider = null;
        input.off(Input.EventType.TOUCH_END, this.onWorldTouch, this);
        this.unscheduleAllCallbacks(); if (this.data) this.persist();
        this.socialBubbles.forEach(b => { if (isValid(b.node, true)) b.node.destroy(); });
        this.socialBubbles = []; this.pairCooldowns.clear();
        this.needBubbles.forEach(b => { if (isValid(b.node, true)) b.node.destroy(); });
        this.needBubbles.clear(); this.needHistory.clear(); this.needQueue.clear();
        if (this.bubbleLayer && isValid(this.bubbleLayer, true)) this.bubbleLayer.destroy();
        this.bubbleLayer = null;
        if (this.selectionRing && isValid(this.selectionRing, true)) this.selectionRing.destroy();
        this.selectionRing = null; this.careIcons.clear(); this.skins.clear();
        this.world?.destroy(); this.ui?.destroy(); this.background?.destroy();
        this.worldCamera?.node.destroy(); this.uiCamera?.node.destroy(); this.backgroundCamera?.node.destroy();
        this.materials.forEach(m => m.destroy()); this.meshes.forEach(m => m.destroy());
        this.materials.clear(); this.meshes.clear(); this.petModels.clear();
    }
}
