#!/usr/bin/env bash
set -euo pipefail

titles_dir="$(dirname -- "${BASH_SOURCE[0]}")/../titles"

ranges=(
    "0005000010100000:0005000010220000"
    "000500001f600000:000500001f608000"
)

metadata_url="http://localhost:3000/api/title-metadata?titleId=%s"
update_metadata_url="http://localhost:3000/api/title-update?titleId=%s"
dlc_metadata_url="http://localhost:3000/api/title-dlc?titleId=%s"

parallel="${parallel:-16}"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

echo "Creating $tmp_dir"
mkdir -p "$tmp_dir/tmd" "$tmp_dir/meta" "$tmp_dir/updates" "$tmp_dir/dlc"

titles_file="$titles_dir/titles.json"
extra_file="$titles_dir/extra.json"
icons_file="$titles_dir/icons.json"
titledb_file="$titles_dir/titledb.csv"

updates_file="$tmp_dir/updates.json"
dlc_file="$tmp_dir/dlc.json"
extra_base_file="$tmp_dir/extra-base.json"
extra_updates_file="$tmp_dir/extra-updates.json"
extra_dlc_file="$tmp_dir/extra-dlc.json"

export metadata_url update_metadata_url dlc_metadata_url tmp_dir icons_file

process_title() {
    local n="$1"
    local title_id="$2"

    local meta_api
    local icon_url
    local update_api
    local update_version
    local dlc_api
    local dlc_version

    meta_api="$(printf "$metadata_url" "$title_id")"

    icon_url="$(
        jq -r --arg titleId "$title_id" '
            map(select(.titleId == $titleId))[0].iconUrl // "null"
        ' "$icons_file"
    )"

    if curl -fsS "$meta_api" 2>/dev/null |
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
        ' > "$tmp_dir/meta/$title_id.json"; then
        update_api="$(printf "$update_metadata_url" "$title_id")"
        update_version="$(
            curl -fsSL "$update_api" 2>/dev/null |
            jq -r 'if .exists == true and (.titleVersion // null) != null then .titleVersion else empty end'
        )" || true

        if [[ -n "$update_version" ]]; then
            jq -nc \
                --arg titleId "$title_id" \
                --argjson version "$update_version" \
                '{titleId: $titleId, version: $version}' \
                > "$tmp_dir/updates/$title_id.json"
        fi

        dlc_api="$(printf "$dlc_metadata_url" "$title_id")"
        dlc_version="$(
            curl -fsSL "$dlc_api" 2>/dev/null |
            jq -r 'if .exists == true and (.titleVersion // null) != null then .titleVersion else empty end'
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
        rm -f "$tmp_dir/meta/$title_id.json"
        printf "[%d] MISS %s\n" "$n" "$title_id"
    fi
}

process_extra_title() {
    local n="$1"
    local title_id="$2"

    local update_api
    local update_version
    local dlc_api
    local dlc_version

    update_api="$(printf "$update_metadata_url" "$title_id")"
    update_version="$(
        curl -fsSL "$update_api" 2>/dev/null |
        jq -r 'if .exists == true and (.titleVersion // null) != null then .titleVersion else empty end'
    )" || true

    if [[ -n "$update_version" ]]; then
        jq -nc \
            --arg titleId "$title_id" \
            --argjson version "$update_version" \
            '{titleId: $titleId, version: $version}' \
            > "$tmp_dir/extra-updates/$title_id.json"
    fi

    dlc_api="$(printf "$dlc_metadata_url" "$title_id")"
    dlc_version="$(
        curl -fsSL "$dlc_api" 2>/dev/null |
        jq -r 'if .exists == true and (.titleVersion // null) != null then .titleVersion else empty end'
    )" || true

    if [[ -n "$dlc_version" ]]; then
        jq -nc \
            --arg titleId "$title_id" \
            --argjson version "$dlc_version" \
            '{titleId: $titleId, version: $version}' \
            > "$tmp_dir/extra-dlc/$title_id.json"
    fi

    printf "[%d] EXTRA %s update=%s dlc=%s\n" "$n" "$title_id" "${update_version:-none}" "${dlc_version:-none}"
}

