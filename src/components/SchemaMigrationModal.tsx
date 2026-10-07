import {
  ArrowRightOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { Alert, Button, Divider, Modal, Radio, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useWorkbenchStore } from '../stores/workbenchStore';
import { CURRENT_SCHEMA_VERSION, LEGACY_SCHEMA_VERSION } from '../types/sql';
import { analyzeQuerySql, diffSchemaVersions } from '../utils/schemaMigration';

const { Text, Paragraph } = Typography;

interface SchemaMigrationModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm?: () => void;
}

const KIND_LABEL: Record<string, { text: string; color: string }> = {
  moved: { text: '已迁移', color: 'orange' },
  split: { text: '已拆分', color: 'blue' },
  added: { text: '新增', color: 'green' },
};

export function SchemaMigrationModal({ open, onClose, onConfirm }: SchemaMigrationModalProps) {
  const tabs = useWorkbenchStore((state) => state.tabs);
  const applyMigrationDraft = useWorkbenchStore((state) => state.applyMigrationDraft);
  const keepMigrationOriginal = useWorkbenchStore((state) => state.keepMigrationOriginal);
  const confirmMigration = useWorkbenchStore((state) => state.confirmMigration);

  const legacyTabs = useMemo(
    () => tabs.filter((tab) => tab.schemaVersion === LEGACY_SCHEMA_VERSION),
    [tabs],
  );

  const analyses = useMemo(
    () => new Map(legacyTabs.map((tab) => [tab.id, analyzeQuerySql(tab.sql)])),
    [legacyTabs],
  );

  const [choices, setChoices] = useState<Record<string, 'draft' | 'keep'>>({});

  const choiceOf = (tabId: string, status: string): 'draft' | 'keep' =>
    choices[tabId] ?? (status === 'rewritable' ? 'draft' : 'keep');

  const handleConfirm = () => {
    legacyTabs.forEach((tab) => {
      const analysis = analyses.get(tab.id);
      const choice = choiceOf(tab.id, analysis?.status ?? 'pending');
      if (choice === 'draft' && analysis?.status === 'rewritable') {
        applyMigrationDraft(tab.id);
      } else {
        keepMigrationOriginal(tab.id);
      }
    });
    confirmMigration();
    onConfirm?.();
  };

  const diffs = diffSchemaVersions();

  return (
    <Modal
      title={
        <span>
          <InfoCircleOutlined style={{ color: '#1769ff', marginRight: 8 }} />
          数据源结构升级 · {LEGACY_SCHEMA_VERSION} → {CURRENT_SCHEMA_VERSION}
        </span>
      }
      open={open}
      onCancel={onClose}
      width={760}
      footer={[
        <Button key="defer" onClick={onClose}>
          稍后处理
        </Button>,
        <Button key="confirm" type="primary" onClick={handleConfirm}>
          确认升级
        </Button>,
      ]}
    >
      <Alert
        type="warning"
        showIcon
        message="数据仓库本周已切换表结构"
        description="订单表客户名称并入客户表、金额拆分为人民币和美元两列、客户表新增区域编码。标签页中依据旧结构保存的查询需要逐条对照改写；历史和收藏会留住原文与依据版本，不受影响。"
        style={{ marginBottom: 14 }}
      />

      <div className="migration-diff">
        {diffs.map((diff) => {
          const meta = KIND_LABEL[diff.kind] ?? { text: diff.kind, color: 'default' };
          return (
            <div key={`${diff.table}.${diff.column}`} className="migration-diff__item">
              <Tag color={meta.color}>{meta.text}</Tag>
              <Text code>
                {diff.table}.{diff.column}
              </Text>
              <Text type="secondary" className="migration-diff__detail">
                {diff.detail}
              </Text>
            </div>
          );
        })}
      </div>

      <Divider style={{ margin: '14px 0' }} />

      <div className="migration-tabs">
        {legacyTabs.length === 0 && (
          <Alert type="success" showIcon message="所有标签页均已基于当前结构，无需升级。" />
        )}
        {legacyTabs.map((tab) => {
          const analysis = analyses.get(tab.id);
          if (!analysis) return null;
          const choice = choiceOf(tab.id, analysis.status);
          return (
            <div key={tab.id} className="migration-tab">
              <div className="migration-tab__head">
                <strong>{tab.title}</strong>
                {analysis.status === 'rewritable' && (
                  <Tag color="blue" icon={<CheckCircleOutlined />}>
                    可改写
                  </Tag>
                )}
                {analysis.status === 'pending' && (
                  <Tag color="orange" icon={<ExclamationCircleOutlined />}>
                    待处理
                  </Tag>
                )}
                {analysis.status === 'unchanged' && <Tag>不涉及变更</Tag>}
              </div>

              <div className="migration-tab__sql">
                <Text type="secondary" className="migration-tab__label">
                  原文（{LEGACY_SCHEMA_VERSION}）
                </Text>
                <pre className="migration-tab__code">{tab.sql}</pre>
              </div>

              {analysis.status === 'rewritable' && analysis.draftSql && (
                <div className="migration-tab__sql">
                  <Text type="secondary" className="migration-tab__label">
                    改写草稿（{CURRENT_SCHEMA_VERSION}）
                  </Text>
                  <pre className="migration-tab__code migration-tab__code--draft">
                    {analysis.draftSql}
                  </pre>
                </div>
              )}

              {analysis.blockers.length > 0 && (
                <div className="migration-tab__blockers">
                  {analysis.blockers.map((blocker) => (
                    <div key={blocker.column} className="migration-tab__blocker">
                      <ExclamationCircleOutlined />
                      <span>
                        <Text code>{blocker.column}</Text> {blocker.reason}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {analysis.status === 'rewritable' && (
                <Radio.Group
                  value={choice}
                  onChange={(event) =>
                    setChoices((current) => ({ ...current, [tab.id]: event.target.value }))
                  }
                  optionType="button"
                  buttonStyle="solid"
                  size="small"
                  options={[
                    { value: 'draft', label: '应用草稿' },
                    { value: 'keep', label: '保留原文（待处理）' },
                  ]}
                />
              )}
              {analysis.status === 'pending' && (
                <Radio.Group
                  value="keep"
                  disabled
                  optionType="button"
                  buttonStyle="solid"
                  size="small"
                  options={[{ value: 'keep', label: '保留原文（待处理）' }]}
                />
              )}
            </div>
          );
        })}
      </div>

      <Paragraph type="secondary" className="migration-note">
        <ArrowRightOutlined /> 确认后，应用草稿的标签页落到 {CURRENT_SCHEMA_VERSION} 并保留原文可恢复；
        待处理的标签页留在 {LEGACY_SCHEMA_VERSION}，写清原因，不会丢失。
      </Paragraph>
    </Modal>
  );
}
