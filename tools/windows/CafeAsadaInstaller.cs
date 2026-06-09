using System;
using System.Diagnostics;
using System.IO;
using System.Linq;

internal static class CafeAsadaInstaller
{
    private const string AppName = "CafeAsada";
    private const string ShortcutName = "카페 바이럴 원고 생성기.lnk";

    private static int Main(string[] args)
    {
        bool silent = HasArg(args, "/silent");
        bool noLaunch = HasArg(args, "/no-launch");
        string sourceDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        string installDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), AppName);

        try
        {
            Directory.CreateDirectory(installDir);
            CopyAppFiles(sourceDir, installDir);
            CreateShortcut(installDir);
            if (!noLaunch) LaunchInstalledApp(installDir);
            if (!silent)
            {
                System.Windows.Forms.MessageBox.Show(
                    "설치가 완료되었습니다.\r\n\r\n바탕화면에 '카페 바이럴 원고 생성기' 바로가기를 만들었습니다.",
                    "카페 바이럴 원고 생성기",
                    System.Windows.Forms.MessageBoxButtons.OK,
                    System.Windows.Forms.MessageBoxIcon.Information);
            }
            return 0;
        }
        catch (Exception ex)
        {
            if (!silent)
            {
                System.Windows.Forms.MessageBox.Show(
                    "설치 중 오류가 발생했습니다.\r\n\r\n" + ex.Message,
                    "카페 바이럴 원고 생성기",
                    System.Windows.Forms.MessageBoxButtons.OK,
                    System.Windows.Forms.MessageBoxIcon.Error);
            }
            else
            {
                Console.Error.WriteLine(ex);
            }
            return 1;
        }
    }

    private static bool HasArg(string[] args, string name)
    {
        foreach (string arg in args)
        {
            if (string.Equals(arg, name, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private static void CopyAppFiles(string sourceDir, string installDir)
    {
        string[] skipDirs = { ".git", ".github", "__pycache__", "tools", "dist" };
        string[] skipExtensions = { ".pyc" };
        string[] skipFiles = { "CafeAsadaInstaller.exe" };

        foreach (string dirPath in Directory.GetDirectories(sourceDir, "*", SearchOption.AllDirectories))
        {
            string relative = RelativePath(sourceDir, dirPath);
            if (ContainsPathPart(relative, skipDirs)) continue;
            Directory.CreateDirectory(Path.Combine(installDir, relative));
        }

        foreach (string filePath in Directory.GetFiles(sourceDir, "*", SearchOption.AllDirectories))
        {
            string relative = RelativePath(sourceDir, filePath);
            if (ContainsPathPart(relative, skipDirs)) continue;
            if (skipExtensions.Contains(Path.GetExtension(filePath), StringComparer.OrdinalIgnoreCase)) continue;
            if (skipFiles.Contains(Path.GetFileName(filePath), StringComparer.OrdinalIgnoreCase)) continue;

            string targetPath = Path.Combine(installDir, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(targetPath));
            File.Copy(filePath, targetPath, true);
        }
    }

    private static void CreateShortcut(string installDir)
    {
        string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        string shortcutPath = Path.Combine(desktop, ShortcutName);
        string exePath = Path.Combine(installDir, "CafeAsada.exe");
        if (!File.Exists(exePath)) throw new FileNotFoundException("CafeAsada.exe 파일을 설치 폴더에서 찾지 못했습니다.", exePath);

        string command =
            "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('" + PsEscape(shortcutPath) + "');" +
            "$s.TargetPath='" + PsEscape(exePath) + "';" +
            "$s.WorkingDirectory='" + PsEscape(installDir) + "';" +
            "$s.IconLocation='" + PsEscape(exePath) + ",0';" +
            "$s.Save()";

        Process process = Process.Start(new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = "-NoProfile -ExecutionPolicy Bypass -Command " + Quote(command),
            UseShellExecute = false,
            CreateNoWindow = true
        });
        process.WaitForExit();
        if (process.ExitCode != 0) throw new InvalidOperationException("바탕화면 바로가기를 만들지 못했습니다.");
    }

    private static void LaunchInstalledApp(string installDir)
    {
        string exePath = Path.Combine(installDir, "CafeAsada.exe");
        Process.Start(new ProcessStartInfo
        {
            FileName = exePath,
            WorkingDirectory = installDir,
            UseShellExecute = true
        });
    }

    private static bool ContainsPathPart(string relativePath, string[] parts)
    {
        string[] tokens = relativePath.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        return tokens.Any(token => parts.Contains(token, StringComparer.OrdinalIgnoreCase));
    }

    private static string RelativePath(string root, string path)
    {
        Uri rootUri = new Uri(AppendSeparator(root));
        Uri pathUri = new Uri(path);
        return Uri.UnescapeDataString(rootUri.MakeRelativeUri(pathUri).ToString()).Replace('/', Path.DirectorySeparatorChar);
    }

    private static string AppendSeparator(string path)
    {
        return path.EndsWith(Path.DirectorySeparatorChar.ToString()) ? path : path + Path.DirectorySeparatorChar;
    }

    private static string PsEscape(string value)
    {
        return value.Replace("'", "''");
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }
}
