import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const project=fileURLToPath(new URL('../',import.meta.url));
let require=createRequire(import.meta.url),chromium;
try { ({chromium}=require('playwright')); }
catch { require=createRequire(path.resolve(path.dirname(process.execPath),'../node_modules/package.json'));({chromium}=require('playwright')); }
const root=path.join(project,'assets/export/moonlit-camp-v1');
const spec=JSON.parse(fs.readFileSync(path.join(root,'scene.json'),'utf8'));
assert.equal(spec.layers.length,10);
assert.equal(spec.animations[0].frames.length,8);
assert.equal(spec.animations[0].frameDurationMs,100);
for(const layer of spec.layers){assert.ok(layer.metadata.fullyTransparentFraction>0.4,layer.id+' is not isolated');assert.ok(fs.existsSync(path.join(root,layer.file)));assert.ok(layer.sourceRect[2]>0&&layer.sourceRect[3]>0);}
for(const [index,file]of spec.animations[0].frames.entries()){const bytes=fs.readFileSync(path.resolve(root,file));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),spec.animations[0].frameSha256[index]);}
let browser;
const launchErrors=[];
for(const channel of ['msedge','chrome',undefined]){try {browser=await chromium.launch({headless:true,...(channel?{channel}:{})});break;}catch(error){launchErrors.push(String(error.message));}}
if(!browser)throw new Error(launchErrors.join('\n'));
try {
 const page=await browser.newPage({viewport:{width:1280,height:1120},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(pathToFileURL(path.join(root,'preview.html')).href);
 await page.waitForFunction(()=>window.__ASSET_PREVIEW__?.ready,{timeout:20000});
 assert.equal(await page.evaluate(()=>window.__ASSET_PREVIEW__.imagesLoaded),18);
 await page.waitForTimeout(150);
 const frame0=await page.evaluate(()=>window.__ASSET_PREVIEW__.frameIndex);
 await page.waitForTimeout(230);
 const frame1=await page.evaluate(()=>window.__ASSET_PREVIEW__.frameIndex);
 assert.notEqual(frame0,frame1,'Fire animation did not advance');
 await page.locator('#pause').click();
 const paused=await page.evaluate(()=>window.__ASSET_PREVIEW__.frameIndex);
 await page.waitForTimeout(220);
 assert.equal(await page.evaluate(()=>window.__ASSET_PREVIEW__.frameIndex),paused,'Pause did not hold frame');
 await page.locator('#forceUi').check();
 await page.mouse.move(5,5);
 await page.waitForTimeout(80);
 const full=await page.locator('#scene').screenshot();
 await page.locator('#layer-near').uncheck();
 await page.waitForTimeout(80);
 const hidden=await page.locator('#scene').screenshot();
 assert.notEqual(crypto.createHash('sha256').update(full).digest('hex'),crypto.createHash('sha256').update(hidden).digest('hex'),'Layer toggle made no visual difference');
 await page.locator('#layer-near').check();
 await page.locator('[data-bg="checker"]').click();
 assert.ok(await page.locator('#stage').evaluate(node=>node.classList.contains('checker')));
 await page.locator('[data-bg="dark"]').click();
 await page.waitForTimeout(100);
 await page.locator('#scene').screenshot({path:path.join(root,'preview-composite.png')});
 await page.screenshot({path:path.join(root,'preview-page.png'),fullPage:true});
 const canvasBox=await page.locator('#scene').boundingBox();
 await page.mouse.move(canvasBox.x+440,canvasBox.y+200);
 await page.mouse.click(canvasBox.x+440,canvasBox.y+200);
 assert.ok(await page.evaluate(()=>window.__ASSET_PREVIEW__.fireUntil>performance.now()),'Woodpile interaction did not trigger fire');
 assert.deepEqual(errors,[]);
 assert.deepEqual(await page.evaluate(()=>window.__ASSET_PREVIEW__.errors),[]);
 const result={passed:true,staticLayers:10,imagesLoaded:18,fireFrames:8,animationAdvanced:true,pause:true,layerToggle:true,woodpileInteraction:true,fireHashesMatchOriginals:true,checks:'PNG alpha / source references / frame animation / pause / layer toggle / checkerboard / interaction / browser errors'};
 fs.writeFileSync(path.join(root,'validation.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
