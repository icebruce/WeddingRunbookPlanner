#!/usr/bin/env bash
# PostToolUse(Bash) hook: push the current branch after a commit.
#
# Reads the hook payload on stdin and pushes only when the Bash command that
# just succeeded contained "git commit". Refuses to push the default branch,
# so a commit that lands on main stays local and still needs a deliberate push.
#
# Always exits 0: a failed push must never fail the tool call that triggered it.

set -uo pipefail

payload=$(cat 2>/dev/null || true)
command=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""' 2>/dev/null || true)

# Only react to commands that committed something.
case "$command" in
  *'git commit'*) ;;
  *) exit 0 ;;
esac

# Locate the repository from this script's own path (.claude/hooks/ -> root),
# because CLAUDE_PROJECT_DIR is not set in every environment.
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd) || exit 0
cd -- "$here/../.." >/dev/null 2>&1 || exit 0

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
[ -n "$branch" ] || exit 0
[ "$branch" = "HEAD" ] && exit 0   # detached HEAD: nothing meaningful to push

# Default-branch guard. origin/HEAD is often unset and init.defaultBranch is
# frequently empty, so fall back to the conventional names rather than to "".
default=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')
[ -n "$default" ] || default=$(git config --get init.defaultBranch 2>/dev/null)
[ -n "$default" ] || default=main
for protected in "$default" main master; do
  if [ "$branch" = "$protected" ]; then
    printf '{"systemMessage":"Auto-push skipped: %s is a default branch. Push it deliberately if you meant to."}\n' "$branch"
    exit 0
  fi
done

# Nothing ahead of the remote means nothing to do (covers --dry-run, --amend
# with no net change, and commands that merely mention git commit).
if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
  ahead=$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)
  [ "$ahead" = "0" ] && exit 0
fi

out=""
for delay in 0 2 4 8; do
  [ "$delay" = "0" ] || sleep "$delay"
  if out=$(git push -u origin "$branch" 2>&1); then
    printf '{"systemMessage":"Auto-pushed %s to origin."}\n' "$branch"
    exit 0
  fi
done

reason=$(printf '%s' "$out" | tr -d '"\\' | tr '\n' ' ' | tail -c 200)
printf '{"systemMessage":"Auto-push of %s failed after 4 attempts: %s"}\n' "$branch" "$reason"
exit 0
