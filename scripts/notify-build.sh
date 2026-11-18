#!/usr/bin/env bash
# Espera a que termine el build del Flatpak y avisa al escritorio.
# Uso: sh scripts/notify-build.sh [etiqueta]
set -u

label="${1:-Flatpak}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"

notify() {
  local urgency="$1" title="$2" body="$3"
  if command -v notify-send >/dev/null 2>&1; then
    notify-send -u "$urgency" -a OpenBurn -i io.github.SJLS27.OpenBurn "$title" "$body" || true
  fi
  # Fallback para terminales: bell + línea visible en el log.
  printf '\a[%s] %s — %s\n' "$urgency" "$title" "$body"
}

# No arrancar dos watchers a la vez.
lock="/tmp/openburn-notify.lock"
if ! mkdir "$lock" 2>/dev/null; then
  echo "Ya hay un watcher activo ($lock)"
  exit 0
fi
trap 'rmdir "$lock" 2>/dev/null' EXIT

started=$(date +%s)
while pgrep -f "flatpak-builder" >/dev/null 2>&1; do
  sleep 5
done

elapsed=$(( $(date +%s) - started ))

# Estado final: el Flatpak quedó instalado?
if flatpak info io.github.SJLS27.OpenBurn >/dev/null 2>&1; then
  commit=$(flatpak info io.github.SJLS27.OpenBurn | awk '/Commit:/ {print $2}' | cut -c1-8)
  notify normal "OpenBurn — $label listo" "Instalado en ${elapsed}s · commit $commit"
  exit 0
fi

notify critical "OpenBurn — $label falló" "El build terminó sin instalar (${elapsed}s)"
exit 1
