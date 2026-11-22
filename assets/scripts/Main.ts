import { _decorator, Component, Node, Camera, Canvas, UITransform, Graphics, Label, Color, Vec3, Vec2, MeshRenderer, Material, primitives, utils, view, ResolutionPolicy, Layers, input, Input, EventTouch, sys, BlockInputEvents } from 'cc';

const { ccclass } = _decorator;
type Kind = 'cat' | 'dog';
type Page = 'home' | 'recruit' | 'adventure' | 'album' | 'shop' | 'pet' | 'bag';
interface Pet { id: number; hunger: number; clean: number; energy: number; joy: number; }
interface Save { version: number; coins: number; gems: number; xp: number; avatar: number; pets: Pet[]; food: number; soap: number; toy: number; adventureEnd: number; lastSeen: number; }
interface Actor { node: Node; pet: Pet; target: Vec3; timer: number; phase: number; }
const BREEDS: { name: string; kind: Kind; color: string; accent: string; cost: number }[] = [
    { name: '奶糖猫', kind: 'cat', color: '#F4D7AD', accent: '#B68C63', cost: 0 },
    { name: '布丁犬', kind: 'dog', color: '#CE9763', accent: '#825C43', cost: 0 },
    { name: '云朵猫', kind: 'cat', color: '#F6F4EF', accent: '#A5B3BC', cost: 35 },
    { name: '芝麻犬', kind: 'dog', color: '#777F89', accent: '#E5D3BA', cost: 45 },
    { name: '橘子猫', kind: 'cat', color: '#EFA65C', accent: '#B36F37', cost: 55 },
    { name: '桃桃犬', kind: 'dog', color: '#EACBB9', accent: '#B99183', cost: 65 },
];
const C = { cream: '#FFF9ED', ink: '#425B50', green: '#679B7C', pale: '#E5EFDF', coral: '#DF8C77', muted: '#819487', white: '#FFFFFF' };

@ccclass('Main')
export class Main extends Component {
    private readonly key = 'cat-paradise-save-v1';
    private data!: Save;
    private world!: Node;
    private ui!: Node;
    private top!: Node;
    private bottom!: Node;
    private sheet: Node | null = null;
    private notice!: Label;
    private worldCamera!: Camera;
    private uiCamera!: Camera;
    private actors: Actor[] = [];
    private materials = new Map<string, Material>();
    private meshes = new Map<string, ReturnType<typeof utils.createMesh>>();
    private page: Page = 'home';
    private selected = 0;
    private width = 1080;
    private height = 1920;
    private blockedUntil = 0;
    private noticeUntil = 0;
    private elapsed = 0;
    private dirty = false;
    private adventureLabel: Label | null = null;
    private saveWarning = false;

    onLoad() {
        this.data = this.load();
        view.setDesignResolutionSize(1080, 1920, ResolutionPolicy.FIXED_WIDTH);
        this.world = new Node('温暖庭院');
        this.node.addChild(this.world);
        this.makeCamera();
        this.makeGarden();
        this.data.pets.forEach(p => this.spawnPet(p));
        this.makeUI();
        input.on(Input.EventType.TOUCH_END, this.onWorldTouch, this);
        this.schedule(this.tick, 1);
        if (this.saveWarning) this.toast('存档异常，已安全恢复为初始庭院');
    }

    private fresh(): Save {
        return { version: 1, coins: 260, gems: 100, xp: 0, avatar: 0,
            pets: [0, 1].map(id => ({ id, hunger: 75, clean: 85, energy: 90, joy: 80 })),
            food: 5, soap: 4, toy: 3, adventureEnd: 0, lastSeen: Date.now() };
    }

    private load(): Save {
        try {
            const raw = sys.localStorage.getItem(this.key);
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
            return s;
        } catch { this.saveWarning = true; return this.fresh(); }
    }

    private persist() {
        this.data.lastSeen = Date.now();
        try { sys.localStorage.setItem(this.key, JSON.stringify(this.data)); this.dirty = false; }
        catch { this.toast('本地存储不可用，本次进度仅保留在运行期间'); }
    }

