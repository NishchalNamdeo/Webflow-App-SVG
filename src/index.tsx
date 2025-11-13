import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";

/* ---------------- Webflow Designer minimal typings ---------------- */
interface WFStyle {
  setProperties: (props: Record<string, string>) => Promise<void>;
  getProperties?: () => Promise<Record<string, string>>;
  getName?: () => Promise<string>;
}
interface WFElement {
  // Core identity
  id?: any;
  label?: any;
  type?: any; // "DOM", "Image", "String", etc.
  tag?: string;

  // Capability flags (boolean properties per docs)
  children?: boolean;
  styles?: boolean;
  textContent?: boolean;
  customAttributes?: boolean;

  // DOM Element–specific methods (only if type === "DOM")
  getTag?: () => Promise<string | null>;
  setTag?: (tag: string) => Promise<null>;
  setAttribute?: (name: string, value: string) => Promise<null>;
  removeAttribute?: (name: string) => Promise<null>;

  // Children methods (only if children === true)
  append?: (presetOrElement: any) => Promise<WFElement>;

  // Styles (only if styles === true)
  setStyles?: (styles: WFStyle[]) => Promise<void>;
  getStyles?: () => Promise<WFStyle[] | undefined>;
}
declare const webflow:
  | {
      getSelectedElement: () => Promise<WFElement | null>;
      elementPresets: { DOM: Promise<WFElement> };
      addElement: (el: WFElement) => Promise<void>;
      createStyle: (name: string) => Promise<WFStyle>;
      getStyleByName?: (name: string) => Promise<WFStyle | null>;
      notify?: (opts: { type: "Success" | "Error" | "Warning"; message: string }) => Promise<void> | void;
    }
  | undefined;

/* ---------------- Types ---------------- */
interface SVGStyle {
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
}
interface SVGItem {
  id: string;
  name: string;
  svgContent: string; // original cleaned SVG
  styles: SVGStyle;
  createdAt: number;
  pathCount: number; // for dropdown
}

const DEFAULT_SVG_STYLE: SVGStyle = {
  fillColor: "#3b82f6",
  strokeColor: "#1e40af",
  strokeWidth: 2,
  opacity: 1,
};

/* ---------------- Utils & Logging ---------------- */
const LOG  = (...a: any[]) => console.log("[SVG-EXT]", ...a);
const WARN = (...a: any[]) => console.warn("[SVG-EXT]", ...a);
const ERR  = (...a: any[]) => console.error("[SVG-EXT]", ...a);

const isFile = (x: unknown): x is File => !!x && typeof (x as File).name === "string" && typeof (x as File).type === "string";
const toText = (v: unknown): string => {
  if (v === null || v === undefined) return "-";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  try { const s = JSON.stringify(v); return s && s.length > 160 ? s.slice(0,158) + "…" : s || "[object]"; } catch { return "[object]"; }
};

const hasProp = (el: any, prop: "children" | "customAttributes" | "styles" | "textContent") => !!(el && el[prop]);
const safeMeta = (el: any) =>
  !el ? el : ({ id: el?.id, type: el?.type, tag: el?.tag, children: !!el?.children, customAttributes: !!el?.customAttributes });

/* ---------------- SVG helpers ---------------- */
const isValidSVG = (content: string): boolean => {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, "image/svg+xml"); // correct MIME
    const svg = doc.querySelector("svg");
    const parseError = doc.querySelector("parsererror");
    return !!svg && !parseError;
  } catch { return false; }
};
const cleanSVGContent = (content: string): string => content.trim();

/* ---- numeric helper ---- */
const num = (v: string | null | undefined, fb = 0) => {
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : fb;
};

