// Phone-emulation test (landscape + touch) using Playwright.
// Usage: node tools/mobile-test.cjs [baseUrl] [outDir]
// Needs a local server, e.g.  python3 -m http.server 8080
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:8080/';
const out = process.argv[3] || 'test-shots';
const fs = require('fs');
fs.mkdirSync(out, { recursive: true });

const PHONES = [
  { name: 'pixel7', width: 915, height: 412 },
  { name: 'iphone13', width: 844, height: 390 },
];

async function run(phone, scenario) {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: phone.width, height: phone.height }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const cdp = await ctx.newCDPSession(page);
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: p[2] ?? i })) });
  const center = async (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width]; }, sel);
  const tapEl = async (sel) => { const c = await center(sel); await touch('touchStart', [[c[0], c[1]]]); await page.waitForTimeout(60); await touch('touchEnd', []); await page.waitForTimeout(150); };
  const shot = (n) => page.screenshot({ path: `${out}/${phone.name}-${n}.png` });
  const g = (fn) => page.evaluate(fn);
  const waitDrive = async () => { for (let i = 0; i < 60; i++) { if (await page.evaluate(() => window.__game && window.__game.state) === 'drive') return; await page.waitForTimeout(250); } };
  const result = { phone: phone.name, scenario: scenario.name, checks: {} };
  const check = (k, v) => { result.checks[k] = v; };
  await scenario(page, { touch, center, tapEl, shot, g, check, base, waitDrive });
  result.errors = errors;
  await browser.close();
  return result;
}

const fullFlow = async (page, t) => {
  await page.goto(t.base + '?debug=1');
  await page.waitForTimeout(1200);
  await t.shot('01-menu');
  await t.tapEl('#bPlay');
  await page.waitForTimeout(800);
  await t.shot('02-garage');
  await t.tapEl('#gNext'); await page.waitForTimeout(300);
  await t.tapEl('#gNext'); await page.waitForTimeout(500);
  t.check('truckCycled', await t.g(() => document.getElementById('tName').textContent));
  await t.shot('03-garage-trailer');
  await t.tapEl('#gGo'); await page.waitForTimeout(600);
  // choose tanker cargo
  await page.evaluate(() => { [...document.querySelectorAll('.ccard')].find((b) => b.textContent.includes('Container')).click(); });
  await page.waitForTimeout(500);
  await t.shot('04-cargo');
  await t.tapEl('#cGo'); await page.waitForTimeout(500);
  await t.shot('05-route-empty');
  await t.tapEl('#rClear');
  // tap Delhi then Jaipur on the map
  const city = async (name) => page.evaluate((n) => { const g = [...document.querySelectorAll('#map .city')].find((e) => e.textContent === n); const r = g.getBoundingClientRect(); return [r.left + 8, r.top + r.height / 2]; }, name);
  for (const n of ['Delhi', 'Jaipur']) { const c = await city(n); await t.touch('touchStart', [[c[0], c[1]]]); await t.touch('touchEnd', []); await page.waitForTimeout(250); }
  t.check('route', await t.g(() => document.getElementById('rFromSel').value + ' -> ' + document.getElementById('rToSel').value));
  await t.shot('06-route');
  await t.tapEl('#rGo'); await page.waitForTimeout(400);
  await t.shot('07-summary');
  await t.tapEl('#sGo');
  await page.waitForTimeout(1500);
  await t.shot('08-loading');
  await t.waitDrive();
  t.check('state', await t.g(() => window.__game && window.__game.state));
  // controls test: clear traffic so the blind test drive cannot hit anything
  await t.g(() => { const g = window.__game; g.traffic.density = 0; g.traffic.list.slice().forEach((o) => g.traffic.remove(o)); });
  await t.shot('09-drive');
  // hold accelerator (touch id 1) for 6 s
  const acc = await t.center('#accel');
  await t.touch('touchStart', [[acc[0], acc[1], 1]]);
  await page.waitForTimeout(6000);
  t.check('speedAfterAccel', await t.g(() => Math.round(window.__game.truck.speedKmh)));
  t.check('gear', await t.g(() => window.__game.truck.gearLabel));
  t.check('speedoNeedle', await t.g(() => document.getElementById('speedNeedle').getAttribute('transform')));
  t.check('fuelNeedle', await t.g(() => document.getElementById('fuelNeedle').getAttribute('transform')));
  await t.shot('10-accelerating');
  // rotate the wheel with a second finger while holding accel (short, gentle steer)
  const w = await t.center('#wheel');
  const r = w[2] * 0.38;
  const pts = [];
  for (let a = -90; a <= -50; a += 5) pts.push([w[0] + Math.cos(a * Math.PI / 180) * r, w[1] + Math.sin(a * Math.PI / 180) * r]);
  await t.touch('touchStart', [[acc[0], acc[1], 1], [pts[0][0], pts[0][1], 2]]);
  for (const p of pts) { await t.touch('touchMove', [[acc[0], acc[1], 1], [p[0], p[1], 2]]); await page.waitForTimeout(30); }
  t.check('wheelDeg', await t.g(() => Math.round(window.__app.controls.wheelDeg)));
  await page.waitForTimeout(250);
  t.check('steer', await t.g(() => window.__game.truck.steer.toFixed(3)));
  await t.shot('11-steering');
  await t.touch('touchEnd', []);
  await page.waitForTimeout(1500);
  t.check('wheelReturned', await t.g(() => Math.round(window.__app.controls.wheelDeg)));
  // brake to a stop
  const br = await t.center('#brake');
  t.check('speedBeforeBrake', await t.g(() => Math.round(window.__game.truck.speedKmh)));
  await t.touch('touchStart', [[br[0], br[1], 3]]);
  await page.waitForTimeout(4000);
  t.check('speedAfterBrake', await t.g(() => Math.round(window.__game.truck.speedKmh)));
  await t.touch('touchEnd', []);
  t.check('stateAfterDrive', await t.g(() => window.__game.state));
  // cameras
  for (let i = 0; i < 4; i++) {
    await t.tapEl('#bCam');
    await page.waitForTimeout(500);
    const v = await t.g(() => window.__game.rig.view);
    await t.shot('12-cam-' + v);
  }
  t.check('viewAfter4', await t.g(() => window.__game.rig.view));
  // gears and horn
  await t.tapEl('#gR'); t.check('gearR', await t.g(() => window.__app.controls.gear));
  await t.tapEl('#gN'); t.check('gearN', await t.g(() => window.__app.controls.gear));
  await t.tapEl('#gD');
  const hn = await t.center('#horn');
  await t.touch('touchStart', [[hn[0], hn[1], 5]]); await page.waitForTimeout(200);
  t.check('horn', await t.g(() => window.__app.controls.horn));
  await t.touch('touchEnd', []);
  // pause / resume
  await t.tapEl('#bPause'); await page.waitForTimeout(300);
  await t.shot('13-pause');
  t.check('paused', await t.g(() => window.__game.state));
  await t.tapEl('#pResume');
  t.check('resumed', await t.g(() => window.__game.state));
  // headlights
  await t.tapEl('#bLights'); t.check('lightsOn', await t.g(() => window.__game.model.lights.on));
  await t.shot('14-lights');
  await t.tapEl('#bLights'); t.check('lightsOff', await t.g(() => !window.__game.model.lights.on));
  // mute
  await t.tapEl('#bMute'); t.check('muted', await t.g(() => window.__app.audio.muted)); await t.tapEl('#bMute');
  t.check('fps', await t.g(() => document.getElementById('fps').textContent));
};

