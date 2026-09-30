# 贡献指南

感谢你关注 KnowTrace。项目优先接受范围清晰、行为可验证、不会模糊“记录、主张、证据与结论”边界的改动。

## 开始之前

1. 对较大的功能或行为变更，先创建 Issue 说明目标、使用场景和验收方式。
2. 不要提交真实 API Key、账号凭据、数据库备份、用户记录或证据附件。
3. 保持一次 Pull Request 只解决一个主题，避免无关重构和依赖升级。

## 本地开发

要求：Node.js、pnpm、Go、Docker Desktop，以及 Windows PowerShell 或兼容环境。

```bash
pnpm install
make up
```

如果环境中没有 GNU Make，可运行：

```powershell
.\scripts\start-all.ps1
```

## 提交前验证

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
cd services/go-user-system && go test ./...
```

涉及迁移、鉴权、Workspace、导入导出或附件的改动，还应补充对应的真实数据库或端到端验证，并在 Pull Request 中区分单元测试、本地集成测试和部署验证。

### 部署验证

在 VPS 上部署用 `scripts/linux/deploy-observability.sh --build-app`（或 `make deploy`）。
**不要手写 `docker compose up -d --build`** —— 必须同时给两个 `--env-file` 和三个 `-f`
（`scripts/linux/deploy-observability.sh:48` 是唯一的权威写法）：

```bash
docker compose --project-directory .   --env-file .env --env-file .env.observability   -f compose.yaml -f compose.production.yaml -f compose.observability.yaml   up -d --no-deps --build --wait app
```

**`--build-app` 是关键开关**：不带它时脚本走 `--no-build`，只重启旧镜像却照样报成功。
2026-09-29 观察到的「部署目录 HEAD 47a4c20 / 运行中 7ce26f7d，差 37 个提交」就是这么来的。

脚本在最后一步断言运行态：不一致时，若两者之间 `src/`、`drizzle/` 或构建相关文件
**有变化**则以退出码 2 失败；**没有变化**则只告警（只改监控配置时不一致是预期的）。
这条断言是必要的：`git pull` 成功、`HEAD` 对得上、容器 healthy、探针 200，
**都不能证明跑的是新代码**。

## Pull Request

- 说明问题、解决方案、风险和回滚方式。
- 列出修改文件和实际执行的验证命令。
- UI 变化请附截图，但先移除真实姓名、记录正文、密钥和其他隐私信息。
- 新增行为应同步更新测试与相关文档。

提交代码即表示你同意按照项目的 [MIT License](LICENSE) 提供该贡献。
