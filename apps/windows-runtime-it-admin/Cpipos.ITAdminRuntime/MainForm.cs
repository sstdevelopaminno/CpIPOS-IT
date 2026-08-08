using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Drawing;
using System.Windows.Forms;

namespace Cpipos.ITAdminRuntime;

internal sealed class MainForm : Form
{
    private const int WebViewInitTimeoutMs = 20000;

    private readonly RuntimeOptions _options;
    private readonly WebView2 _webView;
    private bool _isFullscreen;
    private bool _initializing;
    private bool _coreWebView2Configured;
    private Panel? _initTimeoutPanel;

    public MainForm(RuntimeOptions options)
    {
        _options = options;

        Text = "CpIPOS IT Admin";
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.White;
        KeyPreview = true;
        Width = 1280;
        Height = 800;
        MinimumSize = new Size(1024, 640);
        FormBorderStyle = FormBorderStyle.Sizable;
        WindowState = FormWindowState.Maximized;
        MaximizeBox = true;
        MinimizeBox = true;
        ControlBox = true;
        ShowIcon = true;
        ShowInTaskbar = true;

        TryLoadApplicationIcon();

        _webView = new WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = Color.White
        };

        Controls.Add(_webView);

        if (_options.Fullscreen)
        {
            EnterFullscreen();
        }

        Shown += async (_, _) => await InitializeWebViewAsync();
        KeyDown += HandleKeyDown;
    }

    private void TryLoadApplicationIcon()
    {
        var candidatePaths = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "assets", "cpipos.ico"),
            Path.Combine(AppContext.BaseDirectory, "cpipos.ico"),
            Path.Combine(Application.StartupPath, "assets", "cpipos.ico"),
            Path.Combine(Application.StartupPath, "cpipos.ico")
        };

        foreach (var candidatePath in candidatePaths)
        {
            try
            {
                if (!File.Exists(candidatePath)) continue;
                using var loadedIcon = new Icon(candidatePath);
                Icon = (Icon)loadedIcon.Clone();
                return;
            }
            catch
            {
                // Try the next candidate path.
            }
        }

        try
        {
            var associatedIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            if (associatedIcon != null)
            {
                Icon = associatedIcon;
            }
        }
        catch
        {
            // Keep the default Windows icon when a custom icon is not embedded or bundled.
        }
    }

    private async Task InitializeWebViewAsync()
    {
        if (_initializing) return;
        _initializing = true;
        try
        {
            var userDataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "CpIPOS",
                "ITAdminRuntime",
                "WebView2Profile");
            Directory.CreateDirectory(userDataFolder);

            var environment = await WithTimeoutAsync(
                CoreWebView2Environment.CreateAsync(userDataFolder: userDataFolder),
                WebViewInitTimeoutMs);
            await WithTimeoutAsync(_webView.EnsureCoreWebView2Async(environment), WebViewInitTimeoutMs);

            HideInitTimeoutFallback();
            ConfigureCoreWebView2AndNavigate();
        }
        catch (TimeoutException)
        {
            ShowInitTimeoutFallback("หมดเวลารอ WebView2 เริ่มการทำงาน");
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                this,
                "CpIPOS IT Admin เปิดระบบไม่สำเร็จ\n\n" + ex.Message + "\n\nกรุณาตรวจสอบ Microsoft Edge WebView2 Runtime และอินเทอร์เน็ตของเครื่อง",
                "CpIPOS IT Admin",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
        finally
        {
            _initializing = false;
        }
    }

    private void ConfigureCoreWebView2AndNavigate()
    {
        if (_coreWebView2Configured)
        {
            NavigateToApp();
            return;
        }
        _coreWebView2Configured = true;

        _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = _options.EnableDevTools;
        _webView.CoreWebView2.Settings.AreDevToolsEnabled = _options.EnableDevTools;
        _webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
        _webView.CoreWebView2.Settings.IsZoomControlEnabled = true;

        _webView.CoreWebView2.WebMessageReceived += (_, eventArgs) =>
        {
            var message = eventArgs.TryGetWebMessageAsString();
            if (string.Equals(message, "retry", StringComparison.OrdinalIgnoreCase))
            {
                NavigateToApp();
                return;
            }

            if (string.Equals(message, "close", StringComparison.OrdinalIgnoreCase))
            {
                Close();
            }
        };

        _webView.CoreWebView2.NavigationCompleted += (_, eventArgs) =>
        {
            if (!eventArgs.IsSuccess)
            {
                ShowOfflinePage(eventArgs.WebErrorStatus.ToString());
            }
        };

        NavigateToApp();
    }

    private static async Task<T> WithTimeoutAsync<T>(Task<T> task, int timeoutMs)
    {
        var timeoutTask = Task.Delay(timeoutMs);
        var completed = await Task.WhenAny(task, timeoutTask);
        if (completed == timeoutTask)
        {
            ObserveLateFailure(task);
            throw new TimeoutException();
        }
        return await task;
    }

    private static async Task WithTimeoutAsync(Task task, int timeoutMs)
    {
        var timeoutTask = Task.Delay(timeoutMs);
        var completed = await Task.WhenAny(task, timeoutTask);
        if (completed == timeoutTask)
        {
            ObserveLateFailure(task);
            throw new TimeoutException();
        }
        await task;
    }

    private static void ObserveLateFailure(Task task)
    {
        _ = task.ContinueWith(
            t => _ = t.Exception,
            CancellationToken.None,
            TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);
    }

    private void ShowInitTimeoutFallback(string reason)
    {
        if (_initTimeoutPanel != null)
        {
            _initTimeoutPanel.BringToFront();
            return;
        }

        var overlay = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(241, 245, 249)
        };

        var card = new Panel
        {
            Size = new Size(520, 240),
            BackColor = Color.White,
            Anchor = AnchorStyles.None
        };
        void RecenterCard()
        {
            card.Location = new Point(
                Math.Max(0, (overlay.Width - card.Width) / 2),
                Math.Max(0, (overlay.Height - card.Height) / 2));
        }
        overlay.Resize += (_, _) => RecenterCard();

        var title = new Label
        {
            Text = "CpIPOS IT Admin",
            Font = new Font("Tahoma", 18, FontStyle.Bold),
            AutoSize = true,
            Location = new Point(24, 20)
        };
        var message = new Label
        {
            Text = "เปิดระบบไม่สำเร็จ: " + reason +
                   "\n\nกรุณาตรวจสอบ Microsoft Edge WebView2 Runtime และอินเทอร์เน็ตของเครื่อง แล้วลองใหม่",
            Font = new Font("Tahoma", 10),
            Size = new Size(470, 90),
            Location = new Point(24, 60)
        };
        var retryButton = new Button
        {
            Text = "ลองใหม่",
            Size = new Size(120, 36),
            Location = new Point(24, 170)
        };
        retryButton.Click += async (_, _) => await InitializeWebViewAsync();
        var closeButton = new Button
        {
            Text = "ปิดโปรแกรม",
            Size = new Size(120, 36),
            Location = new Point(160, 170)
        };
        closeButton.Click += (_, _) => Close();

        card.Controls.Add(title);
        card.Controls.Add(message);
        card.Controls.Add(retryButton);
        card.Controls.Add(closeButton);
        overlay.Controls.Add(card);

        Controls.Add(overlay);
        RecenterCard();
        overlay.BringToFront();
        _initTimeoutPanel = overlay;
    }

    private void HideInitTimeoutFallback()
    {
        if (_initTimeoutPanel == null) return;
        Controls.Remove(_initTimeoutPanel);
        _initTimeoutPanel.Dispose();
        _initTimeoutPanel = null;
    }

    private void NavigateToApp()
    {
        if (_webView.CoreWebView2 == null) return;
        _webView.CoreWebView2.Navigate(_options.AppUrl);
    }

    private void ShowOfflinePage(string reason)
    {
        _webView.NavigateToString(OfflinePage.Build(reason));
    }

    private void HandleKeyDown(object? sender, KeyEventArgs eventArgs)
    {
        if (eventArgs.KeyCode == Keys.F11)
        {
            ToggleFullscreen();
            eventArgs.Handled = true;
            return;
        }

        if (eventArgs.KeyCode == Keys.Escape && _isFullscreen)
        {
            ExitFullscreen();
            eventArgs.Handled = true;
            return;
        }

        if (eventArgs.Control && eventArgs.KeyCode == Keys.R)
        {
            NavigateToApp();
            eventArgs.Handled = true;
            return;
        }

        if (eventArgs.Control && eventArgs.KeyCode == Keys.Q)
        {
            Close();
            eventArgs.Handled = true;
            return;
        }

        if (_options.EnableDevTools && eventArgs.Control && eventArgs.Shift && eventArgs.KeyCode == Keys.D)
        {
            _webView.CoreWebView2?.OpenDevToolsWindow();
            eventArgs.Handled = true;
        }
    }

    private void ToggleFullscreen()
    {
        if (_isFullscreen)
        {
            ExitFullscreen();
        }
        else
        {
            EnterFullscreen();
        }
    }

    private void EnterFullscreen()
    {
        FormBorderStyle = FormBorderStyle.None;
        WindowState = FormWindowState.Maximized;
        _isFullscreen = true;
    }

    private void ExitFullscreen()
    {
        FormBorderStyle = FormBorderStyle.Sizable;
        WindowState = FormWindowState.Maximized;
        MaximizeBox = true;
        MinimizeBox = true;
        ControlBox = true;
        _isFullscreen = false;
    }
}

