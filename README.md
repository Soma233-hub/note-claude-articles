# note-claude-articles

Claude活用法に関するnote記事の自動生成・管理リポジトリ

## 構成

```
articles/     # 完成記事（Markdown）
drafts/       # 生成済み下書き（レビュー待ち）
```

## 記事シリーズ

| レベル | テーマ例 |
|--------|----------|
| 初級編 | 最初のプロンプト・チャット活用・日常業務への組み込み |
| 中級編 | プロンプト設計・ロールプレイ・文書生成・要約・翻訳 |
| 上級編 | Claude Code・API連携・自動化・エージェント活用 |

## 自動生成スケジュール

毎日 **23:30 JST** にClaudeが記事を自動生成します。
- 生成された記事は `drafts/` に保存
- レビュー後、`articles/` に移動してnoteに掲載
- 初級→中級→上級のサイクルで3レベルをローテーション

## ファイル命名規則

```
drafts/YYYYMMDD_<english-slug>.md
```

例: `drafts/20260518_claude-prompt-basics.md`
