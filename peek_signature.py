import zipfile
import re

docx_path = 'src/templates/council-inspection.docx'

with zipfile.ZipFile(docx_path, 'r') as z:
    doc_xml = z.read('word/document.xml').decode('utf-8')

# Find the signature tag and grab 1000 characters before and after it
match = re.search(r'.{0,1000}\{%signature\}.{0,1000}', doc_xml)

if match:
    print("--- FOUND SIGNATURE AREA XML ---")
    print(match.group(0))
    print("--------------------------------")
else:
    print("Could not find {%signature} in the document XML.")