internal static class OfflinePage
{
    public static string Build(string reason)
    {
        var safeReason = System.Net.WebUtility.HtmlEncode(reason);
        return $$"""
<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CpIPOS IT Admin Offline</title>
  <style>
    body { margin:0; font-family: Tahoma, Arial, sans-serif; background:#f1f5f9; color:#0f172a; display:flex; min-height:100vh; align-items:center; justify-content:center; }
    .card { width:min(720px, calc(100vw - 48px)); background:white; border:1px solid #dbe4f0; border-radius:20px; padding:28px; box-shadow:0 20px 70px rgba(15,23,42,.12); }
    h1 { margin:0 0 12px; font-size:28px; }
    p { color:#475569; line-height:1.65; }
    code { display:block; background:#f8fafc; border:1px solid #dbe4f0; border-radius:12px; padding:12px; color:#334155; overflow:auto; }
    button { border:0; border-radius:12px; padding:12px 18px; font-weight:700; background:#0ea5e9; color:white; cursor:pointer; margin-right:8px; }
    button.secondary { background:#334155; }
    .muted { color:#64748b; font-size:13px; }
  </style>
</head>
<body>
  <main class="card">
    <h1>CpIPOS IT Admin</h1>
    <p>ยังเชื่อมต่อระบบออนไลน์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง</p>
    <code>สถานะ: {{safeReason}}</code>
    <button onclick="chrome.webview.postMessage('retry')">ลองใหม่</button>
    <button class="secondary" onclick="chrome.webview.postMessage('close')">ปิดโปรแกรม</button>
    <p class="muted">ปุ่มลัด: F11 เต็มจอ, Esc ออกจากเต็มจอ, Ctrl+R โหลดใหม่, Ctrl+Q ปิดโปรแกรม</p>
  </main>
</body>
</html>
""";
    }
}
