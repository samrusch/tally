# Tally

A private budgeting and debt planning app. This is **stage 1: data collection and analysis**.

- Add accounts: checking, savings, investment, retirement, home, vehicle, credit cards, loans, mortgage.
- Log balances by hand. Every update is kept, so you get a running history.
- Link a home or vehicle to its loan and Tally tracks your **equity** (value minus loan balance).
- Dashboard with net worth over time, debt payoff projection, asset allocation, monthly deposits and plain-language insights.
- Behind a Supabase login. Row level security means only your own account can read or write the data.

**Stack:** Nuxt 4 (client-rendered SPA), Tailwind CSS 4, daisyUI 5, Supabase (Postgres + Auth), Chart.js. Hosts on Vercel's Hobby plan.

---

## 1. Set up Supabase (about 5 minutes)

1. Create a project at <https://supabase.com/dashboard>.
2. Open **SQL Editor → New query**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), and run it.
   This creates the `accounts` and `balance_entries` tables with row level security.
3. Open **Authentication → Users → Add user → Create new user**. Enter your email and a strong password, and tick *Auto Confirm User*.
4. Open **Authentication → Sign In / Providers** (or *Settings*) and **turn off "Allow new users to sign up"**.
   The app has no sign-up screen, and this makes sure nobody else can create an account on your public URL.
5. Open **Authentication → URL Configuration**:
   - Site URL: your Vercel URL (you can come back and set this after step 3 below).
   - Redirect URLs: add `http://localhost:3000/confirm` and `https://YOUR-APP.vercel.app/confirm` (only needed for the "email me a sign-in link" option).
6. Open **Project Settings → API** and copy the **Project URL** and the **publishable key** (older projects call it the *anon* key).

## 2. Run it locally

Requires Node 20.19+ (Node 22 recommended).

```bash
cp .env.example .env     # then paste your two values into .env
npm install
npm run dev              # http://localhost:3000
```

`.env` needs just two values:

```
NUXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NUXT_PUBLIC_SUPABASE_KEY=your-publishable-key
```

The publishable key is meant to be public; the row level security policies in `schema.sql` are what protect your data.
Never use the `service_role` / secret key in this app.

## 3. Deploy to Vercel (Hobby)

1. Push this folder to a GitHub repository (`.env` is git-ignored, so your keys stay out of it).
2. In Vercel: **Add New → Project**, import the repo. The Nuxt preset is detected automatically.
3. Before deploying, add the same two environment variables under **Settings → Environment Variables**:
   `NUXT_PUBLIC_SUPABASE_URL` and `NUXT_PUBLIC_SUPABASE_KEY`. They are read at build time, so redeploy after changing them.
4. Deploy, then put the resulting URL into Supabase's URL Configuration (step 5 above).

## Using it

1. **Accounts → Add account.** Pick a type, name it, enter today's balance. For a debt, add the APR and minimum payment.
   For a home or vehicle, add the loan account first, then link it when you create the home or vehicle.
2. **Open an account → Record an update** whenever you have a new number. For savings, investment and retirement accounts,
   fill in *deposits since last update* too; that lets Tally separate what you put in from market growth.
3. Home and vehicle values are entered by hand for now. Saving an update is how a value changes.
4. Saving the same date twice replaces that entry, so fixing a typo is just re-saving. You can also use **Edit** or **Delete** in the history table.

### How the numbers work

- **Net worth** = every asset balance minus every debt balance, using each account's latest entry at or before that date.
  An account only counts from its first entry onward, so history before you added it is not backfilled.
- **Equity** = a home or vehicle's value minus its linked loan's balance.
- **Debt payoff** projects cards and loans only (the mortgage is excluded). It measures how fast each balance fell over its own history
  (up to 12 months, at least one month needed), adds those paces together and runs them forward in a straight line. It ignores interest,
  so treat the date as a rough guide.
- **Update due** appears when an account hasn't been updated in over 35 days.

## Project layout

```
app/
  assets/css/main.css     Tailwind + daisyUI, plus the light and dark "tally" themes
  components/             AccountForm, LineChart, BarChart, StatCard, Sparkline
  composables/            useLedger (loads + shares all data), useToast, useChartTheme
  layouts/                default (sidebar), blank (login)
  pages/                  index (dashboard), accounts/index, accounts/[id], login, confirm
  types/                  app types + database.types.ts
  utils/                  finance.ts (all the math and insights), format.ts
supabase/schema.sql       tables, constraints, row level security
```

All of the calculations live in `app/utils/finance.ts` as plain functions, so they are easy to read and to extend for later stages.

## Changing the database

Edit `supabase/schema.sql`, run the change in the SQL Editor, then regenerate the types:

```bash
npx supabase gen types typescript --project-id YOUR_PROJECT_REF > app/types/database.types.ts
```

## Scripts

| Command             | What it does                      |
| ------------------- | --------------------------------- |
| `npm run dev`       | Dev server with hot reload        |
| `npm run build`     | Production build                  |
| `npm run preview`   | Preview the production build      |
| `npm run typecheck` | Type-check the project            |

## Ideas for the next stages

Monthly budget and spending categories, goals (home remodel, lakefront property, retire at 55), a debt planner with
avalanche vs. snowball and balance transfer comparisons, and CSV import/export of balance history.
