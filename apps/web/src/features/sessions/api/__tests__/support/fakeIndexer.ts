import {
  buildSchema,
  execute,
  validate,
  type DocumentNode,
  type GraphQLFieldResolver,
  type OperationDefinitionNode,
} from "graphql";

/**
 * An in-memory stand-in for the indexer's Hasura endpoint over the trade-history tables. It
 * executes whatever document the app sends, honouring Hasura's `where` (`_eq`, `_neq`, `_gt`, `_gte`,
 * `_lt`, `_lte`, `_in`, `_nin`, `_is_null`, `_like`, `_ilike`, `_and`, `_or`, `_not`, object and array
 * relations), `order_by`, `distinct_on`, `limit` and `offset`, so a test pins what the page shows
 * rather than the query it sends.
 *
 * Column names and types follow what Envio's Hasura exposes for `apps/indexer/schema.graphql`: a
 * `BigInt` is `numeric` (served as a string), an `Int` is `Int`, an entity reference is a `<name>_id`
 * column plus an object relation, a `@derivedFrom` field is an array relation. `Swap.sender` is the
 * address an external row shows; it is the field the trade-history issue adds to the indexer.
 *
 * Not pinned against a live Hasura in the unit suite; the fork test reads the real one.
 */

type Column = "String" | "numeric" | "Int" | "Boolean";

interface TableDef {
  columns: Record<string, Column>;
  objects?: Record<string, { table: string; key: string }>;
  arrays?: Record<string, { table: string; foreign: string }>;
}

const TABLES = {
  ChildMarket: {
    columns: {
      id: "String",
      session_id: "String",
      parentOutcomeIndex: "numeric",
      parentOutcome: "String",
      marketName: "String",
      displayName: "String",
      color: "String",
      lowerBound: "numeric",
      upperBound: "numeric",
      downToken: "String",
      upToken: "String",
      invalidToken: "String",
      underlyingToken: "String",
      deployedAt: "numeric",
      transactionHash: "String",
    },
    arrays: {
      pools: { table: "Pool", foreign: "childMarket_id" },
      predictions: { table: "Prediction", foreign: "childMarket_id" },
      tokens: { table: "Token", foreign: "childMarket_id" },
    },
  },
  Executor: {
    columns: { id: "String", owner: "String", deployedAt: "numeric", transactionHash: "String" },
    arrays: {
      predictions: { table: "Prediction", foreign: "executor_id" },
      positions: { table: "Position", foreign: "executor_id" },
    },
  },
  Transfer: {
    columns: {
      id: "String",
      executor_id: "String",
      token: "String",
      amount: "numeric",
      counterparty: "String",
      blockNumber: "numeric",
      timestamp: "numeric",
      transactionHash: "String",
    },
    objects: { executor: { table: "Executor", key: "executor_id" } },
  },
  Position: {
    columns: {
      id: "String",
      executor_id: "String",
      token: "String",
      balance: "numeric",
      updatedAt: "numeric",
    },
    objects: { executor: { table: "Executor", key: "executor_id" } },
  },
  Token: {
    columns: { id: "String", childMarket_id: "String", outcomeIndex: "Int", decimals: "Int", symbol: "String" },
    objects: { childMarket: { table: "ChildMarket", key: "childMarket_id" } },
  },
  Prediction: {
    columns: {
      id: "String",
      executor_id: "String",
      childMarket_id: "String",
      transactionHash: "String",
      blockNumber: "numeric",
      timestamp: "numeric",
      underlyingDelta: "numeric",
      downDelta: "numeric",
      upDelta: "numeric",
      underlyingBalance: "numeric",
      downBalance: "numeric",
      upBalance: "numeric",
      downSwapUnderlying: "numeric",
      downSwapTokens: "numeric",
      upSwapUnderlying: "numeric",
      upSwapTokens: "numeric",
      downAvgPrice: "numeric",
      upAvgPrice: "numeric",
      downPriceBefore: "numeric",
      downPriceAfter: "numeric",
      upPriceBefore: "numeric",
      upPriceAfter: "numeric",
      impliedPrediction: "numeric",
    },
    objects: {
      executor: { table: "Executor", key: "executor_id" },
      childMarket: { table: "ChildMarket", key: "childMarket_id" },
    },
  },
  Pool: {
    columns: {
      id: "String",
      childMarket_id: "String",
      outcomeToken: "String",
      underlyingToken: "String",
      outcomeIndex: "Int",
      outcomeIsToken0: "Boolean",
      price: "numeric",
      tick: "Int",
      underlyingPerOutcome: "numeric",
      liquidity: "numeric",
      volumeOutcome: "numeric",
      volumeUnderlying: "numeric",
      updatedAt: "numeric",
    },
    objects: { childMarket: { table: "ChildMarket", key: "childMarket_id" } },
    arrays: { swaps: { table: "Swap", foreign: "pool_id" } },
  },
  Swap: {
    columns: {
      id: "String",
      pool_id: "String",
      childMarket_id: "String",
      executor_id: "String",
      sender: "String",
      outcomeAmount: "numeric",
      underlyingAmount: "numeric",
      priceBefore: "numeric",
      priceAfter: "numeric",
      tickBefore: "Int",
      tickAfter: "Int",
      underlyingPerOutcomeAfter: "numeric",
      blockNumber: "numeric",
      timestamp: "numeric",
      logIndex: "Int",
      transactionHash: "String",
    },
    objects: {
      pool: { table: "Pool", key: "pool_id" },
      childMarket: { table: "ChildMarket", key: "childMarket_id" },
      executor: { table: "Executor", key: "executor_id" },
    },
  },
} satisfies Record<string, TableDef>;

