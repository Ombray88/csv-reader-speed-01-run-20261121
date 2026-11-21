// Fast, dependency-free ES module exporting run(input) matching csv-reader 1.0.0 semantics.

const COMMA = 'comma';
const LINE_BREAK = 'line break';
const END = 'end';

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const hasCR = text.indexOf('\r') !== -1;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (len > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  function appendSpanWithNewlines(valueRef, endIdx) {
    let p = pos;
    let val = valueRef.val;
    while (p < endIdx) {
      const nextN = text.indexOf('\n', p);
      const nextR = text.indexOf('\r', p);
      let nextNL = -1;
      if (nextN !== -1 && nextN < endIdx) nextNL = nextN;
      if (nextR !== -1 && nextR < endIdx && (nextNL === -1 || nextR < nextNL)) {
        val += text.slice(p, nextR) + '\n';
        line += 1;
        p = text.charCodeAt(nextR + 1) === 10 ? nextR + 2 : nextR + 1;
      } else if (nextNL !== -1) {
        val += text.slice(p, nextNL) + '\n';
        line += 1;
        p = nextNL + 1;
      } else {
        val += text.slice(p, endIdx);
        p = endIdx;
        break;
      }
    }
    valueRef.val = val;
    pos = endIdx;
  }

  function readUnquoted(initialValue = '') {
    let value = initialValue;
    while (pos < len) {
      const nextComma = text.indexOf(',', pos);
      const nextLf = text.indexOf('\n', pos);
      const nextCr = hasCR ? text.indexOf('\r', pos) : -1;

      let next = len;
      if (nextComma !== -1 && nextComma < next) next = nextComma;
      if (nextLf !== -1 && nextLf < next) next = nextLf;
      if (nextCr !== -1 && nextCr < next) next = nextCr;

      if (next === len) {
        value += text.slice(pos, len);
        pos = len;
        return { value, ended: END };
      }

      if (next === nextComma) {
        value += text.slice(pos, nextComma);
        pos = nextComma + 1;
        return { value, ended: COMMA };
      }

      if (next === nextLf) {
        value += text.slice(pos, nextLf);
        pos = nextLf + 1;
        line += 1;
        return { value, ended: LINE_BREAK };
      }

      // next === nextCr
      if (text.charCodeAt(next + 1) === 10) {
        value += text.slice(pos, next);
        pos = next + 2;
        line += 1;
        return { value, ended: LINE_BREAK };
      } else {
        value += text.slice(pos, next);
        error('stray_cr');
        pos = next + 1;
      }
    }
    return { value, ended: END };
  }

  function readQuoted() {
    const open = pos;
    const openLine = line;
    const valueRef = { val: '' };
    pos += 1; // skip opening quote
    let closed = false;

    while (pos < len) {
      const qIdx = text.indexOf('"', pos);
      if (qIdx === -1) {
        appendSpanWithNewlines(valueRef, len);
        break;
      }

      if (text.charCodeAt(qIdx + 1) === 34) {
        appendSpanWithNewlines(valueRef, qIdx);
        valueRef.val += '"';
        pos = qIdx + 2;
        continue;
      } else {
        appendSpanWithNewlines(valueRef, qIdx);
        pos = qIdx + 1; // skip closing quote
        closed = true;
        break;
      }
    }

    if (!closed) {
      pos = open + 1;
      line = openLine;
      error('unterminated_quote');
      return readUnquoted('"');
    }

    const value = valueRef.val;
    if (pos >= len) return { value, ended: END };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value, ended: COMMA };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK };
    }

    const lenBeforeJunk = value.length;
    const junk = readUnquoted(value);
    if (junk.value.length - lenBeforeJunk > 0) error('quote_junk');
    return junk;
  }

  while (true) {
    while (pos < len) {
      const code = text.charCodeAt(pos);
      if (code === 10) {
        pos += 1;
        line += 1;
      } else if (code === 13) {
        if (text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
        } else {
          break;
        }
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted();
      fields.push(field.value);
    } while (field.ended === COMMA);

    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
