import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { analyzeQuery, buildMigrationDraft } from '../data/schemaMigration';
import type {
  FavoriteQuery,
  MigrationReview,
  QueryHistoryEntry,
  QuerySession,
} from '../types/sql';

const DEFAULT_SQL_V1 = `SELECT order_no, customer_name, region, amount, status
FROM orders
WHERE amount > 5000 AND status = '已完成'
ORDER BY amount DESC
LIMIT 500;`;

const DEFAULT_SQL_V2 = `SELECT order_no, customer_id, region, amount_cny, amount_usd, status
FROM orders
WHERE amount_cny > 5000 AND status = '已完成'
ORDER BY amount_cny DESC
LIMIT 500;`;

export function getDefaultSql(version: string): string {
  return version === 'v2' ? DEFAULT_SQL_V2 : DEFAULT_SQL_V1;
}

function createSession(title = '查询 1', sql: string = DEFAULT_SQL_V1, schemaVersion = 'v1'): QuerySession {
  return {
    id: crypto.randomUUID(),
    title,
    sql,
    updatedAt: Date.now(),
    schemaVersion,
  };
}

const initialSession = createSession();

export function reviewKey(
  kind: MigrationReview['kind'],
  refId: string,
  toVersion: string,
): string {
  return `${kind}:${refId}->${toVersion}`;
}

interface BuildReviewInput {
  kind: MigrationReview['kind'];
  refId: string;
  title: string;
  sql: string;
  fromVersion: string;
  toVersion: string;
}

export function buildReview(input: BuildReviewInput): MigrationReview {
  const analysis = analyzeQuery(input.sql, input.fromVersion, input.toVersion);
  // 逐条对照后确认不受影响的查询标记为“无需改写”，不进待确认
  if (!analysis.affected) {
    return {
      key: reviewKey(input.kind, input.refId, input.toVersion),
      kind: input.kind,
      refId: input.refId,
      title: input.title,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      originalSql: input.sql,
      draftSql: null,
      status: 'unaffected',
      notes: ['该查询引用的表和字段在新旧结构中均未变化，无需改写。'],
      reasons: [],
      updatedAt: Date.now(),
    };
  }
  const draft = buildMigrationDraft(input.sql, input.fromVersion, input.toVersion);
  return {
    key: reviewKey(input.kind, input.refId, input.toVersion),
    kind: input.kind,
    refId: input.refId,
    title: input.title,
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    originalSql: input.sql,
    draftSql: draft.draftSql,
    status: draft.status,
    notes: draft.notes,
    reasons: draft.reasons,
    updatedAt: Date.now(),
  };
}

interface WorkbenchState {
  /** 当前数据源结构版本 */
  activeVersion: string;
  /** 结构升级评审弹窗开关与目标版本 */
  reviewOpen: boolean;
  reviewTarget: string;
  tabs: QuerySession[];
  activeTabId: string;
  history: QueryHistoryEntry[];
  favorites: FavoriteQuery[];
  /** 所有未处理/已确认的对照记录，持久化，升级失败不丢失 */
  reviews: MigrationReview[];

  setActiveVersion: (version: string) => void;
  openReview: (toVersion: string) => void;
  closeReview: () => void;
  /** 切版本时逐条对照当前所有标签页/历史/收藏，生成或刷新改写草稿，不覆盖已有人工编辑 */
  generateReviews: (toVersion: string) => void;

  addTab: (sql?: string, schemaVersion?: string) => void;
  addTabFromSource: (kind: MigrationReview['kind'], refId: string) => void;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  updateTab: (id: string, sql: string, title?: string) => void;
  addHistory: (entry: Omit<QueryHistoryEntry, 'id' | 'schemaVersion'>, schemaVersion: string) => void;
  clearHistory: () => void;
  addFavorite: (name: string, sql: string, schemaVersion: string) => void;
  removeFavorite: (id: string) => void;

