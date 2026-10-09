import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = `${await readFile(new URL('../src/core.js', import.meta.url), 'utf8')}\n${await readFile(new URL('../src/app.js', import.meta.url), 'utf8')}`;
// Read the configured address without mounting; all requests below are manual mocks.
const serviceBase = vm.runInNewContext(`${source}\nTargetListCore.serviceUrl(CONFIG.serviceUrl);`, {
  URL, document: { getElementById: () => true },
});
const NOW = Date.parse('2026-10-09T12:00:00Z');
const KEY = 'AbCdEfGh12345678';
const SESSION = 'opaque-session-token';
const player = {
  id: 12345, name: 'Allowed Player', faction: { id: 111, name: 'Allowed Faction' },
  battleStats: { strength: 250_000, defense: 250_000, speed: 250_000, dexterity: 250_000, total: 1_000_000 },
};
const target = {
  id: 98765, name: 'Target Player', faction: { id: 222, name: 'Target Faction' },
  estimatedStats: 500_000, estimateUpdatedAt: NOW / 1000 - 3600, estimateSource: 'FFScouter',
  status: { state: 'Okay' }, lastAction: NOW / 1000 - 60,
};

// A small DOM implements just the standard operations this userscript uses.
// Network responses stay manual so tests can deliver revoked or stale requests.
class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.listeners = new Map();
    this.attributes = new Map(); this.style = {}; this.value = ''; this.textContent = '';
    this.activeElement = null;
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(callback);
  }
  attachShadow() { return this.shadow = new Element('shadow-root'); }
  get lastChild() { return this.children.at(-1); }
  emit(type, additions = {}) {
    const event = { key: '', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...additions };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
}
function descendants(element) {
  return [element, ...element.children.flatMap(child => typeof child === 'object' ? descendants(child) : [])];
}
function textContent(element) {
  return [element.textContent, ...element.children.map(child => typeof child === 'object' ? textContent(child) : String(child))].join(' ');
}
async function flush() { for (let index = 0; index < 12; index++) await Promise.resolve(); }

function fixture(saved = null) {
  let clock = NOW;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  const body = new Element('body'); const requests = []; const storage = new Map(); const writes = []; const timers = []; const timeouts = new Map();
  let nextTimer = 1;
  const storageKey = `targetlist.session.${serviceBase}`;
  if (saved) storage.set(storageKey, saved);
  const context = vm.createContext({
    URL, Intl, Date: Clock, console,
    document: { body, getElementById: id => descendants(body).find(element => element.id === id), createElement: tag => new Element(tag) },
    GM_xmlhttpRequest: options => { requests.push(options); },
    GM_getValue: (key, fallback) => storage.get(key) ?? fallback,
    GM_setValue: (key, value) => { storage.set(key, value); writes.push(value); },
    GM_deleteValue: key => storage.delete(key),
    setInterval: callback => { timers.push(callback); },
    setTimeout: callback => { const id = nextTimer++; timeouts.set(id, callback); return id; },
    clearTimeout: id => timeouts.delete(id),
  });
  vm.runInContext(source, context);
  const root = body.children[0].shadow;
  function find(predicate) { const result = descendants(root).find(predicate); assert.ok(result, 'expected control exists'); return result; }
  function button(label) { return find(element => element.tagName === 'BUTTON' && element.textContent === label); }
  function response(request, data, status = 200) {
    request.onload({ status, responseText: JSON.stringify(data), finalUrl: request.url });
  }
  async function signIn() {
    const input = find(element => element.tagName === 'INPUT' && element.type === 'password'); input.value = KEY;
    find(element => element.tagName === 'FORM').emit('submit');
    const login = requests.at(-1);
    response(login, { token: SESSION, expiresAt: new Date(NOW + 3_600_000).toISOString(), player });
    await flush();
    response(requests.at(-1), { player, targets: [target], warnings: [], generatedAt: new Date(NOW).toISOString() });
    await flush();
    return login;
  }
  return { root, requests, storage, writes, storageKey, timers, timeouts, find, button, response, signIn, text: () => textContent(root), setNow: value => { clock = value; } };
}

