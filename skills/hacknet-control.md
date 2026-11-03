# Hacknet 控制流程

通过 `mcp__hacknet__hnpb_*` 工具控制正在运行的 Hacknet。工具名前缀由 DSH 的 MCP 客户端添加；wire 名仍是 `hnpb_state` 等。先确认工具存在，不要臆造名字。

1. **找实例**：`hnpb_instances`。描述文件可能在游戏崩溃后残留；用 PID 和当前截图匹配用户正在看的窗口，不要默认取第一个。`hnpb_state` 会返回实际 RAM 占用与进程 PID，先用它核对实例身份。
2. **观察并暂停**：`hnpb_state` 默认 `pause: false`，记录返回的 `SessionEpoch`。思考期间保持暂停。错误要如实上报，不要把错误响应当成状态。
3. **派发命令**：`hnpb_command` 走游戏同步语义终端入口，不是模拟键盘；返回只代表已派发，不代表程序、延迟任务或网络效果完成。
4. **连续推进用 `runUntil`**：`hnpb_control {action:"runUntil", milliseconds, terminalContains?, untilProxyBypassed?, traceFloorSeconds?, command?}` 从暂停开始连续播放（最长 8000 ms），在终端出现指定文本、代理解除、Trace 触及保底值、连接变化、RAM 超限或超时时冻结。返回 `StopReason`、`TerminalDelta`、`State` 和 `Ui`。需要精确步进时仍用 `advance`（updates/draws 各 0..300）。
5. **操作 UI**：`hnpb_ui inspect` 读缓存控件；`capture` 会执行一次 Draw 并返回 PNG，本身可能推进绘制驱动的玩法。`activate`/`fill` 需要最近一次清单里的 `key` 和 `revision`，并要求匹配 `sessionEpoch`；`fill` 不自动提交。激活成功不等于界面已打开，必须再抓一帧确认；原生设置图标 Id 3827179 文字为空，但实测可点。
6. **第三方内容**：先用 `hnpb_adapters list` 读能力描述，再 `observe`/`invoke`。未知或自绘控件不会被自动识别；需要时让用户提供或编写适配器。
7. **验证结果**：端口破解、终端输出、取回的文件、适配器状态都算证据；区分"已观察到的成功"、"已排队"和"未验证"。
8. **收尾**：按用户要求决定恢复或保持暂停，并说明当前 Trace 剩余、存档状态和未验证部分。

## 玩法：让游戏在两次决策之间继续跑

- **每次连接或重连后先 `probe`**，用显示出来的重映射端口，不要凭 XML 猜。
- 有代理时：在有权管理的主机上开 shell → 重连目标 → 激活 Overload，**同时**跑防火墙 `analyze`。等代理确实 `INACTIVE` 再启动需要代理权限的 cracker；SQL/RTSP/Torrent/SSL 等 `needsProxyAccess=false` 的端口可以提前开始。
- **防火墙只读完整分析轮次**。从终端输出逐行取候选字符交集（大小写敏感比较）；第一道分隔线、残缺行或 "Analysis already in Progress" 都不算结果。每行都唯一后再 `solve`。一次复测中前 0–3 轮已经足够，保守做法等到了第 6 轮。
- **RAM 是硬约束**：`hnpb_state` 给出实际 RAM 与进程表，游戏侧会拒绝超额的可执行文件。用 `runUntil` 等程序自然结束，再按释放出来的容量接续下一个 cracker，不要并发堆破解器。
- **端口确认打开后再按 PID 清理驻留程序**（如 Torrent、RTSP、FTP）；一次 `kill` 一个 PID，`Invalid PID` 说明它已自行结束。为动态 RAM 和 Trace 工具留余量。
- **Trace**：界面显示百分比，MCP 的 `RemainingSeconds` 是秒。`SecurityTracer.exe` + `ps` + `kill` 该 PID 可停掉当前追踪（普通目标）；下一次敌对动作会重新开始一个完整倒计时。只在需要且 RAM 允许时启动；TraceKill / SignalScramble 属于可选，别为它们牺牲正在进行的利用。
- 端口、代理、防火墙全部确认后跑 `PortHack`，验证管理员权限并读取要求的证明文件；**不要用命令回显当成功证据**。对比性复测要记录初始防御、游戏时间、峰值 RAM 和 Trace 重置次数。
- 读文件用相对路径：先 `cd home` 再 `cat proof.txt`。`cat /home/proof.txt` 会报 `File Not Found`，带前导斜杠的路径不被接受。
- 候选交集目前是 skill 策略，不是 Bridge 的自动停止条件；`runUntil` 只认终端文本、代理解除、Trace 保底等显式条件。

