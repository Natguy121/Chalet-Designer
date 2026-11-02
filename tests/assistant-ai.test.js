// Tests the AI assistant's loop and tools against a FAKE Anthropic API (no key, no cost).
// Needs the SDK bundled for the browser, e.g. in an empty folder:
//   npm i @anthropic-ai/sdk@0.135.0 esbuild && echo 'export { default } from "@anthropic-ai/sdk";' > entry.js && npx esbuild entry.js --bundle --format=esm --platform=browser --outfile=sdk.mjs
// Run:  python3 -m http.server 8765   then   SDK_BUNDLE=... node tests/assistant-ai.test.js
const { chromium } = require('playwright');
const fs = require('fs');
const URL = process.env.URL || 'http://localhost:8765/index.html';
const SDK = fs.readFileSync(process.env.SDK_BUNDLE);

// scripted "Claude" replies: each request gets the next step of the current script
const tu = (id, name, input) => ({ type: 'tool_use', id, name, input });
const reply = (content, stop = 'tool_use') => ({ id: 'msg_' + Math.random().toString(36).slice(2), type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } });
const SCRIPTS = {
  'make a room that fits 3 bathrooms': [
    reply([{ type: 'text', text: '3 bathrooms need about 12 m². I’ll build a 3.6 x 3.4 m room.' }, tu('t1', 'get_project', {})]),
    req => { const st = JSON.parse(req.messages.at(-1).content[0].content); const lv = st.levels.findIndex(l => l.name === 'Ground floor');
      return reply([tu('t2', 'create_room', { level: lv, name: 'Bathrooms', x: 1095, y: 0, width: 360, depth: 340, floor_material: 'tile-ceramic' })]); },
    req => { const r = JSON.parse(req.messages.at(-1).content[0].content); globalThis.ROOM = r.room.id;
      return reply([tu('t3', 'add_wall', { level: 1, x1: 1215, y1: 0, x2: 1215, y2: 340 }), tu('t4', 'add_wall', { level: 1, x1: 1335, y1: 0, x2: 1335, y2: 340 })]); },
    req => reply([tu('t5', 'search_library', { query: 'toilet' })]),
    req => reply([tu('t6', 'place_item', { type: 'toilet', x: 1155, y: 45, rotation: 180 }), tu('t7', 'place_item', { type: 'toilet', x: 1275, y: 45, rotation: 180 }), tu('t8', 'place_item', { type: 'toilet', x: 1395, y: 45, rotation: 180 })]),
    req => reply([{ type: 'text', text: 'Done: 3 bathrooms (3.6 × 3.4 m) east of the living room, each with a toilet. Want showers and basins too?' }], 'end_turn'),
  ],
  'delete the kitchen': [
    reply([tu('d1', 'get_project', {})]),
    req => { const st = JSON.parse(req.messages.at(-1).content[0].content); const k = st.levels.flatMap(l => l.rooms).find(r => r.name === 'Kitchen');
      return reply([tu('d2', 'delete_objects', { ids: [k.id], summary: 'Delete the Kitchen and its fixtures' })]); },
    req => reply([{ type: 'text', text: 'This will delete the Kitchen and its fixtures. Delete? (yes / save a backup first / cancel)' }], 'end_turn'),
  ],
  'make the kitchen 2 m wider': [
    reply([tu('k1', 'get_project', {})]),
    req => { const st = JSON.parse(req.messages.at(-1).content[0].content); const k = st.levels.flatMap(l => l.rooms).find(r => r.name === 'Kitchen');
      return reply([tu('k2', 'resize_room', { room_id: k.id, x: k.x - 200, y: k.y, width: k.width + 200, depth: k.depth })]); },
    req => reply([{ type: 'text', text: 'Done: kitchen is now 2 m wider.' }], 'end_turn'),
  ],
  'bdi 4 b2wab bi kel jiha la room 1': [
    reply([tu('o1', 'get_project', {})]),
    req => { const st = JSON.parse(req.messages.at(-1).content[0].content); const r = st.levels.flatMap(l => l.rooms).find(r => r.name === 'Kitchen');
      return reply([tu('o2', 'add_openings', { room_id: r.id, kind: 'door', side: 'each' })]); },
    req => reply([{ type: 'text', text: 'Tamam: zedt bab 3a kel jiha.' }], 'end_turn'),
  ],
  'make it night': [
    reply([tu('n1', 'run_command', { command: 'make it night' })]),
    req => reply([{ type: 'text', text: 'Done: it’s 21:30 now.' }], 'end_turn'),
  ],
};
let script = null, step = 0, requests = [];
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1400, height: 850 } }); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route('**/@anthropic-ai/sdk@*/+esm', r => r.fulfill({ body: SDK, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } }));
  await p.route('https://api.anthropic.com/**', async r => {
    const req = JSON.parse(r.request().postData()); requests.push({ req, headers: r.request().headers() });
    const s = SCRIPTS[script][step++], body = typeof s === 'function' ? s(req) : s;
    await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  await p.goto(URL); await p.waitForTimeout(6000);
  if (await p.$('#modal.open')) await p.keyboard.press('Escape');
  await p.click('#btnAsk'); await p.click('#aiBadge'); await p.fill('#aiKey', 'sk-ant-test-key'); await p.click('#modalCard [data-ok]');
  let pass = 0, fail = 0;
  const check = (name, ok, info) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '\n      ' + info}`); };
  const say = async q => { script = q; step = 0; const n = await p.$$eval('#askLog .msg', m => m.length); await p.fill('#askInput', q); await p.press('#askInput', 'Enter');
    for (let i = 0; i < 40 && step < SCRIPTS[q].length; i++) await p.waitForTimeout(250); await p.waitForTimeout(700);
    return p.$$eval('#askLog .msg', (m, n) => m.slice(n).map(x => x.innerText).join(' | '), n); };

  let t = await say('make a room that fits 3 bathrooms');
  const first = requests[0];
  check('sends to the Messages API with the visitor key and browser header', first.headers['x-api-key'] === 'sk-ant-test-key' && 'anthropic-dangerous-direct-browser-access' in first.headers, JSON.stringify(first.headers));
  check('uses Opus 5.5, the system prompt, tools, caching and fallbacks', first.req.model === 'claude-opus-5-5' && /Chalet Design Assistant/.test(first.req.system) && first.req.tools.length > 10 && first.req.cache_control && first.req.fallbacks === 'default', JSON.stringify(Object.keys(first.req)));
  check('tool results go back in one user message per turn', requests[2].req.messages.at(-1).content.length === 1 && requests[3].req.messages.at(-1).content.length === 2, '');
  const r3 = JSON.parse(requests[3].req.messages.at(-1).content[1].content);   // after the second partition
  check('add_wall splits the new room into 3 bathrooms', (r3.rooms_now || []).filter(r => /Bathrooms/.test(r.name)).length === 3, JSON.stringify(r3));
  const placed = JSON.parse(requests[5].req.messages.at(-1).content[2].content);
  check('place_item puts a toilet in a bathroom', placed.ok && /Bathrooms/.test(placed.room || ''), JSON.stringify(placed));
  check('final reply is shown, with an undo button', /Done: 3 bathrooms/.test(t) && /Undo all of that/.test(t), t);

  t = await say('delete the kitchen');
  check('delete is only proposed, with a card', /This removes 1 room/.test(t) && /Delete/.test(t), t);
  await p.fill('#askInput', 'yes'); await p.press('#askInput', 'Enter'); await p.waitForTimeout(800);
  t = await p.$$eval('#askLog .msg', m => m.slice(-1).map(x => x.innerText).join(''));
  check('typing "yes" carries out the pending delete without asking the model', /Done: deleted the Kitchen/.test(t), t);
  requests = [];
  await p.click('#btnUndo');   // put the kitchen back for the next test await p.waitForTimeout(500);

  t = await say('make the kitchen 2 m wider');
  const rz = JSON.parse(requests.at(-1).req.messages.at(-1).content[0].content);
  check('resize_room widens the kitchen and stretches its neighbour', rz.ok && rz.room.width === 630 && rz.room.x === -200, JSON.stringify(rz).slice(0, 300));

  t = await say('bdi 4 b2wab bi kel jiha la room 1');
  const op = JSON.parse(requests.at(-1).req.messages.at(-1).content[0].content);
  check('add_openings side "each" adds doors around the room', op.added >= 3, JSON.stringify(op));

  t = await say('make it night');
  const rc = JSON.parse(requests.at(-1).req.messages.at(-1).content[0].content);
  check('run_command drives the built-in commands', /21:30|Time set/.test(rc.reply), JSON.stringify(rc));
  check('no page errors', errs.length === 0, errs.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`); await b.close(); process.exit(fail ? 1 : 0);
})();
