/**
 * The reading views' reads: pieces of the concept graph in the shape the boards use.
 *
 * A port, verb for verb, of the brainstorm-harness's `bin/brain-slice` (the documents its `brain-view`
 * serves at /api/read/<verb>), so a board designed against that runs here unchanged. Everything is a
 * read: Cypher through the open POST /api/neo4j/query (api/cypher.js), this instance's relay through
 * GET /api/strfry/scan, other relays through GET /api/relay/external, names through GET /api/profiles.
 * No endpoint is new and nothing is written.
 *
 * Every document has the same core: `nodes` (id, name, role, part, kinds, sets, fields, provenance,
 * answers, …), `links` (the typed links among those nodes) and `link_types` (how each type reads both
 * ways). A board merges documents into one cache (brainData.js), so no view needs the whole graph.
 * Counts in `answers` that a card shows on its own (evidence for and against, replaced, history,
 * settled, holds) are over the WHOLE graph; the rest (like_it, shares_values, used_by_scopes) are
 * counted inside the document.
 *
 * Scopes: a project (an element of a "projects" kind, or a concept that things name in their json
 * "scope") with the things filed under it, or a top concept (a child of entry-point, or a root other
 * than Tapestry's own "word" and "debris") with its whole subtree. Keys: project:<handle>, concept:<handle>.
 */
import { cypher } from '../../api/cypher';
import { queryRelay } from '../../api/relay';
import { fetchFromRelays } from '../../utils/nostrPublish';
import { COMMUNITY_RELAYS } from '../../hooks/useCommunitySharedConcepts';

const SYSTEM = new Set(['word', 'debris']); // Tapestry's plumbing roots: never a scope
const HUB = 150; // a path never runs through a group holding more than this
export const LINK_TYPES = ['SUPERCEDES', 'BEARS_ON', 'ANSWERS', 'BLOCKED_BY', 'SETS_ASIDE', 'ASSIGNED_TO', 'REFERENCES', 'ENUMERATES'];
const STATE = {
  ours: 'ours', dict: 'community, in my Dictionary', imported: 'community, imported',
  known: 'community, known here only by its header',
};
const LINK_TYPE_KIND = 'relationship type';
const STRUCTURAL = new Set(['classThread', 'coreNodeWiring', 'propertyTree', 'nostr']);
const SEED_LINK_TYPES = {
  SUPERCEDES: { meaning: 'The newer thing replaces the older one; the old one stays, unedited, as history.', reads: 'supersedes', reverse: 'is superseded by' },
  BEARS_ON: { meaning: 'A piece of evidence bears on a claim, for or against it, with how it was found.', reads: 'bears on', reverse: 'has evidence' },
  ANSWERS: { meaning: 'A decision, ruling or closing note answers a question.', reads: 'answers', reverse: 'is answered by' },
  REFERENCES: { reads: 'refers to', reverse: 'is referred to by', family: 'reference' },
  ENUMERATES: { reads: 'gives the allowed values of', reverse: 'takes its values from', family: 'schema' },
};
const CORE_SUFFIX = ['superset', 'schema', 'primary-property', 'properties', 'core-nodes-graph', 'concept-graph', 'property-tree-graph'];
// The definition tags a Dictionary copy repeats from the community's header.
const COPIED = new Set(['names', 'name', 'description', 'slug', 'required', 'recommended', 'optional',
  'allowed', 'field-type', 'display', 'image', 'link']);
const MINUTE = 60 * 1000;

// ── reading the graph ───────────────────────────────────────────────────────

// The server refuses a "read" whose text holds a write word (SET, CREATE, …) in any case, so
// `'Set' IN labels(n)` would be refused. As bin/brain does, quoted strings move into parameters
// when (and only when) the text would trip that guard.
const SERVER_WRITE_RE = /\b(CREATE|MERGE|DELETE|SET|REMOVE|DETACH|DROP|CALL\s*\{)\b/i;
function liftLiterals(q, params) {
  if (!SERVER_WRITE_RE.test(q)) return [q, params];
  const p = { ...params };
  let n = 0;
  const out = q.replace(/'((?:[^'\\]|\\.)*)'/g, (_, s) => {
    let k = `_lit${n++}`;
    while (k in p) k += '_';
    p[k] = s.replace(/\\(.)/g, '$1');
    return '$' + k;
  });
  return [out, p];
}

export async function R(q, params = {}) {
  const [text, p] = liftLiterals(q, params);
  return cypher(text, p);
}

async function batched(q, ids, n = 250, params = {}) {
  const out = [];
  for (let i = 0; i < ids.length; i += n) out.push(...(await R(q, { ...params, u: ids.slice(i, i + n) })));
  return out;
}

const once = (key, ttl, fn) => {   // a value remembered for ttl ms; the same question in flight is shared
  const hit = CACHE[key];
  if (hit && Date.now() - hit.at < ttl) return hit.p;
  const p = fn();
  CACHE[key] = { at: Date.now(), p };
  p.catch(() => { delete CACHE[key]; });
  return p;
};
const CACHE = {};
const addTo = (m, k, v) => { (m[k] = m[k] || []).push(v); };
const isSetLabels = (ls) => (ls || []).includes('Set') && !(ls || []).includes('Superset');

// ── the concept tree ────────────────────────────────────────────────────────

/** Every concept, its parents and children (read again after a minute: an import may bring new ones). */
export function tree() {
  return once('tree', MINUTE, async () => {
    const names = {};
    (await R('MATCH (h:ConceptHeader) RETURN h.uuid AS u, h.name AS n')).forEach((r) => { names[r.u] = r.n; });
    const parents = {}, kids = {};
    for (const r of await R('MATCH (c:ConceptHeader)-[:IS_THE_CONCEPT_FOR]->(:Superset)<-[:IS_A_SUPERSET_OF]-(:Superset)'
      + '<-[:IS_THE_CONCEPT_FOR]-(p:ConceptHeader) RETURN DISTINCT c.uuid AS c, p.uuid AS p')) {
      if (r.c !== r.p) { addTo(parents, r.c, r.p); addTo(kids, r.p, r.c); }
    }
    const roots = Object.keys(names).filter((u) => !(parents[u] || []).length);
    const ep = roots.filter((u) => names[u] === 'entry-point');
    const tops = [...new Set([...ep.flatMap((e) => kids[e] || []), ...roots.filter((u) => !SYSTEM.has(names[u]) && names[u] !== 'entry-point')])];
    const t = { names, parents, kids, tops };
    const topSet = new Set(tops);
    t.topOf = (u) => {   // the top concept a concept sits under (null under Tapestry's plumbing)
      const seen = new Set();
      while (u && !seen.has(u)) {
        if (topSet.has(u)) return u;
        seen.add(u);
        u = (parents[u] || [])[0] || null;
      }
      return null;
    };
    t.realTop = (u) => {   // whether any line of parents leads up to a real top concept
      const seen = new Set(), todo = [u];
      while (todo.length) {
        const x = todo.pop();
        if (topSet.has(x)) return true;
        if (seen.has(x)) continue;
        seen.add(x); todo.push(...(parents[x] || []));
      }
      return false;
    };
    t.subtree = (u) => {
      const out = [], seen = new Set(), todo = [u];
      while (todo.length) {
        const x = todo.pop();
        if (seen.has(x)) continue;
        seen.add(x); out.push(x); todo.push(...(kids[x] || []));
      }
      return out;
    };
    // Tapestry's own kinds and entry-point: a view leaves them out of lists and drawings
    t.system = new Set([
      ...Object.keys(names).filter((r) => SYSTEM.has(names[r])).flatMap((r) => t.subtree(r)).filter((u) => !t.realTop(u)),
      ...Object.keys(names).filter((u) => names[u] === 'entry-point'),
    ]);
    return t;
  });
}

