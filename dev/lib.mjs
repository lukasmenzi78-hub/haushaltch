import fs from 'node:fs';
/** Liest eine Datei so, wie es der Import im Browser tut: UTF-8, bei Ersatzzeichen ISO-8859-1. */
export function readLikeApp(file) {
  const buf = fs.readFileSync(file);
  const text = new TextDecoder('utf-8').decode(buf);
  return text.includes('�') ? new TextDecoder('iso-8859-1').decode(buf) : text;
}
