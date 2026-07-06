#!/usr/bin/env python3
"""Build src/templates/incident-report.docx from the raw incident template.

Pure string splicing on the XML text — never parses/re-serializes the XML
(an lxml round-trip corrupted the council template's header and broke Graph's
PDF conversion; byte splicing avoids that).

The photo section is transplanted verbatim from the council template's
{#photo_rows}/{#c1..c3} loop, so incident photos render exactly like every
other report. The sign-off is reordered to match the other reports:
name, position, company, date, signature.

Usage: tag-incident-v2.py <raw-incident.docx> <council-inspection.docx> <out.docx>
"""
import re
import sys
import zipfile

SRC, COUNCIL, DST = sys.argv[1], sys.argv[2], sys.argv[3]

RUN_RPR = (
    '<w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi" '
    'w:cstheme="majorHAnsi"/><w:color w:val="000000"/><w:sz w:val="16"/>'
    '<w:szCs w:val="16"/></w:rPr>'
)


def run(tag: str) -> str:
    return f'<w:r>{RUN_RPR}<w:t xml:space="preserve">{tag}</w:t></w:r>'


def replace_once(s: str, old: str, new: str, label: str) -> str:
    assert s.count(old) >= 1, f"{label}: pattern not found"
    return s.replace(old, new, 1)


def inject_into_last_para_of_cell(cell: str, tag: str) -> str:
    i = cell.rfind("</w:p>")
    assert i != -1
    return cell[:i] + run(tag) + cell[i:]


def para_span(doc: str, pos: int) -> tuple[int, int]:
    """Span of the <w:p> element containing offset `pos`."""
    start = max(doc.rfind("<w:p>", 0, pos), doc.rfind("<w:p ", 0, pos))
    end = doc.find("</w:p>", pos) + len("</w:p>")
    assert start != -1 and end != -1 + len("</w:p>")
    return start, end


with zipfile.ZipFile(SRC) as z:
    doc = z.read("word/document.xml").decode("utf-8")
    hdr1 = z.read("word/header1.xml").decode("utf-8")
with zipfile.ZipFile(COUNCIL) as z:
    cdoc = z.read("word/document.xml").decode("utf-8")

# ---------- 1. Cover table: property name + date ----------
cover_start = doc.find("<w:tbl>")
cover_end = doc.find("</w:tbl>", cover_start) + len("</w:tbl>")
cover = doc[cover_start:cover_end]
cover = replace_once(cover, ">Property<", ">{property_name}<", "cover property")
cover = replace_once(cover, ">____ <", ">{inspection_date}<", "cover date")
for filler in (">/<", "> ____ <", ">/<", "> ________<"):
    cover = replace_once(cover, filler, "><", f"cover filler {filler}")
doc = doc[:cover_start] + cover + doc[cover_end:]

# ---------- 2. Notes table ----------
i = doc.find("Date:")
row_start = doc.rfind("<w:tr", 0, i)
row_end = doc.find("</w:tr>", i) + len("</w:tr>")
row1 = doc[row_start:row_end]
cells = re.findall(r"<w:tc>.*?</w:tc>", row1, re.S)
assert len(cells) == 4, f"expected 4 cells in Date/Property row, got {len(cells)}"
row1 = row1.replace(cells[1], inject_into_last_para_of_cell(cells[1], "{inspection_date}"))
row1 = row1.replace(cells[3], inject_into_last_para_of_cell(cells[3], "{property_name}"))
doc = doc[:row_start] + row1 + doc[row_end:]

notes_tbl_start = doc.rfind("<w:tbl>", 0, doc.find("Date:"))
notes_tbl_end = doc.find("</w:tbl>", notes_tbl_start) + len("</w:tbl>")
tbl = doc[notes_tbl_start:notes_tbl_end]
rows = re.findall(r"<w:tr[ >].*?</w:tr>", tbl, re.S)
blank_rows = [r for r in rows if not re.search(r"<w:t[^>]*>[^<]", r)]
assert len(blank_rows) >= 30, f"expected ~32 blank note rows, got {len(blank_rows)}"
loop_row = blank_rows[0]
loop_row = loop_row.replace("<w:noWrap/>", "")
loop_row = loop_row.replace('<w:jc w:val="center"/>', "")
j = loop_row.rfind("</w:p>")
loop_row = loop_row[:j] + run("{-w:tr notes}{text}{/notes}") + loop_row[j:]
tbl = tbl.replace(blank_rows[0], loop_row, 1)
for r in blank_rows[1:]:
    tbl = tbl.replace(r, "", 1)
doc = doc[:notes_tbl_start] + tbl + doc[notes_tbl_end:]

# ---------- 3. Photo section: transplant the council {#photo_rows} loop ----------
# Council pieces.
c_loop_start, _ = para_span(cdoc, cdoc.find("{#photo_rows}"))
_, c_loop_end = para_span(cdoc, cdoc.find("{/photo_rows}"))
council_loop = cdoc[c_loop_start:c_loop_end]
assert "{#c1}" in council_loop and "{%image}" in council_loop

