#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s init\n' "$(basename "$0")" >&2
}

resolve_script_dir() {
  local source="${BASH_SOURCE[0]}"
  while [ -L "$source" ]; do
    local dir
    dir="$(cd -P "$(dirname "$source")" >/dev/null 2>&1 && pwd)"
    source="$(readlink "$source")"
    [[ "$source" != /* ]] && source="$dir/$source"
  done
  cd -P "$(dirname "$source")" >/dev/null 2>&1 && pwd
}

normalize_repo_root() {
  local candidate="$1"
  [ -d "$candidate" ] || return 1
  git -C "$candidate" rev-parse --show-toplevel 2>/dev/null || (cd "$candidate" && pwd -P)
}

resolve_target_root() {
  local candidate
  for candidate in \
    "${WORKSPACE_TARGET_PATH:-}" \
    "${CONDUCTOR_WORKSPACE_PATH:-}" \
    "${T3CODE_WORKTREE_PATH:-}" \
    "${CODEX_WORKTREE_PATH:-}"; do
    [ -n "$candidate" ] || continue
    normalize_repo_root "$candidate" && return
  done

  local git_root
  if git_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
    printf '%s\n' "$git_root"
    return
  fi

  resolve_script_dir
}

resolve_source_root() {
  local target_root="$1"
  local candidate
  for candidate in \
    "${WORKSPACE_SOURCE_PATH:-}" \
    "${CONDUCTOR_ROOT_PATH:-}" \
    "${T3CODE_PROJECT_ROOT:-}" \
    "${CODEX_SOURCE_TREE_PATH:-}"; do
    [ -n "$candidate" ] || continue
    normalize_repo_root "$candidate" && return
  done

  local common_dir
  if common_dir="$(git -C "$target_root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; then
    normalize_repo_root "$(dirname "$common_dir")"
  fi
}

# T3 Code and plain `git worktree add` don't copy ignored files, so reapply
# .worktreeinclude from the source checkout. Missing files only: never
# overwrite per-worktree edits.
reapply_worktreeinclude_files() {
  local target_root="$1"
  local source_root="$2"
  local include_file="$source_root/.worktreeinclude"
  local copied=0
  local rel

  [ -n "$source_root" ] && [ "$source_root" != "$target_root" ] && [ -f "$include_file" ] || return 0

  while IFS= read -r -d '' rel; do
    [ -e "$target_root/$rel" ] || [ -L "$target_root/$rel" ] && continue
    mkdir -p "$(dirname "$target_root/$rel")"
    cp -p "$source_root/$rel" "$target_root/$rel"
    copied=$((copied + 1))
  done < <(git -C "$source_root" ls-files --others --ignored --exclude-from="$include_file" -z)

  if [ "$copied" -gt 0 ]; then
    printf 'workspace-setup: copied %d ignored local file(s) via .worktreeinclude\n' "$copied"
  fi
}

main() {
  local command="${1:-}"
  case "$command" in
    init) ;;
    *)
      usage
      return 64
      ;;
  esac

  local target_root
  target_root="$(resolve_target_root)"

  if [ ! -d "$target_root" ]; then
    printf 'workspace-setup: target path does not exist: %s\n' "$target_root" >&2
    return 1
  fi

  cd "$target_root"

  if [ ! -f package.json ]; then
    printf 'workspace-setup: package.json not found in %s\n' "$target_root" >&2
    return 1
  fi

  reapply_worktreeinclude_files "$target_root" "$(resolve_source_root "$target_root" || true)"

  # No placeholder copy from .env.example: a fake bot token can't run anything
  # and would block a later managed copy of the real .env.
  if [ ! -e .env ]; then
    printf 'workspace-setup: no .env; copy .env.example to .env and fill it in before running the bot\n' >&2
  fi

  if ! command -v bun >/dev/null 2>&1; then
    printf 'workspace-setup: bun is required. Install it from https://bun.sh, then retry.\n' >&2
    return 1
  fi

  bun install --frozen-lockfile
}

main "$@"
