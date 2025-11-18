import React, { useCallback, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";

/* ---------------- Webflow Designer minimal typings ---------------- */
interface WFStyle {
  setProperties: (props: Record<string, string>) => Promise<void>;
  getProperties?: () => Promise<Record<string, string>>;
  getName?: () => Promise<string>;
}

type NamedValue = { name: string; value: string };

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
  getAttribute?: (name: string) => Promise<string | null>;
  getAllAttributes?: () => Promise<NamedValue[]>;
  setHtml?: (html: string) => Promise<void>;

  // Children methods (only if children === true)
  append?: (presetOrElement: any) => Promise<WFElement>;

  // Styles (only if styles === true)
  setStyles?: (styles: WFStyle[]) => Promise<void>;
  getStyles?: () => Promise<WFStyle[] | undefined>;
}

declare const webflow:
  | {
      getSelectedElement: () => Promise<WFElement | null>;
      elementPresets: { DOM: any };
      addElement: (el: WFElement) => Promise<void>;
      createStyle: (name: string) => Promise<WFStyle>;
      getStyleByName?: (name: string) => Promise<WFStyle | null>;
      notify?: (opts: {
        type: "Success" | "Error" | "Warning";
        message: string;
      }) => Promise<void> | void;
      getAllElements?: () => Promise<WFElement[]>;
    }
  | undefined;

/* ---------------- Utils & Logging ---------------- */
const LOG = (...a: any[]) => console.log("[SVG-EXT]", ...a);
const WARN = (...a: any[]) => console.warn("[SVG-EXT]", ...a);
const ERR = (...a: any[]) => console.error("[SVG-EXT]", ...a);

const isFile = (x: unknown): x is File =>
  !!x && typeof (x as File).name === "string" && typeof (x as File).type === "string";

const hasProp = (
  el: any,
  prop: "children" | "customAttributes" | "styles" | "textContent"
) => !!(el && el[prop]);

