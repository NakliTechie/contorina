// Typed maths for number fields: 2*pi, min(4, 3), 100/3, x+10. No eval.
const FUNCS = {
  min: Math.min, max: Math.max, abs: Math.abs, sqrt: Math.sqrt, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, pow: Math.pow, deg: (r) => (r * 180) / Math.PI, rad: (d) => (d * Math.PI) / 180,
};
const CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

export function evalExpr(src, vars = {}) {
  const toks = String(src).match(/\d*\.\d+(?:e[+-]?\d+)?|\d+(?:e[+-]?\d+)?|[a-z_]\w*|[-+*/%^(),]|\S/gi) || [];
  let i = 0;
  const peek = () => toks[i];
  const take = (t) => { if (toks[i] !== t) throw new Error(`Expected ${t}`); i++; };
  const expr = () => {
    let v = term();
    while (peek() === '+' || peek() === '-') v = toks[i++] === '+' ? v + term() : v - term();
    return v;
  };
  const term = () => {
    let v = unary();
    while (['*', '/', '%'].includes(peek())) {
      const op = toks[i++], r = unary();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  };
  const unary = () => {
    if (peek() === '-') { i++; return -unary(); }
    if (peek() === '+') { i++; return unary(); }
    return power();
  };
  const power = () => {
    const b = primary();
    if (peek() === '^') { i++; return Math.pow(b, unary()); }
    return b;
  };
  const primary = () => {
    const t = toks[i++];
    if (t === undefined) throw new Error('Unexpected end');
    if (t === '(') { const v = expr(); take(')'); return v; }
    if (/^[\d.]/.test(t)) return parseFloat(t);
    const name = t.toLowerCase();
    if (FUNCS[name]) {
      take('(');
      const args = [];
      if (peek() !== ')') { args.push(expr()); while (peek() === ',') { i++; args.push(expr()); } }
      take(')');
      return FUNCS[name](...args);
    }
    if (name in vars) return vars[name];
    if (name in CONSTS) return CONSTS[name];
    throw new Error(`Unknown name ${t}`);
  };
  const v = expr();
  if (i < toks.length) throw new Error(`Unexpected ${toks[i]}`);
  if (!Number.isFinite(v)) throw new Error('Not a finite number');
  return v;
}
