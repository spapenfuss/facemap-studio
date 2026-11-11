#!/usr/bin/env bash
# Builds web/wasm/engine.wasm from engine/engine.cpp.
#  - default: plain clang + wasm-ld (what produced the prebuilt binary)
#  - if `emcc` is on PATH and you pass --emcc, Emscripten is used instead
set -euo pipefail
cd "$(dirname "$0")"
OUT=web/wasm/engine.wasm
mkdir -p web/wasm
if [[ "${1:-}" == "--emcc" ]]; then
  emcc engine/engine.cpp -std=c++17 -O2 -fno-exceptions -fno-rtti -fno-math-errno \
    -sSTANDALONE_WASM=1 -sALLOW_MEMORY_GROWTH=0 -sINITIAL_MEMORY=1048576 -sSTACK_SIZE=262144 \
    --no-entry -sEXPORT_ALL=0 -o "$OUT"
else
  CXX="${CXX:-clang++}"
  "$CXX" --target=wasm32 -std=c++17 -O2 -ffreestanding -nostdlib -fno-exceptions -fno-rtti \
    -fno-math-errno -mbulk-memory -Wall -Wextra \
    -Wl,--no-entry -Wl,--export-dynamic -Wl,--export-memory -Wl,-z,stack-size=262144 \
    -o "$OUT" engine/engine.cpp
fi
ls -l "$OUT"