/* ---- shape → path ---- */
const rectToPath = (el: Element): string | null => {
  const x = num(el.getAttribute("x"));
  const y = num(el.getAttribute("y"));
  const w = num(el.getAttribute("width"));
  const h = num(el.getAttribute("height"));
  if (w <= 0 || h <= 0) return null;
  const rx = num(el.getAttribute("rx"));
  const ry = num(el.getAttribute("ry"));
  if (rx > 0 || ry > 0) {
    const _rx = Math.min(rx || ry || 0, w / 2);
    const _ry = Math.min(ry || rx || 0, h / 2);
    return [
      `M ${x + _rx} ${y}`,
      `H ${x + w - _rx}`,
      `A ${_rx} ${_ry} 0 0 1 ${x + w} ${y + _ry}`,
      `V ${y + h - _ry}`,
      `A ${_rx} ${_ry} 0 0 1 ${x + w - _rx} ${y + h}`,
      `H ${x + _rx}`,
      `A ${_rx} ${_ry} 0 0 1 ${x} ${y + h - _ry}`,
      `V ${y + _ry}`,
      `A ${_rx} ${_ry} 0 0 1 ${x + _rx} ${y}`,
      "Z",
    ].join(" ");
  }
  return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
};
const circleToPath = (el: Element): string | null => {
  const cx = num(el.getAttribute("cx"));
  const cy = num(el.getAttribute("cy"));
  const r = num(el.getAttribute("r"));
  if (r <= 0) return null;
  return [
    `M ${cx - r} ${cy}`,
    `A ${r} ${r} 0 1 0 ${cx + r} ${cy}`,
    `A ${r} ${r} 0 1 0 ${cx - r} ${cy}`,
    "Z",
  ].join(" ");
};
const ellipseToPath = (el: Element): string | null => {
  const cx = num(el.getAttribute("cx"));
  const cy = num(el.getAttribute("cy"));
  const rx = num(el.getAttribute("rx"));
  const ry = num(el.getAttribute("ry"));
  if (rx <= 0 || ry <= 0) return null;
  return [
    `M ${cx - rx} ${cy}`,
    `A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy}`,
    `A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`,
    "Z",
  ].join(" ");
};
const lineToPath = (el: Element): string | null => {
  const x1 = num(el.getAttribute("x1"));
  const y1 = num(el.getAttribute("y1"));
  const x2 = num(el.getAttribute("x2"));
  const y2 = num(el.getAttribute("y2"));
  return `M ${x1} ${y1} L ${x2} ${y2}`;
};
const pointsToArray = (pts: string | null): Array<[number, number]> => {
  if (!pts) return [];
  const arr: Array<[number, number]> = [];
  pts.trim().split(/[\s,]+/).forEach((v, i, a) => {
    if (i % 2 === 0 && i + 1 < a.length) {
      const x = parseFloat(a[i]); const y = parseFloat(a[i + 1]);
      if (Number.isFinite(x) && Number.isFinite(y)) arr.push([x, y]);
    }
  });
  return arr;
};
const polylineToPath = (el: Element): string | null => {
  const pts = pointsToArray(el.getAttribute("points"));
  if (!pts.length) return null;
  return "M " + pts.map(([x, y]) => `${x} ${y}`).join(" L ");
};
const polygonToPath = (el: Element): string | null => {
  const pts = pointsToArray(el.getAttribute("points"));
  if (!pts.length) return null;
  return "M " + pts.map(([x, y]) => `${x} ${y}`).join(" L ") + " Z";
};