/** {handle: name} of the projects here: a "projects" kind's elements, and every concept things name in their json scope. */
function projects() {
  return once('projects', MINUTE, async () => {
    const out = {};
    (await R("MATCH (h:ConceptHeader {name:'projects'})-[:IS_THE_CONCEPT_FOR]->(:Superset)-[:HAS_ELEMENT]->(p) "
      + 'RETURN DISTINCT p.uuid AS u, p.name AS n')).forEach((r) => { out[r.u] = r.n; });
    const named = new Set();
    for (const r of await R("MATCH (:NostrEvent)-[:HAS_TAG]->(j:NostrEventTag {type:'json'}) WHERE j.value CONTAINS '\"scope\"' RETURN j.value AS j")) {
      let d; try { d = JSON.parse(r.j); } catch { continue; }
      if (!d || typeof d !== 'object' || Array.isArray(d)) continue;
      for (const sc of [d.scope, ...Object.values(d).map((v) => (v && typeof v === 'object' ? v.scope : null))]) {
        if (Array.isArray(sc)) sc.forEach((x) => { if (typeof x === 'string' && x.startsWith('39998:') && !(x in out)) named.add(x); });
      }
    }
    if (named.size) {
      (await R('MATCH (h:ConceptHeader) WHERE h.uuid IN $u RETURN h.uuid AS u, h.name AS n', { u: [...named].sort() }))
        .forEach((r) => { out[r.u] = r.n; });
    }
    return out;
  });
}

/** {TYPE: {meaning, reads, reverse, family}}: the seeds, then every non-structural "relationship type" element. */
function linkTypes() {
  return once('link_types', 5 * MINUTE, async () => {
    const out = JSON.parse(JSON.stringify(SEED_LINK_TYPES));
    let rows = [];
    try {
      rows = await R('MATCH (h:ConceptHeader {name:$k})-[:IS_THE_CONCEPT_FOR]->(:Superset)'
        + "-[:IS_A_SUPERSET_OF|HAS_ELEMENT*1..4]->(e:NostrEvent)-[:HAS_TAG]->(t:NostrEventTag {type:'json'}) "
        + "WHERE NOT e:Superset AND NOT 'Set' IN labels(e) RETURN DISTINCT e.uuid AS u, t.value AS j", { k: LINK_TYPE_KIND });
    } catch { rows = []; }
    for (const r of rows) {
      let d; try { d = JSON.parse(r.j || '{}'); } catch { d = {}; }
      if (d && typeof d.relationshipType === 'object') d = d.relationshipType;
      const ty = String(d.slug || d.type || '');
      if (!/^[A-Z][A-Z0-9_]{1,40}$/.test(ty) || STRUCTURAL.has(d.category)) continue;
      const was = out[ty] || {};
      out[ty] = { ...was, meaning: d.description || d.claim || was.meaning || '',
        reads: d.reads || was.reads || ty.toLowerCase().replace(/_/g, ' '), reverse: d.reverse || was.reverse || '', category: d.category || '' };
    }
    return out;
  });
}

// ── whose a node is ─────────────────────────────────────────────────────────

/** {community coordinate: our copy's handle}: the Dictionary's entries (our header at the same d, pointing at it). */
function copies(ta) {
  return once('copies:' + ta, MINUTE, async () => {
    const out = {};
    for (const r of await R('MATCH (h:NostrEvent) WHERE h.kind = 39998 AND h.pubkey = $ta '
      + "OPTIONAL MATCH (h)-[:HAS_TAG]->(b:NostrEventTag {type:'b'}) RETURN h.uuid AS u, collect(DISTINCT b.value) AS bs", { ta })) {
      const d = r.u.split(':').slice(2).join(':');
      for (const b of r.bs || []) {
        if (/^39998:[0-9a-f]{64}:.+/.test(b || '') && b !== r.u && b.split(':').slice(2).join(':') === d) out[b] = r.u;
      }
    }
    return out;
  });
}

/** {handle: ours|dict|imported|known}. */
async function provenances(hs, ta) {
  const out = {}, ask = [];
  for (const h of hs) {
    const pk = (h || '').split(':')[1];
    if (pk && pk.length === 64) { if (pk === ta) out[h] = 'ours'; else ask.push(h); }
  }
  if (!ask.length) return out;
  const heads = {};
  for (const h of ask) {   // the header each belongs to: itself, its core-node base, or its z
    const [k, pk, ...rest] = h.split(':'); const d = rest.join(':');
    const sfx = CORE_SUFFIX.find((s) => d.endsWith('-' + s));
    heads[h] = k === '39998' ? [h] : sfx ? [`39998:${pk}:${d.slice(0, -sfx.length - 1)}`] : [];
  }
  for (const r of await batched("UNWIND $u AS u MATCH (n:NostrEvent {uuid:u}) OPTIONAL MATCH (n)-[:HAS_TAG]->(z:NostrEventTag {type:'z'}) "
    + 'RETURN u, collect(z.value) AS zs', ask)) {
    heads[r.u].push(...(r.zs || []).filter((z) => String(z).startsWith('39998:')));
  }
  const cand = [...new Set(Object.values(heads).flat())].sort();
  const imp = new Set(cand.length ? (await batched('MATCH (c:ConceptHeader) WHERE c.uuid IN $u RETURN c.uuid AS u', cand)).map((r) => r.u) : []);
  const cp = await copies(ta);
  for (const h of ask) {
    const mine = heads[h].filter((x) => x.split(':')[1] === h.split(':')[1]);
    out[h] = mine.some((x) => x in cp) ? 'dict' : mine.some((x) => imp.has(x)) ? 'imported' : 'known';
  }
  return out;
}

// ── what a scope holds ──────────────────────────────────────────────────────

