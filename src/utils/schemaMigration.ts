import { CURRENT_SCHEMA_VERSION, LEGACY_SCHEMA_VERSION } from '../types/sql';
import { LEGACY_DATABASE } from '../data/mockDatabase';

/**
 * 数据源结构升级规则（v1 → v2）。
 * - moved: 字段迁移到其他表，单表查询无法自动改写（无同表后继）
 * - split: 字段拆分为多列，取默认后继列生成草稿
 * - added: 新增列，对旧查询无影响
 */
export type ChangeKind = 'moved' | 'split' | 'added';

export interface ColumnChangeRule {
  table: string;
  column: string;
  kind: ChangeKind;
  /** 后继字段（moved 时指向其他表的字段） */
  successor?: string;
  /** 拆分后的字段（split） */
  into?: string[];
  /** 拆分时默认取的后继字段（用于生成改写草稿） */
  defaultSuccessor?: string;
  reason: string;
}

export const SCHEMA_CHANGE_RULES: ColumnChangeRule[] = [
  {
    table: 'orders',
    column: 'customer_name',
    kind: 'moved',
    successor: 'customers.customer_name',
    reason:
      'orders.customer_name 已并入 customers 表，订单明细不再冗余客户名称；需要关联 customers 表取数，单表查询无法自动改写。',
  },
  {
    table: 'orders',
    column: 'amount',
    kind: 'split',
    into: ['amount_cny', 'amount_usd'],
    defaultSuccessor: 'amount_cny',
    reason:
      'orders.amount 已拆分为 amount_cny（人民币）与 amount_usd（美元）两列；草稿默认取人民币列，若原合同以美元结算请改用 amount_usd。',
  },
  {
    table: 'customers',
    column: 'region_code',
    kind: 'added',
    reason: 'customers 新增 region_code（区域编码）列，对旧查询无影响。',
  },
];

export interface SchemaColumnDiff {
  table: string;
  column: string;
  kind: ChangeKind;
  detail: string;
}

export function diffSchemaVersions(): SchemaColumnDiff[] {
  return SCHEMA_CHANGE_RULES.map((rule) => ({
    table: rule.table,
    column: rule.column,
    kind: rule.kind,
    detail: rule.reason,
  }));
}

export interface QueryMigrationAnalysis {
  table: string | null;
  status: 'rewritable' | 'pending' | 'unchanged';
  draftSql: string | null;
  changes: Array<{ column: string; message: string; kind: ChangeKind }>;
  blockers: Array<{ column: string; reason: string }>;
}

/**
 * 逐条对照新旧结构，分析单条查询：
 * - 有后继可改写 → status 'rewritable'，给出改写草稿
 * - 无后继或 SELECT * 悄悄少列 → status 'pending'，写清原因
 * - 不涉及变更 → status 'unchanged'
 */
export function analyzeQuerySql(sql: string): QueryMigrationAnalysis {
  const normalized = sql.trim().replace(/;+\s*$/, '');
  const tableMatch = normalized.match(/\bfrom\s+([a-zA-Z_][\w]*)/i);
  const tableName = tableMatch?.[1] ?? null;
  const table = tableName
    ? LEGACY_DATABASE.tables.find((item) => item.name.toLowerCase() === tableName.toLowerCase())
    : undefined;

  if (!table) {
    return { table: tableName, status: 'unchanged', draftSql: null, changes: [], blockers: [] };
  }

  const refs = new Set<string>();
  let hasStar = false;

  // SELECT 投影字段
  const selectMatch = normalized.match(/\bselect\s+([\s\S]+?)\s+from\s+/i);
  if (selectMatch) {
    selectMatch[1].split(',').forEach((part) => {
      const item = part.trim();
      if (item === '*' || /\.\s*\*$/.test(item)) {
        hasStar = true;
        return;
      }
      const match = item.match(
        /^(?:[a-zA-Z_][\w]*\s*\.\s*)?([a-zA-Z_][\w]*)(?:\s+as\s+[a-zA-Z_][\w]*)?$/i,
      );
      if (match) refs.add(match[1].toLowerCase());
    });
  }

  // WHERE / ORDER BY 中引用的字段（以 v1 字段名做词边界匹配）
  const fromMatch = normalized.match(/\bfrom\s+/i);
  const afterFrom = fromMatch ? normalized.slice(fromMatch.index) : normalized;
  table.columns.forEach((column) => {
    if (new RegExp(`\\b${column.name}\\b`, 'i').test(afterFrom)) {
      refs.add(column.name.toLowerCase());
    }
  });

  const changes: QueryMigrationAnalysis['changes'] = [];
  const blockers: QueryMigrationAnalysis['blockers'] = [];
  const replacements: Array<{ from: string; to: string }> = [];

  refs.forEach((ref) => {
    const rule = SCHEMA_CHANGE_RULES.find(
      (item) => item.table === table.name && item.column.toLowerCase() === ref,
    );
    if (!rule) return;
    if (rule.kind === 'moved') {
      blockers.push({ column: ref, reason: rule.reason });
    } else if (rule.kind === 'split') {
      if (rule.defaultSuccessor) {
        changes.push({ column: ref, message: rule.reason, kind: rule.kind });
        replacements.push({ from: ref, to: rule.defaultSuccessor });
      } else {
        blockers.push({ column: ref, reason: rule.reason });
      }
    }
  });

  if (hasStar) {
    blockers.push({
      column: '*',
      reason:
        'SELECT * 展开的列已变化：customer_name 已移除、amount 已拆分为 amount_cny / amount_usd，继续执行会悄悄少列，请改为显式字段列表。',
    });
  }

  if (blockers.length > 0) {
    return { table: table.name, status: 'pending', draftSql: null, changes, blockers };
  }
  if (replacements.length > 0) {
    let draft = normalized;
    replacements.forEach(({ from, to }) => {
      draft = draft.replace(new RegExp(`\\b${from}\\b`, 'gi'), to);
    });
    return { table: table.name, status: 'rewritable', draftSql: `${draft};`, changes, blockers: [] };
  }
  return { table: table.name, status: 'unchanged', draftSql: null, changes: [], blockers: [] };
}

export function schemaVersionLabel(version: string): string {
  if (version === CURRENT_SCHEMA_VERSION) return `${version} 当前结构`;
  if (version === LEGACY_SCHEMA_VERSION) return `${version} 旧结构`;
  return version;
}
