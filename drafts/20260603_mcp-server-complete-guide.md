# MCPサーバー完全入門：ClaudeをSlack・GitHub・DBと繋ぐ実装ガイド

「Claudeは賢いけれど、社内のSlackに投稿したり、GitHubのIssueを自動で閉じたりはできない」——そう思っていませんか？それを可能にするのが **MCP（Model Context Protocol）** です。設定ファイルを1つ書くだけで、ClaudeはあなたのSlackにメッセージを送り、DBを直接クエリし、コードをpushできるエージェントに変わります。

---

## MCPとは何か：30秒で理解する

MCP（Model Context Protocol）は2024年11月にAnthropicがオープンソース公開した規格です。ひと言で言えば「**AIと外部ツールをつなぐUSBポート**」です。

- **Before MCP**: ClaudeはClaude.ai内の会話しかできない
- **After MCP**: Claude DesktopやAPIにMCPサーバーを接続すると、外部サービスを「ツール」として呼び出せる

MCPが普及する前は、外部ツール連携のたびにAPIラッパーをゼロから実装していました。MCPはその共通インターフェースを定義することで、一度書いたサーバーをあらゆるMCP対応クライアントで再利用できるようにしています。

---

## MCPのアーキテクチャ全体像

```mermaid
graph LR
    Claude["🤖 Claude\n(MCP Client)"]

    Claude -->|JSON-RPC over stdio| SlackMCP["💬 Slack MCP Server"]
    Claude -->|JSON-RPC over stdio| GitHubMCP["🐙 GitHub MCP Server"]
    Claude -->|JSON-RPC over HTTP+SSE| SQLiteMCP["🗄️ SQLite MCP Server"]
    Claude -->|JSON-RPC over stdio| FSMCP["📁 Filesystem MCP Server"]

    SlackMCP -->|Slack Web API| Slack["Slack\nWorkspace"]
    GitHubMCP -->|GitHub REST API| GitHub["GitHub\nRepository"]
    SQLiteMCP -->|SQLite3| DB["database.db"]
    FSMCP -->|Node.js fs| Files["ローカルファイル"]

    style Claude fill:#6d28d9,color:#fff
    style SlackMCP fill:#0d2137,color:#79c0ff,stroke:#388bfd
    style GitHubMCP fill:#0d2137,color:#79c0ff,stroke:#388bfd
    style SQLiteMCP fill:#0d2137,color:#79c0ff,stroke:#388bfd
    style FSMCP fill:#0d2137,color:#79c0ff,stroke:#388bfd
    style Slack fill:#1a1a2e,color:#c9d1d9,stroke:#56d364
    style GitHub fill:#1a1a2e,color:#c9d1d9,stroke:#56d364
    style DB fill:#1a1a2e,color:#c9d1d9,stroke:#56d364
    style Files fill:#1a1a2e,color:#c9d1d9,stroke:#56d364
```

ClaudeはJSON-RPC 2.0という軽量なプロトコルでMCPサーバーと通信します。通信経路は「stdio（標準入出力）」または「HTTP+SSE（Server-Sent Events）」の2択で、ローカルサーバーにはstdio、リモートサーバーにはHTTPが使われます。

---

## ツール呼び出しの仕組み：1リクエストの流れ

```mermaid
sequenceDiagram
    participant User as ユーザー
    participant Claude as Claude
    participant MCP as MCPサーバー
    participant API as 外部API

    User->>Claude: 「#generalに今日の日報を投稿して」
    Claude->>MCP: tools/list リクエスト
    MCP-->>Claude: [send_message, list_channels, ...] を返す
    Claude->>Claude: send_message() を選択・引数を生成
    Claude->>MCP: tools/call { name: "send_message", args: {...} }
    MCP->>API: POST /api/chat.postMessage
    API-->>MCP: { ok: true, ts: "1748950000" }
    MCP-->>Claude: ツール実行結果を返す
    Claude->>User: 「#generalに日報を投稿しました（ts: 1748950000）」
```

ポイントは「Claudeがどのツールをどんな引数で呼ぶかを**自律的に判断**する」点です。ユーザーは自然言語で指示するだけで、ツール選択・引数生成・結果解釈をすべてClaudeが担います。

---

## 実装ステップ1：Claude Desktopの設定ファイルを書く

MCP接続の設定は `claude_desktop_config.json` に記述します。ファイルの場所はOSによって異なります。

- **Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "slack": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-slack"],
      "env": {
        "SLACK_BOT_TOKEN": "xoxb-your-bot-token",
        "SLACK_TEAM_ID": "T0123456789"
      }
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_your_token_here"
      }
    },
    "sqlite": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sqlite", "/path/to/database.db"]
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/yourname/projects"]
    }
  }
}
```

設定後、Claude Desktopを再起動するだけで接続完了です。チャット画面の下部に「🔌 ツールが利用可能」のアイコンが表示されれば成功です。

---

## 実装ステップ2：Slack MCPでメッセージを自動投稿する

Slack MCPを使うには、まずSlack Appを作成してBot Tokenを取得する必要があります。

```
コピペ用プロンプト①: Slack日報自動投稿
---
以下の内容で #daily-report チャンネルに日報を投稿してください。

