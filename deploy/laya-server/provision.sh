#!/usr/bin/env bash
# Creates the shared Laya server. Safe to run again: it reuses whatever already exists.
# Prints resource ids only, never a secret. See README.md for what to set first.
set -euo pipefail

: "${ELASTIC_IP:?set ELASTIC_IP to the allocated Elastic IP}"
: "${LAYA_MODEL_REPO:?set LAYA_MODEL_REPO to the Hugging Face model id}"
: "${LAYA_MODEL_REVISION:?set LAYA_MODEL_REVISION to the commit to serve}"

export AWS_PROFILE="${AWS_PROFILE:-mastyf-temp}"
export AWS_REGION="${AWS_REGION:-ap-northeast-1}"
export AWS_PAGER=""
# Git Bash on Windows would otherwise rewrite /mastyf/... into a Windows path.
export MSYS_NO_PATHCONV=1

NAME=mastyf-laya-shared
TAGS="{Key=Name,Value=$NAME},{Key=project,Value=mastyf},{Key=temporary,Value=true}"
AMI_PARAM=/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64
cd "$(dirname "$0")"

# 1. Instance role: Session Manager, and read access to this server's parameters only. The second
# policy is created by an admin (README.md), so the deploy user can't widen what the server may do.
if ! aws iam get-role --role-name "$NAME" >/dev/null 2>&1; then
  aws iam create-role --role-name "$NAME" --assume-role-policy-document \
    '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
fi
aws iam attach-role-policy --role-name "$NAME" \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws iam attach-role-policy --role-name "$NAME" \
  --policy-arn "arn:aws:iam::$ACCOUNT_ID:policy/mastyf-laya-read-parameters"
if ! aws iam get-instance-profile --instance-profile-name "$NAME" >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$NAME" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$NAME" --role-name "$NAME"
  sleep 15 # IAM takes a moment to reach EC2
fi

# 2. Security group: 80 for certificate renewal, 443 for traffic, nothing else.
VPC_ID=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=$NAME" "Name=vpc-id,Values=$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text)
if [ "$SG_ID" = "None" ]; then
  SG_ID=$(aws ec2 create-security-group --group-name "$NAME" --vpc-id "$VPC_ID" \
    --description "Laya server: 80 and 443 only" \
    --tag-specifications "ResourceType=security-group,Tags=[$TAGS]" \
    --query GroupId --output text)
  for port in 80 443; do
    aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
      --protocol tcp --port "$port" --cidr 0.0.0.0/0 >/dev/null
  done
fi

# 3. Parameters. The shared secret is generated once and never printed.
if ! aws ssm get-parameter --name /mastyf/laya/shared/hf-token >/dev/null 2>&1; then
  echo "Missing /mastyf/laya/shared/hf-token: store the read-only token first (README.md)." >&2
  exit 1
fi
if ! aws ssm get-parameter --name /mastyf/laya/shared/secret >/dev/null 2>&1; then
  aws ssm put-parameter --name /mastyf/laya/shared/secret --type SecureString \
    --value "$(openssl rand -hex 32)" >/dev/null
fi
aws ssm put-parameter --name /mastyf/laya/shared/model-repo --type String --overwrite \
  --value "$LAYA_MODEL_REPO" >/dev/null
aws ssm put-parameter --name /mastyf/laya/shared/model-revision --type String --overwrite \
  --value "$LAYA_MODEL_REVISION" >/dev/null

# 4. The instance, with the service and Caddy files embedded in its first-boot script.
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=$NAME" Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)
if [ "$INSTANCE_ID" = "None" ]; then
  b64() { tr -d '\r' < "$1" | base64 | tr -d '\n'; }
  USER_DATA=$(mktemp ./user-data.XXXXXX)
  trap 'rm -f "$USER_DATA"' EXIT
  tr -d '\r' < user-data.sh \
    | sed -e "s|__REGION__|$AWS_REGION|" \
          -e "s|__LAYA_SERVICE_B64__|$(b64 laya-serve.service)|" \
          -e "s|__CADDYFILE_B64__|$(b64 Caddyfile)|" > "$USER_DATA"
  INSTANCE_ID=$(aws ec2 run-instances \
    --image-id "resolve:ssm:$AMI_PARAM" \
    --instance-type c7i-flex.large \
    --iam-instance-profile "Name=$NAME" \
    --security-group-ids "$SG_ID" \
    --metadata-options HttpTokens=required \
    --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=30,VolumeType=gp3,Encrypted=true}' \
    --tag-specifications "ResourceType=instance,Tags=[$TAGS]" "ResourceType=volume,Tags=[$TAGS]" \
    --user-data "file://$USER_DATA" \
    --query 'Instances[0].InstanceId' --output text)
  aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
fi

# 5. Attach the Elastic IP.
ALLOCATION_ID=$(aws ec2 describe-addresses --public-ips "$ELASTIC_IP" \
  --query 'Addresses[0].AllocationId' --output text)
aws ec2 associate-address --allocation-id "$ALLOCATION_ID" --instance-id "$INSTANCE_ID" >/dev/null

echo "instance:       $INSTANCE_ID"
echo "security group: $SG_ID"
echo "elastic ip:     $ELASTIC_IP"
