import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { loginRequest } from "./authConfig";
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

// Map URL pathnames to agent names
const AGENT_PATH_MAP = {
  "/main-agent": "Main Agent",
  "/usage-agent": "Usage Agent",
  "/email-agent": "Email Solution Agent",
  "/config-agent": "Configuration Agent"
};

const REVERSE_AGENT_PATH_MAP = {
  "Main Agent": "main-agent",
  "Usage Agent": "usage-agent",
  "Email Solution Agent": "email-agent",
  "Configuration Agent": "config-agent"
};

// ═══════════════════════════════════════════════════════════════════════════
function App() {
  const { instance, accounts, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const activeAccount = instance.getActiveAccount();
  const userAccount = activeAccount || (accounts && accounts.length > 0 ? accounts[0] : null);
  const isUserLoggedIn = isAuthenticated || (accounts && accounts.length > 0) || !!activeAccount;
  const [loginError, setLoginError] = useState(null);

  // Ensure active account is synced when accounts array updates
  useEffect(() => {
    if (accounts.length > 0 && !instance.getActiveAccount()) {
      instance.setActiveAccount(accounts[0]);
    }
  }, [accounts, instance]);

  const handleLogin = () => {
    setLoginError(null);
    instance.loginRedirect(loginRequest).catch((error) => {
      console.error("Login redirect failed:", error);
      setLoginError(error.message || "Login failed. Please try again.");
    });
  };

  // Helper to acquire Microsoft Azure AD O365 JWT Token
  const getAuthHeaders = useCallback(async () => {
    const acc = instance.getActiveAccount() || (accounts && accounts.length > 0 ? accounts[0] : null);
    if (!acc) return { "Content-Type": "application/json" };
    try {
      const response = await instance.acquireTokenSilent({
        ...loginRequest,
        account: acc,
      });
      const token = response.idToken || response.accessToken;
      return {
        "Content-Type": "application/json",
        ...(token ? { "Authorization": `Bearer ${token}` } : {})
      };
    } catch (err) {
      console.warn("Silent token acquisition failed:", err);
      return { "Content-Type": "application/json" };
    }
  }, [instance, accounts]);

  const getInitialAgent = () => {
    // On mobile, default to Main Agent
    if (window.innerWidth <= 768) {
      return "Main Agent";
    }
    // On desktop, read from URL path as before
    const path = window.location.pathname.toLowerCase();
    return AGENT_PATH_MAP[path] || "Main Agent";
  };

  const [selectedAgent, setSelectedAgent] = useState(getInitialAgent);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobileTechPanelOpen, setIsMobileTechPanelOpen] = useState(false);
  const [subscriberId, setSubscriberId] = useState("");
  const [allAgentMessages, setAllAgentMessages] = useState({}); // per-agent chat history
  const [loading, setLoading] = useState(false);
  const [apiData, setApiData] = useState(null);      // raw HTTP node data
  const [devOutput, setDevOutput] = useState(null);      // parsed developer_output

  // ── Usage Agent dedicated state ──────────────────────────────────────────
  const [usageMessages, setUsageMessages] = useState([]);
  const [usageInput, setUsageInput] = useState("");
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageRawApiData, setUsageRawApiData] = useState(null);
  const [usageApiType, setUsageApiType] = useState(null); // "dashboard" | "protocol"
  const [isMobileUsageApiPanelOpen, setIsMobileUsageApiPanelOpen] = useState(false);

  // ── Main Agent dedicated state ───────────────────────────────────────────
  const [mainMessages, setMainMessages] = useState([]);
  const [mainInput, setMainInput] = useState("");
  const [mainLoading, setMainLoading] = useState(false);
  const [mainSessionId] = useState(() => "main_" + Math.random().toString(36).substring(2, 9));
  const mainMessagesEndRef = useRef(null);

  const messagesEndRef = useRef(null);
  const usageMessagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Derived: messages for the currently selected agent
  const chatMessages = useMemo(
    () => allAgentMessages[selectedAgent] || [],
    [allAgentMessages, selectedAgent]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      scrollToBottom();
    }, 80);
    return () => clearTimeout(timer);
  }, [chatMessages, loading]);

  useEffect(() => {
    const timer = setTimeout(() => {
      mainMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 80);
    return () => clearTimeout(timer);
  }, [mainMessages, mainLoading]);

  useEffect(() => {
    const timer = setTimeout(() => {
      usageMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 80);
    return () => clearTimeout(timer);
  }, [usageMessages, usageLoading]);

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname.toLowerCase();
      const agent = AGENT_PATH_MAP[path] || "Main Agent";
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

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [allAgentMessages]);

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
    setIsMobileMenuOpen(false); // close mobile sidebar on agent select

    // Update URL path without reloading page
    const code = REVERSE_AGENT_PATH_MAP[agent];
    if (code) {
      try {
        const newUrl = `${window.location.protocol}//${window.location.host}/${code}`;
        // Only push state on desktop to preserve Web UI behavior exactly as before
        if (window.innerWidth > 768) {
          window.history.pushState({ agent }, "", newUrl);
        }
      } catch (err) {
        console.warn("Failed to update URL:", err);
      }
    }

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
                if (sv.length > 0) {
                  rows.push({ key: sk, value: null, isSection: true, isSubSection: true });
                  sv.forEach((item, idx) => {
                    if (typeof item === "object") {
                      if (item.protocol) {
                        // Has protocol field — show as sub-header
                        rows.push({ key: item.protocol, value: null, isItemHeader: true, isIndented: true });
                        for (const [ik, iv] of Object.entries(item)) {
                          if (ik !== "protocol") {
                            rows.push({ key: `  ${ik}`, value: String(iv ?? "N/A"), isDoubleIndented: true });
                          }
                        }
                      } else {
                        // No protocol — just expand fields with indent (no numbered header)
                        for (const [ik, iv] of Object.entries(item)) {
                          rows.push({ key: `  ${ik}`, value: String(iv ?? "N/A"), isDoubleIndented: true });
                        }
                      }
                    } else {
                      rows.push({ key: `  ${idx + 1}`, value: String(item ?? "N/A"), isDoubleIndented: true });
                    }
                  });
                } else {
                  rows.push({ key: sk, value: "Empty", isIndented: true });
                }
              } else if (typeof sv === "object" && sv !== null) {
                rows.push({ key: `  ${sk}`, value: formatObjectFriendly(sk, sv), isIndented: true });
              } else {
                rows.push({ key: `  ${sk}`, value: String(sv ?? "N/A"), isIndented: true });
              }
            }
          }
        } else if (Array.isArray(v)) {
          if (v.length > 0 && typeof v[0] === "object") {
            // Array of objects at the root level (e.g. total, download, upload lists in Protocol Usage)
            rows.push({ key: k, value: null, isSection: true });
            v.forEach((item, idx) => {
              const itemTitle = item.protocol ? item.protocol : `[${idx + 1}]`;
              rows.push({ key: itemTitle, value: null, isSection: true, isSubSection: true });
              for (const [ik, iv] of Object.entries(item)) {
                if (ik !== "protocol") {
                  rows.push({ key: ik, value: String(iv ?? "N/A"), isIndented: true, isDoubleIndented: true });
                }
              }
            });
          } else {
            rows.push({ key: k, value: v.join(", ") });
          }
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

  // ── Main Agent Submit Handler ─────────────────────────────────────────────
  const handleMainSubmit = async (customPrompt) => {
    const messageToSend = typeof customPrompt === "string" ? customPrompt : mainInput;
    if (!messageToSend || !messageToSend.trim()) {
      alert("Please enter a query or message for the Main Agent");
      return;
    }

    const userMsg = messageToSend.trim();
    if (typeof customPrompt !== "string") {
      setMainInput("");
    }

    setMainMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setMainLoading(true);

    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch(getApiUrl("/main-agent-chat"), {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          message: userMsg,
          session_id: mainSessionId
        }),
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      let parsedDev = null;
      let workflow = [];

      const aiRaw = data.raw?.ai_analysis;
      if (aiRaw && typeof aiRaw === "object") {
        parsedDev = aiRaw.developer_output || null;
        const wfRaw = parsedDev?.workflow_execution;
        if (Array.isArray(wfRaw)) {
          workflow = wfRaw;
        } else if (typeof wfRaw === "string") {
          workflow = wfRaw.split(",").map(s => s.trim()).filter(Boolean);
        }
      }

      const cleanedWorkflow = [];
      let sessionInserted = false;
      const BOILERPLATE_STEPS = ["webhook triggered", "send post request", "code in javascript node"];
      const isBoilerplate = (step) => BOILERPLATE_STEPS.some(b => step.toLowerCase().includes(b));
      const cleanStepText = (step) => step.replace(/[\][{}'"]/g, "").replace(/_/g, " ").trim();

      if (workflow && workflow.length > 0) {
        for (const step of workflow) {
          if (isBoilerplate(step)) {
            if (!sessionInserted) {
              cleanedWorkflow.push("🟢 Session Started");
              sessionInserted = true;
            }
          } else {
            cleanedWorkflow.push(cleanStepText(step));
          }
        }
      }
      if (!sessionInserted && cleanedWorkflow.length > 0) {
        cleanedWorkflow.unshift("🟢 Session Started");
      }

      // Use exact tool name from n8n intermediateSteps only — no keyword guessing
      // If n8n did not call any sub-agent tool, agent_used will be null and no badge is shown
      let toolCalled = data.agent_used || null;

      // Normalize tool name: remove underscores and fix display names
      if (toolCalled) {
        toolCalled = toolCalled.replace(/_/g, " "); // "Usage_Agent" → "Usage Agent"
        if (toolCalled === "Email Solution") toolCalled = "Email Solution Agent";
      }

      setMainMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: data.reply,
          workflow: cleanedWorkflow,
          toolCalled: toolCalled
        }
      ]);
    } catch (error) {
      console.error("Error:", error);
      setMainMessages(prev => [
        ...prev,
        { role: "assistant", content: `Error: ${error.message}`, workflow: [] }
      ]);
    } finally {
      setMainLoading(false);
    }
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!selectedAgent) {
      alert("Please select an agent first");
      return;
    }

    if (selectedAgent === "Main Agent") {
      handleMainSubmit();
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
        const authHeaders = await getAuthHeaders();
        const response = await fetch(getApiUrl("/email-chat"), {
          method: "POST",
          headers: authHeaders,
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
      const authHeaders = await getAuthHeaders();
      const response = await fetch(getApiUrl("/support-query"), {
        method: "POST",
        headers: authHeaders,
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
            // Helper: convert SNAKE_CASE or snake_case to Title Case
            const toTitleCase = (str) =>
              str.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

            customerSummary = rawSummary
              // Replace literal \n (backslash-n) with a real newline BEFORE stripping backslashes
              .replace(/\\n/g, "\n")
              // Now strip remaining special chars
              .replace(/[{}"\\]/g, "")
              // Remove leftover section keys
              .replace(/(?:^|\n)\s*(?:summary|next_steps|customer_output)\s*:/g, "")
              // Convert comma-separated metadata "key: ALL_CAPS_VALUE" into newline-separated
              // beautiful readable lines e.g. "Status: Not Healthy\nDecision Code: Open Fault User"
              .replace(/,?\s*(\w+):\s*([A-Z][A-Z_]+)(?=\s*,|\s*$)/g, (match, key, val) => {
                return `\n${toTitleCase(key)}: ${toTitleCase(val)}`;
              })
              // Collapse leftover commas
              .replace(/,\s*,/g, "")
              .replace(/^\s*,|,\s*$/g, "")
              .replace(/\n{3,}/g, "\n\n")
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
        // ── Step 0: Strip leading/trailing whitespace, newlines, and emojis/symbols from raw summary
        customerSummary = customerSummary.replace(/^[\s\r\n💡🤖❌🟢🔴🟡⚙️]+/, "").trim();

        // ── Step 1: Strip ANY leading intro boilerplate the AI prepends
        //    Catches: "Here's the output:", "Here is the output for the given input:",
        //             "Below is the output:", "Here are the results:", etc.
        customerSummary = customerSummary.replace(
          /^[^a-zA-Z\u2019]*(?:here(?:'s|\u2019s|\s+is|\s+are)?|below\s+is)\s+(?:the\s+)?(?:output|results?|response|summary)(?:\s+for[^:\n]*)?\s*:?\s*/i,
          ""
        ).trim();

        // ── Step 2: Strip ANY standalone "Customer …" heading line (global, any position)
        //    Matches "Customer" followed by 1-3 words: Output, Response, Summary,
        //    Configuration Report, Message Details, etc.
        customerSummary = customerSummary.replace(
          /customer[\s_]+(?:\w+[\s_]*){1,3}\s*:?[\t ]*[\r\n]*/gi,
          ""
        ).trim();

        // ── Step 3: Cut everything from the first "Developer …" header onwards.
        //    Split by line so there are zero regex-index edge cases.
        {
          // Match ANY line starting with "developer" or typical developer-only keys (customer_id, missing_data, etc.)
          const devHeaderRe = /^\s*(?:developer\b|customer_id\s*:|vendor_hint\s*:|internal_status\s*:|missing_data\s*:|workflow_execution\s*:|execution_trace\s*:)/i;
          const lines = customerSummary.split(/\r?\n/);
          const cutIdx = lines.findIndex(line => devHeaderRe.test(line));
          if (cutIdx !== -1) {
            customerSummary = lines.slice(0, cutIdx).join("\n").trim();
          }
        }

        // ── Step 4: Strip markdown code-block markers (``` or ```language)
        customerSummary = customerSummary.replace(/```[^\n]*/g, "").trim();

        // ── Step 5: Strip trailing "Note …" sentences the AI appends as meta-commentary.
        //    Catches: "Note that …", "Note: …", "Note – …", "Note — …"
        customerSummary = customerSummary.replace(/\bNote\s*(?:that|[:–—])\s*[\s\S]*/i, "").trim();

        // ── Step 6: Strip sign-off lines like "Best regards, [Your Name]"
        customerSummary = customerSummary.replace(/(?:\n|^)\s*(?:best\s+regards|sincerely|regards|yours\s+(?:truly|sincerely))[\s\S]*/i, "").trim();

        // ── Step 7: Collapse leftover triple blank lines
        customerSummary = customerSummary.replace(/\n{3,}/g, "\n\n").trim();

        // ── Step 8: Strip stray punctuation & leftover YAML keys
        customerSummary = customerSummary.replace(/[;,]/g, "");
        customerSummary = customerSummary.replace(/(?:-\s*)?(?:summary|next_steps|customer_\w+|developer_\w+)\s*:?/gi, "").trim();

        // ── Final defensive trim (catches any leftover leading/trailing whitespace)
        customerSummary = customerSummary.trim();

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
        return step.replace(/[\][{}'"]/g, "").replace(/_/g, " ").trim();
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

      // A valid response must contain at least one real identifier or data field (not just empty VAS placeholder structures)
      const hasIdentifier = rawApiData && (
        rawApiData.subscriberId ||
        rawApiData.subscriber_id ||
        rawApiData.customer_id ||
        rawApiData.NMS_service_port_status ||
        rawApiData.nms_service_port_status ||
        rawApiData.email ||
        rawApiData.phone
      );

      const hasRealData = rawApiData &&
        typeof rawApiData === "object" &&
        Object.keys(rawApiData).length > 0 &&
        Object.keys(rawApiData).some(k => !ERROR_ONLY_KEYS.has(k)) &&
        !!hasIdentifier;

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



  const renderMessageContent = (msg) => {
    if (!msg || !msg.content) return null;

    // Fix literal \n escape sequences that backend sometimes sends as text
    let content = msg.content.replace(/\\n/g, "\n");

    // Check if content contains markdown table syntax (|) or headings (#)
    if (content.includes("|") || /^\s*#{1,6}\s+/m.test(content)) {
      return (
        <div className="markdown-rendered-content">
          {renderMarkdown(content)}
        </div>
      );
    }

    // Clean up dangling ** markers (e.g. "** " at the end or "**customer_output**")
    // First render actual bold markdown, then strip any leftover asterisks
    const renderContent = (text) => {
      // Replace literal \n with actual newline just in case
      let html = text.replace(/\\n/g, "\n");

      // NEW: Replace HTML non-breaking spaces if backend sends them
      html = html.replace(/&nbsp;/gi, " ");

      // Clean up spaces around colons (e.g. "Subscriber ID : 94113627500" -> "Subscriber ID: 94113627500")
      html = html.replace(/\s+:\s+/g, ": ");

      // UPDATED: Collapse ALL consecutive spaces (including special whitespace, excluding newlines) uniformly
      html = html.replace(/[^\S\r\n]+/g, " ").trim();

      // Highlight subscriber/customer IDs (e.g. ACC060859917, 94113627500)
      html = html.replace(/\b(ACC\d+|\d{10,})\b/g, '<span class="sub-id-highlight">$1</span>');

      // Render **bold** markdown
      html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
      // Remove any leftover dangling ** markers
      html = html.replace(/\*\*/g, "");
      // Render [text](url) links
      html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      // Bold lines ending with a colon (:)
      if (text.trim().endsWith(":")) {
        html = `<strong>${html}</strong>`;
      }
      return html;
    };

    if (msg.isEmailAgent) {
      return (
        <div className="email-agent-response">
          {content.split("\n").map((line, i) => (
            <div
              key={i}
              className="message-line"
              dangerouslySetInnerHTML={{ __html: renderContent(line) }}
            />
          ))}
        </div>
      );
    }

    // Check if this is a final summary message
    const isSummary = content.includes("analysis complete") || content.includes("💡");

    // Split on newlines only — NOT commas, which breaks normal sentences
    const lines = content.split("\n").map(s => s.trim()).filter(Boolean);

    return (
      <div className={isSummary ? "summary-container" : ""}>
        {lines.map((line, idx) => {
          return (
            <div
              key={idx}
              className="message-line"
              dangerouslySetInnerHTML={{
                __html: renderContent(line)
              }}
            />
          );
        })}
      </div>
    );
  };

  // ── Usage Agent: Markdown renderer ──────────────────────────────────────
  const renderMarkdown = (text) => {
    if (!text) return null;
    const lines = text.split("\n");
    const elements = [];
    let tableBuffer = [];
    let inTable = false;
    let key = 0;

    const flushTable = () => {
      if (tableBuffer.length < 2) {
        tableBuffer.forEach(l => elements.push(<p key={key++} className="usage-md-p">{l}</p>));
        tableBuffer = [];
        return;
      }
      const parseCells = (row) => {
        const cells = row.split("|").map(c => c.trim());
        if (cells.length > 0 && cells[0] === "") cells.shift();
        if (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
        return cells;
      };

      const headerCells = parseCells(tableBuffer[0]);

      // Row index 1 is the separator (---|---), skip it
      const dataRows = tableBuffer.slice(2).map(row => parseCells(row)).filter(r => r.length > 0);

      elements.push(
        <div key={key++} className="usage-table-wrapper">
          <table className="usage-table">
            <thead>
              <tr>{headerCells.map((h, i) => <th key={i}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {dataRows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => <td key={ci}>{cell || "-"}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableBuffer = [];
    };

    const parseInline = (str) => {
      // Highlight subscriber/customer IDs (e.g. ACC060859917, 94113627500)
      let html = str.replace(/\b(ACC\d+|\d{10,})\b/g, '<span class="sub-id-highlight">$1</span>');

      // Bold **text**
      html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code>$1</code>');

      // Bold lines ending with a colon (:)
      if (str.trim().endsWith(":")) {
        html = `<strong>${html}</strong>`;
      }
      return html;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Detect table row
      if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
        inTable = true;
        tableBuffer.push(trimmed);
        continue;
      } else if (inTable) {
        flushTable();
        inTable = false;
      }

      if (!trimmed) {
        elements.push(<div key={key++} className="usage-md-spacer" />);
        continue;
      }
      if (trimmed.startsWith("#### ")) {
        elements.push(<h4 key={key++} className="usage-md-h4" dangerouslySetInnerHTML={{ __html: parseInline(trimmed.slice(5)) }} />);
      } else if (trimmed.startsWith("### ")) {
        elements.push(<h3 key={key++} className="usage-md-h3" dangerouslySetInnerHTML={{ __html: parseInline(trimmed.slice(4)) }} />);
      } else if (trimmed.startsWith("## ")) {
        elements.push(<h2 key={key++} className="usage-md-h2" dangerouslySetInnerHTML={{ __html: parseInline(trimmed.slice(3)) }} />);
      } else if (trimmed.startsWith("# ")) {
        elements.push(<h1 key={key++} className="usage-md-h1" dangerouslySetInnerHTML={{ __html: parseInline(trimmed.slice(2)) }} />);
      } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        elements.push(<li key={key++} className="usage-md-li" dangerouslySetInnerHTML={{ __html: parseInline(trimmed.slice(2)) }} />);
      } else {
        elements.push(<p key={key++} className="usage-md-p" dangerouslySetInnerHTML={{ __html: parseInline(trimmed) }} />);
      }
    }
    if (inTable) flushTable();
    return elements;
  };

  // ── Usage Agent: Send message ─────────────────────────────────────────────
  const handleUsageSubmit = async () => {
    const query = usageInput.trim();
    if (!query) return;
    setUsageInput("");
    setUsageMessages(prev => [...prev, { role: "user", content: query }]);
    setUsageLoading(true);
    setUsageRawApiData(null);
    setUsageApiType(null);

    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch(getApiUrl("/usage-chat"), {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ query }),
      });
      const data = await response.json();

      if (data.error) {
        setUsageMessages(prev => [...prev, { role: "assistant", content: `❌ ${data.error}` }]);
        return;
      }

      // ai_chat_response is the markdown text from the Code node
      const aiText = data.ai_chat_response || data.output || "No response received.";

      // raw_api_data is the intermediateSteps array from the Code node
      const steps = data.raw_api_data || [];
      let rawJson = null;
      let apiType = null;

      // Find the last tool observation (the actual API response)
      for (let i = steps.length - 1; i >= 0; i--) {
        const step = steps[i];
        const obs = step?.observation || step?.output || null;
        const toolName = step?.action?.tool || "";
        if (obs) {
          let parsed = obs;
          // Un-wrap stringified JSON up to 3 times
          for (let attempt = 0; attempt < 3; attempt++) {
            if (typeof parsed === "string") {
              const trimmed = parsed.trim();
              if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
                try {
                  parsed = JSON.parse(trimmed);
                } catch {
                  break;
                }
              } else {
                break;
              }
            } else {
              break;
            }
          }
          rawJson = parsed;
          if (toolName.toLowerCase().includes("protocol")) apiType = "protocol";
          else if (toolName.toLowerCase().includes("dashboard")) apiType = "dashboard";
          else if (toolName.toLowerCase().includes("bill") || toolName.toLowerCase().includes("billing")) apiType = "billing";
          else apiType = "api";
          break;
        }
      }

      // Unwrap single-element arrays
      if (Array.isArray(rawJson) && rawJson.length === 1) {
        rawJson = rawJson[0];
      }

      // Unwrap single-key root objects (like "dashboardSummaryResponse") for cleaner UI display
      if (rawJson && typeof rawJson === "object" && !Array.isArray(rawJson)) {
        const keys = Object.keys(rawJson);
        if (keys.length === 1 && typeof rawJson[keys[0]] === "object" && !Array.isArray(rawJson[keys[0]])) {
          rawJson = rawJson[keys[0]];
        }
      }

      setUsageRawApiData(rawJson);
      setUsageApiType(apiType);
      setUsageMessages(prev => [...prev, { role: "assistant", content: aiText, rawJson, apiType, techDetails: buildTechRows(rawJson, null) }]);
    } catch (err) {
      setUsageMessages(prev => [...prev, { role: "assistant", content: `❌ Error: ${err.message}` }]);
    } finally {
      setUsageLoading(false);
    }
  };

  const isEmailAgentSelected = selectedAgent === "Email Solution Agent";
  const NON_IMPLEMENTED = [];
  const isNonImplemented = NON_IMPLEMENTED.includes(selectedAgent);

  // Show Tech Panel only when it's not email, not non-implemented, not usage agent, and user entered subscriber ID (data is loaded or loading)
  const isUsageAgent = selectedAgent === "Usage Agent";
  const isMainAgent = selectedAgent === "Main Agent";
  const showTechPanel = !isEmailAgentSelected && !isNonImplemented && !isUsageAgent && !isMainAgent && (apiData !== null || devOutput !== null || loading);

  // ── Show Loading Screen while processing Microsoft redirect tokens ───────
  if (inProgress === "handleRedirect" || inProgress === "login") {
    return (
      <div className="login-container">
        <div className="login-card" style={{ padding: "48px 36px" }}>
          <img src="/blitz-icon.png" alt="Blitz.ai" className="login-logo-icon" style={{ animation: "pulse 1.5s infinite" }} />
          <h2 style={{ margin: "16px 0 8px", color: "var(--slt-dark)", fontSize: "20px" }}>Signing in to Blitz.ai...</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "13.5px", margin: 0 }}>Verifying your SLT Microsoft 365 credentials</p>
        </div>
      </div>
    );
  }

  // ── Render Microsoft O365 Login Screen if Unauthenticated ───────────────
  if (!isUserLoggedIn) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="login-brand">
            <img src="/blitz-icon.png" alt="Blitz.ai" className="login-logo-icon" />
            <h1 className="login-title">Blitz.ai</h1>
            <span className="login-badge">Enterprise BackOffice</span>
          </div>
          <p className="login-subtitle">
            Sri Lanka Telecom Digital Lab AI Support Platform
          </p>
          <div className="login-divider"></div>
          <div className="login-features">
            <div className="login-feature-item">
              <span className="login-feature-icon">🛡️</span>
              <div>
                <strong>Single Sign-On (SSO)</strong>
                <p>Sign in securely with your official SLT Microsoft 365 account.</p>
              </div>
            </div>
            <div className="login-feature-item">
              <span className="login-feature-icon">⚡</span>
              <div>
                <strong>Autonomous Multi-Agent AI</strong>
                <p>Direct access to Router, Usage, Configuration & Email agents.</p>
              </div>
            </div>
          </div>
          {loginError && (
            <div style={{ color: "#ef4444", background: "rgba(239, 68, 68, 0.1)", padding: "10px", borderRadius: "8px", fontSize: "12px", marginBottom: "16px" }}>
              {loginError}
            </div>
          )}
          <button
            className="ms-login-button"
            onClick={handleLogin}
            disabled={inProgress === "login"}
          >
            <svg className="ms-icon" viewBox="0 0 21 21" width="20" height="20">
              <rect x="1" y="1" width="9" height="9" fill="#f25022" />
              <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
              <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
              <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
            </svg>
            <span>{inProgress === "login" ? "Signing In..." : "Sign in with Microsoft 365"}</span>
          </button>
          <div className="login-footer">
            <span>🔒 Protected by Microsoft Azure Active Directory</span>
            <small>Authorised SLT personnel only</small>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Mobile overlay removed — dropdown overlay is rendered near the dropdown itself */}

      <div
        className="container"
        style={{
          gridTemplateColumns: showTechPanel
            ? `240px 1fr 6px ${techPanelWidth}px`
            : "240px 1fr",
        }}
      >

        {/* ── Sidebar ───────────────────────────────────────────────────── */}
        <div className={`sidebar ${isMobileMenuOpen ? 'mobile-open' : ''}`}>
          <div className="logo">
            <img src="/blitz-icon.png" alt="Blitz.ai" className="sidebar-logo-icon" />
            <span>Blitz.ai</span>
          </div>

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

          {/* ── User Profile & Sign Out ──────────────────────────────────── */}
          <div className="sidebar-user-footer">
            <div className="sidebar-user-avatar">
              {userAccount?.name ? userAccount.name.charAt(0).toUpperCase() : "U"}
            </div>
            <div className="sidebar-user-info">
              <span className="sidebar-user-name" title={userAccount?.name || "SLT User"}>
                {userAccount?.name || "SLT User"}
              </span>
              <span className="sidebar-user-email" title={userAccount?.username || ""}>
                {userAccount?.username || ""}
              </span>
            </div>
            <button
              className="sidebar-logout-btn"
              title="Sign out of Microsoft 365"
              onClick={() => instance.logoutRedirect()}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
            </button>
          </div>
        </div>

        {/* ── Chat Section ──────────────────────────────────────────────── */}
        <div className="chat-section">
          {selectedAgent && (
            <>
              {/* Dynamic header */}
              <div className="chat-header centered-header">
                {/* Mobile-only: brand + agent title on the left, hamburger on the right */}
                <div className="mobile-header-left-wrap">
                  <div className="mobile-brand-container">
                    <img src="/blitz-icon.png" alt="Blitz.ai" className="mobile-logo-icon" />
                    <span className="mobile-header-brand">Blitz.ai</span>
                  </div>
                  <span className="header-agent-title">
                    {selectedAgent === "Main Agent"
                      ? "BACKOFFICE ROUTER AGENT"
                      : isEmailAgentSelected
                        ? "BACKOFFICE EMAIL"
                        : selectedAgent === "Usage Agent"
                          ? "USAGE AGENT"
                          : selectedAgent === "Configuration Agent"
                            ? "TECHNICAL SUPPORT ASSISTANT"
                            : selectedAgent.toUpperCase()}
                  </span>
                </div>
                {/* Desktop title (centered) */}
                <span className="desktop-header-title">
                  {selectedAgent === "Main Agent"
                    ? "BACKOFFICE ROUTER AGENT"
                    : isEmailAgentSelected
                      ? "BACKOFFICE EMAIL"
                      : selectedAgent === "Usage Agent"
                        ? "USAGE AGENT"
                        : selectedAgent === "Configuration Agent"
                          ? "TECHNICAL SUPPORT ASSISTANT"
                          : selectedAgent.toUpperCase()}
                </span>
                {/* Hamburger — mobile only, right-aligned */}
                <button
                  className="mobile-menu-btn"
                  onClick={() => setIsMobileMenuOpen(prev => !prev)}
                  aria-label="Select agent"
                >
                  <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </svg>
                </button>
              </div>

              {/* Non-implemented agents: blank body, no chat UI */}
              {selectedAgent === "Usage Agent" ? (
                /* ── Usage Agent: Split-pane Chat + Raw API Panel ── */
                <div className="usage-layout">
                  {/* Left: Chat Panel */}
                  <div className="usage-chat-panel">
                    <div className="usage-chat-box">
                      {usageMessages.length === 0 && !usageLoading && (
                        <div className="agent-empty-state">
                          <div className="agent-empty-icon usage-icon">
                            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                            </svg>
                          </div>
                          <h2 className="agent-empty-title">Usage Agent</h2>
                          <p className="agent-empty-subtitle">Ask anything about a subscriber's data usage.<br />Try: <em>"Show dashboard summary for 94113627500"</em></p>
                        </div>
                      )}
                      {usageMessages.map((msg, idx) => {
                        return (
                          <div key={idx} className={`usage-message ${msg.role === "user" ? "usage-msg-user" : "usage-msg-assistant"}`}>
                            <div className="usage-msg-bubble">
                              {msg.role === "assistant" && (
                                <div className="usage-msg-avatar">🤖</div>
                              )}
                              {msg.role === "user"
                                ? <p className="usage-md-p">{msg.content}</p>
                                : renderMarkdown(msg.content)
                              }
                            </div>
                            {msg.techDetails && msg.techDetails.length > 0 && (
                              <button
                                className="view-tech-details-btn"
                                style={{ marginTop: '8px' }}
                                onClick={() => {
                                  const rawData = msg.rawJson || msg.apiDataRaw || null;
                                  setUsageRawApiData(rawData);
                                  setUsageApiType(msg.apiType || null);
                                  if (window.innerWidth <= 768) {
                                    setIsMobileUsageApiPanelOpen(true);
                                  }
                                }}
                              >
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                  <polyline points="14 2 14 8 20 8" />
                                  <line x1="16" y1="13" x2="8" y2="13" />
                                  <line x1="16" y1="17" x2="8" y2="17" />
                                </svg>
                                {msg.apiType === "dashboard" && "Dashboard Summary"}
                                {msg.apiType === "protocol" && "Protocol Usage"}
                                {msg.apiType === "billing" && "Billing"}
                                {msg.apiType === "api" && "API Response"}
                                {!msg.apiType && "View Technical Details"}
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="9 18 15 12 9 6" />
                                </svg>
                              </button>
                            )}
                          </div>
                        );
                      })}
                      {usageLoading && (
                        <div className="usage-message usage-msg-assistant">
                          <div className="usage-msg-bubble">
                            <div className="usage-msg-avatar">🤖</div>
                            <div className="typing"><span></span><span></span><span></span></div>
                          </div>
                        </div>
                      )}
                      <div ref={usageMessagesEndRef} />
                    </div>
                    {/* Input bar */}
                    <div className="usage-input-row">
                      <div className="usage-input-container">
                        <input
                          type="text"
                          className="usage-input"
                          placeholder="Ask about a subscriber's usage..."
                          value={usageInput}
                          onChange={e => setUsageInput(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && handleUsageSubmit()}
                        />
                        <button className="usage-send-btn" onClick={handleUsageSubmit} title="Send">
                          <svg viewBox="0 0 24 24" className="send-icon"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Right: Structured API Details Panel — only shown after chat starts */}
                  {usageRawApiData !== null && (
                    <div className={`usage-raw-panel ${isMobileUsageApiPanelOpen ? "usage-api-panel-expanded" : "usage-api-panel-collapsed"}`}>
                      {/* Header — clickable on mobile to toggle */}
                      <div
                        className="usage-raw-header"
                        onClick={() => setIsMobileUsageApiPanelOpen(prev => !prev)}
                      >
                        <span className="usage-raw-title" style={{ paddingLeft: '8px' }}>
                          {usageApiType === "dashboard" && "Dashboard Summary"}
                          {usageApiType === "protocol" && "Protocol Usage"}
                          {usageApiType === "billing" && "Billing"}
                          {usageApiType === "api" && "API Response"}
                          {!usageApiType && "API Data Panel"}
                        </span>
                        {/* Chevron — mobile only */}
                        <svg
                          className="usage-api-panel-chevron"
                          viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" strokeWidth="2.5"
                          strokeLinecap="round" strokeLinejoin="round"
                        >
                          <polyline points={isMobileUsageApiPanelOpen ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
                        </svg>
                      </div>
                      {/* Content */}
                      <div className="usage-api-panel-content">
                        {usageRawApiData ? (
                          <div style={{ flex: 1, overflowY: 'auto' }} className="tech-data">
                            {buildTechRows(usageRawApiData, null).map((row, i) => {
                              if (row.isSection && !row.isSubSection) {
                                return (
                                  <div key={i} className="tech-row tech-section-header">
                                    <span className="tech-section-label">{row.key.replace(/_/g, " ").trim()}</span>
                                  </div>
                                );
                              }
                              if (row.isSubSection) {
                                return (
                                  <div key={i} className="tech-row tech-row-indented tech-subsection-header" style={{ gridTemplateColumns: '1fr' }}>
                                    <span className="tech-subsection-label" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.key.replace(/_/g, " ").trim()}</span>
                                  </div>
                                );
                              }
                              if (row.isItemHeader) {
                                return (
                                  <div key={i} className="tech-row tech-row-indented" style={{ backgroundColor: '#e8edf8', borderTop: '2px solid #c7d2fe', borderBottom: '1px solid #c7d2fe', gridTemplateColumns: '1fr' }}>
                                    <span className="tech-key" style={{ fontWeight: '700', color: '#3730a3', fontSize: '12.5px', letterSpacing: '0.2px', paddingLeft: '8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      ▸ {row.key.replace(/_/g, " ").trim()}
                                    </span>
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
                                  <span className="tech-key">{row.key.replace(/_/g, " ").trim()}</span>
                                  <span className={`tech-value ${statusColor(row.value)}`}>
                                    {row.value}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="usage-raw-empty">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                            </svg>
                            <p>Raw API data will appear here<br />after you send a query.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : isNonImplemented ? (
                <div className="agent-empty-state">
                  <div className="agent-empty-icon coming-soon-icon">
                    {selectedAgent === "Usage Agent" ? (
                      <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="3" y1="9" x2="21" y2="9"></line>
                        <line x1="9" y1="21" x2="9" y2="9"></line>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="5"></circle>
                        <line x1="12" y1="1" x2="12" y2="3"></line>
                        <line x1="12" y1="21" x2="12" y2="23"></line>
                        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                        <line x1="1" y1="12" x2="3" y2="12"></line>
                        <line x1="21" y1="12" x2="23" y2="12"></line>
                        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                      </svg>
                    )}
                  </div>
                  <h2 className="agent-empty-title">{selectedAgent}</h2>
                  <p className="agent-empty-subtitle">This agent is currently under development and will be available soon.</p>
                  <div className="coming-soon-badge">COMING SOON</div>
                  <button className="go-to-email-btn" onClick={() => handleSelectAgent("Email Solution Agent")}>
                    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                      <polyline points="22,6 12,13 2,6"></polyline>
                    </svg>
                    Go to Email Agent
                  </button>
                </div>
              ) : (
                <>
                  {/* Chat messages area */}
                  <div className={`chat-box ${isEmailAgentSelected ? "email-chat-box" : ""}`}>
                    {selectedAgent === "Main Agent" ? (
                      mainMessages.length === 0 ? (
                        <div className="agent-empty-state">
                          <div className="agent-empty-icon main-icon">
                            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1 1 .03 2.71-1.379 2.41l-2.134-.534M5 14.5l-1.402 1.402c-1 1-.029 2.71 1.379 2.41l2.134-.534M5 14.5L12 21l7-6.5" />
                            </svg>
                          </div>
                          <h2 className="agent-empty-title">Main Agent</h2>
                          <p className="agent-empty-subtitle">Ask any customer support question and I'll route it to the right specialist automatically.<br />Try: <em>"Check line health for subscriber 94112322658"</em></p>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '16px' }}>
                            {[
                              "Check line health for subscriber 94112322658",
                              "Show data usage for subscriber 94112322658",
                              "I cannot login to my email account",
                              "Check bill for account 0015472433"
                            ].map((prompt, i) => (
                              <button
                                key={i}
                                onClick={() => handleMainSubmit(prompt)}
                                style={{
                                  background: '#f1f5f9', border: '1px solid #e2e8f0',
                                  color: '#475569', padding: '6px 12px', borderRadius: '16px',
                                  fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit'
                                }}
                              >
                                {prompt}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        mainMessages.map((msg, index) => (
                          <div
                            key={index}
                            className={msg.role === "assistant" ? "message assistant main-agent-msg" : "message user"}
                          >
                            {msg.role === "assistant" && msg.toolCalled && (
                              <div style={{
                                display: 'inline-block',
                                background: 'rgba(99,102,241,0.1)',
                                border: '1px solid #6366f1',
                                color: '#6366f1',
                                fontSize: '0.72rem',
                                fontWeight: '600',
                                padding: '2px 9px',
                                borderRadius: '6px',
                                marginBottom: '8px'
                              }}>
                                ⚡ Routed via: {msg.toolCalled}
                              </div>
                            )}
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
                          </div>
                        ))
                      )
                    ) : selectedAgent === "Configuration Agent" && chatMessages.length === 0 ? (
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
                        <h2 className="agent-empty-title">Email Solution Agent</h2>
                        <p className="agent-empty-subtitle">Describe the customer's email issue. I'll analyze the symptoms and provide real-time troubleshooting steps.</p>
                      </div>
                    ) : (
                      chatMessages.map((msg, index) => {
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
                            {msg.role === "assistant" && msg.toolCalled && (
                              <div style={{
                                display: 'inline-block',
                                background: 'rgba(99,102,241,0.1)',
                                border: '1px solid #6366f1',
                                color: '#6366f1',
                                fontSize: '0.72rem',
                                fontWeight: '600',
                                padding: '2px 9px',
                                borderRadius: '6px',
                                marginBottom: '8px'
                              }}>
                                ⚡ Routed via: {msg.toolCalled}
                              </div>
                            )}
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

                            {msg.techDetails && msg.techDetails.length > 0 && (
                              <button
                                className="view-tech-details-btn"
                                onClick={() => {
                                  setApiData(msg.apiDataRaw || null);
                                  setDevOutput(msg.devOutputRaw || null);
                                }}
                              >
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                  <polyline points="14 2 14 8 20 8" />
                                  <line x1="16" y1="13" x2="8" y2="13" />
                                  <line x1="16" y1="17" x2="8" y2="17" />
                                </svg>
                                View Technical Details
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="9 18 15 12 9 6" />
                                </svg>
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}

                    {selectedAgent === "Main Agent" ? (
                      mainLoading && (
                        <div className="message assistant main-agent-msg">
                          <div className="typing">
                            <span></span><span></span><span></span>
                          </div>
                        </div>
                      )
                    ) : (
                      loading && (
                        <div className="message assistant">
                          <div className="typing">
                            <span></span><span></span><span></span>
                          </div>
                        </div>
                      )
                    )}
                    {selectedAgent === "Main Agent" ? <div ref={mainMessagesEndRef} /> : <div ref={messagesEndRef} />}
                  </div>

                  {/* Chat input */}
                  <div className="chat-input">
                    <div className="chat-input-container">
                      {selectedAgent === "Main Agent" ? (
                        <>
                          <input
                            type="text"
                            placeholder="Type your message..."
                            value={mainInput}
                            onChange={(e) => setMainInput(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleMainSubmit()}
                          />
                          <button className="send-icon-btn" onClick={() => handleMainSubmit()} title="Send Message">
                            <svg viewBox="0 0 24 24" className="send-icon">
                              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                            </svg>
                          </button>
                        </>
                      ) : (
                        <>
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
                        </>
                      )}
                    </div>
                  </div>


                  {/* ── Mobile Tech Panel — shown only when showTechPanel is true ── */}
                  {showTechPanel && (
                    <div className={`tech-panel mobile-only-tech ${isMobileTechPanelOpen ? "mobile-expanded" : "mobile-collapsed"}`}>
                      <h3 onClick={() => {
                        if (window.innerWidth <= 768) {
                          setIsMobileTechPanelOpen(!isMobileTechPanelOpen);
                        }
                      }}>
                        Technical Details
                        <svg className="mobile-tech-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points={isMobileTechPanelOpen ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
                        </svg>
                      </h3>

                      <div className="tech-panel-content">
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
                    </div>
                  )}
                </>
              )}

              {/* Footer */}
              <div className="app-footer">
                <div className="footer-content">
                  <span className="powered-by">POWERED BY</span>
                  <div className="footer-logo-container">
                    <img
                      src="/sltmobitel-icon-transparent.png"
                      alt="SLT Mobitel Logo"
                      className="footer-logo-img"
                    />
                    <div className="footer-logo-text">
                      <div className="logo-slt-mobitel">
                        <span className="logo-slt">SLT</span>
                        <span className="logo-mobitel">MOBITEL</span>
                      </div>
                      <div className="logo-embryo">THEEMBRYO</div>
                      <div className="logo-innovation">INNOVATION CENTRE</div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Desktop Resizer & Tech Panel — shown only when showTechPanel is true ── */}
        {showTechPanel && (
          <>
            <div className="resizer desktop-only-tech" onMouseDown={startResizing} title="Drag to resize panel"></div>
            <div className={`tech-panel desktop-only-tech ${isMobileTechPanelOpen ? "mobile-expanded" : "mobile-collapsed"}`}>
              <h3 onClick={() => {
                if (window.innerWidth <= 768) {
                  setIsMobileTechPanelOpen(!isMobileTechPanelOpen);
                }
              }}>
                Technical Details
                <svg className="mobile-tech-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points={isMobileTechPanelOpen ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
                </svg>
              </h3>

              <div className="tech-panel-content">
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
            </div>
          </>
        )}

      </div>


      {/* ── Mobile Top Navigation Dropdown (mobile only, hidden on desktop) ── */}
      {isMobileMenuOpen && (
        <div className="mobile-dropdown-overlay" onClick={() => setIsMobileMenuOpen(false)} />
      )}
      <nav className={`mobile-top-dropdown ${isMobileMenuOpen ? "open" : ""}`}>
        {agents.map((agent, index) => (
          <button
            key={index}
            className={`mobile-dropdown-item ${selectedAgent === agent ? "active" : ""}`}
            onClick={() => { handleSelectAgent(agent); setIsMobileMenuOpen(false); }}
          >
            <span className="mobile-dropdown-dot" />
            {agent}
            {selectedAgent === agent && (
              <svg className="mobile-dropdown-check" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
        ))}
      </nav>
    </>
  );
}

export default App;