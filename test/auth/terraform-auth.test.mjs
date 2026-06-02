import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const authTf = readFileSync(new URL("../../infra/auth.tf", import.meta.url), "utf8");

test("auth Terraform keeps secrets out of state values", () => {
  assert.match(authTf, /resource "aws_secretsmanager_secret" "auth_google_oauth"/);
  assert.match(authTf, /resource "aws_secretsmanager_secret" "auth_jwt"/);
  assert.match(authTf, /resource "aws_secretsmanager_secret" "auth_stripe"/);
  assert.doesNotMatch(authTf, /aws_secretsmanager_secret_version/);
  assert.doesNotMatch(authTf, /client_secret\s*=/);
  assert.doesNotMatch(authTf, /signing_key\s*=/);
  assert.doesNotMatch(authTf, /secret_key\s*=/);
  assert.doesNotMatch(authTf, /webhook_secret\s*=/);
});

test("auth Terraform disables authorizer result caching for protected route safety", () => {
  assert.match(authTf, /authorizer_result_ttl_in_seconds\s+=\s+0/);
});

test("auth Terraform avoids wildcard credentialed CORS and enables DynamoDB protections", () => {
  assert.match(authTf, /allow_credentials\s+=\s+true/);
  assert.doesNotMatch(authTf, /allow_origins\s+=\s+\["\*"\]/);
  assert.match(authTf, /deletion_protection_enabled\s+=\s+true/);
  assert.match(authTf, /point_in_time_recovery\s+\{\s+enabled\s+=\s+true\s+\}/s);
  assert.match(authTf, /server_side_encryption\s+\{\s+enabled\s+=\s+true\s+\}/s);
});

test("auth Terraform protects billing summary with JWT auth and leaves Stripe webhook unsigned by JWT", () => {
  assert.match(authTf, /route_key\s+=\s+"GET \/billing\/summary"[\s\S]*authorization_type\s+=\s+"CUSTOM"[\s\S]*authorizer_id\s+=\s+aws_apigatewayv2_authorizer\.auth_jwt\.id/);
  assert.match(authTf, /route_key\s+=\s+"POST \/billing\/stripe-webhook"/);
});

test("auth Terraform protects direct API Gateway access with regional WAF and rate limiting", () => {
  assert.match(authTf, /resource "aws_wafv2_web_acl" "auth_api"[\s\S]*scope\s+=\s+"REGIONAL"/);
  assert.match(authTf, /resource "aws_wafv2_web_acl_association" "auth_api_stage"[\s\S]*resource_arn\s+=\s+aws_apigatewayv2_stage\.auth_default\.arn[\s\S]*web_acl_arn\s+=\s+aws_wafv2_web_acl\.auth_api\.arn/);
  assert.match(authTf, /rate_based_statement\s+\{\s+aggregate_key_type\s+=\s+"IP"\s+limit\s+=\s+local\.waf_rate_limit_per_five_minute\s+\}/s);
  assert.match(authTf, /AWSManagedRulesAmazonIpReputationList/);
  assert.match(authTf, /AWSManagedRulesCommonRuleSet/);
  assert.match(authTf, /AWSManagedRulesKnownBadInputsRuleSet/);
  assert.match(authTf, /AWSManagedRulesSQLiRuleSet/);
});
