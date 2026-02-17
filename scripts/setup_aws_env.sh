#!/usr/bin/env bash
set -euo pipefail

PROFILE="tempo-sandbox"
REGION="us-east-1"

if ! command -v aws >/dev/null 2>&1; then
  echo "AWS CLI not found. Install it first (e.g. brew install awscli)." >&2
  exit 1
fi

echo "Configuring AWS profile '${PROFILE}'..."
aws configure set aws_access_key_id "$AWS_ACCESS_KEY_ID" --profile "${PROFILE}"
aws configure set aws_secret_access_key "$AWS_SECRET_ACCESS_KEY" --profile "${PROFILE}"
aws configure set aws_session_token "$AWS_SESSION_TOKEN" --profile "${PROFILE}"
aws configure set region "${REGION}" --profile "${PROFILE}"
aws configure set output json --profile "${PROFILE}"

echo "Verifying credentials..."
aws sts get-caller-identity --profile "${PROFILE}"

cat <<EOF

Done. Export these before running CDK:
  export AWS_PROFILE=${PROFILE}
  export AWS_DEFAULT_REGION=${REGION}
  export AWS_ACCOUNT_ID=\$(aws sts get-caller-identity --query Account --output text --profile ${PROFILE})
EOF