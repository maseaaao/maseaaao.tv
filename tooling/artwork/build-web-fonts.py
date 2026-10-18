"""Build Unbounded 600 in WOFF2 with its complete character coverage.

Requires fonttools[woff]. Previous hashed resources remain available for cached pages.
"""
from hashlib import sha256
from io import BytesIO
from pathlib import Path
import re
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parents[2]
font = TTFont(root / "packages/design/fonts/Unbounded.ttf", recalcTimestamp=False)
characters = set(font.getBestCmap())
font = instantiateVariableFont(font, {"wght": 600}, inplace=True)
assert set(font.getBestCmap()) == characters, "Character coverage must be preserved"
font.flavor = "woff2"
buffer = BytesIO()
font.save(buffer)
content = buffer.getvalue()
name = f"unbounded-600.{sha256(content).hexdigest()[:16]}.woff2"
output = root / "packages/design/fonts"
output.mkdir(exist_ok=True)
(output / name).write_bytes(content)
for file in ("packages/design/brand.css", "apps/website/public/index.html"):
    target = root / file
    target.write_text(re.sub(r"unbounded-600\.[a-z0-9]+\.woff2", name, target.read_text(encoding="utf-8")), encoding="utf-8")
print(f"{name}: {len(content)} bytes; {len(characters)} Unicode characters")