export async function scopes() {
  const t = await tree(), pj = await projects(), out = [];
  const keys = Object.keys(pj);
  if (keys.length) {
    for (const r of await R("UNWIND $u AS h MATCH (n:NostrEvent)-[:HAS_TAG]->(j:NostrEventTag {type:'json'}) "
      + 'WHERE j.value CONTAINS h RETURN h, count(DISTINCT n) AS n', { u: keys })) {
      if (r.n) out.push({ key: 'project:' + r.h, label: pj[r.h], kind: 'project', count: r.n });
    }
  }
  // every top's subtree in one query (a query per top, one after another, was most of the page's wait)
  const subs = Object.fromEntries(t.tops.map((top) => [top, t.subtree(top)]));
  const pairs = Object.entries(subs).flatMap(([top, sub]) => sub.map((c) => ({ t: top, c })));
  const got = {};
  if (pairs.length) {
    for (const r of await R('UNWIND $p AS x MATCH (:NostrEvent {uuid:x.c})-[:IS_THE_CONCEPT_FOR]->(:Superset)'
      + '-[:IS_A_SUPERSET_OF*0..8]->()-[:HAS_ELEMENT]->(e) RETURN x.t AS t, count(DISTINCT e) AS n', { p: pairs })) got[r.t] = r.n;
  }
  for (const top of t.tops) {
    const count = (got[top] || 0) + subs[top].length - 1;
    if (count) out.push({ key: 'concept:' + top, label: t.names[top], kind: 'concept', count });
  }
  out.sort((a, b) => (a.kind !== 'project') - (b.kind !== 'project') || b.count - a.count);
  return { scopes: out };
}

async function scopeMembers(key, limit) {
  const i = key.indexOf(':'), kind = key.slice(0, i), h = key.slice(i + 1);
  let rows, lead;
  if (kind === 'project') {
    rows = await R("MATCH (n:NostrEvent)-[:HAS_TAG]->(j:NostrEventTag {type:'json'}) WHERE j.value CONTAINS $h "
      + 'RETURN DISTINCT n.uuid AS u, n.created_at AS t', { h });
    lead = [h];
  } else if (kind === 'concept') {
    const sub = (await tree()).subtree(h);
    rows = await R('UNWIND $u AS c MATCH (:NostrEvent {uuid:c})-[:IS_THE_CONCEPT_FOR]->(:Superset)-[:IS_A_SUPERSET_OF*0..8]->(g)'
      + '-[:HAS_ELEMENT]->(e) RETURN DISTINCT e.uuid AS u, e.created_at AS t', { u: sub });
    const sets = await R('UNWIND $u AS c MATCH (:NostrEvent {uuid:c})-[:IS_THE_CONCEPT_FOR]->(:Superset)-[:IS_A_SUPERSET_OF*1..8]->(s) '
      + "WHERE 'Set' IN labels(s) AND NOT 'Superset' IN labels(s) RETURN DISTINCT s.uuid AS u", { u: sub });
    lead = [...sub, ...sets.map((r) => r.u)];
  } else {
    throw new Error(`a scope key is project:<handle> or concept:<handle>, not ${key}`);
  }
  rows.sort((a, b) => (b.t || 0) - (a.t || 0));
  const ids = [...new Set([...lead, ...rows.filter((r) => r.u).map((r) => r.u)])];
  return [ids.slice(0, limit + lead.length), rows.length];
}

/** A Set's elements, or a kind's elements down its whole subtree, newest first. */
async function members(gid) {
  const rows = await R('MATCH (g:NostrEvent {uuid:$g}) OPTIONAL MATCH (g)-[:HAS_ELEMENT]->(e1) '
    + 'OPTIONAL MATCH (g)-[:IS_THE_CONCEPT_FOR]->(:Superset)-[:IS_A_SUPERSET_OF*0..8]->()-[:HAS_ELEMENT]->(e2) '
    + 'WITH collect(DISTINCT e1) + collect(DISTINCT e2) AS es UNWIND es AS e RETURN DISTINCT e.uuid AS u, e.created_at AS t', { g: gid });
  rows.sort((a, b) => (b.t || 0) - (a.t || 0));
  return rows.filter((r) => r.u).map((r) => r.u);
}

// ── the document: nodes, their structure, typed links, answers ──────────────

