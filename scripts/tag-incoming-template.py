#!/usr/bin/env python3
"""Build the tagged incoming-inspection template from the supplied DOCX.

The source uses fixed blank rows and ten fixed photo blocks. This script keeps
its styling but adds Docxtemplater tags, turns HVAC/fire groups into dynamic
row loops, and replaces the photo blocks with a full-width two-cell row loop.
"""

import re
import sys
import zipfile

SRC, DST = sys.argv[1], sys.argv[2]

RUN_RPR = (
    '<w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi" '
    'w:cstheme="majorHAnsi"/><w:color w:val="000000"/><w:sz w:val="16"/>'
    '<w:szCs w:val="16"/></w:rPr>'
)


def run(text: str) -> str:
    return f'<w:r>{RUN_RPR}<w:t xml:space="preserve">{text}</w:t></w:r>'


def para(text: str) -> str:
    return f"<w:p>{run(text)}</w:p>"


def replace_once(value: str, old: str, new: str, label: str) -> str:
    assert old in value, f"{label}: pattern not found"
    return value.replace(old, new, 1)


def table_span(doc: str, marker: str) -> tuple[int, int]:
    pos = doc.find(marker)
    assert pos != -1, f"table marker not found: {marker}"
    start = doc.rfind("<w:tbl>", 0, pos)
    end = doc.find("</w:tbl>", pos) + len("</w:tbl>")
    assert start != -1 and end != -1 + len("</w:tbl>")
    return start, end


def rows(table: str) -> list[str]:
    return re.findall(r"<w:tr(?: [^>]*)?>.*?</w:tr>", table, re.S)


def cells(row: str) -> list[str]:
    return re.findall(r"<w:tc(?: [^>]*)?>.*?</w:tc>", row, re.S)


def inject(cell: str, text: str) -> str:
    pos = cell.rfind("</w:p>")
    assert pos != -1
    return cell[:pos] + run(text) + cell[pos:]


def clear_text(cell: str) -> str:
    return re.sub(
        r"(<w:t(?: [^>]*)?>).*?(</w:t>)",
        r"\1\2",
        cell,
        flags=re.S,
    )


def tag_simple_table(
    doc: str,
    marker: str,
    tags: list[str],
) -> str:
    start, end = table_span(doc, marker)
    table = doc[start:end]
    table_rows = rows(table)
    assert len(table_rows) == len(tags) + 1
    for row, tag in zip(table_rows[1:], tags):
        row_cells = cells(row)
        assert len(row_cells) == 2
        tagged = row.replace(row_cells[1], inject(row_cells[1], tag), 1)
        table = table.replace(row, tagged, 1)
    return doc[:start] + table + doc[end:]


with zipfile.ZipFile(SRC) as archive:
    document = archive.read("word/document.xml").decode("utf-8")
    header = archive.read("word/header1.xml").decode("utf-8")

# Cover and repeated page header.
document = replace_once(
    document,
    ">Property Address<",
    ">{property_name}<",
    "cover property",
)
document = replace_once(
    document,
    ">____ / ____ / ________<",
    ">{inspection_date}<",
    "cover date",
)
header = replace_once(
    header,
    ">Property Address<",
    ">{property_name}<",
    "header property",
)

# Property, tenant, and electrical details.
document = tag_simple_table(
    document,
    "Property Information",
    ["{street_address}", "{suburb}", "{property_type}", "{property_area}"],
)
document = tag_simple_table(
    document,
    ">Tenant<",
    [
        "{tenant_company}",
        "{tenant_contact_name}",
        "{tenant_contact_number}",
        "{lease_term}",
        "{commencement}",
    ],
)
document = tag_simple_table(
    document,
    "Electrical Information",
    [
        "{electrical_nmi}",
        "{electrical_msb_location}",
        "{electrical_capacity}",
        "{electrical_db_count}",
    ],
)

# HVAC: retain one three-row group and loop that group.
start, end = table_span(document, ">HVAC<")
table = document[start:end]
table_rows = rows(table)
assert len(table_rows) == 10
group = table_rows[1:4]
hvac_tags = [
    "{#hvac_units}{type}",
    "{location}",
    "{last_service_date}{/hvac_units}",
]
tagged_group = []
for row, tag in zip(group, hvac_tags):
    row_cells = cells(row)
    tagged_group.append(row.replace(row_cells[1], inject(row_cells[1], tag), 1))
table = table.replace("".join(table_rows[1:]), "".join(tagged_group), 1)
document = document[:start] + table + document[end:]

# Fire services: retain one two-row group and loop it. This also removes the
# source examples (Extinguishers, Hose Reels, and the sample date).
start, end = table_span(document, "Fire Services")
table = document[start:end]
table_rows = rows(table)
assert len(table_rows) == 7
group = table_rows[1:3]
fire_tags = [
    "{#fire_services}{type}",
    "{last_service_date}{/fire_services}",
]
tagged_group = []
for row, tag in zip(group, fire_tags):
    row_cells = cells(row)
    value_cell = clear_text(row_cells[1])
    tagged_group.append(row.replace(row_cells[1], inject(value_cell, tag), 1))
