import type {
  ColumnSchema,
  DatabaseSchema,
  QueryColumn,
  QueryResult,
  SqlValue,
  TableSchema,
} from '../types/sql';
import { SqlQueryError } from '../utils/queryErrors';

const CUSTOMER_PREFIXES = ['远海', '星图', '柏川', '新域', '启明', '屹辰', '和光', '云舟'];
const CUSTOMER_SUFFIXES = ['科技有限公司', '智能制造有限公司', '供应链有限公司', '数据服务有限公司'];
const REGIONS = ['华东', '华南', '华北', '西南', '西北', '东北'];
const REGION_CODES = ['HD', 'HN', 'HB', 'XN', 'XB', 'DB'];
const STATUSES = ['待审核', '进行中', '已发货', '已完成', '异常'];
const PRODUCTS = ['企业云主机', '边缘计算节点', '数据治理平台', '智能客服', '可观测套件', '灾备服务'];
const OWNERS = ['陈嘉', '林月', '周砺', '许宁', '韩舟', '顾清', '沈河', '陆遥'];
const CHANNELS = ['直销', '渠道', '电商', '伙伴'];
/** 演示用固定汇率：v2 金额拆分为人民币/美元两列 */
const USD_RATE = 7.2;

const orderCount = 18000;
const customerCount = 2600;

function customerNameAt(index: number): string {
  return `${CUSTOMER_PREFIXES[index % CUSTOMER_PREFIXES.length]}${CUSTOMER_SUFFIXES[(index * 3) % CUSTOMER_SUFFIXES.length]}`;
}

function regionIndexByName(name: string): number {
  const code = name.charCodeAt(0) + name.charCodeAt(1);
  return code % REGIONS.length;
}

/* ---------------- v1 原始结构 ---------------- */

const v1OrderColumns: ColumnSchema[] = [
  { name: 'order_no', type: 'string', description: '订单业务编号' },
  { name: 'customer_name', type: 'string', description: '客户名称' },
  { name: 'region', type: 'string', description: '销售区域' },
  { name: 'product', type: 'string', description: '产品线' },
  { name: 'owner', type: 'string', description: '销售负责人' },
  { name: 'amount', type: 'number', description: '含税合同金额（原币口径）' },
  { name: 'quantity', type: 'number', description: '订购数量' },
  { name: 'status', type: 'string', description: '订单状态' },
  { name: 'channel', type: 'string', description: '获客渠道（旧版字段，将下线）' },
  { name: 'created_at', type: 'date', description: '创建时间' },
];

const v1Orders: Array<Record<string, SqlValue>> = Array.from({ length: orderCount }, (_, index) => ({
  order_no: `SO-${202600000 + index}`,
  customer_name: customerNameAt(index),
  region: REGIONS[(index * 5) % REGIONS.length],
  product: PRODUCTS[(index * 7) % PRODUCTS.length],
  owner: OWNERS[(index * 11) % OWNERS.length],
  amount: Math.round((1200 + ((index * 7919) % 930000) / 3) * 100) / 100,
  quantity: 1 + ((index * 17) % 320),
  status: STATUSES[(index * 13) % STATUSES.length],
  channel: CHANNELS[(index * 19) % CHANNELS.length],
  created_at: `2026-${String((index % 12) + 1).padStart(2, '0')}-${String((index * 3) % 27 + 1).padStart(2, '0')} ${String(index % 24).padStart(2, '0')}:${String((index * 7) % 60).padStart(2, '0')}:00`,
}));

const v1Customers: Array<Record<string, SqlValue>> = Array.from({ length: customerCount }, (_, index) => ({
  customer_id: `CUS-${String(index + 1).padStart(6, '0')}`,
  customer_name: customerNameAt(index),
  region: REGIONS[(index * 5) % REGIONS.length],
  level: ['战略客户', '重点客户', '普通客户'][index % 3],
  credit_limit: 200000 + (index % 80) * 50000,
  owner: OWNERS[(index * 11) % OWNERS.length],
  active: index % 9 === 0 ? '否' : '是',
}));

const productRows: Array<Record<string, SqlValue>> = Array.from({ length: 1200 }, (_, index) => ({
  product_code: `PRD-${String(index + 1).padStart(5, '0')}`,
  product_name: `${PRODUCTS[index % PRODUCTS.length]} ${['标准版', '专业版', '企业版'][index % 3]}`,
  category: ['云计算', '数据智能', '协同办公', '安全服务'][(index * 3) % 4],
  list_price: 1999 + (index % 120) * 800,
  stock: (index * 31) % 900,
  online: index % 11 === 0 ? '下架' : '在售',
}));

