import { PDFExtract } from 'pdf.js-extract';
import { readFile } from 'fs/promises';

async function main() {
  const pdfExtract = new PDFExtract();
  const path = process.env.HOME + '/Downloads/HHS-ONC-2024-0010-0045_attachment_1.pdf';
  const buffer = await readFile(path);

  // You can tweak options if needed
  const options = { normalizeWhitespace: true, disableCombineTextItems: false };

  pdfExtract.extractBuffer(buffer, options, (err, data) => {
    if (err) {
      console.error('Error extracting PDF:', err);
      process.exit(1);
    }
    // Concatenate all text items from all pages
    const allText = data.pages
      .map(page => page.content.map(item => item.str).join(' '))
      .join('\n\n');
    console.log(allText);
  });
}

main(); 