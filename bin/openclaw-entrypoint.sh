#!/usr/bin/env sh
set -eu

aws_dir="${HOME:-/home/node}/.aws"
credentials_file="${AWS_SHARED_CREDENTIALS_FILE:-$aws_dir/credentials}"
config_file="${AWS_CONFIG_FILE:-$aws_dir/config}"
region="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"

if [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ]; then
  mkdir -p "$aws_dir"
  umask 077

  {
    printf '[default]\n'
    printf 'aws_access_key_id=%s\n' "$AWS_ACCESS_KEY_ID"
    printf 'aws_secret_access_key=%s\n' "$AWS_SECRET_ACCESS_KEY"
    if [ -n "${AWS_SESSION_TOKEN:-}" ]; then
      printf 'aws_session_token=%s\n' "$AWS_SESSION_TOKEN"
    fi
  } > "$credentials_file"

  {
    printf '[default]\n'
    printf 'region=%s\n' "$region"
    printf 'output=json\n'
  } > "$config_file"

  export AWS_SHARED_CREDENTIALS_FILE="$credentials_file"
  export AWS_CONFIG_FILE="$config_file"
fi

exec openclaw "$@"
