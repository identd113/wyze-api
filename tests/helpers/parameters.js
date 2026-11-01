/**
 * The parameter list of a function, read from its source: one entry per parameter, in order.
 * A default value is dropped (`a = 1` is `a`), a rest parameter keeps its dots, and an options object
 * (`{ a, b = 2 }`) becomes `{a,b}` so the names of the options can be compared too.
 */
function parametersOf(fn) {
  const source = fn.toString();
  const start = source.indexOf("(");
  if (start === -1) return [];
  const params = [];
  let depth = 0;
  let current = "";
  let quote = null;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      current += ch;
      if (ch === "\\") current += source[++i] ?? "";
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; current += ch; continue; }
    if (ch === "(" || ch === "{" || ch === "[") {
      depth += 1;
      if (depth === 1 && ch === "(") continue; // the opening parenthesis of the list itself
      current += ch;
      continue;
    }
    if (ch === ")" || ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) { if (current.trim()) params.push(current); return params.map(normalize); }
      current += ch;
      continue;
    }
    if (ch === "," && depth === 1) { params.push(current); current = ""; continue; }
    current += ch;
  }
  return params.map(normalize);
}

function normalize(text) {
  const trimmed = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").trim();
  if (trimmed.startsWith("{")) {
    // an options object: keep the option names, drop their defaults
    let depth = 0; let end = 0;
    for (let i = 0; i < trimmed.length; i += 1) {
      if (trimmed[i] === "{") depth += 1;
      if (trimmed[i] === "}") { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    const inner = trimmed.slice(1, end);
    const keys = [];
    let level = 0; let part = "";
    for (const ch of inner + ",") {
      if ("{[(".includes(ch)) level += 1;
      if ("}])".includes(ch)) level -= 1;
      if (ch === "," && level === 0) { const key = part.split("=")[0].split(":")[0].trim(); if (key) keys.push(key); part = ""; } else part += ch;
    }
    return `{${keys.join(",")}}`;
  }
  const name = trimmed.split("=")[0].trim();
  return name;
}

module.exports = { parametersOf };
