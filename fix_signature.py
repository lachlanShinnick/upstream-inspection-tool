import zipfile
import shutil
import os

docx_path = 'src/templates/council-inspection.docx'
temp_docx = 'src/templates/council-inspection_temp.docx'

# Open original and write to a clean temporary zip structure
with zipfile.ZipFile(docx_path, 'r') as yin, zipfile.ZipFile(temp_docx, 'w', zipfile.ZIP_DEFLATED) as yout:
    for item in yin.infolist():
        data = yin.read(item.filename)
        
        if item.filename == 'word/document.xml':
            doc_xml = data.decode('utf-8')
            
            # 1. Revert that accidental next-line paragraph padding back to standard 60
            doc_xml = doc_xml.replace('paraId="4B81A844" w14:textId="77777777" w:rsidR="001E3460" w:rsidRPr="00F14229" w:rsidRDefault="001E3460" w:rsidP="001E3460"><w:pPr><w:pStyle w:val="PR05--Bodycopy"/><w:spacing w:before="180"', 
                                      'paraId="4B81A844" w14:textId="77777777" w:rsidR="001E3460" w:rsidRPr="00F14229" w:rsidRDefault="001E3460" w:rsidP="001E3460"><w:pPr><w:pStyle w:val="PR05--Bodycopy"/><w:spacing w:before="60"')
            
            # 2. Target the actual paragraph that CONTAINS the {%signature} tag
            # Find the spacing element preceding the signature tabs and push it down (e.g., to 240 twips)
            # This will nudge the signature block vertically away from the text labels above it.
            target_pPr = '<w:pStyle w:val="PR05--Bodycopy"/><w:spacing w:before="60"'
            replacement_pPr = '<w:pStyle w:val="PR05--Bodycopy"/><w:spacing w:before="240"'
            
            # Since multiple lines use PR05--Bodycopy, we target the one closest to our signature block
            split_xml = doc_xml.split('{%signature}')
            if len(split_xml) > 1:
                # Modify the spacing tag just before our target string
                left_side = split_xml[0]
                right_side = '{%signature}'.join(split_xml[1:])
                
                # Replace the last instance of 60 spacing on the left side with 240
                if target_pPr in left_side:
                    chunks = left_side.rsplit(target_pPr, 1)
                    left_side = chunks[0] + replacement_pPr + chunks[1]
                    doc_xml = left_side + '{%signature}' + right_side
                    print("Successfully updated vertical spacing properties for the signature!")
            
            data = doc_xml.encode('utf-8')
            
        yout.writestr(item, data)

# Swap out the temporary file back to original location safely
shutil.move(temp_docx, docx_path)
print("Docx rebuilt successfully with clean native zip compliance.")
