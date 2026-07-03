#!/usr/bin/env sh
# Docker gate：以 production build（既有 Dockerfile → .output）跑 gate spec，
# 與本機 dev server 完全隔離 —— 多 session 同時 push 也不互撞。
# 流程：build image → run container（ephemeral port，僅綁 127.0.0.1）
#       → 等 ready → host 端 Playwright 以 E2E_BASE_URL 打進 container → 清理。
set -eu

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
docker run -d --rm --name "$container" -p 127.0.0.1::3000 "$image" >/dev/null

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
  if curl -fs -o /dev/null "$base_url/" 2>/dev/null; then
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
