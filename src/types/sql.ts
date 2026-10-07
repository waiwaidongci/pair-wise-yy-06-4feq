export type SqlValue = string | number | null;

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
  version: string;
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
  /** 结果依据的结构版本；与当前数据源版本不一致时结果立即失效 */
  schemaVersion: string;
}

export interface QuerySession {
  id: string;
  title: string;
  sql: string;
  updatedAt: number;
  /** 标签当前 SQL 所依据的结构版本，确认迁移后才会变更 */
  schemaVersion: string;
}

export interface QueryHistoryEntry {
  id: string;
  sql: string;
  executedAt: number;
  elapsedMs: number;
  rowCount: number;
  success: boolean;
  error?: string;
  /** 历史原文依据的结构版本，永久保留 */
  schemaVersion: string;
}

export interface FavoriteQuery {
  id: string;
  name: string;
  sql: string;
  createdAt: number;
  /** 收藏原文依据的结构版本，永久保留 */
  schemaVersion: string;
}

export interface QueryErrorDetail {
  code: string;
  message: string;
  hint: string;
  line: number;
  column: number;
}

/** 字段级结构变更类型 */
export type MigrationKind = 'moved' | 'split' | 'merge' | 'renamed' | 'removed';

/** 旧字段 -> 新结构 的血缘描述 */
export interface FieldLineage {
  oldTable: string;
  oldColumn: string;
  kind: MigrationKind;
  /** 后继字段；为空表示该字段无后继 */
  successors?: Array<{ table: string; column: string }>;
  /** 跨表迁移时的关联方式 */
  joinWith?: string;
  /** 有后继时，随改写草稿给出的说明 */
  note?: string;
  /** 无后继时，留在待处理里的原因说明 */
  reason?: string;
}

export type ColumnRefLocation = 'select' | 'where' | 'order';

export interface ColumnRef {
  column: string;
  locations: ColumnRefLocation[];
}

export interface QueryAnalysis {
  table: string | null;
  parsed: boolean;
  star: boolean;
  refs: ColumnRef[];
  /** 命中的字段血缘 */
  changes: FieldLineage[];
  /** 是否受本次结构变更影响（字段不存在风险或 SELECT * 悄悄少列） */
  affected: boolean;
}

export type MigrationReviewStatus = 'draft' | 'pending' | 'confirmed' | 'unaffected';

/** 一条保存查询（标签页 / 历史 / 收藏）的结构升级对照记录 */
export interface MigrationReview {
  key: string;
  kind: 'tab' | 'history' | 'favorite';
  refId: string;
  title: string;
  fromVersion: string;
  toVersion: string;
  /** 原文，永不覆盖，供失败后恢复 */
  originalSql: string;
  /** 改写草稿；无后继时为 null，进入待处理 */
  draftSql: string | null;
  status: MigrationReviewStatus;
  notes: string[];
  reasons: string[];
  updatedAt: number;
}
