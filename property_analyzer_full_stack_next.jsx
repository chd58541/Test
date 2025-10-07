// Property Analyzer SaaS – Full Stack Starter (Next.js 14 + TypeScript + Supabase + Stripe)
// -------------------------------------------------------------------------------
// This single file contains the full repository scaffold using "virtual files".
// Copy sections into real files matching the paths below, or use as a reference.
// Focus: (1) Exactable finance engine, (2) Auth + saved analyses (Supabase),
// (3) Payments: subscriptions + pay-per-analysis (Stripe), (4) Deploy to Vercel.

// ┌───────────────────────────────────────────────────────────────────────────┐
// │ 1) package.json                                                          │
// └───────────────────────────────────────────────────────────────────────────┘
// --- file: package.json
{
  "name": "property-analyzer-saas",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "14.2.5",
    "react": "18.2.0",
    "react-dom": "18.2.0",
    "zod": "3.23.8",
    "zustand": "4.5.2",
    "@supabase/ssr": "0.5.1",
    "@supabase/supabase-js": "2.45.5",
    "stripe": "16.12.0",
    "date-fns": "3.6.0"
  },
  "devDependencies": {
    "typescript": "5.6.3",
    "eslint": "8.57.0",
    "eslint-config-next": "14.2.5",
    "tailwindcss": "3.4.10",
    "postcss": "8.4.47",
    "autoprefixer": "10.4.20"
  }
}

// ┌───────────────────────────────────────────────────────────────────────────┐
// │ 2) .env.example (copy to .env.local)                                     │
// └───────────────────────────────────────────────────────────────────────────┘
// --- file: .env.example
# Supabase
NEXT_PUBLIC_SUPABASE_URL="https://YOUR-PROJECT.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="YOUR_SUPABASE_ANON_KEY"
SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY" # used only in server code if needed

# Stripe
STRIPE_SECRET_KEY="sk_live_or_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
NEXT_PUBLIC_STRIPE_PRICE_MONTHLY="price_..."    # recurring price id
NEXT_PUBLIC_STRIPE_PRICE_ANNUAL="price_..."     # optional
NEXT_PUBLIC_STRIPE_PRICE_ONE_TIME="price_..."   # one-time price id
STRIPE_CHECKOUT_SUCCESS_URL="http://localhost:3000/success"
STRIPE_CHECKOUT_CANCEL_URL="http://localhost:3000/pricing"

# App
NEXT_PUBLIC_APP_NAME="Property Analyzer"
NEXTAUTH_SECRET="dev-secret-change-me"

// ┌───────────────────────────────────────────────────────────────────────────┐
// │ 3) tailwind setup                                                         │
// └───────────────────────────────────────────────────────────────────────────┘
// --- file: tailwind.config.js
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: []
}

// --- file: postcss.config.js
module.exports = {
  plugins: { tailwindcss: {}, autoprefixer: {} }
}

// --- file: app/globals.css
@tailwind base;
@tailwind components;
@tailwind utilities;

.input{ @apply w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500; }
.btn{ @apply inline-flex items-center justify-center rounded-2xl px-4 py-2 font-medium shadow; }
.btn-primary{ @apply btn bg-indigo-600 text-white hover:bg-indigo-700; }
.btn-outline{ @apply btn border border-slate-300 bg-white hover:bg-slate-50; }
.btn-ghost{ @apply btn text-slate-700 hover:bg-slate-100; }
.card{ @apply bg-white rounded-2xl p-5 shadow; }

// ┌───────────────────────────────────────────────────────────────────────────┐
// │ 4) Supabase: schema.sql + server client                                   │
// └───────────────────────────────────────────────────────────────────────────┘
// --- file: supabase/schema.sql
-- Run in Supabase SQL editor
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamp with time zone default now()
);

create table if not exists analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  payload jsonb not null, -- raw inputs
  results jsonb,          -- computed results snapshot
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_subscribed boolean default false,
  one_time_credits int default 0,
  updated_at timestamptz default now()
);

-- RLS
alter table analyses enable row level security;
create policy "user-can-rw-own-analyses" on analyses
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table entitlements enable row level security;
create policy "user-read-own-entitlements" on entitlements for select using (auth.uid() = user_id);
create policy "user-update-own-entitlements" on entitlements for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

// --- file: lib/supabase-server.ts
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

export function supabaseServer() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value; },
        set(name: string, value: string, options: any) { cookieStore.set({ name, value, ...options }); },
        remove(name: string, options: any) { cookieStore.set({ name, value: "", ...options }); },
      },
    }
  );
}

