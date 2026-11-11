import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
let require = createRequire(import.meta.url);
let PNG;
try { ({ PNG } = require('pngjs')); }
catch { require = createRequire(path.resolve(path.dirname(process.execPath), '../node_modules/package.json')); ({ PNG } = require('pngjs')); }
const root = path.join(project, 'assets/export/moonlit-camp-v1');
const definitions = [
  ['sky','天空、月亮与星星','background/00-sky-moon-stars.png',0,'background'],
  ['far','远山与浓雾','background/01-far-mountains-mist.png',10,'background'],
  ['middle','中景山林与薄雾','background/02-mid-forest-mist.png',20,'background'],
  ['near','近景山坡与清晰松树','background/03-near-hills-pines.png',30,'background'],
  ['ground','草地与前景碎石','terrain/ground-grass-stones.png',40,'terrain'],
  ['tent','帐篷与铺盖卷','props/tent-bedroll.png',50,'props'],
  ['kettle','烧水壶','props/kettle.png',51,'props'],
  ['woodpile','无绳木堆','props/woodpile.png',52,'props'],
  ['fire-base','火堆底座、石块与燃木','props/fire-base-stones-logs.png',60,'props'],
  ['toolbar','悬浮工具栏','ui/toolbar.png',100,'ui'],
];
function inspect(file) {
  const buffer = fs.readFileSync(file);
  const png = PNG.sync.read(buffer);
  let x0=png.width,y0=png.height,x1=-1,y1=-1,transparent=0,partial=0,visible=0;
  for(let y=0;y<png.height;y++) for(let x=0;x<png.width;x++) {
    const a=png.data[(y*png.width+x)*4+3];
    if(a===0) transparent++; else if(a<255) partial++;
    if(a>=32) { visible++; x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y); }
  }
  if(x1<0) throw new Error('Empty PNG: '+file);
  return { width:png.width,height:png.height,bytes:buffer.length,sha256:crypto.createHash('sha256').update(buffer).digest('hex'),alphaBounds:[x0,y0,x1-x0+1,y1-y0+1],fullyTransparentFraction:transparent/(png.width*png.height),partialAlphaFraction:partial/(png.width*png.height),visiblePixels:visible };
}
const layers = definitions.map(([id,label,file,z,category]) => {
  const metadata=inspect(path.join(root,file));
  const [x,y,w,h]=metadata.alphaBounds;
  const drawRect=id==='toolbar' ? [352,25,129,41] : [x/metadata.width*500,y/metadata.height*300,w/metadata.width*500,h/metadata.height*300].map(n=>Math.round(n*1000)/1000);
  return { id,label,file,z,category,sourceRect:metadata.alphaBounds,drawRect,defaultVisible:id!=='toolbar',interactive:category==='props'||id==='toolbar',metadata };
});
const fireRelative='../../third-party/devkidd-pixel-fire/Pixel fire asset pack v1.2/Pixel Fire Asset Pack Colored/fire asset red/Group 6 - 1';
const frames=Array.from({length:8},(_,i)=>`${fireRelative}/Group 6 - 1_${i+1}.png`);
const frameMetadata=frames.map(f=>inspect(path.resolve(root,f)));
if(frameMetadata.some(m=>m.width!==32||m.height!==48)) throw new Error('Unexpected fire-frame size');
const fire={ id:'fire',label:'Devkidd 暖红火焰',z:55,frames,frameSize:[32,48],frameDurationMs:100,loop:true,filter:'nearest',drawRect:[259,117,64,96],origin:'bottom-center',source:{author:'Devkidd',pack:'Pixel Art Fire Asset Pack v1.2',url:'https://devkidd.itch.io/pixel-fire-asset-pack',usage:'Used in project via original files; not copied into the standalone generated-art export.',license:'Personal and commercial project use permitted; do not resell, redistribute or repackage as standalone files.'},frameSha256:frameMetadata.map(m=>m.sha256)};
const scene={schemaVersion:1,name:'月下营地 · 分层素材试导出',logicalSize:[500,300],sourceConcept:'../../../output/imagegen/14-moonlit-valley-depth-fog.png',reconstructed:true,notes:['Static layers are AI-reconstructed from a flattened concept, not lossless original project layers.','All static PNGs retain large transparent margins; sourceRect and drawRect trim them at rendering time.','Toolbar was separately extracted and placed using its drawRect.','Background fog is baked into the individual depth layers; it is not a separate adjustable fog mask.','Fire animation references the existing licensed author files; no AI-generated flame is used.'],backgroundComposition:{maskedLayers:['sky','far','middle'],alphaMask:'sky',unmaskedFrontLayer:'near',description:'Composite distant scenery into the sky cutout with destination-in, then draw near silhouettes over it.'},layers,animations:[fire],hitRegions:[{id:'tent',rect:[21,104,135,120]},{id:'kettle',rect:[200,180,40,43]},{id:'fire',rect:[252,126,80,98]},{id:'woodpile',rect:[408,181,66,42]}],runtimeEffects:{steam:{origin:[223,184],method:'small animated pixel clusters behind kettle',maxCount:8}},targets:{animationFps:30,fireSpriteFps:10,pauseWhenHidden:true,staticBackgroundCache:true}};
fs.mkdirSync(path.join(root,'effects'),{recursive:true});
fs.writeFileSync(path.join(root,'scene.json'),JSON.stringify(scene,null,2)+'\n');
fs.writeFileSync(path.join(root,'scene.js'),'window.CAMP_SCENE = '+JSON.stringify(scene,null,2)+';\n');
fs.writeFileSync(path.join(root,'effects/fire.source.json'),JSON.stringify(fire,null,2)+'\n');
fs.writeFileSync(path.join(root,'inventory.csv'),'id,category,file,width,height,bytes,transparent_fraction\n'+layers.map(l=>[l.id,l.category,l.file,l.metadata.width,l.metadata.height,l.metadata.bytes,l.metadata.fullyTransparentFraction.toFixed(5)].join(',')).join('\n')+'\n');
console.log(JSON.stringify({staticPngs:layers.length,totalBytes:layers.reduce((s,l)=>s+l.metadata.bytes,0),fireFrames:frames.length,fireFrameDurationMs:fire.frameDurationMs,layers:layers.map(l=>({id:l.id,size:[l.metadata.width,l.metadata.height],bounds:l.sourceRect,rect:l.drawRect,transparent:l.metadata.fullyTransparentFraction.toFixed(3)}))},null,2));