const employeeRows: Array<Record<string, SqlValue>> = Array.from({ length: 860 }, (_, index) => ({
  employee_id: `EMP-${String(index + 1).padStart(4, '0')}`,
  employee_name: `${OWNERS[index % OWNERS.length]}${String(index).padStart(2, '0')}`,
  department: ['销售一部', '销售二部', '解决方案部', '交付中心', '客户成功部'][(index * 3) % 5],
  region: REGIONS[(index * 7) % REGIONS.length],
  title: ['客户经理', '高级客户经理', '解决方案顾问', '交付经理'][(index * 5) % 4],
  joined_at: `20${18 + (index % 8)}-${String((index % 12) + 1).padStart(2, '0')}-01`,
  performance: Math.round((68 + ((index * 29) % 32) * 0.9) * 10) / 10,
}));

/* ---------------- v2 升级结构 ---------------- */
/*
 * 本周结构变更：
 * 1. orders.customer_name 并入 customers（以 customer_id 关联，客户名称只保留在 customers）
 * 2. orders.amount 拆为 amount_cny / amount_usd 两列
 * 3. customers 新增 region_code 区域编码
 * 4. orders.channel 下线（无后继）
 */

const v2Orders: Array<Record<string, SqlValue>> = v1Orders.map((row, index) => {
  const cny = Number(row.amount);
  return {
    order_no: row.order_no,
    customer_id: `CUS-${String((index % customerCount) + 1).padStart(6, '0')}`,
    region: row.region,
    product: row.product,
    owner: row.owner,
    amount_cny: cny,
    amount_usd: Math.round((cny / USD_RATE) * 100) / 100,
    quantity: row.quantity,
    status: row.status,
    created_at: row.created_at,
  };
});

const v2Customers: Array<Record<string, SqlValue>> = v1Customers.map((row) => {
  const regionIndex = regionIndexByName(String(row.customer_name));
  return {
    customer_id: row.customer_id,
    customer_name: row.customer_name,
    region: row.region,
    region_code: REGION_CODES[regionIndex],
    level: row.level,
    credit_limit: row.credit_limit,
    owner: row.owner,
    active: row.active,
  };
});