// --- file: lib/supabase-browser.ts
import { createBrowserClient } from "@supabase/ssr";
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ┌───────────────────────────────────────────────────────────────────────────┐
// │ 5) Finance Engine (exactable formulas)                                    │
// └───────────────────────────────────────────────────────────────────────────┘
// --- file: lib/finance.ts
export type Inputs = {
  purchasePrice: number;
  closingCosts: number;
  loanCosts: number;
  rehab: number;
  miscCosts: number;
  loanPct: number;          // e.g., 75
  interestRatePct: number;  // APR, e.g., 6.25
  amortYears: number;       // e.g., 30
  vacancyPct: number;       // e.g., 7
  startingRent: number;     // monthly gross
  miscIncome: number;       // monthly
  propMgmtPct: number;      // of gross rent
};

export type Results = {
  totalCost: number;
  loanAmount: number;
  monthlyMortgage: number;
  monthlyNOI: number;
  monthlyCFAfterDebt: number;
  annualizedCF: number;
  initialEquity: number;
  cashOnCashPct: number;
  stabilizedYieldPct: number;
  equityMultipleEst: number;
};

export function pmntAPR(principal: number, aprPct: number, nMonths: number) {
  const r = aprPct / 100 / 12;
  if (principal <= 0 || r <= 0 || nMonths <= 0) return 0;
  return (principal * r) / (1 - Math.pow(1 + r, -nMonths));
}

export function irr(cashflows: number[], guess = 0.1): number {
  // Newton-Raphson; returns annual IRR as decimal (e.g., 0.12 for 12%)
  const maxIter = 100; const tol = 1e-7; let x = guess;
  for (let i = 0; i < maxIter; i++) {
    let f = 0, df = 0;
    for (let t = 0; t < cashflows.length; t++) {
      const cf = cashflows[t];
      f += cf / Math.pow(1 + x, t);
      df += (-t * cf) / Math.pow(1 + x, t + 1);
    }
    const x1 = x - f / df;
    if (Math.abs(x1 - x) < tol) return x1;
    x = x1;
  }
  return x;
}

export function compute(inputs: Inputs): Results {
  const totalCost = inputs.purchasePrice + inputs.closingCosts + inputs.loanCosts + inputs.rehab + inputs.miscCosts;
  const loanAmount = (inputs.loanPct / 100) * inputs.purchasePrice;
  const monthlyMortgage = pmntAPR(loanAmount, inputs.interestRatePct, inputs.amortYears * 12);

  const vacancy = inputs.vacancyPct / 100;
  const grossAfterVacancy = inputs.startingRent * (1 - vacancy) + inputs.miscIncome;
  const propMgmt = (inputs.propMgmtPct / 100) * inputs.startingRent;
  // Placeholder other opex set to 30% of rent; replace with detailed lines later
  const otherOps = 0.30 * inputs.startingRent;
  const monthlyOpex = propMgmt + otherOps;

  const monthlyNOI = Math.max(0, grossAfterVacancy - monthlyOpex);
  const monthlyCFAfterDebt = monthlyNOI - monthlyMortgage;
  const annualizedCF = monthlyCFAfterDebt * 12;
  const initialEquity = Math.max(0, totalCost - loanAmount);
  const cashOnCashPct = initialEquity > 0 ? (annualizedCF / initialEquity) * 100 : 0;
  const stabilizedYieldPct = totalCost > 0 ? ((monthlyNOI * 12) / totalCost) * 100 : 0;
  const equityMultipleEst = 1 + (annualizedCF * 5) / Math.max(1, initialEquity); // 5-year rough

  return {
    totalCost, loanAmount, monthlyMortgage, monthlyNOI, monthlyCFAfterDebt,
    annualizedCF, initialEquity, cashOnCashPct, stabilizedYieldPct, equityMultipleEst
  };
}

// ┌───────────────────────────────────────────────────────────────────────────┐
// │ 6) App Router: layout + protected pages + pricing                         │
// └───────────────────────────────────────────────────────────────────────────┘
// --- file: app/layout.tsx
import "./globals.css";
import React from "react";
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50">
        <div className="max-w-6xl mx-auto p-6">
          <header className="flex items-center justify-between mb-6">
            <a href="/" className="text-xl font-semibold">{process.env.NEXT_PUBLIC_APP_NAME}</a>
            <nav className="flex gap-3 text-sm">
              <a href="/pricing" className="hover:underline">Pricing</a>
              <a href="/dashboard" className="hover:underline">Dashboard</a>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}

