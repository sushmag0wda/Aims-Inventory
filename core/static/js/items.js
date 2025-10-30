// core/static/js/items.js
const API_BASE_URL = "/api";
let currentInventory = []; // Global state to hold fetched items for CRUD logic
let inventoryChart = null; // Global chart instance

// Register Chart.js plugins
Chart.register(ChartDataLabels);

// ===========================================
// UTILITIES (Unmodified)
// ===========================================

async function authFetch(url, options = {}) {
    try {
        const response = await fetch(url, options);
        return response;
    } catch (e) {
        console.error("Fetch error:", e);
        throw e;
    }
}

function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.startsWith(name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

const showMessage = (message, isError = false) => {
    const container = document.querySelector('.items-container') || document.body; 
    const messageContainer = document.createElement('div');
    messageContainer.textContent = message;
    messageContainer.className = `message-box ${isError ? 'error' : 'success'}`;
    const existingMessage = container.querySelector('.message-box');
    if (existingMessage) existingMessage.remove();
    container.insertBefore(messageContainer, container.firstChild);
    setTimeout(() => messageContainer.remove(), 5000);
};


// --- INVENTORY ITEM DEFINITIONS (Master List) ---
const ITEM_CODES = [
    { code: '2PN', name: '200 Pages Note Book' },
    { code: '2PR', name: '200 Pages Record' },
    { code: '2PO', name: '200 Pages Observation' },
    { code: '1PN', name: '100 Pages Note Book' },
    { code: '1PR', name: '100 Pages Record' },
    { code: '1PO', name: '100 Pages Observation' },
];

// ===========================================
// DATA FETCHING AND RENDERING
// ===========================================

// FIX: Removed 'items' argument since it uses the global ITEM_CODES list
function populateItemDropdown() {
    const dropdown = document.getElementById('item-name');
    if (!dropdown) return;
    
    dropdown.innerHTML = '<option value="" disabled selected>Select an Item</option>'; 

    ITEM_CODES.forEach(item => {
        const option = document.createElement('option');
        option.value = item.code; 
        option.textContent = `${item.name} (${item.code})`;
        dropdown.appendChild(option);
    });
}

// FIX: Corrected API URL and added error handling
async function fetchItems() {
    try {
        // 🔥 CRITICAL FIX: Use the correct DRF endpoint /api/items/
        const response = await authFetch(`${API_BASE_URL}/items/`); 
        
        if (!response.ok) {
             const errorData = await response.json();
             throw new Error(errorData.detail || 'API failed with status: ' + response.status);
        }

        const items = await response.json();
        currentInventory = items; // Store the fetched items
        renderItems(items);
        
    } catch (error) {
        console.error("Error fetching inventory items:", error);
        if (error.message !== 'Unauthorized') {
            showMessage("Failed to load inventory stock. Check network and ensure the Django API is running.", true);
        }
    }
}

function renderItems(items) {
    // Update the bar chart instead of table
    renderInventoryChart(items);
}

async function renderInventoryChart(items) {
    const ctx = document.getElementById('inventoryChart');
    if (!ctx) return;

    // Destroy existing chart if it exists
    if (inventoryChart) {
        inventoryChart.destroy();
    }

    try {
        // Fetch issue records to calculate closing stock
        const issueRecordsRes = await authFetch(`${API_BASE_URL}/issue-records/`);
        const issueRecords = await issueRecordsRes.json();
        
        // Calculate issued quantities by item code
        const issuedQuantities = {};
        issueRecords.forEach(record => {
            if (!issuedQuantities[record.item_code]) {
                issuedQuantities[record.item_code] = 0;
            }
            issuedQuantities[record.item_code] += record.qty_issued || 0;
        });

        // Prepare data for chart with opening and closing stock
        const labels = [];
        const openingStock = [];
        const closingStock = [];
        const itemIds = [];

        items.forEach(item => {
            const masterItem = ITEM_CODES.find(i => i.code === item.item_code);
            const itemName = masterItem ? masterItem.name : `[Unknown Item: ${item.item_code}]`;
            
            labels.push(itemName);
            itemIds.push(item.id);
            
            // Opening stock (total inventory)
            const opening = item.quantity || 0;
            openingStock.push(opening);
            
            // Closing stock (opening - issued)
            const issued = issuedQuantities[item.item_code] || 0;
            const closing = Math.max(0, opening - issued);
            closingStock.push(closing);
        });

        // Create the chart with grouped bars
        inventoryChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Opening Stock',
                        data: openingStock,
                        backgroundColor: '#4CAF50', // Green for opening stock
                        borderColor: '#4CAF50',
                        borderWidth: 1,
                        itemIds: itemIds,
                        itemType: 'opening'
                    },
                    {
                        label: 'Closing Stock',
                        data: closingStock,
                        backgroundColor: '#FFB74D', // Pastel orange for closing stock
                        borderColor: '#FFB74D',
                        borderWidth: 1,
                        itemIds: itemIds,
                        itemType: 'closing'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            padding: 20
                        }
                    },
                    tooltip: {
                        callbacks: {
                            afterLabel: function(context) {
                                return `Click to edit/delete`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Quantity'
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Items'
                        }
                    }
                },
                onClick: (event, elements) => {
                    if (elements.length > 0) {
                        const elementIndex = elements[0].index;
                        const itemId = itemIds[elementIndex];
                        const item = items.find(i => i.id === itemId);
                        if (item) {
                            showItemEditModal(item);
                        }
                    }
                },
                plugins: {
                    datalabels: {
                        display: true,
                        color: '#333',
                        font: {
                            weight: 'bold',
                            size: 14
                        },
                        formatter: function(value, context) {
                            return value;
                        },
                        anchor: 'end',
                        align: 'top',
                        offset: 4
                    }
                }
            }
        });

    } catch (error) {
        console.error('Error loading issue records:', error);
        showMessage('Failed to load stock data', true);
    }
}

