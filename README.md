# Nebula SQL 查询工作台

基于 React、TypeScript、Vite、Ant Design、Monaco Editor、Zustand、TanStack Query
和 React Router 构建的浏览器 SQL 工作台。执行引擎完全运行在前端内存中，不依赖后端。

## 功能

- 数据库 / 表 / 字段结构树与模糊检索
- 多标签 SQL 编辑器、语法高亮、自动补全、格式化与错误行标记
- `Ctrl/Cmd + Enter` 执行，长查询可取消
- 自研简单 `SELECT / WHERE / ORDER BY / LIMIT` 解析与过滤
- 虚拟滚动结果表、列宽调整、双击复制、CSV 导出和分页
- 查询历史、收藏语句、错误信息中文映射
- 使用 localStorage 持久化标签页、历史和收藏

## 结构版本管理（v1 → v2）

本周数仓结构变更：`orders.customer_name` 并入 `customers`（orders 改 `customer_id` 关联）、
`orders.amount` 拆为 `amount_cny` / `amount_usd`、`customers` 新增 `region_code`、
`orders.channel` 下线（无后继）。

- **数据源带结构版本**：侧边栏可在 v1 / v2 间切换，执行引擎按版本取结构，结果带版本戳
- **保存即记版本**：标签页、历史、收藏均记录依据的结构版本；旧的本地数据启动时自动补标为 v1
- **切版本逐条对照**：切换时对所有标签页、历史、收藏逐一比对新旧字段血缘：
  - 有后继（迁移 / 拆分）→ 生成可编辑的改写草稿与口径说明
  - 无后继（如 `channel`）→ 留在待处理，写清“字段无后继”的原因
  - 不受影响 → 标记“无需改写”
  - 对照记录持久化，升级中断 / 失败都不丢失
- **确认后才落地**：标签页只有在对照窗口确认草稿后才切到新版本；历史与收藏永久保留原文和依据版本
- **失败可恢复**：确认后执行失败，可一键“从原文恢复”，标签回到旧版本原文重新待处理
- **结果立即失效**：版本一变，旧版本结果标记为“已失效”，禁止复制单元格 / 复制结果 / 导出 CSV

## 运行

```bash
export PATH="/Applications/ChatGPT.app/Contents/Resources/cua_node/bin:$PATH"
corepack pnpm install
corepack pnpm dev
corepack pnpm build
```

支持示例：

```sql
SELECT order_no, customer_name, amount, status
FROM orders
WHERE amount > 5000 AND status = '已完成'
ORDER BY amount DESC
LIMIT 200;
```
