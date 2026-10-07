import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { FavoriteQuery, QueryHistoryEntry, QuerySession } from '../types/sql';
import { CURRENT_SCHEMA_VERSION, LEGACY_SCHEMA_VERSION, isOlderThan } from '../types/sql';
import { analyzeQuerySql } from '../utils/schemaMigration';

const DEFAULT_SQL = `SELECT order_no, customer_name, region, amount, status
FROM orders
WHERE amount > 5000 AND status = '已完成'
ORDER BY amount DESC
LIMIT 500;`;

/** 可改写示例：仅引用 amount（已拆分为 amount_cny / amount_usd） */
const REWRITABLE_SQL = `SELECT order_no, amount, status
FROM orders
WHERE amount > 5000
ORDER BY amount DESC
LIMIT 500;`;

function createSession(
  title = '查询 1',
  sql = DEFAULT_SQL,
  schemaVersion: string = CURRENT_SCHEMA_VERSION,
): QuerySession {
  return {
    id: crypto.randomUUID(),
    title,
    sql,
    updatedAt: Date.now(),
    schemaVersion,
  };
}

/** 升级前的示例标签（v1 旧结构），用于演示逐条对照与改写 */
function createLegacySessions(): QuerySession[] {
  const pending = createSession('高金额已完成订单', DEFAULT_SQL, LEGACY_SCHEMA_VERSION);
  pending.migrationStatus = 'pending';
  const rewritable = createSession('订单金额排序', REWRITABLE_SQL, LEGACY_SCHEMA_VERSION);
  rewritable.migrationStatus = 'pending';
  return [pending, rewritable];
}

const LEGACY_SESSIONS = createLegacySessions();

/** 升级前的历史记录（v1），留住原文与依据版本 */
function createLegacyHistory(): QueryHistoryEntry[] {
  return [
    {
      id: 'legacy-history-1',
      sql: DEFAULT_SQL,
      executedAt: Date.now() - 1000 * 60 * 60 * 26,
      elapsedMs: 312,
      rowCount: 487,
      success: true,
      schemaVersion: LEGACY_SCHEMA_VERSION,
    },
    {
      id: 'legacy-history-2',
      sql: REWRITABLE_SQL,
      executedAt: Date.now() - 1000 * 60 * 60 * 52,
      elapsedMs: 268,
      rowCount: 512,
      success: true,
      schemaVersion: LEGACY_SCHEMA_VERSION,
    },
  ];
}

interface WorkbenchState {
  /** 工作台状态所依据的数据源结构版本 */
  workbenchSchemaVersion: string;
  /** 结构升级向导是否打开（瞬态，不持久化） */
  migrationOpen: boolean;
  tabs: QuerySession[];
  activeTabId: string;
  history: QueryHistoryEntry[];
  favorites: FavoriteQuery[];
  addTab: (sql?: string) => void;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  updateTab: (id: string, sql: string, title?: string) => void;
  addHistory: (entry: Omit<QueryHistoryEntry, 'id' | 'schemaVersion'>) => void;
  clearHistory: () => void;
  addFavorite: (name: string, sql: string) => void;
  removeFavorite: (id: string) => void;
  /** 应用改写草稿：标签落到新版本，原文保留可恢复 */
  applyMigrationDraft: (tabId: string) => void;
  /** 保留原文：标签留在旧版本并记录待处理原因 */
  keepMigrationOriginal: (tabId: string) => void;
  /** 从原文恢复（撤销改写） */
  restoreTabOriginal: (tabId: string) => void;
  /** 确认升级：所有标签落到新版本 */
  confirmMigration: () => void;
  /** 稍后处理 */
  dismissMigration: () => void;
  /** 重新打开升级向导 */
  reopenMigration: () => void;
}

