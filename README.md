# Ops Agent — Minimal AWS Bootstrap

This repo uses a simple, production‑lean layout:

- `pipeline/pipeline.yaml`: CodePipeline (GitHub trigger) + CodeBuild to deploy SAM stacks
- `sam/data.yaml`: Persistent storage (S3, DynamoDB, SSM) via AWS SAM
- `sam/resources.yaml`: Lambdas, API, roles, and wiring via AWS SAM
- `src/handlers/*`: Lambda handler source code (Node.js)
- `frontend/admin/`: Minimal Next.js skeleton for admin UI (Amplify Hosting ready)

## Deploy (high level)

1) Create/activate a CodeStar Connections GitHub connection in AWS console.
2) Deploy `pipeline/pipeline.yaml`, passing your repo/org/branch and Connection ARN.
3) Push to the configured branch — the pipeline will deploy `sam/data.yaml` then `sam/resources.yaml`.

## Local development

Handlers are plain Node.js modules under `src/handlers`. You can unit test them locally (e.g., with `node` or a test runner). The pipeline builds and deploys without needing a local build chain.

## Next steps

- Flesh out handlers to use DynamoDB/S3 (and S3 Vectors later)
- Add admin UI calls to the deployed API
- Harden IAM and alarms
