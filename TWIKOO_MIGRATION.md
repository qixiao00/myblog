# Twikoo 历史评论迁移（从当前 DB 导出）

## 目标
- 评论区切换到 Twikoo（和参考项目一致的点赞/回复交互）
- 保留现有 PostgreSQL 里的历史评论数据

## 1. 导出当前数据库评论为 Twikoo 导入格式
在项目根目录执行：

```bash
pnpm run export:twikoo
```

默认会生成文件：

```text
twikoo-import-from-db.json
```

如果你想指定文件名：

```bash
node ./scripts/export-db-comments-to-twikoo.mjs ./my-twikoo-import.json
```

## 2. 在 Twikoo 管理面板导入
1. 打开你的 Twikoo 管理面板
2. 进入导入功能
3. 数据源选择 `twikoo`
4. 上传 `twikoo-import-from-db.json`
5. 执行导入

## 3. 导入说明
- 留言板评论会映射到 `/guestbook`
- 博客评论会映射到 `/notes/<slug>`
- 回复层级会保留（`pid` / `rid` 已转换）
- 点赞数会转换为 `ups` 数组（用于恢复点赞计数）

## 4. 安全说明
- 该导出不会删除你现有 PostgreSQL 数据
- 建议在导入前备份 Twikoo 现有数据，避免重复导入
