import React, { useState, useEffect, useCallback } from "react";
import ReactDOM from "react-dom/client";

declare const webflow: any;

interface SVGStyle {
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
  scale: number;
  rotation: number;
}

interface SVGElement {
  id: string;
  name: string;
  svgContent: string;
  styles: SVGStyle;
}

const DEFAULT_SVG_STYLE: SVGStyle = {
  fillColor: "#3b82f6",
  strokeColor: "#1e40af",
  strokeWidth: 2,
  opacity: 1,
  scale: 1,
  rotation: 0
};

const COLOR_PRESETS = [
  { name: "Blue", value: "#3b82f6" },
  { name: "Red", value: "#ef4444" },
  { name: "Green", value: "#10b981" },
  { name: "Purple", value: "#8b5cf6" },
  { name: "Pink", value: "#ec4899" },
  { name: "Orange", value: "#f97316" },
  { name: "Teal", value: "#14b8a6" },
  { name: "Yellow", value: "#eab308" },
  { name: "Indigo", value: "#6366f1" },
  { name: "Gray", value: "#6b7280" }
];

const App: React.FC = () => {
  const [hasSelectedElement, setHasSelectedElement] = useState(false);
  const [selectedElement, setSelectedElement] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"upload" | "style" | "presets">("upload");
  const [uploadedSVGs, setUploadedSVGs] = useState<SVGElement[]>([]);
  const [currentSVG, setCurrentSVG] = useState<SVGElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [svgCode, setSvgCode] = useState(""); // For SVG code input
  const [uploadMethod, setUploadMethod] = useState<"file" | "code">("file"); // Upload method toggle

  const checkApiReady = useCallback(() =>
    typeof webflow !== "undefined" && webflow && typeof webflow.getSelectedElement === "function", []);

  useEffect(() => {
    let stopped = false;
    let timer: NodeJS.Timeout;

    const tick = async () => {
      try {
        if (!checkApiReady()) {
          if (!stopped) timer = setTimeout(tick, 300);
          return;
        }

        const element = await webflow.getSelectedElement();
        const hasElement = !!element;

        setHasSelectedElement(hasElement);
        setSelectedElement(hasElement ? element : null);
      } catch (error) {
        setHasSelectedElement(false);
        setSelectedElement(null);
      } finally {
        if (!stopped) timer = setTimeout(tick, 400);
      }
    };

    tick();

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [checkApiReady]);

  // Auto-apply when SVG or styles change
  useEffect(() => {
    if (currentSVG && selectedElement) {
      const timeoutId = setTimeout(() => {
        applySVGToWebflow();
      }, 300);
      
      return () => clearTimeout(timeoutId);
    }
  }, [currentSVG?.styles, currentSVG]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      if (file.type === "image/svg+xml") {
        const reader = new FileReader();
        reader.onload = (e) => {
          const svgContent = e.target?.result as string;
          const newSVG: SVGElement = {
            id: `svg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: file.name.replace('.svg', ''),
            svgContent,
            styles: { ...DEFAULT_SVG_STYLE }
          };

          setUploadedSVGs(prev => [...prev, newSVG]);
          setCurrentSVG(newSVG);
          setActiveTab("style");
        };
        reader.readAsText(file);
      }
    });
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);

    const files = event.dataTransfer.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      if (file.type === "image/svg+xml") {
        const reader = new FileReader();
        reader.onload = (e) => {
          const svgContent = e.target?.result as string;
          const newSVG: SVGElement = {
            id: `svg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: file.name.replace('.svg', ''),
            svgContent,
            styles: { ...DEFAULT_SVG_STYLE }
          };

          setUploadedSVGs(prev => [...prev, newSVG]);
          setCurrentSVG(newSVG);
          setActiveTab("style");
        };
        reader.readAsText(file);
      }
    });
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
  };

  // SVG code se SVG create karta hai
  const handleSvgCodeUpload = () => {
    if (!svgCode.trim()) {
      alert("Please enter SVG code");
      return;
    }

    try {
      // Validate SVG code
      const parser = new DOMParser();
      const svgDoc = parser.parseFromString(svgCode, 'image/svg+xml');
      const svgElement = svgDoc.documentElement;
      
      if (svgElement.nodeName !== 'svg') {
        alert("Please enter valid SVG code");
        return;
      }

      const newSVG: SVGElement = {
        id: `svg-code-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: "Custom SVG",
        svgContent: svgCode,
        styles: { ...DEFAULT_SVG_STYLE }
      };

      setUploadedSVGs(prev => [...prev, newSVG]);
      setCurrentSVG(newSVG);
      setActiveTab("style");
      setSvgCode(""); // Clear input
      
    } catch (error) {
      alert("Invalid SVG code. Please check and try again.");
    }
  };

  const updateSVGStyle = (updates: Partial<SVGStyle>) => {
    if (!currentSVG) return;

    setCurrentSVG(prev => prev ? {
      ...prev,
      styles: { ...prev.styles, ...updates }
    } : null);
  };

  // SVG ko Webflow mein directly HTML element ke roop mein insert karta hai
  const applySVGToWebflow = async () => {
    if (!currentSVG || !selectedElement) return;

    setIsApplying(true);
    try {
      const styledSVG = applyStylesToSVG(currentSVG.svgContent, currentSVG.styles);
      
      // SVG ko directly HTML content ke roop mein set karo
      await selectedElement.setHtml(styledSVG);
      
      console.log("SVG successfully applied to Webflow element");
    } catch (error) {
      console.error("Error applying SVG:", error);
      alert("Failed to apply SVG. Please try again.");
    } finally {
      setIsApplying(false);
    }
  };

  // SVG content ko style karta hai with proper path elements
  const applyStylesToSVG = (svgContent: string, styles: SVGStyle): string => {
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgContent, 'image/svg+xml');
    const svgElement = svgDoc.documentElement;

    // SVG attributes set karo
    svgElement.setAttribute('width', '100%');
    svgElement.setAttribute('height', '100%');
    svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    // ViewBox ensure karo
    if (!svgElement.getAttribute('viewBox')) {
      const width = svgElement.getAttribute('width') || '24';
      const height = svgElement.getAttribute('height') || '24';
      svgElement.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }

    // Individual SVG elements ko style karo (path, circle, rect, etc.)
    const styleableElements = svgElement.querySelectorAll('path, circle, rect, ellipse, line, polyline, polygon, g');
    
    styleableElements.forEach(element => {
      // Fill color apply karo
      if (styles.fillColor && styles.fillColor !== 'none') {
        element.setAttribute('fill', styles.fillColor);
      }
      
      // Stroke color apply karo
      if (styles.strokeColor && styles.strokeColor !== 'none') {
        element.setAttribute('stroke', styles.strokeColor);
      }
      
      // Stroke width apply karo
      if (styles.strokeWidth > 0) {
        element.setAttribute('stroke-width', styles.strokeWidth.toString());
      }
      
      // Opacity apply karo
      element.setAttribute('opacity', styles.opacity.toString());
    });

    // Transform group banakar apply karo
    const existingTransform = svgElement.getAttribute('transform') || '';
    const newTransform = `scale(${styles.scale}) rotate(${styles.rotation} 50 50) ${existingTransform}`;
    svgElement.setAttribute('transform', newTransform.trim());

    return new XMLSerializer().serializeToString(svgElement);
  };

  const copySVGCode = () => {
    if (!currentSVG) return;

    const styledSVG = applyStylesToSVG(currentSVG.svgContent, currentSVG.styles);
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(styledSVG).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {
        copyToClipboardFallback(styledSVG);
      });
    } else {
      copyToClipboardFallback(styledSVG);
    }
  };

  const copyToClipboardFallback = (text: string) => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert("Failed to copy SVG code. Please copy manually.");
    }
    document.body.removeChild(textarea);
  };

  const resetStyles = () => {
    if (!currentSVG) return;
    
    // Local styles reset
    setCurrentSVG(prev => prev ? {
      ...prev,
      styles: { ...DEFAULT_SVG_STYLE }
    } : null);
  };

  const selectSVG = (svg: SVGElement) => {
    setCurrentSVG(svg);
    setActiveTab("style");
  };

  if (!hasSelectedElement) {
    return (
      <div className="h-[460px] bg-white shadow-xl overflow-hidden flex flex-col">
        <div className="flex-1 flex items-center justify-center text-center p-4">
          <div className="space-y-2">
            <div className="text-4xl">👉</div>
            <h3 className="font-semibold text-lg">Select an Element</h3>
            <p className="text-sm text-gray-500">Please select a Div Block or Container in Webflow Designer to apply SVG.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[460px] bg-white shadow-xl overflow-hidden flex flex-col">
      {/* Header Tabs */}
      <div className="p-1 bg-gray-100">
        <div className="grid grid-cols-3 gap-1">
          {(["upload", "style", "presets"] as const).map(tab => (
            <button
              key={tab}
              className={`tab-btn py-1 text-xs rounded-md transition-colors ${activeTab === tab
                  ? 'bg-blue-200 text-blue-700 font-semibold'
                  : 'text-gray-500 hover:text-blue-600'
                }`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === "upload" ? "Upload" : tab === "style" ? "Style" : "Presets"}
            </button>
          ))}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "upload" && (
          <div className="p-4 h-full flex flex-col">
            {/* Upload Method Toggle */}
            <div className="flex mb-4 bg-gray-100 rounded-lg p-1">
              <button
                className={`flex-1 py-1 text-xs rounded-md transition-colors ${
                  uploadMethod === "file" 
                    ? 'bg-white text-blue-700 font-semibold shadow-sm' 
                    : 'text-gray-500'
                }`}
                onClick={() => setUploadMethod("file")}
              >
                Upload File
              </button>
              <button
                className={`flex-1 py-1 text-xs rounded-md transition-colors ${
                  uploadMethod === "code" 
                    ? 'bg-white text-blue-700 font-semibold shadow-sm' 
                    : 'text-gray-500'
                }`}
                onClick={() => setUploadMethod("code")}
              >
                SVG Code
              </button>
            </div>

            {/* File Upload Section */}
            {uploadMethod === "file" && (
              <div
                className={`drop-zone flex-1 flex flex-col items-center justify-center p-6 text-center border-2 border-dashed rounded-lg ${
                  isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300'
                }`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
              >
                <div className="text-4xl mb-2">📁</div>
                <h3 className="font-semibold text-sm mb-1">Drop SVG files here</h3>
                <p className="text-xs text-gray-500 mb-3">or</p>
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
                <p className="text-xs text-gray-500 mt-3">Supports multiple SVG files</p>
              </div>
            )}

            {/* SVG Code Upload Section */}
            {uploadMethod === "code" && (
              <div className="flex-1 flex flex-col">
                <h3 className="font-semibold text-sm mb-2">Paste SVG Code</h3>
                <textarea
                  value={svgCode}
                  onChange={(e) => setSvgCode(e.target.value)}
                  placeholder="Paste your SVG code here...&#10;&#10;Example: &#10;&lt;svg width=&quot;24&quot; height=&quot;24&quot; viewBox=&quot;0 0 24 24&quot; fill=&quot;none&quot; xmlns=&quot;http://www.w3.org/2000/svg&quot;&gt;&#10;  &lt;path d=&quot;M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z&quot; fill=&quot;currentColor&quot;/&gt;&#10;&lt;/svg&gt;"
                  className="flex-1 w-full p-3 text-xs border border-gray-300 rounded-lg resize-none font-mono"
                  rows={8}
                />
                <button
                  onClick={handleSvgCodeUpload}
                  disabled={!svgCode.trim()}
                  className="mt-3 bg-blue-600 text-white py-2 rounded text-xs hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  Upload SVG Code
                </button>
              </div>
            )}

            {/* Uploaded SVGs List */}
            {uploadedSVGs.length > 0 && (
              <div className="mt-4">
                <h4 className="font-semibold text-xs mb-2">Your SVGs</h4>
                <div className="grid grid-cols-3 gap-2 max-h-24 overflow-y-auto">
                  {uploadedSVGs.map(svg => (
                    <button
                      key={svg.id}
                      className={`preset-card p-1 bg-white border rounded hover:shadow-md transition-all ${
                        currentSVG?.id === svg.id ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'
                      }`}
                      onClick={() => selectSVG(svg)}
                    >
                      <div 
                        className="h-8 w-full bg-gray-100 rounded flex items-center justify-center"
                        dangerouslySetInnerHTML={{ 
                          __html: applyStylesToSVG(svg.svgContent, { ...svg.styles, scale: 0.5 }) 
                        }}
                      />
                      <div className="text-[10px] mt-1 truncate">{svg.name}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "style" && currentSVG && (
          <div className="p-4 h-full overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Styling: {currentSVG.name}</h3>
              <button
                onClick={resetStyles}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Reset
              </button>
            </div>

            {/* SVG Preview */}
            <div className="bg-gray-100 rounded-lg p-4 mb-3 flex items-center justify-center">
              <div
                className="svg-preview"
                style={{
                  width: '80px',
                  height: '80px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                dangerouslySetInnerHTML={{
                  __html: applyStylesToSVG(currentSVG.svgContent, currentSVG.styles)
                }}
              />
            </div>

            {/* Style Controls */}
            <div className="space-y-3">
              {/* Fill Color */}
              <div className="space-y-1">
                <label className="text-xs font-medium">Fill Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={currentSVG.styles.fillColor}
                    onChange={(e) => updateSVGStyle({ fillColor: e.target.value })}
                    className="w-8 h-8 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={currentSVG.styles.fillColor}
                    onChange={(e) => updateSVGStyle({ fillColor: e.target.value })}
                    className="flex-1 text-xs border rounded px-2 py-1"
                  />
                </div>
              </div>

              {/* Stroke Color */}
              <div className="space-y-1">
                <label className="text-xs font-medium">Stroke Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={currentSVG.styles.strokeColor}
                    onChange={(e) => updateSVGStyle({ strokeColor: e.target.value })}
                    className="w-8 h-8 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={currentSVG.styles.strokeColor}
                    onChange={(e) => updateSVGStyle({ strokeColor: e.target.value })}
                    className="flex-1 text-xs border rounded px-2 py-1"
                  />
                </div>
              </div>

              {/* Stroke Width */}
              <div className="space-y-1">
                <label className="text-xs font-medium">Stroke Width: {currentSVG.styles.strokeWidth}px</label>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.5"
                  value={currentSVG.styles.strokeWidth}
                  onChange={(e) => updateSVGStyle({ strokeWidth: parseFloat(e.target.value) })}
                  className="slider w-full"
                />
              </div>

              {/* Opacity */}
              <div className="space-y-1">
                <label className="text-xs font-medium">Opacity: {currentSVG.styles.opacity}</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={currentSVG.styles.opacity}
                  onChange={(e) => updateSVGStyle({ opacity: parseFloat(e.target.value) })}
                  className="slider w-full"
                />
              </div>

              {/* Scale */}
              <div className="space-y-1">
                <label className="text-xs font-medium">Scale: {currentSVG.styles.scale}x</label>
                <input
                  type="range"
                  min="0.1"
                  max="3"
                  step="0.1"
                  value={currentSVG.styles.scale}
                  onChange={(e) => updateSVGStyle({ scale: parseFloat(e.target.value) })}
                  className="slider w-full"
                />
              </div>

              {/* Rotation */}
              <div className="space-y-1">
                <label className="text-xs font-medium">Rotation: {currentSVG.styles.rotation}°</label>
                <input
                  type="range"
                  min="0"
                  max="360"
                  step="1"
                  value={currentSVG.styles.rotation}
                  onChange={(e) => updateSVGStyle({ rotation: parseInt(e.target.value) })}
                  className="slider w-full"
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === "presets" && (
          <div className="p-4 h-full overflow-y-auto">
            <h3 className="font-semibold text-sm mb-3">Color Presets</h3>
            <div className="grid grid-cols-5 gap-2">
              {COLOR_PRESETS.map(preset => (
                <button
                  key={preset.name}
                  className="preset-card p-2 bg-white border border-gray-200 rounded hover:shadow-md transition-all"
                  onClick={() => {
                    if (currentSVG) {
                      updateSVGStyle({
                        fillColor: preset.value,
                        strokeColor: preset.value
                      });
                      setActiveTab("style");
                    }
                  }}
                >
                  <div
                    className="w-full h-8 rounded mb-1"
                    style={{ backgroundColor: preset.value }}
                  />
                  <div className="text-[10px] text-center">{preset.name}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <footer className="p-2 bg-gray-900 text-white flex gap-1">
        <button
          className="flex-1 py-1 text-xs bg-gray-700 rounded hover:bg-gray-600 transition-colors"
          onClick={resetStyles}
          disabled={!currentSVG || isApplying}
        >
          Reset
        </button>
        <button
          className={`flex-1 py-1 text-xs rounded transition-colors ${
            copied ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-700'
          }`}
          onClick={copySVGCode}
          disabled={!currentSVG}
        >
          {copied ? 'Copied!' : 'Copy SVG'}
        </button>
        <button
          className={`flex-1 py-1 text-xs bg-green-600 rounded hover:bg-green-700 transition-colors ${
            isApplying ? 'opacity-50 cursor-not-allowed' : ''
          }`}
          onClick={applySVGToWebflow}
          disabled={!currentSVG || isApplying}
        >
          {isApplying ? (
            <span className="flex items-center justify-center">
              <div className="loading-spinner h-3 w-3 mr-1"></div>
              Applying...
            </span>
          ) : (
            'Apply to Webflow'
          )}
        </button>
      </footer>
    </div>
  );
};

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
);
root.render(<App />);