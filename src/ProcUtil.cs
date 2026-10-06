// Running console tools (powershell, netsh, pktmon) without ever hanging the app.
using System.Diagnostics;
using System.Text;

namespace GameNetKit
{
    public static class ProcUtil
    {
        // Reads output and errors at the same time (reading one after the other can deadlock once the other pipe fills up)
        // and kills the tool when it takes longer than timeoutMs. Returns the exit code, or -99 on timeout.
        public static int Run(string file, string arguments, int timeoutMs, out string output)
        {
            var psi = new ProcessStartInfo(file, arguments)
            {
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true
            };
            using (var p = Process.Start(psi))
            {
                var buf = new StringBuilder();
                var gate = new object();
                p.OutputDataReceived += (s, e) => { if (e.Data != null) lock (gate) buf.AppendLine(e.Data); };
                p.ErrorDataReceived += (s, e) => { if (e.Data != null) lock (gate) buf.AppendLine(e.Data); };
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                if (!p.WaitForExit(timeoutMs))
                {
                    try { p.Kill(); } catch { }
                    lock (gate) output = buf.ToString() + "[timed out after " + (timeoutMs / 1000) + " s]";
                    return -99;
                }
                p.WaitForExit();   // lets the asynchronous readers finish
                lock (gate) output = buf.ToString();
                return p.ExitCode;
            }
        }
    }
}
