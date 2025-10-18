import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type Range = readonly [number, number];
type SizeRow = { label: string; bust: Range; waist: Range; hip: Range };

// ---- TUNE TO YOUR CHART (cm) ----
// Megaska Swimwear – brand size chart (inches)
const SIZE_CHART: readonly SizeRow[] = [
  { label: "S",   bust: [32, 34], waist: [28, 30], hip: [34, 36] },
  { label: "M",   bust: [34, 36], waist: [30, 32], hip: [36, 38] },
  { label: "L",   bust: [36, 38], waist: [32, 34], hip: [38, 40] },
  { label: "XL",  bust: [38, 40], waist: [34, 36], hip: [40, 42] },
  { label: "XXL", bust: [40, 42], waist: [36, 38], hip: [42, 44] }
] as const;

const inToCm = (i: number) => i * 2.54;

// Lazy Supabase: only create if envs exist, and only when the request runs
let _sb: SupabaseClient | null = null;
function getSB(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) return null;
  if (!_sb) _sb = createClient(url, key);
  return _sb;
}

function sizeByHW(h?: number, w?: number) {
  if (!h || !w) return null;
  const bmi = w / Math.pow(h / 100, 2);
  if (bmi < 21) return "S";
  if (bmi < 24) return "M";
  if (bmi < 27) return "L";
  if (bmi < 31) return "XL";
  return "XXL";
}

function pickFromChart(bustCm?: number, waistCm?: number, hipCm?: number): string | null {
  if (bustCm == null && waistCm == null && hipCm == null) return null;

  let best: { label: string; score: number; dist: number } | null = null;

  const mid = (a: number, b: number) => (a + b) / 2;
  const dist = (v: number | undefined, range: Range) => {
    const [lo, hi] = range;
    if (v == null) return 0;
    if (v < lo) return lo - v;
    if (v > hi) return v - hi;
    return Math.abs(v - mid(lo, hi)) * 0.1;
  };

  for (const s of SIZE_CHART) {
    let score = 0;
    if (bustCm  != null && bustCm  >= s.bust[0]  && bustCm  <= s.bust[1])  score++;
    if (waistCm != null && waistCm >= s.waist[0] && waistCm <= s.waist[1]) score++;
    if (hipCm   != null && hipCm   >= s.hip[0]   && hipCm   <= s.hip[1])   score++;

    const d = dist(bustCm, s.bust) + dist(waistCm, s.waist) + dist(hipCm, s.hip);

    if (!best || score > best.score || (score === best.score && d < best.dist)) {
      best = { label: s.label, score, dist: d };
    }
  }
  return best?.label || null;
}

function parseBra(bra?: string) {
  if (!bra) return { band: null as number | null, cup: null as string | null };
  const m = bra.replace(/\s+/g, "").toUpperCase().match(/^(\d{2})([A-Z]+)$/);
  if (!m) return { band: null, cup: null };
  return { band: parseInt(m[1], 10), cup: m[2] };
}

function chooseCoverage(activity?: string, modesty?: string, tummy?: boolean, pref?: string | null) {
  if (pref === "burkini") return "burkini";
  if (pref === "swimdress") return "knee length";
  if (pref === "rashguard") return "one-piece + rash guard";
  if (modesty === "high") return "burkini";
  if (activity === "swim_class" || activity === "aqua_fitness") {
    if (modesty === "medium") return "knee length";
    return "one-piece";
  }
  if (tummy) return "knee length";
  return "knee length";
}

function fitCopy(size: string, coverage: string, opts: { t?: boolean; a?: string; m?: string }) {
  const hints: string[] = [];
  if (opts.t) hints.push("tummy-control panels");
  if (opts.a === "swim_class") hints.push("secure shoulder coverage");
  if (opts.m === "high" || coverage === "burkini") hints.push("full coverage");
  const extra = hints.length ? ` with ${hints.join(" & ")}` : "";
  return `We suggest **${size}** in a **${coverage}** style${extra}. For close fit choose your measured size; for relaxed fit, consider one size up.`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const unit: "metric" | "imperial" = body.unit === "imperial" ? "imperial" : "metric";
// Read explicit fields first (our UI now sends these)
const bust_in   : number | undefined = body.bust_in ?? undefined;
const waist_in  : number | undefined = body.waist_in ?? undefined;
const hip_in    : number | undefined = body.hip_in ?? undefined;
const height_cm : number | undefined = body.height_cm ?? undefined;
const weight_kg : number | undefined = body.weight_kg ?? undefined;

// Back-compat: if someone still posts old fields (bust in cm/inches, weight in lb),
// try to infer sensibly.
const inch = (n:number)=>n; const cmToIn = (n:number)=> n/2.54; const lbToKg = (n:number)=> n*0.453592;

const bustIn   = bust_in  ?? (typeof body.bust  === "number" ? (body.unit==="imperial" ? inch(body.bust)  : cmToIn(body.bust))  : undefined);
const waistIn  = waist_in ?? (typeof body.waist === "number" ? (body.unit==="imperial" ? inch(body.waist) : cmToIn(body.waist)) : undefined);
const hipIn    = hip_in   ?? (typeof body.hip   === "number" ? (body.unit==="imperial" ? inch(body.hip)   : cmToIn(body.hip))   : undefined);
const heightCm = height_cm ?? (typeof body.height === "number" ? (body.unit==="imperial" ? Math.round(body.height*2.54) : Math.round(body.height)) : undefined);
const weightKg = weight_kg ?? (typeof body.weight === "number" ? (body.unit==="imperial" ? lbToKg(body.weight) : body.weight) : undefined);

// Use bustIn/waistIn/hipIn with your chart (which is in inches)
const byChart = pickFromChart(bustIn, waistIn, hipIn);
const byHW    = sizeByHW(heightCm, weightKg);


    const coverage = chooseCoverage(body.activity, body.modesty, !!body.tummy_control, body.style_preference);
    const notes = fitCopy(size, coverage, { t: !!body.tummy_control, a: body.activity, m: body.modesty });

    // Optional logging — only if envs are present
    const sb = getSB();
    if (sb) {
      await sb.from("size_quiz_responses").insert({
        product_handle: body.product_handle || null,
        product_title: body.product_title || null,
        height_cm,
        weight_kg,
        bust_cm: bust_est ?? null,
        waist_cm: waist_cm ?? null,
        hip_cm: hip_cm ?? null,
        bra_band: bra_band ?? null,
        bra_cup: bra_cup ?? null,
        unit_system: unit,
        activity: body.activity ?? null,
        modesty: body.modesty ?? null,
        tummy_control: body.tummy_control ?? null,
        style_preference: body.style_preference ?? null,
        recommended_size: size,
        recommended_style: coverage,
        fit_notes: notes
      });
    }

    return NextResponse.json({ ok: true, size, coverage, fitNotes: notes });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 400 });
  }
}
