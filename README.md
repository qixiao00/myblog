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

## 编辑室后台

入口为 `/admin`。支持文章搜索、Markdown 编辑和预览、图片上传、草稿保存、发布、删除；支持留言搜索、分页、隐藏与恢复、置顶、回复以及 JSON 导出。移动端也可使用。

首次进入：

1. 在博客仓库所有者的 GitHub 账号内创建 fine-grained personal access token，只选择 `myblog` 仓库，并为 **Contents** 授予 **Read and write** 权限。
2. 在后台页面内填写令牌，设置至少 12 位的管理员密码。初始化前会核对 GitHub 账号是否为仓库所有者。
3. 密码沿用 Twikoo 管理员身份。如果已有 Twikoo 密码，直接登录，在“后台设置”中连接仓库。

令牌仅通过服务端访问 GitHub，不写入页面、localStorage 或仓库。它保存在加密的 HttpOnly、SameSite Strict 登录 cookie 中，7 天过期；退出登录会删除 cookie。每次后台请求都向 Twikoo 重新验证管理员身份。更换 Twikoo 密码会使已有会话失效。登录限流按服务实例生效，并非跨实例全局限流。

生产环境建议配置独立的 `ADMIN_SESSION_SECRET`（随机生成至少 32 字符）。已有部署未配置时，会从现有 `POSTGRES_URL` 派生独立会话加密密钥；更换该连接串会使已有后台会话失效。可选配置 `ADMIN_GITHUB_TOKEN`，免去每次登录重新连接仓库。仓库和分支可通过 `ADMIN_GITHUB_REPO`、`ADMIN_GITHUB_BRANCH` 覆盖，默认 `qixiao00/myblog`、`master`。配置示例见 `.env.example`。

文章继续写入 `vault/`，图片写入 `vault/assets/uploads/`，每次保存生成 Git 提交，随后由 Vercel 的现有部署流程更新公开网站。已有文章路径固定，保存时检查 GitHub 文件 SHA，避免覆盖他人更新。其他 frontmatter 字段保留。图片最大 4 MB，支持 PNG、JPEG、GIF、WebP。

**草稿不出现在博客页面，但仍会写入 Git 仓库。如果仓库公开，草稿也能在 GitHub 查看，不能用于保存私密内容。** 删除文章可从 Git 历史恢复；留言永久删除不可撤销，建议先导出或使用“隐藏”。留言继续位于现有 Twikoo MongoDB，本后台不迁移数据库。回复沿用现有 Twikoo 反垃圾及验证码设置；如果开启验证码，需要在 Twikoo 原管理面板中完成对应验证后回复。

运行 `npm run test:admin` 验证会话防篡改、跨站保护、初始化身份验证、文章冲突与预览清理。测试使用模拟接口，不写入线上文章或留言。

## 评论服务

评论统一使用 Twikoo。前端脚本位于 `public/vendor/twikoo/`；浏览器通过本站 `/api/twikoo` 读写评论，服务端转发到 `TWIKOO_UPSTREAM_URL`，以免国内访客需要直连可能无法访问的 `*.vercel.app` 后端。原有 `PUBLIC_TWIKOO_ENV_ID` 仍可作为兼容配置，但新部署建议只使用服务端变量。统计页通过 Twikoo 的批量计数接口取得公开评论数，包含回复。Twikoo 不可用时会显示“暂不可用”。

旧 PostgreSQL `comments` 表不再用于页面和 API。升级不会删除历史数据；如果还需要迁移旧评论，可使用 `npm run export:twikoo` 导出。

部署后从国内网络检查留言板、文章评论和 `/api/twikoo`。本站域名本身也需要能在国内访问。

## 浏览量

文章页调用 `/api/view`。服务端用一年有效的匿名浏览器 cookie 识别访客，同一浏览器访问同一篇文章在同一 UTC 日期内只增加一次浏览量；刷新或重复请求不再重复计数。清除 cookie、换设备或使用其他浏览器会被视为新访客，因此它是去重浏览量，不是精确独立人数。旧 `post_views` 数值保留作为历史基数，其中可能包含此前重复请求。

现有数据库在部署新版 `/api/view` **之前**，先执行 `scripts/migrate-unique-views.sql`。这是只新增 `post_view_visitors` 表的迁移，不改动旧计数。运行迁移请使用数据库的直连地址；应用运行仍使用 `POSTGRES_URL`。

## 部署

将仓库的 `master` 分支连接到 Vercel，并设置 `POSTGRES_URL`、`TWIKOO_UPSTREAM_URL`。首次部署前对数据库执行 `scripts/init-engagement.sql`；已有部署按上文执行迁移。之后推送到 `master` 即可触发部署。

Vercel 使用 `pnpm@10.33.0` 和 `pnpm-lock.yaml`。更新依赖时，请同步 `package-lock.json` 和 `pnpm-lock.yaml`，避免生产环境的 frozen-lockfile 检查失败。
