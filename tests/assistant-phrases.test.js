// Phrase tests for the in-page assistant.
// Run:  python3 -m http.server 8765   (in the repo folder)   then   node tests/assistant-phrases.test.js
// Each case loads a fresh project, types a request into the assistant, optionally clicks one of its
// answer buttons, saves the project and checks what changed.
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const URL = process.env.URL || 'http://localhost:8765/index.html';

// one 5 m × 4 m room with four outside walls — like a room you draw yourself
const wall = (id, a, b) => ({ id, a, b, thick: 20, height: null, ext: true, matL: 'paint-white', matR: 'paint-white' });
const ONE_ROOM = { version: 3, name: 'Test house', customMats: [], site: { trees: [] }, settings: {},
  floors: [{ id: 'f1', name: 'Ground floor', elev: 0, height: 270, slab: 25, roof: { type: 'none' }, bg: null, dims: [], labels: [], stairs: [], items: [], openings: [],
    rooms: [{ id: 'r1', name: 'Room 1', poly: [[0, 0], [500, 0], [500, 400], [0, 400]], floorMat: 'oak', ceilMat: 'ceiling', outdoor: false }],
    walls: [wall('wn', [0, 0], [500, 0]), wall('we', [500, 0], [500, 400]), wall('ws', [500, 400], [0, 400]), wall('ww', [0, 400], [0, 0])] }] };

const SIDE = { wn: 'north', we: 'east', ws: 'south', ww: 'west' };
const count = (P, kind) => P.floors[0].openings.filter(o => o.kind === kind).length;
const onSide = (P, kind, side) => P.floors[0].openings.filter(o => o.kind === kind && SIDE[o.wallId] === side).length;
const items = (P, type) => P.floors[0].items.filter(i => !type || i.type === type).length;

