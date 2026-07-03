# Changelog

このファイルは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) 形式に準拠する。

PH-OS の `/api/*` エンドポイント群は、明示的な URL バージョンプレフィックス（`/api/v1/...`）を
持たないが、**暗黙的に v1 相当**として扱う（`docs/design/api-versioning-decision.md` §3 で確定）。
破壊的変更を行う場合は、事前にこのファイルへエントリを追加し、
`docs/api-versioning-policy.md` / `docs/api-versioning-implementation-guide.md` の
deprecation ライフサイクルに従う。

## [Unreleased]

### Added

- API deprecation 基盤（`src/lib/api/versioning.ts`, `src/lib/api/deprecation-catalog.ts`）を
  scaffolding として追加。現時点で deprecation カタログは空で、実際に deprecated 対象となる
  エンドポイントは未登録（Phase 14-5）。

## [1.0.0] - 2026-07-03

### Added

- 初期リリース。`/api/*` 配下の全 Route Handler を暗黙の v1 として宣言。
