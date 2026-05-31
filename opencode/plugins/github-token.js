// GitHub 短命トークンの発行／失効を担う opencode プラグイン。
//
// 設計（n8n ブローカー連携を1ファイルに集約・git/gh コマンド限定）:
//   - tool.execute.before : git の network 操作（push/pull/fetch/clone/ls-remote/remote update）や
//       gh コマンド（GitHub API を叩く操作）を含む bash コマンドの直前に n8n の POST /github/token を叩き、
//       短命トークン（ghs_..., 約1h）を発行して /tmp/n8n-gh-token に書く。git はこの後、薄い credential helper
//       (/usr/local/bin/git-credential-n8n) 経由で、gh は薄いラッパー (/usr/local/bin/gh) が GH_TOKEN として
//       読み取り、github.com に認証する。
//   - tool.execute.after  : その bash コマンド完了直後に POST /github/revoke で即失効し、
//       トークンファイルを削除する。after は「コマンド完了後」に発火するため、push 送信中の
//       トークンを壊さずに失効できる（credential helper 内では store がパック送信前に呼ばれるため不可）。
//
// 長命の GitHub 秘密（App 秘密鍵）はこのコンテナに置かない。opencode が触れるのは
// 短命・最小スコープのトークンだけ、という非対称設計（wiki『AI開発支援エージェント活用』）の実装。
//
// セキュリティ: トークン値はログ・チャット・コマンド文字列に一切出さない（件数のみログ）。

import { writeFileSync, rmSync } from "node:fs"

const TOKEN_FILE = "/tmp/n8n-gh-token"

// 認証を要する git の network 操作だけを対象にする（commit/status 等はトークン不要）。
const GIT_RE = /\bgit\b/
const NET_RE = /\b(push|pull|fetch|clone|ls-remote|remote\s+update)\b/
// gh は基本どのサブコマンドも GitHub API を叩くため、gh 実行は一律でトークンを要する。
const GH_RE = /\bgh\b/

/** bash ツールかつ git の network コマンド、または gh コマンドか（GitHub 認証が要る操作）。 */
function needsToken(tool, command) {
  if (tool !== "bash" || typeof command !== "string") return false
  if (GIT_RE.test(command) && NET_RE.test(command)) return true
  if (GH_RE.test(command)) return true
  return false
}

function baseUrl() {
  const base = process.env.N8N_WEBHOOK_BASE_URL
  return base ? base.replace(/\/+$/, "") : undefined
}

export const GithubToken = async ({ client }) => {
  // callID -> token。before で発行したトークンを after で失効するための対応表。
  const issued = new Map()

  const log = async (level, message) => {
    try {
      await client.app.log({ body: { service: "github-token", level, message } })
    } catch {
      // ログ失敗は本処理に影響させない。
    }
  }

  // ロード確認用（運用時の死活確認にも使える）。トークン値は出さない。
  await log("info", "plugin loaded (n8n GitHub token broker)")

  return {
    // ── 発行: git network / gh コマンドの直前 ──
    // before では実行引数は第2引数 output.args に入る（型: { args }）。
    "tool.execute.before": async (input, output) => {
      const command = output?.args?.command
      if (!needsToken(input.tool, command)) return

      const base = baseUrl()
      if (!base) {
        await log("error", "N8N_WEBHOOK_BASE_URL is not set; cannot mint GitHub token")
        // 古い/失効済みトークンを使わせないため、残っていれば消す。
        rmSync(TOKEN_FILE, { force: true })
        return
      }

      try {
        const res = await fetch(`${base}/github/token`, { method: "POST" })
        if (!res.ok) throw new Error(`token endpoint returned ${res.status}`)
        const token = (await res.json())?.token
        if (!token) throw new Error("no token in response")

        writeFileSync(TOKEN_FILE, token, { mode: 0o600 })
        issued.set(input.callID, token)
        await log("info", "issued short-lived GitHub token")
      } catch (e) {
        rmSync(TOKEN_FILE, { force: true })
        await log("error", `failed to mint GitHub token: ${e?.message ?? e}`)
      }
    },

    // ── 失効: git network / gh コマンドの完了直後 ──
    // after では実行引数は input.args に入る（型: { tool, sessionID, callID, args }）。
    "tool.execute.after": async (input) => {
      const token = issued.get(input.callID)
      // このコマンドで発行していなければ何もしない（git/gh 以外の bash も素通り）。
      if (!token) return

      issued.delete(input.callID)
      // credential helper が古いトークンを返さないよう、まずファイルを消す。
      rmSync(TOKEN_FILE, { force: true })

      const base = baseUrl()
      if (!base) return

      try {
        await fetch(`${base}/github/revoke`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        })
        await log("info", "revoked short-lived GitHub token")
      } catch (e) {
        // 失効に失敗しても GitHub 仕様の 1h 自動失効が backstop。
        await log("warn", `failed to revoke GitHub token (will auto-expire): ${e?.message ?? e}`)
      }
    },
  }
}
