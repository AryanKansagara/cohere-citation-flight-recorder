const start = version => ({ type: 'message-start', answer_version: version, offset_unit: 'unicode-code-points' });
const delta = (version, text) => ({ type: 'content-delta', answer_version: version, delta: { message: { content: { text } } } });
const end = version => ({ type: 'message-end', answer_version: version });
export const citation = (version, id, start, text, sources) => ({ type: 'citation-start', answer_version: version,
  delta: { message: { citations: { id, start, end: start + [...text].length, text,
    sources: sources.map(([id, source_version]) => ({ type: 'document', id, source_version })) } } } });
export function fixture() {
  const sources = [
    { id: 'menu', version: 'v1', content: 'Café ☕ serves tea.' },
    { id: 'menu', version: 'v2', content: 'Café ☕ is temporarily closed.' },
    { id: 'science', version: 'v1', content: 'The Moon is a rocky natural satellite.' },
  ];
  const events = [start('answer-v1'), delta('answer-v1', '🧭 '),
    // Citation can precede the rest of its text; validation waits for answer end.
    citation('answer-v1', 'cafe', 2, 'Café ☕ serves tea.', [['menu', 'v1']]),
    delta('answer-v1', 'Café ☕ '), delta('answer-v1', 'serves tea. '),
    delta('answer-v1', 'The Moon is cheese.'),
    citation('answer-v1', 'moon', 21, 'The Moon is cheese.', [['science', 'v1']]), end('answer-v1'),
    start('answer-v2'), delta('answer-v2', 'UPDATE: 🧭 Café ☕ serves tea.'),
    // Stale offsets copied after an edit: source still exists, span is wrong.
    citation('answer-v2', 'copied', 2, 'Café ☕ serves tea.', [['menu', 'v1']]),
    citation('answer-v2', 'missing', 10, 'Café ☕ serves tea.', [['menu', 'missing']]), end('answer-v2')];
  return { sources, events, labels: { 'answer-v1/cafe': 'supported', 'answer-v1/moon': 'unsupported' } };
}
