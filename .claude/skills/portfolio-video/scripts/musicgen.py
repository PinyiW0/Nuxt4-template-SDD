# 用途：用 MusicGen（facebook/musicgen-small）生成配樂：先生成一段，再拿尾端當提示往後接，拼出超過目標長度的曲子。
# 用法：<work>/venv/bin/python musicgen.py <out.wav> <seed> <秒> ["prompt"]
#   venv 建法：python3 -m venv <work>/venv && <work>/venv/bin/pip install torch transformers soundfile numpy
#   首跑會下載約 2.2 GB 權重，需 10 分鐘以上。
#   授權：權重為 CC BY-NC 4.0，不可商用；商用請改用自備授權音樂。
# 結束碼：0 成功；1 失敗（參數錯誤、生成例外、接續一次新增 <1 秒、或接續超過 10 次仍不足目標長度）。
import sys
import time

PROMPT = ("minimal modern tech product film score, clean electronic, warm analog synth arpeggio, "
          "soft pulsing bass, crisp light drums, airy pads, confident, elegant, uplifting, 110 bpm, instrumental")


def main():
    out, seed, target = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])
    prompt = sys.argv[4] if len(sys.argv) > 4 else PROMPT

    import numpy as np
    import soundfile as sf
    import torch
    from transformers import AutoProcessor, MusicgenForConditionalGeneration

    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    proc = AutoProcessor.from_pretrained("facebook/musicgen-small")
    model = MusicgenForConditionalGeneration.from_pretrained("facebook/musicgen-small").to(dev)
    sr = model.config.audio_encoder.sampling_rate
    torch.manual_seed(seed)

    t0 = time.time()
    inp = proc(text=[prompt], padding=True, return_tensors="pt").to(dev)
    audio = model.generate(**inp, do_sample=True, guidance_scale=3.0, max_new_tokens=1500)[0, 0].float().cpu().numpy()
    print("第一段", round(len(audio) / sr, 2), "秒，耗時", round(time.time() - t0, 1), flush=True)

    # 往後接：拿最後 10 秒當提示，每次多生成約 20 秒
    rounds = 0
    while len(audio) / sr < target:
        rounds += 1
        if rounds > 10:
            raise RuntimeError("接續超過 10 次仍未達目標長度，中止")
        tail = audio[-10 * sr:]
        inp = proc(audio=tail, sampling_rate=sr, text=[prompt], padding=True, return_tensors="pt").to(dev)
        gen = model.generate(**inp, do_sample=True, guidance_scale=3.0, max_new_tokens=1500)[0, 0].float().cpu().numpy()
        added = gen[len(tail):]
        if len(added) / sr < 1:
            raise RuntimeError(f"本次接續只新增 {len(added) / sr:.2f} 秒（<1 秒），中止避免無窮迴圈")
        audio = np.concatenate([audio, added])
        print("接續後", round(len(audio) / sr, 2), "秒，耗時", round(time.time() - t0, 1), flush=True)

    sf.write(out, audio, sr)
    print("完成", out)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("失敗：", e, file=sys.stderr)
        sys.exit(1)