test('invalid key input stays local and the password field is cleared on submission', async () => {
  const app = fixture(); const input = app.find(element => element.type === 'password'); input.value = 'bad-key';
  const event = app.find(element => element.tagName === 'FORM').emit('submit');
  await flush();
  assert.equal(event.defaultPrevented, true);
  assert.equal(input.value, '');
  assert.equal(app.requests.length, 0);
  assert.match(app.text(), /Enter a 16-character Torn Limited API key/);
  assert.equal(app.storage.size, 0);
});

test('login posts the key once, stores only the session token, and authorizes target requests', async () => {
  const app = fixture(); const login = await app.signIn();
  assert.equal(login.method, 'POST');
  assert.equal(login.url, `${serviceBase}/api/session`);
  assert.deepEqual(JSON.parse(login.data), { apiKey: KEY });
  assert.equal(login.headers.Authorization, undefined);
  assert.equal(login.anonymous, true);
  assert.equal(login.redirect, 'error', 'the key body must not follow redirects');
  assert.equal(app.requests[1].headers.Authorization, `Bearer ${SESSION}`);
  assert.equal(app.requests[1].data, undefined);
  assert.equal(app.writes.length, 1);
  assert.equal(app.writes[0].token, SESSION);
  assert.deepEqual(Object.keys(app.writes[0]).sort(), ['expiresAt', 'token']);
  assert.equal(JSON.stringify([...app.storage.values()]).includes(KEY), false);
  assert.match(app.text(), /Allowed Player \[12345\]/);
  assert.match(app.text(), /Target Player \[98765\]/);
  assert.equal(descendants(app.root).some(element => element.className === 'attack'), false, 'cached Okay status has no attack link');
});

test('a stored session verifies authorization before displaying any targets', async () => {
  const app = fixture({ token: SESSION, expiresAt: new Date(NOW + 3_600_000).toISOString() });
  assert.equal(app.requests.length, 0);
  app.button('◎ Target list').emit('click');
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].headers.Authorization, `Bearer ${SESSION}`);
  assert.ok(app.requests[0].url.endsWith('/api/targets'));
  app.response(app.requests[0], { error: { code: 'FACTION_NOT_ALLOWED', message: 'Your faction is no longer allowed.' } }, 403);
  await flush();
  assert.equal(app.storage.size, 0);
  assert.match(app.text(), /Your faction is no longer allowed/);
  assert.equal(descendants(app.root).some(element => element.className === 'card'), false);
});

test('a concurrent login cannot strand a restored session in the loading state', async () => {
  const app = fixture({ token: SESSION, expiresAt: new Date(NOW + 3_600_000).toISOString() });
  app.button('◎ Target list').emit('click'); const restoring = app.requests.at(-1);
  // A form may remain during restoration, but it must not start a competing login.
  const form = descendants(app.root).find(element => element.tagName === 'FORM');
  if (form) {
    app.find(element => element.type === 'password').value = KEY;
    form.emit('submit');
  }
  await flush();
  assert.equal(app.requests.length, 1, 'restoration blocks a concurrent login request');
  app.response(restoring, { player, targets: [target], warnings: [] });
  await flush();
  assert.match(app.text(), /Target Player \[98765\]/);
  assert.equal(app.button('Refresh list').disabled, false);
});

test('expired saved credentials are removed before a request is made', () => {
  const app = fixture({ token: SESSION, expiresAt: new Date(NOW - 1).toISOString() });
  app.button('◎ Target list').emit('click');
  assert.equal(app.requests.length, 0);
  assert.equal(app.storage.size, 0);
});

