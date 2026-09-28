// workflow/script-shell.cs: npm's script shell on Windows. npm starts its shell
// as a plain program, so this one hands the call to script-shell.sh under Git's
// bash; `workkit setup` builds it with the compiler every Windows ships, into
// the machine's own folder.

using System;
using System.Diagnostics;
using System.IO;
using System.Text;

class ScriptShell {
  static int Main(string[] args) {
    string bash = FindBash();
    if (bash == null) {
      Console.Error.WriteLine("script-shell: no bash.exe on PATH outside the Windows folder and none beside git.exe, so npm's script shell cannot start Git Bash");
      return 127;
    }
    // The engine's order (workflow/workkit.sh's CLAUDE_HOME), then USERPROFILE for a start without HOME.
    string claudeHome = Environment.GetEnvironmentVariable("WORKFLOW_CLAUDE_HOME");
    if (string.IsNullOrEmpty(claudeHome)) {
      string home = Environment.GetEnvironmentVariable("HOME");
      if (string.IsNullOrEmpty(home)) home = Environment.GetEnvironmentVariable("USERPROFILE") ?? "";
      claudeHome = Path.Combine(home, ".claude");
    }
    // bash's dirname reads only forward slashes.
    string wrapper = Path.Combine(Path.Combine(claudeHome, "workkit"), "script-shell.sh").Replace('\\', '/');
    StringBuilder line = new StringBuilder(Quote(wrapper));
    foreach (string arg in args) line.Append(' ').Append(Quote(arg));
    ProcessStartInfo info = new ProcessStartInfo(bash, line.ToString());
    info.UseShellExecute = false;
    using (Process p = Process.Start(info)) {
      p.WaitForExit();
      return p.ExitCode;
    }
  }

  // The first bash.exe on PATH outside the Windows folder and the Store's app
  // aliases, where WSL's live, else the one beside git.exe's own folder
  // (Git\cmd\git.exe, Git\bin\bash.exe).
  static string FindBash() {
    string localAppData = Environment.GetEnvironmentVariable("LOCALAPPDATA") ?? "";
    string[] skipped = {
      Environment.GetEnvironmentVariable("SystemRoot") ?? "",
      localAppData.Length > 0 ? Path.Combine(Path.Combine(localAppData, "Microsoft"), "WindowsApps") : ""
    };
    string gitDir = null;
    foreach (string entry in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';')) {
      string dir = entry.Trim().Trim('"');
      if (dir.Length == 0) continue;
      if (Array.Exists(skipped, s => s.Length > 0 && dir.StartsWith(s, StringComparison.OrdinalIgnoreCase))) continue;
      if (File.Exists(Path.Combine(dir, "bash.exe"))) return Path.Combine(dir, "bash.exe");
      if (gitDir == null && File.Exists(Path.Combine(dir, "git.exe"))) gitDir = dir;
    }
    if (gitDir != null) {
      string beside = Path.Combine(Path.Combine(Path.GetDirectoryName(gitDir.TrimEnd('\\', '/')) ?? gitDir, "bin"), "bash.exe");
      if (File.Exists(beside)) return beside;
    }
    return null;
  }

  // One argument as CreateProcess's command line carries it: quoted when it
  // holds whitespace or a quote, backslashes doubled only before a quote.
  static string Quote(string arg) {
    if (arg.Length > 0 && arg.IndexOfAny(new char[] { ' ', '\t', '\n', '\v', '"' }) < 0) return arg;
    StringBuilder sb = new StringBuilder("\"");
    int slashes = 0;
    foreach (char c in arg) {
      if (c == '\\') { slashes++; continue; }
      sb.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
      slashes = 0;
      sb.Append(c);
    }
    sb.Append('\\', slashes * 2).Append('"');
    return sb.ToString();
  }
}
