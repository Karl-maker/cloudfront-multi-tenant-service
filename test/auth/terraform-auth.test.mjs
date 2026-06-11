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
  assert.match(authTf, /auth_cors_allow_headers\s+=\s+\[[^\]]*"x-requested-with"[^\]]*"x-amz-security-token"[^\]]*\]/);
  assert.match(authTf, /allow_headers\s+=\s+local\.auth_cors_allow_headers/);
  assert.match(authTf, /AUTH_ALLOWED_ORIGINS\s+=\s+join\(",", var\.auth_allowed_origins\)/);
  assert.doesNotMatch(authTf, /allow_origins\s+=\s+\["\*"\]/);
  assert.match(authTf, /deletion_protection_enabled\s+=\s+true/);
  assert.match(authTf, /point_in_time_recovery\s+\{\s+enabled\s+=\s+true\s+\}/s);
  assert.match(authTf, /server_side_encryption\s+\{\s+enabled\s+=\s+true\s+\}/s);
});

test("auth Terraform protects billing summary with JWT auth and leaves Stripe webhook unsigned by JWT", () => {
  assert.match(authTf, /route_key\s+=\s+"GET \/billing\/summary"[\s\S]*authorization_type\s+=\s+"CUSTOM"[\s\S]*authorizer_id\s+=\s+aws_apigatewayv2_authorizer\.auth_jwt\.id/);
  assert.match(authTf, /route_key\s+=\s+"POST \/billing\/checkout"[\s\S]*authorization_type\s+=\s+"CUSTOM"[\s\S]*authorizer_id\s+=\s+aws_apigatewayv2_authorizer\.auth_jwt\.id/);
  assert.match(authTf, /route_key\s+=\s+"GET \/websites"[\s\S]*authorization_type\s+=\s+"CUSTOM"[\s\S]*authorizer_id\s+=\s+aws_apigatewayv2_authorizer\.auth_jwt\.id/);
  assert.match(authTf, /route_key\s+=\s+"POST \/websites"[\s\S]*authorization_type\s+=\s+"CUSTOM"[\s\S]*authorizer_id\s+=\s+aws_apigatewayv2_authorizer\.auth_jwt\.id/);
  assert.match(authTf, /route_key\s+=\s+"GET \/websites\/\{websiteId\}"[\s\S]*authorization_type\s+=\s+"CUSTOM"[\s\S]*authorizer_id\s+=\s+aws_apigatewayv2_authorizer\.auth_jwt\.id/);
  assert.match(authTf, /route_key\s+=\s+"PUT \/websites\/\{websiteId\}\/config"[\s\S]*authorization_type\s+=\s+"CUSTOM"[\s\S]*authorizer_id\s+=\s+aws_apigatewayv2_authorizer\.auth_jwt\.id/);
  assert.match(authTf, /route_key\s+=\s+"POST \/websites\/\{websiteId\}\/media"[\s\S]*authorization_type\s+=\s+"CUSTOM"[\s\S]*authorizer_id\s+=\s+aws_apigatewayv2_authorizer\.auth_jwt\.id/);
  assert.match(authTf, /route_key\s+=\s+"POST \/websites\/\{websiteId\}\/deploy"[\s\S]*authorization_type\s+=\s+"CUSTOM"[\s\S]*authorizer_id\s+=\s+aws_apigatewayv2_authorizer\.auth_jwt\.id/);
  assert.match(authTf, /route_key\s+=\s+"POST \/billing\/stripe-webhook"/);
});

test("auth Terraform lets Google login write and update auth records", () => {
  assert.match(authTf, /data "aws_iam_policy_document" "auth_google_login_lambda"[\s\S]*"dynamodb:PutItem"[\s\S]*"dynamodb:UpdateItem"[\s\S]*aws_dynamodb_table\.auth_users\.arn[\s\S]*aws_dynamodb_table\.auth_logins\.arn/);
});

