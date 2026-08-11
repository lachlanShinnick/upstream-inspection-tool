#!/usr/bin/env python3
"""Remove the inspector's own "Inspection Completed By" sign-off block from
an Incoming Inspection template, leaving only the tenant sign-off block
(added by add-tenant-signoff.py) that follows it.

Usage: remove-inspector-signoff.py <path-to-docx>  (edits in place)
"""

import re
import sys
import zipfile

PATH = sys.argv[1]

with zipfile.ZipFile(PATH) as archive:
    entries = {info.filename: (info, archive.read(info.filename)) for info in archive.infolist()}

document = entries["word/document.xml"][1].decode("utf-8")

idx = document.find("Completed By")
assert idx != -1, "'Completed By' not found"
start = document.rfind("<w:p ", 0, idx)
assert start != -1
paras = re.findall(r"<w:p[ >].*?</w:p>", document[start:], re.S)
assert len(paras) >= 9
inspector_block = "".join(paras[:9])
assert "Completed By" in inspector_block
assert "Lessee by" not in inspector_block, "block shape changed -- check manually"

new_document = document.replace(inspector_block, "", 1)
assert new_document != document
assert "Completed By" not in new_document
assert "Lessee by" in new_document

entries["word/document.xml"] = (entries["word/document.xml"][0], new_document.encode("utf-8"))

with zipfile.ZipFile(PATH, "w", zipfile.ZIP_DEFLATED) as output:
    for info, data in entries.values():
        output.writestr(info, data)

print("inspector sign-off removed ->", PATH)
