"""Create a CC0 raster-only page for the isolated no-text-layer acceptance."""
from pathlib import Path
import fitz

root = Path(__file__).resolve().parents[1]
output = root / '.zotero-dev/scan-fixture.pdf'
output.parent.mkdir(exist_ok=True)
source = fitz.open()
page = source.new_page(width=612, height=792)
page.insert_text((48, 100), 'Raster-only acceptance page', fontsize=24)
page.insert_text((48, 160), 'Original CC0 fixture. No text layer or OCR.', fontsize=14)
image = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5))
scanned = fitz.open()
scanned.new_page(width=612, height=792).insert_image(page.rect, pixmap=image)
assert scanned[0].get_text() == ''
scanned.save(output, garbage=4, deflate=True, no_new_id=True)
print(output)
