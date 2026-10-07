import { CloseOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Tabs, Tag } from 'antd';
import type { QuerySession } from '../types/sql';

interface QueryTabsProps {
  tabs: QuerySession[];
  activeTabId: string;
  activeVersion: string;
  onActivate: (id: string) => void;
  onAdd: () => void;
  onClose: (id: string) => void;
}

export function QueryTabs({
  tabs,
  activeTabId,
  activeVersion,
  onActivate,
  onAdd,
  onClose,
}: QueryTabsProps) {
  return (
    <div className="query-tabs">
      <Tabs
        activeKey={activeTabId}
        onChange={onActivate}
        onEdit={(key, action) => {
          if (action === 'add') onAdd();
          if (action === 'remove') onClose(String(key));
        }}
        type="editable-card"
        hideAdd
        items={tabs.map((tab) => {
          const pinned = tab.schemaVersion !== activeVersion;
          return {
            key: tab.id,
            label: (
              <span className="tab-label">
                <span className={`tab-status${pinned ? ' tab-status--pinned' : ''}`} />
                {tab.title}
                {pinned && (
                  <Tag color="orange" className="tab-version-tag">
                    {tab.schemaVersion}
                  </Tag>
                )}
              </span>
            ),
            closable: true,
          };
        })}
      />
      <Button
        type="text"
        className="add-query-tab"
        icon={<PlusOutlined />}
        title="新建查询标签"
        onClick={onAdd}
      />
      <span className="query-tabs__spacer" />
      <Button
        type="text"
        icon={<CloseOutlined />}
        title="关闭当前标签"
        onClick={() => onClose(activeTabId)}
      />
    </div>
  );
}
