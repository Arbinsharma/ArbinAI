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

        // If a tunnel URL was restored, try to fetch models immediately
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
        // Modal
        if (elements.enterBtn) {
            elements.enterBtn.addEventListener('click', closeWelcomeModal);
        }

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

            // Prefer saved model, then mythomax, then first
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

        if (!activeSession || active