/** part: {uuid: scope label, or null for "its home scope"} -> a document. */
async function build(part, ta) {
  const chosen = Object.keys(part).filter(Boolean);
  const kindOf = {}, setsOf = {};
  for (const r of await batched('UNWIND $u AS u MATCH (e:NostrEvent {uuid:u}) OPTIONAL MATCH (g)-[:HAS_ELEMENT]->(e) '
    + 'OPTIONAL MATCH (k:ConceptHeader)-[:IS_THE_CONCEPT_FOR]->(sup:Superset)-[:IS_A_SUPERSET_OF*0..6]->(g) '
    + "RETURN u, g.uuid AS g, 'Set' IN labels(g) AND NOT 'Superset' IN labels(g) AS isSet, collect(DISTINCT k.uuid) AS ks", chosen, 200)) {
    if (!r.g) continue;
    if (r.isSet && !(setsOf[r.u] || []).includes(r.g)) addTo(setsOf, r.u, r.g);
    for (const k of r.ks || []) if (k && !(kindOf[r.u] || []).includes(k)) addTo(kindOf, r.u, k);
  }
  // every kind and Set they sit in becomes a node too, and the kinds above those
  const t = await tree();
  const context = new Set([...Object.values(kindOf), ...Object.values(setsOf)].flat());
  const parents = {};
  let frontier = new Set([...context, ...chosen].filter((u) => u in t.names));
  const seen = new Set();
  while (frontier.size) {
    const nxt = new Set();
    for (const u of frontier) { parents[u] = t.parents[u] || []; parents[u].forEach((p) => nxt.add(p)); }
    frontier.forEach((u) => seen.add(u));
    frontier = new Set([...nxt].filter((u) => !seen.has(u)));
  }
  Object.values(parents).flat().forEach((p) => context.add(p));
  const setParent = {};
  const setlike = [...new Set([...context, ...chosen])].filter((x) => x.startsWith('39999:'));
  for (const r of await batched("UNWIND $u AS u MATCH (s:NostrEvent {uuid:u}) WHERE 'Set' IN labels(s) AND NOT 'Superset' IN labels(s) "
    + 'MATCH (p)-[:IS_A_SUPERSET_OF]->(s) OPTIONAL MATCH (k:ConceptHeader)-[:IS_THE_CONCEPT_FOR]->(p) RETURN u, coalesce(k.uuid, p.uuid) AS p', setlike)) {
    addTo(setParent, r.u, r.p);
  }
  Object.values(setParent).flat().filter(Boolean).forEach((p) => context.add(p));
  context.forEach((u) => { if (!(u in part)) part[u] = 'structure'; });
  const ids = Object.keys(part).filter(Boolean).sort();

  const info = {};
  for (const r of await batched('UNWIND $u AS u MATCH (n:NostrEvent {uuid:u}) '
    + "OPTIONAL MATCH (n)-[:HAS_TAG]->(j:NostrEventTag {type:'json'}) "
    + "OPTIONAL MATCH (n)-[:HAS_TAG]->(d:NostrEventTag {type:'description'}) "
    + 'RETURN u, n.name AS name, labels(n) AS labels, n.created_at AS t, head(collect(j.value)) AS j, head(collect(d.value)) AS d', ids, 200)) {
    info[r.u] = r;
  }
  const prov = await provenances(ids, ta);
  const pj = await projects();

  const homeOf = (u, role, rawScope) => {   // the project it is filed under, else the top concept of its kind
    const proj = rawScope.find((x) => x in pj);
    if (proj) return 'project:' + proj;
    const top = role === 'concept' ? t.topOf(u) : [...(kindOf[u] || []), ...(setParent[u] || [])].map((k) => t.topOf(k)).find(Boolean);
    return top ? 'concept:' + top : 'structure';
  };
  const nodes = ids.map((u) => {
    const r = info[u] || {};
    let j; try { j = JSON.parse(r.j || '{}'); } catch { j = {}; }
    if (!j || typeof j !== 'object' || Array.isArray(j)) j = {};
    const rawScope = (Array.isArray(j.scope) ? j.scope : []).filter((x) => typeof x === 'string');
    const word = j.word && typeof j.word === 'object' ? j.word : {};
    if (j.word && typeof j.word === 'object') delete j.word;
    const labels = r.labels || [];
    const role = u.startsWith('39998:') || labels.includes('ConceptHeader') ? 'concept' : isSetLabels(labels) ? 'set' : 'element';
    const fields = {};
    if (role === 'concept') {
      const ch = j.conceptHeader || {};
      if (ch.oNames) fields.plural = ch.oNames.plural;
    } else {
      const n = Object.keys(j).length;
      for (const [k, v] of Object.entries(j)) {
        if (v && typeof v === 'object' && !Array.isArray(v) && n <= 2) { Object.assign(fields, v); continue; }   // {"word":…, "<kind>": {…}}
        fields[k] = v;
      }
    }
    delete fields.scope; delete fields.recorded;
    const p = part[u] == null ? homeOf(u, role, rawScope) : part[u];
    return {
      id: u, name: r.name || word.name || u.split(':').pop(), role, part: p,
      description: r.d || (j.conceptHeader || {}).description || null,
      kinds: kindOf[u] || [], sets: setsOf[u] || [],
      parent_kinds: role === 'concept' ? parents[u] || [] : [],
      inside: role === 'set' ? setParent[u] || [] : [],
      author: u.split(':').length >= 3 ? u.split(':')[1] : null,
      provenance: STATE[prov[u]] || 'ours',
      scopes: rawScope.map((x) => pj[x] || x.split(':').pop()),
      created_at: r.t, fields,
      ...(t.system.has(u) ? { system: true } : {}),
    };
  });

  const lt = await linkTypes();
  const links = [];
  for (const ty of LINK_TYPES) {
    for (const r of await batched(`UNWIND $u AS u MATCH (a:NostrEvent {uuid:u})-[e:${ty}]->(c:NostrEvent) WHERE c.uuid IN $all `
      + 'RETURN a.uuid AS a, c.uuid AS c, properties(e) AS p', ids, 300, { all: ids })) {
      const pr = {};
      Object.entries(r.p || {}).forEach(([k, v]) => { if (['polarity', 'reliability', 'how', 'reason', 'source', 'note'].includes(k)) pr[k] = v; });
      if (r.a !== r.c) links.push({ from: r.a, to: r.c, type: ty, ...(Object.keys(pr).length ? { props: pr } : {}) });
    }
  }
  for (const r of await R('MATCH (sup:Superset)-[:ENUMERATES]->(p:Property) MATCH (k:ConceptHeader)-[:IS_THE_CONCEPT_FOR]->(sup) '
    + 'MATCH (p)-[:IS_A_PROPERTY_OF*1..3]->(:JSONSchema)-[:IS_THE_JSON_SCHEMA_FOR]->(t:ConceptHeader) '
    + 'WHERE k.uuid IN $all AND t.uuid IN $all RETURN DISTINCT k.uuid AS a, t.uuid AS c, p.name AS f', { all: ids })) {
    links.push({ from: r.a, to: r.c, type: 'ENUMERATES', props: { field: r.f } });
  }
  const link_types = LINK_TYPES.map((ty) => ({ type: ty, reads: (lt[ty] || {}).reads, reverse: (lt[ty] || {}).reverse,
    family: (lt[ty] || {}).family, meaning: (lt[ty] || {}).meaning }));
  answers(nodes, links);
  await wholeGraphCounts(nodes);
  return { link_types, nodes, links };
}

/** Per node, the structural answers the boards show, counted inside the document. */
function answers(nodes, links) {
  const byid = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const outL = {}, inL = {}, mem = {}, valueIndex = {};
  links.forEach((l) => { addTo(outL, l.from, l); addTo(inL, l.to, l); });
  nodes.forEach((n) => [...n.sets, ...n.kinds].forEach((s) => addTo(mem, s, n.id)));
  nodes.forEach((n) => ['decided_by', 'date', 'subject', 'year', 'status'].forEach((f) => {
    const v = n.fields[f];
    if ((typeof v === 'string' || typeof v === 'number') && v !== '') addTo(valueIndex, f + '\u0000' + v, n.id);
  }));
  const count = (ls, ty) => (ls || []).filter((l) => l.type === ty).length;
  for (const n of nodes) {
    const u = n.id, A = {}, o = outL[u] || [], i = inL[u] || [];
    if (n.kinds.length || n.sets.length) A.part_of = n.kinds.length + n.sets.length;
    if (n.sets.length >= 2) A.in_several_groups = n.sets.length;
    const sib = new Set([...n.sets, ...n.kinds].flatMap((s) => mem[s] || []).filter((m) => m !== u));
    if (sib.size) A.like_it = sib.size;
    if (count(o, 'BEARS_ON')) A.bears_on = count(o, 'BEARS_ON');
    if (count(o, 'ANSWERS')) A.answers = count(o, 'ANSWERS');
    for (const [ty, ko, ki] of [['BLOCKED_BY', 'waits_on', 'waited_on_by'], ['SETS_ASIDE', 'sets_aside', 'set_aside_by'], ['ASSIGNED_TO', 'assigned_to', 'responsible_for']]) {
      if (count(o, ty)) A[ko] = count(o, ty);
      if (count(i, ty)) A[ki] = count(i, ty);
    }
    const who = n.fields.decided_by || n.fields.subject;
    if (who) {
      const f = n.fields.decided_by ? 'decided_by' : 'subject';
      A.voice = { who, others_by_them: (valueIndex[f + '\u0000' + who] || []).length - 1 };
    }
    const refKinds = new Set(i.filter((l) => l.type === 'REFERENCES' && byid[l.from]).flatMap((l) => byid[l.from].kinds));
    if (refKinds.size >= 2) A.seen_from_several_kinds = refKinds.size;
    if (n.provenance !== 'ours') A.whose = n.provenance;
    const linked = new Set([...o, ...i].flatMap((l) => (byid[l.from === u ? l.to : l.from] || {}).scopes || []));
    const other = [...linked].filter((s) => !n.scopes.includes(s)).sort();
    if (n.scopes.length && other.length) A.reaches_other_scopes = other;
    const rOut = count(o, 'REFERENCES'), rIn = count(i, 'REFERENCES');
    if (rOut || rIn) A.mentions = { out: rOut, in: rIn };
    if (n.role !== 'element') {
      const used = new Set([...i.filter((l) => l.type === 'REFERENCES').flatMap((l) => (byid[l.from] || {}).scopes || []),
        ...(mem[u] || []).flatMap((m) => (byid[m] || {}).scopes || [])]);
      if (used.size >= 2) A.used_by_scopes = [...used].sort();
    }
    const src = {};
    ['source', 'line', 'commit', 'interview', 'cite_key', 'section'].forEach((k) => { if (n.fields[k]) src[k] = n.fields[k]; });
    if (Object.keys(src).length) A.source = src;
    const shared = {};
    Object.entries(valueIndex).forEach(([fv, xs]) => { if (xs.includes(u) && xs.length > 1) shared[fv.replace('\u0000', '=')] = xs.length - 1; });
    if (Object.keys(shared).length) A.shares_values = shared;
    if ([...o, ...i].some((l) => l.type === 'ENUMERATES')) A.values_from_elsewhere = true;
    n.answers = A;
  }
}