table = table.replace("".join(table_rows[1:]), "".join(tagged_group), 1)
document = document[:start] + table + document[end:]

# Build one tagged condition-photo block from the source's first block.
photo_start, first_photo_end = table_span(document, ">Image:<")
photo_table = document[photo_start:first_photo_end]
photo_rows = rows(photo_table)
assert len(photo_rows) == 2
top_cells = cells(photo_rows[0])
detail_cells = cells(photo_rows[1])
assert len(top_cells) == 4 and len(detail_cells) == 2

top_tagged = photo_rows[0].replace(
    top_cells[3],
    inject(top_cells[3], "{area}"),
    1,
)
image_cell = inject(detail_cells[0], "{%incoming_image}")
description_cell = clear_text(detail_cells[1])
description_cell = inject(
    description_cell,
    "Condition: {condition} | Comments: {comment}",
)
detail_tagged = (
    photo_rows[1]
    .replace(detail_cells[0], image_cell, 1)
    .replace(detail_cells[1], description_cell, 1)
)
photo_table = photo_table.replace(photo_rows[0], top_tagged, 1)
photo_table = photo_table.replace(photo_rows[1], detail_tagged, 1)

# Remove all ten fixed photo tables.
region_end = first_photo_end
for _ in range(9):
    next_start = document.find("<w:tbl>", region_end)
    next_end = document.find("</w:tbl>", next_start) + len("</w:tbl>")
    assert next_start != -1 and next_end != -1 + len("</w:tbl>")
    region_end = next_end

# The source photo section is a Word two-column flow, which fills vertically.
# Close that section immediately before the photo grid, then make the new
# section single-column so an outer table can enforce left-to-right ordering.
section_match = re.search(
    r'<w:sectPr(?:(?!</w:sectPr>).)*?<w:cols w:num="2" w:space="284"/>.*?</w:sectPr>',
    document[region_end:],
    re.S,
)
assert section_match, "photo two-column section not found"
section_start = region_end + section_match.start()
section_end = region_end + section_match.end()
two_column_section = document[section_start:section_end]
single_column_section = two_column_section.replace(
    '<w:cols w:num="2" w:space="284"/>',
    '<w:cols w:space="284"/>',
)
section_break = f"<w:p><w:pPr>{two_column_section}</w:pPr></w:p>"

cell_pr = (
    '<w:tcPr><w:tcW w:w="5098" w:type="dxa"/>'
    '<w:tcMar><w:top w:w="0" w:type="dxa"/><w:left w:w="70" w:type="dxa"/>'
    '<w:bottom w:w="100" w:type="dxa"/><w:right w:w="70" w:type="dxa"/>'
    "</w:tcMar></w:tcPr>"
)
left_cell = (
    f"<w:tc>{cell_pr}{para('{-w:tr photo_rows}{#c1}')}"
    f"{photo_table}{para('{/c1}')}</w:tc>"
)
right_cell = (
    f"<w:tc>{cell_pr}{para('{#c2}')}"
    f"{photo_table}{para('{/c2}{/photo_rows}')}</w:tc>"
)
photo_grid = (
    '<w:tbl><w:tblPr><w:tblW w:w="10450" w:type="dxa"/>'
    '<w:tblLayout w:type="fixed"/>'
    '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/>'
    '<w:bottom w:val="nil"/><w:right w:val="nil"/>'
    '<w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>'
    "</w:tblPr><w:tblGrid>"
    '<w:gridCol w:w="5225"/><w:gridCol w:w="5225"/>'
    f"</w:tblGrid><w:tr>{left_cell}{right_cell}</w:tr></w:tbl>"
)
document = (
    document[:photo_start]
    + section_break
    + photo_grid
    + document[region_end:section_start]
    + single_column_section
    + document[section_end:]
)

# Sign-off fields retain the current account values and order.
signoff = document.find(">Completed By<")
assert signoff != -1
head, tail = document[:signoff], document[signoff:]
underscore = re.compile(r"(<w:t(?: [^>]*)?>)_{20,}(</w:t>)")
values = [
    "{inspector_name}",
    "{%signature}",
    "{inspector_position}",
    "{inspector_company}",
    "{inspection_date}",
]
for value in values:
    tail, count = underscore.subn(rf"\1{value}\2", tail, count=1)
    assert count == 1, f"sign-off line not found for {value}"
document = head + tail

assert document.count("{#photo_rows}") == 0
assert document.count("{-w:tr photo_rows}") == 1
assert document.count("{%incoming_image}") == 2
assert "Extinguishers" not in document and "Hose Reels" not in document

with zipfile.ZipFile(SRC) as source, zipfile.ZipFile(
    DST,
    "w",
    zipfile.ZIP_DEFLATED,
) as output:
    for info in source.infolist():
        data = source.read(info.filename)
        if info.filename == "word/document.xml":
            data = document.encode("utf-8")
        elif info.filename == "word/header1.xml":
            data = header.encode("utf-8")
        output.writestr(info, data)

print("tagged OK ->", DST)
