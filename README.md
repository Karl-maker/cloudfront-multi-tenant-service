# Syncpoly CloudFront Folder Router

CloudFront Function setup for serving many domains from different folders in one private S3 bucket.

The browser keeps the original URL:

```text
https://hello.com/about
```

CloudFront rewrites the origin request to:

```text
s3://syncpoly-web-builder-sites/hello-site/about/index.html
```

## Shape

- `cloudfront/domain-folder-router.js` is the CloudFront Function source.
- `test/cloudfront-function.test.js` tests host-to-folder rewrites locally.
- `infra/` creates the private S3 bucket, CloudFront Function, CloudFront distribution, Origin Access Control, and read-only S3 bucket policy.
- `bin/bootstrap-tf-state.sh` creates the hardcoded Terraform state bucket and DynamoDB lock table.

## Hardcoded Host Map

For now, edit this object directly in `cloudfront/domain-folder-router.js`:

```js
var foldersByHost = {
  "hello.com": "hello-site",
  "www.hello.com": "hello-site"
};
```

CloudFront Functions cannot call DynamoDB directly, so hardcoded mappings or CloudFront KeyValueStore are the practical paths here.

## Local Commands

```bash
npm install
npm run build
npm test
```

Terraform validation without touching remote state:

```bash
terraform -chdir=infra init -backend=false
terraform -chdir=infra validate
```

## Terraform State Bootstrap

The backend is hardcoded to:

```text
S3 bucket: syncpoly-web-builder-terraform-state
State key: cloudfront/terraform.tfstate
DynamoDB lock table: syncpoly-web-builder-terraform-locks
Region: us-east-1
```

Create those once with AWS credentials in your environment:

```bash
AWS_ACCESS_KEY_ID=... \
AWS_SECRET_ACCESS_KEY=... \
AWS_REGION=us-east-1 \
./bin/bootstrap-tf-state.sh
```

Then run:

```bash
terraform -chdir=infra init
terraform -chdir=infra plan
terraform -chdir=infra apply
```

## GitHub Secrets

The manual Terraform workflow reads AWS credentials from GitHub secrets:

```text
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
```

CI runs build, tests, Terraform formatting, and Terraform validation. The manual `Terraform` workflow bootstraps state, plans, and can apply when you choose `apply`.

Terraform intentionally ignores manual changes to CloudFront aliases and viewer certificates, so adding custom domains later in the AWS console will not be removed by the next apply.