c_prephoto_sect = re.search(
    r"<w:sectPr[^>]*>(?:(?!</w:sectPr>).)*?<w:type w:val=\"nextPage\"/>.*?</w:sectPr>",
    cdoc,
    re.S,
).group(0)
m = re.search(r"<w:sectPr(?:(?!</w:sectPr>).)*?</w:sectPr>", cdoc[c_loop_end:], re.S)
c_postphoto_sect = m.group(0)
assert '<w:cols w:space="113"/>' in c_postphoto_sect
assert "r:id" not in c_prephoto_sect and "r:id" not in c_postphoto_sect

# Incident: swap the section leading into the photos (2-col continuous) for the
# council's page-break section, so photos start on a fresh page as elsewhere.
m = re.search(
    r"<w:sectPr(?:(?!</w:sectPr>).)*?<w:cols w:num=\"2\" w:space=\"708\"/>.*?</w:sectPr>",
    doc,
    re.S,
)
assert m, "pre-photo 2-col sectPr not found"
doc = doc[: m.start()] + c_prephoto_sect + doc[m.end() :]

# Replace everything from the first photo block table up to (and including)
# the 3-column sectPr that laid the blocks out as snaking columns.
first_img = doc.find(">Image:")
region_start = doc.rfind("<w:tbl>", 0, first_img)
m = re.search(
    r"<w:sectPr(?:(?!</w:sectPr>).)*?<w:cols w:num=\"3\" w:space=\"113\"/>.*?</w:sectPr>",
    doc,
)
assert m and m.start() > region_start, "3-col photo sectPr not found after blocks"
# Keep the paragraph that carries the sectPr; swap just the sectPr inside it.
p_start, p_end = para_span(doc, m.start())
sect_para = doc[p_start:p_end].replace(m.group(0), c_postphoto_sect, 1)
doc = doc[:region_start] + council_loop + sect_para + doc[p_end:]

# All 15 original blocks gone (their "Image:" was a single run; the council
# loop's is split "Image" + ":"), and the transplanted loop present exactly once.
assert doc.count(">Image:") == 0, "an original incident photo block survived"
assert doc.count("{#photo_rows}") == 1 and doc.count("{/photo_rows}") == 1

# The raw template jumps to the 2nd column here with a column break; the
# section is single-column now, where a column break acts as a page break and
# leaves a blank page before the photos. Drop it.
seg_start = doc.find("{/notes}")
seg_end = doc.find("{#photo_rows}")
between = doc[seg_start:seg_end]
m = re.search(r"<w:r>(?:(?!</w:r>).)*?<w:br w:type=\"column\"/></w:r>", between, re.S)
assert m, "column break between notes and photos not found"
doc = doc[:seg_start] + between.replace(m.group(0), "", 1) + doc[seg_end:]

# ---------- 4. Sign-off: fill + reorder to match the other reports ----------
# Template label order: Reported By, Signature, Position, Company, Date.
# Other reports end with the signature, so relabel to:
#   Reported By, Position, Company, Date, Signature.
signoff_at = doc.find("Incident Reported")
assert signoff_at != -1
head, tail = doc[:signoff_at], doc[signoff_at:]
tail = replace_once(tail, ">Signature<", ">@@L2@@<", "label 2")
tail = replace_once(tail, ">Position:<", ">@@L3@@<", "label 3")
tail = replace_once(tail, ">Company:<", ">@@L4@@<", "label 4")
tail = replace_once(tail, ">Date:<", ">@@L5@@<", "label 5")
tail = tail.replace(">@@L2@@<", ">Position<")
tail = tail.replace(">@@L3@@<", ">Company:<")
tail = tail.replace(">@@L4@@<", ">Date:<")
tail = tail.replace(">@@L5@@<", ">Signature:<")

line = "_" * 86
fills = ["{inspector_name}", "{inspector_position}", "{inspector_company}",
         "{inspection_date}", "{%signature}"]
assert tail.count(f">{line}<") == len(fills), (
    f"expected {len(fills)} sign-off lines, got {tail.count('>' + line + '<')}"
)
for tag in fills:
    tail = tail.replace(f">{line}<", f">{tag}<", 1)
doc = head + tail

# ---------- 5. Page header: property name ----------
hdr1 = replace_once(hdr1, ">Property<", ">{property_name}<", "header property")

# ---------- Write output: copy every entry verbatim except the two edited ----------
with zipfile.ZipFile(SRC) as zin, zipfile.ZipFile(DST, "w", zipfile.ZIP_DEFLATED) as zout:
    for info in zin.infolist():
        data = zin.read(info.filename)
        if info.filename == "word/document.xml":
            data = doc.encode("utf-8")
        elif info.filename == "word/header1.xml":
            data = hdr1.encode("utf-8")
        zout.writestr(info, data)

print("tagged OK ->", DST)
