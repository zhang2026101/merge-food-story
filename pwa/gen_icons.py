import struct, zlib, os

# 生成占位 PNG 图标（纯色）。实现 Agent 应替换为真实简笔画图标。
def png(path, size, rgb):
    w = h = size
    raw = bytearray()
    r, g, b = rgb
    for _ in range(h):
        raw.append(0)                 # filter type 0 (None)
        for _ in range(w):
            raw += bytes((r, g, b, 255))
    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data +
                struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff))
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)   # 8-bit RGBA
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")
os.makedirs(OUT, exist_ok=True)
COLOR = (244, 196, 48)   # 暖黄占位色
png(os.path.join(OUT, "icon-192.png"), 192, COLOR)
png(os.path.join(OUT, "icon-512.png"), 512, COLOR)
png(os.path.join(OUT, "icon-maskable-512.png"), 512, COLOR)
print("icons generated at", OUT)
