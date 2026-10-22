# 生产发布与恢复

站点：https://thomas-hub.com/ ，https://www.thomas-hub.com/ 。
代码仓库：https://github.com/qy-lu/HomePage ，默认分支 `master`。
本地仓库：`D:\thomas-hub`。

## 2026-10-22 UI 版本

- 上线时间：2026-10-22 19:02:55，Europe/Berlin（UTC+02:00）。
- UI 功能提交：`dcd0b9c321c2af35cdad1a0e3310e6945cdd5510`。
- 发布编号：`20261022T170255676292Z`。
- 发布包共 12 个文件，只有 HTML、CSS、主脚本、背景脚本四个文件内容变化。
- 线上两域名共 24 项 HTTP 内容检查通过，全部匹配本地构建清单。
- 独立入口响应与发布前一致：WordPress 200；Jupyter 原有 302；AskPool 200；
  动漫站仍为 503 维护页。Apache 配置未改变。

最终上线版本另包含 19:08:07 的浏览器缓存兼容修复：

- 最终发布编号：`20261022T170807641419Z`。
- 构建修复提交：`8c31483`，Git 标签：`homepage-ui-20261022.1`。
- 构建会为样式、脚本、动态背景模块及页面图片添加按内容生成的版本查询参数，
  避免新 HTML 混用旧缓存。没有改动页面的视觉与交互设计。
- 最终 24 项 HTTP 校验通过，从干净 Git 源码构建可逐字节复现全部 12 个线上文件。
- 最终修复发布前，也已完整备份首个 UI 版本，备份目录为
  `/var/backups/thomas-homepage/20261022T170807641419Z/`。

## 旧版的永久备份

服务器目录：

```text
/var/backups/thomas-homepage/20261022T170255676292Z/
```

其中：

- `public-root.tar.gz`：上线前整个主页根目录的压缩包，保留原文件元数据。
- `files/`：本次替换文件的旧版副本。
- `before.json`：发布前完整文件内容哈希、权限与属主记录。
- `manifest.json`：本次已上线文件的哈希清单。
- `server-release.py`：永久保存的发布/回滚工具。
- `verify-release-backup.py`：隔离环境恢复验证工具。
- `recovery-verification.json`：本次备份及恢复演练通过的记录。

完整旧版压缩包 SHA-256：

```text
11f8f6eac7c6eb7816ff9af0c00c5d2cb87e2c5d9f91cb672e70c3f8444dda88
```

已在隔离临时目录复制当前版本，再执行真实回滚工具；恢复后的全部 20 个文件
内容、权限及属主与发布前记录一致。演练没有切换生产站点。
该目录在永久备份路径下，项目脚本不会自动清理它；本地另保留恢复包。

## 回到上线前的旧版

```powershell
ssh root@www.thomas-hub.com "python3 /var/backups/thomas-homepage/20261022T170807641419Z/server-release.py --rollback 20261022T170807641419Z"
ssh root@www.thomas-hub.com "python3 /var/backups/thomas-homepage/20261022T170255676292Z/server-release.py --rollback 20261022T170255676292Z"
```

依次执行以上两条：先撤回缓存兼容修复，再恢复最初的旧主页。
任何一步失败都应停止并检查输出，不继续强制覆盖。

工具会先确认线上仍对应这次发布，再原子恢复主页文件，最后校验；
不覆盖其他文件，不改 WordPress、Jupyter、Apache 和其他子域名服务。
若以后已发布新版本，应先按发布的逆序回滚，或人工核实差异后安排恢复，
不要强行绕过当前版本检查。完整旧版压缩包独立于回滚工具保存，可用于灾难恢复。

恢复验证可以再次运行：

```powershell
ssh root@www.thomas-hub.com "python3 /var/backups/thomas-homepage/20261022T170807641419Z/verify-rollback-chain.py 20261022T170807641419Z 20261022T170255676292Z"
```

该命令要求线上仍是最终版本；它会在隔离副本中依次回退两次，不修改生产目录。
整条恢复链已实际演练通过，每一步均恢复到对应的完整 20 文件快照。
本地完整恢复包包含上述两个备份目录，以及校验记录和永久回滚工具。

## 后续发布

```powershell
cd D:\thomas-hub
npm test
npm run build
.\scripts\deploy.ps1 -DryRun
.\scripts\deploy.ps1
```

默认读取 `docs/production-manifest.json`，要求服务器内容与上次已验证版本一致。
发现服务器被手工修改会停止，不擅自覆盖。发布前需明确授权，UI 变更先本地验收。

发布成功且核验通过后，保存新的 `release/manifest.json` 到
`docs/production-manifest.json`，记录新备份编号并提交 Git。
如需指定其他已知线上版本，可用 `-ExpectedManifest <该版本清单路径>`。
回滚后也必须同步实际生产版本记录，再继续发布。

每次实际发布都会创建新的完整备份。不要清理仍需保留的历史备份，
也不要对 `/var/www/public-root` 运行带删除的整目录同步或直接解压覆盖。
