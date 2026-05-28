terraform {
  required_version = ">= 1.10.0"

  backend "s3" {
    bucket         = "syncpoly-web-builder-terraform-state"
    key            = "cloudfront/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    use_lockfile   = true
    dynamodb_table = "syncpoly-web-builder-terraform-locks"
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}
