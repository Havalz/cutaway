#!/bin/sh
# U1: no UI file may hard-code a colour; CutawayStyle.ts is the single source.
# Prints any literal colour (vec4 values, hex, colour tags) and exits 1 if it finds one.
cd "$(dirname "$0")/../../Assets/Scripts" || exit 2
UI="CutawayStationUI.ts CutawayResetUI.ts CutawayLabelsUI.ts CutawayHeroUI.ts CutawayRpRail.ts CutawayLampRail.ts CutawayUiKit.ts"
for f in CutawayRail.ts CutawayHalo.ts CutawayOpening.ts CutawayFinale.ts; do [ -f "$f" ] && UI="$UI $f"; done
if grep -nE 'new vec4\(|0x[0-9a-fA-F]{6}|#[0-9a-fA-F]{6}|<color=' $UI; then
  echo "U1 FAIL: hard-coded colours above"
  exit 1
fi
echo "U1 OK: no hard-coded colours in: $UI"
