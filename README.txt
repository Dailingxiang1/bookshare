BookShare — Coursework 1 / Coursework 2
Student: 祝德阳 202315030125

本目录对应 Coursework 1 (1).docx 和 Coursework 2 (1).docx 中的 Azure 云原生多媒体共享作业。
主题：书籍封面与原创 PDF 读书笔记共享平台。
此项目与工作区中先前的 Flask/MongoDB 版本分别保存。

先看 docs/Account-and-Deployment.html：账号数量、注册顺序、部署步骤和当前完成状态。
再看 docs/CW2-Video.txt：不超过 5 分钟的个人演示安排及实际证据要求。

本地启动
1. 使用 Node.js 22.13 或更高版本。
2. 在本目录执行 npm ci。
3. 执行 npm start，打开 http://127.0.0.1:7073。
也可以执行 powershell -File scripts/Start-Local.ps1。
首次运行生成三份原创示例 PDF，数据保存在 .local，重启后仍存在。

功能
- PDF、PNG、JPEG 上传，大小/文件头/尺寸检查及真实 SHA-256。
- 列表、搜索、分类、排序、详情、PDF 多页渲染、图片预览和下载。
- 修改元数据、删除文件及其记录。
- 云端管理口令保护写操作。当前本机演示不需要口令。
- 已实现真实 Azure Translator 调用代码。没有云端密钥时明确禁用翻译。

验证
npm run check
npm test
npm run test:ci
npm run build
2026-10-26：Node.js 22.23.3 的 35 项测试通过；JUnit 结果写入 reports/junit.xml。Azure 适配器单元测试仍使用模拟传输，另有实际云端检查。
Azure Functions SDK 在单元测试中显示 test mode 提示属正常现象。
2026-10-26：学生在实际 Azure Cloud Shell 执行 Verify，15 项云端 HTTP 检查通过，包括完整 CRUD、文件字节、Function 检查和 Translator。另行检查网站、健康接口、浏览器 CORS 预检及 PDF.js 资源均成功。Azure DevOps 实际构建仍待完成。

云端结构
web/                 静态前端，构建后部署到 Azure Storage $web
server/azure-entry.cjs Azure Function 网关、写权限和文件检查
server/azure-store.cjs 所有云端 CRUD 委托给 Logic Apps
infra/main.json       Storage、Cosmos DB NoSQL、Function、Translator 的 ARM 模板
infra/workflow-factory.cjs 从真实 connector Swagger 生成六个 Logic Apps
azure-pipelines.yml   GitHub -> Azure DevOps 前端构建、测试、产物流水线
scripts/              分阶段资源部署、工作流生成、发布及打包

云端部署后的自动检查：设置 BOOKSHARE_BASE_URL 为 Function 的 HTTPS Origin、
BOOKSHARE_WRITE_TOKEN 为本机保存的管理口令，再运行 node scripts/smoke.cjs。
脚本只新增并删除自己创建的测试资料，并要求实际 Translator 调用成功。
Cloud Shell 部署包可直接执行 scripts/Deploy-CloudShell.ps1 -Stage Verify -Apply，口令由脚本从本地文件读取。
HTTP 检查之外，还需要在 Portal 核对 Blob/Cosmos 删除结果及工作流运行历史。
流水线使用 BOOKSHARE_API_BASE 把公开 API Origin 写入构建产物；未设置该变量时，普通本地构建保持相对 API 路径。

本地演示使用文件存储适配器，不会声称已连接 Azure。
实际网站：https://booksharenpvsnrw3.z28.web.core.windows.net
健康接口：https://bookshare-npvsnrw3-api.azurewebsites.net/api/health
GitHub 目标仓库：https://github.com/Dailingxiang1/bookshare
待完成：GitHub 源码提交、Azure DevOps 实际成功构建、浏览器预览及 Portal 证据核对、本人录制视频。
CW2 必须完成这些真实云端环节，不能只提交本地网页或这份源码。

项目边界
- 每个文件最多 5 MiB，只接受 PDF、PNG、JPEG。
- 修改只更新元数据。更换文件时应新增资料。
- 公共读取、共享管理口令，不提供个人账户和逐人文件权限。
- 文件头检查不等于完整格式验证或病毒扫描。
- 跨 Blob / Cosmos 的写入没有分布式事务。失败运行可能需要孤立文件清理。
- 列表最多读取 20 个 connector 页面，不能声称无限容量；后续应增加游标分页和服务器搜索。
- 仅上传原创、公共领域或已获授权的资料。

依赖与来源
Azure Functions Node.js SDK: Microsoft，MIT（见安装包许可）。
PDF.js 6.4.299: Mozilla and individual contributors，Apache-2.0。
PDF.js 被复制到 web/vendor，许可在 web/vendor/LICENSE.txt，构建无需公共 CDN。
所有 Azure / 账号官方来源链接见 docs/Account-and-Deployment.html。
