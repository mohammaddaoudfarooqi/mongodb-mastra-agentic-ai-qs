# Deploy Marshal to AWS + MongoDB Atlas (one command)

Stands up the Marshal fraud-investigation console end to end: an EC2 box running the app in
Docker behind nginx, backed by a new **MongoDB Atlas M10** cluster reached over **AWS ↔ Atlas
VPC peering**. One `terraform apply` (wrapped by `deploy.sh`) builds AWS and Atlas together.

The box deploys in **demo mode** by default: it replays the committed recording (`data/replay/`),
so **no LLM is called at runtime** and it scales to hundreds of concurrent viewers. The only LLM-
adjacent dependency at deploy time is Voyage, used once to embed the corpus during provisioning.

```
┌────────── AWS VPC (10.0.0.0/16) ──────────┐        ┌── Atlas project ──┐
│  EC2 (AL2023, m6i.large)                   │  VPC   │  M10 replica set  │
│   nginx :80  →  app :8000  (Docker)        │ peering│  (change streams) │
│   env from SSM Parameter Store (KMS)       │◄──────►│  192.168.248.0/21 │
└────────────────────────────────────────────┘        └───────────────────┘
```

## Prerequisites (on the deploy machine)

- `terraform` ≥ 1.13, `aws` CLI (configured: `aws sts get-caller-identity` works), `jq`, `ssh`, `curl`
- `pnpm` — for the data-bootstrap step (provision + restore the recording). If missing, the box
  still comes up; run the bootstrap manually afterward (see below).
- A **MongoDB Atlas Programmatic API key** (public + private) and either an existing **project id**
  (`TF_VAR_atlas_project_id`) or an **org id** (`TF_VAR_atlas_org_id`, needs the Project-Creator role).
- A **Voyage API key** (`TF_VAR_voyage_api_key`).
- No Bedrock / cloud-LLM setup required — demo mode makes no model calls.

## Deploy

```bash
cp deploy/terraform/terraform.tfvars.example deploy/terraform/terraform.tfvars
# edit non-secret config (region, name_prefix, office_cidrs, …)

export TF_VAR_atlas_public_key=...   TF_VAR_atlas_private_key=...
export TF_VAR_atlas_project_id=...   # or TF_VAR_atlas_org_id to create a new project
export TF_VAR_voyage_api_key=...

deploy/scripts/deploy.sh              # add --yes to skip the apply confirmation
```

The wrapper: preflight (tool + credential checks, public-IP auto-detect, CIDR-overlap assert,
one-time generation of the Atlas DB password and the app's `AUDIT_SECRET` / `SESSION_SECRET`) →
`terraform apply` (with transient-error retry) → wait for peering **ACTIVE** → wait for the EC2
bootstrap marker → **bootstrap data from this machine** (`pnpm provision && pnpm restore:replay`
against Atlas over the allowlisted admin path) → health-poll the public URL.

**Timing:** ~15–20 min (Atlas M10 ~7–15 min; on-box docker build ~3–5 min).

Generated secrets are persisted to `deploy/.deploy-secrets.env` (gitignored) and reused on every
later run, so re-applies never rotate the audit-chain key or reset the DB password.

## After it's up

- **Console:** `http://<public-dns>/?tour=0` (the `?tour=0` suppresses the auto-tour on stage)
- **Health:** `http://<public-dns>/api/health`
- **Presenter beats** (run against the cluster — same `DEMO_MODE` as the box, i.e. `DEMO_MODE=1`):
  ```bash
  MONGODB_URI=... MONGODB_DB=marshal DEMO_MODE=1 pnpm beat:policy    # POLICY UPDATED LIVE banner
  MONGODB_URI=... MONGODB_DB=marshal DEMO_MODE=1 pnpm beat:tamper    # AUDIT CHAIN BROKEN alarm
  MONGODB_URI=... MONGODB_DB=marshal DEMO_MODE=1 pnpm beat:restore   # AUDIT CHAIN RESTORED
  ```
  See `story.md` for the full presentation walkthrough.

## Live mode (optional)

To run the real agent instead of the replay, set `demo_mode = "0"` in tfvars and supply the LLM
gateway config: `llm_base_url` in tfvars and `TF_VAR_grove_api_key` in the env. `NODE_ENV=production`
(the default) then requires real `AUDIT_SECRET`/`SESSION_SECRET` — the wrapper generates both.

## BYO cluster

Set `create_atlas_cluster = false` and `TF_VAR_mongodb_uri_byo=mongodb+srv://…` (must be a replica
set — Marshal uses change streams). Skips all Atlas/peering resources; allowlist the box's egress
IP on your cluster yourself.

## Redeploy / destroy

```bash
deploy/scripts/redeploy.sh ec2-user@<public-dns> main   # pull code, rebuild, re-apply data (no Terraform)
deploy/scripts/destroy.sh                               # tear everything down (type 'destroy' to confirm)
```

## Security posture

Nothing is world-open. App ports are admitted only from `office_cidrs`; `admin_cidr` (your deploy
machine, auto-detected as a /32) additionally gets SSH and the Atlas provisioning path. Secrets live
in SSM Parameter Store as SecureString (KMS-encrypted), hydrated into `/opt/app/.env` at boot; the
instance role can read only this app's SSM path and decrypt via the SSM KMS key. The connection
string is never a Terraform output — it exists only in SSM.
