#!/bin/sh
# Installs Overhand: downloads the package for this machine from the latest release, checks its SHA-256,
# unpacks it into ~/.overhand/app, links `overhand` into ~/.local/bin and starts it.
#   curl -fsSL https://get.overhand.dev | sh
# OVERHAND_DOWNLOAD points at another copy of the release files (a mirror, a test server);
# OVERHAND_NO_START=1 installs without starting it (CI, images). NO_COLOR, or output that isn't a terminal, turns colour off.
set -eu

DOWNLOAD="${OVERHAND_DOWNLOAD:-}"
NO_START="${OVERHAND_NO_START:-}"
APP="${HOME}/.overhand/app"
BIN="${HOME}/.local/bin"
URL_UI="http://127.0.0.1:4317"

# colour only on a terminal, and never with NO_COLOR set
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  b="$(printf '\033[1m')"; d="$(printf '\033[2m')"; ok="$(printf '\033[32m')"; warn="$(printf '\033[33m')"
  bad="$(printf '\033[31m')"; hi="$(printf '\033[34m')"; r="$(printf '\033[0m')"; tty=1
else
  b=""; d=""; ok=""; warn=""; bad=""; hi=""; r=""; tty=0
fi
step() { printf '  %s✓%s %s\n' "$ok" "$r" "$1"; }
note() { printf '  %s!%s %s\n' "$warn" "$r" "$1"; }
fail() { printf '  %s✗%s %s\n' "$bad" "$r" "$1" >&2; exit 1; }

printf '\n  %s◆ Overhand%s %sinstaller%s\n\n' "$b$hi" "$r" "$d" "$r"

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "Overhand runs on macOS and Linux; this is $(uname -s)." ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) fail "No Overhand build for $(uname -m) yet." ;;
esac
step "This machine: ${os}/${arch}"

pkg="overhand-${os}-${arch}.tar.gz"
url="${DOWNLOAD:-https://get.overhand.dev/download/latest}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# a progress bar on a terminal, quiet otherwise
if [ "$tty" = 1 ]; then
  printf '  %s↓%s Downloading %s\n' "$hi" "$r" "$pkg"
  curl -fL --progress-bar "${url}/${pkg}" -o "${tmp}/${pkg}" || fail "Download failed: ${url}/${pkg}"
  printf '\033[1A\033[2K\033[1A\033[2K'
else
  curl -fsSL "${url}/${pkg}" -o "${tmp}/${pkg}" || fail "Download failed: ${url}/${pkg}"
fi
step "Downloaded ${pkg}"

curl -fsSL "${url}/SHA256SUMS" -o "${tmp}/SHA256SUMS" || fail "Couldn't fetch SHA256SUMS"
want="$(grep " ${pkg}\$" "${tmp}/SHA256SUMS" | cut -d' ' -f1)"
if command -v shasum >/dev/null 2>&1; then got="$(shasum -a 256 "${tmp}/${pkg}" | cut -d' ' -f1)"; else got="$(sha256sum "${tmp}/${pkg}" | cut -d' ' -f1)"; fi
if [ -z "$want" ] || [ "$want" != "$got" ]; then fail "Checksum mismatch for ${pkg}; not installing."; fi
step "Checksum verified"

mkdir -p "$APP" "$BIN"
tar -xzf "${tmp}/${pkg}" -C "$APP"
ln -sf "${APP}/overhand" "${BIN}/overhand"
step "Installed ~/.local/bin/overhand"

for tool in git gh; do
  command -v "$tool" >/dev/null 2>&1 || note "${tool} isn't installed yet; the setup page shows how to get it."
done

path_line=""
case ":${PATH}:" in
  *":${BIN}:"*) ;;
  *)
    # the exact line for the user's shell, so `overhand` works in every new terminal
    case "$(basename "${SHELL:-sh}")" in
      zsh) rc="~/.zshrc"; line="export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
      bash) if [ "$os" = darwin ]; then rc="~/.bash_profile"; else rc="~/.bashrc"; fi; line="export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
      fish) rc="~/.config/fish/config.fish"; line="fish_add_path \$HOME/.local/bin" ;;
      *) rc="your shell's startup file"; line="export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
    esac
    path_line="$line"
    ;;
esac

if [ "$NO_START" = "1" ]; then
  head="Overhand is installed"
  # until a new terminal picks up the PATH line below, only the full path runs
  if [ -n "$path_line" ]; then tail="Start it with: ~/.local/bin/overhand start"; else tail="Start it with: overhand start"; fi
else
  "${APP}/overhand" start >"${tmp}/start.log" 2>&1 || { cat "${tmp}/start.log" >&2; fail "Overhand didn't start."; }
  step "Started"
  # e.g. no systemd user session (a container, WSL): it runs in the background until a reboot
  grep '^Note: ' "${tmp}/start.log" | sed 's/^Note: //' | while IFS= read -r line; do note "$line"; done
  head="Overhand is running → ${URL_UI}"
  tail="Open it to finish setting up."
fi

# the final box, sized to its longest line (the arrow is one character, though three bytes; wc -m counts bytes in a
# C locale, as in a bare container, so it's swapped for one byte first)
len() { printf '%s' "$1" | sed 's/→/>/g' | wc -c | tr -d ' '; }
pad() { printf '%*s' $(($2 - $(len "$1"))) ''; }
w="$(len "$head")"; [ "$(len "$tail")" -gt "$w" ] && w="$(len "$tail")"
bar="$(printf '%*s' $((w + 2)) '' | tr ' ' '-')"
printf '\n  %s+%s+%s\n' "$d" "$bar" "$r"
printf '  %s|%s %s%s%s%s %s|%s\n' "$d" "$r" "$b" "$head" "$r" "$(pad "$head" "$w")" "$d" "$r"
printf '  %s|%s %s%s %s|%s\n' "$d" "$r" "$tail" "$(pad "$tail" "$w")" "$d" "$r"
printf '  %s+%s+%s\n\n' "$d" "$bar" "$r"

if [ -n "$path_line" ]; then
  printf '  ~/.local/bin isn'"'"'t on your PATH. Add this line to %s, then open a new terminal:\n' "$rc"
  printf '    %s%s%s\n\n' "$b" "$path_line" "$r"
fi
