"""
裁掉 logo GIF 里残留的上下黑带，并重新生成页面用的 WebP。

背景：
  Premiere 裁剪后画面是 1920x540，但文字上下仍各留了一截纯黑（按显示宽 300px 算
  约 4px / 6px）。这些黑带和 .logo-screen 的 padding 叠加，会让"发光屏"的黑框显得很厚。

做法：
  1. 取所有帧的亮度二值图并集，得到内容的整体包围盒——用并集而不是单帧，
     是为了不裁掉抖动时才会溢出到边缘的毛刺和扫描线。
  2. 按包围盒 + 少量安全余量裁剪每一帧。
  3. 重新生成 logo_<w>.webp 与首帧预览图。

用法：
  python tools/crop-logo-black.py            # 只看测得的裁剪框，不写文件
  python tools/crop-logo-black.py --apply    # 真正写出 WebP 资产
"""

import argparse
import os

from PIL import Image, ImageSequence

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "logo_glitched.gif")
OUT_DIR = os.path.join(ROOT, "assets", "img")
WIDTHS = (720, 1080)
WEBP_QUALITY = 82

# 内容判定阈值：黑底是纯 0，取 40 可以保住毛刺、滤掉极暗噪点
THRESHOLD = 40
# 裁剪后额外保留的像素余量，避免贴边把毛刺切平
MARGIN = 2


def load_frames():
    im = Image.open(SRC)
    frames, durations = [], []
    for f in ImageSequence.Iterator(im):
        durations.append(f.info.get("duration", 40))
        rgba = f.convert("RGBA")
        flat = Image.new("RGB", rgba.size, (0, 0, 0))
        flat.paste(rgba, mask=rgba.split()[3])
        frames.append(flat)
    return frames, durations


def content_box(frames, threshold=THRESHOLD):
    """所有帧亮像素的并集包围盒。"""
    w, h = frames[0].size
    x0, y0, x1, y1 = w, h, -1, -1
    for f in frames:
        mask = f.convert("L").point(lambda v: 255 if v > threshold else 0)
        box = mask.getbbox()
        if not box:
            continue
        bx0, by0, bx1, by1 = box
        x0, y0 = min(x0, bx0), min(y0, by0)
        x1, y1 = max(x1, bx1 - 1), max(y1, by1 - 1)
    if x1 < 0:
        return (0, 0, w - 1, h - 1)
    return (x0, y0, x1, y1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="写出裁剪后的 WebP 资产")
    ap.add_argument("--margin", type=int, default=MARGIN)
    args = ap.parse_args()

    frames, durations = load_frames()
    w, h = frames[0].size
    x0, y0, x1, y1 = content_box(frames)
    x0 = max(0, x0 - args.margin)
    y0 = max(0, y0 - args.margin)
    x1 = min(w - 1, x1 + args.margin)
    y1 = min(h - 1, y1 + args.margin)

    cw, ch = x1 - x0 + 1, y1 - y0 + 1
    print("源画面      : %dx%d" % (w, h))
    print("内容包围盒  : x[%d,%d] y[%d,%d]" % (x0, y0, x1, y1))
    print("裁剪后      : %dx%d  (比例 %.2f:1, 原 %.2f:1)" % (cw, ch, cw / ch, w / h))
    print("去掉的黑边  : 上 %dpx 下 %dpx 左 %dpx 右 %dpx" % (y0, h - 1 - y1, x0, w - 1 - x1))

    if not args.apply:
        print("\n（未写文件，加 --apply 生效）")
        return

    cropped = [f.crop((x0, y0, x1 + 1, y1 + 1)) for f in frames]
    os.makedirs(OUT_DIR, exist_ok=True)
    for target_w in WIDTHS:
        target_h = max(1, round(ch * target_w / cw))
        small = [f.resize((target_w, target_h), Image.LANCZOS) for f in cropped]
        path = os.path.join(OUT_DIR, "logo_%d.webp" % target_w)
        small[0].save(path, save_all=True, append_images=small[1:],
                      duration=durations, loop=0, quality=WEBP_QUALITY, method=6)
        print("  写出 assets/img/logo_%d.webp  %dx%d  %.2f MB"
              % (target_w, target_w, target_h, os.path.getsize(path) / 1048576))
        if target_w == WIDTHS[0]:
            print("  → index.html 里 <img> 的 width/height 应为 300 x %d"
                  % round(target_h * 300 / target_w))
        del small


if __name__ == "__main__":
    main()
