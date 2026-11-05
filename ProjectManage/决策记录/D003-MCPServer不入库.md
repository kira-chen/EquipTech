# D003 MCPServer/ 只在本地和部署服务器上，不提交到 GitHub

- 日期：2026-11-03
- 决定人：用户
- 状态：有效
- 来源：项目记忆、`.gitignore`（回溯补记）

## 决定

Mock MCP Server 代码放在仓库根目录 `MCPServer/`，已加入 `.gitignore`，不提交、不推送。代码只在本机和部署服务器上。

## 影响

- 通过 GitHub 协作的成员看不到 MCP Server 代码，涉及 MCP 的任务只能派给 MCP Server 开发会话。
- 仓库内文档不链接、不描述 MCP Server 的部署细节。
- MCP 协议（地址、传输、鉴权）已冻结，只能改工具；改动影响 Client 调用（工具名、入参、返回结构、描述）时先由用户确认。
