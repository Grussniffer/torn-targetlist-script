import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const coreSource = await readFile(new URL('../src/core.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const source = `${coreSource}\n${appSource}`;
// Read the configured address without mounting; all requests below are manual mocks.
const configSource = appSource.match(/^const CONFIG = .*;$/m)[0];
const { serviceBase, version: scriptVersion } = vm.runInNewContext(
  `${coreSource}\n${configSource}\n({ serviceBase: TargetListCore.serviceUrl(CONFIG.serviceUrl), version: CONFIG.version });`, { URL });
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
    this.activeElement = null; this.parentNode = null;
  }
  append(...children) {
    for (const child of children) {
      if (typeof child === 'object') { child.remove(); child.parentNode = this; }
      this.children.push(child);
    }
  }
  replaceChildren(...children) {
    for (const child of this.children) if (typeof child === 'object') child.parentNode = null;
    this.children = []; this.append(...children);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
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

function fixture(saved = null, preferences = null, existingHost = null) {
  let clock = NOW;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  const body = new Element('body'); const requests = []; const navigations = []; const storage = new Map(); const writes = []; const timers = []; const timeouts = new Map();
  if (existingHost) body.append(existingHost);
  let nextTimer = 1;
  const storageKey = `targetlist.session.${serviceBase}`;
  const preferencesKey = `targetlist.preferences.${serviceBase}`;
  if (saved) storage.set(storageKey, saved);
  if (preferences) storage.set(preferencesKey, preferences);
  const context = vm.createContext({
    URL, Intl, Date: Clock, console,
    window: { location: { assign: url => navigations.push(url) } },
    document: { body, getElementById: id => descendants(body).find(element => element.id === id), createElement: tag => new Element(tag),
      createElementNS: (namespace, tag) => { const node = new Element(tag); node.namespaceURI = namespace; return node; } },
    GM_xmlhttpRequest: options => { requests.push(options); },
    GM_getValue: (key, fallback) => storage.get(key) ?? fallback,
    GM_setValue: (key, value) => { storage.set(key, value); writes.push(value); },
    GM_deleteValue: key => storage.delete(key),
    setInterval: callback => { timers.push(callback); },
    setTimeout: callback => { const id = nextTimer++; timeouts.set(id, callback); return id; },
    clearTimeout: id => timeouts.delete(id),
  });
  const runScript = () => vm.runInContext(`(() => {\n${source}\n})();`, context);
  runScript();
  const host = body.children.find(element => element.id === 'torn-targetlist-host');
  const root = host.shadow;
  function find(predicate) { const result = descendants(root).find(predicate); assert.ok(result, 'expected control exists'); return result; }
  function button(label) { return find(element => element.tagName === 'BUTTON' && element.textContent === label); }
  function response(request, data, status = 200) {
    request.onload({ status, responseText: JSON.stringify(data), finalUrl: request.url });
  }
  async function signIn(targets = [target]) {
    const input = find(element => element.tagName === 'INPUT' && element.type === 'password'); input.value = KEY;
    find(element => element.tagName === 'FORM').emit('submit');
    const login = requests.at(-1);
    response(login, { token: SESSION, expiresAt: new Date(NOW + 3_600_000).toISOString(), player });
    await flush();
    response(requests.at(-1), { player, targets, warnings: [], generatedAt: new Date(NOW).toISOString() });
    await flush();
    return login;
  }
  return { root, host, body, runScript, requests, navigations, storage, writes, storageKey, preferencesKey, timers, timeouts, find, button, response, signIn,
    settings: () => find(element => element.className === 'settings-toggle'),
    text: () => textContent(root), setNow: value => { clock = value; } };
}

test('installing NWA replaces a legacy target-list host and keeps the settings gear usable', () => {
  for (const previousVersion of [null, '0.3.0']) {
    const legacy = new Element('div'); legacy.id = 'torn-targetlist-host';
    if (previousVersion) legacy.setAttribute('data-nwa-version', previousVersion);
    const legacyButton = new Element('button'); legacyButton.textContent = '◎ Target list';
    legacy.attachShadow().append(legacyButton);
    const app = fixture(null, null, legacy);
    assert.equal(legacy.parentNode, null);
    assert.equal(app.body.children.filter(element => element.id === 'torn-targetlist-host').length, 1);
    assert.notEqual(app.host, legacy);
    assert.equal(app.host.getAttribute('data-nwa-version'), scriptVersion);
    assert.equal(app.button('NWA').className, 'launcher');
    assert.equal(descendants(app.settings()).some(element => element.tagName === 'SVG' && element.namespaceURI === 'http://www.w3.org/2000/svg'), true);
    app.settings().emit('click');
    assert.equal(app.find(element => element.className === 'panel').hidden, false);
  }
});

test('running the current NWA version again preserves one launcher and its existing session', async () => {
  const app = fixture(); await app.signIn();
  const host = app.host; const before = app.requests.length;
  app.runScript();
  assert.equal(app.body.children.filter(element => element.id === 'torn-targetlist-host').length, 1);
  assert.equal(app.body.children[0], host);
  assert.equal(app.timers.length, 1, 'the current version does not mount a second session timer');
  assert.equal(app.requests.length, before);
  assert.equal(app.storage.get(app.storageKey).token, SESSION);
  assert.match(app.text(), /Allowed Player \[12345\]/);
});

test('an older script cannot replace an already mounted newer NWA version', () => {
  const [major, minor, patch] = scriptVersion.split('.').map(Number);
  for (const newerVersion of [`${major}.${minor + 1}.0`, `${major}.${minor}.${patch + 10}`]) {
    const newerHost = new Element('div'); newerHost.id = 'torn-targetlist-host';
    newerHost.setAttribute('data-nwa-version', newerVersion);
    const existingUi = new Element('button'); existingUi.textContent = 'Existing newer NWA';
    newerHost.attachShadow().append(existingUi);
    const app = fixture(null, null, newerHost);
    assert.equal(app.host, newerHost);
    assert.equal(app.host.getAttribute('data-nwa-version'), newerVersion);
    assert.equal(app.body.children.length, 1);
    assert.equal(app.root.children[0], existingUi);
    assert.equal(app.timers.length, 0);
    assert.equal(app.requests.length, 0);
  }
});

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
  app.settings().emit('click');
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
  app.settings().emit('click'); const restoring = app.requests.at(-1);
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
  app.settings().emit('click');
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
  const app = fixture(); await app.signIn(); app.settings().emit('click');
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

test('the NWA launcher opens login without requesting a target when signed out', async () => {
  const app = fixture();
  const settings = app.settings();
  assert.equal(settings.attributes.get('aria-label'), 'NWA settings');
  app.button('NWA').emit('click'); await flush();
  assert.equal(app.find(element => element.className === 'panel').hidden, false);
  assert.match(app.text(), /Torn Limited API key/);
  assert.equal(app.requests.length, 0);
  assert.deepEqual(app.navigations, []);
});

test('signing in from NWA continues straight to a live target check', async () => {
  const app = fixture(); app.button('NWA').emit('click'); await app.signIn();
  assert.equal(app.requests.length, 3);
  assert.equal(app.requests.at(-1).url, `${serviceBase}/api/targets/${target.id}/status`);
  assert.deepEqual(app.navigations, []);
  app.response(app.requests.at(-1), { id: target.id, status: { state: 'Okay' }, checkedAt: new Date(NOW).toISOString() }); await flush();
  assert.equal(app.navigations.length, 1);
});

test('NWA checks a fresh suitable target live before opening its attack page in the same tab', async () => {
  const app = fixture();
  await app.signIn([
    { ...target, id: 10001, estimatedStats: 100_000, faction: player.faction },
    { ...target, id: 10002, estimatedStats: 100_000, estimateUpdatedAt: NOW / 1000 - 8 * 86400 },
    { ...target, id: 10003, estimatedStats: null },
    { ...target, id: 10004, estimatedStats: 900_000 },
    { ...target, checkedAt: new Date(NOW).toISOString() },
  ]);
  const before = app.requests.length;
  app.button('NWA').emit('click');
  assert.equal(app.requests.length, before + 1);
  const live = app.requests.at(-1);
  assert.equal(live.method, 'GET');
  assert.equal(live.url, `${serviceBase}/api/targets/${target.id}/status`);
  assert.equal(live.headers.Authorization, `Bearer ${SESSION}`);
  assert.deepEqual(app.navigations, [], 'a cached Okay status must not navigate');
  app.response(live, { id: target.id, status: { state: 'Okay' }, checkedAt: new Date(NOW).toISOString() });
  await flush();
  assert.deepEqual(app.navigations, [`https://www.torn.com/page.php?sid=attack&user2ID=${target.id}`]);
  assert.equal(app.requests.length, before + 1, 'opening the attack page does not send an attack request');
});

test('NWA skips unavailable, newly friendly, and removed targets before opening the next live match', async () => {
  const app = fixture();
  const candidates = Array.from({ length: 5 }, (_, index) => ({ ...target, id: 20001 + index, estimatedStats: 100_000 + index * 10_000 }));
  await app.signIn(candidates);
  app.button('NWA').emit('click');
  const outcomes = [
    [{ id: candidates[0].id, status: { state: 'Hospital' }, checkedAt: new Date(NOW).toISOString() }, 200],
    [{ id: candidates[1].id, status: { state: 'Traveling' }, checkedAt: new Date(NOW).toISOString() }, 200],
    [{ error: { code: 'FRIENDLY_TARGET', message: 'This target is now friendly.' } }, 403],
    [{ error: { code: 'TARGET_NOT_FOUND', message: 'This target is no longer in the pool.' } }, 404],
  ];
  for (let index = 0; index < outcomes.length; index++) {
    assert.equal(app.requests.at(-1).url, `${serviceBase}/api/targets/${candidates[index].id}/status`);
    app.response(app.requests.at(-1), ...outcomes[index]); await flush();
    assert.deepEqual(app.navigations, []);
  }
  assert.equal(app.requests.at(-1).url, `${serviceBase}/api/targets/${candidates[4].id}/status`);
  app.response(app.requests.at(-1), { id: candidates[4].id, status: { state: 'Okay' }, checkedAt: new Date(NOW).toISOString() });
  await flush();
  assert.deepEqual(app.navigations, [`https://www.torn.com/page.php?sid=attack&user2ID=${candidates[4].id}`]);
  assert.equal(app.storage.get(app.storageKey).token, SESSION);
});

test('repeated NWA clicks coalesce while a target check is pending', async () => {
  const app = fixture(); await app.signIn(); const before = app.requests.length;
  const launcher = app.button('NWA'); launcher.emit('click'); launcher.emit('click'); launcher.emit('click');
  assert.equal(app.requests.length, before + 1);
  app.response(app.requests.at(-1), { id: target.id, status: { state: 'Okay' }, checkedAt: new Date(NOW).toISOString() });
  await flush();
  assert.equal(app.navigations.length, 1);
});

test('NWA stops on service or network failures without trying another target', async () => {
  for (const outcome of ['rate-limit', 'upstream', 'network']) {
    const app = fixture(); await app.signIn([target, { ...target, id: target.id + 1 }]);
    const before = app.requests.length; app.button('NWA').emit('click'); const live = app.requests.at(-1);
    if (outcome === 'network') live.onerror();
    else app.response(live, { error: { code: outcome === 'rate-limit' ? 'RATE_LIMITED' : 'UPSTREAM_UNAVAILABLE', message: 'Try again later.' } }, outcome === 'rate-limit' ? 429 : 503);
    await flush();
    assert.equal(app.requests.length, before + 1, outcome);
    assert.deepEqual(app.navigations, [], outcome);
    assert.equal(app.storage.get(app.storageKey).token, SESSION, outcome);
    assert.equal(app.find(element => element.className === 'quick-notice').hidden, false, 'failure is shown beside NWA');
    assert.equal(app.button('NWA').disabled, false);
  }
});

test('NWA bounds unavailable-target checks to five per click', async () => {
  const app = fixture();
  const candidates = Array.from({ length: 6 }, (_, index) => ({ ...target, id: 30001 + index, estimatedStats: 100_000 + index * 10_000 }));
  await app.signIn(candidates); const before = app.requests.length; app.button('NWA').emit('click');
  for (let index = 0; index < 5; index++) {
    assert.equal(app.requests.at(-1).url, `${serviceBase}/api/targets/${candidates[index].id}/status`);
    app.response(app.requests.at(-1), { id: candidates[index].id, status: { state: 'Hospital' }, checkedAt: new Date(NOW).toISOString() });
    await flush();
  }
  assert.equal(app.requests.length, before + 5);
  assert.deepEqual(app.navigations, []);
  assert.equal(app.button('NWA').disabled, false);
  assert.equal(app.find(element => element.className === 'quick-notice').hidden, false);
  app.button('NWA').emit('click');
  assert.equal(app.requests.length, before + 6, 'the next click advances beyond the recently unavailable first five');
  assert.equal(app.requests.at(-1).url, `${serviceBase}/api/targets/${candidates[5].id}/status`);
  app.response(app.requests.at(-1), { id: candidates[5].id, status: { state: 'Okay' }, checkedAt: new Date(NOW).toISOString() }); await flush();
  assert.deepEqual(app.navigations, [`https://www.torn.com/page.php?sid=attack&user2ID=${candidates[5].id}`]);
});

test('a restored session loads an authorized pool before NWA checks a target', async () => {
  const app = fixture({ token: SESSION, expiresAt: new Date(NOW + 3_600_000).toISOString() });
  app.button('NWA').emit('click'); app.button('NWA').emit('click');
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].url, `${serviceBase}/api/targets`);
  assert.deepEqual(app.navigations, []);
  app.response(app.requests[0], { player, targets: [target], warnings: [] }); await flush();
  assert.equal(app.requests.length, 2);
  assert.equal(app.requests[1].url, `${serviceBase}/api/targets/${target.id}/status`);
  app.response(app.requests[1], { id: target.id, status: { state: 'Okay' }, checkedAt: new Date(NOW).toISOString() });
  await flush();
  assert.equal(app.navigations.length, 1);
});

