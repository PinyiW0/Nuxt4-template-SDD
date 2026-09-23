#!/usr/bin/env sh
# Docker gate：以 production build（既有 Dockerfile → .output）跑 gate spec 全量，
# 與本機 dev server 完全隔離。
# 定位（#150 測試分級後）：/ship --prod-gate 的本機選配。pre-push 不再呼叫它（只跑煙霧），
# production 全量的常規入口是 CI 的 e2e job（.github/workflows/pull_request.yml）。
# 流程：build image → run container（ephemeral port，僅綁 127.0.0.1）
#       → 等 ready → host 端 Playwright 以 E2E_BASE_URL 打進 container → 清理。
set -eu

# 前置檢查與 .husky/pre-push、/vibe-check、CI e2e job 同一套：gate 範圍沒有 spec 檔（模板初始狀態）就放行，
# 否則 Playwright 對「No tests found」回非 0，/ship --prod-gate 在空模板上會白紅。刻意不用 --pass-with-no-tests。
gate_specs=$(find test/e2e/specs test/e2e/vibe -name '*.spec.ts' -not -path '*/vibe/unstable/*' 2>/dev/null || true)
if [ -z "$gate_specs" ]; then
  echo "⚠️  尚無 gate 測試檔（test/e2e/specs｜vibe/*.spec.ts）→ 跳過 Docker gate。"
  exit 0
fi

# 名稱唯一性：worktree 目錄 slug（不同 worktree 必不同）+ PID（同 worktree 並發 push 也不撞）
# BuildKit layer cache 是 content-addressable、與 image tag 解耦 —— 結尾 rmi 掉暫時 tag
# 不會丟 cache，下次 build 依然快；並發 build 共用 cache 由 BuildKit 內部鎖保證安全。
slug=$(basename "$PWD" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-*//; s/-*$//')
[ -n "$slug" ] || slug=nuxt-app
image="e2e-gate-${slug}:pid$$"
container="e2e-gate-${slug}-$$"

# 成功／失敗／Ctrl-C 都收乾淨（--rm 會自刪 container，這裡是保險 + 移除暫時 image tag）
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker rmi "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# 注意：CJK 全形字元緊接變數時，sh 可能把多位元組字元誤併入變數名，故一律用 ${} 定界
echo "🐳 [1/4] Build production image（${image}）…（首次較慢，之後吃 layer cache）"
docker build -t "$image" .

echo "🐳 [2/4] Run container（ephemeral port，僅綁 127.0.0.1）…"
# NUXT_E2E_RESET=true：production build 下 reset 端點（server/api/__test__/reset.post.ts）預設 404，
# 沒有這個旗標每支 spec 的 beforeEach 會先炸。只在 gate 容器設，部署環境不得設。
# 有 auth scaffold 的專案：server/plugins/00.security-guard.ts 在 production 對 REQUIRED_SECRETS fail-fast，
# 在下方再加 -e <key>=<假值> 逐個給（假值不得等於範本的 devDefault 字串，否則一樣拒啟）。
# NUXT_PUBLIC_API_BASE=/api：E2E_BASE_URL 模式下 playwright.config.ts 不掛 webServer，那裡 webServer.env 鎖 /api 的保險套不到
# container；下游若把 runtimeConfig.public.apiBase 設成外部網址，測試會繞出 container 打錯的後端。與 CI e2e job 同一行。
docker run -d --rm --name "$container" -e NUXT_E2E_RESET=true -e NUXT_PUBLIC_API_BASE=/api -p 127.0.0.1::3000 "$image" >/dev/null

# 查 Docker 分配到的 host port（輸出形如 127.0.0.1:54321，可能含 IPv6 行，取第一行）
port=$(docker port "$container" 3000/tcp | head -n1 | awk -F: '{print $NF}')
if [ -z "$port" ]; then
  echo "❌ 取不到 container 對映 port"
  exit 1
fi
base_url="http://127.0.0.1:${port}"

echo "🐳 [3/4] 等待 server ready（${base_url}，最長 60 秒）…"
i=0
ready=0
while [ "$i" -lt 60 ]; do
  # 不用 curl -f：回任何 HTTP 狀態就算 ready（沒有根頁的專案打 / 是 404，-f 會誤判成沒起來）。與 CI e2e job 同一寫法。
  # --max-time 5：container 接了連線卻不回應時 curl 會一直等，迴圈次數就不是真正的上限；單次最多 5 秒。
  if curl -s --max-time 5 -o /dev/null "$base_url/" 2>/dev/null; then
    ready=1
    break
  fi
  i=$((i + 1))
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "❌ Server 60 秒內未 ready，container logs（最後 50 行）："
  docker logs --tail 50 "$container" || true
  exit 1
fi

echo "🐳 [4/4] Run gate spec → ${base_url}"
E2E_BASE_URL="$base_url" npx playwright test --config playwright.gate.config.ts
