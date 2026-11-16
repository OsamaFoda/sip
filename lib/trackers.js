// Heavy ad and tracker hosts that cost data on page after page and do nothing for the reader.
//
// This list is Sip's own curation, released under the MPL-2.0 like the rest of Sip. It is kept
// short on purpose: each host is matched with its subdomains, only when another site loads it
// (a third-party request), and it never includes anything a page needs to work: sign-in,
// payments, CAPTCHAs, consent dialogs, maps, fonts or code libraries. For much more blocking,
// use a full content blocker such as uBlock Origin alongside Sip.
//
// kind: 'ads' | 'analytics' | 'social' | 'session-replay' | 'consent' | 'video-ads'

const list = {
  ads: [
    'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'googletagservices.com',
    'adservice.google.com', 'adservice.google.com.eg', '2mdn.net', 'adtrafficquality.google',
    'amazon-adsystem.com', 'assoc-amazon.com', 'adnxs.com', 'adnxs-simple.com', 'criteo.com',
    'criteo.net', 'taboola.com', 'outbrain.com', 'outbrainimg.com', 'zemanta.com', 'pubmatic.com',
    'openx.net', 'rubiconproject.com', 'casalemedia.com', 'indexww.com', 'adroll.com',
    'adsrvr.org', 'mathtag.com', 'smartadserver.com', 'sascdn.com', 'teads.tv',
    'sharethrough.com', 'media.net', 'yieldmo.com', 'mgid.com', 'adskeeper.com',
    'revcontent.com', 'propellerads.com', 'popads.net', 'popcash.net', 'adcash.com',
    'adform.net', 'adformdsp.net', '3lift.com', 'triplelift.com', '33across.com',
    'bidswitch.net', 'sonobi.com', 'gumgum.com', 'lijit.com', 'contextweb.com', 'smaato.net',
    'yieldlab.net', 'adition.com', 'adscale.de', 'stackadapt.com', 'serving-sys.com',
    'flashtalking.com', 'rtbhouse.com', 'creativecdn.com', 'adkernel.com', 'onetag-sys.com',
    'emxdgt.com', 'kargo.com', 'undertone.com', 'dotomi.com', 'advertising.com', 'bidr.io',
    'seedtag.com', 'speakol.com', 'exoclick.com', 'exosrv.com', 'exdynsrv.com', 'juicyads.com',
    'trafficjunky.net', 'trafficstars.com', 'adsterra.com', 'hilltopads.net', 'clickadu.com',
    'a-ads.com', 'coinzilla.com', 'bitmedia.io', 'skimresources.com', 'skimlinks.com',
    'viglink.com', 'an.yandex.ru', 'yandexadexchange.net', 'cpro.baidu.com', 'pos.baidu.com',
    'ad.mail.ru', 'ads.yahoo.com', 'improvedigital.com', '360yield.com', 'adsafeprotected.com',
    'doubleverify.com', 'dvtps.com', 'moatads.com', 'grapeshot.co.uk', 'everesttech.net',
    'ads-twitter.com',
  ],
  'video-ads': [
    'imasdk.googleapis.com', 'innovid.com', 'spotxchange.com', 'spotx.tv', 'springserve.com',
    'fwmrm.net', 'tremorhub.com', 'unrulymedia.com', 'rhythmone.com', 'connatix.com',
    'primis.tech', 'aniview.com', 'vidazoo.com', 'anyclip.com',
  ],
  analytics: [
    'google-analytics.com', 'analytics.google.com', 'googletagmanager.com',
    'scorecardresearch.com', 'quantserve.com', 'quantcount.com', 'imrworldwide.com',
    'exelator.com', 'chartbeat.com', 'chartbeat.net', 'parsely.com', 'segment.io', 'segment.com',
    'mixpanel.com', 'mxpnl.com', 'amplitude.com', 'heapanalytics.com', 'matomo.cloud',
    'statcounter.com', 'histats.com', 'getclicky.com', 'woopra.com', 'stats.wp.com',
    'pixel.wp.com', 'js-agent.newrelic.com', 'nr-data.net', 'browser-intake-datadoghq.com',
    'browser-intake-datadoghq.eu', 'go-mpulse.net', 'jwpltx.com', 'metrics.brightcove.com',
    'hm.baidu.com', 'mc.yandex.ru', 'mc.yandex.com', 'top-fwz1.mail.ru', 'analytics.yahoo.com',
    'bat.bing.com', 'analytics.tiktok.com', 'analytics.twitter.com', 'munchkin.marketo.net',
    'pi.pardot.com', 'hs-analytics.net', 'demdex.net', 'omtrdc.net', '2o7.net', 'krxd.net',
    'bluekai.com', 'agkn.com', 'rlcdn.com', 'crwdcntrl.net', 'tapad.com', 'liadm.com',
    'id5-sync.com', 'zeotap.com', 'intentiq.com', 'uidapi.com', 'eyeota.net', 'permutive.com',
    'permutive.app',
  ],
  social: [
    'connect.facebook.net', 'px.ads.linkedin.com', 'snap.licdn.com', 'ct.pinterest.com',
    'tr.snapchat.com', 'sc-static.net', 'q.quora.com', 'addthis.com', 'sharethis.com',
  ],
  'session-replay': [
    'hotjar.com', 'hotjar.io', 'clarity.ms', 'mouseflow.com', 'fullstory.com', 'smartlook.com',
    'smartlook.cloud', 'luckyorange.com', 'luckyorange.net', 'inspectlet.com',
    'quantummetric.com', 'contentsquare.net', 'clicktale.net', 'crazyegg.com', 'lr-ingest.io',
    'logr-ingest.com',
  ],
};

export const TRACKERS = Object.entries(list)
  .flatMap(([kind, hosts]) => hosts.map(host => ({ host, kind })))
  .sort((a, b) => (a.host < b.host ? -1 : 1));

export const TRACKER_HOSTS = TRACKERS.map(t => t.host);
