import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page = await browser.newPage();
 await page.setViewport({width:1280,height:860});
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.APP_URL || 'http://127.0.0.1:5181/');
 await page.waitForFunction(()=>window.__app?.scene.forms.length&&!document.querySelector('#add').disabled);
 const points = await page.evaluate(async()=>{
  const {createShape}=await import('/src/shapes.js');
  const {scene,viewer}=window.__app; scene.clear();
  for(const x of [-3,3]) {
   const s=createShape('box',()=>0.5);
   s.geometry.translate(x,0,0);
   scene.createForm({geometry:s.geometry,construction:[],shapeId:'box',label:'Box',radius:s.radius,pairs:[]});
  }
  scene.frame(); viewer.controls.enableDamping=false; viewer.tick();
  const r=viewer.renderer.domElement.getBoundingClientRect();
  return scene.forms.map(f=>{const p=f.box.getCenter(viewer.camera.position.clone()).project(viewer.camera);return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};});
 });
 const click=i=>page.mouse.click(points[i].x,points[i].y);
 const size=()=>page.evaluate(()=>window.__app.scene.selection.size);
 const arrows=()=>page.evaluate(()=>{window.__app.viewer.tick();return window.__app.perspectiveGuides.arrows.filter(a=>a.visible).length;});
 await click(0); assert.equal(await size(),1); const single=await arrows();
 await page.keyboard.down('Control'); await click(1); await page.keyboard.up('Control');
 assert.equal(await size(),2); assert.equal(await arrows(),single*2);
 await page.click('#togglePerspective'); assert.equal(await arrows(),0);
 assert.equal(await page.$eval('#togglePerspective',e=>e.getAttribute('aria-pressed')),'false');
 assert.equal(await page.$eval('#showPerspective',e=>e.checked),false);
 await page.click('#togglePerspective'); assert.equal(await arrows(),single*2);
 const transform=await page.evaluate(()=>{
  const {scene,editor}=window.__app;
  const before=scene.forms.map(f=>Array.from(f.geometry.attributes.position.array));
  editor.setMode('translate'); editor.begin(); editor.proxy.position.x+=2; editor.preview(); editor.finish();
  const shifts=scene.forms.map((f,i)=>f.geometry.attributes.position.array[0]-before[i][0]);
  editor.undo();
  const restored=scene.forms.every((f,i)=>Array.from(f.geometry.attributes.position.array).every((v,j)=>Math.abs(v-before[i][j])<1e-5));
  editor.setMode('rotate'); editor.begin(); editor.proxy.rotation.y=0.6; editor.preview(); editor.finish(); editor.undo();
  const rotationRestored=scene.forms.every((f,i)=>Array.from(f.geometry.attributes.position.array).every((v,j)=>Math.abs(v-before[i][j])<1e-5));
  editor.setMode('select'); return {shifts,restored,rotationRestored};
 });
 assert.ok(transform.shifts.every(x=>Math.abs(x-2)<1e-5)); assert.ok(transform.restored); assert.ok(transform.rotationRestored);
 await page.click('#hideSelected'); assert.equal(await arrows(),0);
 assert.equal(await page.evaluate(()=>window.__app.scene.forms.every(f=>f.faint)),true);
 await page.click('#hideSelected'); assert.equal(await arrows(),single*2);
 await page.keyboard.down('Control'); await click(1); await page.keyboard.up('Control'); assert.equal(await size(),1);
 await click(1); assert.equal(await size(),1);
 await page.keyboard.down('Control'); await click(0); await page.keyboard.up('Control'); assert.equal(await size(),2);
 await page.keyboard.press('Escape'); assert.equal(await size(),0); assert.equal(await arrows(),0);
 await click(0); await page.keyboard.down('Control'); await click(1); await page.keyboard.up('Control');
 await page.click('#deleteSelected'); assert.equal(await size(),0);
 assert.equal(await page.evaluate(()=>window.__app.scene.forms.length),0);
 assert.deepEqual(errors,[]);
 console.log('Ctrl-click add/remove, replacement, guides/toggle, group move/rotate/undo, hide/show, Escape and deletion passed.');
} finally {await browser.close();}
