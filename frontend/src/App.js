import React, { useState, useRef, useCallback, useEffect } from "react";
import "./App.css";

// ─── YAML-style text parser ────────────────────────────────────────────────
// Converts the AI agent's plain-text output into a structured JS object.
// Handles indented key: value pairs and bullet-list arrays (- item).
function parseAITextOutput(text) {
  if (!text || typeof text !== "string") return null;

  const result = {};
  const lines = text.split("\n");
  let currentSection = null;        // top-level key
  let currentSubSection = null;     // second-level key
  let currentSubSubSection = null;  // third-level key
  let inArray = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trimEnd();
    if (!trimmed) continue;

    // Count leading spaces to determine depth
    const indent = raw.length - raw.trimStart().length;
    const content = raw.trim();

    // Skip section header lines like "customer_output:" or "developer_output:"
    if ((content === "customer_output:" || content === "developer_output:") && indent === 0) {
      currentSection = content.replace(":", "");
      result[currentSection] = {};
      currentSubSection = null;
      currentSubSubSection = null;
      inArray = false;
      continue;
    }

    // Bullet list item (array element)
    if (content.startsWith("- ") && inArray) {
      const arrVal = content.slice(2).replace(/^["']|["']$/g, "");
      if (currentSubSubSection && currentSubSection && currentSection) {
        if (!Array.isArray(result[currentSection][currentSubSection][currentSubSubSection])) {
          result[currentSection][currentSubSection][currentSubSubSection] = [];
        }
        result[currentSection][currentSubSection][currentSubSubSection].push(arrVal);
      } else if (currentSubSection && currentSection) {
        if (!Array.isArray(result[currentSection][currentSubSection])) {
          result[currentSection][currentSubSection] = [];
        }
        result[currentSection][currentSubSection].push(arrVal);
      }
      continue;
    }

    // Key: value line
    const colonIdx = content.indexOf(":");
    if (colonIdx === -1) continue;

    const key = content.slice(0, colonIdx).trim();
    const val = content.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");

    if (!currentSection) continue;

    if (indent <= 2) {
      // depth-1 key inside a top-level section
      currentSubSection = key;
      currentSubSubSection = null;
      inArray = false;
      if (val === "" || val === null) {
        result[currentSection][key] = {};
        inArray = false;
      } else {
        result[currentSection][key] = val;
      }
    } else if (indent <= 4) {
      // depth-2 key
      currentSubSubSection = key;
      inArray = false;
      if (!currentSubSection) continue;
      if (typeof result[currentSection][currentSubSection] !== "object" || Array.isArray(result[currentSection][currentSubSection])) {
        result[currentSection][currentSubSection] = {};
      }
      if (val === "") {
        result[currentSection][currentSubSection][key] = {};
        inArray = false;
      } else if (val === "null") {
        result[currentSection][currentSubSection][key] = null;
      } else {
        result[currentSection][currentSubSection][key] = val;
      }
    } else {
      // depth-3+ (array items inside sub-subsection or plain value)
      if (!currentSubSection || !currentSubSubSection) continue;
      if (content.startsWith("- ")) {
        inArray = true;
        const arrVal = content.slice(2).replace(/^["']|["']$/g, "");
        if (!Array.isArray(result[currentSection][currentSubSection][currentSubSubSection])) {
          result[currentSection][currentSubSection][currentSubSubSection] = [];
        }
        result[currentSection][currentSubSection][currentSubSubSection].push(arrVal);
      } else {
        if (typeof result[currentSection][currentSubSection][currentSubSubSection] !== "object") {
          result[currentSection][currentSubSection][currentSubSubSection] = {};
        }
        if (val === "null") {
          result[currentSection][currentSubSection][currentSubSubSection][key] = null;
        } else {
          result[currentSection][currentSubSection][currentSubSubSection][key] = val;
        }
      }
    }

    // detect array start (value is empty and the next line starts with "- ")
    if (val === "" && i + 1 < lines.length && lines[i + 1].trim().startsWith("- ")) {
      inArray = true;
    }
  }
  return result;
}

// ─── Extract workflow_execution from the raw AI text ──────────────────────
function extractWorkflow(text) {
  if (!text || typeof text !== "string") return [];

  // Normalise line endings
  const normalised = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const wfStart = normalised.indexOf("workflow_execution:");
  if (wfStart === -1) return [];

  const wfBlock = normalised.slice(wfStart);

  // Try bullet list format first:  - "Some step"
  const bullets = wfBlock.match(/^\s*-\s+["']?(.+?)["']?\s*$/gm) || [];
  if (bullets.length > 0) {
    return bullets
      .map((b) => b.replace(/^\s*-\s+/, "").replace(/^"|"$|^'|'$/g, "").trim())
      .filter(Boolean);
  }

  // Fallback: comma-separated values on one line after the key
  // e.g.  workflow_execution: step1,step2,step3
  const inlineMatch = wfBlock.match(/workflow_execution:\s*(.+)/);
  if (inlineMatch) {
    return inlineMatch[1]
      .split(",")
      .map((s) => s.replace(/^"|"$|^'|'$/g, "").trim())
      .filter(Boolean);
  }

  return [];
}

// ─── Render nested objects as flat rows for the Tech Panel ────────────────
function flattenObj(obj, prefix = "") {
  const rows = [];
  if (obj === null || obj === undefined) return rows;
  if (typeof obj !== "object" || Array.isArray(obj)) {
    rows.push({ key: prefix, value: Array.isArray(obj) ? obj.join(", ") : String(obj ?? "N/A") });
    return rows;
  }
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined) {
      rows.push({ key: fullKey, value: "N/A" });
    } else if (Array.isArray(v)) {
      rows.push({ key: fullKey, value: v.join(" → ") });
    } else if (typeof v === "object") {
      rows.push(...flattenObj(v, fullKey));
    } else {
      rows.push({ key: fullKey, value: String(v) });
    }
  }
  return rows;
}

// ─── Format Object into a user-friendly string ──────────────────────────
function formatObjectFriendly(key, obj) {
  if (obj === null || obj === undefined) return "N/A";
  if (Array.isArray(obj)) {
    if (obj.length === 0) return "Empty List";
    return obj.map(item => typeof item === "object" ? JSON.stringify(item) : String(item)).join(", ");
  }

  // Check for empty object
  if (Object.keys(obj).length === 0) return "None";

  // Check for standard limit/used summaries (like myPackageSummary, vasDataSummary, etc.)
  if (typeof obj.limit === "number" && typeof obj.used === "number") {
    const unit = obj.volumeUnit || "GB";
    return `Limit: ${obj.limit} ${unit} | Used: ${obj.used} ${unit}`;
  }

  // Special handling for myPackageInfo
  if (key === "myPackageInfo") {
    const name = obj.packageName || "N/A";
    const details = obj.usageDetails && obj.usageDetails.length > 0
      ? ` (${obj.usageDetails.length} usage profiles)`
      : "";
    return `${name}${details}`;
  }

  // Fallback: pretty print key-value pairs of the object
  return Object.entries(obj)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" | ");
}

// ─── Status badge colour ──────────────────────────────────────────────────
function statusColor(val) {
  if (!val) return "";
  const v = String(val).toLowerCase();

  // Check red conditions first to prevent "inactive" triggering "active"
  if (["inactive", "offline", "failed", "error", "fault", "throttled"].some((k) => v.includes(k))) return "badge-red";
  if (["active", "online", "healthy", "passed", "ok", "normal"].some((k) => v.includes(k))) return "badge-green";
  if (["unknown", "n/a", "none"].some((k) => v.includes(k))) return "badge-grey";
  return "badge-blue";
}

// Helper to resolve API URLs dynamically based on client access host
const getApiUrl = (path) => {
  const hostname = window.location.hostname;
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
  // In production, Nginx reverse proxy handles routing — API is on the same origin
  const base = isLocal ? "http://localhost:8000" : `${window.location.protocol}//${hostname}`;
  return `${base}${path}`;
};

// ═══════════════════════════════════════════════════════════════════════════
function App() {
  const [selectedAgent, setSelectedAgent] = useState("");
  const [subscriberId, setSubscriberId] = useState("");
  const [allAgentMessages, setAllAgentMessages] = useState({}); // per-agent chat history
  const [loading, setLoading] = useState(false);
  const [apiData, setApiData] = useState(null);      // raw HTTP node data
  const [devOutput, setDevOutput] = useState(null);      // parsed developer_output

  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Derived: messages for the currently selected agent
  const chatMessages = allAgentMessages[selectedAgent] || [];

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages, loading]);

  // Helper to append messages to the active agent's history
  const appendMessage = (agent, msg) => {
    setAllAgentMessages(prev => ({
      ...prev,
      [agent]: [...(prev[agent] || []), msg],
    }));
  };

  // Switch agent: clear input, preserve each agent's history
  const handleSelectAgent = (agent) => {
    setSelectedAgent(agent);
    setSubscriberId("");

    const agentMessages = allAgentMessages[agent] || [];
    let lastApiData = null;
    let lastDevOutput = null;

    for (let i = agentMessages.length - 1; i >= 0; i--) {
      const msg = agentMessages[i];
      if (msg.role === "assistant" && (msg.apiDataRaw || msg.devOutputRaw)) {
        lastApiData = msg.apiDataRaw || null;
        lastDevOutput = msg.devOutputRaw || null;
        break;
      }
    }

    setApiData(lastApiData);
    setDevOutput(lastDevOutput);
  };

  // ── Resizer State ────────────────────────────────────────────────────────
  const [techPanelWidth, setTechPanelWidth] = useState(500);
  const isResizing = useRef(false);

  const resize = useCallback((e) => {
    if (isResizing.current) {
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth > 300 && newWidth < 1200) {
        setTechPanelWidth(newWidth);
      }
    }
  }, []);

  const stopResizing = useCallback(() => {
    isResizing.current = false;
    document.body.style.cursor = 'default';
    document.body.style.userSelect = 'auto';
    document.removeEventListener('mousemove', resize);
    document.removeEventListener('mouseup', stopResizing);
  }, [resize]);

  const startResizing = useCallback((e) => {
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', resize);
    document.addEventListener('mouseup', stopResizing);
  }, [resize, stopResizing]);

  // ── Build the rows shown in the Tech Panel ────────────────────────────────
  const buildTechRows = (api, dev) => {
    const rows = [];

    // Section 1 — API Data: fully flatten all nested objects into individual rows
    if (api && typeof api === "object") {
      for (const [k, v] of Object.entries(api)) {
        if (v === null || v === undefined) {
          rows.push({ key: k, value: "N/A" });
        } else if (typeof v === "object" && !Array.isArray(v)) {
          // Empty object → single "None" row
          if (Object.keys(v).length === 0) {
            rows.push({ key: k, value: "None" });
          } else {
            // Non-empty object → expand each sub-field as its own row with indent marker
            rows.push({ key: k, value: null, isSection: true }); // section header
            for (const [sk, sv] of Object.entries(v)) {
              if (Array.isArray(sv)) {
                // Array items (e.g. usageDetails) — each element on own row
                sv.forEach((item, idx) => {
                  if (typeof item === "object") {
                    rows.push({ key: sk, value: null, isSection: true, isSubSection: true });
                    for (const [ik, iv] of Object.entries(item)) {
                      rows.push({ key: ik, value: String(iv ?? "N/A"), isIndented: true, isDoubleIndented: true });
                    }
                  } else {
                    rows.push({ key: sk, value: String(item ?? "N/A"), isIndented: true });
                  }
                });
              } else if (typeof sv === "object" && sv !== null) {
                rows.push({ key: `  ${sk}`, value: formatObjectFriendly(sk, sv), isIndented: true });
              } else {
                rows.push({ key: `  ${sk}`, value: String(sv ?? "N/A"), isIndented: true });
              }
            }
          }
        } else if (Array.isArray(v)) {
          rows.push({ key: k, value: v.join(", ") });
        } else {
          rows.push({ key: k, value: String(v) });
        }
      }
    }

    // Section 2 — Developer Output fields (flat, no workflow_execution)
    // Removed per user request

    return rows;
  };

  const agents = [
    "Main Agent",
    "Usage Agent",
    "Email Solution Agent",
    "Configuration Agent",
  ];

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!selectedAgent) {
      alert("Please select an agent first");
      return;
    }

    if (selectedAgent === "Email Solution Agent") {
      if (!subscriberId.trim()) {
        alert("Please enter a message for the Email Agent");
        return;
      }

      const userMsg = subscriberId;
      setSubscriberId("");

      // Instantly show the user's message bubble
      appendMessage(selectedAgent, { role: "user", content: userMsg });

      // Clear old technical details while loading
      setApiData(null);
      setDevOutput(null);
      setLoading(true);

      try {
        const response = await fetch(getApiUrl("/email-chat"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: userMsg,
            user_id: "020601",
            thread_id: "default_thread",
          }),
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();
        if (data.error) throw new Error(data.error);

        appendMessage(selectedAgent, { role: "assistant", content: data.reply, isEmailAgent: true });
      } catch (error) {
        console.error("Error:", error);
        appendMessage(selectedAgent, { role: "assistant", content: `Error: ${error.message}`, isEmailAgent: true });
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!subscriberId) {
      alert("Please enter a Subscriber ID or Customer ID");
      return;
    }

    // Determine label based on format: numeric = Subscriber ID, ACC-prefix = Customer ID
    const idLabel = /^\d+$/.test(subscriberId.trim()) ? "Subscriber ID" : "Customer ID";

    // Instantly show the user's message bubble, appending to previous chats
    appendMessage(selectedAgent, { role: "user", content: `${idLabel} : ${subscriberId}` });

    // Clear old technical details while loading
    setApiData(null);
    setDevOutput(null);

    setLoading(true);

    try {
      const response = await fetch(getApiUrl("/support-query"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: selectedAgent,
          subscriber_id: subscriberId,
          query: "",
        }),
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();
      console.log("Full backend response:", JSON.stringify(data, null, 2));

      // Handle backend or n8n errors gracefully
      if (data.status === "error" || data.error) {
        const errMsg = data.reply || data.message || data.error || "An error occurred during analysis.";
        appendMessage(selectedAgent, {
          role: "assistant",
          content: `❌ ${errMsg}`,
          workflow: []
        });
        setSubscriberId("");
        setLoading(false);
        return;
      }

      // ── 1. Store raw api_data from HTTP node ──────────────────────────
      const rawApiData = data.api_data || null;
      setApiData(rawApiData);

      // ── 2. Parse AI output ───────────────────────────────────────────
      let workflow = [];
      let parsedDev = null;
      let chatMessage = "";

      const aiRaw = data.ai_analysis;

      // Extract customer summary robustly
      let customerSummary = "";
      if (aiRaw && aiRaw.customer_output && aiRaw.customer_output.summary) {
        let rawSummary = aiRaw.customer_output.summary;
        if (typeof rawSummary === "string") {
          try {
            const parsed = JSON.parse(rawSummary);
            if (parsed) {
              const parts = [];
              if (parsed.summary) parts.push(parsed.summary);
              if (parsed.next_steps) parts.push(parsed.next_steps);

              if (parts.length > 0) {
                customerSummary = parts.join(" ");
              } else if (parsed.customer_output?.summary) {
                customerSummary = parsed.customer_output.summary;
                if (parsed.customer_output.next_steps) customerSummary += " " + parsed.customer_output.next_steps;
              }
            }
          } catch (e) {
            // Ignore parse error
          }

          // If JSON parse failed or didn't populate it, use aggressive text cleanup
          if (!customerSummary) {
            customerSummary = rawSummary
              .replace(/[{}"\\]/g, "")
              .replace(/(?:^|\n)\s*(?:summary|next_steps|customer_output)\s*:/g, "")
              .replace(/\n+/g, " ")
              .trim();
          }
        } else if (typeof rawSummary === "object") {
          const parts = [];
          if (rawSummary.summary) parts.push(rawSummary.summary);
          if (rawSummary.next_steps) parts.push(rawSummary.next_steps);
          customerSummary = parts.length > 0 ? parts.join(" ") : String(rawSummary);
        }
      }

      if (customerSummary) {
        // Automatically strip out any semicolons as requested
        customerSummary = customerSummary.replace(/;/g, "");
        // Remove leftover keys like "summary:", "- summary:", "next_steps:"
        customerSummary = customerSummary.replace(/(?:-\s*)?(?:summary|next_steps|customer_output)\s*:/gi, "").trim();
        chatMessage = `💡 ${customerSummary}\n\n`;
      }
      chatMessage += `${idLabel} ${subscriberId} — analysis complete. See Technical Details`;

      // Helper: extract from a string (raw AI text)
      const extractFromString = (str) => {
        const parsed = parseAITextOutput(str);
        const wf = extractWorkflow(str);
        return {
          dev: parsed?.developer_output || null,
          wf,
        };
      };

      if (data.output && typeof data.output === "string") {
        // ── Shape: { output: "...yaml text..." }  (N8N array unwrapped by backend)
        const { dev, wf } = extractFromString(data.output);
        parsedDev = dev;
        workflow = wf;

      } else if (typeof aiRaw === "string") {
        // ── Shape: { ai_analysis: "...yaml text...", api_data: {...} }
        const { dev, wf } = extractFromString(aiRaw);
        parsedDev = dev;
        workflow = wf;

      } else if (aiRaw && typeof aiRaw === "object") {
        // ── Shape: { ai_analysis: { developer_output: {...} }, api_data: {...} }
        parsedDev = aiRaw.developer_output || null;
        // workflow may be array or comma-string inside developer_output
        const wfRaw = parsedDev?.workflow_execution;
        if (Array.isArray(wfRaw)) {
          workflow = wfRaw;
        } else if (typeof wfRaw === "string") {
          workflow = wfRaw.split(",").map(s => s.trim()).filter(Boolean);
        }
      }

      // ── Last resort: check if api_data itself has workflow_execution
      if (workflow.length === 0 && data.api_data?.workflow_execution) {
        const wfRaw = data.api_data.workflow_execution;
        workflow = Array.isArray(wfRaw) ? wfRaw :
          typeof wfRaw === "string" ? wfRaw.split(",").map(s => s.trim()) : [];
      }

      // ── Deep search: scan ALL string values in the response for workflow_execution
      // This catches cases where N8N buries the AI text inside summary/other fields
      if (workflow.length === 0) {
        const deepSearch = (obj) => {
          if (!obj || typeof obj !== "object") return "";
          for (const val of Object.values(obj)) {
            if (typeof val === "string" && val.includes("workflow_execution")) return val;
            if (typeof val === "object") {
              const found = deepSearch(val);
              if (found) return found;
            }
          }
          return "";
        };
        const foundText = deepSearch(data);
        if (foundText) {
          workflow = extractWorkflow(foundText);
          console.log("[DEBUG] workflow found via deep search:", workflow);
        }
      }

      // ── Collapse the first 3 boilerplate N8N init steps into "Session Started"
      // These steps are always the same internal setup steps, not meaningful to display.
      const BOILERPLATE_STEPS = [
        "webhook triggered",
        "send post request",
        "code in javascript node",
      ];
      const isBoilerplate = (step) =>
        BOILERPLATE_STEPS.some((b) => step.toLowerCase().includes(b));

      let sessionInserted = false;
      const cleanedWorkflow = [];

      const cleanStepText = (step) => {
        // Removes ANY quotes, braces, brackets, replaces underscores with spaces, and trims whitespace
        return step.replace(/[\]}"'\[{]/g, "").replace(/_/g, " ").trim();
      };

      for (const step of workflow) {
        if (isBoilerplate(step)) {
          if (!sessionInserted) {
            cleanedWorkflow.push("🟢 Session Started");
            sessionInserted = true;
          }
          // skip the raw boilerplate step
        } else {
          cleanedWorkflow.push(cleanStepText(step));
        }
      }
      // If nothing was boilerplate but we still have steps, prepend Session Started
      if (!sessionInserted && cleanedWorkflow.length > 0) {
        cleanedWorkflow.unshift("🟢 Session Started");
      }

      setDevOutput(parsedDev);

      // Detect if subscriber ID is invalid/not found in the SLT APIs
      // A valid response has rawApiData as a non-empty object with real data keys.
      // An invalid/not-found response is null, empty, or contains only error/status metadata.
      const ERROR_ONLY_KEYS = new Set(["error", "status", "message", "errorCode", "errorMessage"]);
      const hasRealData = rawApiData &&
                          typeof rawApiData === "object" &&
                          Object.keys(rawApiData).length > 0 &&
                          Object.keys(rawApiData).some(k => !ERROR_ONLY_KEYS.has(k));

      // Also check if the API explicitly returned an error status
      const apiHasError = rawApiData &&
                          (rawApiData.error || 
                           (rawApiData.status && String(rawApiData.status).toLowerCase().includes("error")) ||
                           (rawApiData.errorCode && String(rawApiData.errorCode) !== "0"));

      if (!hasRealData || apiHasError) {
        // Clear technical data so the Tech Panel does not appear
        setApiData(null);
        setDevOutput(null);
        appendMessage(selectedAgent, {
          role: "assistant",
          content: "💡 The ID entered could not be found. Please verify the Subscriber ID or Customer ID and try again.",
          workflow: []
        });
        setSubscriberId("");
        setLoading(false);
        return;
      }

      const messageTechDetails = buildTechRows(rawApiData, parsedDev);

      appendMessage(selectedAgent, {
        role: "assistant",
        content: chatMessage,
        workflow: cleanedWorkflow,
        techDetails: messageTechDetails,
        apiDataRaw: rawApiData,
        devOutputRaw: parsedDev
      });

      setSubscriberId("");
    } catch (error) {
      console.error("Error:", error);
      appendMessage(selectedAgent, { role: "assistant", content: `Error: ${error.message}`, workflow: [] });
    }

    setLoading(false);
  };

  const techRows = buildTechRows(apiData, devOutput);

  // ── Render Dashboard (Dynamic vs Static) ─────────────────────────────────
  const renderTechDashboard = () => {
    const formatValue = (prefix, keys) => {
      let isPresent = false;
      let val = "UNKNOWN"; // Default to UNKNOWN if not found or empty

      const resolvePath = (obj, path) => {
        if (!obj) return undefined;
        const parts = path.split('.');
        let current = obj;
        for (const part of parts) {
          if (current === null || current === undefined) return undefined;
          current = current[part];
        }
        return current;
      };

      for (const key of keys) {
        let apiVal = resolvePath(apiData, key);
        let devVal = resolvePath(devOutput, key);

        if (apiVal !== undefined && apiVal !== null && String(apiVal).trim() !== "") {
          isPresent = true;
          val = typeof apiVal === "object"
            ? formatObjectFriendly(key.split('.').pop(), apiVal)
            : String(apiVal);
          break;
        }

        if (devVal !== undefined && devVal !== null && String(devVal).trim() !== "") {
          isPresent = true;
          val = typeof devVal === "object"
            ? formatObjectFriendly(key.split('.').pop(), devVal)
            : String(devVal);
          break;
        }
      }

      if (!isPresent) {
        return (
          <div className="value-row">
            {prefix && <span className="value-prefix">{prefix.replace(/_/g, " ")}</span>}
            <span className="badge-grey">UNKNOWN</span>
          </div>
        );
      }

      return (
        <div className="value-row">
          {prefix && <span className="value-prefix">{prefix.replace(/_/g, " ")}</span>}
          <span className={`value-text ${statusColor(val)}`}>{val.replace(/_/g, " ")}</span>
        </div>
      );
    };

    const renderRawObject = (prefix, keys) => {
      let isPresent = false;
      let objVal = null;
      const resolvePath = (obj, path) => {
        if (!obj) return undefined;
        const parts = path.split('.');
        let current = obj;
        for (const part of parts) {
          if (current === null || current === undefined) return undefined;
          current = current[part];
        }
        return current;
      };

      for (const key of keys) {
        let val = resolvePath(apiData, key) || resolvePath(devOutput, key);
        if (val !== undefined && val !== null) {
          isPresent = true;
          objVal = val;
          break;
        }
      }

      if (!isPresent) {
        return (
          <div className="value-row">
            {prefix && <span className="value-prefix">{prefix.replace(/_/g, " ")}</span>}
            <span className="badge-grey">UNKNOWN</span>
          </div>
        );
      }

      const renderNode = (node, depth = 0) => {
        if (node === null || node === undefined) return <span style={{ color: '#94a3b8' }}>N/A</span>;
        if (typeof node !== 'object') return <span style={{ color: '#0f172a', fontWeight: '500' }}>{String(node)}</span>;

        if (Array.isArray(node)) {
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px', width: '100%' }}>
              {node.map((item, idx) => (
                <div key={idx} style={{ paddingLeft: '12px', borderLeft: '2px solid #cbd5e1', width: '100%' }}>
                  {renderNode(item, depth + 1)}
                </div>
              ))}
            </div>
          );
        }

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: depth === 0 ? '0' : '4px', width: '100%' }}>
            {Object.entries(node).map(([k, v], idx) => (
              <div key={idx} style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: '#475569', fontWeight: '600', minWidth: '100px', wordBreak: 'break-word' }}>{k}</span>
                <div style={{ flex: 1, fontSize: '13px', wordBreak: 'break-word' }}>
                  {renderNode(v, depth + 1)}
                </div>
              </div>
            ))}
          </div>
        );
      };

      return (
        <div className="value-row" style={{ flexDirection: 'column', alignItems: 'flex-start', padding: '10px 12px', width: '100%' }}>
          {prefix && <span className="value-prefix" style={{ marginBottom: '8px', borderBottom: '1px solid #e2e8f0', paddingBottom: '4px', width: '100%' }}>{prefix.replace(/_/g, " ")}</span>}
          <div style={{ width: '100%' }}>
            {renderNode(objVal)}
          </div>
        </div>
      );
    };

    return (
      <div className="tech-dashboard">
        <div className="tech-column">
          <h4>Dynamic Data</h4>

          <div className="tech-group">
            <h5>LDAP</h5>
            <div className="tech-item"><span className="label">Package details:</span><span className="value">{formatValue("LDAP_Package", ["LDAP_Package", "Package"])}</span></div>
            <div className="tech-item"><span className="label">Account Status:</span><span className="value">{formatValue("Account_Status", ["Account_Status", "LDAP_Status", "ldap_status"])}</span></div>
            <div className="tech-item"><span className="label">Online Status:</span><span className="value">{formatValue("Online_Status", ["Online_Status", "online_status"])}</span></div>
          </div>

          <div className="tech-group">
            <h5>VAS</h5>
            <div className="tech-item multi-row" style={{ width: '100%' }}><span className="label">Package details:</span><span className="value" style={{ width: '100%', gap: '12px' }}>
              {renderRawObject("Info", ["dashboardSummaryResponse.myPackageInfo", "myPackageInfo"])}
              {renderRawObject("Summary", ["dashboardSummaryResponse.myPackageSummary", "myPackageSummary"])}
            </span></div>
            <div className="tech-item"><span className="label">Status:</span><span className="value">{formatValue("", ["dashboardSummaryResponse.status", "status"])}</span></div>
            <div className="tech-item"><span className="label">Extra GB:</span><span className="value">{formatValue("", ["dashboardSummaryResponse.extraGbDataSummary", "extraGbDataSummary"])}</span></div>
            <div className="tech-item"><span className="label">Addons:</span><span className="value">{formatValue("", ["dashboardSummaryResponse.addons", "addons"])}</span></div>
          </div>

          <div className="tech-group">
            <h5>NMS</h5>
            <div className="tech-item"><span className="label">Line status:</span><span className="value">{formatValue("NMS_service_port_status", ["NMS_service_port_status", "nms_service_port_status"])}</span></div>
            <div className="tech-item multi-row"><span className="label">Line conditions:</span><span className="value">{formatValue("RX_Power_Level", ["RX_Power_Level", "rx_power"])}{formatValue("TX_Power_Level", ["TX_Power_Level", "tx_power"])}{formatValue("PON_Status", ["PON_Status", "pon_status"])}</span></div>
          </div>

          <div className="tech-group">
            <h5>IPTV</h5>
            <div className="tech-item multi-row"><span className="label">Package:</span><span className="value">{formatValue("PEOTV_1_Status", ["PEOTV_1_Status"])}{formatValue("PEOTV_2_Status", ["PEOTV_2_Status"])}{formatValue("PEOTV_3_Status", ["PEOTV_3_Status"])}{formatValue("Service_status_IPTV", ["Service_status_IPTV"])}</span></div>
            <div className="tech-item"><span className="label">MAC:</span><span className="value">{formatValue("STB_MAC", ["STB_MAC", "stb_mac"])}</span></div>
          </div>

          <div className="tech-group">
            <h5>Billing Details</h5>
            <div className="tech-item"><span className="label">Status:</span><span className="value">{formatValue("Billing_Status", ["Billing_Status", "billing_status"])}</span></div>
            <div className="tech-item"><span className="label">Total bill:</span><span className="value">{formatValue("Total_bill", ["Total_bill", "total_bill"])}</span></div>
            <div className="tech-item"><span className="label">Last month’s bill:</span><span className="value">{formatValue("Last_month_bill", ["Last_month_bill", "last_month_bill"])}</span></div>
          </div>
        </div>

        <div className="tech-column">
          <h4>Static Data</h4>

          <div className="tech-group">
            <h5>Customer Details</h5>
            <div className="tech-item"><span className="label">Name:</span><span className="value">{formatValue("", ["dashboardSummaryResponse.name", "name"])}</span></div>
            <div className="tech-item"><span className="label">Contact number:</span><span className="value">{formatValue("", ["dashboardSummaryResponse.phone", "phone"])}</span></div>
          </div>

          <div className="tech-group">
            <h5>Fault History</h5>
            <div className="tech-item multi-row"><span className="label">Recent fault:</span><span className="value">{formatValue("Existing_faults_BB", ["Existing_faults_BB"])}{formatValue("Existing_faults_Voice", ["Existing_faults_Voice"])}{formatValue("Existing_faults_IPTV", ["Existing_faults_IPTV"])}{formatValue("NW_faults", ["NW_faults"])}</span></div>
            <div className="tech-item"><span className="label">Faults per month:</span><span className="value">{formatValue("Faults_per_month", ["Faults_per_month"])}</span></div>
          </div>

          <div className="tech-group">
            <h5>Equipment Details</h5>
            <div className="tech-item multi-row"><span className="label">Brand and model:</span><span className="value">{formatValue("ONT_Model", ["ONT_Model", "ont_model"])}{formatValue("ONT_Type", ["ONT_Type", "ont_type"])}</span></div>
            <div className="tech-item"><span className="label">Serial number:</span><span className="value">{formatValue("ONT_Serial_No", ["ONT_Serial_No", "ont_serial_no", "serial", "Serial"])}</span></div>
          </div>
        </div>
      </div>
    );
  };

  const formatMarkdownToHTML = (text) => {
    let html = text;
    // Replace bold syntax **text** with <strong>text</strong>
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Replace link syntax [text](url) with a clickable link <a href="url">text</a>
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return html;
  };

  const renderMessageContent = (msg) => {
    if (!msg || !msg.content) return null;
    const content = msg.content;

    if (msg.isEmailAgent) {
      return (
        <div className="email-agent-response">
          {content.split("\n").map((line, i) => (
            <div
              key={i}
              className="message-line"
              dangerouslySetInnerHTML={{ __html: formatMarkdownToHTML(line) }}
            />
          ))}
        </div>
      );
    }

    // Check if this is a final summary message
    const isSummary = content.includes("analysis complete") || content.includes("💡");

    const sections = content.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);

    return (
      <div className={isSummary ? "summary-container" : ""}>
        {sections.map((section, idx) => {
          const subIdRegex = /(ACC\d+)/g;
          const parts = section.split(subIdRegex);
          return (
            <div key={idx} className="message-line">
              {parts.map((part, i) => {
                if (subIdRegex.test(part)) {
                  return <strong key={i} className="sub-id-highlight">{part}</strong>;
                }
                return part;
              })}
            </div>
          );
        })}
      </div>
    );
  };

  const isEmailAgentSelected = selectedAgent === "Email Solution Agent";
  const NON_IMPLEMENTED = ["Main Agent", "Usage Agent"];
  const isNonImplemented = NON_IMPLEMENTED.includes(selectedAgent);

  // Show Tech Panel only when it's not email, not non-implemented, and user entered subscriber ID (data is loaded or loading)
  const showTechPanel = !isEmailAgentSelected && !isNonImplemented && (apiData !== null || devOutput !== null || loading);

  return (
    <div
      className="container"
      style={{
        gridTemplateColumns: showTechPanel
          ? `240px 1fr 6px ${techPanelWidth}px`
          : "240px 1fr",
      }}
    >

      {/* ── Sidebar ───────────────────────────────────────────────────── */}
      <div className="sidebar">
        <div className="logo">SLTMobitel Support</div>

        <h2>Agent Selector</h2>

        {agents.map((agent, index) => (
          <div
            key={index}
            className={`agent-card ${selectedAgent === agent ? "selected" : ""}`}
            onClick={() => handleSelectAgent(agent)}
          >
            {agent}
          </div>
        ))}
      </div>

      {/* ── Chat Section ──────────────────────────────────────────────── */}
      <div className="chat-section">
        {!selectedAgent ? (
          <div className="welcome-hero-container">
            <div className="welcome-hero-card">
              <div className="welcome-hero-logo">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h1 className="welcome-hero-title">SLTMobitel Support</h1>
              <p className="welcome-hero-subtitle">Intelligent Backoffice Assistant</p>
              <div className="welcome-hero-divider"></div>
              <p className="welcome-hero-instruction">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12"></line>
                  <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
                Please select an agent from the sidebar to begin.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Dynamic header */}
            <div className={`chat-header ${isEmailAgentSelected || isNonImplemented ? "centered-header" : ""}`}>
              {isEmailAgentSelected
                ? "BACKOFFICE EMAIL"
                : isNonImplemented
                  ? selectedAgent.toUpperCase()
                  : "Technical Support Assistant"}
            </div>

            {/* Non-implemented agents: blank body, no chat UI */}
            {isNonImplemented ? (
              <div className="chat-box blank-chat-box"></div>
            ) : (
              <>
                {/* Chat messages area */}
                <div className={`chat-box ${isEmailAgentSelected ? "email-chat-box" : ""}`}>
                  {selectedAgent === "Configuration Agent" && chatMessages.length === 0 ? (
                    <div className="agent-empty-state">
                      <div className="agent-empty-icon config-icon">
                        <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                        </svg>
                      </div>
                      <h2 className="agent-empty-title">Configuration Diagnostics</h2>
                      <p className="agent-empty-subtitle">Enter a Subscriber ID or Customer ID to begin the diagnostic analysis.</p>
                    </div>
                  ) : isEmailAgentSelected && chatMessages.length === 0 ? (
                    <div className="agent-empty-state">
                      <div className="agent-empty-icon email-icon">
                        <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                          <polyline points="22,6 12,13 2,6"></polyline>
                        </svg>
                      </div>
                      <h2 className="agent-empty-title">Email Solution Assistant</h2>
                      <p className="agent-empty-subtitle">Describe the customer's email issue. I'll analyze the symptoms and provide real-time troubleshooting steps.</p>
                    </div>
                  ) : (
                    chatMessages.map((msg, index) => {
                      const isLatestMessageAndAssistant = index === chatMessages.length - 1 && msg.role === "assistant";

                      if (isEmailAgentSelected) {
                        // Email Agent: Full-width rectangle card layout
                        const isUser = msg.role === "user";
                        return (
                          <div
                            key={index}
                            className={`email-msg-card ${isUser ? "email-msg-user" : "email-msg-assistant"}`}
                          >
                            <div className="email-msg-avatar">
                              {isUser ? "👤" : "🤖"}
                            </div>
                            <div className="email-msg-text">
                              {renderMessageContent(msg)}
                            </div>
                          </div>
                        );
                      }

                      // Other agents: original bubble layout
                      return (
                        <div
                          key={index}
                          className={msg.role === "assistant" ? "message assistant" : "message user"}
                        >
                          <div className="message-avatar">
                            {msg.role === "user" ? "👤" : "🤖"}
                          </div>
                          <div className="message-content">
                            {renderMessageContent(msg)}
                          </div>

                          {msg.workflow && msg.workflow.length > 0 && (
                            <div className="workflow-section">
                              <strong>⚙ Workflow Execution:</strong>
                              <ul>
                                {msg.workflow.map((step, i) => (
                                  <li key={i}>{step}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {msg.techDetails && msg.techDetails.length > 0 && !isLatestMessageAndAssistant && (
                            <details className="chat-tech-details">
                              <summary>View Technical Details</summary>
                              <div className="tech-data">
                                {msg.techDetails.map((row, i) => {
                                  if (row.isSection && !row.isSubSection) {
                                    return (
                                      <div key={i} className="tech-row tech-section-header">
                                        <span className="tech-section-label">{row.key.trim()}</span>
                                      </div>
                                    );
                                  }
                                  if (row.isSubSection) {
                                    return (
                                      <div key={i} className="tech-row tech-row-indented tech-subsection-header">
                                        <span className="tech-subsection-label">{row.key.trim()}</span>
                                      </div>
                                    );
                                  }
                                  let rowClass = "tech-row";
                                  if (row.isDoubleIndented) {
                                    rowClass += " tech-row-double-indented";
                                  } else if (row.isIndented) {
                                    rowClass += " tech-row-indented";
                                  }
                                  return (
                                    <div key={i} className={rowClass}>
                                      <span className="tech-key">{row.key.trim()}</span>
                                      <span className={`tech-value ${statusColor(row.value)}`}>
                                        {row.value}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </details>
                          )}
                        </div>
                      );
                    })
                  )}

                  {loading && (
                    <div className="message assistant">
                      <div className="typing">
                        <span></span><span></span><span></span>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Chat input */}
                <div className="chat-input">
                  <div className="chat-input-container">
                    <input
                      type="text"
                      placeholder={isEmailAgentSelected ? "Type your message..." : "Enter Subscriber ID or Customer ID..."}
                      value={subscriberId}
                      onChange={(e) => setSubscriberId(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                    />
                    <button className="send-icon-btn" onClick={handleSubmit} title="Send Message">
                      <svg viewBox="0 0 24 24" className="send-icon">
                        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* ── Resizer & Tech Panel — shown only when showTechPanel is true ── */}
      {showTechPanel && (
        <>
          <div className="resizer" onMouseDown={startResizing} title="Drag to resize panel"></div>
          <div className="tech-panel">
            <h3>Technical Details</h3>

            {techRows.length > 0 ? (
              <>
                {renderTechDashboard()}
                <div className="tech-data">
                  {techRows.map((row, i) => {
                    if (row.isSection && !row.isSubSection) {
                      return (
                        <div key={i} className="tech-row tech-section-header">
                          <span className="tech-section-label">{row.key.trim()}</span>
                        </div>
                      );
                    }
                    if (row.isSubSection) {
                      return (
                        <div key={i} className="tech-row tech-row-indented tech-subsection-header">
                          <span className="tech-subsection-label">{row.key.trim()}</span>
                        </div>
                      );
                    }
                    let rowClass = "tech-row";
                    if (row.isDoubleIndented) {
                      rowClass += " tech-row-double-indented";
                    } else if (row.isIndented) {
                      rowClass += " tech-row-indented";
                    }
                    return (
                      <div key={i} className={rowClass}>
                        <span className="tech-key">{row.key.trim()}</span>
                        <span className={`tech-value ${statusColor(row.value)}`}>
                          {row.value}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="no-data">No technical data yet.<br />Submit a query to see details.</p>
            )}
          </div>
        </>
      )}

    </div>
  );
}

export default App;