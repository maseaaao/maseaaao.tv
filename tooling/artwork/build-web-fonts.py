"""Build real Unbounded 400/600 WOFF2 instances with full character coverage.

Requires fonttools[woff]; see requirements-fonts.txt. Arial is provided by the OS.
"""
from io import BytesIO
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parents[2]
source = root / "packages/design/fonts/Unbounded.ttf"
output = source.parent
characters = set(TTFont(source).getBestCmap())
for weight in (400, 600):
    font = TTFont(source, recalcTimestamp=False)
    font = instantiateVariableFont(font, {"wght": weight}, inplace=True)
    assert set(font.getBestCmap()) == characters, "Character coverage must be preserved"
    assert font["OS/2"].usWeightClass == weight, "Instance weight must match the file name"
    font.flavor = "woff2"
    buffer = BytesIO()
    font.save(buffer)
    content = buffer.getvalue()
    check = TTFont(BytesIO(content))
    assert check["OS/2"].usWeightClass == weight
    assert set(check.getBestCmap()) == characters
    name = f"unbounded-{weight}.woff2"
    (output / name).write_bytes(content)
    print(f"{name}: {len(content)} bytes; {len(characters)} Unicode characters; weight {weight}")
