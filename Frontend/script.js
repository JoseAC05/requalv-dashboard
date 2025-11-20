// Configuration
const API_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:5000'
    : (import.meta?.env?.VITE_API_URL || 'https://tu-backend.herokuapp.com');

const ENDPOINTS = {
    clients: '/api/clients',
    requirements: '/api/requirements',
    stats: '/api/stats',
    health: '/api/health'
};

// Global State
let socket = null;
let clients = [];
let requirements = [];
let currentClientId = null;
let currentRequirementId = null;
let isConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
});

function initializeApp() {
    updateConnectionStatus('connecting');
    connectToBackend();
    connectWebSocket();
}

function setupEventListeners() {
    document.getElementById('addClientBtn').addEventListener('click', openAddClientModal);
    document.getElementById('saveClientBtn').addEventListener('click', saveClient);
    document.getElementById('saveRequirementBtn').addEventListener('click', saveRequirement);
    document.getElementById('refreshBtn').addEventListener('click', refreshDashboard);
    document.getElementById('exportBtn').addEventListener('click', exportData);
    document.getElementById('searchInput').addEventListener('input', handleSearch);
    
    // Close modals on outside click
    document.getElementById('clientModal').addEventListener('click', (e) => {
        if (e.target.id === 'clientModal') closeClientModal();
    });
    document.getElementById('requirementModal').addEventListener('click', (e) => {
        if (e.target.id === 'requirementModal') closeRequirementModal();
    });
}

// Backend Connection
async function connectToBackend() {
    try {
        const response = await fetch(`${API_URL}${ENDPOINTS.health}`);
        if (response.ok) {
            isConnected = true;
            reconnectAttempts = 0;
            await loadAllData();
        } else {
            throw new Error('Backend not responding');
        }
    } catch (error) {
        console.error('Connection error:', error);
        isConnected = false;
        updateConnectionStatus('disconnected');
        showToast('Error de conexión con el servidor', 'error');
        scheduleReconnect();
    }
}

async function loadAllData() {
    try {
        await Promise.all([
            loadClients(),
            loadRequirements(),
            loadStats()
        ]);
        updateConnectionStatus('connected');
    } catch (error) {
        console.error('Error loading data:', error);
        showToast('Error al cargar datos', 'error');
    }
}

async function loadClients() {
    try {
        const response = await fetch(`${API_URL}${ENDPOINTS.clients}`);
        if (response.ok) {
            clients = await response.json();
            renderClients();
        } else {
            throw new Error('Failed to load clients');
        }
    } catch (error) {
        console.error('Error loading clients:', error);
        clients = [];
        renderClients();
    }
}

async function loadRequirements() {
    try {
        const response = await fetch(`${API_URL}${ENDPOINTS.requirements}`);
        if (response.ok) {
            requirements = await response.json();
        } else {
            throw new Error('Failed to load requirements');
        }
    } catch (error) {
        console.error('Error loading requirements:', error);
        requirements = [];
    }
}

async function loadStats() {
    try {
        const response = await fetch(`${API_URL}${ENDPOINTS.stats}`);
        if (response.ok) {
            const stats = await response.json();
            updateStats(stats);
        } else {
            // Calculate stats locally if endpoint fails
            calculateLocalStats();
        }
    } catch (error) {
        console.error('Error loading stats:', error);
        calculateLocalStats();
    }
}

function calculateLocalStats() {
    const stats = {
        total_clients: clients.length,
        active_requirements: requirements.filter(r => r.status !== 'completed').length,
        completed_requirements: requirements.filter(r => r.status === 'completed').length
    };
    updateStats(stats);
}

function updateStats(stats) {
    document.getElementById('totalClients').textContent = stats.total_clients || 0;
    document.getElementById('activeRequirements').textContent = stats.active_requirements || 0;
    document.getElementById('completedRequirements').textContent = stats.completed_requirements || 0;
}

