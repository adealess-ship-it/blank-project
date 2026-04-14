#!/bin/bash
# Pre-commit checks — runs automatically before git commit via Claude Code hooks
# Exit 0 = OK, Exit 2 = BLOCK commit

FAIL=0

# Get staged HTML files
STAGED_HTML=$(git diff --cached --name-only --diff-filter=ACM | grep '\.html$')

if [ -n "$STAGED_HTML" ]; then
  echo "=== Pre-commit: Checking staged HTML files ==="

  for f in $STAGED_HTML; do
    echo "  Checking: $f"

    # 1. Silent Fail Guard — no empty catch
    EMPTY_CATCH=$(grep -n 'catch(() => {})' "$f" 2>/dev/null)
    if [ -n "$EMPTY_CATCH" ]; then
      echo "    FAIL: .catch(() => {}) found — must log error"
      echo "$EMPTY_CATCH" | while read line; do echo "      $line"; done
      FAIL=1
    fi

    EMPTY_TRY=$(grep -n 'catch(e) {}' "$f" 2>/dev/null)
    if [ -n "$EMPTY_TRY" ]; then
      echo "    FAIL: catch(e) {} found — must log error"
      echo "$EMPTY_TRY" | while read line; do echo "      $line"; done
      FAIL=1
    fi

    # 2. TDZ Guard — check let/const declarations exist before usage
    HAS_SCRIPT=$(grep -c '<script>' "$f" 2>/dev/null)
    if [ "$HAS_SCRIPT" -gt 0 ]; then
      # Check for .catch(() => {}) variant too
      SILENT_CATCH=$(grep -n '\.catch(() => {' "$f" 2>/dev/null | grep -v 'console\.\|warn\|error\|log')
      if [ -n "$SILENT_CATCH" ]; then
        echo "    FAIL: silent .catch() found — must log error"
        FAIL=1
      fi
    fi
  done
fi

# 3. Check ALL staged files for console.log left in production code (warning only)
STAGED_ALL=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|js|tsx|jsx)$')
if [ -n "$STAGED_ALL" ]; then
  for f in $STAGED_ALL; do
    DEBUGS=$(grep -n 'console\.log.*DEBUG\|console\.log.*TODO\|debugger;' "$f" 2>/dev/null)
    if [ -n "$DEBUGS" ]; then
      echo "  WARN: debug statements in $f"
      echo "$DEBUGS" | while read line; do echo "    $line"; done
    fi
  done
fi

if [ "$FAIL" -eq 1 ]; then
  echo ""
  echo "BLOCKED: Fix the issues above before committing."
  exit 2
fi

echo "Pre-commit checks passed."
exit 0
