"""Prints the lines of the install prompt Firefox shows for this checkout's manifest, as Firefox
itself words them (read in a throwaway browser profile). Used for store/permissions.md."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "e2e"))
from common import ROOT, Context  # noqa: E402

ctx = Context(install=False)
try:
    xpi = os.path.join(ROOT, "dist", "sip.xpi")
    lines = ctx.chrome_js(f"""
      const {{ ExtensionData }} = ChromeUtils.importESModule('resource://gre/modules/Extension.sys.mjs');
      const {{ AddonManager }} = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
      const {{ FileUtils }} = ChromeUtils.importESModule('resource://gre/modules/FileUtils.sys.mjs');
      const install = await AddonManager.getInstallForFile(new FileUtils.File({json.dumps(xpi)}));
      const addon = install.addon;
      const result = ExtensionData.formatPermissionStrings({{
        addon, permissions: addon.installPermissions, optionalPermissions: addon.optionalPermissions, type: 'extension',
      }}, {{ fullDomainsList: true, buildOptionalOrigins: true }});
      install.cancel();
      return {{ required: result.msgs, optional: Object.values(result.optionalOrigins || {{}}).concat(Object.values(result.optionalPermissions || {{}})),
               data: result.dataCollectionPermissions?.msg ?? null, installPermissions: addon.installPermissions }};
    """)
    print(json.dumps(lines, indent=2, ensure_ascii=False))
finally:
    ctx.stop()