// WebSocket Connection
function connectWebSocket() {
    try {
        socket = io(API_URL, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            reconnectionAttempts: MAX_RECONNECT_ATTEMPTS
        });

        socket.on('connect', () => {
            console.log('WebSocket connected');
            reconnectAttempts = 0;
            updateConnectionStatus('connected');
        });

        socket.on('disconnect', () => {
            console.log('WebSocket disconnected');
            updateConnectionStatus('disconnected');
        });

        socket.on('connect_error', (error) => {
            console.error('WebSocket connection error:', error);
            updateConnectionStatus('disconnected');
        });

        // Client events
        socket.on('client_created', (data) => {
            console.log('Client created:', data);
            clients.push(data);
            renderClients();
            calculateLocalStats();
            showToast(`Cliente "${data.name}" creado`, 'success');
        });

        socket.on('client_updated', (data) => {
            console.log('Client updated:', data);
            const index = clients.findIndex(c => c.id === data.id);
            if (index !== -1) {
                clients[index] = data;
                renderClients();
                showToast(`Cliente "${data.name}" actualizado`, 'info');
            }
        });

        socket.on('client_deleted', (data) => {
            console.log('Client deleted:', data);
            clients = clients.filter(c => c.id !== data.id);
            renderClients();
            calculateLocalStats();
            showToast('Cliente eliminado', 'warning');
        });

        // Requirement events
        socket.on('requirement_created', (data) => {
            console.log('Requirement created:', data);
            requirements.push(data);
            renderClients();
            calculateLocalStats();
            showToast(`Requerimiento "${data.title}" creado`, 'success');
        });

        socket.on('requirement_updated', (data) => {
            console.log('Requirement updated:', data);
            const index = requirements.findIndex(r => r.id === data.id);
            if (index !== -1) {
                requirements[index] = data;
                renderClients();
                calculateLocalStats();
                showToast(`Requerimiento actualizado`, 'info');
            }
        });

        socket.on('requirement_deleted', (data) => {
            console.log('Requirement deleted:', data);
            requirements = requirements.filter(r => r.id !== data.id);
            renderClients();
            calculateLocalStats();
            showToast('Requerimiento eliminado', 'warning');
        });

    } catch (error) {
        console.error('WebSocket setup error:', error);
        updateConnectionStatus('disconnected');
    }
}

function scheduleReconnect() {
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
        setTimeout(() => {
            updateConnectionStatus('connecting');
            connectToBackend();
        }, delay);
    } else {
        showToast('No se pudo conectar al servidor. Por favor recarga la página.', 'error');
    }
}

function updateConnectionStatus(status) {
    const statusEl = document.getElementById('connectionStatus');
    const textEl = document.getElementById('connectionText');
    
    statusEl.className = 'connection-status ' + status;
    
    switch(status) {
        case 'connected':
            textEl.textContent = 'Conectado';
            break;
        case 'disconnected':
            textEl.textContent = 'Desconectado';
            break;
        case 'connecting':
            textEl.textContent = 'Conectando...';
            break;
    }
}

// Client Operations
function openAddClientModal() {
    currentClientId = null;
    document.getElementById('clientModalTitle').textContent = 'Nuevo Cliente';
    document.getElementById('clientForm').reset();
    document.getElementById('clientModal').classList.add('active');
}

function openEditClientModal(clientId) {
    const client = clients.find(c => c.id === clientId);
    if (!client) return;
    
    currentClientId = clientId;
    document.getElementById('clientModalTitle').textContent = 'Editar Cliente';
    document.getElementById('clientName').value = client.name || '';
    document.getElementById('clientEmail').value = client.email || '';
    document.getElementById('clientCompany').value = client.company || '';
    document.getElementById('clientPhone').value = client.phone || '';
    document.getElementById('clientStatus').value = client.status || 'active';
    document.getElementById('clientModal').classList.add('active');
}

function closeClientModal() {
    document.getElementById('clientModal').classList.remove('active');
    currentClientId = null;
}

