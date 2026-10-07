import {
  BookOutlined,
  CaretRightOutlined,
  FormatPainterOutlined,
  HistoryOutlined,
  StopOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, App as AntdApp, Button, Input, Modal, Space, Tag, Tooltip } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { QueryTabs } from '../components/QueryTabs';
import { ResultGrid } from '../components/ResultGrid';
import { SchemaTree } from '../components/SchemaTree';
import { SqlEditor } from '../components/SqlEditor';
import { executeMockQuery, getSchema } from '../data/mockDatabase';
import { useWorkbenchStore } from '../stores/workbenchStore';
import type { QueryErrorDetail, QueryResult } from '../types/sql';
import { formatSql } from '../utils/sqlFormatter';
import { ERROR_MAPPINGS, toQueryErrorDetail } from '../utils/queryErrors';

export function WorkbenchPage() {
  const { message } = AntdApp.useApp();
  const tabs = useWorkbenchStore((state) => state.tabs);
  const activeTabId = useWorkbenchStore((state) => state.activeTabId);
  const activeVersion = useWorkbenchStore((state) => state.activeVersion);
  const addTab = useWorkbenchStore((state) => state.addTab);
  const closeTab = useWorkbenchStore((state) => state.closeTab);
  const activateTab = useWorkbenchStore((state) => state.activateTab);
  const updateTab = useWorkbenchStore((state) => state.updateTab);
  const addHistory = useWorkbenchStore((state) => state.addHistory);
  const addFavorite = useWorkbenchStore((state) => state.addFavorite);
  const openReview = useWorkbenchStore((state) => state.openReview);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const schemaQuery = useQuery({
    queryKey: ['database-schema', activeVersion],
    queryFn: () => getSchema(activeVersion),
  });
  const abortRef = useRef<AbortController | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<QueryErrorDetail | null>(null);
  const [favoriteOpen, setFavoriteOpen] = useState(false);
  const [favoriteName, setFavoriteName] = useState('');
  const [lastExecutedSql, setLastExecutedSql] = useState('');

  const tabVersion = activeTab?.schemaVersion ?? activeVersion;
  const tabPinned = tabVersion !== activeVersion;
  // 逐条对照后确认无需改写的旧版本标签，可直接在新版本执行
  const tabReview = useWorkbenchStore(
    (state) =>
      state.reviews.find(
        (review) =>
          review.kind === 'tab' &&
          review.refId === activeTabId &&
          review.toVersion === activeVersion,
      ) ?? null,
  );
  const tabUnaffected = tabReview?.status === 'unaffected';
  const blockExecution = tabPinned && !tabUnaffected;
  // 结果依据的版本与当前数据源版本不一致：版本一变，已跑出的结果立刻失效
  const resultStale = !!result && result.schemaVersion !== activeVersion;

  // 数据源切版本后立即作废旧结果（置为失效展示，禁止复制导出）
  useEffect(() => {
    setError(null);
  }, [activeTabId]);

  const executeMutation = useMutation({
    mutationFn: ({ sql, version, signal }: { sql: string; version: string; signal: AbortSignal }) =>
      executeMockQuery(sql, version, signal),
  });

  const running = executeMutation.isPending;
  const errorTitle = error ? ERROR_MAPPINGS[error.code]?.title ?? '执行失败' : '';

  const complexity = useMemo(() => {
    const sql = activeTab?.sql ?? '';
    return {
      lines: sql.split('\n').length,
      chars: sql.length,
      hasLimit: /\blimit\b/i.test(sql),
    };
  }, [activeTab?.sql]);

  if (!activeTab) return null;

  const execute = async () => {
    if (running) return;
    if (blockExecution) {
      void message.warning(
        `该标签仍依据 ${tabVersion}，与当前数据源 ${activeVersion} 不一致，请先完成改写确认再执行`,
      );
      openReview(activeVersion);
      return;
    }
    if (tabUnaffected) {
      // 无需改写的标签执行时视为落地到当前版本
      useWorkbenchStore.setState((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.id === activeTab.id ? { ...tab, schemaVersion: activeVersion } : tab,
        ),
      }));
    }
    const sql = activeTab.sql.trim();
    abortRef.current = new AbortController();
    setError(null);
    setResult(null);
    setLastExecutedSql(sql);
    try {
      const nextResult = await executeMutation.mutateAsync({
        sql,
        version: activeVersion,
        signal: abortRef.current.signal,
      });
      setResult(nextResult);
      addHistory(
        {
          sql,
          executedAt: Date.now(),
          elapsedMs: nextResult.elapsedMs,
          rowCount: nextResult.rowCount,
          success: true,
        },
        activeVersion,
      );
      if (nextResult.truncated) {
        void message.warning(`结果超过 LIMIT，已返回前 ${nextResult.rowCount} 行`);
      }
    } catch (queryError) {
      const detail = toQueryErrorDetail(queryError, sql);
      setError(detail);
      addHistory(
        {
          sql,
          executedAt: Date.now(),
          elapsedMs: 0,
          rowCount: 0,
          success: false,
          error: detail.message,
        },
        activeVersion,
      );
    } finally {
      abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    void message.info('已发送取消请求');
  };

  const runFormat = () => {
    updateTab(activeTab.id, formatSql(activeTab.sql));
  };

  const useTable = (tableName: string) => {
    const table = schemaQuery.data?.tables.find((item) => item.name === tableName);
    if (!table) return;
    const sql = `SELECT *\nFROM ${table.name}\nLIMIT 500;`;
    updateTab(activeTab.id, sql, table.name);
  };

  return (
    <div className="workbench">
      <SchemaTree
        schema={schemaQuery.data}
        loading={schemaQuery.isLoading}
        onUseTable={useTable}
      />
      <main className="query-main">
        <section className="editor-panel">
          <QueryTabs
            tabs={tabs}
            activeTabId={activeTab.id}
            activeVersion={activeVersion}
            onActivate={activateTab}
            onAdd={() => addTab()}
            onClose={closeTab}
          />
          <div className="editor-toolbar">
            <Space size={6}>
              <Tooltip title={blockExecution ? `该标签仍依据 ${tabVersion}，需先改写确认` : '执行 (⌘ Enter)'}>
                <Button
                  type="primary"
                  icon={<CaretRightOutlined />}
                  loading={running}
                  danger={blockExecution}
                  onClick={() => void execute()}
                >
                  {blockExecution ? `需先迁移（${tabVersion}）` : '执行'}
                </Button>
              </Tooltip>
              <Tooltip title="查询执行中可取消">
                <Button
                  danger
                  icon={<StopOutlined />}
                  disabled={!running}
                  onClick={cancel}
                >
                  取消
                </Button>
              </Tooltip>
              <Button icon={<FormatPainterOutlined />} onClick={runFormat}>
                格式化
              </Button>
              <Button
                icon={<BookOutlined />}
                onClick={() => {
                  setFavoriteName(`收藏 ${useWorkbenchStore.getState().favorites.length + 1}`);
                  setFavoriteOpen(true);
                }}
              >
                收藏
              </Button>
              {blockExecution && (
                <Button icon={<WarningOutlined />} onClick={() => openReview(activeVersion)}>
                  查看改写草稿
                </Button>
              )}
            </Space>
            <Space size={16} className="editor-meta">
              <Tag color={blockExecution ? 'orange' : 'blue'}>
                标签依据 {tabVersion}
                {tabUnaffected ? ' · 无需改写' : ''}
              </Tag>
              <span>
                <HistoryOutlined /> {complexity.lines} 行 / {complexity.chars} 字符
              </span>
              <span className={complexity.hasLimit ? 'meta-ok' : 'meta-warn'}>
                {complexity.hasLimit ? '已设置 LIMIT' : '建议设置 LIMIT'}
              </span>
              <kbd>⌘ Enter</kbd>
            </Space>
          </div>
          {blockExecution && (
            <Alert
              showIcon
              type="warning"
              className="version-banner"
              message={`该标签查询依据旧结构 ${tabVersion}，当前数据源已切换到 ${activeVersion}，直接执行会报字段不存在或悄悄少列。`}
              description="系统已按新旧字段血缘给出改写草稿；确认后标签才落到新版本。若改写后执行失败，可在对照窗口用原文恢复。"
              action={
                <Button size="small" type="primary" onClick={() => openReview(activeVersion)}>
                  去逐条对照
                </Button>
              }
            />
          )}
          {error && (
            <Alert
              closable
              showIcon
              type="error"
              message={`${errorTitle} [${error.code}] 第 ${error.line} 行，第 ${error.column} 列`}
              description={`${error.message} ${error.hint}`}
              onClose={() => setError(null)}
            />
          )}
          <div className="editor-wrap">
            <SqlEditor
              key={activeTab.id}
              value={activeTab.sql}
              schema={blockExecution ? undefined : schemaQuery.data}
              error={error}
              onChange={(sql) => updateTab(activeTab.id, sql)}
              onExecute={() => void execute()}
              onFormat={runFormat}
            />
          </div>
        </section>
        <ResultGrid result={result} loading={running} error={error?.message ?? null} stale={resultStale} />
      </main>
      <Modal
        open={favoriteOpen}
        title="收藏当前查询"
        okText="保存收藏"
        cancelText="取消"
        onCancel={() => setFavoriteOpen(false)}
        onOk={() => {
          if (!favoriteName.trim()) {
            void message.warning('请输入收藏名称');
            return;
          }
          // 收藏时记下查询依据的结构版本
          addFavorite(favoriteName, activeTab.sql, tabVersion);
          setFavoriteOpen(false);
          void message.success(`查询已收藏（依据 ${tabVersion}）`);
        }}
      >
        <Input
          autoFocus
          value={favoriteName}
          placeholder="例如：华东区高金额订单"
          onChange={(event) => setFavoriteName(event.target.value)}
          onPressEnter={() => {
            addFavorite(favoriteName, activeTab.sql, tabVersion);
            setFavoriteOpen(false);
          }}
        />
        <div className="favorite-version-hint">收藏将保存原文与依据版本 {tabVersion}，结构升级后原文不会被修改。</div>
      </Modal>
      {lastExecutedSql && (
        <div className="execution-footprint" aria-hidden="true">
          {lastExecutedSql.slice(0, 80)}
        </div>
      )}
    </div>
  );
}
