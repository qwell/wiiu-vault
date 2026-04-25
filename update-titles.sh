#!/usr/bin/env bash
set -euo pipefail

start_hex="0005000010100000"
end_hex="0005000010220000"

tmd_url="http://ccs.cdn.c.shop.nintendowifi.net/ccs/download/%s/tmd"
metadata_url="http://localhost:3000/api/title-metadata?titleId=%s"

parallel="${parallel:-16}"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

echo "Creating $tmp_dir"
mkdir -p "$tmp_dir/tmd" "$tmp_dir/meta" "$tmp_dir/updates" "$tmp_dir/dlc"

titles_file="titles.json"
icons_file="icons.json"

updates_file="$tmp_dir/updates.json"
dlc_file="$tmp_dir/dlc.json"

export tmd_url metadata_url tmp_dir icons_file

process_title() {
    local n="$1"
    local title_id="$2"

    local base_url
    local base_tmd_file
    local http_code
    local curl_rc

    base_url="$(printf "$tmd_url" "$title_id")"
    base_tmd_file="$tmp_dir/tmd/$title_id.tmd"

    http_code="$(curl -sS -L -o "$base_tmd_file" -w "%{http_code}" "$base_url")"
    curl_rc=$?

    if [[ $curl_rc -eq 0 && "$http_code" == "200" && -s "$base_tmd_file" ]]; then
        local meta_api

        local icon_url

        local update_id
        local update_url
        local update_version

        local dlc_id
        local dlc_url
        local dlc_version

        meta_api="$(printf "$metadata_url" "$title_id")"

        icon_url="$(
            jq -r --arg titleId "$title_id" '
                map(select(.titleId == $titleId))[0].iconUrl // "null"
            ' "$icons_file"
        )"

        curl -fsS "$meta_api" |
        jq -c --arg iconUrl "$icon_url" '
            {
                titleId,
                name,
                region,
                productCode,
                companyCode,
                iconUrl: (
                    if $iconUrl == "null" or $iconUrl == "" then null else $iconUrl end
                ),
                updates: [],
                dlc: []
            }
        ' > "$tmp_dir/meta/$title_id.json" || rm -f "$tmp_dir/meta/$title_id.json"

        update_id="${title_id:0:7}e${title_id:8}"
        update_url="$(printf "$tmd_url" "$update_id")"
        update_version="$(
            curl -fsSL "$update_url" 2>/dev/null |
            dd bs=1 skip=$((0x1dc)) count=2 2>/dev/null |
            od -An -tu2 -j0 -N2 --endian=big |
            tr -d " "
        )" || true

        if [[ -n "$update_version" ]]; then
            jq -nc \
                --arg titleId "$title_id" \
                --argjson version "$update_version" \
                '{titleId: $titleId, version: $version}' \
                > "$tmp_dir/updates/$title_id.json"
        fi

        dlc_id="${title_id:0:7}c${title_id:8}"
        dlc_url="$(printf "$tmd_url" "$dlc_id")"
        dlc_version="$(
            curl -fsSL "$dlc_url" 2>/dev/null |
            dd bs=1 skip=$((0x1dc)) count=2 2>/dev/null |
            od -An -tu2 -j0 -N2 --endian=big |
            tr -d " "
        )" || true

        if [[ -n "$dlc_version" ]]; then
            jq -nc \
                --arg titleId "$title_id" \
                --argjson version "$dlc_version" \
                '{titleId: $titleId, version: $version}' \
                > "$tmp_dir/dlc/$title_id.json"
        fi

        printf "[%d] HIT  %s update=%s dlc=%s\n" "$n" "$title_id" "${update_version:-none}" "${dlc_version:-none}"
    else
        rm -f "$base_tmd_file"
        printf "[%d] MISS %s\n" "$n" "$title_id"
    fi
}

export -f process_title

start_dec=$((16#$start_hex))
end_dec=$((16#$end_hex))

for ((current_dec=start_dec; current_dec<=end_dec; current_dec+=0x100)); do
    printf "%016x\n" "$current_dec"
done | nl -ba | xargs -P "$parallel" -n 2 bash -c 'process_title "$1" "$2"' _

jq --indent 4 -s 'sort_by(.titleId)' "$tmp_dir"/updates/*.json > "$updates_file" 2>/dev/null || echo "[]" > "$updates_file"
jq --indent 4 -s 'sort_by(.titleId)' "$tmp_dir"/dlc/*.json > "$dlc_file" 2>/dev/null || echo "[]" > "$dlc_file"
jq --indent 4 -s 'sort_by(.titleId)' "$tmp_dir"/meta/*.json > "$titles_file" 2>/dev/null || echo "[]" > "$titles_file"

echo "Title data saved to $titles_file"
