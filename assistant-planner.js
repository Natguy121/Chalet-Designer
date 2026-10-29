/* =====================================================================
   ASSISTANT, PART 3 — plan generation, safe edits, versions, Q&A
   ---------------------------------------------------------------------
   Core rule: the assistant only PROPOSES risky changes. Deleting
   anything, replacing the house or switching versions needs your click;
   deleting a floor or the whole house needs the project name typed in.
   Every change the assistant makes is snapshotted, so "restore last
   version" and "what did you just change?" always work.
   ===================================================================== */
(() => {
  Object.assign(ASK, { snaps: [], lastDiff: null, versions: {} });
  try { ASK.versions = JSON.parse(localStorage.getItem('chalet-versions') || '{}'); } catch (_) {}
  const saveVersions = () => { try { localStorage.setItem('chalet-versions', JSON.stringify(ASK.versions)); } catch (_) { toast('Versions are too big for browser storage — they last until you reload'); } };
  const lastMsg = () => { const l = $('#askLog').lastElementChild; return l && l.classList.contains('ai') ? l : null; };
  function buttons(items, host = lastMsg()) {
    if (!host) return;
    const row = document.createElement('div'); row.className = 'achips';
    for (const [label, fn] of items) { const b = document.createElement('button'); b.textContent = label;
      b.onclick = () => { row.querySelectorAll('button').forEach(x => x.disabled = true); typeof fn === 'string' ? ask(fn) : tracked(fn); }; row.appendChild(b); }
    host.appendChild(row); $('#askLog').scrollTop = 1e9;
  }

  /* ---------- snapshots and plain-language diffs ---------- */
  const KINDS = [['rooms', 'room'], ['items', 'item'], ['openings', 'door/window'], ['walls', 'wall'], ['stairs', 'stair']];
  function diff(a, b) {
    const parts = [], fa = new Map(a.floors.map(f => [f.id, f])), fb = new Map(b.floors.map(f => [f.id, f]));
    const fAdd = b.floors.filter(f => !fa.has(f.id)), fDel = a.floors.filter(f => !fb.has(f.id));
    if (fAdd.length) parts.push(`added ${fAdd.length} floor${fAdd.length > 1 ? 's' : ''}`);
    if (fDel.length) parts.push(`removed ${fDel.length} floor${fDel.length > 1 ? 's' : ''} (${fDel.map(f => f.name).join(', ')})`);
    for (const [k, label] of KINDS) {
      const A = new Map(), B = new Map();
      for (const f of a.floors) if (fb.has(f.id)) for (const o of f[k]) A.set(o.id, o);
      for (const f of b.floors) if (fa.has(f.id)) for (const o of f[k]) B.set(o.id, o);
      const add = [...B.keys()].filter(id => !A.has(id)), del = [...A.keys()].filter(id => !B.has(id)), chg = [...B.keys()].filter(id => A.has(id) && JSON.stringify(A.get(id)) !== JSON.stringify(B.get(id)));
      const nm = (ids, M) => { const n = ids.map(id => M.get(id).name).filter(Boolean); return n.length && n.length <= 4 ? ` (${n.join(', ')})` : ''; };
      const pl = n => `${n} ${label}${n > 1 ? 's' : ''}`;
      if (add.length) parts.push(`added ${pl(add.length)}${nm(add, B)}`);
      if (del.length) parts.push(`removed ${pl(del.length)}${nm(del, A)}`);
      if (chg.length) parts.push(`changed ${pl(chg.length)}${nm(chg, B)}`);
    }
    if (!parts.length && JSON.stringify(a.settings) !== JSON.stringify(b.settings)) parts.push('changed display or lighting settings');
    if (!parts.length && JSON.stringify(a) !== JSON.stringify(b)) parts.push('changed project details');
    return parts;
  }
  function noteChange(before) {
    if (JSON.stringify(P) === before) return;
    ASK.snaps.push(before); if (ASK.snaps.length > 20) ASK.snaps.shift();
    ASK.lastDiff = diff(JSON.parse(before), P);
  }
  function tracked(fn) { const s0 = JSON.stringify(P); try { fn(); } catch (e) { console.error(e); say('Sorry — that didn’t work.'); } noteChange(s0); }
  const _answer = answer;
  answer = q => { const s0 = JSON.stringify(P); try { if (!extra(q)) _answer(q); } finally { noteChange(s0); } };

  /* ---------- helpers ---------- */
  function itemById(id) { for (let fi = 0; fi < P.floors.length; fi++) { const f = P.floors[fi], it = f.items.find(i => i.id === id); if (it) return { kind: 'item', f, fi, it, name: it.name }; } return null; }
  /** the item a command is about: the one we just talked about if the names match, else a search */
  function targetItem(text) {
    const t = (text || '').trim().replace(/^(the|a|an|my)\s+/, ''), last = ASK.last && ASK.last.kind === 'item' ? itemById(ASK.last.it.id) : null;
    if (!t || /^(it|this|that|this one|that one)$/.test(t)) { if (last) return last; const s0 = selectedObjs()[0]; return s0 && s0.s.k === 'item' ? { kind: 'item', f: F(), fi: S.floor, it: s0.o, name: s0.o.name } : null; }
    if (last && last.name.toLowerCase() === t) return last;
    return search(t, ['item'])[0] || null;
  }
  const roomItems = (f, r) => f.items.filter(i => inPoly(i.x, i.y, r.poly));
  const roomDoors = (f, r) => openingsOfRoom(f, r);
  const counts = () => ({ floors: P.floors.length, rooms: P.floors.reduce((s, f) => s + f.rooms.length, 0), doors: P.floors.reduce((s, f) => s + f.openings.filter(o => o.kind === 'door').length, 0),
    windows: P.floors.reduce((s, f) => s + f.openings.filter(o => o.kind === 'window').length, 0), items: P.floors.reduce((s, f) => s + f.items.length, 0) });
  function typedConfirm(title, html, label, fn) {
    const c = openModal(`<h2>${esc(title)}</h2><p>${html}</p><p>A snapshot is saved first, and Undo still works. To confirm, type the project name <b>${esc(P.name)}</b>:</p>
      <div class="f full"><input id="tcIn" autocomplete="off" placeholder="${esc(P.name)}"></div>
      <div class="row" style="justify-content:flex-end"><button class="btn" data-x>Cancel</button><button class="btn primary danger" data-ok disabled>${esc(label)}</button></div>`);
    const i = c.querySelector('#tcIn'), ok = c.querySelector('[data-ok]');
    i.oninput = () => ok.disabled = i.value.trim().toLowerCase() !== P.name.trim().toLowerCase();
    i.onkeydown = e => { if (e.key === 'Enter' && !ok.disabled) ok.click(); };
    c.querySelector('[data-x]').onclick = () => { closeModal(); say('OK, nothing was deleted.'); };
    ok.onclick = () => { closeModal(); tracked(fn); };
  }
  function costOf(proj) { const keep = P; P = proj; try { return computeCosts().total; } finally { P = keep; } }
  const areaOf = proj => proj.floors.reduce((s, f) => s + f.rooms.filter(r => !r.outdoor).reduce((a, r) => a + polyArea(r.poly), 0), 0);

  /* ---------- plan generation from a brief ---------- */
  const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, a: 1, an: 1 };
  const num = (t, re, d) => { const m = t.match(re); if (!m) return d; const v = +m[1] || NUM[m[1]]; return v ? Math.min(8, v) : d; };
  function briefOf(t) {
    const N = '(\\d+|one|two|three|four|five|six|seven|eight|a|an)';
    const b = { beds: num(t, new RegExp(N + '[\\s-]*(?:bed|bedroom)'), 3) };
    b.baths = num(t, new RegExp(N + '[\\s-]*(?:bath|bathroom|shower room)'), Math.max(1, Math.ceil(b.beds / 2)));
    b.garage = /garage|car ?port|parking/.test(t); b.sauna = /sauna/.test(t); b.office = /office|study|work from home|remote/.test(t);
    b.boot = !/no boot|no mud/.test(t); b.laundry = !/no laundry/.test(t); b.loft = /loft|mezzanine/.test(t);
    b.open = /open[\s-]?plan|open living/.test(t); b.two = /two[\s-]?stor|2[\s-]?stor|upstairs|first floor|two floors|2 floors/.test(t);
    b.roof = /a-?frame|steep/.test(t) ? 50 : /shed|mono/.test(t) ? 'shed' : /flat/.test(t) ? 'flat' : 38;
    b.rental = /rent|airbnb|guests/.test(t);
    if (b.rental) { b.beds = Math.max(b.beds, 4); b.baths = Math.max(b.baths, Math.ceil(b.beds / 2) + 1); }
    return b;
  }
  /** A = open plan, B = separate rooms, C = compact on two floors */
  function genPlan(b, variant) {
    const two = variant === 'C' || ((b.two || b.loft) && variant !== 'A') || (b.beds >= 4 && !variant);
    const pub = variant === 'A' || variant === 'C' || (b.open && variant !== 'B') ? [['Living, Kitchen & Dining', 760, 'oak']] : [['Living Room', 520, 'oak'], ['Kitchen & Dining', 420, 'tile-porcelain']];
    if (b.office) pub.push(['Office', 280, 'oak']);
    const service = [...(b.boot ? [['Boot Room', 220, 'tile-ceramic']] : []), ['Guest WC', 170, 'tile-ceramic'], ...(b.laundry ? [['Drying & Laundry', 220, 'tile-ceramic']] : []), ...(b.sauna ? [['Sauna', 230, 'decking']] : [])];
    const priv = [];
    for (let i = 0; i < b.beds; i++) priv.push([i ? `Bedroom ${i + 1}` : 'Master Bedroom', i ? 330 : 420, i ? 'oak' : 'walnut']);
    for (let i = 0; i < b.baths; i++) priv.push([b.baths > 1 ? `Bathroom ${i + 1}` : 'Bathroom', 240, 'tile-ceramic']);
    const garage = b.garage ? [['Garage', 360, 'concrete']] : [];
    const D1 = 450, D2 = 400, HALL = two ? 230 : 130;
    const levels = two ? [{ name: 'Ground floor', elev: 0, top: [...pub, ...garage], bot: service, ext: 'stone' }, { name: 'First floor', elev: 295, top: priv.filter((_, i) => i % 2 === 0), bot: priv.filter((_, i) => i % 2 === 1), ext: 'timber-clad' }]
                       : [{ name: 'Ground floor', elev: 0, top: [...pub, ...garage, ...priv.filter(r => /Master/.test(r[0]))], bot: [...service, ...priv.filter(r => !/Master/.test(r[0]))], ext: 'timber-clad' }];
    const W = Math.max(...levels.flatMap(L => [L.top, L.bot].map(row => row.reduce((s, r) => s + r[1], 0))));
    const floors = levels.map((L, li) => {
      const rooms = [], openings = [], items = [];
      for (const [row, y, d] of [[L.top, 0, D1], [L.bot, D1 + HALL, D2]]) {
        let x = 0; row.forEach(([name, w, mat], i) => {
          const ww = i === row.length - 1 ? W - x : w; rooms.push([name, x, y, ww, d, mat]);
          const cx = x + ww / 2, hallSide = y === 0 ? D1 : D1 + HALL, outside = y === 0 ? 0 : D1 + HALL + D2;
          if (name === 'Garage') { openings.push(['garage-door', cx, 0], ['door', x + 60, hallSide]); }
          else { openings.push([name === 'Sauna' ? 'door' : 'door', x + Math.min(70, ww / 2), hallSide]);
            if (name !== 'Sauna') openings.push([ww >= 380 ? (y === 0 && li === 0 ? 'window-picture' : 'window-double') : 'window', cx + (ww > 200 ? 25 : 0), outside]); }
          x += ww;
        });
        if (!row.length) rooms.push(['Store', 0, y, W, d, 'concrete']);
      }
      rooms.push([li ? 'Landing' : 'Hall', 0, D1, W, HALL, li ? 'oak' : 'tile-marble']);
      if (!li) { openings.push(['door', 0, D1 + HALL / 2, { type: 'double', width: 140 }]); items.push(['entrance', 30, D1 + HALL / 2 - 22, 90]); }
      openings.push(['window', W, D1 + HALL / 2]);
      const fl = { name: L.name, elev: L.elev, height: 270, extMat: L.ext, intMat: 'paint-white', rooms, openings, items };
      if (two && !li) fl.stairs = [{ type: 'straight', x: W / 2, y: D1 + HALL - 60, w: 100, len: 480, rot: 90 }];
      if (li === levels.length - 1) fl.roof = b.roof === 'flat' ? { type: 'flat', overhang: 30, mat: 'concrete' } : b.roof === 'shed' ? { type: 'shed', pitch: 18, overhang: 60, mat: 'roof-metal' } : { type: 'gable', pitch: b.roof, overhang: 70, mat: 'roof-slate' };
      return fl;
    });
    const name = `Chalet — ${b.beds} bed${b.beds > 1 ? 's' : ''}${variant ? ' (' + { A: 'open plan', B: 'separate rooms', C: 'compact, two floors' }[variant] + ')' : ''}`;
    return buildTemplate({ name, site: { fence: true, trees: [[-400, -300, 1.1], [W + 400, -250, 1.3], [W + 450, 900, 1], [-450, 1000, 1.2]], path: { x: -60, w: 110, len: 500 } }, floors });
  }
  function proposePlan(proj, extraNote) {
    const C = counts(), cost = costOf(proj);
    say(`Here’s <b>${esc(proj.name)}</b>: ${proj.floors.length} floor${proj.floors.length > 1 ? 's' : ''}, ${proj.floors.reduce((s, f) => s + f.rooms.length, 0)} rooms, ${fmtArea(areaOf(proj))}, roughly ${fmtMoney(cost, P.settings.currency)} before furniture. ${extraNote || ''}<br>Loading it <b>replaces your current house</b> (${C.floors} floors, ${C.rooms} rooms). I’ll keep a snapshot, so “restore last version” or Undo brings it back.`);
    buttons([['✓ Load this plan', () => { commit(); const keep = P.settings; P = proj; P.settings = Object.assign(deepClone(keep), { prices: keep.prices }); S.floor = 0; S.sel = []; afterLoad(true); changed();
               say(`Loaded. Next: <b>furnish every room</b>, check the warnings, or save the old one as a version first.`); buttons([['Furnish every room', furnishAll], ['Any problems?', 'any problems?'], ['What did you change?', 'what did you just change?']]); }],
             ['Save my current house as a version first', () => { saveVersion('Before plan ' + (Object.keys(ASK.versions).length + 1)); proposePlan(proj); }],
             ['Cancel', () => say('OK, your house is unchanged.')]]);
  }
  function furnishAll() {
    let n = 0; const keepFloor = S.floor;
    P.floors.forEach((f, fi) => f.rooms.forEach(r => { const k = roomKind(r.name); if (!k || !ROOM_SETS[k] || roomItems(f, r).some(i => i.type !== 'ceiling-lamp')) return;
      for (const id of ROOM_SETS[k]) if (LIB[id]) { addThing(LIB[id], r, f, fi); n++; } }));
    S.floor = keepFloor; refreshFloors(); say(`Added ${n} pieces of furniture across the house. Drag anything into place, or say “undo” for the last one / “restore last version” for all of them.`);
  }

  /* ---------- versions ---------- */
  function saveVersion(name) {
    ASK.versions[name] = { t: Date.now(), P: JSON.parse(JSON.stringify(P)) }; saveVersions();
    say(`Saved your current house as <b>${esc(name)}</b>. Say “compare versions” or “switch to ${esc(name)}” any time.`);
  }
  function compareVersions() {
    const list = [['Current', P], ...Object.entries(ASK.versions).map(([k, v]) => [k, v.P])];
    if (list.length < 2) return say('There’s only the current house. Say “save this as version B” to keep a copy, then change things and compare.');
    const rows = list.map(([n, p]) => { const r = p.floors.reduce((s, f) => s + f.rooms.length, 0), a = areaOf(p), c = costOf(p);
      return `<tr><td>${esc(n)}</td><td class="n">${p.floors.length}</td><td class="n">${r}</td><td class="n">${fmtArea(a)}</td><td class="n">${fmtMoney(c, P.settings.currency)}</td></tr>`; }).join('');
    say(`<table class="t"><tr><th>Version</th><th class="n">Floors</th><th class="n">Rooms</th><th class="n">Area</th><th class="n">Cost</th></tr>${rows}</table>`);
    buttons(Object.keys(ASK.versions).slice(0, 6).map(k => [`Switch to ${k}`, `switch to ${k}`]));
  }

  /* ---------- the knowledge base: typical rules of thumb ---------- */
  const FAQ = [
    ['bedroom size big minimum', 'Roughly 9 m² for a single and 12–14 m² for a double with a wardrobe. Check your local minimum — I can list rooms below that with “any problems?”.'],
    ['kitchen small size', 'Under about 6 m² usually forces a galley layout. A comfortable kitchen-diner for 4–6 people is 15–20 m².'],
    ['hallway corridor wide width', 'Hallways: 90–100 cm minimum, 120 cm if wheelchair access matters.'],
    ['bathroom where place', 'Next to the bedrooms, and stacked over or under other wet rooms (kitchen, laundry) to shorten pipe runs.'],
    ['kitchen open living door', 'An open kitchen works well in a chalet — plan good extraction for cooking smells and some acoustic separation.'],
    ['square metres need people family area', 'Usually 90–130 m² for 4 people. Tell me “design a chalet with 3 bedrooms” and I’ll size the rooms.'],
    ['wasted space efficiency corridor', 'Long corridors and dead-end corners waste area; aim for under 15–20% of the floor as circulation.'],
    ['master bedroom ground floor upstairs', 'Ground floor is good for accessibility and ageing in place; upstairs gets better views and quiet.'],
    ['guest room later flexible', 'Reserve a flexible office/guest room with a window and plumbing nearby so it can become a bedroom later.'],
    ['boot room mudroom ski gear', 'Right inside the main entrance, next to the heat source so boots and gear dry — with a durable tiled floor and a bench.'],
    ['roof angle pitch snow', 'About 30–45° sheds snow well. Lower pitches need a stronger structure for the snow load.'],
    ['snow slide door entrance roof', 'Don’t put the entrance under the eaves of a slope that sheds snow. Put it on a gable end, or add a canopy or snow guards.'],
    ['fireplace stove where', 'Central in the living area, away from windows and furniture, with a straight chimney route up through the ridge.'],
    ['chimney height above roof', 'Typical rule: about 60 cm above the ridge, or 1 m above where it leaves the roof. Check your local code.'],
    ['firewood store wood storage', 'Covered, close to the entrance, and a few metres from the walls to reduce fire and insect risk.'],
    ['sauna fit size', 'About 3–4 m², water-resistant and ventilated, with a dedicated electrical line. Try “add a sauna to the plan” or include “sauna” in a brief.'],
    ['deck terrace balcony size', '8–12 m² for a table and chairs, 20 m² or more for lounging — facing the view and the afternoon sun.'],
    ['entrance south side wind', 'South helps melt ice (northern hemisphere), but shelter from the prevailing wind matters more.'],
    ['loft mezzanine space headroom', 'Use it for sleeping, reading or an office. Keep about 2 m headroom over most of the floor and a safe railing.'],
    ['rent rental airbnb guests', 'More beds, an extra bathroom, durable finishes and an easy-clean entrance. Say “design a rental chalet with 5 bedrooms”.'],
    ['drying room wet clothes', 'Next to the boot room and the heating, with a floor drain and good ventilation.'],
    ['remove wall load bearing', 'If it carries a floor or roof above, it needs a beam sized by an engineer. I can’t tell load paths for certain — treat it as “engineer review”.'],
    ['span column beam living room wide', 'Typical timber floor spans are 4–6 m; beyond that you usually need a beam, a column or engineered joists.'],
    ['stair slope safe rise run', 'Rise about 17–19 cm, going about 25–28 cm, headroom at least 2 m. Select a stair to see its numbers.'],
    ['steps stairs how many floor height', 'Divide the floor-to-floor height by about 17.5 cm — e.g. 2.8 m gives 16 steps of 17.5 cm.'],
    ['balcony safe cantilever', 'Projections over about 1.5 m need engineering. Glass or metal railings around 1–1.1 m high.'],
    ['two exits egress fire escape', 'Upper floors and lofts with beds often need a second way out — usually an escape-size window.'],
    ['smoke detector co alarm', 'One in each bedroom, in the hallway outside sleeping areas, on every level, and a CO alarm near the stove and boiler.'],
    ['basement waterproofing', 'Below ground needs tanking or a membrane, perimeter drainage and a retaining-wall check.'],
    ['railing guardrail height', 'Commonly 90–110 cm, with gaps small enough that a child can’t get through (about 10 cm). Check local rules.'],
    ['insulation how much', 'Cold climates: think 20–30 cm in walls and 30–40 cm in the roof, with triple glazing. Airtightness matters as much as thickness.'],
    ['window size big daylight', 'Glass of roughly 10–20% of each room’s floor area gives good daylight.'],
    ['south glass overheating summer shade', 'Big south glazing is great in winter; add a roof overhang or shading so summer sun doesn’t overheat the room.'],
    ['heating system heat pump underfloor', 'Wood stove for atmosphere, heat pump for running cost, underfloor heating for comfort — many chalets combine two.'],
    ['solar panels', 'Use the roof slope that faces south; roughly 1 kWp per 5–6 m² of panel.'],
    ['warm winter heat loss', 'Heat loss comes from walls, roof, windows and draughts. Compact shape + good windows + airtightness keep it warm.'],
    ['cold spots thermal bridge', 'Corners, balcony slabs and north walls. Keep balconies thermally broken from the floor slab.'],
    ['fresh air ventilation heat recovery', 'A heat-recovery ventilation (MVHR) unit brings in fresh air while keeping most of the heat.'],
    ['energy bill reduce', 'In order of impact: airtight envelope, better windows, more insulation, compact shape, shading.'],
    ['morning sun bedroom east', 'East-facing windows get morning light. Set the North bearing on the right and I can tell which way rooms face.'],
    ['outlets plugs sockets how many', 'About one double socket every 3–4 m of wall, plus extras at desks, beds and kitchen worktops.'],
    ['electrical panel fuse board where', 'Near the entrance or in the utility room — easy to reach, away from water.'],
    ['water tank where', 'Utility room or basement, with a drain and protection from freezing.'],
    ['septic tank sewer', 'If there’s no sewer, yes — keep it well away from the house and any water source.'],
    ['router wifi internet', 'Central and high, with cables to the office and the TV.'],
    ['power cut outage backup generator', 'A wood stove for heat, plus a small generator or a battery for critical loads.'],
    ['contingency budget', 'Keep 10–15% of the budget, more for sloped or remote sites.'],
    ['how long build time schedule', 'A typical chalet takes 9–18 months; mountain weather and deliveries often add time. Build the shell first so it’s weather-tight.'],
    ['save money cut cost cheaper', 'Biggest savings: simpler roof shape, fewer corners, less glass, standard window sizes, stacked wet rooms.'],
    ['permit permits need', 'Usually a building permit with plans, elevations, a site plan and an engineer’s structural report. Confirm with your municipality.'],
    ['driveway steep slope', 'About 10–12% is comfortable; steeper needs heating cables or careful winter care.'],
    ['parking where', 'Close to the entrance, with space to pile snow and a safe turning area.'],
    ['sloped plot slope site', 'Step the floors, half-bury a lower level (like Chalet F’s basement) or use piles.'],
    ['rainwater drainage', 'Slope the ground away from the house and lead downpipes to a drain or a collection tank.'],
    ['sofa fit room', 'Leave about 90 cm of walkway and keep door swings clear. Ask “which sofas fit in the living room?”.'],
    ['color colour palette alpine', 'Warm woods, deep forest green, stone grey and cream, with one accent like rust red.'],
    ['flooring best chalet', 'Tiles or stone by the entrance, warm wood in the living areas, easy-clean tiles in wet rooms.'],
    ['cozy cosy living room', 'Low warm lights, the fireplace as the focal point, a window seat, rugs and soft textures.'],
    ['tv where place', 'Away from bright windows to avoid glare, about 2.5–3.5 m from the sofa.'],
    ['delete itself trust ai mistake', 'I never delete on my own — I propose and you confirm. Deleting a floor or the house needs the project name typed in. Every change is snapshotted: say “restore last version”.'],
    ['offline work', 'Everything here runs in your browser, so it keeps working offline once the page has loaded.'],
    ['structural advice trust engineer', 'Use me for early design and to flag risks. Final structural, electrical and code decisions need a licensed professional.'],
  ];
  function faq(l) {
    if (!/^(how|what|where|should|can|is|are|do|does|which|will|why|when)\b/.test(l) || /^(how many|how big is|where is|where are|what'?s in|how much (does|is|do)|what is (this|that))\b/.test(l)) return false;
    const T = terms(l); let best = null;
    for (const [k, a] of FAQ) { const r = scoreText(k, T); if (r.matched >= 2 && (!best || r.s > best.s)) best = { a, s: r.s }; }
    if (!best) return false;
    say(best.a + ' <span class="muted">(Rule of thumb — always check local code and a licensed professional.)</span>'); return true;
  }

  /* ---------- doors & windows by count and by wall side ----------
     "add 4 doors, one on each side of the room", "put 2 windows on the north wall of the kitchen",
     "add a window on the left and right walls", "remove all the doors from bedroom 2", "how many windows does the office have" */
  const WORDNUM = { a: 1, an: 1, one: 1, single: 1, two: 2, couple: 2, pair: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, several: 3, few: 2 };
  const toNum = w => w == null ? null : /^\d+$/.test(w) ? +w : WORDNUM[w] ?? null;
  const SIDE_WORD = { north: 'north', top: 'north', back: 'north', upper: 'north', south: 'south', bottom: 'south', front: 'south', lower: 'south', east: 'east', right: 'east', west: 'west', left: 'west' };
  const SIDE_ORDER = ['north', 'east', 'south', 'west'];
  const SIDE_NAME = { north: 'top (north)', south: 'bottom (south)', east: 'right (east)', west: 'left (west)' };
  /** the stretches of wall around a room, each tagged with the side of the room it is on */
  function roomSides(f, r) {
    const [cx, cy] = interiorPoint(r.poly), out = [];
    for (const w of f.walls) {
      const L = wallLen(w), [dx, dy] = wallDir(w), lim = (w.thick || 20) / 2 + 8; let t0 = null, t1 = null;
      for (let t = 5; t < L - 5; t += 5) { const x = w.a[0] + dx * t, y = w.a[1] + dy * t; if (edgeDist(r.poly, x, y) < lim) { if (t0 === null) t0 = t; t1 = t; } }
      if (t0 === null || t1 - t0 < 60) continue;
      const mx = w.a[0] + dx * (t0 + t1) / 2, my = w.a[1] + dy * (t0 + t1) / 2, ex = mx - cx, ey = my - cy;
      const side = Math.abs(ex) > Math.abs(ey) ? (ex > 0 ? 'east' : 'west') : (ey > 0 ? 'south' : 'north');
      const sd = wallSides(f, w);
      out.push({ w, t0, t1, side, ext: !(sd.l && sd.r) });
    }
    return out;
  }
  /** put n openings spread evenly along one stretch of wall; returns how many fitted */
  function placeOn(f, s, kind, n, spec) {
    const span = s.t1 - s.t0, base = makeOpening(spec || kind), width = Math.min(base.width, span / n - 20);
    if (width < (kind === 'door' ? 60 : 40)) return 0;
    const taken = f.openings.filter(q => q.wallId === s.w.id); let placed = 0;
    const lo = s.t0 + width / 2 + 5, hi = s.t1 - width / 2 - 5, free = t => t >= lo && t <= hi && !taken.some(q => Math.abs(q.t - t) < (q.width + width) / 2 + 10);
    for (let i = 0; i < n; i++) {
      const ideal = s.t0 + span * (i + .5) / n; let t = null;
      for (let d = 0; d <= span && t === null; d += 10) { if (free(ideal + d)) t = ideal + d; else if (free(ideal - d)) t = ideal - d; }   // slide along to the nearest free spot
      if (t === null) continue;
      const o = makeOpening(spec || kind); o.width = Math.round(width); o.wallId = s.w.id; o.t = t; f.openings.push(o); taken.push(o); placed++;
    }
    return placed;
  }
  /** which room a sentence is about: a room named in it, else the selected / last-mentioned room, else the only room */
  function roomInText(l) {
    let best = null;
    P.floors.forEach((f, fi) => f.rooms.forEach(r => { const n = r.name.toLowerCase(); if (l.includes(n) && (!best || n.length > best.name.length)) best = { kind: 'room', f, fi, r, name: r.name }; }));
    if (best) return best;
    const m = l.match(/\b(?:to|in|into|of|for|on|from|around) (?:the |my )?([a-z][a-z0-9 &'-]+?)(?:'s)?(?: walls?| sides?)?$/);
    const generic = /^(room|this room|that room|it|here|there|wall|walls|side|sides|house|plan|middle|centre|center|corner|end|outside|inside)$|\b(north|south|east|west|left|right|top|bottom|front|back|upper|lower|each|every|all|both|around|other)(ern)?\b/;
    if (m && !generic.test(m[1])) { const r = search(m[1], ['room'])[0]; if (r && r.score >= 3) return r; return { missing: m[1] }; }
    return null;
  }
  function contextOrOnlyRoom() {
    const c = contextRoom(); if (c) return c;
    const last = ASK.lastRoom && P.floors.find(f => f.id === ASK.lastRoom.f.id);
    if (last) { const r = last.rooms.find(q => q.id === ASK.lastRoom.r.id); if (r) return { kind: 'room', f: last, fi: P.floors.indexOf(last), r, name: r.name }; }
    const only = F().rooms.filter(r => !r.outdoor); return only.length === 1 ? { kind: 'room', f: F(), fi: S.floor, r: only[0], name: only[0].name } : null;
  }
  function askWhichRoom(q, l) {
    const rooms = P.floors.flatMap((f, fi) => f.rooms.filter(r => !r.outdoor).map(r => ({ f, fi, r })));
    if (!rooms.length) { say('There are no rooms yet. Draw walls (W) or say “design a chalet with 3 bedrooms” first.'); return true; }
    say('Which room?');
    const base = q.replace(/\s+(?:to|in|into|of|for|on|around) (?:the |this |that )?room$/i, '').replace(/[?.!]+$/, '');
    buttons(rooms.slice(0, 14).map(x => [x.r.name, `${base} in the ${x.r.name}`]));
    return true;
  }
  function openingCmd(q, l) {
    let m;
    const kindM = l.match(/\b(doors?|doorways?|windows?|openings?|arch(?:es|way)?s?|skylights?)\b/); if (!kindM) return false;
    const kw = kindM[1], kind = /window|skylight/.test(kw) ? 'window' : 'door';
    const spec = /arch/.test(kw) ? 'arch' : /sliding/.test(l) ? (kind === 'door' ? 'door-sliding' : 'window-sliding') : /french/.test(l) ? 'door-french' : /double/.test(l) ? (kind === 'door' ? 'door-double' : 'window-double') : /pocket/.test(l) ? 'door-pocket' : /garage/.test(l) ? 'garage-door' : /picture|big|large|panoramic/.test(l) && kind === 'window' ? 'window-picture' : /bay/.test(l) ? 'window-bay' : kind;
    if (/skylight/.test(kw)) return false;

    // how many doors / windows does X have
    if (/^how many\b/.test(l)) {
      let r = roomInText(l); if (r && r.missing) return say(`I couldn’t find a room called “${esc(r.missing)}”.`), true; r = r || (/\b(the room|this room|it)\b/.test(l) ? contextOrOnlyRoom() : null);
      const list = r ? openingsOfRoom(r.f, r.r) : P.floors.flatMap(f => f.openings), n = list.filter(o => o.kind === kind).length;
      say(`${r ? 'The ' + esc(r.name) + ' has' : 'The house has'} ${n} ${kind}${n === 1 ? '' : 's'}.`); return true;
    }
    // remove / delete doors or windows from a room (proposed, not executed)
    if (/^(remove|delete|take out|take away|get rid of|close up|brick up|fill in)\b/.test(l)) {
      const r0 = roomInText(l); if (r0 && r0.missing) { say(`I couldn’t find a room called “${esc(r0.missing)}”.`, search(r0.missing, ['room']).slice(0, 4)); return true; }
    const r = r0 || contextOrOnlyRoom(); if (!r) return askWhichRoom(q, l);
      let sides = Object.keys(SIDE_WORD).filter(w => new RegExp(`\\b${w}\\b`).test(l)).map(w => SIDE_WORD[w]);
      const spans = roomSides(r.f, r.r).filter(s => !sides.length || sides.includes(s.side)), ids = new Set(spans.map(s => s.w.id));
      const hit = openingsOfRoom(r.f, r.r).filter(o => o.kind === kind && ids.has(o.wallId) && spans.some(s => s.w.id === o.wallId && o.t >= s.t0 - 5 && o.t <= s.t1 + 5));
      if (!hit.length) { say(`The ${esc(r.name)} has no ${kind}s${sides.length ? ' on that side' : ''} to remove.`); return true; }
      say(`Remove <b>${hit.length} ${kind}${hit.length > 1 ? 's' : ''}</b> from the ${esc(r.name)}${sides.length ? ' (' + sides.map(s => SIDE_NAME[s]).join(', ') + ')' : ''}? ${kind === 'door' && hit.length === openingsOfRoom(r.f, r.r).filter(o => o.kind === 'door').length ? 'The room will have no way in.' : ''}`);
      buttons([[`Remove ${hit.length}`, () => { edit(() => { const del = new Set(hit.map(o => o.id)); r.f.openings = r.f.openings.filter(o => !del.has(o.id)); }); S.sel = []; onSelection(); say(`Removed ${hit.length} ${kind}${hit.length > 1 ? 's' : ''} from the ${esc(r.name)}.`); }], ['Cancel', () => say('OK, nothing removed.')]]);
      return true;
    }
    if (!/^(add|put|place|insert|make|create|give|cut|open up|i want|i need|can you add|could you add|please add|we need)\b/.test(l)) return false;
    if (/\b(between|connect|connecting|joining)\b/.test(l)) return false;            // handled by "door between X and Y"
    const sidePhrase = /\b(each|every|all(?: the)?|all four|all 4|both) (sides?|walls?)\b|\b(on|in) (each|every) (side|wall)\b|\ball around\b|\baround the room\b/;
    const plainLess = l.replace(sidePhrase, '');
    if (/\b(every|each|all)\b/.test(plainLess) && /\brooms?\b|bedrooms?|bathrooms?|kitchens?/.test(plainLess)) return false;   // "a window in every bedroom" → batch command
    const nM = l.match(/\b(\d+|a|an|one|single|two|couple(?: of)?|pair(?: of)?|three|four|five|six|seven|eight|nine|ten|twelve|several|few)\s+(?:more\s+|new\s+|extra\s+|big\s+|large\s+|small\s+|double\s+|sliding\s+|french\s+|pocket\s+|picture\s+|wide\s+)*(?:doors?|doorways?|windows?|openings?|arch)/);
    const n = Math.min(24, toNum(nM && nM[1].replace(/ of$/, '')) || 1);
    const r0 = roomInText(l); if (r0 && r0.missing) { say(`I couldn’t find a room called “${esc(r0.missing)}”.`, search(r0.missing, ['room']).slice(0, 4)); return true; }
    const r = r0 || contextOrOnlyRoom(); if (!r) return askWhichRoom(q, l);
    let spans = roomSides(r.f, r.r);
    if (!spans.length) { say(`The ${esc(r.name)} has no walls around it to put a ${kind} in. Draw walls along its edges first.`); return true; }
    const named = [...new Set(Object.keys(SIDE_WORD).filter(w => new RegExp(`\\b${w}(?:ern)?\\b`).test(l)).map(w => SIDE_WORD[w]))];
    const perSide = /\bper (side|wall)\b|\b(each|apiece)$/.test(l);
    const eachSide = sidePhrase.test(l) || perSide;
    const total = /\b(in total|total|altogether|spread|around|distributed)\b/.test(l);
    if (kind === 'window' && !named.length) { const ext = spans.filter(s => s.ext); if (ext.length) spans = ext; }
    // group the spans by side, longest stretch first
    const bySide = {}; for (const s of spans) (bySide[s.side] = bySide[s.side] || []).push(s);
    for (const k in bySide) bySide[k].sort((a, b) => (b.t1 - b.t0) - (a.t1 - a.t0));
    let sides = named.length ? named : eachSide ? SIDE_ORDER.filter(s => bySide[s]) : null;
    const missing = named.filter(s => !bySide[s]);
    if (missing.length) { say(`The ${esc(r.name)} has no wall on its ${missing.map(s => SIDE_NAME[s]).join(' or ')} side${kind === 'window' ? ' that faces outside' : ''}. Its walls are on the ${Object.keys(bySide).map(s => SIDE_NAME[s]).join(', ')}.`); return true; }
    if (eachSide && n > 1 && !perSide && !total && n !== sides.length) {
      // "4 doors from each side" — ask whether that is n per side or n in total
      say(`Do you mean <b>${n} ${kind}s on every side</b> of the ${esc(r.name)} (${n * sides.length} in total), or <b>${n} in total</b> spread around its ${sides.length} sides?`);
      const what = spec !== kind ? `${OPEN_DEF[spec].type} ${kind}s` : `${kind}s`;
      buttons([[`${n} on every side (${n * sides.length})`, `add ${n} ${what} per side in the ${r.name}`], [`${n} in total`, `add ${n} ${what} spread around the ${r.name}`], ['Cancel', () => say('OK, nothing added.')]]);
      return true;
    }
    // work out how many go on each side
    const plan = {};
    if (sides && (perSide || (eachSide && (n === 1 || n === sides.length || !total)))) {
      const k = perSide ? n : eachSide && n === sides.length ? 1 : n; for (const s of sides) plan[s] = k;
    } else if (sides) { const k = total ? n : Math.max(n, sides.length); for (let i = 0; i < k; i++) { const s = sides[i % sides.length]; plan[s] = (plan[s] || 0) + 1; } }   // "a door on the north and south walls" = one on each
    else if (total || n > 1) {                      // spread round the room, longest walls first, exterior first for windows
      const order = SIDE_ORDER.filter(s => bySide[s]).sort((a, b) => (bySide[b][0].t1 - bySide[b][0].t0) - (bySide[a][0].t1 - bySide[a][0].t0));
      for (let i = 0; i < n; i++) { const s = order[i % order.length]; plan[s] = (plan[s] || 0) + 1; }
    } else {                                         // one opening, best wall: exterior for windows, interior for doors
      const pick = spans.slice().sort((a, b) => ((kind === 'door' ? a.ext - b.ext : b.ext - a.ext)) || ((b.t1 - b.t0) - (a.t1 - a.t0)))[0];
      plan[pick.side] = 1; bySide[pick.side] = [pick, ...bySide[pick.side].filter(s => s !== pick)];
    }
    let placed = 0; const done = [];
    edit(() => { for (const [side, k] of Object.entries(plan)) { let left = k;
      for (const s of bySide[side]) { if (left <= 0) break; const p = placeOn(r.f, s, kind, left, spec); placed += p; left -= p; }
      if (k - left > 0) done.push(`${k - left} on the ${SIDE_NAME[side]}`); } });
    if (r.fi !== S.floor) { S.floor = r.fi; refreshFloors(); }
    ASK.last = { kind: 'room', f: r.f, fi: r.fi, r: r.r, name: r.r.name }; ASK.lastRoom = ASK.last; showThing(ASK.last);
    const wanted = Object.values(plan).reduce((a, b) => a + b, 0), nm = `${kind}${placed === 1 ? '' : 's'}`;
    if (!placed) { say(`There’s no free space for ${wanted === 1 ? 'a' : wanted} ${kind}${wanted === 1 ? '' : 's'} there — the walls are too short or already have openings.`); return true; }
    say(`Added ${placed} ${spec !== kind ? esc(OPEN_DEF[spec].type) + ' ' : ''}${nm} to the ${esc(r.name)}: ${done.join(', ')}.${placed < wanted ? ` Only ${placed} of ${wanted} fitted — the rest of the wall is too short or taken.` : ''} Select one to change its size, swing or style.`);
    return true;
  }
  /** best library item for a phrase: highest score, then the one whose name ends in a word you used, then the shortest name */
  function bestLib(text) {
    const T = terms(text), phrase = text.trim();                      // score every library item (search() drops near-misses we want to compare)
    const res = candidates().filter(c => c.kind === 'lib').map(c => Object.assign(c, { score: scoreText(c.text, T, phrase).s })).filter(c => c.score >= 2.5).sort((a, b) => b.score - a.score);
    if (!res.length) return null;
    const top = res[0].score, said = new Set(words(text)), tie = res.filter(c => c.score >= top - .01);
    const tie2 = res.filter(c => c.score >= top - 4.01), extra = c => words(c.L.name).filter(w => !said.has(w)).length;   // 4 = the literal-phrase bonus
    tie2.sort((x, y) => (said.has(y.L.id) - said.has(x.L.id)) || (said.has(sing(words(y.L.name).pop())) - said.has(sing(words(x.L.name).pop()))) || extra(x) - extra(y) || y.score - x.score || x.L.name.length - y.L.name.length);
    return tie2[0];
    return tie[0];
  }
  /** "add 4 chairs to the kitchen", "add a couple of floor lamps", "add a sofa" when there is only one room */
  function countedItems(q, l) {
    const m = l.match(/^(?:add|put|place|insert|i need|i want|give me)\s+(?:a\s+)?(?:(\d+|two|three|four|five|six|seven|eight|nine|ten|twelve|couple of|pair of|few|several)\s+)?(.+?)(?:\s+(?:in|into|to|on|inside)\s+(?:the\s+)?(.+))?$/);
    if (!m) return false;
    const counted = !!m[1], lib = bestLib(m[2]);
    if (!lib || lib.score < 2.5) return false;
    const indoor = P.floors.flatMap(f => f.rooms.filter(r => !r.outdoor));
    if (!counted && (m[3] || indoor.length !== 1)) return false;            // the normal "add a sofa" path asks where
    const n = counted ? Math.min(20, toNum(m[1].replace(/ of$/, '')) || 2) : 1;
    const r = m[3] ? search(m[3], ['room'])[0] : contextOrOnlyRoom();
    if (m[3] && !r) { say(`I couldn’t find a room called “${esc(m[3])}”.`); return true; }
    if (!r) return askWhichRoom(q, l);
    for (let i = 0; i < n; i++) addThing(lib.L, r.r, r.f, r.fi);
    say(n === 1 ? `Added ${article(lib.L.name)} <b>${esc(lib.L.name.toLowerCase())}</b> to the ${esc(r.name)}. Drag it into place or change its size on the right.` : `Added ${n} × ${esc(lib.L.name.toLowerCase())} to the ${esc(r.name)}. They’re placed in free spots — drag them where you like.`); return true;
  }

  /* ---------- the new commands ---------- */
  function extra(q) {
    const l = q.toLowerCase().replace(/[?!.]+$/, '').trim(); let m;
    if (/^help$/.test(l)) { setTimeout(() => say('New: <b>“design a chalet with 3 bedrooms, a sauna and a garage”</b>, “show me 3 layout variants”, “add a door between the kitchen and the hall”, “add a window to every bedroom”, “make it a bit bigger”, “move it 1 m to the left”, “lock the bathroom”, “save this as version B”, “compare versions”, “what did you just change?”, “restore last version”, “delete the whole house” (asks first), plus building questions like “what roof angle is best for snow?”.'), 0); return false; }
    if (openingCmd(q, l) || countedItems(q, l)) return true;

    // generation
    if (/\b(variants?|options|alternatives|layouts)\b/.test(l) && /\b(3|three|some|several|layout|show|give|suggest)\b/.test(l) && !/^(how|where)/.test(l)) {
      const b = briefOf(l), plans = ['A', 'B', 'C'].map(v => genPlan(b, v));
      say(`Three ways to lay out a ${b.beds}-bedroom chalet:<br>` + plans.map((p, i) => `<b>${'ABC'[i]}</b> — ${esc(p.name.split('(')[1].replace(')', ''))}: ${p.floors.length} floor${p.floors.length > 1 ? 's' : ''}, ${fmtArea(areaOf(p))}, ~${fmtMoney(costOf(p), P.settings.currency)}`).join('<br>'));
      buttons(plans.map((p, i) => [`Use ${'ABC'[i]}`, () => proposePlan(p)]));
      return true;
    }
    if ((/^(design|generate|create|make|build|plan|draw|start)( me)?( a| an| my)?\b/.test(l) && /\b(chalet|house|home|cabin|plan|layout)\b/.test(l)) || /^\d+ ?bed(room)?s? (chalet|house|home)/.test(l)) {
      const b = briefOf(l);
      proposePlan(genPlan(b, b.open ? 'A' : null), `It has ${b.beds} bedroom${b.beds > 1 ? 's' : ''}, ${b.baths} bathroom${b.baths > 1 ? 's' : ''}${b.boot ? ', a boot room by the entrance' : ''}${b.sauna ? ', a sauna' : ''}${b.garage ? ', a garage' : ''}${b.office ? ', an office' : ''}.`);
      return true;
    }

    // versions, history, diffs
    if ((m = l.match(/^(?:save|keep|store)(?: this| it| the house| a copy)?(?: as)? (?:a )?(?:version|variant|copy)? ?(.+)?$/)) && /version|variant|copy|as /.test(l)) {
      const name = (m[1] || '').replace(/^(version|variant)\s*/, '').trim(); saveVersion(name ? 'Version ' + name.toUpperCase() : 'Version ' + 'ABCDEFGH'[Object.keys(ASK.versions).length % 8]); return true; }
    if (/^(compare|show|list)( the| my| all)? (versions|variants)$/.test(l)) { compareVersions(); return true; }
    if ((m = l.match(/^(?:switch|go back|change|load|open|restore) (?:to )?(.+)$/)) && ASK.versions[Object.keys(ASK.versions).find(k => k.toLowerCase() === m[1].replace(/^the /, '') || k.toLowerCase() === 'version ' + m[1].replace(/^version /, ''))]) {
      const key = Object.keys(ASK.versions).find(k => k.toLowerCase() === m[1].replace(/^the /, '') || k.toLowerCase() === 'version ' + m[1].replace(/^version /, ''));
      say(`Switch to <b>${esc(key)}</b>? Your current house is replaced (it stays in the snapshots).`);
      buttons([['Switch', () => { commit(); P = validateProject(JSON.parse(JSON.stringify(ASK.versions[key].P))); S.sel = []; afterLoad(true); say(`Now showing ${esc(key)}.`); }], ['Save current first', () => { saveVersion('Version before switch'); ask(q); }], ['Cancel', () => say('OK.')]]);
      return true;
    }
    if (/^(what|which)( did you| have you)?( just)? (change|changed|do|did)|^what changed|^(show|list)( the)? changes|^diff$/.test(l)) {
      say(ASK.lastDiff ? `Last change: ${ASK.lastDiff.join('; ')}.` : 'I haven’t changed anything yet in this session.'); return true; }
    if (/^(restore|go back to|revert to|bring back)( the)? (last|previous) (version|state|snapshot)$|^revert( that| it)?$|^restore$/.test(l)) {
      if (!ASK.snaps.length) { say('There’s no snapshot from me yet — Undo (Ctrl+Z) still works for manual edits.'); return true; }
      commit(); P = validateProject(JSON.parse(ASK.snaps.pop())); S.sel = []; afterLoad(false); changed(); say('Restored the version from before my last change.'); return true;
    }

    // deletes: always proposed, never executed straight away
    if ((m = l.match(/^(?:delete|remove|erase|clear|wipe|get rid of|demolish) (?:the |my )?(.+)$/))) {
      const t = m[1].trim();
      if (/^(whole |entire )?(house|home|chalet|project|everything|all|building|design)$/.test(t)) {
        const C = counts();
        typedConfirm('Delete the whole house?', `This removes <b>${C.floors} level${C.floors > 1 ? 's' : ''}, ${C.rooms} rooms, ${C.doors} doors, ${C.windows} windows and ${C.items} items</b>, leaving one empty floor.`, 'Delete everything',
          () => { commit(); P.floors = [newFloor('Ground floor', 0)]; S.floor = 0; S.sel = []; afterLoad(true); changed(); say('The house is cleared. Say “restore last version” to bring it all back.'); });
        say('That would delete everything, so I’ve opened a confirmation — type the project name there to go ahead.'); return true;
      }
      const fl = P.floors.findIndex(f => t === f.name.toLowerCase() || t.replace(/ floor$/, '') === f.name.toLowerCase().replace(/ floor$/, ''));
      if (fl >= 0 || /^(basement|ground floor|first floor|top floor|upper floor)$/.test(t)) {
        const i = fl >= 0 ? fl : findFloor(t); if (i < 0) return false; const f = P.floors[i];
        if (P.floors.length === 1) { say('That’s the only floor — say “delete the whole house” instead.'); return true; }
        typedConfirm(`Delete ${f.name}?`, `This removes <b>${f.rooms.length} rooms, ${f.openings.filter(o => o.kind === 'door').length} doors and ${f.items.length} items</b> on ${esc(f.name)}. Anything above it stays where it is.`, 'Delete floor',
          () => { commit(); P.floors.splice(P.floors.indexOf(f), 1); S.floor = Math.max(0, Math.min(S.floor, P.floors.length - 1)); S.sel = []; afterLoad(false); changed(); say(`${esc(f.name)} deleted.`); });
        say(`Deleting a floor needs a typed confirmation — I’ve opened it.`); return true;
      }
      if (/^all (?:the )?(?:furniture|items|things)(?: (?:in|from) (?:the )?(.+))?$/.test(t) || /^(?:the )?(.+?) furniture$/.test(t)) {
        const rn = (t.match(/(?:in|from) (?:the )?(.+)$/) || t.match(/^(?:the )?(.+?) furniture$/) || [])[1], r = rn ? search(rn, ['room'])[0] : null;
        if (rn && !r) { say(`I couldn’t find a room called “${esc(rn)}”.`); return true; }
        const where = r ? [[r.f, roomItems(r.f, r.r)]] : P.floors.map(f => [f, f.items.filter(i => i.type !== 'entrance')]), n = where.reduce((s, [, a]) => s + a.length, 0);
        if (!n) { say('There’s nothing to clear.'); return true; }
        say(`This removes <b>${n} item${n > 1 ? 's' : ''}</b>${r ? ' from the ' + esc(r.name) : ' from the whole house'}. Go ahead?`);
        buttons([['Remove them', () => { edit(() => where.forEach(([f, a]) => { const ids = new Set(a.filter(i => !i.locked).map(i => i.id)); f.items = f.items.filter(i => !ids.has(i.id)); })); S.sel = []; onSelection(); say('Cleared. “restore last version” brings them back.'); }], ['Cancel', () => say('OK, nothing removed.')]]);
        return true;
      }
      const room = search(t, ['room'])[0], item = targetItem(t);
      const iScore = item ? (item.score ?? 99) : -1;
      if (room && (!item || room.score > iScore + .5 || t === room.name.toLowerCase())) {
        if (room.r.locked) { say(`The ${esc(room.name)} is locked — say “unlock the ${esc(room.name.toLowerCase())}” first.`); return true; }
        const its = roomItems(room.f, room.r), ds = roomDoors(room.f, room.r);
        showThing(room);
        say(`Delete the <b>${esc(room.name)}</b> (${fmtArea(roomArea(room.r))}) on ${esc(room.f.name)}? Its ${its.length} item${its.length === 1 ? '' : 's'} go too; its walls and ${ds.length} door${ds.length === 1 ? '' : 's'}/window${ds.length === 1 ? '' : 's'} stay so neighbouring rooms keep theirs.`);
        buttons([['Delete room', () => { edit(() => { const f = room.f, ids = new Set(its.filter(i => !i.locked).map(i => i.id)); f.items = f.items.filter(i => !ids.has(i.id)); f.rooms.splice(f.rooms.indexOf(room.r), 1); }); S.sel = []; onSelection(); say(`${esc(room.name)} deleted.`); }],
                 ['Cancel', () => say('OK, nothing deleted.')]]);
        return true;
      }
      if (item) {
        if (item.it.locked) { say(`The ${esc(item.name)} is locked.`); return true; }
        showThing(item);
        say(`Delete the <b>${esc(item.name)}</b> (${esc(whereText(item))})?`);
        buttons([['Delete', () => { edit(() => { const a = item.f.items, i = a.indexOf(item.it); if (i >= 0) a.splice(i, 1); }); S.sel = []; onSelection(); say(`Deleted the ${esc(item.name)}.`); }], ['Cancel', () => say('OK, kept it.')]]);
        return true;
      }
      return false;
    }

    // locks
    if ((m = l.match(/^(lock|unlock|freeze|unfreeze|protect) (?:the )?(.+)$/))) {
      const on = /^(lock|freeze|protect)/.test(m[1]), room = search(m[2], ['room'])[0], item = room ? null : targetItem(m[2]);
      const o = room ? room.r : item ? item.it : null; if (!o) return false;
      edit(() => { o.locked = on; if (room) roomItems(room.f, room.r).forEach(i => i.locked = on); }); renderProps();
      say(on ? `Locked the ${esc((room || item).name)}${room ? ' and everything in it' : ''}. I won’t move, delete or resize ${room ? 'them' : 'it'} until you unlock.` : `Unlocked the ${esc((room || item).name)}.`); return true;
    }

    // connect two rooms with a door
    if ((m = l.match(/^(?:add|put|make|create)(?: a| an)?(?: door| opening| doorway)? (?:between|connecting) (?:the )?(.+?) (?:and|to|with) (?:the )?(.+)$/)) || (m = l.match(/^connect (?:the )?(.+?) (?:to|and|with) (?:the )?(.+)$/))) {
      const a = search(m[1], ['room'])[0], b = search(m[2], ['room'])[0];
      if (!a || !b) { say(`I couldn’t find “${esc(!a ? m[1] : m[2])}”.`); return true; }
      if (a.f !== b.f) { say(`The ${esc(a.name)} and the ${esc(b.name)} are on different floors — they need stairs, not a door.`); return true; }
      let best = null;
      for (const w of a.f.walls) { const L = wallLen(w), [dx, dy] = wallDir(w), lim = (w.thick || 20) / 2 + 8; let t0 = null, t1 = null;
        for (let t = 5; t < L - 5; t += 5) { const x = w.a[0] + dx * t, y = w.a[1] + dy * t; if (edgeDist(a.r.poly, x, y) < lim && edgeDist(b.r.poly, x, y) < lim) { if (t0 === null) t0 = t; t1 = t; } }
        if (t0 !== null && (!best || t1 - t0 > best.t1 - best.t0)) best = { w, t0, t1 }; }
      if (!best || best.t1 - best.t0 < 75) { say(`The ${esc(a.name)} and the ${esc(b.name)} don’t share a long enough wall for a door.`); return true; }
      const o = makeOpening('door'); o.width = Math.min(90, best.t1 - best.t0 - 10); o.wallId = best.w.id;
      const taken = a.f.openings.filter(q => q.wallId === best.w.id);
      if (taken.some(q => q.kind === 'door' && q.t >= best.t0 - 5 && q.t <= best.t1 + 5)) { say(`The ${esc(a.name)} and the ${esc(b.name)} are already connected by a door.`); return true; }
      const spot = [.5, .3, .7, .15, .85].map(k => best.t0 + (best.t1 - best.t0) * k).find(t => t - o.width / 2 >= best.t0 && t + o.width / 2 <= best.t1 && taken.every(q => Math.abs(q.t - t) > (q.width + o.width) / 2 + 10));
      if (spot == null) { say('That wall is already full of openings.'); return true; }
      o.t = spot; edit(() => a.f.openings.push(o)); showThing({ kind: 'opening', f: a.f, fi: a.fi, o, name: 'door' });
      say(`Added a ${fmtLen(o.width)} door between the ${esc(a.name)} and the ${esc(b.name)}. Select it to change the swing or type.`); return true;
    }

    // batch: "... to every bedroom"
    if ((m = l.match(/^add (?:a |an |one )?(.+?) (?:to|in|into) (?:every|each|all(?: the)?|all of the) (.+?)$/))) {
      const what = m[1], kind = sing(m[2].replace(/s$/, '').trim()).replace(/^room$/, '');
      const rooms = P.floors.flatMap((f, fi) => f.rooms.filter(r => !r.outdoor && (!kind || r.name.toLowerCase().includes(kind))).map(r => ({ f, fi, r })));
      if (!rooms.length) { say(`I didn’t find any ${esc(m[2])}.`); return true; }
      say(`Adding ${esc(what)} to ${rooms.length} room${rooms.length > 1 ? 's' : ''}: ${rooms.map(x => esc(x.r.name)).join(', ')}.`);
      if (/^(window|door)s?$/.test(what)) { for (const x of rooms) _answer(`add a ${what.replace(/s$/, '')} to the ${x.r.name}`); return true; }
      const lib = search(what, ['lib'])[0]; if (!lib) { say(`I don’t have “${esc(what)}” in the library.`); return true; }
      for (const x of rooms) addThing(lib.L, x.r, x.f, x.fi);
      say(`Done — ${rooms.length} × ${esc(lib.L.name.toLowerCase())}. “restore last version” removes all of them at once.`); return true;
    }

    // relative edits on furniture
    if ((m = l.match(/^(?:make|set) (?:the )?(.+?) (?:a (?:bit|little|touch)|slightly|a tad) (bigger|larger|smaller|wider|narrower|taller|shorter|longer|deeper)$/)) ||
        (m = l.match(/^(?:make|set) (?:the )?(.+?) (twice|half|three times) as (big|large|wide|long|tall|high|deep)$/))) {
      const c = targetItem(m[1]); if (!c) return false;
      const it = c.it; if (it.locked) { say(`The ${esc(it.name)} is locked.`); return true; }
      const rel = /twice|three|half/.test(m[2]), k = rel ? { twice: 2, half: .5, 'three times': 3 }[m[2]] : /bigger|larger|wider|taller|longer|deeper/.test(m[2]) ? 1.1 : .9;
      const dim = rel ? m[3] : m[2], keys = /big|large|bigger|larger|smaller/.test(dim) ? ['w', 'd', 'h'] : /wide|wider|narrower|long|longer/.test(dim) ? ['w'] : /tall|high|taller|shorter/.test(dim) ? ['h'] : ['d'];
      edit(() => keys.forEach(kk => it[kk] = Math.max(1, Math.round(it[kk] * k)))); ASK.last = c; renderProps(); showThing(c);
      say(`The ${esc(it.name)} is now ${fmtLen(it.w)} × ${fmtLen(it.d)} × ${fmtLen(it.h)}.`); return true;
    }
    if ((m = l.match(/^(?:move|shift|slide|nudge|push) (?:the )?(.+?) (?:by )?(\d+(?:\.\d+)?)\s*(cm|m|mm|ft|feet|in|inches)? (?:to the |towards the |to |)(left|right|up|down|north|south|east|west|forward|back)$/))) {
      const c = targetItem(m[1]); if (!c) return false; const it = c.it;
      if (it.locked) { say(`The ${esc(it.name)} is locked.`); return true; }
      const d = toCm(m[2], m[3] || 'cm'), dir = { left: [-1, 0], west: [-1, 0], right: [1, 0], east: [1, 0], up: [0, -1], north: [0, -1], back: [0, -1], down: [0, 1], south: [0, 1], forward: [0, 1] }[m[4]];
      edit(() => { it.x += dir[0] * d; it.y += dir[1] * d; }); ASK.last = c; renderProps(); showThing(c);
      say(`Moved the ${esc(it.name)} ${fmtLen(d)} ${m[4]}${/left|right|up|down/.test(m[4]) ? ' on the plan' : ''}.`); return true;
    }

    // knowledge questions
    return faq(l);
  }
})();
