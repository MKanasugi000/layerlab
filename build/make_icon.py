"""LayerLab アイコン生成。
重なった3枚のレイヤー（最上面=ブランド青）を角丸ダークタイルに配置した、
「レイヤーエディタ」が一目で伝わるアイコンを PIL だけで描画し、
PNG（256/512/1024）とマルチサイズ .ico を書き出す。

実行: python build/make_icon.py
"""
from PIL import Image, ImageDraw, ImageFilter
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

SS = 4               # スーパーサンプリング倍率（ポリゴンのアンチエイリアス用）
BASE = 1024          # 最終ロゴ解像度
W = BASE * SS        # 作業解像度

# ---- カラーパレット（Photoshop風ダークUI + LayerLab青アクセント）----
BG_TOP = (42, 52, 72)        # #2a3448 角丸タイル上端
BG_BOTTOM = (19, 24, 34)     # #131822 角丸タイル下端
EDGE = (60, 74, 102)         # タイル縁のハイライト
LAYER_BACK = (74, 90, 120)   # #4a5a78 一番下のシート
LAYER_MID = (150, 170, 205)  # #96aacd 中間シート
LAYER_TOP = (43, 155, 255)   # #2b9bff 最上面（アクティブ＝ブランド青）
STROKE = (15, 19, 28)        # シート間の溝（暗）


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_tile(size):
    """縦グラデの角丸タイル（RGBA）を返す。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    grad = Image.new("RGB", (1, size))
    for y in range(size):
        grad.putpixel((0, y), lerp(BG_TOP, BG_BOTTOM, y / (size - 1)))
    grad = grad.resize((size, size))

    radius = int(size * 0.225)
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)

    img.paste(grad, (0, 0), mask)

    # 縁の内側ハイライト（立体感）
    od = ImageDraw.Draw(img)
    od.rounded_rectangle(
        [int(size * 0.012)] * 2 + [size - 1 - int(size * 0.012)] * 2,
        radius=int(radius * 0.95), outline=EDGE + (110,), width=max(1, int(size * 0.006)),
    )
    return img


def rhombus(cx, cy, hw, hh):
    """水平ダイヤ（左・上・右・下）の頂点列。"""
    return [(cx - hw, cy), (cx, cy - hh), (cx + hw, cy), (cx, cy + hh)]


def draw_layers(img):
    d = ImageDraw.Draw(img)
    cx = W // 2
    hw = int(W * 0.300)        # ダイヤ半幅
    hh = int(W * 0.150)        # ダイヤ半高（2:1）
    offset = int(W * 0.135)    # シート間の縦オフセット（< hh で重なる）
    stroke_w = max(2, int(W * 0.014))

    sheets = [
        (cx, W // 2 + offset, LAYER_BACK),   # 下
        (cx, W // 2, LAYER_MID),             # 中
        (cx, W // 2 - offset, LAYER_TOP),    # 上（青）
    ]
    for x, y, color in sheets:
        pts = rhombus(x, y, hw, hh)
        d.polygon(pts, fill=color, outline=STROKE, width=stroke_w)


def main():
    # 影を別レイヤーで作ってから合成（立体感）
    canvas = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    canvas.alpha_composite(rounded_tile(W))

    shadow = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.polygon(
        rhombus(W // 2, W // 2 + int(W * 0.135) + int(W * 0.05),
                int(W * 0.30), int(W * 0.15)),
        fill=(0, 0, 0, 130),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(int(W * 0.02)))
    canvas.alpha_composite(shadow)

    draw_layers(canvas)

    # タイルの角丸でクリップ（影/シートのはみ出し防止）
    clip = Image.new("L", (W, W), 0)
    ImageDraw.Draw(clip).rounded_rectangle(
        [0, 0, W - 1, W - 1], radius=int(W * 0.225), fill=255)
    canvas.putalpha(Image.composite(canvas.getchannel("A"),
                                    Image.new("L", (W, W), 0), clip))

    logo = canvas.resize((BASE, BASE), Image.LANCZOS)

    os.makedirs(HERE, exist_ok=True)
    logo.save(os.path.join(HERE, "icon-1024.png"))
    logo.resize((512, 512), Image.LANCZOS).save(os.path.join(HERE, "icon-512.png"))
    png256 = logo.resize((256, 256), Image.LANCZOS)
    png256.save(os.path.join(HERE, "icon-256.png"))

    # renderer 用 favicon
    os.makedirs(os.path.join(ROOT, "public"), exist_ok=True)
    png256.save(os.path.join(ROOT, "public", "icon.png"))

    # マルチサイズ .ico
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    logo.save(os.path.join(HERE, "icon.ico"), format="ICO", sizes=sizes)

    print("wrote:")
    for f in ("icon.ico", "icon-256.png", "icon-512.png", "icon-1024.png"):
        p = os.path.join(HERE, f)
        print(f"  {p}  ({os.path.getsize(p)} bytes)")
    print(f"  {os.path.join(ROOT, 'public', 'icon.png')}")


if __name__ == "__main__":
    main()
