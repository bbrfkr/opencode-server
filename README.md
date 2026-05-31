# opencode-server

[opencode](https://opencode.ai) の headless サーバ（`opencode serve`）をコンテナ化した、**再利用可能な opencode サーバーの単一の真実点**です。
project root にマウントする対象を切り替えるだけで、用途の異なる複数のデプロイを **同一イメージ・同一 compose** でまかなえます。

- **PKM 用途**: 自分の Obsidian vault をマウント → 自分の PKM を文脈に応答する HTTP API
- **bot 用途**: n8n ワークフロー仕様リポ等をマウント → discord bot 等のクライアントが接続する作業用サーバー

クライアント（discord bot 等）はこのサーバーを起動・同梱せず、`OPENCODE_BASE_URL` で **HTTP 接続**する。
これにより「opencode サーバー」と「それを使うアプリ」が疎結合に分離される。

---

## アーキテクチャ

```
HTTP クライアント ──HTTP──▶ opencode serve ──▶ litellm (OpenAI互換API)
 (discord bot 等)             │  ▲
              project root ───┘  └─── /data (named volume) に
              /root/project          セッション DB を保存
        (vault または docs 等)
                              │
                              └──curl(POST)──▶ n8n ブローカー（短命 GitHub トークン）
```

- **opencode**: `opencode serve`（headless HTTP サーバ、ポート `4096`）。litellm 互換エンドポイントで推論する。
- **プロジェクトルート**: コンテナの作業ディレクトリ `/root/project` にマウントしたものを起点にノート/ファイルを読み書きする。マウント対象は `.env` の `PROJECT_PATH` で切り替える。
- **セキュアな GitHub 操作（n8n 短命トークン）**: git の HTTPS 認証も gh の API 認証も、長命の静的トークンを持たせず、n8n ブローカー経由の短命トークン（GitHub App installation token, 約1h）で行う。発行/失効は opencode プラグイン (`opencode/plugins/github-token.js`) が git network / gh 実行の前後で担当する。
- **defuddle 同梱**: skill が Web ページ取得に `defuddle parse <url> --md` を使う（jsdom ベース・ブラウザ不要）。
- **セッションの永続化**: セッション DB は `XDG_DATA_HOME=/data`（named volume `opencode-data`）に保存され、再起動後も保持される。
- **Web 検索（MCP）**: SearXNG の remote MCP を接続しており、AI が必要に応じて Web 検索を行える。

---

## 必要なもの

- Docker / docker compose（OrbStack や Docker Desktop でも可）
- litellm など OpenAI 互換 API のエンドポイントと API キー
- project root にマウントする対象（Obsidian vault や n8n ワークフロー仕様リポ等）
- n8n ブローカーの Webhook URL（`github-token` ワークフロー）

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
| `PROJECT_PATH` | ✅ | `/root/project` にマウントする対象のホスト側絶対パス（vault または docs 等） |
| `N8N_WEBHOOK_BASE_URL` | ✅ | n8n の Webhook 親 URL（`/github/token`・`/github/revoke` の手前、`/webhook` まで） |
| `GIT_USER_NAME` | ✅ | AI が作るコミットの著者名 |
| `GIT_USER_EMAIL` | ✅ | AI が作るコミットの著者メール |

### 2. project root のマウントパスを指定

マウント対象はコンテナの `/root/project` にマウントされ、これが opencode のプロジェクトルートになる。
ホスト側パスは `.env` の `PROJECT_PATH` で指定する（`docker-compose.yml` を編集する必要はない）。

```bash
# .env（PKM 用途の例）
PROJECT_PATH=/path/to/your/obsidian-vault
```

`PROJECT_PATH` は必須。未設定のまま `docker compose up` すると起動時にエラーになる。
マウントは読み書き可能なので、AI は参照に加えて作成・編集も行える。

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

起動後、`http://localhost:4096` で opencode の HTTP API に到達できる。クライアントはこの URL を `OPENCODE_BASE_URL` に設定して接続する。

### 死活確認

```bash
curl -s http://localhost:4096/global/health
# または compose 内部から
docker compose exec opencode node -e "fetch('http://127.0.0.1:4096/global/health').then(r=>r.json()).then(console.log)"
```

---

## GitHub 連携（n8n 短命トークン）

git の push/pull/clone 等の network 操作と gh コマンドは、n8n ブローカー経由の短命トークンで認証する。
長命の GitHub 秘密（App 秘密鍵）はこのコンテナに置かず、opencode が触れるのは短命・最小スコープのトークンだけ、という非対称設計。

- `opencode/plugins/github-token.js`: git network / gh 実行の直前に `POST /github/token` で発行（`/tmp/n8n-gh-token` に書込）、完了直後に `POST /github/revoke` で失効。
- `opencode/git-credential-n8n`: git の credential helper。`/tmp/n8n-gh-token` を読んで渡すだけの薄い受け渡し役。
- `opencode/gh`: gh ラッパー。同ファイルを `GH_TOKEN` として実体 gh に渡すだけ。

> トークン値はログ・チャット・コマンド文字列に一切出さない設計。失効に失敗しても GitHub 仕様の 1h 自動失効が backstop。

---

## 運用・保守

### 再起動 / 更新

```bash
docker compose restart opencode             # 再起動
docker compose up -d --build                # 設定変更を反映して再起動

# opencode 本体や依存を最新化（イメージを作り直す）
docker compose build --no-cache opencode
docker compose up -d opencode
```

> `opencode-ai` / `defuddle` のバージョンを上げたい場合は `opencode/Dockerfile` の
> `npm install -g opencode-ai defuddle` を再ビルドする（必要ならバージョン固定推奨）。

### データの永続化とリセット

| データ | 保存先 | リセット方法 |
|---|---|---|
| opencode セッション DB | named volume `opencode-data` | `docker compose down -v` または `docker volume rm opencode-server_opencode-data` |
| project root | ホストのマウント元ディレクトリ | コンテナ管理外 |

> ⚠️ project root は読み書き可能でマウントされているため、AI がファイルを編集・削除する可能性がある。
> 重要なデータはバージョン管理（git 等）やバックアップを別途用意することを推奨。

---

## トラブルシュート

| 症状 | 確認ポイント |
|---|---|
| opencode が unhealthy | `docker compose logs opencode` / litellm への到達性 / config の `{env:...}` が解決されているか |
| 応答が project を参照しない | `working_dir` が `/root/project` か / マウントが正しいか（`docker compose exec opencode ls /root/project`） |
| API 呼び出しに失敗 | `LITELLM_API_KEY` / `LITELLM_BASE_URL` が正しいか |
| git push/pull が認証エラー | `N8N_WEBHOOK_BASE_URL` が正しいか / n8n の `github-token` ワークフローが稼働しているか |

---

## セキュリティ上の注意

- `.env` は `.gitignore` 済み。**API キーは絶対にコミットしない。**
- `opencode/opencode.json` はキーを直書きせず `{env:...}` 参照のみ（リポジトリにもイメージにも秘密情報を残さない）。
- GitHub 認証は静的トークンを持たせず n8n 短命トークンに一本化している。
- project root は読み書き可能でマウントしている。意図しない変更を避けたい場合は `docker-compose.yml` のマウントを `:ro`（読み取り専用）にする。
- opencode サーバを外部公開する場合は `OPENCODE_SERVER_PASSWORD` 等の認証を検討する。

---

## ディレクトリ構成

```
opencode-server/
├── docker-compose.yml          # opencode serve サービス（PROJECT_PATH を project root にマウント）
├── opencode/
│   ├── Dockerfile              # opencode サーバイメージ（n8n 短命トークン機構 + defuddle 同梱）
│   ├── opencode.json           # プロバイダ/モデル/MCP 設定（秘密情報なし）
│   ├── gh                      # gh ラッパー（短命トークンを GH_TOKEN として渡すだけ）
│   ├── git-credential-n8n      # git credential helper（短命トークンを渡すだけ）
│   └── plugins/
│       └── github-token.js     # n8n ブローカーで短命トークンを発行/失効する opencode プラグイン
├── .env.example                # 環境変数テンプレート
└── .env                        # 接続情報（gitignore）
```