const SCHEMAS: Record<string, DatabaseSchema> = {
  v1: {
    name: 'commerce_dw',
    label: 'commerce_dw · 企业经营数据仓库',
    version: 'v1',
    tables: [
      {
        name: 'orders',
        label: 'orders · 销售订单明细',
        description: '覆盖 2026 年订单、客户、产品、负责人和履约状态',
        columns: v1OrderColumns,
        rows: v1Orders,
      },
      {
        name: 'customers',
        label: 'customers · 客户主数据',
        description: '客户等级、信用额度、归属区域和责任人',
        columns: [
          { name: 'customer_id', type: 'string' },
          { name: 'customer_name', type: 'string', description: '客户名称' },
          { name: 'region', type: 'string' },
          { name: 'level', type: 'string' },
          { name: 'credit_limit', type: 'number' },
          { name: 'owner', type: 'string' },
          { name: 'active', type: 'string' },
        ],
        rows: v1Customers,
      },
      {
        name: 'products',
        label: 'products · 产品目录',
        description: '产品编码、价格、库存和上下架状态',
        columns: [
          { name: 'product_code', type: 'string' },
          { name: 'product_name', type: 'string' },
          { name: 'category', type: 'string' },
          { name: 'list_price', type: 'number' },
          { name: 'stock', type: 'number' },
          { name: 'online', type: 'string' },
        ],
        rows: productRows,
      },
      {
        name: 'employees',
        label: 'employees · 组织人员',
        description: '销售及交付团队人员信息',
        columns: [
          { name: 'employee_id', type: 'string' },
          { name: 'employee_name', type: 'string' },
          { name: 'department', type: 'string' },
          { name: 'region', type: 'string' },
          { name: 'title', type: 'string' },
          { name: 'joined_at', type: 'date' },
          { name: 'performance', type: 'number' },
        ],
        rows: employeeRows,
      },
    ],
  },
  v2: {
    name: 'commerce_dw',
    label: 'commerce_dw · 企业经营数据仓库',
    version: 'v2',
    tables: [
      {
        name: 'orders',
        label: 'orders · 销售订单明细（v2）',
        description: '客户改为 customer_id 关联，金额拆分为人民币与美元两列',
        columns: [
          { name: 'order_no', type: 'string', description: '订单业务编号' },
          { name: 'customer_id', type: 'string', description: '关联 customers.customer_id' },
          { name: 'region', type: 'string', description: '销售区域' },
          { name: 'product', type: 'string', description: '产品线' },
          { name: 'owner', type: 'string', description: '销售负责人' },
          { name: 'amount_cny', type: 'number', description: '含税合同金额（人民币）' },
          { name: 'amount_usd', type: 'number', description: '含税合同金额（美元）' },
          { name: 'quantity', type: 'number', description: '订购数量' },
          { name: 'status', type: 'string', description: '订单状态' },
          { name: 'created_at', type: 'date', description: '创建时间' },
        ],
        rows: v2Orders,
      },
      {
        name: 'customers',
        label: 'customers · 客户主数据（v2）',
        description: '客户名称归入本表，新增区域编码 region_code',
        columns: [
          { name: 'customer_id', type: 'string' },
          { name: 'customer_name', type: 'string', description: '客户名称（v2 起仅保留于此表）' },
          { name: 'region', type: 'string' },
          { name: 'region_code', type: 'string', description: '区域编码（新增）' },
          { name: 'level', type: 'string' },
          { name: 'credit_limit', type: 'number' },
          { name: 'owner', type: 'string' },
          { name: 'active', type: 'string' },
        ],
        rows: v2Customers,
      },
      {
        name: 'products',
        label: 'products · 产品目录',
        description: '产品编码、价格、库存和上下架状态',
        columns: [
          { name: 'product_code', type: 'string' },
          { name: 'product_name', type: 'string' },
          { name: 'category', type: 'string' },
          { name: 'list_price', type: 'number' },
          { name: 'stock', type: 'number' },
          { name: 'online', type: 'string' },
        ],
        rows: productRows,
      },
      {
        name: 'employees',
        label: 'employees · 组织人员',
        description: '销售及交付团队人员信息',
        columns: [
          { name: 'employee_id', type: 'string' },
          { name: 'employee_name', type: 'string' },
          { name: 'department', type: 'string' },
          { name: 'region', type: 'string' },
          { name: 'title', type: 'string' },
          { name: 'joined_at', type: 'date' },
          { name: 'performance', type: 'number' },
        ],
        rows: employeeRows,
      },
    ],
  },
};

export const SCHEMA_VERSIONS = [
  { version: 'v1', label: 'v1 · 旧版结构' },
  { version: 'v2', label: 'v2 · 本周新结构' },
];

interface ParsedQuery {
  select: Array<{ source: string; alias: string }>;
  table: TableSchema;
  where?: WhereNode;
  orderBy?: { field: string; direction: 'asc' | 'desc' };
  limit: number;
}

type WhereNode =
  | { kind: 'condition'; field: string; operator: string; value: string }
  | { kind: 'group'; logic: 'and' | 'or'; children: WhereNode[] };

export function getSchema(version = 'v1'): DatabaseSchema {
  const database = SCHEMAS[version] ?? SCHEMAS.v1;
  return {
    ...database,
    tables: database.tables.map((table) => ({ ...table, rows: [] })),
  };
}

/** 只做语法与字段存在性校验，不执行查询；返回错误提示，校验通过返回 null */
export function validateQuery(sql: string, version = 'v1'): string | null {
  if (/\bjoin\b/i.test(sql)) {
    return '草稿含跨表 JOIN，前端模拟引擎不支持执行；确认落地后请到数仓环境运行。';
  }
  const database = SCHEMAS[version] ?? SCHEMAS.v1;
  try {
    parseSelect(sql, database);
    return null;
  } catch (error) {
    return error instanceof SqlQueryError ? `${error.message}（${error.hint}）` : '查询无法解析';
  }
}

