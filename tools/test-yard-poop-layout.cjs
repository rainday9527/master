// 执行真实 Main 方法；相机采用可控投影桩，不替代真机渲染。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('D:/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript/lib/typescript.js');
class Vec3 { constructor(x=0,y=0,z=0) { Object.assign(this,{x,y,z}); } }
class Vec2 extends Vec3 { static distance(a,b) { return Math.hypot(a.x-b.x,a.y-b.y); } }
const modules = new Map();
function load(name) {
 if(modules.has(name)) return modules.get(name);
 const exports={}; modules.set(name,exports);
 const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../assets/scripts',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,experimentalDecorators:true}}).outputText;
 vm.runInNewContext(code,{exports,console,require:id=>id==='cc/env'?{DEBUG:false}:id==='cc'?{_decorator:{ccclass:()=>c=>c},Component:class{},Vec3,Vec2,isValid:n=>!!n}:load(id.replace('./',''))}); return exports;
}
const {Main}=load('Main');
let cases=0;
for(const [width,height] of [[1080,1920],[1080,2340],[1080,2400],[1440,1920],[3413,1920]]) for(const page of ['home','pet']) {
 const g=new Main(); g.page=page; g.data={poops:[{id:9,petId:0,x:-5,z:4,createdAt:123}],placedFurniture:[{x:0,z:0}]};
 const transform={convertToNodeSpaceAR:p=>p}; g.ui={getComponent:()=>transform,getChildByName:()=>null};
 g.uiCamera={screenToWorld:p=>p}; g.worldCamera={orthoHeight:13,worldToScreen:p=>new Vec3(p.x*width/15,p.z*height/16,0.5)};
 g.chromeBounds=()=>({left:-width/2+24,right:width/2-24,bottom:-height/2+60,top:height/2-100});
 const rects=[{left:-width/2,right:-width/2+230,bottom:0,top:height/2},{left:width/2-230,right:width/2,bottom:0,top:height/2},{left:-width/2,right:width/2,bottom:-height/2,top:-height/2+(page==='pet'?700:180)}];
 g.yardUIRects=()=>rects;
 const original=JSON.stringify(g.data); g.refreshYardPoopPositions(); assert.equal(JSON.stringify(g.data),original,'旧存档仅重映射');
 function verify() { for(const p of g.yardPoopPositions.values()) { const q=g.yardPoopProjection(p.x,p.z),m=68,b=g.chromeBounds(); assert(q.x>=b.left+m&&q.x<=b.right-m&&q.y>=b.bottom+m&&q.y<=b.top-m,'投影在安全区'); assert(!rects.some(r=>q.x>=r.left-m&&q.x<=r.right+m&&q.y>=r.bottom-m&&q.y<=r.top+m),'避让UI和拾取余量'); assert(Math.hypot(p.x,p.z)>=1.5,'避让家具'); } }
 verify(); const stable=JSON.stringify([...g.yardPoopPositions]); g.refreshYardPoopPositions(); assert.equal(JSON.stringify([...g.yardPoopPositions]),stable,'无每帧抖动');
 g.commitShop=c=>{g.data=c;return true;}; g.spawnYardPoop(0,-5,4); assert.equal(g.data.poops.length,2); verify();
 for(let i=0;i<4;i++) g.spawnYardPoop(0,-5,4); assert.equal(g.data.poops.length,6); verify();
 const before=JSON.stringify(g.data),id=g.poopNextId; g.commitShop=()=>false; g.spawnYardPoop(0,4,4); assert.equal(JSON.stringify(g.data),before); assert.equal(g.poopNextId,id,'失败不消耗ID');
 let cleaned=null; g.cleanYardPoop=id=>cleaned=id; g.blockedUntil=0; g.isTouchOnUI=Main.prototype.isTouchOnUI; const pos=g.yardPoopPositions.get(9),p=g.yardPoopProjection(pos.x,pos.z); g.onWorldTouch({getLocation:()=>p}); assert.equal(cleaned,9,'拾取使用显示坐标');
 cleaned=null; g.onWorldTouch({getLocation:()=>new Vec2(rects[0].left+10,rects[0].top-10)}); assert.equal(cleaned,null,'UI优先禁止穿透');
 rects[2].top+=100; g.refreshYardPoopPositions(); verify(); cases++;
}
// 实际热区使用变换后的矩形，不按未缩放 position 猜测。
const g=new Main(); const rect={x:100,y:200,width:80,height:90}; g.ui={getChildByName:()=>null,getComponent:()=>({convertToNodeSpaceAR:p=>p})}; g.top={activeInHierarchy:true,getComponent:()=>({getBoundingBoxToWorld:()=>rect})}; g.uiCamera={screenToWorld:p=>p}; assert(g.isTouchOnUI(new Vec2(110,210))); assert(!g.isTouchOnUI(new Vec2(0,0)));
console.log(`通过：${cases}组真实方法投影/避让、旧档不变、新生成及保存失败、视口/照顾底栏变化、拾取一致和UI优先。`);