async function saveClient() {
    const name = document.getElementById('clientName').value.trim();
    const email = document.getElementById('clientEmail').value.trim();
    const company = document.getElementById('clientCompany').value.trim();
    const phone = document.getElementById('clientPhone').value.trim();
    const status = document.getElementById('clientStatus').value;
    
    if (!name || !email) {
        showToast('Por favor completa los campos requeridos', 'warning');
        return;
    }
    
    const clientData = {
        name,
        email,
        company,
        phone,
        status
    };
    
    const saveBtn = document.getElementById('saveClientBtn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<div class="spinner"></div> Guardando...';
    
    try {
        let response;
        if (currentClientId) {
            response = await fetch(`${API_URL}${ENDPOINTS.clients}/${currentClientId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(clientData)
            });
        } else {
            response = await fetch(`${API_URL}${ENDPOINTS.clients}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(clientData)
            });
        }
        
        if (response.ok) {
            const savedClient = await response.json();
            if (currentClientId) {
                const index = clients.findIndex(c => c.id === currentClientId);
                if (index !== -1) clients[index] = savedClient;
            } else {
                clients.push(savedClient);
            }
            renderClients();
            calculateLocalStats();
            closeClientModal();
            showToast(`Cliente ${currentClientId ? 'actualizado' : 'creado'} exitosamente`, 'success');
        } else {
            throw new Error('Failed to save client');
        }
    } catch (error) {
        console.error('Error saving client:', error);
        showToast('Error al guardar el cliente', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = 'Guardar';
    }
}

async function deleteClient(clientId) {
    if (!confirm('¿Estás seguro de eliminar este cliente y todos sus requerimientos?')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}${ENDPOINTS.clients}/${clientId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            clients = clients.filter(c => c.id !== clientId);
            requirements = requirements.filter(r => r.client_id !== clientId);
            renderClients();
            calculateLocalStats();
            showToast('Cliente eliminado exitosamente', 'success');
        } else {
            throw new Error('Failed to delete client');
        }
    } catch (error) {
        console.error('Error deleting client:', error);
        showToast('Error al eliminar el cliente', 'error');
    }
}

// Requirement Operations
function openAddRequirementModal(clientId) {
    currentClientId = clientId;
    currentRequirementId = null;
    document.getElementById('requirementModalTitle').textContent = 'Nuevo Requerimiento';
    document.getElementById('requirementForm').reset();
    document.getElementById('requirementModal').classList.add('active');
}

function closeRequirementModal() {
    document.getElementById('requirementModal').classList.remove('active');
    currentClientId = null;
    currentRequirementId = null;
}

async function saveRequirement() {
    const title = document.getElementById('requirementTitle').value.trim();
    const description = document.getElementById('requirementDescription').value.trim();
    const priority = document.getElementById('requirementPriority').value;
    const status = document.getElementById('requirementStatus').value;
    
    if (!title) {
        showToast('Por favor ingresa un título', 'warning');
        return;
    }
    
    const requirementData = {
        title,
        description,
        priority,
        status,
        client_id: currentClientId
    };
    
    const saveBtn = document.getElementById('saveRequirementBtn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<div class="spinner"></div> Guardando...';
    
    try {
        let response;
        if (currentRequirementId) {
            response = await fetch(`${API_URL}${ENDPOINTS.requirements}/${currentRequirementId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requirementData)
            });
        } else {
            response = await fetch(`${API_URL}${ENDPOINTS.requirements}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requirementData)
            });
        }
        
        if (response.ok) {
            const savedRequirement = await response.json();
            if (currentRequirementId) {
                const index = requirements.findIndex(r => r.id === currentRequirementId);
                if (index !== -1) requirements[index] = savedRequirement;
            } else {
                requirements.push(savedRequirement);
            }
            renderClients();
            calculateLocalStats();
            closeRequirementModal();
            showToast(`Requerimiento ${currentRequirementId ? 'actualizado' : 'creado'} exitosamente`, 'success');
        } else {
            throw new Error('Failed to save requirement');
        }
    } catch (error) {
        console.error('Error saving requirement:', error);
        showToast('Error al guardar el requerimiento', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = 'Guardar';
    }
}