export async function executeMockQuery(
  sql: string,
  version = 'v1',
  signal?: AbortSignal,
): Promise<QueryResult> {
  const startedAt = performance.now();
  const database = SCHEMAS[version] ?? SCHEMAS.v1;
  const parsed = parseSelect(sql, database);
  if (!parsed) {
    throw new SqlQueryError(
      'SQL_PARSE',
      '无法解析该 SQL，当前仅支持单条 SELECT 查询',
      '示例：SELECT order_no, amount_cny FROM orders WHERE amount_cny > 5000 LIMIT 100',
      0,
    );
  }

  await waitForMockLatency(180 + Math.min(1000, parsed.table.rows.length / 40), signal);

  const selectedColumns = resolveColumns(parsed);
  const filtered = parsed.where
    ? parsed.table.rows.filter((row) => evaluateWhere(row, parsed.where as WhereNode))
    : [...parsed.table.rows];

  if (parsed.orderBy) {
    const { field, direction } = parsed.orderBy;
    filtered.sort((left, right) => compareValues(left[field], right[field]) * (direction === 'asc' ? 1 : -1));
  }

  const rows = filtered.slice(0, parsed.limit).map((row) => {
    const projected: Record<string, SqlValue> = {};
    selectedColumns.forEach((column) => {
      projected[column.name] = row[column.source];
    });
    return projected;
  });

  return {
    columns: selectedColumns.map(({ name, source }) => {
      const schema = parsed.table.columns.find((column) => column.name === source);
      return { name, label: name, type: schema?.type ?? 'string' } satisfies QueryColumn;
    }),
    rows,
    rowCount: rows.length,
    totalMatched: filtered.length,
    elapsedMs: Math.max(12, Math.round(performance.now() - startedAt)),
    sql,
    truncated: filtered.length > parsed.limit,
    schemaVersion: database.version,
  };
}

function parseSelect(sql: string, database: DatabaseSchema): ParsedQuery | null {
  const normalized = sql.trim().replace(/;+\s*$/, '');
  if (!normalized || !/^select\b/i.test(normalized)) {
    if (!normalized) {
      throw new SqlQueryError('EMPTY_SQL', '请输入 SQL 查询语句', '输入 SELECT 语句后执行。', 0);
    }
    return null;
  }

  const match = normalized.match(
    /^select\s+([\s\S]+?)\s+from\s+([a-zA-Z_][\w]*)(?:\s+where\s+([\s\S]+?))?(?:\s+order\s+by\s+([a-zA-Z_][\w]*)(?:\s+(asc|desc))?)?(?:\s+limit\s+(\d+))?$/i,
  );
  if (!match) {
    throw new SqlQueryError(
      'SQL_PARSE',
      'SELECT 语句结构不完整',
      '支持的顺序为 SELECT ... FROM ... WHERE ... ORDER BY ... LIMIT ...',
      Math.max(0, normalized.toLowerCase().indexOf('select')),
    );
  }

  const tableName = match[2];
  const table = database.tables.find((item) => item.name.toLowerCase() === tableName.toLowerCase());
  if (!table) {
    throw new SqlQueryError(
      'TABLE_NOT_FOUND',
      `数据表 ${tableName} 不存在于结构 ${database.version}`,
      `当前可用表：${database.tables.map((item) => item.name).join('、')}`,
      normalized.indexOf(tableName),
    );
  }

  const select = match[1].split(',').map((part) => {
    const value = part.trim();
    const aliasMatch = value.match(/^([\w*]+)(?:\s+as\s+([\w]+))?$/i);
    if (!aliasMatch) {
      throw new SqlQueryError('SQL_PARSE', `无法解析投影字段：${value}`, '示例：customer_name AS 客户名称', 0);
    }
    return { source: aliasMatch[1], alias: aliasMatch[2] || aliasMatch[1] };
  });

  if (!select.some((column) => column.source === '*')) {
    const invalid = select.find(
      (column) => !table.columns.some((schema) => schema.name.toLowerCase() === column.source.toLowerCase()),
    );
    if (invalid) {
      throw new SqlQueryError(
        'COLUMN_NOT_FOUND',
        `字段 ${invalid.source} 不存在于 ${table.name}（结构版本 ${database.version}）`,
        `可用字段：${table.columns.map((column) => column.name).join('、')}`,
        normalized.indexOf(invalid.source),
      );
    }
  }

  const where = match[3] ? parseWhere(match[3], table, normalized) : undefined;
  const limit = Math.min(Math.max(Number(match[6] ?? 500), 1), 5000);
  return {
    select,
    table,
    where,
    orderBy: match[4]
      ? { field: match[4], direction: (match[5]?.toLowerCase() as 'asc' | 'desc') || 'asc' }
      : undefined,
    limit,
  };
}

