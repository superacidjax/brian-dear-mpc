#!/usr/bin/env bash
set -euo pipefail

echo "Deprecated: use infra/cloudformation/*.yaml for production infrastructure. This script is retained only until the CloudFormation deployment is verified." >&2

: "${AWS_ACCOUNT_ID:?AWS_ACCOUNT_ID is required}"
: "${AWS_REGION:=us-east-1}"
: "${BEDROCK_API_KEY:?BEDROCK_API_KEY is required}"
: "${SLACK_BOT_TOKEN:?SLACK_BOT_TOKEN is required}"
: "${SLACK_SIGNING_SECRET:?SLACK_SIGNING_SECRET is required}"
: "${SLACK_BRIAN_USER_ID:?SLACK_BRIAN_USER_ID is required}"

APP_NAME="brian-dear-career-mcp"
ENV_NAME="prod"
SERVICE_NAME="${APP_NAME}-${ENV_NAME}"
IMAGE_REPO_NAME="${APP_NAME}"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)}"
BUILD_BUCKET="${APP_NAME}-build-${AWS_ACCOUNT_ID}-${AWS_REGION}"
SOURCE_KEY="source/${IMAGE_TAG}.zip"
SOURCE_ARCHIVE="/tmp/${APP_NAME}-${IMAGE_TAG}.zip"
SECRET_PREFIX="/${APP_NAME}/${ENV_NAME}"
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${IMAGE_REPO_NAME}:${IMAGE_TAG}"
BRAIN_TABLE_NAME="${APP_NAME}-brain-${ENV_NAME}"

aws_cmd() {
  AWS_DEFAULT_REGION="$AWS_REGION" AWS_CLI_FOLLOW_URLPARAM=false aws "$@"
}

ensure_secret() {
  local name="$1"
  local value="$2"
  local secret_file
  secret_file="$(mktemp)"
  printf "%s" "$value" > "$secret_file"
  if aws_cmd secretsmanager describe-secret --secret-id "$name" >/dev/null 2>&1; then
    aws_cmd secretsmanager put-secret-value --secret-id "$name" --secret-string "file://${secret_file}" >/dev/null
  else
    aws_cmd secretsmanager create-secret --name "$name" --secret-string "file://${secret_file}" >/dev/null
  fi
  rm -f "$secret_file"
}

ensure_role() {
  local role_name="$1"
  local trust_file="$2"
  if ! aws_cmd iam get-role --role-name "$role_name" >/dev/null 2>&1; then
    aws_cmd iam create-role --role-name "$role_name" --assume-role-policy-document "file://${trust_file}" >/dev/null
  fi
}

echo "Creating/updating secrets..."
if [[ -z "${ADMIN_TOKEN:-}" ]]; then
  if AWS_DEFAULT_REGION="$AWS_REGION" AWS_CLI_FOLLOW_URLPARAM=false aws secretsmanager describe-secret --secret-id "${SECRET_PREFIX}/ADMIN_TOKEN" >/dev/null 2>&1; then
    ADMIN_TOKEN="$(AWS_DEFAULT_REGION="$AWS_REGION" AWS_CLI_FOLLOW_URLPARAM=false aws secretsmanager get-secret-value --secret-id "${SECRET_PREFIX}/ADMIN_TOKEN" --query SecretString --output text)"
  else
    ADMIN_TOKEN="$(python3 - <<'PY'
import secrets
print(secrets.token_hex(24))
PY
)"
  fi
fi
ensure_secret "${SECRET_PREFIX}/BEDROCK_API_KEY" "$BEDROCK_API_KEY"
ensure_secret "${SECRET_PREFIX}/SLACK_BOT_TOKEN" "$SLACK_BOT_TOKEN"
ensure_secret "${SECRET_PREFIX}/SLACK_SIGNING_SECRET" "$SLACK_SIGNING_SECRET"
ensure_secret "${SECRET_PREFIX}/SLACK_BRIAN_USER_ID" "$SLACK_BRIAN_USER_ID"
ensure_secret "${SECRET_PREFIX}/SLACK_USER_LOG_CHANNEL_ID" "${SLACK_USER_LOG_CHANNEL_ID:-$SLACK_BRIAN_USER_ID}"
ensure_secret "${SECRET_PREFIX}/SLACK_HUMAN_EVAL_CHANNEL_ID" "${SLACK_HUMAN_EVAL_CHANNEL_ID:-$SLACK_BRIAN_USER_ID}"
ensure_secret "${SECRET_PREFIX}/SLACK_MOCK_INTERVIEW_CHANNEL_ID" "${SLACK_MOCK_INTERVIEW_CHANNEL_ID:-$SLACK_BRIAN_USER_ID}"
ensure_secret "${SECRET_PREFIX}/SLACK_INTERVIEW_REQUEST_CHANNEL_ID" "${SLACK_INTERVIEW_REQUEST_CHANNEL_ID:-$SLACK_BRIAN_USER_ID}"
ensure_secret "${SECRET_PREFIX}/ADMIN_TOKEN" "$ADMIN_TOKEN"

