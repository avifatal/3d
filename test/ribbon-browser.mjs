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
 await page.goto( process.env.APP_URL || 'http://127.0.0.1:5181/' );
 await page.waitForFunction( () => window.__app?.scene.forms.length > 0 && !document.querySelector('#add').disabled );
 await page.click( '[data-exercise="ribbon"]' );
 const ready = () => page.waitForFunction( () => !document.querySelector('#add').disabled );
 await ready();
 for ( const [ i, level ] of [ 'easier', 'harder', 'hardest' ].entries() ) {
  await page.keyboard.press( String( i + 1 ) );
  await ready();
  assert.equal( await page.$eval( '#ribbonLevel .active', el => el.dataset.level ), level );
  assert.match( await page.$eval( '#status', el => el.textContent ), new RegExp( `${i+1} bend` ) );
  assert.equal( await page.evaluate( () => window.__app.scene.forms[0].mesh.material.side ), 2 );
  await page.screenshot( { path: `/tmp/ribbon-${level}.png` } );
 }
 await page.click( '#reribbon' ); await ready();
 await page.click( '[data-tab="style"]' );
 await page.click( '#showConstruction' );
 await page.click( '[data-mode="xray"]' );
 assert.equal( await page.evaluate( () => window.__app.scene.showConstruction ), true );
 await page.reload();
 await page.waitForFunction( () => window.__app?.scene.forms[0]?.shapeId === 'ribbon' && !document.querySelector('#add').disabled );
 assert.equal( await page.$eval( '#ribbonLevel .active', el => el.dataset.level ), 'hardest' );
 await page.setViewport( { width: 390, height: 844 } );
 await page.click( '[data-tab="create"]' );
 await page.screenshot( { path: '/tmp/ribbon-mobile.png' } );
 assert.equal( await page.evaluate( () => document.documentElement.scrollWidth <= innerWidth ), true );
 assert.deepEqual( errors, [] );
 console.log( 'Ribbon levels, shortcuts, regeneration, guides, preference restore and mobile layout passed.' );
} finally { await browser.close(); }
