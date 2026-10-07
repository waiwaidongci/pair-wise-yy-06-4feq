import { DeleteOutlined, PlayCircleOutlined, StarFilled } from '@ant-design/icons';
import { App as AntdApp, Button, Card, Empty, Popconfirm, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useWorkbenchStore } from '../stores/workbenchStore';

export function FavoritesPage() {
  const { message } = AntdApp.useApp();
  const favorites = useWorkbenchStore((state) => state.favorites);
  const removeFavorite = useWorkbenchStore((state) => state.removeFavorite);
  const addTab = useWorkbenchStore((state) => state.addTab);
  const activeVersion = useWorkbenchStore((state) => state.activeVersion);
  const navigate = useNavigate();

  return (
    <div className="content-page">
      <div className="content-page__heading">
        <div>
          <Typography.Title level={2}>收藏查询</Typography.Title>
          <Typography.Text type="secondary">
            收藏永久保留原文与依据的结构版本；在新标签打开时继承原版本，结构升级后需改写确认。
          </Typography.Text>
        </div>
      </div>
      {favorites.length ? (
        <div className="favorite-grid">
          {favorites.map((favorite) => {
            const pinned = favorite.schemaVersion !== activeVersion;
            return (
              <Card
                key={favorite.id}
                className="favorite-card"
                title={
                  <span>
                    <StarFilled className="favorite-star" /> {favorite.name}
                  </span>
                }
                extra={
                  <Popconfirm
                    title="删除这条收藏？"
                    onConfirm={() => {
                      removeFavorite(favorite.id);
                      void message.success('收藏已删除');
                    }}
                  >
                    <Button type="text" danger size="small" icon={<DeleteOutlined />} />
                  </Popconfirm>
                }
              >
                <div className="favorite-card__tags">
                  <Tag color={pinned ? 'orange' : 'blue'}>
                    依据 {favorite.schemaVersion}
                    {pinned ? ` · 当前 ${activeVersion}` : ''}
                  </Tag>
                </div>
                <pre className="sql-preview">{favorite.sql}</pre>
                {pinned && (
                  <Typography.Text type="warning" className="favorite-card__hint">
                    原文依据旧结构，打开后请在升级对照中确认改写草稿。
                  </Typography.Text>
                )}
                <Button
                  type="primary"
                  ghost
                  block
                  icon={<PlayCircleOutlined />}
                  onClick={() => {
                    addTab(favorite.sql, favorite.schemaVersion);
                    navigate('/workbench');
                  }}
                >
                  在新标签中打开原文
                </Button>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="content-card">
          <Empty description="还没有收藏查询，可在编辑器中点击收藏按钮添加" />
        </div>
      )}
    </div>
  );
}
