import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE!
);

type Range = readonly [number, number];

type SizeRow = {
  label: string;
  bust: Range;
  waist: Range;
  hip: Range;
};

// ---- TUNE TO YOUR CHART (cm) ----
const SIZE_CHART: SizeRow[] = [
  { label: "S",   bust: [80, 86],  waist: [64, 70],  hip: [86, 94]   },
  { label: "M",   bust: [87, 94],  waist: [71, 78],  hip: [95, 101]  },
  { label: "L",   bust: [95, 101], waist: [79, 86],  hip: [102, 108] },
  { label: "XL",  bust: [102,108], waist: [87, 94],  hip: [109, 115] },
  { label: "XXL", bust: [109,116], waist: [95, 104], hip: [116, 124] }
] as const;

const inToCm = (i: number) => i * 2.54;

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
    return Math.abs(v - mid(lo, hi)) * 0.1; // small tie-breaker
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

function chooseCoverage(
  activity?: string,
  modesty?: string,
  tummy?: boolean,
  pref?: string | null
) {
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

    const height_cm = body.height ? (unit === "imperial" ? Math.round(inToCm(body.height)) : Math.round(body.height)) : undefined;
    const weight_kg = body.weight ? (unit === "imperial" ? Math.round(body.weight * 0.453592) : Math.round(body.weight)) : undefined;

    const bust_cm  = body.bust  ? (unit === "imperial" ? inToCm(body.bust)  : body.bust)  : undefined;
    const waist_cm = body.waist ? (unit === "imperial" ? inToCm(body.waist) : body.waist) : undefined;
    const hip_cm   = body.hip   ? (unit === "imperial" ? inToCm(body.hip)   : body.hip)   : undefined;

    const { band: bra_band, cup: bra_cup } = parseBra(body.bra);

    let bust_est = bust_cm;
    if (!bust_est && bra_band && bra_cup) {
      const cupMap: Record<string, number> = { A: 2.5, B: 5, C: 7.5, D: 10, DD: 12.5, E: 12.5, F: 15 };
      bust_est = bra_band * 2.54 + (cupMap[bra_cup] || 7.5) * 2.54;
    }

    const byChart = pickFromChart(bust_est, waist_cm, hip_cm);
    const byHW = sizeByHW(height_cm, weight_kg);
    const size = byChart || byHW || "M";

    const coverage = chooseCoverage(body.activity, body.modesty, !!body.tummy_control, body.style_preference);
    const notes = fitCopy(size, coverage, { t: !!body.tummy_control, a: body.activity, m: body.modesty });

    // Optional logging (only if envs are set)
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE) {
      await supabase.from("size_quiz_responses").insert({
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