test('an in-flight status response cannot restore targets after sign out', async () => {
  const app = fixture(); await app.signIn();
  app.button('Check status').emit('click'); const statusRequest = app.requests.at(-1);
  app.button('Sign out').emit('click'); const logoutRequest = app.requests.at(-1);
  assert.equal(logoutRequest.method, 'DELETE');
  assert.equal(logoutRequest.headers.Authorization, `Bearer ${SESSION}`);
  assert.equal(app.storage.size, 0);
  app.response(statusRequest, { id: target.id, status: { state: 'Okay' }, checkedAt: new Date(NOW).toISOString() });
  app.response(logoutRequest, { ok: true });
  await flush();
  assert.match(app.text(), /Torn Limited API key/);
  assert.equal(descendants(app.root).some(element => element.className === 'attack' || element.className === 'card'), false);
});

test('revocation or a faction change during a status check clears the pool and session', async () => {
  for (const code of ['SESSION_REVOKED', 'FACTION_CHANGED']) {
    const app = fixture(); await app.signIn();
    app.button('Check status').emit('click');
    app.response(app.requests.at(-1), { error: { code, message: 'Session no longer authorized.' } }, 403);
    await flush();
    assert.equal(app.storage.size, 0, code);
    assert.match(app.text(), /Session no longer authorized/);
    assert.match(app.text(), /Torn Limited API key/);
    assert.equal(descendants(app.root).some(element => element.className === 'card'), false);
  }
});

test('a friendly-target denial blocks the attack while retaining a valid player session', async () => {
  const app = fixture(); await app.signIn();
  app.button('Check status').emit('click');
  app.response(app.requests.at(-1), { error: { code: 'FRIENDLY_TARGET', message: 'This target is friendly.' } }, 403);
  await flush();
  assert.equal(app.storage.get(app.storageKey).token, SESSION);
  assert.match(app.text(), /Allowed Player \[12345\]/);
  assert.match(app.text(), /This target is friendly/);
  assert.equal(descendants(app.root).some(element => element.className === 'attack'), false);
});

test('attack clicks revalidate live status expiry even before the next display refresh', async () => {
  const app = fixture(); await app.signIn();
  app.button('Check status').emit('click');
  app.response(app.requests.at(-1), { id: target.id, status: { state: 'Okay' }, checkedAt: new Date(NOW).toISOString() });
  await flush();
  const attack = app.find(element => element.className === 'attack');
  assert.equal(attack.emit('click').defaultPrevented, false);
  app.setNow(NOW + 60_000);
  assert.equal(attack.emit('click').defaultPrevented, true);
  assert.match(app.text(), /Check this target’s status again/);
  assert.equal(descendants(app.root).some(element => element.className === 'attack'), false);
});

test('middle clicks also revalidate an expired status check', async () => {
  const app = fixture(); await app.signIn();
  app.button('Check status').emit('click');
  app.response(app.requests.at(-1), { id: target.id, status: { state: 'Okay' }, checkedAt: new Date(NOW).toISOString() });
  await flush();
  const attack = app.find(element => element.className === 'attack');
  app.setNow(NOW + 60_000);
  assert.equal(attack.emit('auxclick', { button: 1 }).defaultPrevented, true);
  assert.equal(descendants(app.root).some(element => element.className === 'attack'), false);
});

test('the status-expiry timer removes attack links even while a control has focus', async () => {
  const app = fixture(); await app.signIn(); app.button('◎ Target list').emit('click');
  app.button('Check status').emit('click');
  app.response(app.requests.at(-1), { id: target.id, status: { state: 'Okay' }, checkedAt: new Date(NOW).toISOString() });
  await flush();
  app.root.activeElement = app.find(element => element.className === 'attack');
  app.setNow(NOW + 60_000); app.timers[0]();
  assert.equal(descendants(app.root).some(element => element.className === 'attack'), false);
  assert.match(app.text(), /Status needs checking/);
});