function parseWhere(source: string, table: TableSchema, fullSql: string): WhereNode {
  const expression = stripOuterParentheses(source.trim());
  const orParts = splitLogical(expression, 'or');
  if (orParts.length > 1) {
    return { kind: 'group', logic: 'or', children: orParts.map((part) => parseWhere(part, table, fullSql)) };
  }
  const andParts = splitLogical(expression, 'and');
  if (andParts.length > 1) {
    return { kind: 'group', logic: 'and', children: andParts.map((part) => parseWhere(part, table, fullSql)) };
  }

  const condition = expression.match(/^([\w]+)\s*(=|!=|<>|>=|<=|>|<|like|in)\s*(.+)$/i);
  if (!condition) {
    throw new SqlQueryError('SQL_PARSE', `无法解析筛选条件：${expression}`, '示例：amount_cny >= 5000', 0);
  }
  const field = table.columns.find(
    (column) => column.name.toLowerCase() === condition[1].toLowerCase(),
  );
  if (!field) {
    throw new SqlQueryError(
      'COLUMN_NOT_FOUND',
      `筛选字段 ${condition[1]} 不存在于 ${table.name}（结构版本 ${table.label.includes('v2') ? 'v2' : 'v1'}）`,
      `可用字段：${table.columns.map((column) => column.name).join('、')}`,
      fullSql.indexOf(condition[1]),
    );
  }
  return {
    kind: 'condition',
    field: field.name,
    operator: condition[2].toLowerCase(),
    value: condition[3].trim().replace(/^['"]|['"]$/g, ''),
  };
}

function stripOuterParentheses(source: string): string {
  let expression = source;
  while (expression.startsWith('(') && expression.endsWith(')')) {
    let depth = 0;
    let wrapsWholeExpression = true;
    for (let index = 0; index < expression.length; index += 1) {
      if (expression[index] === '(') depth += 1;
      if (expression[index] === ')') depth -= 1;
      if (depth === 0 && index < expression.length - 1) {
        wrapsWholeExpression = false;
        break;
      }
    }
    if (!wrapsWholeExpression) break;
    expression = expression.slice(1, -1).trim();
  }
  return expression;
}

function splitLogical(source: string, operator: 'and' | 'or'): string[] {
  const result: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  const upper = source.toUpperCase();
  const needle = ` ${operator.toUpperCase()} `;
  for (let index = 0; index <= source.length - needle.length; index += 1) {
    const char = source[index];
    if ((char === '\'' || char === '"') && source[index - 1] !== '\\') {
      quote = quote === char ? '' : quote || char;
    } else if (!quote && char === '(') {
      depth += 1;
    } else if (!quote && char === ')') {
      depth -= 1;
    } else if (!quote && depth === 0 && upper.slice(index, index + needle.length) === needle) {
      result.push(source.slice(start, index).trim());
      start = index + needle.length;
      index += needle.length - 1;
    }
  }
  result.push(source.slice(start).trim());
  return result;
}

function evaluateWhere(row: Record<string, SqlValue>, node: WhereNode): boolean {
  if (node.kind === 'group') {
    return node.logic === 'and'
      ? node.children.every((child) => evaluateWhere(row, child))
      : node.children.some((child) => evaluateWhere(row, child));
  }
  const left = row[node.field];
  const right = node.value;
  switch (node.operator) {
    case '=':
      return String(left) === right;
    case '!=':
    case '<>':
      return String(left) !== right;
    case '>':
      return compareRaw(left, right) > 0;
    case '>=':
      return compareRaw(left, right) >= 0;
    case '<':
      return compareRaw(left, right) < 0;
    case '<=':
      return compareRaw(left, right) <= 0;
    case 'like':
      return String(left).toLowerCase().includes(right.toLowerCase().replaceAll('%', ''));
    case 'in':
      return right
        .replace(/^\(|\)$/g, '')
        .split(',')
        .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
        .includes(String(left));
    default:
      return false;
  }
}

function resolveColumns(parsed: ParsedQuery): Array<{ name: string; source: string }> {
  if (parsed.select.some((column) => column.source === '*')) {
    return parsed.table.columns.map((column) => ({ name: column.name, source: column.name }));
  }
  return parsed.select.map((column) => ({
    name: column.alias,
    source: parsed.table.columns.find(
      (schema) => schema.name.toLowerCase() === column.source.toLowerCase(),
    )?.name ?? column.source,
  }));
}

function compareValues(left: SqlValue, right: SqlValue): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right), 'zh-CN');
}

function compareRaw(left: SqlValue, right: string): number {
  if (typeof left === 'number') return left - Number(right);
  return String(left).localeCompare(right, 'zh-CN');
}

function waitForMockLatency(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      if (signal?.aborted) {
        window.clearInterval(timer);
        reject(new SqlQueryError('QUERY_ABORTED', '用户取消了长时间查询', '可以缩小时间范围或增加筛选条件。'));
      } else if (performance.now() - startedAt >= milliseconds) {
        window.clearInterval(timer);
        resolve();
      }
    }, 20);
  });
}
