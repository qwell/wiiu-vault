#!/usr/bin/env bash
set -euo pipefail

titles_dir="$(realpath "$(dirname "${BASH_SOURCE[0]}")/../titles")"

ranges=(
    "0005000010100000:0005000010220000"
    "000500001f600000:000500001f601f00"
    "000500001f700000:000500001f702f00"
    "000500001f800000:000500001f80ff00"
    "000500001f940e00:000500001f940f00" # "A", "B"
    "000500001f943100:000500001f943100" # Nintendo eShop, WUP-N-HAEJ
    "000500001fbf1000:000500001fbf1000" # FBF10 [patched2]

##    "0005000010000000:00050000127fff00"
#    "0005000012800000:0005000012ffff00"

##    "000500001f000000:000500001fffff00"
)

title_all_url="http://localhost:3000/api/title-all?titleId=%s"
update_metadata_url="http://localhost:3000/api/title-update?titleId=%s"
dlc_metadata_url="http://localhost:3000/api/title-dlc?titleId=%s"
samurai_contents_url="https://samurai.wup.shop.nintendo.net/samurai/ws/US/contents/?shop_id=2&limit=10000"

parallel="${parallel:-16}"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

echo "Creating $tmp_dir"
mkdir -p "$tmp_dir/tmd" "$tmp_dir/meta" "$tmp_dir/updates" "$tmp_dir/dlc"

titles_file="$titles_dir/titles.json"
extra_file="$titles_dir/extra.json"
icons_file="$titles_dir/icons.json"
exclude_file="$titles_dir/exclude.json"
titledb_file="$titles_dir/titledb.csv"

exclude_title_ids_file="$tmp_dir/exclude-title-ids.json"
samurai_icons_file="$tmp_dir/samurai-icons.json"
extra_base_file="$tmp_dir/extra-base.json"
extra_updates_file="$tmp_dir/extra-updates.json"
extra_dlc_file="$tmp_dir/extra-dlc.json"

export title_all_url update_metadata_url dlc_metadata_url tmp_dir icons_file

