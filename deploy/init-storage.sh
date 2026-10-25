#!/bin/sh
# Creates the upload bucket and points its object-created events at the backend
# (the OCR webhook). Idempotent; run by the storage-init service in docker-compose.yml.
set -eu

s3() {
    aws --endpoint-url "$S3_ENDPOINT" --region us-east-1 "$@"
}

echo "Waiting for RustFS at $S3_ENDPOINT ..."
until s3 s3api list-buckets > /dev/null 2>&1; do
    sleep 1
done

if ! s3 s3api head-bucket --bucket "$S3_BUCKET" > /dev/null 2>&1; then
    echo "Creating bucket $S3_BUCKET"
    s3 s3api create-bucket --bucket "$S3_BUCKET"
fi

echo "Registering the OCR webhook for $S3_BUCKET"
s3 s3api put-bucket-notification-configuration \
    --bucket "$S3_BUCKET" \
    --notification-configuration '{"QueueConfigurations":[{"Id":"ocr-uploads","QueueArn":"arn:rustfs:sqs:us-east-1:primary:webhook","Events":["s3:ObjectCreated:*"],"Filter":{"Key":{"FilterRules":[{"Name":"prefix","Value":"uploads/"}]}}}]}'

echo "Storage ready"