    private makeCamera() {
        const n = new Node('庭院相机'); this.node.addChild(n);
        this.worldCamera = n.addComponent(Camera);
        this.worldCamera.projection = Camera.ProjectionType.ORTHO;
        this.worldCamera.orthoHeight = 20.5;
        this.worldCamera.near = 0.1; this.worldCamera.far = 100;
        this.worldCamera.visibility = Layers.Enum.DEFAULT;
        this.worldCamera.clearColor = this.color('#E8EFDF');
        this.worldCamera.priority = 0;
        n.setPosition(12, 22, 19); n.lookAt(new Vec3(0, 0, 0));
    }

    private color(hex: string): Color { return new Color().fromHEX(hex); }
    private shape(parent: Node, type: 'box' | 'sphere' | 'cone' | 'cylinder', color: string, pos: number[], scale: number[], rotation?: number[]): Node {
        const n = new Node(type); parent.addChild(n); n.layer = Layers.Enum.DEFAULT;
        n.setPosition(pos[0], pos[1], pos[2]); n.setScale(scale[0], scale[1], scale[2]);
        if (rotation) n.setRotationFromEuler(rotation[0], rotation[1], rotation[2]);
        const renderer = n.addComponent(MeshRenderer);
        let mesh = this.meshes.get(type);
        if (!mesh) {
            const geometry = type === 'box' ? primitives.box() : type === 'sphere' ? primitives.sphere(0.5, { segments: 12 }) : type === 'cone' ? primitives.cone(0.5, 1, { radialSegments: 8 }) : primitives.cylinder(0.5, 0.5, 1, { radialSegments: 10 });
            mesh = utils.createMesh(geometry); this.meshes.set(type, mesh);
        }
        renderer.mesh = mesh;
        let mat = this.materials.get(color);
        if (!mat) { mat = new Material(); mat.initialize({ effectName: 'builtin-unlit' }); mat.setProperty('mainColor', this.color(color)); this.materials.set(color, mat); }
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

    private spawnPet(pet: Pet) {
        const b = BREEDS[pet.id], cat = b.kind === 'cat';
        const n = new Node(b.name); this.world.addChild(n);
        n.setPosition((pet.id % 3 - 1) * 2, 0, 0.5 + Math.floor(pet.id / 3) * 2);
        this.shape(n, 'sphere', '#A1B28A', [0, 0.04, 0], [1.35, 0.06, 1.8]);
        this.shape(n, 'sphere', b.color, [0, 0.65, 0], [cat ? 0.9 : 1.05, 0.95, 1.45]);
        this.shape(n, 'sphere', b.color, [0, 1.2, 0.65], [cat ? 1.05 : 1.1, 1, 0.95]);
        for (const x of [-0.32, 0.32]) for (const z of [-0.45, 0.4]) {
            this.shape(n, 'sphere', b.color, [x, 0.28, z], [0.28, 0.55, 0.3]);
            this.shape(n, 'sphere', '#F8E8D1', [x, 0.12, z + 0.07], [0.3, 0.22, 0.37]);
        }
        for (const side of [-1, 1]) {
            if (cat) {
                this.shape(n, 'cone', b.accent, [side * 0.34, 1.85, 0.63], [0.42, 0.62, 0.38], [0, 0, -side * 12]);
                this.shape(n, 'cone', '#E8ADA4', [side * 0.34, 1.86, 0.78], [0.23, 0.37, 0.09]);
            } else this.shape(n, 'sphere', b.accent, [side * 0.54, 1.27, 0.57], [0.4, 0.95, 0.46], [0, 0, side * 15]);
            this.shape(n, 'sphere', '#3B423B', [side * 0.23, 1.3, 1.075], [0.12, 0.16, 0.075]);
            this.shape(n, 'sphere', '#FFFFFF', [side * 0.23 - 0.015, 1.33, 1.11], [0.035, 0.045, 0.025]);
            this.shape(n, 'sphere', '#E6AC9C', [side * 0.32, 1.08, 1.075], [0.18, 0.09, 0.04]);
        }
        this.shape(n, 'sphere', '#F7E6D0', [0, 0.99, 1.08], [cat ? 0.45 : 0.65, 0.32, cat ? 0.22 : 0.42]);
        this.shape(n, 'sphere', cat ? '#BD8881' : '#4F4B43', [0, 1.1, cat ? 1.22 : 1.3], [0.15, 0.1, 0.1]);
        this.shape(n, 'sphere', b.accent, [0, 0.99, -0.85], [0.22, cat ? 1.1 : 0.65, 0.24], [-30, 0, 0]);
        this.shape(n, 'box', cat ? '#D79582' : '#739E9D', [0, 0.89, 0.45], [0.88, 0.12, 0.2]);
        this.actors.push({ node: n, pet, target: n.position.clone(), timer: 2 + Math.random() * 3, phase: Math.random() * 6 });
    }

    private makeUI() {
        this.ui = new Node('庭院界面'); this.node.addChild(this.ui); this.ui.layer = Layers.Enum.UI_2D;
        this.ui.addComponent(UITransform);
        const cameraNode = new Node('界面相机'); this.node.addChild(cameraNode); cameraNode.setPosition(0, 0, 1000);
        this.uiCamera = cameraNode.addComponent(Camera); this.uiCamera.projection = Camera.ProjectionType.ORTHO;
        this.uiCamera.visibility = Layers.Enum.UI_2D; this.uiCamera.priority = 10;
        this.uiCamera.clearFlags = Camera.ClearFlag.DEPTH_ONLY; this.uiCamera.near = 0.1; this.uiCamera.far = 2000;
        const canvas = this.ui.addComponent(Canvas); canvas.cameraComponent = this.uiCamera;
        this.top = this.uiNode(this.ui, '顶栏', 0, 0, 1024, 196);
        this.bottom = this.uiNode(this.ui, '底栏', 0, 0, 1040, 142);
        const note = this.uiNode(this.ui, '提示', 0, 0, 980, 66);
        this.notice = this.text(note, '点击庭院里的猫猫狗狗，开始照顾它们', 0, 0, 950, 54, 27, C.ink);
        this.layout(); this.renderHeader(); this.renderNav();
    }

    private uiNode(parent: Node, name: string, x: number, y: number, w: number, h: number): Node {
        const n = new Node(name); n.layer = Layers.Enum.UI_2D; parent.addChild(n); n.setPosition(x, y, 0);
        n.addComponent(UITransform).setContentSize(w, h); return n;
    }
    private card(n: Node, fill = C.cream, radius = 28) {
        const size = n.getComponent(UITransform)!.contentSize;
        const g = n.getComponent(Graphics) || n.addComponent(Graphics); g.clear(); g.fillColor = this.color(fill);
        g.roundRect(-size.width / 2, -size.height / 2, size.width, size.height, radius); g.fill();
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
        this.text(n, title, 0, 0, w - 18, h - 8, font, fill === C.pale || fill === C.cream ? C.ink : C.white);
        n.on(Node.EventType.TOUCH_END, (event: EventTouch) => { event.propagationStopped = true; this.blockedUntil = Date.now() + 350; action(); }, this);
        return n;
    }
    private clear(n: Node) { for (const child of n.children.slice()) child.destroy(); n.getComponent(Graphics)?.clear(); }
    private layout() {
        const size = view.getVisibleSize(); this.width = size.width; this.height = size.height;
        this.ui.getComponent(UITransform)!.setContentSize(this.width, this.height);
        this.uiCamera.orthoHeight = this.height / 2;
        this.top.setPosition(0, this.height / 2 - 136, 0);
        this.bottom.setPosition(0, -this.height / 2 + 114, 0);
        this.notice.node.parent!.setPosition(0, this.height / 2 - 280, 0);
        this.worldCamera.orthoHeight = Math.max(20.5, 20.5 * this.height / 1920);
        if (this.sheet) this.sheet.setPosition(0, -this.height / 2 + 640, 0);
    }
    private renderHeader() {
        this.clear(this.top); this.card(this.top); if (!this.top.getComponent(BlockInputEvents)) this.intercept(this.top);
        const level = Math.floor(this.data.xp / 100) + 1, progress = this.data.xp % 100;
        this.button(this.top, BREEDS[this.data.avatar].name + '\n头像', -390, 0, 190, 138, () => this.open('album'), C.pale, 29);
        this.text(this.top, '茸茸庭院  Lv.' + level, -90, 48, 350, 48, 34);
        this.text(this.top, '经验 ' + progress + ' / 100', -90, -6, 340, 38, 24, C.muted);
        const bar = this.uiNode(this.top, '经验进度', -90, -51, 310, 15); this.card(bar, C.pale, 7);
        if (progress > 0) { const f = this.uiNode(bar, '已获得', -155 + 155 * progress / 100, 0, 310 * progress / 100, 15); this.card(f, C.green, 7); }
        this.text(this.top, '金币  ' + this.data.coins, 315, 38, 320, 52, 31);
        this.text(this.top, '钻石  ' + this.data.gems, 315, -36, 320, 52, 31, C.coral);
    }
    private renderNav() {
        this.clear(this.bottom); this.card(this.bottom); if (!this.bottom.getComponent(BlockInputEvents)) this.intercept(this.bottom);
        const items: [Page, string][] = [['home', '主城'], ['recruit', '招募'], ['adventure', '冒险'], ['album', '图鉴'], ['shop', '商店']];
        items.forEach(([page, name], i) => this.button(this.bottom, name, -408 + i * 204, 0, 186, 94, () => this.open(page), this.page === page ? C.green : C.pale, 31));
    }
    private open(page: Page) {
        this.page = page; this.adventureLabel = null;
        if (this.sheet) { this.sheet.destroy(); this.sheet = null; }
        this.renderNav(); if (page === 'home') return;
        this.sheet = this.uiNode(this.ui, '操作卡片', 0, -this.height / 2 + 640, 1024, 866); this.card(this.sheet); this.intercept(this.sheet);
        const titles: Record<string, string> = { pet: BREEDS[this.selected].name + '的小日常', recruit: '遇见新的毛茸茸', adventure: '林间寻宝', album: '伙伴图鉴', shop: '庭院补给铺', bag: '我的背包' };
        this.text(this.sheet, titles[page], -60, 363, 760, 64, 40);
        this.button(this.sheet, '收起', 405, 363, 150, 66, () => this.open('home'), C.pale, 27);
        if (page === 'pet') this.renderPet();
        if (page === 'recruit') this.renderRecruit();
        if (page === 'album') this.renderAlbum();
        if (page === 'shop') this.renderShop();
        if (page === 'adventure') this.renderAdventure();
        if (page === 'bag') this.renderBag();
    }

    private renderPet() {
        const p = this.data.pets.find(v => v.id === this.selected)!;
        this.text(this.sheet!, BREEDS[p.id].kind === 'cat' ? '喵呜，今天也想和你一起晒太阳。' : '汪！陪你散步是最开心的事。', 0, 270, 900, 55, 27, C.muted);
        const needs: [string, number][] = [['饱腹', p.hunger], ['洁净', p.clean], ['体力', p.energy], ['心情', p.joy]];
        needs.forEach(([name, value], i) => {
            const y = 177 - i * 83;
            this.text(this.sheet!, name, -365, y, 140, 48, 28);
            const bg = this.uiNode(this.sheet!, name, 38, y, 570, 24); this.card(bg, C.pale, 12);
            if (value > 0) { const f = this.uiNode(bg, '数值', -285 + 285 * value / 100, 0, 570 * value / 100, 24); this.card(f, value < 30 ? C.coral : C.green, 12); }
            this.text(this.sheet!, String(Math.round(value)), 412, y, 95, 48, 28);
        });
        this.button(this.sheet!, '喂养 · 食物 ' + this.data.food, -245, -205, 440, 90, () => this.care('food'));
        this.button(this.sheet!, '清洁 · 用品 ' + this.data.soap, 245, -205, 440, 90, () => this.care('soap'));
        this.button(this.sheet!, '休息 · 免费', -245, -315, 440, 90, () => this.care('rest'), C.coral);
        this.button(this.sheet!, '陪玩 · 玩具 ' + this.data.toy, 245, -315, 440, 90, () => this.care('toy'), C.coral);
        this.button(this.sheet!, '查看背包', 0, -397, 400, 50, () => this.open('bag'), C.pale, 24);
    }
    private care(item: 'food' | 'soap' | 'toy' | 'rest') {
        const p = this.data.pets.find(v => v.id === this.selected)!;
        const stat = item === 'food' ? 'hunger' : item === 'soap' ? 'clean' : item === 'toy' ? 'joy' : 'energy';
        if (p[stat] >= 99) { this.toast('已经很满足啦，试试其他照顾吧'); return; }
        if (item !== 'rest' && this.data[item] <= 0) { this.toast('库存不足，去补给铺看看吧'); return; }
        if (item !== 'rest') this.data[item]--;
        p[stat] = Math.min(100, p[stat] + (item === 'rest' ? 35 : 40));
        if (item === 'toy') p.energy = Math.max(0, p.energy - 8);
        this.gainXP(15); this.persist(); this.renderHeader(); this.open('pet');
        this.toast(({ food: '吃饱啦，', soap: '香喷喷的，', toy: '玩得好开心，', rest: '精神满满，' })[item] + '经验 +15');
        const actor = this.actors.find(a => a.pet.id === p.id); if (actor) actor.timer = -1.3;
    }
    private gainXP(amount: number) {
        const old = Math.floor(this.data.xp / 100); this.data.xp = Math.min(100000000, this.data.xp + amount);
        const gained = Math.floor(this.data.xp / 100) - old;
        if (gained > 0) { this.data.gems = Math.min(100000000, this.data.gems + gained * 12); this.data.coins = Math.min(100000000, this.data.coins + gained * 60); }
    }
    private renderRecruit() {
        this.text(this.sheet!, '定向迎接伙伴 · 不重复招募 · 升级可得钻石', 0, 270, 940, 54, 27, C.muted);
        BREEDS.slice(2).forEach((b, i) => {
            const y = 142 - i * 143, owned = this.data.pets.some(p => p.id === i + 2);
            this.text(this.sheet!, (b.kind === 'cat' ? '猫咪  ' : '狗狗  ') + b.name, -240, y, 420, 70, 33);
            this.button(this.sheet!, owned ? '已经在家' : b.cost + ' 钻石 · 迎接', 260, y, 390, 90, () => {
                if (this.data.pets.some(p => p.id === i + 2)) { this.toast('伙伴已经在庭院里等你啦'); return; }
                if (this.data.gems < b.cost) { this.toast('钻石不足，照顾伙伴升级或完成冒险可获得'); return; }
                this.data.gems -= b.cost;
                const p = { id: i + 2, hunger: 70, clean: 80, energy: 85, joy: 75 };
                this.data.pets.push(p); this.spawnPet(p); this.persist(); this.renderHeader(); this.open('recruit'); this.toast(b.name + '搬进庭院啦');
            }, owned ? C.pale : C.coral);
        });
        this.text(this.sheet!, '每位新伙伴都拥有独立的需求与庭院生活', 0, -370, 940, 55, 25, C.muted);
    }
    private renderAlbum() {
        this.text(this.sheet!, '已拥有 ' + this.data.pets.length + ' / ' + BREEDS.length + ' · 点击已拥有伙伴切换头像', 0, 268, 940, 50, 27, C.muted);
        BREEDS.forEach((b, i) => {
            const owned = this.data.pets.some(p => p.id === i), x = -250 + (i % 2) * 500, y = 127 - Math.floor(i / 2) * 190;
            this.button(this.sheet!, (b.kind === 'cat' ? '猫咪' : '狗狗') + ' · ' + b.name + '\n' + (owned ? (this.data.avatar === i ? '当前头像' : '已拥有 · 设为头像') : '尚未相遇'), x, y, 455, 158, () => {
                if (!owned) { this.open('recruit'); return; }
                this.data.avatar = i; this.persist(); this.renderHeader(); this.open('album'); this.toast('已换上' + b.name + '的头像');
            }, owned ? C.green : C.pale, 29);
        });
    }
    private renderShop() {
        this.text(this.sheet!, '用日常冒险获得的金币，换一份贴心照顾', 0, 268, 940, 55, 27, C.muted);
        const goods: ['food' | 'soap' | 'toy', string, string, number][] = [['food', '营养餐', '饱腹 +40', 20], ['soap', '柔软清洁包', '洁净 +40', 15], ['toy', '彩色小球', '心情 +40', 25]];
        goods.forEach(([key, name, info, cost], i) => {
            const y = 125 - i * 170;
            this.text(this.sheet!, name + '  ×' + this.data[key] + '\n' + info, -220, y, 450, 110, 30);
            this.button(this.sheet!, cost + ' 金币 · 买 1 份', 270, y, 390, 100, () => {
                if (this.data.coins < cost) { this.toast('金币不足，去林间寻宝吧'); return; }
                if (this.data[key] >= 100000000) { this.toast('背包已经装满啦'); return; }
                this.data.coins -= cost; this.data[key]++; this.persist(); this.renderHeader(); this.open('shop'); this.toast('已购买' + name);
            });
        });
        this.button(this.sheet!, '打开背包', 0, -373, 680, 70, () => this.open('bag'), C.pale);
    }
    private renderBag() {
        this.text(this.sheet!, '庭院物资 · 点击宠物后使用补给', 0, 263, 920, 60, 29, C.muted);
        [['营养餐', this.data.food], ['柔软清洁包', this.data.soap], ['彩色小球', this.data.toy]].forEach(([name, count], i) => {
            const row = this.uiNode(this.sheet!, '库存', 0, 120 - i * 150, 900, 120); this.card(row, C.pale);
            this.text(row, name + '                      × ' + count, 0, 0, 840, 80, 34);
        });
        this.button(this.sheet!, '补充物资', -240, -365, 420, 85, () => this.open('shop'));
        this.button(this.sheet!, '照顾 ' + BREEDS[this.selected].name, 240, -365, 420, 85, () => this.open('pet'), C.coral);
    }
    private renderAdventure() {
        this.text(this.sheet!, '小小脚步，也能收集大大的惊喜', 0, 267, 940, 55, 29, C.muted);
        const art = this.uiNode(this.sheet!, '冒险图案', 0, 87, 880, 210); this.card(art, C.pale, 32);
        this.text(art, '庭院  —  花径  —  林间宝箱\n伙伴们正在发现生活的小美好', 0, 0, 830, 170, 34);
        this.adventureLabel = this.text(this.sheet!, '', 0, -90, 940, 100, 37, C.green);
        this.updateAdventureLabel();
        this.text(this.sheet!, '每次 60 秒 · 奖励 80 金币 / 8 钻石 / 25 经验\n无需等待在此页面，离线也会计时', 0, -218, 940, 100, 27, C.muted);
        this.button(this.sheet!, this.data.adventureEnd === 0 ? '出发寻宝' : Date.now() >= this.data.adventureEnd ? '领取本次奖励' : '查看寻宝进度', 0, -355, 850, 100, () => {
            if (!this.data.adventureEnd) { this.data.adventureEnd = Date.now() + 60000; this.persist(); this.open('adventure'); this.toast('寻宝出发，60 秒后带回礼物'); }
            else if (Date.now() < this.data.adventureEnd) this.toast('伙伴正在路上，稍后再来看看');
            else {
                this.data.adventureEnd = 0;
                this.data.coins = Math.min(100000000, this.data.coins + 80); this.data.gems = Math.min(100000000, this.data.gems + 8);
                this.gainXP(25); this.persist(); this.renderHeader(); this.open('adventure'); this.toast('寻宝成功！金币 +80，钻石 +8，经验 +25');
            }
        }, C.coral);
    }
    private updateAdventureLabel() {
        if (!this.adventureLabel || !this.adventureLabel.isValid) return;
        const left = Math.ceil((this.data.adventureEnd - Date.now()) / 1000);
        this.adventureLabel.string = !this.data.adventureEnd ? '今日的风景，等你一起发现' : left > 0 ? '寻宝中  ' + Math.floor(left / 60) + ':' + ('0' + left % 60).slice(-2) : '伙伴回来啦 · 礼物等待领取';
    }
    private toast(message: string) { if (this.notice) { this.notice.string = message; this.noticeUntil = Date.now() + 4500; } }

    private onWorldTouch(event: EventTouch) {
        const location = event.getLocation();
        if (Date.now() < this.blockedUntil) return;
        const screen = new Vec3(location.x, location.y, 0), uiWorld = new Vec3(); this.uiCamera.screenToWorld(screen, uiWorld);
        const point = this.ui.getComponent(UITransform)!.convertToNodeSpaceAR(uiWorld);
        if (point.y > this.height / 2 - 250 || point.y < -this.height / 2 + 200 || (this.sheet && point.y < -this.height / 2 + 1090)) return;
        let closest: Actor | null = null, distance = 90;
        this.actors.forEach(actor => {
            const projected = new Vec3(); this.worldCamera.worldToScreen(new Vec3(actor.node.worldPosition.x, actor.node.worldPosition.y + 0.9, actor.node.worldPosition.z), projected);
            const d = Vec2.distance(location, new Vec2(projected.x, projected.y));
            if (projected.z >= 0 && projected.z <= 1 && d < distance) { distance = d; closest = actor; }
        });
        if (closest) { this.selected = (closest as Actor).pet.id; this.open('pet'); }
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
        if (Date.now() > this.noticeUntil) this.notice.string = this.data.adventureEnd && Date.now() >= this.data.adventureEnd ? '寻宝伙伴已归来，点击冒险领取礼物' : '点击猫猫狗狗 · 一起经营温暖的小庭院';
    };
    update(dt: number) {
        const delta = Math.min(dt, 0.1);
        this.actors.forEach(a => {
            a.phase += delta * 4;
            if (a.timer < 0) { a.timer += delta; a.node.setPosition(a.node.position.x, Math.abs(Math.sin(a.timer * 9)) * 0.22, a.node.position.z); return; }
            a.timer -= delta;
            if (a.timer <= 0) { a.target.set((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 6 + 1); a.timer = 4 + Math.random() * 5; }
            const pos = a.node.position, dx = a.target.x - pos.x, dz = a.target.z - pos.z, distance = Math.sqrt(dx * dx + dz * dz);
            if (distance > 0.15 && a.pet.energy > 5) {
                const speed = Math.min(distance, delta * 0.65);
                a.node.setPosition(pos.x + dx / distance * speed, Math.abs(Math.sin(a.phase)) * 0.045, pos.z + dz / distance * speed);
                a.node.setRotationFromEuler(0, Math.atan2(dx, dz) * 180 / Math.PI, 0);
            } else a.node.setPosition(pos.x, 0, pos.z);
        });
    }
    onDestroy() {
        input.off(Input.EventType.TOUCH_END, this.onWorldTouch, this);
        this.unscheduleAllCallbacks(); if (this.data) this.persist();
        this.world?.destroy(); this.ui?.destroy();
        this.worldCamera?.node.destroy(); this.uiCamera?.node.destroy();
        this.materials.forEach(m => m.destroy()); this.meshes.forEach(m => m.destroy());
    }
}
