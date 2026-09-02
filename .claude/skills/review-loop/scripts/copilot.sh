#!/usr/bin/env bash
# Copilot review 的三個 gh 操作。抽成腳本的理由：re-request 要先解出兩個 node ID，
# 手打三次 gh 容易出錯；而且 REST 版本會「回 200 但無效」，錯了不會報錯只會靜默不動。
set -euo pipefail

usage() {
  cat <<'USAGE'
用法：
  copilot.sh bot-id
      解析本 repo 的 Copilot reviewer bot node ID。

  copilot.sh request <PR編號> [botId]
      用 GraphQL 重新請 Copilot review（REST 的 requested_reviewers 對 re-request 無效）。
      帶 botId 可跳過解析（狀態檔快取用）。

  copilot.sh reviews <PR編號> [since-review-id]
      列出 Copilot 的 review（JSON 陣列，含 body 與 commit_id）。
      給了 since-review-id 就只列 id 大於它的。

結束碼：0 成功／1 執行失敗／2 參數錯誤。
輸出保證是 JSON 陣列；非 0 結束時一律不得當成「沒有新 review」。
USAGE
}

# 參數一律驗numeric：since 會被當成 jq 參數、pr 會進 URL path，
# 而 since 的來源是狀態檔（內容由 GitHub 上的外部文字輾轉寫入），不驗就是注入面。
require_num() {
  case "$2" in
    '' | *[!0-9]*) echo "$1 必須是數字，收到：$2" >&2; exit 2 ;;
  esac
}

repo_slug() { gh repo view --json nameWithOwner -q .nameWithOwner; }

# Copilot 在不同端點有三種 login（Copilot / copilot-pull-request-reviewer / …[bot]），
# 所以比對 login 而非硬編字串；但要夠精確才不會撈到 copilot-swe-agent 這類「另一個 copilot bot」
# ——請錯 bot 一樣會回成功，然後 review 永遠不會來。撈到多個不同 id 就報錯，不猜。
bot_id() {
  local slug owner name ids
  slug="$(repo_slug)"; owner="${slug%%/*}"; name="${slug##*/}"
  ids="$(gh api graphql -f owner="$owner" -f name="$name" -f query='
    query($owner:String!,$name:String!){
      repository(owner:$owner,name:$name){
        pullRequests(last:50,states:[OPEN,MERGED,CLOSED]){
          nodes{ reviews(first:50){ nodes{ author{ login __typename ... on Bot { id } } } } }
        }
      }
    }' --jq '
      [ .data.repository.pullRequests.nodes[].reviews.nodes[].author
        | select(.__typename == "Bot" and (.login | ascii_downcase | test("copilot.*review")))
        | .id ] | unique | .[]')"

  if [ -z "$ids" ]; then
    echo "找不到 Copilot reviewer 的 bot node ID：本 repo 近 50 個 PR 都沒有它的 review。" >&2
    echo "先讓 Copilot review 過任一個 PR——開 PR 時帶 REST requested_reviewers 可觸發初次 review" >&2
    echo "（見 references/copilot-quirks.md 第 1 節），之後 re-request 才有 id 可用。" >&2
    exit 1
  fi
  if [ "$(printf '%s\n' "$ids" | wc -l | tr -d ' ')" -gt 1 ]; then
    echo "撈到多個 copilot review bot，無法判斷該請哪一個：" >&2
    printf '  %s\n' $ids >&2
    echo "請人工指定：copilot.sh request <PR編號> <botId>" >&2
    exit 1
  fi
  printf '%s\n' "$ids"
}

request_review() {
  local pr="$1" bot="${2:-}" pr_id
  require_num "PR 編號" "$pr"
  pr_id="$(gh pr view "$pr" --json id -q .id)"
  [ -n "$bot" ] || bot="$(bot_id)"
  gh api graphql -f prId="$pr_id" -f botId="$bot" -f query='
    mutation($prId:ID!,$botId:ID!){
      requestReviews(input:{pullRequestId:$prId, botIds:[$botId], union:true}){
        pullRequest{ reviewRequests(first:10){ nodes{ requestedReviewer{
          __typename ... on Bot { login } } } } }
      }
    }' --jq '
      [ .data.requestReviews.pullRequest.reviewRequests.nodes[].requestedReviewer
        | select(.__typename == "Bot") | .login ]
      | if length > 0 then "已請 review：" + join(", ")
        else "⚠️ mutation 成功但 reviewRequests 是空的——請人工到 PR 頁面確認" end'
}

list_reviews() {
  local pr="$1" since="${2:-0}" slug
  require_num "PR 編號" "$pr"
  require_num "since-review-id" "$since"
  slug="$(repo_slug)"
  # since 走 --argjson 傳參，不做字串內插——內插會讓狀態檔的內容變成可執行的 jq 運算式。
  gh api --paginate "repos/${slug}/pulls/${pr}/reviews?per_page=100" \
    --jq '.' \
    | jq -s --argjson since "$since" '
        [ .[]
          | if type == "array" then . else error("GitHub API 回傳非陣列：" + tostring) end
          | .[]
          | select((.user.login | ascii_downcase | contains("copilot")) and .id > $since)
          | {id, state, submitted_at, commit_id, body} ]'
}

case "${1:-}" in
  bot-id)   bot_id ;;
  request)  [ $# -ge 2 ] || { usage >&2; exit 2; }; request_review "$2" "${3:-}" ;;
  reviews)  [ $# -ge 2 ] || { usage >&2; exit 2; }; list_reviews "$2" "${3:-0}" ;;
  *)        usage >&2; exit 2 ;;
esac