test('a forced-fetch timeout unblocks login and ignores a late successful response', async () => {
  const app = fixture(); const input = app.find(element => element.type === 'password'); input.value = KEY;
  app.find(element => element.tagName === 'FORM').emit('submit');
  const login = app.requests.at(-1);
  assert.equal(app.timeouts.size, 1);
  [...app.timeouts.values()][0]();
  await flush();
  assert.match(app.text(), /timed out/);
  assert.equal(app.button('Sign in').disabled, false);
  app.response(login, { token: SESSION, expiresAt: new Date(NOW + 3_600_000).toISOString(), player });
  await flush();
  assert.equal(app.storage.size, 0);
  assert.equal(app.requests.length, 1);
  assert.match(app.text(), /Torn Limited API key/);
});

test('the idle timer clears expired sessions while the panel is closed', async () => {
  const app = fixture(); await app.signIn();
  app.setNow(NOW + 3_600_000);
  app.timers[0]();
  assert.equal(app.storage.size, 0);
  assert.match(app.text(), /Session expired/);
  assert.equal(descendants(app.root).some(element => element.className === 'card'), false);
});

function suggestion(overrides = {}) {
  return { id: '00000000-0000-4000-8000-000000000001', type: 'player', targetId: 45678,
    targetName: 'Suggested Player', comment: 'Inactive player for chains.', status: 'pending',
    suggestedBy: { id: player.id, name: player.name, faction: player.faction }, createdAt: new Date(NOW).toISOString(),
    reviewedBy: null, reviewedAt: null, ...overrides };
}
async function openSuggestions(app, data = { canReview: false, suggestions: [], nextOffset: null }) {
  app.button('Suggestions').emit('click'); const request = app.requests.at(-1);
  assert.equal(request.url, `${serviceBase}/api/suggestions?view=pending&offset=0`);
  app.response(request, data); await flush(); return request;
}
function fillSuggestion(app, { type = 'player', targetId = '45678', comment = 'Useful chain target.' } = {}) {
  const typeInput = app.find(element => element.attributes.get('aria-label') === 'Suggestion type');
  typeInput.value = type; typeInput.emit('change');
  const idInput = app.find(element => element.attributes.get('aria-label') === 'Player or faction ID');
  idInput.value = targetId; idInput.emit('input');
  const commentInput = app.find(element => element.tagName === 'TEXTAREA');
  commentInput.value = comment; commentInput.emit('input');
}
function submitSuggestion(app) { app.find(element => element.tagName === 'FORM' && element.className === 'suggestionform').emit('submit'); }

test('suggestions require a trimmed nonblank comment and a valid Torn ID before making a request', async () => {
  const app = fixture(); await app.signIn(); await openSuggestions(app);
  const requestCount = app.requests.length;
  for (const comment of ['', '  \n\t ', 'x'.repeat(1001), '🙂'.repeat(1001)]) {
    fillSuggestion(app, { comment }); submitSuggestion(app); await flush();
    assert.equal(app.requests.length, requestCount);
    assert.match(app.text(), /Add a reason/);
  }
  for (const targetId of ['0', '-4', '1.5', '1e3', '2147483648', 'NaN']) {
    fillSuggestion(app, { targetId }); submitSuggestion(app); await flush();
    assert.equal(app.requests.length, requestCount);
    assert.match(app.text(), /valid player or faction ID/);
  }
  assert.equal(app.find(element => element.tagName === 'TEXTAREA').required, true);
  assert.equal(app.find(element => element.tagName === 'TEXTAREA').maxLength, 2000);
});

test('a thousand Unicode characters reach the backend without splitting emoji or truncating the reason', async () => {
  const app = fixture(); await app.signIn(); await openSuggestions(app);
  const comment = '🙂'.repeat(1000);
  fillSuggestion(app, { comment }); submitSuggestion(app);
  const post = app.requests.at(-1);
  assert.equal(post.method, 'POST');
  assert.equal(post.url, `${serviceBase}/api/suggestions`);
  assert.equal(JSON.parse(post.data).comment, comment);
});

