#!/usr/bin/env bash
set -euo pipefail

: "${AWS_PROFILE:?Set AWS_PROFILE first}"
: "${AWS_DEFAULT_REGION:?Set AWS_DEFAULT_REGION first}"
: "${AWS_ACCOUNT_ID:?Set AWS_ACCOUNT_ID first}"

STAGE="${1:-dev}"

cd "$(dirname "${BASH_SOURCE[0]}")/../A2/infrastructure"

npm install
npm run build

echo "Bootstrapping (safe to rerun)..."
npx cdk bootstrap "aws://${AWS_ACCOUNT_ID}/${AWS_DEFAULT_REGION}"

echo "Deploying stage '${STAGE}'..."

STACKS=("TempoFlow-Infra-${STAGE}")
PARAMS=()

if [ "${DEPLOY_WEB_STACK:-0}" = "1" ]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: Docker is required when DEPLOY_WEB_STACK=1 (CDK builds the web-app image locally)." >&2
    echo "Use DEPLOY_AMPLIFY_WEB_STACK=1 for frontend hosting without Docker, or install Docker Desktop." >&2
    exit 1
  fi
fi

if [ "${DEPLOY_WEB_STACK:-0}" = "1" ]; then
  STACKS+=("TempoFlow-Web-${STAGE}")
fi

if [ "${DEPLOY_AMPLIFY_WEB_STACK:-0}" = "1" ]; then
  : "${AMPLIFY_GITHUB_REPO:?Set AMPLIFY_GITHUB_REPO to 'owner/repo'}"
  : "${AMPLIFY_GITHUB_ACCESS_TOKEN:?Set AMPLIFY_GITHUB_ACCESS_TOKEN (GitHub PAT classic) for Amplify}"
  STACKS+=("TempoFlow-AmplifyWeb-${STAGE}")
  PARAMS+=(--parameters "TempoFlow-AmplifyWeb-${STAGE}:GitHubAccessToken=${AMPLIFY_GITHUB_ACCESS_TOKEN}")
fi

if [ "${DEPLOY_A5_BACKEND_STACK:-0}" = "1" ]; then
  : "${GEMINI_API_KEY:?Set GEMINI_API_KEY for A5 backend (NoEcho parameter; do not commit)}"
  STACKS+=("TempoFlow-A5Backend-${STAGE}")
  PARAMS+=(--parameters "TempoFlow-A5Backend-${STAGE}:GeminiApiKey=${GEMINI_API_KEY}")
fi

export STAGE="${STAGE}"
npx cdk deploy "${STACKS[@]}" "${PARAMS[@]}"