/* ---- normalize to path-only; also count paths ---- */
const normalizeSVGToPathOnly = (svgContent: string, styles: SVGStyle): { svg: string; count: number } => {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgContent, "image/svg+xml");
    const inSvg = doc.querySelector("svg");
    if (!inSvg) { WARN("normalize: no <svg> root"); return { svg: svgContent, count: 0 }; }

    const outDoc = document.implementation.createDocument("http://www.w3.org/2000/svg", "svg", null);
    const outSvg = outDoc.documentElement;
    outSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");

    let viewBox = inSvg.getAttribute("viewBox");
    if (!viewBox) {
      const wAttr = inSvg.getAttribute("width");
      const hAttr = inSvg.getAttribute("height");
      const w = wAttr ? parseFloat(String(wAttr).replace("px", "")) : NaN;
      const h = hAttr ? parseFloat(String(hAttr).replace("px", "")) : NaN;
      viewBox = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? `0 0 ${w} ${h}` : "0 0 24 24";
    }
    outSvg.setAttribute("viewBox", viewBox);
    outSvg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    let pathIdx = 0;
    inSvg.querySelectorAll("*").forEach((el) => {
      const tag = el.tagName.toLowerCase();
      let d: string | null = null;

      if (tag === "path") d = (el as SVGPathElement).getAttribute("d");
      else if (tag === "rect") d = rectToPath(el);
      else if (tag === "circle") d = circleToPath(el);
      else if (tag === "ellipse") d = ellipseToPath(el);
      else if (tag === "line") d = lineToPath(el);
      else if (tag === "polyline") d = polylineToPath(el);
      else if (tag === "polygon") d = polygonToPath(el);

      if (d && d.trim()) {
        const p = outDoc.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", d);
        // Use provided styles but honor explicit 'none'
        const origFill = el.getAttribute("fill");
        const origStroke = el.getAttribute("stroke");
        p.setAttribute("fill", origFill === "none" ? "none" : styles.fillColor);
        if (origStroke === "none") {
          p.setAttribute("stroke", "none");
        } else {
          p.setAttribute("stroke", styles.strokeColor);
          p.setAttribute("stroke-width", String(styles.strokeWidth));
        }
        p.setAttribute("opacity", String(styles.opacity));

        // mark each path with index so we can target it later
        p.setAttribute("data-svg-ext-path-idx", String(pathIdx));
        outSvg.appendChild(p);
        pathIdx++;
      }
    });

    const serialized = new XMLSerializer().serializeToString(outSvg);
    return { svg: serialized, count: pathIdx };
  } catch (e) {
    ERR("normalize failed:", e);
    return { svg: svgContent, count: 0 };
  }
};

/* ---- styled preview (non-destructive) ---- */
const applyStylesToSVGForPreview = (svgContent: string, styles: SVGStyle): string => {
  try {
    const doc = new DOMParser().parseFromString(svgContent, "image/svg+xml");
    const svg = doc.querySelector("svg");
    if (!svg) return svgContent;
    if (!svg.getAttribute("viewBox")) svg.setAttribute("viewBox", "0 0 24 24");
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    svg.querySelectorAll("*").forEach((el) => {
      const tag = el.tagName.toLowerCase();
      if (["path","circle","rect","ellipse","polygon","polyline"].includes(tag)) {
        if (el.getAttribute("fill") !== "none") el.setAttribute("fill", styles.fillColor);
      }
      if (["path","circle","rect","ellipse","line","polyline","polygon"].includes(tag)) {
        if (el.getAttribute("stroke") !== "none") {
          el.setAttribute("stroke", styles.strokeColor);
          el.setAttribute("stroke-width", String(styles.strokeWidth));
        }
      }
      el.setAttribute("opacity", String(styles.opacity));
    });
    return new XMLSerializer().serializeToString(svg);
  } catch {
    return svgContent;
  }
};

/* ---------------- Building into Webflow (DOM Element path) ---------------- */

// Keep references of created elements so we can restyle without reinserting
type WFRef = { container: WFElement; svgRoot: WFElement; paths: WFElement[] };
const wfRefs: Record<string, WFRef | undefined> = {};

/** Create <tag> under parent via official sequence: append -> setTag -> setAttribute* */
async function appendDomWithTag(parent: WFElement, tag: string, attrs?: Record<string, string>) {
  if (!hasProp(parent, "children") || typeof parent.append !== "function") {
    throw new Error("Parent cannot host children");
  }
  const domEl = await parent.append(webflow!.elementPresets.DOM);
  if (typeof domEl.setTag === "function") {
    await domEl.setTag(tag);
  }
  if (attrs && hasProp(domEl, "customAttributes") && typeof domEl.setAttribute === "function") {
    for (const [k, v] of Object.entries(attrs)) {
      if (v != null && v !== "") await domEl.setAttribute(k, String(v));
    }
  }
  return domEl;
}

function attrsFrom(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes.item(i);
    if (a) out[a.name] = a.value;
  }
  return out;
}

/** Find insertion container: selected if can host children, else make a new DIV */
async function getInsertionContainer(): Promise<WFElement> {
  const selected = await webflow!.getSelectedElement();
  LOG("Selected:", safeMeta(selected));
  if (selected && hasProp(selected, "children")) {
    return selected;
  }
  // Create fresh container on canvas
  const root = await webflow!.elementPresets.DOM;
  await webflow!.addElement(root);
  await root.setTag?.("div");
  if (hasProp(root, "customAttributes") && typeof root.setAttribute === "function") {
    await root.setAttribute("data-inline-svg-container", "true");
  }
  LOG("Using new container:", safeMeta(root));
  return root;
}