test('members can submit both players and factions with a required reason, then see the pending queue', async () => {
  for (const type of ['player', 'faction']) {
    const app = fixture(); await app.signIn(); await openSuggestions(app);
    fillSuggestion(app, { type, comment: '  Useful for chains.\n  ' });
    const form = app.find(element => element.className === 'suggestionform'); form.emit('submit');
    const post = app.requests.at(-1); form.emit('submit');
    assert.equal(app.requests.at(-1), post, 'an in-flight submit cannot be doubled');
    assert.equal(post.method, 'POST'); assert.equal(post.url, `${serviceBase}/api/suggestions`);
    assert.deepEqual(JSON.parse(post.data), { type, targetId: 45678, comment: 'Useful for chains.' });
    assert.equal(post.headers.Authorization, `Bearer ${SESSION}`);
    app.response(post, { suggestion: suggestion({ type }) }, 201); await flush();
    const queue = app.requests.at(-1); assert.equal(queue.method, 'GET');
    app.response(queue, { canReview: false, suggestions: [suggestion({ type })], nextOffset: null }); await flush();
    assert.match(app.text(), /Suggestion submitted/);
    assert.equal(app.find(element => element.tagName === 'TEXTAREA').value, '');
    assert.equal(app.find(element => element.attributes.get('aria-label') === 'Player or faction ID').value, '');
    assert.match(app.text(), /Suggested Player \[45678\].*Inactive player for chains/s);
    assert.equal(descendants(app.root).some(element => element.tagName === 'BUTTON' && ['Approve', 'Reject'].includes(element.textContent)), false);
    if (type === 'faction') assert.match(app.text(), /Faction · current players added on approval/);
  }
});

test('suggestion drafts survive navigation, queue re-renders, and transient or duplicate submission failures', async () => {
  const app = fixture(); await app.signIn(); await openSuggestions(app);
  fillSuggestion(app, { type: 'faction', targetId: '55555', comment: '  Draft reason\nwith details.  ' });
  app.button('Targets').emit('click'); await openSuggestions(app);
  assert.equal(app.find(element => element.tagName === 'TEXTAREA').value, '  Draft reason\nwith details.  ');
  assert.equal(app.find(element => element.attributes.get('aria-label') === 'Suggestion type').value, 'faction');
  assert.equal(app.find(element => element.attributes.get('aria-label') === 'Player or faction ID').value, '55555');
  for (const [status, code] of [[503, 'UPSTREAM_UNAVAILABLE'], [409, 'SUGGESTION_CONFLICT'], [403, 'FRIENDLY_TARGET']]) {
    submitSuggestion(app); app.response(app.requests.at(-1), { error: { code, message: 'Try another target or later.' } }, status); await flush();
    assert.equal(app.storage.get(app.storageKey).token, SESSION);
    assert.equal(app.find(element => element.tagName === 'TEXTAREA').value, '  Draft reason\nwith details.  ');
    assert.equal(app.button('Submit suggestion').disabled, false);
  }
});

test('pending and own-history queues offer pagination and ignore stale results from the previous view', async () => {
  const app = fixture(); await app.signIn();
  await openSuggestions(app, { canReview: false, suggestions: [suggestion()], nextOffset: 50 });
  app.button('Load more suggestions').emit('click'); const more = app.requests.at(-1);
  assert.ok(more.url.endsWith('/api/suggestions?view=pending&offset=50'));
  const other = suggestion({ id: '00000000-0000-4000-8000-000000000002', targetId: 67890, targetName: 'Second Target' });
  app.response(more, { canReview: false, suggestions: [suggestion(), other], nextOffset: null }); await flush();
  assert.equal(descendants(app.root).filter(element => element.className === 'card suggestioncard').length, 2, 'duplicate page rows display once');
  app.button('Refresh suggestions').emit('click'); const stale = app.requests.at(-1);
  app.button('My suggestions').emit('click'); const own = app.requests.at(-1);
  assert.ok(own.url.endsWith('/api/suggestions?view=mine&offset=0'));
  app.response(own, { canReview: false, suggestions: [suggestion({ status: 'approved', reviewedBy: player, reviewedAt: new Date(NOW).toISOString() })], nextOffset: 50 });
  app.response(stale, { canReview: true, suggestions: [other], nextOffset: null }); await flush();
  assert.match(app.text(), /Approved by Allowed Player/);
  assert.equal(app.text().includes('Second Target'), false, 'late pending response must not overwrite history');
  assert.equal(descendants(app.root).some(element => element.textContent === 'Approve'), false);
  app.button('Load more suggestions').emit('click');
  assert.ok(app.requests.at(-1).url.endsWith('/api/suggestions?view=mine&offset=50'));
});

