#!/bin/sh
# Installs the pre-commit git hook for E2E tests.
# Run once after cloning: npm run install:hooks (from bandwagon/)

set -e

REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
HOOK_TARGET="$REPO_ROOT/.git/hooks/pre-commit"

cat > "$HOOK_TARGET" << 'HOOK'
#!/bin/sh
# Pre-commit hook: runs E2E fast suite before every commit.
# Set E2E_FULL=1 to run the complete suite (includes draft test, ~4 min).
# If .env.test is absent, the hook warns and exits cleanly.

BANDWAGON_DIR="$(git rev-parse --show-toplevel)/bandwagon"
cd "$BANDWAGON_DIR"

if [ ! -f .env.test ]; then
  echo ""
  echo "  ⚠️  .env.test not found — skipping E2E tests."
  echo "  Run 'cp .env.test.example .env.test' and fill in TEST_DATABASE_URL to enable."
  echo ""
  exit 0
fi

echo ""
echo "  🎵 Running Bandwagon E2E tests before commit..."
echo ""

if [ "$E2E_FULL" = "1" ]; then
  npm run test:e2e
else
  npm run test:e2e:fast
fi

STATUS=$?
if [ $STATUS -ne 0 ]; then
  echo ""
  echo "  ✗ E2E tests failed — commit blocked."
  echo "  Run 'npm run test:e2e:report' for details."
  echo "  Skip with: git commit --no-verify (not recommended)"
  echo ""
  exit 1
fi

echo ""
echo "  ✓ E2E tests passed."
echo ""
HOOK

chmod +x "$HOOK_TARGET"
echo "✅ Pre-commit hook installed at $HOOK_TARGET"
echo "   Run 'npm run test:e2e:fast' to test manually."
echo "   Use 'E2E_FULL=1 git commit' to run the full suite including draft."
