"""Prepare and verify independent immutable release assets without publishing.

The releasable products are declared in tooling/release-products.json, so a new
product is added as data instead of a change to this script or to the release
workflow.
"""
from pathlib import Path
import json
import re
import shutil
import sys
import zipfile

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "tooling/release-products.json").read_text(encoding="utf-8"))
products = {product["id"]: product for product in manifest["products"]}
tag = sys.argv[-1]


def find_product(candidate):
    """Return the product whose tag prefix matches, or raise."""
    for product in products.values():
        if candidate.startswith(product["tagPrefix"]):
            return product
    raise SystemExit("Expected a supported product-vX.Y.Z tag")


def product_version(product, tag):
    match = re.fullmatch(re.escape(product["tagPrefix"]) + r"(\d+\.\d+\.\d+)", tag)
    if not match:
        raise SystemExit("Expected a supported product-vX.Y.Z tag")
    return match.group(1)


product = find_product(tag)
version = product_version(product, tag)
app = root / product["path"]
if json.loads((app / "package.json").read_text(encoding="utf-8"))["version"] != version:
    raise SystemExit("Tag must match the selected product's version")
names = product["artifacts"]
notes = (app / "CHANGELOG.md").read_text(encoding="utf-8")
section = re.search(r"^## " + re.escape(version) + r"\s*\n(.*?)(?=^## |\Z)", notes, re.M | re.S)
if not section:
    raise SystemExit("Missing product-specific changelog section")
if "--validate" in sys.argv:
    print(f"Validated {tag}")
    raise SystemExit()
output = root / "build" / "release"
archive_name = f"{product['id']}-{version}.zip"
if "--verify-download" in sys.argv:
    downloaded = root / "build" / "downloaded"
    for name in names + [archive_name]:
        if (downloaded / name).read_bytes() != (output / name).read_bytes():
            raise SystemExit(f"Downloaded artifact differs: {name}")
    print("Downloaded assets match the verified local build")
    raise SystemExit()
if output.exists():
    shutil.rmtree(output)
output.mkdir(parents=True)
for name in names:
    data = (app / "dist" / name).read_bytes()
    if len(data) < 1000 or b"<!doctype html>" not in data.lower():
        raise SystemExit(f"Invalid standalone HTML: {name}")
    (output / name).write_bytes(data)
with zipfile.ZipFile(output / archive_name, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in names:
        archive.write(output / name, name)
    for license_file in (app / "licenses").glob("*"):
        archive.write(license_file, "licenses/" + license_file.name)
    if "licenses/Unbounded-OFL.txt" not in archive.namelist():
        archive.write(root / "packages/design/licenses/Unbounded-OFL.txt", "licenses/Unbounded-OFL.txt")
    for name in ["LICENSE", "THIRD_PARTY_NOTICES.md"]:
        if (app / name).exists():
            archive.write(app / name, name)
(output / "notes.md").write_text(section[1].strip() + "\n", encoding="utf-8")
with zipfile.ZipFile(output / archive_name) as archive:
    assert archive.testzip() is None
    for name in names:
        assert archive.read(name) == (output / name).read_bytes()
print(f"Packaged and verified {tag}: {len(names)} HTML files and ZIP")
