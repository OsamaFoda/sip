# Sip — Data Saver

A browser extension for people on capped or expensive internet. Sip shows how much data each
site uses, keeps you inside a monthly budget, and cuts the waste.

- **Data meter**: today and this billing period, with the sites using the most.
- **Monthly budget**: your quota and renewal day; a toolbar badge shows the percentage used,
  and the popup shows what's safe to use today. Notifications at 75%, 90% and 100%.
- **Savers** (each can be switched off, and any site can be allowed):
  - stop autoplaying and preloading video
  - block third-party ads and trackers
  - block images (off by default)
  - block web fonts (off by default)

Works in Firefox, Zen and other Firefox-based browsers (128+), and in Chrome, Edge and Brave.
Everything stays on your device.

## How accurate is the meter?

Sip counts what this browser downloads: each response's headers plus its `Content-Length`,
with the page's own timing data filling in responses that arrive without a length. Cached
files count as free. It doesn't see other browsers, apps or your phone, so your carrier's
counter remains the official number.

## Try it in Zen or Firefox

```bash
python3 tools/build.py
```

Then open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and pick
`dist/sip.xpi`. It stays loaded until the browser restarts. A permanent install needs the
add-on to be signed by Mozilla (free, through addons.mozilla.org).

## Try it in Chrome, Edge or Brave

Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick this
folder.

## Tests

```bash
node --test               # logic: byte counting, billing periods, rules
python3 tools/e2e_zen.py  # the real extension in a headless Zen, against a local test server
```

The end-to-end test uses no internet: it serves its own pages from `127.0.0.1`.

## Layout

| File | What it does |
| --- | --- |
| `lib.js` | Pure logic shared by everything, tested in Node |
| `background.js` | Meters responses, stores daily totals, applies saver rules, badge, warnings |
| `content.js` | Reports transfer sizes the headers didn't give |
| `autoplay.js` | Stops media from autoplaying or preloading; registered only while that saver is on |
| `popup.*`, `options.*`, `style.css` | The interface |
| `tools/` | Icon drawing, packaging, end-to-end test |
