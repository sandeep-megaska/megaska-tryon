"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// CDNs for MediaPipe Tasks Vision (all on-device)
const TASKS_VISION_VERSION = "0.10.10";
const TASKS_VISION_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}`;

declare global {
  // Types for dynamic imports
  interface Window { }
}

export default function TryOnPage({
  searchParams
}: {
  searchParams?: { overlay?: string; title?: string; mirror?: string };
}) {
  const overlayUrl = searchParams?.overlay || "";
  const title = searchParams?.title || "Try it on (Beta)";
  const mirror = (searchParams?.mirror ?? "1") !== "0"; // default mirror ON

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [garmentLoaded, setGarmentLoaded] = useState(false);

  // Transform state (user adjustable, saved locally)
  const [scale, setScale] = useState<number>(() => parseFloat(localStorage.getItem("vto_scale") || "0.65"));
  const [offsetX, setOffsetX] = useState<number>(() => parseFloat(localStorage.getItem("vto_offx") || "0"));
  const [offsetY, setOffsetY] = useState<number>(() => parseFloat(localStorage.getItem("vto_offy") || "0.18"));
  const [rotation, setRotation] = useState<number>(() => parseFloat(localStorage.getItem("vto_rot") || "0"));

  // Minimal “pose-agnostic” overlay PNG (transparent BG) – front pose
  const garmentImg = useMemo(() => {
    const img = new Image();
    if (overlayUrl) img.src = overlayUrl;
    img.onload = () => setGarmentLoaded(true);
    img.onerror = () => setError("Couldn’t load overlay image");
    return img;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayUrl]);

  // Keep transforms in localStorage so customers don’t have to re-tune
  useEffect(() => { localStorage.setItem("vto_scale", String(scale)); }, [scale]);
  useEffect(() => { localStorage.setItem("vto_offx", String(offsetX)); }, [offsetX]);
  useEffect(() => { localStorage.setItem("vto_offy", String(offsetY)); }, [offsetY]);
  useEffect(() => { localStorage.setItem("vto_rot", String(rotation)); }, [rotation]);

  useEffect(() => {
    let stopped = false;
    let segmenter: any = null;

    async function init() {
      try {
        // 1) Camera
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" }, audio: false
        });
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        // 2) Load on-device segmentation
        //    Using ImageSegmenter with the selfie model (fast + private)
        //    NOTE: All files load from CDN to the browser; nothing goes to servers.
        // @ts-ignore
        const { ImageSegmenter, FilesetResolver } = await import(/* webpackIgnore: true */ `${TASKS_VISION_BASE}`);
        const vision = await (FilesetResolver as any).forVisionTasks(`${TASKS_VISION_BASE}/wasm`);
        segmenter = await (ImageSegmenter as any).createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float32/1/selfie_segmenter.tflite"
          },
          outputCategoryMask: true,
        });

        setReady(true);

        // 3) Render loop
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

          // Auto-size canvas to the video
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;

          // Mirror if requested (most users expect “mirror” on front camera)
          ctx.save();
          if (mirror) {
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
          }

          // Draw camera
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          // 4) Segmentation (optional visual effect)
          //    We won’t occlude garment for MVP; but you can dim background a bit.
          //    Commented, as reading mask each frame can be heavier on low-end phones.
          //    Uncomment this block to dim background outside the person.
          /*
          try {
            // @ts-ignore
            const bitmap = (self as any).createImageBitmap ? await createImageBitmap(video) : null;
            if (bitmap) {
              const res = await segmenter.segment(bitmap);
              const mask = res?.categoryMask;
              if (mask) {
                // simple dim outside the person mask
                ctx.globalCompositeOperation = "destination-over";
                ctx.fillStyle = "rgba(0,0,0,0.15)";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.globalCompositeOperation = "source-over";
              }
              bitmap.close?.();
            }
          } catch (e) { /* swallow */ /* }
          */

          // 5) Draw garment overlay (static alignment – adjustable)
          if (garmentLoaded) {
            const w = canvas.width, h = canvas.height;

            // Base width proportional to video width
            const gW = w * scale; // scale slider 0.3–1.2 typical
            const aspect = garmentImg.height / garmentImg.width || 1;
            const gH = gW * aspect;

            // Center X + offsetX (percentage of width), Y anchored at top 20% + offsetY
            const xCenter = w / 2 + offsetX * w;
            const yTop = h * (0.20 + offsetY); // 20% down is a decent starting anchor

            // Apply rotation around garment center
            ctx.translate(xCenter, yTop + gH / 2);
            ctx.rotate((rotation * Math.PI) / 180);
            ctx.drawImage(garmentImg, -gW / 2, -gH / 2, gW, gH);
            ctx.setTransform(1, 0, 0, 1, 0, 0); // reset
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
      // stop camera tracks
      const tracks = (videoRef.current?.srcObject as MediaStream | undefined)?.getTracks?.();
      tracks?.forEach(t => t.stop());
      segmenter?.close?.();
    };
  }, [overlayUrl, mirror, garmentLoaded]);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.titleWrap}>
          <button
            onClick={() => (window.top ? window.top.postMessage({ type: "CLOSE_VTO" }, "*") : history.back())}
            style={styles.closeBtn}
            aria-label="Close"
            title="Close"
          >
            ✕
          </button>
          <h1 style={styles.h1}>{title}</h1>
        </div>
        <p style={styles.sub}>100% on-device • No uploads • Camera stays in your browser</p>
      </header>

      <main style={styles.main}>
        {!overlayUrl && (
          <div style={styles.warn}>
            Supply an overlay PNG via <code>?overlay=&lt;URL&gt;</code>
          </div>
        )}

        <div style={styles.stage}>
          <video ref={videoRef} playsInline autoPlay muted style={{ display: "none" }} />
          <canvas ref={canvasRef} style={styles.canvas} />
        </div>

        <section style={styles.controls}>
          <div style={styles.controlRow}>
            <label style={styles.label}>Scale</label>
            <input type="range" min="0.3" max="1.3" step="0.01" value={scale}
                   onChange={(e) => setScale(parseFloat(e.target.value))} />
            <span style={styles.value}>{scale.toFixed(2)}</span>
          </div>
          <div style={styles.controlRow}>
            <label style={styles.label}>Offset X</label>
            <input type="range" min="-0.5" max="0.5" step="0.005" value={offsetX}
                   onChange={(e) => setOffsetX(parseFloat(e.target.value))} />
            <span style={styles.value}>{offsetX.toFixed(3)}</span>
          </div>
          <div style={styles.controlRow}>
            <label style={styles.label}>Offset Y</label>
            <input type="range" min="-0.3" max="0.5" step="0.005" value={offsetY}
                   onChange={(e) => setOffsetY(parseFloat(e.target.value))} />
            <span style={styles.value}>{offsetY.toFixed(3)}</span>
          </div>
          <div style={styles.controlRow}>
            <label style={styles.label}>Rotation</label>
            <input type="range" min="-20" max="20" step="0.1" value={rotation}
                   onChange={(e) => setRotation(parseFloat(e.target.value))} />
            <span style={styles.value}>{rotation.toFixed(1)}°</span>
          </div>
          <div style={styles.controlRow}>
            <label style={styles.label}>Mirror</label>
            <button
              onClick={() => {
                const url = new URL(window.location.href);
                url.searchParams.set("mirror", mirror ? "0" : "1");
                window.location.href = url.toString();
              }}
              style={styles.toggleBtn}
            >
              {mirror ? "On" : "Off"}
            </button>
          </div>
        </section>

        {error && <div style={styles.error}>{error}</div>}
        {!ready && <div style={styles.loading}>Initializing camera…</div>}
      </main>

      <footer style={styles.footer}>
        <small>Disclaimer: AI overlay is an illustration. Please refer to the Size Guide for accurate fit.</small>
      </footer>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial", color: "#111", background: "#fff" },
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
