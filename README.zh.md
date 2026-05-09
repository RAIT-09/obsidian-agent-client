<h1 align="center">Agent Client Plugin for Obsidian</h1>

<p align="center">
  <img src="https://img.shields.io/github/downloads/RAIT-09/obsidian-agent-client/total" alt="GitHub Downloads">
  <img src="https://img.shields.io/github/license/RAIT-09/obsidian-agent-client" alt="License">
  <img src="https://img.shields.io/github/v/release/RAIT-09/obsidian-agent-client" alt="GitHub release">
  <img src="https://img.shields.io/github/last-commit/RAIT-09/obsidian-agent-client" alt="GitHub last commit">
  <a href="https://github.com/RAIT-09/obsidian-agent-client/discussions"><img src="https://img.shields.io/github/discussions/RAIT-09/obsidian-agent-client" alt="GitHub Discussions"></a>
</p>

将 AI Agent（Claude Code、Codex、Gemini CLI）直接引入 Obsidian。可以直接在你的个人知识库中与 AI 助手聊天。

基于 Zed 的 [Agent Client Protocol (ACP)](https://github.com/agentclientprotocol/agent-client-protocol)

基于 Andrej Karpathy 的 LLM-wiki 理念 [LLM-wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)

![video](https://github.com/user-attachments/assets/1c538349-b3fb-44dd-a163-7331cbca7824)

## 功能

- **笔记提及**：使用 `@notename` 语法引用你的笔记
- **维基链接上下文**：在提及的笔记中，`[[wikilinks]]` 被呈现已解析的文件路径，以便代理可以决定读取哪个
- **代理工作区**：一个专用的 `/Agent-Client/` 文件夹，包含 `Index.md`（笔记索引）、`Resources/`（待处理资源）和 `Agent_Output/YYYY-MM-DD/`（按日期排序输出），资源更新时以种子-增量的方式发送给代理
- **图片附件**：将图片粘贴或拖放到聊天中
- **斜杠命令**：使用 Agent SDK 提供的 `/` 命令
- **多代理支持**：在 Claude Code、Codex、Gemini CLI 和自定义代理之间切换
- **多会话**：在不同视图中同时运行多个代理
- **浮动聊天**：一个持久的、可折叠的聊天窗口，方便快速访问
- **模式和模型切换**：从聊天中更改 AI 模型和代理模式
- **会话历史**：恢复或 fork 之前的对话
- **聊天导出**：将对话保存为 Markdown 笔记
- **终端集成**：让代理执行命令并返回结果
- **MCP 支持**：代理使用其配置的 MCP 服务器 — 插件中无需额外设置

## LLM-wiki 模式
https://github.com/user-attachments/assets/0a8a3d26-0c03-4a52-a803-87ac2b8a3a55

详见 [wiki-mode](docs/usage/wiki-mode.md)

## 安装

### 通过 BRAT（推荐）

1. 安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 插件
2. 转到 **设置 → BRAT → 添加 Beta 插件**
3. 粘贴：`https://github.com/RAIT-09/obsidian-agent-client`
4. 从插件列表中启用 **Agent Client**

### 手动安装

1. 从 [Releases](https://github.com/RAIT-09/obsidian-agent-client/releases) 下载 `main.js`、`manifest.json`、`styles.css`
2. 将它们放在 `VaultFolder/.obsidian/plugins/agent-client/` 中
3. 在 **设置 → 社区插件** 中启用插件

## 快速开始

打开终端（macOS/Linux 上为 Terminal，Windows 上为 PowerShell），运行以下命令。

1. **安装代理及其 ACP 适配器**（例如，Claude Code）：
   ```bash
   curl -fsSL https://claude.ai/install.sh | bash   # 安装 Claude Code
   npm install -g @agentclientprotocol/claude-agent-acp   # 安装 ACP 适配器
   ```

2. **登录**（如果使用 API 密钥则跳过）：
   ```bash
   claude
   ```
   按提示使用你的 Anthropic 账户进行身份验证。

3. **查找路径**：
   ```bash
   which node   # macOS/Linux
   which claude-agent-acp

   where.exe node   # Windows
   where.exe claude-agent-acp
   ```

4. **在 **设置 → Agent Client** 中进行配置：
   - **Node.js 路径**：例如 `/usr/local/bin/node`
   - **内置代理 → Claude Code → 路径**：例如 `/usr/local/bin/claude-agent-acp`（而不是 `claude`）
   - **API 密钥**：添加你的密钥，或者如果通过 CLI 登录则留空

5. **开始聊天**：点击工具栏中的机器人图标

### 设置指南

- [Claude Code](https://rait-09.github.io/obsidian-agent-client/agent-setup/claude-code.html)
- [Codex](https://rait-09.github.io/obsidian-agent-client/agent-setup/codex.html)
- [Gemini CLI](https://rait-09.github.io/obsidian-agent-client/agent-setup/gemini-cli.html)
- [自定义代理](https://rait-09.github.io/obsidian-agent-client/agent-setup/custom-agents.html)（OpenCode、Qwen Code、Kiro、Mistral Vibe 等）

**[完整文档](https://rait-09.github.io/obsidian-agent-client/)**

## 开发

```bash
npm install
npm run dev
```

对于生产构建：
```bash
npm run build
```

## 许可证

Apache 许可证 2.0 - 详见 [LICENSE](LICENSE) 了解详情。

## 星标历史

[![Star History Chart](https://api.star-history.com/svg?repos=RAIT-09/obsidian-agent-client&type=Date)](https://www.star-history.com/#RAIT-09/obsidian-agent-client&Date)
