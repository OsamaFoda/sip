# Why Sip asks for each permission

For the AMO review's "permission reasons", and for anyone reading the install prompt.

| Permission | Why |
|---|---|
| `<all_urls>` (host access) | To count the data every site uses (`webRequest` only reports requests to sites the add-on may access) and to apply the savers on any site you visit. |
| `webRequest` | To read the size of each request and response as Firefox counted it, and which site it belongs to. Sip never changes or blocks requests through it (there is no `webRequestBlocking`). |
| `declarativeNetRequestWithHostAccess` | The savers: blocking heavy trackers, images or web fonts, and adding the optional `Save-Data: on` header, with rules the browser applies itself. Unlike `declarativeNetRequest`, it adds no "Block content on any page" line to the install prompt, because it works only where host access is granted. |
| `scripting` | To register the autoplay saver and the YouTube quality limit as content scripts, only where they apply. |
| `storage` | To keep your settings and daily totals on your device. |
| `notifications` | The 75%, 90% and 100% budget warnings, and the weekly pace warning. |
| `alarms` | To start a new day at local midnight (pruning old days and refreshing the summary). |

## The install prompt

Recorded from Astrelle 153 (Firefox ESR 153) with `python3 tools/install_prompt.py`, which asks
Firefox to word the prompt for the built `dist/sip.xpi`:

- Access your data for all websites
- Display notifications to you
- The developer says this extension doesn't require data collection.

There is no separate "Block content on any page" line.