test('NWA explains when the pool has no fresh target within the stat limit', async () => {
  const tooStrong = { ...target, estimatedStats: 700_000 };
  const app = fixture(); await app.signIn([tooStrong]);
  const before = app.requests.length; app.button('NWA').emit('click'); await flush();
  assert.equal(app.requests.length, before + 1);
  assert.equal(app.requests.at(-1).url, `${serviceBase}/api/targets`);
  app.response(app.requests.at(-1), { player, targets: [tooStrong], warnings: [] }); await flush();
  assert.equal(app.requests.length, before + 1, 'no-match recovery refreshes the pool only once per click');
  assert.deepEqual(app.navigations, []);
  assert.equal(app.find(element => element.className === 'quick-notice').hidden, false);
  assert.match(app.text(), /no.*match|no.*target.*limit/i);
});

test('NWA recovers an empty or unknown-stat pool after background estimates become available', async () => {
  for (const oldPool of [[], [{ ...target, estimatedStats: null, estimateUpdatedAt: null }]]) {
    const app = fixture(); await app.signIn(oldPool);
    const before = app.requests.length; app.button('NWA').emit('click'); app.button('NWA').emit('click');
    assert.equal(app.requests.length, before + 1);
    assert.equal(app.requests.at(-1).url, `${serviceBase}/api/targets`);
    app.response(app.requests.at(-1), { player, targets: [target], warnings: [] }); await flush();
    assert.equal(app.requests.length, before + 2);
    assert.equal(app.requests.at(-1).url, `${serviceBase}/api/targets/${target.id}/status`);
    assert.deepEqual(app.navigations, []);
    app.response(app.requests.at(-1), { id: target.id, status: { state: 'Okay' }, checkedAt: new Date(NOW).toISOString() }); await flush();
    assert.deepEqual(app.navigations, [`https://www.torn.com/page.php?sid=attack&user2ID=${target.id}`]);
  }
});

