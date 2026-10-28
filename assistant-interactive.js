/* =====================================================================
   INTERACTIVE ASSISTANT — add-on for the Chalet Home Designer
   ---------------------------------------------------------------------
   HOW TO INSTALL: paste this whole block INSIDE the <script type="module">
   of the designer, just ABOVE the last line:
       try { boot(); } catch (e) { ...
   It reuses the assistant's own functions (search, answer, say, addThing…)
   and upgrades it with:
     • memory — "make it bigger", "add a lamp there", "and the fridge?"
     • clarifying questions — "Where should the sofa go?", "Which one?"
     • clickable follow-ups after every answer + an Undo for each change
     • inline controls — colour swatches and a live size slider
     • confirmation before furnishing a whole room
     • chained requests — "add a sofa and a TV to the living room, then make it night"
     • reacts when you select something on the plan while the panel is open
     • typing dots, ↑/↓ for earlier questions, optional voice input 🎤
   ===================================================================== */
(() => {
  Object.assign(ASK, { last: null, lastRoom: null, verb: null, hist: [], hi: -1, busy: false, selKey: '', selT: 0 });
  try { ASK.hist = JSON.parse(localStorage.getItem('chalet-ask-hist') || '[]'); } catch (_) {}

  /* ---------- styles ---------- */
  const st = document.createElement('style');
  st.textContent = `
    .msg.typing{display:flex;gap:4px;padding:11px 13px}
    .msg.typing i{width:6px;height:6px;border-radius:50%;background:var(--muted);animation:askdot 1s infinite}
    .msg.typing i:nth-child(2){animation-delay:.15s}.msg.typing i:nth-child(3){animation-delay:.3s}
    @keyframes askdot{0%,80%,100%{opacity:.25;transform:none}40%{opacity:1;transform:translateY(-3px)}}
    .achips{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
    .achips button{font-size:11.5px;padding:4px 9px;border-radius:999px;border:1px solid var(--line);background:var(--panel)}
    .achips button:hover{border-color:var(--accent)}
    .achips .sw{width:20px;height:20px;padding:0;border-radius:50%}
    .actl{display:flex;align-items:center;gap:7px;margin-top:8px;font-size:11.5px;color:var(--muted)}
    .actl input{flex:1;accent-color:var(--accent)}
    #askMic.on{background:var(--danger);color:#fff;border-color:var(--danger)}`;
  document.head.appendChild(st);

  const log = () => $('#askLog');
  const lastMsg = () => { const l = log().lastElementChild; return l && l.classList.contains('ai') && !l.classList.contains('typing') ? l : null; };
  const keyOf = c => c ? c.kind + ':' + ((c.it || c.r || {}).id || '') : '';
  const SW = ['red', 'navy', 'sage', 'mustard', 'terracotta', 'charcoal', 'cream'];

  /** re-find a remembered thing in the current model (undo replaces every object) */
  function alive(c) {
    if (!c || !c.f) return null;
    const fi = P.floors.findIndex(f => f.id === c.f.id); if (fi < 0) return null; const f = P.floors[fi];
    if (c.kind === 'item') { const it = f.items.find(i => i.id === c.it.id); return it ? { kind: 'item', f, fi, it, name: it.name } : null; }
    if (c.kind === 'room') { const r = f.rooms.find(q => q.id === c.r.id); return r ? { kind: 'room', f, fi, r, name: r.name } : null; }
    return null;
  }
  function remember(c) {
    if (!c || (c.kind !== 'item' && c.kind !== 'room')) return;
    ASK.last = c;
    if (c.kind === 'room') ASK.lastRoom = c;
    else { const r = roomOfPoint(c.f, c.it.x, c.it.y); if (r) ASK.lastRoom = { kind: 'room', f: c.f, fi: c.fi, r, name: r.name }; }
  }

  /* ---------- remember whatever the assistant shows, walks to or adds ---------- */
  const _showThing = showThing, _walkToThing = walkToThing, _addThing = addThing, _onSelection = onSelection;
  showThing = c => { remember(c); return _showThing(c); };
  walkToThing = c => { remember(c); return _walkToThing(c); };
  addThing = (L, room, f, fi) => { const it = _addThing(L, room, f, fi); remember({ kind: 'item', f: F(), fi: S.floor, it, name: it.name }); return it; };

  /* ---------- chips & inline controls ---------- */
  function chips(items, host = lastMsg()) {
    if (!host || !items.length) return;
    const row = document.createElement('div'); row.className = 'achips';
    for (const [label, fn, color] of items) {
      const b = document.createElement('button');
      if (color) { b.className = 'sw'; b.style.background = color; b.title = label; b.setAttribute('aria-label', label); } else b.textContent = label;
      b.onclick = () => {
        if (typeof fn === 'string') return ask(fn);
        ASK.busy = true; const u0 = H.undo.length, k0 = keyOf(ASK.last), n0 = log().children.length;
        try { fn(); } catch (e) { console.error(e); say('Sorry — that didn’t work.'); }
        after(u0, k0, n0); setTimeout(() => ASK.busy = false, 60);
      };
      row.appendChild(b);
    }
    host.appendChild(row); log().scrollTop = log().scrollHeight;
  }
  function focus(c) { if (c.fi !== S.floor) { S.floor = c.fi; refreshFloors(); } selectOnly(c.kind, (c.it || c.r).id); }
  function resize(c0, k) {
    const c = alive(c0); if (!c) return;
    edit(() => { const it = c.it; it.w = Math.round(it.w * k); it.d = Math.round(it.d * k); it.h = Math.round(it.h * k); });
    renderProps(); const it = alive(c0).it; say(`The ${esc(it.name)} is now ${fmtLen(it.w)} × ${fmtLen(it.d)} × ${fmtLen(it.h)}.`);
  }
  function ctxItems(c0) {
    const c = alive(c0); if (!c) return [];
    if (c.kind === 'item') {
      const it = c.it, room = roomOfPoint(c.f, it.x, it.y);
      return [
        ['↻ Rotate', () => { focus(c); rotateSelection(90); renderProps(); say(`Rotated the ${esc(it.name)}.`); }],
        ['Bigger', () => resize(c, 1.15)], ['Smaller', () => resize(c, .87)],
        ['Walk there', () => { walkToThing(c); if (S.view === 'walk') closeAsk(); }],
        ...(room ? [[`More for the ${room.name}`, `what should I put in the ${room.name}`]] : []),
        ['Delete', () => { focus(c); deleteSelection(); say(`Deleted the ${esc(it.name)}.`); }],
        ...SW.map(k => [k, () => { const a = alive(c); if (!a) return; edit(() => a.it.color = COLORS[k]); renderProps(); say(`The ${esc(it.name)} is now ${k}.`); }, COLORS[k]]),
      ];
    }
    const r = c.r, on = r.lights ? r.lights === 'on' : lightsOn();
    return [
      ['What’s in it?', `what's in the ${r.name}`], ['Ideas for it', `what should I put in the ${r.name}`], ['Furnish it', `furnish the ${r.name}`],
      [`Lights ${on ? 'off' : 'on'}`, `turn lights ${on ? 'off' : 'on'} in the ${r.name}`], ['Add a window', `add a window to the ${r.name}`],
      ['Walk there', () => { walkToThing(c); if (S.view === 'walk') closeAsk(); }],
      ...SW.map(k => [`Paint the walls ${k}`, `paint the ${r.name} walls ${k}`, COLORS[k]]),
    ];
  }
  function sizeCtl(c0, host) {
    const c = alive(c0); if (!c || !host) return;
    const base = { w: c.it.w, d: c.it.d, h: c.it.h }, box = document.createElement('label'); box.className = 'actl';
    box.innerHTML = `Size <input type="range" min="50" max="200" step="5" value="100"><b>100%</b>`;
    const r = box.querySelector('input'), b = box.querySelector('b'); let started = false;
    r.oninput = () => { const cur = alive(c0); if (!cur) return; if (!started) { commit(); started = true; } const k = r.value / 100;
      Object.assign(cur.it, { w: Math.round(base.w * k), d: Math.round(base.d * k), h: Math.round(base.h * k) }); b.textContent = r.value + '%'; changed({ live: true }); };
    r.onchange = () => { started = false; changed(); renderProps(); };
    host.appendChild(box);
  }
  /** after an answer: Undo for changes, follow-ups for the thing we're talking about */
  function after(u0, k0, n0) {
    const m = lastMsg(); if (!m || log().children.length <= n0 || m.querySelector('.achips')) return;
    const c = alive(ASK.last), fresh = c && keyOf(c) !== k0, edited = H.undo.length > u0, items = [];
    if (edited) items.push(['↶ Undo', () => { undo(); say('Undone.'); }]);
    if (c && (fresh || edited)) items.push(...ctxItems(c));
    if (!items.length && /couldn’t|don’t have|not sure|isn’t one/.test(m.textContent))
      items.push(['What can you do?', 'help'], ['List rooms', 'list rooms'], ['Describe the house', 'describe the house']);
    chips(items, m);
    if (c && fresh && c.kind === 'item') sizeCtl(c, m);
  }

  /* ---------- understanding follow-ups ---------- */
  const VSTART = /^(make|rotate|turn|spin|move|put|bring|delete|remove|paint|colou?r|rename|walk to|go to|take me to|resize|set|show|how much|how big is|what'?s in)\b/i;
  function resolve(q) {
    let s = q.trim(); const l = s.toLowerCase(), c = alive(ASK.last), room = alive(ASK.lastRoom);
    const m = l.match(/^(?:and|what about|how about|also)\s+(?:the\s+|a\s+|an\s+)?(.+?)\??$/);
    if (m && ASK.verb) return `${ASK.verb} ${m[1]}`;
    if (c && VSTART.test(l) && !/^(make it|is it) (night|day|dark|morning|evening|noon|sunny)|^(undo|redo) (it|that)/.test(l))
      s = s.replace(/\b(this one|that one|it|that|this|them)\b/i, 'the ' + c.name);
    if (room) s = s.replace(/\s+(?:in\s+)?(?:there|here|in this room|in that room)\s*[?.!]*$/i, ` to the ${room.name}`);
    return s;
  }
  const V = '(?:add|make|paint|turn|switch|rotate|move|delete|remove|open|close|shut|set|walk|go|show|furnish|rename|change|put|take)\\b';
  function splitChain(q) {
    const m = q.match(/^(add|put|place)\s+(.+?)\s+and\s+(?!then\b)(.+?)(\s+(?:to|in|into|on)\s+.+)?$/i);
    if (m && !/between|connect/i.test(q) && !new RegExp('^' + V, 'i').test(m[3])) return [`${m[1]} ${m[2]}${m[4] || ''}`, `${m[1]} ${m[3]}${m[4] || ''}`];
    if (/\b(between|connect)\b/i.test(q) && !/\bthen\b|;/.test(q)) return [q];
    return q.split(new RegExp(`\\s*(?:;|,?\\s+and then\\s+|,?\\s+then\\s+|,?\\s+and\\s+(?=${V}))\\s*`, 'i')).filter(Boolean);
  }

  /* ---------- asking back instead of guessing ---------- */
  function clarify(q) {
    const l = q.toLowerCase().replace(/[?!.]+$/, '').trim(); let m;
    // "add a lamp" with no place → where?
    if ((m = l.match(/^(?:add|put|place|insert)\s+(?:an?\s+|the\s+|some\s+|another\s+|one\s+)?(.+)$/)) && !/\s(?:in|into|to|on|inside|between|connecting)\s/.test(` ${m[1]} `)) {
      const what = m[1], rooms = F().rooms.filter(r => !r.outdoor), room = alive(ASK.lastRoom);
      if (/^(door|window)s?$/.test(what)) {
        say(`Which room should get the ${what.replace(/s$/, '')}?`);
        chips(rooms.slice(0, 12).map(r => [r.name, `add a ${what.replace(/s$/, '')} to the ${r.name}`])); return true;
      }
      const lib = search(what, ['lib'])[0]; if (!lib) return false;
      say(`Where should the <b>${esc(lib.L.name.toLowerCase())}</b> go?`);
      chips([...(room ? [[`★ ${room.name}`, `add ${what} to the ${room.name}`]] : []),
             ...rooms.filter(r => !room || r.id !== room.r.id).slice(0, 10).map(r => [r.name, `add ${what} to the ${r.name}`]),
             ['I’ll click on the plan', () => { closeAsk(); armPlacing(lib.L.id); }]]);
      return true;
    }
    // "delete the nightstand" when there are several → which one?
    if ((m = l.match(/^(?:delete|remove|get rid of) (?:the )?(.+)$/)) && !/roof/.test(m[1])) {
      const hits = search(m[1], ['item']);
      if (hits.length > 1 && hits[1].score >= hits[0].score - .5) {
        const same = hits.filter(h => h.score >= hits[0].score - .5).slice(0, 8);
        say(`I found ${same.length} — which one should go?`, same);
        chips([...same.map(h => [`${h.name} · ${whereText(h)}`, () => { focus(h); deleteSelection(); say(`Deleted the ${esc(h.name)} (${esc(whereText(h))}).`); }]),
               [`All ${same.length}`, () => { edit(() => same.forEach(h => { const a = h.f.items, i = a.indexOf(h.it); if (i >= 0) a.splice(i, 1); })); S.sel = []; onSelection(); say(`Deleted all ${same.length}.`); }],
               ['Cancel', () => say('OK, nothing deleted.')]]);
        return true;
      }
    }
    // "furnish bedroom 4" → confirm (and ask the room type if unclear)
    if ((m = l.match(/^(?:furnish|decorate|fill|fit out|set up) (?:the )?(.+?)$/)) && !/ as /.test(l)) {
      const r = search(m[1], ['room'])[0]; if (!r) return false;
      const kind = roomKind(r.name);
      if (!kind) {
        say(`What kind of room should the ${esc(r.name)} be?`);
        chips(['bedroom', 'living', 'kitchen', 'dining', 'office', 'bathroom', 'laundry', 'gym', 'cinema', 'games', 'garage'].map(k => [k, `furnish the ${r.name} as a ${k}`]));
        return true;
      }
      showThing(r);
      say(`For the ${esc(r.name)} I’d add: ${ROOM_SETS[kind].map(id => esc(LIB[id].name)).join(', ')}. Go ahead?`);
      chips([['✓ Furnish it', `furnish the ${r.name} as a ${kind}`], ['Let me pick', `what should I put in the ${r.name}`], ['Cancel', () => say('OK, nothing changed.')]]);
      return true;
    }
    return false;
  }

  /* ---------- the conversation loop ---------- */
  function runQuery(q) {
    const parts = splitChain(q.trim());
    if (parts.length > 1) say(`Doing ${parts.length} things: ${parts.map(p => '“' + esc(p) + '”').join(', ')}.`);
    for (const p of parts) {
      const r = resolve(p), l = r.toLowerCase();
      const vm = l.match(/^(where (?:is|are)(?: the)?|walk to(?: the)?|go to(?: the)?|how many|how big is(?: the)?|what'?s in(?: the)?|add(?: a| an)?|delete(?: the)?|show(?: me)?(?: the)?|find(?: the)?|how much (?:is|does)(?: the)?)\s/);
      if (vm) ASK.verb = vm[1];
      if (r !== p) say(`<span class="muted">→ ${esc(r)}</span>`);
      const u0 = H.undo.length, k0 = keyOf(ASK.last), n0 = log().children.length;
      if (!clarify(r)) answer(r);
      after(u0, k0, n0);
    }
    if (/^help$/i.test(q.trim())) say('Tips: I remember what we talk about — say “make <b>it</b> bigger”, “add a lamp <b>there</b>” or “<b>and</b> the fridge?”. Chain requests with “and” / “then”. Press <kbd>↑</kbd> for earlier questions' + (window.SpeechRecognition || window.webkitSpeechRecognition ? ', or 🎤 to speak.' : '.'));
  }
  ask = q => {
    addMsg('me', esc(q));
    ASK.hist = [...ASK.hist.filter(x => x !== q), q].slice(-50); ASK.hi = -1;
    try { localStorage.setItem('chalet-ask-hist', JSON.stringify(ASK.hist)); } catch (_) {}
    const d = document.createElement('div'); d.className = 'msg ai typing'; d.innerHTML = '<i></i><i></i><i></i>';
    log().appendChild(d); log().scrollTop = log().scrollHeight; ASK.busy = true;
    setTimeout(() => {
      d.remove();
      try { runQuery(q); } catch (e) { console.error(e); say('Sorry — something went wrong answering that.'); }
      finally { setTimeout(() => ASK.busy = false, 60); }
    }, 250 + Math.min(450, q.length * 6));
  };

  /* ---------- react to what you select on the plan or in 3D ---------- */
  onSelection = () => {
    _onSelection();
    if (ASK.busy || !$('#ask').classList.contains('on')) return;
    clearTimeout(ASK.selT); ASK.selT = setTimeout(reactSel, 350);
  };
  function reactSel() {
    if (ASK.busy) return;
    const objs = selectedObjs(); if (objs.length !== 1) return;
    const { s, o } = objs[0]; if (s.k !== 'item' && s.k !== 'room') return;
    if (ASK.selKey === s.k + o.id) return; ASK.selKey = s.k + o.id;
    const c = s.k === 'item' ? { kind: 'item', f: F(), fi: S.floor, it: o, name: o.name } : { kind: 'room', f: F(), fi: S.floor, r: o, name: o.name };
    remember(c);
    say(`You selected <b>${esc(o.name)}</b>${s.k === 'room' ? ' · ' + fmtArea(roomArea(o)) : ''}. What would you like to do with it?`);
    chips(ctxItems(c)); if (s.k === 'item') sizeCtl(c, lastMsg());
  }

  /* ---------- ↑ / ↓ history ---------- */
  $('#askInput').addEventListener('keydown', e => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const h = ASK.hist; if (!h.length) return; e.preventDefault();
    if (e.key === 'ArrowUp') ASK.hi = ASK.hi < 0 ? h.length - 1 : Math.max(0, ASK.hi - 1);
    else ASK.hi = ASK.hi < 0 || ASK.hi + 1 >= h.length ? -1 : ASK.hi + 1;
    e.target.value = ASK.hi < 0 ? '' : h[ASK.hi];
  });

  /* ---------- voice input (Chrome, Edge, Safari) ---------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    const b = document.createElement('button'); b.type = 'button'; b.id = 'askMic'; b.className = 'btn'; b.title = 'Speak your question'; b.textContent = '🎤';
    $('#askForm').insertBefore(b, $('#askForm').lastElementChild);
    let rec = null;
    b.onclick = () => {
      if (rec) return rec.stop();
      rec = new SR(); rec.lang = navigator.language || 'en-US'; rec.interimResults = true;
      rec.onresult = e => { const t = [...e.results].map(r => r[0].transcript).join(''); $('#askInput').value = t;
        if (e.results[e.results.length - 1].isFinal) { $('#askInput').value = ''; ask(t); } };
      rec.onerror = () => toast('Voice input is not available here');
      rec.onend = () => { rec = null; b.classList.remove('on'); };
      b.classList.add('on'); rec.start();
    };
  }
})();
