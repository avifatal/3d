import puppeteer from 'puppeteer-core';
const [,, out, ...actions] = process.argv;
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--hide-scrollbars','--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 });
page.on('console', m => console.log(`[${m.type()}]`, m.text()));
page.on('pageerror', e => console.log('[pageerror]', e.message, '\n', (e.stack||'').split('\n').slice(0,4).join('\n')));
page.on('requestfailed', r => console.log('[reqfail]', r.url(), r.failure()?.errorText));
await page.goto('http://localhost:5179/', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 2500));
for (const a of actions) {
  if (a.startsWith('click:')) await page.click(a.slice(6));
  else if (a.startsWith('select:')) { const [sel, val] = a.slice(7).split('='); await page.select(sel, val); }
  else if (a.startsWith('shot:')) await page.screenshot({ path: a.slice(5) });
  else if (a.startsWith('range:')) { const [sel, val] = a.slice(6).split('='); await page.$eval(sel, (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, val); }
  else if (a.startsWith('wait:')) await new Promise(r => setTimeout(r, +a.slice(5)));
  else if (a.startsWith('eval:')) console.log('[eval]', JSON.stringify(await page.evaluate(a.slice(5)), null, 1));
  else if (a.startsWith('evalfile:')) console.log('[eval]', JSON.stringify(await page.evaluate((await import('node:fs')).readFileSync(a.slice(9),'utf8')), null, 1));
  else if (a.startsWith('drag:')) {
    const [dx,dy] = a.slice(5).split(',').map(Number);
    await page.mouse.move(800,430); await page.mouse.down();
    for (let i=1;i<=12;i++) await page.mouse.move(800+dx*i/12, 430+dy*i/12);
    await page.mouse.up();
  }
  await new Promise(r => setTimeout(r, 400));
}
console.log('[status]', await page.$eval('#status', e => e.textContent));
if (out !== '-') await page.screenshot({ path: out });
await browser.close();