test("auth Terraform seeds billing catalog plans, addons, and entitlements", () => {
  assert.match(authTf, /resource "aws_dynamodb_table" "billing_catalog"/);
  assert.match(authTf, /resource "aws_dynamodb_table" "auth_websites"[\s\S]*hash_key\s+=\s+"user_id"[\s\S]*range_key\s+=\s+"website_id"/);
  assert.match(authTf, /resource "aws_dynamodb_table" "website_folders"[\s\S]*hash_key\s+=\s+"folder"/);
  assert.match(authTf, /resource "aws_dynamodb_table" "website_media"[\s\S]*hash_key\s+=\s+"user_id"[\s\S]*range_key\s+=\s+"media_id"/);
  assert.match(authTf, /resource "aws_dynamodb_table_item" "billing_catalog_seed"/);
  assert.match(authTf, /resource "aws_dynamodb_table" "billing_checkout_requests"[\s\S]*hash_key\s+=\s+"idempotency_key"[\s\S]*ttl\s+\{[\s\S]*attribute_name\s+=\s+"ttl"[\s\S]*enabled\s+=\s+true/);
  assert.match(authTf, /free_website_plan[\s\S]*Free Website Plan[\s\S]*syncpoly_banner[\s\S]*value = true[\s\S]*included_websites[\s\S]*limit = 1[\s\S]*media_storage_mb[\s\S]*limit = 10/);
  assert.match(authTf, /basic_website_plan[\s\S]*Basic Website Plan[\s\S]*amount_monthly_cents\s+=\s+3999[\s\S]*change_requests[\s\S]*limit = 3[\s\S]*included_websites[\s\S]*limit = 1[\s\S]*media_storage_mb[\s\S]*limit = 50/);
  assert.match(authTf, /custom_solution_plan[\s\S]*Custom Solution Plan[\s\S]*email_conversation/);
  assert.match(authTf, /additional_website_one_time[\s\S]*Additional Website[\s\S]*amount_one_time_cents\s+=\s+2999/);
  assert.match(authTf, /media_storage_10mb_one_time[\s\S]*10MB Media Storage[\s\S]*amount_one_time_cents\s+=\s+499[\s\S]*additional_media_storage_mb[\s\S]*add = 10/);
  assert.match(authTf, /addon_5_change_requests[\s\S]*change_requests[\s\S]*add = 5/);
  assert.match(authTf, /addon_managed_promotions[\s\S]*managed_promotions/);
});

test("auth Terraform lets pricing read catalog, update Stripe ids, and use Stripe secret", () => {
  assert.match(authTf, /data "aws_iam_policy_document" "auth_pricing_lambda"[\s\S]*"secretsmanager:GetSecretValue"[\s\S]*data\.aws_secretsmanager_secret\.auth_stripe\.arn/);
  assert.match(authTf, /data "aws_iam_policy_document" "auth_pricing_lambda"[\s\S]*"dynamodb:Scan"[\s\S]*"dynamodb:UpdateItem"[\s\S]*aws_dynamodb_table\.billing_catalog\.arn/);
  assert.match(authTf, /data "aws_iam_policy_document" "auth_pricing_lambda"[\s\S]*"dynamodb:PutItem"[\s\S]*aws_dynamodb_table\.billing_checkout_requests\.arn/);
  assert.match(authTf, /resource "aws_lambda_function" "auth_pricing"/);
  assert.match(authTf, /BILLING_CHECKOUT_REQUESTS_TABLE_NAME\s+=\s+aws_dynamodb_table\.billing_checkout_requests\.name/);
  assert.match(authTf, /data "aws_iam_policy_document" "auth_websites_lambda"[\s\S]*"dynamodb:TransactWriteItems"[\s\S]*aws_dynamodb_table\.auth_users\.arn/);
  assert.match(authTf, /data "aws_iam_policy_document" "auth_websites_lambda"[\s\S]*"dynamodb:Query"[\s\S]*aws_dynamodb_table\.auth_websites\.arn[\s\S]*aws_dynamodb_table\.website_folders\.arn[\s\S]*aws_dynamodb_table\.website_media\.arn/);
  assert.match(authTf, /resource "aws_lambda_function" "auth_websites"/);
  assert.match(authTf, /WEBSITE_FOLDERS_TABLE_NAME\s+=\s+aws_dynamodb_table\.website_folders\.name/);
  assert.match(authTf, /WEBSITE_MEDIA_TABLE_NAME\s+=\s+aws_dynamodb_table\.website_media\.name/);
});

test("auth Terraform defines unauthenticated OPTIONS routes for CORS preflight", () => {
  assert.match(authTf, /allow_methods\s+=\s+\["GET", "POST", "PUT", "OPTIONS"\]/);
  assert.match(authTf, /route_key\s+=\s+"OPTIONS \/auth\/google"/);
  assert.match(authTf, /route_key\s+=\s+"OPTIONS \/auth\/me"/);
  assert.match(authTf, /route_key\s+=\s+"OPTIONS \/billing\/summary"/);
  assert.match(authTf, /route_key\s+=\s+"OPTIONS \/billing\/catalog"/);
  assert.match(authTf, /route_key\s+=\s+"OPTIONS \/billing\/checkout"/);
  assert.match(authTf, /route_key\s+=\s+"OPTIONS \/websites"/);
  assert.match(authTf, /route_key\s+=\s+"OPTIONS \/websites\/\{websiteId\}"/);
  assert.match(authTf, /route_key\s+=\s+"OPTIONS \/websites\/\{websiteId\}\/config"/);
  assert.match(authTf, /route_key\s+=\s+"OPTIONS \/websites\/\{websiteId\}\/media"/);
  assert.match(authTf, /route_key\s+=\s+"OPTIONS \/websites\/\{websiteId\}\/deploy"/);
  assert.match(authTf, /route_key\s+=\s+"OPTIONS \/billing\/stripe-webhook"/);
  assert.doesNotMatch(authTf, /route_key\s+=\s+"OPTIONS [^"]+"[\s\S]{0,160}authorization_type\s+=\s+"CUSTOM"/);
});

test("auth Terraform protects API traffic through CloudFront WAF and rate limiting", () => {
  assert.match(authTf, /resource "aws_cloudfront_distribution" "auth_api"[\s\S]*web_acl_id\s+=\s+aws_wafv2_web_acl\.sites\.arn/);
  assert.doesNotMatch(authTf, /resource "aws_wafv2_web_acl_association" "auth_api_stage"/);
});
