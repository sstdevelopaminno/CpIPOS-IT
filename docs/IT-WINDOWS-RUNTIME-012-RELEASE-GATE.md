# CpIPOS IT Admin Windows Runtime v0.1.2 — release gate

Source patch only; no installer was published by this change.

- Source login host is **cp-ipos-it-web.vercel.app/it-admin/login**, not the customer POS host.
- The wrapper rejects arbitrary production domains and accepts localhost custom URLs only with the explicit development flag.
- WebView2 surfaces HTTP 404 and >=500 as an error page with retry, not a blank customer POS window.
- Pull requests run a Windows .NET compile without releasing artifacts.
- The manual release workflow **fails before packaging/publishing** unless the independent IT login returns HTTP 200, contains the IT route, and is not the customer POS store-login page.
- Confirm actual Production alias, login, and installer launch on a test Windows machine before treating v0.1.2 as released or closing MDM issue #39.

If the IT Vercel project has been renamed, update the exact allowlisted hostname, GitHub Actions gate and smoke-test together; do not silently fall back to cp-ipos-web.vercel.app.