BEDROCK_SECRET_ARN="$(aws_cmd secretsmanager describe-secret --secret-id "${SECRET_PREFIX}/BEDROCK_API_KEY" --query ARN --output text)"
BOT_TOKEN_SECRET_ARN="$(aws_cmd secretsmanager describe-secret --secret-id "${SECRET_PREFIX}/SLACK_BOT_TOKEN" --query ARN --output text)"
SIGNING_SECRET_ARN="$(aws_cmd secretsmanager describe-secret --secret-id "${SECRET_PREFIX}/SLACK_SIGNING_SECRET" --query ARN --output text)"
BRIAN_USER_SECRET_ARN="$(aws_cmd secretsmanager describe-secret --secret-id "${SECRET_PREFIX}/SLACK_BRIAN_USER_ID" --query ARN --output text)"
USER_LOG_CHANNEL_SECRET_ARN="$(aws_cmd secretsmanager describe-secret --secret-id "${SECRET_PREFIX}/SLACK_USER_LOG_CHANNEL_ID" --query ARN --output text)"
HUMAN_EVAL_CHANNEL_SECRET_ARN="$(aws_cmd secretsmanager describe-secret --secret-id "${SECRET_PREFIX}/SLACK_HUMAN_EVAL_CHANNEL_ID" --query ARN --output text)"
MOCK_INTERVIEW_CHANNEL_SECRET_ARN="$(aws_cmd secretsmanager describe-secret --secret-id "${SECRET_PREFIX}/SLACK_MOCK_INTERVIEW_CHANNEL_ID" --query ARN --output text)"
INTERVIEW_REQUEST_CHANNEL_SECRET_ARN="$(aws_cmd secretsmanager describe-secret --secret-id "${SECRET_PREFIX}/SLACK_INTERVIEW_REQUEST_CHANNEL_ID" --query ARN --output text)"
ADMIN_TOKEN_SECRET_ARN="$(aws_cmd secretsmanager describe-secret --secret-id "${SECRET_PREFIX}/ADMIN_TOKEN" --query ARN --output text)"

echo "Creating DynamoDB brain table..."
if ! aws_cmd dynamodb describe-table --table-name "$BRAIN_TABLE_NAME" >/dev/null 2>&1; then
  aws_cmd dynamodb create-table \
    --table-name "$BRAIN_TABLE_NAME" \
    --attribute-definitions AttributeName=id,AttributeType=S \
    --key-schema AttributeName=id,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST >/dev/null
  aws_cmd dynamodb wait table-exists --table-name "$BRAIN_TABLE_NAME"
fi

echo "Creating ECR repository..."
aws_cmd ecr describe-repositories --repository-names "$IMAGE_REPO_NAME" >/dev/null 2>&1 \
  || aws_cmd ecr create-repository --repository-name "$IMAGE_REPO_NAME" >/dev/null

echo "Creating build bucket..."
if ! aws_cmd s3api head-bucket --bucket "$BUILD_BUCKET" >/dev/null 2>&1; then
  aws_cmd s3api create-bucket --bucket "$BUILD_BUCKET" >/dev/null
fi

TMP_DIR="$(mktemp -d)"
cat > "${TMP_DIR}/codebuild-trust.json" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "codebuild.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
JSON

cat > "${TMP_DIR}/apprunner-ecr-trust.json" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "build.apprunner.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
JSON

cat > "${TMP_DIR}/apprunner-instance-trust.json" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "tasks.apprunner.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
JSON

ensure_role "${APP_NAME}-codebuild-role" "${TMP_DIR}/codebuild-trust.json"
CODEBUILD_ROLE_ARN="$(aws_cmd iam get-role --role-name "${APP_NAME}-codebuild-role" --query Role.Arn --output text)"

