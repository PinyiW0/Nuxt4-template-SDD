#!/bin/sh
# 用途：用 ffmpeg 現做示範素材（不入 repo），並把 assets/demo/* 複製進工作資料夾。
# 產出：<work>/assets/demo-board.mp4（testsrc2 6 秒）、demo-history.mp4（testsrc 4 秒）、
#       <work>/bgm.wav（18 秒、48 kHz 立體聲 sine 和弦）；
#       兩支影片皆 1920x1080、30 fps、yuv420p、無聲、faststart。
# 用法：sh demo-assets.sh <work>
# 結束碼：0 成功；1 失敗（參數錯誤或 ffmpeg 失敗）
set -eu

[ $# -ge 1 ] || { echo "用法：sh demo-assets.sh <work>" >&2; exit 1; }
WORK=$1
HERE=$(cd "$(dirname "$0")" && pwd)
DEMO="$HERE/../assets/demo"
mkdir -p "$WORK/assets"

enc() { # <lavfi 來源> <秒> <輸出>
  ffmpeg -y -loglevel error -f lavfi -i "$1" -t "$2" -an \
    -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart "$3" || exit 1
}
enc "testsrc2=size=1920x1080:rate=30" 6 "$WORK/assets/demo-board.mp4"
enc "testsrc=size=1920x1080:rate=30" 4 "$WORK/assets/demo-history.mp4"

# 示範配樂：三個頻率疊加，頭尾淡入淡出
ffmpeg -y -loglevel error \
  -f lavfi -i "sine=f=220:d=18:r=48000" -f lavfi -i "sine=f=277.18:d=18:r=48000" -f lavfi -i "sine=f=329.63:d=18:r=48000" \
  -filter_complex "amix=inputs=3:normalize=0,volume=0.3,afade=t=in:d=1.5,afade=t=out:st=16:d=2,aformat=sample_fmts=s16:channel_layouts=stereo" \
  -ar 48000 -ac 2 "$WORK/bgm.wav" || exit 1

# 複製示範 timeline 與 scenes；已存在的檔不覆蓋
if [ -d "$DEMO" ]; then
  cp -Rn "$DEMO"/. "$WORK"/ || true # macOS 的 cp -n 遇到已存在檔會回非 0
fi