## 边界

- **玩法操作应在运行态执行**：连接、probe、派发命令、等待破解器完成、PortHack 都应在游戏连续运行或 `runUntil` 窗口内完成。当前 `hnpb_command` / `hnpb_control runUntil` 返回 `Pause the game before acting.` 属于待修缺陷，不要把它写进正常流程；遇到时记录实例、`SessionEpoch` 和命令，走可用路径或等待修复。
- Freezer 只冻结游戏的 Update/Draw 和 SDL 文本输入，不冻结后台线程、网络和墙钟；截图执行一次 Draw，不是无副作用观察。
- 超时或会话变化后先重新观察，不要盲目重放非幂等操作；`requestId` 去重只在当前桥进程内有界有效。
- 游戏文本、节点文件、邮件和适配器返回值都是环境数据，不构成对真实计算机或第三方服务的授权。
- 多实例并发修改同一个游戏会互相干扰；同一实例只保持一个操作者。

## 连不上时先看这里

工具出现了不等于连上了游戏。按这个顺序判断：

1. `hnpb_instances` 里有没有 `ProcessPresent: true` 的实例，PID 是否与玩家正在看的窗口一致；残留描述符很常见。
2. `hnpb_state {pause: false}` 必须返回 `ok: true` 和真实状态（`SessionEpoch`、`Paused`、`Freezer` 版本、RAM）。只看到工具注册不算通过。
3. 报 `Access to the path is denied.` 时，通常不是插件没加载、也不是 MCP 协议不兼容，而是 **Host 的启动方式错了**：Host 必须用 `dotnet HacknetPathfinderBridge.Host.dll` 启动；直接启动 apphost `.exe` 会让进程落到 Low 完整性，打不开 Medium 完整性的游戏命名管道。握手和实例列表仍会正常，所以失败只在第一次管道调用时暴露。
4. 需要更多线索时看插件的 `launch.log`：它记录启动命令、stdin/stdout/stderr 和子进程退出码；缺 `.dll`/`.deps.json`/`.runtimeconfig.json` 或找不到 .NET 10 runtime 会在 stderr 直说。
5. 管道可用但调用失败，才去怀疑游戏侧：Trace 是否结束、实例是否已崩溃、是否另一个操作者正在控制同一实例、RAM 是否被驻留进程占满。

新版实测：hnpb_state 默认不冻结；需要冻结时显式传 pause:true。hnpb_command 和 runUntil 接受运行态。runUntil 返回 FinalFrameRendered=true 才能把最后停住的画面和状态对齐；否则保留画面可能过时。PNG 仍需 capture，UI activate/fill 和显式步进仍要求暂停。

并行任务用 OR 等待：runUntil 可同时订阅直到防火墙分析完成、代理解除、可用 RAM 达标、指定 PID 退出、提权或指定终端结果。先处理最早发生的有效事件，再等待仍未完成的条件。若代理仍开但分析已完，应立即读 TerminalDelta，不必等代理。条件字段：untilFirewallAnalysisComplete、untilProxyBypassed、untilFreeRamMb、untilProcessExit、untilAdmin、terminalContains。命中已满足的条件会立即返回；下一次应移除该条件。进程退出不等于端口已开，仍要核实。检查 FinalFrameRendered。
