#!/usr/bin/env python3
"""Rebuild the tenant sign-off block so its blank lines always align.

The block was originally cloned from the inspector sign-off block, which
draws each blank line as a literal 86-underscore run pushed across by a
chain of default tab stops. That only lines up when every label happens to
be the same width. Once the labels became the tenant ones (from the very
long "Accepted & signed on behalf of the Lessee by:" down to the short
"Date:"), two things broke: rows reached different default tab stops, and
the fixed-length underscore run sat near the right margin -- so on some
rows it overflowed and wrapped onto the next line.

Fix: drop the literal underscores and let Word draw the line, via a right
tab stop at the right margin with an underscore leader, preceded by a left
tab stop that every line starts from. Word sizes the leader to exactly fill
the gap, so a line can never wrap or overflow no matter how long the label
is, and every row starts and ends at the same column.

Usage: rebuild-tenant-signoff.py <path-to-docx>  (edits in place)
"""

import re
import sys
import zipfile

PATH = sys.argv[1]

# Page is 11900 twips wide with 720 twip side margins (see the section
# properties governing this block), and the section is single-column.
TEXT_WIDTH = 11900 - 720 - 720
# Clears the longest label ("Accepted & signed on behalf of the Lessee by:")
# with room to spare. If a label ever outgrew this, its tab would simply
# fall through to the right stop and the leader would start after the
# label instead -- degraded alignment, never a wrap.
LINE_START = 4400

FONTS = (
    '<w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi" w:cstheme="majorHAnsi"/>'
)
LABEL_RPR = f'<w:rPr>{FONTS}<w:b/><w:bCs/><w:color w:val="auto"/><w:sz w:val="16"/><w:szCs w:val="16"/><w:lang w:val="en-AU"/></w:rPr>'
# The leader takes this run's formatting, so the drawn line picks up the
# same light grey the template already uses for fill-in lines.
LINE_RPR = f'<w:rPr>{FONTS}<w:color w:val="BFBFBF" w:themeColor="background1" w:themeShade="BF"/><w:sz w:val="16"/><w:szCs w:val="16"/><w:lang w:val="en-AU"/></w:rPr>'

TABS = (
    "<w:tabs>"
    f'<w:tab w:val="left" w:pos="{LINE_START}"/>'
    f'<w:tab w:val="right" w:pos="{TEXT_WIDTH}" w:leader="underscore"/>'
    "</w:tabs>"
)
# CT_PPrBase requires tabs before spacing.
PPR = (
    '<w:pPr><w:pStyle w:val="PR05--Bodycopy"/>'
    f"{TABS}"
    '<w:spacing w:before="160" w:after="160"/>'
    f"{LINE_RPR}</w:pPr>"
)


def row(label: str) -> str:
    return (
        f"<w:p>{PPR}"
        f'<w:r>{LABEL_RPR}<w:t xml:space="preserve">{label}</w:t></w:r>'
        f"<w:r>{LINE_RPR}<w:tab/><w:tab/></w:r>"
        "</w:p>"
    )


NEW_BLOCK = "".join(
    row(label)
    for label in (
        "Accepted &amp; signed on behalf of the Lessee by:",
        "Print Name:",
        "Position:",
        "Company:",
        "Date:",
    )
)

with zipfile.ZipFile(PATH) as archive:
    entries = {info.filename: (info, archive.read(info.filename)) for info in archive.infolist()}

document = entries["word/document.xml"][1].decode("utf-8")

idx = document.find("Lessee by")
assert idx != -1, "'Lessee by' not found -- run add-tenant-signoff.py first"
start = document.rfind("<w:p ", 0, idx)
assert start != -1

paras = re.findall(r"<w:p[ >].*?</w:p>", document[start:], re.S)
assert len(paras) >= 9, f"expected >=9 paragraphs, found {len(paras)}"
old_block = "".join(paras[:9])

# Guard: this must be the tenant block in full, and must not have swallowed
# the inspector block (which was removed earlier) or trailing content.
for needle in ("Lessee by", "Print Name", "Position:", "Company:", "Date:"):
    assert needle in old_block, f"{needle!r} missing from matched block"
assert "Completed By" not in old_block, "matched block includes the inspector sign-off"

document = document.replace(old_block, NEW_BLOCK, 1)
entries["word/document.xml"] = (entries["word/document.xml"][0], document.encode("utf-8"))

with zipfile.ZipFile(PATH, "w", zipfile.ZIP_DEFLATED) as output:
    for info, data in entries.values():
        output.writestr(info, data)

print("tenant sign-off rebuilt ->", PATH)
