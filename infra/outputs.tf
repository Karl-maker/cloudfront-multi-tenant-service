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
