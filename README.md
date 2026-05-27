# opencode-pkm

[opencode](https://opencode.ai) の headless サーバ（`opencode serve`）に、自分の Obsidian vault（PKM）をプロジェクトルートとしてマウントすることで、
**自分の PKM を文脈に応答する HTTP API** を提供するための docker compose 構成です。

opencode serve はカレントディレクトリをプロジェクトルートとして扱うため、vault をそのディレクトリに据えることで、
AI agent が vault 内のノートを横断的に読み書きしながら応答します。

---

## アーキテクチャ

```
HTTP クライアント ──HTTP──▶ opencode serve ──▶ litellm (OpenAI互換API)
                              │  ▲
              project root ───┘  └─── /data (named volume) に
          /ref/pkm-private          セッション DB を保存
          (Obsidian vault)
```

- **opencode**: `opencode serve`（headless HTTP サーバ、ポート `4096`）。litellm 互換エンドポイントで推論する。
- **プロジェクトルート = PKM vault**: コンテナの作業ディレクトリを `/ref/pkm-private`（マウントした Obsidian vault）に設定。
  opencode はここを起点にノートを読み書きするため、PKM を文脈とした応答ができる。
- **セッションの永続化**: opencode のセッション DB は `XDG_DATA_HOME=/data`（named volume `opencode-data`）に保存され、再起動後も保持される。
- **Web 検索（MCP）**: opencode に SearXNG の remote MCP を接続しており、AI が必要に応じて Web 検索を行える。

---

## 必要なもの

- Docker / docker compose（OrbStack や Docker Desktop でも可）
- litellm など OpenAI 互換 API のエンドポイントと API キー
- マウント対象の Obsidian vault（既定ではホストの `/home/ubuntu/pkm-private`）

---

## セットアップ

### 1. `.env` を用意

```bash
cp .env.example .env
```

`.env` を編集して以下を設定する（このファイルは `.gitignore` 済み。**コミットしないこと**）。

| 変数 | 必須 | 説明 |
|---|---|---|
| `LITELLM_BASE_URL` | ✅ | OpenAI 互換エンドポイント（例 `https://.../v1`） |
| `LITELLM_API_KEY` | ✅ | 上記の API キー |
| `PKM_VAULT_PATH` | ✅ | マウントする Obsidian vault のホスト側絶対パス |

### 2. vault のマウントパスを指定

ホストの Obsidian vault はコンテナの `/ref/pkm-private` にマウントされ、これが opencode のプロジェクトルートになる。
ホスト側パスは `.env` の `PKM_VAULT_PATH` で指定する（`docker-compose.yml` を編集する必要はない）。

```bash
# .env
PKM_VAULT_PATH=/path/to/your/obsidian-vault
```

`PKM_VAULT_PATH` は必須。未設定のまま `docker compose up` すると起動時にエラーになる。
`working_dir: /ref/pkm-private` により、opencode serve はこの vault をプロジェクトルートとして起動する。
マウントは読み書き可能なので、AI はノートの参照に加えて作成・編集も行える。

### 3. モデル設定

opencode が使うプロバイダ／モデルは `opencode/opencode.json` で定義。API キーは `{env:LITELLM_API_KEY}` 置換で実行時に注入するため、**このファイルに秘密情報は書かない**。

- **画像対応**: 画像を扱うには各モデルに `"attachment": true` と `"modalities": { "input": ["text", "image"], ... }` を設定する（既定モデルは設定済み）。
- **MCP**: `mcp` セクションで外部ツールを接続できる。既定では SearXNG の remote MCP（Web 検索）を有効化している。不要なら `enabled: false` にする。

---

## 起動（docker compose）

```bash
docker compose up -d --build      # ビルドして起動
docker compose logs -f opencode   # ログ追従
docker compose ps                 # 稼働状況
docker compose down               # 停止（セッション DB の volume は保持）
```

起動後、`http://localhost:4096` で opencode の HTTP API に到達できる。

### 死活確認

```bash
curl -s http://localhost:4096/global/health
# または compose 内部から
docker compose exec opencode node -e "fetch('http://127.0.0.1:4096/global/health').then(r=>r.json()).then(console.log)"
```

### API の使い方（例）

opencode の HTTP API でセッションを作り、PKM を文脈にプロンプトを送る。
詳細なエンドポイント仕様は [opencode の公式ドキュメント](https://opencode.ai/docs/) を参照。

```bash
# 例: セッションを作成
curl -s -X POST http://localhost:4096/session -H 'content-type: application/json' -d '{}'
```

---

## 運用・保守

### ログの確認

```bash
docker compose logs -f opencode      # opencode サーバ
docker compose logs --since 1h opencode
```

### 再起動 / 更新

```bash
docker compose restart opencode             # 再起動
docker compose up -d --build                # 設定変更を反映して再起動

# opencode 本体や依存を最新化（イメージを作り直す）
docker compose build --no-cache opencode
docker compose up -d opencode
```

> `opencode-ai` のバージョンを上げたい場合は `opencode/Dockerfile` の
> `npm install -g opencode-ai` を再ビルドする（必要ならバージョン固定推奨）。

### データの永続化とリセット

| データ | 保存先 | リセット方法 |
|---|---|---|
| opencode セッション DB | named volume `opencode-data` | `docker compose down -v` または `docker volume rm opencode-pkm_opencode-data` |
| PKM vault | ホストの vault ディレクトリ | コンテナ管理外（Obsidian 側で管理） |

> ⚠️ vault は読み書き可能でマウントされているため、AI がノートを編集・削除する可能性がある。
> 重要なノートはバージョン管理（git 等）やバックアップを別途用意することを推奨。

### バックアップ

```bash
# opencode セッション DB（volume を tar 化）
docker run --rm -v opencode-pkm_opencode-data:/data -v "$PWD":/backup \
  busybox tar czf /backup/opencode-data-$(date +%F).tgz -C /data .
```

---

## トラブルシュート

| 症状 | 確認ポイント |
|---|---|
| opencode が unhealthy | `docker compose logs opencode` / litellm への到達性 / config の `{env:...}` が解決されているか |
| 応答が PKM を参照しない | `working_dir` が `/ref/pkm-private` か / vault が正しくマウントされているか（`docker compose exec opencode ls /ref/pkm-private`） |
| API 呼び出しに失敗 | `LITELLM_API_KEY` / `LITELLM_BASE_URL` が正しいか（`docker compose logs opencode`） |

---

## セキュリティ上の注意

- `.env` は `.gitignore` 済み。**API キーは絶対にコミットしない。**
- `opencode/opencode.json` はキーを直書きせず `{env:...}` 参照のみ（リポジトリにもイメージにも秘密情報を残さない）。
- vault は読み書き可能でマウントしている。AI による意図しない変更を避けたい場合は、`docker-compose.yml` のマウントを `:ro`（読み取り専用）にする。
- opencode サーバを外部公開する場合は `OPENCODE_SERVER_PASSWORD` 等の認証を検討する。

---

## ディレクトリ構成

```
opencode-pkm/
├── docker-compose.yml        # opencode serve サービス（vault を project root にマウント）
├── opencode/
│   ├── Dockerfile            # opencode サーバイメージ
│   └── opencode.json         # プロバイダ/モデル/MCP 設定（秘密情報なし）
├── .env.example              # 環境変数テンプレート
└── .env                      # litellm の接続情報（gitignore）
```
