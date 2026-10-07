import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  RollbackOutlined,
} from '@ant-design/icons';
import { Alert, App as AntdApp, Badge, Button, Empty, Modal, Segmented, Tabs, Tag, Tooltip, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { SCHEMA_CHANGELOG } from '../data/schemaMigration';
import { validateAgainstVersion } from '../data/schemaMigration';
import { useNavigate } from 'react-router-dom';
import { useWorkbenchStore } from '../stores/workbenchStore';
import type { MigrationReview } from '../types/sql';

const KIND_LABEL: Record<MigrationReview['kind'], string> = {
  tab: '标签页',
  history: '历史',
  favorite: '收藏',
};

function StatusTag({ status }: { status: MigrationReview['status'] }) {
  if (status === 'confirmed') {
    return (
      <Tag icon={<CheckCircleOutlined />} color="success">
        已确认落地
      </Tag>
    );
  }
  if (status === 'pending') {
    return (
      <Tag icon={<ExclamationCircleOutlined />} color="error">
        待处理（无后继）
      </Tag>
    );
  }
  if (status === 'unaffected') {
    return (
      <Tag icon={<CheckCircleOutlined />} color="default">
        无需改写
      </Tag>
    );
  }
  return (
    <Tag icon={<ClockCircleOutlined />} color="processing">
      待确认草稿
    </Tag>
  );
}

interface ReviewCardProps {
  review: MigrationReview;
  onFocus?: () => void;
}

function ReviewCard({ review, onFocus }: ReviewCardProps) {
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();
  const saveDraft = useWorkbenchStore((state) => state.saveDraft);
  const confirmReview = useWorkbenchStore((state) => state.confirmReview);
  const restoreReview = useWorkbenchStore((state) => state.restoreReview);
  const activateTab = useWorkbenchStore((state) => state.activateTab);
  const addTabFromSource = useWorkbenchStore((state) => state.addTabFromSource);
  const [editing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState(review.draftSql ?? '');
  const [validating, setValidating] = useState(false);

  useEffect(() => {
    setDraftValue(review.draftSql ?? '');
    setEditing(false);
  }, [review.draftSql, review.key]);

  const validationError = useMemo(
    () => (review.draftSql ? validateAgainstVersion(review.draftSql, review.toVersion) : null),
    [review.draftSql, review.toVersion],
  );
  const openInEditor = () => {
    if (review.kind === 'tab') {
      activateTab(review.refId);
    } else {
      addTabFromSource(review.kind, review.refId);
    }
    onFocus?.();
    navigate('/workbench');
  };

  const handleConfirm = async () => {
    if (review.status === 'pending') {
      void message.warning('该查询存在无后继字段，需先人工处理后才能落地');
      return;
    }
    if (editing) {
      saveDraft(review.key, draftValue);
    }
    const sql = editing ? draftValue : review.draftSql ?? '';
    setValidating(true);
    await Promise.resolve();
    const error = validateAgainstVersion(sql, review.toVersion);
    setValidating(false);
    if (error && /不存在|无法解析|不存在于/.test(error)) {
      void message.error(`草稿校验未通过：${error}`);
      return;
    }
    confirmReview(review.key, sql);
    if (review.kind === 'tab') {
      activateTab(review.refId);
    }
    void message.success(
      review.kind === 'tab'
        ? '标签页已确认并落到新版本结构'
        : '已标记确认；原文与依据版本保留不变',
    );
  };

  return (
    <div className="migration-card">
      <div className="migration-card__head">
        <span className="migration-card__title">
          <FileTextOutlined /> {review.title}
        </span>
        <span className="migration-card__tags">
          <Tag>{KIND_LABEL[review.kind]}</Tag>
          <Tag color="default">{review.fromVersion}</Tag>
          <span>→</span>
          <Tag color="blue">{review.toVersion}</Tag>
          <StatusTag status={review.status} />
        </span>
      </div>

      <div className="migration-card__sqls">
        <div className="migration-sql-block">
          <div className="migration-sql-block__label">
            原文（依据 {review.fromVersion}，{review.kind === 'tab' ? '确认前保留' : '永久保留'}）
          </div>
          <pre className="sql-preview migration-sql">{review.originalSql}</pre>
        </div>
        {review.status === 'unaffected' ? (
          <Alert
            type="success"
            showIcon
            className="migration-pending"
            message="该查询无需改写"
            description="引用的表与字段在新版本中保持不变，可继续使用（历史/收藏原文不变；标签页将随版本直接生效）。"
          />
        ) : review.status !== 'pending' ? (
          <div className="migration-sql-block">
            <div className="migration-sql-block__label">
              改写草稿（{review.toVersion}）
              <Button
                type="link"
                size="small"
                icon={<EditOutlined />}
                onClick={() => {
                  setDraftValue(review.draftSql ?? '');
                  setEditing((value) => !value);
                }}
              >
                {editing ? '完成编辑' : '编辑草稿'}
              </Button>
            </div>
            {editing ? (
              <textarea
                className="migration-draft-editor"
                value={draftValue}
                onChange={(event) => setDraftValue(event.target.value)}
                rows={Math.max(4, draftValue.split('\n').length)}
              />
            ) : (
              <pre className="sql-preview migration-sql migration-sql--draft">{review.draftSql}</pre>
            )}
          </div>
        ) : (
          <Alert
            type="error"
            showIcon
            className="migration-pending"
            message="无后继字段，留在待处理"
            description={
              <ul className="migration-reasons">
                {review.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            }
          />
        )}
      </div>

      {review.notes.length > 0 && (
        <ul className="migration-notes">
          {review.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {review.status !== 'pending' && validationError && (
        <Alert
          type="warning"
          showIcon
          className="migration-validate"
          message={
            /join/i.test(validationError)
              ? validationError
              : `草稿在 ${review.toVersion} 校验：${validationError}`
          }
        />
      )}

      <div className="migration-card__actions">
        <Button onClick={openInEditor}>
          {review.kind === 'tab' ? '前往标签页查看' : '在新标签打开原文'}
        </Button>
        {review.status === 'unaffected' ? null : review.status === 'confirmed' ? (
          <Tooltip title="升级失败或改错时，可用原文恢复，标签页回到旧版本并重新进入待确认">
            <Button icon={<RollbackOutlined />} onClick={() => restoreReview(review.key)}>
              从原文恢复
            </Button>
          </Tooltip>
        ) : review.status === 'draft' ? (
          <>
            <Tooltip title="丢弃当前改写，标签页回到旧版本原文，之后可重新生成草稿">
              <Button icon={<RollbackOutlined />} onClick={() => restoreReview(review.key)}>
                从原文恢复
              </Button>
            </Tooltip>
            <Button type="primary" loading={validating} onClick={() => void handleConfirm()}>
              {review.kind === 'tab' ? '确认并落地新版本' : '确认改写建议'}
            </Button>
          </>
        ) : (
          <Tooltip title="该查询引用了在新版本无后继的字段，必须人工处理">
            <Button type="primary" disabled>
              等待人工处理
            </Button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

export function MigrationReviewModal() {
  const reviewOpen = useWorkbenchStore((state) => state.reviewOpen);
  const reviewTarget = useWorkbenchStore((state) => state.reviewTarget);
  const closeReview = useWorkbenchStore((state) => state.closeReview);
  const reviews = useWorkbenchStore((state) => state.reviews);
  const tabs = useWorkbenchStore((state) => state.tabs);
  const history = useWorkbenchStore((state) => state.history);
  const favorites = useWorkbenchStore((state) => state.favorites);
  const [filter, setFilter] = useState<'all' | 'draft' | 'pending' | 'confirmed' | 'unaffected'>('all');
  const [activeGroup, setActiveGroup] = useState<'tab' | 'history' | 'favorite'>('tab');

  // 打开对照时：有待处理优先看待处理，其次看待确认草稿
  useEffect(() => {
    if (!reviewOpen) return;
    if (counts.pending > 0) {
      setFilter('pending');
    } else if (counts.draft > 0) {
      setFilter('draft');
    } else {
      setFilter('all');
    }
    setActiveGroup('tab');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewOpen, reviewTarget]);

  // 过滤掉来源条目已删除的记录，并以当前保存内容为准展示标题
  const liveReviews = useMemo(() => {
    return reviews
      .filter((review) => review.toVersion === reviewTarget)
      .map((review) => {
        if (review.kind === 'tab') {
          const tab = tabs.find((item) => item.id === review.refId);
          return tab ? { ...review, title: tab.title } : null;
        }
        if (review.kind === 'history') {
          return history.some((item) => item.id === review.refId) ? review : null;
        }
        return favorites.some((item) => item.id === review.refId) ? review : null;
      })
      .filter((review): review is MigrationReview => review !== null)
      .sort((a, b) => a.updatedAt - b.updatedAt);
  }, [reviews, reviewTarget, tabs, history, favorites]);

  const grouped = useMemo(
    () => ({
      tab: liveReviews.filter((review) => review.kind === 'tab'),
      history: liveReviews.filter((review) => review.kind === 'history'),
      favorite: liveReviews.filter((review) => review.kind === 'favorite'),
    }),
    [liveReviews],
  );

  const matchFilter = (review: MigrationReview) => filter === 'all' || review.status === filter;

  const counts = useMemo(
    () => ({
      draft: liveReviews.filter((review) => review.status === 'draft').length,
      pending: liveReviews.filter((review) => review.status === 'pending').length,
      confirmed: liveReviews.filter((review) => review.status === 'confirmed').length,
      unaffected: liveReviews.filter((review) => review.status === 'unaffected').length,
    }),
    [liveReviews],
  );

  const changelog = SCHEMA_CHANGELOG[`v1->${reviewTarget}`] ?? SCHEMA_CHANGELOG['v1->v2'];

  const renderList = (list: MigrationReview[]) => {
    const matched = list.filter(matchFilter);
    if (!matched.length) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={list.length === 0 ? '该分组没有需要对照的查询' : '当前筛选下没有记录'}
        />
      );
    }
    return matched.map((review) => <ReviewCard key={review.key} review={review} />);
  };

  const tabBadge = (list: MigrationReview[], status: MigrationReview['status']) =>
    list.filter((review) => review.status === status).length;

  return (
    <Modal
      open={reviewOpen}
      title={
        <span>
          结构版本升级对照 · {changelog.from} → {changelog.to}
        </span>
      }
      width={920}
      footer={
        <div className="migration-footer">
          <span className="migration-footer__summary">
            待确认 <Badge count={counts.draft} showZero color="#1677ff" />
            <Badge count={counts.pending} showZero color="#ff4d4f" /> 待处理
            <Badge count={counts.confirmed} showZero color="#52c41a" /> 已确认
          </span>
          <Button type="primary" onClick={closeReview}>
            完成对照
          </Button>
        </div>
      }
      onCancel={closeReview}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        className="migration-changelog"
        message="本周结构变更"
        description={
          <ul className="migration-notes">
            {changelog.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        }
      />
      {counts.pending > 0 && (
        <Alert
          type="error"
          showIcon
          className="migration-changelog"
          message={`有 ${counts.pending} 条查询引用的字段无后继，已留在待处理；这些标签页在人工处理前不会落到 ${reviewTarget}`}
        />
      )}
      <div className="migration-filter">
        <Segmented
          value={filter}
          onChange={(value) => setFilter(value as typeof filter)}
          options={[
            { label: '全部', value: 'all' },
            { label: `待确认 (${counts.draft})`, value: 'draft' },
            { label: `待处理 (${counts.pending})`, value: 'pending' },
            { label: `已确认 (${counts.confirmed})`, value: 'confirmed' },
            { label: `无需改写 (${counts.unaffected})`, value: 'unaffected' },
          ]}
        />
      </div>
      {liveReviews.length === 0 ? (
        <Empty description="所有保存的查询均依据当前版本，无需改写" />
      ) : (
        <Tabs
          activeKey={activeGroup}
          onChange={(key) => setActiveGroup(key as typeof activeGroup)}
          items={[
            {
              key: 'tab',
              label: (
                <span>
                  标签页{' '}
                  {tabBadge(grouped.tab, 'draft') > 0 && (
                    <Badge count={tabBadge(grouped.tab, 'draft')} color="#1677ff" />
                  )}
                  {tabBadge(grouped.tab, 'pending') > 0 && (
                    <Badge count={tabBadge(grouped.tab, 'pending')} color="#ff4d4f" />
                  )}
                </span>
              ),
              children: renderList(grouped.tab),
            },
            {
              key: 'history',
              label: <span>历史（{grouped.history.length}）</span>,
              children: renderList(grouped.history),
            },
            {
              key: 'favorite',
              label: <span>收藏（{grouped.favorite.length}）</span>,
              children: renderList(grouped.favorite),
            },
          ]}
        />
      )}
      <Typography.Paragraph type="secondary" className="migration-tip">
        历史与收藏的原文和依据版本永久保留，确认动作只记录改写建议；标签页仅在点击“确认并落地新版本”后才切换。
      </Typography.Paragraph>
    </Modal>
  );
}
