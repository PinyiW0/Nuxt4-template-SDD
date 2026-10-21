# 配樂與混音

## bgm 關鍵格預設表

配樂音量與悶度（低通）隨段落切換，在關鍵格之間線性插值。dB 是相對配樂原音量的增益，悶度 0 = 不處理、1 = 最悶。

| 段落 | 音量 dB | 悶度 | 說明 |
|------|---------|------|------|
| title 開頭 | −10 → −6 | 1.0 → 0.8 | 悶、小聲，隨標題展開慢慢打開 |
| kinetic 文字動畫 | −6 | 0.75 | 壓低讓出空間給畫面 |
| scene 操作畫面 | −1 | 0 | 配樂主場，完全打開 |
| end 引言 | −9 | 0.9 | 收尾引言，退到背景 |
| end 品牌名 | −2 | 0.1 | 品牌名出現時推起來 |
| 尾端 | 最後 1.2 秒淡到 −40 | — | 避免突然截斷 |

預設值是起點，依實際配樂的動態調整；調完用下面的響度驗證。

## 響度：loudnorm 兩段式

目標 `I=-16`、`TP=-1.5`、`LRA=11`。兩段式：先量測，再把量到的數字餵回去做線性校正。

```bash
# 第一段：量測，輸出 JSON（input_i、input_tp、input_lra、input_thresh、target_offset）
ffmpeg -i mix.wav -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | tail -n 14

# 第二段：帶入量到的值
ffmpeg -i mix.wav -af "loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=<input_i>:measured_TP=<input_tp>:measured_LRA=<input_lra>:measured_thresh=<input_thresh>:offset=<target_offset>:linear=true" mix-norm.wav
```

驗證：

```bash
ffmpeg -i mix-norm.wav -af ebur128=peak=true -f null - 2>&1 | tail -n 12
```

看 Summary 的 `I`（約 −16 LUFS）與 `True peak`（不高於 −1.5 dBTP）。

## MusicGen 配樂（選用）

`scripts/musicgen.py` 用 `facebook/musicgen-small` 生成配樂，先生一段再拿尾端 10 秒接續，拼到目標長度。

```bash
python3 -m venv <work>/venv && <work>/venv/bin/pip install torch transformers soundfile numpy
<work>/venv/bin/python scripts/musicgen.py <work>/bgm.wav <seed> <秒> ["prompt"]
```

- 首跑要下載約 2.2 GB 權重，需 10 分鐘以上；之後走快取。
- venv 與權重放 `<work>/`（約數百 MB），不入 repo。
- 同一個 seed 與 prompt 結果可重現；不滿意就換 seed。
- 生成長度要比影片長，多留幾秒給尾端淡出。配樂比 `cues.total` 短超過 0.5 秒時 `mix.mjs` 會 exit 3，不會靜默補靜音。

### prompt 範本

腳本預設 prompt：

```
minimal modern tech product film score, clean electronic, warm analog synth arpeggio, soft pulsing bass, crisp light drums, airy pads, confident, elegant, uplifting, 110 bpm, instrumental
```

改風格時保留「instrumental」與 bpm，換掉樂器與形容詞，例如沉穩企業風：`calm corporate film score, soft piano, warm strings, gentle pulse, 90 bpm, instrumental`。

## 授權：商用要換音樂

MusicGen 權重授權是 **CC BY-NC 4.0，不可商用**。作品集、個人展示以外的商用用途（客戶提案、公開行銷、廣告），改用自備授權音樂，放到 `<work>/bgm.wav`，混音流程不變。不確定用途算不算商用，一律當作商用處理。
