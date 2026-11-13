"""Packs the extension into dist/sip.xpi (a zip that Firefox, Zen and Chrome all accept)."""
import os
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FILES = ["manifest.json", "lib.js", "background.js", "content.js", "autoplay.js",
         "popup.html", "popup.js", "options.html", "options.js", "style.css"]

os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
out = os.path.join(ROOT, "dist", "sip.xpi")
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for name in FILES:
        z.write(os.path.join(ROOT, name), name)
    for icon in sorted(os.listdir(os.path.join(ROOT, "icons"))):
        z.write(os.path.join(ROOT, "icons", icon), f"icons/{icon}")
print(out)
