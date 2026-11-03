# dsh-plugin-hacknet-bridge

把 [HacknetPathfinderBridge](https://github.com/AprilCrystal/HacknetPathfinderBridge) 接进 DeepSeek Harness：游戏侧仍是 Pathfinder 插件，Harness 侧通过它的 stdio MCP Host 拿到控制工具。

## 组成

| 行 | 作用 |
|---|---|
| `mcp-hacknet-bridge` | 以 stdio 启动 Bridge Host，注册 `mcp__hacknet__hnpb_instances`、`hnpb_state`、`hnpb_control`、`hnpb_command`、`hnpb_ui`、`hnpb_adapters`。 |
| `hacknet-bridge-skill` | 注册 `hacknet-control` 技能：暂停观察、`SessionEpoch`、有限 `advance`、UI 句柄与安全边界。 |

游戏侧仍需按上游 README 把 `HacknetPathfinderBridge.Plugin.dll` 和 `Freeze.dll` 放进 Hacknet 的 `BepInEx/plugins/HacknetPathfinderBridge/`。本插件只负责 Host ↔ Harness 这一层。

## 上游版本

本包同步自 `AprilCrystal/HacknetPathfinderBridge@db52e9a`（*Guard executable RAM and add event-bounded gameplay*）。相对首版：

- `hnpb_state` 新增 `Ram`（`TotalMb` / `UsedMb` / `AvailableMb` / 警告 / 进程表），游戏侧在执行前校验 RAM 准入。
- `hnpb_control` 新增 `runUntil`：从暂停开始连续播放（1–8000 ms），在 Trace 保底、终端匹配、代理解除、连接变化、RAM 超限或超时时冻结，返回 `StopReason` 与 `TerminalDelta`。
- `hacknet-control` 技能补充了 probe、并行代理/防火墙分析、完整分析轮次与候选交集、按实际 RAM 接续、按 PID 清理驻留程序等策略。

构建与部署：

```powershell
Copy-Item <游戏开发引用>\* repo\Dependencies\ -Force   # 9 个文件，见 docs/build.md
dotnet build repo\HacknetPathfinderBridge\Host\HacknetPathfinderBridge.Host.csproj -c Release
dotnet build repo\HacknetPathfinderBridge\Plugin\HacknetPathfinderBridge.Plugin.csproj -c Release
Copy-Item repo\Output\HacknetPathfinderBridge\Host\* plugin\host\ -Force
# BridgeMod：只保留一份，旧目录移出 plugins，否则 BepInEx 会跳过重复 GUID
Copy-Item repo\Output\HacknetPathfinderBridge\Plugin\HacknetPathfinderBridge.Plugin.dll, repo\Output\HacknetPathfinderBridge\Plugin\Freeze.dll <Hacknet>\BepInEx\plugins\HacknetPathfinderBridge\ -Force
```

更新 BridgeMod 后必须重启游戏才会加载新 DLL。


## 启动器

Host 是 .NET 控制台程序，每行一个 JSON-RPC 消息，必须用 **`dotnet HacknetPathfinderBridge.Host.dll`** 启动，不要启动 apphost `.exe`。

在本机实测：直接启动 `.exe` 的 Host 会以 **Low 完整性**（0x1000）运行，而游戏是 Medium（0x2000）。这时 MCP 握手、六个工具注册、`hnpb_instances`（读注册目录里的描述文件）全都正常，但第一次要打开游戏命名管道的调用会在 `NamedPipeClientStream.TryConnect` 失败：

```text
{"ok":false,"error":"Access to the path is denied."}
```

容易误判成“插件没加载”或“MCP 协议不兼容”。以 `.dll` 经 `dotnet` 启动时完整性正常，管道可用。原 `.exe` 为什么落到 Low 完整性仍未查明。

[host-proxy.js](host-proxy.js) 保留 Cordis → Node → Host 的 stdio 链路，负责按上面的方式启动 Host：

- 默认 `host/HacknetPathfinderBridge.Host.dll`，`cwd` 为 Host 目录；
- 校验 `.dll`、`.deps.json`、`.runtimeconfig.json` 齐全，缺哪个在 stderr 直说；
- `dotnet.exe` 依次找 `DOTNET_HOST_PATH`、`DOTNET_ROOT`、`%ProgramFiles%\dotnet`、PATH，找不到提示安装 .NET 10 runtime；
- `HACKNET_BRIDGE_HOST` 传 `.exe` 时自动改用同名 `.dll` 并提示迁移；
- `HACKNET_BRIDGE_REGISTRY` 原样透传为 `--registry`。

- `host/` 是构建产物副本（`dotnet build` 的 Host 输出），因此插件不依赖仓库目录还在。
- `launch.log` 记录每次启动的 stdin/stdout/stderr，单次启动覆盖写入，上限 512 KiB；连不上时先看它。
- 环境变量：`HACKNET_BRIDGE_HOST` 指向 Host 的 **.dll**（旧配置里写 `.exe` 会自动映射到同名 `.dll` 并在 stderr 提示迁移）；`HACKNET_BRIDGE_REGISTRY` 指定隔离的实例注册目录（默认 `%TEMP%/HacknetPathfinderBridge`）。

`cordis.patch.yml` 里的 node 路径来自当前 DSH 运行时。DSH 升级若换掉运行时目录，改这一行即可；`command` 也可以直接换成 `node`（若它已在图形进程的 PATH 上）。

## 重新构建 Host

```powershell
cd repo
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Build.ps1 -HostOnly
Copy-Item Output\HacknetPathfinderBridge\Host\* ..\plugin\host\ -Force
```

`-HostOnly` 只需要 .NET SDK 10，不需要游戏开发引用。它的断言集里有一项命名管道往返测试，在受限沙箱中会失败（不能打开命名管道），这与 Host 本身无关。

## 验收步骤

只看“六个工具已注册”不算通过。从 DSH 内部按顺序做：

1. `hnpb_instances`，用 `ProcessPresent: true` 加 PID 匹配玩家正在看的窗口（多实例时不要默认取第一个）。
2. `hnpb_state {instanceId, pause: false}`，判据是 `ok: true` 且返回真实游戏状态（`SessionEpoch`、`Paused`、`Freezer` 版本、计数在变化）。
3. 若第 2 步报 `Access to the path is denied.`，先确认 Host 是经 `dotnet <dll>` 启动，而不是 apphost `.exe`；再查 `launch.log`。

已实测：

- Host 独立握手：`initialize` 返回 `protocolVersion 2025-06-18`，`tools/list` 返回 6 个 `hnpb_*`。
- 本机通过 DSH 内部复验（2026-11-03，游戏 PID 17116，Pathfinder + Freezer 1.1.0）：`hnpb_instances` 返回 6 个残留描述符与 2 个活动实例；`hnpb_state {pause:false}` 返回 `ok: true`，带 `SessionEpoch 981ef02b…`、`Freezer 1.1.0`、计数 2168。
- 同一请求在 `.exe` 启动方式下稳定复现 `Access to the path is denied.`，改 `.dll` 后恢复。
- `hacknet-control` 出现在技能目录。
- **db52e9a 升级后复验（PID 7108）**：`hnpb_state {pause:false}` 返回 `ok: true`，带 `SessionEpoch eb199213…`、`Ram {TotalMb:761, UsedMb:0, AvailableMb:761}`（新字段）；`hnpb_control {action:"runUntil", milliseconds:1500}` 返回 `StopReason: "timeBudget"` 并回到暂停。
- `hnpb_ui`：capture 得到 `button:3827179:26:0:20:19`（设置图标，Text 为空），activate 后控件出现 `<- Back`、`Apply Changes`、`Pathfinder Options`，再抓一帧确认设置界面已打开。

未验证：`hnpb_command` 的完整玩法链路、多实例并发控制，以及 DSH 界面内（非 MCP 工具）的点击。

## 变更配置

`cordis.patch.yml` 随包分发；要长期改路径，在 profile 的 `cordis.patch.yml` 里按行 id 覆盖 `mcp-hacknet-bridge` 的 `config`，不要在安装目录里改完就以为生效。
