<h1 align="center">Agent Client Plugin for Obsidian</h1>

<p align="center">
  <img src="https://img.shields.io/github/downloads/RAIT-09/obsidian-agent-client/total" alt="GitHub Downloads">
  <img src="https://img.shields.io/github/license/RAIT-09/obsidian-agent-client" alt="License">
  <img src="https://img.shields.io/github/v/release/RAIT-09/obsidian-agent-client" alt="GitHub release">
  <img src="https://img.shields.io/github/last-commit/RAIT-09/obsidian-agent-client" alt="GitHub last commit">
</p>

<p align="center">
  <a href="https://www.buymeacoffee.com/rait09" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" width="180" height="50" ></a>
</p>

AIエージェント（Claude Code、Codex、Gemini CLI）をObsidianに直接統合。Vault内からAIアシスタントとチャットできます。

このプラグインは、Zed の [Agent Client Protocol (ACP)](https://github.com/zed-industries/agent-client-protocol) で構築されています。

https://github.com/user-attachments/assets/1c538349-b3fb-44dd-a163-7331cbca7824

## 機能

- **ノートメンション**: `@ノート名`でノートを参照
- **画像添付**: チャットに画像をペーストまたはドラッグ&ドロップ
- **スラッシュコマンド**: エージェントが提供する`/`コマンドを使用
- **マルチエージェント**: Claude Code、Codex、Gemini CLI、カスタムエージェントを切り替え
- **マルチセッション**: 複数のエージェントを別々のビューで同時実行
- **モード・モデル切り替え**: チャット画面からAIモデルやエージェントモードを変更
- **セッション履歴**: 過去の会話を再開またはフォーク
- **チャットエクスポート**: 会話をMarkdownノートとして保存
- **ターミナル統合**: エージェントがコマンドを実行し結果を返す

## インストール

### BRAT経由（推奨）

1. [BRAT](https://github.com/TfTHacker/obsidian42-brat) プラグインをインストール
2. **設定 → BRAT → Add Beta Plugin** に移動
3. 貼り付け: `https://github.com/RAIT-09/obsidian-agent-client`
4. プラグインリストから **Agent Client** を有効化

### 手動インストール

1. [リリース](https://github.com/RAIT-09/obsidian-agent-client/releases)から `main.js`、`manifest.json`、`styles.css` をダウンロード
2. `VaultFolder/.obsidian/plugins/agent-client/` に配置
3. **設定 → コミュニティプラグイン** でプラグインを有効化

## クイックスタート

ターミナル（macOS/LinuxではTerminal、WindowsではPowerShell）を開き、以下のコマンドを実行します。

1. **エージェントとACPアダプタをインストール**（例: Claude Code）:
   ```bash
   curl -fsSL https://claude.ai/install.sh | bash   # Claude Codeをインストール
   npm install -g @zed-industries/claude-code-acp   # ACPアダプタをインストール
   ```

2. **ログイン**（APIキーを使う場合はスキップ）:
   ```bash
   claude
   ```
   プロンプトに従ってAnthropicアカウントで認証します。

3. **パスを確認**:
   ```bash
   which node   # macOS/Linux
   which claude-code-acp

   where.exe node   # Windows
   where.exe claude-code-acp
   ```

4. **設定 → Agent Client** で設定:
   - **Node.js path**: 例: `/usr/local/bin/node`
   - **Built-in agents → Claude Code → Path**: 例: `/usr/local/bin/claude-code-acp`（`claude`ではない）
   - **API key**: キーを追加、またはCLIでログイン済みの場合は空欄

5. **チャット開始**: リボンのロボットアイコンをクリック

### セットアップガイド

- [Claude Code](https://rait-09.github.io/obsidian-agent-client/agent-setup/claude-code.html)
- [Codex](https://rait-09.github.io/obsidian-agent-client/agent-setup/codex.html)
- [Gemini CLI](https://rait-09.github.io/obsidian-agent-client/agent-setup/gemini-cli.html)
- [カスタムエージェント](https://rait-09.github.io/obsidian-agent-client/agent-setup/custom-agents.html)（OpenCode、Qwen Code、Mistral Vibeなど）

**[ドキュメント全文](https://rait-09.github.io/obsidian-agent-client/)**

## 開発

```bash
npm install
npm run dev
```

プロダクションビルド:
```bash
npm run build
```

## ライセンス

Apache License 2.0 - 詳細は [LICENSE](LICENSE) を参照。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=RAIT-09/obsidian-agent-client&type=Date)](https://www.star-history.com/#RAIT-09/obsidian-agent-client&Date)