// --- file: app/page.tsx (Landing)
export default function Home() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="card">
        <h1 className="text-3xl font-semibold">Analyze Rental Deals Instantly</h1>
        <p className="text-slate-600 mt-2">Upload or input assumptions, and get IRR, CoC, and cash flow in seconds. Built for real estate investors.</p>
        <div className="mt-4 flex gap-3">
          <a className="btn-primary" href="/dashboard">Try the App</a>
          <a className="btn-outline" href="/pricing">See Pricing</a>
        </div>
      </div>
      <div className="card">
        <div className="h-64 rounded-2xl border flex items-center justify-center text-slate-400">Preview image / chart</div>
      </div>
    </div>
  );
}

// --- file: app/dashboard/page.tsx
"use client";
import { useState, useEffect } from "react";
import { compute, type Inputs } from "@/lib/finance";
import { supabase } from "@/lib/supabase-browser";

export default function Dashboard() {
  const [name, setName] = useState("New Analysis");
  const [inputs, setInputs] = useState<Inputs>({
    purchasePrice: 460000, closingCosts: 7500, loanCosts: 3500, rehab: 40241, miscCosts: 0,
    loanPct: 75, interestRatePct: 6.25, amortYears: 30,
    vacancyPct: 7, startingRent: 1200, miscIncome: 15, propMgmtPct: 10,
  });
  const results = compute(inputs);

  async function save() {
    const { data: user } = await supabase.auth.getUser();
    if (!user?.user) { alert("Please sign in first (Supabase Magic Link or OAuth)"); return; }
    const payload = { name, payload: inputs, results };
    const { error } = await supabase.from("analyses").insert({ name, payload: inputs, results });
    if (error) alert(error.message); else alert("Saved!");
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <section className="lg:col-span-2 card">
        <h2 className="text-xl font-medium mb-4">Inputs</h2>
        <label className="block text-sm">Analysis Name</label>
        <input className="input mt-1" value={name} onChange={e=>setName(e.target.value)} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div className="p-4 border rounded-xl">
            <h3 className="font-semibold mb-2">Purchase</h3>
            {(
              [
                ["purchasePrice","Purchase Price"], ["closingCosts","Closing Costs"], ["loanCosts","Loan Costs"],
                ["rehab","Rehab / Op Deficit"], ["miscCosts","Misc Costs"]
              ] as const
            ).map(([k,label]) => (
              <div key={k} className="mt-3">
                <label className="block text-sm">{label}</label>
                <input className="input mt-1" type="number" value={(inputs as any)[k]}
                  onChange={e=>setInputs(prev=>({...prev,[k]: Number(e.target.value)}))} />
              </div>
            ))}
          </div>
          <div className="p-4 border rounded-xl">
            <h3 className="font-semibold mb-2">Financing</h3>
            {(
              [
                ["loanPct","Loan %"], ["interestRatePct","Interest Rate %"], ["amortYears","Amortization (yrs)"]
              ] as const
            ).map(([k,label]) => (
              <div key={k} className="mt-3">
                <label className="block text-sm">{label}</label>
                <input className="input mt-1" type="number" value={(inputs as any)[k]}
                  onChange={e=>setInputs(prev=>({...prev,[k]: Number(e.target.value)}))} />
              </div>
            ))}
          </div>
          <div className="p-4 border rounded-xl">
            <h3 className="font-semibold mb-2">Rent & Ops</h3>
            {(
              [
                ["startingRent","Starting Rent (mo)"], ["vacancyPct","Vacancy %"], ["miscIncome","Misc Income (mo)"], ["propMgmtPct","Property Mgmt %"]
              ] as const
            ).map(([k,label]) => (
              <div key={k} className="mt-3">
                <label className="block text-sm">{label}</label>
                <input className="input mt-1" type="number" value={(inputs as any)[k]}
                  onChange={e=>setInputs(prev=>({...prev,[k]: Number(e.target.value)}))} />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 flex gap-3">
          <button className="btn-primary" onClick={save}>Save Analysis</button>
          <a className="btn-outline" href="/pricing">Upgrade / Buy</a>
        </div>
      </section>

      <aside className="card">
        <h2 className="text-xl font-medium mb-3">Results</h2>
        <div className="space-y-3 text-sm">
          <Row label="Total Project Cost" value={results.totalCost} money />
          <Row label="Loan Amount" value={results.loanAmount} money />
          <Row label="Monthly Mortgage" value={results.monthlyMortgage} money />
          <Row label="Monthly NOI" value={results.monthlyNOI} money />
          <Row label="Monthly CF (after debt)" value={results.monthlyCFAfterDebt} money highlight />
          <Row label="Annualized CF" value={results.annualizedCF} money />
          <Row label="Initial Equity" value={results.initialEquity} money />
          <Row label="Cash-on-Cash" value={results.cashOnCashPct} pct />
          <Row label="Stabilized Yield" value={results.stabilizedYieldPct} pct />
          <Row label="Equity Multiple (est)" value={results.equityMultipleEst} />
        </div>
      </aside>
    </div>
  );
}

function Row({ label, value, money, pct, highlight }: { label: string; value: number; money?: boolean; pct?: boolean; highlight?: boolean; }){
  const fmtMoney = (v:number)=> `$${v.toLocaleString(undefined,{maximumFractionDigits:0})}`;
  const fmtPct = (v:number)=> `${v.toFixed(2)}%`;
  return (
    <div className={`p-3 border rounded-xl ${highlight ? (value<0?"border-rose-300 bg-rose-50":"border-emerald-300 bg-emerald-50") : ""}`}>
      <div className="flex justify-between">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold">{money ? fmtMoney(value) : pct ? fmtPct(value) : value.toFixed(2)}</span>
      </div>
    </div>
  );
}

// --- file: app/pricing/page.tsx
"use client";
import { useState } from "react";

export default function Pricing(){
  const [loading, setLoading] = useState<string | null>(null);
  async function checkout(priceId: string){
    try{
      setLoading(priceId);
      const res = await fetch("/api/stripe/checkout",{ method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ priceId })});
      const { url, error } = await res.json();
      if (error) throw new Error(error);
      window.location.href = url;
    }catch(e:any){ alert(e.message); } finally{ setLoading(null); }
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Plan title="Pay Per Analysis" price="$5" desc="One analysis credit" onClick={()=>checkout(process.env.NEXT_PUBLIC_STRIPE_PRICE_ONE_TIME!)} loading={loading===process.env.NEXT_PUBLIC_STRIPE_PRICE_ONE_TIME} />
      <Plan title="Monthly" price="$19" desc="Unlimited analyses" onClick={()=>checkout(process.env.NEXT_PUBLIC_STRIPE_PRICE_MONTHLY!)} loading={loading===process.env.NEXT_PUBLIC_STRIPE_PRICE_MONTHLY} />
      <Plan title="Annual" price="$180" desc="2 months free" onClick={()=>checkout(process.env.NEXT_PUBLIC_STRIPE_PRICE_ANNUAL!)} loading={loading===process.env.NEXT_PUBLIC_STRIPE_PRICE_ANNUAL} />
    </div>
  );
}

function Plan({title, price, desc, onClick, loading}:{title:string; price:string; desc:string; onClick:()=>void; loading?:boolean}){
  return (
    <div className="card">
      <h3 className="text-lg font-semibold">{title}</h3>
      <div className="text-3xl mt-2">{price}<span className="text-base text-slate-500">/ea</span></div>
      <p className="text-slate-600 mt-2">{desc}</p>
      <button className="btn-primary mt-4" onClick={onClick} disabled={loading}>{loading?"Redirecting...":"Buy"}</button>
    </div>
  );
}

// ┌───────────────────────────────────────────────────────────────────────────┐
// │ 7) Stripe: checkout + webhook (entitlements)                              │
// └───────────────────────────────────────────────────────────────────────────┘
// --- file: app/api/stripe/checkout/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-06-20" });

export async function POST(req: NextRequest){
  try{
    const { priceId } = await req.json();
    const session = await stripe.checkout.sessions.create({
      mode: priceId === process.env.NEXT_PUBLIC_STRIPE_PRICE_ONE_TIME ? "payment" : "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: process.env.STRIPE_CHECKOUT_SUCCESS_URL!,
      cancel_url: process.env.STRIPE_CHECKOUT_CANCEL_URL!,
    });
    return NextResponse.json({ url: session.url });
  }catch(e:any){
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

// --- file: app/api/stripe/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest){
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET!;
  const buf = Buffer.from(await req.arrayBuffer());
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-06-20" });
  let evt: Stripe.Event;
  try{ evt = stripe.webhooks.constructEvent(buf, sig!, secret); }
  catch(e:any){ return new NextResponse(`Webhook Error: ${e.message}`, { status: 400 }); }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

  switch(evt.type){
    case "checkout.session.completed": {
      const session = evt.data.object as Stripe.Checkout.Session;
      // Map to your user using metadata or email (production: secure mapping)
      const email = session.customer_details?.email;
      if (email) {
        // Ensure entitlements record exists
        await supabase.rpc("ensure_entitlements", { p_email: email }).catch(()=>{});
        // One-time vs subscription
        if (session.mode === "payment") {
          await supabase.rpc("grant_one_time_credit", { p_email: email });
        } else {
          await supabase.rpc("set_subscribed", { p_email: email, p_value: true });
        }
      }
      break;
    }
    case "customer.subscription.deleted": {
      // Revoke subscription on cancel
      // You would look up user by Stripe customer id stored on profile
      break;
    }
  }
  return NextResponse.json({ received: true });
}

// (Optional) SQL helper functions in Supabase for RPC used above
// Add to supabase/schema.sql:
-- create or replace function ensure_entitlements(p_email text) returns void as $$
-- declare uid uuid; begin
--   select id into uid from auth.users where email = p_email limit 1;
--   if uid is not null then insert into entitlements(user_id) values (uid) on conflict (user_id) do nothing; end if;
-- end; $$ language plpgsql security definer;
-- create or replace function grant_one_time_credit(p_email text) returns void as $$
-- declare uid uuid; begin
--   select id into uid from auth.users where email = p_email limit 1;
--   if uid is not null then insert into entitlements(user_id, one_time_credits) values (uid,1)
--     on conflict (user_id) do update set one_time_credits = entitlements.one_time_credits + 1; end if;
-- end; $$ language plpgsql security definer;
-- create or replace function set_subscribed(p_email text, p_value boolean) returns void as $$
-- declare uid uuid; begin
--   select id into uid from auth.users where email = p_email limit 1;
--   if uid is not null then insert into entitlements(user_id,is_subscribed) values (uid,p_value)
--     on conflict (user_id) do update set is_subscribed = p_value; end if;
-- end; $$ language plpgsql security definer;

// ┌───────────────────────────────────────────────────────────────────────────┐
// │ 8) Simple gate: server action to check entitlement before compute         │
// └───────────────────────────────────────────────────────────────────────────┘
// --- file: app/api/compute/route.ts
import { NextRequest, NextResponse } from "next/server";
import { compute } from "@/lib/finance";

export async function POST(req: NextRequest){
  const body = await req.json();
  // TODO: validate user entitlement (subscription or credit)
  const results = compute(body);
  return NextResponse.json({ results });
}

// ┌───────────────────────────────────────────────────────────────────────────┐
// │ 9) Auth UI (Supabase magic link)                                          │
// └───────────────────────────────────────────────────────────────────────────┘
// --- file: app/auth/page.tsx
"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase-browser";

export default function Auth(){
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  async function send(){
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + "/dashboard" } });
    if (error) alert(error.message); else setSent(true);
  }
  return (
    <div className="card max-w-md mx-auto">
      <h2 className="text-xl font-semibold">Sign in</h2>
      {sent ? <p>Check your email for a magic link.</p> : (
        <>
          <label className="block text-sm mt-3">Email</label>
          <input className="input mt-1" value={email} onChange={e=>setEmail(e.target.value)} />
          <button className="btn-primary mt-4" onClick={send}>Send Magic Link</button>
        </>
      )}
    </div>
  );
}

