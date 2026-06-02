import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const authTf = readFileSync(new URL("../../infra/auth.tf", import.meta.url), "utf8");

test("auth Terraform keeps secrets out of state values", () => {
  assert.match(authTf, /data "aws_secretsmanager_secret" "auth_google_oauth"/);
  assert.match(authTf, /data "aws_secretsmanager_secret" "auth_jwt"/);
  assert.match(authTf, /data "aws_secretsmanager_secret" "auth_stripe"/);
  assert.doesNotMatch(authTf, /resource "aws_secretsmanager_secret"/);
  assert.doesNotMatch(authTf, /aws_secretsmanager_secret_version/);
  assert.doesNotMatch(authTf, /client_secret\s*=/);
  assert.doesNotMatch(authTf, /signing_key\s*=/);
  assert.doesNotMatch(authTf, /secret_key\s*=/);
  assert.doesNotMatch(authTf, /webhook_secret\s*=/);
});

test("auth Terraform disables authorizer result caching for protected route safety", () => {
  assert.match(authTf, /authorizer_result_ttl_in_seconds\s+=\s+0/);
});

test("auth Terraform serves API Gateway through the default stage", () => {
  assert.match(authTf, /resource "aws_apigatewayv2_stage" "auth_default"[\s\S]*name\s+=\s+"\$default"[\s\S]*auto_deploy\s+=\s+true/);
  assert.doesNotMatch(authTf, /resource "aws_apigatewayv2_stage" "auth_prod"/);
  assert.doesNotMatch(authTf, /origin_path\s+=/);
});

test("auth Terraform avoids wildcard credentialed CORS and enables DynamoDB protections", () => {
  assert.match(authTf, /allow_credentials\s+=\s+true/);
  assert.match(authTf, /https:\/\/www\.syncpoly\.com/);
  assert.match(authTf, /AUTH_ALLOWED_ORIGINS\s+=\s+join\(",", var\.auth_allowed_origins\)/);
  assert.doesNotMatch(authTf, /allow_origins\s+=\s+\["\*"\]/);
  assert.match(authTf, /deletion_protection_enabled\s+=\s+true/);
  assert.match(authTf, /point_in_time_recovery\s+\{\s+enabled\s+=\s+true\s+\}/s);
  assert.match(authTf, /server_side_encryption\s+\{\s+enabled\s+=\s+true\s+\}/s);
});

test("auth Terraform protects billing summary with JWT auth and leaves Stripe webhook unsigned by JWT", () => {
  assert.match(authTf, /route_key\s+=\s+"GET \/billing\/summary"[\s\S]*authorization_type\s+=\s+"CUSTOM"[\s\S]*authorizer_id\s+=\s+aws_apigatewayv2_authorizer\.auth_jwt\.id/);
  assert.match(authTf, /route_key\s+=\s+"POST \/billing\/stripe-webhook"/);
});

test("auth Terraform protects API traffic through CloudFront WAF and rate limiting", () => {
  assert.match(authTf, /resource "aws_cloudfront_distribution" "auth_api"[\s\S]*web_acl_id\s+=\s+aws_wafv2_web_acl\.sites\.arn/);
  assert.doesNotMatch(authTf, /resource "aws_wafv2_web_acl_association" "auth_api_stage"/);
});
