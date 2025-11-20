import React, { useCallback, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";

/* ---------------- Webflow Designer minimal typings ---------------- */
interface WFStyle {
  setProperties: (props: Record<string, string>) => Promise<void>;
  getProperties?: () => Promise<Record<string, string>>;
}

type NamedValue = { name: string; value: string };

interface WFElement {
  // Core identity
  id?: any;
  label?: any;
  type?: any; // "DOM", "Image", "String", etc.
  tag?: string;

  // Capability flags
  children?: boolean;
  styles?: boolean;
  textContent?: boolean;
  customAttributes?: boolean;

  // DOM Element–specific methods (only if type === "DOM")
  getTag?: () => Promise<string | null>;
  setTag?: (tag: string) => Promise<null>;
  setAttribute?: (name: string, value: string) => Promise<null>;
  removeAttribute?: () => Promise<null>;
  getAttribute?: (name: string) => Promise<string | null>;
  getAllAttributes?: () => Promise<NamedValue[]>;
  setHtml?: (html: string) => Promise<void>;

  // Children methods (only if children === true)
  append?: (presetOrElement: any) => Promise<WFElement>;

  // Styles
  getStyles?: () => Promise<WFStyle[] | undefined>;
}

declare const webflow:
  | {
      getSelectedElement: () => Promise<WFElement | null>;
      elementPresets: { DOM: any };
      notify?: (opts: {
        type: "Success" | "Error" | "Warning";
        message: string;
      }) => Promise<void> | void;
    }
  | undefined;

/* ---------------- Utils ---------------- */
const isFile = (x: unknown): x is File =>
  !!x && typeof (x as File).name === "string" && typeof (x as File).type === "string";

const hasProp = (
  el: any,
  prop: "children" | "customAttributes" | "styles" | "textContent"
) => !!(el && el[prop]);

/* ---------------- SVG helpers ---------------- */
const isValidSVG = (content: string): boolean => {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, "image/svg+xml");
    const svg = doc.querySelector("svg");
    const parseError = doc.querySelector("parsererror");
    return !!svg && !parseError;
  } catch {
    return false;
  }
};

const cleanSVGContent = (content: string): string => content.trim();

/* ---------------- Webflow DOM helpers ---------------- */