async function deleteRequirement(requirementId) {
    if (!confirm('¿Estás seguro de eliminar este requerimiento?')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}${ENDPOINTS.requirements}/${requirementId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            requirements = requirements.filter(r => r.id !== requirementId);
            renderClients();
            calculateLocalStats();
            showToast('Requerimiento eliminado exitosamente', 'success');
        } else {
            throw new Error('Failed to delete requirement');
        }
    } catch (error) {
        console.error('Error deleting requirement:', error);
        showToast('Error al eliminar el requerimiento', 'error');
    }
}

async function updateRequirementStatus(requirementId, newStatus) {
    try {
        const requirement = requirements.find(r => r.id === requirementId);
        if (!requirement) return;
        
        const response = await fetch(`${API_URL}${ENDPOINTS.requirements}/${requirementId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...requirement, status: newStatus })
        });
        
        if (response.ok) {
            const updatedRequirement = await response.json();
            const index = requirements.findIndex(r => r.id === requirementId);
            if (index !== -1) requirements[index] = updatedRequirement;
            renderClients();
            calculateLocalStats();
            showToast('Estado actualizado', 'success');
        } else {
            throw new Error('Failed to update requirement status');
        }
    } catch (error) {
        console.error('Error updating requirement status:', error);
        showToast('Error al actualizar el estado', 'error');
    }
}

// Render Functions
function renderClients() {
    const grid = document.getElementById('clientsGrid');
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    
    let filteredClients = clients;
    if (searchTerm) {
        filteredClients = clients.filter(client => 
            client.name.toLowerCase().includes(searchTerm) ||
            (client.email && client.email.toLowerCase().includes(searchTerm)) ||
            (client.company && client.company.toLowerCase().includes(searchTerm))
        );
    }
    
    if (filteredClients.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-users"></i>
                <p>${searchTerm ? 'No se encontraron clientes' : 'No hay clientes registrados'}</p>
                ${!searchTerm ? '<button class="btn btn-primary" onclick="openAddClientModal()"><i class="fas fa-plus"></i> Agregar Cliente</button>' : ''}
            </div>
        `;
        return;
    }
    
    grid.innerHTML = filteredClients.map(client => {
        const clientRequirements = requirements.filter(r => r.client_id === client.id);
        return `
            <div class="client-card">
                <div class="client-header">
                    <div class="client-info">
                        <h3>${escapeHtml(client.name)}</h3>
                        <div class="client-meta">
                            <span><i class="fas fa-envelope"></i> ${escapeHtml(client.email || 'Sin email')}</span>
                            ${client.company ? `<span><i class="fas fa-building"></i> ${escapeHtml(client.company)}</span>` : ''}
                            ${client.phone ? `<span><i class="fas fa-phone"></i> ${escapeHtml(client.phone)}</span>` : ''}
                            <span class="badge ${client.status || 'active'}">${getStatusLabel(client.status || 'active')}</span>
                        </div>
                    </div>
                    <div class="client-actions">
                        <button class="btn-icon" onclick="openEditClientModal(${client.id})" title="Editar">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-icon danger" onclick="deleteClient(${client.id})" title="Eliminar">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                
                <div class="requirements-section">
                    <div class="requirements-header">
                        <h4>Requerimientos (${clientRequirements.length})</h4>
                        <button class="btn btn-primary btn-sm" onclick="openAddRequirementModal(${client.id})">
                            <i class="fas fa-plus"></i> Agregar
                        </button>
                    </div>
                    
                    ${clientRequirements.length > 0 ? `
                        <div class="requirements-list">
                            ${clientRequirements.map(req => `
                                <div class="requirement-item">
                                    <div class="requirement-content">
                                        <div class="requirement-title">${escapeHtml(req.title)}</div>
                                        <div class="requirement-meta">
                                            <span class="badge ${req.status}">${getStatusLabel(req.status)}</span>
                                            <span class="badge ${req.priority}">${getPriorityLabel(req.priority)}</span>
                                            ${req.description ? `<span>${escapeHtml(req.description.substring(0, 50))}${req.description.length > 50 ? '...' : ''}</span>` : ''}
                                        </div>
                                    </div>
                                    <div class="client-actions">
                                        <select class="form-control" style="width: auto; padding: 0.5rem;" onchange="updateRequirementStatus(${req.id}, this.value)">
                                            <option value="pending" ${req.status === 'pending' ? 'selected' : ''}>Pendiente</option>
                                            <option value="in_progress" ${req.status === 'in_progress' ? 'selected' : ''}>En Progreso</option>
                                            <option value="completed" ${req.status === 'completed' ? 'selected' : ''}>Completado</option>
                                        </select>
                                        <button class="btn-icon danger" onclick="deleteRequirement(${req.id})" title="Eliminar">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    ` : `
                        <div class="empty-state" style="padding: 1.5rem;">
                            <p style="font-size: 0.875rem;">No hay requerimientos</p>
                        </div>
                    `}
                </div>
            </div>
        `;
    }).join('');
}

// Utility Functions
function handleSearch() {
    renderClients();
}

async function refreshDashboard() {
    const btn = document.getElementById('refreshBtn');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Actualizando...';
    
    await loadAllData();
    
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-sync-alt"></i> Actualizar';
    showToast('Dashboard actualizado', 'success');
}

function exportData() {
    const data = {
        clients,
        requirements,
        exported_at: new Date().toISOString()
    };
    
    // Export as JSON
    const jsonStr = JSON.stringify(data, null, 2);
    const jsonBlob = new Blob([jsonStr], { type: 'application/json' });
    const jsonUrl = URL.createObjectURL(jsonBlob);
    const jsonLink = document.createElement('a');
    jsonLink.href = jsonUrl;
    jsonLink.download = `dashboard-export-${Date.now()}.json`;
    jsonLink.click();
    
    // Export as CSV
    const csvRows = ['ID,Nombre,Email,Empresa,Teléfono,Estado'];
    clients.forEach(client => {
        csvRows.push([
            client.id,
            `"${(client.name || '').replace(/"/g, '""')}"`,
            `"${(client.email || '').replace(/"/g, '""')}"`,
            `"${(client.company || '').replace(/"/g, '""')}"`,
            `"${(client.phone || '').replace(/"/g, '""')}"`,
            client.status || 'active'
        ].join(','));
    });
    
    const csvStr = csvRows.join('\n');
    const csvBlob = new Blob([csvStr], { type: 'text/csv' });
    const csvUrl = URL.createObjectURL(csvBlob);
    const csvLink = document.createElement('a');
    csvLink.href = csvUrl;
    csvLink.download = `dashboard-export-${Date.now()}.csv`;
    csvLink.click();
    
    showToast('Datos exportados exitosamente', 'success');
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    
    toast.innerHTML = `
        <i class="fas ${icons[type]} toast-icon"></i>
        <div class="toast-message">${escapeHtml(message)}</div>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getStatusLabel(status) {
    const labels = {
        pending: 'Pendiente',
        in_progress: 'En Progreso',
        completed: 'Completado',
        active: 'Activo'
    };
    return labels[status] || status;
}

function getPriorityLabel(priority) {
    const labels = {
        low: 'Baja',
        medium: 'Media',
        high: 'Alta'
    };
    return labels[priority] || priority;
}

// Export functions to global scope
window.openAddClientModal = openAddClientModal;
window.openEditClientModal = openEditClientModal;
window.closeClientModal = closeClientModal;
window.saveClient = saveClient;
window.deleteClient = deleteClient;
window.openAddRequirementModal = openAddRequirementModal;
window.closeRequirementModal = closeRequirementModal;
window.saveRequirement = saveRequirement;
window.deleteRequirement = deleteRequirement;
window.updateRequirementStatus = updateRequirementStatus;