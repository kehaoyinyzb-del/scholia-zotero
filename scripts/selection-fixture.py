"""CC0 sentences for native selection, cancellation, and latency acceptance."""
from pathlib import Path
import fitz

root = Path(__file__).resolve().parents[1]
doc = fitz.open()
p = doc.new_page(width=612, height=792)
p.insert_text((48, 58), 'Selection translation / original fixture', fontsize=18)
lines = [
    'In this digital timing specification, assert means drive a signal active.',
    'assert',
    'The source shall not change DATA for 3 cycles.',
    'A latch stores a bit while its enable input is inactive.',
    'The gate must remain closed for 12 ns.',
    'The result does not establish a causal effect.',
]
for i in range(20):
    lines.append(f'Sample {i + 1}: The measured delay is {i + 2} ns.')
for i, line in enumerate(lines):
    p.insert_text((48, 100 + i * 23), line, fontsize=11)
p.insert_text((48, 754), 'Original material / CC0 / 1', fontsize=9)
doc.set_metadata({'title': 'Selection translation fixture', 'author': 'Reading Companion',
                  'subject': 'CC0-1.0'})
doc.set_page_labels([{'startpage': 0, 'prefix': '', 'style': 'D', 'firstpagenum': 1}])
doc.save(root / 'samples/selection-translation.pdf', garbage=4, deflate=True, no_new_id=True)
out = root / '.zotero-dev/fixture-render'
out.mkdir(parents=True, exist_ok=True)
p.get_pixmap(matrix=fitz.Matrix(1.3, 1.3)).save(out / 'selection-translation.png')
