import { validateQuery } from './mockDatabase';
import type {
  ColumnRef,
  ColumnRefLocation,
  FieldLineage,
  QueryAnalysis,
} from '../types/sql';

/**
 * v1 -> v2 字段血缘表（本周结构变更）
 * 1. orders.customer_name 并入 customers
 * 2. orders.amount 拆为 amount_cny / amount_usd
 * 3. customers 新增 region_code
 * 4. orders.channel 下线，无后继
 */
export const LINEAGE_V1_V2: FieldLineage[] = [
  {
    oldTable: 'orders',
    oldColumn: 'customer_name',
    kind: 'moved',
    successors: [{ table: 'customers', column: 'customer_name' }],
    joinWith: 'orders.customer_id = customers.customer_id',
    note: '客户名称已并入 customers 表，订单表改为 customer_id 关联，草稿按两表关联改写。',
  },
  {
    oldTable: 'orders',
    oldColumn: 'amount',
    kind: 'split',
    successors: [
      { table: 'orders', column: 'amount_cny' },
      { table: 'orders', column: 'amount_usd' },
    ],
    note: '金额已拆为 amount_cny（人民币）与 amount_usd（美元）两列；筛选/排序条件默认改写为 amount_cny，若原口径为美元请手工改为 amount_usd。',
  },
  {
    oldTable: 'customers',
    oldColumn: 'region',
    kind: 'renamed',
    successors: [{ table: 'customers', column: 'region_code' }],
    note: '若查询需要的是区域编码，可使用新增字段 region_code（REGIONS 中文名 region 仍然保留）。',
  },
  {
    oldTable: 'orders',
    oldColumn: 'channel',
    kind: 'removed',
    reason: 'orders.channel 在 v2 已下线，且没有后继字段；请与数据仓库确认该维度是否迁移到其他表或彻底废弃后，再手工处理该查询。',
  },
];

/** 结构版本清单与变更摘要，供界面展示 */
export const SCHEMA_CHANGELOG: Record<string, { from: string; to: string; summary: string[] }> = {
  'v1->v2': {
    from: 'v1',
    to: 'v2',
    summary: [
      'orders.customer_name 客户名称并入 customers 表，orders 改为 customer_id 关联',
      'orders.amount 金额拆分为 amount_cny（人民币）与 amount_usd（美元）两列',
      'customers 新增 region_code 区域编码',
      'orders.channel 下线（无后继字段）',
    ],
  },
};

export function getLineage(fromVersion: string, toVersion: string): FieldLineage[] {
  if (fromVersion === 'v1' && toVersion === 'v2') return LINEAGE_V1_V2;
  return [];
}

interface RawSegments {
  selectPart: string;
  fromTable: string;
  wherePart?: string;
  orderPart?: string;
  limitPart?: string;
}

const STMT_RE =
  /^select\s+([\s\S]+?)\s+from\s+([a-zA-Z_][\w]*)(?:\s+where\s+([\s\S]+?))?(?:\s+order\s+by\s+(.+?))?(?:\s+limit\s+(\d+))?\s*;?$/i;

function parseSegments(sql: string): RawSegments | null {
  const match = sql.trim().replace(/;+\s*$/, '').match(STMT_RE);
  if (!match) return null;
  return {
    selectPart: match[1].trim(),
    fromTable: match[2],
    wherePart: match[3]?.trim(),
    orderPart: match[4]?.trim().replace(/;+\s*$/, '').trim(),
    limitPart: match[5]?.trim(),
  };
}

