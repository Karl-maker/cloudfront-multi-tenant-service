output "content_bucket_name" {
  value = aws_s3_bucket.sites.bucket
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.sites.id
}

output "cloudfront_domain_name" {
  value = aws_cloudfront_distribution.sites.domain_name
}

output "cloudfront_function_name" {
  value = aws_cloudfront_function.domain_folder_router.name
}

output "waf_web_acl_name" {
  value = aws_wafv2_web_acl.sites.name
}

output "waf_rate_limit_per_five_minutes" {
  value = local.waf_rate_limit_per_five_minute
}

output "auth_api_waf_web_acl_name" {
  value = aws_wafv2_web_acl.sites.name
}

output "auth_api_endpoint" {
  value = aws_apigatewayv2_api.auth.api_endpoint
}

output "auth_api_cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.auth_api.id
}

output "auth_api_cloudfront_domain_name" {
  value = aws_cloudfront_distribution.auth_api.domain_name
}

output "auth_google_login_function_name" {
  value = aws_lambda_function.auth_google_login.function_name
}

output "auth_me_function_name" {
  value = aws_lambda_function.auth_me.function_name
}

output "auth_authorizer_function_name" {
  value = aws_lambda_function.auth_authorizer.function_name
}

output "auth_billing_summary_function_name" {
  value = aws_lambda_function.auth_billing_summary.function_name
}

output "auth_pricing_function_name" {
  value = aws_lambda_function.auth_pricing.function_name
}

output "auth_stripe_webhook_function_name" {
  value = aws_lambda_function.auth_stripe_webhook.function_name
}

output "auth_google_oauth_secret_arn" {
  value     = data.aws_secretsmanager_secret.auth_google_oauth.arn
  sensitive = true
}

output "auth_jwt_secret_arn" {
  value     = data.aws_secretsmanager_secret.auth_jwt.arn
  sensitive = true
}

output "auth_stripe_secret_arn" {
  value     = data.aws_secretsmanager_secret.auth_stripe.arn
  sensitive = true
}
