#!/bin/sh
# Copilot review 的三個 gh 操作。抽成腳本的理由：re-request 要先解出兩個 node ID，
# 手打三次 gh 容易出錯；而且 REST 版本會「回 200 但無效」，錯了不會報錯只會靜默不動。
#
# 結束碼契約（呼叫端照這個分流，不要只看輸出）：
#   0  成功。輸出可信。reviews 回空陣列＝真的沒有新 review，這是合法結果。
#   1  執行失敗（環境、API、資料異常）。**可重試**——呼叫端記錄後排下一輪，
#      絕不可當成「沒有新 review」。
#   2  參數或用法錯誤。呼叫端寫錯了，重試無用。
#   3  需人工介入（找不到 reviewer bot、撈到多個無法判斷、mutation 沒掛上 reviewer）。
#
# 為什麼不用 pipefail：非 POSIX，dash 會在 set 那行就 Illegal option，
# 而本檔一律以 `sh` 呼叫（對齊 ship/scripts/ledger.sh）。沒有 pipefail 時管線的結束碼
# 取自最後一段，所以**一律不把 gh 接進管線**：先捕進變數、明確檢查結束碼，再交給 jq。
# 踩過：gh 失敗且 stdout 空時，jq -s 會回 [] 並 exit 0，迴圈誤判成「沒有新 review」而靜默空轉。
set -eu

usage() {
  cat <<'USAGE'
用法：
  copilot.sh bot-id
      解析本 repo 的 Copilot reviewer bot node ID。輸出：一行 node ID。

  copilot.sh request <PR編號> [botId]
      用 GraphQL 重新請 Copilot review（REST 的 requested_reviewers 對 re-request 無效）。
      帶 botId 可跳過解析（狀態檔快取用）。輸出：一行提示文字。

  copilot.sh reviews <PR編號> [since-review-id]
      列出 Copilot reviewer 的 review。輸出：JSON 陣列，含 body 與 commit_id。
      給了 since-review-id 就只列 id 大於它的。

結束碼：0 成功／1 可重試的執行失敗／2 參數錯誤／3 需人工介入。
非 0 時輸出一律不可信，尤其不得把失敗當成「沒有新 review」。
USAGE
}

die() { echo "$2" >&2; exit "$1"; }

# 參數一律驗 numeric：since 會被當成 jq 參數、pr 會進 URL path，
# 而 since 的來源是狀態檔（內容由 GitHub 上的外部文字輾轉寫入），不驗就是注入面。
require_num() {
  case "$2" in
    '' | *[!0-9]*) die 2 "$1 必須是數字，收到：$2" ;;
  esac
}

# gh 的錯誤訊息本來就會走 stderr，這裡不吞掉，讓呼叫者看得到原因。
repo_slug() {
  if ! _slug="$(gh repo view --json nameWithOwner -q .nameWithOwner)"; then
    die 1 "取不到 repo（gh repo view 失敗）：確認 gh 已認證、且目前在 git repo 內。"
  fi
  [ -n "$_slug" ] || die 1 "gh repo view 成功但沒有輸出，無法判斷 repo。"
  printf '%s' "$_slug"
}

# reviewer bot 的 login 隨端點而異（實測 2026-09-02）：
#   GraphQL review author      → copilot-pull-request-reviewer
#   REST /pulls/N/reviews      → copilot-pull-request-reviewer[bot]
#   REST /pulls/N/comments     → Copilot
# 所以比對 login 而非硬編字串。但只用 contains("copilot") 太寬，會撈到 copilot-swe-agent
# 這類「另一個 copilot bot」——請錯 bot 一樣回成功，然後 review 永遠不會來。
# bot_id 與 list_reviews 一律共用下面這條判準：type 是 Bot ＋ login 命中 copilot.*review。
# （comments 端點的短 login "Copilot" 不適用此式，本腳本沒有用到那個端點。）
bot_id() {
  slug="$(repo_slug)" || exit $?
  owner="${slug%%/*}"; name="${slug##*/}"

  if ! ids="$(gh api graphql -f owner="$owner" -f name="$name" -f query='
    query($owner:String!,$name:String!){
      repository(owner:$owner,name:$name){
        pullRequests(last:50,states:[OPEN,MERGED,CLOSED]){
          nodes{ reviews(first:50){ nodes{ author{ login __typename ... on Bot { id } } } } }
        }
      }
    }' --jq '
      [ .data.repository.pullRequests.nodes[].reviews.nodes[].author
        | select(.__typename == "Bot" and (.login | ascii_downcase | test("copilot.*review")))
        | .id ] | unique | .[]')"; then
    die 1 "查 bot id 失敗（gh api graphql）。可重試。"
  fi

  if [ -z "$ids" ]; then
    echo "找不到 Copilot reviewer 的 bot node ID：本 repo 近 50 個 PR 都沒有它的 review。" >&2
    echo "先讓 Copilot review 過任一個 PR——開 PR 時帶 REST requested_reviewers 可觸發初次 review" >&2
    die 3 "（見 references/copilot-quirks.md 第 1 節），之後 re-request 才有 id 可用。"
  fi
  if [ "$(printf '%s\n' "$ids" | wc -l | tr -d ' ')" -gt 1 ]; then
    echo "撈到多個 copilot review bot，無法判斷該請哪一個：" >&2
    printf '%s\n' "$ids" | sed 's/^/  /' >&2
    die 3 "請人工指定：copilot.sh request <PR編號> <botId>"
  fi
  printf '%s\n' "$ids"
}