/** 提取一条 SQL 对受影响表的字段引用位置（只识别简单 SELECT 形态，覆盖本工作台引擎） */
export function analyzeQuery(
  sql: string,
  fromVersion: string,
  toVersion: string,
): QueryAnalysis {
  const lineage = getLineage(fromVersion, toVersion);
  const segments = parseSegments(sql);
  if (!segments) {
    return { table: null, parsed: false, star: false, refs: [], changes: [], affected: false };
  }

  const tableName = segments.fromTable;
  const star = /^\*\s*$/.test(segments.selectPart) || /(^|,\s*)\*(,|$)/.test(segments.selectPart);
  const refs: ColumnRef[] = [];
  const addRef = (column: string, location: ColumnRefLocation) => {
    const existing = refs.find((ref) => ref.column.toLowerCase() === column.toLowerCase());
    if (existing) {
      if (!existing.locations.includes(location)) existing.locations.push(location);
    } else {
      refs.push({ column, locations: [location] });
    }
  };

  // SELECT 字段
  segments.selectPart
    .split(',')
    .map((part) => part.trim().match(/^([a-zA-Z_][\w]*|\*)/)?.[1] ?? '')
    .filter((name) => name && name !== '*')
    .forEach((name) => addRef(name, 'select'));

  // WHERE / ORDER BY 中的字段名（运算符左侧标识）
  if (segments.wherePart) {
    const fieldRe = /(?:^|and\s+|or\s+|[(]\s*)([a-zA-Z_][\w]*)\s*(?:=|!=|<>|>=|<=|>|<|like|in)/gi;
    let match: RegExpExecArray | null;
    while ((match = fieldRe.exec(segments.wherePart)) !== null) {
      addRef(match[1], 'where');
    }
  }
  if (segments.orderPart) {
    const orderField = segments.orderPart.match(/^([a-zA-Z_][\w]*)/)?.[1];
    if (orderField) addRef(orderField, 'order');
  }

  const changes = lineage.filter(
    (change) =>
      change.oldTable.toLowerCase() === tableName.toLowerCase() &&
      (star ||
        refs.some((ref) => ref.column.toLowerCase() === change.oldColumn.toLowerCase())),
  );

  // SELECT * 在新结构下会“悄悄少一列/多一列”，同样受影响
  const affected = changes.length > 0 || (star && lineage.some((c) => c.oldTable.toLowerCase() === tableName.toLowerCase()));

  return { table: tableName, parsed: true, star, refs, changes, affected };
}

/** 仅当查询显式引用了无后继字段时才留在待处理；SELECT * 只是隐式丢列，可给展开草稿 */
function explicitRemoved(analysis: QueryAnalysis): FieldLineage[] {
  return analysis.changes.filter(
    (change) =>
      (change.kind === 'removed' || !change.successors?.length) &&
      (analysis.star
        ? false
        : analysis.refs.some((ref) => ref.column.toLowerCase() === change.oldColumn.toLowerCase())),
  );
}

/** 仅在标识符 token 上做替换，避免误伤字符串字面量与子串 */
function replaceIdentifier(segment: string, from: string, to: string): string {
  return segment.replace(
    new RegExp(`(^|[\\s(,=<>!])${from}(?=$|[\\s),=<>!])`, 'gi'),
    (full, prefix: string) => `${prefix}${to}`,
  );
}

export interface DraftResult {
  draftSql: string | null;
  status: 'draft' | 'pending';
  notes: string[];
  reasons: string[];
}

/**
 * 逐条对照新旧结构生成改写草稿：
 * - 有后继：给出改写草稿（可在确认前编辑）+ 改写说明
 * - 无后继：返回 null 草稿，留在待处理并写清原因
 */
export function buildMigrationDraft(
  sql: string,
  fromVersion: string,
  toVersion: string,
): DraftResult {
  const analysis = analyzeQuery(sql, fromVersion, toVersion);
  if (!analysis.parsed || !analysis.table) {
    return {
      draftSql: null,
      status: 'pending',
      notes: [],
      reasons: ['该查询无法按当前支持的 SELECT 语法解析，需要人工改写，原文已保留。'],
    };
  }

  const segments = parseSegments(sql);
  if (!segments) {
    return { draftSql: null, status: 'pending', notes: [], reasons: ['无法解析查询结构，需要人工改写。'] };
  }

  const removed = explicitRemoved(analysis);
  if (removed.length > 0) {
    return {
      draftSql: null,
      status: 'pending',
      notes: [],
      reasons: removed.map(
        (change) =>
          `字段 ${change.oldTable}.${change.oldColumn} 无后继：${change.reason ?? '该字段在新版本中没有对应字段。'}`,
      ),
    };
  }

  const notes: string[] = [];
  let selectPart = segments.selectPart;
  let wherePart = segments.wherePart;
  let orderPart = segments.orderPart;

  // 1) 金额拆分：投影列拆成两列；筛选/排序默认改 amount_cny 并提示口径
  const amountChange = analysis.changes.find((change) => change.kind === 'split');
  if (amountChange) {
    if (analysis.star) {
      notes.push('SELECT * 已展开为 v2 字段列表：金额列包含 amount_cny、amount_usd，不再包含已下线的 customer_name、channel。');
    } else {
      const amountRef = analysis.refs.find((ref) => ref.column.toLowerCase() === 'amount');
      if (amountRef?.locations.includes('select')) {
        selectPart = selectPart
          .split(',')
          .map((part) => {
            const trimmed = part.trim();
            if (/^amount(\s+as\s+\w+)?$/i.test(trimmed)) {
              return 'amount_cny, amount_usd';
            }
            return part;
          })
          .join(', ');
      }
      if (amountRef?.locations.some((loc) => loc === 'where' || loc === 'order')) {
        notes.push(amountChange.note ?? '');
      } else if (amountRef?.locations.includes('select')) {
        notes.push('amount 已拆为 amount_cny 与 amount_usd 两列，两列均已投影，请按分析口径选用。');
      }
    }
    wherePart = wherePart ? replaceIdentifier(wherePart, 'amount', 'amount_cny') : wherePart;
    orderPart = orderPart ? replaceIdentifier(orderPart, 'amount', 'amount_cny') : orderPart;
  }

  // 2) 客户名称并入 customers：跨表关联改写
  const movedChange = analysis.changes.find((change) => change.kind === 'moved');
  if (movedChange) {
    notes.push(movedChange.note ?? '');
  }

  // 3) 区域编码新增提示（只有引用了 customers.region 才给提示，不强行替换语义）
  const regionChange = analysis.changes.find(
    (change) => change.kind === 'renamed' && change.oldColumn === 'region',
  );
  if (regionChange) {
    notes.push(regionChange.note ?? '');
  }

  let draftSql: string;

  if (movedChange && analysis.table.toLowerCase() === 'orders') {
    // orders 单表引擎不支持 JOIN，草稿保留跨表写法供人工确认，同时明确告知需在数仓执行
    if (analysis.star) {
      selectPart =
        'o.order_no, c.customer_name, o.region, o.product, o.owner, o.amount_cny, o.amount_usd, o.quantity, o.status, o.created_at';
    } else {
      selectPart = selectPart
        .split(',')
        .map((part) => {
          const trimmed = part.trim();
          if (/^customer_name(\s+as\s+\w+)?$/i.test(trimmed)) {
            return 'c.customer_name';
          }
          return part;
        })
        .join(', ');
    }
    if (wherePart) {
      wherePart = replaceIdentifier(wherePart, 'customer_name', 'c.customer_name');
      wherePart = replaceIdentifier(wherePart, 'amount', 'amount_cny');
    }
    if (orderPart) {
      orderPart = /^amount\b/i.test(orderPart)
        ? orderPart.replace(/^amount/i, 'o.amount_cny')
        : orderPart;
    }
    draftSql = [
      `SELECT ${selectPart}`,
      'FROM orders o',
      'JOIN customers c ON o.customer_id = c.customer_id',
      wherePart ? `WHERE ${wherePart}` : null,
      orderPart ? `ORDER BY ${orderPart}` : null,
      segments.limitPart ? `LIMIT ${segments.limitPart}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    notes.push('该草稿含 JOIN，当前前端模拟引擎仅支持单表查询，请到数仓环境执行，或在确认窗口改写为单表查询后再落地。');
  } else if (analysis.star) {
    draftSql = [
      `SELECT ${selectPart === '*' ? '*' : selectPart}`,
      `FROM ${segments.fromTable}`,
      wherePart ? `WHERE ${wherePart}` : null,
      orderPart ? `ORDER BY ${orderPart}` : null,
      segments.limitPart ? `LIMIT ${segments.limitPart}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  } else {
    draftSql = [
      `SELECT ${selectPart}`,
      `FROM ${segments.fromTable}`,
      wherePart ? `WHERE ${wherePart}` : null,
      orderPart ? `ORDER BY ${orderPart}` : null,
      segments.limitPart ? `LIMIT ${segments.limitPart}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  }

  return {
    draftSql,
    status: 'draft',
    notes: notes.filter(Boolean),
    reasons: [],
  };
}

/** 判断草稿在指定版本能否通过语法与字段存在性校验；返回错误提示，通过返回 null */
export function validateAgainstVersion(sql: string, toVersion: string): string | null {
  return validateQuery(sql, toVersion);
}
