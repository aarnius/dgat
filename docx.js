/* Minimalus .docx kūrimas naršyklėje (be išorinių bibliotekų): pastraipos, lentelės, sąrašų taškai, puslapių lūžiai.
   Naudojimas: Docx.build(blocks, { landscape }) → Blob; Docx.save(vardas, blob).
   Blokai: { t:'title'|'h'|'p'|'li'|'sig'|'pb'|'table', text } (tekste **paryškinta**). */
const Docx = (() => {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const enc = new TextEncoder();

  /* ---- ZIP (be suspaudimo) ---- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files) {
    const parts = [], central = []; let off = 0;
    const u16 = (n) => [n & 255, (n >> 8) & 255], u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
    files.forEach(([name, text]) => {
      const nb = enc.encode(name), data = enc.encode(text), crc = crc32(data);
      const head = new Uint8Array([0x50, 0x4b, 3, 4, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), 0, 0]);
      parts.push(head, nb, data);
      central.push(new Uint8Array([0x50, 0x4b, 1, 2, 20, 0, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(off)]), nb);
      off += head.length + nb.length + data.length;
    });
    const cLen = central.reduce((a, b) => a + b.length, 0);
    const end = new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(cLen), ...u32(off), 0, 0]);
    return new Blob([...parts, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  /* ---- WordprocessingML ---- */
  const runs = (text, base = '') => String(text).split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((seg) => {
    const bold = /^\*\*[^*]+\*\*$/.test(seg), t = bold ? seg.slice(2, -2) : seg;
    return `<w:r><w:rPr>${bold ? '<w:b/>' : ''}${base}</w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
  }).join('');
  const para = (text, { align, before = 0, after = 100, ind, hang, size, bold, keep, line } = {}) =>
    `<w:p><w:pPr>${keep ? '<w:keepNext/>' : ''}<w:spacing w:before="${before}" w:after="${after}"${line ? ` w:line="${line}" w:lineRule="auto"` : ''}/>${ind || hang ? `<w:ind w:left="${ind || 0}" w:hanging="${hang || 0}"/>` : ''}${align ? `<w:jc w:val="${align}"/>` : ''}</w:pPr>${runs(text, `${bold ? '<w:b/>' : ''}${size ? `<w:sz w:val="${size * 2}"/>` : ''}`)}</w:p>`;
  const cell = (text, w, { bold, shade, align } = {}) =>
    `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ''}<w:vAlign w:val="center"/></w:tcPr>${para(text, { after: 0, bold, align, line: 276 })}</w:tc>`;
  function table(b, usable) {
    const tot = b.widths.reduce((a, x) => a + x, 0);
    const w = b.widths.map((x) => Math.round((x / tot) * usable));
    const fs = b.size || 10;
    const row = (cells, head, h) => `<w:tr><w:trPr>${h ? `<w:trHeight w:val="${h}" w:hRule="atLeast"/>` : ''}${head ? '<w:tblHeader/>' : ''}<w:cantSplit/></w:trPr>${cells.map((c, i) => cell(c, w[i], { bold: head, shade: head ? 'E8ECFA' : '', align: b.align && b.align[i] })).join('')}</w:tr>`.replace(/<w:sz w:val="\d+"\/>/g, '');
    const body = `<w:tbl><w:tblPr><w:tblW w:w="${usable}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((k) => `<w:${k} w:val="single" w:sz="4" w:space="0" w:color="888888"/>`).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${w.map((x) => `<w:gridCol w:w="${x}"/>`).join('')}</w:tblGrid>${b.head ? row(b.head, true) : ''}${b.rows.map((r) => row(r, false, b.rowH)).join('')}</w:tbl>`;
    return body + '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>';
  }
  const block = (b, usable) => {
    switch (b.t) {
      case 'title': return para(b.text, { align: 'center', bold: true, size: 12, after: 60, before: 0 });
      case 'sub': return para(b.text, { align: 'center', bold: true, size: 11, after: 80 });
      case 'c': return para(b.text, { align: 'center', after: 60 });
      case 'note': return para(b.text, { size: 8, before: 200, after: 0 });
      case 'h': return para(b.text, { bold: true, size: 11, before: 140, after: 50, keep: true });
      case 'li': return para('•  ' + b.text, { ind: 340, hang: 240, after: 30 });
      case 'sig': return para(`${b.text} ${'_'.repeat(22)}`, { before: 240, after: 40, keep: b.keep });
      case 'pb': return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      case 'table': return table(b, usable);
      default: return para(b.text || '', { after: 60, keep: b.keep });
    }
  };

  function build(blocks, { landscape = false, font = 'Times New Roman', size = 10, margin = 1134 } = {}) {
    const W = landscape ? 16838 : 11906, H = landscape ? 11906 : 16838, M = margin, usable = W - 2 * M;
    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${blocks.map((b, i) => block(blocks[i + 1] && blocks[i + 1].t === 'sig' && b.t !== 'pb' ? { ...b, keep: true } : b.t === 'sig' && blocks[i + 1] && blocks[i + 1].t === 'sig' ? { ...b, keep: true } : b, usable)).join('')}<w:sectPr><w:pgSz w:w="${W}" w:h="${H}"${landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${M}" w:right="${M}" w:bottom="${M}" w:left="${M}" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:eastAsia="${font}"/><w:sz w:val="${size * 2}"/><w:lang w:val="lt-LT"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;
    return zip([
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
      ['word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['word/styles.xml', styles],
      ['word/document.xml', doc],
    ]);
  }
  function save(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_') + (/\.docx$/i.test(name) ? '' : '.docx');
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  return { build, save };
})();
