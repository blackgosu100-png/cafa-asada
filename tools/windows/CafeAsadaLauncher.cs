using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Threading;

internal static class CafeAsadaLauncher
{
    private const int Port = 8787;

    private static int Main(string[] args)
    {
        bool noOpen = HasArg(args, "/no-open");
        string appDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        string serverPath = Path.Combine(appDir, "codex_local_server.js");
        if (!File.Exists(serverPath))
        {
            ShowError("codex_local_server.js 파일을 찾지 못했습니다.\r\n\r\n설치 폴더: " + appDir);
            return 1;
        }

        string nodePath = FindNode();
        if (string.IsNullOrEmpty(nodePath))
        {
            ShowError("Node.js를 찾지 못했습니다.\r\n\r\nNode.js를 설치한 뒤 다시 실행해 주세요.");
            return 1;
        }

        if (!IsPortOpen())
        {
            StartServer(appDir, nodePath, serverPath);
        }

        if (!WaitForServer())
        {
            ShowError("로컬 서버를 시작하지 못했습니다.\r\n\r\n설치 폴더의 codex_local_server.err.log 파일을 확인해 주세요.");
            return 1;
        }

        if (!noOpen)
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "http://127.0.0.1:8787/cafe_viral_generator.html",
                UseShellExecute = true
            });
        }

        return 0;
    }

    private static bool HasArg(string[] args, string name)
    {
        foreach (string arg in args)
        {
            if (string.Equals(arg, name, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private static string FindNode()
    {
        string env = Environment.GetEnvironmentVariable("NODE_EXE");
        if (!string.IsNullOrWhiteSpace(env) && File.Exists(env)) return env;

        string[] candidates =
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs", "node.exe")
        };

        foreach (string candidate in candidates)
        {
            if (File.Exists(candidate)) return candidate;
        }

        return "";
    }

    private static void StartServer(string appDir, string nodePath, string serverPath)
    {
        string outLog = Path.Combine(appDir, "codex_local_server.out.log");
        string errLog = Path.Combine(appDir, "codex_local_server.err.log");
        string pythonPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".cache",
            "codex-runtimes",
            "codex-primary-runtime",
            "dependencies",
            "python",
            "python.exe");

        ProcessStartInfo startInfo = new ProcessStartInfo
        {
            FileName = nodePath,
            Arguments = Quote(serverPath),
            WorkingDirectory = appDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };

        if (File.Exists(pythonPath))
        {
            startInfo.EnvironmentVariables["PYTHON_EXE"] = pythonPath;
        }

        Process process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs args)
        {
            if (args.Data != null) AppendLine(outLog, args.Data);
        };
        process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs args)
        {
            if (args.Data != null) AppendLine(errLog, args.Data);
        };

        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
    }

    private static bool WaitForServer()
    {
        for (int i = 0; i < 40; i++)
        {
            if (IsPortOpen()) return true;
            Thread.Sleep(250);
        }
        return false;
    }

    private static bool IsPortOpen()
    {
        try
        {
            using (TcpClient client = new TcpClient())
            {
                IAsyncResult result = client.BeginConnect("127.0.0.1", Port, null, null);
                bool success = result.AsyncWaitHandle.WaitOne(TimeSpan.FromMilliseconds(180));
                if (!success) return false;
                client.EndConnect(result);
                return true;
            }
        }
        catch
        {
            return false;
        }
    }

    private static void AppendLine(string path, string line)
    {
        try
        {
            File.AppendAllText(path, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss ") + line + Environment.NewLine);
        }
        catch
        {
        }
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    private static void ShowError(string message)
    {
        System.Windows.Forms.MessageBox.Show(message, "카페 바이럴 원고 생성기", System.Windows.Forms.MessageBoxButtons.OK, System.Windows.Forms.MessageBoxIcon.Error);
    }
}