test('leader approvals refresh the pool and queue, while rejection updates only the queue', async () => {
  for (const decision of ['approved', 'rejected']) {
    const app = fixture(); await app.signIn();
    await openSuggestions(app, { canReview: true, suggestions: [suggestion({ type: 'faction' })], nextOffset: null });
    const action = app.button(decision === 'approved' ? 'Approve' : 'Reject'); action.emit('click'); const review = app.requests.at(-1);
    action.emit('click'); assert.equal(app.requests.at(-1), review, 'busy review cannot be sent twice');
    assert.equal(review.url, `${serviceBase}/api/suggestions/00000000-0000-4000-8000-000000000001/review`);
    assert.deepEqual(JSON.parse(review.data), { decision });
    const beforeRefresh = app.requests.length;
    app.response(review, { suggestion: suggestion({ status: decision }), addedPlayers: decision === 'approved' ? 12 : 0 }); await flush();
    const refreshes = app.requests.slice(beforeRefresh);
    const queue = refreshes.find(request => request.url.includes('/api/suggestions?')); assert.ok(queue);
    app.response(queue, { canReview: true, suggestions: [], nextOffset: null });
    const pool = refreshes.find(request => request.url.endsWith('/api/targets'));
    if (decision === 'approved') {
      assert.ok(pool); app.response(pool, { player, targets: [target, { ...target, id: 67890, name: 'Newly Approved Player' }], warnings: [] });
    } else assert.equal(pool, undefined);
    await flush();
    assert.match(app.text(), decision === 'approved' ? /12 players added to the target pool/ : /Suggestion rejected/);
    if (decision === 'approved') { app.button('Targets').emit('click'); assert.match(app.text(), /Newly Approved Player/); }
  }
});

test('a review role denial removes leader actions while preserving the ordinary session and draft', async () => {
  const app = fixture(); await app.signIn();
  await openSuggestions(app, { canReview: true, suggestions: [suggestion()], nextOffset: null });
  fillSuggestion(app, { comment: 'Keep this unfinished draft.' }); app.button('Approve').emit('click');
  app.response(app.requests.at(-1), { error: { code: 'REVIEW_NOT_ALLOWED', message: 'Leadership permission is no longer available.' } }, 403); await flush();
  assert.equal(app.storage.get(app.storageKey).token, SESSION);
  assert.match(app.text(), /Leadership permission is no longer available/);
  assert.equal(descendants(app.root).some(element => element.textContent === 'Approve' || element.textContent === 'Reject'), false);
  assert.equal(app.find(element => element.tagName === 'TEXTAREA').value, 'Keep this unfinished draft.');
  assert.equal(app.button('Submit suggestion').disabled, false);
  app.button('Targets').emit('click'); assert.match(app.text(), /Target Player/);
});

test('an already-reviewed conflict keeps the session and allows the queue to be refreshed', async () => {
  const app = fixture(); await app.signIn();
  await openSuggestions(app, { canReview: true, suggestions: [suggestion()], nextOffset: null });
  app.button('Reject').emit('click');
  app.response(app.requests.at(-1), { error: { code: 'ALREADY_REVIEWED', message: 'Another leader already reviewed this suggestion.' } }, 409); await flush();
  assert.equal(app.storage.get(app.storageKey).token, SESSION);
  assert.match(app.text(), /Another leader already reviewed/);
  assert.equal(app.button('Refresh suggestions').disabled, false);
});