process_title() {
    local n="$1"
    local title_id="$2"

    local title_all_api
    local update_versions
    local dlc_versions

    title_all_api="$(printf "$title_all_url" "$title_id")"

    if curl -fsS "$title_all_api" 2>/dev/null |
        jq -ce '
            select(
                .titleId != null
                and
                (
                    .name != null
                    or .productCode != null
                    or .companyCode != null
                )
            )
            | {
                titleId,
                name,
                region,
                productCode,
                companyCode,
                iconUrl: null,
                updates: (.updates // []),
                dlc: (.dlc // [])
            }
        ' > "$tmp_dir/meta/$title_id.json"; then
        update_versions="$(jq -r '.updates | if length == 0 then "none" else join(",") end' "$tmp_dir/meta/$title_id.json")"
        dlc_versions="$(jq -r '.dlc | if length == 0 then "none" else join(",") end' "$tmp_dir/meta/$title_id.json")"

        printf "[%d] HIT  %s update=%s dlc=%s\n" "$n" "$title_id" "$update_versions" "$dlc_versions"
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

if [[ -f "$exclude_file" ]]; then
    jq '
        map(.titleId | tostring | ascii_downcase)
        | map(select(test("^[0-9a-f]{16}$")))
        | unique
    ' "$exclude_file" > "$exclude_title_ids_file"
else
    echo "[]" > "$exclude_title_ids_file"
fi

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
} |
jq -R -r --slurpfile exclude "$exclude_title_ids_file" '
    ($exclude[0] | INDEX(.)) as $excluded
    | select($excluded[.] | not)
' |
nl -ba |
xargs -r -P "$parallel" -n 2 bash -c 'process_title "$1" "$2"' _

jq --indent 4 -s 'sort_by(.titleId)' "$tmp_dir"/meta/*.json > "$titles_file" 2>/dev/null || echo "[]" > "$titles_file"

echo "Title data saved to $titles_file"

if [[ -f "$titledb_file" ]]; then
    if ! command -v mlr >/dev/null 2>&1; then
        echo "Skipping $extra_file: mlr is not installed"
    else
        mkdir -p "$tmp_dir/extra-updates" "$tmp_dir/extra-dlc"

        mlr --icsv --ojson --infer-none cat "$titledb_file" |
        jq --slurpfile titles "$titles_file" --slurpfile exclude "$exclude_title_ids_file" '
            ($titles[0]
                | map(.titleId | tostring | ascii_downcase)
                | INDEX(.)
            ) as $have
            | ($exclude[0] | INDEX(.)) as $excluded
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
            | map(select($excluded[.titleId] | not))
            | sort_by(.titleId)
        ' > "$extra_base_file"

        jq -r '.[].titleId' "$extra_base_file" |
        nl -ba |
        xargs -r -P "$parallel" -n 2 bash -c 'process_extra_title "$1" "$2"' _

        jq -s 'sort_by(.titleId)' "$tmp_dir"/extra-updates/*.json > "$extra_updates_file" 2>/dev/null || echo "[]" > "$extra_updates_file"
        jq -s 'sort_by(.titleId)' "$tmp_dir"/extra-dlc/*.json > "$extra_dlc_file" 2>/dev/null || echo "[]" > "$extra_dlc_file"

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

if command -v xmlstarlet >/dev/null 2>&1; then
    if curl -kfsS "$samurai_contents_url" |
        xmlstarlet sel -t \
            -m '/eshop/contents/content/title[@id and string-length(icon_url) > 0]' \
            -v '@id' -o $'\t' \
            -v 'icon_url' -n \
            - |
        jq -R -s --indent 4 '
            split("\n")
            | map(
                select(length > 0)
                | split("\t")
                | select(length == 2)
                | {
                    titleId: (.[0] | ascii_downcase),
                    iconUrl: .[1]
                }
                | select(.titleId | test("^[0-9a-f]{16}$"))
            )
            | unique_by(.titleId)
            | sort_by(.titleId)
        ' > "$samurai_icons_file"; then

        jq -s --indent 4 '
            .[0] as $icons
            | ($icons | map(.titleId) | INDEX(.)) as $have
            | $icons + (
                .[1]
                | map(
                    select(
                        .titleId
                        and .iconUrl
                        and ($have[.titleId] | not)
                    )
                )
                | unique_by(.titleId)
            )
            | sort_by(.titleId)
        ' "$icons_file" "$samurai_icons_file" > "$tmp_dir/icons.json" &&
            mv "$tmp_dir/icons.json" "$icons_file"

        echo "Icon data saved to $icons_file"
    else
        echo "Skipping Samurai icon supplement: fetch or xmlstarlet conversion failed"
    fi
else
    echo "Skipping Samurai icon supplement: xmlstarlet is not installed"
fi

if [[ -f "$icons_file" ]]; then
    jq --indent 4 '
        . as $icons
        | ($icons
            | map({
                key: .titleId,
                value: .iconUrl
            })
            | from_entries
        ) as $by_title
        | input
        | map(.iconUrl = ($by_title[.titleId] // null))
    ' "$icons_file" "$titles_file" > "$tmp_dir/titles-with-icons.json" &&
        mv "$tmp_dir/titles-with-icons.json" "$titles_file"

    if [[ -f "$extra_file" ]]; then
        jq --indent 4 '
            . as $icons
            | ($icons
                | map({
                    key: .titleId,
                    value: .iconUrl
                })
                | from_entries
            ) as $by_title
            | input
            | map(.iconUrl = ($by_title[.titleId] // null))
        ' "$icons_file" "$extra_file" > "$tmp_dir/extra-with-icons.json" &&
            mv "$tmp_dir/extra-with-icons.json" "$extra_file"
    fi
fi
