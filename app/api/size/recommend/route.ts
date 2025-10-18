import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

/** ---------- Megaska size chart (INCHES) ---------- */
type Range = readonly [number, number];
type SizeRow = { label: string; bust: Range; waist: Range; hip: Range };

const SIZE_CHART: readonly SizeRow[] = [
  { label: "S",   bust: [32, 34], waist: [28, 30], hip: [34, 36] },
  { label: "M",   bust: [34, 36], waist: [30, 32], hip: [36, 38] },
  { label: "L",   bust: [36, 38], waist: [32, 34], hip: [38, 40] },
  { label: "XL",  bust: [38, 40], waist: [34, 36], hip: [40, 42] },
  { label: "XXL", bust: [40, 42], waist: [36, 38], hip: [42, 44] }
] as const;

/** ---------- utils ---------- */
const cmToIn = (n: number) => n / 2.54;
const lbToKg = (n: number) => n * 0.453592;

function sizeByHW(height_cm?: number, weight_kg?: number) {
  if (!height_cm || !weight_kg) return null;
  const bmi = weight_kg / Math.pow(height_cm / 100, 2);
  if (bmi < 21) return "S";
  if (bmi < 24) return "M";
  if (bmi < 27) return "L";
  if (bmi < 31) return "XL";
  return "XXL";
}

function pickFromChart(bustIn?: number, waistIn?: number, hipIn?: number): string | null {
  if (bustIn == null && waistIn == null && hipIn == null) return null;

  let best: { label: string; score: number; dist: number } | null = null;
  const mid = (a: number, b: number) => (a + b) / 2;
  const dist = (v: number | undefined, [lo, hi]: Range) => {
    if (v == null) return 0;
    if (v < lo) return lo - v;
    if (v > hi) return v - hi;
    return Math.abs(v - mid(lo, hi)) * 0.1; // tie-breaker
  };

  for (const s of SIZE_CHART) {
    let score = 0;
    if (bustIn  != null && bustIn  >= s.bust[0]  && bustIn  <= s.bust[1])  score++;
    if (waistIn != null && waistIn >= s.waist[0] && waistIn <= s.waist[1]) score++;
    if (hipIn   != null && hipIn   >= s.hip[0]   && hipIn   <= s.hip[1])   score++;

    const d = dist(bustIn, s.bust) + dist(waistIn, s.waist) + dist(hipIn, s.hip);
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

/** ---------- lazy Supabase (optional logging) ---------- */
let _sb: SupabaseClient | null = null;
function getSB(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) return null;
  if (!_sb) _sb = createClient(url, key);
  return _sb;
}

/** ---------- handler ---------- */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // 1) New explicit fields from our UI
    const bust_in   : number | undefined = typeof body.bust_in   === "number" ? body.bust_in   : undefined;
    const waist_in  : number | undefined = typeof body.waist_in  === "number" ? body.waist_in  : undefined;
    const hip_in    : number | undefined = typeof body.hip_in    === "number" ? body.hip_in    : undefined;
    const height_cm : number | undefined = typeof body.height_cm === "number" ? body.height_cm : undefined;
    const weight_kg : number | undefined = typeof body.weight_kg === "number" ? body.weight_kg : undefined;

    // 2) Back-compat: support older fields (bust/waist/hip, height, weight, unit)
    // If provided, auto-convert to inches/kg as needed.
    const unit = body.unit === "imperial" ? "imperial" : (body.unit === "metric" ? "metric" : undefined);
    const legacyBust   = typeof body.bust   === "number" ? body.bust   : undefined;
    const legacyWaist  = typeof body.waist  === "number" ? body.waist  : undefined;
    const legacyHip    = typeof body.hip    === "number" ? body.hip    : undefined;
    const legacyHeight = typeof body.height === "number" ? body.height : undefined;
    const legacyWeight = typeof body.weight === "number" ? body.weight : undefined;

    const finalBustIn   = (bust_in  != null) ? bust_in  : (legacyBust  != null ? (unit === "imperial" ? legacyBust  : cmToIn(legacyBust))  : undefined);
    const finalWaistIn  = (waist_in != null) ? waist_in : (legacyWaist != null ? (unit === "imperial" ? legacyWaist : cmToIn(legacyWaist)) : undefined);
    const finalHipIn    = (hip_in   != null) ? hip_in   : (legacyHip   != null ? (unit === "imperial" ? legacyHip   : cmToIn(legacyHip))   : undefined);
    const finalHeightCm = (height_cm!= null) ? height_cm: (legacyHeight!= null ? (unit === "imperial" ? Math.round(legacyHeight * 2.54) : Math.round(legacyHeight)) : undefined);
    const finalWeightKg = (weight_kg!= null) ? weight_kg: (legacyWeight!= null ? (unit === "imperial" ? lbToKg(legacyWeight) : legacyWeight) : undefined);

    // 3) Size decision
    const byChart = pickFromChart(finalBustIn, finalWaistIn, finalHipIn);
    const byHW    = sizeByHW(finalHeightCm, finalWeightKg);
    const size    = byChart || byHW || "M";

    // 4) Coverage decision & friendly notes
    const coverage = chooseCoverage(body.activity, body.modesty, !!body.tummy_control, body.style_preference);
    const notes    = fitCopy(size, coverage, { t: !!body.tummy_control, a: body.activity, m: body.modesty });

    // 5) Optional logging
    const sb = getSB();
    if (sb) {
      const { band: bra_band, cup: bra_cup } = parseBra(body.bra);
      await sb.from("size_quiz_responses").insert({
        product_handle: body.product_handle || null,
        product_title:  body.product_title  || null,
        height_cm: finalHeightCm ?? null,
        weight_kg: finalWeightKg ?? null,
        bust_cm: finalBustIn != null ? Math.round(finalBustIn * 2.54) : null,
        waist_cm: finalWaistIn != null ? Math.round(finalWaistIn * 2.54) : null,
        hip_cm: finalHipIn != null ? Math.round(finalHipIn * 2.54) : null,
        bra_band: bra_band ?? null, bra_cup: bra_cup ?? null,
        unit_system: "mixed:in+kg",
        activity: body.activity ?? null,
        modesty: body.modesty ?? null,
        tummy_control: body.tummy_control ?? null,
        style_preference: body.style_preference ?? null,
        recommended_size: size,
        recommended_style: coverage,
        fit_notes: notes
      });
    }

    return NextResponse.json({ ok: true, size, coverage, fitNotes: notes, debug: { bustIn: finalBustIn, waistIn: finalWaistIn, hipIn: finalHipIn, heightCm: finalHeightCm, weightKg: finalWeightKg } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 400 });
  }
}