/** The answers a card shows on its own, over the whole graph (one query each: counting several edge
 *  kinds through one OPTIONAL MATCH chain multiplies rows). */
async function wholeGraphCounts(nodes) {
  const ids = nodes.map((n) => n.id), byid = Object.fromEntries(nodes.map((n) => [n.id, n]));
  for (const r of await batched('UNWIND $u AS u MATCH (n:NostrEvent {uuid:u})<-[b:BEARS_ON]-() '
    + 'RETURN u, sum(CASE WHEN coalesce(b.polarity,0) > 0 THEN 1 ELSE 0 END) AS f, '
    + 'sum(CASE WHEN coalesce(b.polarity,0) < 0 THEN 1 ELSE 0 END) AS a, sum(coalesce(b.polarity,0)) AS net', ids)) {
    const A = byid[r.u].answers;
    if (r.f) A.evidence_for = r.f;
    if (r.a) A.evidence_against = r.a;
    A.evidence_net = Math.round(Number(r.net || 0) * 100) / 100;
  }
  for (const r of await batched('UNWIND $u AS u MATCH (n:NostrEvent {uuid:u})-[:SUPERCEDES*1..20]-(m) '
    + 'RETURN u, count(DISTINCT m) + 1 AS h, size([(n)<-[:SUPERCEDES]-() | 1]) AS newer', ids)) {
    const A = byid[r.u].answers;
    A.history = r.h;
    if (r.newer) A.replaced = true;
  }
  const answered = new Set((await batched('UNWIND $u AS u MATCH (n:NostrEvent {uuid:u})<-[:ANSWERS]-() RETURN DISTINCT u', ids)).map((r) => r.u));
  const kindNames = Object.fromEntries(nodes.filter((n) => n.role === 'concept').map((n) => [n.id, n.name]));
  nodes.forEach((n) => {
    if (n.kinds.map((k) => kindNames[k] || '').join(' ').toLowerCase().includes('question')) n.answers.settled = answered.has(n.id);
  });
  const groups = nodes.filter((n) => n.role !== 'element').map((n) => n.id);
  for (const r of await batched('UNWIND $u AS u MATCH (g:NostrEvent {uuid:u}) OPTIONAL MATCH (g)-[:HAS_ELEMENT]->(e1) '
    + 'OPTIONAL MATCH (g)-[:IS_THE_CONCEPT_FOR]->(:Superset)-[:IS_A_SUPERSET_OF*0..8]->()-[:HAS_ELEMENT]->(e2) '
    + 'WITH u, collect(DISTINCT e1) + collect(DISTINCT e2) AS es RETURN u, size(es) AS n', groups, 100)) {
    if (r.n) byid[r.u].answers.holds = r.n;
  }
}

// ── the verbs ───────────────────────────────────────────────────────────────

export async function scope({ key, limit = 400 }, ta) {
  if (!key) throw new Error('scope needs a key');
  limit = Number(limit);
  const [ids, total] = await scopeMembers(key, limit);
  const h = key.slice(key.indexOf(':') + 1);   // the label without counting every scope again
  const label = (key.startsWith('project:') ? (await projects())[h] : (await tree()).names[h]) || key;
  const doc = await build(Object.fromEntries(ids.map((u) => [u, key])), ta);
  doc.parts = [{ key, label }];
  doc.scope = { key, label, shown: ids.length, total, capped: total > limit };
  return doc;
}

export async function node({ id, depth = 1 }, ta) {
  if (!id) throw new Error('node needs an id');
  const near = new Set([id]);
  let frontier = [id];
  for (let d = 0; d < Math.max(1, Math.min(Number(depth), 2)); d++) {
    const rows = await batched(`UNWIND $u AS u MATCH (n:NostrEvent {uuid:u})-[:${LINK_TYPES.join('|')}]-(m:NostrEvent) RETURN DISTINCT m.uuid AS m`, [...frontier].sort());
    const nxt = [...new Set(rows.map((r) => r.m).filter((m) => m && !near.has(m)))].sort().slice(0, d === 0 ? 40 : 60);
    nxt.forEach((m) => near.add(m));
    frontier = nxt;
  }
  const ms = (await members(id)).slice(0, 40);
  // a concept's place in the tree: the kinds right under it and the Sets directly in it
  const t = await tree();
  const under = [...(t.kids[id] || [])];
  if (id in t.names) {
    under.push(...(await R('MATCH (:NostrEvent {uuid:$u})-[:IS_THE_CONCEPT_FOR]->(:Superset)-[:IS_A_SUPERSET_OF]->(s) '
      + "WHERE 'Set' IN labels(s) AND NOT 'Superset' IN labels(s) RETURN s.uuid AS u", { u: id })).map((r) => r.u));
  }
  const all = [...new Set([...near, ...ms, ...under.slice(0, 40)])].sort();
  const doc = await build(Object.fromEntries(all.map((u) => [u, null])), ta);
  doc.center = id;
  return doc;
}

