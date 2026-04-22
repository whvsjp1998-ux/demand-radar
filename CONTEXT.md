## 项目：需求雷达 Demand Radar

## 技术栈
- **框架**：Next.js 15.3 (App Router, TypeScript)
- **样式**：Tailwind CSS + 自定义 glass-card 组件
- **图标**：Material Symbols Outlined（via fonts.loli.net CDN，Google Fonts 国内镜像）
- **AI 分析**：DeepSeek API (`deepseek-chat`，批量每次最多 10 条)
- **数据源**：Reddit 公共 JSON API + Product Hunt GraphQL API
- **持久化**：Supabase (PostgreSQL)，懒加载初始化防止未配置时崩溃
- **部署**：本地 `npm run dev`，端口 3001（3000 被占用时自动递增）

## 已完成
- Reddit 帖子抓取（多个 subreddit，浏览器 User-Agent 绕过 403，工具相关预过滤）
- Product Hunt 帖子抓取（GraphQL API，过滤 Productivity/Developer Tools/AI 等话题，id 前缀 `ph_`）
- DeepSeek AI 批量分析（每批 10 条，返回评分/摘要/关键词/竞争度/标签）
- Supabase 持久化（帖子存储 + AI 分析结果存储 + 用户状态标签存储）
- 启动时从 DB 加载已分析结果，跳过重复分析（`skipIds` 机制）
- 排序：按热度（upvotes）/ 按 AI 评分
- 筛选：全部 / 可行 / 待审核
- 状态标记：可行 / 待审核 / 暂缓（实时同步到 Supabase）
- 全中文 UI，侧边栏 + 卡片列表 + 详情面板布局
- 详情面板：AI 评分进度条、需求洞察摘要、SEO 关键词、竞争难度标签
- Skeleton loading 占位动画

## 进行中
- Supabase 持久化端到端测试（anon key 已填入 `.env.local`，建表后待验证完整流程）

## 下一步
- 搜索功能（目前搜索框为 UI 占位，无实际过滤逻辑）
- 更多数据源（Indie Hackers、HackerNews）
- 用户系统（替换硬编码的 "Alex Chen"）
- 导出功能（CSV / Notion）
- 定时自动抓取（cron job）
- 部署到 Vercel

## 重要备注
- **Reddit 403**：必须用浏览器 User-Agent，自定义 UA 会被封
- **Reddit 预过滤**：`isToolRelated()` 用 TOOL_SIGNALS / EXCLUDE_SIGNALS 过滤无关帖，减少 AI API 调用
- **Google Fonts 国内被封**：Material Symbols 图标必须用 `fonts.loli.net` 镜像，否则图标变乱码
- **Supabase 懒加载**：`db()` 工厂函数而非模块级 `createClient()`，防止未配置时崩溃
- **DeepSeek 批量**：系统 prompt 要求返回带 `index` 字段的 JSON 数组，解析用 `index` 匹配而非位置，容错性更强
- **Product Hunt token**：OAuth Bearer token（非 API key），从开发者后台获取
- **Supabase anon key 新格式**：以 `sb_publishable_` 开头（非旧版 JWT 格式）
- **MiniMax 已弃用**：原用国内 `api.minimaxi.com`（多一个 i），`sk-api-` 前缀才有 LLM 权限，`sk-cp-` 是订阅 key 无权限

## 环境变量清单（不填值，只列 key 名）
- `DEEPSEEK_API_KEY`
- `PRODUCT_HUNT_TOKEN`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
