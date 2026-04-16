// Tiny expression tree for WHERE clauses. The query builder constructs these
// from column references; we then render them to a parameterised SQL fragment.
//
// We intentionally keep this small for v0.1 — eq, ne, gt, gte, lt, lte, like,
// in, isNull, and, or, not. Anything fancier than this should drop to db.sql`...`.

import { kColumn, type ColumnDef } from './schema/index.js'
import { quoteIdent } from './ddl.js'

export type Expr =
  | { kind: 'binop'; op: string; col: string; value: unknown }
  | { kind: 'isnull'; col: string; negate: boolean }
  | { kind: 'in'; col: string; values: unknown[] }
  | { kind: 'and' | 'or'; parts: Expr[] }
  | { kind: 'not'; expr: Expr }

// User-facing column wrapper exposing comparison helpers. We can't extend the
// ColumnDef itself because we want a separate, nicer API surface for query
// building (and to leave room for future operators without polluting schema).
export interface ColumnRef<T = unknown> {
  eq(value: T): Expr
  ne(value: T): Expr
  gt(value: T): Expr
  gte(value: T): Expr
  lt(value: T): Expr
  lte(value: T): Expr
  like(pattern: string): Expr
  in(values: T[]): Expr
  isNull(): Expr
  isNotNull(): Expr
}

export function colRef<T>(col: ColumnDef<T>): ColumnRef<T> {
  const name = col[kColumn].name
  return {
    eq: (v) => ({ kind: 'binop', op: '=', col: name, value: v }),
    ne: (v) => ({ kind: 'binop', op: '!=', col: name, value: v }),
    gt: (v) => ({ kind: 'binop', op: '>', col: name, value: v }),
    gte: (v) => ({ kind: 'binop', op: '>=', col: name, value: v }),
    lt: (v) => ({ kind: 'binop', op: '<', col: name, value: v }),
    lte: (v) => ({ kind: 'binop', op: '<=', col: name, value: v }),
    like: (p) => ({ kind: 'binop', op: 'LIKE', col: name, value: p }),
    in: (vs) => ({ kind: 'in', col: name, values: vs }),
    isNull: () => ({ kind: 'isnull', col: name, negate: false }),
    isNotNull: () => ({ kind: 'isnull', col: name, negate: true }),
  }
}

export function and(...parts: Expr[]): Expr {
  return { kind: 'and', parts }
}
export function or(...parts: Expr[]): Expr {
  return { kind: 'or', parts }
}
export function not(expr: Expr): Expr {
  return { kind: 'not', expr }
}

// Render an expression to SQL + bound parameters. We use positional `?`
// placeholders because better-sqlite3's prepared-statement API binds by index.
export function renderExpr(expr: Expr): { sql: string; params: unknown[] } {
  const params: unknown[] = []
  const sql = render(expr, params)
  return { sql, params }
}

function render(expr: Expr, params: unknown[]): string {
  switch (expr.kind) {
    case 'binop':
      params.push(expr.value)
      return `${quoteIdent(expr.col)} ${expr.op} ?`
    case 'isnull':
      return `${quoteIdent(expr.col)} IS ${expr.negate ? 'NOT ' : ''}NULL`
    case 'in': {
      if (expr.values.length === 0) return '0' // empty IN matches nothing
      const placeholders = expr.values.map((v) => {
        params.push(v)
        return '?'
      })
      return `${quoteIdent(expr.col)} IN (${placeholders.join(', ')})`
    }
    case 'and':
      if (expr.parts.length === 0) return '1'
      return `(${expr.parts.map((p) => render(p, params)).join(' AND ')})`
    case 'or':
      if (expr.parts.length === 0) return '0'
      return `(${expr.parts.map((p) => render(p, params)).join(' OR ')})`
    case 'not':
      return `NOT (${render(expr.expr, params)})`
  }
}
