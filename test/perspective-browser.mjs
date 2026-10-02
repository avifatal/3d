import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage();
 await page.setViewport({width:1280,height:860});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.APP_URL||'http://127.0.0.1:5181/');
 await page.waitForFunction(()=>window.__app?.scene.forms.length&&!document.querySelector('#add').disabled);
 const arrows=()=>page.evaluate(()=>{window.__app.viewer.tick();return window.__app.perspectiveGuides.arrows.filter(a=>a.visible).map(a=>[...a.position.toArray(),...a.quaternion.toArray()]);});
 assert.equal((await arrows()).length,0,'no guides without selection');
 for(const exercise of ['intersecting','stacking','queue','carving','ribbon']) {
  await page.click(`[data-exercise="${exercise}"]`);
  await page.waitForFunction(()=>!document.querySelector('#add').disabled);
  await page.evaluate(()=>{const {scene}=window.__app;scene.select(scene.forms[0]);});
  assert.ok((await arrows()).length>=4,`${exercise} shows perspective guides`);
  await page.click('#hideSelected');assert.equal((await arrows()).length,0);
  await page.click('#hideSelected');assert.ok((await arrows()).length>=4);
 }
 const before=await arrows();
 await page.evaluate(()=>{const {viewer}=window.__app;viewer.camera.position.x*=-1;viewer.camera.position.z*=-1;viewer.controls.update();});
 assert.notDeepEqual(await arrows(),before,'camera orbit updates guides');
 const beforeEdit=await arrows();
 await page.evaluate(()=>{const {editor}=window.__app;editor.setMode('rotate');editor.begin();editor.proxy.rotation.y=0.8;editor.preview();});
 assert.notDeepEqual(await arrows(),beforeEdit,'live rotation updates guides');
 await page.keyboard.press('Escape');
 assert.deepEqual(await arrows(),beforeEdit,'cancel restores guides');
 await page.screenshot({path:'/tmp/perspective-guides.png'});
 await page.click('#togglePerspective');assert.equal((await arrows()).length,0);
 assert.equal(await page.$eval('#showPerspective',e=>e.checked),false);
 await page.reload();await page.waitForFunction(()=>window.__app?.scene.forms.length&&!document.querySelector('#add').disabled);
 assert.equal(await page.$eval('#showPerspective',e=>e.checked),false,'preference persists');
 await page.click('[data-tab="style"]');await page.click('#showPerspective');
 await page.evaluate(()=>{const {scene}=window.__app;scene.select(scene.forms[0]);});
 assert.ok((await arrows()).length>=4);
 await page.click('[data-theme="blueprint"]');
 await page.screenshot({path:'/tmp/perspective-blueprint.png'});
 await page.setViewport({width:390,height:844});
 assert.ok((await arrows()).length>=4,'guides survive viewport resizing');
 await page.evaluate(()=>window.__app.scene.clear());assert.equal((await arrows()).length,0,'clearing detaches guides');
 assert.deepEqual(errors,[]);
 console.log('All exercises, orbit, live rotation/cancel, hidden selection, toolbar/style toggles, persistence and resize passed.');
} finally {await browser.close();}
