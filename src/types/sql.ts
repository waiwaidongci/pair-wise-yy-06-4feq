export type SqlValue = string | number | null;

/**
 * 数据源结构版本号。
 * v1 为升级前结构：orders 含 customer_name、amount；customers 无 region_code。
 * v2 为当前结构：orders 移除 customer_name（并入 customers），amount 拆分为
 * amount_cny / amount_usd；customers 新增 region_code。
 */
export const LEGACY_SCHEMA_VERSION = 'v1';
export const CURRENT_SCHEMA_VERSION = 'v2';

export function versionNumber(version: string): number {
  return Number(version.replace(/^v/i, '')) || 0;
}

export function isOlderThan(version: string, current: string = CURRENT_SCHEMA_VERSION): boolean {
  return versionNumber(version) < versionNumber(current);
}

export interface ColumnSchema {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean';
  nullable?: boolean;
  description?: string;
}

export interface TableSchema {
  name: string;
  label: string;
  description: string;
  columns: ColumnSchema[];
  rows: Array<Record<string, SqlValue>>;
}

export interface DatabaseSchema {
  name: string;
  label: string;
  schemaVersion: string;
  tables: TableSchema[];
}

export interface QueryColumn {
  name: string;
  label: string;
  type: ColumnSchema['type'];
}

export interface QueryResult {
  columns: QueryColumn[];
  rows: Array<Record<string, SqlValue>>;
  rowCount: number;
  totalMatched: number;
  elapsedMs: number;
  sql: string;
  truncated: boolean;
  /** 结果产出时数据源的结构版本；与当前版本不一致时结果立即失效 */
  schemaVersion: string;
}

export type MigrationStatus = 'pending' | 'rewritten' | 'kept';

export interface QuerySession {
  id: string;
  title: string;
  sql: string;
  updatedAt: number;
  /** 该查询语句所依据的数据源结构版本 */
  schemaVersion: string;
  /** 升级前的原文（应用改写草稿后保留，可用于恢复） */
  originalSql?: string;
  /** 升级处理状态：pending 待处理 / rewritten 已应用草稿 / kept 保留原文 */
  migrationStatus?: MigrationStatus;
  /** 待处理原因（保留原文时记录） */
  migrationReason?: string;
}

export interface QueryHistoryEntry {
  id: string;
  sql: string;
  executedAt: number;
  elapsedMs: number;
  rowCount: number;
  success: boolean;
  error?: string;
  /** 该历史记录依据的数据源结构版本（历史留住原文与版本，不再改写） */
  schemaVersion: string;
}

export interface FavoriteQuery {
  id: string;
  name: string;
  sql: string;
  createdAt: number;
  /** 该收藏语句依据的数据源结构版本（收藏留住原文与版本，不再改写） */
  schemaVersion: string;
}

export interface QueryErrorDetail {
  code: string;
  message: string;
  hint: string;
  line: number;
  column: number;
}
