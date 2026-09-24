# Paper Trail

基于 Astro、Obsidian 笔记库和 Vercel 的个人刊物。文章内容放在 `vault/`，公开页面包括笔记、留言板和站点统计。

## 本地开发

1. `npm install`
2. 将数据库连接配置为 `POSTGRES_URL`，将 Twikoo 后端 HTTPS 地址配置为 `TWIKOO_UPSTREAM_URL`。本地可以写在 `.env.local`；不要提交这个文件。
3. 对新数据库执行 `scripts/init-engagement.sql`。
4. `npm run dev`

提交前运行 `npm run check` 和 `npm run build`。`predev` 和 `prebuild` 会将 `vault/` 中的附件同步到 `public/_vault/`。

## 内容格式

每篇公开笔记至少包含：

```yaml
---
title: 笔记标题
date: 2026-04-08
updated: 2026-04-08
description: 一句简介
tags:
  - tag-a
  - tag-b
draft: false
---
```

支持标准 Markdown、`[[内部链接]]`、`[[内部链接|别名]]`、Obsidian callout、嵌入附件及相对路径图片。

## 评论

评论统一使用 Twikoo。前端脚本位于 `public/vendor/twikoo/`；浏览器通过本站 `/api/twikoo` 读写评论，服务端转发到 `TWIKOO_UPSTREAM_URL`，以免国内访客需要直连可能无法访问的 `*.vercel.app` 后端。原有 `PUBLIC_TWIKOO_ENV_ID` 仍可作为兼容配置，但新部署建议只使用服务端变量。统计页通过 Twikoo 的批量计数接口取得公开评论数，包含回复。Twikoo 不可用时会显示“暂不可用”。

旧 PostgreSQL `comments` 表不再用于页面和 API。升级不会删除历史数据；如果还需要迁移旧评论，可使用 `npm run export:twikoo` 导出。

部署后从国内网络检查留言板、文章评论和 `/api/twikoo`。本站域名本身也需要能在国内访问。

## 浏览量

文章页调用 `/api/view`。服务端用一年有效的匿名浏览器 cookie 识别访客，同一浏览器访问同一篇文章在同一 UTC 日期内只增加一次浏览量；刷新或重复请求不再重复计数。清除 cookie、换设备或使用其他浏览器会被视为新访客，因此它是去重浏览量，不是精确独立人数。旧 `post_views` 数值保留作为历史基数，其中可能包含此前重复请求。

现有数据库在部署新版 `/api/view` **之前**，先执行 `scripts/migrate-unique-views.sql`。这是只新增 `post_view_visitors` 表的迁移，不改动旧计数。运行迁移请使用数据库的直连地址；应用运行仍使用 `POSTGRES_URL`。

## 部署

将仓库的 `master` 分支连接到 Vercel，并设置 `POSTGRES_URL`、`TWIKOO_UPSTREAM_URL`。首次部署前对数据库执行 `scripts/init-engagement.sql`；已有部署按上文执行迁移。之后推送到 `master` 即可触发部署。
