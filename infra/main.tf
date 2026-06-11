locals {
  project_name                   = "syncpoly-web-builder"
  content_bucket_name            = "syncpoly-web-builder-sites"
  cloudfront_function            = "syncpoly-domain-folder-router"
  s3_origin_id                   = "syncpoly-sites-s3-origin"
  waf_rate_limit_per_five_minute = 2000
  long_cache_path_patterns = [
    "/_next/static/*",
    "/assets/*",
    "/images/*",
    "/fonts/*",
    "/favicon.ico",
    "/404.css"
  ]
  auth_api_path_patterns = [
    "/auth/*",
    "/billing/*",
    "/websites",
    "/websites/*"
  ]
}

resource "aws_s3_bucket" "sites" {
  bucket = local.content_bucket_name
}

resource "aws_s3_bucket_public_access_block" "sites" {
  bucket = aws_s3_bucket.sites.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "sites" {
  bucket = aws_s3_bucket.sites.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "sites" {
  bucket = aws_s3_bucket.sites.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "sites" {
  bucket = aws_s3_bucket.sites.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "sites" {
  name                              = "${local.project_name}-s3-oac"
  description                       = "Read-only CloudFront access to ${local.content_bucket_name}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "domain_folder_router" {
  name    = local.cloudfront_function
  runtime = "cloudfront-js-2.0"
  comment = "Maps request hostnames to folders in the shared S3 bucket"
  publish = true
  code    = file("${path.module}/../cloudfront/domain-folder-router.js")
}

resource "aws_cloudfront_cache_policy" "pages" {
  name        = "${local.project_name}-pages-cache"
  comment     = "Short cache for static HTML pages"
  default_ttl = 300
  max_ttl     = 3600
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

resource "aws_cloudfront_cache_policy" "static_assets" {
  name        = "${local.project_name}-static-assets-cache"
  comment     = "Long cache for versioned static assets"
  default_ttl = 31536000
  max_ttl     = 31536000
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

resource "aws_cloudfront_response_headers_policy" "security" {
  name    = "${local.project_name}-security-headers"
  comment = "Baseline browser security headers for static sites"

  security_headers_config {
    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      override                   = true
      preload                    = false
    }

    xss_protection {
      mode_block = true
      override   = true
      protection = true
    }
  }

  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      override = true
      value    = "camera=(), microphone=(), geolocation=()"
    }
  }
}

resource "aws_wafv2_web_acl" "sites" {
  name        = "${local.project_name}-cloudfront-waf"
  description = "Managed WAF protections and rate limiting for the shared CloudFront distribution"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "AWSManagedIpReputationList"
    priority = 0

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAmazonIpReputationList"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedIpReputationList"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "AWSManagedCommonRules"
    priority = 10

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedCommonRules"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "AWSManagedKnownBadInputs"
    priority = 20

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedKnownBadInputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "AWSManagedSQLiRules"
    priority = 30

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedSQLiRules"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "RateLimitByIp"
    priority = 40

    action {
      block {}
    }

    statement {
      rate_based_statement {
        aggregate_key_type = "IP"
        limit              = local.waf_rate_limit_per_five_minute
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "RateLimitByIp"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.project_name}-cloudfront-waf"
    sampled_requests_enabled   = true
  }
}

resource "aws_cloudfront_distribution" "sites" {
  enabled             = true
  comment             = "${local.project_name} domain-to-folder static site distribution"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  web_acl_id          = aws_wafv2_web_acl.sites.arn

  origin {
    domain_name              = aws_s3_bucket.sites.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.sites.id
    origin_id                = local.s3_origin_id
  }

  origin {
    domain_name = replace(aws_apigatewayv2_api.auth.api_endpoint, "https://", "")
    origin_id   = local.auth_api_cloudfront_origin_id

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id           = local.s3_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = aws_cloudfront_cache_policy.pages.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
    compress                   = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.domain_folder_router.arn
    }
  }

  dynamic "ordered_cache_behavior" {
    for_each = local.long_cache_path_patterns

    content {
      path_pattern               = ordered_cache_behavior.value
      target_origin_id           = local.s3_origin_id
      viewer_protocol_policy     = "redirect-to-https"
      allowed_methods            = ["GET", "HEAD", "OPTIONS"]
      cached_methods             = ["GET", "HEAD"]
      cache_policy_id            = aws_cloudfront_cache_policy.static_assets.id
      response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
      compress                   = true

      function_association {
        event_type   = "viewer-request"
        function_arn = aws_cloudfront_function.domain_folder_router.arn
      }
    }
  }

  dynamic "ordered_cache_behavior" {
    for_each = local.auth_api_path_patterns

    content {
      path_pattern               = ordered_cache_behavior.value
      target_origin_id           = local.auth_api_cloudfront_origin_id
      viewer_protocol_policy     = "redirect-to-https"
      allowed_methods            = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
      cached_methods             = ["GET", "HEAD", "OPTIONS"]
      cache_policy_id            = data.aws_cloudfront_cache_policy.api_caching_disabled.id
      origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.api_all_viewer_except_host.id
      response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
      compress                   = true
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  custom_error_response {
    error_code            = 403
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 60
  }

  custom_error_response {
    error_code            = 404
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 60
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  lifecycle {
    ignore_changes = [
      aliases,
      viewer_certificate
    ]
  }
}

data "aws_iam_policy_document" "sites_read_from_cloudfront" {
  statement {
    sid    = "AllowCloudFrontReadOnly"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.sites.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.sites.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "sites" {
  bucket = aws_s3_bucket.sites.id
  policy = data.aws_iam_policy_document.sites_read_from_cloudfront.json
}