// ┌───────────────────────────────────────────────────────────────────────────┐
// │ 10) Middleware (optional route protection skeleton)                       │
// └───────────────────────────────────────────────────────────────────────────┘
// --- file: middleware.ts
export const config = { matcher: ["/dashboard"] };
export function middleware(){ /* For full protection, integrate Supabase SSR */ }

// ┌───────────────────────────────────────────────────────────────────────────┐
// │ 11) README (setup steps)                                                  │
// └───────────────────────────────────────────────────────────────────────────┘
// --- file: README.md
# Property Analyzer SaaS

## Quickstart
1. Create a Supabase project. Run `supabase/schema.sql` in SQL editor. Enable email auth.
2. Create 2–3 Stripe Prices: monthly, annual (optional), one-time. Put IDs in `.env.local`.
3. Copy `.env.example` → `.env.local` and fill values.
4. `npm i` then `npm run dev`.
5. Visit `/auth` to sign in with a magic link. Use `/pricing` to test checkout.
6. Add a Stripe webhook endpoint to `/api/stripe/webhook` with your `STRIPE_WEBHOOK_SECRET`.
7. Deploy to Vercel. Add env vars in Vercel dashboard. Set Stripe URLs to your domain.

## Next Steps
- Replace placeholder opex with detailed expense lines from your spreadsheet.
- Implement Rent Schedule, Amortization table, Annual CF, and Waterfall modules.
- Lock `POST /api/compute` behind entitlement check (subscription or decrement credit).
- Add PDF export and Excel export using your original structure.

