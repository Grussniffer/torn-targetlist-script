// Keep this service hostname and @connect in metadata.txt in sync when deploying elsewhere.
const CONFIG = Object.freeze({ serviceUrl: 'https://targetlist.grusmedia.no' });

if (!document.getElementById('torn-targetlist-host')) {
  mountTargetList();
}

function mountTargetList() {
  const C = TargetListCore;
  let base;
  try { base = C.serviceUrl(CONFIG.serviceUrl); }
  catch (error) { console.error('[Target List] Invalid service address:', error.message); return; }
  const storageKey = `targetlist.session.${base}`;
  const host = document.createElement('div');
  host.id = 'torn-targetlist-host';
  host.style.cssText = 'position:fixed;bottom:18px;right:18px;z-index:2147483000;';
  document.body.append(host);
  const root = host.attachShadow({ mode: 'closed' });
  const state = {
    token: null, expiresAt: null, player: null, targets: [], warnings: [], generatedAt: null,
    busy: false, open: false, generation: 0, error: '', query: '', mode: 'all', maxRatio: C.DEFAULT_MAX_RATIO,
    pendingChecks: new Set(), loading: false, targetGeneration: 0, view: 'targets',
    suggestionView: 'pending', suggestions: [], nextSuggestionOffset: null, canReview: false,
    suggestionsLoading: false, suggestionGeneration: 0, suggestionMutation: null, suggestionNotice: '',
    suggestionDraft: { type: 'player', targetId: '', comment: '' }
  };
  const css = document.createElement('style');
  css.textContent = `
    :host{all:initial;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#edf4f4;font-size:14px;line-height:1.5}
    *{box-sizing:border-box} button,input,select,textarea{font:inherit}button,a,input,select,textarea{outline-offset:3px}
    button{cursor:pointer;border:1px solid #3d505b;border-radius:9px;padding:8px 12px;background:#22343f;color:#eef6f6}
    button:hover:not(:disabled){background:#304954}button:disabled{cursor:wait;opacity:.55}
    a{color:#7fe0ce;text-decoration:none}a:hover{text-decoration:underline}p{margin:0 0 12px}h2,h3{margin:0}
    input,select,textarea{color:#edf4f4;background:#101c24;border:1px solid #3d505b;border-radius:8px;padding:10px;min-width:0}
    input:focus,select:focus,textarea:focus{border-color:#69d7c0}label{display:block}small,.muted{color:#a8b9c2;font-size:12px}
    .launcher{background:#76e1c7;color:#102626;border:0;font-weight:750;box-shadow:0 3px 25px #0006}
    .panel{width:min(640px,calc(100vw - 36px));max-height:calc(100dvh - 88px);background:#14222d;border:1px solid #354956;
      border-radius:15px;box-shadow:0 18px 70px #0009;display:flex;flex-direction:column;margin-bottom:10px;overflow:hidden}
    [hidden]{display:none!important}.header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #30414c}
    .eyebrow{font-size:10px;letter-spacing:1.8px;font-weight:750;color:#76e1c7;text-transform:uppercase}
    h2{font-size:20px;line-height:1.4}.icon{padding:3px 10px;background:transparent;font-size:20px}
    .scroll{overflow:auto;padding:20px}.login{display:grid;gap:13px}.login input{width:100%;margin-top:5px}
    .primary{background:#76e1c7;color:#102626;font-weight:750;border:0}.primary:hover:not(:disabled){background:#95efd9}
    .notice{font-size:12px;line-height:1.6;color:#b4c3ca}.error{background:#492b31;color:#ffd6d8;padding:10px 13px;border-radius:8px;margin-bottom:14px}
    .profile{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.profile strong{font-size:17px}
    .statgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0}.stat{background:#1c303a;padding:9px;border-radius:8px}
    .stat strong{display:block;color:#e4f5f3;font-size:15px}.toolbar{display:grid;grid-template-columns:1fr 160px;gap:10px;margin:14px 0}
    .controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.controls input{width:74px;padding:5px 8px}.controls button{margin-left:auto}
    .count{margin:15px 0 10px;font-size:12px;color:#a8b9c2}.cards{display:grid;gap:10px}.card{border:1px solid #354956;border-radius:10px;padding:14px;background:#192b36}
    .cardhead{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.name{font-weight:750;font-size:15px}.badge{font-size:10px;font-weight:750;padding:4px 7px;border-radius:5px;white-space:nowrap;background:#20473e;color:#a4efd9}
    .badge.warn{background:#4e3e26;color:#f6d290}.badge.muted{background:#2c3944;color:#bbcad4}
    .metrics{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:12px}.metrics strong{display:block;font-size:14px}.metrics small{display:block}
    .actions{display:flex;align-items:center;gap:12px;margin-top:12px}.actions a.attack{margin-left:auto;background:#76e1c7;color:#102626;padding:7px 12px;border-radius:8px;font-weight:750}
    .notes{font-size:12px;color:#b7c7ce;margin-top:8px;overflow-wrap:anywhere}.empty{padding:24px;text-align:center;background:#1c303a;border-radius:10px}
    .footnote{border-top:1px solid #30414c;margin-top:18px;padding-top:14px;font-size:11px;color:#9fb2bd}
    .tabs{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.tabs button[aria-pressed=true]{border-color:#76e1c7;background:#244a46;color:#baf8e7}
    .suggestionform{display:grid;gap:12px;margin:14px 0 20px}.suggestionfields{display:grid;grid-template-columns:140px 1fr;gap:10px}
    .suggestionform input,.suggestionform select,.suggestionform textarea{display:block;width:100%;margin-top:5px}.suggestionform textarea{resize:vertical;min-height:84px}
    .success{background:#20473e;color:#baf8e7;padding:10px 13px;border-radius:8px;margin:12px 0;font-size:13px}
    .comment{white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0;font-size:13px;color:#d4e4e9}.queueheader{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .queueheader h3{font-size:16px}.queuefooter{margin-top:12px}.suggestioncard .actions button{padding:6px 10px}.suggestioncard .name{overflow-wrap:anywhere}
    @media(max-width:480px){.scroll{padding:14px}.toolbar{grid-template-columns:1fr}.statgrid{grid-template-columns:repeat(2,1fr)}
      .metrics{grid-template-columns:1fr 1fr}.cardhead{flex-wrap:wrap}.badge{white-space:normal}.actions{gap:8px}.header{padding:12px 14px}.suggestionfields{grid-template-columns:1fr}}
  `;
  root.append(css);
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }
  function button(text, callback, className) {
    const node = element('button', text, className); node.type = 'button';
    node.addEventListener('click', callback); return node;
  }
  function link(text, href, className) {
    const node = element('a', text, className); node.href = href;
    node.target = '_blank'; node.rel = 'noopener noreferrer'; return node;
  }
  const panel = element('section', null, 'panel'); panel.hidden = true;
  panel.setAttribute('aria-label', 'Faction target list');
  const header = element('div', null, 'header');
  const title = element('div'); title.append(element('div', 'Faction target list', 'eyebrow'), element('h2', 'Find your next hit'));
  header.append(title, button('×', () => toggle(false), 'icon'));
  header.lastChild.setAttribute('aria-label', 'Close target list');
  const scroll = element('div', null, 'scroll');
  const errorBox = element('div', null, 'error'); errorBox.setAttribute('role', 'alert'); errorBox.hidden = true;
  const content = element('div'); scroll.append(errorBox, content); panel.append(header, scroll);
  const launcher = button('◎ Target list', () => toggle(!state.open), 'launcher');
  launcher.setAttribute('aria-expanded', 'false'); root.append(panel, launcher);

  function message(text) { state.error = text; errorBox.textContent = text; errorBox.hidden = !text; }
  function saveSession() {
    GM_setValue(storageKey, { token: state.token, expiresAt: state.expiresAt });
  }
  function clearSession() {
    state.generation++; state.token = null; state.player = null; state.targets = []; state.warnings = [];
    state.pendingChecks.clear(); state.busy = false; state.loading = false; state.targetGeneration++; state.expiresAt = null;
    state.view = 'targets'; state.suggestionView = 'pending'; state.suggestions = []; state.nextSuggestionOffset = null;
    state.canReview = false; state.suggestionsLoading = false; state.suggestionGeneration++;
    state.suggestionMutation = null; state.suggestionNotice = ''; state.suggestionDraft = { type: 'player', targetId: '', comment: '' };
    GM_deleteValue(storageKey);
  }
  function handleError(error) {
    if (error.code === 'REVIEW_NOT_ALLOWED') state.canReview = false;
    if (['SESSION_EXPIRED', 'UNAUTHORIZED', 'FACTION_NOT_ALLOWED', 'FACTION_CHANGED', 'INVALID_KEY', 'KEY_ACCESS', 'SESSION_REVOKED', 'KEY_REVOKED', 'INVALID_SESSION', 'FORBIDDEN'].includes(error.code) || error.status === 401 || (error.status === 403 && !['FRIENDLY_TARGET', 'REVIEW_NOT_ALLOWED'].includes(error.code))) {
      clearSession(); render();
    }
    message(error.message || 'The request failed. Try again shortly.');
  }
  function request(method, path, body, token = state.token) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const succeed = value => { if (!settled) { settled = true; clearTimeout(deadline); resolve(value); } };
      const fail = error => { if (!settled) { settled = true; clearTimeout(deadline); reject(error); } };
      const deadline = setTimeout(() => fail(new Error('The target service timed out. Try again shortly.')), 20000);
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (token) headers.Authorization = `Bearer ${token}`;
      try { GM_xmlhttpRequest({
        method, url: `${base}${path}`, headers, anonymous: true, redirect: 'error', timeout: 20000,
        data: body === undefined ? undefined : JSON.stringify(body),
        onload(response) {
          if (settled) return;
          if (response.finalUrl && new URL(response.finalUrl).origin !== new URL(base).origin) {
            fail(new Error('The service redirected to another host. Check the configured service address.')); return;
          }
          let data;
          try { data = response.responseText ? JSON.parse(response.responseText) : null; }
          catch { fail(new Error('The target service returned an invalid response.')); return; }
          if (response.status < 200 || response.status >= 300 || data?.error) {
            const delay = data?.error?.retryAfterSeconds;
            const error = new Error(`${data?.error?.message || 'The target service could not complete the request.'}${delay ? ` Retry in ${delay}s.` : ''}`);
            error.status = response.status; error.code = data?.error?.code; fail(error); return;
          }
          succeed(data);
        },
        onerror: () => fail(new Error('Cannot reach the target service. Check its address and the userscript connection permission.')),
        ontimeout: () => fail(new Error('The target service timed out. Try again shortly.')),
        onabort: () => fail(new Error('The request was cancelled.'))
      }); } catch { fail(new Error('The userscript manager could not send this request. Check its permissions.')); }
    });
  }

  async function login(apiKey) {
    if (state.busy || state.loading) return;
    if (!C.validKey(apiKey)) { message('Enter a 16-character Torn Limited API key.'); return; }
    state.busy = true; message('');
    const generation = ++state.generation;
    render();
    try {
      const data = await request('POST', '/api/session', { apiKey }, null);
      if (generation !== state.generation) return;
      state.token = data.token; state.expiresAt = data.expiresAt; state.player = data.player;
      saveSession(); await loadTargets();
    } catch (error) { if (generation === state.generation) handleError(error); }
    finally { if (generation === state.generation) { state.busy = false; render(); } }
  }

  async function logout() {
    const token = state.token; clearSession(); message(''); render();
    if (token) { try { await request('DELETE', '/api/session', undefined, token); } catch { /* Local credentials are cleared regardless. */ } }
  }
  async function loadTargets(force = false) {
    if (!state.token || (state.loading && !force)) return;
    const generation = state.generation;
    const targetGeneration = ++state.targetGeneration;
    state.loading = true; message('');
    // Clear previously checked statuses while refreshed authorization is pending.
    state.targets = []; render();
    try {
      const data = await request('GET', '/api/targets');
      if (generation !== state.generation || targetGeneration !== state.targetGeneration) return;
      state.player = data.player; state.targets = data.targets; state.warnings = data.warnings || []; state.generatedAt = data.generatedAt;
    } catch (error) { if (generation === state.generation && targetGeneration === state.targetGeneration) handleError(error); }
    finally { if (generation === state.generation && targetGeneration === state.targetGeneration) { state.loading = false; render(); } }
  }
  async function checkStatus(id) {
    if (state.pendingChecks.has(id)) return;
    state.pendingChecks.add(id); message(''); renderCards();
    const generation = state.generation;
    try {
      const checked = await request('GET', `/api/targets/${id}/status`);
      if (generation !== state.generation) return;
      state.targets = state.targets.map(target => target.id === id ? { ...target, ...checked } : target);
    } catch (error) {
      if (generation !== state.generation) return;
      state.targets = state.targets.map(target => target.id === id ? { ...target, checkedAt: null } : target);
      handleError(error);
    } finally {
      if (generation === state.generation) { state.pendingChecks.delete(id); renderCards(); }
    }
  }

  async function loadSuggestions(view = state.suggestionView, append = false) {
    if (!state.token || (append && (state.suggestionsLoading || state.nextSuggestionOffset === null))) return;
    const generation = state.generation;
    const suggestionGeneration = ++state.suggestionGeneration;
    const offset = append ? state.nextSuggestionOffset : 0;
    state.suggestionView = view; state.suggestionsLoading = true;
    if (!append) { state.suggestions = []; state.nextSuggestionOffset = null; }
    message(''); render();
    try {
      const data = await request('GET', `/api/suggestions?view=${view}&offset=${offset}`);
      if (generation !== state.generation || suggestionGeneration !== state.suggestionGeneration) return;
      state.canReview = data.canReview === true;
      // Keep a changing shared queue from displaying a repeated row across pages.
      const rows = append ? [...state.suggestions, ...data.suggestions] : data.suggestions;
      state.suggestions = [...new Map(rows.map(row => [row.id, row])).values()];
      state.nextSuggestionOffset = Number.isSafeInteger(data.nextOffset) && data.nextOffset > offset ? data.nextOffset : null;
    } catch (error) {
      if (generation === state.generation && suggestionGeneration === state.suggestionGeneration) handleError(error);
    } finally {
      if (generation === state.generation && suggestionGeneration === state.suggestionGeneration) { state.suggestionsLoading = false; render(); }
    }
  }

  async function submitSuggestion() {
    if (!state.token || state.suggestionMutation) return;
    const draft = state.suggestionDraft;
    const targetId = Number(draft.targetId);
    const comment = draft.comment.trim();
    if (!['player', 'faction'].includes(draft.type) || !/^[1-9]\d*$/.test(draft.targetId.trim()) || !Number.isSafeInteger(targetId) || targetId > 2147483647) {
      message('Enter a valid player or faction ID.'); return;
    }
    if (!comment || [...comment].length > 1000) { message('Add a reason for this target, up to 1,000 characters.'); return; }
    const generation = state.generation;
    state.suggestionMutation = 'submit'; state.suggestionNotice = ''; message(''); render();
    try {
      await request('POST', '/api/suggestions', { type: draft.type, targetId, comment });
      if (generation !== state.generation) return;
      state.suggestionDraft = { type: 'player', targetId: '', comment: '' };
      state.suggestionNotice = 'Suggestion submitted. A faction leader or co-leader can review it.';
      await loadSuggestions();
    } catch (error) { if (generation === state.generation) handleError(error); }
    finally { if (generation === state.generation) { state.suggestionMutation = null; render(); } }
  }

  async function reviewSuggestion(id, decision) {
    if (!state.token || !state.canReview || state.suggestionMutation || !state.suggestions.some(row => row.id === id && row.status === 'pending')) return;
    const generation = state.generation;
    state.suggestionMutation = id; state.suggestionNotice = ''; message(''); render();
    try {
      const data = await request('POST', `/api/suggestions/${id}/review`, { decision });
      if (generation !== state.generation) return;
      const added = data.addedPlayers || 0;
      state.suggestionNotice = decision === 'approved'
        ? `Suggestion approved. ${added} ${added === 1 ? 'player added' : 'players added'} to the target pool.`
        : 'Suggestion rejected.';
      await Promise.all([loadSuggestions(), ...(decision === 'approved' ? [loadTargets(true)] : [])]);
    } catch (error) {
      if (generation !== state.generation) return;
      if (error.code === 'REVIEW_NOT_ALLOWED') {
        // An older queue response must not restore buttons after leadership was revoked.
        state.suggestionGeneration++; state.suggestionsLoading = false; state.canReview = false;
      }
      handleError(error);
    } finally { if (generation === state.generation) { state.suggestionMutation = null; render(); } }
  }

  let cardContainer, countNode;
  function render() {
    content.replaceChildren(); cardContainer = null; countNode = null;
    if (!state.player) {
      const intro = element('p', 'Find chain targets that match your stats.');
      const form = element('form', null, 'login');
      const label = element('label', 'Torn Limited API key');
      const input = element('input'); input.type = 'password'; input.maxLength = 16;
      input.autocomplete = 'off'; input.placeholder = '16-character key'; input.required = true;
      input.disabled = state.busy || state.loading; label.append(input);
      const submit = element('button', state.loading ? 'Restoring session…' : state.busy ? 'Verifying faction…' : 'Sign in', 'primary'); submit.type = 'submit'; submit.disabled = state.busy || state.loading;
      form.addEventListener('submit', event => { event.preventDefault(); const key = input.value.trim(); input.value = ''; void login(key); });
      const privacy = element('div', null, 'notice');
      privacy.append(element('div', `Your key is sent to ${new URL(base).host} and Torn for login, and kept only for this session.`),
        link('Get a Limited API key ↗', 'https://www.torn.com/preferences.php#tab=api'));
      form.append(label, submit, privacy); content.append(intro, form); return;
    }
    const player = state.player;
    const profile = element('div', null, 'profile'); const identity = element('div');
    identity.append(element('strong', `${player.name} [${player.id}]`), element('div', `${player.faction.name} · Faction ${player.faction.id}`, 'muted'));
    profile.append(identity, button('Sign out', () => void logout())); content.append(profile);
    const tabs = element('div', null, 'tabs'); tabs.setAttribute('aria-label', 'Target list sections');
    for (const [view, label] of [['targets', 'Targets'], ['suggestions', 'Suggestions']]) {
      const tab = button(label, () => {
        if (state.view === view) return;
        state.view = view; render();
        if (view === 'suggestions') void loadSuggestions();
      });
      tab.setAttribute('aria-pressed', String(state.view === view)); tabs.append(tab);
    }
    content.append(tabs);
    if (state.view === 'suggestions') { renderSuggestions(); return; }
    content.append(element('p', `Your battle stats: ${C.compact(player.battleStats.total)} total`, 'muted'));
    const grid = element('div', null, 'statgrid');
    for (const key of ['strength', 'defense', 'speed', 'dexterity']) {
      const stat = element('div', null, 'stat'); stat.append(element('small', key[0].toUpperCase() + key.slice(1)), element('strong', C.compact(player.battleStats[key]))); grid.append(stat);
    }
    content.append(grid);
    const toolbar = element('div', null, 'toolbar');
    const query = element('input'); query.type = 'search'; query.placeholder = 'Search player, faction or notes'; query.value = state.query;
    query.setAttribute('aria-label', 'Search targets'); query.addEventListener('input', () => { state.query = query.value; renderCards(); });
    const mode = element('select'); mode.setAttribute('aria-label', 'Target view');
    for (const [value, label] of [['all', 'All targets'], ['suggested', 'Possible matches']]) {
      const option = element('option', label); option.value = value; mode.append(option);
    }
    mode.value = state.mode; mode.addEventListener('change', () => { state.mode = mode.value; renderCards(); });
    toolbar.append(query, mode); content.append(toolbar);
    const controls = element('div', null, 'controls'); const ratioLabel = element('label', 'Target stats limit: ');
    const ratio = element('input'); ratio.type = 'number'; ratio.min = '1'; ratio.max = '500'; ratio.step = '5'; ratio.value = String(Math.round(state.maxRatio * 100));
    ratio.setAttribute('aria-label', 'Maximum target stats as percent of your total');
    ratio.addEventListener('change', () => {
      const value = Number(ratio.value);
      state.maxRatio = Number.isFinite(value) && value >= 1 && value <= 500 ? value / 100 : C.DEFAULT_MAX_RATIO;
      ratio.value = String(Math.round(state.maxRatio * 100)); renderCards();
    });
    ratioLabel.append(ratio, element('span', '% of yours')); controls.append(ratioLabel);
    const refresh = button(state.loading ? 'Loading…' : 'Refresh list', () => void loadTargets()); refresh.disabled = state.loading; controls.append(refresh); content.append(controls);
    countNode = element('div', null, 'count'); cardContainer = element('div', null, 'cards'); content.append(countNode, cardContainer);
    const note = element('div', null, 'footnote');
    note.append(element('p', 'Possible matches use estimated total stats, with estimates no older than 7 days. This is a rough difficulty guide: stat distribution, equipment and bonuses also affect fights.'),
      element('p', 'Check status before attacking. The attack button lasts 60 seconds after a successful check. Status can change at any time; Torn makes the final availability check.'));
    for (const warning of state.warnings) note.append(element('p', warning));
    if (state.generatedAt) note.append(element('div', `Pool updated: ${new Date(state.generatedAt).toLocaleString()}`));
    content.append(note); renderCards();
  }

  function renderSuggestions() {
    content.append(element('p', 'Suggest a player or faction for the shared target pool. Every suggestion needs a reason.', 'notice'));
    const form = element('form', null, 'suggestionform');
    const fields = element('div', null, 'suggestionfields');
    const typeLabel = element('label', 'Target type'); const type = element('select'); type.setAttribute('aria-label', 'Suggestion type');
    for (const [value, label] of [['player', 'Player'], ['faction', 'Faction']]) { const option = element('option', label); option.value = value; type.append(option); }
    type.value = state.suggestionDraft.type; type.disabled = Boolean(state.suggestionMutation);
    type.addEventListener('change', () => { if (!state.suggestionMutation) state.suggestionDraft.type = type.value; }); typeLabel.append(type);
    const idLabel = element('label', 'Player or faction ID'); const id = element('input'); id.type = 'number'; id.min = '1'; id.max = '2147483647'; id.step = '1'; id.required = true;
    id.placeholder = 'Torn ID'; id.setAttribute('aria-label', 'Player or faction ID'); id.value = state.suggestionDraft.targetId; id.disabled = Boolean(state.suggestionMutation);
    id.addEventListener('input', () => { if (!state.suggestionMutation) state.suggestionDraft.targetId = id.value; }); idLabel.append(id); fields.append(typeLabel, idLabel);
    const commentLabel = element('label', 'Reason / comment (required)'); const comment = element('textarea'); comment.required = true; comment.maxLength = 2000; comment.rows = 3;
    comment.placeholder = 'Why should this target be added?'; comment.setAttribute('aria-label', 'Reason for suggesting this target'); comment.value = state.suggestionDraft.comment; comment.disabled = Boolean(state.suggestionMutation);
    comment.addEventListener('input', () => { if (!state.suggestionMutation) state.suggestionDraft.comment = comment.value; }); commentLabel.append(comment, element('small', 'Up to 1,000 characters. Your name and faction are shown with the suggestion.'));
    const submit = element('button', state.suggestionMutation === 'submit' ? 'Submitting…' : 'Submit suggestion', 'primary'); submit.type = 'submit'; submit.disabled = Boolean(state.suggestionMutation);
    form.addEventListener('submit', event => { event.preventDefault(); void submitSuggestion(); });
    form.append(fields, commentLabel, submit); content.append(form);
    if (state.suggestionNotice) { const notice = element('div', state.suggestionNotice, 'success'); notice.setAttribute('role', 'status'); content.append(notice); }
    const queueHeader = element('div', null, 'queueheader'); queueHeader.append(element('h3', 'Target suggestions'));
    const refresh = button(state.suggestionsLoading ? 'Loading…' : 'Refresh suggestions', () => void loadSuggestions()); refresh.disabled = state.suggestionsLoading || Boolean(state.suggestionMutation); queueHeader.append(refresh); content.append(queueHeader);
    const views = element('div', null, 'tabs'); views.setAttribute('aria-label', 'Suggestion views');
    for (const [view, label] of [['pending', 'Pending suggestions'], ['mine', 'My suggestions']]) {
      const tab = button(label, () => { if (state.suggestionView !== view) void loadSuggestions(view); });
      tab.setAttribute('aria-pressed', String(state.suggestionView === view)); tab.disabled = Boolean(state.suggestionMutation); views.append(tab);
    }
    content.append(views);
    content.append(element('p', state.canReview
      ? 'You can approve or reject suggestions as a current faction leader or co-leader. Approving a faction adds its current players to the target pool.'
      : 'Faction leaders and co-leaders can approve or reject suggestions. Approving a faction adds its current players to the target pool.', 'notice'));
    const queue = element('div', null, 'cards suggestionqueue'); content.append(queue);
    if (!state.suggestions.length) queue.append(element('div', state.suggestionsLoading ? 'Loading suggestions…' : state.suggestionView === 'mine' ? 'You have not suggested any targets yet.' : 'There are no pending suggestions.', 'empty'));
    for (const row of state.suggestions) {
      const card = element('article', null, 'card suggestioncard'); const top = element('div', null, 'cardhead'); const identity = element('div');
      const href = row.type === 'faction' ? `https://www.torn.com/factions.php?step=profile&ID=${row.targetId}` : `https://www.torn.com/profiles.php?XID=${row.targetId}`;
      identity.append(link(`${row.targetName || (row.type === 'faction' ? 'Faction' : 'Player')} [${row.targetId}] ↗`, href, 'name'), element('div', row.type === 'faction' ? 'Faction · current players added on approval' : 'Player', 'muted'));
      top.append(identity, element('span', row.status, `badge ${row.status === 'pending' ? 'warn' : row.status === 'rejected' ? 'muted' : ''}`)); card.append(top);
      card.append(element('div', row.comment, 'comment'));
      const actor = row.suggestedBy;
      card.append(element('div', `Suggested by ${actor.name} [${actor.id}] · ${actor.faction.name} [${actor.faction.id}]`, 'muted'), element('div', new Date(row.createdAt).toLocaleString(), 'muted'));
      if (row.reviewedBy) card.append(element('div', `${row.status === 'approved' ? 'Approved' : 'Rejected'} by ${row.reviewedBy.name} [${row.reviewedBy.id}]${row.reviewedAt ? ` · ${new Date(row.reviewedAt).toLocaleString()}` : ''}`, 'muted'));
      if (state.canReview && row.status === 'pending') {
        const actions = element('div', null, 'actions');
        for (const [decision, label] of [['approved', 'Approve'], ['rejected', 'Reject']]) {
          const action = button(label, () => void reviewSuggestion(row.id, decision), decision === 'approved' ? 'primary' : '');
          action.disabled = Boolean(state.suggestionMutation) || state.suggestionsLoading; actions.append(action);
        }
        card.append(actions);
      }
      queue.append(card);
    }
    if (state.nextSuggestionOffset !== null) {
      const more = button(state.suggestionsLoading ? 'Loading…' : 'Load more suggestions', () => void loadSuggestions(state.suggestionView, true));
      more.disabled = state.suggestionsLoading || Boolean(state.suggestionMutation); const footer = element('div', null, 'queuefooter'); footer.append(more); content.append(footer);
    }
  }

  function renderCards() {
    if (!state.player || !cardContainer) return;
    const rows = C.select(state.targets, state.player, state);
    const suggestions = state.targets.filter(t => C.assess(t, state.player, state.maxRatio).suggested).length;
    countNode.textContent = state.loading ? 'Loading the faction’s target pool…' : `${rows.length} shown · ${state.targets.length} in pool · ${suggestions} possible matches`;
    cardContainer.replaceChildren();
    if (!rows.length && !state.loading) {
      const text = state.targets.length ? 'No targets match these filters. Try All targets or a different stat limit.' : 'The target pool is empty. New targets will appear after your faction’s list is updated.';
      cardContainer.append(element('div', text, 'empty')); return;
    }
    for (const { target, assessment } of rows) {
      const card = element('article', null, 'card'); const top = element('div', null, 'cardhead'); const name = element('div');
      name.append(link(`${target.name || 'Player'} [${target.id}] ↗`, `https://www.torn.com/profiles.php?XID=${target.id}`, 'name'),
        element('div', `${target.faction?.name || 'Faction unknown'}${target.level ? ` · Level ${target.level}` : ''}`, 'muted'));
      top.append(name, element('span', assessment.label, `badge ${assessment.tone}`)); card.append(top);
      const metrics = element('div', null, 'metrics');
      const stats = element('div'); stats.append(element('small', 'Estimated battle stats'), element('strong', C.compact(target.estimatedStats)), element('small', `${target.estimateSource || 'No estimate'} · ${C.ageLabel(target.estimateUpdatedAt)}`));
      const comparison = element('div'); comparison.append(element('small', 'Compared with you'), element('strong', assessment.ratio === null ? 'Unknown' : `${(assessment.ratio * 100).toFixed(0)}% of your stats`));
      const status = element('div');
      status.append(element('small', assessment.live ? 'Status checked just now' : 'Status needs checking'), element('strong', target.status?.state || 'Unknown'),
        element('small', target.lastAction ? `Last active ${C.ageLabel(target.lastAction)}` : 'Activity unknown'));
      if (target.status?.until > Date.now() / 1000) status.append(element('small', `Until ${new Date(target.status.until * 1000).toLocaleTimeString()}`));
      metrics.append(stats, comparison, status); card.append(metrics);
      if (target.notes) card.append(element('div', target.notes, 'notes'));
      const actions = element('div', null, 'actions');
      const check = button(state.pendingChecks.has(target.id) ? 'Checking…' : 'Check status', () => void checkStatus(target.id)); check.disabled = state.pendingChecks.has(target.id) || state.loading;
      actions.append(check);
      if (assessment.ready) {
        const attack = link('Attack ↗', `https://www.torn.com/loader.php?sid=attack&user2ID=${target.id}`, 'attack');
        const guardAttack = event => {
          const latest = state.targets.find(t => t.id === target.id);
          if (!latest || !state.token || Date.parse(state.expiresAt) <= Date.now() || !C.assess(latest, state.player, state.maxRatio).ready) {
            event.preventDefault(); message('Check this target’s status again before opening an attack.'); renderCards();
          }
        };
        attack.addEventListener('click', guardAttack);
        attack.addEventListener('auxclick', guardAttack);
        actions.append(attack);
      } else actions.append(element('small', assessment.live ? target.status?.description || 'Unavailable right now' : 'Check availability to open attack'));
      card.append(actions); cardContainer.append(card);
    }
  }

  function toggle(open) {
    state.open = open; panel.hidden = !open; launcher.setAttribute('aria-expanded', String(open));
    if (open && state.token && !state.player) void loadTargets();
  }
  const saved = GM_getValue(storageKey, null);
  if (saved?.token && Date.parse(saved.expiresAt) > Date.now()) {
    state.token = saved.token; state.expiresAt = saved.expiresAt;
  } else GM_deleteValue(storageKey);
  root.addEventListener('keydown', event => { if (event.key === 'Escape') toggle(false); });
  // Expire the session and checked attack links even while the panel is idle.
  setInterval(() => {
    if (state.token && Date.parse(state.expiresAt) <= Date.now()) { clearSession(); message('Session expired. Sign in again.'); render(); }
    else if (state.open && state.player && !state.pendingChecks.size) {
      let expired = false;
      state.targets = state.targets.map(target => {
        if (target.checkedAt && !C.assess(target, state.player, state.maxRatio).live) {
          expired = true; return { ...target, checkedAt: null };
        }
        return target;
      });
      if (expired) renderCards();
    }
  }, 5000);
  render();
}