const safeMeta = (el: any) =>
  !el
    ? el
    : {
        id: el?.id,
        type: el?.type,
        tag: el?.tag,
        children: !!el?.children,
        customAttributes: !!el?.customAttributes,
      };

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
  const [uploadError, setUploadError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [apiReady, setApiReady] = useState(false);

  const checkApiReady = useCallback(() => {
    const ok =
      typeof webflow !== "undefined" &&
      !!webflow &&
      typeof webflow.getSelectedElement === "function" &&
      webflow.elementPresets?.DOM;
    setApiReady(!!ok);
    return ok;
  }, []);

  // Keep polling until Webflow Designer API is ready
  useEffect(() => {
    let alive = true;
    const tick = () => {
      checkApiReady();
      if (alive) setTimeout(tick, 1200);
    };
    tick();
    return () => {
      alive = false;
    };
  }, [checkApiReady]);

  /* ---------------- Apply SVG into Webflow (no session storage) ---------------- */
  const handleApplySVG = useCallback(
    async (svgContent: string, label?: string) => {
      const cleaned = cleanSVGContent(svgContent);
      if (!cleaned) return;

      if (!checkApiReady()) {
        webflow?.notify?.({
          type: "Warning",
          message: "Webflow API not ready. Open in Designer & select an element.",
        });
        return;
      }

      try {
        const selectedElement = await webflow!.getSelectedElement();
        LOG("Selected element for apply:", safeMeta(selectedElement));

        if (!selectedElement) {
          WARN("Select an element first in Webflow");
          webflow?.notify?.({
            type: "Warning",
            message: "Please select a Webflow element first.",
          });
          return;
        }

        if (
          !hasProp(selectedElement, "children") ||
          typeof selectedElement.append !== "function"
        ) {
          WARN("Selected element cannot host children");
          webflow?.notify?.({
            type: "Error",
            message: "Selected element cannot contain SVG.",
          });
          return;
        }

        const parser = new DOMParser();
        const parsed = parser.parseFromString(cleaned, "image/svg+xml");
        const svgEl = parsed.querySelector("svg");

        if (!svgEl) {
          WARN("No <svg> root in uploaded content");
          webflow?.notify?.({
            type: "Error",
            message: "Invalid SVG: missing <svg> root.",
          });
          return;
        }

        // Create Webflow DOM "svg" element under selected element
        const svgDom = await selectedElement.append(webflow!.elementPresets.DOM);
        if (typeof svgDom.setTag === "function") {
          await svgDom.setTag("svg");
        }
        svgDom.tag = "svg";

        // Copy root <svg> attributes (viewBox, width, height, etc.)
        if (typeof svgDom.setAttribute === "function") {
          const attrs = Array.from(svgEl.attributes);
          for (const a of attrs) {
            await svgDom.setAttribute(a.name, a.value);
          }
        }

        // For each shape: create Webflow DOM node and map fill/stroke to currentColor
        const shapeNodes = svgEl.querySelectorAll(
          "path,rect,circle,ellipse,line,polygon,polyline"
        );

        const childPromises: Promise<unknown>[] = [];

        for (const node of Array.from(shapeNodes)) {
          const tagName = node.tagName.toLowerCase();
          const attrs = attrsFrom(node);

          // Make fills/strokes driven by Webflow styles via currentColor
          if (attrs.fill !== "none") {
            attrs.fill = "currentColor";
          }
          if (attrs.stroke && attrs.stroke !== "none") {
            attrs.stroke = "currentColor";
          }

          const p = appendDomWithTag(svgDom, tagName, attrs);
          childPromises.push(p);
        }

        await Promise.all(childPromises);

        webflow?.notify?.({
          type: "Success",
          message:
            label && label.trim().length > 0
              ? `"${label}" SVG applied to selected element.`
              : "SVG applied to selected element.",
        });
      } catch (e) {
        ERR("handleApplySVG failed:", e);
        webflow?.notify?.({
          type: "Error",
          message: "Failed to apply SVG.",
        });
      }
    },
    [checkApiReady]
  );

  /* ---------------- Upload from file ---------------- */
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files as FileList | null;
    if (!files || !files.length) return;

    setUploadError("");

    Array.from(files).forEach((maybe) => {
      const file = isFile(maybe) ? maybe : null;
      if (!file) return;

      if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
        const reader = new FileReader();

        reader.onload = (ev) => {
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

            // Directly apply into Webflow, no session gallery
            void handleApplySVG(cleaned, file.name.replace(/\.svg$/i, ""));
          } catch (err) {
            setUploadError(`Error reading "${file.name}".`);
            ERR("reader err:", err);
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
    e.preventDefault();
    setIsDragging(false);
    setUploadError("");

    const files = e.dataTransfer.files as FileList | null;
    if (!files || !files.length) return;

    Array.from(files).forEach((maybe) => {
      const file = isFile(maybe) ? maybe : null;
      if (!file) return;

      if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
        const reader = new FileReader();

        reader.onload = (ev) => {
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

            // Directly apply into Webflow, no session gallery
            void handleApplySVG(cleaned, file.name.replace(/\.svg$/i, ""));
          } catch (err) {
            setUploadError(`Error reading "${file.name}".`);
            ERR("drop read err:", err);
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
  const handleSvgCodeUpload = () => {
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

      // Directly apply into Webflow, no session gallery
      void handleApplySVG(cleaned, "Custom SVG");
      setSvgCode("");
    } catch {
      setUploadError("Invalid SVG code.");
    }
  };

  /* ---------------- UI ---------------- */
  return (
    <div className="w-full h-full bg-black text-white flex flex-col">
      <div className="flex-1 p-4">
        <div className="flex flex-col gap-6">
          {/* Upload / Drop Section */}
          <section
            className={`flex flex-col items-center justify-center p-6 text-center border-2 border-dashed rounded-lg ${
              isDragging ? "border-blue-400 bg-gray-900" : "border-gray-700 bg-gray-950"
            }`}
            onDrop={handleDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setIsDragging(false);
            }}
          >
            <div className="text-4xl mb-2">📁</div>
            <h3 className="font-semibold text-sm mb-1">Drop SVG files here</h3>
            <p className="text-xs text-gray-400 mb-3">or</p>
            <label className="bg-blue-600 text-white px-4 py-2 rounded text-xs cursor-pointer hover:bg-blue-700 transition-colors">
              Browse Files
              <input
                type="file"
                multiple
                accept=".svg"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
            <p className="text-xs text-gray-400 mt-3">Supports .svg files only.</p>
          </section>

          {/* Paste SVG Code Section */}
          <section className="flex flex-col bg-gray-950 border border-gray-800 rounded-lg p-4">
            <h3 className="font-semibold text-sm mb-2">Paste SVG Code</h3>
            <textarea
              value={svgCode}
              onChange={(e) => setSvgCode(e.target.value)}
              placeholder="<svg>...</svg>"
              className="w-full h-28 p-3 text-xs border border-gray-700 rounded-lg resize-none font-mono bg-black text-gray-100"
            />
            <button
              onClick={handleSvgCodeUpload}
              disabled={!svgCode.trim()}
              className="mt-3 bg-blue-600 text-white py-2 rounded text-xs hover:bg-blue-700 transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
            >
              Apply to  Selected Element
            </button>
          </section>

          {uploadError && (
            <div className="p-2 bg-red-900/40 border border-red-500 text-red-200 text-xs rounded">
              {uploadError}
            </div>
          )}

        
        </div>
      </div>
    </div>
  );
};

/* ---- mount ---- */
const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
);
root.render(<App />);
