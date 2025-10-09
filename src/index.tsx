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
          if (!currentSVG) {
            setCurrentSVG(newSVG);
            setActiveTab("style");
          }
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
          if (!currentSVG) {
            setCurrentSVG(newSVG);
            setActiveTab("style");
          }
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

  const updateSVGStyle = (updates: Partial<SVGStyle>) => {
    if (!currentSVG) return;

    setCurrentSVG(prev => prev ? {
      ...prev,
      styles: { ...prev.styles, ...updates }
    } : null);
  };

  // Fixed function - SVG ko Webflow mein properly apply karega
  const applyStyleToWebflow = async () => {
    if (!currentSVG || !selectedElement) return;

    setIsApplying(true);
    try {
      const styledSVG = applyStylesToSVG(currentSVG.svgContent, currentSVG.styles);
      
      // Webflow element ko directly SVG content set karo
      await applySVGToElement(selectedElement, styledSVG);
      
    } catch (error) {
      console.error("Error applying SVG:", error);
      alert("Failed to apply SVG style. Please try again.");
    } finally {
      setIsApplying(false);
    }
  };

  // New function - SVG ko directly Webflow element mein set karta hai
  const applySVGToElement = async (element: any, svgContent: string) => {
    try {
      // Pehle existing styles clear karo
      await clearExistingStyles(element);
      
      // Naya style create karo
      const styleName = `svg-style-${Date.now()}`;
      const newStyle = await webflow.createStyle(styleName);
      
      // SVG ko data URI mein convert karo
      const dataURI = `url("data:image/svg+xml,${encodeURIComponent(svgContent)}")`;
      
      // Background properties set karo - no-repeat ensure karo
      await newStyle.setProperties({
        'background-image': dataURI,
        'background-repeat': 'no-repeat',
        'background-position': 'center',
        'background-size': 'contain',
        'width': '100px',
        'height': '100px'
      });

      // Element ko naya style assign karo
      const currentStyles = await element.getStyles();
      const updatedStyles = Array.isArray(currentStyles) 
        ? [...currentStyles, newStyle] 
        : [newStyle];
      
      await element.setStyles(updatedStyles);
      
    } catch (error) {
      throw error;
    }
  };

  // Existing styles clear karne ka function
  const clearExistingStyles = async (element: any) => {
    try {
      const styles = await element.getStyles();
      if (styles && styles.length > 0) {
        // Sirf background-image wale styles clear karo
        for (const style of styles) {
          const properties = await style.getProperties();
          if (properties && properties['background-image']) {
            await style.setProperties({
              'background-image': 'none',
              'background-repeat': 'repeat'
            });
          }
        }
      }
    } catch (error) {
      console.log("No existing styles to clear");
    }
  };

  const applyStyle = async (property: string, value: string) => {
    const element = await webflow.getSelectedElement();
    if (!element) {
      alert("No element selected. Please select an element in the Webflow Designer.");
      return;
    }

    try {
      if (!element.styles) {
        alert("This element does not support styles.");
        return;
      }

      const styles = await element.getStyles();
      let stylesArray = [];

      if (Array.isArray(styles)) {
        stylesArray = styles;
      } else if (styles && typeof styles[Symbol.iterator] === 'function') {
        stylesArray = Array.from(styles);
      } else {
        stylesArray = [];
      }

      let targetStyle = null;
      let existingStyleWithProperty = null;

      for (const style of stylesArray) {
        const properties = await style.getProperties();
        if (properties && property in properties) {
          existingStyleWithProperty = style;
          break;
        }
      }

      if (existingStyleWithProperty) {
        targetStyle = existingStyleWithProperty;
      } else if (stylesArray.length === 1) {
        targetStyle = stylesArray[0];
      } else {
        let baseStyleName = property.replace('-', '_') + '_style';
        let styleName = baseStyleName;
        let count = 1;
        let nameIsUnique = false;

        while (!nameIsUnique) {
          try {
            const existingStyle = await webflow.getStyleByName(styleName);
            if (existingStyle) {
              styleName = `${baseStyleName}-${count}`;
              count++;
            } else {
              nameIsUnique = true;
            }
          } catch (error: any) {
            if (error.code === 404) {
              nameIsUnique = true;
            } else {
              styleName = `${property}-${Date.now()}`;
              nameIsUnique = true;
            }
          }
        }

        const newStyle = await webflow.createStyle(styleName);
        await newStyle.setProperties({ [property]: value });

        const updatedStyles = [...stylesArray, newStyle];
        await element.setStyles(updatedStyles);
        targetStyle = newStyle;
      }

      if (targetStyle) {
        const currentProperties = await targetStyle.getProperties();
        const newProperties = { ...currentProperties, [property]: value };
        await targetStyle.setProperties(newProperties);
      }
    } catch (error) {
      throw error;
    }
  };

  // Optimized SVG styling function
  const applyStylesToSVG = (svgContent: string, styles: SVGStyle): string => {
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgContent, 'image/svg+xml');
    const svgElement = svgDoc.documentElement;

    // Remove existing dimensions and attributes
    svgElement.removeAttribute('width');
    svgElement.removeAttribute('height');
    svgElement.removeAttribute('style');
    
    // Set consistent small size
    svgElement.setAttribute('width', '100');
    svgElement.setAttribute('height', '100');
    
    // Maintain aspect ratio
    const viewBox = svgElement.getAttribute('viewBox');
    if (!viewBox) {
      svgElement.setAttribute('viewBox', '0 0 24 24');
    }
    
    svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    // Apply styles
    svgElement.setAttribute('fill', styles.fillColor);
    svgElement.setAttribute('stroke', styles.strokeColor);
    svgElement.setAttribute('stroke-width', styles.strokeWidth.toString());
    svgElement.setAttribute('opacity', styles.opacity.toString());
    
    // Transform apply karo
    const transform = `scale(${styles.scale}) rotate(${styles.rotation})`;
    svgElement.setAttribute('transform', transform);

    return new XMLSerializer().serializeToString(svgElement);
  };

  const copySVGCode = () => {
    if (!currentSVG) return;

    const styledSVG = applyStylesToSVG(currentSVG.svgContent, currentSVG.styles);
    const cssCode = `background-image: url("data:image/svg+xml,${encodeURIComponent(styledSVG)}"); background-repeat: no-repeat; background-position: center; background-size: contain;`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(cssCode).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {
        copyToClipboardFallback(cssCode);
      });
    } else {
      copyToClipboardFallback(cssCode);
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
      alert("Failed to copy code. Please copy manually.");
    }
    document.body.removeChild(textarea);
  };

  const resetStyles = async () => {
    if (!currentSVG) return;
    
    // Local styles reset
    setCurrentSVG(prev => prev ? {
      ...prev,
      styles: { ...DEFAULT_SVG_STYLE }
    } : null);

    // Webflow se bhi styles clear karo
    if (selectedElement) {
      try {
        await clearExistingStyles(selectedElement);
      } catch (error) {
        console.log("Error clearing Webflow styles:", error);
      }
    }
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
            <p className="text-sm text-gray-500">Please select an element in Webflow Designer to apply SVG.</p>
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
            <div
              className={`drop-zone flex-1 flex flex-col items-center justify-center p-6 text-center ${isDragging ? 'drag-over' : ''
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

            {uploadedSVGs.length > 0 && (
              <div className="mt-4">
                <h4 className="font-semibold text-xs mb-2">Uploaded SVGs</h4>
                <div className="grid grid-cols-3 gap-2 max-h-24 overflow-y-auto scrollbar-thin">
                  {uploadedSVGs.map(svg => (
                    <button
                      key={svg.id}
                      className="preset-card p-1 bg-white border border-gray-200 rounded hover:shadow-md transition-all"
                      onClick={() => selectSVG(svg)}
                    >
                      <div 
                        className="h-8 w-full bg-gray-100 rounded flex items-center justify-center"
                        style={{ 
                          width: '100%', 
                          height: '32px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                        dangerouslySetInnerHTML={{ 
                          __html: applyStylesToSVG(svg.svgContent, { ...DEFAULT_SVG_STYLE, scale: 0.3 }) 
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
          <div className="p-4 h-full overflow-y-auto scrollbar-thin">
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
                    className="color-picker"
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
                    className="color-picker"
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
          <div className="p-4 h-full overflow-y-auto scrollbar-thin">
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
          className={`flex-1 py-1 text-xs rounded transition-colors ${copied ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          onClick={copySVGCode}
          disabled={!currentSVG}
        >
          {copied ? 'Copied!' : 'Copy CSS'}
        </button>
        <button
          className={`flex-1 py-1 text-xs bg-green-600 rounded hover:bg-green-700 transition-colors ${isApplying ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          onClick={applyStyleToWebflow}
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