cat > "${TMP_DIR}/codebuild-policy.json" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], "Resource": "*" },
    { "Effect": "Allow", "Action": ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"], "Resource": "arn:aws:s3:::${BUILD_BUCKET}/*" },
    { "Effect": "Allow", "Action": ["ecr:GetAuthorizationToken"], "Resource": "*" },
    { "Effect": "Allow", "Action": ["ecr:BatchCheckLayerAvailability", "ecr:CompleteLayerUpload", "ecr:InitiateLayerUpload", "ecr:PutImage", "ecr:UploadLayerPart"], "Resource": "arn:aws:ecr:${AWS_REGION}:${AWS_ACCOUNT_ID}:repository/${IMAGE_REPO_NAME}" }
  ]
}
JSON
aws_cmd iam put-role-policy --role-name "${APP_NAME}-codebuild-role" --policy-name "${APP_NAME}-codebuild-policy" --policy-document "file://${TMP_DIR}/codebuild-policy.json"

ensure_role "${APP_NAME}-apprunner-ecr-role" "${TMP_DIR}/apprunner-ecr-trust.json"
APPRUNNER_ECR_ROLE_ARN="$(aws_cmd iam get-role --role-name "${APP_NAME}-apprunner-ecr-role" --query Role.Arn --output text)"
aws_cmd iam attach-role-policy --role-name "${APP_NAME}-apprunner-ecr-role" --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess >/dev/null 2>&1 || true

ensure_role "${APP_NAME}-apprunner-instance-role" "${TMP_DIR}/apprunner-instance-trust.json"
APPRUNNER_INSTANCE_ROLE_ARN="$(aws_cmd iam get-role --role-name "${APP_NAME}-apprunner-instance-role" --query Role.Arn --output text)"
cat > "${TMP_DIR}/apprunner-secrets-policy.json" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": [
        "${BEDROCK_SECRET_ARN}",
        "${BOT_TOKEN_SECRET_ARN}",
        "${SIGNING_SECRET_ARN}",
        "${BRIAN_USER_SECRET_ARN}",
        "${USER_LOG_CHANNEL_SECRET_ARN}",
        "${HUMAN_EVAL_CHANNEL_SECRET_ARN}",
        "${MOCK_INTERVIEW_CHANNEL_SECRET_ARN}",
        "${INTERVIEW_REQUEST_CHANNEL_SECRET_ARN}",
        "${ADMIN_TOKEN_SECRET_ARN}"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:Scan", "dynamodb:UpdateItem"],
      "Resource": "arn:aws:dynamodb:${AWS_REGION}:${AWS_ACCOUNT_ID}:table/${BRAIN_TABLE_NAME}"
    }
  ]
}
JSON
aws_cmd iam put-role-policy --role-name "${APP_NAME}-apprunner-instance-role" --policy-name "${APP_NAME}-secrets-policy" --policy-document "file://${TMP_DIR}/apprunner-secrets-policy.json"

echo "Packaging source..."
rm -f "$SOURCE_ARCHIVE"
zip -qr "$SOURCE_ARCHIVE" . \
  -x '.git/*' 'node_modules/*' 'dist/*' 'tmp/*' 'output/*' '*.log' '.env' '.DS_Store'
aws_cmd s3 cp "$SOURCE_ARCHIVE" "s3://${BUILD_BUCKET}/${SOURCE_KEY}" >/dev/null

cat > "${TMP_DIR}/codebuild-project.json" <<JSON
{
  "name": "${APP_NAME}-image-build",
  "source": {
    "type": "S3",
    "location": "${BUILD_BUCKET}/${SOURCE_KEY}",
    "buildspec": "buildspec.yml"
  },
  "artifacts": { "type": "NO_ARTIFACTS" },
  "environment": {
    "type": "LINUX_CONTAINER",
    "image": "aws/codebuild/standard:7.0",
    "computeType": "BUILD_GENERAL1_SMALL",
    "privilegedMode": true,
    "environmentVariables": [
      { "name": "AWS_ACCOUNT_ID", "value": "${AWS_ACCOUNT_ID}", "type": "PLAINTEXT" },
      { "name": "IMAGE_REPO_NAME", "value": "${IMAGE_REPO_NAME}", "type": "PLAINTEXT" },
      { "name": "IMAGE_TAG", "value": "${IMAGE_TAG}", "type": "PLAINTEXT" }
    ]
  },
  "serviceRole": "${CODEBUILD_ROLE_ARN}"
}
JSON

if aws_cmd codebuild batch-get-projects --names "${APP_NAME}-image-build" --query 'projects[0].name' --output text | grep -q "${APP_NAME}-image-build"; then
  aws_cmd codebuild update-project --cli-input-json "file://${TMP_DIR}/codebuild-project.json" >/dev/null
else
  aws_cmd codebuild create-project --cli-input-json "file://${TMP_DIR}/codebuild-project.json" >/dev/null
fi

echo "Starting CodeBuild image build..."
BUILD_ID="$(aws_cmd codebuild start-build --project-name "${APP_NAME}-image-build" --query build.id --output text)"
echo "Build ID: ${BUILD_ID}"

while true; do
  STATUS="$(aws_cmd codebuild batch-get-builds --ids "$BUILD_ID" --query 'builds[0].buildStatus' --output text)"
  echo "Build status: ${STATUS}"
  case "$STATUS" in
    SUCCEEDED) break ;;
    FAILED|FAULT|STOPPED|TIMED_OUT) echo "CodeBuild failed"; exit 1 ;;
  esac
  sleep 15
done

cat > "${TMP_DIR}/apprunner-source.json" <<JSON
{
  "ImageRepository": {
    "ImageIdentifier": "${ECR_URI}",
    "ImageRepositoryType": "ECR",
    "ImageConfiguration": {
      "Port": "8080",
      "RuntimeEnvironmentVariables": {
        "NODE_ENV": "production",
        "PORT": "8080",
        "AWS_REGION": "${AWS_REGION}",
        "APP_BASE_URL": "https://www.briandear.ai",
        "CAREER_AI_PROVIDER": "bedrock",
        "BEDROCK_BASE_URL": "https://bedrock-mantle.us-east-1.api.aws/v1",
        "BEDROCK_MODEL": "openai.gpt-oss-20b",
        "BEDROCK_TIMEOUT_MS": "15000",
        "COMPATIBLE_MAX_TOKENS": "500",
        "BRAIN_STORE": "dynamodb",
        "BRAIN_TABLE_NAME": "${BRAIN_TABLE_NAME}"
      },
      "RuntimeEnvironmentSecrets": {
        "BEDROCK_API_KEY": "${BEDROCK_SECRET_ARN}",
        "SLACK_BOT_TOKEN": "${BOT_TOKEN_SECRET_ARN}",
        "SLACK_SIGNING_SECRET": "${SIGNING_SECRET_ARN}",
        "SLACK_BRIAN_USER_ID": "${BRIAN_USER_SECRET_ARN}",
        "SLACK_USER_LOG_CHANNEL_ID": "${USER_LOG_CHANNEL_SECRET_ARN}",
        "SLACK_HUMAN_EVAL_CHANNEL_ID": "${HUMAN_EVAL_CHANNEL_SECRET_ARN}",
        "SLACK_MOCK_INTERVIEW_CHANNEL_ID": "${MOCK_INTERVIEW_CHANNEL_SECRET_ARN}",
        "SLACK_INTERVIEW_REQUEST_CHANNEL_ID": "${INTERVIEW_REQUEST_CHANNEL_SECRET_ARN}",
        "ADMIN_TOKEN": "${ADMIN_TOKEN_SECRET_ARN}"
      }
    }
  },
  "AuthenticationConfiguration": {
    "AccessRoleArn": "${APPRUNNER_ECR_ROLE_ARN}"
  },
  "AutoDeploymentsEnabled": false
}
JSON

cat > "${TMP_DIR}/instance-config.json" <<JSON
{
  "Cpu": "0.25 vCPU",
  "Memory": "0.5 GB",
  "InstanceRoleArn": "${APPRUNNER_INSTANCE_ROLE_ARN}"
}
JSON

SERVICE_ARN="$(aws_cmd apprunner list-services --query "ServiceSummaryList[?ServiceName=='${SERVICE_NAME}'].ServiceArn | [0]" --output text)"
if [[ "$SERVICE_ARN" == "None" || -z "$SERVICE_ARN" ]]; then
  echo "Creating App Runner service..."
  SERVICE_ARN="$(aws_cmd apprunner create-service \
    --service-name "${SERVICE_NAME}" \
    --source-configuration "file://${TMP_DIR}/apprunner-source.json" \
    --instance-configuration "file://${TMP_DIR}/instance-config.json" \
    --query 'Service.ServiceArn' \
    --output text)"
else
  echo "Updating App Runner service..."
  aws_cmd apprunner update-service \
    --service-arn "$SERVICE_ARN" \
    --source-configuration "file://${TMP_DIR}/apprunner-source.json" \
    --instance-configuration "file://${TMP_DIR}/instance-config.json" >/dev/null
fi

echo "Waiting for App Runner service..."
while true; do
  SERVICE_JSON="$(aws_cmd apprunner describe-service --service-arn "$SERVICE_ARN")"
  SERVICE_STATUS="$(echo "$SERVICE_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["Service"]["Status"])')"
  echo "Service status: ${SERVICE_STATUS}"
  case "$SERVICE_STATUS" in
    RUNNING) break ;;
    CREATE_FAILED|DELETE_FAILED) echo "App Runner service failed"; exit 1 ;;
    OPERATION_IN_PROGRESS) ;;
  esac
  sleep 20
done

SERVICE_URL="$(aws_cmd apprunner describe-service --service-arn "$SERVICE_ARN" --query 'Service.ServiceUrl' --output text)"
echo "APP_RUNNER_SERVICE_ARN=${SERVICE_ARN}"
echo "APP_RUNNER_SERVICE_URL=https://${SERVICE_URL}"
echo "ECR_IMAGE_URI=${ECR_URI}"