export -f process_title
export -f process_extra_title

{
    for range in "${ranges[@]}"; do
        start_hex="${range%%:*}"
        end_hex="${range##*:}"

        start_dec=$((16#$start_hex))
        end_dec=$((16#$end_hex))

        for ((current_dec=start_dec; current_dec<=end_dec; current_dec+=0x100)); do
            printf "%016x\n" "$current_dec"
        done
    done
} | nl -ba | xargs -P "$parallel" -n 2 bash -c 'process_title "$1" "$2"' _

jq --indent 4 -s 'sort_by(.titleId)' "$tmp_dir"/updates/*.json > "$updates_file" 2>/dev/null || echo "[]" > "$updates_file"
jq --indent 4 -s 'sort_by(.titleId)' "$tmp_dir"/dlc/*.json > "$dlc_file" 2>/dev/null || echo "[]" > "$dlc_file"
jq --indent 4 -s \
    --slurpfile updates "$updates_file" \
    --slurpfile dlc "$dlc_file" '
        map(
            . as $title
            | .updates = (
                [
                    $updates[0][]
                    | select(.titleId == $title.titleId)
                    | .version
                ]
            )
            | .dlc = (
                [
                    $dlc[0][]
                    | select(.titleId == $title.titleId)
                    | .version
                ]
            )
        )
        | sort_by(.titleId)
    ' "$tmp_dir"/meta/*.json > "$titles_file" 2>/dev/null || echo "[]" > "$titles_file"

echo "Title data saved to $titles_file"

if [[ -f "$titledb_file" ]]; then
    if ! command -v mlr >/dev/null 2>&1; then
        echo "Skipping $extra_file: mlr is not installed"
    else
        mkdir -p "$tmp_dir/extra-updates" "$tmp_dir/extra-dlc"

        mlr --icsv --ojson cat "$titledb_file" |
        jq --slurpfile titles "$titles_file" '
            ($titles[0]
                | map(.titleId | tostring | ascii_downcase)
                | INDEX(.)
            ) as $have
            | map({
                titleId: (."Title ID" | tostring | ascii_downcase),
                name: (.Description // "Unknown"),
                region: (if (.Region // "") == "" then null else .Region end),
                productCode: (if (."Product Code" // "") == "" then null else ."Product Code" end),
                companyCode: (if (."Company Code" // "") == "" then null else ."Company Code" end),
                iconUrl: null,
                updates: [],
                dlc: [],
                availableOnCdn: (
                    if (."Available on CDN?" | tostring | ascii_downcase) == "yes"
                    then "Yes"
                    else "No"
                    end
                )
            })
            | map(select(.titleId | test("^[0-9a-f]{16}$")))
            | map(select($have[.titleId] | not))
            | sort_by(.titleId)
        ' > "$extra_base_file"

        jq -r '.[].titleId' "$extra_base_file" |
        nl -ba |
        xargs -P "$parallel" -n 2 bash -c 'process_extra_title "$1" "$2"' _

        jq --indent 4 -s 'sort_by(.titleId)' "$tmp_dir"/extra-updates/*.json > "$extra_updates_file" 2>/dev/null || echo "[]" > "$extra_updates_file"
        jq --indent 4 -s 'sort_by(.titleId)' "$tmp_dir"/extra-dlc/*.json > "$extra_dlc_file" 2>/dev/null || echo "[]" > "$extra_dlc_file"

        jq --indent 4 \
            --slurpfile updates "$extra_updates_file" \
            --slurpfile dlc "$extra_dlc_file" '
                map(
                    . as $title
                    | .updates = (
                        [
                            $updates[0][]
                            | select(.titleId == $title.titleId)
                            | .version
                        ]
                    )
                    | .dlc = (
                        [
                            $dlc[0][]
                            | select(.titleId == $title.titleId)
                            | .version
                        ]
                    )
                )
                | sort_by(.titleId)
            ' "$extra_base_file" > "$extra_file"

        echo "Extra title data saved to $extra_file"
    fi
fi