/** Apply whole normalized path-only SVG into Webflow and store refs */
async function applySvgIntoWebflow(item: SVGItem, styles: SVGStyle, pathTarget: number | "all") {
  const { svg, count } = normalizeSVGToPathOnly(item.svgContent, styles);
  if (!count) {
    WARN("No path(s) to insert.");
    return;
  }
  // Parse normalized svg to DOM to enumerate paths + attributes
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const svgNode = parsed.querySelector("svg")!;
  const pathNodes = Array.from(parsed.querySelectorAll("path"));

  const container = await getInsertionContainer();

  // Create <svg> root
  const svgRoot = await appendDomWithTag(container, "svg", attrsFrom(svgNode));

  // Create <path>s
  const createdPaths: WFElement[] = [];
  for (let i = 0; i < pathNodes.length; i++) {
    if (pathTarget !== "all" && i !== pathTarget) continue; // only selected
    const p = pathNodes[i]!;
    const attrs = attrsFrom(p);
    // ensure index attribute for later find
    attrs["data-svg-ext-path-idx"] = String(i);
    const wfPath = await appendDomWithTag(svgRoot, "path", attrs);
    createdPaths.push(wfPath);
  }

  // Save references by item.id so we can re-style later
  wfRefs[item.id] = { container, svgRoot, paths: createdPaths };

  if (webflow?.notify) webflow.notify({ type: "Success", message: `Inserted ${createdPaths.length} path(s)` });
  LOG("Applied into Webflow:", { container: safeMeta(container), root: safeMeta(svgRoot), paths: createdPaths.length });
}

/** Update attributes on previously created paths (if present) */
async function restyleExistingInWebflow(item: SVGItem, styles: SVGStyle, pathTarget: number | "all") {
  const ref = wfRefs[item.id];
  if (!ref) return false;

  const updateOne = async (el: WFElement) => {
    if (!hasProp(el, "customAttributes") || typeof el.setAttribute !== "function") return;
    await el.setAttribute("opacity", String(styles.opacity));
    // fill / stroke: respect "none" if already none
    // we can’t read attributes reliably without getAttribute API; we’ll just set:
    await el.setAttribute("fill", styles.fillColor);
    await el.setAttribute("stroke", styles.strokeColor);
    await el.setAttribute("stroke-width", String(styles.strokeWidth));
  };

  if (pathTarget === "all") {
    for (const p of ref.paths) await updateOne(p);
  } else {
    const p = ref.paths[pathTarget];
    if (p) await updateOne(p);
  }
  if (webflow?.notify) webflow.notify({ type: "Success", message: "Updated styles" });
  return true;
}

