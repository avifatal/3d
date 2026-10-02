import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch( {
 executablePath: '/usr/bin/google-chrome', headless: true,
 args: [ '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ],
} );
try {
 const page = await browser.newPage();
 const errors = [];
 page.on( 'pageerror', error => errors.push( error.message ) );
 await page.setViewport( { width: 1280, height: 860 } );
 await page.goto( process.env.APP_URL || 'http://127.0.0.1:5181/' );
 await page.waitForFunction( () => window.__app?.scene.forms.length && !document.querySelector('#add').disabled );
 await page.click( '[data-exercise="ribbon"]' );
 await page.waitForFunction( () => !document.querySelector('#add').disabled );
 await page.evaluate( () => { const { scene } = window.__app; scene.select( scene.forms[ 0 ] ); } );
 await page.click( '[data-transform="translate"]' );
 await page.evaluate( () => { const v=window.__app.viewer; v.controls.enableDamping=false; v.tick(); } );
 const snapshot = () => page.evaluate( () => {
  const { scene, viewer } = window.__app;
  return { points: Array.from(scene.selected.geometry.attributes.position.array), camera: viewer.camera.position.toArray(), id:scene.selected.id };
 } );
 const before = await snapshot();
 const handle = await page.evaluate( () => {
  const { editor, viewer } = window.__app;
  viewer.tick();
  const handle = editor.controls._gizmo.gizmo.translate.children.find( h => h.name === 'X' && h.visible );
  handle.geometry.computeBoundingBox();
  const point = handle.geometry.boundingBox.getCenter( viewer.camera.position.clone() ).applyMatrix4(handle.matrixWorld).project(viewer.camera);
  const rect=viewer.renderer.domElement.getBoundingClientRect();
  return { x:rect.left+(point.x+1)*rect.width/2, y:rect.top+(1-point.y)*rect.height/2 };
 } );
 await page.mouse.move(handle.x,handle.y);
 await page.mouse.down();
 assert.equal( await page.evaluate( () => !!window.__app.editor.start ), true, 'real handle starts transform' );
 await page.mouse.move(handle.x+55,handle.y+10,{steps:8});
 await page.mouse.up();
 const moved=await snapshot();
 assert.equal( await page.evaluate( () => {
  const {scene,viewer}=window.__app;
  return viewer.scene.getObjectByName('selectionBounds').matrix.equals(scene.selected.objectBounds.matrix);
 } ), true, 'selection cage follows committed move' );
 assert.notDeepEqual(moved.points,before.points,'drag moves geometry');
 assert.deepEqual(moved.camera,before.camera,'drag does not orbit camera');
 assert.equal(moved.id,before.id,'identity and selection survive');
 await page.click('#undoTransform');
 let undone=await snapshot();
 assert.ok(Math.max(...undone.points.map((n,i)=>Math.abs(n-before.points[i])))<1e-5,'undo restores position');
 await page.click('[data-transform="rotate"]');
 const ring = await page.evaluate( () => {
  const { editor, viewer } = window.__app;
  viewer.tick();
  const rect=viewer.renderer.domElement.getBoundingClientRect();
  const ring=editor.controls._gizmo.gizmo.rotate.children.find(h=>h.name==='E');
  const p=ring.geometry.attributes.position;
  for(let i=0;i<p.count;i+=12){
   const v=viewer.camera.position.clone().fromBufferAttribute(p,i).applyMatrix4(ring.matrixWorld).project(viewer.camera);
   editor.controls.pointerHover({x:v.x,y:v.y,button:0});
   if(editor.controls.axis==='E') return {x:rect.left+(v.x+1)*rect.width/2,y:rect.top+(1-v.y)*rect.height/2};
  }
  throw new Error('No rotation ring hit');
 } );
 await page.mouse.move(ring.x,ring.y); await page.mouse.down();
 assert.equal(await page.evaluate(()=>!!window.__app.editor.start),true,'rotation ring starts drag');
 await page.mouse.move(ring.x+35,ring.y+30,{steps:8});
 assert.equal( await page.evaluate( () => {
  const {scene,viewer}=window.__app;
  const form=scene.selected;
  return viewer.scene.getObjectByName('selectionBounds').matrix.equals(form.objectBounds.matrix.clone().premultiply(form.previewMatrix));
 } ), true, 'selection cage rotates with the preview without becoming a world box' );
 await page.mouse.up();
 assert.notDeepEqual((await snapshot()).points,before.points,'rotation changes geometry');
 await page.click('#undoTransform');
 undone=await snapshot();
 assert.ok(Math.max(...undone.points.map((n,i)=>Math.abs(n-before.points[i])))<1e-5,'undo restores rotation');
 await page.evaluate( () => { const {editor}=window.__app; editor.begin(); editor.proxy.position.x+=2; editor.preview(); } );
 await page.keyboard.press('Escape');
 assert.ok(Math.max(...(await snapshot()).points.map((n,i)=>Math.abs(n-before.points[i])))<1e-5,'cancel leaves geometry unchanged');
 assert.equal(await page.evaluate(()=>window.__app.scene.selected.mesh.matrixAutoUpdate),true);
 await page.click('#hideSelected');
 assert.equal(await page.evaluate(()=>window.__app.editor.controls.object===undefined),true,'hidden object detaches handles');
 await page.click('#hideSelected');
 await page.screenshot({path:'/tmp/object-rotate.png'});
 // Two known overlapping solids: rebuild seams, remove them by moving away,
 // then rotate/return and verify the BVH sees the transformed geometry.
 const result=await page.evaluate(async()=>{
  const {createShape}=await import('/src/shapes.js');
  const {scene,viewer,editor}=window.__app;
  scene.clear();
  const make=()=>{const s=createShape('box',()=>0.5); return scene.createForm({geometry:s.geometry,construction:s.construction,shapeId:'box',label:'Box',radius:s.radius,pairs:[]});};
  const a=make(),b=make();
  const matrix=viewer.camera.matrix.clone();
  scene.transformForm(b,matrix.makeTranslation(0.6,0.3,0.2));
  const overlap=scene.intersections.length;
  scene.transformForm(b,matrix.makeTranslation(10,0,0));
  const apart=scene.intersections.length;
  scene.transformForm(b,matrix.makeTranslation(-10,0,0));
  const returned=scene.intersections.length;
  const ids=scene.forms.map(f=>f.id);
  const links=scene.forms.map(f=>f.links);
  scene.select(b); editor.setMode('translate'); scene.removeForm(b);
  return {overlap,apart,returned,ids,links,detached:editor.controls.object===undefined,history:editor.history.length};
 });
 assert.equal(result.overlap,1);assert.equal(result.apart,0);assert.equal(result.returned,1);
 assert.deepEqual(result.links,[1,1]);assert.equal(result.detached,true);assert.equal(result.history,0);
 const guides = await page.evaluate( () => {
  const {scene,viewer}=window.__app;
  scene.carve('solid');
  const form=scene.forms[0];
  const old=scene.carveGhost.solid[0][0];
  scene.transformForm(form,viewer.camera.matrix.clone().makeTranslation(2,0,0));
  scene.setCarveGuides('cuts');
  return {shift:scene.carveGhost.solid[0][0]-old,aligned:form.construction[0]===scene.carveGhost.solid[0]};
 });
 assert.ok(Math.abs(guides.shift-2)<1e-5); assert.equal(guides.aligned,true,'carve guide switching preserves transformed guides');
 // Real touch dragging and touch cancellation on the mobile canvas.
 await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
 await page.reload();
 await page.waitForFunction(()=>window.__app?.scene.forms.length&&!document.querySelector('#add').disabled);
 await page.click('[data-tab="create"]');
 await page.click('[data-exercise="ribbon"]');
 await page.waitForFunction(()=>!document.querySelector('#add').disabled);
 await page.evaluate( () => { const { scene } = window.__app; scene.select( scene.forms[ 0 ] ); } );
 await page.click('[data-transform="translate"]');
 const touchHandle=async()=>page.evaluate(()=>{
  const {editor,viewer}=window.__app;viewer.controls.enableDamping=false;viewer.tick();
  const h=editor.controls._gizmo.gizmo.translate.children.find(h=>h.name==='X'&&h.visible);
  h.geometry.computeBoundingBox();
  const p=h.geometry.boundingBox.getCenter(viewer.camera.position.clone()).applyMatrix4(h.matrixWorld).project(viewer.camera);
  const r=viewer.renderer.domElement.getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};
 });
 const client=await page.createCDPSession();
 const touch=async(type,p)=>client.send('Input.dispatchTouchEvent',{type,touchPoints:p?[{x:p.x,y:p.y,id:0}]:[]});
 const mobileBefore=await snapshot();
 let h=await touchHandle();
 await touch('touchStart',h);await touch('touchMove',{x:h.x+30,y:h.y+8});await touch('touchEnd');
 assert.notDeepEqual((await snapshot()).points,mobileBefore.points,'touch moves object');
 assert.deepEqual((await snapshot()).camera,mobileBefore.camera,'touch transform does not orbit');
 const mobileMoved=await snapshot();
 h=await touchHandle();
 await touch('touchStart',h);await touch('touchMove',{x:h.x+20,y:h.y+5});await touch('touchCancel');
 assert.deepEqual((await snapshot()).points,mobileMoved.points,'touch cancellation does not commit');
 assert.equal(await page.evaluate(()=>window.__app.viewer.controls.enabled),true);
 await page.screenshot({path:'/tmp/object-move-mobile.png'});
 assert.deepEqual(errors,[]);
 console.log('Real gizmo drag, camera isolation, rotation, undo, cancel, hiding/deletion and intersection rebuilds passed.');
} finally { await browser.close(); }
