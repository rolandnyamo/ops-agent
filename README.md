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

Backend (SAM):
- Requires AWS SAM CLI and Docker (for emulation)
- Start local API (no auth):
  - `npm run dev:api` (or see below for profile/region flags)
- Uses your default AWS credentials; to use a profile: add `--profile <name>`
- Ensure `sam/local-env.json` has your real table/bucket names for cloud resources

Profiles and region:
- Easiest: `AWS_PROFILE=my-profile AWS_REGION=us-east-1 npm run dev`
- Or pass flags to just the API process via npm config args:
  - `npm run dev --profile=my-profile --region=us-east-1`
  - These map to `sam local start-api ... --profile my-profile --region us-east-1`

Frontend (Next.js):
- `cd frontend/admin`
- Set `.env.local` with:
  - `NEXT_PUBLIC_API_BASE=http://127.0.0.1:3001`
  - `NEXT_PUBLIC_AWS_REGION=us-east-1` (not used when EnableAuth=false)
  - `NEXT_PUBLIC_COGNITO_USER_POOL_ID=...` (optional for local no-auth)
  - `NEXT_PUBLIC_COGNITO_USER_POOL_WEB_CLIENT_ID=...` (optional)
- Run: `npm run dev` (or `npm run build && npm run start`)

## Next steps

- Flesh out handlers to use DynamoDB/S3 (and S3 Vectors later)
- Add admin UI calls to the deployed API
- Harden IAM and alarms
