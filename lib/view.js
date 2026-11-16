// What the popup (and options and first run) render: the summary plus the details only Sip's own
// pages need. Built fresh by the background for each `view` message.

import { budgetState } from './budget.js';
import { hostOf } from './meter.js';
import { effective, isYoutubeHost, levelOf, overrideFor } from './savers.js';
import { dayKey, topSites } from './store.js';
import { summaryFrom } from './summary.js';

export function buildView({
  settings, days, carrier, now = new Date(), tabUrl, tabIncognito = false,
  privateAllowed = false, hostAccess = true, astrelle = false, ...opts
}) {
  const state = budgetState({ settings, days, carrier, now });
  const summary = summaryFrom(state, settings, now, opts);
  const todaySites = days[dayKey(now)]?.sites || {};

  let site = null;
  const host = hostOf(tabUrl);
  if (host) {
    const rule = overrideFor(settings, host);
    site = {
      host,
      today: tabIncognito ? 0 : todaySites[host] || 0,
      period: tabIncognito ? 0 : state.sites[host] || 0,
      private: !!tabIncognito,
      effective: effective(settings, host),
      overrides: rule ? rule.overrides : null,
      overrideHost: rule ? rule.host : null,
      isYoutube: isYoutubeHost(host),
    };
  }

  return {
    summary,
    settings,
    savingLevel: levelOf(settings),
    overheadBytes: state.overheadBytes,
    otherBytes: state.otherBytes,
    todaySites: topSites(todaySites, 5, { buckets: true }),
    periodSites: topSites(state.sites, 5, { buckets: true }),
    site,
    privateAllowed: !!privateAllowed,
    hostAccess: !!hostAccess,
    astrelle: !!astrelle,
    firstRun: !settings.firstRunDone && !astrelle,
  };
}
