import React, { useState, useRef, useCallback } from "react";
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

// ─── Status badge colour ──────────────────────────────────────────────────
function statusColor(val) {
  if (!val) return "";
  const v = String(val).toLowerCase();

  // Check red conditions first to prevent "inactive" triggering "active"
  if (["inactive", "offline", "failed", "error", "fault", "throttled"].some((k) => v.includes(k))) return "badge-red";
  if (["active", "online", "healthy", "passed", "ok"].some((k) => v.includes(k))) return "badge-green";
  if (["unknown", "n/a"].some((k) => v.includes(k))) return "badge-grey";
  return "badge-blue";
}

// ═══════════════════════════════════════════════════════════════════════════
function App() {
  const [selectedAgent, setSelectedAgent] = useState("");
  const [subscriberId, setSubscriberId] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [apiData, setApiData] = useState(null);      // raw HTTP node data
  const [devOutput, setDevOutput] = useState(null);      // parsed developer_output

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

    // Section 1 — API Data (raw from HTTP Request node)
    if (api && typeof api === "object") {
      for (const [k, v] of Object.entries(api)) {
        rows.push({ key: k, value: v === null || v === undefined ? "N/A" : String(v) });
      }
    }

    // Section 2 — Developer Output fields (flat, no workflow_execution)
    if (dev && typeof dev === "object") {
      for (const [k, v] of Object.entries(dev)) {
        if (k === "workflow_execution") continue;
        if (v === null || v === undefined) {
          rows.push({ key: k, value: "N/A" });
        } else if (Array.isArray(v)) {
          rows.push({ key: k, value: v.join(", ") });
        } else if (typeof v === "object") {
          flattenObj(v, k).forEach((r) => rows.push(r));
        } else {
          rows.push({ key: k, value: String(v) });
        }
      }
    }

    return rows;
  };

  const agents = [
    "Free Chat",
    "Usage Agent",
    "Protocol Agent",
    "Monthly Data Allocation Agent",
    "Email Solution Agent",
    "Configuration Agent",
  ];

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!selectedAgent || !subscriberId) {
      alert("Please select an agent and enter a Subscriber ID");
      return;
    }

    // Instantly show the user's message bubble, appending to previous chats
    setChatMessages((prev) => [
      ...prev,
      { role: "user", content: `Subscriber ID: ${subscriberId}` },
    ]);

    // Clear old technical details while loading
    setApiData(null);
    setDevOutput(null);

    setLoading(true);

    try {
      const response = await fetch("http://localhost:8000/support-query", {
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
      chatMessage += `Subscriber ${subscriberId} — analysis complete. See Technical Details`;

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

      const messageTechDetails = buildTechRows(rawApiData, parsedDev);

      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: chatMessage, workflow: cleanedWorkflow, techDetails: messageTechDetails },
      ]);

      setSubscriberId("");
    } catch (error) {
      console.error("Error:", error);
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${error.message}`, workflow: [] },
      ]);
    }

    setLoading(false);
  };

  const techRows = buildTechRows(apiData, devOutput);

  // ── Render Dashboard (Dynamic vs Static) ─────────────────────────────────
  const renderTechDashboard = () => {
    const formatValue = (prefix, keys) => {
      let isPresent = false;
      let val = "UNKNOWN";

      for (const key of keys) {
        if (apiData && Object.prototype.hasOwnProperty.call(apiData, key)) {
          isPresent = true;
          if (apiData[key] !== null && apiData[key] !== undefined && String(apiData[key]).trim() !== "") {
            val = String(apiData[key]);
          }
          break;
        }
        if (devOutput && Object.prototype.hasOwnProperty.call(devOutput, key)) {
          isPresent = true;
          if (devOutput[key] !== null && devOutput[key] !== undefined && String(devOutput[key]).trim() !== "") {
            val = String(devOutput[key]);
          }
          break;
        }
      }

      // If the field wasn't sent in the payload at all, hide the prefix and just show UNKNOWN
      if (!isPresent) {
        return <div className="value-row"><span className="badge-grey">UNKNOWN</span></div>;
      }

      // If the field WAS sent (even if its value is 'UNKNOWN', null, or empty), show the prefix
      return (
        <div className="value-row">
          <span className="value-prefix">{prefix.replace(/_/g, " ")}</span>
          <span className={`value-text ${statusColor(val)}`}>{val.replace(/_/g, " ")}</span>
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
            <div className="tech-item"><span className="label">Package details:</span><span className="value">{formatValue("VAS_Package", ["VAS_Package"])}</span></div>
            <div className="tech-item"><span className="label">Status:</span><span className="value">{formatValue("VAS_Status", ["VAS_Status"])}</span></div>
            <div className="tech-item"><span className="label">Extra GB:</span><span className="value">{formatValue("Extra_GB", ["Extra_GB"])}</span></div>
            <div className="tech-item"><span className="label">Addons:</span><span className="value">{formatValue("Addons", ["Addons", "VAS_Addons"])}</span></div>
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
            <div className="tech-item"><span className="label">Name:</span><span className="value">{formatValue("Customer_Name", ["Customer_Name", "customer_name", "Name", "name"])}</span></div>
            <div className="tech-item"><span className="label">Contact number:</span><span className="value">{formatValue("Contact_Number", ["Contact_Number", "contact_number", "Contact", "contact"])}</span></div>
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

  const renderMessageContent = (content) => {
    if (!content) return null;

    // Check if this is a final summary message
    const isSummary = content.includes("analysis complete") || content.includes("💡");

    // Split by the " , " separator if present to handle multi-part summaries
    // Using a regex to handle optional whitespace and newlines around the comma
    const sections = content.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);

    return (
      <div className={isSummary ? "summary-container" : ""}>
        {sections.map((section, idx) => {
          // Highlight Subscriber IDs (e.g., ACC060859917)
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

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="container" style={{ gridTemplateColumns: `240px 1fr 6px ${techPanelWidth}px` }}>

      {/* ── Sidebar ───────────────────────────────────────────────────── */}
      <div className="sidebar">
        <div className="logo">SLTMobitel Support</div>

        <h2>Agent Selector</h2>

        {agents.map((agent, index) => (
          <div
            key={index}
            className={`agent-card ${selectedAgent === agent ? "selected" : ""}`}
            onClick={() => setSelectedAgent(agent)}
          >
            {agent}
          </div>
        ))}
      </div>

      {/* ── Chat Section ──────────────────────────────────────────────── */}
      <div className="chat-section">
        <div className="chat-header">Technical Support Assistant</div>

        <div className="chat-box">
          {chatMessages.map((msg, index) => {
            const isLatestMessageAndAssistant = index === chatMessages.length - 1 && msg.role === "assistant";

            return (
              <div
                key={index}
                className={msg.role === "assistant" ? "message assistant" : "message user"}
              >
                <div className="message-content">
                  {renderMessageContent(msg.content)}
                </div>

                {/* Workflow Execution — shown inside the chat bubble */}
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

                {/* In-chat Technical Details Toggle */}
                {msg.techDetails && msg.techDetails.length > 0 && !isLatestMessageAndAssistant && (
                  <details className="chat-tech-details">
                    <summary>View Technical Details</summary>
                    <div className="tech-data">
                      {msg.techDetails.map(({ key, value }, i) => (
                        <div key={i} className="tech-row">
                          <span className="tech-key">{key}</span>
                          <span className={`tech-value ${statusColor(value)}`}>{value}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            );
          })}

          {loading && (
            <div className="message assistant">
              <div className="typing">
                <span></span><span></span><span></span>
              </div>
            </div>
          )}
        </div>

        <div className="chat-input">
          <input
            type="text"
            placeholder="Enter Subscriber ID and press Send..."
            value={subscriberId}
            onChange={(e) => setSubscriberId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />
          <button onClick={handleSubmit}>Send</button>
        </div>
      </div>

      {/* ── Resizer ───────────────────────────────────────────────────── */}
      <div className="resizer" onMouseDown={startResizing} title="Drag to resize panel"></div>

      {/* ── Tech Panel (right side) ───────────────────────────────────── */}
      <div className="tech-panel">
        <h3>Technical Details</h3>

        {techRows.length > 0 ? (
          <>
            {renderTechDashboard()}
            <div className="tech-data">
              {techRows.map(({ key, value }, i) => (
                <div key={i} className="tech-row">
                  <span className="tech-key">{key}</span>
                  <span className={`tech-value ${statusColor(value)}`}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="no-data">No technical data yet.<br />Submit a query to see details.</p>
        )}
      </div>

    </div>
  );
}

export default App;