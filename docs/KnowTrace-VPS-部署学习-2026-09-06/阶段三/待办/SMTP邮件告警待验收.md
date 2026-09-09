# SMTP 邮件告警待验收

## 当前状态

- `ALERT_EMAIL_ENABLED=false`
- Alertmanager 已接收真实故障演练告警。
- SMTP 提供商已选 163；VPS 到 `smtp.163.com:465` 的 TLS 1.3 握手及证书校验通过。
- 尚未确认完整发件/收件地址，也没有收件箱送达证据。
- 因此阶段三只能标记“核心可观测性完成，外部邮件待验收”。

## 需要用户提供或决定

仍可在聊天中提供的非敏感信息：

- 发件地址；
- 收件地址。

不要再次在聊天中发送邮箱登录密码或授权码。已出现在聊天中的授权码应先在
163 后台作废并生成新值，再直接通过 VPS 隐藏提示输入：

```bash
ssh knowtrace-vps
cd /opt/knowtrace
scripts/linux/configure-163-alert-email.sh
```

助手会原子设置：

```dotenv
ALERT_EMAIL_ENABLED=true
ALERT_SMTP_SMARTHOST=smtp.163.com:465
ALERT_SMTP_FROM=<完整163邮箱>
ALERT_SMTP_AUTH_USERNAME=<完整163邮箱>
ALERT_SMTP_AUTH_PASSWORD=<隐藏输入的新授权码>
ALERT_SMTP_REQUIRE_TLS=false
ALERT_EMAIL_TO=<完整收件邮箱>
```

当前 Alertmanager 0.28.1 会先对 465 建立隐式 TLS；上述 `false` 只跳过
随后重复的 STARTTLS 检查，不会关闭证书校验或把连接改成明文。

## 应用配置

```bash
cd /opt/knowtrace
scripts/linux/init-observability-env.sh
docker compose \
  --env-file .env \
  --env-file .env.observability \
  -f compose.yaml \
  -f compose.production.yaml \
  -f compose.observability.yaml \
  up -d --no-deps --force-recreate alertmanager
scripts/linux/test-email-alert.sh
```

## 完成门禁

- [x] VPS 到 163 SMTP 465 的 TLS 握手成功且证书验证为 `OK`。
- [ ] 已确认完整发件邮箱和收件邮箱。
- [ ] 已作废聊天中出现的授权码，并通过隐藏提示写入新授权码。
- [ ] `amtool check-config` 成功。
- [ ] Alertmanager 健康。
- [ ] 测试告警出现在 Alertmanager。
- [ ] Alertmanager 日志没有 DNS、TCP、STARTTLS、认证或退信错误。
- [ ] 收件箱实际收到测试邮件。
- [ ] 测试告警恢复并清除。
- [ ] 文档只记录提供商、时间和结果，不记录密码、完整邮件头或 token。

只有全部勾选后才能关闭此待办。
