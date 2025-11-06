# テストガイド

このガイドでは、Agent Client Pluginのテストプラクティスとインフラストラクチャについて説明します。

## 目次

- [概要](#概要)
- [クイックスタート](#クイックスタート)
- [テストインフラストラクチャ](#テストインフラストラクチャ)
- [テストの実行](#テストの実行)
- [テスト構造](#テスト構造)
- [テストの書き方](#テストの書き方)
- [カバレッジレポート](#カバレッジレポート)
- [トラブルシューティング](#トラブルシューティング)
- [ベストプラクティス](#ベストプラクティス)

## 概要

このプロジェクトでは、テストフレームワークとして[Vitest](https://vitest.dev/)を使用しています。選択理由：

- TypeScriptとESMのネイティブサポート
- 高速実行とインスタントホットモジュールリロード
- Jestと互換性のあるAPI
- v8による組み込みカバレッジレポート
- ビジュアルテスト探索のためのエレガントなUIモード

### 現在のテストカバレッジ

- **Use Cases**: 95.92% カバレッジ（58テスト）
  - `SendMessageUseCase`: 15テスト
  - `ManageSessionUseCase`: 15テスト
  - `HandlePermissionUseCase`: 16テスト
  - `SwitchAgentUseCase`: 12テスト

### 技術スタック

- **フレームワーク**: Vitest 1.6.1
- **DOM環境**: happy-dom（軽量DOM実装）
- **カバレッジ**: @vitest/coverage-v8
- **Reactテスト**: @testing-library/react（将来のコンポーネントテスト用）

## クイックスタート

### インストール

```bash
npm install
```

プロジェクトには`.npmrc`に`legacy-peer-deps=true`が含まれており、プロジェクトの`@types/node`（v16）とVitest（v18+必要）のバージョン差を処理します。

### テストの実行

```bash
# ウォッチモードでテストを実行（開発時推奨）
npm test

# 一度だけ実行して終了（CI用）
npm run test:run

# UIモードで実行
npm run test:ui

# カバレッジレポートを生成
npm run test:coverage
```

## テストインフラストラクチャ

### 設定ファイル

#### `vitest.config.ts`

```typescript
export default defineConfig({
  test: {
    globals: true,                    // グローバルテストAPIを有効化
    environment: 'happy-dom',         // 軽量DOM実装
    setupFiles: ['./test/setup.ts'],  // グローバルセットアップ
    coverage: {
      provider: 'v8',
      exclude: [
        'node_modules/',
        'test/',
        'src/infrastructure/**',      // 外部フレームワークコード
        'src/presentation/**',        // UIコンポーネント（将来）
      ],
    },
    alias: {
      obsidian: path.resolve(__dirname, './test/mocks/obsidian.ts'),
    },
  },
});
```

#### `test/setup.ts`

グローバルテストセットアップ、以下を含む：
- UUID生成用のCrypto APIモック
- グローバルテストユーティリティ
- 環境設定

#### `test/mocks/obsidian.ts`

Obsidian APIの包括的モック：
- `Vault`: ファイル操作（read、getAbstractFileByPathなど）
- `TFile`、`TFolder`: ファイルシステムの抽象化
- `Plugin`: プラグインライフサイクル
- `Platform`: プラットフォーム検出
- 設定とイベント

#### `test/mocks/codemirror.ts`

エディタ関連テスト用のCodeMirror APIモック。

## テストの実行

### ウォッチモード（開発時）

```bash
npm test
```

機能：
- ファイル変更時に自動的にテストを再実行
- `p` を押してファイル名でフィルタリング
- `t` を押してテスト名でフィルタリング
- `f` を押して失敗したテストのみ実行
- `a` を押してすべてのテストを実行
- `q` を押して終了

### 単発実行（CI）

```bash
npm run test:run
```

すべてのテストを一度実行して終了。継続的インテグレーションパイプラインに最適。

### UIモード（ビジュアル）

```bash
npm run test:ui
```

`http://localhost:51204/__vitest__/` でブラウザベースのUIを開きます：
- インタラクティブなテストエクスプローラー
- ソースコードとテストコードの並列表示
- リアルタイムテスト実行
- 詳細なエラー検査

### 特定のテストを実行

```bash
# 特定のテストファイルを実行
npm test src/core/use-cases/send-message.use-case.test.ts

# パターンに一致するテストを実行
npm test -- --grep="auto-mention"
```

### カバレッジレポート

```bash
npm run test:coverage
```

生成されるもの：
- カバレッジサマリー付きのコンソール出力
- `coverage/`ディレクトリのHTMLレポート
- JSONレポート（`coverage/coverage-final.json`）

ブラウザで`coverage/index.html`を開くと、詳細な行ごとのカバレッジ可視化が表示されます：
- 🟢 緑：テスト済みコード
- 🟡 黄色：部分的にテスト済み（一部の分岐のみカバー）
- 🔴 赤：未テストコード

## テスト構造

### Use Caseテスト

Use Caseテストは**Arrange-Act-Assert**パターンに従います：

```typescript
describe('SendMessageUseCase', () => {
  let useCase: SendMessageUseCase;
  let mockAgentClient: IAgentClient;
  let mockVaultAccess: IVaultAccess;
  let mockMentionService: NoteMentionService;

  beforeEach(() => {
    // Arrange: モックとテスト対象をセットアップ
    mockAgentClient = {
      sendMessage: vi.fn(),
      // ... その他のメソッド
    } as unknown as IAgentClient;

    mockVaultAccess = {
      readNote: vi.fn(),
      // ... その他のメソッド
    } as unknown as IVaultAccess;

    useCase = new SendMessageUseCase(
      mockAgentClient,
      mockVaultAccess,
      mockMentionService
    );
  });

  it('should prepare message with auto-mention', async () => {
    // Arrange: テストデータをセットアップ
    const activeNote = { path: 'notes/test.md', name: 'test' };
    vi.mocked(mockVaultAccess.readNote)
      .mockResolvedValue('Note content');

    // Act: Use Caseを実行
    const result = await useCase.prepareMessage({
      message: 'Test message',
      activeNote,
      vaultBasePath: '/vault',
    });

    // Assert: 結果を検証
    expect(result.agentMessage).toContain('obsidian_opened_note');
    expect(result.agentMessage).toContain('/vault/notes/test.md');
  });
});
```

### 主要なテストパターン

#### 1. 依存性注入

Use Casesはコンストラクタ経由ですべての依存関係を受け取るため、モック化が容易：

```typescript
const useCase = new SendMessageUseCase(
  mockAgentClient,    // IAgentClient実装
  mockVaultAccess,    // IVaultAccess実装
  mockMentionService  // NoteMentionServiceモック
);
```

#### 2. Vitestによるモックセットアップ

```typescript
// メソッドをモックして値を返す
vi.mocked(mockAgentClient.initialize)
  .mockResolvedValue({ authMethods: [], protocolVersion: 1 });

// メソッドをモックしてエラーをスロー
vi.mocked(mockAgentClient.sendMessage)
  .mockRejectedValue(new Error('Network error'));

// メソッドが呼ばれたことを検証
expect(mockAgentClient.sendMessage).toHaveBeenCalledWith(
  'session-123',
  'Hello'
);

// 特定の引数で呼ばれたことを検証
expect(mockAgentClient.initialize).toHaveBeenCalledWith(
  expect.objectContaining({
    env: expect.objectContaining({
      ANTHROPIC_API_KEY: 'test-api-key',
    }),
  })
);
```

#### 3. 非同期操作のテスト

```typescript
it('should handle async operations', async () => {
  const promise = useCase.createSession({
    workingDirectory: '/test',
    agentId: 'claude-code-acp',
  });

  await expect(promise).resolves.toEqual(
    expect.objectContaining({
      sessionId: 'test-session-123',
    })
  );
});
```

#### 4. エラーケースのテスト

```typescript
it('should handle errors gracefully', async () => {
  vi.mocked(mockAgentClient.sendMessage)
    .mockRejectedValue(new Error('Connection failed'));

  await expect(
    useCase.sendPreparedMessage({
      sessionId: 'test-session',
      message: 'Hello',
    })
  ).rejects.toThrow('Connection failed');
});
```

## テストの書き方

### 新しいUse Caseのテスト追加

1. **テストファイルを作成**: `src/core/use-cases/[use-case-name].use-case.test.ts`

2. **依存関係をインポート**:
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { YourUseCase } from './your.use-case';
import type { IAgentClient } from '../domain/ports/agent-client.port';
// ... その他のインポート
```

3. **テストスイートをセットアップ**:
```typescript
describe('YourUseCase', () => {
  let useCase: YourUseCase;
  let mockDependency: IDependency;

  beforeEach(() => {
    // 各テスト前にモックをリセット
    vi.clearAllMocks();

    // 新しいインスタンスを作成
    mockDependency = {
      method: vi.fn(),
    } as unknown as IDependency;

    useCase = new YourUseCase(mockDependency);
  });

  // ここにテストを記述
});
```

4. **テストケースを書く**:
```typescript
describe('methodName', () => {
  it('should handle normal case', () => {
    // Arrange
    const input = { /* ... */ };

    // Act
    const result = useCase.methodName(input);

    // Assert
    expect(result).toBe(expectedValue);
  });

  it('should handle edge case', () => {
    // エッジケースをテスト
  });

  it('should handle error case', () => {
    // エラーシナリオをテスト
  });
});
```

### テスト構成のガイドライン

#### 関連テストをグループ化

```typescript
describe('SendMessageUseCase', () => {
  describe('prepareMessage', () => {
    it('should return simple message as-is', () => { /* ... */ });
    it('should convert @[[mentions]] to paths', () => { /* ... */ });
    it('should add auto-mention when enabled', () => { /* ... */ });
  });

  describe('sendPreparedMessage', () => {
    it('should send message to agent client', () => { /* ... */ });
    it('should handle network errors', () => { /* ... */ });
    it('should retry on auth failure', () => { /* ... */ });
  });
});
```

#### 説明的なテスト名を使用

- ✅ 良い: `'should convert @[[note]] to absolute path'`
- ❌ 悪い: `'mention conversion'`

- ✅ 良い: `'should throw error when session not found'`
- ❌ 悪い: `'error test'`

#### 1テストにつき1つのことをテスト

```typescript
// ✅ 良い: 単一責任
it('should add auto-mention when enabled', () => {
  const result = useCase.prepareMessage({ /* ... */ });
  expect(result.agentMessage).toContain('obsidian_opened_note');
});

// ❌ 悪い: 複数のことをテスト
it('should prepare message correctly', () => {
  const result = useCase.prepareMessage({ /* ... */ });
  expect(result.agentMessage).toContain('obsidian_opened_note');
  expect(result.displayMessage).toBe('original message');
  expect(mockVaultAccess.readNote).toHaveBeenCalled();
  // アサーションが多すぎる
});
```

### モッキングのベストプラクティス

#### 適切なレベルでモック

```typescript
// ✅ 良い: ポート（インターフェース）レベルでモック
const mockAgentClient: IAgentClient = {
  sendMessage: vi.fn(),
  // ... その他のメソッド
} as unknown as IAgentClient;

// ❌ 悪い: 実装の詳細をモックしない
vi.mock('../adapters/acp/acp.adapter.ts');  // 具体的すぎる
```

#### 型安全なモックを使用

```typescript
// ✅ 良い: 型安全なモックアクセス
vi.mocked(mockAgentClient.sendMessage)
  .mockResolvedValue(undefined);

// ❌ 悪い: 安全でないキャスト
(mockAgentClient.sendMessage as any)
  .mockResolvedValue(undefined);
```

#### テスト間でモックをリセット

```typescript
beforeEach(() => {
  vi.clearAllMocks();  // 呼び出し履歴をクリア
  // または
  vi.resetAllMocks();  // 実装もリセット
});
```

## カバレッジレポート

### カバレッジメトリクスの理解

- **Statements（文）**: 実行された文の割合
- **Branches（分岐）**: 実行された条件分岐の割合
- **Functions（関数）**: 呼び出された関数の割合
- **Lines（行）**: 実行された行の割合

### カバレッジ目標

- **Use Cases**: 90%以上を目標（現在95.92%）
- **Adapters**: 80%以上を目標
- **ViewModels**: 85%以上を目標
- **Utilities**: 70%以上を目標

### カバレッジの確認

#### コンソール出力

```bash
npm run test:coverage
```

出力：
```
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------|---------|----------|---------|---------|-------------------
All files          |   26.64 |    80.14 |    55.1 |   26.64 |
 core/use-cases    |   95.92 |     85.6 |     100 |   95.92 |
  ...n.use-case.ts |     100 |    91.66 |     100 |     100 | 86,111
  ...n.use-case.ts |     100 |    96.96 |     100 |     100 | 220
  ...e.use-case.ts |   91.99 |    76.36 |     100 |   91.99 | ...89-506,572-579
  ...t.use-case.ts |     100 |    84.61 |     100 |     100 | 70-74
-------------------|---------|----------|---------|---------|-------------------
```

#### HTMLレポート

ブラウザで`coverage/index.html`を開くと：
- インタラクティブなファイルエクスプローラー
- 行ごとのカバレッジハイライト
- 分岐カバレッジの詳細
- 未カバーコードの識別

### カバレッジ設定

カバレッジから除外（`vitest.config.ts`内）：
- `node_modules/` - サードパーティコード
- `test/` - テストコード自体
- `src/infrastructure/**` - 外部フレームワーク統合
- `src/presentation/**` - UIコンポーネント（将来検討）

## トラブルシューティング

### 一般的な問題

#### 1. ピア依存関係エラーでインストール失敗

**問題**:
```
npm error ERESOLVE could not resolve
npm error peerOptional @types/node@"^18.0.0 || >=20.0.0" from vitest@1.6.1
```

**解決策**:
プロジェクトには`legacy-peer-deps=true`付きの`.npmrc`が含まれています。最新のコードがあることを確認してください：
```bash
git pull origin your-branch
npm install
```

#### 2. "crypto.randomUUID is not a function"でテストが失敗

**問題**: テスト環境でcryptoモックが欠落。

**解決策**: `test/setup.ts`で既に処理されています。最新バージョンを使用していることを確認してください。

#### 3. Obsidian APIメソッドが利用できない

**問題**: Obsidian API呼び出しで"undefined is not a function"エラー。

**解決策**: `test/mocks/obsidian.ts`に必要なメソッドが含まれているか確認。不足している場合は追加：
```typescript
export class Vault {
  // 不足しているメソッドを追加
  newMethod = vi.fn();
}
```

#### 4. ローカルでは成功するがCIで失敗

**チェックリスト**:
- ✅ すべてのテストファイルがコミットされているか確認
- ✅ Node.jsバージョンが一致しているか確認（v16+）
- ✅ npmバージョンを確認（v8+）
- ✅ `.npmrc`がコミットされているか確認
- ✅ タイミング依存のテストを確認（`vi.useFakeTimers()`を使用）

### テストのデバッグ

#### 詳細出力を有効化

```bash
npm test -- --reporter=verbose
```

#### 単一テストのデバッグ

```bash
# パターンに一致するテストのみ実行
npm test -- --grep="should handle auto-mention"
```

#### デバッグログを追加

```typescript
it('should do something', () => {
  console.log('Debug info:', someValue);  // コンソールに出力
  expect(result).toBe(expected);
});
```

#### VS Codeデバッガーを使用

`.vscode/launch.json`に追加：
```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Current Test File",
  "runtimeExecutable": "npm",
  "runtimeArgs": ["test", "--", "${relativeFile}"],
  "console": "integratedTerminal"
}
```

## ベストプラクティス

### 1. クリーンアーキテクチャの原則に従う

ビジネスロジック（Use Cases）をインフラストラクチャから分離してテスト：

```typescript
// ✅ 良い: モックされたポートでUse Caseをテスト
const mockAgentClient: IAgentClient = { /* ... */ };
const useCase = new SendMessageUseCase(mockAgentClient, /* ... */);

// ❌ 悪い: 実際のアダプターでUse Caseをテスト
const realAdapter = new AcpAdapter();
const useCase = new SendMessageUseCase(realAdapter, /* ... */);
```

### 2. テストを高速に保つ

- 実際のI/O操作の代わりにモックを使用
- 不要な`setTimeout`や遅延を避ける
- 時間依存テストには`vi.useFakeTimers()`を使用

```typescript
it('should timeout after 5 seconds', () => {
  vi.useFakeTimers();

  const promise = useCase.waitForResponse();

  vi.advanceTimersByTime(5000);

  expect(promise).rejects.toThrow('Timeout');

  vi.useRealTimers();
});
```

### 3. 実装ではなく振る舞いをテスト

```typescript
// ✅ 良い: 観測可能な振る舞いをテスト
it('should send message to agent', async () => {
  await useCase.sendMessage({ message: 'Hello' });
  expect(mockAgentClient.sendMessage).toHaveBeenCalledWith(
    expect.any(String),
    'Hello'
  );
});

// ❌ 悪い: 内部状態をテスト
it('should set internal flag', async () => {
  await useCase.sendMessage({ message: 'Hello' });
  expect(useCase['_internalFlag']).toBe(true);  // 壊れやすい
});
```

### 4. テストデータにファクトリーを使用

```typescript
// 再利用可能なテストデータファクトリーを作成
function createMockNote(overrides?: Partial<NoteMetadata>): NoteMetadata {
  return {
    path: 'notes/test.md',
    name: 'test',
    basename: 'test',
    extension: 'md',
    ...overrides,
  };
}

it('should handle note', () => {
  const note = createMockNote({ name: 'Custom Note' });
  // テストでnoteを使用
});
```

### 5. テスト駆動開発（TDD）

新機能追加時：
1. 期待される振る舞いの失敗テストを書く
2. テストを通過する最小限のコードを実装
3. テストをグリーンに保ちながらリファクタリング
4. 繰り返す

### 6. テスト品質を維持

- 本番コードと同じくらい厳密にテストコードをレビュー
- 本番コードをリファクタリングする際はテストもリファクタリング
- 削除された機能のテストを削除
- テストコードをDRY（Don't Repeat Yourself）に保つ

### 7. 複雑なテストシナリオを文書化

```typescript
it('should handle concurrent requests correctly', async () => {
  // シナリオ: 同じセッションに2つのメッセージを同時送信
  // 期待: 両方成功し、順序が保持される

  const promise1 = useCase.sendMessage({ message: 'First' });
  const promise2 = useCase.sendMessage({ message: 'Second' });

  await Promise.all([promise1, promise2]);

  // 順序を検証
  const calls = vi.mocked(mockAgentClient.sendMessage).mock.calls;
  expect(calls[0][1]).toBe('First');
  expect(calls[1][1]).toBe('Second');
});
```

---

## 次のステップ

### 計画中のテストカバレッジ

1. **Adapters**（現在0%）
   - VaultAdapter: Obsidian API統合
   - AcpAdapter: エージェント通信プロトコル
   - SettingsStore: 設定の永続化

2. **ViewModels**（現在0%）
   - ChatViewModel: UI状態管理

3. **Utilities**（現在20.54%）
   - chat-exporter: チャットをMarkdownにエクスポート
   - path-utils: パス操作
   - wsl-utils: WSL統合

### 貢献

テストを追加する際：
1. 既存のテストで確立されたパターンに従う
2. 新しいコードで90%以上のカバレッジを目指す
3. ハッピーパスとエラーケースの両方を含める
4. 複雑なテストシナリオを文書化
5. コミット前にローカルでテストを実行: `npm test`

---

## リソース

- [Vitestドキュメント](https://vitest.dev/)
- [Testing Library](https://testing-library.com/)
- [クリーンアーキテクチャのテスト](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [テスト駆動開発](https://martinfowler.com/bliki/TestDrivenDevelopment.html)

---

**最終更新**: 2025年11月
**テストフレームワーク**: Vitest 1.6.1
**カバレッジ**: 95.92%（Use Cases）
