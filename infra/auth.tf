variable "auth_allowed_origins" {
  description = "Browser origins allowed to call the auth API."
  type        = list(string)
  default     = ["https://syncpoly.com", "https://www.syncpoly.com"]
}

variable "auth_login_retention_days" {
  description = "Number of days to keep login audit records."
  type        = number
  default     = 90
}

variable "billing_event_retention_days" {
  description = "Number of days to keep Stripe billing webhook event records."
  type        = number
  default     = 180
}

locals {
  auth_api_name                      = "syncpoly-builder-auth-api"
  auth_api_cloudfront_origin_id      = "syncpoly-builder-auth-api-origin"
  auth_authorizer_function_name      = "syncpoly-builder-auth-authorizer"
  auth_billing_summary_function_name = "syncpoly-builder-billing-summary"
  auth_google_login_function_name    = "syncpoly-builder-google-login"
  auth_me_function_name              = "syncpoly-builder-auth-me"
  auth_google_oauth_secret_name      = "syncpoly-builder-google-oauth"
  auth_jwt_secret_name               = "syncpoly-builder-jwt-signing-key"
  auth_stripe_secret_name            = "syncpoly-builder-stripe"
  auth_stripe_webhook_function_name  = "syncpoly-builder-stripe-webhook"
  auth_users_table_name              = "syncpoly-builder-users"
  auth_logins_table_name             = "syncpoly-builder-logins"
  billing_events_table_name          = "syncpoly-builder-billing-events"
  auth_jwt_issuer                    = "syncpoly-builder"
  auth_jwt_audience                  = "syncpoly-builder-api"
  auth_access_token_ttl_seconds      = 3600
  auth_login_retention_ttl_seconds   = var.auth_login_retention_days * 24 * 60 * 60
  billing_event_ttl_seconds          = var.billing_event_retention_days * 24 * 60 * 60
}

data "archive_file" "auth_google_login" {
  type        = "zip"
  source_file = "${path.module}/../lambdas/auth/google-login/index.mjs"
  output_path = "${path.module}/auth-google-login.zip"
}

data "archive_file" "auth_authorizer" {
  type        = "zip"
  source_file = "${path.module}/../lambdas/auth/authorizer/index.mjs"
  output_path = "${path.module}/auth-authorizer.zip"
}

data "archive_file" "auth_me" {
  type        = "zip"
  source_file = "${path.module}/../lambdas/auth/me/index.mjs"
  output_path = "${path.module}/auth-me.zip"
}

data "archive_file" "auth_billing_summary" {
  type        = "zip"
  source_file = "${path.module}/../lambdas/auth/billing-summary/index.mjs"
  output_path = "${path.module}/auth-billing-summary.zip"
}

data "archive_file" "auth_stripe_webhook" {
  type        = "zip"
  source_file = "${path.module}/../lambdas/auth/stripe-webhook/index.mjs"
  output_path = "${path.module}/auth-stripe-webhook.zip"
}

data "aws_cloudfront_cache_policy" "api_caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "api_all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

data "aws_secretsmanager_secret" "auth_google_oauth" {
  name = local.auth_google_oauth_secret_name
}

data "aws_secretsmanager_secret" "auth_jwt" {
  name = local.auth_jwt_secret_name
}

data "aws_secretsmanager_secret" "auth_stripe" {
  name = local.auth_stripe_secret_name
}

resource "aws_dynamodb_table" "auth_users" {
  name                        = local.auth_users_table_name
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "user_id"
  deletion_protection_enabled = true

  attribute {
    name = "user_id"
    type = "S"
  }

  attribute {
    name = "email"
    type = "S"
  }

  global_secondary_index {
    name            = "email-index"
    hash_key        = "email"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }
}