export type TableName = keyof typeof TABLES;
type Row = Record<string, unknown>;
export type Tables = Partial<Record<TableName, Row[]>>;

const DEFS: Record<string, TableDef> = TABLES;
const COMPARISON_TYPE: Record<Column, string> = {
  String: "String",
  numeric: "numeric",
  Int: "Int",
  Boolean: "Boolean",
};

const comparison = (scalar: string) => `input ${scalar}_comparison_exp {
  _eq: ${scalar} _neq: ${scalar} _gt: ${scalar} _gte: ${scalar} _lt: ${scalar} _lte: ${scalar}
  _in: [${scalar}!] _nin: [${scalar}!] _is_null: Boolean _like: String _ilike: String
}`;

const selectArgs = (table: string) =>
  `(where: ${table}_bool_exp, order_by: [${table}_order_by!], limit: Int, offset: Int, distinct_on: [${table}_select_column!])`;

function sdl(): string {
  const parts = [
    "scalar numeric",
    "enum order_by { asc asc_nulls_first asc_nulls_last desc desc_nulls_first desc_nulls_last }",
    ...["String", "numeric", "Int", "Boolean"].map(comparison),
  ];
  for (const [name, def] of Object.entries(DEFS)) {
    const columns = Object.entries(def.columns);
    const objects = Object.entries(def.objects ?? {});
    const arrays = Object.entries(def.arrays ?? {});
    parts.push(`type ${name} {
      ${columns.map(([col, type]) => `${col}: ${type}`).join("\n")}
      ${objects.map(([field, rel]) => `${field}: ${rel.table}`).join("\n")}
      ${arrays.map(([field, rel]) => `${field}${selectArgs(rel.table)}: [${rel.table}!]!`).join("\n")}
    }`);
    parts.push(`input ${name}_bool_exp {
      _and: [${name}_bool_exp!] _or: [${name}_bool_exp!] _not: ${name}_bool_exp
      ${columns.map(([col, type]) => `${col}: ${COMPARISON_TYPE[type]}_comparison_exp`).join("\n")}
      ${[...objects, ...arrays].map(([field, rel]) => `${field}: ${rel.table}_bool_exp`).join("\n")}
    }`);
    parts.push(`input ${name}_order_by {
      ${columns.map(([col]) => `${col}: order_by`).join("\n")}
      ${objects.map(([field, rel]) => `${field}: ${rel.table}_order_by`).join("\n")}
    }`);
    parts.push(`enum ${name}_select_column { ${columns.map(([col]) => col).join(" ")} }`);
  }
  parts.push(`type query_root {
    ${Object.keys(DEFS)
      .map((name) => `${name}${selectArgs(name)}: [${name}!]!\n${name}_by_pk(id: String!): ${name}`)
      .join("\n")}
  }`);
  parts.push("schema { query: query_root }");
  return parts.join("\n");
}

