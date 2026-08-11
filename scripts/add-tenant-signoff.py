#!/usr/bin/env python3
"""Add a tenant sign-off block to an Incoming Inspection template, directly
below the existing "Inspection Completed By" block.

The new block reuses that block's paragraph structure and styling exactly
(same run properties, same 86-underscore blank-line convention used
elsewhere in this template), so it always renders blank -- there is no
Docxtemplater tag behind any of its fields. It's meant to be filled in by
hand or sent to the tenant for e-signing (Adobe), never auto-populated.

Usage: add-tenant-signoff.py <path-to-docx>  (edits in place)
"""

import re
import sys
import zipfile

PATH = sys.argv[1]

BLANK = "_" * 86


def find_signoff_block(xml: str) -> tuple[int, int, str]:
    """Locate the 9-paragraph 'Inspection Completed By ... Date' block:
    5 label/value paragraphs interleaved with 4 blank spacer paragraphs."""
    idx = xml.find("Completed By")
    assert idx != -1, "'Completed By' not found"
    start = xml.rfind("<w:p ", 0, idx)
    assert start != -1
    paras = re.findall(r"<w:p[ >].*?</w:p>", xml[start:], re.S)
    assert len(paras) >= 9
    block = "".join(paras[:9])
    return start, start + len(block), block


def build_tenant_block(block: str) -> str:
    tenant = block
    replacements = [
        ('<w:t xml:space="preserve">Inspection </w:t>',
         '<w:t xml:space="preserve">Accepted &amp; signed on behalf of the </w:t>'),
        ("<w:t>Completed By</w:t>", "<w:t>Lessee by</w:t>"),
        ("<w:t>Signature</w:t>", "<w:t>Print Name</w:t>"),
        ("<w:t>{inspector_name}</w:t>", f"<w:t>{BLANK}</w:t>"),
        ("<w:t>{%signature}</w:t>", f"<w:t>{BLANK}</w:t>"),
        ("<w:t>{inspector_position}</w:t>", f"<w:t>{BLANK}</w:t>"),
        ("<w:t>{inspector_company}</w:t>", f"<w:t>{BLANK}</w:t>"),
        ("<w:t>{inspection_date}</w:t>", f"<w:t>{BLANK}</w:t>"),
    ]
    for old, new in replacements:
        # Untagged source templates already have blank underscore runs
        # instead of {tags}, so some of these are no-ops there -- fine.
        tenant = tenant.replace(old, new, 1)
    return tenant


with zipfile.ZipFile(PATH) as archive:
    document = archive.read("word/document.xml").decode("utf-8")

start, end, block = find_signoff_block(document)
tenant_block = build_tenant_block(block)
assert tenant_block != block, "no replacements applied -- block shape changed?"
assert "Lessee by" in tenant_block
assert tenant_block.count(BLANK) == 5, tenant_block.count(BLANK)
document = document[:end] + tenant_block + document[end:]

with zipfile.ZipFile(PATH) as source:
    entries = {info.filename: (info, source.read(info.filename)) for info in source.infolist()}
entries["word/document.xml"] = (entries["word/document.xml"][0], document.encode("utf-8"))

with zipfile.ZipFile(PATH, "w", zipfile.ZIP_DEFLATED) as output:
    for info, data in entries.values():
        output.writestr(info, data)

print("tenant sign-off added ->", PATH)