resource "aws_dynamodb_table" "auth_logins" {
  name                        = local.auth_logins_table_name
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "user_id"
  range_key                   = "login_id"
  deletion_protection_enabled = true

  attribute {
    name = "user_id"
    type = "S"
  }

  attribute {
    name = "login_id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
}

resource "aws_dynamodb_table" "billing_events" {
  name                        = local.billing_events_table_name
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "stripe_customer_id"
  range_key                   = "stripe_event_id"
  deletion_protection_enabled = true

  attribute {
    name = "stripe_customer_id"
    type = "S"
  }

  attribute {
    name = "stripe_event_id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "auth_google_login_lambda" {
  name               = "${local.auth_google_login_function_name}-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role" "auth_authorizer_lambda" {
  name               = "${local.auth_authorizer_function_name}-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role" "auth_me_lambda" {
  name               = "${local.auth_me_function_name}-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role" "auth_billing_summary_lambda" {
  name               = "${local.auth_billing_summary_function_name}-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role" "auth_stripe_webhook_lambda" {
  name               = "${local.auth_stripe_webhook_function_name}-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role_policy_attachment" "auth_google_login_basic" {
  role       = aws_iam_role.auth_google_login_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "auth_authorizer_basic" {
  role       = aws_iam_role.auth_authorizer_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "auth_me_basic" {
  role       = aws_iam_role.auth_me_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "auth_billing_summary_basic" {
  role       = aws_iam_role.auth_billing_summary_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "auth_stripe_webhook_basic" {
  role       = aws_iam_role.auth_stripe_webhook_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "auth_google_login_xray" {
  role       = aws_iam_role.auth_google_login_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy_attachment" "auth_authorizer_xray" {
  role       = aws_iam_role.auth_authorizer_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy_attachment" "auth_me_xray" {
  role       = aws_iam_role.auth_me_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy_attachment" "auth_billing_summary_xray" {
  role       = aws_iam_role.auth_billing_summary_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy_attachment" "auth_stripe_webhook_xray" {
  role       = aws_iam_role.auth_stripe_webhook_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

data "aws_iam_policy_document" "auth_google_login_lambda" {
  statement {
    effect = "Allow"

    actions = [
      "secretsmanager:GetSecretValue"
    ]

    resources = [
      data.aws_secretsmanager_secret.auth_google_oauth.arn,
      data.aws_secretsmanager_secret.auth_jwt.arn
    ]
  }

  statement {
    effect = "Allow"

    actions = [
      "dynamodb:PutItem"
    ]

    resources = [
      aws_dynamodb_table.auth_users.arn,
      aws_dynamodb_table.auth_logins.arn
    ]
  }
}

data "aws_iam_policy_document" "auth_authorizer_lambda" {
  statement {
    effect = "Allow"

    actions = [
      "secretsmanager:GetSecretValue"
    ]

    resources = [
      data.aws_secretsmanager_secret.auth_jwt.arn
    ]
  }
}

data "aws_iam_policy_document" "auth_me_lambda" {
  statement {
    effect = "Allow"

    actions = [
      "dynamodb:GetItem"
    ]

    resources = [
      aws_dynamodb_table.auth_users.arn
    ]
  }
}

data "aws_iam_policy_document" "auth_billing_summary_lambda" {
  statement {
    effect = "Allow"

    actions = [
      "secretsmanager:GetSecretValue"
    ]

    resources = [
      data.aws_secretsmanager_secret.auth_stripe.arn
    ]
  }

  statement {
    effect = "Allow"

    actions = [
      "dynamodb:GetItem",
      "dynamodb:UpdateItem"
    ]

    resources = [
      aws_dynamodb_table.auth_users.arn
    ]
  }

  statement {
    effect = "Allow"

    actions = [
      "dynamodb:Query"
    ]

    resources = [
      aws_dynamodb_table.billing_events.arn
    ]
  }
}

data "aws_iam_policy_document" "auth_stripe_webhook_lambda" {
  statement {
    effect = "Allow"

    actions = [
      "secretsmanager:GetSecretValue"
    ]

    resources = [
      data.aws_secretsmanager_secret.auth_stripe.arn
    ]
  }

  statement {
    effect = "Allow"

    actions = [
      "dynamodb:PutItem",
      "dynamodb:UpdateItem"
    ]

    resources = [
      aws_dynamodb_table.billing_events.arn
    ]
  }
}

resource "aws_iam_role_policy" "auth_google_login_lambda" {
  name   = "${local.auth_google_login_function_name}-policy"
  role   = aws_iam_role.auth_google_login_lambda.id
  policy = data.aws_iam_policy_document.auth_google_login_lambda.json
}

resource "aws_iam_role_policy" "auth_authorizer_lambda" {
  name   = "${local.auth_authorizer_function_name}-policy"
  role   = aws_iam_role.auth_authorizer_lambda.id
  policy = data.aws_iam_policy_document.auth_authorizer_lambda.json
}

resource "aws_iam_role_policy" "auth_me_lambda" {
  name   = "${local.auth_me_function_name}-policy"
  role   = aws_iam_role.auth_me_lambda.id
  policy = data.aws_iam_policy_document.auth_me_lambda.json
}

resource "aws_iam_role_policy" "auth_billing_summary_lambda" {
  name   = "${local.auth_billing_summary_function_name}-policy"
  role   = aws_iam_role.auth_billing_summary_lambda.id
  policy = data.aws_iam_policy_document.auth_billing_summary_lambda.json
}

resource "aws_iam_role_policy" "auth_stripe_webhook_lambda" {
  name   = "${local.auth_stripe_webhook_function_name}-policy"
  role   = aws_iam_role.auth_stripe_webhook_lambda.id
  policy = data.aws_iam_policy_document.auth_stripe_webhook_lambda.json
}

resource "aws_cloudwatch_log_group" "auth_google_login" {
  name              = "/aws/lambda/${local.auth_google_login_function_name}"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "auth_authorizer" {
  name              = "/aws/lambda/${local.auth_authorizer_function_name}"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "auth_me" {
  name              = "/aws/lambda/${local.auth_me_function_name}"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "auth_billing_summary" {
  name              = "/aws/lambda/${local.auth_billing_summary_function_name}"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "auth_stripe_webhook" {
  name              = "/aws/lambda/${local.auth_stripe_webhook_function_name}"
  retention_in_days = 30
}

resource "aws_lambda_function" "auth_google_login" {
  function_name    = local.auth_google_login_function_name
  description      = "Exchanges Google OAuth codes for Syncpoly Builder API access tokens"
  role             = aws_iam_role.auth_google_login_lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  architectures    = ["arm64"]
  filename         = data.archive_file.auth_google_login.output_path
  source_code_hash = data.archive_file.auth_google_login.output_base64sha256
  timeout          = 10
  memory_size      = 256

  environment {
    variables = {
      ACCESS_TOKEN_TTL_SECONDS = tostring(local.auth_access_token_ttl_seconds)
      AUTH_ALLOWED_ORIGINS     = join(",", var.auth_allowed_origins)
      GOOGLE_OAUTH_SECRET_ARN  = data.aws_secretsmanager_secret.auth_google_oauth.arn
      JWT_AUDIENCE             = local.auth_jwt_audience
      JWT_ISSUER               = local.auth_jwt_issuer
      JWT_SECRET_ARN           = data.aws_secretsmanager_secret.auth_jwt.arn
      LOGINS_TABLE_NAME        = aws_dynamodb_table.auth_logins.name
      LOGINS_TTL_SECONDS       = tostring(local.auth_login_retention_ttl_seconds)
      USERS_TABLE_NAME         = aws_dynamodb_table.auth_users.name
    }
  }

  tracing_config {
    mode = "Active"
  }

  depends_on = [
    aws_cloudwatch_log_group.auth_google_login,
    aws_iam_role_policy_attachment.auth_google_login_basic,
    aws_iam_role_policy_attachment.auth_google_login_xray,
    aws_iam_role_policy.auth_google_login_lambda
  ]
}

resource "aws_lambda_function" "auth_authorizer" {
  function_name    = local.auth_authorizer_function_name
  description      = "Validates Syncpoly Builder JWT access tokens for API Gateway"
  role             = aws_iam_role.auth_authorizer_lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  architectures    = ["arm64"]
  filename         = data.archive_file.auth_authorizer.output_path
  source_code_hash = data.archive_file.auth_authorizer.output_base64sha256
  timeout          = 5
  memory_size      = 128

  environment {
    variables = {
      JWT_AUDIENCE   = local.auth_jwt_audience
      JWT_ISSUER     = local.auth_jwt_issuer
      JWT_SECRET_ARN = data.aws_secretsmanager_secret.auth_jwt.arn
    }
  }

  tracing_config {
    mode = "Active"
  }

  depends_on = [
    aws_cloudwatch_log_group.auth_authorizer,
    aws_iam_role_policy_attachment.auth_authorizer_basic,
    aws_iam_role_policy_attachment.auth_authorizer_xray,
    aws_iam_role_policy.auth_authorizer_lambda
  ]
}

resource "aws_lambda_function" "auth_me" {
  function_name    = local.auth_me_function_name
  description      = "Returns the authenticated Syncpoly Builder user profile"
  role             = aws_iam_role.auth_me_lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  architectures    = ["arm64"]
  filename         = data.archive_file.auth_me.output_path
  source_code_hash = data.archive_file.auth_me.output_base64sha256
  timeout          = 5
  memory_size      = 128

  environment {
    variables = {
      AUTH_ALLOWED_ORIGINS = join(",", var.auth_allowed_origins)
      USERS_TABLE_NAME     = aws_dynamodb_table.auth_users.name
    }
  }

  tracing_config {
    mode = "Active"
  }

  depends_on = [
    aws_cloudwatch_log_group.auth_me,
    aws_iam_role_policy_attachment.auth_me_basic,
    aws_iam_role_policy_attachment.auth_me_xray,
    aws_iam_role_policy.auth_me_lambda
  ]
}

resource "aws_lambda_function" "auth_billing_summary" {
  function_name    = local.auth_billing_summary_function_name
  description      = "Returns the authenticated Syncpoly Builder user's Stripe billing summary"
  role             = aws_iam_role.auth_billing_summary_lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  architectures    = ["arm64"]
  filename         = data.archive_file.auth_billing_summary.output_path
  source_code_hash = data.archive_file.auth_billing_summary.output_base64sha256
  timeout          = 10
  memory_size      = 256

  environment {
    variables = {
      AUTH_ALLOWED_ORIGINS      = join(",", var.auth_allowed_origins)
      BILLING_EVENTS_TABLE_NAME = aws_dynamodb_table.billing_events.name
      STRIPE_SECRET_ARN         = data.aws_secretsmanager_secret.auth_stripe.arn
      USERS_TABLE_NAME          = aws_dynamodb_table.auth_users.name
    }
  }

  tracing_config {
    mode = "Active"
  }

  depends_on = [
    aws_cloudwatch_log_group.auth_billing_summary,
    aws_iam_role_policy_attachment.auth_billing_summary_basic,
    aws_iam_role_policy_attachment.auth_billing_summary_xray,
    aws_iam_role_policy.auth_billing_summary_lambda
  ]
}

resource "aws_lambda_function" "auth_stripe_webhook" {
  function_name    = local.auth_stripe_webhook_function_name
  description      = "Verifies Stripe webhooks and records billing and dunning events"
  role             = aws_iam_role.auth_stripe_webhook_lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  architectures    = ["arm64"]
  filename         = data.archive_file.auth_stripe_webhook.output_path
  source_code_hash = data.archive_file.auth_stripe_webhook.output_base64sha256
  timeout          = 10
  memory_size      = 128

  environment {
    variables = {
      AUTH_ALLOWED_ORIGINS       = join(",", var.auth_allowed_origins)
      BILLING_EVENTS_TABLE_NAME  = aws_dynamodb_table.billing_events.name
      BILLING_EVENTS_TTL_SECONDS = tostring(local.billing_event_ttl_seconds)
      STRIPE_SECRET_ARN          = data.aws_secretsmanager_secret.auth_stripe.arn
    }
  }

  tracing_config {
    mode = "Active"
  }

  depends_on = [
    aws_cloudwatch_log_group.auth_stripe_webhook,
    aws_iam_role_policy_attachment.auth_stripe_webhook_basic,
    aws_iam_role_policy_attachment.auth_stripe_webhook_xray,
    aws_iam_role_policy.auth_stripe_webhook_lambda
  ]
}

resource "aws_apigatewayv2_api" "auth" {
  name          = local.auth_api_name
  protocol_type = "HTTP"

  cors_configuration {
    allow_credentials = true
    allow_headers     = ["authorization", "content-type"]
    allow_methods     = ["GET", "POST", "OPTIONS"]
    allow_origins     = var.auth_allowed_origins
    max_age           = 300
  }
}

resource "aws_apigatewayv2_stage" "auth_default" {
  api_id      = aws_apigatewayv2_api.auth.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    detailed_metrics_enabled = true
    throttling_burst_limit   = 100
    throttling_rate_limit    = 50
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.auth_api_gateway.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      protocol       = "$context.protocol"
      responseLength = "$context.responseLength"
      integrationErr = "$context.integrationErrorMessage"
    })
  }
}

resource "aws_cloudwatch_log_group" "auth_api_gateway" {
  name              = "/aws/apigateway/${local.auth_api_name}"
  retention_in_days = 30
}

resource "aws_apigatewayv2_authorizer" "auth_jwt" {
  api_id                            = aws_apigatewayv2_api.auth.id
  authorizer_type                   = "REQUEST"
  authorizer_uri                    = aws_lambda_function.auth_authorizer.invoke_arn
  enable_simple_responses           = true
  identity_sources                  = ["$request.header.Authorization"]
  name                              = "syncpoly-builder-jwt-authorizer"
  authorizer_payload_format_version = "2.0"
  authorizer_result_ttl_in_seconds  = 0
}

resource "aws_apigatewayv2_integration" "auth_google_login" {
  api_id                 = aws_apigatewayv2_api.auth.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.auth_google_login.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 10000
}

resource "aws_apigatewayv2_integration" "auth_me" {
  api_id                 = aws_apigatewayv2_api.auth.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.auth_me.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 5000
}

resource "aws_apigatewayv2_integration" "auth_billing_summary" {
  api_id                 = aws_apigatewayv2_api.auth.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.auth_billing_summary.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 10000
}

resource "aws_apigatewayv2_integration" "auth_stripe_webhook" {
  api_id                 = aws_apigatewayv2_api.auth.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.auth_stripe_webhook.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 10000
}

resource "aws_apigatewayv2_route" "auth_google_login" {
  api_id    = aws_apigatewayv2_api.auth.id
  route_key = "POST /auth/google"
  target    = "integrations/${aws_apigatewayv2_integration.auth_google_login.id}"
}

resource "aws_apigatewayv2_route" "auth_google_login_options" {
  api_id    = aws_apigatewayv2_api.auth.id
  route_key = "OPTIONS /auth/google"
  target    = "integrations/${aws_apigatewayv2_integration.auth_google_login.id}"
}

resource "aws_apigatewayv2_route" "auth_me" {
  api_id             = aws_apigatewayv2_api.auth.id
  route_key          = "GET /auth/me"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.auth_jwt.id
  target             = "integrations/${aws_apigatewayv2_integration.auth_me.id}"
}

resource "aws_apigatewayv2_route" "auth_me_options" {
  api_id    = aws_apigatewayv2_api.auth.id
  route_key = "OPTIONS /auth/me"
  target    = "integrations/${aws_apigatewayv2_integration.auth_me.id}"
}

resource "aws_apigatewayv2_route" "auth_billing_summary" {
  api_id             = aws_apigatewayv2_api.auth.id
  route_key          = "GET /billing/summary"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.auth_jwt.id
  target             = "integrations/${aws_apigatewayv2_integration.auth_billing_summary.id}"
}

resource "aws_apigatewayv2_route" "auth_billing_summary_options" {
  api_id    = aws_apigatewayv2_api.auth.id
  route_key = "OPTIONS /billing/summary"
  target    = "integrations/${aws_apigatewayv2_integration.auth_billing_summary.id}"
}

resource "aws_apigatewayv2_route" "auth_stripe_webhook" {
  api_id    = aws_apigatewayv2_api.auth.id
  route_key = "POST /billing/stripe-webhook"
  target    = "integrations/${aws_apigatewayv2_integration.auth_stripe_webhook.id}"
}

resource "aws_apigatewayv2_route" "auth_stripe_webhook_options" {
  api_id    = aws_apigatewayv2_api.auth.id
  route_key = "OPTIONS /billing/stripe-webhook"
  target    = "integrations/${aws_apigatewayv2_integration.auth_stripe_webhook.id}"
}

resource "aws_lambda_permission" "auth_google_login_api_gateway" {
  statement_id  = "AllowExecutionFromApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.auth_google_login.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.auth.execution_arn}/*/*"
}

resource "aws_lambda_permission" "auth_me_api_gateway" {
  statement_id  = "AllowExecutionFromApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.auth_me.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.auth.execution_arn}/*/*"
}

resource "aws_lambda_permission" "auth_authorizer_api_gateway" {
  statement_id  = "AllowExecutionFromApiGatewayAuthorizer"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.auth_authorizer.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.auth.execution_arn}/authorizers/${aws_apigatewayv2_authorizer.auth_jwt.id}"
}

resource "aws_lambda_permission" "auth_billing_summary_api_gateway" {
  statement_id  = "AllowExecutionFromApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.auth_billing_summary.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.auth.execution_arn}/*/*"
}

resource "aws_lambda_permission" "auth_stripe_webhook_api_gateway" {
  statement_id  = "AllowExecutionFromApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.auth_stripe_webhook.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.auth.execution_arn}/*/*"
}

resource "aws_cloudfront_distribution" "auth_api" {
  enabled      = true
  comment      = "Syncpoly Builder auth API distribution"
  price_class  = "PriceClass_100"
  web_acl_id   = aws_wafv2_web_acl.sites.arn
  http_version = "http2and3"

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
    target_origin_id           = local.auth_api_cloudfront_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods             = ["GET", "HEAD", "OPTIONS"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.api_caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.api_all_viewer_except_host.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
    compress                   = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