/* ---------------- React Component ---------------- */
const App: React.FC = () => {
  // Session memory
  const [uploaded, setUploaded] = useState<SVGItem[]>([]);
  const [current, setCurrent] = useState<SVGItem | null>(null);

  const [styles, setStyles] = useState<SVGStyle>({ ...DEFAULT_SVG_STYLE });
  const [uploadTab, setUploadTab] = useState<"file" | "code">("file");
  const [svgCode, setSvgCode] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  // Webflow API ready
  const [apiReady, setApiReady] = useState(false);

  // Path selection
  const [pathTarget, setPathTarget] = useState<number | "all">("all"); // "all" or specific index

  // Auto-apply toggle
  const [autoApply, setAutoApply] = useState(true);
  const applyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkApiReady = useCallback(() => {
    const ok =
      typeof webflow !== "undefined" &&
      !!webflow &&
      typeof webflow.getSelectedElement === "function" &&
      webflow.elementPresets?.DOM;
    if (!ok) WARN("API not ready");
    setApiReady(!!ok);
    return ok;
  }, []);

  useEffect(() => {
    // simple poll just to keep ready flag fresh
    let alive = true;
    const tick = async () => {
      checkApiReady();
      if (alive) setTimeout(tick, 1200);
    };
    tick();
    return () => { alive = false; };
  }, [checkApiReady]);

  /* ---------------- Upload / Code ---------------- */
  const pushToMemory = useCallback((name: string, cleaned: string) => {
    // count paths once so dropdown can be built
    const { count } = normalizeSVGToPathOnly(cleaned, DEFAULT_SVG_STYLE);
    const item: SVGItem = {
      id: `svg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name,
      svgContent: cleaned,
      styles: { ...DEFAULT_SVG_STYLE },
      createdAt: Date.now(),
      pathCount: count,
    };
    setUploaded((prev) => [item, ...prev]);
    setCurrent(item);
    setStyles({ ...DEFAULT_SVG_STYLE });
    setPathTarget("all");
    LOG("Saved (session only):", { id: item.id, name: item.name, len: cleaned.length, paths: count });
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files as FileList | null;
    if (!files || !files.length) return;
    setUploadError("");
    Array.from(files).forEach((maybe) => {
      const file = isFile(maybe) ? maybe : null; if (!file) return;
      if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const res = ev.target?.result as string | ArrayBuffer | null;
            const raw = typeof res === "string" ? res : res ? new TextDecoder().decode(res as ArrayBuffer) : "";
            const cleaned = cleanSVGContent(raw);
            if (!isValidSVG(cleaned)) { setUploadError(`"${file.name}" is not a valid SVG`); ERR("invalid SVG"); return; }
            pushToMemory(file.name.replace(/\.svg$/i, ""), cleaned);
          } catch (err) { setUploadError(`Error reading "${file.name}"`); ERR("reader err:", err); }
        };
        reader.onerror = () => { setUploadError(`Failed to read "${file.name}"`); };
        reader.readAsText(file);
      } else {
        setUploadError("Please upload only .svg files");
      }
    });
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setIsDragging(false); setUploadError("");
    const files = e.dataTransfer.files as FileList | null; if (!files || !files.length) return;
    Array.from(files).forEach((maybe) => {
      const file = isFile(maybe) ? maybe : null; if (!file) return;
      if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const res = ev.target?.result as string | ArrayBuffer | null;
            const raw = typeof res === "string" ? res : res ? new TextDecoder().decode(res as ArrayBuffer) : "";
            const cleaned = cleanSVGContent(raw);
            if (!isValidSVG(cleaned)) { setUploadError(`"${file.name}" is not a valid SVG`); ERR("invalid SVG"); return; }
            pushToMemory(file.name.replace(/\.svg$/i, ""), cleaned);
          } catch (err) { setUploadError(`Error reading "${file.name}"`); ERR("drop read err:", err); }
        };
        reader.onerror = () => { setUploadError(`Failed to read "${file.name}"`); };
        reader.readAsText(file);
      } else {
        setUploadError("Please drop only .svg files");
      }
    });
  };

  const handleSvgCodeUpload = () => {
    if (!svgCode.trim()) { setUploadError("Please enter SVG code"); return; }
    setUploadError("");
    try {
      const cleaned = cleanSVGContent(svgCode);
      if (!isValidSVG(cleaned)) { setUploadError("Please enter valid SVG code containing <svg>"); return; }
      pushToMemory("Custom SVG", cleaned);
      setSvgCode("");
    } catch {
      setUploadError("Invalid SVG code");
    }
  };

  /* ---------------- Copy & Reset ---------------- */
  const copyNormalized = () => {
    if (!current) return;
    const { svg } = normalizeSVGToPathOnly(current.svgContent, styles);
    const doCopy = async () => {
      try {
        await navigator.clipboard.writeText(svg);
        webflow?.notify?.({ type: "Success", message: "SVG (path-only) copied" });
      } catch {
        const ta = document.createElement("textarea"); ta.value = svg; document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); webflow?.notify?.({ type: "Success", message: "SVG (path-only) copied" }); } catch { /* noop */ }
        document.body.removeChild(ta);
      }
    };
    void doCopy();
  };

  const resetStyles = () => {
    setStyles({ ...DEFAULT_SVG_STYLE });
    setPathTarget("all");
  };

  /* ---------------- Apply to Webflow (DOM Element path) ---------------- */
  const applyIntoWebflow = useCallback(async () => {
    if (!current) return;
    if (!checkApiReady()) { webflow?.notify?.({ type:"Warning", message:"Webflow API not ready" }); return; }

    // If we already inserted this item, try to restyle in-place; else insert fresh.
    const updated = await restyleExistingInWebflow(current, styles, pathTarget);
    if (updated) return;

    // Not present yet: insert now
    try {
      await applySvgIntoWebflow(current, styles, pathTarget);
    } catch (e) {
      ERR("Apply failed:", e);
      webflow?.notify?.({ type:"Error", message:"Apply failed" });
    }
  }, [current, styles, pathTarget, checkApiReady]);

  // Auto-apply debounce
  useEffect(() => {
    if (!autoApply || !current) return;
    if (applyDebounceRef.current) clearTimeout(applyDebounceRef.current);
    applyDebounceRef.current = setTimeout(() => { void applyIntoWebflow(); }, 350);
    return () => { if (applyDebounceRef.current) clearTimeout(applyDebounceRef.current); };
  }, [autoApply, current, styles, pathTarget, applyIntoWebflow]);

  /* ---------------- UI state ---------------- */
  const styledPreview = useMemo(() => {
    if (!current) return "";
    return applyStylesToSVGForPreview(current.svgContent, styles);
  }, [current, styles]);

  const normalizedPreview = useMemo(() => {
    if (!current) return "";
    return normalizeSVGToPathOnly(current.svgContent, styles).svg;
  }, [current, styles]);

  /* ---------------- UI ---------------- */
  return (
    <div className="h-[560px] bg-white shadow-xl overflow-hidden flex flex-col">
      {/* Header: tabs + status */}
      <div className="p-2 bg-gray-100 flex items-center justify-between">
        <div className="grid grid-cols-2 gap-1">
          {(["file", "code"] as const).map((tab) => (
            <button
              key={tab}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${uploadTab === tab ? "bg-white text-blue-700 font-semibold shadow-sm" : "text-gray-600"}`}
              onClick={() => setUploadTab(tab)}
            >
              {tab === "file" ? "Upload / Drop" : "Paste SVG Code"}
            </button>
          ))}
        </div>
        <div className={`text-[11px] px-2 py-1 rounded ${apiReady ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
          {apiReady ? "Designer API: Ready" : "Designer API: Not ready"}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-4">
        {/* Upload or Code */}
        {uploadTab === "file" ? (
          <div
            className={`flex flex-col items-center justify-center p-6 text-center border-2 border-dashed rounded-lg ${isDragging ? "border-blue-400 bg-blue-50" : "border-gray-300"}`}
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
          >
            <div className="text-4xl mb-2">📁</div>
            <h3 className="font-semibold text-sm mb-1">Drop SVG files here</h3>
            <p className="text-xs text-gray-500 mb-3">or</p>
            <label className="bg-blue-600 text-white px-4 py-2 rounded text-xs cursor-pointer hover:bg-blue-700 transition-colors">
              Browse Files
              <input type="file" multiple accept=".svg" onChange={handleFileUpload} className="hidden" />
            </label>
            <p className="text-xs text-gray-500 mt-3">Supports .svg files only</p>
            {uploadError && (
              <div className="mt-3 p-2 bg-red-100 border border-red-300 text-red-700 text-xs rounded">{uploadError}</div>
            )}
          </div>
        ) : (
          <div className="flex flex-col">
            <h3 className="font-semibold text-sm mb-2">Paste SVG Code</h3>
            <textarea
              value={svgCode}
              onChange={(e) => setSvgCode(e.target.value)}
              placeholder="<svg>...</svg>"
              className="w-full h-28 p-3 text-xs border border-gray-300 rounded-lg resize-none font-mono"
            />
            <button
              onClick={handleSvgCodeUpload}
              disabled={!svgCode.trim()}
              className="mt-3 bg-blue-600 text-white py-2 rounded text-xs hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              Save to Preview (Session only)
            </button>
            {uploadError && (
              <div className="mt-3 p-2 bg-red-100 border border-red-300 text-red-700 text-xs rounded">{uploadError}</div>
            )}
          </div>
        )}

        {/* Gallery */}
        {uploaded.length > 0 && (
          <div className="mt-4">
            <h4 className="font-semibold text-xs mb-2">Session SVGs ({uploaded.length})</h4>
            <div className="grid grid-cols-3 gap-2 max-h-24 overflow-y-auto">
              {uploaded.map((it) => (
                <button
                  key={it.id}
                  className={`p-1 bg-white border rounded hover:shadow-md transition-all ${current?.id === it.id ? "border-blue-500 ring-2 ring-blue-200" : "border-gray-200"}`}
                  onClick={() => setCurrent(it)}
                  title={it.name}
                >
                  <div
                    className="h-8 w-full bg-gray-100 rounded flex items-center justify-center"
                    dangerouslySetInnerHTML={{ __html: applyStylesToSVGForPreview(it.svgContent, DEFAULT_SVG_STYLE) }}
                  />
                  <div className="text-[10px] mt-1 truncate">{it.name}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Style + Preview + Path targeting */}
        {current && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold">Styling: {current.name}</div>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={autoApply} onChange={(e) => setAutoApply(e.target.checked)} /> Auto-apply
              </label>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-100 rounded-lg p-3">
                <div className="text-xs font-medium mb-1">Live Preview (styled)</div>
                <div className="border rounded bg-white flex items-center justify-center" style={{ width: 140, height: 140 }}
                  dangerouslySetInnerHTML={{ __html: styledPreview }} />
              </div>
             
            </div>

            {/* Path selector */}
            <div className="mt-3 grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">Target path</label>
                <select
                  className="w-full text-xs border rounded px-2 py-1"
                  value={pathTarget === "all" ? "all" : String(pathTarget)}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "all") setPathTarget("all");
                    else setPathTarget(parseInt(v, 10) || 0);
                  }}
                >
                  <option value="all">All paths ({current.pathCount || "?"})</option>
                  {Array.from({ length: current.pathCount || 0 }).map((_, i) => (
                    <option key={i} value={i}>Path #{i + 1}</option>
                  ))}
                </select>
               
              </div>

              {/* Fill */}
              <div className="space-y-1">
                <label className="text-xs font-medium">Fill</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={styles.fillColor} onChange={(e) => setStyles((s) => ({ ...s, fillColor: e.target.value }))} className="w-8 h-8 cursor-pointer" />
                  <input type="text" value={styles.fillColor} onChange={(e) => setStyles((s) => ({ ...s, fillColor: e.target.value }))} className="flex-1 text-xs border rounded px-2 py-1" />
                </div>
              </div>

              {/* Stroke */}
              <div className="space-y-1">
                <label className="text-xs font-medium">Stroke</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={styles.strokeColor} onChange={(e) => setStyles((s) => ({ ...s, strokeColor: e.target.value }))} className="w-8 h-8 cursor-pointer" />
                  <input type="text" value={styles.strokeColor} onChange={(e) => setStyles((s) => ({ ...s, strokeColor: e.target.value }))} className="flex-1 text-xs border rounded px-2 py-1" />
                </div>
              </div>

              {/* Stroke width */}
              <div className="space-y-1">
                <label className="text-xs font-medium">Stroke Width: {styles.strokeWidth}px</label>
                <input type="range" min={0} max={10} step={0.5} value={styles.strokeWidth} onChange={(e) => setStyles((s) => ({ ...s, strokeWidth: parseFloat(e.target.value) }))} className="w-full" />
              </div>

              {/* Opacity */}
              <div className="space-y-1">
                <label className="text-xs font-medium">Opacity: {styles.opacity}</label>
                <input type="range" min={0} max={1} step={0.1} value={styles.opacity} onChange={(e) => setStyles((s) => ({ ...s, opacity: parseFloat(e.target.value) }))} className="w-full" />
              </div>
            </div>

            {/* Actions */}
            <div className="mt-3 flex gap-2">
              <button className="px-3 py-1 text-xs rounded bg-gray-700 text-white hover:bg-gray-600" onClick={resetStyles}>Reset</button>
              <button className="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700" onClick={copyNormalized}>Copy SVG (path-only)</button>
              <button
                className="px-3 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                onClick={() => void applyIntoWebflow()}
                disabled={!apiReady}
                title={apiReady ? "Apply to Webflow" : "Designer API not ready"}
              >
                Apply to Webflow
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* ---- mount ---- */
const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(<App />);
