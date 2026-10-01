import fs from 'node:fs';
import crypto from 'node:crypto';

const source = fs.readFileSync(process.argv[2], 'utf8');
const start = source.indexOf('  const MULTI_OPS =');
const end = source.indexOf('  const parseImportSpecs =', start);
if (start < 0 || end < 0) throw new Error('oracle extraction anchors missing');
// CONSTRAINT: the kit function and its lexical constants are executed verbatim, not instrumented or rewritten.
const extracted = source.slice(start, end);
const lexModule = new Function(extracted + '\nreturn lexModule;')();
const inputs = JSON.parse(fs.readFileSync(0, 'utf8'));
const results = inputs.map(({ name, text }) => {
  const lx = lexModule(text);
  const decisions = lx.tokens.filter(t => t.type === 'punct' && t.value === '/').map(t => ({ pos: t.start, mode: 'code' }));
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '/' || lx.stateAt(i) !== 'regex') continue;
    decisions.push({ pos: i, mode: 'regex' });
    let j = i + 1;
    let klass = false;
    for (; j < text.length; j++) {
      if (text[j] === '\\') { j++; continue; }
      if (klass) { if (text[j] === ']') klass = false; }
      else if (text[j] === '[') klass = true;
      else if (text[j] === '/') break;
    }
    i = j;
    while (i + 1 < text.length && 'gimsuyvd'.includes(text[i + 1])) i++;
  }
  decisions.sort((a, b) => a.pos - b.pos);
  return { name, decisions, mode: lx.mode, interp: lx.interp };
});
console.log(JSON.stringify({
  kitSha256: crypto.createHash('sha256').update(source).digest('hex'),
  extractedSha256: crypto.createHash('sha256').update(extracted).digest('hex'),
  results,
}));