【本日の作業】
- タスクA: 完了
- タスクB: 進行中（80%）
- タスクC: 未着手

【明日の予定】
- タスクBの完了
- タスクDの着手

投稿後、投稿のタイムスタンプを教えてください。
---
```

Claudeはこのプロンプトを受け取ると、`send_message` ツールを呼び出し、チャンネル名・本文を自動で引数にセットして投稿します。

---

## 実装ステップ3：GitHub MCPでIssue管理を自動化する

```
コピペ用プロンプト②: バグ報告Issue自動作成
---
以下のバグ情報を元に、GitHubの soma233-hub/my-app リポジトリに
バグ報告Issueを作成してください。

【バグ内容】
- 現象: ログインボタンをクリックしても画面が遷移しない
- 再現環境: Chrome 124 / macOS Sonoma
- 再現手順: 1. トップページを開く 2. ログインボタンをクリック
- 期待動作: /dashboard へ遷移
- 実際の動作: 画面変化なし、コンソールにエラーなし

ラベル: bug, priority:high を付けてください。
---
```

```
コピペ用プロンプト③: PRレビュー自動チェック
---
リポジトリ soma233-hub/my-app の未マージPR一覧を取得し、
以下の条件で優先度を付けてレポートしてください。

優先度High: レビュー待ち3日以上
優先度Mid: 変更ファイル数が20以上
優先度Low: それ以外

表形式で出力してください。
---
```

---

## インタラクティブデモで体験する

MCPサーバーとツール呼び出しの仕組みを視覚的に確認できるシミュレーターを用意しました。Slack・GitHub・SQLite・Filesystemの4つのサーバーを切り替えながら、各ツールがどのような動作をするかを体験できます。

![デモ画面](../images/20260603_mcp-server-complete-guide/demo.png)

[→ デモを操作する](../demos/20260603_mcp-server-complete-guide/index.html)

---

## よくある実装ミスと対処法

| エラー | 原因 | 対処法 |
|--------|------|--------|
| `spawn npx ENOENT` | Node.jsのPATHが通っていない | `"command": "/usr/local/bin/npx"` と絶対パスで指定 |
| `Tool not found` | サーバーが起動していない | Claude Desktopを完全再起動 / ログを確認 |
| `Missing required env` | トークン未設定 | `env`ブロックにトークンを追加 |
| `Permission denied` | ファイルパスが制限外 | Filesystem MCPの許可ディレクトリを見直す |
| `Rate limit exceeded` | API呼び出しが多すぎる | バッチ処理プロンプトで1回の呼び出しをまとめる |

---

## 自作MCPサーバーの作り方（最小実装）

公式の `@modelcontextprotocol/sdk` を使えば、Node.jsで30行程度のサーバーを書けます。

```javascript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "my-mcp", version: "1.0.0" });

server.tool(
  "get_weather",
  { city: z.string() },
  async ({ city }) => {
    // ここに実際のAPI呼び出しを書く
    return { content: [{ type: "text", text: `${city}の天気: 晴れ 22℃` }] };
  }
);

await server.connect(new StdioServerTransport());
```

このサーバーを `claude_desktop_config.json` に登録するだけで、Claudeが `get_weather("Tokyo")` を呼び出せるようになります。ツール数・複雑度は自由に拡張できます。

---

## まとめ

- **MCPはAIと外部ツールをつなぐ共通規格**——一度書いたサーバーはすべてのMCP対応クライアントで再利用できる
- **設定はJSONファイル1つ**——`claude_desktop_config.json` にサーバー情報を書いて再起動するだけで接続完了
- **Slack・GitHub・SQLite・Filesystemは公式サーバーが存在**——`npx` 一発で動かせる
- **自然言語で指示するだけ**——ツール選択・引数生成・結果解釈はClaudeが担う
- **自作サーバーも30行程度**——社内専用APIや独自データソースとの連携も容易

---

## 次のステップ

明日すぐ試してほしいアクション：

1. **Claude Desktopをインストール**していない場合はまず導入する（[公式サイト](https://claude.ai/download)）
2. **Filesystem MCPだけ先に試す**——トークン不要でローカルファイルを読み書きできる最も簡単な入門
3. **Slack Bot Tokenを取得**し、`#test` チャンネルへの投稿を自動化してみる
4. デモを操作して、各MCPサーバーのツール一覧と実行フローを確認する

次回（木曜・初級編）は「Claudeでビジネスメールを3分で仕上げる：コピペ用テンプレート8選」を予定しています。MCPで自動投稿まで組み合わせれば、メール作業がゼロに近づきます。
