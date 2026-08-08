using System.Windows.Forms;

namespace Cpipos.ITAdminRuntime;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var options = RuntimeOptions.FromArgs(args);
        Application.Run(new MainForm(options));
    }
}

internal sealed class RuntimeOptions
{
    private const string ProductionAppUrl = "https://cp-ipos-web.vercel.app/it-admin/login";

    public string AppUrl { get; init; } = ProductionAppUrl;
    public bool Fullscreen { get; init; }
    public bool EnableDevTools { get; init; }
    public bool AllowCustomAppUrl { get; init; }

    public static RuntimeOptions FromArgs(string[] args)
    {
        var rawAppUrl = ReadEnv("CPIPOS_ITADMIN_APP_URL", ProductionAppUrl);
        var fullscreen = string.Equals(ReadEnv("CPIPOS_ITADMIN_FULLSCREEN", "0"), "1", StringComparison.OrdinalIgnoreCase);
        var enableDevTools = string.Equals(ReadEnv("CPIPOS_ITADMIN_ENABLE_DEVTOOLS", "0"), "1", StringComparison.OrdinalIgnoreCase);
        var allowCustomAppUrl = string.Equals(ReadEnv("CPIPOS_ITADMIN_ALLOW_CUSTOM_APP_URL", "0"), "1", StringComparison.OrdinalIgnoreCase);

        foreach (var arg in args)
        {
            if (TryReadValue(arg, "--url=", out var url) && !string.IsNullOrWhiteSpace(url))
            {
                rawAppUrl = url.Trim();
                continue;
            }
            if (string.Equals(arg, "--windowed", StringComparison.OrdinalIgnoreCase))
            {
                fullscreen = false;
                continue;
            }
            if (string.Equals(arg, "--fullscreen", StringComparison.OrdinalIgnoreCase))
            {
                fullscreen = true;
                continue;
            }
            if (string.Equals(arg, "--devtools", StringComparison.OrdinalIgnoreCase))
            {
                enableDevTools = true;
                continue;
            }
            if (string.Equals(arg, "--allow-custom-url", StringComparison.OrdinalIgnoreCase))
            {
                allowCustomAppUrl = true;
            }
        }

        var appUrl = ResolveAppUrl(rawAppUrl, allowCustomAppUrl);

        return new RuntimeOptions
        {
            AppUrl = appUrl,
            Fullscreen = fullscreen,
            EnableDevTools = enableDevTools,
            AllowCustomAppUrl = allowCustomAppUrl
        };
    }

    private static string ResolveAppUrl(string value, bool allowCustomAppUrl)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)) return ProductionAppUrl;
        if (IsProductionAppUri(uri)) return uri.ToString();
        if (allowCustomAppUrl && IsLocalDevelopmentUri(uri)) return uri.ToString();
        return ProductionAppUrl;
    }

    private static bool IsProductionAppUri(Uri uri)
    {
        return uri.Scheme == Uri.UriSchemeHttps &&
               string.Equals(uri.Host, "cp-ipos-web.vercel.app", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsLocalDevelopmentUri(Uri uri)
    {
        return (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps) &&
               (string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(uri.Host, "127.0.0.1", StringComparison.OrdinalIgnoreCase));
    }

    private static string ReadEnv(string name, string fallback)
    {
        var value = Environment.GetEnvironmentVariable(name);
        return string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
    }

    private static bool TryReadValue(string arg, string prefix, out string value)
    {
        if (arg.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            value = arg[prefix.Length..];
            return true;
        }
        value = string.Empty;
        return false;
    }
}
