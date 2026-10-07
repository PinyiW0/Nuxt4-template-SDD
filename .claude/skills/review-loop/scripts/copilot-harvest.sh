#!/bin/sh
# 把 Copilot 在指定 PR 留下的每一則意見整理成 eval 用的 case（TSV）。
# 唯讀，只查 GitHub。verdict 欄一律留空，由之後的判定步驟（evals/README.md）填。
#
# 一則「意見」有兩種來源，都要收，漏任一種 eval 就會低估 Copilot 的產出：
#   1. inline 留言（REST /pulls/N/comments）：有 comment_id、有 thread、有我方回覆。
#   2. review body 裡的「Previously missed」：沒有 comment_id。v1 格式在 `### Suppressed comments`
#      底下用 `**path:line**` 列；v2 格式在 `<strong>Previously missed (N)</strong>` 底下用巢狀 <details>。
#      兩種都解析；v2 的路徑夾著零寬空白（U+200B），要先清掉。
#
# 結束碼契約（與 copilot.sh 一字不差）：0 成功／1 可重試的執行失敗／2 參數錯誤／3 需人工介入（缺 gh／jq）。
# 不用 pipefail、不把 gh 接進管線，理由見 copilot.sh 檔頭。
set -eu

usage() {
  cat <<'USAGE'
用法：
  copilot-harvest.sh <PR編號> [<PR編號> ...]
      每個 PR 的每則 Copilot 意見印一列 TSV（第一行是欄名），依 PR 參數順序、再依時間排。

欄位（11 欄，固定順序）：
  pr             PR 編號
  review_id      該意見所屬的 review id
  comment_id     inline 留言的 id；review body 內的「Previously missed」沒有 id，留空
  path, line     檔案與行號（行號來自 Copilot，可能差 2–4 行，只當參考）
  severity       High／Medium／Low，來自 v2 review body 的圖示；v1 沒有，留空
  created_at     留言或 review 的時刻
  body_excerpt   意見內容前 200 字（換行與 tab 換成空白）
  reply_excerpt  我方第一則回覆前 200 字。inline 取 thread 內第一則非 Bot 回覆；
                 Previously missed 取 PR 留言中第一則提到該路徑的非 Bot 留言。沒有就空
  is_resolved    thread 是否已 Resolved（true／false）；Previously missed 沒有 thread，留空
  verdict        留空，之後填 必修已修／誤判／範圍外／可選／未回覆

結束碼：0 成功／1 可重試的執行失敗／2 參數錯誤／3 需人工介入。
USAGE
}

die() { printf '%s\n' "$2" >&2; exit "$1"; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || die 3 "找不到 $1。$2"; }
require_num() {
  case "$2" in
    '' | *[!0-9]*) die 2 "$1 必須是數字，收到：$2" ;;
  esac
}
repo_slug() {
  if ! _slug="$(gh repo view --json nameWithOwner -q .nameWithOwner)"; then
    die 1 "取不到 repo（gh repo view 失敗）：確認 gh 已認證、且目前在 git repo 內。"
  fi
  [ -n "$_slug" ] || die 1 "gh repo view 成功但沒有輸出，無法判斷 repo。"
  printf '%s' "$_slug"
}

# 與 copilot.sh L78、copilot-metrics.sh、SKILL.md 鐵律 2 同一份白名單，改一處就要同步改其他處。
COPILOT_LOGINS='["Copilot","copilot-pull-request-reviewer","copilot-pull-request-reviewer[bot]"]'

# 四個來源各抓成一個檔（每檔是「頁的陣列」，jq 裡再攤平），全部抓齊才開始算，中途失敗就整個 PR 放棄。
fetch_sources() {
  slug="$1"; pr="$2"; dir="$3"
  owner="${slug%%/*}"; name="${slug##*/}"

  if ! gh api --paginate "repos/${slug}/pulls/${pr}/comments?per_page=100" --jq '.' > "$dir/comments.json"; then
    die 1 "取 PR #${pr} 的 inline 留言失敗（gh api）。可重試。"
  fi
  if ! gh api --paginate "repos/${slug}/pulls/${pr}/reviews?per_page=100" --jq '.' > "$dir/reviews.json"; then
    die 1 "取 PR #${pr} 的 review 失敗（gh api）。可重試。"
  fi
  if ! gh api --paginate "repos/${slug}/issues/${pr}/comments?per_page=100" --jq '.' > "$dir/issue_comments.json"; then
    die 1 "取 PR #${pr} 的 PR 留言失敗（gh api）。可重試。"
  fi
  # thread 的 Resolved 狀態只有 GraphQL 有。每個 thread 只取第一則留言的 databaseId 當 key，
  # 那就是 Copilot 開 thread 的那則 inline 留言 id。
  if ! gh api graphql --paginate -f owner="$owner" -f name="$name" -F pr="$pr" -f query='
    query($owner:String!,$name:String!,$pr:Int!,$endCursor:String){
      repository(owner:$owner,name:$name){
        pullRequest(number:$pr){
          reviewThreads(first:100, after:$endCursor){
            pageInfo{ hasNextPage endCursor }
            nodes{ isResolved comments(first:1){ nodes{ databaseId } } }
          }
        }
      }
    }' --jq '[ .data.repository.pullRequest.reviewThreads.nodes[]
               | { isResolved, firstId: .comments.nodes[0].databaseId } ]' > "$dir/threads.json"; then
    die 1 "取 PR #${pr} 的 review thread 失敗（gh api graphql）。可重試。"
  fi
  for f in comments reviews issue_comments threads; do
    [ -s "$dir/$f.json" ] || die 1 "PR #${pr} 的 $f 回應是空的，狀態不明。可重試。"
  done
}

