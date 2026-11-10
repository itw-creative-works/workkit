# workflow/ship/dispatch-input.awk: whether one workflow file declares the
# dispatch input `input`, as a key of `inputs:` under `workflow_dispatch:` under
# the top-level `on:`, each in block style; exit 0 yes, 1 no. Carriage returns
# and quotes read as triggers.awk reads them; the same key elsewhere never counts.
# Usage: awk -v input=<name> -f dispatch-input.awk <workflow file>
# Read by .github/scripts/ci-release.js.

BEGIN { split("on workflow_dispatch inputs", key, " "); key[4] = input; at[0] = -1 }
{ gsub(/\r/, ""); gsub(/\047/, "\"") }
/^[[:space:]]*(#|$)/ { next }
{
  match($0, /^[[:space:]]*/)
  n = RLENGTH
  while (depth > 0 && n <= at[depth]) { delete kid[depth]; depth-- }
  # A level's keys sit at the indent of its first line.
  if (!(depth in kid)) kid[depth] = n
  if (n == kid[depth] && substr($0, n + 1) ~ ("^\"?" key[depth + 1] "\"?[[:space:]]*:")) {
    at[++depth] = n
    if (depth == 4) { found = 1; exit }
  }
}
END { exit found ? 0 : 1 }
