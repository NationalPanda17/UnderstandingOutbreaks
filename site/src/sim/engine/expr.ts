/** Safe rate-expression language for model specs.
 *
 * A tiny arithmetic grammar with a fixed whitelist of functions. Expressions are parsed to an AST and compiled to
 * closures. There is no eval, no Function constructor, no property access, no strings: anything outside the grammar
 * is rejected, so a model spec loaded from a URL or file cannot run arbitrary code.
 */
export type Ast =
  | { k: 'num'; v: number }
  | { k: 'id'; name: string }
  | { k: 'un'; op: '-'; a: Ast }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Ast; b: Ast }
  | { k: 'call'; fn: string; args: Ast[] };

export const FUNCTIONS: Record<string, { arity: [number, number]; f: (...a: number[]) => number; py: string; r: string; tex: string }> = {
  exp: { arity: [1, 1], f: Math.exp, py: 'np.exp', r: 'exp', tex: '\\exp' },
  log: { arity: [1, 1], f: Math.log, py: 'np.log', r: 'log', tex: '\\ln' },
  sqrt: { arity: [1, 1], f: Math.sqrt, py: 'np.sqrt', r: 'sqrt', tex: '\\sqrt' },
  sin: { arity: [1, 1], f: Math.sin, py: 'np.sin', r: 'sin', tex: '\\sin' },
  cos: { arity: [1, 1], f: Math.cos, py: 'np.cos', r: 'cos', tex: '\\cos' },
  abs: { arity: [1, 1], f: Math.abs, py: 'np.abs', r: 'abs', tex: '\\operatorname{abs}' },
  min: { arity: [2, 8], f: Math.min, py: 'min', r: 'min', tex: '\\min' },
  max: { arity: [2, 8], f: Math.max, py: 'max', r: 'max', tex: '\\max' },
  pow: { arity: [2, 2], f: Math.pow, py: 'pow', r: '`^`', tex: '\\operatorname{pow}' },
  /** step(x) = 1 when x >= 0, else 0. Used for time windows. */
  step: { arity: [1, 1], f: (x) => (x >= 0 ? 1 : 0), py: 'step', r: 'step', tex: '\\operatorname{step}' },
};
export const CONSTANTS: Record<string, number> = { pi: Math.PI };
const MAX_LEN = 500;
const MAX_DEPTH = 40;

export class ExprError extends Error {}

export function parseExpr(src: string): Ast {
  if (typeof src !== 'string') throw new ExprError('expression must be a string');
  if (src.length > MAX_LEN) throw new ExprError('expression too long');
  const toks: { t: 'num' | 'id' | 'op'; v: string }[] = [];
  const re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([-+*/^(),]))/y;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw new ExprError(`unexpected character at position ${pos + 1}: "${src.slice(pos, pos + 8).trim()}"`);
    if (m[1] !== undefined) toks.push({ t: 'num', v: m[1] }); else if (m[2] !== undefined) toks.push({ t: 'id', v: m[2] }); else toks.push({ t: 'op', v: m[3] });
    pos = re.lastIndex;
  }
  let i = 0; let depth = 0;
  const peek = () => toks[i];
  const eat = (v?: string) => { const tk = toks[i]; if (!tk || (v !== undefined && tk.v !== v)) throw new ExprError(v ? `expected "${v}"` : 'unexpected end of expression'); i++; return tk; };
  const guard = <T>(fn: () => T): T => { if (++depth > MAX_DEPTH) throw new ExprError('expression nested too deeply'); try { return fn(); } finally { depth--; } };
  const primary = (): Ast => guard(() => {
    const tk = peek();
    if (!tk) throw new ExprError('unexpected end of expression');
    if (tk.t === 'num') { i++; return { k: 'num', v: Number(tk.v) }; }
    if (tk.t === 'id') {
      i++;
      if (peek()?.v === '(') {
        if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, tk.v)) throw new ExprError(`function "${tk.v}" is not allowed`);
        eat('(');
        const args: Ast[] = [];
        if (peek()?.v !== ')') { args.push(sum()); while (peek()?.v === ',') { eat(','); args.push(sum()); } }
        eat(')');
        const [lo, hi] = FUNCTIONS[tk.v].arity;
        if (args.length < lo || args.length > hi) throw new ExprError(`function "${tk.v}" takes ${lo === hi ? lo : `${lo} to ${hi}`} argument(s)`);
        return { k: 'call', fn: tk.v, args };
      }
      return { k: 'id', name: tk.v };
    }
    if (tk.v === '(') { eat('('); const e = sum(); eat(')'); return e; }
    if (tk.v === '-') { eat('-'); return { k: 'un', op: '-', a: power() }; }
    if (tk.v === '+') { eat('+'); return power(); }
    throw new ExprError(`unexpected "${tk.v}"`);
  });
  const power = (): Ast => { const base = primary(); if (peek()?.v === '^') { eat('^'); return { k: 'bin', op: '^', a: base, b: guard(power) }; } return base; };
  const product = (): Ast => { let a = power(); while (peek() && (peek().v === '*' || peek().v === '/')) { const op = eat().v as '*' | '/'; a = { k: 'bin', op, a, b: power() }; } return a; };
  const sum = (): Ast => { let a = product(); while (peek() && (peek().v === '+' || peek().v === '-')) { const op = eat().v as '+' | '-'; a = { k: 'bin', op, a, b: product() }; } return a; };
  const ast = sum();
  if (i < toks.length) throw new ExprError(`unexpected "${toks[i].v}"`);
  return ast;
}

