# Tally

A private budgeting and debt planning app. This is **stage 1: data collection and analysis**, plus shared household access, the **stage 2 debt planner**, the **stage 3 budget** and the **stage 4 goals**.

- Add accounts: checking, savings, investment, retirement, home, vehicle, credit cards, loans, mortgage.
- Log balances by hand. Every update is kept, so you get a running history.
- Link a home or vehicle to its loan and Tally tracks your **equity** (value minus loan balance).
- Dashboard with net worth over time, debt payoff projection, asset allocation, an **Activity** feed and plain-language insights. (Your average monthly deposits still show in the top row.)
- **Debt planner** (`/debt`): payoff dates and interest for minimums only, snowball and avalanche, an extra-per-month slider, and a balance transfer calculator.
- **Budget** (`/budget`): your take-home income (any pay frequency), planned spending by category, savings and extra debt payments, with your debt minimums pulled in from your accounts. Shows your planned savings rate and what is left to assign. The debt planner can use that left-over as your extra payment.
- **Goals** (`/goals`): savings goals with an amount and a date (a remodel, a property, optionally a price range) and a retirement goal that works out the nest egg you need and the age you'd reach it. Each shows progress, the monthly amount needed, whether you're on track and a projection chart, and compares the total needed with your budget.
- Behind a Supabase login. Row level security means only people you have added can read or write the data.
- **Shared households with roles:** you are the owner and can add family members as editor, contributor or viewer (see *Sharing with family* below).

**Stack:** Nuxt 4 (client-rendered SPA), Tailwind CSS 4, daisyUI 5, Supabase (Postgres + Auth), Chart.js. Hosts on Vercel's Hobby plan.

---

## 1. Set up Supabase (about 5 minutes)

1. Create a project at <https://supabase.com/dashboard>.
2. Open **Authentication → Users → Add user → Create new user**. Enter your email and a strong password, and tick *Auto Confirm User*.
   Create your own user first: the first user becomes the owner of the household.
3. Open **SQL Editor → New query**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), and run it.
   This creates the tables, the household and roles, and row level security, and makes you the owner.
4. Open **Authentication → Sign In / Providers** (or *Settings*) and **turn off "Allow new users to sign up"**.
   The app has no sign-up screen, and this makes sure nobody else can create an account on your public URL.
5. Open **Authentication → URL Configuration**:
   - Site URL: your Vercel URL (you can come back and set this after step 3 below).
   - Redirect URLs: add `http://localhost:3000/confirm` and `https://YOUR-APP.vercel.app/confirm` (only needed for the "email me a sign-in link" option).
6. Open **Project Settings → API** and copy the **Project URL** and the **publishable key** (older projects call it the *anon* key).

### Upgrading a database that already has Tally data (also needed for each new stage)

Run the new `supabase/schema.sql` in the SQL Editor, exactly as above. It is safe on a live database: your accounts and balance history stay,
and everything you have entered so far moves into a household that you own. It runs as a single transaction, so if anything goes wrong
nothing is changed. Then deploy the new code. Run the SQL first: the new screens expect the new tables.

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

## Sharing with family

Everyone in a household sees the same accounts and balances. Open **Members** (sidebar) to manage who is in it.

| | Owner | Editor | Contributor | Viewer |
|---|---|---|---|---|
| See everything | yes | yes | yes | yes |
| Add accounts, balance updates, income, budget items and goals | yes | yes | yes | no |
| Change or delete those | yes | yes | only ones they created | no |
| Invite people, change roles, remove people | yes | no | no | no |

A contributor can delete an account they created only while all of its history is theirs too, so they can never wipe out someone else's entries.
A household always keeps at least one owner.

**Adding your wife (or anyone):**

1. In Tally, **Members → Invite someone**, enter her email and choose a role (for example *Viewer*).
2. If she has no login yet, create one in Supabase: **Authentication → Users → Add user**, enter her email and a password, and tick *Auto Confirm User*.
   Sign-ups stay switched off, so nobody can create an account on their own.
3. She signs in to Tally with that email and password and joins automatically with the role you chose.

The rules are enforced by the database, not just hidden buttons, so a viewer cannot change anything even by calling the API directly.

## Using it

1. **Accounts → Add account.** Pick a type, name it, enter today's balance. For a debt, add the APR and minimum payment.
   For a home or vehicle, add the loan account first, then link it when you create the home or vehicle.
   (Viewers do not see the add and edit buttons.)
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
- **Debt planner** simulates month by month: interest of APR / 12 is added to each balance, every debt gets its minimum, and the rest of
  your budget (all original minimums plus your extra) goes to the target debt. Cleared debts' minimums roll onto the next one.
  *Avalanche* targets the highest rate, *snowball* the smallest balance, *minimums only* pays no extra and no rollover.
  A missing APR is treated as 0% and a missing minimum as the larger of $25 or 2% of the balance; both are flagged on the page.
  Edit rates and minimums right on the page; they save to the account (and follow the same role rules, so a viewer sees them greyed out).
  The mortgage is left out unless you tick the box.
