<h1 align="center">🤖 Agent Client Plugin for Obsidian</h1>

<p align="center">
  <img src="https://img.shields.io/github/downloads/RAIT-09/obsidian-agent-client/total" alt="GitHub Downloads">
  <img src="https://img.shields.io/github/license/RAIT-09/obsidian-agent-client" alt="License">
  <img src="https://img.shields.io/github/v/release/RAIT-09/obsidian-agent-client" alt="GitHub release">
  <img src="https://img.shields.io/github/last-commit/RAIT-09/obsidian-agent-client" alt="GitHub last commit">
</p>

<p align="center">
  <a href="https://www.buymeacoffee.com/rait09" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" width="180" height="50" ></a>
</p>

AIエージェントをObsidianに直接統合しましょう！このプラグインを使えば、Claude Code、Codex、Gemini CLI、その他のAIエージェントと、あなたのVaultから直接チャットできます。AIアシスタントがサイドパネルですぐに利用可能になります✨

このプラグインは、Zed の [Agent Client Protocol (ACP)](https://github.com/zed-industries/agent-client-protocol) で構築されています。

https://github.com/user-attachments/assets/1c538349-b3fb-44dd-a163-7331cbca7824

## ✨ 主な機能

- 🔗 **エージェントの直接統合**: 右側パネルでAIコーディングエージェントとチャット
- 🖼️ **画像添付**: チャットに画像をペーストまたはドラッグ&ドロップして、メッセージと一緒に送信できます
- 📝 **ノートメンション**: アクティブなノートを自動的にメンションしたり、`@ノート名`で特定のノートを手動でメンションできます
- ⚡ **スラッシュコマンド**: `/`コマンドを使用して、エージェントが提供する機能を実行できます
- 🔄 **複数のエージェントを切り替え**: Claude Code、Codex、Gemini CLI、その他のカスタムエージェント間で簡単に切り替えることができます
- 🎛️ **モード・モデル切り替え**: チャット画面からAIモデル（例: Sonnet、Haiku）やエージェントモード（例: Plan Mode）を直接変更できます
- 💻 **ターミナル統合**: エージェントがターミナルコマンドを実行し、結果をチャットで返すことができます
- 🔐 **権限管理**: エージェントのアクションに対する細かい制御ができます

## 📦 インストール方法
### 🧪 BRAT経由でインストール
1. コミュニティプラグインから [BRAT](https://github.com/TfTHacker/obsidian42-brat) プラグインをインストールします。
2. Obsidianの設定で、コミュニティプラグイン → BRAT → Add Beta Plugin に移動します。
3. このリポジトリのURLを貼り付けます:
   ```
   https://github.com/RAIT-09/obsidian-agent-client
   ```
4. BRATが最新リリースをダウンロードし、自動更新を行います。
5. プラグインリストからAgent Clientを有効化します。

### 💻 手動でインストール
1. [リリース](https://github.com/RAIT-09/obsidian-agent-client/releases)から最新リリースのファイルをダウンロードします:
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. プラグインのフォルダを作成し、ファイルを配置します: `VaultFolder/.obsidian/plugins/agent-client/`
3. Obsidianの設定 → コミュニティプラグイン でプラグインを有効化します

## ⚙️ プラグインの設定

### ステップ1: 📦 必要な依存関係をインストール

- **Claude Code**の場合:
  ```bash
  npm install -g @zed-industries/claude-code-acp
  ```

- **Codex**の場合:
  ```bash
  npm install -g @zed-industries/codex-acp
  ```

- **Gemini CLI**の場合:
  ```bash
  npm install -g @google/gemini-cli
  ```

### ステップ2: 🔍 インストールパスを確認

エージェントをインストールした後、それぞれの絶対パスを確認してください:

**macOS/Linuxの場合:**
```bash
# Node.js のパスを確認
which node
# 出力例: /usr/local/bin/node

# Claude Code のパスを確認
which claude-code-acp
# 出力例: /usr/local/bin/claude-code-acp

# Codex のパスを確認
which codex-acp
# 出力例: /usr/local/bin/codex-acp

# Gemini CLI のパスを確認
which gemini
# 出力例: /usr/local/bin/gemini
```

**Windowsの場合:**
```cmd
# Node.js のパスを確認
where.exe node
# 出力例: C:\Program Files\nodejs\node.exe

# Claude Code のパスを確認
where.exe claude-code-acp
# 出力例: C:\Users\Username\AppData\Roaming\npm\claude-code-acp.cmd

# Codex のパスを確認
where.exe codex-acp
# 出力例: C:\Users\Username\AppData\Roaming\npm\codex-acp.cmd

# Gemini CLI のパスを確認
where.exe gemini
# 出力例: C:\Users\Username\AppData\Roaming\npm\gemini.cmd
```

### ステップ3: 🛠️ プラグインをセットアップ

1. **Settings → Agent Client**を開く
2. node のパスを設定:
   - **Node.js path**: 上記で確認した絶対パスを入力 (例: `/usr/local/bin/node` または `C:\Program Files\nodejs\node.exe`)
1. 使用するエージェントを設定:
   - **Claude Code**:
     - **Path**: 絶対パスを入力 (例: `/usr/local/bin/claude-code-acp`)
     - **API key**: Anthropicアカウントにログイン済みの場合は任意
   - **Codex**
	   - **Path**: 絶対パスを入力 (例: `/usr/local/bin/codex-acp`)
	   - **API key**: OpenAIアカウントにログイン済みの場合は任意
   - **Gemini CLI**:
     - **Path**: 絶対パスを入力 (例: `/usr/local/bin/gemini`)
     - **API key**: Googleアカウントにログイン済みの場合は任意
   - **Custom Agents**: ACP互換のエージェントを追加可能

### 📋 設定例

**macOS/Linuxの例:**
```
Settings:
├── Node.js path: /usr/local/bin/node

Built-in agents:
├── Claude Code
│   ├── Path: /usr/local/bin/claude-code-acp
│   └── API key: (任意)
├── Codex
│   ├── Path: /usr/local/bin/codex-acp
│   └── API key: (任意)
└── Gemini CLI
    ├── Path: /usr/local/bin/gemini
    └── API key: (任意)
```

**Windowsの例（ネイティブ）:**

> 💡 WSL Modeを使用する場合は、上記のmacOS/Linuxの例を参照してください。

```
Settings:
├── Node.js path: C:\Program Files\nodejs\node.exe

Built-in agents:
├── Claude Code
│   ├── Path: C:\Users\Username\AppData\Roaming\npm\claude-code-acp.cmd
│   └── API key: (任意)
├── Codex
│   ├── Path: C:\Users\Username\AppData\Roaming\npm\codex-acp.cmd
│   └── API key: (任意)
└── Gemini CLI
    ├── Path: C:\Users\Username\AppData\Roaming\npm\gemini.cmd
    └── API key: (任意)
```

### 🪟 WSL Mode（Windowsユーザー向け推奨）

WSL ModeはWindows Subsystem for Linux内でエージェントを実行し、より良い互換性とUnixライクな環境を提供します。

1. **Settings → Agent Client**で**WSL Mode**を有効化
2. Linuxスタイルのパスを使用（例: `/usr/local/bin/node`、`/usr/local/bin/claude-code-acp`）
3. パス設定は上記の**macOS/Linuxの例**を参照

## 🚀 使用方法

- 🎯 コマンドパレットを使用して開く: "Open agent chat"
- 🤖 リボンメニューのロボットアイコンをクリックして開く
- 💬 右側パネルで設定したエージェントとチャットする
- 📝 `@ノート名`でノートをメンションする
- 🔄 プラグイン設定のドロップダウンメニューからエージェントを切り替える
- 🎛️ 入力欄の下にあるドロップダウンからAIモデルやモードを変更する

## 👨‍💻 開発者向け

```bash
npm install
npm run dev
```

ビルド:
```bash
npm run build
```

コードフォーマット（Prettier）:
```bash
# コードのフォーマットをチェック
npm run format:check

# フォーマットを自動修正
npm run format
```

## 🗺️ ロードマップ

- **編集の追跡機能**: エージェントの編集を自動で追跡 — 影響を受けるノートを開き、編集時にカーソルを移動する
- **チャット履歴機能**: エージェントとの過去のチャットセッションを閲覧、検索、復元する
- **マルチインスタンス対応**: 複数のエージェントを別々のパネルで同時に実行する

アイデアや機能のリクエストがある場合は、ぜひお気軽に[issue](https://github.com/RAIT-09/obsidian-agent-client/issues)を開いてください！

## 📄 ライセンス

このプロジェクトはApache License 2.0の下でライセンスされています - 詳細は[LICENSE](LICENSE)ファイルをご覧ください。

## ⭐️ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=RAIT-09/obsidian-agent-client&type=Date)](https://www.star-history.com/#RAIT-09/obsidian-agent-client&Date)
