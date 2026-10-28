/**
 * Every protocol file is indexed (Loom A6.11, from P-19). The Tapestry connector serves a
 * file in protocols/drafts/ or protocols/nips/ only once protocols/README.md's "Spec index"
 * links it, so a file left out of the index is invisible to every teammate's Claude. Each
 * such file is in the Spec index, or in the README's "Not in the index" section with why.
 * Pure: it reads the README and lists the two folders.
 */
const fs = require('fs');
const path = require('path');

const PROTOCOLS = path.resolve(__dirname, '..', 'protocols');
const FOLDERS = ['drafts', 'nips'];
function assert(c, m) { if (!c) throw new Error(m || 'fail'); }
const tests = [];
const t = (n, f) => tests.push([n, f]);

/** The text of a `## ` section of the README, up to the next `## ` heading, or null. */
function section(md, heading) {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

/**
 * The protocol file each of a section's table rows is about, as `drafts/x.md` or `nips/x.md`: the row's
 * first such link, as the connector reads the Spec index. A later link in the row only points elsewhere.
 */
function linked(text) {
  const out = [];
  for (const row of (text || '').split('\n').filter((l) => l.trim().startsWith('|'))) {
    const m = /\]\(\.?\/?((?:drafts|nips)\/[^)#\s]+\.md)(?:#[^)]*)?\)/.exec(row);
    if (m) out.push(m[1]);
  }
  return out;
}

const readme = fs.readFileSync(path.join(PROTOCOLS, 'README.md'), 'utf8');
const indexed = linked(section(readme, 'Spec index'));
const leftOutText = section(readme, 'Not in the index');
const leftOut = linked(leftOutText);
const files = FOLDERS.flatMap((f) => fs.readdirSync(path.join(PROTOCOLS, f)).filter((n) => n.endsWith('.md')).map((n) => `${f}/${n}`));

t('the README has a Spec index and a "Not in the index" section', () => {
  assert(indexed.length > 0, 'protocols/README.md needs a "## Spec index" table linking the specs');
  assert(leftOutText !== null, 'protocols/README.md needs a "## Not in the index" section, even if its table is empty');
});

t('every file in protocols/drafts and protocols/nips is in the Spec index, or left out with a reason', () => {
  const missing = files.filter((f) => !indexed.includes(f) && !leftOut.includes(f));
  assert(missing.length === 0, `not indexed, so the Tapestry connector can't serve them: ${missing.join(', ')}. Add a row to the Spec index in protocols/README.md, or list the file under "Not in the index" with why.`);
});

t('no file is both indexed and left out', () => {
  const both = indexed.filter((f) => leftOut.includes(f));
  assert(both.length === 0, `in the Spec index and under "Not in the index": ${both.join(', ')}`);
});

t('every file the two sections link exists', () => {
  const gone = [...indexed, ...leftOut].filter((f) => !fs.existsSync(path.join(PROTOCOLS, f)));
  assert(gone.length === 0, `linked from protocols/README.md but not there: ${gone.join(', ')}`);
});

t('each file left out says why', () => {
  const rows = (leftOutText || '').split('\n').filter((l) => l.trim().startsWith('|') && linked(l).length > 0);
  const bare = rows.filter((r) => (r.split('|').map((c) => c.trim()).filter(Boolean)[1] || '') === '');
  assert(bare.length === 0, `"Not in the index" rows need a reason in their second column: ${bare.map((r) => linked(r)[0]).join(', ')}`);
});

async function run() {
  console.log('\n--- protocols index tests (every protocol file reaches the Tapestry connector) ---');
  let pass = 0, fail = 0; const failures = [];
  for (const [name, fn] of tests) { try { await fn(); console.log(`  PASS  ${name}`); pass++; } catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); failures.push({ name, message: e.message }); fail++; } }
  console.log(`\nprotocols-index: ${pass} passed, ${fail} failed`);
  return { pass, fail, failures };
}
if (require.main === module) { run().then(({ fail }) => process.exit(fail === 0 ? 0 : 1)).catch((e) => { console.error(e); process.exit(1); }); }
module.exports = { run };