- **Budget** converts everything to an average month: weekly pay is x 52 / 12, every two weeks is x 26 / 12, twice a month is x 2,
  quarterly is / 3, yearly is / 12. Income minus planned spending, debt minimums, savings and extra debt payments is *left to assign*.
  Debt minimums come from the debts on the Accounts page (the mortgage included), so they are never typed twice.
  *Planned savings rate* is savings divided by income. *Available for extra* debt payments is income minus spending, savings and minimums.
  Biweekly pay has two months a year with a third paycheck and weekly pay has four months with a fifth; the budget uses the average so those
  extra checks are free to send to debt or savings. This stage records the plan only, not what you actually spent.
- **Goals** use steady monthly saving with a constant yearly return (monthly compounding) that you choose per goal, and ignore taxes and fees.
  Progress is the latest balance of the accounts you link to the goal plus any money you mark as already set aside. *Needed per month* is the
  amount that grows today's balance to the target by the date; *on track* means your planned monthly amount gets there. With a price range the plan
  aims for the top of it, and for a purchase you'll finance, enter the cash you need (the down payment), not the full price.
  A retirement goal's nest egg is yearly spending (in today's dollars) divided by the withdrawal rate (for example $90,000 at 4% needs $2.25 million),
  and its return should be after inflation so everything stays in today's dollars. The age you reach the nest egg is shown for your planned pace.
  The same account can count toward several goals, so check you aren't counting it twice.
- **Activity** (dashboard): the 10 most recent additions, changes and deletions across accounts, balances, income, budget items, goals and members, with who did each. It is recorded by the database itself, so it can't be skipped or edited, and everyone in the household can read it. It starts empty and only records things from the day you run the updated `schema.sql`. Changing only a balance's note isn't logged, and anything done directly in the Supabase SQL editor isn't either. Deleting an account logs one line, not one per balance entry.
- **Update due** appears when an account hasn't been updated in over 35 days.

## Project layout

```
app/
  assets/css/main.css     Tailwind + daisyUI, plus the light and dark "tally" themes
  components/             AccountForm, BudgetForm, GoalForm, LineChart, BarChart, StatCard, Sparkline
  composables/            useLedger (loads + shares all data), useHousehold (role + members), useBudget (income + plan), useGoals (goals + projections), useActivity (recent changes), useToast, useChartTheme
  layouts/                default (sidebar), blank (login)
  pages/                  index (dashboard), accounts/index, accounts/[id], budget, debt, goals, members, login, confirm
  types/                  app types + database.types.ts
  utils/                  finance.ts (math and insights), payoff.ts (debt planner), budget.ts (budget maths), goals.ts (projections), activity.ts (activity sentences), format.ts, errors.ts
supabase/schema.sql       tables, households and roles, constraints, row level security
```

All of the calculations live in `app/utils/finance.ts` as plain functions, so they are easy to read and to extend for later stages.

## Troubleshooting

- **`TypeError: options.hostname.toLowerCase is not a function` when running `npm run dev`:** this is a bug in older versions of
  Nuxt's CLI (4.0.1). This project pins `@nuxt/cli` 4.0.3 or newer, which fixes it. If you still see it, run
  `npm install -D @nuxt/cli@latest` and try again.
- **"Invalid path specified in request URL" on sign-in:** the Supabase URL in `.env` is malformed. It must be only the project
  address, like `https://abcdxyz.supabase.co`, with no trailing slash, no path such as `/rest/v1`, and no quotes. The login page now
  warns you when it spots this. Fix `.env` and restart `npm run dev`.
- **"Email me a sign-in link" does nothing or errors:** the link only works for a user that already exists, and `http://localhost:3000/confirm`
  must be listed under Authentication → URL Configuration → Redirect URLs. Signing in with email and password avoids that setup, so
  set a password for your user in Authentication → Users if you haven't.
- **Blank page or redirect loop on first load:** check that `.env` exists (not just `.env.example`) and that both Supabase values are filled in.
  Restart `npm run dev` after editing `.env`.
- **"You don't have access yet" after signing in:** the email isn't in a household. The owner needs to invite it from Members, or, if you
  are the very first user, run `supabase/schema.sql` again after creating your user.
- **"Could not load your household" after upgrading the code:** run the new `supabase/schema.sql` in the SQL Editor first. If it still complains
  about a missing table or function, run `notify pgrst, 'reload schema';`.
- **"Invalid login credentials":** the user must be created in Supabase under Authentication → Users first; the app has no sign-up screen.

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

Ideas for later: actual spending against the budget (monthly totals per category), CSV import and export of balance history, and hiding chosen accounts from chosen people.
