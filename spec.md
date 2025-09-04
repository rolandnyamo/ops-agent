# Docs-Grounded Q&A (Single-Tenant) — Bootstrap Spec for Codegen Agent

**Stack:** AWS CloudFormation (no CDK) • Amazon S3 + **S3 Vectors** • DynamoDB (per-app tables) • API Gateway (HTTP) via **OpenAPI YAML** • Lambda (Node.js 20) • SSM Parameter Store • (Optional) SES for contact handoff • WordPress widget/plugin (no secrets in browser)

> This document describes everything needed to scaffold a **single-tenant** version of the school documentation Q&A app using **S3 Vectors** for retrieval. It is written for a code generation agent to produce the repo(s), CloudFormation templates, Lambda code, OpenAPI spec, and a lightweight WordPress plugin to embed the chat UI. Multi-tenant onboarding comes later.

---

## 0) Goals & Guardrails

### Goals

- Build a **docs-grounded** Q&A service that answers only from uploaded or linked school documents.
- Use **Amazon S3 Vectors** as the vector store (store/query embeddings natively in S3).
- Provide a small **WordPress widget** (bubble + panel) to ask questions from the public site and contact page.
- Provide a minimal **admin flow** (single-tenant) to add a document (title/description/category/audience/year/version + URL or upload) and trigger ingestion.
- Keep costs low; avoid OpenSearch for v1.
- **No “AI” branding** in user UX (neutral copy).

### Non-Goals (v1)

- No multi-tenant control plane; no per-tenant provisioning.
- No mailbox ingestion/reply automation (Phase 2 placeholder only).
- No student DB/finance integrations (Phase 3).

### Guardrails

- **Strict grounding**: answers must be constructed only from retrieved chunks; always attach citations (doc title + section + page range).
- **Fallback**: if confidence < threshold or no relevant chunks, return “not in docs” + show contact form; server sends SES email if configured.
- **Secrets**: do not expose OpenAI/embedding keys in client or WordPress. Store in **SSM Parameter Store** (SecureString).

---

## 1) High-Level Architecture (Single Tenant)

```
[WP Site (twowingsis.com)]
     |  (JS widget via small WP plugin; no secrets)
     v
[API Gateway (HTTP, /prod)  <-- OpenAPI YAML as source of truth]
     |                 \
     |                  \--> [GET /settings] -> SettingsTable
     |--> [POST /qa] -------> AskFn (Lambda)
     |                          |--> SSM: OpenAI key
     |                          |--> embed question
     |                          |--> S3 Vectors: QueryVectors (filters optional)
     |                          |--> compose grounded answer (+citations) OR fallback
     |                          |--> (Optional) SES email on fallback
     |
     |--> [POST /docs/upload-url] -> CreateUploadUrlFn (S3 presign)
     |--> [POST /docs/ingest] ----> IngestionFn
                                   |--> fetch from URL or read from S3
                                   |--> extract text (Textract/Tika)
                                   |--> chunk (500–900 tokens, overlap ~100)
                                   |--> embed chunks (server-side)
                                   |--> S3 Vectors: PutVectors with metadata
                                   |--> update DynamoDB (Docs/Settings)
                                   |--> write chunks JSONL to S3 (raw bucket)
```

---

## 2) Repos, Folders & Pipeline

**Monorepo layout**

```
repo/
  infra/
    pipeline.yml         # CodePipeline + CodeBuild + artifact bucket
    data.yml             # S3/S3 Vectors/DynamoDB/SSM/KMS/IAM base
    compute.yml          # Lambdas + permissions (and SES if used)
    api.yml              # API Gateway from OpenAPI YAML
    openapi.yaml         # Source of truth for routes/schemas/integrations
  app/
    lambdas/
      ask/
        index.ts
        package.json
      ingestion/
        index.ts
        chunk.ts
        extract/
          textract.ts
          html.ts
          docx.ts
          pdf.ts
        vectors/
          s3vectors.ts
        embeddings/
          openai.ts        # server-side embedding provider
      upload-url/
        index.ts
        package.json
      shared/
        conf.ts
        logging.ts
        types.ts
    admin/
      (optional minimal React page to call APIs)
    wp-widget/
      twowings-ask-widget.php   # WP plugin skeleton
      assets/
        widget.js
        widget.css
  .github/ or buildspecs/
    buildspec-app.yml
    buildspec-infra.yml
  README.md
```

---

## 3) AWS Resources (Single Tenant)

- **S3**: raw docs + chunks (JSONL)
- **S3 Vectors**: 1 vector bucket + 1 index
- **DynamoDB**: DocsTable, SettingsTable, QALogsTable
- **Lambda**: CreateUploadUrlFn, IngestionFn, AskFn
- **API Gateway (HTTP)** from OpenAPI
- **SSM**: OpenAI API key
- **SES**: optional

---

## 4) OpenAPI YAML Skeleton

```yaml
openapi: 3.0.3
info:
  title: Docs-Grounded QA API
  version: 1.0.0
paths:
  /settings:
    get:
      operationId: getSettings
      responses:
        '200': { description: OK }
  /docs/upload-url:
    post:
      operationId: createUploadUrl
      responses:
        '200': { description: OK }
  /docs/ingest:
    post:
      operationId: ingestDoc
      responses:
        '202': { description: Accepted }
  /qa:
    post:
      operationId: ask
      responses:
        '200': { description: OK }
```

---

## 5) Data Model

- **DocsTable**: doc\_id (PK), title, desc, category, audience, year, version, status
- **SettingsTable**: key=GLOBAL, branding, thresholds, emails
- **QALogsTable**: day (PK), ts (SK), question, top\_ids, confidence, decision
- **S3 (raw bucket)**: raw/{docId}/{filename}, chunks/{docId}/chunks.jsonl
- **S3 Vectors**: PutVectors per chunk (vector + filterable metadata)

---

## 6) Lambda Flows

- **CreateUploadUrlFn**: presign PUT
- **IngestionFn**: fetch/extract text, chunk, embed, PutVectors, update DDB
- **AskFn**: embed query, QueryVectors, compose grounded answer, fallback if needed

---

## 7) WordPress Plugin

- Admin: API base URL setting
- Shortcode: `[twowings_ask]`
- JS: bubble → /qa → display answers/citations
- CORS restricted to school domain
- No keys in WP

---

## 8–19) (Full details)

- Chunking rules (500–900 tokens, overlap)
- Embedding provider (OpenAI, key in SSM)
- IAM security + KMS
- Logging & CloudWatch alarms
- Test plan (seed doc, queries)
- Copy guidelines (no "AI" mentions, fallback message)

---

## Acceptance Criteria

- Ingest via URL or upload, doc stored in S3 + vectors in S3 Vectors
- `/qa` grounded answers + citations, fallback path works
- OpenAPI YAML is API source of truth
- Deployed via CloudFormation pipeline
- Widget works via `[twowings_ask]`

