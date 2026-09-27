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
 await page.waitForFunction( () => window.__app?.scene.forms.length && ! document.querySelector( '#add' ).disabled );
 // Layout checks need only explicit renders, avoiding continuous software rendering.
 await page.evaluate( () => window.__app.viewer.renderer.setAnimationLoop( null ) );
 const draw = () => page.evaluate( () => new Promise( resolve => requestAnimationFrame( () => requestAnimationFrame( () => { window.__app.viewer.tick(); resolve(); } ) ) ) );
 const screenshot = async path => {
  await page.evaluate( () => window.__app.viewer.renderer.setAnimationLoop( () => window.__app.viewer.tick() ) );
  await page.screenshot( { path } );
  await page.evaluate( () => window.__app.viewer.renderer.setAnimationLoop( null ) );
 };
 const layout = () => page.evaluate( () => {
  const p = document.querySelector( '#panel' ).getBoundingClientRect();
  const s = document.querySelector( '#stage' ).getBoundingClientRect();
  return { panel: { top:p.top, right:p.right, bottom:p.bottom }, stage: { left:s.left, bottom:s.bottom, height:s.height }, width:innerWidth, height:innerHeight, overflow:document.documentElement.scrollWidth > innerWidth };
 } );
 await draw();
 let rects = await layout();
 assert.ok( rects.stage.left >= rects.panel.right, 'desktop tools do not cover the canvas' );
 await screenshot( '/tmp/toolbar-desktop.png' );
 for ( const [ width, height ] of [ [390,844], [320,568], [768,1024], [844,390] ] ) {
  await page.setViewport( { width, height } );
  await page.waitForFunction( () => Math.abs( window.__app.viewer.camera.aspect - document.querySelector( '#stage' ).clientWidth / document.querySelector( '#stage' ).clientHeight ) < .001 );
  await page.click( '[data-tab="style"]' );
  assert.equal( await page.$eval( '#styleTools', el => el.hidden ), false );
  await page.click( '[data-theme="blueprint"]' );
  assert.equal( await page.$eval( 'html', el => el.dataset.theme ), 'blueprint' );
  await page.click( '[data-theme="paper"]' );
  await page.click( '[data-tab="objects"]' );
  const id = await page.evaluate( () => String( window.__app.scene.forms[0].id ) );
  await page.select( '#selectedObject', id );
  await page.click( '#hideSelected' );
  assert.equal( await page.$eval( '#hideSelected', el => el.getAttribute( 'aria-label' ) ), 'Show object (H)' );
  assert.equal( await page.$eval( '#hideSelected', el => !!el.querySelector('svg') ), true );
  await page.click( '#hideSelected' );
  await page.click( '#lockCamera' );
  assert.equal( await page.evaluate( () => window.__app.viewer.controls.enableRotate ), false );
  await page.click( '#lockCamera' );
  await page.click( '[data-tab="create"]' );
  await draw();
  rects = await layout();
  assert.equal( rects.overflow, false );
  assert.ok( rects.panel.bottom <= height + 1 && rects.panel.right <= width + 1 );
  assert.ok( rects.stage.height >= height * .4 );
  assert.ok( rects.stage.left >= rects.panel.right || rects.stage.bottom <= rects.panel.top + 1, 'panel does not cover canvas' );
  await screenshot( `/tmp/toolbar-${width}.png` );
  if ( width <= 700 ) {
   await page.click( '#togglePanel' );
   assert.equal( await page.$eval( '#toolContent', el => el.hidden ), true );
   await draw();
   await screenshot( `/tmp/toolbar-${width}-collapsed.png` );
   await page.click( '[data-tab="create"]' );
   assert.equal( await page.$eval( '#toolContent', el => el.hidden ), false );
  }
  console.log( `${width}×${height}: layout, tabs, theme, object actions and camera lock passed` );
 }
 await page.setViewport( { width:390, height:844, isMobile:true, hasTouch:true } );
 await page.reload();
 await page.waitForFunction( () => window.__app?.scene.forms.length && ! document.querySelector('#add').disabled );
 await page.evaluate( () => { const v=window.__app.viewer; v.renderer.setAnimationLoop(null); v.controls.enableDamping=false; } );
 const client = await page.createCDPSession();
 const touch = (type, points) => client.send('Input.dispatchTouchEvent', {type, touchPoints:points.map(([x,y],id)=>({x,y,id}))});
 const camera = () => page.evaluate(() => {const v=window.__app.viewer; v.controls.update(); return {angle:v.controls.getAzimuthalAngle(), distance:v.camera.position.distanceTo(v.controls.target)};});
 const before = await camera();
 await touch('touchStart', [[120,150]]);
 await touch('touchMove', [[180,170]]);
 await touch('touchEnd', []);
 assert.ok(Math.abs((await camera()).angle-before.angle)>.01, 'one finger orbits');
 await page.tap('#lockCamera');
 const locked = await camera();
 await touch('touchStart', [[120,150]]);
 await touch('touchMove', [[180,170]]);
 await touch('touchEnd', []);
 assert.ok(Math.abs((await camera()).angle-locked.angle)<1e-8, 'locked touch cannot rotate');
 await touch('touchStart', [[130,150],[230,150]]);
 await touch('touchMove', [[100,150],[260,150]]);
 await touch('touchEnd', []);
 assert.ok((await camera()).distance < locked.distance, 'pinch still zooms while locked');
 await page.tap('#toggleHelp');
 assert.equal(await page.$eval('#toggleHelp', el=>el.getAttribute('aria-pressed')), 'true');
 await screenshot('/tmp/toolbar-touch-help.png');
 console.log('Touch orbit, locked touch, pinch zoom and touch help passed');
 const unnamed = await page.$$eval( 'button', buttons => buttons.filter( b => ! b.getAttribute( 'aria-label' ) ).length );
 assert.equal( unnamed, 0, 'all icon buttons have accessible names' );
 assert.deepEqual( errors, [] );
} finally { await browser.close(); }
