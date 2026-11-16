# Sip — Data Saver

Sip is a browser add-on for people on capped data plans. It counts the data this browser uses,
site by site, warns you before you run out, and saves data where it can. It's built for Firefox
(and Astrelle, which bundles it). Everything stays on your device.

## What it does

- **What's left, at a glance.** The popup leads with how much of your plan is left and how many
  days until it renews. A bar shows what you've used and, hatched, where your current pace ends
  by renewal, with an "On track", "Too fast" or "Over budget" label. Below it, today against
  today's fair share of what's left.
- **Budget that matches your carrier.** Monthly on a day you choose, or every N days. Enter
  what your carrier says you've used (or what's left) and Sip counts on from there. A network
  overhead estimate (+5% by default) covers what a browser never sees.
- **Warnings** at 75%, 90% and 100%, and once a week if you're on pace to run out more than three
  days early. Clicking one opens Sip.
- **Saving levels:** Light (heavy trackers), Balanced (also autoplay; the default) and Max
  (also images), or Off to pause. Each saver can also be set on its own, and per site.
- **YouTube quality** is the person's own choice (240p to 1080p, or no limit; 480p to start).
  Saving levels never change it.
- **What Sip saved:** requests blocked, videos stopped, and an estimate of the data, from
  averages measured in this browser.
- English and Arabic (right to left), light and dark.

## How accurate is it?

Sip counts what this browser sends and receives using Firefox's own byte counts
(`responseSize` and `requestSize` in `webRequest`), including headers, uploads and transfers
stopped halfway. Each gap below makes Sip read **low**, never high:

| Not seen by Sip | Why |
|---|---|
| Other apps and devices | Sip only sees this browser. Enter "used so far" to line up with your carrier. |
| Browser and add-on updates, other background downloads | They don't go through `webRequest`. |
| WebSocket and WebRTC traffic (video calls, live connections) | `webRequest` sees only the start of a WebSocket, and WebRTC not at all. |
| Encryption (TLS) and packet (IP/TCP) overhead | A browser never sees it. This is what the overhead estimate is for: 5% by default, adjustable. |
| Redirect hops | Firefox reports no sizes for them, so Sip counts their headers only. |

On Chrome, sizes come from response headers and the page's timing data instead, which misses
more; Sip 1.0 is built and tested for Firefox.

Your carrier's counter is the official one. Check it now and then, and enter it under Your plan.

## For more blocking

Sip's tracker list is short on purpose (a few hundred of the heaviest hosts, Sip's own curation
under the MPL-2.0). For ads and many more trackers, use [uBlock Origin](https://ublockorigin.com)
alongside Sip; they work well together.

## Install

- **Firefox:** from addons.mozilla.org (once it's listed), or, to try this checkout,
  `about:debugging` → This Firefox → Load Temporary Add-on → `manifest.json`.
- **Astrelle** bundles Sip and turns it on from its welcome screen.

## Development

    python3 tools/build.py          # merge strings into _locales/, pack dist/sip.xpi
    node --test                     # unit tests (no browser needed)
    python3 tools/e2e/run.py        # end-to-end cases in a real Astrelle, all local
    python3 tools/release_check.py  # everything above, plus the release rules

The end-to-end cases start Astrelle (or `SIP_BROWSER`) headless with a throwaway profile and a
local server as its proxy, so every hostname is answered on 127.0.0.1 and nothing reaches the
internet.

### Files

| Path | What it is |
|---|---|
| `manifest.json` | The add-on's manifest (MV3) |
| `background.js` | Metering, storage, rules and scripts, the summary, badge and warnings |
| `lib/` | Pure modules (settings, store, meter, period, budget, savers, trackers, summary, view, format, i18n, migrate) |
| `autoplay.js`, `autoplay-main.js` | The autoplay saver, in Sip's world and the page's |
| `youtube-quality.js`, `youtube-player.js`, `youtube/` | The YouTube quality limit |
| `content.js` | Chrome only: sizes from the page's timing data |
| `popup.html`, `popup.js` | The popup |
| `options.html`, `options.js` | Settings and first run |
| `style.css`, `ui/` | The look and shared page code |
| `locales/` | Strings by language and part; `_locales/` is generated from them |
| `tests/` | Unit tests |
| `tools/e2e/` | End-to-end cases |
| `store/` | Store listing, permissions, screenshots and the Arabic review sheet |
| `PRIVACY.md`, `LICENSE` | Privacy statement; the MPL-2.0 |

## Releasing

1. `python3 tools/release_check.py` passes.
2. Upload `dist/sip.xpi` to addons.mozilla.org as a listed add-on, with the texts in
   `store/` and the screenshots in `store/screenshots/`. Review can take days to weeks; don't
   upload another version while one is waiting.
3. Once AMO signs it, copy the signed file into Astrelle as
   `ui/extensions/sip@osamafoda.github.io.xpi` (same version) and commit there.

## Licence

[Mozilla Public License 2.0](LICENSE).
