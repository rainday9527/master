import { _decorator, Component, Node, Camera, Canvas, UITransform, Graphics, Label, Color, Vec3, Vec2, MeshRenderer, Material, primitives, utils, view, ResolutionPolicy, Layers, input, Input, EventTouch, sys, BlockInputEvents, Sprite, SpriteFrame, resources, DirectionalLight, Vec4, JsonAsset, Texture2D, isValid, tween, Tween } from 'cc';

const { ccclass } = _decorator;
type Kind = 'cat' | 'dog';
type Page = 'home' | 'recruit' | 'adventure' | 'album' | 'shop' | 'pet' | 'bag';
interface Pet { id: number; hunger: number; clean: number; energy: number; joy: number; }
interface Save { version: number; coins: number; gems: number; xp: number; avatar: number; pets: Pet[]; food: number; soap: number; toy: number; adventureEnd: number; lastSeen: number; }
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

    onLoad() {
        this.data = this.load();
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
        if (n.name === '友好相遇' || n.name === '已获得' || n.name === '数值') return;
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
    private clear(n: Node) {
        for (const child of n.children.slice()) { child.active = false; child.removeFromParent(); child.destroy(); }
        n.getComponent(Graphics)?.clear();
    }
    private pressFeedback(n: Node) {
        // Keep hit boxes, labels, and the dock stationary; animate only the icon artwork.
        const animate = (scale: number, duration: number) => {
            const target = n.children.find(child => child.name === '照顾图标' || (child.name.startsWith('主城素材-') && !child.name.endsWith('selected') && !child.name.includes('label')));
            if (!target) return;
            Tween.stopAllByTarget(target);
            tween(target).to(duration, { scale: new Vec3(scale, scale, 1) }, { easing: 'quadOut' }).start();
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
        this.bottom.setPosition(0, -this.height / 2 + 90, 0);
        this.notice.node.parent!.setPosition(0, this.height / 2 - (this.page === 'pet' ? 426 : 195), 0);
        this.layoutBackground();
        this.worldCamera.orthoHeight = Math.max(9.5, 9.5 * this.height / 1920);
        if (this.sheet) this.sheet.setPosition(0, this.page === 'pet' ? -this.height / 2 + 330 : -this.height / 2 + 640, 0);
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
            if (currency === 'coins') {
                if (this.page !== 'adventure') this.open('adventure');
                this.toast('完成林间寻宝可获得80金币和8钻石');
            } else {
                if (this.page !== 'adventure') this.open('adventure');
                this.toast('寻宝或照顾伙伴升级可获得钻石，暂未接入充值');
            }
        }, this);
    }

    private renderHeader() {
        this.clear(this.top);
        this.top.getComponent(UITransform)!.setContentSize(1024, 228);
        if (!this.top.getComponent(BlockInputEvents)) this.intercept(this.top);
        const level = Math.floor(this.data.xp / 100) + 1, progress = this.data.xp % 100;
        const profile = this.uiNode(this.top, '头像等级经验', -276, 17, 470, 150);
        this.petAvatar(profile, this.data.avatar, -159, 0, 102);
        this.headerArt(profile, 'profile');
        this.intercept(profile);
        profile.on(Node.EventType.TOUCH_END, () => this.open('album'), this);
        this.headerText(profile, 'Lv.' + level, -45, 25, 100, 36, 27);
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
            fill.fillStart = 0; fill.fillRange = progress / 100;
        });
        const xpLabel = this.headerText(profile, progress + ' / 100', 65, -17, 262, 28, 18);
        xpLabel.color = this.color('#FFF8DF'); xpLabel.outlineColor = this.color('#704121'); xpLabel.outlineWidth = 2;
        // Align to the rectangular info plate, not the taller circular avatar rim.
        // Native 1x transforms avoid nested fractional scaling of icons and text.
        const diamond = this.uiNode(this.top, '钻石栏', 83, 28, 220, 81);
        this.headerArt(diamond, 'currency-panel');
        const gemIcon = this.uiNode(diamond, '独立钻石', -78, 0, 60, 53.5); this.headerArt(gemIcon, 'diamond-icon');
        this.headerText(diamond, String(this.data.gems), -1, 0, 100, 44, 28);
        this.currencyPlus(diamond, 'gems', 80);
        const coin = this.uiNode(this.top, '金币栏', 333, 28, 220, 81);
        this.headerArt(coin, 'currency-panel');
        const coinIcon = this.uiNode(coin, '独立金币', -78, 0, 56, 57.2); this.headerArt(coinIcon, 'coin-icon');
        this.headerText(coin, String(this.data.coins), -1, 0, 100, 44, 28);
        this.currencyPlus(coin, 'coins', 80);
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
                resources.load('art/' + (['feed', 'clean', 'rest', 'play', 'bag'].includes(name) ? 'care/' : 'nav/') + name + '/spriteFrame', SpriteFrame, (error, frame) => resolve(error ? null : frame));
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
            void this.navArt(button, 'label' + i, 0, -48, 160, 49);
            const title = this.text(button, name, 0, -48, 148, 40, 30, '#49301E');
            title.fontFamily = 'Microsoft YaHei, SimHei, sans-serif';
            title.isBold = true;
            title.enableOutline = true;
            title.outlineColor = this.color('#FFF3D5');
            title.outlineWidth = 2;
        });
    }
    private open(page: Page) {
        this.page = page; this.adventureLabel = null;
        if (page === 'pet') this.petSelected = true;
        if (page === 'home') { this.petSelected = false; this.careSelected = ''; }
        if (this.sheet) { this.sheet.active = false; this.sheet.destroy(); this.sheet = null; }
        this.updateSelectionRing(); this.renderNav();
        this.notice.node.parent!.setPosition(0, this.height / 2 - (page === 'pet' ? 426 : 195), 0);
        if (page === 'home') return;
        if (page === 'pet') {
            this.sheet = this.uiNode(this.ui, '宠物状态', 0, -this.height / 2 + 330, 940, 240);
            this.headerArt(this.sheet, 'pet-status'); this.intercept(this.sheet);
            this.headerText(this.sheet, BREEDS[this.selected].name + ' · 小日常', 0, 65, 650, 36, 27);
            this.renderPet();
            return;
        }
        this.sheet = this.uiNode(this.ui, '操作卡片', 0, -this.height / 2 + 640, 1024, 866); this.card(this.sheet); this.intercept(this.sheet);
        const titles: Record<string, string> = { pet: BREEDS[this.selected].name + '的小日常', recruit: '遇见新的毛茸茸', adventure: '林间寻宝', album: '伙伴图鉴', shop: '庭院补给铺', bag: '我的背包' };
        this.text(this.sheet, titles[page], -60, 363, 760, 64, 40);
        const petBag = page === 'bag' && this.petSelected;
        this.button(this.sheet, petBag ? '返回宠物' : '收起', 405, 363, 150, 66, () => this.open(petBag ? 'pet' : 'home'), C.pale, 27);
        if (petBag) this.button(this.sheet, '返回主页', 0, -425, 220, 44, () => this.open('home'), C.pale, 23);
        if (page === 'recruit') this.renderRecruit();
        if (page === 'album') this.renderAlbum();
        if (page === 'shop') this.renderShop();
        if (page === 'adventure') this.renderAdventure();
        if (page === 'bag') this.renderBag();
    }

    private renderPet() {
        const p = this.data.pets.find(v => v.id === this.selected)!;
        const needs: [string, number][] = [['饱腹', p.hunger], ['洁净', p.clean], ['体力', p.energy], ['心情', p.joy]];
        needs.forEach(([name, value], i) => {
            const x = -202 + (i % 2) * 404, y = 5 - Math.floor(i / 2) * 59;
            this.headerText(this.sheet!, name, x - 125, y, 72, 34, 23);
            const bg = this.uiNode(this.sheet!, name + '-槽', x + 14, y, 192, 33);
            this.headerArt(bg, 'xp-track');
            const fillNode = this.uiNode(this.sheet!, name + '-进度', x + 14, y, 192, 33);
            const fill = fillNode.addComponent(Sprite); fill.sizeMode = Sprite.SizeMode.CUSTOM;
            resources.load('art/header/xp-fit/spriteFrame', SpriteFrame, (error, frame) => {
                if (error || !frame || !isValid(fill, true)) return;
                fill.spriteFrame = frame; fill.type = Sprite.Type.FILLED;
                fill.fillType = Sprite.FillType.HORIZONTAL; fill.fillStart = 0; fill.fillRange = value / 100;
                if (value < 30) fill.color = this.color('#F0A68A');
            });
            this.headerText(this.sheet!, String(Math.round(value)), x + 137, y, 58, 34, 23);
        });
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
            const tile = this.button(this.sheet!, '', x, y, 455, 158, () => {
                if (!owned) { this.open('recruit'); return; }
                this.data.avatar = i; this.persist(); this.renderHeader(); this.open('album'); this.toast('已换上' + b.name + '的头像');
            }, owned ? C.green : C.pale, 29);
            this.petAvatar(tile, i, -150, 0, 122, !owned);
            this.text(tile, b.name + '\n' + (owned ? (this.data.avatar === i ? '当前头像' : '设为头像') : '尚未相遇'), 66, 0, 278, 118, 29, C.ink);
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
    private toast(message: string) {
        if (!this.notice) return;
        const panel = this.notice.node.parent!;
        panel.setSiblingIndex(this.ui.children.length - 1);
        panel.setPosition(0, this.page === 'pet' ? -this.height / 2 + 525 : this.height / 2 - 265, 0);
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
        if (Date.now() < this.blockedUntil) return;
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
    }
    onDestroy() {
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