const schema = buildSchema(sdl());

const toComparable = (type: Column, value: unknown): bigint | number | string | boolean | null => {
  if (value === null || value === undefined) return null;
  if (type === "numeric") return BigInt(String(value));
  if (type === "Int") return Number(value);
  if (type === "Boolean") return Boolean(value);
  return String(value);
};

const likeToRegExp = (pattern: string, flags: string) =>
  new RegExp(
    `^${pattern
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/%/g, ".*")
      .replace(/_/g, ".")}$`,
    flags,
  );

function compare(type: Column, raw: unknown, ops: Record<string, unknown>): boolean {
  const value = toComparable(type, raw);
  return Object.entries(ops).every(([op, operand]) => {
    if (op === "_is_null") return (value === null) === operand;
    if (value === null) return false;
    const rhs = (each: unknown) => toComparable(type, each);
    switch (op) {
      case "_eq":
        return value === rhs(operand);
      case "_neq":
        return value !== rhs(operand);
      case "_gt":
        return value > rhs(operand)!;
      case "_gte":
        return value >= rhs(operand)!;
      case "_lt":
        return value < rhs(operand)!;
      case "_lte":
        return value <= rhs(operand)!;
      case "_in":
        return (operand as unknown[]).some((each) => value === rhs(each));
      case "_nin":
        return !(operand as unknown[]).some((each) => value === rhs(each));
      case "_like":
        return likeToRegExp(String(operand), "").test(String(value));
      case "_ilike":
        return likeToRegExp(String(operand), "i").test(String(value));
      default:
        throw new Error(`The fake indexer does not implement ${op}`);
    }
  });
}

