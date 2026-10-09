const TargetListCore = (() => {
  const DEFAULT_MAX_RATIO = 0.6;
  const ESTIMATE_MAX_AGE = 7 * 24 * 60 * 60;
  const LIVE_STATUS_MAX_AGE = 30 * 1000;

  function serviceUrl(value) {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
      throw new Error('Use an HTTPS service address, or HTTP on localhost for development.');
    }
    return url.href.replace(/\/$/, '');
  }

  function validKey(value) { return /^[a-zA-Z0-9]{16}$/.test(value); }
  function positive(value) { return typeof value === 'number' && Number.isFinite(value) && value > 0; }
  function compact(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'Unknown';
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
  }
  function ageLabel(timestamp, now = Date.now()) {
    if (!positive(timestamp)) return 'Date unknown';
    const seconds = Math.max(0, Math.floor(now / 1000 - timestamp));
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  function assess(target, player, maxRatio = DEFAULT_MAX_RATIO, now = Date.now()) {
    const ratio = positive(target.estimatedStats) && positive(player.battleStats.total)
      ? target.estimatedStats / player.battleStats.total : null;
    const stamp = target.estimateUpdatedAt;
    const fresh = positive(stamp) && stamp <= now / 1000 + 300 && now / 1000 - stamp <= ESTIMATE_MAX_AGE;
    const allied = target.id === player.id || (target.faction?.id && target.faction.id === player.faction.id);
    const checked = Date.parse(target.checkedAt);
    const live = Number.isFinite(checked) && checked <= now + 5000 && now - checked < LIVE_STATUS_MAX_AGE;
    const until = target.status?.until;
    const validUntil = until == null || (typeof until === 'number' && Number.isSafeInteger(until) && until >= 0);
    const timedUnavailable = validUntil && typeof until === 'number' && until > now / 1000;
    const ready = live && target.status?.state === 'Okay' && validUntil && !timedUnavailable && !allied;
    let label = 'Possible match';
    let tone = 'good';
    if (allied) { label = 'Friendly / self'; tone = 'muted'; }
    else if (ratio === null) { label = 'Stats unknown'; tone = 'muted'; }
    else if (!fresh) { label = 'Estimate needs refresh'; tone = 'warn'; }
    else if (ratio > maxRatio) { label = 'Above your limit'; tone = 'warn'; }
    const suggested = !allied && ratio !== null && fresh && ratio <= maxRatio;
    return { ratio, fresh, live, ready, timedUnavailable, suggested, label, tone };
  }

  function select(targets, player, options, now = Date.now()) {
    const query = (options.query || '').trim().toLowerCase();
    return targets.map(target => ({ target, assessment: assess(target, player, options.maxRatio, now) }))
      .filter(({ target, assessment }) => {
        if (options.mode === 'suggested' && !assessment.suggested) return false;
        return !query || `${target.id} ${target.name} ${target.faction?.name || ''} ${target.notes || ''}`.toLowerCase().includes(query);
      })
      .sort((a, b) => Number(b.assessment.suggested) - Number(a.assessment.suggested) ||
        (a.assessment.ratio ?? Infinity) - (b.assessment.ratio ?? Infinity) || a.target.id - b.target.id);
  }

  return { DEFAULT_MAX_RATIO, ESTIMATE_MAX_AGE, LIVE_STATUS_MAX_AGE, serviceUrl, validKey, compact, ageLabel, assess, select };
})();
