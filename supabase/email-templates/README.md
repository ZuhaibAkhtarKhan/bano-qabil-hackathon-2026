# Supabase auth email templates (1-Apply)

## Free tier: custom template + custom SMTP go together

Since **June 2026**, Supabase free-tier projects **cannot** edit auth email templates while using Supabase’s built-in mail sender.

| Custom SMTP | Can edit templates? | What you get |
|-------------|---------------------|--------------|
| **OFF** | No (read-only) | Supabase default plain emails |
| **ON** | Yes | Your branded HTML from this folder |

**Important:** If you turn **off** custom SMTP, Supabase **resets all email templates back to defaults**. That is expected dashboard behavior — not a bug. To keep the 1-Apply design, leave custom SMTP **on** and fix Resend (below), then paste the template again.

---

## Setup (do in this order)

### 1. Enable Resend SMTP

Supabase Dashboard → **Authentication** → **SMTP Settings**

| Field | Value |
|--------|--------|
| **Enable custom SMTP** | ON |
| **Sender email** | `onboarding@resend.dev` |
| **Sender name** | `1-Apply` |
| **Host** | `smtp.resend.com` |
| **Port** | `465` |
| **Username** | `resend` (literal — not your project name) |
| **Password** | Resend API key (`re_...`) from [API Keys](https://resend.com/api-keys) |

Common mistakes that cause **“Error sending confirmation email”**:

| Mistake | Correct value |
|---------|----------------|
| Username = project name | Username must be **`resend`** |
| Password = Supabase key | Password = Resend API key **`re_...`** |
| Sender = unverified domain | Use **`onboarding@resend.dev`** until domain is verified |
| Test signup with random email | Without a domain, Resend only delivers to **your Resend account email** |

Save SMTP settings and confirm the toggle stays **ON**.

### 2. Paste the branded template

Supabase Dashboard → **Authentication** → **Email Templates** → **Confirm signup**

1. Subject: `Confirm your 1-Apply account`
2. Body: paste full HTML from `confirm-signup.html`
3. **Save**

If you previously turned SMTP off, the template was reset — paste it again after re-enabling SMTP.

### 3. URL configuration

**Authentication** → **URL Configuration**

- **Site URL**: `http://localhost:3000` (local) or your deployed URL
- **Redirect URLs**: add `http://localhost:3000/auth/callback`

### 4. Test signup

Sign up with the **same email as your Resend account** until you verify a custom domain.

---

## “Error sending confirmation email”

This means **Supabase could not send mail** (SMTP misconfiguration). It is not a bug in the Next.js app.

Do **not** turn off custom SMTP to “fix” it — that drops your template. Fix the Resend fields in the table above instead.

---

## When you get a domain

1. Add and verify the domain in Resend (or Brevo / SendGrid / AWS SES)
2. Change **Sender email** to e.g. `noreply@yourdomain.com`
3. Update **Site URL** to your production URL

---

## Alternative: Brevo (verify personal email, no custom domain)

| Field | Value |
|--------|--------|
| **Host** | `smtp-relay.brevo.com` |
| **Port** | `587` |
| **Username** | Your Brevo account email |
| **Password** | SMTP key from Brevo → SMTP & API |
| **Sender email** | The single sender email you verified in Brevo |

Keep custom SMTP **on** and paste templates the same way.

---

## Supabase template variables

Use these in HTML (Go template syntax):

| Variable | Purpose |
|----------|---------|
| `{{ .ConfirmationURL }}` | Confirm signup link (use in button + fallback) |
| `{{ .Email }}` | User’s email address |
| `{{ .SiteURL }}` | App site URL from Auth settings |
| `{{ .Token }}` | OTP token (magic link / OTP flows) |

## Also customize

- **Magic link** — reuse the same layout; CTA “Sign in to 1-Apply”
- **Reset password** — same layout; CTA “Reset password”
- **Invite user** — if you enable invites later

Copy `confirm-signup.html` as a base and adjust the headline + button label.
