# Inbox shows “hajjiazmatullah” instead of “Go Live Check List”

Gmail often uses the **Google Account profile name**, not only the app’s From header.

## Fix (2 minutes) — works 100% with Gmail SMTP

1. Login **hajjiazmatullah@gmail.com**
2. Open: https://myaccount.google.com/personal-info
3. **Name** → Edit → set to: **Go Live Check List** (or “Go Live Checklist”)
4. Save

Next emails to **habib.developer8899@gmail.com** will show **Go Live Check List** in the inbox list.

## Also on Vercel (after code deploy)

Environment variable:

| Key | Value |
|-----|--------|
| `GO_LIVE_AUDIT_EMAIL_FROM_NAME` | `Go Live Check List` |

Then **Redeploy**.

## Optional: Gmail “Send mail as”

Gmail → Settings → Accounts → Send mail as → add name **Go Live Check List** (same address).