  saveDraft: (key: string, draftSql: string) => void;
  confirmReview: (key: string, finalSql: string) => void;
  restoreReview: (key: string) => void;
  dismissReview: (key: string) => void;
}

export const useWorkbenchStore = create<WorkbenchState>()(
  persist(
    (set, get) => ({
      activeVersion: 'v1',
      reviewOpen: false,
      reviewTarget: 'v2',
      tabs: [initialSession],
      activeTabId: initialSession.id,
      history: [],
      favorites: [
        {
          id: 'favorite-example',
          name: '高金额已完成订单',
          sql: DEFAULT_SQL_V1,
          createdAt: Date.now(),
          schemaVersion: 'v1',
        },
        {
          id: 'favorite-channel',
          name: '按渠道统计订单（旧字段）',
          sql: `SELECT channel, status, order_no
FROM orders
WHERE channel = '渠道'
ORDER BY order_no ASC
LIMIT 200;`,
          createdAt: Date.now() - 1000,
          schemaVersion: 'v1',
        },
      ],
      reviews: [],

      setActiveVersion: (version) => {
        if (version === get().activeVersion) return;
        // 版本一变，已跑出的结果立即失效（组件依据版本戳判断）
        set({ activeVersion: version });
        // 切版本时逐条对照新旧结构，生成改写草稿/待处理并弹出确认窗口
        get().generateReviews(version);
        set({ reviewOpen: true, reviewTarget: version });
      },
      openReview: (toVersion) => {
        get().generateReviews(toVersion);
        set({ reviewOpen: true, reviewTarget: toVersion });
      },
      closeReview: () => set({ reviewOpen: false }),
      generateReviews: (toVersion) => {
        const state = get();
        const sources: Array<BuildReviewInput> = [
          ...state.tabs
            .filter((tab) => tab.schemaVersion !== toVersion)
            .map((tab) => ({
              kind: 'tab' as const,
              refId: tab.id,
              title: tab.title,
              sql: tab.sql,
              fromVersion: tab.schemaVersion,
              toVersion,
            })),
          ...state.history
            .filter((entry) => entry.schemaVersion !== toVersion)
            .map((entry) => ({
              kind: 'history' as const,
              refId: entry.id,
              title: new Date(entry.executedAt).toLocaleString('zh-CN'),
              sql: entry.sql,
              fromVersion: entry.schemaVersion,
              toVersion,
            })),
          ...state.favorites
            .filter((favorite) => favorite.schemaVersion !== toVersion)
            .map((favorite) => ({
              kind: 'favorite' as const,
              refId: favorite.id,
              title: favorite.name,
              sql: favorite.sql,
              fromVersion: favorite.schemaVersion,
              toVersion,
            })),
        ];

        set((current) => {
          const existingKeys = new Set(current.reviews.map((review) => review.key));
          // 已有人工编辑/确认结果保留，不被自动生成覆盖；只增量补入新条目
          const additions = sources
            .filter((source) => !existingKeys.has(reviewKey(source.kind, source.refId, toVersion)))
            .map(buildReview);
          return additions.length ? { reviews: [...current.reviews, ...additions] } : {};
        });
      },

      addTab: (sql, schemaVersion) => {
        const version = schemaVersion ?? get().activeVersion;
        const tab = createSession(
          `查询 ${get().tabs.length + 1}`,
          sql ?? getDefaultSql(version),
          version,
        );
        set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id }));
      },
      addTabFromSource: (kind, refId) => {
        const state = get();
        if (kind === 'favorite') {
          const favorite = state.favorites.find((item) => item.id === refId);
          if (favorite) {
            get().addTab(favorite.sql, favorite.schemaVersion);
          }
        } else {
          const entry = state.history.find((item) => item.id === refId);
          if (entry) {
            get().addTab(entry.sql, entry.schemaVersion);
          }
        }
      },
      closeTab: (id) => {
        set((state) => {
          if (state.tabs.length === 1) {
            const version = state.activeVersion;
            const replacement = createSession('查询 1', getDefaultSql(version), version);
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
      addHistory: (entry, schemaVersion) =>
        set((state) => ({
          history: [
            { ...entry, id: crypto.randomUUID(), schemaVersion },
            ...state.history,
          ].slice(0, 100),
        })),
      clearHistory: () => set({ history: [] }),
      addFavorite: (name, sql, schemaVersion) =>
        set((state) => ({
          favorites: [
            {
              id: crypto.randomUUID(),
              name: name.trim(),
              sql,
              createdAt: Date.now(),
              schemaVersion,
            },
            ...state.favorites.filter((favorite) => favorite.name !== name.trim()),
          ],
        })),
      removeFavorite: (id) =>
        set((state) => ({ favorites: state.favorites.filter((favorite) => favorite.id !== id) })),

      saveDraft: (key, draftSql) =>
        set((state) => ({
          reviews: state.reviews.map((review) =>
            review.key === key
              ? { ...review, draftSql, updatedAt: Date.now() }
              : review,
          ),
        })),
      confirmReview: (key, finalSql) => {
        const review = get().reviews.find((item) => item.key === key);
        if (!review) return;
        // 待处理（无后继）不允许确认落地
        if (review.status === 'pending') return;
        set((state) => {
          const reviews = state.reviews.map((item) =>
            item.key === key
              ? { ...item, draftSql: finalSql, status: 'confirmed' as const, updatedAt: Date.now() }
              : item,
          );
          // 只有标签页在确认后才真正落到新版本；历史/收藏只更新对照状态，原文不动
          if (review.kind === 'tab') {
            const tabs = state.tabs.map((tab) =>
              tab.id === review.refId
                ? { ...tab, sql: finalSql, schemaVersion: review.toVersion, updatedAt: Date.now() }
                : tab,
            );
            return { reviews, tabs };
          }
          return { reviews };
        });
      },
      restoreReview: (key) => {
        const review = get().reviews.find((item) => item.key === key);
        if (!review) return;
        set((state) => {
          const reviews = state.reviews.map((item) =>
            item.key === key
              ? { ...item, status: 'draft' as const, updatedAt: Date.now() }
              : item,
          );
          // 升级失败可从原文恢复：标签页回到旧版本原文，重新待处理
          if (review.kind === 'tab') {
            const tabs = state.tabs.map((tab) =>
              tab.id === review.refId
                ? { ...tab, sql: review.originalSql, schemaVersion: review.fromVersion, updatedAt: Date.now() }
                : tab,
            );
            return { reviews, tabs };
          }
          return { reviews };
        });
      },
      dismissReview: (key) =>
        set((state) => ({
          reviews: state.reviews.filter((review) => review.key !== key),
        })),
    }),
    {
      name: 'pair-wise-yy-06-workbench',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      // 旧版本（无版本标记）数据升级：全部标注为依据 v1，原文保留；对照记录缺失则不构造，由打开评审时补
      migrate: (persisted: unknown) => {
        const data = (persisted ?? {}) as Partial<WorkbenchState>;
        const stamp = <T>(item: T): T & { schemaVersion: string } => {
          const existing = (item as { schemaVersion?: unknown }).schemaVersion;
          return { ...(item as object), schemaVersion: typeof existing === 'string' ? existing : 'v1' } as T & {
            schemaVersion: string;
          };
        };
        return {
          ...data,
          activeVersion: typeof data.activeVersion === 'string' ? data.activeVersion : 'v1',
          tabs: (data.tabs ?? []).map(stamp),
          history: (data.history ?? []).map(stamp),
          favorites: (data.favorites ?? []).map(stamp),
          reviews: data.reviews ?? [],
        };
      },
      partialize: (state) => ({
        activeVersion: state.activeVersion,
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        history: state.history,
        favorites: state.favorites,
        reviews: state.reviews,
      }),
    },
  ),
);