export async function group({ id, offset = 0, limit = 150 }, ta) {
  if (!id) throw new Error('group needs an id');
  const ms = await members(id);
  const page = ms.slice(Number(offset), Number(offset) + Number(limit));
  const doc = await build(Object.fromEntries([id, ...page].map((u) => [u, null])), ta);
  doc.group = { id, total: ms.length, offset: Number(offset), limit: Number(limit), ids: page };
  return doc;
}

export async function search({ q, limit = 14 }, ta) {
  const ws = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!ws.length) return { link_types: [], nodes: [], links: [], results: [] };
  const rows = await R('MATCH (n:NostrEvent) WHERE n.name IS NOT NULL AND ALL(w IN $w WHERE toLower(n.name) CONTAINS w) '
    + 'RETURN n.uuid AS u, n.name AS n, labels(n) AS l LIMIT 400', { w: ws });
  const core = ['Superset', 'JSONSchema', 'Property'];
  const score = (r) => {
    const low = (r.n || '').toLowerCase();
    let s = 0;
    for (const w of ws) { const i = low.indexOf(w); s += i === 0 ? 4 : i > 0 && ' -_'.includes(low[i - 1]) ? 3 : 1.5; }
    return s - low.length / 400 - ((r.l || []).some((x) => core.includes(x)) ? 2 : 0);
  };
  const top = rows.map((r) => [score(r), r.u]).sort((a, b) => b[0] - a[0]).slice(0, Number(limit)).map((x) => x[1]);
  const doc = await build(Object.fromEntries(top.map((u) => [u, null])), ta);
  doc.results = top;
  return doc;
}

/** Tapestry's own kinds, their supersets, and hubs: everything is an element of "superset" or "set",
 *  and a group holding more than HUB things puts everything two steps from everything. */
function plumbing() {
  return once('plumbing', MINUTE, async () => {
    const t = await tree();
    const hs = [...t.system];
    const sup = (await R('MATCH (h:ConceptHeader)-[:IS_THE_CONCEPT_FOR]->(s) WHERE h.uuid IN $h RETURN s.uuid AS s', { h: hs })).map((r) => r.s);
    const hubs = (await R("MATCH (g:NostrEvent) WHERE g:ConceptHeader OR ('Set' IN labels(g) AND NOT 'Superset' IN labels(g)) "
      + 'OPTIONAL MATCH (g)-[:HAS_ELEMENT]->(e1) '
      + 'OPTIONAL MATCH q = (g)-[:IS_THE_CONCEPT_FOR]->(:Superset)-[:IS_A_SUPERSET_OF*0..6]->(h)-[:HAS_ELEMENT]->(e2) '
      + 'WHERE ALL(x IN nodes(q)[2..-1] WHERE NOT x:Superset) '
      + 'WITH g, collect(DISTINCT e1) + collect(DISTINCT e2) AS es WHERE size(es) > $k RETURN g.uuid AS u', { k: HUB })).map((r) => r.u);
    return new Set([...hs, ...sup, ...hubs]);
  });
}

/** One step out from each id: [from, to, how, type]. mode 0 = typed links; 1 = also Sets; 2 = also kinds. */
async function steps(ids, mode) {
  const out = [], skip = await plumbing(), lt = await linkTypes();
  for (const r of await batched(`UNWIND $u AS u MATCH (n:NostrEvent {uuid:u})-[e:${LINK_TYPES.join('|')}]-(m:NostrEvent) `
    + 'RETURN u, m.uuid AS m, type(e) AS t, startNode(e).uuid = u AS fwd', ids)) {
    out.push([r.u, r.m, (lt[r.t] || {})[r.fwd ? 'reads' : 'reverse'] || r.t.toLowerCase(), r.t]);
  }
  if (mode >= 1) {
    for (const r of await batched('UNWIND $u AS u MATCH (g)-[:HAS_ELEMENT]->(:NostrEvent {uuid:u}) '
      + 'OPTIONAL MATCH q = (k:ConceptHeader)-[:IS_THE_CONCEPT_FOR]->(:Superset)-[:IS_A_SUPERSET_OF*0..6]->(g) '
      + 'WHERE ALL(x IN nodes(q)[2..] WHERE NOT x:Superset) '
      + "RETURN u, CASE WHEN 'Set' IN labels(g) AND NOT 'Superset' IN labels(g) THEN g.uuid END AS s, collect(DISTINCT k.uuid) AS ks", ids)) {
      if (r.s) out.push([r.u, r.s, 'is in', 'HAS_ELEMENT']);
      if (mode >= 2) (r.ks || []).filter(Boolean).forEach((k) => out.push([r.u, k, 'is in', 'HAS_ELEMENT']));
    }
    const groups = ids.filter((u) => u.startsWith('39999:') || u.startsWith('39998:'));
    if (groups.length) {
      for (const r of await batched("UNWIND $u AS u MATCH (g:NostrEvent {uuid:u}) WHERE ('Set' IN labels(g) AND NOT 'Superset' IN labels(g)) "
        + (mode >= 2 ? 'OR g:ConceptHeader ' : '')
        + 'OPTIONAL MATCH (g)-[:HAS_ELEMENT]->(e1) '
        + 'OPTIONAL MATCH q = (g)-[:IS_THE_CONCEPT_FOR]->(:Superset)-[:IS_A_SUPERSET_OF*0..6]->(h)-[:HAS_ELEMENT]->(e2) '
        + 'WHERE ALL(x IN nodes(q)[2..-1] WHERE NOT x:Superset) '
        + 'WITH u, collect(DISTINCT e1.uuid)[0..200] + collect(DISTINCT e2.uuid)[0..200] AS es RETURN u, es', groups, 50)) {
        (r.es || []).filter(Boolean).forEach((e) => out.push([r.u, e, 'holds', 'HAS_ELEMENT']));
      }
    }
  }
  if (mode >= 2) {   // a kind's place in the concept tree
    const t = await tree();
    for (const u of ids) {
      (t.parents[u] || []).forEach((p) => out.push([u, p, 'is a kind of', 'IS_A_SUPERSET_OF']));
      (t.kids[u] || []).forEach((k) => out.push([u, k, 'includes', 'IS_A_SUPERSET_OF']));
    }
  }
  return out.filter((x) => !skip.has(x[1]) && x[0] !== x[1]);
}

/** The shortest way from a to b, searched from both ends a step at a time: typed links only first,
 *  then also through Sets, then also through kinds. */