function showItemEditModal(item) {
    const masterItem = ITEM_CODES.find(i => i.code === item.item_code);
    const itemName = masterItem ? masterItem.name : `[Unknown Item: ${item.item_code}]`;
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>Edit Item: ${itemName}</h3>
            <div class="modal-body">
                <label for="edit-quantity">New Quantity:</label>
                <input type="number" id="edit-quantity" value="${item.quantity}" min="0" required>
            </div>
            <div class="modal-actions">
                <button id="save-item" class="btn-primary">Save</button>
                <button id="delete-item" class="btn-danger">Delete</button>
                <button id="cancel-edit" class="btn-secondary">Cancel</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Event listeners
    document.getElementById('save-item').addEventListener('click', () => {
        const newQuantity = parseInt(document.getElementById('edit-quantity').value);
        if (newQuantity >= 0) {
            updateItemQuantity(item.id, newQuantity);
            modal.remove();
        } else {
            showMessage("Quantity must be 0 or greater", true);
        }
    });
    
    document.getElementById('delete-item').addEventListener('click', () => {
        if (confirm(`Are you sure you want to delete ${itemName}?`)) {
            deleteItem(item.id, item.item_code);
            modal.remove();
        }
    });
    
    document.getElementById('cancel-edit').addEventListener('click', () => {
        modal.remove();
    });
    
    // Close modal when clicking outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

async function updateItemQuantity(itemId, newQuantity) {
    try {
        const response = await authFetch(`${API_BASE_URL}/items/${itemId}/`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify({
                quantity: newQuantity
            })
        });

        if (response.ok) {
            showMessage("Item quantity updated successfully!", false);
            fetchItems();
        } else {
            const error = await response.json();
            throw new Error(JSON.stringify(error) || 'Update failed.');
        }
    } catch (error) {
        console.error("Error updating item:", error);
        showMessage(`Error updating item: ${error.message}`, true);
    }
}


// ===========================================
// CRUD LOGIC: ADD/UPDATE/DELETE
// ===========================================

const addItem = async (event) => {
    event.preventDefault();
    
    const itemCode = document.getElementById("item-name").value;
    const quantity = parseInt(document.getElementById("item-qty").value);

    // Get the full name from the static list for the POST/PUT request
    const masterItem = ITEM_CODES.find(i => i.code === itemCode);

    if (!masterItem || isNaN(quantity) || quantity <= 0) {
        showMessage("Please select an item and enter a quantity greater than zero.", true);
        return;
    }
    
    // Check for existing item to determine POST (new) vs PUT (update stock)
    const existingItem = currentInventory.find(item => item.item_code === itemCode);
    
    let method;
    let url;
    let bodyData = {};

    if (existingItem) {
        // FIX: If item exists, we use PUT/PATCH to UPDATE the total quantity
        method = 'PUT';
        url = `${API_BASE_URL}/items/${existingItem.id}/`;
        // Send the new total quantity: current + added
        bodyData = {
            name: masterItem.name, 
            item_code: itemCode, // Keep the code
            quantity: existingItem.quantity + quantity // Crucial: New stock = Old + Added
        }; 
    } else {
        // If item doesn't exist, we use POST to CREATE a new record
        method = 'POST';
        url = `${API_BASE_URL}/items/`;
        bodyData = {
            name: masterItem.name, // Send name for database record
            item_code: itemCode, 
            quantity: quantity 
        };
    }

    try {
        const response = await authFetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify(bodyData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(JSON.stringify(error) || `${method} failed.`);
        }

        showMessage(`${masterItem.name} stock ${existingItem ? 'updated' : 'added'} successfully!`, false);
        
        // Clear form and refresh chart
        document.getElementById("item-qty").value = ''; 
        document.getElementById("item-name").value = ''; 
        fetchItems(); 

    } catch (error) {
        console.error("Error saving item:", error);
        showMessage(`Error saving item: ${error.message}`, true);
    }
};

async function deleteItem(itemId, itemCode) {
    if (!confirm(`Are you sure you want to delete the inventory record for item code ${itemCode}? This will remove all available stock.`)) {
        return;
    }
    
    try {
        const response = await authFetch(`${API_BASE_URL}/items/${itemId}/`, {
            method: 'DELETE',
            headers: {
                'X-CSRFToken': getCookie('csrftoken')
            }
        });

        if (response.status === 204) { // 204 No Content is standard for successful DELETE
            showMessage(`Item ${itemCode} deleted successfully.`);
            fetchItems();
        } else if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Delete failed.');
        }

    } catch (error) {
        console.error("Item Delete Error:", error);
        showMessage(`Error deleting item: ${error.message}`, true);
    }
}


// ===========================================
// CHART FUNCTIONALITY (Replaces Stock Cards)
// ===========================================

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", function () {
    // FIX: Call the fixed populate function
    populateItemDropdown(); 
    fetchItems();
    
    const itemForm = document.getElementById("item-form");
    if (itemForm) {
        itemForm.addEventListener("submit", addItem);
    }
});