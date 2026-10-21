#!/bin/sh
# 用途：lint → 無聲 render（render/<name>-<mode>.mp4 比 index.html 與 hf/assets 內所有檔都新才重用，跳過 lint 與 render） → 長度對帳 → 合音軌 → 自動編號輸出（取最大編號＋1，永不覆蓋）。
# 用法：sh render.sh <work> [full|sample] [name]    預設 full、name 預設 video
#   full 讀 <work>/hf、cues.json、mix.wav；sample 讀 hf-sample、cues.sample.json、mix.sample.wav。
# 輸出：<work>/out/<name>-NN.mp4、同名 .jpg 封面（總長 40% 處）、同名 .json sidecar（sha256、版本、時間）。
# render 先輸出到 render/<name>-<mode>.tmp.mp4，成功才 mv 成正式檔；失敗會刪半成品，render/ 不留殘檔。
# 結束碼：0 成功；1 參數錯誤、hyperframes 版本不一致或 lint error>0（重用舊 render 時不重跑 lint）；2 render 失敗；3 mux 失敗、輸出檔已存在或編號用完（99）；
#         4 畫面／cues／音軌長度差 >0.1 秒。
set -eu

HF_VER=0.8.180

[ $# -ge 1 ] || { echo "用法：sh render.sh <work> [full|sample] [name]" >&2; exit 1; }
WORK=$(cd "$1" && pwd)
MODE=${2:-full}
NAME=${3:-video}
case "$MODE" in
  full) HF="$WORK/hf"; CUES="$WORK/cues.json"; MIX="$WORK/mix.wav" ;;
  sample) HF="$WORK/hf-sample"; CUES="$WORK/cues.sample.json"; MIX="$WORK/mix.sample.wav" ;;
  *) echo "mode 只能是 full 或 sample" >&2; exit 1 ;;
esac

# 版本比對：render.sh 的 HF_VER 要和專案 package.json 一致
PKG_VER=$(sed -n 's/.*hyperframes@\([0-9][0-9.]*\).*/\1/p' "$HF/package.json" | head -1)
if [ "$PKG_VER" != "$HF_VER" ]; then
  echo "hyperframes 版本不一致：render.sh=${HF_VER}，${HF}/package.json=${PKG_VER:-找不到}" >&2
  exit 1
fi

mkdir -p "$WORK/render" "$WORK/out"
VIDEO="$WORK/render/$NAME-$MODE.mp4"
if [ -e "$VIDEO" ] && [ -z "$(find "$HF/index.html" "$HF/assets" -newer "$VIDEO" 2>/dev/null | head -1)" ]; then
  # 畫面已是最新（index.html 與 hf/assets 內任一檔都不比 render 新）：只重跑對帳與 mux，調音量不必重 render
  echo "重用 render/$NAME-$MODE.mp4"
else
  # lint
  cd "$HF"
  # 只讀 stdout（stderr 丟掉），取「以 { 開頭的那一行起」整段做 JSON.parse
  LINT=$(npx --yes "hyperframes@$HF_VER" lint --json 2>/dev/null || true)
  ERRS=$(printf '%s' "$LINT" | node -e 'const s=require("fs").readFileSync(0,"utf8");const m=s.match(/^\{/m);try{console.log(JSON.parse(s.slice(m.index)).errorCount)}catch{console.log(-1)}')
  if [ "$ERRS" != "0" ]; then
    echo "lint errorCount=$ERRS" >&2
    printf '%s\n' "$LINT" >&2
    exit 1
  fi

  # 無聲 render
  TMPV="$WORK/render/$NAME-$MODE.tmp.mp4"
  rm -f "$TMPV"
  npx --yes "hyperframes@$HF_VER" render --quality looks --output "$TMPV" || { rm -f "$TMPV"; exit 2; }
  mv -f "$TMPV" "$VIDEO"
fi

# 長度對帳
dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }
TOTAL=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).total' "$CUES")
DV=$(dur "$VIDEO")
DA=$(dur "$MIX")
if ! awk -v t="$TOTAL" -v v="$DV" -v a="$DA" 'function d(x){return x<0?-x:x} BEGIN{exit !(d(v-t)<=0.1 && d(a-t)<=0.1)}'; then
  echo "長度對不上：畫面 ${DV}、cues.total ${TOTAL}、音軌 ${DA}（容許 0.1 秒）" >&2
  exit 4
fi

# 自動編號，set -C 保證永不覆蓋
# 取現有最大編號＋1（有缺號也不會撞檔）
MAXN=0
for f in "$WORK/out/$NAME"-[0-9][0-9].mp4; do
  [ -e "$f" ] || continue
  n=${f%.mp4}
  n=${n##*-}; n=${n#0}; n=${n:-0}
  [ "$n" -gt "$MAXN" ] && MAXN=$n
done
[ "$MAXN" -lt 99 ] || { echo "編號用完（已到 ${NAME}-99），請換名稱" >&2; exit 3; }
BASE="$WORK/out/$(printf '%s-%02d' "$NAME" $((MAXN + 1)))"
set -C
: > "$BASE.mp4" || { echo "輸出檔已存在：$BASE.mp4" >&2; exit 3; }
set +C
ffmpeg -y -loglevel error -i "$VIDEO" -i "$MIX" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart "$BASE.mp4" || { rm -f "$BASE.mp4"; exit 3; }

# 封面與 sidecar
SS=$(awk -v t="$TOTAL" 'BEGIN{printf "%.2f", t*0.4}')
ffmpeg -n -loglevel error -ss "$SS" -i "$BASE.mp4" -frames:v 1 -q:v 2 "$BASE.jpg" || exit 3
sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
# hf/assets 檔名＋大小清單的 sha256（重錄素材會讓它變）
ASSETS=$(cd "$HF/assets" 2>/dev/null && find . -type f | LC_ALL=C sort | while IFS= read -r f; do printf '%s %s\n' "$f" "$(wc -c < "$f" | tr -d ' ')"; done | shasum -a 256 | cut -d' ' -f1)
set -C
cat > "$BASE.json" <<JSON
{
  "hyperframes": "$HF_VER",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "sha256": {
    "index.html": "$(sha "$HF/index.html")",
    "$(basename "$CUES")": "$(sha "$CUES")",
    "$(basename "$MIX")": "$(sha "$MIX")"
  },
  "assets": "$ASSETS"
}
JSON
set +C
echo "$BASE.mp4"
