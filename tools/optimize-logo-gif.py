"""
把 Premiere 导出的高分辨率 logo GIF 重新编码成适合网页的体积。

背景：
  logo_glitched.gif 在页面里显示宽度只有 300px，但源文件是 1920x540 / 68 帧 / 13.3MB。
  浏览器至少要把它整份下载完才播，属于首屏阻塞级的大文件。
  按显示尺寸反推，1920px 宽是 6.4 倍冗余。

用法：
  python tools/optimize-logo-gif.py            # 只生成候选文件到 logo_variants/，不动原图
  python tools/optimize-logo-gif.py --apply 720  # 用 720px 宽那档覆盖 logo_glitched.gif

说明：
  - 保留原始帧数与时序（duration），只做尺寸与调色板优化。
  - 同时输出 WebP 版：GIF 是 1987 年的格式，同样画质下 WebP 通常小一个数量级。
"""

import argparse
import os
import sys

from PIL import Image, ImageSequence

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "logo_glitched.gif")
OUT_DIR = os.path.join(ROOT, "logo_variants")

# 页面显示宽度 300px；给出 2x / 3x 两档，供高分屏取舍
CANDIDATE_WIDTHS = (600, 720, 900)
WEBP_WIDTH = 720
WEBP_QUALITY = 82


def load_frames(width):
    """读出所有帧并按目标宽度等比缩放。"""
    im = Image.open(SRC)
    src_w, src_h = im.size
    height = max(1, round(src_h * width / src_w))
    frames, durations = [], []
    for frame in ImageSequence.Iterator(im):
        durations.append(frame.info.get("duration", 40))
        rgba = frame.convert("RGBA")
        # GIF 没有半透明，转 RGB 前先在黑底上合成，避免边缘出现白边
        flat = Image.new("RGB", rgba.size, (0, 0, 0))
        flat.paste(rgba, mask=rgba.split()[3])
        frames.append(flat.resize((width, height), Image.LANCZOS))
    return frames, durations, (src_w, src_h), (width, height)


def save_gif(frames, durations, path):
    quantized = [f.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG)
                 for f in frames]
    quantized[0].save(
        path,
        save_all=True,
        append_images=quantized[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=2,
    )
    return os.path.getsize(path)


def save_webp(frames, durations, path):
    frames[0].save(
        path,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        quality=WEBP_QUALITY,
        method=6,
    )
    return os.path.getsize(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", type=int, metavar="WIDTH",
                        help="用指定宽度那档覆盖 logo_glitched.gif（建议 720）")
    args = parser.parse_args()

    if not os.path.exists(SRC):
        sys.exit("找不到 %s" % SRC)
    os.makedirs(OUT_DIR, exist_ok=True)

    src_size = os.path.getsize(SRC)
    print("源文件: %s  %.2f MB" % (SRC, src_size / 1048576))

    results = []
    for width in CANDIDATE_WIDTHS:
        frames, durations, src_dim, out_dim = load_frames(width)
        gif_path = os.path.join(OUT_DIR, "logo_%d.gif" % width)
        gif_size = save_gif(frames, durations, gif_path)
        row = {"width": width, "dim": out_dim, "frames": len(frames),
               "gif": gif_size, "webp": None}
        if width == WEBP_WIDTH:
            webp_path = os.path.join(OUT_DIR, "logo_%d.webp" % width)
            row["webp"] = save_webp(frames, durations, webp_path)
        results.append(row)
        print("  %4dpx -> %sx%s, %d 帧, GIF %.2f MB (省 %.1f%%)"
              % (width, out_dim[0], out_dim[1], len(frames),
                 gif_size / 1048576, 100 * (1 - gif_size / src_size)))
        del frames

    for row in results:
        if row["webp"]:
            print("  %4dpx WebP q%d: %.2f MB (省 %.1f%% vs 源文件)"
                  % (row["width"], WEBP_QUALITY, row["webp"] / 1048576,
                     100 * (1 - row["webp"] / src_size)))

    print("\n候选文件已写入 %s（未改动 logo_glitched.gif）" % OUT_DIR)

    if args.apply:
        chosen = os.path.join(OUT_DIR, "logo_%d.gif" % args.apply)
        if not os.path.exists(chosen):
            sys.exit("没有 %dpx 这一档，可选：%s" % (args.apply, [r["width"] for r in results]))
        backup = os.path.join(ROOT, "logo_glitched_prermiere.gif")
        if not os.path.exists(backup):
            os.rename(SRC, backup)
            print("原文件已备份为 %s" % os.path.basename(backup))
        with open(chosen, "rb") as fsrc, open(SRC, "wb") as fdst:
            fdst.write(fsrc.read())
        print("已用 %dpx 版本覆盖 logo_glitched.gif (%.2f MB)"
              % (args.apply, os.path.getsize(SRC) / 1048576))


if __name__ == "__main__":
    main()
