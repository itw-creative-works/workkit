// test/lib/stub-launcher.cs: the `<name>.exe` beside a PATH stub on Windows, so
// Node starts the stub by its bare name (libuv appends only .com and .exe). It
// hands the call to the bash script `<name>` beside it under Git's bash, whose
// path test/lib/platform.js fills in before building it with csc.

using System;
using System.Diagnostics;
using System.IO;
using System.Text;

class StubLauncher {
  static int Main(string[] args) {
    // bash's dirname reads only forward slashes.
    string script = Path.ChangeExtension(System.Reflection.Assembly.GetExecutingAssembly().Location, null).Replace('\\', '/');
    StringBuilder line = new StringBuilder(Quote(script));
    foreach (string arg in args) line.Append(' ').Append(Quote(arg));
    ProcessStartInfo info = new ProcessStartInfo(@"{{BASH}}", line.ToString());
    info.UseShellExecute = false;
    using (Process p = Process.Start(info)) {
      p.WaitForExit();
      return p.ExitCode;
    }
  }

  // The twin of Quote in workflow/script-shell.cs: one argument as CreateProcess's
  // command line carries it, always quoted, backslashes doubled only before a
  // quote: the msys runtime globs an unquoted argument a native parent hands it.
  static string Quote(string arg) {
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
