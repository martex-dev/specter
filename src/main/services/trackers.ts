// Built-in list of well-known third-party tracking / advertising hosts.
// Only blocked when loaded as a third-party resource. This is deliberately a
// compact list (not a full filter-list engine); SPECTER reports its size
// honestly in the Privacy Center.
export const TRACKER_DOMAINS: string[] = [
  // Google advertising / analytics
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'google-analytics.com', 'googletagmanager.com',
  'googletagservices.com', 'adservice.google.com', 'pagead2.googlesyndication.com', 'app-measurement.com', 'imasdk.googleapis.com',
  // Meta
  'connect.facebook.net', 'pixel.facebook.com', 'an.facebook.com',
  // Microsoft / Bing ads & clarity
  'bat.bing.com', 'clarity.ms', 'ads.msn.com', 'adnxs.com', 'adnxs-simple.com',
  // Amazon ads
  'amazon-adsystem.com', 'assoc-amazon.com',
  // Twitter/X, LinkedIn, TikTok, Pinterest, Snap, Reddit pixels
  'ads-twitter.com', 'analytics.twitter.com', 'static.ads-twitter.com', 'px.ads.linkedin.com', 'snap.licdn.com', 'analytics.tiktok.com',
  'ct.pinterest.com', 'tr.snapchat.com', 'sc-static.net', 'alb.reddit.com', 'events.redditmedia.com',
  // Ad exchanges / SSPs / DSPs
  'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com', 'rubiconproject.com', 'pubmatic.com', 'openx.net', 'casalemedia.com',
  'indexww.com', 'smartadserver.com', 'adsrvr.org', 'mathtag.com', 'bidswitch.net', 'contextweb.com', 'sharethrough.com', 'triplelift.com',
  '3lift.com', 'yieldmo.com', 'teads.tv', 'media.net', 'moatads.com', 'adform.net', 'adition.com', 'spotxchange.com', 'spotx.tv',
  'springserve.com', 'smaato.net', 'inmobi.com', 'mopub.com', 'lijit.com', 'sovrn.com', 'gumgum.com', 'districtm.io', 'emxdgt.com',
  'onetag-sys.com', 'richaudience.com', 'improvedigital.com', '33across.com', 'yieldlab.net', 'adkernel.com', 'zemanta.com',
  'revcontent.com', 'mgid.com', 'adroll.com', 'quantserve.com', 'quantcount.com', 'scorecardresearch.com', 'serving-sys.com',
  'flashtalking.com', 'eyeota.net', 'bluekai.com', 'demdex.net', 'everesttech.net', 'omtrdc.net', 'krxd.net', 'exelator.com',
  'rlcdn.com', 'tapad.com', 'agkn.com', 'crwdcntrl.net', 'adsymptotic.com', 'liadm.com', 'id5-sync.com', 'bidr.io', 'turn.com',
  'advertising.com', 'adtechus.com', 'yahoo-ads.com', 'ads.yahoo.com', 'analytics.yahoo.com', 'gemini.yahoo.com',
  // Product analytics / session replay
  'hotjar.com', 'hotjar.io', 'mouseflow.com', 'fullstory.com', 'crazyegg.com', 'luckyorange.com', 'luckyorange.net', 'inspectlet.com',
  'smartlook.com', 'sessioncam.com', 'quantummetric.com', 'contentsquare.net', 'decibelinsight.net', 'heapanalytics.com',
  'mixpanel.com', 'segment.io', 'segment.com', 'cdn.segment.com', 'amplitude.com', 'kissmetrics.com', 'chartbeat.com', 'chartbeat.net',
  'newrelic.com', 'nr-data.net', 'pingdom.net', 'mxpnl.com', 'branch.io', 'app.link', 'adjust.com', 'appsflyer.com', 'kochava.com',
  'optimizely.com', 'omniture.com', '2o7.net', 'statcounter.com', 'histats.com', 'clicky.com', 'getclicky.com', 'woopra.com',
  'yandex.ru/metrika', 'mc.yandex.ru', 'top-fwz1.mail.ru', 'counter.yadro.ru', 'tns-counter.ru',
  // Consent-wall / fingerprinting / misc trackers
  'addthis.com', 'addtoany.com', 'sharethis.com', 'po.st', 'disqusads.com', 'zergnet.com', 'bounceexchange.com', 'bouncex.net',
  'permutive.com', 'permutive.app', 'lotame.com', 'narrative.io', 'zeotap.com', 'intentiq.com', 'semasio.net', 'weborama.fr',
  'adsafeprotected.com', 'doubleverify.com', 'iasds01.com', 'imrworldwide.com', 'nielsen.com', 'comscore.com', 'parsely.com',
  'parse.ly', 'onesignal.com', 'pushcrew.com', 'pushengage.com', 'hubspot.net/analytics', 'hs-analytics.net', 'hsadspixel.net',
  'marketo.net', 'mktoresp.com', 'pardot.com', 'trkn.us', 'tru.am', 'trafficjunky.net', 'exoclick.com', 'popads.net', 'propellerads.com',
  'adcash.com', 'juicyads.com', 'adsterra.com', 'hilltopads.net', 'clickadu.com', 'popcash.net'
].filter((d) => !d.includes('/'))
