# workflow/ship/triggers.awk: whether one workflow file's top-level `on:` names
# the event `ev`, in any of its YAML shapes; exit 0 yes, 1 no. Carriage returns
# go and single quotes read as double, so a quoted `"on":` key and a CRLF file
# answer the same as the plain one. One nested deeper is not a trigger.
# Usage: awk -v ev=<event> -f triggers.awk <workflow file>
# Read by ship/watch.sh and .github/scripts/ci-release.js.

{ gsub(/\r/, ""); gsub(/\047/, "\"") }
/^[[:space:]]*(#|$)/ { next }
inblock && /^[^[:space:]]/ { inblock = 0 }
inblock {
  match($0, /^[[:space:]]*/)
  if (want < 0) want = RLENGTH
  if (RLENGTH == want) {
    line = substr($0, RLENGTH + 1)
    sub(/^-[[:space:]]*/, "", line)
    if (line ~ ("^\"?" ev "\"?[[:space:]]*(:|#|$)")) found = 1
  }
  next
}
/^"?on"?[[:space:]]*:/ {
  rest = $0
  sub(/^[^:]*:/, "", rest)
  sub(/#.*/, "", rest)
  if (rest ~ /[^[:space:]]/) {
    if (rest ~ ("(^|[^A-Za-z0-9_-])" ev "([^A-Za-z0-9_-]|$)")) found = 1
  } else {
    inblock = 1
    want = -1
  }
}
END { exit found ? 0 : 1 }