// Long Drive mode: car selection, route, cruise control, lane assist, parking win
const longDrive = async (page, t) => {
  await page.goto(t.base + '?debug=1');
  await page.waitForTimeout(1200);
  await t.tapEl('#bDrive');
  await page.waitForTimeout(800);
  t.check('garageTitle', await t.g(() => document.getElementById('gTitle').textContent));
  await t.tapEl('#gNext'); await page.waitForTimeout(400);
  t.check('car', await t.g(() => document.getElementById('tName').textContent));
  await t.shot('ld-01-car');
  await t.tapEl('#gGo'); await page.waitForTimeout(500);
  t.check('skippedCargo', await t.g(() => !document.getElementById('route').classList.contains('hidden')));
  await page.selectOption('#rFromSel', 'mumbai'); await page.selectOption('#rToSel', 'pune');
  await t.tapEl('#rGo'); await page.waitForTimeout(400);
  await t.shot('ld-02-summary');
  await t.tapEl('#sGo');
  await page.waitForTimeout(1000);
  await t.waitDrive();
  t.check('state', await t.g(() => window.__game && window.__game.state));
  await t.g(() => { const g = window.__game; g.traffic.density = 0; g.traffic.list.slice().forEach((o) => g.traffic.remove(o)); });
  // accelerate to cruising speed, then switch on cruise control and let go of everything
  const acc = await t.center('#accel');
  await t.touch('touchStart', [[acc[0], acc[1], 1]]);
  await page.waitForTimeout(5000);
  await t.touch('touchEnd', []);
  const v0 = await t.g(() => window.__game.truck.speedKmh);
  t.check('speedAfterAccel', Math.round(v0));
  await t.tapEl('#bCruise');
  t.check('cruiseSet', await t.g(() => window.__game.cruiseText()));
  await page.waitForTimeout(6000);
  t.check('speedHeldByCruise', await t.g(() => Math.round(window.__game.truck.speedKmh)));
  t.check('laneAssistActive', await t.g(() => !!window.__game.assistActive));
  t.check('stayedInLane', await t.g(() => window.__game.d.toFixed(2)));
  await t.shot('ld-03-cruise');
  // brake cancels cruise
  const br = await t.center('#brake');
  await t.touch('touchStart', [[br[0], br[1], 3]]); await page.waitForTimeout(400); await t.touch('touchEnd', []);
  t.check('cruiseCancelled', await t.g(() => window.__game.cruiseText() === 0));
  // park in the bay -> drive complete
  await t.g(() => { const g = window.__game, r = g.route; g.teleport(r.bay.s + (g.totalLen / 2 - g.model.cabFront), r.bay.d); });
  for (let i = 0; i < 40 && await t.g(() => window.__game.state) === 'drive'; i++) await page.waitForTimeout(250);
  await page.waitForTimeout(500);
  t.check('finish', await t.g(() => document.getElementById('winTitle').textContent));
  await t.shot('ld-04-finish');
};

const scenarios = { fullFlow, longDrive };
(async () => {
  const which = (process.argv[4] || 'fullFlow,longDrive').split(',');
  const results = [];
  for (const ph of PHONES.slice(0, Number(process.argv[5] || 2))) for (const w of which) results.push(await run(ph, scenarios[w]));
  console.log(JSON.stringify(results, null, 1));
  if (results.some((r) => r.errors.length)) process.exitCode = 1;
})();
