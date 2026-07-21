#!/bin/zsh
set -euo pipefail

OUTPUT_PATH="${1:?缺少輸出路徑}"
CANDIDATE_ROOT="${MAGI_V3_CANDIDATE_ROOT:-$HOME/Desktop/MAGI_v3_candidates}"

release_complete="$(/usr/bin/find "$CANDIDATE_ROOT" -maxdepth 2 -path '*/v3-*/RELEASE_COMPLETE.json' -type f -print 2>/dev/null | /usr/bin/sort | /usr/bin/tail -n 1)"
if [[ -z "$release_complete" ]]; then
    /usr/bin/jq -n '{found:false,releaseID:null,releasePath:null,manifestVerified:false,v2RoutesPreserved:false,canonicalEnvelopeVerified:false,compatible:false,detail:"找不到 MAGI V3 候選版本。"}' > "$OUTPUT_PATH"
    exit 0
fi

release_root="${release_complete:h}"
release_id="$(/usr/bin/jq -r '.release_id // empty' "$release_complete")"
[[ -n "$release_id" ]] || release_id="${release_root:t}"
manifest="$release_root/release-manifest.json"
routes="$release_root/docs/architecture/v3/generated/v2_runtime_routes.json"
envelope="$release_root/docs/architecture/v3/contracts/api-envelope.schema.json"

manifest_ok=false
routes_ok=false
envelope_ok=false

if [[ -f "$manifest" ]] && [[ "$(/usr/bin/jq -r '.manifest // empty' "$release_complete")" == "release-manifest.json" ]]; then
    manifest_ok=true
fi

if [[ -f "$routes" ]] && /usr/bin/jq -e '
    (.services["5002"] | map(.rule)) as $main |
    (.services["5003"] | map(.rule)) as $tools |
    (["/livez", "/readyz", "/health", "/api/osc/chat"] | all(. as $route | $main | index($route))) and
    (["/livez", "/health"] | all(. as $route | $tools | index($route)))
' "$routes" >/dev/null; then
    routes_ok=true
fi

if [[ -f "$envelope" ]] && /usr/bin/jq -e '
    .properties.meta.properties.compat_version.enum == ["v2", "v3"]
' "$envelope" >/dev/null; then
    envelope_ok=true
fi

compatible=false
detail="已找到 V3，但相容契約未完整通過。"
if [[ "$manifest_ok" == true && "$routes_ok" == true && "$envelope_ok" == true ]]; then
    compatible=true
    detail="已於建置時離線驗證 V3 完成版、V2 路由與 V2／V3 回應封套；未啟動 V3。"
fi

/usr/bin/jq -n \
    --argjson found true \
    --arg releaseID "$release_id" \
    --arg releasePath "$release_root" \
    --argjson manifestVerified "$manifest_ok" \
    --argjson v2RoutesPreserved "$routes_ok" \
    --argjson canonicalEnvelopeVerified "$envelope_ok" \
    --argjson compatible "$compatible" \
    --arg detail "$detail" \
    '{found:$found,releaseID:$releaseID,releasePath:$releasePath,manifestVerified:$manifestVerified,v2RoutesPreserved:$v2RoutesPreserved,canonicalEnvelopeVerified:$canonicalEnvelopeVerified,compatible:$compatible,detail:$detail}' > "$OUTPUT_PATH"