export function createFakeIndexer(initial: Tables) {
  const tables: Tables = { ...initial };
  const rowsOf = (table: string): Row[] => tables[table as TableName] ?? [];

  const related = (table: string, row: Row, field: string): Row | Row[] | null | undefined => {
    const def = DEFS[table]!;
    const object = def.objects?.[field];
    if (object) {
      const key = row[object.key];
      return key == null ? null : (rowsOf(object.table).find((each) => each.id === key) ?? null);
    }
    const array = def.arrays?.[field];
    if (array) return rowsOf(array.table).filter((each) => each[array.foreign] === row.id);
    return undefined;
  };

  function matches(table: string, row: Row, where: Record<string, unknown> | undefined): boolean {
    if (!where) return true;
    const def = DEFS[table]!;
    return Object.entries(where).every(([key, condition]) => {
      if (key === "_and") return (condition as Record<string, unknown>[]).every((each) => matches(table, row, each));
      if (key === "_or") return (condition as Record<string, unknown>[]).some((each) => matches(table, row, each));
      if (key === "_not") return !matches(table, row, condition as Record<string, unknown>);
      const type = def.columns[key];
      if (type) return compare(type, row[key], condition as Record<string, unknown>);
      const relTable = def.objects?.[key]?.table ?? def.arrays?.[key]?.table;
      const value = related(table, row, key);
      const sub = condition as Record<string, unknown>;
      if (Array.isArray(value)) return value.some((each) => matches(relTable!, each, sub));
      return value != null && matches(relTable!, value, sub);
    });
  }

  function orderValue(table: string, row: Row, path: Record<string, unknown>): [unknown, string] {
    const [key, direction] = Object.entries(path)[0]!;
    const def = DEFS[table]!;
    const type = def.columns[key];
    if (type) return [toComparable(type, row[key]), direction as string];
    const object = def.objects?.[key];
    const next = related(table, row, key) as Row | null;
    return next ? orderValue(object!.table, next, direction as Record<string, unknown>) : [null, "asc"];
  }

  function select(table: string, rows: Row[], args: Record<string, unknown>): Row[] {
    let out = rows.filter((row) => matches(table, row, args.where as Record<string, unknown> | undefined));
    const orderBy = ([] as Record<string, unknown>[]).concat((args.order_by as Record<string, unknown>[]) ?? []);
    const keys = orderBy.flatMap((each) => Object.entries(each).map(([k, v]) => ({ [k]: v })));
    if (keys.length > 0) {
      out = [...out].sort((a, b) => {
        for (const key of keys) {
          const [x, direction] = orderValue(table, a, key);
          const [y] = orderValue(table, b, key);
          if (x === y) continue;
          const desc = direction.startsWith("desc");
          const nullsFirst = direction.endsWith("nulls_first") || (desc && !direction.endsWith("nulls_last"));
          if (x === null) return nullsFirst ? -1 : 1;
          if (y === null) return nullsFirst ? 1 : -1;
          return (x! < y! ? -1 : 1) * (desc ? -1 : 1);
        }
        return 0;
      });
    }
    const distinct = args.distinct_on as string[] | undefined;
    if (distinct && distinct.length > 0) {
      const seen = new Set<string>();
      out = out.filter((row) => {
        const key = JSON.stringify(distinct.map((col) => row[col] ?? null));
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    const offset = (args.offset as number | undefined) ?? 0;
    const limit = args.limit as number | undefined;
    return out.slice(offset, limit === undefined || limit === null ? undefined : offset + limit);
  }

  const fieldResolver: GraphQLFieldResolver<unknown, unknown> = (source, args, _context, info) => {
    const field = info.fieldName;
    if (info.parentType.name === "query_root") {
      if (field.endsWith("_by_pk")) {
        const table = field.slice(0, -"_by_pk".length);
        return rowsOf(table).find((row) => row.id === args.id) ?? null;
      }
      return select(field, rowsOf(field), args);
    }
    const table = info.parentType.name;
    const row = source as Row;
    if (DEFS[table]?.columns[field]) return row[field] ?? null;
    const value = related(table, row, field);
    if (Array.isArray(value)) return select(DEFS[table]!.arrays![field]!.table, value, args);
    return value ?? null;
  };

  const rootFields = new Set(Object.keys(DEFS).flatMap((name) => [name, `${name}_by_pk`]));

  return {
    /** Replaces or extends a table, as the indexer does when a new block lands. */
    set(table: TableName, rows: Row[]) {
      tables[table] = rows;
    },
    /** Whether every root field the document asks for is one of this fake's tables. */
    serves(document: DocumentNode): boolean {
      const operation = document.definitions.find(
        (d): d is OperationDefinitionNode => d.kind === "OperationDefinition",
      );
      return (
        operation !== undefined &&
        operation.selectionSet.selections.every(
          (selection) => selection.kind === "Field" && rootFields.has(selection.name.value),
        )
      );
    },
    async answer(document: DocumentNode, variables: Record<string, unknown> | undefined): Promise<unknown> {
      const errors = validate(schema, document);
      if (errors.length > 0) throw new Error(`Fake indexer rejected the query: ${errors.map((e) => e.message)}`);
      const result = await execute({ schema, document, variableValues: variables ?? {}, fieldResolver });
      if (result.errors?.length) throw new Error(`Fake indexer failed: ${result.errors.map((e) => e.message)}`);
      return result.data;
    },
  };
}