export async function path({ from: a, to: b, max_steps: maxSteps = 8 }, ta) {
  if (!a || !b) throw new Error('path needs from and to');
  let meet = null, prev;
  for (const mode of [0, 1, 2]) {
    prev = { [a]: { [a]: null }, [b]: { [b]: null } };
    const front = { [a]: [a], [b]: [b] };
    for (let s = 0; s < maxSteps && !meet; s++) {
      const side = front[a].length <= front[b].length ? a : b, other = side === a ? b : a;
      if (!front[side].length) break;
      const nxt = [];
      for (const [x, y, how, ty] of await steps(front[side], mode)) {
        if (y in prev[side]) continue;
        prev[side][y] = [x, how, ty]; nxt.push(y);
        if (y in prev[other]) { meet = y; break; }
      }
      front[side] = nxt.slice(0, 3000);
    }
    if (meet) break;
  }
  if (!meet) { const doc = await build({ [a]: null, [b]: null }, ta); doc.path = null; return doc; }
  const left = [];
  let x = meet;
  while (prev[a][x]) { const [f, how, ty] = prev[a][x]; left.unshift({ from: f, to: x, via: how, type: ty }); x = f; }
  const flip = { 'is in': 'holds', holds: 'is in', 'is a kind of': 'includes', includes: 'is a kind of' };
  Object.values(await linkTypes()).forEach((v) => { if (v.reads && v.reverse) { flip[v.reads] = v.reverse; flip[v.reverse] = v.reads; } });
  const right = [];
  x = meet;
  while (prev[b][x]) { const [f, how, ty] = prev[b][x]; right.push({ from: x, to: f, via: flip[how] || how, type: ty }); x = f; }
  const stepsOut = [...left, ...right];
  const doc = await build(Object.fromEntries([...new Set([a, ...stepsOut.map((s) => s.to)])].map((u) => [u, null])), ta);
  doc.path = stepsOut;
  return doc;
}

// ── the community view: this instance among other people's concepts ─────────

const addrOf = (e) => {
  const d = (e.tags || []).find((t) => t && t[0] === 'd' && t.length > 1);
  return e.kind >= 30000 && d ? `${e.kind}:${e.pubkey}:${d[1]}` : e.id;
};
const newest = (evs) => {
  const out = {};
  for (const e of evs || []) { const a = addrOf(e); if (!out[a] || (e.created_at || 0) > (out[a].created_at || 0)) out[a] = e; }
  return out;
};
const copiedPart = (tags) => (tags || []).filter((t) => t && COPIED.has(t[0])).map((t) => [...t]);
const sameTags = (x, y) => JSON.stringify(x) === JSON.stringify(y);

/** Newest event per address on this instance's own relay, fetched by kind and author. */
async function ownByAddr(addrs) {
  const groups = {};
  addrs.filter((a) => a.split(':').length >= 3).forEach((a) => {
    const [k, pk, ...rest] = a.split(':');
    addTo(groups, k + ':' + pk, rest.join(':'));
  });
  const evs = [];
  for (const [kp, ds] of Object.entries(groups)) {
    const [k, pk] = kp.split(':');
    for (let i = 0; i < ds.length; i += 100) {
      const chunk = ds.slice(i, i + 100);
      evs.push(...((await queryRelay({ kinds: [Number(k)], authors: [pk], '#d': chunk, limit: chunk.length * 3 })) || []));
    }
  }
  return newest(evs);
}

const NAMES = {};   // pubkey -> display name (or null): profiles rarely change, so once a page load
async function profileNames(pks) {
  const ask = pks.filter((pk) => !(pk in NAMES) && /^[0-9a-f]{64}$/.test(pk));
  for (let i = 0; i < ask.length; i += 50) {
    const chunk = ask.slice(i, i + 50);
    try {
      const d = await (await fetch('/api/profiles?pubkeys=' + chunk.join(','))).json();
      chunk.forEach((pk) => {
        const p = (d && d.profiles && d.profiles[pk]) || null;
        NAMES[pk] = p ? p.display_name || p.displayName || p.name || null : null;
      });
    } catch { chunk.forEach((pk) => { NAMES[pk] = null; }); }
  }
  return NAMES;
}

/** What this instance knows about community concepts (the Dictionary view). Reads two relays, so it
 *  is slower than the other verbs; brainData.js keeps its answer for five minutes. */