test('NWA retries the pool after login succeeded but the initial target feed failed', async () => {
  const app = fixture();
  app.find(element => element.type === 'password').value = KEY;
  app.find(element => element.tagName === 'FORM').emit('submit');
  app.response(app.requests.at(-1), { token: SESSION, expiresAt: new Date(NOW + 3_600_000).toISOString(), player }); await flush();
  assert.equal(app.requests.at(-1).url, `${serviceBase}/api/targets`);
  app.response(app.requests.at(-1), { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Target feed is temporarily unavailable.' } }, 503); await flush();
  assert.equal(app.storage.get(app.storageKey).token, SESSION);
  app.button('NWA').emit('click');
  assert.equal(app.requests.length, 3);
  assert.equal(app.requests.at(-1).url, `${serviceBase}/api/targets`);
  app.response(app.requests.at(-1), { player, targets: [target], warnings: [] }); await flush();
  assert.equal(app.requests.at(-1).url, `${serviceBase}/api/targets/${target.id}/status`);
  app.response(app.requests.at(-1), { id: target.id, status: { state: 'Okay' }, checkedAt: new Date(NOW).toISOString() }); await flush();
  assert.equal(app.navigations.length, 1);
});

test('NWA refreshes a pool older than 30 seconds before selecting a live target', async () => {
  const app = fixture(); await app.signIn();
  const updated = { ...target, id: target.id + 1, name: 'New Backend Target' };
  app.setNow(NOW + 30_001); const before = app.requests.length; app.button('NWA').emit('click');
  assert.equal(app.requests.length, before + 1);
  assert.equal(app.requests.at(-1).url, `${serviceBase}/api/targets`);
  app.response(app.requests.at(-1), { player, targets: [updated], warnings: [] }); await flush();
  assert.equal(app.requests.length, before + 2);
  assert.equal(app.requests.at(-1).url, `${serviceBase}/api/targets/${updated.id}/status`);
  app.response(app.requests.at(-1), { id: updated.id, status: { state: 'Okay' }, checkedAt: new Date(NOW + 30_001).toISOString() }); await flush();
  assert.deepEqual(app.navigations, [`https://www.torn.com/page.php?sid=attack&user2ID=${updated.id}`]);
});

test('signout, expiry, or a refreshed pool prevents an old NWA status response from navigating', async () => {
  for (const interruption of ['logout', 'expire', 'refresh']) {
    const app = fixture(); await app.signIn(); app.button('NWA').emit('click'); const live = app.requests.at(-1);
    if (interruption === 'logout') app.button('Sign out').emit('click');
    else if (interruption === 'expire') { app.setNow(NOW + 3_600_000); app.timers[0](); }
    else app.button('Refresh list').emit('click');
    const after = app.requests.length;
    app.response(live, { id: target.id, status: { state: 'Okay' }, checkedAt: new Date(NOW).toISOString() }); await flush();
    assert.deepEqual(app.navigations, [], interruption);
    assert.equal(app.requests.length, after, 'stale checks cannot continue to another candidate');
    if (interruption !== 'refresh') assert.equal(app.storage.has(app.storageKey), false);
    else {
      app.response(app.requests.at(-1), { player, targets: [{ ...target, id: 40001 }], warnings: [] }); await flush();
      assert.deepEqual(app.navigations, []);
    }
  }
});

test('NWA rechecks session expiry at navigation time even before the idle timer runs', async () => {
  const app = fixture(); await app.signIn(); app.button('NWA').emit('click');
  const live = app.requests.at(-1); app.setNow(NOW + 3_600_000);
  app.response(live, { id: target.id, status: { state: 'Okay' }, checkedAt: new Date(NOW + 3_600_000).toISOString() });
  await flush();
  assert.deepEqual(app.navigations, []);
  assert.equal(app.storage.has(app.storageKey), false);
});

test('revocation during NWA selection stops further checks and clears the session', async () => {
  const app = fixture(); await app.signIn([target, { ...target, id: target.id + 1 }]);
  app.button('NWA').emit('click'); const before = app.requests.length;
  app.response(app.requests.at(-1), { error: { code: 'FACTION_CHANGED', message: 'Faction access revoked.' } }, 403);
  await flush();
  assert.equal(app.requests.length, before);
  assert.deepEqual(app.navigations, []);
  assert.equal(app.storage.has(app.storageKey), false);
  assert.match(app.text(), /Faction access revoked/);
});

test('the stat limit persists separately from the session and is used by NWA after reloading', async () => {
  const app = fixture(); await app.signIn();
  const ratio = app.find(element => element.attributes.get('aria-label') === 'Maximum target stats as percent of your total');
  ratio.value = '40'; ratio.emit('change');
  assert.equal(app.storage.get(app.preferencesKey).maxRatio, 0.4);
  app.button('Sign out').emit('click');
  assert.equal(app.storage.has(app.storageKey), false);
  assert.equal(app.storage.get(app.preferencesKey).maxRatio, 0.4);
  assert.equal(JSON.stringify([...app.storage.values()]).includes(KEY), false);
  const reloaded = fixture(null, app.storage.get(app.preferencesKey)); await reloaded.signIn();
  const before = reloaded.requests.length; reloaded.button('NWA').emit('click'); await flush();
  assert.equal(reloaded.requests.length, before + 1);
  assert.equal(reloaded.requests.at(-1).url, `${serviceBase}/api/targets`);
  reloaded.response(reloaded.requests.at(-1), { player, targets: [target], warnings: [] }); await flush();
  assert.equal(reloaded.requests.length, before + 1, 'a 50% target is excluded by the saved 40% limit after refreshing the pool');
  assert.deepEqual(reloaded.navigations, []);
  assert.match(reloaded.find(element => element.className === 'quick-notice').textContent, /No targets match/);
});

test('changing the stat limit cancels a pending NWA selection before it can navigate', async () => {
  const app = fixture(); await app.signIn(); app.button('NWA').emit('click'); const live = app.requests.at(-1);
  const ratio = app.find(element => element.attributes.get('aria-label') === 'Maximum target stats as percent of your total');
  ratio.value = '40'; ratio.emit('change');
  app.response(live, { id: target.id, status: { state: 'Okay' }, checkedAt: new Date(NOW).toISOString() }); await flush();
  assert.deepEqual(app.navigations, []);
  assert.equal(app.button('NWA').disabled, false);
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
