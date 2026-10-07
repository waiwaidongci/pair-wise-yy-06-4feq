import { BranchesOutlined, SwapOutlined } from '@ant-design/icons';
import { App as AntdApp, Badge, Button, Popconfirm, Tag, Tooltip } from 'antd';
import { SCHEMA_VERSIONS } from '../data/mockDatabase';
import { useMemo } from 'react';
import { useWorkbenchStore } from '../stores/workbenchStore';

export function VersionSwitcher() {
  const { modal } = AntdApp.useApp();
  const activeVersion = useWorkbenchStore((state) => state.activeVersion);
  const setActiveVersion = useWorkbenchStore((state) => state.setActiveVersion);
  const openReview = useWorkbenchStore((state) => state.openReview);
  const reviews = useWorkbenchStore((state) => state.reviews);

  const pendingCount = useMemo(
    () =>
      reviews.filter(
        (review) =>
          review.toVersion === activeVersion &&
          (review.status === 'draft' || review.status === 'pending') &&
          review.kind === 'tab',
      ).length,
    [reviews, activeVersion],
  );

  const switchVersion = (version: string) => {
    if (version === activeVersion) return;
    modal.confirm({
      title: `切换数据源结构版本到 ${version}？`,
      icon: <SwapOutlined />,
      content:
        '切换后已跑出的查询结果将立即失效（不可复制或导出），系统会逐条对照标签页、历史和收藏中的旧查询并给出改写草稿，确认后标签页才会落到新版本。',
      okText: '切换并逐条对照',
      cancelText: '取消',
      onOk: () => setActiveVersion(version),
    });
  };

  return (
    <div className="version-switcher">
      <div className="version-switcher__head">
        <BranchesOutlined />
        <span>结构版本</span>
        <Tag color="blue" className="version-switcher__current">
          当前 {activeVersion}
        </Tag>
      </div>
      <div className="version-switcher__options">
        {SCHEMA_VERSIONS.map((item) => (
          <button
            key={item.version}
            type="button"
            className={`version-option${item.version === activeVersion ? ' version-option--active' : ''}`}
            onClick={() => switchVersion(item.version)}
            title={`切换到 ${item.label}`}
          >
            <span className="version-option__dot" />
            <span className="version-option__label">{item.label}</span>
            {item.version === activeVersion && <span className="version-option__check">●</span>}
          </button>
        ))}
      </div>
      <Popconfirm
        title={`打开 ${activeVersion} 升级对照清单？`}
        description="逐条查看标签页、历史、收藏的改写草稿与待处理项"
        onConfirm={() => openReview(activeVersion)}
      >
        <Tooltip title="查看旧版本查询的改写草稿与待处理项">
          <Button block size="small" className="version-switcher__review">
            <Badge count={pendingCount} size="small" offset={[18, -2]} color="red">
              升级对照与待处理
            </Badge>
          </Button>
        </Tooltip>
      </Popconfirm>
    </div>
  );
}
