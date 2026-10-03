/**
 * Arbin AI - Client-Side Controller & Neural Interface Engine
 * Handles app lifecycle, session storage, model discovery, and Ollama tunnel fetch.
 */

const ArbinApp = (() => {
    // ===================== Config & State =====================
    const DEFAULT_MODEL = 'wangtcalex/mythomax-13b:latest';
    const STORAGE_KEY = 'arbin-ai-sessions-v1';
    const TUNNEL_STORAGE_KEY = 'arbin-ai-tunnel-url';
    const MODEL_STORAGE_KEY = 'arbin-ai-model';

    let chatSessions = [];
    let currentSessionIndex = null;
    let currentModel = DEFAULT_MODEL;
    let isStreaming = false;
    let modelFetchDebounce = null;

    let elements = {};

    // ===================== Init =====================
    function init() {
        elements = {
            modalOverlay: document.getElementById('permission-modal'),
            enterBtn: document.getElementById('enter-workspace-btn'),
            sidebar: document.getElementById('arbin-sidebar'),
            newChatBtn: document.getElementById('new-chat-btn'),
            tunnelInput: document.getElementById('tunnel-url-input'),
            tunnelBadge: document.getElementById('tunnel-status-indicator'),
            modelSelect: document.getElementById('model-select'),
            historyContainer: document.getElementById('history-container'),
            chatScrollport: document.getElementById('chat-scrollport'),
            promptTextarea: document.getElementById('user-prompt-textarea'),
            submitBtn: document.getElementById('submit-prompt-btn')
        };

        injectMobileToggle();
        loadSessionsFromStorage();
        restoreTunnelFromStorage();
        bindEvents();
        checkInitialState();

        const savedTunnel = elements.tunnelInput.value.trim();
        if (savedTunnel) {
            fetchAvailableModels(savedTunnel);
        }
    }

    function injectMobileToggle() {
        const toggle = document.createElement('button');
        toggle.className = 'mobile-menu-toggle';
        toggle.setAttribute('aria-label', 'Toggle sidebar');
        toggle.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;

        const backdrop = document.createElement('div');
        backdrop.className = 'arbin-sidebar-backdrop';

        document.querySelector('.arbin-main-workspace').appendChild(toggle);
        document.body.appendChild(backdrop);

        toggle.addEventListener('click', () => {
            elements.sidebar.classList.toggle('mobile-open');
            backdrop.classList.toggle('active');
        });

        backdrop.addEventListener('click', () => {
            elements.sidebar.classList.remove('mobile-open');
            backdrop.classList.remove('active');
        });
    }

    function bindEvents() {
        // Modal close
        if (elements.enterBtn) {
            elements.enterBtn.addEventListener('click', closeWelcomeModal);
        }
        // Also allow clicking the backdrop to dismiss
        if (elements.modalOverlay) {
            elements.modalOverlay.addEventListener('click', (e) => {
                if (e.target === elements.modalOverlay) closeWelcomeModal();
            });
        }
        // Escape key dismisses modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && elements.modalOverlay && !elements.modalOverlay.classList.contains('hidden')) {
                closeWelcomeModal();
            }
        });

        // Sidebar
        if (elements.newChatBtn) {
            elements.newChatBtn.addEventListener('click', () => {
                createNewChatSession(true);
                elements.sidebar.classList.remove('mobile-open');
                document.querySelector('.arbin-sidebar-backdrop')?.classList.remove('active');
            });
        }

        // Textarea
        if (elements.promptTextarea) {
            elements.promptTextarea.addEventListener('input', handleTextareaAutoresize);
            elements.promptTextarea.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    executePromptSubmission();
                }
            });
        }

        if (elements.submitBtn) {
            elements.submitBtn.addEventListener('click', executePromptSubmission);
        }

        // Tunnel input
        if (elements.tunnelInput) {
            elements.tunnelInput.addEventListener('input', handleTunnelUrlValidation);
            elements.tunnelInput.addEventListener('blur', () => {
                const val = elements.tunnelInput.value.trim();
                if (val) {
                    localStorage.setItem(TUNNEL_STORAGE_KEY, val);
                } else {
                    localStorage.removeItem(TUNNEL_STORAGE_KEY);
                }
            });
        }

        // Model select
        if (elements.modelSelect) {
            elements.modelSelect.addEventListener('change', (e) => {
                currentModel = e.target.value;
                localStorage.setItem(MODEL_STORAGE_KEY, currentModel);
            });
        }
    }

    function checkInitialState() {
        if (chatSessions.length === 0) {
            createNewChatSession(false);
        } else {
            currentSessionIndex = 0;
        }
        renderHistoryList();
        renderActiveChatWorkspace();
    }

    function restoreTunnelFromStorage() {
        const savedTunnel = localStorage.getItem(TUNNEL_STORAGE_KEY);
        if (savedTunnel && elements.tunnelInput) {
            elements.tunnelInput.value = savedTunnel;
            elements.tunnelBadge.textContent = 'Linked Active';
            elements.tunnelBadge.classList.add('linked');
        }
        const savedModel = localStorage.getItem(MODEL_STORAGE_KEY);
        if (savedModel) {
            currentModel = savedModel;
        }
    }

    // ===================== Modal =====================
    function closeWelcomeModal() {
        if (elements.modalOverlay) {
            elements.modalOverlay.classList.add('hidden');
        }
    }

    // ===================== Sessions =====================
    function createNewChatSession(render = true) {
        const newSession = {
            id: 'session-' + Date.now(),
            title: 'New Conversation',
            messages: []
        };
        chatSessions.unshift(newSession);
        currentSessionIndex = 0;

        if (render) {
            renderHistoryList();
            renderActiveChatWorkspace();
            persistSessions();
        }
    }

    function loadSessionsFromStorage() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    chatSessions = parsed;
                    currentSessionIndex = 0;
                }
            }
        } catch (err) {
            console.warn('Could not load sessions from storage:', err);
        }
    }

    function persistSessions() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(chatSessions));
        } catch (err) {
            console.warn('Could not persist sessions:', err);
        }
    }

    // ===================== Input Helpers =====================
    function handleTextareaAutoresize(e) {
        const ta = e.target;
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
    }

    function handleTunnelUrlValidation(e) {
        const val = e.target.value.trim();
        if (val.length > 8 && /^https?:\/\//i.test(val)) {
            elements.tunnelBadge.textContent = 'Linked Active';
            elements.tunnelBadge.classList.add('linked');

            clearTimeout(modelFetchDebounce);
            modelFetchDebounce = setTimeout(() => fetchAvailableModels(val), 700);
        } else {
            elements.tunnelBadge.textContent = 'Unlinked';
            elements.tunnelBadge.classList.remove('linked');
        }
    }

    // ===================== Model Discovery =====================
    async function fetchAvailableModels(rawUrl) {
        const cleanBaseUrl = rawUrl.replace(/\/+$/, '');
        const tagsUrl = `${cleanBaseUrl}/api/tags`;

        elements.modelSelect.innerHTML = '<option value="">Loading models...</option>';

        try {
            const res = await fetch(tagsUrl, { method: 'GET' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();
            const models = (data.models || []).map(m => m.name);

            if (models.length === 0) {
                elements.modelSelect.innerHTML = '<option value="">No models found</option>';
                return;
            }

            elements.modelSelect.innerHTML = models
                .map(name => `<option value="${name}">${name}</option>`)
                .join('');

            const savedModel = localStorage.getItem(MODEL_STORAGE_KEY);
            const preferred =
                (savedModel && models.includes(savedModel) && savedModel) ||
                models.find(n => n.toLowerCase().includes('mythomax')) ||
                models[0];

            elements.modelSelect.value = preferred;
            currentModel = preferred;

        } catch (err) {
            console.warn('Could not fetch model list:', err);
            elements.modelSelect.innerHTML = `<option value="${currentModel}">${currentModel}</option>`;
        }
    }

    // ===================== Rendering =====================
    function renderHistoryList() {
        if (!elements.historyContainer) return;
        elements.historyContainer.innerHTML = '';

        chatSessions.forEach((session, index) => {
            const pill = document.createElement('div');
            pill.className = `history-item-pill ${index === currentSessionIndex ? 'active' : ''}`;
            pill.textContent = session.title;
            pill.setAttribute('role', 'button');
            pill.setAttribute('tabindex', '0');
            pill.addEventListener('click', () => {
                currentSessionIndex = index;
                renderHistoryList();
                renderActiveChatWorkspace();
                elements.sidebar.classList.remove('mobile-open');
                document.querySelector('.arbin-sidebar-backdrop')?.classList.remove('active');
            });
            elements.historyContainer.appendChild(pill);
        });
    }

    function renderActiveChatWorkspace() {
        if (!elements.chatScrollport) return;
        elements.chatScrollport.innerHTML = '';

        const activeSession = chatSessions[currentSessionIndex];

        if (!activeSession || activeSession.messages.length === 0) {
            elements.chatScrollport.innerHTML = `
                <div class="arbin-welcome-hero" id="welcome-hero-screen">
                    <div class="hero-logo-glow"></div>
                    <h2 class="hero-title">Arbin AI</h2>
                    <p class="hero-subtitle">What would you like to build, analyze, or discover today?</p>
                </div>
            `;
            return;
        }

        activeSession.messages.forEach(msg => {
            appendMessageNode(msg.text, msg.sender, msg.isError || false, false);
        });

        elements.chatScrollport.scrollTop = elements.chatScrollport.scrollHeight;
    }

    function appendMessageNode(text, sender, isError = false, scrollToBottom = true) {
        const hero = document.getElementById('welcome-hero-screen');
        if (hero) hero.remove();

        const row = document.createElement('div');
        row.className = `arbin-message-row ${sender}`;

        const avatar = document.createElement('div');
        avatar.className = `message-avatar ${sender}`;
        avatar.textContent = sender === 'ai' ? 'AI' : 'AS';

        const bubble = document.createElement('div');
        bubble.className = `message-bubble-content ${isError ? 'error-state' : ''}`;
        bubble.textContent = text;

        if (sender === 'ai') {
            row.appendChild(avatar);
            row.appendChild(bubble);
        } else {
            row.appendChild(bubble);
            row.appendChild(avatar);
        }

        elements.chatScrollport.appendChild(row);

        if (scrollToBottom) {
            elements.chatScrollport.scrollTop = elements.chatScrollport.scrollHeight;
        }
    }

    function appendThinkingNode() {
        const thinkingId = 'thinking-node-' + Date.now();
        const row = document.createElement('div');
        row.className = 'arbin-message-row ai';
        row.id = thinkingId;
        row.innerHTML = `
            <div class="message-avatar ai">AI</div>
            <div class="message-bubble-content">
                <span class="thinking-dots"><span></span><span></span><span></span></span>
            </div>
        `;
        elements.chatScrollport.appendChild(row);
        elements.chatScrollport.scrollTop = elements.chatScrollport.scrollHeight;
        return thinkingId;
    }

    // ===================== Submission =====================
    async function executePromptSubmission() {
        if (isStreaming) return;

        const rawUrl = elements.tunnelInput.value.trim();
        const promptText = elements.promptTextarea.value.trim();

        if (!rawUrl) {
            alert('Please paste your active Cloudflare tunnel URL in the top bar before prompting.');
            elements.tunnelInput.focus();
            return;
        }

        if (!promptText) return;

        if (currentSessionIndex === null) {
            createNewChatSession(false);
        }

        const activeSession = chatSessions[currentSessionIndex];

        if (activeSession.messages.length === 0) {
            activeSession.title = promptText.length > 28
                ? promptText.substring(0, 28) + '...'
                : promptText;
            renderHistoryList();
        }

        activeSession.messages.push({ sender: 'user', text: promptText });
        appendMessageNode(promptText, 'user');

        elements.promptTextarea.value = '';
        elements.promptTextarea.style.height = 'auto';
        isStreaming = true;
        elements.submitBtn.disabled = true;

        const thinkingId = appendThinkingNode();

        const cleanBaseUrl = rawUrl.replace(/\/+$/, '');
        const apiEndpoint = `${cleanBaseUrl}/api/generate`;

        try {
            const response = await fetch(apiEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: currentModel,
                    prompt: promptText,
                    stream: false
                })
            });

            document.getElementById(thinkingId)?.remove();

            if (!response.ok) {
                const exactHttpError = `HTTP Status Error [${response.status}] ${response.statusText}`;
                activeSession.messages.push({ sender: 'ai', text: exactHttpError, isError: true });
                appendMessageNode(exactHttpError, 'ai', true);
                persistSessions();
                return;
            }

            const responsePayload = await response.json();
            const modelResponseText = responsePayload.response
                || 'Received empty response string structure from backend model.';

            activeSession.messages.push({ sender: 'ai', text: modelResponseText });
            appendMessageNode(modelResponseText, 'ai');
            persistSessions();

        } catch (error) {
            document.getElementById(thinkingId)?.remove();

            console.error('Arbin AI fetch failed:', {
                error,
                url: apiEndpoint,
                model: currentModel
            });

            let hint = '';
            if (error.message === 'Failed to fetch') {
                hint = ' — check: (1) tunnel is live, (2) Ollama is running, (3) OLLAMA_ORIGINS allows this page, (4) not mixing https→http.';
            }

            const exactNetworkError = `Connection Failed: ${error.message}${hint}`;
            activeSession.messages.push({ sender: 'ai', text: exactNetworkError, isError: true });
            appendMessageNode(exactNetworkError, 'ai', true);
            persistSessions();

        } finally {
            isStreaming = false;
            elements.submitBtn.disabled = false;
            elements.promptTextarea.focus();
        }
    }

    // ===================== Public API =====================
    return {
        init,
        closeWelcomeModal,
        createNewChatSession
    };
})();

document.addEventListener('DOMContentLoaded', ArbinApp.init);