test('queue content is rendered as plain text, including comments, target names, and submitter names', async () => {
  const app = fixture(); await app.signIn();
  const injected = '<img src=x onerror="throw Error(1)">';
  await openSuggestions(app, { canReview: false, suggestions: [suggestion({ targetName: injected, comment: `<script>alert(1)</script>\n${injected}`,
    suggestedBy: { ...player, name: injected, faction: { ...player.faction, name: injected } } })], nextOffset: null });
  assert.match(app.text(), /<script>alert\(1\)<\/script>/);
  assert.ok(app.text().includes(injected));
  assert.equal(descendants(app.root).some(element => element.tagName === 'IMG' || element.tagName === 'SCRIPT'), false);
});

test('sign out during queue loading or mutations ignores late results and clears the suggestion draft', async () => {
  for (const action of ['queue', 'submit', 'review']) {
    const app = fixture(); await app.signIn();
    if (action === 'queue') app.button('Suggestions').emit('click');
    else {
      await openSuggestions(app, { canReview: true, suggestions: [suggestion()], nextOffset: null });
      fillSuggestion(app, { comment: 'Must be removed on sign out.' });
      if (action === 'submit') submitSuggestion(app); else app.button('Approve').emit('click');
    }
    const held = app.requests.at(-1); app.button('Sign out').emit('click'); const count = app.requests.length;
    app.response(held, action === 'queue' ? { canReview: true, suggestions: [suggestion()], nextOffset: null } : { suggestion: suggestion(), addedPlayers: 1 }); await flush();
    assert.equal(app.requests.length, count, 'a stale mutation must not start new refreshes');
    assert.equal(app.storage.size, 0);
    assert.match(app.text(), /Torn Limited API key/);
    assert.equal(app.text().includes('Must be removed on sign out.'), false);
    assert.equal(descendants(app.root).some(element => element.className === 'card suggestioncard'), false);
  }
});

test('session expiry and revocation during a suggestion request cannot restore review access', async () => {
  for (const outcome of ['expire', 'revoke']) {
    const app = fixture(); await app.signIn(); await openSuggestions(app);
    fillSuggestion(app); submitSuggestion(app); const post = app.requests.at(-1);
    if (outcome === 'expire') {
      app.setNow(NOW + 3_600_000); app.timers[0]();
      app.response(post, { suggestion: suggestion() }, 201);
    } else app.response(post, { error: { code: 'FACTION_NOT_ALLOWED', message: 'Faction access revoked.' } }, 403);
    await flush(); assert.equal(app.storage.size, 0); assert.match(app.text(), /Torn Limited API key/);
    assert.equal(descendants(app.root).some(element => element.textContent === 'Approve'), false);
  }
});

test('approval starts a fresh target request and ignores an older target refresh result', async () => {
  const app = fixture(); await app.signIn(); app.button('Refresh list').emit('click'); const oldPool = app.requests.at(-1);
  await openSuggestions(app, { canReview: true, suggestions: [suggestion()], nextOffset: null });
  app.button('Approve').emit('click'); app.response(app.requests.at(-1), { suggestion: suggestion({ status: 'approved' }), addedPlayers: 1 }); await flush();
  const newPool = app.requests.at(-1); assert.ok(newPool.url.endsWith('/api/targets')); assert.notEqual(newPool, oldPool);
  const queue = app.requests.at(-2); app.response(queue, { canReview: true, suggestions: [], nextOffset: null });
  app.response(newPool, { player, targets: [{ ...target, name: 'Approved Pool' }], warnings: [] });
  app.response(oldPool, { player, targets: [{ ...target, name: 'Old Pool' }], warnings: [] }); await flush();
  app.button('Targets').emit('click'); assert.match(app.text(), /Approved Pool/); assert.equal(app.text().includes('Old Pool'), false);
});