async function appendDomWithTag(
  parent: WFElement,
  tag: string,
  attrs?: Record<string, string>
): Promise<WFElement> {
  if (!hasProp(parent, "children") || typeof parent.append !== "function") {
    throw new Error("Parent cannot host children");
  }

  const domEl = await parent.append(webflow!.elementPresets.DOM);
  if (typeof domEl.setTag === "function") {
    await domEl.setTag(tag);
  }
  domEl.tag = tag;

  if (attrs && typeof domEl.setAttribute === "function") {
    const entries = Object.entries(attrs);
    for (const [k, v] of entries) {
      if (v != null && v !== "") {
        await domEl.setAttribute(k, String(v));
      }
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

/* ---------------- React Component ---------------- */
const App: React.FC = () => {
  const [svgCode, setSvgCode] = useState("");
  const [svgUrl, setSvgUrl] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [apiReady, setApiReady] = useState(false);
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [hasSelectedElement, setHasSelectedElement] = useState(false);

  const checkApiReady = useCallback(() => {
    const ok =
      typeof webflow !== "undefined" &&
      !!webflow &&
      typeof webflow.getSelectedElement === "function" &&
      webflow.elementPresets?.DOM;
    setApiReady(!!ok);
    return ok;
  }, []);

  // Poll Webflow Designer API until ready (then stop)
  useEffect(() => {
    let attempts = 0;
    const interval = setInterval(() => {
      const ok = checkApiReady();
      attempts += 1;
      if (ok || attempts > 60) {
        // ~60s max
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [checkApiReady]);

  // Poll current selected element and update hasSelectedElement
  useEffect(() => {
    if (!apiReady || typeof webflow === "undefined") return;

    let cancelled = false;

    const interval = setInterval(async () => {
      if (cancelled) return;
      try {
        const el = await webflow.getSelectedElement();
        if (!cancelled) {
          setHasSelectedElement(!!el);
        }
      } catch {
        if (!cancelled) {
          setHasSelectedElement(false);
        }
      }
    }, 800);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [apiReady]);

  /* ---------------- Apply SVG into Webflow ---------------- */
  const handleApplySVG = useCallback(
    async (svgContent: string) => {
      const cleaned = cleanSVGContent(svgContent);
      if (!cleaned) return;

      if (!checkApiReady()) {
        setUploadError("Webflow Designer API is not ready yet.");
        return;
      }

      try {
        const selected = await webflow!.getSelectedElement();
        if (!selected) {
          setUploadError("Please select an element on the canvas first.");
          return;
        }

        if (!hasProp(selected, "children") || typeof selected.append !== "function") {
          setUploadError("Selected element cannot contain SVG content.");
          return;
        }

        const parser = new DOMParser();
        const parsed = parser.parseFromString(cleaned, "image/svg+xml");
        const svgEl = parsed.querySelector("svg");

        if (!svgEl) {
          setUploadError("Provided SVG does not contain a valid <svg> root.");
          return;
        }

        // Create Webflow DOM "svg" element under selected element
        const svgDom = await selected.append(webflow!.elementPresets.DOM);
        if (typeof svgDom.setTag === "function") {
          await svgDom.setTag("svg");
        }
        svgDom.tag = "svg";

        // Mark root for later lookup
        if (typeof svgDom.setAttribute === "function") {
          await svgDom.setAttribute("data-svg-ext-root", "1");
        }

        // Copy root <svg> attributes (viewBox, width, height, etc.)
        if (typeof svgDom.setAttribute === "function") {
          const attrs = Array.from(svgEl.attributes);
          for (const a of attrs) {
            await svgDom.setAttribute(a.name, a.value);
          }
        }

        // For each shape: create Webflow DOM node
        const shapeNodes = svgEl.querySelectorAll(
          "path,rect,circle,ellipse,line,polygon,polyline"
        );

        const childPromises: Promise<unknown>[] = [];

        for (const node of Array.from(shapeNodes)) {
          const tagName = node.tagName.toLowerCase();
          const attrs = attrsFrom(node);

          const extendedAttrs: Record<string, string> = {
            ...attrs,
            "data-svg-ext-shape": "1",
          };

          // store original colors
          if (attrs.fill != null) {
            extendedAttrs["data-svg-ext-orig-fill"] = attrs.fill;
          }
          if (attrs.stroke != null) {
            extendedAttrs["data-svg-ext-orig-stroke"] = attrs.stroke;
          }

          // multi-color: original colors se render karo, but allow overrides
          if (attrs.fill && attrs.fill !== "none") {
            extendedAttrs.fill = attrs.fill;
          } else {
            extendedAttrs.fill = "currentColor";
          }

          if (attrs.stroke && attrs.stroke !== "none") {
            extendedAttrs.stroke = attrs.stroke;
          }

          extendedAttrs["data-svg-ext-currentcolor-enabled"] = "1";

          // extra class clean up
          delete extendedAttrs.class;
          delete extendedAttrs.className;

          childPromises.push(appendDomWithTag(svgDom, tagName, extendedAttrs));
        }

        await Promise.all(childPromises);

        setUploadError("");
      } catch {
        setUploadError("Something went wrong while applying the SVG.");
      }
    },
    [checkApiReady]
  );

  /* ---------------- Webflow class color/fill → SVG sync ---------------- */
  useEffect(() => {
    if (!apiReady || typeof webflow === "undefined") return;

    let cancelled = false;

    const interval = setInterval(async () => {
      if (cancelled) return;

      try {
        const selected = await webflow.getSelectedElement();
        if (!selected || !hasProp(selected, "styles") || !selected.getStyles) {
          return;
        }

        const stylesArr = (await selected.getStyles()) || [];
        if (!stylesArr.length) return;

        const mergedProps: Record<string, string> = {};

        for (const style of stylesArr) {
          const props = (await style.getProperties?.()) || {};
          Object.assign(mergedProps, props);
        }

        // priority for picking color:
        // 1) color
        // 2) fill
        // 3) background-color
        const colorFromClass = mergedProps["color"] || "";
        const fillFromClass = mergedProps["fill"] || "";
        const bgFromClass = mergedProps["background-color"] || "";

        const webflowColor =
          colorFromClass || fillFromClass || bgFromClass || "";

        if (!webflowColor) {
          return;
        }

        // Always sync style fill with the effective color
        await Promise.all(
          stylesArr.map((style) =>
            style.setProperties
              ? style.setProperties({
                  fill: webflowColor,
                })
              : Promise.resolve()
          )
        );

        // DOM side: update shapes inside closest svg-ext root
        const allAttrs = (await selected.getAllAttributes?.()) || [];
        const idAttr = allAttrs.find((a) => a.name === "id");

        let selectedDom: Element | null = null;
        if (idAttr?.value) {
          selectedDom = document.getElementById(idAttr.value);
        }

        if (!selectedDom) return;

        const closestRoot = selectedDom.closest<SVGSVGElement>(
          "[data-svg-ext-root='1']"
        );
        if (!closestRoot) return;

        const shapes = Array.from(
          closestRoot.querySelectorAll<SVGElement>("[data-svg-ext-shape='1']")
        );

        shapes.forEach((shape) => {
          const origFill = shape.getAttribute("data-svg-ext-orig-fill");
          const origStroke = shape.getAttribute("data-svg-ext-orig-stroke");

          // last applied color is persisted in attributes → survives app close
          if (origFill && origFill !== "none") {
            shape.setAttribute("fill", webflowColor);
          }
          if (origStroke && origStroke !== "none") {
            shape.setAttribute("stroke", webflowColor);
          }
        });
      } catch {
        // swallow errors to avoid console spam; will retry next interval
      }
    }, 1200); // still light enough, avoids DOM thrash

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [apiReady]);

  /* ---------------- Upload from file ---------------- */
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files as FileList | null;
    if (!files || !files.length) return;

    setUploadError("");

    Array.from(files).forEach((maybe) => {
      const file = isFile(maybe) ? maybe : null;
      if (!file) return;

      if (
        file.type === "image/svg+xml" ||
        file.name.toLowerCase().endsWith(".svg")
      ) {
        const reader = new FileReader();

        reader.onload = async (ev) => {
          try {
            const res = ev.target?.result as string | ArrayBuffer | null;
            const raw =
              typeof res === "string"
                ? res
                : res
                ? new TextDecoder().decode(res as ArrayBuffer)
                : "";

            const cleaned = cleanSVGContent(raw);
            if (!isValidSVG(cleaned)) {
              setUploadError(`"${file.name}" is not a valid SVG.`);
              return;
            }

            await handleApplySVG(cleaned);
          } catch {
            setUploadError(`Error reading "${file.name}".`);
          }
        };

        reader.onerror = () => {
          setUploadError(`Failed to read "${file.name}".`);
        };

        reader.readAsText(file);
      } else {
        setUploadError("Please upload only .svg files.");
      }
    });
  };

  /* ---------------- Drag & Drop ---------------- */
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.cancelable) e.preventDefault();
    setIsDragging(false);
    setUploadError("");

    const files = e.dataTransfer.files as FileList | null;
    if (!files || !files.length) return;

    Array.from(files).forEach((maybe) => {
      const file = isFile(maybe) ? maybe : null;
      if (!file) return;

      if (
        file.type === "image/svg+xml" ||
        file.name.toLowerCase().endsWith(".svg")
      ) {
        const reader = new FileReader();

        reader.onload = async (ev) => {
          try {
            const res = ev.target?.result as string | ArrayBuffer | null;
            const raw =
              typeof res === "string"
                ? res
                : res
                ? new TextDecoder().decode(res as ArrayBuffer)
                : "";

            const cleaned = cleanSVGContent(raw);
            if (!isValidSVG(cleaned)) {
              setUploadError(`"${file.name}" is not a valid SVG.`);
              return;
            }

            await handleApplySVG(cleaned);
          } catch {
            setUploadError(`Error reading "${file.name}".`);
          }
        };

        reader.onerror = () => {
          setUploadError(`Failed to read "${file.name}".`);
        };

        reader.readAsText(file);
      } else {
        setUploadError("Please drop only .svg files.");
      }
    });
  };

  /* ---------------- Paste SVG Code ---------------- */
  const handleSvgCodeUpload = async () => {
    if (!svgCode.trim()) {
      setUploadError("Please enter SVG code.");
      return;
    }

    setUploadError("");
    try {
      const cleaned = cleanSVGContent(svgCode);
      if (!isValidSVG(cleaned)) {
        setUploadError("Please enter valid SVG code containing <svg>.");
        return;
      }

      await handleApplySVG(cleaned);
      setSvgCode("");
    } catch {
      setUploadError("Invalid SVG code.");
    }
  };

  /* ---------------- Paste SVG URL (Asset CDN) ---------------- */
  const handleSvgUrlApply = async () => {
    const url = svgUrl.trim();
    if (!url) {
      setUploadError("Please enter SVG URL.");
      return;
    }

    setUploadError("");
    setIsFetchingUrl(true);
    try {
      const res = await fetch(url, { method: "GET" });

      if (!res.ok) {
        setUploadError(`Failed to fetch SVG. Server responded with ${res.status}.`);
        return;
      }

      const raw = await res.text();
      const cleaned = cleanSVGContent(raw);

      if (!isValidSVG(cleaned)) {
        setUploadError("Fetched file is not a valid SVG.");
        return;
      }

      await handleApplySVG(cleaned);
    } catch {
      setUploadError("Error fetching SVG from URL.");
    } finally {
      setIsFetchingUrl(false);
    }
  };

  /* ---------------- GATE: until element is selected ---------------- */
  if (!hasSelectedElement) {
    return (
      <div className="w-full h-[460px] bg-black text-white flex flex-col p-16 overflow-hidden">
        <div className="text-4xl p-5 text-center">👉</div>
        <h3 className="font-semibold text-lg p-1 text-center">Select an element</h3>
        <p className="text-[11px] text-gray-400 p-1 text-center">
          No element is selected. Please select any element on the Webflow Designer
          canvas. Once an element is selected, the app will automatically enable the
          SVG actions.
        </p>
      </div>
    );
  }

  /* ---------------- UI (visible only AFTER element selected) ---------------- */
  return (
    <div className="w-full h-full bg-black text-white flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 p-3 flex flex-col gap-4 justify-center">
        {/* Upload / Drop Section */}
        <section
          className={`flex flex-col items-center justify-center p-4 text-center border border-dashed rounded-lg transition-colors ${
            isDragging ? "border-blue-400 bg-gray-900" : "border-gray-700 bg-gray-950"
          }`}
          onDrop={handleDrop}
          onDragOver={(e) => {
            if (e.cancelable) e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            if (e.cancelable) e.preventDefault();
            setIsDragging(false);
          }}
        >
          <div className="text-3xl mb-1">📁</div>
          <h3 className="font-semibold text-xs mb-1">Drop SVG files here</h3>
          <p className="text-[11px] text-gray-400 mb-2">or</p>
          <label className="bg-blue-600 text-white px-3 py-1.5 rounded text-[11px] cursor-pointer hover:bg-blue-700 transition-colors">
            Browse Files
            <input
              type="file"
              multiple
              accept=".svg"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
          <p className="text-[11px] text-gray-400 mt-2">
            Supports .svg files only.
          </p>
        </section>

        {/* SVG URL Section */}
        <section className="flex flex-col bg-gray-950 border border-gray-800 rounded-lg p-3 gap-2">
          <h3 className="font-semibold text-xs">SVG URL (Webflow Asset)</h3>
          <p className="text-[11px] text-gray-400">
            Grab the SVG link from your Assets (→ Copy link) → paste here → Apply URL
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={svgUrl}
              onChange={(e) => setSvgUrl(e.target.value)}
              placeholder="https://cdn.prod.website-files.com/.../icon.svg"
              className="flex-1 px-2 py-1.5 text-[11px] rounded border border-gray-700 bg-black text-gray-100 font-mono"
            />
            <button
              onClick={handleSvgUrlApply}
              disabled={!svgUrl.trim() || isFetchingUrl}
              className="px-3 py-1.5 text-[11px] rounded bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {isFetchingUrl ? "Fetching..." : "Apply URL"}
            </button>
          </div>
        </section>

        {/* Paste SVG Code Section */}
        <section className="flex flex-col bg-gray-950 border border-gray-800 rounded-lg p-3">
          <h3 className="font-semibold text-xs mb-1">Paste SVG Code</h3>
          <textarea
            value={svgCode}
            onChange={(e) => setSvgCode(e.target.value)}
            placeholder="<svg>...</svg>"
            className="w-full h-24 p-2 text-[11px] border border-gray-700 rounded-lg resize-none font-mono bg-black text-gray-100"
          />
          <button
            onClick={handleSvgCodeUpload}
            disabled={!svgCode.trim()}
            className="mt-2 bg-blue-600 text-white py-1.5 rounded text-[11px] hover:bg-blue-700 transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
          >
            Apply to Selected Element
          </button>
        </section>

        {uploadError && (
          <div className="p-2 bg-red-900/40 border border-red-500 text-red-200 text-[11px] rounded">
            {uploadError}
          </div>
        )}
      </div>
    </div>
  );
};

/* ---- mount ---- */
const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
);
root.render(<App />);
