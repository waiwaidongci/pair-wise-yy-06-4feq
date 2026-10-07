import { CopyOutlined, DownloadOutlined, TableOutlined } from '@ant-design/icons';
import { App as AntdApp, Button, Empty, Spin, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { TableProps } from 'antd';
import { useEffect, useMemo, useState, type ThHTMLAttributes } from 'react';
import type { QueryResult, SqlValue } from '../types/sql';
import { CURRENT_SCHEMA_VERSION } from '../types/sql';

interface ResultGridProps {
  result: QueryResult | null;
  loading: boolean;
  error: string | null;
  /** 版本切换导致结果失效 */
  stale?: boolean;
}

interface ResizableTitleProps extends ThHTMLAttributes<HTMLTableCellElement> {
  width?: number;
  onResize?: (width: number) => void;
}

function ResizableTitle({ width, onResize, children, ...restProps }: ResizableTitleProps) {
  if (!width || !onResize) {
    return <th {...restProps}>{children}</th>;
  }
  return (
    <th {...restProps}>
      <div className="resizable-title">
        <span>{children}</span>
        <span
          className="column-resizer"
          onMouseDown={(event) => {
            event.preventDefault();
            const startX = event.clientX;
            const startWidth = width;
            const onMouseMove = (moveEvent: MouseEvent) => {
              onResize(Math.max(90, startWidth + moveEvent.clientX - startX));
            };
            const onMouseUp = () => {
              document.removeEventListener('mousemove', onMouseMove);
              document.removeEventListener('mouseup', onMouseUp);
            };
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
          }}
        />
      </div>
    </th>
  );
}

function normalizeRow(row: Record<string, SqlValue>): Record<string, SqlValue> {
  return row;
}

export function ResultGrid({ result, loading, error, stale = false }: ResultGridProps) {
  const { message } = AntdApp.useApp();
  const [widths, setWidths] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!result) return;
    setWidths(
      Object.fromEntries(
        result.columns.map((column) => [
          column.name,
          Math.max(130, Math.min(260, column.name.length * 14 + 60)),
        ]),
      ),
    );
  }, [result]);

  const invalid = stale || (result ? result.schemaVersion !== CURRENT_SCHEMA_VERSION : false);

  const copyValue = async (value: SqlValue) => {
    if (invalid) return;
    await navigator.clipboard.writeText(value === null ? 'NULL' : String(value));
    void message.success('单元格内容已复制');
  };

  const dataSource = useMemo(
    () =>
      (result?.rows ?? []).map((row, index) => ({
        ...normalizeRow(row),
        __rowKey: index,
      })),
    [result],
  );
  const resultWidth = useMemo(
    () =>
      result?.columns.reduce(
        (sum, column) => sum + (widths[column.name] ?? 160),
        0,
      ) ?? 0,
    [result, widths],
  );

  const columns = useMemo<ColumnsType<Record<string, SqlValue | number>>>(() => {
    if (!result) return [];
    return result.columns.map((column) => ({
      title: column.name,
      dataIndex: column.name,
      key: column.name,
      width: widths[column.name] ?? 160,
      ellipsis: true,
      render: (value: SqlValue) => (
        <span
          className={value === null ? 'null-value' : 'result-cell'}
          title={invalid ? '结果已失效，不能复制' : '右键复制单元格'}
          onContextMenu={(event) => {
            event.preventDefault();
            if (invalid) return;
            void copyValue(value);
          }}
        >
          {value === null ? 'NULL' : String(value)}
        </span>
      ),
      onHeaderCell: () => ({
        width: widths[column.name] ?? 160,
        onResize: (width: number) =>
          setWidths((current) => ({ ...current, [column.name]: width })),
      }),
    }));
  }, [result, widths]);

  const exportCsv = () => {
    if (!result || invalid) return;
    const header = result.columns.map((column) => column.name).join(',');
    const rows = result.rows.map((row) =>
      result.columns
        .map((column) => `"${String(row[column.name] ?? '').replaceAll('"', '""')}"`)
        .join(','),
    );
    const blob = new Blob([`\uFEFF${[header, ...rows].join('\n')}`], {
      type: 'text/csv;charset=utf-8',
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `query-result-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const tableProps: TableProps<Record<string, SqlValue | number>> = {
    virtual: true,
    size: 'small',
    bordered: true,
    rowKey: '__rowKey',
    scroll: { x: Math.max(640, resultWidth), y: 330 },
    components: {
      header: {
        cell: ResizableTitle,
      },
    },
    pagination: {
      defaultPageSize: 100,
      pageSizeOptions: [50, 100, 200, 500],
      showSizeChanger: true,
      showQuickJumper: true,
      showTotal: (total) => `共 ${total} 行`,
      size: 'small',
    },
  };

  return (
    <section className="result-pane">
      <div className="result-heading">
        <div className="result-heading__title">
          <TableOutlined />
          <strong>查询结果</strong>
          {result && (
            <>
              <Tag color={result.truncated ? 'orange' : 'green'}>
                {result.rowCount.toLocaleString('zh-CN')} 行
              </Tag>
              <span>匹配 {result.totalMatched.toLocaleString('zh-CN')} 行</span>
              <span>· {result.elapsedMs} ms</span>
            </>
          )}
        </div>
        <div>
          <Button
            type="text"
            size="small"
            icon={<CopyOutlined />}
            disabled={!result || invalid}
            onClick={() => {
              if (!result || invalid) return;
              void navigator.clipboard
                .writeText(
                  [
                    result.columns.map((column) => column.name).join('\t'),
                    ...result.rows.map((row) =>
                      result.columns.map((column) => row[column.name] ?? '').join('\t'),
                    ),
                  ].join('\n'),
                )
                .then(() => message.success('结果已复制为制表符文本'));
            }}
          >
            复制
          </Button>
          <Button
            type="text"
            size="small"
            icon={<DownloadOutlined />}
            disabled={!result || invalid}
            onClick={exportCsv}
          >
            CSV
          </Button>
        </div>
      </div>
      {invalid && result && (
        <div className="result-invalid-banner">
          <strong>结果已失效</strong>
          <span>
            该结果基于旧结构 {result.schemaVersion} 产出，数据源已升级到 {CURRENT_SCHEMA_VERSION}
            ，列结构已变化，不能再复制或导出。请在确认改写后重新执行查询。
          </span>
        </div>
      )}
      <div className={`result-body${invalid ? ' result-body--invalid' : ''}`}>
        {loading ? (
          <div className="result-state">
            <Spin size="large" />
            <span>模拟数据源正在执行查询…</span>
          </div>
        ) : error ? (
          <div className="result-error">
            <strong>查询未能执行</strong>
            <span>{error}</span>
            <small>错误位置已在编辑器中高亮，可按 Esc 关闭提示后修改 SQL。</small>
          </div>
        ) : result ? (
          <Table<Record<string, SqlValue | number>>
            {...tableProps}
            columns={columns}
            dataSource={dataSource}
          />
        ) : (
          <Empty
            className="result-empty"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="执行查询后，结果将在这里显示"
          />
        )}
      </div>
    </section>
  );
}
