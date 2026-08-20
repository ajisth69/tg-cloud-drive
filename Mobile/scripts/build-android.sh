#!/usr/bin/env bash
# Builds the Clash Drive Android APK with automatic environment setup:
#   - Detects the Android SDK (ANDROID_HOME / common locations)
#   - Writes android/local.properties when missing
#   - Picks a JDK 21 (system, ~/.jdks, or auto-downloads Temurin 21)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Clash Drive Android build"

# ── Android SDK ────────────────────────────────────────────────────────────
if [ -z "${ANDROID_HOME:-}" ] || [ ! -d "${ANDROID_HOME:-}" ]; then
  for cand in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "$HOME/Android/Sdk" "$HOME/android-sdk" "/opt/android-sdk" "/usr/local/android-sdk"; do
    if [ -n "$cand" ] && [ -d "$cand" ]; then
      export ANDROID_HOME="$cand"
      break
    fi
  done
fi
if [ -z "${ANDROID_HOME:-}" ] || [ ! -d "$ANDROID_HOME" ]; then
  echo "ERROR: Android SDK not found. Install it or set ANDROID_HOME." >&2
  exit 1
fi
echo "    Android SDK: $ANDROID_HOME"

# Make the SDK path visible to Gradle even without ANDROID_HOME exported.
if [ ! -f "$ROOT/android/local.properties" ]; then
  printf 'sdk.dir=%s\n' "$ANDROID_HOME" > "$ROOT/android/local.properties"
  echo "    Wrote android/local.properties"
fi

# ── JDK 21 ─────────────────────────────────────────────────────────────────
JAVA_HOME=""

has_jdk21() {
  "$1/bin/java" -version 2>&1 | grep -q '"21'
}

if has_jdk21 "$(dirname "$(dirname "$(command -v java 2>/dev/null || echo /nonexistent)")")" 2>/dev/null; then
  JAVA_HOME="$(dirname "$(dirname "$(command -v java)")")"
elif [ -n "${JAVA_HOME:-}" ] && has_jdk21 "$JAVA_HOME" 2>/dev/null; then
  :
elif [ -d "$HOME/.jdks/temurin-21" ] && has_jdk21 "$HOME/.jdks/temurin-21"; then
  JAVA_HOME="$HOME/.jdks/temurin-21"
else
  for cand in "$HOME/.jdks"/* "$HOME/.sdkman/candidates/java"/* "/usr/lib/jvm"/*; do
    if [ -d "$cand/bin" ] && has_jdk21 "$cand" 2>/dev/null; then
      JAVA_HOME="$cand"
      break
    fi
  done
fi

if [ -z "$JAVA_HOME" ]; then
  echo "==> No JDK 21 found. Downloading Temurin 21 to ~/.jdks/temurin-21 ..."
  mkdir -p "$HOME/.jdks"
  TMP_TAR="$(mktemp --suffix=.tar.gz)"
  curl -sL "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse" -o "$TMP_TAR"
  mkdir -p "$HOME/.jdks/temurin-21.tmp"
  tar -xzf "$TMP_TAR" -C "$HOME/.jdks/temurin-21.tmp"
  rm "$TMP_TAR"
  rm -rf "$HOME/.jdks/temurin-21"
  mv "$HOME/.jdks/temurin-21.tmp"/* "$HOME/.jdks/temurin-21"
  rmdir "$HOME/.jdks/temurin-21.tmp"
  JAVA_HOME="$HOME/.jdks/temurin-21"
fi
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"
echo "    JDK 21: $JAVA_HOME"

# ── Build ──────────────────────────────────────────────────────────────────
cd "$ROOT/android"
./gradlew "$@"