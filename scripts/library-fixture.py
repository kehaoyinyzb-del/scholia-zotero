"""Original non-engineering fixture; insertion order deliberately differs from reading order."""
from pathlib import Path
import fitz

root = Path(__file__).resolve().parents[1]
document = fitz.open()
page = document.new_page(width=612, height=792)
page.insert_text((48, 754), 'Original acceptance fixture / CC0 / 1', fontsize=9)
page.insert_text((48, 80), 'Library opening hours and visits', fontsize=20)
lines = [
    (150, 'A study of 18 branches recorded a 6% increase in visits during exam weeks only.'),
    (174, 'Repeated entries were excluded from the unique visitors count.'),
    (230, 'Branches chose their own opening schedules. These observations cannot establish that'),
    (248, 'longer opening hours caused the increase in visits.'),
    (300, 'After adjustment, the confidence interval included zero.'),
    (360, 'Visits count entries, not people. Unique visitors count distinct people.'),
    (384, 'The same visitor can make several visits.'),
]
for top, text in lines:
    page.insert_text((48, top), text, fontsize=11)
document.set_page_labels([{'startpage': 0, 'prefix': '', 'style': 'D', 'firstpagenum': 1}])
document.set_metadata({'title': 'Library opening hours - original acceptance fixture',
                       'author': 'Reading Companion project', 'subject': 'CC0-1.0'})
output = root / 'samples/library-study.pdf'
document.save(output, garbage=4, deflate=True, no_new_id=True)
review = root / '.zotero-dev/fixture-render'
review.mkdir(parents=True, exist_ok=True)
page.get_pixmap(matrix=fitz.Matrix(1.3, 1.3)).save(review / 'library-study.png')
print(output)
