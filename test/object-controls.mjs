import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch( {
 executablePath: '/usr/bin/google-chrome', headless: true,
 args: [ '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ],
} );
try {
 const page = await browser.newPage();
 await page.setViewport( { width: 1280, height: 860 } );
 const errors = [];
 page.on( 'pageerror', error => errors.push( error.message ) );
 await page.goto( process.env.APP_URL || 'http://127.0.0.1:5179/' );
 await page.waitForFunction( () => window.__app?.scene.forms.length > 0 );
 for ( const exercise of [ 'intersecting', 'stacking', 'queue', 'carving', 'ribbon' ] ) {
  await page.click( '[data-tab="create"]' );
  await page.click( `[data-exercise="${exercise}"]` );
  await page.waitForFunction( () => ! document.querySelector( '#add' ).disabled );
  const before = await page.evaluate( () => window.__app.scene.forms.length );
 await page.evaluate( () => { const { scene } = window.__app; scene.select( scene.forms[ 0 ] ); } );
  assert.equal( await page.evaluate( () => {
   const { scene, viewer } = window.__app;
   const frame = viewer.scene.getObjectByName( 'selectionBounds' );
   viewer.tick();
   const bounds = scene.selected.objectBounds;
   if ( !frame.matrix.equals( bounds.matrix ) ) return false;
   const actual = bounds.box.clone().makeEmpty();
   const inverse = bounds.matrix.clone().invert();
   const point = viewer.camera.position.clone();
   const positions = scene.selected.geometry.attributes.position;
   for ( let i=0; i<positions.count; i++ ) actual.expandByPoint( point.fromBufferAttribute(positions,i).applyMatrix4(inverse) );
   return actual.min.distanceTo(bounds.box.min)<2e-5 && actual.max.distanceTo(bounds.box.max)<2e-5;
  } ), true, `${exercise}: object-aligned cage touches all six bounds` );
  await page.click( '#hideSelected' );
  assert.equal( await page.evaluate( () => {
   const { scene } = window.__app;
   const f = scene.selected;
   return f.faint && ! f.mesh.visible && ! f.mesh.castShadow && f.hardLines.visible.material.opacity === 0.10;
  } ), true, `${exercise}: hide` );
  await page.click( '#hideSelected' );
  assert.equal( await page.evaluate( () => {
   const { scene, viewer } = window.__app;
   return ! scene.selected.faint && scene.selected.mesh.visible && scene.selected.hardLines.visible.material === viewer.materials.edge;
  } ), true, `${exercise}: restore` );
  await page.click( '#deleteSelected' );
  assert.equal( await page.evaluate( () => window.__app.scene.forms.length ), before - 1 );
  assert.equal( await page.evaluate( () => {
   const { scene } = window.__app;
   return ! scene.selected && scene.intersections.every( entry => scene.forms.includes( entry.a ) && scene.forms.includes( entry.b ) );
  } ), true );
  console.log( `${exercise}: select, hide, restore, delete passed` );
 }
 // Use a fresh stack for real canvas picking and orbit gestures.
 await page.click( '[data-tab="create"]' );
 await page.click( '[data-exercise="stacking"]' );
 await page.waitForFunction( () => ! document.querySelector( '#add' ).disabled );
 const point = await page.evaluate( () => {
  const { scene, viewer } = window.__app;
  const p = scene.forms[ 0 ].box.getCenter( viewer.camera.position.clone() ).project( viewer.camera );
  const rect = viewer.renderer.domElement.getBoundingClientRect();
  return { x: rect.left + ( p.x + 1 ) * rect.width / 2, y: rect.top + ( 1 - p.y ) * rect.height / 2 };
 } );
 await page.mouse.click( point.x, point.y );
 assert.equal( await page.evaluate( () => !! window.__app.scene.selected ), true, 'canvas selection' );
 await page.keyboard.press( 'Escape' );
 await page.mouse.move( 850, 450 );
 await page.mouse.down();
 await page.mouse.move( 900, 470, { steps: 10 } );
 await page.mouse.up();
 assert.equal( await page.evaluate( () => window.__app.scene.selected ), null, 'orbit does not select' );
 assert.deepEqual( errors, [] );
 console.log( 'Canvas selection, deselection and orbit passed; no browser errors.' );
} finally {
 await browser.close();
}
