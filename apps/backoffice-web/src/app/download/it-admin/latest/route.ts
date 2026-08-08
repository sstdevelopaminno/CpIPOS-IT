import { NextResponse } from "next/server";

const releaseApiUrl = "https://api.github.com/repos/sstdevelopaminno/CpIPOS-IT/releases/tags/it-admin-runtime-latest";
const assetName = "CpIPOS-ITAdminRuntime-Setup.exe";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch(releaseApiUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "CpIPOS-ITAdminRuntime-Download"
      }
    });

    if (!response.ok) {
      return notReady("เนเธเธฅเนเธ•เธดเธ”เธ•เธฑเนเธ CpIPOS IT Admin เธเธณเธฅเธฑเธเธ–เธนเธเธชเธฃเนเธฒเธ เธเธฃเธธเธ“เธฒเธฃเธญเธชเธฑเธเธเธฃเธนเนเนเธฅเนเธงเธเธ”เธ”เธฒเธงเธเนเนเธซเธฅเธ”เธญเธตเธเธเธฃเธฑเนเธ");
    }

    const release = (await response.json()) as {
      assets?: Array<{
        name?: string;
        browser_download_url?: string;
      }>;
    };

    const asset = release.assets?.find((item) => item.name === assetName);
    if (!asset?.browser_download_url) {
      return notReady("เธเธเธซเธเนเธฒ Release เนเธฅเนเธง เนเธ•เนเนเธเธฅเนเธ•เธดเธ”เธ•เธฑเนเธ CpIPOS IT Admin เธขเธฑเธเนเธกเนเธ–เธนเธเนเธเธ เธเธฃเธธเธ“เธฒเธฃเธญเธชเธฑเธเธเธฃเธนเนเนเธฅเนเธงเธเธ”เธ”เธฒเธงเธเนเนเธซเธฅเธ”เธญเธตเธเธเธฃเธฑเนเธ");
    }

    return NextResponse.redirect(asset.browser_download_url, 302);
  } catch {
    return notReady("เธขเธฑเธเธ•เธฃเธงเธเธชเธญเธเนเธเธฅเนเธ•เธดเธ”เธ•เธฑเนเธเนเธกเนเนเธ”เน เธเธฃเธธเธ“เธฒเธฅเธญเธเนเธซเธกเนเธญเธตเธเธเธฃเธฑเนเธ");
  }
}

function notReady(reason: string) {
  const html = `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CpIPOS IT Admin เธเธณเธฅเธฑเธเน€เธ•เธฃเธตเธขเธกเธ•เธฑเธงเธ•เธดเธ”เธ•เธฑเนเธ</title>
  <style>
    body{margin:0;min-height:100vh;background:#020617;color:#f8fafc;font-family:Tahoma,Arial,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
    main{max-width:780px;border:1px solid #334155;border-radius:24px;background:#0f172a;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.35)}
    h1{font-size:28px;margin:0 0 12px}p{line-height:1.7;color:#cbd5e1}.note{display:block;background:#020617;border:1px solid #334155;border-radius:12px;padding:12px;color:#bae6fd}.btn{display:inline-block;margin-top:16px;border-radius:14px;background:#0ea5e9;color:white;padding:12px 18px;text-decoration:none;font-weight:700}.muted{color:#94a3b8;font-size:13px}
  </style>
</head>
<body>
  <main>
    <h1>CpIPOS IT Admin เธเธณเธฅเธฑเธเน€เธ•เธฃเธตเธขเธกเธ•เธฑเธงเธ•เธดเธ”เธ•เธฑเนเธ</h1>
    <p>เธฃเธฐเธเธเธเธณเธฅเธฑเธเธชเธฃเนเธฒเธเนเธเธฅเนเธ•เธดเธ”เธ•เธฑเนเธเธชเธณเธซเธฃเธฑเธ Windows เธเนเธฒเธ GitHub Actions เน€เธกเธทเนเธญเธชเธฃเนเธฒเธเน€เธชเธฃเนเธ เธเธธเนเธกเธ”เธฒเธงเธเนเนเธซเธฅเธ”เน€เธ”เธดเธกเธเธฐเธ”เธฒเธงเธเนเนเธซเธฅเธ”เนเธเธฅเนเธ•เธดเธ”เธ•เธฑเนเธเนเธ”เนเธ—เธฑเธเธ—เธต</p>
    <span class="note">${escapeHtml(reason)}</span>
    <a class="btn" href="/download/it-admin">เธเธฅเธฑเธเนเธเธซเธเนเธฒเธ”เธฒเธงเธเนเนเธซเธฅเธ”</a>
    <p class="muted">CpIPOS Web เธขเธฑเธเนเธเนเธเธฒเธเนเธขเธเนเธ”เนเธ•เธฒเธกเธเธเธ•เธด เธซเธเนเธฒเธเธตเนเน€เธเนเธเนเธเธฅเนเธ•เธดเธ”เธ•เธฑเนเธเธชเธณเธซเธฃเธฑเธ Windows เน€เธ—เนเธฒเธเธฑเนเธ</p>
  </main>
</body>
</html>`;

  return new NextResponse(html, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

