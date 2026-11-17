"""Generate original vector IC test material and rendered review pages using PyMuPDF."""
from pathlib import Path
import json
import fitz

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'samples'
REVIEW = ROOT / '.zotero-dev/fixture-render'
OUTPUT.mkdir(exist_ok=True)
REVIEW.mkdir(parents=True, exist_ok=True)
document = fitz.open()


def page(title, printed):
    result = document.new_page(width=612, height=792)
    result.insert_text((48, 48), 'READING COMPANION / ORIGINAL ACCEPTANCE FIXTURE', fontsize=9)
    result.insert_text((48, 92), title, fontsize=20, fontname='hebo')
    result.draw_line((48, 110), (564, 110), color=(0.6, 0.6, 0.6))
    footer = 'Teaching protocol only - not a commercial IP specification'
    result.insert_text((48, 754), footer, fontsize=9)
    result.insert_text((548, 754), printed, fontsize=10)
    return result


def paragraph(target, text, top, size=12):
    rectangle = fitz.Rect(48, top, 564, top + 100)
    spare = target.insert_textbox(rectangle, text, fontsize=size, lineheight=1.5)
    if spare < 0:
        raise RuntimeError('Fixture text overflows its reserved rectangle')


cover = page('HOLD and SAMPLE interfaces', 'i')
paragraph(cover, 'Revision 1.0 / Public-domain test specification\n'
          'Original material created for this project. Released under CC0.', 142)
paragraph(cover, 'Purpose: distinguish a normative data-stability rule from a waveform '
          'that merely happens to show a constant value.', 260)
paragraph(cover, 'File page 2: HOLD rule. File page 3: positive timing example.\n'
          'File page 4: SAMPLE rule. File page 5: counterexample timing diagram.\n'
          'File page 6: register table with footnotes.', 376)

hold = page('3.1 HOLD channel requirements', '1')
paragraph(hold, 'R1. The source shall hold VALID at 1 and keep DATA[7:0] stable while '
          'VALID=1 and READY=0. The requirement lasts through the accepting rising edge.', 142)
paragraph(hold, 'R2. A transfer occurs only on a rising edge of CLK for which both '
          'VALID and READY are 1. The receiver samples DATA at that edge.', 262)
paragraph(hold, 'R3. All edge numbers in figures count rising edges from the left, '
          'starting with edge 1. The third edge in Figure 1 is stalled, not accepted.', 382)
paragraph(hold, 'Normative terms: shall is mandatory; should is recommended; may is permitted. '
          'An RTL assertion can observe DATA stability after a stalled cycle, '
          'until acceptance.', 502)


def waveform(target, caption, channel):
    paragraph(target, caption, 136)
    start = 150
    interval = 72
    edges = [start + index * interval for index in range(5)]
    for index, edge in enumerate(edges):
        target.draw_line((edge, 248), (edge, 520), color=(0.75, 0.75, 0.75), dashes='[2 3]')
        target.insert_text((edge - 3, 235), str(index + 1), fontsize=12)
    for label, top in [('CLK', 280), ('VALID', 350), ('READY', 420), ('DATA[7:0]', 490)]:
        target.insert_text((48, top), label, fontsize=11, fontname='cour')
    points = [(130, 294)]
    for edge in edges:
        points.extend([(edge, 294), (edge, 266), (edge + 34, 266), (edge + 34, 294)])
    target.draw_polyline(points, color=(0, 0, 0), width=1.5)
    target.draw_polyline([(130, 364), (185, 364), (185, 336), (520, 336)], width=1.5)
    target.draw_polyline([(130, 434), (402, 434), (402, 406), (520, 406)], width=1.5)
    target.draw_line((130, 478), (520, 478), width=1.5)
    target.draw_line((130, 502), (520, 502), width=1.5)
    target.insert_text((310, 494), 'A', fontsize=12, fontname='cour')
    paragraph(target, f'At rising edge 3: VALID=1, READY=0, DATA=A.\n'
              f'The waveform belongs only to the {channel} channel.', 562)


positive = page('Figure 1 / HOLD timing', '2')
waveform(positive, 'HOLD-channel example. Edges are numbered from the left. '
         'The applicable channel requirements are in Section 3.1 on printed page 1.', 'HOLD')