const CASES = [
  // the request from the screenshot
  ['add 4 doors from each side of the room', null, P => count(P, 'door') === 4 && ['north', 'east', 'south', 'west'].every(s => onSide(P, 'door', s) === 1) && items(P) === 0],
  ['add a door on each side of the room', null, P => count(P, 'door') === 4],
  ['add one door to every wall', null, P => count(P, 'door') === 4],
  ['add doors on all four sides', null, P => count(P, 'door') === 4],
  ['add 2 windows on each wall of the room', '2 on every side (8)', P => count(P, 'window') === 8],
  ['add 2 windows on each wall of the room', '2 in total', P => count(P, 'window') === 2],
  ['add 2 windows per side', null, P => count(P, 'window') === 8],
  ['add 4 windows all around the room', null, P => count(P, 'window') === 4],
  ['add 6 windows spread around room 1', null, P => count(P, 'window') === 6],
  ['add windows to every wall', null, P => count(P, 'window') === 4],
  // one side
  ['add a window on the north wall', null, P => onSide(P, 'window', 'north') === 1 && count(P, 'window') === 1],
  ['add a window to the bottom wall', null, P => onSide(P, 'window', 'south') === 1],
  ['put a door on the right side of room 1', null, P => onSide(P, 'door', 'east') === 1],
  ['add 3 windows on the south wall', null, P => onSide(P, 'window', 'south') === 3],
  ['put two windows on the left and right walls of room 1', null, P => onSide(P, 'window', 'west') === 1 && onSide(P, 'window', 'east') === 1],
  ['add a door in the north and south walls', null, P => onSide(P, 'door', 'north') === 1 && onSide(P, 'door', 'south') === 1],
  ['add a window on the western wall', null, P => onSide(P, 'window', 'west') === 1],
  // counts without a side
  ['add a door', null, P => count(P, 'door') === 1],
  ['add 2 doors', null, P => count(P, 'door') === 2],
  ['add 3 windows to room 1', null, P => count(P, 'window') === 3],
  ['i need a couple of windows in the room', null, P => count(P, 'window') === 2],
  ['please add a window', null, P => count(P, 'window') === 1],
  // types
  ['add a big window on the south side', null, P => P.floors[0].openings.some(o => o.type === 'picture' && SIDE[o.wallId] === 'south')],
  ['add a sliding door to the east wall', null, P => P.floors[0].openings.some(o => o.kind === 'door' && o.type === 'sliding' && SIDE[o.wallId] === 'east')],
  ['add a french door to the west side', null, P => P.floors[0].openings.some(o => o.type === 'french' && SIDE[o.wallId] === 'west')],
  ['add a double door to the room', null, P => P.floors[0].openings.some(o => o.type === 'double')],
  ['add an archway on the north wall', null, P => P.floors[0].openings.some(o => o.type === 'arched')],
  // removing (always asks first)
  ['__setup:add a door on each side of the room', null, null],
  ['remove the doors from the north wall', 'Remove 1', P => count(P, 'door') === 3 && onSide(P, 'door', 'north') === 0],
  ['__setup:add a door on each side of the room', null, null],
  ['remove all the doors from room 1', 'Remove 4', P => count(P, 'door') === 0],
  ['__setup:add a door on each side of the room', null, null],
  ['delete all doors in the room', 'Cancel', P => count(P, 'door') === 4],
  // questions
  ['__setup:add 2 windows to room 1', null, null],
  ['how many windows does room 1 have', null, (P, txt) => /has 2 windows/.test(txt)],
  ['how many doors are in the room', null, (P, txt) => /has 0 doors/.test(txt)],
  // furniture must still work, and weak matches must not add random things
  ['add 4 chairs to room 1', null, P => items(P, 'chair') === 4],
  ['add a couple of floor lamps', null, P => items(P, 'floor-lamp') === 2],
  ['add a side table', null, P => items(P, 'side-table') === 1],
  ['add a sofa', 'Room 1', P => items(P) === 1],
  ['add a flibbertigibbet', null, P => items(P) === 0 && count(P, 'door') === 0],
  ['add a door to the kitchen', null, (P, txt) => count(P, 'door') === 0 && /couldn’t find a room called/.test(txt)],
  ['add 3 doors to the garage', null, (P, txt) => count(P, 'door') === 0 && /couldn’t find/.test(txt)],
];
// a second set on the full Chalet F template (loaded by default)
const CHALET = [
  ['add a window to the north wall of the kitchen', null, (P, txt) => /Added 1 window to the Kitchen/.test(txt)],
  ['add 2 doors to the master bedroom', null, (P, txt) => /Added 2 doors to the Master Bedroom/.test(txt)],
  ['how many doors does the kitchen have', null, (P, txt) => /Kitchen has \d+ doors?/.test(txt)],
  ['add a window to every bedroom', null, (P, txt) => /Adding window to \d+ rooms/.test(txt)],
  ['add a door between the dining room and the reading nook', null, (P, txt) => /already connected|Added a/.test(txt)],
  ['add 3 bar stools to the kitchen', null, (P, txt) => /Added 3 × bar stool/.test(txt)],
  ['remove the windows from the living room', 'Cancel', (P, txt) => /Remove \d+ windows? from the Living Room/.test(txt)],
];

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chalet-')), fix = path.join(tmp, 'one-room.json');
  fs.writeFileSync(fix, JSON.stringify(ONE_ROOM));
  const b = await chromium.launch(), ctx = await b.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 850 } });
  let pass = 0, fail = 0;
  const run = async (cases, fixture) => {
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL); await p.waitForTimeout(6000);
    const blur = () => p.evaluate(() => { document.activeElement && document.activeElement.blur(); document.querySelector('#tour')?.classList.remove('on'); });
    const load = async () => { if (!fixture) { await p.reload(); await p.waitForTimeout(5000); } else { await blur(); if (await p.$('#modal.open')) await p.keyboard.press('Escape'); await p.click('#mFile .tb'); const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#mFile [data-act=open]')]); await fc.setFiles(fixture); await p.waitForTimeout(500); }
      if (await p.$('#modal.open')) await p.keyboard.press('Escape');
      if (!(await p.$('#ask.on'))) await p.click('#btnAsk'); };
    const save = async () => { await blur(); const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+s')]); return JSON.parse(fs.readFileSync(await dl.path(), 'utf8')); };
    const ask = async q => { const n = await p.$$eval('#askLog .msg', m => m.length); await p.fill('#askInput', q); await p.press('#askInput', 'Enter'); await p.waitForTimeout(900);
      return p.$$eval('#askLog .msg', (m, n) => m.slice(n).map(x => x.innerText).join(' | '), n); };
    let fresh = true;
    for (const [q, click, check] of cases) {
      if (fresh) await load();
      if (q.startsWith('__setup:')) { await ask(q.slice(8)); fresh = false; continue; }
      let txt = await ask(q);
      if (click) { const bt = await p.$(`#askLog .msg:last-child .achips button:text-is("${click}")`) || await p.$(`.achips button:text-is("${click}")`);
        if (bt) { await bt.click(); await p.waitForTimeout(1300); txt += ' || ' + await p.$$eval('#askLog .msg', m => m.slice(-2).map(x => x.innerText).join(' | ')); } else txt += ' [NO BUTTON ' + click + ']'; }
      const P = await save(), ok = check(P, txt.replace(/\s+/g, ' '));
      ok ? pass++ : fail++;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${q}${click ? '  → ' + click : ''}${ok ? '' : '\n      ' + txt.replace(/\s+/g, ' ').slice(0, 300)}`);
      fresh = true;
    }
    if (errs.length) console.log('PAGE ERRORS:', errs);
    await p.close();
  };
  await run(CASES, fix);
  await run(CHALET, null);
  console.log(`\n${pass} passed, ${fail} failed`); await b.close(); process.exit(fail ? 1 : 0);
})();
