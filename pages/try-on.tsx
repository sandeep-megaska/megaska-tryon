// pages/try-on.tsx
import { useEffect, useMemo, useRef, useState } from "react";

const TASKS_VISION_VERSION = "0.10.10";
const TASKS_VISION_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}`;

export default function TryOnPage() {
  // read URL params on client
  const [overlayUrl, setOverlayUrl] = useState<string>("");
  const [title, setTitle] = useState<string>("Try it on (Beta)");
  const [mirror, setMirror] = useState<boolean>(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    setOverlayUrl(sp.get("overlay") || "");
    setTitle(sp.get("title") || "Try it on (Beta)");
    setMirror((sp.get("mirror") ?? "1") !== "0");
  }, []);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [garmentLoaded, setGarmentLoaded] = useState(false);

  const [scale, setScale] = useState<number>(() => parseFloat((typeof window !== "undefined" && localStorage.getItem("vto_scale")) || "0.65"));
  const [offsetX, setOffsetX] = useState<number>(() => parseFloat((typeof window !== "undefined" && localStorage.getItem("vto_offx")) || "0"));
  const [offsetY, setOffsetY] = useState<number>(() => parseFloat((typeof window !== "undefined" && localStorage.getItem("vto_offy")) || "0.18"));
  const [rotation, setRotation] = useState<number>(() => parseFloat((typeof window !== "undefined" && localStorage.getItem("vto_rot")) || "0"));

  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("vto_scale", String(scale)); }, [scale]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("vto_offx", String(offsetX)); }, [offsetX]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("vto_offy", String(offsetY)); }, [offsetY]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("vto_rot", String(rotation)); }, [rotation]);

  const garmentImg = useMemo(() => {
    const img = new Image();
    if (overlayUrl) img.src = overlayUrl;
    img.onload = () => setGarmentLoaded(true);
    img.onerror = () => setError("Couldn’t load overlay image");
    return img;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayUrl]);

  useEffect(() => {
    let stopped = false;
    let segmenter: any = null;

    async function init() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        // Optional segmentation (kept loaded but not used; safe to remove)
        // @ts-ignore
        const { ImageSegmenter, FilesetResolver } = await import(/* webpackIgnore: true */ `${TASKS_VISION_BASE}`);
        const vision = await (FilesetResolver as any).forVisionTasks(`${TASKS_VISION_BASE}/wasm`);
        segmenter = await (ImageSegmenter as any).createFromOptions(vision, {
          baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float32/1/selfie_segmenter.tflite" },
          outputCategoryMask: true,
        });

        setReady(true);

        const ctx = canvasRef.current?.getContext("2d", { willReadFrequently: true });
        if (!ctx || !canvasRef.current || !videoRef.current) return;

        function drawFrame() {
          if (stopped) return;
          const video = videoRef.current!;
          const canvas = canvasRef.current!;

          if (!video.videoWidth || !video.videoHeight) {
            requestAnimationFrame(drawFrame);
            return;
          }

          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;

          ctx.save();
          if (mirror) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }

          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          if (garmentLoaded) {
            const w = canvas.width, h = canvas.height;
            const gW = w * scale;
            const aspect = garmentImg.height / garmentImg.width || 1;
            const gH = gW * aspect;
            const xCenter = w / 2 + offsetX * w;
            const yTop = h * (0.20 + offsetY);

            ctx.translate(xCenter, yTop + gH / 2);
            ctx.rotate((rotation * Math.PI) / 180);
            ctx.drawImage(garmentImg, -gW / 2, -gH / 2, gW, gH);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
          }

          ctx.restore();
          requestAnimationFrame(drawFrame);
        }

        requestAnimationFrame(drawFrame);
      } catch (e: any) {
        setError(e?.message || "Camera permission denied or unsupported.");
      }
    }

    init();

    return () => {
      stopped = true;
      const tracks = (videoRef.current?.srcObject as MediaStream | undefined)?.getTracks?.();
      tracks?.forEach(t => t.stop());
      segmenter?.close?.();
    };
  }, [overlayUrl, mirror, garmentLoaded, scale, offsetX, offsetY, rotation, garmentImg]);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.titleWrap}>
          <button onClick={() => (window.top ? window.top.postMessage({ type: "CLOSE_VTO" }, "*") : history.back())}
                  style={styles.closeBtn}>✕</button>
          <h1 style={styles.h1}>{title}</h1>
        </div>
        <p style={styles.sub}>On-device • No uploads</p>
      </header>

      <main style={styles.main}>
        {!overlayUrl && <div style={styles.warn}>Supply an overlay PNG via <code>?overlay=&lt;URL&gt;</code></div>}
        <div style={styles.stage}>
          <video ref={videoRef} playsInline autoPlay muted style={{ display: "none" }} />
          <canvas ref={canvasRef} style={styles.canvas} />
        </div>

        <section style={styles.controls}>
          <Ctl label="Scale" value={scale} set={setScale} min={0.3} max={1.3} step={0.01} fmt={(v)=>v.toFixed(2)} />
          <Ctl label="Offset X" value={offsetX} set={setOffsetX} min={-0.5} max={0.5} step={0.005} fmt={(v)=>v.toFixed(3)} />
          <Ctl label="Offset Y" value={offsetY} set={setOffsetY} min={-0.3} max={0.5} step={0.005} fmt={(v)=>v.toFixed(3)} />
          <Ctl label="Rotation" value={rotation} set={setRotation} min={-20} max={20} step={0.1} fmt={(v)=>v.toFixed(1)+'°'} />
          <div style={styles.controlRow}>
            <label style={styles.label}>Mirror</label>
            <button onClick={() => setMirror(!mirror)} style={styles.toggleBtn}>{mirror ? "On" : "Off"}</button>
            <span />
          </div>
        </section>

        {error && <div style={styles.error}>{error}</div>}
        {!ready && <div style={styles.loading}>Initializing camera…</div>}
      </main>

      <footer style={styles.footer}>
        <small>Illustration only. Use Size Guide for accurate fit.</small>
      </footer>
    </div>
  );
}

function Ctl({label, value, set, min, max, step, fmt}:{label:string;value:number;set:(n:number)=>void;min:number;max:number;step:number;fmt:(n:number)=>string}) {
  return (
    <div style={styles.controlRow}>
      <label style={styles.label}>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e)=>set(parseFloat(e.target.value))}/>
      <span style={styles.value}>{fmt(value)}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,Arial", color: "#111", background: "#fff" },
  header: { padding: "10px 14px 4px", position: "sticky", top: 0, background: "#fff", zIndex: 10, borderBottom: "1px solid #eee" },
  titleWrap: { display: "flex", alignItems: "center", gap: 8 },
  closeBtn: { border: "1px solid #ddd", borderRadius: 10, padding: "6px 10px", background: "#fff", cursor: "pointer" },
  h1: { fontSize: 18, margin: 0 },
  sub: { margin: "6px 0 0", fontSize: 12, opacity: 0.7 },
  main: { padding: 12, maxWidth: 560, margin: "0 auto" },
  stage: { position: "relative", width: "100%", borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 8px rgba(0,0,0,0.06)" },
  canvas: { width: "100%", height: "auto", display: "block", background: "#000" },
  controls: { marginTop: 14, border: "1px solid #eee", borderRadius: 12, padding: 12 },
  controlRow: { display: "grid", gridTemplateColumns: "90px 1fr 60px", alignItems: "center", gap: 10, padding: "6px 0" },
  label: { fontSize: 13, opacity: 0.75 },
  value: { fontSize: 12, textAlign: "right", opacity: 0.8 },
  toggleBtn: { border: "1px solid #ddd", background: "#fff", padding: "6px 10px", borderRadius: 8, cursor: "pointer" },
  warn: { background: "#fff7e6", border: "1px solid #ffe0a3", padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 13 },
  error: { background: "#ffe8e8", border: "1px solid #ffbaba", padding: 12, borderRadius: 8, marginTop: 10, color: "#a40000", fontSize: 13 },
  loading: { marginTop: 10, fontSize: 13, opacity: 0.7 },
  footer: { padding: "10px 14px 18px", textAlign: "center", fontSize: 12, opacity: 0.65 }
};
