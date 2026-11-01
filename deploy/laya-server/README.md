# Shared Laya server

Runs `laya-serve` on one `c7i-flex.large` EC2 instance in Tokyo (`ap-northeast-1`), behind Caddy for HTTPS. The cloud's
`/api/v1/laya/classify` route forwards to it. `laya-serve` listens on localhost only; the security
group admits 80 and 443 only; every request needs the shared secret.

| File | What it is |
|---|---|
| `deployer-policy.json` | the AWS permissions needed to run `provision.sh` |
| `instance-role-policy.json` | what the server itself may read: its own parameters only |
| `provision.sh` | creates the role, security group, secret and instance; safe to run again |
| `user-data.sh` | first-boot setup: installs Laya and Caddy, downloads the model, starts both |
| `laya-serve.service` | systemd unit for the model server |
| `Caddyfile` | HTTPS for `laya-origin.mastyf.ai`, with no access logs |

## Before you run it

1. Allocate an Elastic IP in `ap-northeast-1` and point `laya-origin.mastyf.ai` at it with an `A` record.
2. As an admin, create a customer-managed IAM policy named `mastyf-laya-read-parameters` from
   `instance-role-policy.json`.
3. As an admin, attach `deployer-policy.json` to the deploying IAM user. It can attach only that
   policy and `AmazonSSMManagedInstanceCore` to the server's role, and can't edit either one.
4. Store a read-only Hugging Face token. In PowerShell:

   ```powershell
   aws ssm put-parameter --name /mastyf/laya/shared/hf-token --type SecureString --region ap-northeast-1 --profile mastyf-temp --value <token>
   ```

   In Git Bash, put `MSYS_NO_PATHCONV=1` in front of the command.

## Run it

```bash
ELASTIC_IP=<ip> LAYA_MODEL_REPO=<owner/model> LAYA_MODEL_REVISION=<commit> ./deploy/laya-server/provision.sh
```

First boot takes several minutes, mostly installing PyTorch and downloading the model. The HTTPS
certificate arrives once DNS resolves to the Elastic IP.

## Check it

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://laya-origin.mastyf.ai/health                    # 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://laya-origin.mastyf.ai/v1/systemone -d '{}'  # 401
```

Setup log on the server: `/var/log/cloud-init-output.log`.

## Connect the cloud

Set these in Vercel for production, then redeploy:

- `LAYA_SHARED_URL=https://laya-origin.mastyf.ai/v1/systemone`
- `LAYA_SHARED_SECRET=<value of /mastyf/laya/shared/secret>`
