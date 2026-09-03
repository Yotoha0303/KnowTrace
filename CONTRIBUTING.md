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

## Pull Request

- 说明问题、解决方案、风险和回滚方式。
- 列出修改文件和实际执行的验证命令。
- UI 变化请附截图，但先移除真实姓名、记录正文、密钥和其他隐私信息。
- 新增行为应同步更新测试与相关文档。

提交代码即表示你同意按照项目的 [MIT License](LICENSE) 提供该贡献。
