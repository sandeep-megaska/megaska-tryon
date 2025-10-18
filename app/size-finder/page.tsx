"use client";
import { useState } from "react";

export default function SizeFinder() {
  // Inputs: inches for B/W/H, cm for height, kg for weight
  const [bustIn, setBustIn] = useState("");
  const [waistIn, setWaistIn] = useState("");
  const [hipIn, setHipIn] = useState("");
  const [bra, setBra] = useState(""); // e.g., 36C (optional)
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");

  const [activity, setActivity] = useState<"beach"|"swim_class"|"aqua_fitness"|"">("");
  const [modesty, setModesty] = useState<"low"|"medium"|"high"|"">("");
  const [tummy, setTummy] = useState(false);
  const [style, setStyle] = useState<"swimdress"|"onepiece"|"burkini"|"rashguard"|"">("");

  const [res, setRes] = useState<{size:string; coverage:string; fitNotes:string}|null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string|null>(null);

  async function submit() {
    try {
      setBusy(true); setErr(null); setRes(null);
      const qs = new URLSearchParams(location.search);
      const body = {
        // explicit fields the API understands
        bust_in:   bustIn ? Number(bustIn) : undefined,
        waist_in:  waistIn ? Number(waistIn) : undefined,
        hip_in:    hipIn ? Number(hipIn) : undefined,
        height_cm: heightCm ? Number(heightCm) : undefined,
        weight_kg: weightKg ? Number(weightKg) : undefined,
        bra: bra || undefined,

        activity: activity || undefined,
        modesty:  modesty || undefined,
        tummy_control: tummy || undefined,
        style_preference: style || undefined,

        product_handle: qs.get("handle") || undefined,
        product_title:  qs.get("title")  || undefined
      };

      const r = await fetch("/api/size/recommend", {
        method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body)
      });
      const data = await r.json();
      if(!r.ok || !data?.ok) throw new Error(data?.error || "Failed");
      setRes({ size: data.size, coverage: data.coverage, fitNotes: data.fitNotes });
    } catch(e:any){ setErr(e?.message || "Something went wrong"); }
    finally{ setBusy(false); }
  }

  function applyOnShopify(){ if(res?.size) window.top?.postMessage({type:"APPLY_SIZE", size:res.size},"*"); }

  return (
    <main style={{maxWidth:560,margin:"0 auto",padding:16,fontFamily:"system-ui,-apple-system,Segoe UI,Roboto"}}>
      <h1 style={{marginTop:0}}>Find your size & coverage</h1>
      <p style={{margin:"4px 0 12px",opacity:.75,fontSize:13}}>
        Measurements in <b>inches</b>; weight in <b>kg</b>. Height is optional (cm).
      </p>

      <Section title="Measurements">
        <Row label="Bust (in)"  value={bustIn}  set={setBustIn}/>
        <Row label="Waist (in)" value={waistIn} set={setWaistIn}/>
        <Row label="Hips (in)"  value={hipIn}   set={setHipIn}/>
        <Row label="Or Bra (e.g., 36C)" value={bra} set={setBra}/>
      </Section>

      <Section title="Basics (optional)">
        <Row label="Height (cm)" value={heightCm} set={setHeightCm}/>
        <Row label="Weight (kg)" value={weightKg} set={setWeightKg}/>
      </Section>

      <Section title="Usage & preference">
        <SelectRow label="Activity" value={activity} set={setActivity}
          opts={[["","Select…"],["beach","Beach"],["swim_class","Swim class"],["aqua_fitness","Aqua fitness"]]} />
        <SelectRow label="Modesty" value={modesty} set={setModesty}
          opts={[["","Select…"],["low","Low"],["medium","Medium"],["high","High"]]} />
        <CheckboxRow label="Prefer tummy control" checked={tummy} set={setTummy}/>
        <SelectRow label="Style preference" value={style} set={setStyle}
          opts={[["","No preference"],["swimdress","Swimdress"],["onepiece","One-piece"],["burkini","Burkini"],["rashguard","Rash guard"]]} />
      </Section>

      <div style={{display:"flex",gap:8,marginTop:10}}>
        <button onClick={submit} disabled={busy} style={btnPrimary}>{busy?"Calculating…":"Get recommendation"}</button>
        <button onClick={()=>window.top?.postMessage({type:"CLOSE_SIZE"},"*")} style={btnLight}>Close</button>
      </div>

      {err && <p style={{marginTop:10,color:"crimson"}}>{err}</p>}

      {res && (
        <div style={{marginTop:16,border:"1px solid #eee",borderRadius:12,padding:12}}>
          <p><strong>Recommended size:</strong> {res.size}</p>
          <p><strong>Recommended coverage:</strong> {res.coverage}</p>
          <p dangerouslySetInnerHTML={{__html: res.fitNotes.replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>")}}/>
          <div style={{display:"flex",gap:8,marginTop:8}}>
            <button onClick={applyOnShopify} style={btnPrimary}>Apply size on product</button>
            <button onClick={()=>window.top?.postMessage({type:"CLOSE_SIZE"},"*")} style={btnLight}>Done</button>
          </div>
          <p style={{fontSize:12,opacity:.7,marginTop:8}}>We never upload your data; anonymous stats only.</p>
        </div>
      )}
    </main>
  );
}

function Section({title, children}:{title:string; children:any}) {
  return <section style={{border:"1px solid #eee",borderRadius:12,padding:12,margin:"10px 0"}}>
    <h3 style={{margin:"0 0 8px",fontSize:16}}>{title}</h3>{children}
  </section>;
}
function Row({label,value,set}:{label:string;value:string;set:(v:string)=>void}) {
  return <label style={{display:"grid",gridTemplateColumns:"1fr 140px",gap:8,alignItems:"center",padding:"6px 0"}}>
    <span style={{fontSize:13,opacity:.8}}>{label}</span>
    <input value={value} onChange={e=>set(e.target.value)} inputMode="decimal" style={field}/>
  </label>;
}
function SelectRow({label,value,set,opts}:{label:string;value:string;set:(v:any)=>void;opts:[string,string][]}) {
  return <label style={{display:"grid",gridTemplateColumns:"1fr 140px",gap:8,alignItems:"center",padding:"6px 0"}}>
    <span style={{fontSize:13,opacity:.8}}>{label}</span>
    <select value={value} onChange={e=>set(e.target.value)} style={field}>
      {opts.map(([v,t])=><option key={v} value={v}>{t}</option>)}
    </select>
  </label>;
}
function CheckboxRow({label,checked,set}:{label:string;checked:boolean;set:(v:boolean)=>void}) {
  return <label style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0"}}>
    <input type="checkbox" checked={checked} onChange={e=>set(e.target.checked)}/>
    <span style={{fontSize:13,opacity:.8}}>{label}</span>
  </label>;
}

const field: React.CSSProperties = { border:"1px solid #ddd", borderRadius:8, padding:"8px 10px" };
const btnPrimary: React.CSSProperties = { background:"#111", color:"#fff", border:"1px solid #111", borderRadius:10, padding:"8px 12px", cursor:"pointer" };
const btnLight: React.CSSProperties = { background:"#fff", color:"#111", border:"1px solid #ddd", borderRadius:10, padding:"8px 12px", cursor:"pointer" };