sample = page('3.2 SAMPLE channel requirements', '3')
paragraph(sample, 'S1. The source may change DATA[7:0] while VALID=1 and READY=0. '
          'There is no stability obligation during a stalled SAMPLE-channel cycle.', 142)
paragraph(sample, 'S2. The receiver samples DATA only at a rising edge where VALID=1 '
          'and READY=1. DATA must meet the specified setup and hold requirements '
          'around that accepting edge.', 262)
paragraph(sample, 'S3. Figure 2 is illustrative. A flat DATA trace does not prohibit '
          'data changes. The HOLD rule R1 does not apply to the SAMPLE channel.', 382)
paragraph(sample, 'The source should avoid unnecessary toggles to reduce dynamic power. '
          'This recommendation does not change the permission granted by S1.', 502)

negative = page('Figure 2 / SAMPLE timing', '4')
waveform(negative, 'Counterexample. The same visible flat DATA trace is drawn here. '
         'Use S1 on printed page 3 to decide whether a change is allowed.', 'SAMPLE')

registers = page('4 Register map', '5')
paragraph(registers, 'All registers are 32 bits wide. Address offsets are byte offsets.\n'
          'Register reset values below are guaranteed only after a completed reset.', 140)
columns = [48, 124, 214, 328, 414, 564]
rows = [260, 298, 344, 390, 436]
cells = [
    ['Offset', 'Name', 'Bits', 'Access', 'Reset'],
    ['0x00', 'CTRL', '[0] ENABLE', 'RW', '0'],
    ['0x04', 'STATUS', '[3:0] DONE', 'W1C [a]', '0'],
    ['0x08', 'COUNT', '[15:0]', 'RC [b]', '0'],
]
for coordinate in columns:
    registers.draw_line((coordinate, rows[0]), (coordinate, rows[-1]), color=(0.6, 0.6, 0.6))
for coordinate in rows:
    registers.draw_line(
        (columns[0], coordinate), (columns[-1], coordinate), color=(0.6, 0.6, 0.6)
    )
for row_index, row in enumerate(cells):
    for column_index, value in enumerate(row):
        registers.insert_text((columns[column_index] + 6, rows[row_index] + 24), value,
                              fontsize=10, fontname='cour')
paragraph(registers, '[a] Write-one-to-clear: writing 1 shall clear the corresponding DONE bit. '
          'Writing 0 shall not change it. Hardware may set DONE in the same cycle; '
          'hardware set wins over software clear.', 476, 11)
paragraph(registers, '[b] Read-clear: COUNT shall clear only after a successful bus '
          'read handshake. An aborted read shall not clear COUNT. '
          'Reserved bits [31:16] read as 0.', 582, 11)

document.set_page_labels([
    {'startpage': 0, 'prefix': '', 'style': 'r', 'firstpagenum': 1},
    {'startpage': 1, 'prefix': '', 'style': 'D', 'firstpagenum': 1},
])
document.set_metadata({'title': 'HOLD and SAMPLE interfaces - acceptance fixture',
                       'author': 'Reading Companion project', 'subject': 'CC0 original fixture'})
output = OUTPUT / 'digital-ic-spec.pdf'
document.save(output, garbage=4, deflate=True, no_new_id=True)
for index, current in enumerate(document):
    current.get_pixmap(matrix=fitz.Matrix(1.3, 1.3)).save(REVIEW / f'page-{index + 1}.png')
manifest = {
    'file': output.name,
    'license': 'CC0-1.0',
    'pageLabels': [page.get_label() for page in document],
    'positive': {'figureFilePage': 3, 'ruleFilePage': 2, 'thirdEdgeChangeAllowed': False},
    'counterexample': {'figureFilePage': 5, 'ruleFilePage': 4, 'thirdEdgeChangeAllowed': True},
    'registerFilePage': 6,
}
(OUTPUT / 'digital-ic-spec.json').write_text(json.dumps(manifest, indent=2) + '\n')
(REVIEW / 'pages.json').write_text(json.dumps([
    {'pageIndex': index, 'printedPage': current.get_label(), 'text': current.get_text()}
    for index, current in enumerate(document)
], indent=2) + '\n')
print(output)