export function identifiers(ast: Ast, out = new Set<string>()): Set<string> {
  if (ast.k === 'id') out.add(ast.name);
  else if (ast.k === 'un') identifiers(ast.a, out);
  else if (ast.k === 'bin') { identifiers(ast.a, out); identifiers(ast.b, out); }
  else if (ast.k === 'call') ast.args.forEach((a) => identifiers(a, out));
  return out;
}

export interface Env { comp: Record<string, number>; param: Record<string, number> }
export type Compiled = (y: ArrayLike<number>, p: ArrayLike<number>, t: number, N: number) => number;

/** Compile to a closure. Identifiers must be a compartment, a parameter, `t`, `N`, or a constant: anything else is rejected. */
export function compileAst(ast: Ast, env: Env): Compiled {
  switch (ast.k) {
    case 'num': { const v = ast.v; return () => v; }
    case 'id': {
      const n = ast.name;
      if (n === 't') return (_y, _p, t) => t;
      if (n === 'N') return (_y, _p, _t, N) => N;
      if (Object.prototype.hasOwnProperty.call(env.comp, n)) { const ix = env.comp[n]; return (y) => y[ix]; }
      if (Object.prototype.hasOwnProperty.call(env.param, n)) { const ix = env.param[n]; return (_y, p) => p[ix]; }
      if (Object.prototype.hasOwnProperty.call(CONSTANTS, n)) { const v = CONSTANTS[n]; return () => v; }
      throw new ExprError(`unknown name "${n}"`);
    }
    case 'un': { const a = compileAst(ast.a, env); return (y, p, t, N) => -a(y, p, t, N); }
    case 'bin': {
      const a = compileAst(ast.a, env); const b = compileAst(ast.b, env);
      switch (ast.op) {
        case '+': return (y, p, t, N) => a(y, p, t, N) + b(y, p, t, N);
        case '-': return (y, p, t, N) => a(y, p, t, N) - b(y, p, t, N);
        case '*': return (y, p, t, N) => a(y, p, t, N) * b(y, p, t, N);
        case '/': return (y, p, t, N) => a(y, p, t, N) / b(y, p, t, N);
        default: return (y, p, t, N) => Math.pow(a(y, p, t, N), b(y, p, t, N));
      }
    }
    default: {
      const f = FUNCTIONS[ast.fn].f; const args = ast.args.map((x) => compileAst(x, env));
      if (args.length === 1) { const a0 = args[0]; return (y, p, t, N) => f(a0(y, p, t, N)); }
      if (args.length === 2) { const a0 = args[0]; const a1 = args[1]; return (y, p, t, N) => f(a0(y, p, t, N), a1(y, p, t, N)); }
      return (y, p, t, N) => f(...args.map((g) => g(y, p, t, N)));
    }
  }
}

const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 };

/** Render as Python or R source (for "copy as code"). `name` maps identifiers to target-language names. */
export function toCode(ast: Ast, lang: 'py' | 'r', name: (id: string) => string, parent = 0): string {
  switch (ast.k) {
    case 'num': return Number.isInteger(ast.v) ? ast.v.toFixed(1) : String(ast.v);
    case 'id': return ast.name === 'pi' ? (lang === 'py' ? 'np.pi' : 'pi') : name(ast.name);
    case 'un': return `(-${toCode(ast.a, lang, name, 3)})`;
    case 'bin': {
      const p = PREC[ast.op];
      const op = ast.op === '^' ? (lang === 'py' ? '**' : '^') : ast.op;
      const s = `${toCode(ast.a, lang, name, p)} ${op} ${toCode(ast.b, lang, name, p + (ast.op === '^' ? 0 : 1))}`;
      return p < parent || ast.op === '^' ? `(${s})` : s;
    }
    default: {
      const args = ast.args.map((a) => toCode(a, lang, name, 0));
      if (ast.fn === 'step') return lang === 'py' ? `(1.0 if ${args[0]} >= 0 else 0.0)` : `as.numeric(${args[0]} >= 0)`;
      if (ast.fn === 'pow') return `(${args[0]}) ${lang === 'py' ? '**' : '^'} (${args[1]})`;
      return `${lang === 'py' ? FUNCTIONS[ast.fn].py : FUNCTIONS[ast.fn].r}(${args.join(', ')})`;
    }
  }
}

/** Render as LaTeX. `sym` maps identifiers to LaTeX symbols. */
export function toTex(ast: Ast, sym: (id: string) => string, parent = 0): string {
  switch (ast.k) {
    case 'num': return String(ast.v);
    case 'id': return ast.name === 'pi' ? '\\pi' : sym(ast.name);
    case 'un': return `-${toTex(ast.a, sym, 3)}`;
    case 'bin': {
      if (ast.op === '/') return `\\frac{${toTex(ast.a, sym, 0)}}{${toTex(ast.b, sym, 0)}}`;
      if (ast.op === '^') return `{${toTex(ast.a, sym, 5)}}^{${toTex(ast.b, sym, 0)}}`;
      const p = PREC[ast.op];
      const s = `${toTex(ast.a, sym, p)} ${ast.op === '*' ? '\\,' : ast.op} ${toTex(ast.b, sym, p + 1)}`;
      return p < parent ? `\\left(${s}\\right)` : s;
    }
    default: return ast.fn === 'sqrt' ? `\\sqrt{${toTex(ast.args[0], sym, 0)}}` : `${FUNCTIONS[ast.fn].tex}\\left(${ast.args.map((a) => toTex(a, sym, 0)).join(', ')}\\right)`;
  }
}