export const useWorkbenchStore = create<WorkbenchState>()(
  persist(
    (set, get) => ({
      workbenchSchemaVersion: LEGACY_SCHEMA_VERSION,
      migrationOpen: true,
      tabs: LEGACY_SESSIONS,
      activeTabId: LEGACY_SESSIONS[0].id,
      history: createLegacyHistory(),
      favorites: [
        {
          id: 'favorite-example',
          name: '高金额已完成订单',
          sql: DEFAULT_SQL,
          createdAt: Date.now(),
          schemaVersion: LEGACY_SCHEMA_VERSION,
        },
      ],
      addTab: (sql) => {
        const tab = createSession(`查询 ${get().tabs.length + 1}`, sql);
        set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id }));
      },
      closeTab: (id) => {
        set((state) => {
          if (state.tabs.length === 1) {
            const replacement = createSession();
            return { tabs: [replacement], activeTabId: replacement.id };
          }
          const index = state.tabs.findIndex((tab) => tab.id === id);
          const tabs = state.tabs.filter((tab) => tab.id !== id);
          const activeTabId =
            state.activeTabId === id
              ? (tabs[Math.max(0, index - 1)]?.id ?? tabs[0].id)
              : state.activeTabId;
          return { tabs, activeTabId };
        });
      },
      activateTab: (id) => set({ activeTabId: id }),
      updateTab: (id, sql, title) =>
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === id
              ? {
                  ...tab,
                  sql,
                  title: title ?? tab.title,
                  updatedAt: Date.now(),
                }
              : tab,
          ),
        })),
      addHistory: (entry) =>
        set((state) => ({
          history: [
            { ...entry, id: crypto.randomUUID(), schemaVersion: CURRENT_SCHEMA_VERSION },
            ...state.history,
          ].slice(0, 100),
        })),
      clearHistory: () => set({ history: [] }),
      addFavorite: (name, sql) =>
        set((state) => ({
          favorites: [
            {
              id: crypto.randomUUID(),
              name: name.trim(),
              sql,
              createdAt: Date.now(),
              schemaVersion: CURRENT_SCHEMA_VERSION,
            },
            ...state.favorites.filter((favorite) => favorite.name !== name.trim()),
          ],
        })),
      removeFavorite: (id) =>
        set((state) => ({ favorites: state.favorites.filter((favorite) => favorite.id !== id) })),
      applyMigrationDraft: (tabId) =>
        set((state) => ({
          tabs: state.tabs.map((tab) => {
            if (tab.id !== tabId) return tab;
            const analysis = analyzeQuerySql(tab.sql);
            if (analysis.status !== 'rewritable' || !analysis.draftSql) return tab;
            return {
              ...tab,
              sql: analysis.draftSql,
              originalSql: tab.sql,
              schemaVersion: CURRENT_SCHEMA_VERSION,
              migrationStatus: 'rewritten',
              migrationReason: undefined,
              updatedAt: Date.now(),
            };
          }),
        })),
      keepMigrationOriginal: (tabId) =>
        set((state) => ({
          tabs: state.tabs.map((tab) => {
            if (tab.id !== tabId) return tab;
            const analysis = analyzeQuerySql(tab.sql);
            const reason =
              analysis.blockers.length > 0
                ? analysis.blockers.map((item) => `${item.column}：${item.reason}`).join('\n')
                : '已选择保留原文，未应用改写草稿。';
            return {
              ...tab,
              schemaVersion: LEGACY_SCHEMA_VERSION,
              migrationStatus: 'kept',
              migrationReason: reason,
              updatedAt: Date.now(),
            };
          }),
        })),
      restoreTabOriginal: (tabId) =>
        set((state) => ({
          tabs: state.tabs.map((tab) => {
            if (tab.id !== tabId || !tab.originalSql) return tab;
            return {
              ...tab,
              sql: tab.originalSql,
              originalSql: undefined,
              schemaVersion: LEGACY_SCHEMA_VERSION,
              migrationStatus: 'pending',
              migrationReason: undefined,
              updatedAt: Date.now(),
            };
          }),
        })),
      confirmMigration: () =>
        set((state) => ({
          // 标签的改写/保留已由 applyMigrationDraft / keepMigrationOriginal 逐条落定
          workbenchSchemaVersion: CURRENT_SCHEMA_VERSION,
          migrationOpen: false,
        })),
      dismissMigration: () => set({ migrationOpen: false }),
      reopenMigration: () => set({ migrationOpen: true }),
    }),
    {
      name: 'pair-wise-yy-06-workbench',
      partialize: (state) => ({
        workbenchSchemaVersion: state.workbenchSchemaVersion,
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        history: state.history,
        favorites: state.favorites,
      }),
      merge: (persisted, current) => {
        const persistedState = (persisted ?? {}) as Partial<WorkbenchState>;
        const normalizeTab = (tab: QuerySession): QuerySession => ({
          ...tab,
          schemaVersion: tab.schemaVersion ?? LEGACY_SCHEMA_VERSION,
        });
        const tabs = (persistedState.tabs ?? current.tabs).map(normalizeTab);
        const history = (persistedState.history ?? current.history).map((entry) => ({
          ...entry,
          schemaVersion: entry.schemaVersion ?? LEGACY_SCHEMA_VERSION,
        }));
        const favorites = (persistedState.favorites ?? current.favorites).map((favorite) => ({
          ...favorite,
          schemaVersion: favorite.schemaVersion ?? LEGACY_SCHEMA_VERSION,
        }));
        const workbenchSchemaVersion =
          persistedState.workbenchSchemaVersion ?? LEGACY_SCHEMA_VERSION;
        return {
          ...current,
          ...persistedState,
          tabs,
          history,
          favorites,
          workbenchSchemaVersion,
          migrationOpen: isOlderThan(workbenchSchemaVersion),
        };
      },
    },
  ),
);
