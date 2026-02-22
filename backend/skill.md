---
name: memetics
version: 1.0.0
description: Custom token homepages on memetics.wtf. Deploy a bungalow — a branded landing page for your Solana token — in one API call.
homepage: https://memetics.wtf
metadata: {"category": "defi-tools", "api_base": "https://memetics.wtf"}
---

# Memetics — Custom Token Homepages

You have a Solana token. Dexscreener gives you a chart. Memetics gives you a **home**.

A **bungalow** is a custom-branded landing page for your token, hosted at `memetics.wtf/solana/{mint_address}`. You control the HTML. One API call to deploy. One API call to update.

---

## Quick Start

### 1. Build your page

Create a single `index.html` file with **all CSS and JS inlined**. No external dependencies except fonts (Google Fonts, etc). The page must be fully self-contained.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>$YOUR_TOKEN</title>
  <style>
    /* all your CSS here, inlined */
  </style>
</head>
<body>
  <!-- your token homepage -->
  <script>
    // all your JS here, inlined
  </script>
</body>
</html>
```

### 2. Host it as a raw file

Upload your HTML to a GitHub Gist and get the **raw URL**:

```
https://gist.githubusercontent.com/{user}/{gist_id}/raw/{file_id}/index.html
```

The URL must be a raw file URL — we fetch and store the HTML content directly.

### 3. Deploy it

```
POST https://memetics.wtf/api/v1/bungalow
Content-Type: application/json
Payment-Signature: 0x<tx_hash>

{
  "mint_address": "YourTokenMintAddress123456789pump",
  "html_url": "https://gist.githubusercontent.com/.../raw/.../index.html",
  "title": "My Token",
  "description": "One-line description of your project"
}
```

Cost: **$5.00 USDC** via x402 protocol on Base.

### 4. Done

Your bungalow is live at:

```
https://memetics.wtf/solana/YourTokenMintAddress123456789pump
```

---

## Payment — x402 Protocol

Every bungalow deployment costs **$5.00 USDC** paid via the x402 protocol.

### How to pay

1. Get the treasury address: `GET https://memetics.wtf/api/treasury`
2. Send **5.00 USDC** on Base (chain ID 8453) to the treasury address
3. Pass the transaction hash in the `Payment-Signature` header

```
POST https://memetics.wtf/api/v1/bungalow
Content-Type: application/json
Payment-Signature: 0x<64 hex chars tx hash>

{ ... }
```

Any wallet can pay. No API key needed. No registration. Just USDC and a tx hash.

### Payment flow

1. `Payment-Signature` header with raw tx hash (0x + 64 hex) → **wallet payment**
2. No payment header → **402 Payment Required** (response includes treasury address and cost)

**402 response example:**

```json
{
  "error": "payment required",
  "cost_usdc": 5.00,
  "treasury": "0xe91B8920Ef5DBf6e1289991F1CE4eeF3671A610E",
  "chain": "base",
  "chain_id": 8453,
  "usdc_contract": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "accepts": ["x402", "raw_tx_hash"]
}
```

---

## Full API Reference

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| POST | `/api/v1/bungalow` | Payment | Deploy or update a bungalow |
| GET | `/api/v1/bungalow/{mint_address}` | None | Get bungalow metadata |
| GET | `/api/treasury` | None | Get USDC treasury address |
| GET | `/solana/{mint_address}` | None | View the live bungalow page |
| GET | `/api/bungalows` | None | List bungalows |
| GET | `/api/health` | None | Service health check |

---

## Endpoints in Detail

### Deploy / Update Bungalow

```
POST https://memetics.wtf/api/v1/bungalow
Content-Type: application/json
Payment-Signature: 0x<tx_hash>

{
  "mint_address": "6GsRbp2Bz9QZsoAEmUSGgTpTW7s59m7R3EGtm1FPpump",
  "html_url": "https://gist.githubusercontent.com/user/abc123/raw/def456/index.html",
  "title": "anky",
  "description": "write yourself into existence"
}
```

**Request fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mint_address` | string | yes | Solana token mint address |
| `html_url` | string | yes | Raw URL to self-contained HTML file (GitHub Gist raw, etc.) |
| `title` | string | yes | Token/project name |
| `description` | string | no | One-line description |

**Response (201):**

```json
{
  "ok": true,
  "mint_address": "6GsRbp2Bz9QZsoAEmUSGgTpTW7s59m7R3EGtm1FPpump",
  "url": "https://memetics.wtf/solana/6GsRbp2Bz9QZsoAEmUSGgTpTW7s59m7R3EGtm1FPpump",
  "deployed_at": "2026-02-20T18:30:00Z"
}
```

**Updating:** POST to the same `mint_address` again with a new `Payment-Signature`. The old page is replaced. Each deployment costs $5 USDC.

### Get Bungalow Metadata

```
GET https://memetics.wtf/api/v1/bungalow/{mint_address}
```

**Response:**

```json
{
  "mint_address": "6GsRbp2Bz9QZsoAEmUSGgTpTW7s59m7R3EGtm1FPpump",
  "chain": "solana",
  "title": "anky",
  "description": "write yourself into existence",
  "url": "https://memetics.wtf/solana/6GsRbp2Bz9QZsoAEmUSGgTpTW7s59m7R3EGtm1FPpump",
  "deployed_at": "2026-02-20T18:30:00Z",
  "updated_at": "2026-02-20T18:30:00Z"
}
```

### Treasury

```
GET https://memetics.wtf/api/treasury
```

```json
{
  "address": "0xe91B8920Ef5DBf6e1289991F1CE4eeF3671A610E",
  "chain": "base",
  "chain_id": 8453,
  "usdc_contract": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "bungalow_cost_usdc": 5.00
}
```

---

## HTML Requirements

Your `index.html` must be:

1. **Self-contained** — all CSS in `<style>` tags, all JS in `<script>` tags
2. **No external scripts** — no CDN links to JS libraries (Google Fonts CSS is OK)
3. **Responsive** — must work on mobile and desktop
4. **Max size: 500KB** — keep it lean
5. **Hosted as raw URL** — GitHub Gist raw URLs, raw.githubusercontent.com, or any URL ending in .html/.htm or containing /raw/

Memetics fetches your HTML from the raw URL and serves it directly. Your page IS the page at that URL.

---

## Costs

| Action | Cost |
|--------|------|
| Deploy bungalow | $5.00 USDC |
| Update bungalow | $5.00 USDC |
| View bungalow | Free |
| API metadata queries | Free |

USDC contract on Base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
Treasury: `0xe91B8920Ef5DBf6e1289991F1CE4eeF3671A610E`

---

## Example: Agent Workflow

```python
import requests

# 1. Check treasury
treasury = requests.get("https://memetics.wtf/api/treasury").json()
print(f"Send {treasury['bungalow_cost_usdc']} USDC to {treasury['address']} on Base")

# 2. After payment, deploy
resp = requests.post(
    "https://memetics.wtf/api/v1/bungalow",
    headers={
        "Content-Type": "application/json",
        "Payment-Signature": "0x<your_tx_hash>"
    },
    json={
        "mint_address": "YourMintAddress",
        "html_url": "https://gist.githubusercontent.com/.../raw/.../index.html",
        "title": "My Token",
        "description": "The best token"
    }
)
print(resp.json())
# {"ok": true, "url": "https://memetics.wtf/solana/YourMintAddress", ...}
```

---

Deploy your token's home. The chart is on dexscreener. The story is on memetics.