request_review() {
  pr="$1"; bot="${2:-}"
  require_num "PR 編號" "$pr"

  if ! pr_id="$(gh pr view "$pr" --json id -q .id)"; then
    die 1 "取不到 PR #${pr} 的 node id（gh pr view 失敗）：確認 PR 存在且看得到。"
  fi
  [ -n "$pr_id" ] || die 1 "gh pr view 成功但沒回 node id。"

  if [ -z "$bot" ]; then
    bot="$(bot_id)" || exit $?
  fi

  if ! out="$(gh api graphql -f prId="$pr_id" -f botId="$bot" -f query='
    mutation($prId:ID!,$botId:ID!){
      requestReviews(input:{pullRequestId:$prId, botIds:[$botId], union:true}){
        pullRequest{ reviewRequests(first:10){ nodes{ requestedReviewer{
          __typename ... on Bot { login } } } } }
      }
    }' --jq '
      [ .data.requestReviews.pullRequest.reviewRequests.nodes[].requestedReviewer
        | select(.__typename == "Bot") | .login ] | join(", ")')"; then
    die 1 "請 review 失敗（requestReviews mutation）。可重試。"
  fi

  # mutation 成功但沒掛上 reviewer：不是可重試的錯誤，是要人去看的異常。
  [ -n "$out" ] || die 3 "mutation 成功但 reviewRequests 是空的——請人工到 PR 頁面確認 Copilot 是否可用。"
  echo "已請 review：$out"
}

list_reviews() {
  pr="$1"; since="${2:-0}"
  require_num "PR 編號" "$pr"
  require_num "since-review-id" "$since"
  slug="$(repo_slug)" || exit $?

  # 不接管線：先捕獲並檢查 gh 的結束碼，這樣「取得失敗」不會被下游 jq 洗成 [] exit 0。
  if ! raw="$(gh api --paginate "repos/${slug}/pulls/${pr}/reviews?per_page=100" --jq '.')"; then
    die 1 "取 PR #${pr} 的 review 失敗（gh api）。可重試——不要當成沒有新 review。"
  fi
  [ -n "$raw" ] || die 1 "gh api 回 0 但沒有輸出，狀態不明。可重試——不要當成沒有新 review。"

  # --paginate 會把每頁各吐一個陣列，所以要 -s 併起來。
  # since 走 --argjson 傳參，不做字串內插——內插會讓狀態檔的內容變成可執行的 jq 運算式。
  if ! printf '%s' "$raw" | jq -s --argjson since "$since" '
        [ .[]
          | if type == "array" then . else error("GitHub API 回傳非陣列：" + tostring) end
          | .[]
          | select(.user.type == "Bot"
                   and (.user.login | ascii_downcase | test("copilot.*review"))
                   and .id > $since)
          | {id, state, submitted_at, commit_id, body} ]'; then
    die 1 "review 資料解析失敗（回應不是預期的陣列）。可重試。"
  fi
}

case "${1:-}" in
  bot-id)   [ $# -eq 1 ] || die 2 "bot-id 不吃參數。"; bot_id ;;
  request)  { [ $# -ge 2 ] && [ $# -le 3 ]; } || { usage >&2; exit 2; }; request_review "$2" "${3:-}" ;;
  reviews)  { [ $# -ge 2 ] && [ $# -le 3 ]; } || { usage >&2; exit 2; }; list_reviews "$2" "${3:-0}" ;;
  *)        usage >&2; exit 2 ;;
esac
