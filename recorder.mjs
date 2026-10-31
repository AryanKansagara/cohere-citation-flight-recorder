import { createHash } from 'node:crypto';

const hash = text => createHash('sha256').update(text).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.isWellFormed();
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,80}$/.test(value);
export class ContractError extends Error {}

/** Sources and answer revisions are local immutable identifiers, not Cohere guarantees. */
export class Recorder {
  #sources = new Map();
  #answers = new Map();
  #current;
  #events = 0;
  addSource(id, version, content) {
    if (!identifier(id) || !identifier(version) || !text(content) || Buffer.byteLength(content) > 65536)
      throw new ContractError('Invalid source version');
    const key = `${id}/${version}`;
    const prior = this.#sources.get(key);
    if (prior && prior.content !== content) throw new ContractError('Immutable source version conflict');
    this.#sources.set(key, Object.freeze({ id, version, content, sha256: hash(content) }));
  }
  accept(event) {
    if (++this.#events > 10000 || !plain(event) || !identifier(event.answer_version))
      throw new ContractError('Invalid or excessive stream events');
    const version = event.answer_version;
    if (event.type === 'message-start') {
      if (this.#current || this.#answers.has(version) || event.offset_unit !== 'unicode-code-points')
        throw new ContractError('Answer version conflict or unsupported offset contract');
      this.#current = { version, text: '', citations: [], ended: false };
      this.#answers.set(version, this.#current);
      return;
    }
    if (!this.#current || this.#current.version !== version || this.#current.ended)
      throw new ContractError('Event outside its active answer version');
    if (event.type === 'content-delta') {
      const delta = event.delta?.message?.content?.text;
      if (!text(delta) || Buffer.byteLength(this.#current.text + delta) > 131072)
        throw new ContractError('Invalid or oversized content delta');
      this.#current.text += delta;
    } else if (event.type === 'citation-start') {
      const citation = event.delta?.message?.citations;
      if (!plain(citation) || !identifier(citation.id) || !Number.isSafeInteger(citation.start)
          || !Number.isSafeInteger(citation.end) || citation.start < 0 || citation.end <= citation.start
          || !text(citation.text) || !Array.isArray(citation.sources) || !citation.sources.length
          || citation.sources.length > 16 || this.#current.citations.length >= 1000
          || !citation.sources.every(s => plain(s) && identifier(s.id) && identifier(s.source_version)))
        throw new ContractError('Invalid citation shape');
      if (this.#current.citations.some(c => c.id === citation.id))
        throw new ContractError('Duplicate citation identifier');
      // Copy caller data: external mutations cannot rewrite an accepted citation.
      this.#current.citations.push(structuredClone(citation));
    } else if (event.type === 'message-end') {
      this.#current.ended = true;
      this.#current = undefined;
    } else throw new ContractError('Unsupported stream event');
  }
  report(labels = {}) {
    if (!plain(labels)) throw new ContractError('Invalid fixture support labels');
    const answers = [...this.#answers.values()].map(answer => {
      const points = [...answer.text];
      const citations = answer.citations.map(citation => {
        const errors = [];
        if (!answer.ended) errors.push('answer_incomplete');
        if (citation.end > points.length) errors.push('span_out_of_bounds');
        else if (points.slice(citation.start, citation.end).join('') !== citation.text) errors.push('span_text_mismatch');
        const sources = citation.sources.map(source => {
          const stored = this.#sources.get(`${source.id}/${source.source_version}`);
          if (!stored) errors.push('dangling_source_version');
          return { id: source.id, version: source.source_version, resolved: Boolean(stored), sha256: stored?.sha256 ?? null };
        });
        const support = labels[`${answer.version}/${citation.id}`] ?? 'unreviewed';
        if (!['supported', 'unsupported', 'unreviewed'].includes(support))
          throw new ContractError('Invalid fixture support label');
        return { id: citation.id, start: citation.start, end: citation.end, cited_text: citation.text,
          structurally_valid: errors.length === 0, structural_errors: [...new Set(errors)], sources,
          semantic_support: support, semantic_support_method: 'authored_fixture_label_not_model_judgment' };
      });
      return { version: answer.version, text: answer.text, sha256: hash(answer.text), ended: answer.ended,
        code_points: points.length, utf16_units: answer.text.length, citations };
    });
    return { schema_version: 1, provenance: 'authored_fixture_not_live_cohere', offset_unit: 'unicode-code-points',
      events: this.#events, answers, structurally_invalid: answers.flatMap(a => a.citations).filter(c => !c.structurally_valid).length,
      unsupported_fixture_labels: answers.flatMap(a => a.citations).filter(c => c.semantic_support === 'unsupported').length,
      limits: 'Structural integrity does not establish factual support; source/answer version fields and offset contract are local fixture extensions.' };
  }
}

/** Actual incremental UTF-8/NDJSON decoding, including byte-split emoji. */
export async function replay(chunks, sources, labels = {}) {
  const recorder = new Recorder();
  for (const source of sources) recorder.addSource(source.id, source.version, source.content);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '', bytes = 0;
  const consume = () => {
    let newline;
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (!line) continue;
      // Enforce the byte bound before parsing complete lines too. Otherwise a
      // whole oversized line succeeds while smaller transport chunks reject it.
      if (Buffer.byteLength(line) > 262144) throw new ContractError('Oversized event line');
      try { recorder.accept(JSON.parse(line)); }
      catch (error) { if (error instanceof ContractError) throw error; throw new ContractError('Invalid JSON event'); }
    }
    if (Buffer.byteLength(pending) > 262144) throw new ContractError('Oversized event line');
  };
  try {
    for await (const chunk of chunks) {
      if (!(chunk instanceof Uint8Array) || (bytes += chunk.byteLength) > 2_000_000)
        throw new ContractError('Invalid or oversized wire stream');
      pending += decoder.decode(chunk, { stream: true });
      consume();
    }
    pending += decoder.decode();
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw new ContractError('Malformed UTF-8 stream');
  }
  if (pending.trim()) throw new ContractError('Truncated NDJSON event');
  return recorder.report(labels);
}

export function wire(events) { return Buffer.from(events.map(e => JSON.stringify(e)).join('\n') + '\n'); }
export function chunks(bytes, size) {
  if (!Number.isSafeInteger(size) || size < 1) throw new ContractError('Invalid chunk size');
  return Array.from({ length: Math.ceil(bytes.length / size) }, (_, i) => bytes.subarray(i * size, (i + 1) * size));
}
