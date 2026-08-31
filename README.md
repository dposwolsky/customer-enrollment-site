# Customer Enrollment Site

A static, responsive enrollment site designed to run directly on GitHub Pages. It saves a customer enrollment through a tightly scoped Supabase database function, then reveals a Stripe Payment Link Buy Button with the enrollment UUID attached as `client-reference-id`.

## Architecture

- `index.html` contains the semantic landing page and accessible enrollment form.
- `styles.css` provides the responsive design with no framework or build step.
- `app.js` validates the form, calls Supabase, and creates the Stripe Buy Button only after a confirmed insert.
- GitHub Pages serves the files directly from the repository.
- Supabase stores enrollment records. The browser can call only the `create_enrollment` function; it cannot read or update customer records.
- Stripe hosts checkout and card collection. This site never handles card information.

The browser receives an enrollment UUID, but it does **not** determine payment status. A trusted backend or Supabase Edge Function must verify Stripe webhook signatures and update the matching enrollment after a `checkout.session.completed` event.

## 1. Configure Supabase

Create a Supabase project, open **SQL Editor**, and run the following SQL. The `security definer` function permits one validated insert and returns only its UUID. The anonymous role receives no table-level read, update, or delete access.

```sql
create extension if not exists pgcrypto;

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (char_length(first_name) between 1 and 80),
  last_name text not null check (char_length(last_name) between 1 and 80),
  email text not null check (
    char_length(email) <= 254
    and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  company text not null check (char_length(company) between 1 and 120),
  product text not null check (product = 'launch'),
  consent boolean not null check (consent is true),
  payment_status text not null default 'not_verified'
  check (
    payment_status in (
      'not_verified',
      'paid',
      'failed',
      'refunded'
    )
  ),
  created_at timestamptz not null default now()
);

alter table public.enrollments enable row level security;
revoke all on table public.enrollments from anon, authenticated;

create or replace function public.create_enrollment(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_company text,
  p_product text,
  p_consent boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_id uuid;
begin
  if p_consent is not true then
    raise exception 'Consent is required';
  end if;

  insert into public.enrollments (first_name, last_name, email, company, product, consent)
  values (
    left(trim(p_first_name), 80),
    left(trim(p_last_name), 80),
    lower(left(trim(p_email), 254)),
    left(trim(p_company), 120),
    p_product,
    p_consent
  )
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.create_enrollment(text, text, text, text, text, boolean) from public;
grant execute on function public.create_enrollment(text, text, text, text, text, boolean) to anon;
```

Do not add a `SELECT`, `UPDATE`, or `DELETE` policy for `anon`. Administrative access should use Supabase’s authenticated dashboard or a trusted server-side environment, never this site.

In Supabase, copy:

1. **Project Settings → Data API → Project URL** for `YOUR_SUPABASE_URL`.
2. **Project Settings → API Keys → anon/public key** for `YOUR_SUPABASE_ANON_KEY`. A newer publishable key is also suitable if your project offers it.

Replace the two labeled placeholders in the `CONFIG` block at the top of `app.js`. These browser keys are public by design; Row Level Security and restricted function grants provide the protection.

## 2. Configure Stripe in test mode

1. Switch the Stripe Dashboard to **Test mode**.
2. Create the Acme Launch product and $499 price, then create its Payment Link. The product offered in the form must match this Payment Link.
3. From the Payment Link, choose **Buy button** and copy its `buy-button-id`.
4. Copy the test publishable key from **Developers → API keys**.
5. Replace `YOUR_STRIPE_BUY_BUTTON_ID` and `YOUR_STRIPE_PUBLISHABLE_KEY` in the `CONFIG` block in `app.js`.

The button receives the Supabase UUID as `client-reference-id` and the submitted email as `customer-email`. Never place an `sk_test_…` or `sk_live_…` secret key in this repository.

### Payment verification webhook

Deploy a trusted Stripe webhook handler, such as a Supabase Edge Function. It must:

1. Verify the `Stripe-Signature` header using the webhook signing secret.
2. Handle `checkout.session.completed` idempotently.
3. Read `client_reference_id` from the Checkout Session.
4. Update the matching enrollment to `paid` using credentials stored only in the server-side function environment.

A success-page redirect is not proof of payment and must not update `payment_status` from browser JavaScript.

## 3. Preview locally

No dependencies or build step are required. Serve the directory with any static file server, for example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Opening `index.html` directly also renders the page, but a local server better matches GitHub Pages.

## 4. Deploy with GitHub Pages

1. Push the files to a GitHub repository.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the publishing branch (normally `main`) and `/ (root)`, then save.
5. Wait for GitHub to publish the URL shown in the Pages settings.

This repository needs no GitHub Actions workflow unless you prefer one. Configuration values committed to `app.js` are visible to every visitor.

## Manual test checklist

- [ ] Page works at desktop and narrow mobile widths without horizontal scrolling.
- [ ] Skip link, navigation, form fields, checkbox, and submit button work by keyboard.
- [ ] Every input has a visible label and validation errors are announced.
- [ ] Empty, malformed-email, missing-product, and missing-consent submissions are blocked.
- [ ] A Supabase outage or rejected request leaves the form available and shows a failure message.
- [ ] Valid submission inserts one row and returns a UUID.
- [ ] Anonymous API requests cannot select, update, or delete `enrollments` rows.
- [ ] Stripe Buy Button is absent before enrollment succeeds.
- [ ] After success, the button includes the UUID and prefills the submitted email.
- [ ] Stripe test payment appears in the Dashboard with the matching client reference ID.
- [ ] Webhook signature verification, idempotency, and server-side paid-status update are tested.
- [ ] Browser developer tools and repository search contain no secret keys or customer records.

## Secrets warning

Assume every repository file and every value delivered to the browser is public. Only the Supabase URL, browser-safe anon/publishable key, Stripe Buy Button ID, and Stripe publishable key belong in `app.js`. Keep the Supabase service-role key, Stripe secret key, and webhook signing secret in a trusted server-side secret store.