header() {
  printf 'pr\treview_id\tcomment_id\tpath\tline\tseverity\tcreated_at\tbody_excerpt\treply_excerpt\tis_resolved\tverdict\n'
}

harvest_pr() {
  pr="$1"
  require_num "PR 編號" "$pr"
  slug="$(repo_slug)" || exit $?
  dir="$(mktemp -d)" || die 1 "建不了暫存目錄。"
  fetch_sources "$slug" "$pr" "$dir" || { rm -rf "$dir"; exit 1; }

  if ! jq -r -n --arg pr "$pr" --argjson logins "$COPILOT_LOGINS" \
        --slurpfile comments "$dir/comments.json" \
        --slurpfile reviews "$dir/reviews.json" \
        --slurpfile issues "$dir/issue_comments.json" \
        --slurpfile threads "$dir/threads.json" '
    # --paginate 每頁一個陣列；--slurpfile 再包一層。攤成一層並拒絕非陣列（gh 失敗時可能吐物件）。
    def flat: [ .[] | if type == "array" then . else error("GitHub API 回傳非陣列：" + tostring) end | .[] ];
    def excerpt: (. // "") | gsub("\r"; "") | gsub("\n+"; " ") | gsub("\t"; " ") | .[0:200];
    def strip_zw: gsub("​"; "");
    def is_copilot: (.user.type == "Bot") and (.user.login | IN($logins[]));

    ($comments | flat) as $c
    | ($reviews | flat | map(select(is_copilot)) | sort_by(.id)) as $r
    | ($threads | flat) as $t
    | ($issues | flat | map(select(.user.type != "Bot"))) as $ic

    # v2 body 的 Open／Resolved 清單：每條「圖示 … #discussion_r<id>」→ id → 嚴重度。多則 review 重複列時取最後一次。
    | ([ $r[] | (.body // "")
        | match("alt=\"(High|Medium|Low) severity\"[^\\n]*?#discussion_r([0-9]+)"; "g")
        | { key: .captures[1].string, value: .captures[0].string } ] | from_entries) as $sev
    | ([ $t[] | select(.firstId != null) | { key: (.firstId | tostring), value: .isResolved } ] | from_entries) as $res

    # 來源 1：Copilot 開 thread 的 inline 留言（排除它自己的回覆）；我方回覆＝同 thread 第一則非 Bot。
    | ($c | map(select(is_copilot and .in_reply_to_id == null))) as $ci
    | ($c | map(select(.in_reply_to_id != null and .user.type != "Bot")) | sort_by(.created_at)
        | group_by(.in_reply_to_id) | map({ key: (.[0].in_reply_to_id | tostring), value: .[0].body }) | from_entries) as $rep
    | ($ci | map({
        pr: $pr,
        review_id: (.pull_request_review_id | tostring),
        comment_id: (.id | tostring),
        path: (.path | strip_zw),
        line: ((.line // .original_line // "") | tostring),
        severity: ($sev[(.id | tostring)] // ""),
        created_at,
        body_excerpt: (.body | excerpt),
        reply_excerpt: ($rep[(.id | tostring)] // "" | excerpt),
        is_resolved: (($res[(.id | tostring)] // "") | tostring),
        verdict: ""
      })) as $rows_inline

    # 來源 2：review body 的 Previously missed。v2 巢狀 <details>（有嚴重度與標題）；v1 `**path:line**` 接 `* 說明`。
    # 同一條會在後續 review 重複列到修掉為止，依 path:line 去重、留最早那次。
    | ([ $r[] | . as $rv | (.body // "")
        | ( [ match("<details>\\s*<summary><picture>[\\s\\S]*?alt=\"(High|Medium|Low) severity\"[\\s\\S]*?</picture>\\s*([^<\\n]*?)</summary>\\s*`([^`\\n]+?):([0-9]+)`\\s*([\\s\\S]*?)\\s*</details>"; "g")
              | { sev: .captures[0].string, title: .captures[1].string,
                  path: (.captures[2].string | strip_zw), line: .captures[3].string, text: .captures[4].string } ]
          + [ match("\\*\\*([^*\\n]+?):([0-9]+)\\*\\*\\s*\\n\\* ([^\\n]+)"; "g")
              | { sev: "", title: "",
                  path: (.captures[0].string | strip_zw), line: .captures[1].string, text: .captures[2].string } ] )
        | .[] | . + { review_id: ($rv.id | tostring), created_at: $rv.submitted_at } ]
      | sort_by(.created_at) | group_by(.path + ":" + .line) | map(.[0])
      | map(. as $m | {
          pr: $pr,
          review_id,
          comment_id: "",
          path, line,
          severity: .sev,
          created_at,
          body_excerpt: ((if .title != "" then .title + " — " else "" end) + .text | excerpt),
          reply_excerpt: (([ $ic[] | select(.body | contains($m.path)) ] | .[0].body // "") | excerpt),
          is_resolved: "",
          verdict: ""
        })) as $rows_missed

    | ($rows_inline + $rows_missed) | sort_by(.created_at) | .[]
    | [ .pr, .review_id, .comment_id, .path, .line, .severity, .created_at,
        .body_excerpt, .reply_excerpt, .is_resolved, .verdict ] | @tsv'; then
    rm -rf "$dir"
    die 1 "PR #${pr} 的資料解析失敗。可重試。"
  fi
  rm -rf "$dir"
}

require_cmd gh "本腳本全部查詢都透過它。請先安裝並 gh auth login。"
require_cmd jq "解析與合併四個來源都要它。請先安裝（brew install jq／apt install jq）。"

[ $# -ge 1 ] || { usage >&2; exit 2; }
for p in "$@"; do require_num "PR 編號" "$p"; done

header
for p in "$@"; do
  harvest_pr "$p" || exit $?
done
