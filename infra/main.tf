locals {
  project_name        = "syncpoly-web-builder"
  content_bucket_name = "syncpoly-web-builder-sites"
  cloudfront_function = "syncpoly-domain-folder-router"
  s3_origin_id        = "syncpoly-sites-s3-origin"
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
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

resource "aws_cloudfront_distribution" "sites" {
  enabled             = true
  comment             = "${local.project_name} domain-to-folder static site distribution"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"

  origin {
    domain_name              = aws_s3_bucket.sites.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.sites.id
    origin_id                = local.s3_origin_id
  }

  default_cache_behavior {
    target_origin_id       = local.s3_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
    compress               = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.domain_folder_router.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
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
