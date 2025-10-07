import React, { useMemo, useState, useDeferredValue, useEffect } from "react";

// LIVE DEMO — Multi-Unit + Sq Ft + Rent Mode ($/mo or $/SF/Mo)
// Smooth typing in ALL inputs • No spinner arrows • Right-aligned numbers

// ───────────────────────── Helpers ─────────────────────────
const toNum = (x) => {
  if (x === null || x === undefined) return 0;
  const s = String(x).trim();
  if (s === "") return 0;
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function pmntAPR(principal, aprPct, nMonths){
  const r = aprPct/100/12; if (!(principal>0) || !(r>0) || !(nMonths>0)) return 0;
  return (principal*r)/(1-Math.pow(1+r,-nMonths));
}
function amortSchedule(principal, aprPct, termMonths, horizonMonths){
  const pmt = pmntAPR(principal, aprPct, termMonths);
  const r = aprPct/100/12; let bal = principal;
  const balance=[];
  for(let m=1;m<=horizonMonths;m++){
    const i = bal*r; const pr = Math.max(0, pmt - i); bal = Math.max(0, bal - pr); balance.push(bal);
  }
  return { payment: pmt, finalBalance: balance[balance.length-1] ?? principal };
}
function irrMonthly(cf){
  try{
    if (!Array.isArray(cf) || cf.length < 2) return null;
    const min = Math.min(...cf), max = Math.max(...cf);
    if (!(min < 0 && max > 0)) return null;
    let x = 0.01; const tol = 1e-7;
    for(let k=0;k<100;k++){
      let f=0, df=0; 
      for(let t=0;t<cf.length;t++){ const d=Math.pow(1+x,t); f+=cf[t]/d; df+=(-t*cf[t])/Math.pow(1+x,t+1); }
      if (Math.abs(df) < 1e-12) break;
      const x1 = x - f/df; if(!isFinite(x1)) break; if(Math.abs(x1-x)<tol){ x=x1; return (Math.pow(1+x,12)-1)*100; } x=x1;
    }
    let lo=-0.99, hi=1.0; const npv=(r)=> cf.reduce((acc,v,i)=> acc + v/Math.pow(1+r,i),0);
    let fLo=npv(lo), fHi=npv(hi); if (!isFinite(fLo)||!isFinite(fHi)) return null; if (fLo*fHi>0) return null;
    for(let i=0;i<200;i++){
      const mid=(lo+hi)/2, fMid=npv(mid);
      if (Math.abs(fMid) < 1e-10){ x=mid; break; }
      if (fLo*fMid<=0){ hi=mid; fHi=fMid; } else { lo=mid; fLo=fMid; }
      if (Math.abs(hi-lo) < 1e-7){ x=(lo+hi)/2; break; }
    }
    return (Math.pow(1+x,12)-1)*100;
  }catch{ return null; }
}

// Interpret a unit's monthly rent based on mode and sqft
function unitMonthlyRent(u){
  const sqft = toNum(u.sqft); const rate = toNum(u.rate); const mode = u.rentMode||"monthly";
  if (mode === "psf") return rate * sqft; // $/SF/Mo * SqFt
  return rate; // $/mo
}

function compute(inputs){
  const units = Array.isArray(inputs.units)? inputs.units : [];
  const baseRent = units.reduce((a,u)=> a + unitMonthlyRent(u), 0);
  const baseMisc = units.reduce((a,u)=> a + (toNum(u.misc)||0), 0);

  const rentGrowth = toNum(inputs.rentGrowthAnnualPct ?? 3)/100;
  const expenseInfl = toNum(inputs.expenseInflationAnnualPct ?? 2.5)/100;
  const otherOpsPct = toNum(inputs.otherOpsPctOfRent ?? 30)/100;
  const sellingPct = toNum(inputs.sellingCostsPct ?? 6)/100;

  const totalCost = toNum(inputs.purchasePrice) + toNum(inputs.closingCosts) + toNum(inputs.loanCosts) + toNum(inputs.rehab) + toNum(inputs.miscCosts);
  const loanAmount = toNum(inputs.loanPct)/100 * toNum(inputs.purchasePrice);
  const termMonths = Math.max(1, toNum(inputs.amortYears)*12);
  const horizonMonths = Math.max(1, toNum(inputs.holdYears)*12);
  const amort = amortSchedule(loanAmount, toNum(inputs.interestRatePct), termMonths, horizonMonths);
  const monthlyPmt = amort.payment||0;

  const vacancy = toNum(inputs.vacancyPct)/100; const cfs=[-(totalCost - loanAmount)];
  let last12NOI=[]; let seriesCF=[]; 
  let monthlyNOI=0, monthlyCFAfterDebt=0;
  for(let m=1;m<=horizonMonths;m++){
    const t = (m-1)/12;
    const rent = baseRent*Math.pow(1+rentGrowth,t);
    const misc = baseMisc*Math.pow(1+rentGrowth,t);
    const collected = (rent+misc)*(1-vacancy);
    const pm = toNum(inputs.propMgmtPct)/100*collected;
    const other = otherOpsPct*baseRent*Math.pow(1+expenseInfl,t);
    const noi = Math.max(0, collected - pm - other);
    const cf = noi - monthlyPmt; cfs.push(cf); seriesCF.push(cf);
    monthlyNOI = noi; monthlyCFAfterDebt = cf;
    last12NOI.push(noi); if (last12NOI.length>12) last12NOI.shift();
  }
  const stabilizedNOI = last12NOI.reduce((a,b)=>a+b,0);
  const exitCap = toNum(inputs.exitCapPct)/100;
  const salePrice = exitCap>0 ? stabilizedNOI/exitCap : 0;
  const sellingCosts = sellingPct*salePrice; const payoff = amort.finalBalance||0;
  const netProceeds = Math.max(0, salePrice - sellingCosts - payoff);
  cfs[cfs.length-1] = (cfs[cfs.length-1]||0) + netProceeds;

  const irrPct = irrMonthly(cfs);
  const annualizedCF = monthlyCFAfterDebt*12;
  const initialEquity = Math.max(0, totalCost - loanAmount);
  const coc = initialEquity>0 ? (annualizedCF/initialEquity)*100 : 0;
  const yieldPct = totalCost>0 ? (stabilizedNOI/totalCost)*100 : 0;
  const eqMult = initialEquity>0 ? (cfs.reduce((a,b)=>a+b,0)/-cfs[0]) : 0;

  return { totalCost, loanAmount, monthlyPmt, monthlyNOI, monthlyCFAfterDebt, annualizedCF, initialEquity, coc, yieldPct, eqMult, irrPct, netProceeds, payoff, seriesCF, baseRent, baseMisc };
}

// ───────────────────────── UI helpers ─────────────────────────
const isNum = (v)=> typeof v==="number" && isFinite(v);
const fmt$ = (v)=> isNum(v)? `$${Number(v).toLocaleString(undefined,{maximumFractionDigits:0})}` : "–";
const fmtPct = (v)=> isNum(v)? `${Number(v).toFixed(2)}%` : "–";

function Badge({ children, tone="indigo" }){
  const map = {
    indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    rose: "bg-rose-50 text-rose-700 border-rose-200",
    slate: "bg-slate-50 text-slate-700 border-slate-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${map[tone]}`}>{children}</span>;
}

function Bars({ data }){
  const arr = Array.isArray(data)? data : [];
  const width=380, height=120; const denom = Math.max(1, ...arr.map(v=>Math.abs(v)));
  const n = Math.max(1, arr.length); const barW = Math.max(2, Math.floor(width/n));
  return (
    <svg width={width} height={height} className="rounded-xl">
      <defs>
        <linearGradient id="pos" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0.2" />
        </linearGradient>
        <linearGradient id="neg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.2" />
        </linearGradient>
      </defs>
      <line x1={0} y1={height/2} x2={width} y2={height/2} stroke="#cbd5e1" strokeWidth={1} />
      {arr.map((v,i)=>{
        const x=i*barW; const mid=height/2; const h=Math.min(height/2-4, Math.round((Math.abs(v)/denom)*(height/2-6)));
        const y=v>=0? mid-h : mid; const fill = v>=0? "url(#pos)":"url(#neg)";
        return <rect key={i} x={x+1} y={y} width={barW-2} height={h} rx={2} ry={2} fill={fill} />
      })}
    </svg>
  );
}

function Section({ title, emoji, children, tone="slate" }){
  const tones = {
    indigo: "from-indigo-500/10 to-transparent",
    emerald: "from-emerald-500/10 to-transparent",
    rose: "from-rose-500/10 to-transparent",
    slate: "from-slate-500/10 to-transparent",
    amber: "from-amber-500/10 to-transparent",
  };
  return (
    <div className="p-4 rounded-2xl border bg-white shadow">
      <div className={`rounded-xl p-3 mb-3 bg-gradient-to-r ${tones[tone]}`}>
        <div className="flex items-center gap-2">
          <span className="text-lg">{emoji}</span>
          <h3 className="font-semibold">{title}</h3>
        </div>
      </div>
      {children}
    </div>
  );
}

function GlobalStyles(){
  return (
    <style>{`
      /* Hide number input arrows */
      input[type=number]::-webkit-inner-spin-button,
      input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
      input[type=number] { -moz-appearance: textfield; }
      /* Right align numeric inputs */
      input[type=number], input[data-align="right"] { text-align: right; }
    `}</style>
  );
}

// Units editor (with sqft + rent mode)
function UnitsEditor({ units, setUnits }){
  function update(i, key, value){
    const next = units.map((u,idx)=> idx===i? { ...u, [key]: value }: u);
    setUnits(next);
  }
  function add(){ setUnits([ ...units, { name: `Unit ${units.length+1}`, sqft: "", rentMode: "monthly", rate: "", misc: "" } ]); }
  function remove(i){ setUnits(units.filter((_,idx)=> idx!==i)); }

  const totalRent = units.reduce((a,u)=> a + unitMonthlyRent(u), 0);
  const totalMisc = units.reduce((a,u)=> a + (toNum(u.misc)||0), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-slate-600">Units: {units.length}</div>
        <button className="px-3 py-1 rounded-xl bg-indigo-600 text-white text-sm" onClick={add}>Add Unit</button>
      </div>
      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left py-2 pr-3">Name</th>
              <th className="text-right py-2 pr-3">Sq Ft</th>
              <th className="text-left py-2 pr-3">Rent Mode</th>
              <th className="text-right py-2 pr-3">Rate</th>
              <th className="text-right py-2 pr-3">Computed $/mo</th>
              <th className="text-right py-2 pr-3">Misc (mo)</th>
              <th className="py-2"> </th>
            </tr>
          </thead>
          <tbody>
            {units.map((u,i)=> {
              const monthly = unitMonthlyRent(u);
              return (
                <tr key={i} className="border-t">
                  <td className="py-2 pr-3"><input className="w-full rounded-lg border px-2 py-1" value={u.name} onChange={e=>update(i,'name',e.target.value)} /></td>
                  <td className="py-2 pr-3 text-right"><input type="number" data-align="right" className="w-24 rounded-lg border px-2 py-1 text-right" value={u.sqft ?? ''} onChange={e=>update(i,'sqft',e.target.value)} /></td>
                  <td className="py-2 pr-3">
                    <select className="rounded-lg border px-2 py-1" value={u.rentMode||'monthly'} onChange={e=>update(i,'rentMode',e.target.value)}>
                      <option value="monthly">$ / month</option>
                      <option value="psf">$ / SF / Mo</option>
                    </select>
                  </td>
                  <td className="py-2 pr-3 text-right"><input type="number" data-align="right" className="w-28 rounded-lg border px-2 py-1 text-right" value={u.rate ?? ''} onChange={e=>update(i,'rate',e.target.value)} /></td>
                  <td className="py-2 pr-3 text-right">{fmt$(monthly)}</td>
                  <td className="py-2 pr-3 text-right"><input type="number" data-align="right" className="w-28 rounded-lg border px-2 py-1 text-right" value={u.misc ?? ''} onChange={e=>update(i,'misc',e.target.value)} /></td>
                  <td className="py-2 text-center"><button className="px-2 py-1 text-rose-600" onClick={()=>remove(i)}>Remove</button></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t font-medium">
              <td className="py-2 pr-3 text-right">Totals</td>
              <td></td>
              <td></td>
              <td className="py-2 pr-3 text-right"></td>
              <td className="py-2 pr-3 text-right">{fmt$(totalRent)}</td>
              <td className="py-2 pr-3 text-right">{fmt$(totalMisc)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="text-xs text-slate-500 mt-2">Tip: In $/SF/Mo mode, set Sq Ft and a rate like <code>1.85</code> to compute monthly rent.</div>
    </div>
  );
}

const Metric = React.memo(function Metric({label, value, kind, tone}){
  return (
    <div className="rounded-2xl p-4 border shadow bg-white">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-500">{label}</span>
        <Badge tone={tone||"slate"}>{kind==="money"? fmt$(value) : kind==="pct"? fmtPct(value) : (isNum(value)? value.toFixed(2): String(value))}</Badge>
      </div>
      <div className={`text-2xl font-semibold mt-1 ${label.includes("Cash Flow")? (isNum(value)&&value<0?"text-rose-600":"text-emerald-600"):"text-slate-800"}`}>
        {kind==="money"? fmt$(value) : kind==="pct"? fmtPct(value) : (isNum(value)? value.toFixed(2): String(value))}
      </div>
    </div>
  );
});

export default function LiveDemo(){
  const [name, setName] = useState("Demo Analysis");
  const [form, setForm] = useState({
    purchasePrice: "460000", closingCosts: "7500", loanCosts: "3500", rehab: "40241", miscCosts: "0",
    loanPct: "75", interestRatePct: "6.25", amortYears: "30",
    vacancyPct: "7", propMgmtPct: "10",
    holdYears: "5", exitCapPct: "6.5", rentGrowthAnnualPct: "3", expenseInflationAnnualPct: "2.5", otherOpsPctOfRent: "30", sellingCostsPct: "6"
  });
  const [units, setUnits] = useState([
    { name: "Unit 1", sqft: "800", rentMode: "monthly", rate: "1200", misc: "15" },
    { name: "Unit 2", sqft: "820", rentMode: "monthly", rate: "1200", misc: "15" },
    { name: "Unit 3", sqft: "780", rentMode: "psf", rate: "1.6", misc: "15" },
    { name: "Unit 4", sqft: "900", rentMode: "psf", rate: "1.55", misc: "15" }
  ]);

  const computeInputs = useMemo(()=> ({...(form), units}), [form, units]);
  const deferredInputs = useDeferredValue(computeInputs);
  const r = useMemo(()=> compute(deferredInputs), [deferredInputs]);

  const Field = ({k,label,suffix,step=1}) => {
    const parentVal = form[k] ?? '';
    const [text, setText] = useState(parentVal);
    useEffect(() => { if (parentVal !== text) setText(parentVal); }, [parentVal]);
    return (
      <label className="block mb-3">
        <div className="flex items-center justify-between">
          <span className="block text-sm text-slate-600">{label}</span>
        </div>
        <input
          type="number"
          data-align="right"
          step={step}
          className="mt-1 w-full rounded-xl border px-3 py-2 focus:ring-2 focus:ring-indigo-500 text-right"
          value={text}
          onChange={e=> { const v = e.target.value; setText(v); setForm(prev=>({...prev, [k]: v})); }}
        />
        {suffix && <div className="text-xs text-slate-400 mt-1">{suffix}</div>}
      </label>
    );
  };

  return (
    <div className="min-h-screen p-6 bg-gradient-to-b from-slate-50 to-slate-100">
      <GlobalStyles />
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Property Analyzer — Live Demo (Multi-Unit, $/SF)</h1>
            <p className="text-slate-600">Per-unit sqft • $/mo or $/SF/Mo • Global vacancy/PM</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="indigo">Demo</Badge>
            <Badge tone="emerald">Interactive</Badge>
            <Badge tone="amber">Multi-Unit</Badge>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <section className="lg:col-span-2 space-y-4">
            <Section title="Basics" emoji="🧱" tone="indigo">
              <label className="block text-sm">Analysis Name</label>
              <input className="mt-1 w-full rounded-xl border px-3 py-2 focus:ring-2 focus:ring-indigo-500" value={name} onChange={e=>setName(e.target.value)} />
            </Section>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Section title="Purchase" emoji="🏠" tone="slate">
                <Field k="purchasePrice" label="Purchase Price" />
                <Field k="closingCosts" label="Closing Costs" />
                <Field k="loanCosts" label="Loan Costs" />
                <Field k="rehab" label="Rehab / Op Deficit" />
                <Field k="miscCosts" label="Misc Costs" />
              </Section>

              <Section title="Financing" emoji="💳" tone="amber">
                <Field k="loanPct" label="Loan %" />
                <Field k="interestRatePct" label="Interest Rate %" step={0.01} />
                <Field k="amortYears" label="Amortization (yrs)" />
              </Section>

              <Section title="Units & Rents" emoji="🏢" tone="emerald">
                <UnitsEditor units={units} setUnits={setUnits} />
              </Section>

              <Section title="Global Ops" emoji="⚙️" tone="rose">
                <Field k="vacancyPct" label="Vacancy %" step={0.1} />
                <Field k="propMgmtPct" label="Property Mgmt %" step={0.1} />
                <Field k="rentGrowthAnnualPct" label="Rent Growth % (annual)" step={0.01} />
                <Field k="expenseInflationAnnualPct" label="Expense Inflation % (annual)" step={0.01} />
                <Field k="otherOpsPctOfRent" label="Other Opex % of Base Rent" step={0.1} />
                <Field k="sellingCostsPct" label="Selling Costs %" step={0.1} />
              </Section>
            </div>
          </section>

          <aside className="space-y-4">
            <Section title="Key Results" emoji="🎯" tone="emerald">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Metric label="Total Project Cost" value={r.totalCost} kind="money" />
                <Metric label="Loan Amount" value={r.loanAmount} kind="money" />
                <Metric label="Monthly Mortgage" value={r.monthlyPmt} kind="money" tone="slate" />
                <Metric label="Monthly NOI" value={r.monthlyNOI} kind="money" tone="emerald" />
                <Metric label="Monthly Cash Flow" value={r.monthlyCFAfterDebt} kind="money" tone={isNum(r.monthlyCFAfterDebt)&&r.monthlyCFAfterDebt<0?"rose":"emerald"} />
                <Metric label="Annualized Cash Flow" value={r.annualizedCF} kind="money" />
                <Metric label="Cash-on-Cash" value={r.coc} kind="pct" />
                <Metric label="Stabilized Yield" value={r.yieldPct} kind="pct" />
                <Metric label="Equity Multiple (est)" value={r.eqMult} />
                <Metric label="Levered IRR (est)" value={r.irrPct} kind="pct" />
                <Metric label="Sale Proceeds (net)" value={r.netProceeds} kind="money" />
                <Metric label="Loan Payoff at Exit" value={r.payoff} kind="money" />
              </div>
              <div className="mt-3 text-sm text-slate-600 flex items-center gap-2">
                <Badge tone="slate">Base Rent/mo: {fmt$(r.baseRent)}</Badge>
                <Badge tone="slate">Misc/mo: {fmt$(r.baseMisc)}</Badge>
              </div>
            </Section>

            <Section title="Cash Flow (First 60 Months)" emoji="📊" tone="indigo">
              <Bars data={Array.isArray(r.seriesCF)? r.seriesCF.slice(0,60): []} />
              <div className="text-xs text-slate-500 mt-1">Above axis = positive CF • Below axis = negative CF</div>
            </Section>
          </aside>
        </div>

        <footer className="mt-8 text-xs text-slate-500">
          Multi-unit model with sqft-aware rent: pick $/month or $/SF/Mo per unit; we compute monthly rent and aggregate.
        </footer>
      </div>
    </div>
  );
}
