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

## 结构版本（v1 → v2）

数据源带结构版本，标签页、历史和收藏各自记录依据的版本。本周结构变更：

- `orders.customer_name` 移除，并入 `customers` 表（需关联取数，无同表后继）
- `orders.amount` 拆分为 `amount_cny`（人民币）/ `amount_usd`（美元）
- `customers` 新增 `region_code`（区域编码）列

升级流程：

1. 打开应用时自动检测依据旧结构的标签页，弹出升级向导
2. 逐条对照新旧结构：有后继的给出改写草稿（如 `amount` → `amount_cny`），无后继或
   `SELECT *` 悄悄少列的留在待处理并写清原因（如 `customer_name` 需关联客户表）
3. 确认后标签页落到新版本，原文保留可随时恢复；历史和收藏留住原文与依据版本
4. 版本一切换，已跑出的结果立即失效，失效结果不能再复制或导出

## 运行

```bash
export PATH="/Applications/ChatGPT.app/Contents/Resources/cua_node/bin:$PATH"
corepack pnpm install
corepack pnpm dev
corepack pnpm build
```

支持示例：

```sql
SELECT order_no, amount_cny, status
FROM orders
WHERE amount_cny > 5000 AND status = '已完成'
ORDER BY amount_cny DESC
LIMIT 200;
```