export async function community(_, ta, config = {}) {
  const COMMUNITY = COMMUNITY_RELAYS[0];
  const heads = await R("MATCH (h:ConceptHeader) OPTIONAL MATCH (h)-[:HAS_TAG]->(d:NostrEventTag {type:'description'}) "
    + 'OPTIONAL MATCH (h)-[:IS_THE_CONCEPT_FOR]->(s:Superset) '
    + 'RETURN h.uuid AS u, h.name AS n, h.created_at AS t, head(collect(d.value)) AS d, count(DISTINCT s) > 0 AS core');
  const H = Object.fromEntries(heads.map((r) => [r.u, r]));
  const ids = Object.keys(H).sort();
  const btags = {};
  for (const r of await R("MATCH (h:ConceptHeader)-[:HAS_TAG]->(t:NostrEventTag {type:'b'}) RETURN h.uuid AS u, t.value AS v, t.value1 AS how")) {
    if (r.v) addTo(btags, r.u, { target: r.v, type: r.how || 'pointer', self: r.v === r.u });
  }
  const t = await tree();
  const byAuthor = {};
  for (const r of await R('MATCH q = (h:ConceptHeader)-[:IS_THE_CONCEPT_FOR]->(:Superset)-[:IS_A_SUPERSET_OF*0..6]->(g)-[:HAS_ELEMENT]->(e) '
    + 'WHERE ALL(x IN nodes(q)[2..-1] WHERE NOT x:Superset) RETURN h.uuid AS u, e.pubkey AS pk, count(DISTINCT e) AS n')) {
    if (r.pk) { byAuthor[r.u] = byAuthor[r.u] || {}; byAuthor[r.u][r.pk] = (byAuthor[r.u][r.pk] || 0) + r.n; }
  }
  const prov = await provenances(ids, ta);
  const cp = await copies(ta);
  const copyOf = Object.fromEntries(Object.entries(cp).map(([k, v]) => [v, k]));

  // where each header's newest event is: this instance's relay and the community relay
  const communityHeads = newest(await fetchFromRelays({ kinds: [39998], limit: 2000 }, [COMMUNITY]));
  const ownHeads = await ownByAddr(ids.filter((u) => u.startsWith('39998:')));
  const rel = (e, u) => (!e ? null : (e.created_at || 0) === (H[u].t || 0) ? 'same' : (e.created_at || 0) < (H[u].t || 0) ? 'older' : 'newer');
  const where = (u) => ({ own: rel(ownHeads[u], u) || 'missing', community: rel(communityHeads[u], u) || 'missing' });
  const fieldsOfEvent = (e) => ((e || {}).tags || []).filter((x) => x && ['required', 'recommended', 'optional'].includes(x[0]) && x.length > 1)
    .map((x) => ({ field: x[1], level: x[0], what: x[2] || '' }));

  // a concept's fields as its schema defines them (the property tree), beside the ones its header's tags name
  const schema = {};
  for (const r of await R('MATCH (p:Property)-[:IS_A_PROPERTY_OF*1..3]->(:JSONSchema)-[:IS_THE_JSON_SCHEMA_FOR]->(h:ConceptHeader) '
    + "WHERE NOT p.name STARTS WITH 'primary property for' "
    + "OPTIONAL MATCH (p)-[:HAS_TAG]->(j:NostrEventTag {type:'json'}) RETURN h.uuid AS u, p.name AS n, head(collect(j.value)) AS j")) {
    let pr; try { pr = (JSON.parse(r.j || '{}') || {}).property || {}; } catch { pr = {}; }
    schema[r.u] = schema[r.u] || {};
    if (r.n && !schema[r.u][r.n]) schema[r.u][r.n] = { field: r.n, type: pr.type || '', required: !!pr.required, what: pr.description || '' };
  }
  // a header's own field tags (DList convention), in tag order
  const headerFields = {};
  for (const r of await R("MATCH (h:ConceptHeader)-[:HAS_TAG]->(t:NostrEventTag) WHERE t.type IN ['required','recommended','optional','field-type'] "
    + 'RETURN h.uuid AS u, t.type AS k, t.value AS a, t.value1 AS b, t.uuid AS id')) {
    addTo(headerFields, r.u, r);
  }
  const fieldsOf = (u) => {
    const order = (r) => (String(r.id || '').split('_').length >= 3 ? Number(String(r.id).split('_')[1]) : 0);
    const rows = (headerFields[u] || []).slice().sort((x, y) => order(x) - order(y));
    const types = Object.fromEntries(rows.filter((r) => r.k === 'field-type').map((r) => [r.a, r.b || '']));
    return rows.filter((r) => r.k !== 'field-type').map((r) => ({ field: r.a, level: r.k, what: r.b || '', type: types[r.a] || '' }));
  };
  const tagDiff = (mine, theirs) => {
    const by = (tags) => { const o = {}; copiedPart(tags).forEach((x) => addTo(o, x[0], x.slice(1).map(String).join(' · '))); return o; };
    const a = by((mine || {}).tags), c = by((theirs || {}).tags);
    return [...new Set([...Object.keys(a), ...Object.keys(c)])].sort()
      .filter((k) => !sameTags([...(a[k] || [])].sort(), [...(c[k] || [])].sort()))
      .map((k) => ({ tag: k, ours: a[k] || [], theirs: c[k] || [] }));
  };

  const pks = new Set();
  const concepts = ids.map((u) => {
    const h = H[u], pk = u.split(':')[1];
    pks.add(pk);
    const c = {
      id: u, name: h.n, d: u.split(':').slice(2).join(':'), author: pk, state: prov[u] || 'ours',
      description: h.d, core_nodes: !!h.core, system: t.system.has(u), parents: t.parents[u] || [], b: btags[u] || [],
      declared: (btags[u] || []).some((x) => x.self),
      elements: Object.values(byAuthor[u] || {}).reduce((s, n) => s + n, 0), elements_by_author: byAuthor[u] || {},
      fields: fieldsOf(u), schema_fields: Object.values(schema[u] || {}), created_at: h.t, relays: where(u),
    };
    Object.keys(byAuthor[u] || {}).forEach((x) => pks.add(x));
    if (copyOf[u]) {
      const cc = copyOf[u], ce = communityHeads[cc], lev = ownHeads[u];
      c.copy_of = cc;
      c.copy_type = ((btags[u] || []).find((x) => x.target === cc) || {}).type || 'pointer';
      c.copy_matches = ce && lev ? sameTags(copiedPart(lev.tags), copiedPart(ce.tags)) : null;
      c.community_fields = fieldsOfEvent(ce);
      c.copy_diff = ce && lev ? tagDiff(lev, ce) : null;
      c.community_schema_fields = H[cc] ? Object.values(schema[cc] || {}) : null;
      c.community_on_relay = !!ce;
      pks.add(cc.split(':')[1]);
    }
    (btags[u] || []).forEach((x) => { if (!x.self && x.target.split(':').length >= 3) pks.add(x.target.split(':')[1]); });
    return c;
  });

  // elements filed under someone else's concept
  const crossings = (await R("MATCH (e:NostrEvent)-[:HAS_TAG]->(z:NostrEventTag {type:'z'}) WHERE z.value STARTS WITH '39998:' "
    + "AND split(z.value, ':')[1] <> e.pubkey RETURN z.value AS concept, e.pubkey AS author, count(DISTINCT e) AS n")).map((r) => {
    pks.add(r.author); pks.add(r.concept.split(':')[1]);
    return { concept: r.concept, concept_author: r.concept.split(':')[1], element_author: r.author, count: r.n };
  });
  const enumerates = (await R('MATCH (sup:Superset)-[:ENUMERATES]->(p:Property) MATCH (k:ConceptHeader)-[:IS_THE_CONCEPT_FOR]->(sup) '
    + 'MATCH (p)-[:IS_A_PROPERTY_OF*1..3]->(:JSONSchema)-[:IS_THE_JSON_SCHEMA_FOR]->(t:ConceptHeader) '
    + 'RETURN DISTINCT k.uuid AS a, t.uuid AS c, p.name AS f')).map((r) => ({ from: r.a, to: r.c, field: r.f }));

  // on the community relay, not held here
  const here = new Set(ids);
  const onRelay = [];
  for (const [coord, e] of Object.entries(communityHeads)) {
    if (here.has(coord) || coord in cp) continue;
    const tv = (k) => ((e.tags || []).find((x) => x && x[0] === k && x.length > 1) || [])[1] || null;
    onRelay.push({ id: coord, name: tv('names') || tv('name') || coord.split(':').slice(2).join(':'), author: e.pubkey,
      description: tv('description'), created_at: e.created_at,
      points_at: (e.tags || []).filter((x) => x && x[0] === 'b' && x.length > 1 && x[1] !== coord).map((x) => x[1]),
      fields: fieldsOfEvent(e) });
    pks.add(e.pubkey);
  }

  const names = await profileNames([...pks].filter((pk) => pk !== ta));
  const people = Object.fromEntries([...pks].sort().map((pk) => [pk, { name: pk === ta ? 'this instance' : names[pk] || null, is_this_instance: pk === ta }]));
  const byState = {};
  concepts.forEach((c) => { byState[c.state] = (byState[c.state] || 0) + 1; });
  return {
    exported: new Date().toISOString().slice(0, 10),
    instance: { name: location.host, url: location.origin, assistant: ta, own_relay: 'this instance’s relay', community_relay: COMMUNITY, owner: config.ownerPubkey || null },
    counts: { concepts: concepts.length, by_state: byState, copies: Object.keys(copyOf).length,
      declared: concepts.filter((c) => c.declared).length, on_relay_not_here: onRelay.length },
    people, concepts, crossings, enumerates, on_relay: onRelay,
  };
}

export const VERBS = { scopes, scope, node, group, search, path, community };
