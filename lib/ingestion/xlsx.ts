import { inflateRawSync } from 'node:zlib';

/**
 * Reads the first worksheet of an XLSX workbook into the same tabular text
 * consumed by the CSV parser. XLSX is a ZIP container of XML files; keeping
 * this adapter deliberately small means statement data is never sent to a
 * third party and the existing mapping, review and dedupe path stays shared.
 */
export function xlsxToDelimited(input: ArrayBuffer): string {
  const files = unzip(new Uint8Array(input));
  const workbook = required(files, 'xl/workbook.xml');
  const relationships = required(files, 'xl/_rels/workbook.xml.rels');
  const firstSheetId = /<sheet\b[^>]*\br:id="([^"]+)"/i.exec(workbook)?.[1];
  if (!firstSheetId) throw new Error('The workbook has no readable worksheet.');

  const relationship = [...relationships.matchAll(/<Relationship\b([^>]*)\/?\s*>/gi)]
    .map((match) => attributes(match[1]))
    .find((attrs) => attrs.Id === firstSheetId);
  if (!relationship?.Target) throw new Error('The first worksheet is missing from the workbook.');

  const sheetPath = relationship.Target.startsWith('/')
    ? normalize(relationship.Target.slice(1))
    : normalize(`xl/${relationship.Target}`);
  const sheet = required(files, sheetPath);
  const shared = files.get('xl/sharedStrings.xml')
    ? [...files.get('xl/sharedStrings.xml')!.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)]
        .map((match) => textNodes(match[1]))
    : [];
  const dateStyles = dateStyleIndexes(files.get('xl/styles.xml'));
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(?:1|true)"/i.test(workbook);

  const rows: string[] = [];
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    const cells: string[] = [];
    // Cells may omit their r reference; such a cell occupies the column after
    // the previous cell in the row (column A when it is the first cell).
    let nextColumn = 0;
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      const attrs = attributes(cellMatch[1]);
      const column = attrs.r ? columnIndex(attrs.r) : nextColumn;
      nextColumn = column + 1;
      while (cells.length <= column) cells.push('');
      const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/i.exec(cellMatch[2])?.[1] ?? '';
      let value = attrs.t === 'inlineStr' ? textNodes(cellMatch[2]) : decodeXml(raw);
      if (attrs.t === 's') value = shared[Number(value)] ?? '';
      if (attrs.t !== 's' && attrs.t !== 'inlineStr' && dateStyles.has(Number(attrs.s))) {
        value = excelDate(value, date1904);
      }
      cells[column] = value;
    }
    if (cells.some((cell) => cell.trim())) rows.push(cells.map(tsvCell).join('\t'));
  }
  if (rows.length === 0) throw new Error('The first worksheet contains no readable rows.');
  return rows.join('\n');
}

function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map<string, string>();
  let offset = 0;
  let expanded = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if ((flags & 0x08) !== 0) throw new Error('This workbook uses an unsupported ZIP layout.');
    const start = offset + 30 + nameLength + extraLength;
    const end = start + size;
    if (end > bytes.length) throw new Error('The workbook is truncated.');
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const compressed = bytes.subarray(start, end);
    const remaining = 100 * 1024 * 1024 - expanded;
    const content = method === 0
      ? compressed
      : method === 8
        ? inflateRawSync(compressed, { maxOutputLength: remaining })
        : null;
    if (!content) throw new Error('The workbook uses an unsupported compression method.');
    expanded += content.byteLength;
    if (expanded > 100 * 1024 * 1024) throw new Error('The expanded workbook is too large to read safely.');
    files.set(normalize(name), new TextDecoder().decode(content));
    offset = end;
  }
  if (files.size === 0) throw new Error('That file is not a readable XLSX workbook.');
  return files;
}

function required(files: Map<string, string>, name: string): string {
  const value = files.get(name);
  if (!value) throw new Error('That file is not a readable XLSX workbook.');
  return value;
}

function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) part === '..' ? parts.pop() : part !== '.' && parts.push(part);
  return parts.join('/');
}

function attributes(source: string): Record<string, string> {
  return Object.fromEntries([...source.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], decodeXml(m[2])]));
}

function textNodes(xml: string): string {
  return [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((m) => decodeXml(m[1])).join('');
}

function decodeXml(value: string): string {
  return value.replace(/&#(x?[0-9a-f]+);|&(?:quot|apos|lt|gt|amp);/gi, (entity, numeric: string | undefined) => {
    if (numeric) return String.fromCodePoint(parseInt(numeric.replace(/^x/i, ''), numeric[0].toLowerCase() === 'x' ? 16 : 10));
    return ({ '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' } as Record<string, string>)[entity.toLowerCase()] ?? entity;
  });
}

function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/i.exec(reference)?.[0].toUpperCase() ?? 'A';
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function dateStyleIndexes(styles?: string): Set<number> {
  if (!styles) return new Set();
  const custom = new Set([...styles.matchAll(/<numFmt\b([^>]*)\/?\s*>/gi)]
    .map((m) => attributes(m[1])).filter((a) => /[dmy]/i.test(a.formatCode ?? '')).map((a) => Number(a.numFmtId)));
  const builtIn = new Set([14, 15, 16, 17, 22, 27, 30, 36, 50, 57]);
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/i.exec(styles)?.[1] ?? '';
  const indexes = new Set<number>();
  [...xfs.matchAll(/<xf\b([^>]*)\/?\s*>/gi)].forEach((m, index) => {
    const id = Number(attributes(m[1]).numFmtId);
    if (builtIn.has(id) || custom.has(id)) indexes.add(index);
  });
  return indexes;
}

function excelDate(raw: string, date1904: boolean): string {
  const serial = Number(raw);
  if (!Number.isFinite(serial)) return raw;
  // The Mac 1904 epoch starts 1462 days after the default 1900 epoch.
  const days = Math.floor(serial) + (date1904 ? 1462 : 0);
  const date = new Date(Date.UTC(1899, 11, 30) + days * 86400000);
  return date.toISOString().slice(0, 10);
}

function tsvCell(value: string): string {
  return /[\t\r\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
