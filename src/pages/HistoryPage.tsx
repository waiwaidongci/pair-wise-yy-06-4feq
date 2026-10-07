import { ClockCircleOutlined, DeleteOutlined, PlayCircleOutlined, StarOutlined } from '@ant-design/icons';
import { App as AntdApp, Button, Empty, List, Popconfirm, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useWorkbenchStore } from '../stores/workbenchStore';

export function HistoryPage() {
  const { message } = AntdApp.useApp();
  const history = useWorkbenchStore((state) => state.history);
  const clearHistory = useWorkbenchStore((state) => state.clearHistory);
  const addTab = useWorkbenchStore((state) => state.addTab);
  const addFavorite = useWorkbenchStore((state) => state.addFavorite);
  const activeVersion = useWorkbenchStore((state) => state.activeVersion);
  const navigate = useNavigate();

  const openSql = (sql: string, schemaVersion: string, favorite = false) => {
    if (favorite) {
      addFavorite(`历史收藏 ${Date.now().toString().slice(-4)}`, sql, schemaVersion);
      void message.success(`已加入收藏（原文依据 ${schemaVersion}）`);
      return;
    }
    // 打开历史原文时，新标签继承其依据版本；与当前版本不一致会进入迁移对照
    addTab(sql, schemaVersion);
    navigate('/workbench');
  };

  return (
    <div className="content-page">
      <div className="content-page__heading">
        <div>
          <Typography.Title level={2}>查询历史</Typography.Title>
          <Typography.Text type="secondary">
            最近 100 次执行记录保存在本机浏览器，每条记录保留原文和依据的结构版本。
          </Typography.Text>
        </div>
        {history.length > 0 && (
          <Popconfirm title="确认清空全部查询历史？" onConfirm={clearHistory}>
            <Button danger icon={<DeleteOutlined />}>
              清空历史
            </Button>
          </Popconfirm>
        )}
      </div>
      <div className="content-card">
        {history.length ? (
          <List
            itemLayout="vertical"
            dataSource={history}
            renderItem={(item) => {
              const pinned = item.schemaVersion !== activeVersion;
              return (
                <List.Item
                  key={item.id}
                  actions={[
                    <Button
                      key="open"
                      type="link"
                      icon={<PlayCircleOutlined />}
                      onClick={() => openSql(item.sql, item.schemaVersion)}
                    >
                      在编辑器中打开原文
                    </Button>,
                    <Button
                      key="favorite"
                      type="link"
                      icon={<StarOutlined />}
                      onClick={() => openSql(item.sql, item.schemaVersion, true)}
                    >
                      收藏
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <span>
                        <ClockCircleOutlined /> {new Date(item.executedAt).toLocaleString('zh-CN')}
                        <Tag color={item.success ? 'green' : 'red'} style={{ marginLeft: 10 }}>
                          {item.success ? `${item.rowCount} 行` : '失败'}
                        </Tag>
                        {item.success && <span className="muted-text">{item.elapsedMs} ms</span>}
                        <Tag color={pinned ? 'orange' : 'blue'} style={{ marginLeft: 8 }}>
                          依据 {item.schemaVersion}
                          {pinned ? ` · 当前 ${activeVersion}` : ''}
                        </Tag>
                      </span>
                    }
                    description={
                      <pre className="sql-preview">{item.sql}</pre>
                    }
                  />
                  {item.error && <Typography.Text type="danger">{item.error}</Typography.Text>}
                  {pinned && (
                    <Typography.Text type="warning">
                      该原文依据旧结构 {item.schemaVersion}，打开后需通过升级对照改写；历史原文不会被修改。
                    </Typography.Text>
                  )}
                </List.Item>
              );
            }}
          />
        ) : (
          <Empty description="执行 SQL 后，这里会记录查询和耗时" />
        )}
      </div>
    </div>
  );
}
