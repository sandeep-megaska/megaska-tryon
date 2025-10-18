// app/api/size/recommend/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE! // SERVER ONLY
);

// --- TUNE THESE FOR MEGASKA ---
// Bust/Waist/Hip in CM per size (example; tweak to your charts)
const SIZE_CHART = [
  { label: "S",  bust: [ 80, 86 ],  waist: [ 64, 70 ],  hip: [ 86, 94 ]  },
  { label: "M",  bust: [ 87, 94 ],  waist: [ 71, 78 ],  hip: [ 95, 101 ] },
  { label: "L",  bust: [ 95, 101 ], waist: [ 79, 86 ],  hip: [ 102, 108 ]},
  { label: "XL", bust: [ 102,108 ], waist: [ 87, 94 ],  hip: [ 109,115 ]},
  { label: "XXL",bust: [ 109,116 ], waist: [ 95, 104 ], hip: [ 116,124 ]}
];

// Height/Weight quick heuristic (metric). Adjust as needed.
function sizeByHW(height_cm?: number, weight_kg?: number): string | null {
  if (!height_cm || !weight_kg) return null;
  const bmi = weight_kg / Math.pow(height_cm/100, 2);
  if (bmi < 21) return "S";
  if (bmi < 24) return "M";
  if (bmi < 27) return "L";
  if (bmi < 31) return "XL";
  return "XXL";
}

// Convert inches to cm
const inToCm = (inches: number) => inches * 2.54;

type BodyIn = {
  product_handle?: string;
  product_title?: string;
  unit?: "metric"|"imperial";
  height?: number;
  weight?: number;
  bust?: number;
  waist?: number;
  hip?: number;
  bra?: string; // like "36C" or "34D"
  activity?: "beach"|"swim_class"|"aqua_fitness";
  modesty?: "low"|"medium"|"high";
  tummy_control?: boolean;
  style_preference?: "swimdress"|"onepiece"|"burkini"|"rashguard"|null;
};

function parseBra(bra?: string): { band: number|null; cup: string|null } {
  if (!bra) return { band: null, cup: null };
  const m = bra.replace(/\s+/g,"").toUpperCase().match(/^(\d{2})([A-Z]+)$/);
  if (!m) return { band: null, cup: null };
  return { band: parseInt(m[1], 10), cup: m[2] };
}

function pickFromChart(bust_cm?: number, waist_cm?: number, hip_cm?: number): string | null {
  if (!bust_cm && !waist_cm && !hip_cm) return null;
  // score each size by how many measurements fall within range; tie-breaker by closeness to midpoints
  let best: {label:string; score:number; dist:number} | null = null;
  for (const s of SIZE_CHART) {
    let score = 0;
    let dist = 0;

    const mid = (a:number,b:number)=> (a+b)/2;
    const clampDist = (val:number|undefined, lo:number, hi:number) => {
      if (val==null) return 0;
      if (val < lo) return lo - val;
      if (val > hi) return val - hi;
      return Math.abs(val - mid(lo,hi))*0.1; // small penalty inside range to help tie-break
    };

    if (bust_cm != null && bust_cm >= s.bust[0] && bust_cm <= s.bust[1]) score++;
    if (waist_cm!= null && waist_cm>= s.waist[0] && waist_cm<= s.waist[1]) score++;
    if (hip_cm  != null && hip_cm  >= s.hip[0]   && hip_cm  <= s.hip[1]) score++;

    dist += clampDist(bust_cm, s.bust[0], s.bust[1]);
    dist += clampDist(waist_cm, s.waist[0], s.waist[1]);
    dist += clampDist(hip_cm, s.hip[0], s.hip[1]);

    const cand = { label: s.label, score, dist };
    if (!best || cand.score > best.score || (cand.score === best.score && cand.dist < best.dist)) {
      best = cand;
    }
  }
  return best?.label || null;
}

function chooseCoverage(activity?: string, modesty?: string, tummy?: boolean, pref?: string|null): string {
  // preference overrides
  if (pref === "burkini") return "burkini";
  if (pref === "swimdress") return "knee length"; // your swimdress is knee-length
  if (pref === "rashguard") return "one-piece + rash guard";

  // rules
  if (modesty === "high") return "burkini";
  if (activity === "swim_class" || activity === "aqua_fitness") {
    if (modesty === "medium") return "knee length";
    return "one-piece";
  }
  if (tummy) return "knee length";
  // default
  return "knee length";
}

function fitCopy(size: string, coverage: string, inputs: Partial<BodyIn>): string {
  const hints: string[] = [];
  if (inputs.tummy_control) hints.push("tummy-control panels");
  if (inputs.activity === "swim_class") hints.push("secure shoulder coverage");
  if (inputs.modesty === "high" || coverage === "burkini") hints.push("full coverage");
  const bullet = hints.length ? ` with ${hints.join(" & ")}` : "";
  return `We suggest **${size}** in a **${coverage}** style${bullet}. For close fit, choose your measured size; for relaxed fit, consider one size up.`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as BodyIn;

    const unit = (body.unit || "metric");
    const height_cm = body.height ? (unit==="imperial" ? Math.round(inToCm(body.height)) : Math.round(body.height)) : undefined;
    const weight_kg = body.weight ? (unit==="imperial" ? Math.round(body.weight * 0.453592) : Math.round(body.weight)) : undefined;

    const bust_cm  = body.bust  ? (unit==="imperial" ? inToCm(body.bust)  : body.bust)  : undefined;
    const waist_cm = body.waist ? (unit==="imperial" ? inToCm(body.waist) : body.waist) : undefined;
    const hip_cm   = body.hip   ? (unit==="imperial" ? inToCm(body.hip)   : body.hip)   : undefined;

    const { band: bra_band, cup: bra_cup } = parseBra(body.bra);

    // If only bra given, approximate bust_cm (band + cup increment)
    let bust_est = bust_cm;
    if (!bust_est && bra_band && bra_cup) {
      const cupMap: Record<string, number> = { A:2.5, B:5, C:7.5, D:10, DD:12.5, E:12.5, F:15 };
      // band in inches → convert to cm
      const band_cm = bra_band * 2.54;
      const cupAdd  = (cupMap[bra_cup] || 7.5) * 2.54; // default ~C
      bust_est = band_cm + cupAdd;
    }

    const byChart = pickFromChart(bust_est, waist_cm, hip_cm);
    const byHW    = sizeByHW(height_cm, weight_kg);
    const size = byChart || byHW || "M";

    const coverage = chooseCoverage(body.activity, body.modesty, !!body.tummy_control, body.style_preference);
    const notes = fitCopy(size, coverage, body);

    // Log to Supabase (server-side)
    await supabase.from("size_quiz_responses").insert({
      product_handle: body.product_handle || null,
      product_title: body.product_title || null,
      height_cm, weight_kg,
      bust_cm: bust_est ?? null, waist_cm: waist_cm ?? null, hip_cm: hip_cm ?? null,
      bra_band: bra_band ?? null, bra_cup: bra_cup ?? null,
      unit_system: unit,
      activity: body.activity ?? null,
      modesty: body.modesty ?? null,
      tummy_control: body.tummy_control ?? null,
      style_preference: body.style_preference ?? null,
      recommended_size: size,
      recommended_style: coverage,
      fit_notes: notes
    });

    return NextResponse.json({ ok: true, size, coverage, fitNotes: notes });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: String(e?.message || e) }, { status: 400 });
  }
}
