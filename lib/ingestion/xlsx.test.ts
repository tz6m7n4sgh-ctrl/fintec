import { describe, expect, it } from 'vitest';
import { parseStatement } from './parse';
import { xlsxToDelimited } from './xlsx';

const encoder = new TextEncoder();

/** A minimal stored ZIP is enough to exercise the real XLSX container reader. */
function workbook(files: Record<string, string>): ArrayBuffer {
  const chunks: Uint8Array[] = [];
  for (const [name, source] of Object.entries(files)) {
    const filename = encoder.encode(name);
    const content = encoder.encode(source);
    const header = new Uint8Array(30 + filename.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint32(18, content.length, true);
    view.setUint32(22, content.length, true);
    view.setUint16(26, filename.length, true);
    header.set(filename, 30);
    chunks.push(header, content);
  }
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes.buffer;
}

describe('xlsxToDelimited', () => {
  it('feeds shared strings, inline strings, amounts and styled dates through the CSV pipeline', () => {
    const bytes = workbook({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Statement" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>Date</t></si><si><t>Description</t></si><si><t>Amount</t></si></sst>',
      'xl/styles.xml': '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
      'xl/worksheets/sheet1.xml': `<worksheet><sheetData>
        <row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
        <row><c r="A2" s="1"><v>46237</v></c><c r="B2" t="inlineStr"><is><t>GROCERY &amp; CAFE</t></is></c><c r="C2"><v>-125.50</v></c></row>
      </sheetData></worksheet>`,
    });

    const text = xlsxToDelimited(bytes);
    const result = parseStatement(text, 'account-1');
    expect(result.error).toBeUndefined();
    expect(result.rows).toEqual([expect.objectContaining({
      date: '2026-08-03', description: 'GROCERY & CAFE', amount: 125.5, direction: 'debit',
    })]);
  });

  it('places cells without r references in successive columns instead of column A', () => {
    const bytes = workbook({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Statement" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>Date</t></si><si><t>Description</t></si><si><t>Amount</t></si></sst>',
      'xl/styles.xml': '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
      'xl/worksheets/sheet1.xml': `<worksheet><sheetData>
        <row><c t="s"><v>0</v></c><c t="s"><v>1</v></c><c t="s"><v>2</v></c></row>
        <row><c r="A2" s="1"><v>46237</v></c><c t="inlineStr"><is><t>COFFEE BAR</t></is></c><c><v>-4.20</v></c></row>
      </sheetData></worksheet>`,
    });

    const text = xlsxToDelimited(bytes);
    expect(text.split('\n')[0]).toBe('Date\tDescription\tAmount');
    const result = parseStatement(text, 'account-1');
    expect(result.error).toBeUndefined();
    expect(result.rows).toEqual([expect.objectContaining({
      date: '2026-08-03', description: 'COFFEE BAR', amount: 4.2, direction: 'debit',
    })]);
  });

  it('offsets serial dates by 1462 days when the workbook declares the 1904 epoch', () => {
    const bytes = workbook({
      'xl/workbook.xml': '<workbook><workbookPr date1904="1"/><sheets><sheet name="Statement" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>Date</t></si><si><t>Description</t></si><si><t>Amount</t></si></sst>',
      'xl/styles.xml': '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
      'xl/worksheets/sheet1.xml': `<worksheet><sheetData>
        <row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
        <row><c r="A2" s="1"><v>44775</v></c><c r="B2" t="inlineStr"><is><t>GROCERY</t></is></c><c r="C2"><v>-125.50</v></c></row>
      </sheetData></worksheet>`,
    });

    const result = parseStatement(xlsxToDelimited(bytes), 'account-1');
    expect(result.error).toBeUndefined();
    expect(result.rows).toEqual([expect.objectContaining({
      date: '2026-08-03', description: 'GROCERY', amount: 125.5, direction: 'debit',
    })]);
  });

  it('rejects a renamed non-workbook instead of parsing binary as text', () => {
    expect(() => xlsxToDelimited(encoder.encode('not a zip').buffer)).toThrow(/readable XLSX/);
  });
});
