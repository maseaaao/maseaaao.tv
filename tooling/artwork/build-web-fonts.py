"""Build Unbounded 600 in WOFF2 with its complete character coverage.

Requires fonttools[woff]. Arial is provided by the operating system.
"""
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
name = "unbounded-600.woff2"
output = root / "packages/design/fonts"
output.mkdir(exist_ok=True)
(output / name).write_bytes(content)
print(f"{name}: {len(content)} bytes; {len(characters)} Unicode characters")
